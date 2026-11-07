import { z } from 'zod';

const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const RootPathSlugSchema = SlugSchema.refine(slug => !['api', 'admin', 'media'].includes(slug), 'این نشانی برای مسیرهای داخلی محفوظ است.');
const MediaSchema = z.object({
  src: z.string().regex(/^\/media\/[a-f0-9-]+\.webp$/),
  alt: z.string().max(500),
  title: z.string().max(500).optional(),
});
const ImagePlacementSchema = z.enum(['inline', 'wrap-start', 'wrap-end', 'block-start', 'block-center', 'block-end']);
const RichTextMediaSchema = MediaSchema.extend({ placement: ImagePlacementSchema.optional() });

const TextMarkSchema = z.enum(['bold', 'italic']);
const InlineNodeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(50000), marks: z.array(TextMarkSchema).max(2), size: z.enum(['small','normal','large']).optional() }),
  z.object({ type: z.literal('image'), media: RichTextMediaSchema }),
]);

const TextBlockSchema = z.object({
  type: z.enum(['paragraph', 'heading']),
  level: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  size: z.enum(['small', 'normal', 'large']),
  align: z.enum(['start', 'center', 'end']),
  // Content v1 allows up to 5,000 inline nodes in each text block. Keep that
  // accepted content representable during lossless legacy import.
  children: z.array(InlineNodeSchema).max(5000),
}).superRefine((block, ctx) => {
  if (block.type === 'heading' && block.level === undefined) {
    ctx.addIssue({ code: 'custom', path: ['level'], message: 'تیتر باید سطح مشخص داشته باشد.' });
  }
  if (block.type === 'paragraph' && block.level !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['level'], message: 'بند متن سطح تیتر نمی‌گیرد.' });
  }
});

const RichGalleryBlockSchema = z.object({
  type: z.literal('gallery'),
  images: z.array(MediaSchema).max(100),
});

export const RichTextDocumentSchema = z.object({
  type: z.literal('document'),
  blocks: z.array(z.discriminatedUnion('type', [TextBlockSchema, RichGalleryBlockSchema])).max(60_030),
}).superRefine((document, ctx) => {
  // Content v1 allows at most 30 text components (2,000 blocks and 1,000 inline images each)
  // and 30 galleries (100 images each). Keep valid source documents representable.
  let textLength = 0;
  let imageCount = 0;
  for (const [blockIndex, block] of document.blocks.entries()) {
    if (block.type === 'gallery') imageCount += block.images.length;
    else {
      for (const [nodeIndex, node] of block.children.entries()) {
        if (node.type === 'image') imageCount += 1;
        else textLength += node.text.length;
        if (node.type === 'text' && new Set(node.marks).size !== node.marks.length) {
          ctx.addIssue({ code: 'custom', path: ['blocks', blockIndex, 'children', nodeIndex, 'marks'], message: 'قالب نوشته تکراری است.' });
        }
      }
    }
  }
  if (textLength > 1500000) ctx.addIssue({ code: 'custom', path: ['blocks'], message: 'متن بیش از اندازه بزرگ است.' });
  if (imageCount > 33000) ctx.addIssue({ code: 'custom', path: ['blocks'], message: 'تعداد تصویرهای متن از حد مجاز بیشتر است.' });
});

const CollectionViewSchema = z.object({
  type: z.literal('collectionView'),
  collectionId: z.string().uuid(),
  view: z.enum(['grid', 'list', 'masonry']),
  categoryFieldId: z.string().uuid().optional(),
  categoryIds: z.array(z.string().uuid()).max(20).default([]),
  sort: z.enum(['manual', 'newest', 'title']).default('manual'),
  limit: z.number().int().min(1).max(100).default(12),
});

export const PageBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('richText'), document: RichTextDocumentSchema }),
  z.object({ type: z.literal('gallery'), images: z.array(MediaSchema).max(100), layout: z.enum(['grid', 'list', 'masonry']).default('grid') }),
  z.object({ type: z.literal('image'), media: MediaSchema.optional(), align: z.enum(['start', 'center', 'end']).optional(), size: z.enum(['small', 'medium', 'large']).optional() }),
  CollectionViewSchema,
]);

