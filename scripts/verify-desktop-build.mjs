import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { arch, platform, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Evidence harness only: no build-runner replacement, installs or publication.
// Uses a committed fixture, leaving all user content and uncommitted edits alone.
const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const baselineCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
await mkdir(join(root, '.tmp'), { recursive: true });
const evidence = await mkdtemp(join(root, '.tmp/issue-13-'));
const fixture = join(evidence, 'fixture');
await mkdir(fixture);
const report = {
  issue: 13, startedAt: new Date().toISOString(), baselineCommit,
  environment: { node: process.version, npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(), platform: platform(), arch: arch(), kernel: release() },
  fixture, commands: [], status: 'running',
};
console.log(`Evidence directory: ${evidence}`);
const sourcePaths = ['content/content.json', 'apps/api/src/publisher.ts', 'apps/api/src/build-output.ts', 'apps/site/src/pages/index.astro'];
const originals = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, sha256(await readFile(join(root, path)))])));

async function run(name, args, expectedSuccess = true) {
  const start = performance.now();
  let log = '';
  const code = await new Promise((resolve, reject) => {
    const child = spawn('npm', args, { cwd: fixture, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', bytes => { log += bytes; });
    child.stderr.on('data', bytes => { log += bytes; });
    child.on('error', reject);
    child.on('close', resolve);
  });
  await writeFile(join(evidence, `${name}.log`), log);
  const result = { name, command: ['npm', ...args], exitCode: code, elapsedMs: Math.round(performance.now() - start), log: `${name}.log` };
  report.commands.push(result);
  console.log(JSON.stringify(result));
  if (expectedSuccess) assert.equal(code, 0, `${name} failed; inspect ${name}.log`);
  else assert.ok(typeof code === 'number' && code !== 0, 'Injected build failure must exit nonzero');
  return result;
}

async function outputManifest() {
  const base = join(fixture, 'apps/site/dist');
  const files = [];
  async function walk(relative = '') {
    for (const entry of await readdir(join(base, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      else {
        assert.ok(entry.isFile(), `Unexpected output entry: ${path}`);
        const bytes = await readFile(join(base, path));
        files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await walk();
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { files, fileCount: files.length, htmlCount: files.filter(f => f.path.endsWith('.html')).length, totalBytes: files.reduce((n, f) => n + f.bytes, 0), manifestSha256: sha256(JSON.stringify(files)) };
}

try {
  const archive = execFileSync('git', ['archive', baselineCommit], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', fixture], { input: archive });
  // Hard-link installed dependencies; workspace-relative links retain the copied
  // fixture layout. No dependency installation or native rebuild takes place.
  for (const path of ['node_modules', 'apps/site/node_modules', 'apps/admin/node_modules', 'apps/api/node_modules', 'packages/contracts/node_modules', 'packages/theme/node_modules']) {
    if (existsSync(join(root, path))) execFileSync('cp', ['-al', join(root, path), join(fixture, path)]);
  }
  const lock = await readFile(join(fixture, 'package-lock.json'));
  report.lockfileSha256 = sha256(lock);
  const locked = JSON.parse(lock).packages;
  report.versions = Object.fromEntries(Object.entries(locked).filter(([path]) => /(?:^|\/)node_modules\/(astro|@astrojs\/compiler-rs|typescript|tsx|vite)$/.test(path)).map(([path, pkg]) => [path, pkg.version]));
  report.fixtureContentSha256 = sha256(await readFile(join(fixture, 'content/content.json')));
  await run('typecheck', ['run', 'check']);
  await run('build-output-tests', ['exec', '--', 'node', '--import', 'tsx', '--test', 'tests/build-output.test.ts']);
  await run('tests', ['test']);
  await run('baseline-build', ['run', 'build']);
  report.baselineOutput = await outputManifest();
  await writeFile(join(evidence, 'baseline-output.json'), JSON.stringify(report.baselineOutput, null, 2));

  const contentPath = join(fixture, 'content/content.json');
  const content = JSON.parse(await readFile(contentPath, 'utf8'));
  const marker = 'Issue 13 desktop build — به‌روز <check> & verified';
  content.site.name = marker;
  await writeFile(contentPath, JSON.stringify(content, null, 2));
  await run('changed-content-build', ['run', 'build:site']);
  const indexPath = join(fixture, 'apps/site/dist/index.html');
  const html = await readFile(indexPath, 'utf8');
  assert.ok(html.includes('Issue 13 desktop build — به‌روز &lt;check&gt; &amp; verified'), 'Updated title must appear escaped in generated HTML');
  assert.ok(!html.includes('<check>'), 'Marker must not become an HTML element');
  report.marker = { input: marker, escapedOutputVerified: true, indexSha256: sha256(html) };
  report.updatedOutput = await outputManifest();
  assert.notEqual(report.updatedOutput.manifestSha256, report.baselineOutput.manifestSha256);
  await writeFile(join(evidence, 'updated-output.json'), JSON.stringify(report.updatedOutput, null, 2));

  const pagePath = join(fixture, 'apps/site/src/pages/index.astro');
  const page = await readFile(pagePath);
  await writeFile(pagePath, '---\nimport Missing from "./missing-issue-13.astro";\n---\n<Missing />\n');
  try {
    await run('injected-failure-build', ['run', 'build:site'], false);
    const afterFailure = await outputManifest();
    assert.deepEqual(afterFailure, report.updatedOutput, 'Every output path and byte must survive failed real Astro build');
    assert.deepEqual((await readdir(join(fixture, 'apps'))).filter(name => /^\.dist\.(staging|backup)-/.test(name)), []);
    report.failure = { nonzeroExit: true, allOutputBytesPreserved: true, stagingAndBackupCleaned: true, preservedManifestSha256: afterFailure.manifestSha256 };
  } finally {
    await writeFile(pagePath, page);
  }
  await run('recovery-build', ['run', 'build:site']);
  assert.ok((await readFile(indexPath, 'utf8')).includes('Issue 13 desktop build — به‌روز &lt;check&gt; &amp; verified'));
  for (const path of sourcePaths) assert.equal(sha256(await readFile(join(root, path))), originals[path], `User source changed: ${path}`);
  report.originalSourcesUnchanged = true;
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error.stack ?? error);
  process.exitCode = 1;
  console.error(report.error);
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Result: ${report.status}; report: ${join(evidence, 'report.json')}`);
}
