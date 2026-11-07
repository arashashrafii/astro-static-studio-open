export {
  CollectionFieldSchema,
  CollectionItemSchema,
  CollectionSchema,
  ContentSchema,
  PageBlockSchema,
  PageSchema,
  RichTextDocumentSchema,
  collectionItemDescription,
  descriptionForDisplay,
  migrateV1PlainTextToRichText,
  richTextToPlainText,
  type Collection,
  type CollectionField,
  type CollectionItem,
  type Content,
  type Page,
  type PageBlock,
  type RichTextDocument,
} from './content.js';

export {
  ComponentSchema as LegacyComponentV1Schema,
  ContentSchema as LegacyContentV1Schema,
  EntrySchema as LegacyEntryV1Schema,
  MediaSchema as LegacyMediaV1Schema,
  RichTextSchema as LegacyRichTextV1Schema,
  entryExcerpt as legacyEntryExcerpt,
  entryExcerptFromContent as legacyEntryExcerptFromContent,
  richTextToPlainText as legacyRichTextToPlainText,
  type Component as LegacyComponentV1,
  type Content as LegacyContentV1,
  type Entry as LegacyEntryV1,
  type RichText as LegacyRichTextV1,
} from './legacy-v1.js';

export interface ThemeInterface {
  id: string;
  name: string;
  version: string;
  components: readonly ('richText' | 'gallery' | 'image' | 'collectionView')[];
  tokens: { background: string; foreground: string; accent: string };
}

export interface PublishResult { outputDirectory: string; builtAt: string; }
export interface PublisherInterface { id: string; publish(): Promise<PublishResult>; }
