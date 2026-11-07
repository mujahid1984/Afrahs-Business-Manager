export type Crop = {x:number;y:number;width:number;height:number};
export type LabelSource = {bytes:Uint8Array;page:number;group:string};
export const fullCrop:Crop={x:0,y:0,width:1,height:1};
export function pageGroup(width:number,height:number,rotation:number){return `${width.toFixed(1)} × ${height.toFixed(1)} pt · ${rotation}°`;}
export function validCrop(c:Crop){return Object.values(c).every(Number.isFinite)&&c.x>=0&&c.y>=0&&c.width>=.01&&c.height>=.01&&c.x+c.width<=1.00001&&c.y+c.height<=1.00001;}
export function sheetSlots(width:number,height:number,count:number,margin=12,gap=10){
 if(![1,2,4].includes(count))throw Error('Choose 1, 2 or 4 labels.');
 const cols=count===4?2:1,rows=count===1?1:2;
 const w=(width-2*margin-(cols-1)*gap)/cols,h=(height-2*margin-(rows-1)*gap)/rows;
 return Array.from({length:count},(_,i)=>({x:margin+(i%cols)*(w+gap),y:height-margin-h-Math.floor(i/cols)*(h+gap),width:w,height:h}));
}
// PDF-lib is bundled locally; processing never sends label contents to the server.
export async function makeLabels(pdf:any,sources:LabelSource[],crops:Record<string,Crop>,paper:string,count:number,thermalWidth=100){
 if(!sources.length)throw Error('Upload PDFs first.');
 const isA4=paper==='a4';
 if(!isA4&&(!Number.isFinite(thermalWidth)||thermalWidth<20||thermalWidth>500))throw Error('Enter a roll width between 20 and 500 mm.');
 const output=await pdf.PDFDocument.create();const docs=new Map<Uint8Array,any>();
 const width=isA4?595.2756:thermalWidth*72/25.4,height=841.8898;
 const margin=12;
 const slots=isA4?sheetSlots(width,height,count,margin):[];
 let target:any;
 for(let i=0;i<sources.length;i++){
  const s=sources[i],crop=crops[s.group];if(!crop||!validCrop(crop))throw Error('Set and confirm a crop for every page group.');
  let source=docs.get(s.bytes);if(!source){source=await pdf.PDFDocument.load(s.bytes);docs.set(s.bytes,source);}
  const page=source.getPage(s.page),box=page.getCropBox(),r=((page.getRotation().angle%360)+360)%360;
  // Normalize crop-box origin and rotation to the same visual coordinates as PDF.js.
  const normalized=await pdf.PDFDocument.create(),nw=r%180?box.height:box.width,nh=r%180?box.width:box.height;
  const n=normalized.addPage([nw,nh]);
  const origin=r===90?{x:0,y:box.width}:r===180?{x:box.width,y:box.height}:r===270?{x:box.height,y:0}:{x:0,y:0};
  // Copy the source into this document before embedding the normalized crop.
  const e=await normalized.embedPage(page,{left:box.x,bottom:box.y,right:box.x+box.width,top:box.y+box.height});
  n.drawPage(e,{...origin,width:box.width,height:box.height,rotate:pdf.degrees(-r)});
  // Clip by embedding a normalized page with the selected bounding box.
  const flatDoc=await pdf.PDFDocument.load(await normalized.save());
  const clipped=await output.embedPage(flatDoc.getPage(0),{left:crop.x*nw,bottom:(1-crop.y-crop.height)*nh,right:(crop.x+crop.width)*nw,top:(1-crop.y)*nh});
  if(!isA4){
   const labelHeight=width*clipped.height/clipped.width;
   output.addPage([width,labelHeight]).drawPage(clipped,{x:0,y:0,width,height:labelHeight});
   continue;
  }
  if(i%count===0){
   target=output.addPage([width,height]);
   if(count===4){
    const guide={color:pdf.rgb(.55,.55,.55),thickness:.55,dashArray:[4,3]};
    target.drawLine({...guide,start:{x:width/2,y:margin},end:{x:width/2,y:height-margin}});
    target.drawLine({...guide,start:{x:margin,y:height/2},end:{x:width-margin,y:height/2}});
   }
  }
  const slot=slots[i%count],scale=Math.min(slot.width/clipped.width,slot.height/clipped.height);
  target.drawPage(clipped,{x:slot.x+(slot.width-clipped.width*scale)/2,y:slot.y+(slot.height-clipped.height*scale)/2,width:clipped.width*scale,height:clipped.height*scale});
 }
 return output.save();
}
