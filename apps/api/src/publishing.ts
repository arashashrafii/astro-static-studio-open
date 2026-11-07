import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { hash as blake3 } from 'blake3-wasm';
import mime from 'mime-types';
import { root } from './store.js';

const CONFIG_PATH = resolve(root, 'content/cloudflare-publishing.json');
const BUILD_PATH = resolve(root, 'apps/site/dist');
const MAX_FILES = 20_000;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ASSET_BATCH_SIZE = 512 * 1024;
const ASSET_BATCH_FILE_LIMIT = 2_000;
const PAGES_API = 'https://api.cloudflare.com/client/v4';
const PAGES_API_TIMEOUT_MS = 30_000;
const PAGES_ASSET_UPLOAD_TIMEOUT_MS = 120_000;
const PAGES_PREUPLOAD_TIMEOUT_MS = 20 * 60_000;
const PAGES_API_ATTEMPTS = 3;
const DEPLOYMENT_HEALTH_BUDGET_MS = 60_000;
const DEPLOYMENT_HEALTH_POLL_MS = 10_000;
const DEPLOYMENT_HEALTH_REQUEST_MS = 10_000;
const PROJECT_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const BRANCH_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,99}$/;
const PREVIEW_BRANCH = 'studio-preview';

export interface CommandResult { code: number | null; stdout: string; stderr: string; timedOut?: boolean; structuredOutput?: string; }
export type CommandRunner = (args: string[], accountId?: string) => Promise<CommandResult>;
export interface StaticUploadProvider {
  upload(directory: string, project: CloudflareProject, environment: 'preview' | 'production'): Promise<string | { url: string; verified: boolean; message?: string }>;
}
export interface CloudflareAccount { id: string; name: string; }
export interface CloudflareProject { name: string; productionBranch: string; }
type Spawn = typeof nodeSpawn;

function cleanEnvironment(accountId?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^(CLOUDFLARE_|CF_(?:ACCOUNT_ID|API_TOKEN|API_KEY|EMAIL)$|WRANGLER_|npm_config_|NODE_OPTIONS$|NODE_PATH$)/i.test(name)) delete env[name];
  }
  if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;
  env.CLOUDFLARE_AUTH_USE_KEYRING = 'true';
  env.WRANGLER_SEND_METRICS = 'false';
  return env;
}

export function createWranglerRunner(spawn: Spawn = nodeSpawn, options: { executablePath?: string; timeoutMs?: number; loginTimeoutMs?: number; deployTimeoutMs?: number; killGraceMs?: number } = {}): CommandRunner {
  const require = createRequire(import.meta.url);
  return async (args, accountId) => {
    let executable: string;
    if (options.executablePath) executable = options.executablePath;
    else try { executable = resolve(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js'); }
    catch { throw new Error('ابزار انتشار Wrangler نصب نشده است. وابستگی‌های Studio را نصب و دوباره اجرا کنید.'); }
    const cwd = await mkdtemp(join(tmpdir(), 'astro-studio-wrangler-'));
    // A Pages upload can spend several minutes transferring files; keep it bounded, but
    // do not apply the short metadata-command deadline to the actual deployment.
    const timeoutMs = args[0] === 'login' ? options.loginTimeoutMs ?? 5 * 60_000
      : args[0] === 'pages' && args[1] === 'deploy' ? options.deployTimeoutMs ?? 10 * 60_000
        : options.timeoutMs ?? 60_000;
    try {
      return await new Promise<CommandResult>((resolveResult, reject) => {
        const env = cleanEnvironment(accountId);
        const outputPath = join(cwd, 'wrangler-output.ndjson');
        env.WRANGLER_OUTPUT_FILE_PATH = outputPath;
        const child = spawn(process.execPath, [executable, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;
        const finish = (result: CommandResult) => { if (!settled) { settled = true; clearTimeout(timer); resolveResult({ ...result, timedOut }); } };
        child.stdout?.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-24_000); });
        child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-24_000); });
        child.once('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
        child.once('close', (code) => {
          void readFile(outputPath, 'utf8').catch(() => '').then((structuredOutput) => finish({ code, stdout, stderr, structuredOutput }));
        });
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          const killTimer = setTimeout(() => {
            if (!settled) {
              child.kill('SIGKILL');
              finish({ code: null, stdout, stderr });
            }
          }, options.killGraceMs ?? 2_000);
          killTimer.unref();
        }, timeoutMs);
        timer.unref();
      });
    } finally { await rm(cwd, { recursive: true, force: true }); }
  };
}

