import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ContentSchema,
  RichTextDocumentSchema,
  PageBlockSchema,
  collectionItemDescription,
  descriptionForDisplay,
  migrateV1PlainTextToRichText,
  richTextToPlainText,
} from '../packages/contracts/src/index.js';

const collectionId = '10000000-0000-4000-8000-000000000001';
const categoryFieldId = '10000000-0000-4000-8000-000000000002';
const categoryId = '10000000-0000-4000-8000-000000000003';
const galleryFieldId = '10000000-0000-4000-8000-000000000004';
const richTextFieldId = '10000000-0000-4000-8000-000000000005';
const pageId = '10000000-0000-4000-8000-000000000006';
const itemId = '10000000-0000-4000-8000-000000000007';
const mediaId = '10000000-0000-4000-8000-000000000008';
const releaseDateFieldId = '10000000-0000-4000-8000-000000000009';
const linkFieldId = '10000000-0000-4000-8000-000000000010';
const itemSlug = 'sample-project';
const image = { src: `/media/${mediaId}.webp`, alt: 'Blue sculpture' };

function validContent(): any {
  return {
    version: 2,
    site: { name: 'Sample', tagline: '', email: '', phone: '', language: 'en', direction: 'ltr' },
    pages: [{
      id: pageId,
      slug: 'home',
      title: 'Home',
      published: true,
      description: { source: 'manual', value: '' },
      blocks: [{ type: 'collectionView', collectionId, view: 'grid', categoryFieldId, categoryIds: [], sort: 'manual', limit: 12 }],
    }],
    collections: [{
      id: collectionId,
      slug: 'projects',
      routeBase: 'portfolio',
      name: 'Projects',
      presetId: 'project',
      excerptSourceFieldId: richTextFieldId,
      fields: [
        { id: categoryFieldId, type: 'category', label: 'Category', categories: [{ id: categoryId, slug: 'sculpture', name: 'Sculpture' }] },
        { id: galleryFieldId, type: 'gallery', label: 'Gallery', maxItems: 10 },
        { id: richTextFieldId, type: 'text', format: 'rich', label: 'Project details' },
        { id: releaseDateFieldId, type: 'text', format: 'plain', label: 'Release date' },
        { id: linkFieldId, type: 'link', label: 'External link' },
      ],
    }],
    items: [{
      id: itemId,
      collectionId,
      slug: itemSlug,
      published: true,
      title: 'Sample project',
      coverImage: image,
      description: { source: 'auto' },
      values: {
        [categoryFieldId]: [categoryId],
        [galleryFieldId]: [image],
        [richTextFieldId]: {
          type: 'document',
          blocks: [{ type: 'paragraph', size: 'normal', align: 'start', children: [{ type: 'text', text: 'A sculpture', marks: ['bold'] }, { type: 'image', media: image }] }],
        },
        [releaseDateFieldId]: '2026',
      },
    }],
  };
}

test('canonical schema accepts a generic Project preset while keeping it a collection', () => {
  const parsed = ContentSchema.parse(validContent());
  assert.equal(parsed.collections[0].presetId, 'project');
  assert.equal(parsed.collections[0].routeBase, 'portfolio');
  assert.equal(parsed.collections[0].kind, 'content');
  assert.equal(parsed.collections[0].listLayout, 'grid');
  assert.equal(parsed.collections[0].loading, 'show-more');
  assert.equal(parsed.items[0].id, itemId);
});

test('page gallery layout defaults for legacy content and preserves explicit choices and image title', () => {
  const legacy = structuredClone(validContent());
  legacy.pages[0].blocks = [{ type: 'gallery', images: [{ ...image, alt: '' }] }];
  const parsedLegacy = ContentSchema.parse(legacy);
  assert.equal(parsedLegacy.pages[0].blocks[0].type, 'gallery');
  if (parsedLegacy.pages[0].blocks[0].type === 'gallery') assert.equal(parsedLegacy.pages[0].blocks[0].layout, 'grid');

  legacy.pages[0].blocks[0].layout = 'masonry';
  legacy.pages[0].blocks[0].images[0].title = 'A separate display title';
  const parsed = ContentSchema.parse(legacy);
  const gallery = parsed.pages[0].blocks[0];
  assert.equal(gallery.type, 'gallery');
  if (gallery.type === 'gallery') {
    assert.equal(gallery.layout, 'masonry');
    assert.equal(gallery.images[0].alt, '', 'blank alt remains allowed');
    assert.equal(gallery.images[0].title, 'A separate display title');
  }
});

