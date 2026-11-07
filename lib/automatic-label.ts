import {type Crop,fullCrop,validCrop} from './label-layout';
export type AutomaticLabel={crop:Crop;included:boolean;note:string;review:boolean};
type Raster={width:number;height:number;data:Uint8ClampedArray};
type Point={x:number;y:number};
export function shippingBox(r:Raster,invoiceY:number,anchors:Point[]):Crop|null{
 const stop=Math.min(r.height,Math.floor(invoiceY*r.height)-3),runs:{x:number;top:number;bottom:number}[]=[];
 for(let x=0;x<r.width;x++){let start=0,last=0,gaps=0,best={top:0,bottom:0};for(let y=0;y<stop;y++){const k=(y*r.width+x)*4,dark=(r.data[k]+r.data[k+1]+r.data[k+2])/3<180;if(dark){last=y;gaps=0;}else gaps++;if(gaps>2||y===stop-1){if(last-start>best.bottom-best.top)best={top:start,bottom:last};start=y+1;last=start;gaps=0;}}if(best.bottom-best.top>r.height*.22&&best.top<r.height*.16)runs.push({x,...best});}
 let best:Crop|null=null,area=0;
 for(const l of runs)for(const right of runs){const width=right.x-l.x,height=l.bottom-l.top;if(width<r.width*.18||width>r.width*.7||width>height||Math.abs(l.top-right.top)>4||Math.abs(l.bottom-right.bottom)>4)continue;
 const left=Math.max(0,l.x-3)/r.width,top=Math.max(0,l.top-3)/r.height,w=Math.min(r.width,right.x+4)/r.width-left,h=Math.min(stop,l.bottom+4)/r.height-top;
 if(anchors.some(a=>a.x<left||a.x>left+w||a.y<top||a.y>top+h)||top+h>=invoiceY)continue;
 if(w*h>area){area=w*h;best={x:left,y:top,width:w,height:h};}
 }return best;
}
export function inkBounds(r:Raster):Crop|null{let left=r.width,top=r.height,right=-1,bottom=-1,count=0;for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){const k=(y*r.width+x)*4;if((r.data[k]+r.data[k+1]+r.data[k+2])/3<170){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);count++;}}if(count<r.width*r.height*.01||right-left<r.width*.4||bottom-top<r.height*.5)return null;left=Math.max(0,left-3);top=Math.max(0,top-3);right=Math.min(r.width,right+4);bottom=Math.min(r.height,bottom+4);return {x:left/r.width,y:top/r.height,width:(right-left)/r.width,height:(bottom-top)/r.height};}
export async function renderLabelPage(page:any,maxSize?:number):Promise<Raster>{
 const v=page.getViewport({scale:1});
 const scale=maxSize?Math.min(3,maxSize/Math.max(v.width,v.height)):Math.min(1.5,1000/v.width);
 const view=page.getViewport({scale}),canvas=document.createElement('canvas');
 canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
 try{
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  await page.render({canvasContext:ctx,viewport:view,background:'rgb(255,255,255)'}).promise;
  const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);
  return {width:canvas.width,height:canvas.height,data};
 }finally{canvas.width=canvas.height=0;}
}

// Find vertical ink limits inside the selected crop. Keep the full crop width
// and a small margin at each cut so barcodes and footer text keep their spacing.
export function trimBlankHeight(r:Raster,crop:Crop):Crop{
 const left=Math.max(0,Math.floor(crop.x*r.width)),right=Math.min(r.width,Math.ceil((crop.x+crop.width)*r.width));
 const start=Math.max(0,Math.floor(crop.y*r.height)),end=Math.min(r.height,Math.ceil((crop.y+crop.height)*r.height));
 let first=end,last=-1;
 for(let y=start;y<end;y++){
  for(let x=left;x<right;x++){
   const offset=(y*r.width+x)*4;
   if(Math.min(r.data[offset],r.data[offset+1],r.data[offset+2])>=248)continue;
   first=Math.min(first,y);
   last=y;
   break;
  }
 }
 if(last<0)return crop;
 const padding=Math.max(3,Math.ceil((right-left)*.01));
 const top=Math.max(crop.y,(first-padding)/r.height);
 const bottom=Math.min(crop.y+crop.height,(last+1+padding)/r.height);
 const trimmed={...crop,y:top,height:bottom-top};
 return validCrop(trimmed)?trimmed:crop;
}

export async function thermalLabelCrop(page:any,crop:Crop):Promise<Crop>{
 return trimBlankHeight(await renderLabelPage(page,1800),crop);
}

export async function automaticDocumentLabels(doc:any):Promise<AutomaticLabel[]>{
 const pages:any[]=[],texts:any[]=[],result:AutomaticLabel[]=[];
 for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),text=await page.getTextContent();pages.push(page);texts.push(text.items);result.push({crop:fullCrop,included:true,note:'Full page kept',review:false});}
 const contents=texts.map(items=>items.map((t:any)=>t.str||'').join(' '));
 for(let i=0;i<pages.length;i++){
  const content=contents[i],page=pages[i],view=page.getViewport({scale:1});
  const invoice=/Tax Invoice\s*\/\s*Bill of Supply\s*\/\s*Cash Memo/i.test(content)&&/amazon/i.test(content)&&/Order Number/i.test(content);
  if(invoice){if(i>0&&contents[i-1].trim().length<20){const crop=inkBounds(await renderLabelPage(pages[i-1]));if(crop){result[i-1]={crop,included:true,note:'Amazon shipping label',review:false};result[i]={crop:fullCrop,included:false,note:'Amazon invoice excluded',review:false};continue;}}result[i]={crop:fullCrop,included:true,note:'Amazon invoice: check label page manually',review:true};continue;}
  if(/E.Kart Logistics/i.test(content)&&/Shipping\s*\/\s*Customer address/i.test(content)&&/SKU ID/i.test(content)){
   const tax=texts[i].find((t:any)=>/^tax invoice$/i.test((t.str||'').trim()));const needed=['e-kart logistics','shipping/customer address:','sku id | description','not for resale.'];
   const anchors=texts[i].filter((t:any)=>needed.includes((t.str||'').trim().toLowerCase())).map((t:any)=>{const [x,y]=view.convertToViewportPoint(t.transform[4],t.transform[5]);return{x:x/view.width,y:y/view.height}});
   let crop:Crop|null=null;if(tax&&anchors.length>=3){const [,y]=view.convertToViewportPoint(tax.transform[4],tax.transform[5]);crop=shippingBox(await renderLabelPage(page),y/view.height,anchors);}
   result[i]=crop?{crop,included:true,note:'Flipkart shipping label cropped',review:false}:{crop:fullCrop,included:true,note:'Flipkart layout needs a manual crop',review:true};
  }
 }
 return result;
}
