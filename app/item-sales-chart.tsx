'use client';
import {useMemo,useState} from 'react';
import {BarChart3,Search} from 'lucide-react';
import {Entry,Product,itemSales,markets} from '../lib/business';
const colors=['#b7954e','#142b4a','#7393ac','#7a9c8e'];
export default function ItemSalesChart({entries,products,month}:{entries:Entry[];products:Product[];month:string}){
 const [search,setSearch]=useState(''),[sort,setSort]=useState('quantity');
 const rows=useMemo(()=>itemSales(entries,products,month).filter(r=>r.name.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>sort==='quantity'?b.total-a.total||a.name.localeCompare(b.name):a.name.localeCompare(b.name)),[entries,products,month,search,sort]);
 const positive=(r:typeof rows[number])=>markets.reduce((a,m)=>a+Math.max(0,r.values[m]||0),0);
 const negative=(r:typeof rows[number])=>markets.reduce((a,m)=>a+Math.min(0,r.values[m]||0),0);
 const max=Math.max(4,Math.ceil(Math.max(0,...rows.map(positive))/4)*4);
 const min=Math.min(0,Math.floor(Math.min(0,...rows.map(negative))/4)*4);
 const span=max-min;const period=month==='all'?'All months':new Date(month+'-01T00:00:00').toLocaleDateString('en-GB',{month:'long',year:'numeric'});
 const total=rows.reduce((a,r)=>a+r.total,0);
 return <section className="panel item-chart" aria-labelledby="item-sales-title"><div className="panel-head"><div><div className="item-chart-kicker"><BarChart3 size={14}/> PRODUCT INSIGHTS</div><h2 id="item-sales-title">Item-wise sales</h2><p>Net quantities after valid returns · {period} · follows Master Month</p></div><div className="item-chart-summary"><strong>{total.toLocaleString('en-IN')}</strong><span>net units</span></div></div>
 <div className="item-chart-controls"><label className="search"><Search size={16}/><input aria-label="Search items in sales chart" placeholder="Find a product…" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="Sort item-wise chart" value={sort} onChange={e=>setSort(e.target.value)}><option value="quantity">Top selling first</option><option value="name">Product name</option></select><div className="item-legend">{markets.map((m,i)=><span key={m}><i style={{background:colors[i]}}/>{m}</span>)}</div></div>
 <div className="item-chart-body" role="group" aria-label={'Net units sold by product and marketplace, '+period}>
 <div className="item-axis"><span>PRODUCT</span><div>{[0,1,2,3,4].map(i=><span key={i}>{min+span*i/4}</span>)}</div><span>NET QTY</span></div>
 {rows.map((r,index)=><div className="item-chart-row" key={r.name}><div className="item-chart-label"><span>{String(index+1).padStart(2,'0')}</span><b>{r.name}</b></div><div className="item-track"><div className="item-zero" style={{left:-min/span*100+'%'}}/>{min<0&&<div className="item-stack negative-stack" style={{width:-min/span*100+'%'}}>{markets.map((m,i)=>{const q=Math.min(0,r.values[m]||0);return q!==0?<span key={m} tabIndex={0} className="item-segment" style={{width:Math.abs(q/min)*100+'%',background:colors[i]}} title={`${r.name} · ${m}: ${q} net units`} aria-label={`${r.name}, ${m}, ${q} net units`}>{Math.abs(q/min)>.1?q:''}</span>:null})}</div>}<div className="item-stack" style={{left:-min/span*100+'%',width:max/span*100+'%'}}>{markets.map((m,i)=>{const q=Math.max(0,r.values[m]||0);return q>0?<span key={m} tabIndex={0} className="item-segment" style={{width:q/max*100+'%',background:colors[i]}} title={`${r.name} · ${m}: ${q} net units`} aria-label={`${r.name}, ${m}, ${q} net units`}>{q/max>=.055?q:''}</span>:null})}{positive(r)===0&&negative(r)===0&&<span className="item-zero-text">No net sales</span>}</div></div><span className={'item-total '+(r.total<0?'negative':'')}>{r.total}</span></div>)}
 {rows.length===0&&<div className="empty">No products match your search.</div>}
 <div className="item-chart-foot"><span>{rows.length} products · quantities in units</span><span>Purchased − gross sold + valid returns = stock</span></div>
 </div></section>;
}
