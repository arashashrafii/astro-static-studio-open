import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createCloudflareService, createWranglerRunner, deploymentUrl, pagesAssetHash, validateStaticOutput, type CommandResult, type CommandRunner } from '../apps/api/src/publishing.ts';

const account = { id: '0123456789abcdef0123456789abcdef', name: 'Studio account' };
const whoami = JSON.stringify({ loggedIn: true, accounts: [account] });
const projectList = JSON.stringify([{ 'Project Name': 'portfolio-demo', 'Project Domains': 'portfolio-demo.pages.dev', 'Git Provider': 'No', 'Last Modified': '2 hours ago' }]);
const buildUrl = `https://dash.cloudflare.com/${account.id}/pages/view/portfolio-demo/abcdef12`;
const productionDeployment = JSON.stringify([{ Id: 'abcdef12', Environment: 'Production', Branch: 'main', Status: '2 hours ago', Deployment: 'https://portfolio-demo.pages.dev', Build: buildUrl }]);
function uploadedOutput(environment: 'preview' | 'production', id = 'deadbeef') { return JSON.stringify({ type: 'pages-deploy-detailed', version: 1, pages_project: 'portfolio-demo', deployment_id: id, url: environment === 'production' ? 'https://portfolio-demo.pages.dev' : 'https://deadbeef.portfolio-demo.pages.dev', environment, production_branch: 'main' }); }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'studio-publish-test-'));
  const buildDirectory = join(directory, 'dist');
  const configPath = join(directory, 'content', 'cloudflare.json');
  await mkdir(buildDirectory, { recursive: true });
  await writeFile(join(buildDirectory, 'index.html'), '<h1>local site</h1>');
  return { directory, buildDirectory, configPath };
}
function runnerFor(handler: (args: string[], accountId?: string) => CommandResult | Promise<CommandResult>, calls: string[][] = []): CommandRunner {
  return async (args, accountId) => { calls.push(args); return handler(args, accountId); };
}
function authTokenCommand(args: string[]): CommandResult | null {
  return args[0] === 'auth' && args[1] === 'token' ? { code: 0, stdout: JSON.stringify({ type: 'oauth', token: 'test-oauth-token' }), stderr: '' } : null;
}
function pagesApiFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const address = String(url);
  let result: unknown = {};
  if (address.endsWith('/upload-token')) result = { jwt: 'test-upload-jwt' };
  else if (address.endsWith('/check-missing')) result = [];
  return Promise.resolve({ ok: true, status: 200, url: address, json: async () => ({ success: true, result }), text: async () => JSON.stringify({ success: true, result }) } as Response);
}
async function chooseAccountAndProject(service: ReturnType<typeof createCloudflareService>) {
  await service.selectAccount(account.id);
  await service.selectProject('portfolio-demo');
}