test('gallery items may omit a display title while keeping a stable detail slug and image', () => {
  const gallery = structuredClone(validContent());
  gallery.collections[0].kind = 'gallery';
  gallery.collections[0].listLayout = 'masonry';
  gallery.items[0].title = undefined;
  assert.equal(ContentSchema.safeParse(gallery).success, true);
  gallery.items[0].values[galleryFieldId] = [];
  assert.equal(ContentSchema.safeParse(gallery).success, false, 'published gallery items need an image');
});

test('masonry is reserved for gallery collections and content items require titles', () => {
  const content = structuredClone(validContent());
  content.collections[0].listLayout = 'masonry';
  assert.equal(ContentSchema.safeParse(content).success, false);
  content.collections[0].listLayout = 'grid';
  content.items[0].title = undefined;
  assert.equal(ContentSchema.safeParse(content).success, false);
});

test('rich text covers heading, size, alignment, italic and rejects unsupported formatting values', () => {
  const document = {
    type: 'document',
    blocks: [{ type: 'heading', level: 2, size: 'large', align: 'end', children: [{ type: 'text', text: 'A heading', marks: ['italic'] }] }],
  };
  const parsed = RichTextDocumentSchema.parse(document);
  assert.equal(parsed.blocks[0].type, 'heading');
  if (parsed.blocks[0].type === 'heading') {
    assert.equal(parsed.blocks[0].size, 'large');
    assert.equal(parsed.blocks[0].align, 'end');
    assert.deepEqual(parsed.blocks[0].children[0].type === 'text' ? parsed.blocks[0].children[0].marks : [], ['italic']);
  }
  for (const invalid of [
    {...document, blocks: [{...document.blocks[0], size: 'huge'}]},
    {...document, blocks: [{...document.blocks[0], align: 'justify'}]},
    {...document, blocks: [{...document.blocks[0], children: [{type: 'text', text: 'x', marks: ['underline']}]}]},
  ]) assert.equal(RichTextDocumentSchema.safeParse(invalid).success, false);
  assert.equal(RichTextDocumentSchema.safeParse({...document, blocks: [{type: 'paragraph', align: 'start', children: [{type: 'text', text: 'x'}]}]}).success, false, 'serialized nodes must provide formatting attributes');
});

test('rich text image placement is optional for legacy payloads and survives canonical parsing', () => {
  const legacy={type:'document',blocks:[{type:'paragraph',size:'normal',align:'start',children:[{type:'image',media:image}]}]};
  const oldParsed=RichTextDocumentSchema.parse(legacy);
  assert.deepEqual(oldParsed.blocks[0].type==='paragraph'&&oldParsed.blocks[0].children[0].type==='image'?oldParsed.blocks[0].children[0].media:null,image);
  const placed=RichTextDocumentSchema.parse({...legacy,blocks:[{...legacy.blocks[0],children:[{type:'image',media:{...image,placement:'wrap-start'}}]}]});
  assert.equal(placed.blocks[0].type==='paragraph'&&placed.blocks[0].children[0].type==='image'?placed.blocks[0].children[0].media.placement:undefined,'wrap-start');
  assert.equal(RichTextDocumentSchema.safeParse({...legacy,blocks:[{...legacy.blocks[0],children:[{type:'image',media:{...image,placement:'diagonal'}}]}]}).success,false);
  assert.equal(RichTextDocumentSchema.safeParse({...legacy,blocks:[{...legacy.blocks[0],children:[{type:'image',media:{src:image.src,alt:''}}]}]}).success,true,'canonical model permits decorative inline images with empty alt');
});

