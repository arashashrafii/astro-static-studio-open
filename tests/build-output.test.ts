import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildAndPromote } from '../apps/api/src/build-output.ts';

test('failed build preserves previous output and removes staging files', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'astro-studio-build-'));
  const output = join(parent, 'dist');
  await mkdir(output);
  await writeFile(join(output, 'index.html'), 'previous site');

  try {
    await assert.rejects(buildAndPromote(output, async (staging) => {
      await mkdir(staging);
      await writeFile(join(staging, 'index.html'), 'partial site');
      throw new Error('simulated Astro build failure');
    }), /simulated Astro build failure/);

    assert.equal(await readFile(join(output, 'index.html'), 'utf8'), 'previous site');
    assert.deepEqual(await readdir(parent), ['dist']);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('successful build replaces output only after staging is ready', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'astro-studio-build-'));
  const output = join(parent, 'dist');
  await mkdir(output);
  await writeFile(join(output, 'index.html'), 'previous site');

  try {
    await buildAndPromote(output, async (staging) => {
      await mkdir(staging);
      await writeFile(join(staging, 'index.html'), 'new site');
    });

    assert.equal(await readFile(join(output, 'index.html'), 'utf8'), 'new site');
    assert.deepEqual(await readdir(parent), ['dist']);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