function validateProjectName(value: unknown): string {
  if (typeof value !== 'string' || !PROJECT_NAME.test(value)) throw new Error('نام پروژه باید فقط شامل حروف کوچک انگلیسی، عدد و خط تیره باشد.');
  return value;
}
function validateId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/i.test(value)) throw new Error('حساب Cloudflare انتخاب‌شده معتبر نیست.');
  return value;
}
function validateBranch(value: unknown): string {
  if (typeof value !== 'string' || !BRANCH_NAME.test(value) || value.includes('..') || value.includes('//')) throw new Error('شاخهٔ اصلی پروژه قابل استفاده نیست.');
  return value;
}
function safeMessage(result: CommandResult, fallback: string): string {
  if (result.timedOut) return 'فرمان Cloudflare بیش از زمان مجاز طول کشید و متوقف شد. دوباره تلاش کنید.';
  const combined = `${result.stderr}\n${result.stdout}`.toLowerCase();
  if (/keyring|keychain|secret-tool|credential manager/.test(combined)) return 'دسترسی به مخزن امن سیستم ممکن نیست. آن را آماده کنید و دوباره تلاش کنید؛ اطلاعات ورود به‌صورت متنی ذخیره نمی‌شود.';
  if (/not logged in|authentication|unauthorized|forbidden|oauth/.test(combined)) return 'اجازهٔ Cloudflare تأیید نشد. دوباره اتصال را انجام دهید و دسترسی Pages را بررسی کنید.';
  if (/not found|does not exist|no such project/.test(combined)) return 'پروژهٔ انتخاب‌شده در Cloudflare پیدا نشد. فهرست پروژه‌ها را تازه کنید.';
  if (/notice to agents:.*(?:delegation|latest version of cloudflare pages).*failed/i.test(combined)) return 'Wrangler تلاش کرد این عملیات Pages را به Workers واگذار کند و آن مسیر ناموفق شد. Studio از انتشار مستقیم Pages استفاده می‌کند؛ دوباره تلاش کنید.';
  if (/already exists|already in use|duplicate/.test(combined)) return 'این نام پروژه از قبل استفاده شده است. نام دیگری انتخاب کنید یا فهرست پروژه‌ها را تازه کنید.';
  const cloudflareCode = combined.match(/(?:error\s+code|code)\s*[:=]?\s*(\d{3,7})\b/i)?.[1];
  const diagnostic = ` (کد خروج Wrangler: ${result.code ?? 'نامشخص'}${cloudflareCode ? `؛ کد خطای Cloudflare: ${cloudflareCode}` : ''})`;
  return `${fallback}${diagnostic}`;
}
function parseJsonOutput(result: CommandResult, fallback: string): unknown {
  if (result.code !== 0) throw new Error(safeMessage(result, fallback));
  try { return JSON.parse(result.stdout.trim()); } catch { throw new Error(fallback); }
}
function parseAccounts(result: CommandResult): CloudflareAccount[] {
  const parsed = parseJsonOutput(result, 'وضعیت ورود Cloudflare قابل خواندن نبود.');
  if (!parsed || typeof parsed !== 'object' || (parsed as { loggedIn?: unknown }).loggedIn !== true) return [];
  const accounts = (parsed as { accounts?: unknown }).accounts;
  if (!Array.isArray(accounts)) return [];
  return accounts.filter((item): item is { id: string; name: string } => !!item && typeof item === 'object'
      && typeof (item as { id?: unknown }).id === 'string' && /^[a-f0-9]{32}$/i.test((item as { id: string }).id)
      && typeof (item as { name?: unknown }).name === 'string')
    .map(({ id, name }) => ({ id, name }));
}
function parseProjectList(result: CommandResult): CloudflareProject[] {
  const parsed = parseJsonOutput(result, 'فهرست پروژه‌های Cloudflare قابل خواندن نبود.');
  if (!Array.isArray(parsed)) throw new Error('فهرست پروژه‌های Cloudflare قابل خواندن نبود.');
  return parsed.filter((item): item is { 'Project Name': string } => !!item && typeof item === 'object'
      && typeof (item as { 'Project Name'?: unknown })['Project Name'] === 'string'
      && PROJECT_NAME.test((item as { 'Project Name': string })['Project Name']))
    .map(({ 'Project Name': name }) => ({ name, productionBranch: '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
interface PublishingConfig { accountId?: string; project?: CloudflareProject; }
async function readConfig(configPath = CONFIG_PATH): Promise<PublishingConfig> {
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return {};
    const value = parsed as { accountId?: unknown; project?: { name?: unknown; productionBranch?: unknown } };
    const config: PublishingConfig = {};
    if (typeof value.accountId === 'string' && /^[a-f0-9]{32}$/i.test(value.accountId)) config.accountId = value.accountId;
    if (value.project && typeof value.project.name === 'string' && PROJECT_NAME.test(value.project.name)
      && typeof value.project.productionBranch === 'string' && BRANCH_NAME.test(value.project.productionBranch)) {
      config.project = { name: value.project.name, productionBranch: value.project.productionBranch };
    }
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('تنظیمات انتشار محلی قابل خواندن نیست.');
    return {};
  }
}
async function saveConfig(config: PublishingConfig, configPath = CONFIG_PATH): Promise<void> {
  await mkdir(resolve(configPath, '..'), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export async function validateStaticOutput(directory = BUILD_PATH, expectedDirectory = BUILD_PATH): Promise<void> {
  const rootInfo = await lstat(directory).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('ابتدا یک پوشهٔ خروجی استاتیک بسازید؛ پیوند یا فایل جایگزین پذیرفته نمی‌شود.');
  const expected = await realpath(expectedDirectory).catch(() => null);
  const actual = await realpath(directory).catch(() => null);
  if (!expected || actual !== expected) throw new Error('ابتدا یک خروجی موفق بسازید؛ فایل‌های سایت روی دستگاه شما باقی می‌مانند.');
  let count = 0;
  async function visit(folder: string): Promise<void> {
    for (const name of await readdir(folder)) {
      if (name === '_worker.js' || name === 'functions' || /^\.env(?:\.|$)/i.test(name)) throw new Error('خروجی شامل فایل اجرایی یا تنظیم حساس است و برای انتشار استاتیک امن نیست.');
      const path = join(folder, name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('خروجی شامل پیوند فایل است و برای انتشار پذیرفته نمی‌شود.');
      if (info.isDirectory()) await visit(path);
      else if (info.isFile()) {
        count++;
        if (count > MAX_FILES) throw new Error('تعداد فایل‌های سایت از حد Cloudflare بیشتر است.');
        if (info.size > MAX_FILE_SIZE) throw new Error(`حجم فایل «${basename(path)}» از حد Cloudflare بیشتر است.`);
      } else throw new Error('خروجی شامل نوع فایل پشتیبانی‌نشده است.');
    }
  }
  await visit(actual);
  if (count === 0) throw new Error('خروجی سایت خالی است؛ ابتدا سایت را بسازید.');
}

interface PagesAsset { relativePath: string; path: string; size: number; hash: string; contentType: string; }
type Fetcher = typeof fetch;

/** Matches Wrangler 4.149's Pages asset identity: BLAKE3(base64(contents) + extension), first 32 hex chars. */
export function pagesAssetHash(contents: Buffer | Uint8Array, relativePath: string): string {
  const extension = extname(relativePath).slice(1);
  return blake3(`${Buffer.from(contents).toString('base64')}${extension}`).toString('hex').slice(0, 32);
}

async function listPagesAssets(directory: string): Promise<PagesAsset[]> {
  const assets: PagesAsset[] = [];
  const isWranglerIgnored = (relativePath: string) => {
    const segments = relativePath.split('/');
    return ['_redirects', '_headers', '_routes.json', '.wrangler'].includes(relativePath)
      || relativePath.startsWith('.wrangler/')
      || segments.some((segment) => segment === '.DS_Store' || segment === 'node_modules' || segment === '.git');
  };
  async function visit(folder: string): Promise<void> {
    for (const name of await readdir(folder)) {
      const path = join(folder, name);
      const info = await lstat(path);
      const relativePath = path.slice(directory.length + 1).split(/[\\/]/).join('/');
      if (isWranglerIgnored(relativePath)) continue;
      if (info.isDirectory()) await visit(path);
      else if (info.isFile()) {
        assets.push({
          relativePath,
          path,
          size: info.size,
          hash: pagesAssetHash(await readFile(path), relativePath),
          contentType: mime.lookup(relativePath) || 'application/octet-stream',
        });
      }
    }
  }
  await visit(directory);
  return assets;
}

function cloudflareResult(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || (payload as { success?: unknown }).success !== true) {
    throw new Error('Cloudflare درخواست بارگذاری فایل را نپذیرفت. اتصال و دسترسی Pages را بررسی کنید.');
  }
  return (payload as { result?: unknown }).result;
}

async function fetchPagesApi(fetcher: Fetcher, url: string, init: RequestInit, deadline: number, timeoutMs = PAGES_API_TIMEOUT_MS): Promise<unknown> {
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt < PAGES_API_ATTEMPTS; attempt++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error('بارگذاری فایل‌های سایت از مهلت مجاز گذشت؛ وضعیت Pages را بررسی کنید و سپس دوباره تلاش کنید.');
    let response: Response;
    try {
      response = await fetcher(url, { ...init, signal: AbortSignal.timeout(Math.min(timeoutMs, remainingMs)) });
    } catch {
      if (attempt + 1 === PAGES_API_ATTEMPTS) throw new Error('بارگذاری امن فایل‌ها به Cloudflare کامل نشد؛ اتصال را بررسی و دوباره تلاش کنید.');
      await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(250 * (attempt + 1), remainingMs)));
      continue;
    }
    lastStatus = response.status;
    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500) && attempt + 1 < PAGES_API_ATTEMPTS) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(250 * (attempt + 1), remainingMs)));
        continue;
      }
      throw new Error(`Cloudflare درخواست بارگذاری فایل را نپذیرفت (HTTP ${response.status}). دسترسی Pages را بررسی کنید.`);
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new Error('پاسخ سرویس فایل Cloudflare قابل خواندن نبود.'); }
    return cloudflareResult(payload);
  }
  throw new Error(`بارگذاری فایل‌ها کامل نشد (HTTP ${lastStatus ?? 'نامشخص'}). دوباره تلاش کنید.`);
}

