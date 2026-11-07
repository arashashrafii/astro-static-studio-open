import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {migrateV1ToV2} from '../packages/contracts/src/content-migration.js';
import {parseStoredContent,readContent,saveContent} from '../apps/api/src/store.js';

test('content store reads old content for migration but only writes the canonical model',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'studio-content-store-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const path=join(directory,'content.json');
 const v1={version:1,site:{name:'Store test',tagline:'',email:'',phone:''},entries:[{id:'a7b1bb0e-92b7-4772-b88e-60389c07c033',kind:'page',slug:'about',title:'About',summary:'',published:true,components:[]}]};
 await mkdir(directory,{recursive:true});await writeFile(path,JSON.stringify(v1));
 assert.equal((await readContent(path)).version,1);
 const v2=migrateV1ToV2(v1);
 await assert.rejects(saveContent(v2,path),/ابتدا باید از مسیر بازیابی و پشتیبان‌گیری وارد شود/);
 await writeFile(path,JSON.stringify(v2));
 assert.equal((await saveContent(v2,path)).version,2);
 await assert.rejects(saveContent(v1,path));
 assert.equal(JSON.parse(await readFile(path,'utf8')).version,2);
 assert.throws(()=>parseStoredContent({version:99}),/پشتیبانی نمی‌شود/);
});
