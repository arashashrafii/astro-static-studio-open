import { lstat, mkdir, open, readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pagesAssetHash } from '../apps/api/src/publishing.ts';

export const MANIFEST_RELATIVE_PATH = '__astro_static_studio/cloudflare-manifest.v2.json';
export const ASSET_IDENTITY = 'pages-blake3-base64-content-plus-extension-prefix32-v1';
const execFile = promisify(nodeExecFile);
const MAX_FILES = 499;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TREE_BYTES = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const root = fileURLToPath(new URL('..', import.meta.url));

export function validateRevision(revision) {
  if (typeof revision !== 'string' || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error('Source revision must be a lowercase 40-character commit SHA.');
  }
  return revision;
}

export function verifyCheckoutRevision(expected, actualOutput) {
  validateRevision(expected);
  const actual = typeof actualOutput === 'string' ? actualOutput.trim() : '';
  if (!/^[0-9a-f]{40}$/.test(actual) || actual !== expected) {
    throw new Error('Checked-out source revision does not match the approved revision.');
  }
  return actual;
}

export function createArtifactName(revision, runId, runAttempt) {
  validateRevision(revision);
  if (typeof runId !== 'string' || !/^[1-9][0-9]*$/.test(runId)) throw new Error('Workflow run ID must be a positive decimal ID.');
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) throw new Error('Workflow run attempt must be a positive integer.');
  return `studio-static-build-${revision}-${runId}-${runAttempt}`;
}

function fail(message) { throw new Error(message); }

function validateRelativePath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.includes(':') || path.includes('%')
      || path.normalize('NFC') !== path || path.length > 1024) fail('Static output contains an unsafe or non-normalized path.');
  const parts = path.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || part.length > 255 || part.endsWith('.') || part.endsWith(' ')
        || [...part].some((character) => /[\u0000-\u001f\u007f-\u009f]/u.test(character))) {
      fail('Static output contains an unsafe path segment.');
    }
  }
  const lower = path.toLowerCase();
  if (lower === '__astro_static_studio' || lower.startsWith('__astro_static_studio/')) fail('Static output uses the reserved Studio metadata path.');
  const lowerParts = parts.map((part) => part.toLowerCase());
  if (lower === '_headers' || lower === '_redirects' || lower === '_routes.json' || lower === '_worker.js' || lower === '_worker.bundle'
      || lower === 'functions' || lower.startsWith('functions/') || lower === '.wrangler' || lower.startsWith('.wrangler/') || lowerParts.includes('.ds_store')
      || lowerParts.includes('node_modules') || lowerParts.includes('.git') || parts.some((part) => /^\.env(?:\.|$)/i.test(part))) {
    fail('Static output contains a Cloudflare control, executable, or unsupported path.');
  }
}

async function reservedPathExists(directory) {
  try { await lstat(resolve(directory, MANIFEST_RELATIVE_PATH)); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function inspect(directory) {
  const absolute = resolve(directory);
  const rootInfo = await lstat(absolute).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) fail('A built static output directory is required; links are not accepted.');
  const assets = Object.create(null);
  const paths = new Set();
  let totalBytes = 0;

  async function walk(current) {
    const children = await readdir(current, { withFileTypes: true });
    children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const child of children) {
      const fullPath = resolve(current, child.name);
      const relativePath = relative(absolute, fullPath).split(sep).join('/');
      validateRelativePath(relativePath);
      const key = relativePath.normalize('NFC').toLowerCase();
      if (paths.has(key)) fail('Static output contains duplicate or aliased paths.');
      paths.add(key);
      const info = await lstat(fullPath);
      if (info.isSymbolicLink()) fail('Static output contains a symbolic link.');
      if (info.isDirectory()) { await walk(fullPath); continue; }
      if (!info.isFile()) fail('Static output contains a non-regular file.');
      if (info.size > MAX_FILE_BYTES) fail('A static asset exceeds 25 MiB Pages limit or the 8 MiB Android artifact limit.');
      if (Object.keys(assets).length >= MAX_FILES) fail('Static output exceeds the supported 499 asset files.');
      totalBytes += info.size;
      if (totalBytes > MAX_TREE_BYTES) fail('Static output exceeds the 32 MiB Android artifact limit.');
      const bytes = await readFile(fullPath);
      if (bytes.length !== info.size) fail('A static file changed while the artifact manifest was being prepared.');
      assets[relativePath] = {
        pagesHash: pagesAssetHash(bytes, relativePath),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }
  }

  await walk(absolute);
  if (!Object.hasOwn(assets, 'index.html')) fail('Static output must contain a root index.html.');
  return { absolute, assets, totalBytes, fileCount: Object.keys(assets).length, entryCount: paths.size };
}

export async function inspectStaticOutput(directory) {
  const inspected = await inspect(directory);
  return { fileCount: inspected.fileCount };
}

export async function prepareBuildArtifact(sourceRevision, workflowRevision, directory = resolve(root, 'apps/site/dist')) {
  validateRevision(sourceRevision);
  validateRevision(workflowRevision);
  if (await reservedPathExists(directory)) fail(`Static output already contains the reserved path ${MANIFEST_RELATIVE_PATH}.`);
  const inspected = await inspect(directory);
  // The ZIP may represent the metadata directory as an explicit entry.
  if (inspected.entryCount + 2 > 500) fail('Static output and Cloudflare metadata exceed the 500-entry Android artifact limit.');
  const manifest = {
    schemaVersion: 2,
    assetIdentity: ASSET_IDENTITY,
    sourceRevision,
    workflowRevision,
    assets: inspected.assets,
  };
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8');
  if (bytes.length > MAX_MANIFEST_BYTES) fail('Generated Cloudflare manifest exceeds the Android metadata size limit.');
  if (inspected.totalBytes + bytes.length > MAX_TREE_BYTES) fail('Static output and generated manifest exceed the 32 MiB Android artifact limit.');
  const manifestPath = resolve(inspected.absolute, MANIFEST_RELATIVE_PATH);
  await mkdir(dirname(manifestPath), { recursive: true });
  // Exclusive creation prevents overwriting output if a competing process creates the reserved file after preflight.
  const handle = await open(manifestPath, 'wx', 0o644).catch((error) => {
    if (error?.code === 'EEXIST') fail(`Static output already contains the reserved path ${MANIFEST_RELATIVE_PATH}.`);
    throw error;
  });
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  return { fileCount: inspected.fileCount, manifestPath, manifestBytes: bytes.length };
}

async function main() {
  if (process.argv.length < 4 || process.argv.length > 5) fail('Usage: node --import tsx scripts/prepare-build-artifact.mjs <sourceRevision> <workflowRevision> [built-dist-directory]');
  const sourceRevision = validateRevision(process.argv[2]);
  const workflowRevision = validateRevision(process.argv[3]);
  const directory = process.argv[4] ? resolve(process.argv[4]) : resolve(root, 'apps/site/dist');
  const checkout = await execFile('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  verifyCheckoutRevision(sourceRevision, checkout.stdout);
  const result = await prepareBuildArtifact(sourceRevision, workflowRevision, directory);
  process.stdout.write(`Prepared ${result.fileCount} static assets and the reserved Cloudflare manifest.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error?.message || 'Could not prepare the static build artifact.'}\n`); process.exitCode = 1; });
}
