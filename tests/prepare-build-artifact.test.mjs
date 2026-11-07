import assert from 'node:assert/strict';
import { mkdtemp, mkdir, open, readFile, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ASSET_IDENTITY,
  MANIFEST_RELATIVE_PATH,
  createArtifactName,
  inspectStaticOutput,
  prepareBuildArtifact,
  validateRevision,
  verifyCheckoutRevision,
} from '../scripts/prepare-build-artifact.mjs';
import { pagesAssetHash } from '../apps/api/src/publishing.ts';
import { createHash } from 'node:crypto';

const sha = 'a'.repeat(40);
const workflowSha = 'b'.repeat(40);

async function temporaryDirectory(t) {
  const root = await mkdtemp(join(process.env.STUDIO_TEST_TMPDIR ?? tmpdir(), 'studio-build-artifact-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('revision checks require a full lowercase SHA and exact checkout match', () => {
  assert.equal(validateRevision(sha), sha);
  assert.equal(verifyCheckoutRevision(sha, `${sha}\n`), sha);
  assert.throws(() => validateRevision('main'), /lowercase 40-character/);
  assert.throws(() => validateRevision(sha.toUpperCase()), /lowercase 40-character/);
  assert.throws(() => verifyCheckoutRevision(sha, 'b'.repeat(40)), /does not match/);
});

test('artifact name binds the approved revision and workflow run attempt', () => {
  assert.equal(createArtifactName(sha, '9001', 2), `studio-static-build-${sha}-9001-2`);
  assert.throws(() => createArtifactName('main', '9001', 2), /lowercase 40-character/);
  assert.throws(() => createArtifactName(sha, 'run', 2), /Workflow run ID/);
  assert.throws(() => createArtifactName(sha, '9001', 0), /run attempt/);
});

test('static output accepts a root index and returns its file count', async (t) => {
  const root = await temporaryDirectory(t);
  await mkdir(join(root, 'site'));
  await writeFile(join(root, 'site', 'index.html'), '<!doctype html>');
  await mkdir(join(root, 'site', 'about'));
  await writeFile(join(root, 'site', 'about', 'index.html'), '<h1>About</h1>');

  assert.deepEqual(await inspectStaticOutput(join(root, 'site')), { fileCount: 2 });
  assert.equal(await readFile(join(root, 'site', 'index.html'), 'utf8'), '<!doctype html>');
});

test('static output rejects missing entry point, oversized assets, and symlinks', async (t) => {
  const root = await temporaryDirectory(t);
  const missingIndex = join(root, 'missing');
  await mkdir(missingIndex);
  await writeFile(join(missingIndex, 'about.html'), 'ok');
  await assert.rejects(inspectStaticOutput(missingIndex), /root index.html/);

  const large = join(root, 'large');
  await mkdir(large);
  await writeFile(join(large, 'index.html'), 'ok');
  const largeFile = await open(join(large, 'large.bin'), 'w');
  await largeFile.truncate(25 * 1024 * 1024 + 1);
  await largeFile.close();
  await assert.rejects(inspectStaticOutput(large), /exceeds 25 MiB/);

  const linked = join(root, 'linked');
  await mkdir(linked);
  await writeFile(join(linked, 'index.html'), 'ok');
  await symlink(join(linked, 'index.html'), join(linked, 'alias.html'));
  await assert.rejects(inspectStaticOutput(linked), /symbolic link/);
});

test('artifact preparation emits the exact build-generated hash manifest and preserves all site files', async (t) => {
  const root = await temporaryDirectory(t);
  const site = join(root, 'site');
  await mkdir(join(site, 'assets'), { recursive: true });
  const index = Buffer.from('<!doctype html>');
  const app = Buffer.from('export const ready=true;');
  await writeFile(join(site, 'index.html'), index);
  await writeFile(join(site, 'assets', 'app.js'), app);

  const result = await prepareBuildArtifact(sha, workflowSha, site);
  const generated = JSON.parse(await readFile(join(site, MANIFEST_RELATIVE_PATH), 'utf8'));
  assert.deepEqual(generated, {
    schemaVersion: 2,
    assetIdentity: ASSET_IDENTITY,
    sourceRevision: sha,
    workflowRevision: workflowSha,
    assets: {
      'assets/app.js': { pagesHash: pagesAssetHash(app, 'assets/app.js'), sha256: createHash('sha256').update(app).digest('hex') },
      'index.html': { pagesHash: pagesAssetHash(index, 'index.html'), sha256: createHash('sha256').update(index).digest('hex') },
    },
  });
  assert.equal(result.fileCount, 2);
  assert.equal(await readFile(join(site, 'index.html'), 'utf8'), index.toString());
});

test('artifact preparation refuses to overwrite the reserved path or include reserved/control files', async (t) => {
  const root = await temporaryDirectory(t);
  const collision = join(root, 'collision');
  await mkdir(join(collision, '__astro_static_studio'), { recursive: true });
  await writeFile(join(collision, 'index.html'), 'ok');
  const reserved = join(collision, MANIFEST_RELATIVE_PATH);
  await writeFile(reserved, 'keep-me');
  await assert.rejects(prepareBuildArtifact(sha, workflowSha, collision), /already contains the reserved path/);
  assert.equal(await readFile(reserved, 'utf8'), 'keep-me');

  const control = join(root, 'control');
  await mkdir(control);
  await writeFile(join(control, 'index.html'), 'ok');
  await writeFile(join(control, '_headers'), 'x-test: yes');
  await assert.rejects(prepareBuildArtifact(sha, workflowSha, control), /Cloudflare control/);
});

test('artifact preparation reserves ZIP entry space for manifest metadata', async (t) => {
  const root = await temporaryDirectory(t);
  await writeFile(join(root, 'index.html'), 'ok');
  for (let index = 0; index < 498; index++) await writeFile(join(root, `asset-${String(index).padStart(3, '0')}.txt`), 'x');
  await assert.rejects(prepareBuildArtifact(sha, workflowSha, root), /500-entry Android artifact limit/);
});

test('artifact preparation requires both explicit full revisions', async (t) => {
  const root = await temporaryDirectory(t);
  await writeFile(join(root, 'index.html'), 'ok');
  await assert.rejects(prepareBuildArtifact(undefined, workflowSha, root), /lowercase 40-character/);
  await assert.rejects(prepareBuildArtifact(sha, 'main', root), /lowercase 40-character/);
});

test('Pages asset hash vectors remain compatible with Android BLAKE3 verification', async () => {
  const vectors = JSON.parse(await readFile(new URL('./pages-hash-vectors.json', import.meta.url), 'utf8'));
  for (const vector of vectors) {
    assert.equal(pagesAssetHash(Buffer.from(vector.contentUtf8, 'utf8'), vector.relativePath), vector.pagesHash, vector.relativePath);
  }
});
