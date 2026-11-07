import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LegacyContentV1Schema as ContentSchema,LegacyComponentV1Schema as ComponentSchema,legacyEntryExcerpt as entryExcerpt,legacyEntryExcerptFromContent as entryExcerptFromContent,LegacyRichTextV1Schema as RichTextSchema} from '@astro-static-studio/contracts';
import {readFile} from 'node:fs/promises';
const sample=JSON.parse(await readFile(new URL('./fixtures/content-v1.json',import.meta.url),'utf8'));
test('sample conforms to versioned contract',()=>assert.equal(ContentSchema.safeParse(sample).success,true));
test('site email can be empty during setup but rejects malformed non-empty email',()=>{const c=structuredClone(sample);c.site.email='';assert.equal(ContentSchema.safeParse(c).success,true);c.site.email='owner-at-example';assert.equal(ContentSchema.safeParse(c).success,false)});
test('reject traversal, reserved slugs and duplicate routes',()=>{for(const slug of ['../escape','projects','media','a/b']){const c=structuredClone(sample);c.entries[0].slug=slug;assert.equal(ContentSchema.safeParse(c).success,false)}const c=structuredClone(sample);c.entries[1].slug=c.entries[0].slug;assert.equal(ContentSchema.safeParse(c).success,false)});
test('gallery only accepts managed local WebP media',()=>{assert.equal(ComponentSchema.safeParse({type:'gallery',images:[{src:'/media/1234-abcd.webp',alt:'sample'}]}).success,true);for(const src of ['https://remote/image.webp','/media/../secret.webp','/media/a.png'])assert.equal(ComponentSchema.safeParse({type:'gallery',images:[{src,alt:''}]}).success,false)});
test('reject unknown component types',()=>assert.equal(ComponentSchema.safeParse({type:'script',body:'alert(1)'}).success,false));
test('rich text accepts allowlisted nodes and managed inline images only',()=>{
 const richText={version:1,blocks:[{type:'heading',level:2,align:'center',content:[{type:'text',text:'Hello',bold:true},{type:'image',src:'/media/d316af54-1fe7-4db9-a86a-3b4dd22114a8.webp',alt:'A sample'}]}]};
 assert.equal(RichTextSchema.safeParse(richText).success,true);
 assert.equal(ComponentSchema.safeParse({type:'text',body:'Hello',richText}).success,true);
 assert.equal(ComponentSchema.safeParse({type:'text',body:'Different',richText}).success,false);
 assert.equal(RichTextSchema.safeParse({...richText,blocks:[{type:'paragraph',content:[{type:'image',src:'https://example.com/image.webp',alt:'A sample'}]}]}).success,false);
 assert.equal(RichTextSchema.safeParse({...richText,blocks:[{type:'paragraph',content:[{type:'text',text:'hello',onerror:'x'}]}]}).success,false);
});
test('excerpt uses 150 Unicode code points from body and falls back to legacy summary',()=>{
 assert.equal(Array.from(entryExcerpt('😀'.repeat(151),'legacy')).length,150);
 assert.equal(entryExcerptFromContent([{type:'text',body:'',richText:{version:1,blocks:[]}}],'Legacy summary'),'Legacy summary');
 assert.equal(entryExcerptFromContent([{type:'text',body:'Body text'}],'Legacy summary'),'Body text');
});
