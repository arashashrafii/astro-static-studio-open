import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { PublisherInterface } from '@astro-static-studio/contracts';
import { root } from './store.js';
import { buildAndPromote } from './build-output.js';

export const localPublisher: PublisherInterface = {
  id: 'local-static',
  async publish() {
    const outputDirectory = resolve(root, 'apps/site/dist');
    // Keep generated files outside apps/site so Astro's dev watcher does not treat build output as source changes.
    await buildAndPromote(outputDirectory, async (stagingDirectory) => {
      await new Promise<void>((resolveBuild, rejectBuild) => {
        const child = spawn(
          process.platform === 'win32' ? 'npm.cmd' : 'npm',
          ['run', 'build', '-w', 'apps/site', '--', '--outDir', stagingDirectory],
          { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let log = '';
        child.stdout.on('data', (data) => { log = (log + data).slice(-6000); });
        child.stderr.on('data', (data) => { log = (log + data).slice(-6000); });
        child.on('error', rejectBuild);
        child.on('close', (code) => code === 0 ? resolveBuild() : rejectBuild(new Error(log)));
      });
    }, resolve(root, 'apps'));

    return { outputDirectory: 'apps/site/dist', builtAt: new Date().toISOString() };
  },
};
