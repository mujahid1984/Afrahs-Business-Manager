import fs from 'node:fs/promises';import ts from 'typescript';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
const dir=new URL('../work/template-check/',import.meta.url);await import('./check-label-templates.mjs');
const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
globalThis.labelTemplateTest={
 authenticated:true,
 db:{prepare(sql){return {bind(...args){return {
  async first(){return db.prepare(sql).get(...args)||null},
  async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}}}
 }}}}}
};
let source=await fs.readFile(new URL('../app/api/label-templates/route.ts',import.meta.url),'utf8');source=source.replace("import {env} from 'cloudflare:workers';","const env={get DB(){return globalThis.labelTemplateTest.db}};").replace("import {getChatGPTUser} from '../../chatgpt-auth';","const getChatGPTUser=async()=>globalThis.labelTemplateTest.authenticated?{userId:'test-user'}:null;").replace("'../../../lib/label-templates'","'./label-templates.mjs'");await fs.writeFile(new URL('route.mjs',dir),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const api=await import(new URL('route.mjs',dir));const request=(body,origin='https://example.test')=>new Request('https://example.test/api/label-templates',{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(body)});
assert.equal((await api.GET()).status,200);const initial=await (await api.GET()).json();assert.equal(initial.version,'none');
const template={id:'',name:'Shipping label',market:'Amazon',crop:{x:0,y:0,width:1,height:.5},included:true,signature:{width:595,height:842,rotation:0,marketHint:null,anchors:[],ink:Array(768).fill(.2)}};
globalThis.labelTemplateTest.authenticated=false;assert.equal((await api.GET()).status,401);assert.equal((await api.POST(request({template,version:'none'}))).status,401);globalThis.labelTemplateTest.authenticated=true;
assert.equal((await api.POST(request({template,version:'none'},'https://other.test'))).status,403);
assert.equal((await api.POST(request({template:{...template,crop:{x:1,y:0,width:1,height:1}},version:'none'}))).status,400);
const saved=await api.POST(request({template,version:'none'}));assert.equal(saved.status,200);const a=await saved.json();assert.ok(a.savedId);assert.equal(a.templates.length,1);assert.deepEqual((await (await api.GET()).json()).templates,a.templates);
assert.equal((await api.POST(request({template,version:'none'}))).status,409);
const body={template:{...template,id:a.savedId,name:'Updated crop'},version:a.version};const concurrent=await Promise.all([api.POST(request(body)),api.POST(request(body))]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);assert.equal((await (await api.GET()).json()).templates.length,1);
console.log('PASS: authenticated shared persistence, validation, origin checks, updates, stale versions and concurrent saves.');db.close();
