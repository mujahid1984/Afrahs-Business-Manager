import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {snapshot} from '../../../lib/snapshot';
import {Entry,markets} from '../../../lib/business';
import {assignMissingProductNumbers, readProductCatalog} from '../../../lib/product-catalog';
export const dynamic='force-dynamic';
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const cols='id,kind,date,item,market,quantity,unit_cost AS unitCost,amount,original_date AS originalDate,note,actor,created_at AS createdAt';
const db=()=>{if(!env.DB)throw new Error('Database unavailable');return env.DB;};
async function read() {
  const database = db();
  const initialized = await database.prepare("SELECT value FROM settings WHERE key='initialized'").first();
  if (!initialized) return {...snapshot(), initialized: false};

  const catalog = await readProductCatalog(database);
  const entries = await database.prepare(
    `SELECT ${cols} FROM records ORDER BY date,created_at,id`
  ).all();
  return {
    entries: entries.results,
    ...catalog,
    initialized: true,
    importedAt: '2026-11-03',
  };
}
const validDate=(s:string)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
function validEntry(e:Entry | undefined):e is Entry {
  if(!e||!['purchase','sale','return','expense','settlement'].includes(e.kind))return false;
  return validDate(e.date)&&typeof e.item==='string'&&!!e.item.trim()&&e.item.length<=200
    && Number.isSafeInteger(e.amount)&&e.amount>=0&&e.amount<=1e11
    && Number.isSafeInteger(e.unitCost)&&e.unitCost>=0&&e.unitCost<=1e10
    && Number.isSafeInteger(e.quantity)&&e.quantity>=(e.kind==='settlement'?0:1)&&e.quantity<=1e6
    && typeof e.id==='string'&&/^[-a-zA-Z0-9_]{8,80}$/.test(e.id);
}

const recordBatchKinds = {
  'sale-batch': 'sale',
  'purchase-batch': 'purchase',
  'expense-batch': 'expense',
  'settlement-batch': 'settlement',
} as const;
type RecordBatchKind = typeof recordBatchKinds[keyof typeof recordBatchKinds];

type ProductDraft = {name: string; cost: number};
async function saveProductBatch(database: ReturnType<typeof db>, products: ProductDraft[] | undefined) {
  if (!Array.isArray(products) || !products.length || products.length > 50 ||
    products.some(p => !p || typeof p.name !== 'string' || !p.name.trim() ||
      p.name.trim().length > 200 || !Number.isSafeInteger(p.cost) || p.cost < 0)) {
    return reply({error:'Enter a valid name and unit cost for each product. Submit up to 50 products.'},400);
  }
  const normalized = products.map(({name,cost}) => ({name:name.trim(),cost}));
  if (new Set(normalized.map(p => p.name)).size !== normalized.length) {
    return reply({error:'Remove duplicate product names from the batch.'},400);
  }

  await assignMissingProductNumbers(database);
  const payload = JSON.stringify(normalized);
  const incoming = `WITH incoming AS (
    SELECT json_extract(value,'$.name') AS name, json_extract(value,'$.cost') AS cost
    FROM json_each(?)
  )`;
  const result = await database.prepare(`${incoming}
    INSERT INTO products (name,cost,offset)
    SELECT name,cost,0 FROM incoming
    WHERE NOT EXISTS (SELECT 1 FROM incoming i JOIN products p ON p.name=i.name)
  `).bind(payload).run();
  if (result.meta.changes === normalized.length) return reply(await read());

  // A retry of an already committed batch has the same product names and costs.
  const existing = await database.prepare(`${incoming}
    SELECT COUNT(*) AS matched FROM incoming i JOIN products p ON p.name=i.name AND p.cost=i.cost
  `).bind(payload).first<{matched:number}>();
  if (existing?.matched === normalized.length) return reply(await read());
  return reply({error:'A product name already exists. Remove it from the batch and try again.'},409);
}

