import {Crop,validCrop} from './label-layout';
export const templateMarkets=['Flipkart','Meesho','Amazon'] as const;
export type TemplateMarket=typeof templateMarkets[number];
export const layoutAnchors=['e kart logistics','sku id description','qty','tax invoice','order id','order date','invoice no','invoice date','shipping customer address','sold by','billing address','shipping address','total qty','total price','customer address','if undelivered return to','product details','sku','size','color','order no','original for recipient','bill to ship to','purchase order no','description','hsn','gross amount','taxable value','taxes','other charges','tax invoice bill of supply cash memo','order number','invoice number','invoice details','dynamic qr code','place of supply','place of delivery','authorized signatory','amount in words','total'] as const;
export type Anchor={key:string;x:number;y:number};
export type LayoutSignature={width:number;height:number;rotation:number;anchors:Anchor[];ink:number[];marketHint:TemplateMarket|null};
export type CropTemplate={id:string;name:string;market:TemplateMarket;signature:LayoutSignature;crop:Crop;included:boolean};
export type TemplateStore={templates:CropTemplate[];version:string;updatedAt:string|null};
export const emptyTemplateStore:TemplateStore={templates:[],version:'none',updatedAt:null};
export const normalizeAnchor=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function layoutSimilarity(a:LayoutSignature,b:LayoutSignature):number{
 if(Math.abs(a.width-b.width)>1||Math.abs(a.height-b.height)>1||a.rotation!==b.rotation||a.marketHint&&b.marketHint&&a.marketHint!==b.marketHint||a.ink.length!==768||b.ink.length!==768)return 0;
 const inkError=a.ink.reduce((n,v,i)=>n+Math.abs(v-b.ink[i]),0)/768;
 const matches=a.anchors.filter(p=>b.anchors.some(q=>q.key===p.key&&Math.abs(q.x-p.x)<.015&&Math.abs(q.y-p.y)<.015)).length;
 if(a.anchors.length>=3&&b.anchors.length>=3){const ratio=matches/Math.max(a.anchors.length,b.anchors.length);return matches>=3&&ratio>=.85&&inkError<.055?1-inkError:0;}
 // Scanned pages have no reliable text. Only close structural matches qualify.
 const rowShift=Math.max(...Array.from({length:32},(_,row)=>a.ink.slice(row*24,row*24+24).reduce((sum,v,i)=>sum+Math.abs(v-b.ink[row*24+i]),0)/24));
 const colShift=Math.max(...Array.from({length:24},(_,col)=>Array.from({length:32},(_,row)=>Math.abs(a.ink[row*24+col]-b.ink[row*24+col])).reduce((sum,v)=>sum+v,0)/32));
 if(a.anchors.length>1||b.anchors.length>1||inkError>.022||rowShift>.09||colShift>.09||a.ink.reduce((s,v)=>s+v,0)/768<.008)return 0;
 return 1-inkError*2;
}
export function matchTemplate(signature:LayoutSignature,templates:CropTemplate[]):CropTemplate|null{
 const candidates=templates.filter(t=>!signature.marketHint||t.market===signature.marketHint).map(template=>({template,score:layoutSimilarity(signature,template.signature)})).filter(c=>c.score>0).sort((a,b)=>b.score-a.score);
 if(!candidates.length)return null;
 // Two matching templates with different instructions are ambiguous: require manual selection.
 if(candidates.length>1&&candidates[0].score-candidates[1].score<.035){const a=candidates[0].template,b=candidates[1].template;if(a.market!==b.market||a.included!==b.included||JSON.stringify(a.crop)!==JSON.stringify(b.crop))return null;}
 return candidates[0].template;
}
export function validTemplate(t:CropTemplate){const s=t?.signature;return !!t&&typeof t.id==='string'&&t.id.length<=100&&typeof t.name==='string'&&t.name.trim().length>0&&t.name.length<=80&&templateMarkets.includes(t.market)&&typeof t.included==='boolean'&&!!t.crop&&validCrop(t.crop)&&!!s&&Number.isFinite(s.width)&&s.width>=20&&s.width<=15000&&Number.isFinite(s.height)&&s.height>=20&&s.height<=15000&&[0,90,180,270].includes(s.rotation)&&(s.marketHint===null||templateMarkets.includes(s.marketHint))&&Array.isArray(s.ink)&&s.ink.length===768&&s.ink.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&Array.isArray(s.anchors)&&s.anchors.length<=100&&s.anchors.every(a=>layoutAnchors.includes(a.key as typeof layoutAnchors[number])&&Number.isFinite(a.x)&&Number.isFinite(a.y)&&a.x>=0&&a.x<=1&&a.y>=0&&a.y<=1);}
