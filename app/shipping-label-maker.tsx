'use client';
import {useEffect,useRef,useState} from 'react';
import {Crop as CropIcon,Download,Printer,Share2,Upload,Check,Trash2} from 'lucide-react';
import {readApiResponse} from '../lib/api-response';
import {automaticDocumentLabels,AutomaticLabel,thermalLabelCrop} from '../lib/automatic-label';
import {findDuplicatePages,labelDigest,labelPageDigest} from '../lib/label-duplicates';
import {readLayoutSignature} from '../lib/label-signature';
import {CropTemplate,TemplateStore,TemplateMarket,LayoutSignature,emptyTemplateStore,templateMarkets,matchTemplate,layoutSimilarity} from '../lib/label-templates';
import {loadLabelTools} from '../lib/label-runtime';
import {Crop,fullCrop,LabelSource,makeLabels,pageGroup} from '../lib/label-layout';
type Page=LabelSource&{included:boolean;fullIncluded:boolean;automatic?:AutomaticLabel;fileId:string;fileHash:string;pageHash:string|null;signature?:LayoutSignature;templateId?:string;groupLabel:string;name:string;width:number;height:number;reader:any};
export default function ShippingLabelMaker(){
 const [pages,setPages]=useState<Page[]>([]),[crops,setCrops]=useState<Record<string,Crop>>({}),[index,setIndex]=useState(0),[draft,setDraft]=useState<Crop>(fullCrop),[busy,setBusy]=useState(false),[error,setError]=useState(''),[paper,setPaper]=useState('a4'),[count,setCount]=useState(4),[tw,setTw]=useState('100');
 const [output,setOutput]=useState<{url:string;file:File}|null>(null);
 const [sharing,setSharing]=useState(false),[shareNote,setShareNote]=useState('');
 const url=output?.url??'';
 const preview=useRef<HTMLElement>(null);
 const [mode,setMode]=useState<'auto'|'full'|'templates'>('auto');
 const fileSequence=useRef(0),uploadSequence=useRef(0),renderQueue=useRef<Promise<void>>(Promise.resolve());
 const [templateStore,setTemplateStore]=useState<TemplateStore>(emptyTemplateStore),[templatesLoaded,setTemplatesLoaded]=useState(false),[templateError,setTemplateError]=useState(''),[templateMarket,setTemplateMarket]=useState<TemplateMarket|''>(''),[templateName,setTemplateName]=useState('Shipping label'),[templateNotice,setTemplateNotice]=useState('');
 const canvas=useRef<HTMLCanvasElement>(null),surface=useRef<HTMLDivElement>(null),start=useRef<{x:number;y:number}|null>(null),docs=useRef<any[]>([]),input=useRef<HTMLInputElement>(null);
 const current=pages[index],included=pages.filter(p=>pageIncluded(p)),groups=[...new Set(included.map(p=>p.group))];
 const duplicates=findDuplicatePages(pages,pageIncluded);
 const pagesByFile=new Map<string,Page[]>();
 for(const page of pages){
  const filePages=pagesByFile.get(page.fileId);
  if(filePages)filePages.push(page);
  else pagesByFile.set(page.fileId,[page]);
 }
 const duplicateFiles=[...pagesByFile.values()].filter(filePages=>filePages.every(page=>duplicates.has(page)));
 const duplicateFileIds=new Set(duplicateFiles.map(([page])=>page.fileId));
 const duplicatePages=pages.filter(page=>duplicates.has(page)&&!duplicateFileIds.has(page.fileId));
 const somePagesUnchecked=pages.some(page=>page.pageHash===null);
 const reviewPages=mode==='auto'?pages.flatMap((page,index)=>pageIncluded(page)&&(!page.automatic||page.automatic.review)?[{page,index}]:[]):[];
 const ready=included.length>0&&(mode==='full'||mode==='auto'&&reviewPages.length===0||mode==='templates'&&groups.every(g=>!!crops[g])&&!!current&&(!current.included||JSON.stringify(draft)===JSON.stringify(crops[current.group])));
 async function loadTemplates(){setTemplateError('');try{const response=await fetch('/api/label-templates',{cache:'no-store'}),data=await readApiResponse(response) as TemplateStore&{error?:string};if(!response.ok)throw Error(data.error||'Could not load saved templates.');setTemplateStore(data);setTemplatesLoaded(true);return data;}catch(e){setTemplateError(e instanceof Error?e.message:'Could not load saved templates.');throw e;}}
 useEffect(()=>{if(!current)return;const template=templateStore.templates.find(t=>t.id===current.templateId);setTemplateMarket(template?.market||current.signature?.marketHint||'');setTemplateName(template?.name||'Shipping label');},[current?.group,current?.templateId,templateStore]);
 useEffect(()=>{setTemplateNotice('');},[index]);
 useEffect(()=>()=>{docs.current.forEach(d=>void d.destroy());},[]);
 useEffect(()=>{const active=new Set(pages.map(p=>p.reader));docs.current=docs.current.filter(d=>{if(active.has(d))return true;void d.destroy();return false;});},[pages]);
 useEffect(()=>{return()=>{if(url)URL.revokeObjectURL(url)}},[url]);
 useEffect(()=>{
  if(!url||!preview.current)return;
  const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  preview.current.focus({preventScroll:true});
  preview.current.scrollIntoView({block:'start',behavior:reduceMotion?'instant':'smooth'});
 },[url]);
 useEffect(()=>{if(!current)return;setDraft(mode==='auto'?current.automatic?.crop||fullCrop:crops[current.group]||fullCrop);let task:any,cancelled=false;
  const job=renderQueue.current.catch(()=>{}).then(async()=>{if(cancelled)return;const p=await current.reader.getPage(current.page+1);if(cancelled||!canvas.current)return;const v=p.getViewport({scale:Math.min(1.5,760/current.width)});const c=canvas.current;c.width=v.width;c.height=v.height;task=p.render({canvasContext:c.getContext('2d'),viewport:v});await task.promise;if(!cancelled)setError(previous=>previous==='Could not display this page. Try another PDF.'?'':previous);});
  renderQueue.current=job.catch(()=>{if(!cancelled)setError('Could not display this page. Try another PDF.');});
  return()=>{cancelled=true;task?.cancel();};
 },[current,crops,mode]);
 function invalidate(){setOutput(null);setShareNote('');}
 async function classifyPage(page:Page,existing:Page[],saved:TemplateStore,nextCrops:Record<string,Crop>):Promise<Page>{
  const signature=page.signature||await readLayoutSignature(await page.reader.getPage(page.page+1)),template=matchTemplate(signature,saved.templates);
  const similar=template?null:existing.find(q=>!q.templateId&&q.signature&&layoutSimilarity(q.signature,signature)>0);
  const group=template?'template:'+template.id:similar?.group||(page.group.startsWith('manual:')?page.group:'manual:'+(++uploadSequence.current));
  if(template&&!nextCrops[group])nextCrops[group]=template.crop;
  return {...page,signature,templateId:template?.id,group,included:template?(page.templateId===template.id?page.included:template.included):page.included,groupLabel:template?template.market+' · '+template.name:similar?.groupLabel||'New layout · '+page.name+' · '+pageGroup(page.width,page.height,signature.rotation)};
 }
 async function changeMode(nextMode:'auto'|'full'|'templates'){
  if(nextMode===mode||busy)return;invalidate();setError('');
  if(nextMode==='full'){setMode('full');return;}
  setBusy(true);try{if(nextMode==='auto'){const results=new Map<any,AutomaticLabel[]>();for(const page of pages)if(!page.automatic&&!results.has(page.reader))results.set(page.reader,await automaticDocumentLabels(page.reader));setPages(pages.map(page=>({...page,automatic:page.automatic||results.get(page.reader)?.[page.page]})));setMode('auto');return;}const saved=await loadTemplates(),next:Page[]=[],nextCrops={...crops};for(const page of pages)next.push(await classifyPage(page,next,saved,nextCrops));setPages(next);setCrops(nextCrops);setMode('templates');}catch(e){setError(e instanceof Error?e.message:'Could not open crop templates.');}finally{setBusy(false);}
 }
 async function upload(files:File[]){if(!files.length)return;setBusy(true);setError('');invalidate();let opened:any[]=[];
  try{const existing=[...new Map(pages.map(p=>[p.fileId,p])).values()];if(existing.length+files.length>50||existing.reduce((sum,p)=>sum+p.bytes.byteLength,0)+files.reduce((s,f)=>s+f.size,0)>100_000_000)throw Error('Choose up to 50 PDFs, with a combined size below 100 MB.');
   const saved=mode==='templates'?await loadTemplates():templateStore;const {reader:pdf}=await loadLabelTools();const next:Page[]=[];const nextCrops={...crops};
   for(const file of files){if(!/\.pdf$/i.test(file.name))throw Error('Choose PDF files only.');const fileId='pdf-'+(++fileSequence.current);const bytes=new Uint8Array(await file.arrayBuffer());const fileHash=await labelDigest(bytes.buffer);const doc=await pdf.getDocument({data:bytes.slice(),isEvalSupported:false}).promise;opened.push(doc);
    if(pages.length+next.length+doc.numPages>200)throw Error('Choose at most 200 pages per batch.');
    const automatic=mode==='auto'?await automaticDocumentLabels(doc):null;
    for(let i=0;i<doc.numPages;i++){const p=await doc.getPage(i+1),v=p.getViewport({scale:1});const pageHash=await labelPageDigest(p).catch(()=>null);let page:Page={included:true,fullIncluded:true,automatic:automatic?.[i],fileId,fileHash,pageHash,bytes,page:i,group:'full:'+fileId+':'+i,groupLabel:file.name,name:file.name,width:v.width,height:v.height,reader:doc};if(mode==='templates')page=await classifyPage(page,[...pages,...next],saved,nextCrops);next.push(page);}
   }
   docs.current.push(...opened);setPages([...pages,...next]);setCrops(nextCrops);setIndex(pages.length);
  }catch(e){opened.forEach(d=>void d.destroy());setError(e instanceof Error?e.message:'Could not read PDFs. Password-protected or damaged PDFs are not supported.');}finally{setBusy(false);if(input.current)input.current.value='';}
 }
 async function saveTemplate(){if(!current||!current.signature||!templateMarket)return;setBusy(true);setError('');setTemplateNotice('');try{
  const template:CropTemplate={id:current.templateId||'',market:templateMarket,name:templateName.trim(),signature:current.signature,crop:draft,included:current.included};
  const response=await fetch('/api/label-templates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template,version:templateStore.version})});
  const result=await readApiResponse(response) as TemplateStore&{savedId:string;error?:string};if(!response.ok)throw Error(result.error||'Could not save the template.');
  setTemplateStore(result);const group='template:'+result.savedId;setPages(pages.map(p=>p.group===current.group||p.templateId===result.savedId?{...p,group,templateId:result.savedId,groupLabel:templateMarket+' · '+template.name,included:current.included}:p));setCrops({...crops,[group]:draft});invalidate();setTemplateNotice('Template saved for everyone. Matching future uploads will use this crop automatically.');
 }catch(e){setError(e instanceof Error?e.message:'Could not save the template.');}finally{setBusy(false);}}
 function pageIncluded(page:Page){return mode==='full'?page.fullIncluded:mode==='auto'?page.automatic?.included??true:page.included;}
 function togglePage(i:number,checked:boolean){setPages(pages.map((p,n)=>n!==i?p:mode==='auto'?{...p,automatic:{...p.automatic!,included:checked}}:{...p,[mode==='full'?'fullIncluded':'included']:checked}));invalidate();}
 function removePages(keep:(p:Page,i:number)=>boolean){const remaining=pages.filter(keep);const selected=remaining.indexOf(current);setIndex(selected>=0?selected:Math.max(0,Math.min(index,remaining.length-1)));setPages(remaining);invalidate();setError('');}
 function point(e:React.PointerEvent){const r=surface.current!.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};}
 function move(e:React.PointerEvent){if(!start.current)return;const p=point(e),s=start.current;setDraft({x:Math.min(s.x,p.x),y:Math.min(s.y,p.y),width:Math.abs(p.x-s.x),height:Math.abs(p.y-s.y)});}
 function end(e:React.PointerEvent){if(!start.current)return;move(e);start.current=null;}
 async function generate(){
  setBusy(true);setError('');invalidate();
  try{
   const {writer:pdf}=await loadLabelTools();
   const printSources:LabelSource[]=[],printCrops:Record<string,Crop>={};
   for(const page of included){
    const crop=mode==='auto'?page.automatic!.crop:mode==='templates'?crops[page.group]:fullCrop;
    const group=page.fileId+':'+page.page;
    printSources.push({...page,group});
    printCrops[group]=paper==='thermal'
     ?await thermalLabelCrop(await page.reader.getPage(page.page+1),crop)
     :crop;
   }
   const bytes=await makeLabels(pdf,printSources,printCrops,paper,count,Number(tw));
   const layout=paper==='a4'?'A4 '+count+' in 1':'Thermal Roll';
   const file=new File([bytes as BlobPart],'Afrah Shipping Label '+layout+'.pdf',{type:'application/pdf'});
   setOutput({file,url:URL.createObjectURL(file)});
  }catch(e){setError(e instanceof Error?e.message:'Could not prepare the labels. Try a smaller batch.');}
  finally{setBusy(false);}
 }
 async function sharePdf(){
  if(!output||sharing)return;
  const data={files:[output.file]};
  const fallback='File sharing is unavailable here. Use Download PDF to save the file.';
  setShareNote('');
  try{
   if(!navigator.share||!navigator.canShare?.(data)){
    setShareNote(fallback);
    return;
   }
   setSharing(true);
   await navigator.share(data);
  }catch(error){
   if(!(error instanceof DOMException&&error.name==='AbortError'))setShareNote(fallback);
  }finally{setSharing(false);}
 }
 function print(){const win=window.open(url,'_blank');if(!win){setError('Allow pop-ups to open the print preview, or download the PDF and print it.');return;}win.addEventListener('load',()=>{try{win.focus();win.print();}catch{}},{once:true});}
 return <div className="label-maker"><section className="panel"><div className="panel-head"><div><div className="item-chart-kicker">PREPARE · CROP · PRINT</div><h2>Shipping Label Maker</h2><p>Upload mixed marketplace PDFs, choose your layout, then download or print.</p></div><Upload className="gold"/></div><div className="lm-mode"><button disabled={busy} aria-pressed={mode==='auto'} className={mode==='auto'?'active':''} onClick={()=>void changeMode('auto')}><b>Automatic shipping labels</b><small>Crop Flipkart labels. Keep Amazon labels only.</small></button><button disabled={busy} aria-pressed={mode==='full'} className={mode==='full'?'active':''} onClick={()=>void changeMode('full')}><b>Full pages — simple layout</b><small>Fit every complete page. No crop setup.</small></button><button disabled={busy} aria-pressed={mode==='templates'} className={mode==='templates'?'active':''} onClick={()=>void changeMode('templates')}><b>Saved crops — optional</b><small>Use saved templates or crop manually.</small></button></div><div className="lm-upload"><label className={'secondary '+(busy?'disabled':'')}><Upload size={17}/>{pages.length?'Add more PDFs':'Upload multiple PDFs'}<input ref={input} type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={e=>void upload(Array.from(e.target.files||[]))}/></label><span>{busy?'Processing…':pages.length?mode!=='templates'?`${pages.length} pages ready for layout`:`${pages.length} pages · ${groups.length} crop ${groups.length===1?'group':'groups'}`:'Up to 50 PDFs · 200 pages · 100 MB'}</span></div>{pages.length>0&&<div className="lm-file-list">{[...new Map(pages.map(p=>[p.fileId,p])).values()].map(file=><div key={file.fileId}><button className="text-button" disabled={busy} onClick={()=>setIndex(pages.findIndex(p=>p.fileId===file.fileId))}>{file.name}<small>{pages.filter(p=>p.fileId===file.fileId).length} pages</small></button><button className="text-button lm-remove" disabled={busy} aria-label={'Remove PDF '+file.name} onClick={()=>removePages(p=>p.fileId!==file.fileId)}><Trash2 size={14}/>Remove PDF</button></div>)}</div>}<p className="lm-note">{mode==='auto'?'Recognized Flipkart labels are cropped to the shipping box. Amazon label pages are kept and their paired invoice pages are excluded. Other formats stay complete. Review the extracted labels before printing.':mode==='full'?'Every uploaded PDF page is fitted proportionally, keeping its label, barcode, QR code and invoice together. No crop or saved template is required. You can remove or skip unwanted pages before preparing.':<>First time: upload a label, crop it, choose the marketplace and save a reusable template. Next time: upload mixed PDFs together. Uncertain layouts need a manual crop. Always check the preview before printing. PDFs stay in this browser. Preparing labels does not add sales or change stock. Keep the label text, barcode and QR code inside your crop.</>}</p></section>
 {duplicates.size>0&&<section className="panel">
  <div className="panel-head">
   <div><h2>Duplicates found</h2><p>Remove extra copies before printing. One copy of each page is kept.</p></div>
   <button type="button" className="secondary" disabled={busy} onClick={()=>removePages(page=>!duplicates.has(page))}><Trash2 size={14}/>Remove all duplicates</button>
  </div>
  <div className="lm-file-list">
   {duplicateFiles.map(([page,...rest])=><div key={page.fileId}>
    <button type="button" className="text-button" disabled={busy} onClick={()=>setIndex(pages.indexOf(page))}>{page.name}<small>Duplicate PDF · {rest.length+1} {rest.length?'pages':'page'}</small></button>
    <button type="button" className="text-button lm-remove" disabled={busy} aria-label={'Remove duplicate PDF '+page.name} onClick={()=>removePages(candidate=>candidate.fileId!==page.fileId)}><Trash2 size={14}/>Remove PDF</button>
   </div>)}
   {duplicatePages.map(page=>{
    const original=duplicates.get(page)!;
    return <div key={page.fileId+':'+page.page}>
     <button type="button" className="text-button" disabled={busy} onClick={()=>setIndex(pages.indexOf(page))}>{page.name} · page {page.page+1}<small>Matches {original.name} · page {original.page+1}</small></button>
     <button type="button" className="text-button lm-remove" disabled={busy} aria-label={'Remove duplicate '+page.name+' page '+(page.page+1)} onClick={()=>removePages(candidate=>candidate!==page)}><Trash2 size={14}/>Remove page</button>
    </div>;
   })}
  </div>
 </section>}
 {somePagesUnchecked&&<div className="error" role="status">Some pages could not be compared visually for duplicates. Identical files are still checked.</div>}
 {mode==='templates'&&<section className="panel lm-template-summary"><div className="panel-head"><div><h2>Shared crop templates</h2><p>{templatesLoaded?templateStore.templates.length+' saved templates · available to everyone in this workspace':'Loading saved templates…'}</p></div><button className="text-button" disabled={busy} onClick={()=>void loadTemplates().catch(()=>{})}>Reload templates</button></div>{templateError&&<div className="error" role="alert">{templateError}</div>}<div className="lm-template-chips">{templateStore.templates.map(t=><span key={t.id}>{t.market} · {t.name}{!t.included?' · Skip page':''}</span>)}{templatesLoaded&&!templateStore.templates.length&&<p className="lm-note">Save your first Flipkart, Meesho or Amazon crop below. Only crop settings and layout fingerprints are saved; PDFs stay in your browser.</p>}</div></section>}
 {reviewPages.length>0&&<section className="panel">
  <div className="panel-head"><div><h2>Labels needing review</h2><p>{reviewPages.length} {reviewPages.length===1?'page needs':'pages need'} attention before printing.</p></div></div>
  <div className="lm-auto-results">{reviewPages.map(({page,index})=><button key={page.fileId+':'+page.page} className="needs-review" onClick={()=>setIndex(index)}>{page.name} · page {page.page+1}<strong>{page.automatic?.note||'Needs review'}</strong></button>)}</div>
 </section>}
 {error&&<div className="error" role="alert">{error}</div>}
 {pages.length>0&&<div className="lm-grid"><section className="panel"><div className="panel-head"><div><h2>{mode==='auto'?'1. Review extracted labels':mode==='full'?'1. Review your pages':'1. Crop your labels'}</h2><p>{mode==='auto'?'Check the automatic result. You can skip pages or use Saved crops to adjust an unfamiliar layout.':mode==='full'?'Every page is kept complete. Skip or remove any pages you do not need.':'Matching templates are applied automatically. Crop unrecognized layouts below.'}</p></div><CropIcon className="gold"/></div><div className="lm-body"><label className="lm-field">Preview page<select value={index} disabled={busy} onChange={e=>setIndex(Number(e.target.value))}>{pages.map((p,i)=><option key={i} value={i}>{i+1}. {p.name} — page {p.page+1}{pageIncluded(p)?'':' (skipped)'}{mode==='auto'?' · '+p.automatic?.note:''}</option>)}</select></label><div className="lm-page-tools"><label className="lm-include"><input type="checkbox" checked={pageIncluded(current)} disabled={busy} onChange={e=>togglePage(index,e.target.checked)}/>Include this page in the combined PDF</label><button className="text-button lm-remove" disabled={busy} onClick={()=>removePages((p,i)=>i!==index)}><Trash2 size={14}/>Remove this page</button></div><div className="lm-page" style={{width:Math.min(600,650*current.width/current.height)+'px',cursor:mode!=='templates'?'default':'crosshair'}} ref={surface} onPointerDown={e=>{if(busy||mode!=='templates')return;e.currentTarget.setPointerCapture(e.pointerId);invalidate();start.current=point(e);setDraft({...start.current,width:0,height:0});}} onPointerMove={move} onPointerUp={end} onPointerCancel={()=>{start.current=null;setDraft(crops[current.group]||fullCrop)}}><canvas ref={canvas}/>{mode!=='full'&&<div className="lm-crop" style={{left:draft.x*100+'%',top:draft.y*100+'%',width:draft.width*100+'%',height:draft.height*100+'%'}}/>}</div>{mode==='templates'&&<><div className="lm-crop-actions"><button className="secondary" disabled={busy} onClick={()=>{setDraft(fullCrop);invalidate()}}>Use full page</button><button className="primary" disabled={busy||draft.width<.01||draft.height<.01} onClick={()=>{setCrops({...crops,[current.group]:draft});invalidate();}}><Check size={15}/>Apply crop to this batch</button></div><p className="lm-note">Applies to {pages.filter(p=>p.group===current.group).length} pages with this matching layout. Other layouts keep their own crops.</p><div className="lm-template-editor"><h3>{current.templateId?'Saved template applied':'Save a reusable crop template'}</h3><p className="lm-note">{current.templateId?'This layout matched a shared template. Check its crop in the preview.':'Choose a marketplace and save this layout once for future uploads.'}</p><div className="form-grid"><label className="lm-field">Marketplace<select disabled={busy} value={templateMarket} onChange={e=>setTemplateMarket(e.target.value as TemplateMarket)}><option value="">Choose marketplace</option>{templateMarkets.map(m=><option key={m}>{m}</option>)}</select></label><label className="lm-field">Template name<input disabled={busy} maxLength={80} value={templateName} onChange={e=>setTemplateName(e.target.value)} placeholder="Shipping label"/></label></div><button className="primary" disabled={busy||!templateMarket||!templateName.trim()||draft.width<.01||draft.height<.01} onClick={()=>void saveTemplate()}><Check size={15}/>{current.templateId?'Update shared template':'Save reusable template'}</button><p className="lm-note">Untick “Include this page” before saving to automatically skip this layout, such as an invoice.</p>{templateNotice&&<p className="planner-success">{templateNotice}</p>}</div><div className="lm-groups">{groups.map((g,i)=><button key={g} onClick={()=>setIndex(pages.findIndex(p=>p.group===g))} className={crops[g]?'complete':''}>{crops[g]?<Check size={14}/>:<CropIcon size={14}/>}Group {i+1}: {pages.find(p=>p.group===g)?.groupLabel||g} · {crops[g]?'Crop ready':'Needs crop'}</button>)}</div><p className="lm-note">Same-size pages with a different layout? Select that page and click below to crop it separately.</p><button className="text-button" disabled={busy||pages.filter(p=>p.group===current.group).length===1} onClick={()=>{setPages(pages.map((p,i)=>i===index?{...p,group:'manual:'+(++uploadSequence.current),templateId:undefined,groupLabel:'Separate crop · '+p.name+' · page '+(p.page+1)}:p));invalidate();}}>Give this page its own crop</button></>}</div></section>
 <section className="panel lm-settings"><div className="panel-head"><div><h2>2. Choose your print layout</h2><p>The label keeps its proportions.</p></div><Printer className="gold"/></div><div className="lm-body"><label className="lm-field">Paper size<select disabled={busy} value={paper} onChange={e=>{setPaper(e.target.value);invalidate()}}><option value="a4">A4 — 210 × 297 mm</option><option value="thermal">Thermal roll — auto height</option></select></label>{paper==='a4'?<label className="lm-field">Labels per sheet<select disabled={busy} value={count} onChange={e=>{setCount(Number(e.target.value));invalidate()}}>{[1,2,4].map(n=><option value={n} key={n}>{n} {n===1?'label':'labels'} per sheet</option>)}</select></label>:<div className="form-grid"><label className="lm-field">Roll width (mm)<input disabled={busy} type="number" min="20" max="500" step="0.1" value={tw} onChange={e=>{setTw(e.target.value);invalidate()}}/></label><p className="lm-note">Each label fills the roll width. Blank space above and below the label is trimmed.</p></div>}<div className={'lm-layout lm-layout-'+(paper==='a4'?count:1)}>{Array.from({length:paper==='a4'?count:1},(_,i)=><div key={i}><span>LABEL {i+1}</span><i/></div>)}</div><p className="lm-note">{included.length} labels{paper==='a4'?` → ${Math.ceil(included.length/count)} sheets`:' · one PDF page per label'}. Upload order and page order are preserved. Untick invoice pages you do not need.</p>{!ready&&<p className="lm-pending">{mode==='auto'?'An unfamiliar layout needs attention. Skip that page or use Saved crops to set its crop.':mode==='full'?'Include at least one page to continue.':'Include at least one label and confirm a crop for every unrecognized layout to continue.'}</p>}<button className="primary" disabled={!ready||busy} onClick={()=>void generate()}>{busy?'Preparing…':'Prepare combined PDF'}</button></div></section></div>}
 {output&&<section className="panel" ref={preview} tabIndex={-1} aria-labelledby="label-preview-title">
  <div className="panel-head">
   <div><h2 id="label-preview-title">3. Preview, download or print</h2><p>Print at Actual size / 100%. {paper==='a4'?'Select A4 in your printer settings.':'Select continuous roll media at the matching width in your printer settings.'}</p></div>
   <div className="lm-crop-actions">
    <a className="secondary" href={url} download={output.file.name}><Download size={16}/>Download PDF</a>
    <button type="button" className="secondary" disabled={sharing} onClick={()=>void sharePdf()}><Share2 size={16}/>Share PDF</button>
    <button className="primary" onClick={print}><Printer size={16}/>Print</button>
   </div>
  </div>
  {shareNote&&<p className="lm-note" role="status">{shareNote}</p>}
  <iframe className="lm-output" title="Combined shipping labels PDF" src={url}/>
  <p className="lm-note">If the browser does not open the print dialog automatically, use the PDF viewer’s print button.</p>
 </section>}
 </div>;
}
