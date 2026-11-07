import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ContentSchema, type Content } from '@astro-static-studio/contracts';
import { LegacyContentV1Schema, type LegacyContentV1 } from '@astro-static-studio/contracts/legacy-v1';
export const root=fileURLToPath(new URL('../../../',import.meta.url));
export const contentPath=resolve(root,'content/content.json');
export type StoredContent=Content|LegacyContentV1;
export function parseStoredContent(input:unknown):StoredContent{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('محتوای سایت معتبر نیست.');
 const version=(input as {version?:unknown}).version;
 if(version===1)return LegacyContentV1Schema.parse(input);
 if(version===2)return ContentSchema.parse(input);
 throw new Error(`نسخهٔ محتوای سایت پشتیبانی نمی‌شود: ${String(version)}.`);
}
export async function readContent(path=contentPath):Promise<StoredContent>{return parseStoredContent(JSON.parse(await readFile(path,'utf8')));}
export async function saveContent(input:unknown,path=contentPath):Promise<Content>{
 const data=ContentSchema.parse(input);
 try {const current=parseStoredContent(JSON.parse(await readFile(path,'utf8')));if(current.version===1)throw new Error('محتوای قدیمی ابتدا باید از مسیر بازیابی و پشتیبان‌گیری وارد شود.');}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const temporary=`${path}.${randomUUID()}.tmp`;
 await writeFile(temporary,JSON.stringify(data,null,2),{flag:'wx'});
 await rename(temporary,path);
 return data;
}
