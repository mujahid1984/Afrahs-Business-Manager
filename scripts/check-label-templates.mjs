import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import ts from 'typescript';
const dir=new URL('../work/template-check/',import.meta.url);await fs.mkdir(dir,{recursive:true});
for(const name of ['label-layout','label-templates','label-signature','automatic-label']){
 const src=await fs.readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");await fs.writeFile(new URL(name+'.mjs',dir),compiled);
}
const {layoutSimilarity,matchTemplate,validTemplate}=await import(new URL('label-templates.mjs',dir));
const anchors=['order id','qty','sold by','invoice date'].map((key,i)=>({key,x:.1,y:.1+i*.1}));
const signature={width:595,height:842,rotation:0,marketHint:'Flipkart',anchors,ink:Array.from({length:768},(_,i)=>i%4===0?.3:.02)};
const template={id:'one',name:'Shipping label',market:'Flipkart',signature,crop:{x:.05,y:.02,width:.9,height:.45},included:true};
assert.equal(validTemplate(template),true);assert.equal(matchTemplate(structuredClone(signature),[template]).id,'one');
assert.equal(matchTemplate({...signature,marketHint:'Meesho'},[template]),null);
assert.equal(matchTemplate({...signature,width:612},[template]),null);
assert.equal(matchTemplate({...signature,anchors:anchors.map(a=>({...a,y:a.y+.12}))},[template]),null);
assert.equal(matchTemplate({...signature,ink:signature.ink.map(v=>1-v)},[template]),null);
assert.equal(matchTemplate(signature,[template,{...template,id:'two',crop:{x:0,y:0,width:1,height:1}}]),null);
assert.equal(validTemplate({...template,crop:{x:.8,y:0,width:.9,height:1}}),false);
assert.equal(validTemplate({...template,signature:{...signature,anchors:[{key:'Customer name',x:0,y:0}]}}),false);
const scanned={...signature,anchors:[],marketHint:null};assert.ok(layoutSimilarity(scanned,scanned));assert.equal(layoutSimilarity({...scanned,ink:scanned.ink.map(v=>v+.1)},scanned),0);
assert.equal(layoutSimilarity({...scanned,ink:Array(768).fill(0)},{...scanned,ink:Array(768).fill(0)}),0);
const skipped={...template,included:false};assert.equal(matchTemplate(signature,[skipped]).included,false);
console.log('PASS: matching, changed layouts, ambiguous crops, marketplace mismatches, scanned layouts, blank pages, skip templates and validation.');
