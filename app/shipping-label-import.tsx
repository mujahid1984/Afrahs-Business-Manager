'use client';
import {readApiResponse} from '../lib/api-response';
import {dateToday} from '../lib/business';

import {useState} from 'react';
import {Upload, X} from 'lucide-react';
import {isLabelSaleDate, labelMarkets, LabelMarket, readLabelPage} from '../lib/shipping-label';

type Draft = {file: string; location: string; market?: LabelMarket; id: string; item: string; quantity: number; title: string; error: string; checked: boolean; review: boolean; editing: boolean};
type PdfPage = {
  getTextContent(): Promise<{items: Parameters<typeof readLabelPage>[0]}>;
  getViewport(options: {scale: number}): Parameters<typeof readLabelPage>[1];
};
type PdfDocument = {numPages: number; getPage(page: number): Promise<PdfPage>; destroy(): Promise<void>};
type PdfReader = {
  GlobalWorkerOptions: {workerSrc: string};
  getDocument(options: {data: ArrayBuffer; isEvalSupported: boolean}): {promise: Promise<PdfDocument>};
};

export default function ShippingLabelImport({products, onSaved}: {products: string[]; onSaved: (count:number) => void}) {
  const [open, setOpen] = useState(false);
  const [market, setMarket] = useState<LabelMarket | ''>('');
  const [saleDate, setSaleDate] = useState('');
  const [rows, setRows] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const maxSales = 50;
  const selected = rows.filter(row => row.checked && !row.error && !row.review && products.includes(row.item));

  const validSaleDate = isLabelSaleDate(saleDate);

  async function readFiles(files: File[]) {
    setRows([]);
    setError('');
    if (files.length === 0) return;
    if (files.length > 50) {
      setError('Choose up to 50 PDFs per batch.');
      return;
    }
    setBusy(true);
    try {
      const modulePath = '/label-reader/pdf.min.mjs';
      const reader = await import(/* @vite-ignore */ modulePath) as PdfReader;
      reader.GlobalWorkerOptions.workerSrc = '/label-reader/pdf.worker.min.mjs';
      const drafts: Draft[] = [];
      const seen = new Set<string>();
      let pagesRead = 0;
      for (const file of files) {
        const base: Draft = {file: file.name, location: '', id: '', item: '', quantity: 0, title: '', checked: false, review: false, editing: false, error: ''};
        try {
          if (!file.name.toLowerCase().endsWith('.pdf') || file.size > 10_000_000) {
            throw Error('Choose a PDF no larger than 10 MB.');
          }
          const doc = await reader.getDocument({data: await file.arrayBuffer(), isEvalSupported: false}).promise;
          try {
            if (doc.numPages > 50 || pagesRead + doc.numPages > 200) {
              throw Error('Use up to 50 pages per PDF and 200 pages per upload.');
            }
            pagesRead += doc.numPages;
            for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
              const page = await doc.getPage(pageNumber);
              const {items} = await page.getTextContent();
              const labels = readLabelPage(items, page.getViewport({scale: 1}), products, market || undefined);
              for (const {slot, market: labelMarket, match, orders} of labels) {
                const location = 'Page ' + pageNumber + (slot ? ' · label ' + slot : '');
                const draft: Draft = {...base, location, market: labelMarket, title: match?.title || '',
                  item: match?.item || '', quantity: match?.quantity || 0};
                if (!labelMarket || !match?.order || !match.quantity) {
                  draft.error = orders.length > 1
                    ? 'Several orders share this area. Upload the original labels or invoices.'
                    : 'Order number or single-item quantity unavailable. Use the original invoice or Add sale.';
                } else {
                  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(labelMarket + ':' + match.order));
                  draft.id = 'label-' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
                  draft.error = seen.has(draft.id) ? 'Duplicate order in this batch' : '';
                  draft.review = !match.confident;
                  seen.add(draft.id);
                }
                drafts.push(draft);
              }
            }
          } finally {
            await doc.destroy();
          }
        } catch (failure) {
          drafts.push({...base, error: failure instanceof Error ? failure.message : 'Could not read PDF. Use Add sale.'});
        }
      }
      setRows(drafts);
    } catch {
      setError('The PDF reader could not start. Retry or use Add sale.');
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !selected.length || selected.length > maxSales || !validSaleDate) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/label-sales', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({date: saleDate, rows: selected.map(({id, item, quantity, market}) => ({id, item, quantity, market}))}),
      });
      const data = await readApiResponse(response) as {saved?: number; error?: string; duplicates?: string[]};
      if (!response.ok) {
        if (data.duplicates?.length) setRows(previous => previous.map(row => data.duplicates?.includes(row.id) ? {...row, checked: false, error: 'Already imported'} : row));
        throw Error(data.error || 'Could not save the selected sales.');
      }
      const saved = new Set(selected.map(row => row.id));
      setRows(previous => previous.map(row => !row.error && saved.has(row.id) ? {...row, checked: false, error: 'Saved'} : row));
      onSaved(data.saved || 0);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the selected sales.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="secondary" onClick={() => {setSaleDate(dateToday());setOpen(true);}}><Upload size={16}/>Upload shipping labels</button>
    {open && <div className="modal-backdrop">
      <div className="purchase-planner" role="dialog" aria-modal="true" aria-labelledby="shipping-import-title" onKeyDown={event => {if (event.key === 'Escape' && !busy) setOpen(false);}}>
        <div className="modal-head">
          <div><h2 id="shipping-import-title">Import shipping labels</h2><p>Choose one sale date for the batch and review the products and quantities.</p></div>
          <button type="button" className="icon-button" aria-label="Close importer" disabled={busy} onClick={() => setOpen(false)}><X size={19}/></button>
        </div>
        <form className="planner-body" onSubmit={save}>
          <div className="label-import-fields">
            <label>Marketplace hint<select autoFocus value={market} disabled={busy} onChange={event => {setMarket(event.target.value as LabelMarket | '');setRows([]);setError('');}}><option value="">Auto-detect</option>{labelMarkets.map(name => <option key={name}>{name}</option>)}</select></label>
            <label>Sale date<input type="date" required disabled={busy} value={saleDate} onChange={event => setSaleDate(event.target.value)}/></label>
            <label>Shipping or invoice PDFs<input type="file" multiple accept=".pdf,application/pdf" disabled={busy} onChange={event => {const files = Array.from(event.target.files || []);event.target.value = '';void readFiles(files);}}/></label>
          </div>
          <p className="label-import-help">Upload individual, merged, or 4-in-1 PDFs. Each readable label gets its own row. Compare the rows with your sheet, check products and quantities, then submit together. For image-only labels, use the original invoices.</p>
          {error && <div className="error" role="alert">{error}</div>}
          {busy && <p role="status">Working…</p>}
          {rows.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th>Confirm</th><th>PDF / label</th><th>Marketplace</th><th>Inventory item</th><th>Qty</th><th>Status</th></tr></thead>
            <tbody>{rows.map((row,index) => {
              const update = (changes: Partial<Draft>) => setRows(previous => previous.map((entry,i) => i === index ? {...entry, ...changes} : entry));
              const validProduct = products.includes(row.item);
              return <tr key={index}>
                <td>{row.review && !row.error
                  ? <button type="button" className="secondary" disabled={busy || !validProduct}
                      onClick={() => update({checked: true, review: false, editing: false})}>Confirm</button>
                  : <input type="checkbox" aria-label={'Confirm row ' + (index + 1)} disabled={busy || !!row.error || !validProduct}
                      checked={row.checked} onChange={event => update({checked: event.target.checked})}/>}
                </td>
                <td>{row.file}{row.location && <div className="label-import-location">{row.location}</div>}
                  {(row.review || row.error && row.error !== 'Saved') && row.title &&
                    <small className="label-import-title">Label title · {row.title}</small>}
                </td>
                <td>{row.market || '—'}</td>
                <td>{row.editing
                  ? <select autoFocus size={Math.max(2, Math.min(7, products.length + 1))} aria-label={'Inventory item for row ' + (index + 1)} disabled={busy}
                      value={validProduct ? row.item : ''} onChange={event => update({item: event.target.value})}>
                      <option value="">Choose a product</option>
                      {products.map(product => <option key={product}>{product}</option>)}
                    </select>
                  : <>{row.item || '—'}{row.review && row.item && !row.error && <small className="label-import-title">Suggested product</small>}</>}
                  {!row.error && !row.editing && <button type="button" className="text-button label-import-modify" disabled={busy}
                    onClick={() => update({editing: true, review: true, checked: false})}>Modify</button>}
                </td>
                <td>{row.quantity || '—'}</td>
                <td className={row.review || row.error && row.error !== 'Saved' ? 'label-import-warning' : undefined}>
                  {row.error || (row.review ? validProduct ? 'Confirm product' : 'Choose a product' : 'Ready for review')}
                </td>
              </tr>;
            })}</tbody>
          </table></div>}
          {selected.length > maxSales && <p className="label-import-warning" role="status">Select up to {maxSales} sales per submission.</p>}
          <div className="label-import-actions"><button className="primary" type="submit" disabled={busy || !validSaleDate || selected.length === 0 || selected.length > maxSales}>Submit selected sales ({selected.length})</button></div>
        </form>
      </div>
    </div>}
  </>;
}
