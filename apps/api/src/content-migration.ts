import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ContentSchema, LegacyContentV1Schema, type Content } from '@astro-static-studio/contracts';
import { migrateV1ToV2 } from '../../../packages/contracts/src/content-migration.js';
import { exportBackup, type BackupPaths } from './backup.js';
import { parseStoredContent } from './store.js';

export interface MigrationPaths extends BackupPaths { backupDirectory?: string; draft?: unknown; }
export interface MigrationResult { content: Content; migrated: boolean; backupFile?: string; draftBackupFile?: string; draft?: ReturnType<typeof migrateV1ToV2>; }

/** Validate the conversion, save a complete V1 recovery bundle, then atomically replace content. */
export async function migrateContentToV2(paths: MigrationPaths): Promise<MigrationResult> {
  const draftInput=paths.draft;
  const current = JSON.parse(await readFile(paths.contentPath,'utf8')) as unknown;
  if (current && typeof current === 'object' && (current as {version?:unknown}).version === 2) {
    const draft=draftInput===undefined?undefined:migrateV1ToV2(LegacyContentV1Schema.parse(draftInput));
    return {content:ContentSchema.parse(parseStoredContent(current)),migrated:false,...(draft?{draft}:{})};
  }
  if (!current || typeof current !== 'object' || (current as {version?:unknown}).version !== 1) {
    throw new Error(`نسخهٔ محتوای سایت پشتیبانی نمی‌شود: ${String((current as {version?:unknown}|null)?.version)}.`);
  }
  const v1 = LegacyContentV1Schema.parse(current);
  const migrated = migrateV1ToV2(v1);
  const backup = await exportBackup(paths);
  const draftV1=draftInput===undefined?undefined:LegacyContentV1Schema.parse(draftInput);
  const migratedDraft=draftV1?migrateV1ToV2(draftV1):undefined;
  const draftBackup=draftV1?await exportBackup(paths,draftV1):undefined;
  const backupDirectory = paths.backupDirectory ?? resolve(dirname(paths.contentPath),'backups');
  await mkdir(backupDirectory,{recursive:true});
  const suffix = `${new Date().toISOString().replaceAll(':','-')}-${randomUUID().slice(0,8)}`;
  const backupName = `before-v2-migration-${suffix}.astro-studio.json`;
  const draftBackupName=draftBackup?`before-v2-migration-draft-${suffix}.astro-studio.json`:undefined;
  const archives=draftBackupName&&draftBackup?[[backupName,backup],[draftBackupName,draftBackup]] as const:[[backupName,backup]] as const;
  const staged:Array<{temporary:string;final:string}>=[];
  const installed:string[]=[];
  try {
    for(const [name,bytes] of archives){
      const final=resolve(backupDirectory,name),temporary=`${final}.${randomUUID()}.tmp`;
      await writeFile(temporary,bytes,{flag:'wx'});
      staged.push({temporary,final});
    }
    for(const file of staged){await rename(file.temporary,file.final);installed.push(file.final);}
  } catch(error) {
    await Promise.all([...staged.map(file=>rm(file.temporary,{force:true})),...installed.map(path=>rm(path,{force:true}))]);
    throw error;
  }

  const contentTemporary = `${paths.contentPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(contentTemporary,JSON.stringify(migrated,null,2),{flag:'wx'});
    await rename(contentTemporary,paths.contentPath);
  } catch(error) {
    await rm(contentTemporary,{force:true});
    throw new Error(`مهاجرت انجام نشد؛ محتوای قبلی دست‌نخورده است و نسخهٔ پشتیبان در ${backupName} قرار دارد. ${error instanceof Error?error.message:''}`);
  }
  return {content:migrated,migrated:true,backupFile:backupName,...(draftBackupName?{draftBackupFile:draftBackupName}:{}),...(migratedDraft?{draft:migratedDraft}:{})};
}
