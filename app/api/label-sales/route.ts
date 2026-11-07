import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {isLabelSaleDate, labelMarkets, LabelMarket} from '../../../lib/shipping-label';

const reply = (body: unknown, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});
const markup = {Amazon: 130, Flipkart: 130, Meesho: 140};

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({error: 'Sign in before importing sales.'}, 401);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return reply({error: 'Invalid request origin.'}, 403);
  try {
    const {date, market, rows} = await request.json() as {date?: string; market?: LabelMarket; rows: {id:string; item:string; quantity:number; market?:LabelMarket; date?:string}[]};
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 50 ||
      rows.some(row => !row || !isLabelSaleDate(row.date ?? date) || !labelMarkets.some(value => value === (row.market ?? market)) || !/^label-[a-f0-9]{64}$/.test(row.id) || typeof row.item !== 'string' || !row.item || row.item.length > 200 || !Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 10000) ||
      new Set(rows.map(row => row.id)).size !== rows.length) return reply({error: 'Check the date, marketplace and selected rows.'}, 400);

    const db = env.DB;
    if (!db) return reply({error: 'The sales database is unavailable.'}, 503);
    const payload = JSON.stringify(rows.map(row => {
      const rowMarket = (row.market ?? market)!;
      return {id:row.id, item:row.item, quantity:row.quantity, date:row.date ?? date, market:rowMarket, markup:markup[rowMarket]};
    }));
    const result = await db.prepare(`
      WITH incoming AS (
        SELECT json_extract(value,'$.id') AS id, json_extract(value,'$.item') AS item,
          json_extract(value,'$.quantity') AS quantity, json_extract(value,'$.market') AS market,
          json_extract(value,'$.date') AS date, json_extract(value,'$.markup') AS markup FROM json_each(?)
      ), required AS (
        SELECT item, SUM(quantity) AS quantity FROM incoming GROUP BY item
      )
      INSERT INTO records (id,kind,date,item,market,quantity,unit_cost,amount,original_date,note,actor,created_at)
      SELECT i.id,'sale',i.date,i.item,i.market,i.quantity,p.cost,ROUND(i.quantity*p.cost*i.markup/100.0),
        '','Imported from shipping PDF',?,?
      FROM incoming i JOIN products p ON p.name=i.item
      WHERE NOT EXISTS (SELECT 1 FROM incoming x JOIN records r ON r.id=x.id)
      AND NOT EXISTS (SELECT 1 FROM incoming x JOIN settings s ON s.key='void-sale:' || x.id)
      AND NOT EXISTS (
        SELECT 1 FROM required q LEFT JOIN products p2 ON p2.name=q.item
        WHERE p2.name IS NULL OR q.quantity > p2.offset + (
          SELECT COALESCE(SUM(CASE WHEN kind IN ('purchase','return') THEN quantity WHEN kind='sale' THEN -quantity ELSE 0 END),0)
          FROM records WHERE item=q.item
        )
      )
    `).bind(payload,user.userId,new Date().toISOString()).run();
    if (result.meta.changes !== rows.length) {
      const duplicates = await db.prepare("SELECT json_extract(value,'$.id') AS id FROM json_each(?) j WHERE EXISTS (SELECT 1 FROM records WHERE id=json_extract(j.value,'$.id')) OR EXISTS (SELECT 1 FROM settings WHERE key='void-sale:' || json_extract(j.value,'$.id'))").bind(payload).all<{id:string}>();
      return reply({error: duplicates.results.length ? 'Some labels were already imported or voided. Review the marked rows.' : 'Available stock is insufficient for this batch. Review the quantities and try again.', duplicates: duplicates.results.map(row => row.id)}, 409);
    }
    return reply({saved: result.meta.changes});
  } catch {
    return reply({error: 'Could not import the selected sales. Retry safely.'}, 500);
  }
}
