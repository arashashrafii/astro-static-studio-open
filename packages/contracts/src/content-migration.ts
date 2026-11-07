import { createHash } from 'node:crypto';
import { ContentSchema as LegacyContentSchema, type Content as LegacyContent, type RichText as LegacyRichText } from './legacy-v1.js';
import {
  ContentSchema as CurrentContentSchema,
  migrateV1PlainTextToRichText,
  type Content,
  type RichTextDocument,
} from './content.js';

/** Parse the current model or normalize an older backup into it without writing to disk. */
export function importContent(input: unknown): Content {
  if (input && typeof input === 'object' && !Array.isArray(input) && (input as {version?:unknown}).version === 2) {
    return CurrentContentSchema.parse(input);
  }
  if (input && typeof input === 'object' && !Array.isArray(input) && (input as {version?:unknown}).version === 1) {
    return migrateV1ToV2(input);
  }
  throw new Error(`نسخهٔ محتوای سایت پشتیبانی نمی‌شود: ${String((input as {version?:unknown}|null)?.version)}.`);
}

function stableUuid(key: string): string {
  const bytes = createHash('sha256').update(`astro-static-studio-v1-to-v2:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function categoryList(values: string[], fieldId: string) {
  const names = [...new Set(values)];
  const usedSlugs = new Set<string>();
  return names.map(name => {
    const id = stableUuid(`category:${fieldId}:${name}`);
    const base = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `category-${id.slice(0,8)}`;
    const slug = usedSlugs.has(base) ? `${base}-${id.slice(0,8)}` : base;
    usedSlugs.add(slug);
    return { id, slug, name };
  });
}

function convertRichText(document: LegacyRichText): RichTextDocument {
  const children=(content:LegacyRichText['blocks'][number]['content'])=>content.map(node=>node.type==='text'
    ? { type:'text' as const,text:node.text,marks:[...(node.bold?['bold' as const]:[]),...(node.italic?['italic' as const]:[])],...(node.size?{size:node.size}:{}) }
    : { type:'image' as const,media:{src:node.src,alt:node.alt} });
  return {
    type: 'document',
    blocks: document.blocks.map(block => block.type === 'paragraph'
      ? { type: 'paragraph', size: 'normal', align: block.align === 'center' ? 'center' : block.align === 'right' ? 'end' : 'start', children: children(block.content) }
      : { type: 'heading', level: block.level, size: 'normal', align: block.align === 'center' ? 'center' : block.align === 'right' ? 'end' : 'start', children: children(block.content) }),
  };
}

function textComponent(document: LegacyRichText | undefined, body: string): RichTextDocument {
  return document ? convertRichText(document) : migrateV1PlainTextToRichText(body);
}

function componentsDocument(components: LegacyContent['entries'][number]['components']): RichTextDocument {
  const blocks: RichTextDocument['blocks'] = [];
  for (const component of components) {
    if (component.type === 'gallery') blocks.push({type:'gallery',images:component.images.map(image=>({...image}))});
    else blocks.push(...textComponent(component.richText,component.body).blocks);
  }
  return {type:'document',blocks};
}

/** Deterministic, lossless mapping for legacy pages/projects into the current model. */
export function migrateV1ToV2(input: unknown): Content {
  const source = LegacyContentSchema.parse(input);
  const collectionId = stableUuid('collection:projects');
  const categoryFieldId = stableUuid('field:projects:categories');
  const tagsFieldId = stableUuid('field:projects:tags');
  const galleryFieldId = stableUuid('field:projects:gallery');
  const detailFieldId = stableUuid('field:projects:details');
  const releaseDateFieldId = stableUuid('field:projects:release-date');
  const categoryValues = source.entries.filter(entry=>entry.kind==='project').flatMap(entry=>entry.categories??[]);
  const tagValues = source.entries.filter(entry=>entry.kind==='project').flatMap(entry=>entry.tags??[]);
  const categories = categoryList(categoryValues,categoryFieldId);
  const tags = categoryList(tagValues,tagsFieldId);
  const categoryIds = new Map(categories.map(category=>[category.name,category.id]));
  const tagIds = new Map(tags.map(tag=>[tag.name,tag.id]));
  const projects = source.entries.filter(entry=>entry.kind==='project');

  const migrated: Content = {
    version: 2,
    site: {...source.site,language:'en',direction:'ltr'},
    pages: source.entries.filter(entry=>entry.kind==='page').map(page=>({
      id:page.id,slug:page.slug,title:page.title,published:page.published,
      description:{source:'manual' as const,value:page.summary},
      blocks:page.components.map(component=>component.type==='gallery'
        ? {type:'gallery' as const,images:component.images.map(image=>({...image})),layout:'grid' as const}
        : {type:'richText' as const,document:textComponent(component.richText,component.body)}),
    })),
    collections:projects.length ? [{
      id:collectionId,slug:'projects',routeBase:'portfolio',name:'پروژه‌ها',kind:'content',listLayout:'grid',loading:'show-more',pageSize:12,presetId:'project',excerptSourceFieldId:detailFieldId,
      fields:[
        {id:categoryFieldId,type:'category',label:'دسته‌ها',categories},
        {id:tagsFieldId,type:'category',label:'برچسب‌ها',categories:tags},
        {id:galleryFieldId,type:'gallery',label:'گالری تصاویر',maxItems:3000},
        {id:detailFieldId,type:'text',label:'جزئیات پروژه',format:'rich'},
        {id:releaseDateFieldId,type:'text',label:'تاریخ اثر',format:'plain'},
      ],
    }] : [],
    items:projects.map(project=>{
      const images=project.components.flatMap(component=>component.type==='gallery'?component.images:[]);
      const values:Record<string,unknown>={
        [categoryFieldId]:(project.categories??[]).map(name=>categoryIds.get(name)!),
        [tagsFieldId]:(project.tags??[]).map(name=>tagIds.get(name)!),
        [galleryFieldId]:images.map(image=>({...image})),
        [detailFieldId]:componentsDocument(project.components),
      };
      if(project.releaseDate!==undefined)values[releaseDateFieldId]=project.releaseDate;
      return {
        id:project.id,collectionId,slug:project.slug,published:project.published,title:project.title,
        ...(images[0]?{coverImage:{...images[0]}}:{}),description:{source:'manual' as const,value:project.summary},values,
      };
    }),
  };
  return CurrentContentSchema.parse(migrated);
}
