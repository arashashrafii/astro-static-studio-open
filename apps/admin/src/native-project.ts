type NativeBridge={postMessage:(message:string)=>void;onmessage:((event:{data:string})=>void)|null};
type ProjectReply={source?:string;requestId?:string;result?:{content?:unknown;sha?:string;message?:string;error?:string;conflict?:{content?:unknown;sha?:string}}};
declare global { interface Window {StudioNativeAuth?:NativeBridge} }
let sequence=0;
const REVISION='studio-github-content-sha-v1';
const CONFLICT='studio-github-content-conflict-v1';
const UNLINKED='studio-unlinked-drafts-v1';

export function isNativeProjectMode(){return typeof window!=='undefined'&&Boolean(window.StudioNativeAuth)}

export function sendNativeProject(action:'createProject',payload:{name:string}){
 const bridge=typeof window==='undefined'?undefined:window.StudioNativeAuth;if(!bridge)return false;
 bridge.postMessage(JSON.stringify({action,...payload,requestId:`p${++sequence}`}));return true;
}

/** Keep pre-project drafts on device but out of the newly created repository unless owner restores them. */
export function archiveUnlinkedDrafts():boolean{
 const keys=['studio-draft-v2','studio-draft-v1','sara-draft-v1'];const drafts=keys.flatMap(key=>{const raw=localStorage.getItem(key);return raw?[{key,raw,archivedAt:new Date().toISOString()}]:[]});if(!drafts.length)return true;
 try{const previous=JSON.parse(localStorage.getItem(UNLINKED)||'[]');if(!Array.isArray(previous))return false;const next=[...previous,...drafts];const encoded=JSON.stringify(next);if(encoded.length>4_000_000)return false;localStorage.setItem(UNLINKED,encoded);for(const {key} of drafts)localStorage.removeItem(key);return true}catch{return false}
}
export function readUnlinkedDrafts(){try{const value=JSON.parse(localStorage.getItem(UNLINKED)||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item.key==='string'&&typeof item.raw==='string'&&typeof item.archivedAt==='string'):[]}catch{return[]}}
export function restoreUnlinkedDraft(raw:string){localStorage.setItem('studio-draft-v2',raw)}
export function removeUnlinkedDraft(archivedAt:string){const drafts=readUnlinkedDrafts().filter(item=>item.archivedAt!==archivedAt);if(drafts.length)localStorage.setItem(UNLINKED,JSON.stringify(drafts));else localStorage.removeItem(UNLINKED)}

function call(action:'readContent'|'saveContent'|'checkInstallation',payload:Record<string,unknown>):Promise<ProjectReply['result']>{
 const bridge=window.StudioNativeAuth;if(!bridge)return Promise.reject(new Error('GitHub project access is only available in the Android app.'));
 const requestId=`p${++sequence}`;
 return new Promise((resolve,reject)=>{
  const timer=window.setTimeout(()=>{window.removeEventListener('studio-native-project-response',receive);reject(new Error('GitHub request timed out. Your draft remains on this device.'))},30000);
  const receive=(event:Event)=>{const reply=(event as CustomEvent<ProjectReply>).detail;if(reply?.requestId!==requestId)return;window.clearTimeout(timer);window.removeEventListener('studio-native-project-response',receive);
   const result=reply.result;if(result?.conflict){try{localStorage.setItem(CONFLICT,JSON.stringify(result.conflict));window.dispatchEvent(new Event('studio-native-project-conflict'))}catch{}reject(new Error(result.error||'GitHub content changed. Your draft and the latest GitHub version are both preserved.'))}
   else if(result?.error)reject(new Error(result.error));else resolve(result)};
  window.addEventListener('studio-native-project-response',receive);bridge.postMessage(JSON.stringify({action,requestId,...payload}));
 });
}

/** Read-only GitHub App installation and permission preflight. */
export async function checkNativeInstallation():Promise<string>{
 const result=await call('checkInstallation',{});if(!result||typeof result.message!=='string')throw new Error(result?.error||'GitHub did not return installation status.');return result.message;
}

/** Routes only content.json reads/writes into typed native operations; other browser APIs stay unchanged. */
export async function requestNativeContent(path:string,options:RequestInit={}):Promise<unknown|null>{
 if(!isNativeProjectMode()||path!=='content')return null;
 const method=(options.method||'GET').toUpperCase();
 if(method==='GET'){
  const result=await call('readContent',{});if(!result||!result.content||typeof result.sha!=='string')throw new Error('GitHub returned incomplete project content.');
  localStorage.setItem(REVISION,result.sha);return result.content;
 }
 if(method==='PUT'){
  let content:unknown;try{content=JSON.parse(String(options.body??''))}catch{throw new Error('The content draft is not valid JSON.');}
  const expectedSha=localStorage.getItem(REVISION);if(!expectedSha)throw new Error('Reload the private project before saving. Your draft remains on this device.');
  const result=await call('saveContent',{expectedSha,content});if(!result||!result.content||typeof result.sha!=='string')throw new Error('GitHub did not confirm the saved revision.');
  localStorage.setItem(REVISION,result.sha);localStorage.removeItem(CONFLICT);return result.content;
 }
 throw new Error('This Android project supports only reading and saving canonical content.');
}

export function readNativeConflict<T>():{content:T;sha:string}|null{
 try{const value=JSON.parse(localStorage.getItem(CONFLICT)||'null');return value&&value.content&&typeof value.sha==='string'?value:null}catch{return null}
}
export function chooseNativeConflictRevision(sha:string){localStorage.setItem(REVISION,sha);localStorage.removeItem(CONFLICT)}
export function clearNativeConflict(){localStorage.removeItem(CONFLICT)}
