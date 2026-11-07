export type Kind='purchase'|'sale'|'return'|'expense'|'settlement';
export type Entry={id:string;kind:Kind;date:string;item:string;market:string;quantity:number;unitCost:number;amount:number;originalDate:string;note:string;actor:string;createdAt:string};
export type Product={name:string;cost:number;offset:number;productId?:string};
export const markets=['Meesho','Flipkart','Amazon','Direct Sale'];
export const dateToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(n/100);
export function summarize(entries:Entry[],month:string){const selected=entries.filter(e=>month==='all'||e.date.startsWith(month));const sum=(kind:Kind,field:'amount'|'quantity')=>selected.filter(e=>e.kind===kind).reduce((a,e)=>a+e[field],0);const gross=sum('sale','amount'),returned=sum('return','amount');const cost=selected.reduce((a,e)=>a+(e.kind==='sale'?1:e.kind==='return'?-1:0)*e.quantity*e.unitCost,0);return {sales:gross-returned,gross,returned,cost,profit:gross-returned-cost,expenses:sum('expense','amount'),purchases:sum('purchase','amount'),settled:sum('settlement','amount'),quantity:sum('sale','quantity')-sum('return','quantity'),returns:sum('return','quantity')};}
export function stock(entries:Entry[],products:Product[]){return products.map(p=>{const rows=entries.filter(e=>e.item===p.name);const count=(k:Kind)=>rows.filter(e=>e.kind===k).reduce((a,e)=>a+e.quantity,0);const purchased=count('purchase'),sold=count('sale'),returned=count('return'),expected=purchased-sold+returned;return {...p,purchased,sold,returned,expected,available:expected+p.offset,mismatch:expected<0||p.offset!==0};});}
export function previousMonth(month:string){const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7);}
export function itemSales(entries:Entry[],products:Product[],month:string){
 const quantities=new Map<string,Record<string,number>>();
 for(const p of products)quantities.set(p.name,Object.fromEntries(markets.map(m=>[m,0])));
 for(const e of entries){if((month!=='all'&&!e.date.startsWith(month))||!['sale','return'].includes(e.kind))continue;
 const values=quantities.get(e.item)||Object.fromEntries(markets.map(m=>[m,0]));
 values[e.market]=(values[e.market]||0)+(e.kind==='sale'?1:-1)*e.quantity;quantities.set(e.item,values);}
 return [...quantities].map(([name,values])=>({name,values,total:Object.values(values).reduce((a,b)=>a+b,0)}));
}
export function projectStock(available:number,expectedSales:number){const remaining=available-expectedSales;return {remaining,toBuy:Math.max(0,-remaining),sufficient:remaining>=0};}