async function saveBatch(database:ReturnType<typeof db>,entries:Entry[] | undefined,actor:string,kind:RecordBatchKind) {
  const usesMarket=kind==='sale'||kind==='settlement';
  const usesCatalog=kind==='sale'||kind==='purchase';
  if(!Array.isArray(entries)||!entries.length||entries.length>50||
    entries.some(entry=>!validEntry(entry)||entry.kind!==kind||(usesMarket&&!markets.includes(entry.market)))||
    new Set(entries.map(entry=>entry.id)).size!==entries.length) {
    return reply({error:'Check each item’s date, description, marketplace and amounts. Submit up to 50 items at a time.'},400);
  }

  const payload=JSON.stringify(entries.map(({id,date,item,market,quantity,unitCost,amount,note})=>({
    id,date,item:usesCatalog?item:item.trim(),market:usesMarket?market:'',quantity,unitCost,amount,note:String(note||'').slice(0,1000),
  })));
  const correctionPrefix=kind==='sale'?'void-sale:':kind==='purchase'?'delete-purchase:':null;
  // A single write validates the entire batch and checks stock for sales.
  const incoming=`WITH incoming AS (
    SELECT json_extract(value,'$.id') AS id, json_extract(value,'$.date') AS date,
      json_extract(value,'$.item') AS item, json_extract(value,'$.market') AS market,
      json_extract(value,'$.quantity') AS quantity, json_extract(value,'$.unitCost') AS unit_cost,
      json_extract(value,'$.amount') AS amount, json_extract(value,'$.note') AS note
    FROM json_each(?)
  )`;
  const result=await database.prepare(`${incoming},
    required AS (SELECT item,SUM(quantity) AS quantity FROM incoming GROUP BY item)
    INSERT INTO records (id,kind,date,item,market,quantity,unit_cost,amount,original_date,note,actor,created_at)
    SELECT id,?,date,item,market,quantity,unit_cost,amount,'',note,?,?
    FROM incoming
    WHERE NOT EXISTS (SELECT 1 FROM incoming i JOIN records r ON r.id=i.id)
      AND NOT EXISTS (SELECT 1 FROM incoming i JOIN settings s ON s.key=? || i.id)
      AND NOT EXISTS (
        SELECT 1 FROM required q LEFT JOIN products p ON p.name=q.item
        WHERE ? AND (p.name IS NULL OR (?='sale' AND q.quantity > p.offset + (
          SELECT COALESCE(SUM(CASE WHEN kind IN ('purchase','return') THEN quantity
            WHEN kind='sale' THEN -quantity ELSE 0 END),0)
          FROM records WHERE item=q.item
        )))
      )
  `).bind(payload,kind,actor,new Date().toISOString(),correctionPrefix,usesCatalog?1:0,kind).run();

  if(result.meta.changes===entries.length)return reply(await read());
  const existing=await database.prepare(`${incoming}
    SELECT COUNT(r.id) AS found, COALESCE(SUM(CASE WHEN r.kind=? AND r.actor=?
      AND r.date=i.date AND r.item=i.item AND r.market=i.market AND r.quantity=i.quantity
      AND r.unit_cost=i.unit_cost AND r.amount=i.amount AND r.note=i.note THEN 1 ELSE 0 END),0) AS matched,
      COUNT(s.key) AS voided
    FROM incoming i LEFT JOIN records r ON r.id=i.id
    LEFT JOIN settings s ON s.key=? || i.id
  `).bind(payload,kind,actor,correctionPrefix).first<{found:number;matched:number;voided:number}>();
  if(existing?.matched===entries.length&&!existing.voided)return reply(await read());
  if(existing?.found||existing?.voided)return reply({error:'Some items were already saved or corrected. Check the saved records before submitting again.'},409);
  return reply({error:kind==='sale'?'Check available stock and product names. The batch could not be saved.':'A product in the batch is missing from the catalog. Check the products and try again.'},409);
}

