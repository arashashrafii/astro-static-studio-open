import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export async function buildAndPromote(
  outputDirectory: string,
  build: (stagingDirectory: string) => Promise<void>,
  stagingParentDirectory = dirname(outputDirectory),
): Promise<void> {
  const outputName = basename(outputDirectory);
  const stagingDirectory = join(stagingParentDirectory, `.${outputName}.staging-${randomUUID()}`);
  const backupDirectory = join(stagingParentDirectory, `.${outputName}.backup-${randomUUID()}`);
  let hasBackup = false;

  await mkdir(stagingParentDirectory, { recursive: true });

  try {
    await build(stagingDirectory);

    try {
      await rename(outputDirectory, backupDirectory);
      hasBackup = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    try {
      await rename(stagingDirectory, outputDirectory);
    } catch (error) {
      if (hasBackup) {
        try {
          await rename(backupDirectory, outputDirectory);
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            `Could not install the new site or restore the previous output at ${backupDirectory}`,
          );
        }
      }
      throw error;
    }

    if (hasBackup) {
      await rm(backupDirectory, { recursive: true, force: true }).catch((error: unknown) => {
        console.warn(`New site is ready, but old build cleanup failed at ${backupDirectory}`, error);
      });
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}
