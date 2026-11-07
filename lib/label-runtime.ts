let loading:Promise<{reader:any;writer:any}>|null=null;
export function loadLabelTools(){
 if(loading)return loading;
 loading=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.type='module';script.src='/label-reader/maker-runtime.mjs';
  script.onload=()=>{const tools=(window as unknown as {afrahLabelTools?:{reader:any;writer:any}}).afrahLabelTools;if(tools)resolve(tools);else{loading=null;reject(Error('The PDF tools could not start. Refresh and retry.'));}};
  script.onerror=()=>{loading=null;script.remove();reject(Error('The PDF tools could not load. Check your connection and retry.'));};document.head.appendChild(script);
 });return loading;
}