test('standalone image page block supports optional upload and placement settings', () => {
  assert.equal(PageBlockSchema.safeParse({type:'image'}).success,true);
  const block=PageBlockSchema.parse({type:'image',media:image,align:'end',size:'small'});
  assert.equal(block.type,'image');
  if(block.type==='image')assert.deepEqual({media:block.media,align:block.align,size:block.size},{media:image,align:'end',size:'small'});
  assert.equal(PageBlockSchema.safeParse({type:'image',media:image,align:'diagonal'}).success,false);
  assert.equal(PageBlockSchema.safeParse({type:'image',media:{src:image.src,alt:''}}).success,true);
});

test('rich text ceilings can represent the maximum text and galleries from a v1 entry', () => {
  const blocks = [
    ...Array.from({length: 30}, () => ({type: 'paragraph' as const, size: 'normal' as const, align: 'start' as const, children: [{type: 'text' as const, text: 'x'.repeat(50000), marks: [] as ('bold' | 'italic')[]}]})),
    ...Array.from({length: 30}, () => ({type: 'gallery' as const, images: Array.from({length: 100}, (_, index) => ({src: `/media/${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000000.webp`, alt: ''}))})),
  ];
  assert.equal(RichTextDocumentSchema.safeParse({type: 'document', blocks}).success, true);
});