function oauthTokenFrom(result: CommandResult): string {
  if (result.code !== 0 || result.timedOut) throw new Error('دسترسی امن Cloudflare برای بارگذاری فایل‌ها آماده نیست؛ اتصال را دوباره بررسی کنید.');
  try {
    const parsed: unknown = JSON.parse(result.stdout.trim());
    if (parsed && typeof parsed === 'object' && (parsed as { type?: unknown }).type === 'oauth'
      && typeof (parsed as { token?: unknown }).token === 'string' && (parsed as { token: string }).token.length > 0) {
      return (parsed as { token: string }).token;
    }
  } catch { /* Never include auth command output in an error. */ }
  throw new Error('برای بارگذاری فایل‌ها باید به Cloudflare با ورود امن متصل شوید.');
}

async function preuploadPagesAssets(runner: CommandRunner, fetcher: Fetcher, directory: string, project: CloudflareProject, accountId: string): Promise<void> {
  const authResult = await runner(['auth', 'token', '--json'], accountId);
  const oauthToken = oauthTokenFrom(authResult);
  // This budget covers local file hashing and the Pages API preupload sequence, after
  // Wrangler has returned the in-memory OAuth credential.
  const deadline = Date.now() + PAGES_PREUPLOAD_TIMEOUT_MS;
  const projectPath = `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(project.name)}`;
  const uploadTokenResult = await fetchPagesApi(fetcher, `${PAGES_API}${projectPath}/upload-token`, {
    headers: { Authorization: `Bearer ${oauthToken}` },
  }, deadline);
  const jwt = uploadTokenResult && typeof uploadTokenResult === 'object' && typeof (uploadTokenResult as { jwt?: unknown }).jwt === 'string'
    ? (uploadTokenResult as { jwt: string }).jwt : null;
  if (!jwt) throw new Error('Cloudflare کلید موقت بارگذاری Pages را برنگرداند؛ دوباره اتصال را بررسی کنید.');
  const assets = await listPagesAssets(directory);
  const uniqueAssets = [...new Map(assets.map((asset) => [asset.hash, asset])).values()];
  const headers = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
  const missingResult = await fetchPagesApi(fetcher, `${PAGES_API}/pages/assets/check-missing`, {
    method: 'POST', headers, body: JSON.stringify({ hashes: uniqueAssets.map((asset) => asset.hash) }),
  }, deadline);
  if (!Array.isArray(missingResult) || missingResult.some((hash) => typeof hash !== 'string' || !uniqueAssets.some((asset) => asset.hash === hash))) {
    throw new Error('فهرست فایل‌های موردنیاز Cloudflare قابل بررسی نبود؛ انتشار متوقف شد.');
  }
  const missing = new Set(missingResult);
  const pending = uniqueAssets.filter((asset) => missing.has(asset.hash));
  const batches: PagesAsset[][] = [];
  for (let index = 0; index < pending.length;) {
    const batch: PagesAsset[] = [];
    let rawBytes = 0;
    while (index < pending.length && batch.length < ASSET_BATCH_FILE_LIMIT
      && (batch.length === 0 || rawBytes + pending[index].size <= ASSET_BATCH_SIZE)) {
      const asset = pending[index++];
      batch.push(asset);
      rawBytes += asset.size;
    }
    batches.push(batch);
  }
  let completedFiles = uniqueAssets.length - pending.length;
  for (const [batchIndex, batch] of batches.entries()) {
    const payload = await Promise.all(batch.map(async (asset) => ({
      base64: true,
      key: asset.hash,
      metadata: { contentType: asset.contentType },
      value: (await readFile(asset.path)).toString('base64'),
    })));
    const encodedBytes = payload.reduce((total, asset) => total + Buffer.byteLength(asset.value), 0);
    const batchStartedAt = Date.now();
    await fetchPagesApi(fetcher, `${PAGES_API}/pages/assets/upload`, {
      method: 'POST', headers, body: JSON.stringify(payload),
    }, deadline, PAGES_ASSET_UPLOAD_TIMEOUT_MS);
    await fetchPagesApi(fetcher, `${PAGES_API}/pages/assets/upsert-hashes`, {
      method: 'POST', headers, body: JSON.stringify({ hashes: batch.map((asset) => asset.hash) }),
    }, deadline);
    completedFiles += batch.length;
    console.info(JSON.stringify({
      event: 'pages-assets-upload-batch',
      batch: batchIndex + 1,
      batchCount: batches.length,
      filesInBatch: batch.length,
      completedFiles,
      totalFiles: uniqueAssets.length,
      encodedAssetBytes: encodedBytes,
      elapsedMs: Date.now() - batchStartedAt,
    }));
  }
}

