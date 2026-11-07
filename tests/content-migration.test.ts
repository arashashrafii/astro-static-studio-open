import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {ContentSchema,LegacyContentV1Schema,type LegacyContentV1} from '@astro-static-studio/contracts';
import {importContent,migrateV1ToV2} from '../packages/contracts/src/content-migration.js';
import {migrateContentToV2} from '../apps/api/src/content-migration.js';

const sample=LegacyContentV1Schema.parse(JSON.parse(await readFile(new URL('./fixtures/content-v1.json',import.meta.url),'utf8')));

test('legacy import normalizes to the sole current contract without changing the source object',()=>{
  const source=structuredClone(sample);
  const imported=importContent(source);
  assert.equal(ContentSchema.safeParse(imported).success,true);
  assert.deepEqual(imported,migrateV1ToV2(sample));
  assert.deepEqual(source,sample);
  assert.throws(()=>importContent({version:99}),/پشتیبانی نمی‌شود/);
});

test('v1 migration preserves page and project identity, route fields, order, publication and descriptions',()=>{
  const migrated=migrateV1ToV2(sample);
  assert.equal(migrated.version,2);
  assert.deepEqual(migrated.pages.map(page=>page.id),sample.entries.filter(entry=>entry.kind==='page').map(entry=>entry.id));
  assert.deepEqual(migrated.items.map(item=>item.id),sample.entries.filter(entry=>entry.kind==='project').map(entry=>entry.id));
  assert.deepEqual(migrated.pages.map(page=>page.slug),sample.entries.filter(entry=>entry.kind==='page').map(entry=>entry.slug));
  assert.deepEqual(migrated.items.map(item=>[item.slug,item.published,item.description]),sample.entries.filter(entry=>entry.kind==='project').map(entry=>[entry.slug,entry.published,{source:'manual',value:entry.summary}]));
  assert.equal(migrated.collections[0].slug,'projects');
  assert.equal(migrated.collections[0].routeBase,'portfolio');
  assert.deepEqual({kind:migrated.collections[0].kind,layout:migrated.collections[0].listLayout,loading:migrated.collections[0].loading,pageSize:migrated.collections[0].pageSize},{kind:'content',layout:'grid',loading:'show-more',pageSize:12});
  assert.equal(migrated.collections[0].presetId,'project');
  assert.equal(ContentSchema.safeParse(migrated).success,true);
  const legacyGallery=structuredClone(sample);
  const page=legacyGallery.entries.find(entry=>entry.kind==='page')!;
  page.components=[{type:'gallery',images:[{src:'/media/12345678-1234-4123-8123-123456789012.webp',alt:''}]}];
  const galleryBlock=migrateV1ToV2(legacyGallery).pages.find(value=>value.id===page.id)!.blocks[0];
  assert.equal(galleryBlock.type,'gallery');
  if(galleryBlock.type==='gallery')assert.equal(galleryBlock.layout,'grid');
});

test('v1 migration preserves project text and gallery interleaving, image alt text, categories, tags and release date',()=>{
  const input=structuredClone(sample);
  const project=input.entries.find(entry=>entry.kind==='project')!;
  project.summary='Manual description';
  project.categories=['First','Second']; project.tags=['Tag']; project.releaseDate='2024';
  project.components=[
    {type:'text',body:'Opening',richText:{version:1,blocks:[{type:'heading',level:3,align:'center',content:[{type:'text',text:'Opening',bold:true,italic:true,size:'large'}]}]}},
    {type:'gallery',images:[{src:'/media/12345678-1234-4123-8123-123456789012.webp',alt:'first image'}]},
    {type:'text',body:'Closing'},
    {type:'gallery',images:[{src:'/media/87654321-4321-4321-8321-210987654321.webp',alt:'second image'}]},
  ];
  const migrated=migrateV1ToV2(input);
  const collection=migrated.collections[0];
  const item=migrated.items.find(value=>value.id===project.id)!;
  const detail=collection.fields.find(field=>field.type==='text'&&field.format==='rich')!;
  const document=item.values[detail.id] as {blocks:Array<{type:string;children?:Array<{text?:string}>;images?:Array<{alt:string}>}>};
  assert.deepEqual(document.blocks.map(block=>block.type),['heading','gallery','paragraph','gallery']);
  assert.deepEqual(document.blocks[0].children?.[0],{type:'text',text:'Opening',marks:['bold','italic'],size:'large'});
  assert.equal(document.blocks[1].images?.[0].alt,'first image');
  assert.equal(document.blocks[3].images?.[0].alt,'second image');
  assert.deepEqual(item.description,{source:'manual',value:'Manual description'});
  const category=collection.fields.find(field=>field.type==='category'&&field.label==='دسته‌ها')!;
  const tags=collection.fields.find(field=>field.type==='category'&&field.label==='برچسب‌ها')!;
  assert.equal((item.values[category.id] as string[]).length,2);
  assert.equal((item.values[tags.id] as string[]).length,1);
  const release=collection.fields.find(field=>field.type==='text'&&field.format==='plain'&&field.label==='تاریخ اثر')!;
  assert.equal(item.values[release.id],'2024');
});

test('v1 migration preserves a paragraph at the legacy 5,000 inline-node limit',()=>{
  const input=structuredClone(sample);
  const page=input.entries.find(entry=>entry.kind==='page')!;
  const content=Array.from({length:501},(_,index)=>({type:'text' as const,text:String(index)}));
  page.components=[{type:'text',body:content.map(node=>node.text).join(''),richText:{version:1,blocks:[{type:'paragraph',content}]} }];
  const migrated=migrateV1ToV2(input);
  const pageV2=migrated.pages.find(value=>value.id===page.id)!;
  assert.equal(ContentSchema.safeParse(migrated).success,true);
  const richText=(pageV2.blocks[0] as {document:{blocks:Array<{children:Array<unknown>}>}}).document;
  assert.equal(richText.blocks[0].children.length,501);
});

