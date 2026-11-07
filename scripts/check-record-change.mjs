import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

fs.mkdirSync('work/record-change-check', {recursive: true});
for (const name of ['business', 'record-change']) {
  const source = fs.readFileSync('lib/' + name + '.ts', 'utf8');
  fs.writeFileSync('work/record-change-check/' + name + '.mjs', ts.transpileModule(source, {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022},
  }).outputText);
}
const {applyRecordChange} = await import('../work/record-change-check/record-change.mjs');
const {summarize, stock} = await import('../work/record-change-check/business.mjs');

const purchase = {id: 'purchase', kind: 'purchase', date: '2026-10-01', item: 'Pot',
  market: '', quantity: 20, unitCost: 40000, amount: 800000, originalDate: '',
  note: '', actor: 'test', createdAt: '2026-10-01'};
const sale = {...purchase, id: 'sale', kind: 'sale', date: '2026-11-04', market: 'Amazon',
  quantity: 7, amount: 364000};
const earlierSale = {...sale, id: 'earlier-sale', date: '2026-10-10', quantity: 2, amount: 104000};
const entries = [purchase, earlierSale, sale];
const products = [{name: 'Pot', cost: 40000, offset: 0}];
const before = summarize(entries, 'all');
const corrected = applyRecordChange(entries, {action: 'void-sale', recordId: sale.id});
const after = summarize(corrected, 'all');
assert.equal(after.sales, before.sales - sale.amount);
assert.equal(summarize(corrected, '2026-11').sales, 0);
assert.equal(after.cost, before.cost - sale.quantity * sale.unitCost);
assert.equal(stock(corrected, products)[0].available, stock(entries, products)[0].available + 7);
assert.equal(applyRecordChange(corrected, {action: 'void-sale', recordId: sale.id}).length, corrected.length);
assert.equal(entries.length, 3);

const editedPurchase = {...purchase, quantity: 30, amount: 1200000};
const edited = applyRecordChange(entries, {action: 'edit-purchase', record: editedPurchase});
assert.equal(summarize(edited, 'all').purchases, 1200000);
assert.equal(stock(edited, products)[0].available, 21);
const removed = applyRecordChange(edited, {action: 'delete-purchase', recordId: purchase.id});
assert.equal(summarize(removed, 'all').purchases, 0);
console.log('PASS: immediate monthly/all-time sales, cost, profit inputs, restored stock, idempotent UI updates and purchase corrections.');
