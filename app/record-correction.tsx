'use client';
import {readApiResponse} from '../lib/api-response';

import {useState} from 'react';
import {X} from 'lucide-react';
import {Entry, Product, money} from '../lib/business';
import type {CorrectionAction, RecordChange} from '../lib/record-change';

export default function RecordCorrection({entry, products, entries, onSaved}: {
  entry: Entry; products: Product[]; entries: Entry[]; onSaved: (message: string, change: RecordChange) => void;
}) {
  const [original, setOriginal] = useState(entry);
  const [action, setAction] = useState<CorrectionAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [form, setForm] = useState({date: '', originalDate: '', item: '', quantity: '', unitCost: '', amount: '', note: ''});
  const isReturn = original.kind === 'return';
  const editing = action === 'edit-purchase' || action === 'edit-return';
  const recordName = isReturn ? 'return' : 'purchase';
  const label = editing ? 'Edit ' + recordName : action === 'void-sale' ? 'Void sale' : 'Delete ' + recordName;

  const changingItem = isReturn && form.item !== original.item;
  const eligibleSales = isReturn && editing ? entries.filter(sale => sale.kind === 'sale' &&
    sale.market === original.market && sale.date <= form.date) : [];
  const returnItems = new Set([original.item, ...eligibleSales.map(sale => sale.item)]);
  const saleDates = [...new Set(eligibleSales.filter(sale => sale.item === form.item).map(sale => sale.date))].sort().reverse();

  function begin(next: CorrectionAction) {
    setOriginal(entry);
    setForm({date: entry.date, originalDate: entry.originalDate, item: entry.item, quantity: String(entry.quantity),
      unitCost: String(entry.unitCost / 100), amount: (entry.amount / 100).toFixed(2), note: entry.note});
    setError('');
    setReason('');
    setAction(next);
  }

  function update(key: keyof typeof form, value: string) {
    setForm(previous => {
      const next = {...previous, [key]: value};
      if (isReturn && key === 'item') next.originalDate = value === original.item ? original.originalDate : '';
      if (key === 'quantity' || key === 'unitCost') {
        const adjustment = Number(previous.amount) - Number(previous.quantity) * Number(previous.unitCost);
        next.amount = Math.max(0, Number(next.quantity) * Number(next.unitCost) + adjustment).toFixed(2);
      }
      return next;
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!action || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/record-correction', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action, id: original.id, reason, previous: original, returnEdit: action === 'edit-return' ? {date: form.date, item: form.item, originalDate: form.originalDate, quantity: Number(form.quantity), note: form.note} : undefined, purchase: action === 'edit-purchase' ? {
          ...form, quantity: Number(form.quantity), unitCost: Math.round(Number(form.unitCost) * 100),
          amount: Math.round(Number(form.amount) * 100),
        } : undefined}),
      });
      const result = await readApiResponse(response) as {error?: string; change?: RecordChange};
      if (!response.ok) throw Error(result.error || 'Could not correct the record.');
      if (!result.change) throw Error('Refresh the page to verify this correction.');
      setAction(null);
      const message = editing ? isReturn ? 'Return updated' : 'Purchase updated' : action === 'void-sale'
        ? 'Sale voided · ' + money(original.amount) + ' deducted'
        : isReturn ? 'Return deleted' : 'Purchase deleted';
      onSaved(message, result.change);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not correct the record.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="record-actions">
      {entry.kind === 'sale'
        ? <button className="text-button negative" onClick={() => begin('void-sale')}>Void</button>
        : <>
          <button className="text-button" onClick={() => begin(entry.kind === 'return' ? 'edit-return' : 'edit-purchase')}>Edit</button>
          <button className="text-button negative" onClick={() => begin(entry.kind === 'return' ? 'delete-return' : 'delete-purchase')}>Delete</button>
        </>}
    </div>
    {action && <div className="modal-backdrop">
      <div className="purchase-planner record-correction" role="dialog" aria-modal="true" aria-label={label}
        onKeyDown={event => {if (event.key === 'Escape' && !busy) setAction(null);}}>
        <div className="modal-head">
          <div><h2>{label}</h2><p>{original.item} · {original.date} · {original.quantity} units · {money(original.amount)}</p></div>
          <button className="icon-button" disabled={busy} aria-label="Close correction" onClick={() => setAction(null)}><X size={19}/></button>
        </div>
        <form className="planner-body" onSubmit={save}>
          {editing ? <fieldset className="label-import-fields" disabled={busy}>
            <label>{isReturn ? 'Return date' : 'Purchase date'}<input autoFocus type="date" required value={form.date} onChange={e => update('date', e.target.value)}/></label>
            <label>Item<select required value={form.item} onChange={e => update('item', e.target.value)}>{(isReturn ? [...returnItems].filter(name => name === original.item || products.some(p => p.name === name)) : products.map(p => p.name)).map(name => <option key={name}>{name}</option>)}</select></label>
            <label>Product ID<input readOnly value={products.find(product => product.name === form.item)?.productId || ''}/></label>
            {changingItem && <label>Original sale date<select required value={saleDates.includes(form.originalDate) ? form.originalDate : ''} onChange={e => update('originalDate', e.target.value)}>
              <option value="">Choose original sale</option>{saleDates.map(date => <option key={date}>{date}</option>)}
            </select></label>}
            <label>Quantity<input type="number" required min="1" max="1000000" step="1" value={form.quantity} onChange={e => update('quantity', e.target.value)}/></label>
            {!isReturn && <><label>Unit cost (₹)<input type="number" required min="0" step="0.01" value={form.unitCost} onChange={e => update('unitCost', e.target.value)}/></label>
            <label>Total including GST (₹)<input type="number" required min="0" step="0.01" value={form.amount} onChange={e => update('amount', e.target.value)}/></label></>}
            {isReturn && <p className="label-import-help">To change the item, choose its original sale date. The return amount is recalculated from that sale.</p>}
            <label>{isReturn ? 'Return note' : 'Purchase note'}<input maxLength={1000} value={form.note} onChange={e => update('note', e.target.value)}/></label>
          </fieldset> : <p className="label-import-help">{action === 'void-sale'
            ? 'Voiding this sale restores its quantity to stock and removes its value from sales totals.'
            : isReturn ? 'Deleting this return removes its value from return totals and reverses the stock it restored.'
            : 'Deleting this purchase removes its quantity from stock and its value from purchase totals.'}</p>}
          <div className="label-import-fields"><label>Reason (optional)<input autoFocus={!editing} maxLength={500} disabled={busy} value={reason} onChange={e => setReason(e.target.value)}/></label></div>
          {error && <div className="error" role="alert">{error}</div>}
          <div className="record-actions">
            <button type="button" className="secondary" disabled={busy} onClick={() => setAction(null)}>Cancel</button>
            <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : label}</button>
          </div>
        </form>
      </div>
    </div>}
  </>;
}
