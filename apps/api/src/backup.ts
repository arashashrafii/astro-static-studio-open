import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { ContentSchema, type Content, LegacyContentV1Schema, type LegacyContentV1 } from '@astro-static-studio/contracts';

const FORMAT = 'astro-static-studio-backup';
const VERSION = 1;
const MAX_MEDIA_FILES = 1_000;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 120 * 1024 * 1024;
const MEDIA_SRC = /^\/media\/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/;
const SHA256 = /^[0-9a-f]{64}$/;

export interface BackupPaths {
  contentPath: string;
  mediaDirectory: string;
  /** Optional directory containing source JPEG/PNG files named with their managed media UUID. */
  originalsDirectory?: string;
  /** Parent for short-lived staging folders. Defaults to the system temp directory. */
  tempDirectory?: string;
}

interface BackupMedia {
  src: string;
  size: number;
  sha256: string;
  data: string;
  original?: BackupOriginal;
}

interface BackupOriginal {
  name: string;
  size: number;
  sha256: string;
  data: string;
}

interface BackupDocument {
  format: typeof FORMAT;
  version: typeof VERSION;
  content: Content | LegacyContentV1;
  media: BackupMedia[];
}

export interface RestoreResult {
  mediaAdded: number;
  mediaAlreadyPresent: number;
  originalsAdded: number;
  originalsAlreadyPresent: number;
}

function referencedMedia(content: Content | LegacyContentV1): string[] {
  const refs = new Set<string>();
  const add = (image: {src:string}) => {
    if (!MEDIA_SRC.test(image.src)) throw new Error(`Unsupported managed media path: ${image.src}`);
    refs.add(image.src);
  };
  if (content.version === 1) {
    for (const entry of content.entries) {
      for (const component of entry.components) {
        if (component.type === 'gallery') component.images.forEach(add);
        else if (component.richText) {
          for (const block of component.richText.blocks) for (const node of block.content) if (node.type === 'image') add(node);
        }
      }
    }
  } else {
    const collectionById = new Map(content.collections.map(collection=>[collection.id,collection]));
    for (const page of content.pages) for (const block of page.blocks) {
      if (block.type === 'gallery') block.images.forEach(add);
      else if (block.type === 'richText') for (const richBlock of block.document.blocks) {
        if (richBlock.type === 'gallery') richBlock.images.forEach(add);
        else for (const node of richBlock.children) if (node.type === 'image') add(node.media);
      }
    }
    for (const item of content.items) {
      if (item.coverImage) add(item.coverImage);
      const collection = collectionById.get(item.collectionId);
      if (!collection) continue;
      for (const field of collection.fields) {
        const value = item.values[field.id];
        if (field.type === 'gallery' && Array.isArray(value)) value.forEach(add);
        if (field.type === 'text' && field.format === 'rich' && value && typeof value === 'object') {
          const document = value as Content['items'][number]['values'][string] & {blocks?:unknown[]};
          if (Array.isArray(document.blocks)) for (const richBlock of document.blocks as Array<Record<string,unknown>>) {
            if (richBlock.type === 'gallery' && Array.isArray(richBlock.images)) richBlock.images.forEach(add);
            else if (Array.isArray(richBlock.children)) for (const node of richBlock.children as Array<Record<string,unknown>>) {
              if (node.type === 'image' && node.media && typeof node.media === 'object') add(node.media as {src:string});
            }
          }
        }
      }
    }
  }
  const paths = [...refs].sort();
  if (paths.length > MAX_MEDIA_FILES) throw new Error(`Backup exceeds the ${MAX_MEDIA_FILES} media file limit`);
  return paths;
}

async function readRegularFile(path: string): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error(`Expected a regular file: ${path}`);
  return readFile(path);
}

