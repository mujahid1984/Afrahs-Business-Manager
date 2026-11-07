import {LayoutSignature,layoutAnchors,normalizeAnchor} from './label-templates';
export async function readLayoutSignature(page:any):Promise<LayoutSignature>{
 const view=page.getViewport({scale:1}),text=await page.getTextContent(),content=text.items.map((i:any)=>i.str||'').join(' ');
 const marketHint=/\b(?:e.kart logistics|ordered through flipkart|flipkart)\b/i.test(content)?'Flipkart':/\b(?:meesho|valmo|AFR-MEE)\b/i.test(content)?'Meesho':/\b(?:amazon|amazon\.in)\b/i.test(content)?'Amazon':null;
 const anchors:LayoutSignature['anchors']=[];
 for(const item of text.items){if(!item.str||!item.transform)continue;const key=normalizeAnchor(item.str);if(!layoutAnchors.includes(key as typeof layoutAnchors[number]))continue;const [x,y]=view.convertToViewportPoint(item.transform[4],item.transform[5]);if(x>=0&&y>=0&&x<=view.width&&y<=view.height&&anchors.length<100)anchors.push({key,x:Math.round(x/view.width*1000)/1000,y:Math.round(y/view.height*1000)/1000});}
 const canvas=document.createElement('canvas'),small=page.getViewport({scale:Math.min(384/view.width,512/view.height)});canvas.width=Math.ceil(small.width);canvas.height=Math.ceil(small.height);const context=canvas.getContext('2d',{willReadFrequently:true})!;await page.render({canvasContext:context,viewport:small,background:'rgb(255,255,255)'}).promise;
 const data=context.getImageData(0,0,canvas.width,canvas.height).data,ink:number[]=[];
 for(let row=0;row<32;row++)for(let col=0;col<24;col++){let dark=0,total=0;for(let y=Math.floor(row*canvas.height/32);y<Math.floor((row+1)*canvas.height/32);y++)for(let x=Math.floor(col*canvas.width/24);x<Math.floor((col+1)*canvas.width/24);x++){const i=(y*canvas.width+x)*4;dark+=(data[i]+data[i+1]+data[i+2])/3<170?1:0;total++;}ink.push(Math.round(dark/Math.max(1,total)*1000)/1000);}
 canvas.width=canvas.height=0;
 return {width:view.width,height:view.height,rotation:((page.rotate%360)+360)%360,anchors,ink,marketHint};
}
