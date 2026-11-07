import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { ContentSchema, LegacyContentV1Schema } from '../packages/contracts/src/index.js';
import { importContent } from '../packages/contracts/src/content-migration.js';

const root = new URL('../packages/contracts/', import.meta.url);

test('checked-in Draft-07 schema is generated from the public canonical ContentSchema', async () => {
  const schema = JSON.parse(await readFile(new URL('content.schema.json', root), 'utf8'));
  assert.deepEqual(schema, z.toJSONSchema(ContentSchema, { target: 'draft-7', io: 'input' }));
});

test('native differential vectors match canonical Zod acceptance, including cross-record rules', async () => {
  const vectors = JSON.parse(await readFile(new URL('content-schema-vectors.json', root), 'utf8')) as {
    contentSchemaVersion: number;
    accepted: Array<{name:string;content:unknown}>;
    rejected: Array<{name:string;content:unknown}>;
  };
  assert.equal(vectors.contentSchemaVersion, 2);
  assert.ok(vectors.accepted.some(vector => vector.name.includes('rich-text')));
  assert.ok(vectors.rejected.some(vector => vector.name === 'duplicate-record-id'));
  assert.ok(vectors.rejected.some(vector => vector.name === 'page-and-collection-route-collision'));
  assert.ok(vectors.rejected.some(vector => vector.name === 'stale-category-reference'));
  for (const vector of vectors.accepted) {
    assert.equal(ContentSchema.safeParse(vector.content).success, true, vector.name);
  }
  for (const vector of vectors.rejected) {
    assert.equal(ContentSchema.safeParse(vector.content).success, false, vector.name);
  }
});

test('old documents enter only through the explicit legacy importer', async () => {
  const legacy = JSON.parse(await readFile(new URL('./fixtures/content-v1.json', import.meta.url), 'utf8'));
  assert.equal(LegacyContentV1Schema.safeParse(legacy).success, true);
  assert.equal(ContentSchema.safeParse(legacy).success, false);
  assert.equal(ContentSchema.safeParse(importContent(legacy)).success, true);
});