export function deploymentUrl(project: CloudflareProject, environment: 'preview' | 'production', result: CommandResult, accountId: string, deploymentId: string): string {
  const parsed = parseJsonOutput(result, 'اطلاعات انتشار Cloudflare قابل بررسی نبود.');
  if (!Array.isArray(parsed)) throw new Error('اطلاعات انتشار Cloudflare قابل بررسی نبود.');
  const branch = environment === 'preview' ? PREVIEW_BRANCH : project.productionBranch;
  const expectedEnvironment = environment === 'production' ? 'Production' : 'Preview';
  const match = parsed.find((item) => item && typeof item === 'object'
    && (item as { Id?: unknown }).Id === deploymentId
    && (item as { Branch?: unknown }).Branch === branch
    && (item as { Environment?: unknown }).Environment === expectedEnvironment
    && isSuccessfulDeploymentStatus((item as { Status?: unknown }).Status)
    && typeof (item as { Deployment?: unknown }).Deployment === 'string'
    && deploymentBelongsTo(item as { Build?: unknown }, project.name, accountId));
  if (!match) throw new Error('Cloudflare پاسخ انتشار برای پروژه و شاخهٔ انتخاب‌شده نداد؛ انتشار تأیید نشده است.');
  const url = new URL((match as { Deployment: string }).Deployment);
  const exactBranchAlias = environment === 'preview' && url.hostname === `${PREVIEW_BRANCH}.${project.name}.pages.dev`;
  const projectDeploymentHost = new RegExp(`^[a-f0-9]{8,64}\\.${project.name}\\.pages\\.dev$`, 'i').test(url.hostname);
  const productionHost = environment === 'production' && url.hostname === `${project.name}.pages.dev`;
  if (url.protocol !== 'https:' || !(exactBranchAlias || projectDeploymentHost || productionHost) || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('Cloudflare نشانی‌ای بیرون از پروژه و شاخهٔ انتخاب‌شده برگرداند؛ انتشار تأیید نشده است.');
  }
  return url.toString();
}

