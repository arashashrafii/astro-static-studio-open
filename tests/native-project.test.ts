import assert from 'node:assert/strict';
import test from 'node:test';
import {archiveUnlinkedDrafts,requestNativeContent} from '../apps/admin/src/native-project.js';

const sha='0123456789abcdef0123456789abcdef01234567';
function setupWindow(reply:(request:Record<string,unknown>)=>Record<string,unknown>){
 const values=new Map<string,string>();const target=new EventTarget() as EventTarget&Record<string,unknown>;
 const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,String(value))},removeItem:(key:string)=>{values.delete(key)}};
 const sent:string[]=[];const bridge={postMessage:(raw:string)=>{sent.push(raw);const request=JSON.parse(raw) as Record<string,unknown>;const response=reply(request);const event=new Event('studio-native-project-response') as CustomEvent;Object.defineProperty(event,'detail',{value:response});target.dispatchEvent(event)}};
 Object.assign(target,{StudioNativeAuth:bridge,localStorage:storage,setTimeout,clearTimeout});Object.defineProperty(globalThis,'window',{value:target,configurable:true});
 Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
 return {values,sent};
}

test('project content uses only named native actions and never sends credentials to JavaScript',async()=>{
 const payload={version:2,site:{name:'Example'},pages:[],collections:[],items:[]};
 const {sent}=setupWindow(request=>({source:'studio-native-project',requestId:request.requestId,result:request.action==='readContent'?{content:payload,sha}:{content:payload,sha:'abcdef0123456789abcdef0123456789abcdef01'}}));
 assert.deepEqual(await requestNativeContent('content'),payload);
 assert.deepEqual(await requestNativeContent('content',{method:'PUT',body:JSON.stringify(payload)}),payload);
 const requests=sent.map(raw=>JSON.parse(raw));
 assert.deepEqual(requests.map(request=>request.action),['readContent','saveContent']);
 assert.equal(requests[1].expectedSha,sha);
 assert.equal(requests.some(request=>'access_token' in request||'token' in request||'url' in request||'headers' in request),false);
});

test('revision conflict retains the local draft and latest GitHub version separately',async()=>{
 const {values}=setupWindow(request=>({source:'studio-native-project',requestId:request.requestId,result:{error:'conflict',conflict:{content:{version:2,site:{name:'remote'},pages:[],collections:[],items:[]},sha:'abcdef0123456789abcdef0123456789abcdef01'}}}));
 values.set('studio-github-content-sha-v1',sha);values.set('studio-draft-v2','local draft');
 await assert.rejects(requestNativeContent('content',{method:'PUT',body:'{"version":2}'}),/conflict/);
 assert.equal(values.get('studio-draft-v2'),'local draft');
 assert.match(values.get('studio-github-content-conflict-v1')||'',/remote/);
});

test('unlinked drafts are archived on device instead of transferred into a new project',()=>{
 const {values}=setupWindow(()=>({}));values.set('studio-draft-v2','old local draft');
 assert.equal(archiveUnlinkedDrafts(),true);assert.equal(values.has('studio-draft-v2'),false);
 assert.match(values.get('studio-unlinked-drafts-v1')||'',/old local draft/);
});
