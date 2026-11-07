import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getHeaderLabels } from '../apps/admin/src/navigation.ts';

test('publish navigation identifies the visible publishing panel', () => {
  assert.deepEqual(getHeaderLabels('publish'), { breadcrumb: 'انتشار', title: 'انتشار وب‌سایت' });
});

test('entry navigation keeps its kind breadcrumb and uses the entry title', () => {
  assert.deepEqual(getHeaderLabels('entry-id', 'project'), { breadcrumb: 'پروژه‌ها', title: undefined });
});
