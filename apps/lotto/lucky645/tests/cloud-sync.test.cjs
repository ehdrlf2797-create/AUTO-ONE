'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');

const tombstoneStart = appSource.indexOf('function cloudTombstonesStorageKey() {');
const tombstoneEnd = appSource.indexOf('\nfunction markCloudDeleted(', tombstoneStart);
assert.notEqual(tombstoneStart, -1, 'cloud tombstone storage helpers must exist');
assert.notEqual(tombstoneEnd, -1, 'cloud tombstone helpers must end before markCloudDeleted');

const tombstoneSource = appSource.slice(tombstoneStart, tombstoneEnd);

const syncStart = appSource.indexOf('async function syncCloudData() {');
const syncEnd = appSource.indexOf('\nfunction scheduleCloudSync()', syncStart);
assert.notEqual(syncStart, -1, 'syncCloudData must exist');
assert.notEqual(syncEnd, -1, 'syncCloudData must end before scheduleCloudSync');
const syncSource = appSource.slice(syncStart, syncEnd);

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    has(key) {
      return values.has(key);
    }
  };
}

test('cloud tombstones are isolated by signed-in user', () => {
  const storage = createStorage();
  const context = {
    CLOUD_TOMBSTONES_KEY: 'lucky645_cloud_tombstones_v1',
    cloudSession: { user: { id: 'user-a' } },
    localStorage: storage
  };
  vm.runInNewContext(tombstoneSource + '\nthis.loadCloudTombstones = loadCloudTombstones; this.persistCloudTombstones = persistCloudTombstones;', context);

  const userATombstones = [{ category: 'saved_combination', record_key: 'saved-a', deleted_at: '2026-11-18T00:00:00.000Z' }];
  context.persistCloudTombstones(userATombstones);

  context.cloudSession = { user: { id: 'user-b' } };
  assert.equal(JSON.stringify(context.loadCloudTombstones()), '[]');

  const userBTombstones = [{ category: 'saved_combination', record_key: 'saved-b', deleted_at: '2026-11-18T00:01:00.000Z' }];
  context.persistCloudTombstones(userBTombstones);

  context.cloudSession = { user: { id: 'user-a' } };
  assert.equal(JSON.stringify(context.loadCloudTombstones()), JSON.stringify(userATombstones));
  context.cloudSession = { user: { id: 'user-b' } };
  assert.equal(JSON.stringify(context.loadCloudTombstones()), JSON.stringify(userBTombstones));
});

test('signed-out tombstones stay local and are not reused by a later account', () => {
  const storage = createStorage();
  const context = {
    CLOUD_TOMBSTONES_KEY: 'lucky645_cloud_tombstones_v1',
    cloudSession: null,
    localStorage: storage
  };
  vm.runInNewContext(tombstoneSource + '\nthis.loadCloudTombstones = loadCloudTombstones; this.persistCloudTombstones = persistCloudTombstones;', context);

  const localTombstones = [{ category: 'saved_combination', record_key: 'local-only', deleted_at: '2026-11-18T00:00:00.000Z' }];
  context.persistCloudTombstones(localTombstones);
  context.cloudSession = { user: { id: 'user-c' } };
  assert.equal(JSON.stringify(context.loadCloudTombstones()), '[]');
});

test('overlapping sync requests share one run and schedule a trailing sync', async () => {
  let resolveRun;
  let runs = 0;
  let scheduled = 0;
  const gate = new Promise(resolve => { resolveRun = resolve; });
  const context = {
    cloudSession: { user: { id: 'user-a' } },
    cloudSyncPromise: null,
    cloudSyncRequested: false,
    performCloudSync() {
      runs += 1;
      return gate;
    },
    scheduleCloudSync() {
      scheduled += 1;
    }
  };
  vm.runInNewContext(syncSource + '\nthis.syncCloudData = syncCloudData;', context);

  const first = context.syncCloudData();
  const second = context.syncCloudData();
  assert.equal(runs, 1);
  assert.equal(context.cloudSyncRequested, true);

  resolveRun();
  await Promise.all([first, second]);

  assert.equal(context.cloudSyncPromise, null);
  assert.equal(context.cloudSyncRequested, false);
  assert.equal(scheduled, 1);
});

test('sync failure still releases the lock and schedules a requested retry', async () => {
  let runs = 0;
  let scheduled = 0;
  const context = {
    cloudSession: { user: { id: 'user-a' } },
    cloudSyncPromise: null,
    cloudSyncRequested: false,
    performCloudSync() {
      runs += 1;
      return Promise.reject(new Error('temporary sync failure'));
    },
    scheduleCloudSync() {
      scheduled += 1;
    }
  };
  vm.runInNewContext(syncSource + '\nthis.syncCloudData = syncCloudData;', context);

  const first = context.syncCloudData();
  const second = context.syncCloudData();
  await assert.rejects(Promise.all([first, second]), /temporary sync failure/);

  assert.equal(runs, 1);
  assert.equal(context.cloudSyncPromise, null);
  assert.equal(context.cloudSyncRequested, false);
  assert.equal(scheduled, 1);
});

test('sync does nothing when no authenticated user is present', async () => {
  let runs = 0;
  const context = {
    cloudSession: null,
    cloudSyncPromise: null,
    cloudSyncRequested: false,
    performCloudSync() {
      runs += 1;
    },
    scheduleCloudSync() {}
  };
  vm.runInNewContext(syncSource + '\nthis.syncCloudData = syncCloudData;', context);

  await context.syncCloudData();
  assert.equal(runs, 0);
});