function uploadedDeploymentId(result: CommandResult, project: CloudflareProject, environment: 'preview' | 'production'): string {
  if (result.timedOut) throw new Error('بارگذاری Pages در مهلت انتظار تمام نشد؛ وضعیت استقرار را در Cloudflare بررسی کنید، سپس دوباره تلاش کنید.');
  if (!result.structuredOutput) throw new Error('Wrangler تأییدیهٔ انتشار Pages را برنگرداند؛ انتشار تأیید نشده است. وضعیت پروژه را در Cloudflare بررسی کنید.');
  const entries = result.structuredOutput.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as unknown]; } catch { return []; }
  });
  const output = entries.filter((item): item is {
    type: string;
    pages_project?: unknown;
    environment?: unknown;
    production_branch?: unknown;
    deployment_id?: unknown;
  } => !!item && typeof item === 'object' && (item as { type?: unknown }).type === 'pages-deploy-detailed')
    .map((item) => ({
      item,
      projectMatches: item.pages_project === project.name,
      environmentMatches: item.environment === environment,
      productionBranchMatches: item.production_branch === project.productionBranch,
      deploymentId: typeof item.deployment_id === 'string' && /^[a-f0-9-]{8,64}$/i.test(item.deployment_id),
    }));
  const matched = output.find((candidate) => candidate.projectMatches && candidate.environmentMatches
    && candidate.productionBranchMatches && candidate.deploymentId);
  if (!matched) {
    const expectedEnvironment = environment === 'preview' ? 'preview' : 'production';
    const diagnostics = output.map((candidate) => ({
      projectMatches: candidate.projectMatches,
      environment: candidate.item.environment === 'preview' || candidate.item.environment === 'production' ? candidate.item.environment : 'unexpected',
      environmentMatches: candidate.environmentMatches,
      productionBranchMatches: candidate.productionBranchMatches,
      deploymentIdValid: candidate.deploymentId,
    }));
    const outputTypes = [...new Set(entries.map((item) => {
      const type = item && typeof item === 'object' ? (item as { type?: unknown }).type : undefined;
      return typeof type === 'string' && ['pages-deploy-detailed', 'pages-deploy', 'deploy', 'version-deploy', 'wrangler-session'].includes(type) ? type : 'other';
    }))];
    const outputText = `${result.stdout}\n${result.stderr}`.toLowerCase();
    const safeMarkers = [
      /delegating to .*workers/.test(outputText) && 'delegated-to-workers',
      /deployment complete!/.test(outputText) && 'deployment-complete',
      /couldn't ascertain the final status/.test(outputText) && 'final-status-unavailable',
      /project .* does not exist|pages project .* not found/.test(outputText) && 'pages-project-not-found',
      /not logged in|authentication|unauthorized|forbidden|oauth/.test(outputText) && 'authentication-rejected',
      /keyring|keychain|secret-tool|credential manager/.test(outputText) && 'keyring-unavailable',
      /error code\s*[:=]?\s*\d{3,7}/.test(outputText) && 'cloudflare-error-code-present',
    ].filter((marker): marker is string => typeof marker === 'string');
    const expected = output.length ? `Expected ${expectedEnvironment} for selected project and its configured production branch; provider result type(s): ${outputTypes.join(', ') || 'none'}; safe field checks: ${JSON.stringify(diagnostics)}.`
      : `Expected pages-deploy-detailed output; provider result type(s): ${outputTypes.join(', ') || 'none'}; received ${entries.length} parseable structured item(s).`;
    console.error(JSON.stringify({ event: 'wrangler-pages-deployment-metadata-mismatch', exitCode: result.code, safeMarkers, expected }));
    if (output.length && output.some((candidate) => !candidate.projectMatches)) throw new Error('Wrangler پاسخ پروژهٔ انتخاب‌شده را برنگرداند؛ انتشار تأیید نشد. حساب و پروژه را بررسی کنید.');
    if (output.length && output.some((candidate) => !candidate.environmentMatches)) throw new Error('Wrangler نوع انتشار متفاوتی برگرداند؛ انتشار تأیید نشد. دوباره تلاش کنید و نتیجه را بررسی کنید.');
    if (output.length && output.some((candidate) => !candidate.productionBranchMatches)) throw new Error('شاخهٔ اصلی که Cloudflare برای پروژه برگرداند با انتخاب ذخیره‌شده یکی نیست؛ انتشار تأیید نشد. فهرست پروژه‌ها را تازه و پروژه را دوباره انتخاب کنید.');
    if (output.length && output.some((candidate) => !candidate.deploymentId)) throw new Error('Wrangler شناسهٔ معتبر انتشار را برنگرداند؛ انتشار تأیید نشد.');
    throw new Error('Wrangler تأییدیهٔ انتشار Pages را برنگرداند؛ انتشار تأیید نشده است. وضعیت پروژه را در Cloudflare بررسی کنید.');
  }
  const outputItem = matched.item;
  return outputItem.deployment_id as string;
}

