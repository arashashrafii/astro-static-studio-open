import {
  CollectionItemSchema,
  CollectionSchema,
  ContentSchema,
  PageSchema,
  RichTextDocumentSchema,
  type Content,
} from '@astro-static-studio/contracts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEditableDraftShape(value: unknown): value is Content {
  if (!isRecord(value) || value.version !== 2 || !isRecord(value.site)) return false;
  if (!Array.isArray(value.pages) || !Array.isArray(value.collections) || !Array.isArray(value.items)) return false;
  if (!value.pages.every(page => PageSchema.safeParse(page).success)) return false;
  if (!value.collections.every(collection => CollectionSchema.safeParse(collection).success)) return false;
  if (!value.items.every(item => CollectionItemSchema.safeParse(item).success)) return false;

  const collectionById = new Map(value.collections.map(collection => [
    (collection as { id: string }).id,
    collection as { fields: Array<{ id: string; type: string; format?: string }> },
  ]));
  for (const itemValue of value.items) {
    if (!isRecord(itemValue) || !isRecord(itemValue.values)) return false;
    const collection = collectionById.get(itemValue.collectionId as string);
    if (!collection) return false;
    for (const field of collection.fields) {
      const fieldValue = itemValue.values[field.id];
      if (fieldValue === undefined) continue;
      if (field.type === 'gallery' || field.type === 'category') {
        if (!Array.isArray(fieldValue)) return false;
        if (field.type === 'gallery' && !fieldValue.every(image => isRecord(image) && typeof image.src === 'string' && typeof image.alt === 'string')) return false;
        if (field.type === 'category' && !fieldValue.every(id => typeof id === 'string')) return false;
      } else if (field.type === 'text' && field.format === 'rich') {
        if (!RichTextDocumentSchema.safeParse(fieldValue).success) return false;
      } else if (field.type === 'text' && typeof fieldValue !== 'string') return false;
      else if (field.type === 'link' && (!isRecord(fieldValue) || typeof fieldValue.label !== 'string' || typeof fieldValue.href !== 'string')) return false;
    }
  }

  const checked = ContentSchema.safeParse(value);
  return !checked.success && checked.error.issues.every(issue =>
    issue.path[0] === 'items' && ['title', 'description', 'values'].includes(String(issue.path[2])));
}

/** Load well-formed drafts even when editable fields fail business validation. */
export function readContentDraft(raw: string | null, fallback: Content): Content {
  if (!raw) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    const parsed = ContentSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    return isEditableDraftShape(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
