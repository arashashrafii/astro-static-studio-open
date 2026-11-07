import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const distDirectory = process.env.STUDIO_ADMIN_DIST_DIR;
const assetsDirectory = process.env.STUDIO_ANDROID_ASSETS_DIR;
if (!distDirectory || !assetsDirectory) throw new Error('Android dashboard output directories must be configured');

execFileSync('npm', ['run', 'build', '-w', 'apps/admin', '--', '--base=/assets/www/', `--outDir=${distDirectory}`, '--emptyOutDir'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, STUDIO_ANDROID_APP: 'true' },
});
await rm(assetsDirectory, { recursive: true, force: true });
await mkdir(path.dirname(assetsDirectory), { recursive: true });
await cp(distDirectory, assetsDirectory, { recursive: true });
const validationDirectory = path.join(path.dirname(assetsDirectory), 'native-validation');
await mkdir(validationDirectory, { recursive: true });
for (const filename of ['content.schema.json', 'content-invariants.json']) {
  await cp(path.join(repoRoot, 'packages/contracts', filename), path.join(validationDirectory, filename));
}
console.log(`Bundled dashboard from ${distDirectory} into Android assets.`);