test('provider keeps failed-upload output and routes account explicitly', async () => {
  const f = await fixture();
  try {
    const calls: string[][] = [];
    const service = createCloudflareService(runnerFor((args, accountId) => {
      if (args[0] === 'whoami') return { code: 0, stdout: whoami, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'project') return { code: 0, stdout: projectList, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'deployment') return { code: 0, stdout: productionDeployment, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    }, calls), { async upload() { throw new Error('Upload failed safely'); } }, { buildDirectory: f.buildDirectory, configPath: f.configPath });
    await chooseAccountAndProject(service);
    await assert.rejects(service.publish('preview'), /Upload failed safely/);
    assert.equal(await readFile(join(f.buildDirectory, 'index.html'), 'utf8'), '<h1>local site</h1>');
    assert.ok(calls.length > 0);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('new Pages projects use Wrangler positional name and persist selection before first deployment', async () => {
  const f = await fixture();
  try {
    const calls: string[][] = [];
    const service = createCloudflareService(runnerFor((args) => {
      if (args[0] === 'whoami') return { code: 0, stdout: whoami, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'project' && args[2] === 'create') return {
        code: 0,
        stdout: "✨ Successfully created the 'portfolio-demo' project. It will be available at portfolio-demo.pages.dev once you create your first deployment.",
        stderr: '',
      };
      if (args[0] === 'pages' && args[1] === 'project') return { code: 0, stdout: '[]', stderr: '' };
      if (args[0] === 'pages' && args[1] === 'deployment') return { code: 0, stdout: '[]', stderr: '' };
      return { code: 1, stdout: '', stderr: 'Unexpected mocked Wrangler command' };
    }, calls), undefined, { buildDirectory: f.buildDirectory, configPath: f.configPath });
    const status = await service.status();
    assert.equal(status.accountId, account.id, 'a sole account is selected automatically');
    const created = await service.createProject('portfolio-demo');
    assert.deepEqual(created, { projectName: 'portfolio-demo', productionBranch: 'main' });
    assert.deepEqual(calls.at(-1), ['pages', 'project', 'create', 'portfolio-demo', '--production-branch', 'main', '--force']);
    assert.deepEqual(await service.projects(), [{ name: 'portfolio-demo', productionBranch: 'main' }], 'new projects remain selectable before the first deployment');
    assert.equal((await service.status()).projectName, 'portfolio-demo', 'the selected destination survives a status refresh');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('failed Pages project creation does not save a destination', async () => {
  const f = await fixture();
  try {
    const service = createCloudflareService(runnerFor((args) => {
      if (args[0] === 'whoami') return { code: 0, stdout: whoami, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'project' && args[2] === 'create') return { code: 1, stdout: '', stderr: 'Missing Pages project name (error code: 10055)' };
      return { code: 0, stdout: '[]', stderr: '' };
    }), undefined, { buildDirectory: f.buildDirectory, configPath: f.configPath });
    await service.status();
    await assert.rejects(service.createProject('portfolio-demo'), /ساخت پروژهٔ Cloudflare ناموفق بود\. \(کد خروج Wrangler: 1؛ کد خطای Cloudflare: 10055\)/);
    assert.equal((await service.status()).projectName, null);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('deployment requires exact selected project, branch, environment and Pages host', () => {
  const project = { name: 'portfolio-demo', productionBranch: 'main' };
  const result = (rows: Record<string, unknown>[], id = 'deadbeef'): CommandResult => ({ code: 0, stdout: JSON.stringify(rows.map((row) => ({ Id: id, Build: buildUrl, ...row }))), stderr: '' });
  assert.equal(deploymentUrl(project, 'preview', result([{ Environment: 'Preview', Branch: 'studio-preview', Status: 'just now', Deployment: 'https://studio-preview.portfolio-demo.pages.dev' }]), account.id, 'deadbeef'), 'https://studio-preview.portfolio-demo.pages.dev/');
  assert.equal(deploymentUrl(project, 'preview', result([{ Environment: 'Preview', Branch: 'studio-preview', Status: 'just now', Deployment: 'https://a1b2c3d4.portfolio-demo.pages.dev' }]), account.id, 'deadbeef'), 'https://a1b2c3d4.portfolio-demo.pages.dev/');
  assert.equal(deploymentUrl(project, 'production', result([{ Environment: 'Production', Branch: 'main', Status: '2 minutes ago', Deployment: 'https://portfolio-demo.pages.dev' }]), account.id, 'deadbeef'), 'https://portfolio-demo.pages.dev/');
  assert.throws(() => deploymentUrl(project, 'production', result([{ Environment: 'Production', Branch: 'main', Status: '2 minutes ago', Deployment: 'https://arbitrary.pages.dev' }]), account.id, 'deadbeef'));
  assert.throws(() => deploymentUrl(project, 'preview', result([
    { Id: 'deadbeef', Environment: 'Preview', Branch: 'studio-preview', Status: 'just now', Deployment: 'https://deadbeef.portfolio-demo.pages.dev' },
    { Id: 'cafebabe', Environment: 'Preview', Branch: 'studio-preview', Status: 'Failure', Deployment: 'https://cafebabe.portfolio-demo.pages.dev' },
  ], 'cafebabe'), account.id, 'cafebabe'));
  for (const row of [
    { Environment: 'Preview', Branch: 'studio-preview', Status: 'just now', Deployment: 'https://studio-preview.other-site.pages.dev', Build: `https://dash.cloudflare.com/${account.id}/pages/view/other-site/abcdef12` },
    { Environment: 'Production', Branch: 'main', Status: 'just now', Deployment: 'https://portfolio-demo.pages.dev' },
    { Environment: 'Preview', Branch: 'studio-preview', Status: 'just now', Deployment: 'https://portfolio-demo.attacker.pages.dev' },
    { Environment: 'Preview', Branch: 'studio-preview', Status: 'just now', Deployment: 'https://attacker.pages.dev/portfolio-demo' },
    { Environment: 'Preview', Branch: 'studio-preview', Status: 'just now', Deployment: 'http://studio-preview.portfolio-demo.pages.dev' },
  ]) assert.throws(() => deploymentUrl(project, 'preview', result([row]), account.id, 'deadbeef'));
  assert.throws(() => deploymentUrl(project, 'preview', { code: 1, stdout: '[]', stderr: '' }, account.id, 'deadbeef'));
});

test('Pages asset hashes match the Wrangler 4.149 compatibility fixture', () => {
  assert.equal(pagesAssetHash(Buffer.from('hello'), 'index.html'), 'a2b82584e50075886b08927390f2f573');
  assert.equal(pagesAssetHash(Buffer.from('hello'), 'assets/logo.svg'), '9cbee6c5f196788f3f10390309595c3a');
  assert.equal(pagesAssetHash(Buffer.from(''), 'no-extension'), 'af1349b9f5f9a1a6a0404dea36dcc949');
});

test('Pages preupload sends only missing assets in sequential bounded batches before Wrangler finalizes', async () => {
  const f = await fixture();
  const calls: string[][] = [];
  const requests: Array<{ path: string; payload?: unknown; authorization?: string }> = [];
  let activeUploads = 0;
  let maxConcurrentUploads = 0;
  try {
    await writeFile(join(f.buildDirectory, 'a-400k.bin'), Buffer.alloc(400 * 1024, 1));
    await writeFile(join(f.buildDirectory, 'b-200k.bin'), Buffer.alloc(200 * 1024, 2));
    await writeFile(join(f.buildDirectory, 'c-oversize-batch.bin'), Buffer.alloc(512 * 1024 + 2, 3));
    const service = createCloudflareService(runnerFor((args) => {
      const auth = authTokenCommand(args); if (auth) return auth;
      if (args[0] === 'whoami') return { code: 0, stdout: whoami, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'project') return { code: 0, stdout: projectList, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'deployment') return { code: 0, stdout: args.includes('--environment') ? productionDeployment : JSON.stringify([{ Id: 'deadbeef', Environment: 'Preview', Branch: 'studio-preview', Status: 'just now', Deployment: 'https://studio-preview.portfolio-demo.pages.dev', Build: `https://dash.cloudflare.com/${account.id}/pages/view/portfolio-demo/deadbeef` }]), stderr: '' };
      if (args[0] === 'pages' && args[1] === 'deploy') return { code: 0, stdout: '', stderr: '', structuredOutput: uploadedOutput('preview') };
      return { code: 1, stdout: '', stderr: 'Unexpected mocked Wrangler command' };
    }, calls), undefined, { buildDirectory: f.buildDirectory, configPath: f.configPath, fetch: async (input, init) => {
      const url = String(input);
      if (url.includes('pages.dev')) return { ok: true, url } as Response;
      const path = new URL(url).pathname;
      let payload: unknown;
      try { payload = init?.body ? JSON.parse(String(init.body)) : undefined; } catch { payload = undefined; }
      requests.push({ path, payload, authorization: new Headers(init?.headers).get('authorization') ?? undefined });
      if (path.endsWith('/upload-token')) return { ok: true, status: 200, url, json: async () => ({ success: true, result: { jwt: 'private-test-jwt' } }) } as Response;
      if (path.endsWith('/check-missing')) return { ok: true, status: 200, url, json: async () => ({ success: true, result: (payload as { hashes: string[] }).hashes }) } as Response;
      if (path.endsWith('/upload')) {
        activeUploads++;
        maxConcurrentUploads = Math.max(maxConcurrentUploads, activeUploads);
        const uploads = payload as Array<{ key: string; value: string; base64: boolean; metadata: { contentType: string } }>;
        assert.ok(uploads.every((asset) => asset.base64 && asset.metadata.contentType));
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));
        activeUploads--;
        return { ok: true, status: 200, url, json: async () => ({ success: true, result: {} }) } as Response;
      }
      return { ok: true, status: 200, url, json: async () => ({ success: true, result: {} }) } as Response;
    } });
    await chooseAccountAndProject(service);
    const published = await service.publish('preview');
    assert.equal(published.url, 'https://studio-preview.portfolio-demo.pages.dev/');
    const check = requests.find((request) => request.path.endsWith('/check-missing'));
    const uploads = requests.filter((request) => request.path.endsWith('/upload'));
    const upserts = requests.filter((request) => request.path.endsWith('/upsert-hashes'));
    assert.equal((check?.payload as { hashes: string[] }).hashes.length, 4);
    assert.equal(uploads.length, 4, 'files are packed in deterministic path order and an over-limit individual asset stays alone');
    assert.equal(upserts.length, uploads.length, 'each successful batch is checkpointed before the next one');
    for (const request of uploads) {
      const batch = request.payload as Array<{ value: string }>;
      const rawBytes = batch.reduce((total, asset) => total + Buffer.from(asset.value, 'base64').byteLength, 0);
      assert.ok(batch.length === 1 && rawBytes > 512 * 1024 || rawBytes <= 512 * 1024);
      assert.equal(request.authorization, 'Bearer private-test-jwt');
    }
    assert.equal(maxConcurrentUploads, 1, 'upload requests are sequential');
    assert.ok(requests.some((request) => request.path.endsWith('/upsert-hashes')));
    assert.ok(calls.findIndex((args) => args[1] === 'deploy') > calls.findIndex((args) => args[0] === 'auth'), 'Wrangler deploy finalizes only after preupload');
    assert.equal(await readFile(join(f.buildDirectory, 'index.html'), 'utf8'), '<h1>local site</h1>');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('Pages preupload caps zero-byte asset batches at 2,000 entries', async () => {
  const f = await fixture();
  const batchSizes: number[] = [];
  try {
    for (let index = 0; index < 2_000; index++) {
      await writeFile(join(f.buildDirectory, `empty-${index.toString().padStart(4, '0')}.f${index.toString().padStart(4, '0')}`), '');
    }
    const service = createCloudflareService(runnerFor((args) => {
      const auth = authTokenCommand(args); if (auth) return auth;
      if (args[0] === 'whoami') return { code: 0, stdout: whoami, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'project') return { code: 0, stdout: projectList, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'deployment') return { code: 0, stdout: args.includes('--environment') ? productionDeployment : JSON.stringify([{ Id: 'deadbeef', Environment: 'Preview', Branch: 'studio-preview', Status: 'just now', Deployment: 'https://studio-preview.portfolio-demo.pages.dev', Build: buildUrl }]), stderr: '' };
      if (args[0] === 'pages' && args[1] === 'deploy') return { code: 0, stdout: '', stderr: '', structuredOutput: uploadedOutput('preview') };
      return { code: 1, stdout: '', stderr: 'Unexpected mocked Wrangler command' };
    }), undefined, { buildDirectory: f.buildDirectory, configPath: f.configPath, fetch: async (input, init) => {
      const url = String(input);
      if (url.includes('pages.dev')) return { ok: true, url } as Response;
      const path = new URL(url).pathname;
      if (path.endsWith('/upload-token')) return { ok: true, status: 200, url, json: async () => ({ success: true, result: { jwt: 'private-test-jwt' } }) } as Response;
      if (path.endsWith('/check-missing')) {
        const hashes = JSON.parse(String(init?.body)) as { hashes: string[] };
        return { ok: true, status: 200, url, json: async () => ({ success: true, result: hashes.hashes }) } as Response;
      }
      if (path.endsWith('/upload')) {
        batchSizes.push((JSON.parse(String(init?.body)) as unknown[]).length);
      }
      return { ok: true, status: 200, url, json: async () => ({ success: true, result: {} }) } as Response;
    } });
    await chooseAccountAndProject(service);
    await service.publish('preview');
    assert.equal(batchSizes.reduce((total, size) => total + size, 0), 2_001);
    assert.ok(batchSizes.every((size) => size <= 2_000));
    assert.ok(batchSizes.includes(2_000), 'the 2,000-entry ceiling is exercised');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('successful batches checkpoint for retry while failed batches remain unregistered and undeployed', async () => {
  const f = await fixture();
  const cached = new Set<string>();
  const uploadBatchSizes: number[] = [];
  const checkMissingCounts: number[] = [];
  const registeredBatchSizes: number[] = [];
  const calls: string[][] = [];
  let largeBatchFailuresRemaining = 3;
  const secret = 'private-test-jwt';
  const previousInfo = console.info;
  const progressLogs: string[] = [];
  try {
    await writeFile(join(f.buildDirectory, 'a-duplicate.txt'), 'same bytes');
    await writeFile(join(f.buildDirectory, 'b-duplicate.txt'), 'same bytes');
    await writeFile(join(f.buildDirectory, 'c-unique.txt'), 'different bytes');
    await writeFile(join(f.buildDirectory, 'z-large.bin'), Buffer.alloc(600 * 1024, 9));
    const service = createCloudflareService(runnerFor((args) => {
      const auth = authTokenCommand(args); if (auth) return auth;
      if (args[0] === 'whoami') return { code: 0, stdout: whoami, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'project') return { code: 0, stdout: projectList, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'deployment') return { code: 0, stdout: args.includes('--environment') ? productionDeployment : JSON.stringify([{ Id: 'deadbeef', Environment: 'Preview', Branch: 'studio-preview', Status: 'just now', Deployment: 'https://studio-preview.portfolio-demo.pages.dev', Build: buildUrl }]), stderr: '' };
      if (args[0] === 'pages' && args[1] === 'deploy') return { code: 0, stdout: '', stderr: '', structuredOutput: uploadedOutput('preview') };
      return { code: 1, stdout: '', stderr: 'Unexpected mocked Wrangler command' };
    }, calls), undefined, { buildDirectory: f.buildDirectory, configPath: f.configPath, fetch: async (input, init) => {
      const url = String(input);
      if (url.includes('pages.dev')) return { ok: true, url } as Response;
      const path = new URL(url).pathname;
      if (path.endsWith('/upload-token')) return { ok: true, status: 200, url, json: async () => ({ success: true, result: { jwt: secret } }) } as Response;
      if (path.endsWith('/check-missing')) {
        const body = JSON.parse(String(init?.body)) as { hashes: string[] };
        checkMissingCounts.push(body.hashes.length);
        return { ok: true, status: 200, url, json: async () => ({ success: true, result: body.hashes.filter((hash) => !cached.has(hash)) }) } as Response;
      }
      if (path.endsWith('/upload')) {
        const payload = JSON.parse(String(init?.body)) as Array<{ key: string; value: string }>;
        uploadBatchSizes.push(payload.length);
        const containsLarge = payload.some((asset) => Buffer.from(asset.value, 'base64').byteLength > 512 * 1024);
        if (containsLarge && largeBatchFailuresRemaining > 0) {
          largeBatchFailuresRemaining--;
          return { ok: false, status: 503, url, json: async () => ({ success: false, errors: [{ message: secret }] }) } as Response;
        }
        return { ok: true, status: 200, url, json: async () => ({ success: true, result: {} }) } as Response;
      }
      if (path.endsWith('/upsert-hashes')) {
        const body = JSON.parse(String(init?.body)) as { hashes: string[] };
        body.hashes.forEach((hash) => cached.add(hash));
        registeredBatchSizes.push(body.hashes.length);
      }
      return { ok: true, status: 200, url, json: async () => ({ success: true, result: {} }) } as Response;
    } });
    console.info = (...values: unknown[]) => progressLogs.push(values.map(String).join(' '));
    await chooseAccountAndProject(service);
    await assert.rejects(service.publish('preview'), /HTTP 503/);
    assert.equal(registeredBatchSizes.length, 1, 'only the successful first batch is registered');
    assert.ok(!calls.some((args) => args[1] === 'deploy'), 'a later batch failure prevents deployment');
    await service.publish('preview');
    assert.deepEqual(checkMissingCounts, [4, 4], 'duplicate file paths share one hash while the retry checks the full unique-hash set');
    assert.deepEqual(uploadBatchSizes, [3, 1, 1, 1, 1], 'retry skips the checkpointed batch and retries only the remaining unique hash');
    assert.equal(registeredBatchSizes.length, 2);
    assert.ok(calls.some((args) => args[1] === 'deploy'), 'deployment occurs only after every missing asset batch is registered');
    assert.ok(progressLogs.length >= 2);
    assert.ok(progressLogs.every((line) => !line.includes(secret) && !line.includes('a-duplicate') && !line.includes('z-large')));
  } finally {
    console.info = previousInfo;
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('a Pages asset upload failure stops before Wrangler deploy and hides credentials', async () => {
  const f = await fixture();
  const secret = 'private-test-jwt';
  const calls: string[][] = [];
  try {
    const service = createCloudflareService(runnerFor((args) => {
      const auth = authTokenCommand(args); if (auth) return auth;
      if (args[0] === 'whoami') return { code: 0, stdout: whoami, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'project') return { code: 0, stdout: projectList, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'deploy') return { code: 0, stdout: '', stderr: '', structuredOutput: uploadedOutput('preview') };
      if (args[0] === 'pages' && args[1] === 'deployment') return { code: 0, stdout: productionDeployment, stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    }, calls), undefined, { buildDirectory: f.buildDirectory, configPath: f.configPath, fetch: async (input, init) => {
      const url = String(input);
      const path = new URL(url).pathname;
      if (path.endsWith('/upload-token')) return { ok: true, status: 200, url, json: async () => ({ success: true, result: { jwt: secret } }) } as Response;
      if (path.endsWith('/check-missing')) {
        const hashes = JSON.parse(String(init?.body)) as { hashes: string[] };
        return { ok: true, status: 200, url, json: async () => ({ success: true, result: hashes.hashes }) } as Response;
      }
      if (path.endsWith('/upload')) return { ok: false, status: 503, url, json: async () => ({ success: false, errors: [{ message: secret }] }) } as Response;
      return { ok: true, status: 200, url, json: async () => ({ success: true, result: {} }) } as Response;
    } });
    await chooseAccountAndProject(service);
    await assert.rejects(service.publish('preview'), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /HTTP 503/);
      assert.ok(!error.message.includes(secret));
      return true;
    });
    assert.ok(!calls.some((args) => args[1] === 'deploy'), 'no deployment is created after a failed batch');
    assert.equal(await readFile(join(f.buildDirectory, 'index.html'), 'utf8'), '<h1>local site</h1>');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('Pages upload opts out of Workers delegation and explains a metadata branch mismatch safely', async () => {
  const f = await fixture();
  const calls: string[][] = [];
  const previousError = console.error;
  const diagnostics: string[] = [];
  try {
    const service = createCloudflareService(runnerFor((args) => {
      const auth = authTokenCommand(args); if (auth) return auth;
      if (args[0] === 'whoami') return { code: 0, stdout: whoami, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'project') return { code: 0, stdout: projectList, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'deploy') return {
        code: 0,
        stdout: '',
        stderr: '',
        structuredOutput: JSON.stringify({ type: 'pages-deploy-detailed', version: 1, pages_project: 'portfolio-demo', deployment_id: 'deadbeef', environment: 'preview', production_branch: 'unexpected-branch' }),
      };
      if (args[0] === 'pages' && args[1] === 'deployment') return { code: 0, stdout: args.includes('--environment') ? productionDeployment : '[]', stderr: '' };
      return { code: 1, stdout: '', stderr: 'Unexpected mocked Wrangler command' };
    }, calls), undefined, { buildDirectory: f.buildDirectory, configPath: f.configPath, fetch: pagesApiFetch });
    console.error = (...args: unknown[]) => diagnostics.push(args.map(String).join(' '));
    await chooseAccountAndProject(service);
    await assert.rejects(service.publish('preview'), /شاخهٔ اصلی که Cloudflare برای پروژه برگرداند/);
    const deployCall = calls.find((args) => args[1] === 'deploy');
    assert.ok(deployCall?.includes('--force'), 'Pages deploy explicitly opts out of Workers delegation');
    assert.ok(diagnostics[0]?.includes('productionBranchMatches\\":false'));
    assert.ok(!diagnostics[0]?.includes('unexpected-branch'), 'metadata values are not logged');
  } finally {
    console.error = previousError;
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('missing Pages completion output logs only safe command markers', async () => {
  const f = await fixture();
  const previousError = console.error;
  const diagnostics: string[] = [];
  try {
    const service = createCloudflareService(runnerFor((args) => {
      const auth = authTokenCommand(args); if (auth) return auth;
      if (args[0] === 'whoami') return { code: 0, stdout: whoami, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'project') return { code: 0, stdout: projectList, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'deploy') return {
        code: 0,
        stdout: 'Delegating to Cloudflare Workers',
        stderr: 'CLOUDFLARE_API_TOKEN=must-not-be-logged',
        structuredOutput: JSON.stringify({ type: 'wrangler-session', version: 1 }),
      };
      if (args[0] === 'pages' && args[1] === 'deployment') return { code: 0, stdout: args.includes('--environment') ? productionDeployment : '[]', stderr: '' };
      return { code: 1, stdout: '', stderr: 'Unexpected mocked Wrangler command' };
    }), undefined, { buildDirectory: f.buildDirectory, configPath: f.configPath, fetch: pagesApiFetch });
    console.error = (...args: unknown[]) => diagnostics.push(args.map(String).join(' '));
    await chooseAccountAndProject(service);
    await assert.rejects(service.publish('preview'), /Wrangler تأییدیهٔ انتشار Pages را برنگرداند/);
    assert.ok(diagnostics[0]?.includes('wrangler-session'));
    assert.ok(diagnostics[0]?.includes('"delegated-to-workers"'));
    assert.ok(diagnostics[0]?.includes('"exitCode":0'));
    assert.ok(!diagnostics[0]?.includes('must-not-be-logged'));
  } finally {
    console.error = previousError;
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('a timed-out Pages upload reports its timeout instead of a misleading metadata mismatch', async () => {
  const f = await fixture();
  try {
    const service = createCloudflareService(runnerFor((args) => {
      const auth = authTokenCommand(args); if (auth) return auth;
      if (args[0] === 'whoami') return { code: 0, stdout: whoami, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'project') return { code: 0, stdout: projectList, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'deploy') return { code: 0, stdout: '', stderr: '', timedOut: true, structuredOutput: JSON.stringify({ type: 'wrangler-session', version: 1 }) };
      if (args[0] === 'pages' && args[1] === 'deployment') return { code: 0, stdout: args.includes('--environment') ? productionDeployment : '[]', stderr: '' };
      return { code: 1, stdout: '', stderr: 'Unexpected mocked Wrangler command' };
    }), undefined, { buildDirectory: f.buildDirectory, configPath: f.configPath, fetch: pagesApiFetch });
    await chooseAccountAndProject(service);
    await assert.rejects(service.publish('preview'), /بارگذاری Pages در مهلت انتظار تمام نشد/);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('default upload retries transient HTTP responses before verifying the exact deployment', async () => {
  const f = await fixture();
  const previousFetch = globalThis.fetch;
  try {
    const calls: string[][] = [];
    const probeStatuses = [404, 429, 200];
    const waits: number[] = [];
    const service = createCloudflareService(runnerFor((args) => {
      const auth = authTokenCommand(args); if (auth) return auth;
      if (args[0] === 'whoami') return { code: 0, stdout: whoami, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'project') return { code: 0, stdout: projectList, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'deploy') return { code: 0, stdout: '', stderr: '', structuredOutput: uploadedOutput('preview') };
      if (args[0] === 'pages' && args[1] === 'deployment') return { code: 0, stdout: args.includes('--environment') ? productionDeployment : JSON.stringify([{ Environment: 'Preview', Branch: 'studio-preview', Status: 'just now', Deployment: 'https://studio-preview.portfolio-demo.pages.dev', Build: buildUrl, Id: 'deadbeef' }]), stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    }, calls), undefined, { buildDirectory: f.buildDirectory, configPath: f.configPath, healthBudgetMs: 20, healthPollMs: 10, healthRequestMs: 10, sleep: async (ms) => { waits.push(ms); }, fetch: async (url, init) => {
      if (String(url).includes('pages.dev')) { const status = probeStatuses.shift()!; return { ok: status === 200, status, url: String(url) } as Response; }
      return pagesApiFetch(url, init);
    } });
    await chooseAccountAndProject(service);
    globalThis.fetch = async () => ({ ok: false, url: 'https://studio-preview.portfolio-demo.pages.dev/' } as Response);
    const publication = await service.publish('preview');
    assert.equal(publication.verified, true);
    assert.equal(publication.url, 'https://studio-preview.portfolio-demo.pages.dev/');
    assert.deepEqual(waits, [10, 10]);
    assert.equal(probeStatuses.length, 0);
    assert.deepEqual(calls.find((args) => args[1] === 'deploy')?.slice(-4), ['--branch', 'studio-preview', '--no-bundle', '--force']);
    assert.ok(calls.some((args) => args[1] === 'deployment' && args.includes('--json')));
    assert.equal(await readFile(join(f.buildDirectory, 'index.html'), 'utf8'), '<h1>local site</h1>');
  } finally { globalThis.fetch = previousFetch; await rm(f.directory, { recursive: true, force: true }); }
});

test('deployment metadata keeps the public URL when network readiness remains unconfirmed', async () => {
  const f = await fixture();
  try {
    let probes = 0;
    const service = createCloudflareService(runnerFor((args) => {
      const auth = authTokenCommand(args); if (auth) return auth;
      if (args[0] === 'whoami') return { code: 0, stdout: whoami, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'project') return { code: 0, stdout: projectList, stderr: '' };
      if (args[0] === 'pages' && args[1] === 'deploy') return { code: 0, stdout: '', stderr: '', structuredOutput: uploadedOutput('preview') };
      if (args[0] === 'pages' && args[1] === 'deployment') return { code: 0, stdout: args.includes('--environment') ? productionDeployment : JSON.stringify([{ Environment: 'Preview', Branch: 'studio-preview', Status: 'just now', Deployment: 'https://studio-preview.portfolio-demo.pages.dev', Build: buildUrl, Id: 'deadbeef' }]), stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    }), undefined, {
      buildDirectory: f.buildDirectory, configPath: f.configPath,
      healthBudgetMs: 20, healthPollMs: 10, healthRequestMs: 10, sleep: async () => {},
      fetch: async (url, init) => {
        if (String(url).includes('pages.dev')) {
          probes++;
          if (probes === 1) return { ok: false, status: 404, url: String(url) } as Response;
          throw new TypeError('fetch failed');
        }
        return pagesApiFetch(url, init);
      },
    });
    await chooseAccountAndProject(service);
    const publication = await service.publish('preview');
    assert.equal(publication.url, 'https://studio-preview.portfolio-demo.pages.dev/');
    assert.equal(publication.verified, false);
    assert.match(publication.message!, /Cloudflare استقرار را ساخت/);
    assert.match(publication.message!, /پاسخ شبکه دریافت نشد/);
    assert.equal(probes, 3, 'health polling is bounded to the configured total budget');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('successful HTTP response still rejects redirects to unrelated domains', async () => {
  const f = await fixture();
  const previousFetch = globalThis.fetch;
  try {
    const service = createCloudflareService(runnerFor((args) => {
      const auth = authTokenCommand(args); if (auth) return auth;
      if (args[0] === 'whoami') return { code: 0, stdout: whoami, stderr: '' };
      if (args[1] === 'project') return { code: 0, stdout: projectList, stderr: '' };
      if (args[1] === 'deployment') return { code: 0, stdout: args.includes('--environment') ? productionDeployment : JSON.stringify([{ Environment: 'Preview', Branch: 'studio-preview', Status: 'just now', Deployment: 'https://studio-preview.portfolio-demo.pages.dev', Build: buildUrl, Id: 'deadbeef' }]), stderr: '' };
      if (args[1] === 'deploy') return { code: 0, stdout: '', stderr: '', structuredOutput: uploadedOutput('preview') };
      return { code: 0, stdout: '', stderr: '' };
    }), undefined, { buildDirectory: f.buildDirectory, configPath: f.configPath, fetch: async (url, init) => {
      if (String(url).includes('pages.dev')) return { ok: true, url: 'https://evil.example/' } as Response;
      return pagesApiFetch(url, init);
    } });
    await chooseAccountAndProject(service);
    globalThis.fetch = async () => ({ ok: true, url: 'https://evil.example/' } as Response);
    await assert.rejects(service.publish('preview'), /دامنه‌ای دیگر/);
  } finally { globalThis.fetch = previousFetch; await rm(f.directory, { recursive: true, force: true }); }
});

test('status parses authenticated metadata and reads injected configuration path', async () => {
  const f = await fixture();
  try {
    const service = createCloudflareService(runnerFor((args) => {
      if (args[0] === 'whoami') return { code: 0, stdout: whoami, stderr: '' };
      if (args[1] === 'project') return { code: 0, stdout: projectList, stderr: '' };
      if (args[1] === 'deployment') return { code: 0, stdout: productionDeployment, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    }), undefined, { buildDirectory: f.buildDirectory, configPath: f.configPath });
    await service.selectAccount(account.id);
    await service.selectProject('portfolio-demo');
    const status = await service.status();
    assert.equal(status.authenticated, true);
    assert.equal(status.accountId, account.id);
    assert.equal(status.projectName, 'portfolio-demo');
    const loggedOut = createCloudflareService(runnerFor(() => ({ code: 0, stdout: '{"loggedIn":false}', stderr: '' })));
    assert.equal((await loggedOut.status()).authenticated, false);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('Cloudflare errors never expose raw output that may contain credentials', async () => {
  const secret = 'super-secret-example-token';
  const service = createCloudflareService(runnerFor(() => ({ code: 1, stdout: `failed ${secret}`, stderr: `CLOUDFLARE_API_TOKEN=${secret}` })));
  await assert.rejects(service.connect(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(secret));
    assert.ok(!error.message.includes('CLOUDFLARE_API_TOKEN'));
    return true;
  });
});

test('Wrangler commands are bounded, killed, keyring-forced and ignore inherited tokens', async () => {
  const credentialNames = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CF_API_TOKEN', 'CF_API_KEY', 'CF_EMAIL'];
  const previousCredentials = Object.fromEntries(credentialNames.map((name) => [name, process.env[name]]));
  for (const name of credentialNames) process.env[name] = 'test-secret-never-output';
  const signals: string[] = [];
  let childEnv: NodeJS.ProcessEnv | undefined;
  const fakeSpawn = ((_command: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    childEnv = options.env;
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(),
      kill(signal: string) { signals.push(signal); return true; },
    });
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
  try {
    const runner = createWranglerRunner(fakeSpawn, { executablePath: '/isolated/wrangler.js', timeoutMs: 5, killGraceMs: 5 });
    const result = await runner(['whoami', '--json'], account.id);
    assert.equal(result.timedOut, true);
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
    assert.equal(childEnv?.CLOUDFLARE_AUTH_USE_KEYRING, 'true');
    assert.equal(childEnv?.CLOUDFLARE_ACCOUNT_ID, account.id);
    assert.equal(childEnv?.CLOUDFLARE_API_TOKEN, undefined);
    assert.equal(childEnv?.CLOUDFLARE_API_KEY, undefined);
    assert.equal(childEnv?.CLOUDFLARE_EMAIL, undefined);
    assert.equal(childEnv?.CF_API_TOKEN, undefined);
    assert.equal(childEnv?.CF_API_KEY, undefined);
    assert.equal(childEnv?.CF_EMAIL, undefined);
  } finally {
    for (const [name, value] of Object.entries(previousCredentials)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('Wrangler captures structured deployment output only from its temporary result file', async () => {
  const output = JSON.stringify({ type: 'pages-deploy-detailed', pages_project: 'portfolio-demo', deployment_id: 'deadbeef' });
  const fakeSpawn = ((_command: string, _args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }) => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() { return true; } });
    queueMicrotask(async () => {
      await writeFile(options.env?.WRANGLER_OUTPUT_FILE_PATH ?? join(options.cwd, 'missing'), `${output}\n`);
      child.emit('close', 0);
    });
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
  const runner = createWranglerRunner(fakeSpawn, { executablePath: '/isolated/wrangler.js' });
  const result = await runner(['pages', 'deploy']);
  assert.equal(result.structuredOutput, `${output}\n`);
});

test('Pages deploy receives its longer bounded timeout independently of short Wrangler commands', async () => {
  const fakeSpawn = ((_command: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() { return true; } });
    setTimeout(() => child.emit('close', 0), 20);
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
  const runner = createWranglerRunner(fakeSpawn, { executablePath: '/isolated/wrangler.js', timeoutMs: 5, deployTimeoutMs: 100, killGraceMs: 5 });
  const result = await runner(['pages', 'deploy']);
  assert.equal(result.timedOut, false);
});

test('rejects preview if it is configured as production and rejects unsafe artifacts', async () => {
  const f = await fixture();
  try {
    const service = createCloudflareService(runnerFor((args) => {
      if (args[0] === 'whoami') return { code: 0, stdout: whoami, stderr: '' };
      if (args[1] === 'project') return { code: 0, stdout: JSON.stringify([{ 'Project Name': 'portfolio-demo' }]), stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    }), undefined, { buildDirectory: f.buildDirectory, configPath: f.configPath });
    await service.selectAccount(account.id);
    await assert.rejects(service.selectProject('portfolio-demo'), /شاخهٔ اصلی/);
    await validateStaticOutput(f.buildDirectory, f.buildDirectory);
    await writeFile(join(f.buildDirectory, '_worker.js'), 'secret-capable worker');
    await assert.rejects(validateStaticOutput(f.buildDirectory, f.buildDirectory), /امن نیست/);
    await rm(join(f.buildDirectory, '_worker.js'));
    const outside = join(f.directory, 'outside.txt');
    await writeFile(outside, 'outside');
    await symlink(outside, join(f.buildDirectory, 'external.txt'));
    await assert.rejects(validateStaticOutput(f.buildDirectory, f.buildDirectory), /پیوند فایل/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
