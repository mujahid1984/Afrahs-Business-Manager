import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import type {Entry} from '../../../lib/business';
import type {CorrectionAction, RecordChange} from '../../../lib/record-change';

const reply = (body: unknown, status = 200) =>
  Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});

type Purchase = {date: string; item: string; quantity: number; unitCost: number; amount: number; note: string};

function validPurchase(p: Purchase | undefined): p is Purchase {
  return !!p && typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) &&
    Number.isFinite(Date.parse(p.date)) && new Date(p.date).toISOString().slice(0, 10) === p.date &&
    typeof p.item === 'string' && p.item.length > 0 && p.item.length <= 200 &&
    Number.isSafeInteger(p.quantity) && p.quantity > 0 && p.quantity <= 1000000 &&
    Number.isSafeInteger(p.unitCost) && p.unitCost >= 0 && p.unitCost <= 1e10 &&
    Number.isSafeInteger(p.amount) && p.amount >= 0 && p.amount <= 1e11 &&
    typeof p.note === 'string' && p.note.length <= 1000;
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({error: 'Sign in to correct a record.'}, 401);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return reply({error: 'Invalid request origin.'}, 403);
  try {
    const {action, id, reason, previous, purchase, returnEdit} = await request.json() as {
      action: CorrectionAction;
      id: string; reason: string; previous: Entry; purchase?: Purchase; returnEdit?: Pick<Purchase, 'date' | 'quantity' | 'note'> & {item?: string; originalDate?: string};
    };
    if (!['void-sale', 'delete-purchase', 'edit-purchase', 'delete-return', 'edit-return'].includes(action) ||
      typeof id !== 'string' || id.length < 1 || id.length > 200 ||
      typeof reason !== 'string' || reason.length > 500 ||
      !previous || typeof previous.item !== 'string' || typeof previous.date !== 'string' ||
      !Number.isSafeInteger(previous.quantity) || !Number.isSafeInteger(previous.unitCost) ||
      !Number.isSafeInteger(previous.amount) || typeof previous.note !== 'string') {
      return reply({error: 'Check the record and correction details.'}, 400);
    }
    const isReturn = action === 'edit-return' || action === 'delete-return';
    const editing = action === 'edit-purchase' || action === 'edit-return';
    const relinking = action === 'edit-return' && returnEdit?.item !== undefined && returnEdit.item !== previous.item;
    const originalDate = relinking ? returnEdit?.originalDate ?? '' : previous.originalDate;
    const replacement = action === 'edit-return' && returnEdit ? {
      date: returnEdit.date, item: returnEdit.item ?? previous.item, quantity: returnEdit.quantity, note: returnEdit.note,
      unitCost: relinking ? 0 : previous.unitCost, amount: relinking ? 0 : Math.round(previous.amount * (returnEdit.quantity / previous.quantity)),
    } : isReturn ? undefined : purchase;
    if (editing && !validPurchase(replacement)) return reply({error: 'Enter a valid date, item, quantity and amounts.'}, 400);
    const db = env.DB;
    if (!db) return reply({error: 'The records database is unavailable.'}, 503);

    const saleTotals = `FROM records WHERE kind='sale' AND item=? AND market=? AND date=?`;
    let linkedSale: {qty:number; amount:number; cost:number} | undefined;
    if (relinking && replacement) {
      if (!validPurchase({...replacement, date: originalDate}) || originalDate > replacement.date) {
        return reply({error: 'Choose an original sale date on or before the return date.'}, 400);
      }
      const sale = await db.prepare(`SELECT SUM(quantity) AS qty,SUM(amount) AS amount,SUM(quantity*unit_cost) AS cost ${saleTotals}`)
        .bind(replacement.item, previous.market, originalDate).first<{qty:number; amount:number; cost:number}>();
      if (!sale?.qty) return reply({error: 'No original sale found for this item, marketplace and date.'}, 409);
      linkedSale = sale;
      replacement.unitCost = Math.round(sale.cost / sale.qty);
      replacement.amount = Math.round(sale.amount * replacement.quantity / sale.qty);
      if (!validPurchase(replacement)) return reply({error: 'The corrected return amount is invalid.'}, 400);
    }

    const key = 'correction:' + crypto.randomUUID();
    const kind = action === 'void-sale' ? 'sale' : isReturn ? 'return' : 'purchase';
    // The audit insert is the gate for the mutation. D1 runs both statements in one transaction.
    const stockGuard = kind === 'sale'
      ? `(SELECT COALESCE(SUM(quantity),0) FROM records WHERE kind='return'
          AND item=r.item AND market=r.market AND original_date=r.date) <=
         (SELECT COALESCE(SUM(quantity),0) FROM records WHERE kind='sale'
          AND item=r.item AND market=r.market AND date=r.date AND id<>r.id)`
      : linkedSale
        ? `(SELECT COALESCE(SUM(CASE WHEN kind IN ('purchase','return') THEN quantity
              WHEN kind='sale' THEN -quantity ELSE 0 END),0) FROM records WHERE item=r.item)
            + COALESCE((SELECT offset FROM products WHERE name=r.item),0) - r.quantity >= 0
          AND EXISTS (SELECT 1 FROM products WHERE name=?)
          AND EXISTS (SELECT SUM(quantity) ${saleTotals} HAVING SUM(quantity)=? AND SUM(amount)=? AND SUM(quantity*unit_cost)=?)
          AND ? <= ? - (SELECT COALESCE(SUM(quantity),0) FROM records WHERE kind='return'
            AND item=? AND market=r.market AND original_date=? AND id<>r.id)`
      : isReturn
        ? `(? >= r.quantity OR (
            (SELECT COALESCE(SUM(CASE WHEN kind IN ('purchase','return') THEN quantity
              WHEN kind='sale' THEN -quantity ELSE 0 END),0) FROM records WHERE item=r.item)
            + COALESCE((SELECT offset FROM products WHERE name=r.item),0) - r.quantity + ? >= 0
          ))
          AND (? <= r.quantity OR ? <=
            (SELECT COALESCE(SUM(quantity),0) FROM records WHERE kind='sale'
              AND item=r.item AND market=r.market AND date=r.original_date) -
            (SELECT COALESCE(SUM(quantity),0) FROM records WHERE kind='return'
              AND item=r.item AND market=r.market AND original_date=r.original_date AND id<>r.id))
          AND (?=0 OR r.original_date='' OR ?=r.date OR ?>=r.original_date)`
        : `(SELECT COALESCE(SUM(CASE WHEN kind IN ('purchase','return') THEN quantity
            WHEN kind='sale' THEN -quantity ELSE 0 END),0) FROM records WHERE item=r.item)
         + (SELECT offset FROM products WHERE name=r.item)
         - r.quantity + CASE WHEN r.item=? THEN ? ELSE 0 END >= 0
         AND (?=0 OR EXISTS (SELECT 1 FROM products WHERE name=?))`;
    const replacementItem = replacement?.item ?? '';
    const replacementQuantity = editing ? replacement!.quantity : 0;
    const stockArguments = kind === 'sale' ? [] : linkedSale
      ? [replacementItem, replacementItem, previous.market, originalDate, linkedSale.qty, linkedSale.amount,
        linkedSale.cost, replacementQuantity, linkedSale.qty, replacementItem, originalDate]
      : isReturn
      ? [replacementQuantity, replacementQuantity, replacementQuantity, replacementQuantity,
        replacementQuantity, replacement?.date ?? '', replacement?.date ?? '']
      : [replacementItem, replacementQuantity, replacementQuantity, replacementItem];
    const returnSnapshot = isReturn ? 'AND r.market=? AND r.original_date=?' : '';

    const audit = db.prepare(`
      INSERT OR IGNORE INTO settings (key,value)
      SELECT ?,json_object(
        'action',?,'actor',?,'correctedAt',?,'reason',?,
        'previous',json_object('id',r.id,'kind',r.kind,'date',r.date,'item',r.item,
          'market',r.market,'quantity',r.quantity,'unitCost',r.unit_cost,
          'amount',r.amount,'originalDate',r.original_date,'note',r.note,'actor',r.actor,'createdAt',r.created_at),
        'replacement',json(?)
      ) FROM records r
      WHERE r.id=? AND r.kind=? AND r.date=? AND r.item=? AND r.quantity=?
        AND r.unit_cost=? AND r.amount=? AND r.note=? ${returnSnapshot} AND (${stockGuard})
    `).bind(key, action, user.userId, new Date().toISOString(), reason.trim(),
      JSON.stringify(editing ? relinking ? {...replacement, originalDate} : replacement : null), id, kind, previous.date, previous.item,
      previous.quantity, previous.unitCost, previous.amount, previous.note, ...(isReturn ? [previous.market ?? null, previous.originalDate ?? null] : []), ...stockArguments);
    const gate = 'WHERE id=? AND kind=? AND EXISTS (SELECT 1 FROM settings WHERE key=?)';
    const mutation = editing
      ? db.prepare('UPDATE records SET date=?,item=?,quantity=?,unit_cost=?,amount=?,note=?,original_date=CASE WHEN ? THEN ? ELSE original_date END ' + gate)
        .bind(replacement!.date, replacement!.item, replacement!.quantity, replacement!.unitCost, replacement!.amount, replacement!.note, relinking ? 1 : 0, originalDate ?? '', id, kind, key)
      : db.prepare('DELETE FROM records ' + gate).bind(id, kind, key);
    const statements = [audit, mutation];
    if (editing) {
      statements.push(db.prepare(`
        SELECT id,kind,date,item,market,quantity,unit_cost AS unitCost,amount,
          original_date AS originalDate,note,actor,created_at AS createdAt
        FROM records WHERE id=? AND EXISTS (SELECT 1 FROM settings WHERE key=?)
      `).bind(id, key));
    }
    if (!editing) {
      statements.push(db.prepare(
        'INSERT OR IGNORE INTO settings (key,value) SELECT ?,? WHERE EXISTS (SELECT 1 FROM settings WHERE key=?)'
      ).bind(action + ':' + id, key, key));
    }
    const [archived, changed, updated] = await db.batch(statements);
    if (!archived.meta.changes || !changed.meta.changes) {
      return reply({error: kind === 'sale'
        ? 'This sale changed, was already voided, or is needed to cover a recorded return. Refresh and review the sale.'
        : isReturn ? 'This return changed, would leave negative stock, or exceeds the original sale. Refresh and review the return.'
        : 'This purchase changed, the product is unavailable, or this correction would leave negative stock. Refresh and review the purchase.'}, 409);
    }
    const change: RecordChange = editing
      ? {action: isReturn ? 'edit-return' : 'edit-purchase', record: updated.results[0] as unknown as Entry}
      : {action: action === 'void-sale' ? action : isReturn ? 'delete-return' : 'delete-purchase', recordId: id};
    return reply({ok: true, change});
  } catch {
    return reply({error: 'The correction could not be saved. Refresh and check the record before retrying.'}, 500);
  }
}
