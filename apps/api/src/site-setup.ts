import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { ContentSchema, type Content } from '@astro-static-studio/contracts';
import { importContent } from '@astro-static-studio/contracts/migration';
import { contentPath, root, saveContent } from './store.js';

export const setupPath = resolve(root, 'content/.studio-site.json');

export type SetupMode = 'sample' | 'new-site';

export async function getSetupState(path = setupPath): Promise<{ initialized: boolean; mode?: SetupMode }> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { mode?: unknown };
    return { initialized: true, mode: value.mode === 'new-site' ? 'new-site' : 'sample' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { initialized: false };
    throw error;
  }
}

export async function initializeSite(
  mode: SetupMode,
  siteName: string,
  options: { setupFile?: string; contentFile?: string; save?: (content: Content) => Promise<unknown> } = {},
): Promise<Content> {
  const setupFile = options.setupFile ?? setupPath;
  const contentFile = options.contentFile ?? contentPath;
  if ((await getSetupState(setupFile)).initialized) throw new Error('تنظیم اولیه قبلاً انجام شده است.');

  let content: Content;
  if (mode === 'new-site') {
    const name = siteName.trim();
    if (!name || name.length > 200) throw new Error('نام سایت را وارد کنید (حداکثر ۲۰۰ نویسه).');
    content = ContentSchema.parse({
      version: 2,
      site: { name, tagline: '', email: '', phone: '' },
      pages: [], collections: [], items: [],
    });
    await mkdir(dirname(contentFile), { recursive: true });
    await (options.save ?? saveContent)(content);
  } else {
    content = importContent(JSON.parse(await readFile(contentFile, 'utf8')));
  }

  await mkdir(dirname(setupFile), { recursive: true });
  const temporaryPath = `${setupFile}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify({ mode, initializedAt: new Date().toISOString() }), { flag: 'w' });
  await rename(temporaryPath, setupFile);
  return content;
}
