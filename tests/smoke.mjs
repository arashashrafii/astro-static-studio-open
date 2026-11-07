import assert from 'node:assert/strict';
import sharp from 'sharp';
import {readFile,unlink,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base='http://127.0.0.1:4322/api/';
const headers={Origin:'http://localhost:5173','Content-Type':'application/json'};
const contentFile=new URL('../content/content.json',import.meta.url);
const originalText=await readFile(contentFile,'utf8');
const original=JSON.parse(originalText);
const media=[];
async function call(path,method,body){const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data}
try{
 const previousIndex=await readFile(new URL('../apps/site/dist/index.html',import.meta.url));
 await writeFile(contentFile,'{ invalid json');
 let failedBuild;
 try{failedBuild=await fetch(base+'build',{method:'POST',headers:{Origin:headers.Origin}})}finally{await writeFile(contentFile,originalText)}
 assert.equal(failedBuild.status,400,'invalid content must fail the local build');
 assert.ok(createHash('sha256').update(await readFile(new URL('../apps/site/dist/index.html',import.meta.url))).digest().equals(createHash('sha256').update(previousIndex).digest()),'failed build must preserve previous static output');
 for(const format of ['png','jpeg']){const buf=await sharp({create:{width:2400,height:1200,channels:3,background:'#aabb99'}})[format]().toBuffer();const form=new FormData();form.append('image',new Blob([buf],{type:'image/'+format}),'fixture.'+format);const r=await fetch(base+'media',{method:'POST',headers:{Origin:headers.Origin},body:form});assert.equal(r.status,200);const image=await r.json();media.push(image);const webp=await fetch('http://localhost:5173'+image.src);assert.equal(webp.status,200);const meta=await sharp(Buffer.from(await webp.arrayBuffer())).metadata();assert.equal(meta.format,'webp');assert.equal(meta.width,2000);}
 const forbidden=await fetch(base+'build',{method:'POST',headers:{Origin:'https://example.com'}});assert.equal(forbidden.status,403);
 const malformed=structuredClone(original);malformed.entries[0].slug='../escape';assert.equal((await fetch(base+'content',{method:'PUT',headers,body:JSON.stringify(malformed)})).status,400);
 const next=structuredClone(original);next.entries.push({id:crypto.randomUUID(),kind:'page',slug:'smoke-fixture',title:'آزمون موقت',summary:'Integration fixture',published:true,components:[{type:'text',body:'<script>alert(1)</script>'},{type:'gallery',images:media}]});
 await call('content','PUT',next);assert.equal((await (await fetch(base+'content')).json()).entries.length,next.entries.length);
 assert.equal((await fetch('http://localhost:4321/smoke-fixture/')).status,200);
 await call('build','POST');const html=await readFile(new URL('../apps/site/dist/smoke-fixture/index.html',import.meta.url),'utf8');assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>alert(1)</script>'));assert.ok(html.includes(media[0].src));
 console.log('PASS: failed build preserves prior output; JPEG/PNG → resized WebP; upload proxy; invalid schema; origin guard; page creation; persistence; Astro route; static build; escaped text.');
}finally{
 await writeFile(contentFile,originalText);
 for(const image of media){
  await unlink(new URL('../apps/site/public'+image.src,import.meta.url));
  const id=image.src.split('/').at(-1).replace(/\.webp$/,'');
  for(const extension of ['jpg','png'])await unlink(new URL(`../content/media-originals/${id}.${extension}`,import.meta.url)).catch(error=>{if(error.code!=='ENOENT')throw error});
 }
 await call('build','POST');
}
