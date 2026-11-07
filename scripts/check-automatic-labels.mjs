import assert from 'node:assert/strict';
await import('./check-label-templates.mjs');
const {shippingBox,inkBounds}=await import('../work/template-check/automatic-label.mjs');
const width=400,height=600,data=new Uint8ClampedArray(width*height*4).fill(255),r={width,height,data};
const black=(x,y)=>{const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=0};
for(let y=20;y<=250;y++){black(120,y);black(280,y);}for(let x=120;x<=280;x++){black(x,20);black(x,250);}
const crop=shippingBox(r,.5,[{x:.4,y:.1},{x:.5,y:.3},{x:.6,y:.4}]);assert.ok(crop);assert.ok(crop.x<.3&&crop.x+crop.width>.7);assert.ok(crop.y+crop.height<.5);assert.equal(shippingBox(r,.3,[{x:.4,y:.1}]),null);assert.equal(shippingBox(r,.5,[{x:.1,y:.1}]),null);
assert.equal(inkBounds({width,height,data:new Uint8ClampedArray(width*height*4).fill(255)}),null);
for(let y=15;y<580;y++)for(let x=20;x<380;x++)if(y%6===0)black(x,y);
const bounds=inkBounds(r);assert.ok(bounds);assert.ok(bounds.y+bounds.height>.96);assert.ok(bounds.x<=.05);
console.log('PASS: bounded Flipkart extraction, invoice exclusion boundary, anchor containment, scanned label bounds and blank-page fallback.');