function deploymentBelongsTo(item: { Build?: unknown }, projectName: string, accountId: string): boolean {
  if (typeof item.Build !== 'string') return false;
  try {
    const build = new URL(item.Build);
    const parts = build.pathname.split('/');
    return build.protocol === 'https:' && build.hostname === 'dash.cloudflare.com' && parts.length === 6
      && parts[0] === '' && parts[1] === accountId && parts[2] === 'pages' && parts[3] === 'view'
      && parts[4] === projectName && /^[a-f0-9-]{8,64}$/i.test(parts[5]);
  } catch { return false; }
}

function isSuccessfulDeploymentStatus(value: unknown): boolean {
  return typeof value === 'string' && /^(?:just now|(?:(?:about|almost|over)\s+)?(?:a|an|\d+)\s+(?:few\s+)?(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago)$/i.test(value);
}

export function createCloudflareService(runner: CommandRunner = createWranglerRunner(), provider?: StaticUploadProvider, options: { buildDirectory?: string; configPath?: string; fetch?: Fetcher; healthBudgetMs?: number; healthPollMs?: number; healthRequestMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {
  const buildDirectory = options.buildDirectory ?? BUILD_PATH;
  const configPath = options.configPath ?? CONFIG_PATH;
  const fetcher = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms)));
  const uploadProvider = provider ?? {
    async upload(directory: string, project: CloudflareProject, environment: 'preview' | 'production') {
      const config = await readConfig(configPath);
      if (!config.accountId) throw new Error('ابتدا حساب Cloudflare را انتخاب کنید.');
      await preuploadPagesAssets(runner, fetcher, directory, project, config.accountId);
      const branch = environment === 'preview' ? PREVIEW_BRANCH : project.productionBranch;
      const result = await runner(['pages', 'deploy', directory, '--project-name', project.name, '--branch', branch, '--no-bundle', '--force'], config.accountId);
      if (result.code !== 0) throw new Error(safeMessage(result, 'بارگذاری در Cloudflare ناموفق بود. خروجی محلی شما حفظ شده است.'));
      const id = uploadedDeploymentId(result, project, environment);
      const list = await runner(['pages', 'deployment', 'list', '--project-name', project.name, '--json'], config.accountId);
      const url = deploymentUrl(project, environment, list, config.accountId!, id);
      const healthBudgetMs = options.healthBudgetMs ?? DEPLOYMENT_HEALTH_BUDGET_MS;
      const healthPollMs = options.healthPollMs ?? DEPLOYMENT_HEALTH_POLL_MS;
      const deadline = Date.now() + healthBudgetMs;
      const maxAttempts = Math.max(1, Math.floor(healthBudgetMs / healthPollMs) + 1);
      let lastHttpStatus: number | null = null;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const response = await fetcher(url, { signal: AbortSignal.timeout(Math.min(options.healthRequestMs ?? DEPLOYMENT_HEALTH_REQUEST_MS, remaining)), redirect: 'follow' }).catch(() => null);
        if (response) {
          const finalUrl = new URL(response.url || url);
          if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== new URL(url).hostname || finalUrl.username || finalUrl.password || finalUrl.port) {
            throw new Error('نشانی انتشار به دامنه‌ای دیگر منتقل شد؛ انتشار تأیید نشده است.');
          }
          if (response.ok) return { url: finalUrl.toString(), verified: true };
          lastHttpStatus = response.status;
          if (![404, 408, 429].includes(response.status) && (response.status < 500 || response.status >= 600)) break;
        } else lastHttpStatus = null;
        if (attempt + 1 >= maxAttempts) break;
        const pause = Math.min(healthPollMs, deadline - Date.now());
        if (pause > 0) await sleep(pause);
      }
      const reason = lastHttpStatus === null ? 'پاسخ شبکه دریافت نشد' : `پاسخ HTTP ${lastHttpStatus}`;
      return { url, verified: false, message: `Cloudflare استقرار را ساخت، اما دسترسی عمومی پس از چند تلاش تأیید نشد (${reason}). نشانی آماده است؛ کمی بعد دوباره آن را باز کنید.` };
    },
  } satisfies StaticUploadProvider;

  async function selectedAccount(): Promise<string> {
    const id = (await readConfig(configPath)).accountId;
    if (!id) throw new Error('ابتدا حساب Cloudflare را انتخاب کنید.');
    return id;
  }
  return {
    async status() {
      const result = await runner(['whoami', '--json']);
      const accounts = result.code === 0 ? parseAccounts(result) : [];
      const config = await readConfig(configPath);
      let accountId = accounts.some((account) => account.id === config.accountId) ? config.accountId! : null;
      if (accounts.length === 1 && accountId !== accounts[0].id) {
        accountId = accounts[0].id;
        await saveConfig({ accountId }, configPath);
      }
      return {
        authenticated: accounts.length > 0,
        accounts,
        accountId,
        projectName: accountId === config.accountId ? config.project?.name ?? null : null,
      };
    },
    async connect() {
      const result = await runner(['login', '--use-keyring', '--scopes', 'account:read', 'pages:write']);
      if (result.code !== 0) throw new Error(safeMessage(result, 'اتصال Cloudflare کامل نشد. خروجی ورود مخفی نگه داشته شد.'));
    },
    async disconnect() {
      const result = await runner(['logout']);
      if (result.code !== 0) throw new Error(safeMessage(result, 'خروج از Cloudflare کامل نشد.'));
      await saveConfig({}, configPath);
    },
    async selectAccount(value: unknown) {
      const accountId = validateId(value);
      const accounts = parseAccounts(await runner(['whoami', '--json']));
      if (!accounts.some((account) => account.id === accountId)) throw new Error('این حساب در ورود فعلی Cloudflare نیست.');
      await saveConfig({ accountId }, configPath);
      return { accountId };
    },
    async projects() {
      const accountId = await selectedAccount();
      const projects = parseProjectList(await runner(['pages', 'project', 'list', '--json'], accountId));
      const withBranches: CloudflareProject[] = [];
      for (const item of projects) {
        const deploymentList = await runner(['pages', 'deployment', 'list', '--project-name', item.name, '--environment', 'production', '--json'], accountId);
        const rows = parseJsonOutput(deploymentList, 'اطلاعات شاخهٔ اصلی پروژه قابل خواندن نبود.');
        if (!Array.isArray(rows)) continue;
        const latestSuccessful = rows.find((row) => row && typeof row === 'object'
          && (row as { Environment?: unknown }).Environment === 'Production'
          && isSuccessfulDeploymentStatus((row as { Status?: unknown }).Status)
          && typeof (row as { Branch?: unknown }).Branch === 'string');
        if (!latestSuccessful) continue;
        const productionBranch = validateBranch((latestSuccessful as { Branch: string }).Branch);
        if (productionBranch !== PREVIEW_BRANCH) withBranches.push({ name: item.name, productionBranch });
      }
      const config = await readConfig(configPath);
      if (config.accountId === accountId && config.project && !withBranches.some((project) => project.name === config.project!.name)) {
        withBranches.push(config.project);
      }
      return withBranches;
    },
    async selectProject(value: unknown) {
      const name = validateProjectName(value);
      const accountId = await selectedAccount();
      const project = (await this.projects()).find((candidate) => candidate.name === name);
      if (!project) throw new Error('این پروژه در فهرست Cloudflare نیست. ابتدا فهرست را تازه کنید.');
      if (project.productionBranch === PREVIEW_BRANCH) throw new Error('شاخهٔ اصلی پروژه با شاخهٔ پیش‌نمایش Studio یکی است؛ این پروژه برای انتشار امن پیش‌نمایش پشتیبانی نمی‌شود.');
      await saveConfig({ accountId, project }, configPath);
      return { projectName: project.name, productionBranch: project.productionBranch };
    },
    async createProject(value: unknown) {
      const name = validateProjectName(value);
      const accountId = await selectedAccount();
      const productionBranch = 'main';
      const result = await runner(['pages', 'project', 'create', name, '--production-branch', productionBranch, '--force'], accountId);
      if (result.code !== 0) throw new Error(safeMessage(result, 'ساخت پروژهٔ Cloudflare ناموفق بود.'));
      const project = { name, productionBranch };
      await saveConfig({ accountId, project }, configPath);
      return { projectName: name, productionBranch };
    },
    async publish(environment: 'preview' | 'production') {
      if (environment !== 'preview' && environment !== 'production') throw new Error('نوع انتشار نامعتبر است.');
      const config = await readConfig(configPath);
      if (!config.accountId) throw new Error('ابتدا حساب Cloudflare را انتخاب کنید.');
      if (!config.project) throw new Error('ابتدا پروژهٔ Cloudflare را انتخاب کنید یا پروژه‌ای بسازید.');
      await validateStaticOutput(buildDirectory, buildDirectory);
      const uploaded = await uploadProvider.upload(buildDirectory, config.project, environment);
      const result = typeof uploaded === 'string' ? { url: uploaded, verified: true } : uploaded;
      return { ...result, environment, projectName: config.project.name, publishedAt: new Date().toISOString() };
    },
  };
}

export const cloudflarePublishing = createCloudflareService();
