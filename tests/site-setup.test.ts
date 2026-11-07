import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getSetupState, initializeSite } from '../apps/api/src/site-setup.js';

test('new-site setup creates an empty site once and preserves existing files from silent replacement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-setup-'));
  const setupFile = join(directory, 'content', '.studio-site.json');
  const contentFile = join(directory, 'content', 'content.json');
  const original = JSON.stringify({ existing: 'sample' });
  await mkdir(join(directory, 'content'), { recursive: true });
  await writeFile(contentFile, original);
  const save = async (content: unknown) => writeFile(contentFile, JSON.stringify(content));

  try {
    assert.deepEqual(await getSetupState(setupFile), { initialized: false });
    const content = await initializeSite('new-site', 'My Studio Site', { setupFile, contentFile, save });
    assert.equal(content.site.name, 'My Studio Site');
    assert.equal(content.version, 2);
    assert.deepEqual(content.pages, []);
    assert.deepEqual(content.collections, []);
    assert.deepEqual(content.items, []);
    assert.deepEqual(await getSetupState(setupFile), { initialized: true, mode: 'new-site' });
    await assert.rejects(initializeSite('new-site', 'Second Site', { setupFile, contentFile, save }), /قبلاً/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('sample choice keeps the bundled content and invalid new-site names do not initialize', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-setup-'));
  const setupFile = join(directory, 'content', '.studio-site.json');
  const contentFile = join(directory, 'content', 'content.json');
  const original = JSON.stringify({ version: 1, site: { name: 'Sample', tagline: '', email: 'sample@example.com', phone: '' }, entries: [] });
  await mkdir(join(directory, 'content'), { recursive: true });
  await writeFile(contentFile, original);
  try {
    await assert.rejects(initializeSite('new-site', '  ', { setupFile, contentFile }), /نام سایت/);
    assert.deepEqual(await getSetupState(setupFile), { initialized: false });
    const sample = await initializeSite('sample', '', { setupFile, contentFile });
    assert.equal(sample.version, 2);
    assert.equal(await readFile(contentFile, 'utf8'), original);
    assert.deepEqual(await getSetupState(setupFile), { initialized: true, mode: 'sample' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
