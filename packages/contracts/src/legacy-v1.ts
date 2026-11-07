import { z } from 'zod';
export const MediaSchema = z.object({ src: z.string().regex(/^\/media\/[a-f0-9-]+\.webp$/), alt: z.string().max(500) });
const RichTextAlignmentSchema = z.enum(['left', 'center', 'right']);
const RichTextMediaSrcSchema = z.string().regex(/^\/media\/(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/);
const RichTextInlineSchema = z.discriminatedUnion('type', [
 z.object({type:z.literal('text'),text:z.string().max(50000),bold:z.boolean().optional(),italic:z.boolean().optional(),size:z.enum(['small','large']).optional()}).strict(),
 z.object({type:z.literal('image'),src:RichTextMediaSrcSchema,alt:z.string().trim().min(1).max(500)}).strict()
]);
export const RichTextSchema = z.object({version:z.literal(1),blocks:z.array(z.discriminatedUnion('type', [
 z.object({type:z.literal('paragraph'),align:RichTextAlignmentSchema.optional(),content:z.array(RichTextInlineSchema).max(5000)}).strict(),
 z.object({type:z.literal('heading'),level:z.union([z.literal(2),z.literal(3),z.literal(4)]),align:RichTextAlignmentSchema.optional(),content:z.array(RichTextInlineSchema).max(5000)}).strict()
])).max(2000)}).strict().superRefine((value,ctx)=>{
 const nodes=value.blocks.flatMap(block=>block.content);
 if(nodes.reduce((total,node)=>total+(node.type==='text'?node.text.length:0),0)>50000)ctx.addIssue({code:'custom',path:['blocks'],message:'Rich text exceeds the 50000 character limit'});
 if(nodes.filter(node=>node.type==='image').length>1000)ctx.addIssue({code:'custom',path:['blocks'],message:'Rich text exceeds the 1000 image limit'});
});
export type RichText = z.infer<typeof RichTextSchema>;
export function richTextToPlainText(value: RichText): string {
 return value.blocks.map(block=>block.content.map(node=>node.type==='text'?node.text:'').join('')).join('\n\n').slice(0,50000);
}
export function entryExcerpt(body: string, summary: string, limit=150): string {
 const source=body.trim()?body:summary;
 return Array.from(source.replace(/\s+/gu,' ').trim()).slice(0,limit).join('');
}
export const ComponentSchema = z.discriminatedUnion('type', [
 z.object({type:z.literal('text'),body:z.string().max(50000),richText:RichTextSchema.optional()}).superRefine((component,ctx)=>{
  if(component.richText&&component.body!==richTextToPlainText(component.richText))ctx.addIssue({code:'custom',path:['body'],message:'Body must match the rich text plain-text projection'});
 }),
 z.object({type:z.literal('gallery'),images:z.array(MediaSchema).max(100)})
]);
export const EntrySchema = z.object({id:z.string().uuid(),kind:z.enum(['page','project']),slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).refine(s=>!['projects','media','admin','api'].includes(s),'آدرس رزرو شده است'),title:z.string().trim().min(1).max(200),summary:z.string().max(1000),categories:z.array(z.string().trim().min(1).max(80)).max(10).optional(),tags:z.array(z.string().trim().min(1).max(80)).max(30).optional(),releaseDate:z.string().max(80).optional(),published:z.boolean(),components:z.array(ComponentSchema).max(30)});
export const ContentSchema = z.object({version:z.literal(1),site:z.object({name:z.string().trim().min(1).max(200),tagline:z.string().max(500),email:z.union([z.email(),z.literal('')]),phone:z.string().max(80)}),entries:z.array(EntrySchema).max(500)}).superRefine((v,ctx)=>{for(const key of ['id','slug'] as const){const seen=new Set();v.entries.forEach((e,i)=>{if(seen.has(e[key]))ctx.addIssue({code:'custom',path:['entries',i,key],message:'مقدار تکراری است'});seen.add(e[key]);});}});
export type Content = z.infer<typeof ContentSchema>;
export type Entry = z.infer<typeof EntrySchema>;
export type Component = z.infer<typeof ComponentSchema>;
export function entryExcerptFromContent(components: Component[], summary: string, limit=150): string {
 const body=components.filter((component):component is Extract<Component,{type:'text'}>=>component.type==='text').map(component=>component.richText?richTextToPlainText(component.richText):component.body).join('\n\n');
 return entryExcerpt(body,summary,limit);
}
export {
  ComponentSchema as LegacyComponentV1Schema,
  ContentSchema as LegacyContentV1Schema,
  EntrySchema as LegacyEntryV1Schema,
  MediaSchema as LegacyMediaV1Schema,
  RichTextSchema as LegacyRichTextV1Schema,
  type Component as LegacyComponentV1,
  type Content as LegacyContentV1,
  type Entry as LegacyEntryV1,
  type RichText as LegacyRichTextV1,
};