const DescriptionSchema = z.object({
  source: z.enum(['auto', 'manual']),
  value: z.string().max(1000).optional(),
}).superRefine((description, ctx) => {
  if (description.source === 'manual' && description.value === undefined) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'توضیح دستی باید مقدار داشته باشد.' });
  }
  if (description.source === 'auto' && description.value !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'توضیح خودکار از متن ساخته می‌شود و مقدار دستی نمی‌گیرد.' });
  }
});

export const PageSchema = z.object({
  id: z.string().uuid(),
  slug: RootPathSlugSchema,
  title: z.string().trim().min(1).max(200),
  published: z.boolean(),
  description: DescriptionSchema,
  blocks: z.array(PageBlockSchema).max(30),
});

const CollectionCategorySchema = z.object({
  id: z.string().uuid(),
  slug: SlugSchema,
  name: z.string().trim().min(1).max(80),
});

const BaseFieldSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(100),
});

export const CollectionFieldSchema = z.discriminatedUnion('type', [
  BaseFieldSchema.extend({ type: z.literal('text'), format: z.enum(['plain', 'rich']).default('plain') }),
  BaseFieldSchema.extend({ type: z.literal('category'), categories: z.array(CollectionCategorySchema).max(15000) }),
  BaseFieldSchema.extend({ type: z.literal('gallery'), maxItems: z.number().int().min(1).max(3000).default(20) }),
  BaseFieldSchema.extend({ type: z.literal('link') }),
]);

export const CollectionSchema = z.object({
  id: z.string().uuid(),
  slug: RootPathSlugSchema,
  name: z.string().trim().min(1).max(120),
  /** Defaults keep previously stored collections readable as text-first collections. */
  kind: z.enum(['gallery', 'content']).default('content'),
  listLayout: z.enum(['grid', 'list', 'masonry']).default('grid'),
  loading: z.enum(['pagination', 'show-more']).default('show-more'),
  pageSize: z.number().int().min(4).max(48).default(12),
  /** Optional starter configuration; it does not constrain the collection to a project/article domain type. */
  presetId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  /** Public detail route prefix, e.g. "portfolio" for the existing project URLs. */
  routeBase: RootPathSlugSchema,
  fields: z.array(CollectionFieldSchema).max(30),
  /** Starter presets select the text field that produces an automatic item excerpt. */
  excerptSourceFieldId: z.string().uuid().optional(),
}).superRefine((collection, ctx) => {
  if (collection.kind === 'content' && collection.listLayout === 'masonry') {
    ctx.addIssue({ code: 'custom', path: ['listLayout'], message: 'چیدمان آجری برای مجموعهٔ محتوایی پشتیبانی نمی‌شود.' });
  }
  if (collection.kind === 'gallery' && collection.listLayout === 'list') {
    ctx.addIssue({ code: 'custom', path: ['listLayout'], message: 'برای گالری تصویر، شبکه یا چیدمان آجری را انتخاب کنید.' });
  }
});

const LinkValueSchema = z.object({
  label: z.string().max(200),
  href: z.string().min(1).max(2000).refine(href => href === href.trim(), 'نشانی نباید فاصلهٔ اضافی در ابتدا یا انتها داشته باشد.').refine(href => {
    try {
      if (href.startsWith('/') && !href.startsWith('//') && !href.includes('\\')) return true;
      return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(href).protocol);
    }
    catch { return false; }
  }, 'پیوند باید داخلی یا از نوع HTTP، HTTPS، ایمیل یا تلفن باشد.'),
});
const ItemBaseSchema = z.object({
  id: z.string().uuid(),
  collectionId: z.string().uuid(),
  slug: SlugSchema,
  published: z.boolean(),
  title: z.string().trim().max(200).optional(),
  coverImage: MediaSchema.optional(),
  description: DescriptionSchema,
  /** Values are keyed by stable field ID and checked against that field's definition in ContentSchema. */
  values: z.record(z.string().uuid(), z.unknown()),
});

export const CollectionItemSchema = ItemBaseSchema;

