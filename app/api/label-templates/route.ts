import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {CropTemplate,TemplateStore,emptyTemplateStore,validTemplate} from '../../../lib/label-templates';
export const dynamic='force-dynamic';
const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const key='label_crop_templates_v1';
export async function GET(){if(!await getChatGPTUser())return reply({error:'Sign in to load shared crop templates.'},401);try{if(!env.DB)throw Error();const row=await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first<{value:string}>();return reply(row?JSON.parse(row.value):emptyTemplateStore);}catch{return reply({error:'Could not load shared crop templates. Retry before uploading labels.'},503);}}
export async function POST(req:Request){if(!await getChatGPTUser())return reply({error:'Sign in to save shared crop templates.'},401);if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'Invalid request origin.'},403);
 try{if(!env.DB)throw Error();if(Number(req.headers.get('content-length'))>40000)return reply({error:'Template is too large.'},400);const b=await req.json() as {template:CropTemplate;version:string};if(typeof b.version!=='string'||!validTemplate(b.template))return reply({error:'Choose a marketplace, template name and valid crop.'},400);
 const old=await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first<{value:string}>();const current:TemplateStore=old?JSON.parse(old.value):emptyTemplateStore;if(current.version!==b.version)return reply({error:'Another user changed the crop templates. Reload templates, then save again.'},409);
 const id=b.template.id||crypto.randomUUID();if(b.template.id&&!current.templates.some(t=>t.id===id))return reply({error:'This template no longer exists. Reload templates.'},409);if(!b.template.id&&current.templates.length>=60)return reply({error:'The workspace supports up to 60 crop templates.'},400);
 const template={...b.template,id,name:b.template.name.trim()};const templates=[...current.templates.filter(t=>t.id!==id),template];const result:TemplateStore={templates,version:crypto.randomUUID(),updatedAt:new Date().toISOString()};const value=JSON.stringify(result);
 const saved=old?await env.DB.prepare('UPDATE settings SET value=? WHERE key=? AND value=?').bind(value,key,old.value).run():await env.DB.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').bind(key,value).run();if(!saved.meta.changes)return reply({error:'Crop templates changed while saving. Reload and retry.'},409);return reply({...result,savedId:id});
 }catch{return reply({error:'Could not save the shared crop template. Please retry.'},500);}}