export async function GET(){if(!await getChatGPTUser())return reply({error:'Sign in to open your private workspace.'},401);try{return reply(await read());}catch{return reply({error:'Could not load the database. Please retry.'},503);}}
export async function POST(req:Request){const user=await getChatGPTUser();if(!user)return reply({error:'Sign in before saving.'},401);if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'Invalid request origin'},403);try{const b=await req.json() as {action?:string;name?:string;cost?:number;entry?:Entry;entries?:Entry[];products?:ProductDraft[]};const d=db();if(b.action==='initialize'){const s=snapshot();const insert=(e:Entry)=>d.prepare('INSERT OR IGNORE INTO records VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(e.id,e.kind,e.date,e.item,e.market,e.quantity,e.unitCost,e.amount,e.originalDate,e.note,e.actor,e.createdAt);await d.batch([...s.entries.map(insert),...s.products.map(p=>d.prepare('INSERT OR IGNORE INTO products VALUES (?,?,?)').bind(p.name,p.cost,p.offset)),d.prepare("INSERT OR IGNORE INTO settings VALUES ('initialized','2026-11-03')")]);return reply(await read());}
if(!await d.prepare("SELECT value FROM settings WHERE key='initialized'").first())return reply({error:'Initialize the copied records first.'},409);
if(b.action==='product'){const name=String(b.name||'').trim();const cost=Number(b.cost);if(!name||name.length>200||!Number.isSafeInteger(cost)||cost<0)return reply({error:'Enter a product name and valid cost.'},400);await assignMissingProductNumbers(d);const r=await d.prepare('INSERT OR IGNORE INTO products(name,cost,offset) VALUES (?,?,0)').bind(name,cost).run();if(!r.meta.changes)return reply({error:'This product already exists.'},409);return reply(await read());}
if(b.action==='product-batch')return await saveProductBatch(d,b.products);
const batchKind=recordBatchKinds[b.action as keyof typeof recordBatchKinds];
if(typeof batchKind==='string')return await saveBatch(d,b.entries,user.userId,batchKind);
const e=b.entry as Entry;
if(!validEntry(e))return reply({error:'Check the date, item, quantity and amounts.'},400);
if(['sale','return','settlement'].includes(e.kind)&&!markets.includes(e.market))return reply({error:'Choose a marketplace.'},400);
if(e.kind==='return'&&(!validDate(e.originalDate)||e.originalDate>e.date))return reply({error:'Choose an original sale date no later than the return date.'},400);
if(['sale','purchase','return'].includes(e.kind)&&!await d.prepare('SELECT name FROM products WHERE name=?').bind(e.item).first())return reply({error:'Add this product to the catalog first.'},400);
if(e.kind==='return'){const original=await d.prepare("SELECT SUM(quantity) AS qty,SUM(amount) AS amount,SUM(quantity*unit_cost) AS cost FROM records WHERE kind='sale' AND item=? AND market=? AND date=?").bind(e.item,e.market,e.originalDate).first<{qty:number;amount:number;cost:number}>();if(!original?.qty)return reply({error:'Original sale not found.'},400);e.unitCost=Math.round(original.cost/original.qty);e.amount=Math.round(original.amount*e.quantity/original.qty);}
const values=[e.id,e.kind,e.date,e.item.trim(),e.market||'',e.quantity,e.unitCost,e.amount,e.originalDate||'',String(e.note||'').slice(0,1000),user.userId,new Date().toISOString()];
let condition='1';let params:unknown[]=[];
if(e.kind==='sale'){condition="(SELECT COALESCE(SUM(CASE WHEN kind IN ('purchase','return') THEN quantity WHEN kind='sale' THEN -quantity ELSE 0 END),0) FROM records WHERE item=?) + (SELECT offset FROM products WHERE name=?) >= ?";params=[e.item,e.item,e.quantity];}
if(e.kind==='return'){condition="(SELECT COALESCE(SUM(CASE WHEN kind='sale' AND date=? THEN quantity WHEN kind='return' AND original_date=? THEN -quantity ELSE 0 END),0) FROM records WHERE item=? AND market=?) >= ?";params=[e.originalDate,e.originalDate,e.item,e.market,e.quantity];}
const result=await d.prepare(`INSERT OR IGNORE INTO records SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${condition}`).bind(...values,...params).run();if(!result.meta.changes){if(await d.prepare('SELECT id FROM records WHERE id=?').bind(e.id).first())return reply(await read());return reply({error:e.kind==='return'?'Return exceeds the remaining quantity for this item and original sale date.':'Insufficient available stock. Another user may have just saved a sale.'},409);}return reply(await read());
}catch{return reply({error:'Unable to save. Retry safely; duplicate submissions are prevented.'},500);}}