export const ContentSchema = z.object({
  version: z.literal(2),
  site: z.object({
    name: z.string().trim().min(1).max(200),
    tagline: z.string().max(500),
    email: z.union([z.email(), z.literal('')]),
    phone: z.string().max(80),
    language: z.string().min(2).max(35).default('en'),
    direction: z.enum(['ltr', 'rtl']).default('ltr'),
  }),
  pages: z.array(PageSchema).max(500),
  collections: z.array(CollectionSchema).max(100),
  items: z.array(ItemBaseSchema).max(500),
}).superRefine((content, ctx) => {
  if (content.pages.length + content.items.length > 500) {
    ctx.addIssue({ code: 'custom', path: ['items'], message: 'تعداد کل صفحه‌ها و موارد مجموعه از حد نسخهٔ نخست بیشتر است.' });
  }
  const ids = new Set<string>();
  const paths = new Set<string>();
  const collectionById = new Map(content.collections.map(collection => [collection.id, collection]));
  const addUnique = (key: string, path: (string | number)[]) => {
    if (ids.has(key)) ctx.addIssue({ code: 'custom', path, message: 'شناسه تکراری است.' });
    ids.add(key);
  };
  const addPath = (path: string, errorPath: (string | number)[]) => {
    if (paths.has(path)) ctx.addIssue({ code: 'custom', path: errorPath, message: 'این نشانی از قبل استفاده شده است.' });
    paths.add(path);
  };

  content.pages.forEach((page, index) => {
    addUnique(page.id, ['pages', index, 'id']);
    addPath(`/${page.slug}/`, ['pages', index, 'slug']);
  });
  content.collections.forEach((collection, index) => {
    addUnique(collection.id, ['collections', index, 'id']);
    addPath(`/${collection.slug}/`, ['collections', index, 'slug']);
    // Field IDs are unique within a collection; item values are scoped by collectionId.
    const fieldIds = new Set<string>();
    collection.fields.forEach((field, fieldIndex) => {
      if (fieldIds.has(field.id)) {
        ctx.addIssue({ code: 'custom', path: ['collections', index, 'fields', fieldIndex, 'id'], message: 'شناسهٔ فیلد در این مجموعه تکراری است.' });
      }
      fieldIds.add(field.id);
      if (field.type === 'category') {
        const categoryIds = new Set<string>();
        const categorySlugs = new Set<string>();
        field.categories.forEach((category, categoryIndex) => {
          if (categoryIds.has(category.id) || categorySlugs.has(category.slug)) {
            ctx.addIssue({ code: 'custom', path: ['collections', index, 'fields', fieldIndex, 'categories', categoryIndex], message: 'دستهٔ تکراری است.' });
          }
          categoryIds.add(category.id);
          categorySlugs.add(category.slug);
        });
      }
    });
    if (collection.excerptSourceFieldId && !collection.fields.some(field => field.id === collection.excerptSourceFieldId && field.type === 'text')) {
      ctx.addIssue({ code: 'custom', path: ['collections', index, 'excerptSourceFieldId'], message: 'فیلد سازندهٔ توضیح خودکار باید از نوع متن باشد.' });
    }
  });
  content.items.forEach((item, index) => {
    addUnique(item.id, ['items', index, 'id']);
    const collection = collectionById.get(item.collectionId);
    if (!collection) {
      ctx.addIssue({ code: 'custom', path: ['items', index, 'collectionId'], message: 'مجموعهٔ این مورد پیدا نشد.' });
      return;
    }
    if (collection.kind === 'content' && !item.title?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['items', index, 'title'], message: 'عنوان این مورد را وارد کنید.' });
    }
    if (collection.kind === 'gallery' && item.published) {
      const imageField = collection.fields.find((field): field is Extract<z.infer<typeof CollectionFieldSchema>, { type: 'gallery' }> => field.type === 'gallery');
      const images = imageField ? item.values[imageField.id] : undefined;
      if (!Array.isArray(images) || images.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'values', imageField?.id ?? ''], message: 'برای انتشار تصویر، ابتدا عکس را اضافه کنید.' });
      }
    }
    if (item.description.source === 'auto' && !collection.excerptSourceFieldId) {
      ctx.addIssue({ code: 'custom', path: ['items', index, 'description', 'source'], message: 'برای توضیح خودکار، فیلد متن مبنا باید در مجموعه مشخص شود.' });
    }
    addPath(`/${collection.routeBase}/${item.slug}/`, ['items', index, 'slug']);

    const definitions = new Map(collection.fields.map(field => [field.id, field]));
    for (const [fieldId, value] of Object.entries(item.values)) {
      const field = definitions.get(fieldId);
      const path = ['items', index, 'values', fieldId];
      if (!field) {
        ctx.addIssue({ code: 'custom', path, message: 'این فیلد در تعریف مجموعه وجود ندارد.' });
        continue;
      }
      const parsed = field.type === 'text'
        ? (field.format === 'rich' ? RichTextDocumentSchema.safeParse(value) : z.string().max(50000).safeParse(value))
        : field.type === 'category'
          ? z.array(z.string().uuid()).max(500).safeParse(value)
          : field.type === 'gallery'
            ? z.array(MediaSchema).max(field.maxItems).safeParse(value)
            : LinkValueSchema.safeParse(value);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', path, message: `مقدار فیلد «${field.label}» با نوع آن سازگار نیست.` });
      } else if (field.type === 'category') {
        const allowedIds = new Set(field.categories.map(category => category.id));
        if ((parsed.data as string[]).some(categoryId => !allowedIds.has(categoryId))) {
          ctx.addIssue({ code: 'custom', path, message: `دسته‌ای در فیلد «${field.label}» تعریف نشده است.` });
        }
      }
    }
  });
  content.pages.forEach((page, pageIndex) => page.blocks.forEach((block, blockIndex) => {
    if (block.type === 'collectionView') {
      const collection = collectionById.get(block.collectionId);
      if (!collection) ctx.addIssue({ code: 'custom', path: ['pages', pageIndex, 'blocks', blockIndex, 'collectionId'], message: 'مجموعهٔ این بخش پیدا نشد.' });
      else if (block.categoryIds.length || block.categoryFieldId) {
        const field = collection.fields.find(candidate => candidate.id === block.categoryFieldId);
        if (!field || field.type !== 'category') {
          ctx.addIssue({ code: 'custom', path: ['pages', pageIndex, 'blocks', blockIndex, 'categoryFieldId'], message: 'فیلتر باید به یک فیلد دسته‌بندی از همان مجموعه وصل باشد.' });
        } else {
          const allowedIds = new Set(field.categories.map(category => category.id));
          if (block.categoryIds.some(id => !allowedIds.has(id))) ctx.addIssue({ code: 'custom', path: ['pages', pageIndex, 'blocks', blockIndex, 'categoryIds'], message: 'فیلتر شامل دسته‌ای بیرون از فیلد انتخاب‌شده است.' });
        }
      }
    }
  }));
});