test('v1 migration rejects unsupported versions instead of guessing',()=>{
  assert.throws(()=>migrateV1ToV2({version:999}),/Invalid input|version/i);
});

test('file migration creates a V1 recovery backup before atomically installing V2',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'studio-v2-migration-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const contentPath=join(directory,'content.json');
  const backupDirectory=join(directory,'backups');
  const input={version:1,site:{name:'Migration test',tagline:'',email:'',phone:''},entries:[{id:'a7b1bb0e-92b7-4772-b88e-60389c07c033',kind:'page',slug:'about',title:'About',summary:'Legacy',published:true,components:[{type:'text',body:'Text'}]}]};
  await mkdir(join(directory,'media'),{recursive:true});
  await writeFile(contentPath,JSON.stringify(input));
  const result=await migrateContentToV2({contentPath,mediaDirectory:join(directory,'media'),backupDirectory});
  assert.equal(result.migrated,true);
  assert.equal(result.content.version,2);
  const migrated=JSON.parse(await readFile(contentPath,'utf8'));
  assert.equal(migrated.version,2);
  const backup=JSON.parse(await readFile(join(backupDirectory,result.backupFile!), 'utf8'));
  assert.equal(backup.content.version,1);
  assert.deepEqual(backup.content,input);
});

test('migration preserves a local V1 draft separately from saved V1 and returns its V2 draft',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'studio-v2-draft-migration-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const contentPath=join(directory,'content.json'),backupDirectory=join(directory,'backups'),mediaDirectory=join(directory,'media'),originalsDirectory=join(directory,'originals');
  const saved:LegacyContentV1={version:1,site:{name:'Saved',tagline:'',email:'',phone:''},entries:[{id:'a7b1bb0e-92b7-4772-b88e-60389c07c033',kind:'page',slug:'about',title:'About',summary:'Saved summary',published:true,components:[{type:'text',body:'Saved body'}]}]};
  const draft=structuredClone(saved);draft.site.name='Draft';draft.entries[0].summary='Draft summary';draft.entries[0].components=[{type:'text',body:'Unsaved body'},{type:'gallery',images:[{src:'/media/12345678-1234-4123-8123-123456789012.webp',alt:'Draft-only image'}]}];
  await mkdir(mediaDirectory,{recursive:true});await mkdir(originalsDirectory,{recursive:true});
  await writeFile(join(mediaDirectory,'12345678-1234-4123-8123-123456789012.webp'),await sharp({create:{width:4,height:4,channels:3,background:'#bd6532'}}).webp().toBuffer());
  await writeFile(join(originalsDirectory,'12345678-1234-4123-8123-123456789012.jpg'),await sharp({create:{width:4,height:4,channels:3,background:'#bd6532'}}).jpeg().toBuffer());
  await writeFile(contentPath,JSON.stringify(saved));
  const result=await migrateContentToV2({contentPath,mediaDirectory,originalsDirectory,backupDirectory,draft});
  assert.equal(result.content.version,2);
  assert.equal(result.draft?.site.name,'Draft');
  assert.equal(result.draft?.pages[0].description.value,'Draft summary');
  assert.equal((result.draft?.pages[0].blocks[0] as {document:{blocks:Array<{children:Array<{text:string}>}>}}).document.blocks[0].children[0].text,'Unsaved body');
  assert.equal(JSON.parse(await readFile(contentPath,'utf8')).site.name,'Saved');
  const savedBundle=JSON.parse(await readFile(join(backupDirectory,result.backupFile!),'utf8'));
  const draftBundle=JSON.parse(await readFile(join(backupDirectory,result.draftBackupFile!),'utf8'));
  assert.equal(savedBundle.content.site.name,'Saved');
  assert.equal(draftBundle.content.site.name,'Draft');
  assert.equal(draftBundle.content.entries[0].components[0].body,'Unsaved body');
  assert.deepEqual(draftBundle.media.map((entry:{src:string})=>entry.src),['/media/12345678-1234-4123-8123-123456789012.webp']);
  assert.equal(draftBundle.media[0].original.name,'12345678-1234-4123-8123-123456789012.jpg');
});

test('migration refuses a local draft with missing media and leaves saved V1 untouched',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'studio-v2-draft-media-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const contentPath=join(directory,'content.json');
  const saved:LegacyContentV1={version:1,site:{name:'Saved',tagline:'',email:'',phone:''},entries:[{id:'a7b1bb0e-92b7-4772-b88e-60389c07c033',kind:'page',slug:'about',title:'About',summary:'',published:true,components:[{type:'text',body:'Saved body'}]}]};
  const draft=structuredClone(saved);draft.entries[0].components=[{type:'gallery',images:[{src:'/media/12345678-1234-4123-8123-123456789012.webp',alt:'Draft image'}]}];
  await writeFile(contentPath,JSON.stringify(saved));
  await assert.rejects(migrateContentToV2({contentPath,mediaDirectory:join(directory,'media'),backupDirectory:join(directory,'backups'),draft}),/ENOENT|no such file/i);
  assert.deepEqual(JSON.parse(await readFile(contentPath,'utf8')),saved);
});

test('unknown stored version is rejected without changing content or creating a backup',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'studio-v2-invalid-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const contentPath=join(directory,'content.json');
  const raw=JSON.stringify({version:99,unexpected:true});
  await writeFile(contentPath,raw);
  await assert.rejects(migrateContentToV2({contentPath,mediaDirectory:join(directory,'media'),backupDirectory:join(directory,'backups')}),/پشتیبانی نمی‌شود/);
  assert.equal(await readFile(contentPath,'utf8'),raw);
});