test('documented content sample parses against the executable draft', () => {
  const contentModel = readFileSync(new URL('../docs/CONTENT_MODEL.md', import.meta.url), 'utf8');
  const sample = contentModel.match(/### Approved canonical contract shape\s+```json\s+([\s\S]*?)\s+```/)?.[1];
  assert.ok(sample, 'approved JSON example exists');
  assert.equal(ContentSchema.safeParse(JSON.parse(sample)).success, true);
});

test('collection item values must match a declared field and category', () => {
  const unknownField = structuredClone(validContent());
  (unknownField.items[0].values as Record<string, unknown>)['20000000-0000-4000-8000-000000000001'] = 'unexpected';
  assert.equal(ContentSchema.safeParse(unknownField).success, false);

  const unknownCategory = structuredClone(validContent());
  unknownCategory.items[0].values[categoryFieldId] = ['20000000-0000-4000-8000-000000000002'];
  assert.equal(ContentSchema.safeParse(unknownCategory).success, false);
});

test('page, collection-list and collection-item routes cannot collide', () => {
  const conflictingPage = structuredClone(validContent());
  conflictingPage.pages[0].slug = 'projects';
  assert.equal(ContentSchema.safeParse(conflictingPage).success, false);

  const duplicateItemPath = structuredClone(validContent());
  duplicateItemPath.items.push({ ...duplicateItemPath.items[0], id: '20000000-0000-4000-8000-000000000001' });
  assert.equal(ContentSchema.safeParse(duplicateItemPath).success, false);

  const reservedPage = structuredClone(validContent());
  reservedPage.pages[0].slug = 'admin';
  assert.equal(ContentSchema.safeParse(reservedPage).success, false);

  const reservedCollectionPath = structuredClone(validContent());
  reservedCollectionPath.collections[0].slug = 'media';
  assert.equal(ContentSchema.safeParse(reservedCollectionPath).success, false);
});

test('rich text permits only known safe nodes and processed media paths', () => {
  const invalidNode = structuredClone(validContent());
  const invalidDocument = invalidNode.items[0].values[richTextFieldId] as unknown as { blocks: Array<{ children: unknown[] }> };
  invalidDocument.blocks[0].children.push({ type: 'html', html: '<script>alert(1)</script>' });
  assert.equal(ContentSchema.safeParse(invalidNode).success, false);

  const invalidMedia = structuredClone(validContent());
  invalidMedia.items[0].values[galleryFieldId] = [{ src: '/uploads/raw.jpg', alt: 'Raw' }];
  assert.equal(ContentSchema.safeParse(invalidMedia).success, false);
});

test('collection links accept internal and safe external URLs, but reject unsafe schemes', () => {
  const internal = structuredClone(validContent());
  (internal.items[0].values as Record<string, unknown>)[linkFieldId] = { label: 'About', href: '/about/' };
  assert.equal(ContentSchema.safeParse(internal).success, true);

  const external = structuredClone(validContent());
  (external.items[0].values as Record<string, unknown>)[linkFieldId] = { label: 'Portfolio', href: 'https://example.com/work' };
  assert.equal(ContentSchema.safeParse(external).success, true);

  const unsafe = structuredClone(validContent());
  (unsafe.items[0].values as Record<string, unknown>)[linkFieldId] = { label: 'Unsafe', href: 'javascript:alert(1)' };
  assert.equal(ContentSchema.safeParse(unsafe).success, false);

  const protocolRelative = structuredClone(validContent());
  (protocolRelative.items[0].values as Record<string, unknown>)[linkFieldId] = { label: 'External', href: '//example.com' };
  assert.equal(ContentSchema.safeParse(protocolRelative).success, false);

  const padded = structuredClone(validContent());
  (padded.items[0].values as Record<string, unknown>)[linkFieldId] = { label: 'About', href: ' /about/ ' };
  assert.equal(ContentSchema.safeParse(padded).success, false, 'padded links are rejected because nested field validation does not rewrite stored values');
});

test('automatic descriptions derive text only; manual descriptions remain exact', () => {
  const parsed = ContentSchema.parse(validContent());
  const rich = parsed.items[0].values[richTextFieldId] as ReturnType<typeof migrateV1PlainTextToRichText>;
  assert.equal(descriptionForDisplay(parsed.items[0].description, rich), 'A sculpture');
  assert.equal(collectionItemDescription(parsed.collections[0], parsed.items[0]), 'A sculpture');
  const configuredSource = structuredClone(parsed.collections[0]);
  configuredSource.excerptSourceFieldId = releaseDateFieldId;
  assert.equal(collectionItemDescription(configuredSource, parsed.items[0]), '2026');
  assert.equal(descriptionForDisplay({ source: 'manual', value: 'Owner text' }, rich), 'Owner text');
  assert.equal(descriptionForDisplay({ source: 'auto' }, undefined), '');
});

test('automatic excerpt is capped at 1000 Unicode code points', () => {
  const oversized = structuredClone(validContent());
  const longText = 'a'.repeat(999) + '😀' + 'b'.repeat(20);
  (oversized.items[0].values[richTextFieldId] as { blocks: Array<{ children: Array<{ text?: string }> }> }).blocks[0].children[0].text = longText;
  const parsed = ContentSchema.parse(oversized);
  const excerpt = collectionItemDescription(parsed.collections[0], parsed.items[0]);
  assert.equal(Array.from(excerpt).length, 1000);
  assert.equal(excerpt.includes('\uFFFD'), false);
});

test('automatic descriptions require a declared text source field', () => {
  const noSource = structuredClone(validContent());
  delete (noSource.collections[0] as Record<string, unknown>).excerptSourceFieldId;
  assert.equal(ContentSchema.safeParse(noSource).success, false);

  const wrongSource = structuredClone(validContent());
  wrongSource.collections[0].excerptSourceFieldId = galleryFieldId;
  assert.equal(ContentSchema.safeParse(wrongSource).success, false);
});

test('legacy text maps to structured text without changing line breaks or markup-like text', () => {
  const oldBody = 'Lead line\n\nSecond line with <script> text.\n';
  const document = migrateV1PlainTextToRichText(oldBody);
  assert.equal(richTextToPlainText(document), oldBody);
  assert.equal(document.blocks[0].type, 'paragraph');
  const migrated = structuredClone(validContent());
  const migratedItem = migrated.items[0] as unknown as { description: { source: string; value?: string }; values: Record<string, unknown> };
  migratedItem.description = { source: 'manual', value: 'Legacy summary' };
  migratedItem.values[richTextFieldId] = document;
  const parsed = ContentSchema.parse(migrated);
  assert.equal(collectionItemDescription(parsed.collections[0], parsed.items[0]), 'Legacy summary');
});