async function validateImage(bytes: Buffer, expectedFormat: 'webp' | 'jpeg' | 'png', label: string): Promise<void> {
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000 });
    const meta = await image.metadata();
    if (meta.format !== expectedFormat) throw new Error(`expected ${expectedFormat}`);
    await sharp(bytes, { limitInputPixels: 40_000_000 }).raw().toBuffer();
  } catch {
    throw new Error(`Invalid ${expectedFormat} media: ${label}`);
  }
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Create a portable UTF-8 JSON backup containing content and its referenced WebP files. */
export async function exportBackup(paths: BackupPaths, contentOverride?: unknown): Promise<Buffer> {
  const rawContent=(contentOverride===undefined?JSON.parse(await readFile(paths.contentPath,'utf8')):contentOverride) as {version?:unknown};
  const content=rawContent?.version===1?LegacyContentV1Schema.parse(rawContent):rawContent?.version===2?ContentSchema.parse(rawContent):(()=>{throw new Error(`Unsupported content version: ${String(rawContent?.version)}`)})();
  const media: BackupMedia[] = [];
  let totalMediaBytes = 0;

  for (const src of referencedMedia(content)) {
    const match = MEDIA_SRC.exec(src)!;
    const bytes = await readRegularFile(resolve(paths.mediaDirectory, `${match[1]}.webp`));
    if (bytes.byteLength > MAX_MEDIA_BYTES) throw new Error(`Media exceeds the ${MAX_MEDIA_BYTES} byte limit: ${src}`);
    totalMediaBytes += bytes.byteLength;
    if (totalMediaBytes > MAX_BUNDLE_BYTES) throw new Error(`Backup exceeds the ${MAX_BUNDLE_BYTES} byte media limit`);
    await validateImage(bytes, 'webp', src);
    const item: BackupMedia = { src, size: bytes.byteLength, sha256: digest(bytes), data: bytes.toString('base64') };
    if (paths.originalsDirectory) {
      const id = match[1];
      for (const extension of ['jpg', 'jpeg', 'png'] as const) {
        const originalPath = resolve(paths.originalsDirectory, `${id}.${extension}`);
        try {
          const original = await readRegularFile(originalPath);
          if (original.byteLength > MAX_MEDIA_BYTES) throw new Error(`Original exceeds the ${MAX_MEDIA_BYTES} byte limit: ${id}.${extension}`);
          totalMediaBytes += original.byteLength;
          if (totalMediaBytes > MAX_BUNDLE_BYTES) throw new Error(`Backup exceeds the ${MAX_BUNDLE_BYTES} byte media limit`);
          const expectedFormat = extension === 'png' ? 'png' : 'jpeg';
          await validateImage(original, expectedFormat, `${id}.${extension}`);
          item.original = { name: `${id}.${extension}`, size: original.byteLength, sha256: digest(original), data: original.toString('base64') };
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    media.push(item);
  }

  const output = Buffer.from(JSON.stringify({ format: FORMAT, version: VERSION, content, media } satisfies BackupDocument));
  if (output.byteLength > MAX_BUNDLE_BYTES) throw new Error(`Backup exceeds the ${MAX_BUNDLE_BYTES} byte limit`);
  return output;
}

function parseBackup(input: Buffer | string): BackupDocument {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (bytes.byteLength > MAX_BUNDLE_BYTES) throw new Error(`Backup exceeds the ${MAX_BUNDLE_BYTES} byte limit`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Backup is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid backup document');
  const doc = parsed as Record<string, unknown>;
  if (doc.format !== FORMAT || doc.version !== VERSION) throw new Error('Unsupported backup format or version');
  const rawContent=doc.content as {version?:unknown};
  const content=rawContent?.version===1?LegacyContentV1Schema.parse(rawContent):rawContent?.version===2?ContentSchema.parse(rawContent):(()=>{throw new Error(`Unsupported content version: ${String(rawContent?.version)}`)})();
  if (!Array.isArray(doc.media) || doc.media.length > MAX_MEDIA_FILES) throw new Error('Invalid backup media list');
  const expected = referencedMedia(content);
  if (doc.media.length !== expected.length) throw new Error('Backup media does not match content references');

  const seen = new Set<string>();
  for (const raw of doc.media) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid backup media entry');
    const item = raw as Record<string, unknown>;
    if (typeof item.src !== 'string' || !MEDIA_SRC.test(item.src) || seen.has(item.src)) throw new Error('Invalid or duplicate media path in backup');
    if (typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > MAX_MEDIA_BYTES) throw new Error(`Invalid media size: ${item.src}`);
    if (typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)) throw new Error(`Invalid media hash: ${item.src}`);
    if (typeof item.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data)) throw new Error(`Invalid base64 media data: ${item.src}`);
    const decoded = Buffer.from(item.data, 'base64');
    if (decoded.toString('base64') !== item.data || decoded.byteLength !== item.size || digest(decoded) !== item.sha256) throw new Error(`Media size or checksum mismatch: ${item.src}`);
    if (item.original !== undefined) {
      if (!item.original || typeof item.original !== 'object' || Array.isArray(item.original)) throw new Error(`Invalid original image entry: ${item.src}`);
      const original = item.original as Record<string, unknown>;
      const id = MEDIA_SRC.exec(item.src)![1];
      if (typeof original.name !== 'string' || !new RegExp(`^${id}\\.(?:jpg|jpeg|png)$`).test(original.name)) throw new Error(`Invalid original image name: ${item.src}`);
      if (typeof original.size !== 'number' || !Number.isSafeInteger(original.size) || original.size < 1 || original.size > MAX_MEDIA_BYTES) throw new Error(`Invalid original image size: ${item.src}`);
      if (typeof original.sha256 !== 'string' || !SHA256.test(original.sha256)) throw new Error(`Invalid original image hash: ${item.src}`);
      if (typeof original.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(original.data)) throw new Error(`Invalid original image data: ${item.src}`);
      const originalBytes = Buffer.from(original.data, 'base64');
      if (originalBytes.toString('base64') !== original.data || originalBytes.byteLength !== original.size || digest(originalBytes) !== original.sha256) throw new Error(`Original image size or checksum mismatch: ${item.src}`);
    }
    seen.add(item.src);
  }
  if (expected.some(src => !seen.has(src))) throw new Error('Backup is missing referenced media');
  return { format: FORMAT, version: VERSION, content, media: doc.media as BackupMedia[] };
}

/** Validate and stage a backup, add media without replacement, then atomically replace content. */
export async function restoreBackup(input: Buffer | string, paths: BackupPaths): Promise<RestoreResult> {
  const backup = parseBackup(input);
  if (backup.media.some(item => item.original) && !paths.originalsDirectory) throw new Error('An originals directory is required to restore this backup');
  const staging = await mkdtemp(join(paths.tempDirectory ?? tmpdir(), 'astro-studio-restore-'));
  const stagedContent = join(staging, 'content.json');
  const stagedMedia = join(staging, 'media');
  const stagedOriginals = join(staging, 'originals');
  const contentTemp = join(dirname(paths.contentPath), `.content-${randomUUID()}.tmp`);
  const installed: string[] = [];
  let mediaAdded = 0;
  let mediaAlreadyPresent = 0;
  let originalsAdded = 0;
  let originalsAlreadyPresent = 0;

  try {
    await mkdir(stagedMedia);
    await mkdir(stagedOriginals);
    await writeFile(stagedContent, JSON.stringify(backup.content, null, 2), { flag: 'wx' });
    for (const item of backup.media) {
      const match = MEDIA_SRC.exec(item.src)!;
      const bytes = Buffer.from(item.data, 'base64');
      await validateImage(bytes, 'webp', item.src);
      await writeFile(join(stagedMedia, `${match[1]}.webp`), bytes, { flag: 'wx' });
      if (item.original) {
        const originalBytes = Buffer.from(item.original.data, 'base64');
        const expectedFormat = item.original.name.endsWith('.png') ? 'png' : 'jpeg';
        await validateImage(originalBytes, expectedFormat, item.original.name);
        await writeFile(join(stagedOriginals, item.original.name), originalBytes, { flag: 'wx' });
      }
    }

    await mkdir(paths.mediaDirectory, { recursive: true });
    for (const item of backup.media) {
      const match = MEDIA_SRC.exec(item.src)!;
      const destination = resolve(paths.mediaDirectory, `${match[1]}.webp`);
      try {
        const existing = await readRegularFile(destination);
        if (digest(existing) !== item.sha256) throw new Error(`Media already exists with different contents: ${item.src}`);
        mediaAlreadyPresent++;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        try {
          await copyFile(join(stagedMedia, `${match[1]}.webp`), destination, 1);
          installed.push(destination);
          mediaAdded++;
        } catch (copyError) {
          if ((copyError as NodeJS.ErrnoException).code !== 'EEXIST') throw copyError;
          const raced = await readRegularFile(destination);
          if (digest(raced) !== item.sha256) throw new Error(`Media already exists with different contents: ${item.src}`);
          mediaAlreadyPresent++;
        }
      }
      if (item.original && paths.originalsDirectory) {
        const destination = resolve(paths.originalsDirectory, item.original.name);
        try {
          const existing = await readRegularFile(destination);
          if (digest(existing) !== item.original.sha256) throw new Error(`Original already exists with different contents: ${item.original.name}`);
          originalsAlreadyPresent++;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          await mkdir(paths.originalsDirectory, { recursive: true });
          try {
            await copyFile(join(stagedOriginals, item.original.name), destination, 1);
            installed.push(destination);
            originalsAdded++;
          } catch (copyError) {
            if ((copyError as NodeJS.ErrnoException).code !== 'EEXIST') throw copyError;
            const raced = await readRegularFile(destination);
            if (digest(raced) !== item.original.sha256) throw new Error(`Original already exists with different contents: ${item.original.name}`);
            originalsAlreadyPresent++;
          }
        }
      }
    }

    await writeFile(contentTemp, await readFile(stagedContent), { flag: 'wx' });
    await rename(contentTemp, paths.contentPath);
    return { mediaAdded, mediaAlreadyPresent, originalsAdded, originalsAlreadyPresent };
  } catch (error) {
    await Promise.all(installed.map(path => rm(path, { force: true })));
    await rm(contentTemp, { force: true });
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