export type RichTextDocument = z.infer<typeof RichTextDocumentSchema>;
export type PageBlock = z.infer<typeof PageBlockSchema>;
export type Page = z.infer<typeof PageSchema>;
export type CollectionField = z.infer<typeof CollectionFieldSchema>;
export type Collection = z.infer<typeof CollectionSchema>;
export type CollectionItem = z.infer<typeof CollectionItemSchema>;
export type Content = z.infer<typeof ContentSchema>;

export function richTextToPlainText(document: RichTextDocument): string {
  return document.blocks.map(block => block.type === 'gallery' ? '' : block.children.map(node => node.type === 'text' ? node.text : '').join('')).join('\n\n');
}

function safeExcerpt(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  const codePoints = Array.from(normalized);
  if (codePoints.length <= 1000) return normalized;
  let prefix = codePoints.slice(0, 999).join('');
  const wordBoundary = prefix.lastIndexOf(' ');
  if (wordBoundary >= 800) prefix = prefix.slice(0, wordBoundary).trimEnd();
  return `${prefix}…`;
}

export function descriptionForDisplay(description: z.infer<typeof DescriptionSchema>, document: RichTextDocument | undefined): string {
  if (description.source === 'manual') return description.value ?? '';
  return safeExcerpt(document ? richTextToPlainText(document) : '');
}

export function collectionItemDescription(collection: Collection, item: CollectionItem): string {
  if (item.description.source === 'manual') return item.description.value ?? '';
  const field = collection.fields.find(candidate => candidate.id === collection.excerptSourceFieldId);
  const value = collection.excerptSourceFieldId ? item.values[collection.excerptSourceFieldId] : undefined;
  const parsedDocument = field?.type === 'text' && field.format === 'rich' ? RichTextDocumentSchema.safeParse(value) : undefined;
  const text = parsedDocument?.success
    ? richTextToPlainText(parsedDocument.data)
    : field?.type === 'text' && field.format === 'plain' && typeof value === 'string' ? value : '';
  return safeExcerpt(text);
}

export function migrateV1PlainTextToRichText(body: string): RichTextDocument {
  return {
    type: 'document',
    blocks: body ? [{
      type: 'paragraph' as const,
      size: 'normal' as const,
      align: 'start' as const,
      children: [{ type: 'text' as const, text: body, marks: [] as ('bold' | 'italic')[] }],
    }] : [],
  };
}
