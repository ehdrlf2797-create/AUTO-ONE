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

const savedNormalizerStart = appSource.indexOf('function normalizeSyncTimestamp(');
const savedNormalizerEnd = appSource.indexOf('\nfunction loadSaved()', savedNormalizerStart);
const historyNormalizerStart = appSource.indexOf('function normalizeSavedCheckRecord(');
const historyNormalizerEnd = appSource.indexOf('\nfunction loadSavedCheckHistory()', historyNormalizerStart);
const mergeHelperStart = appSource.indexOf('function mergeCloudSavedRecord(');
const mergeHelperEnd = appSource.indexOf('\nfunction buildLocalCloudRows()', mergeHelperStart);
assert.notEqual(savedNormalizerStart, -1);
assert.notEqual(savedNormalizerEnd, -1);
assert.notEqual(historyNormalizerStart, -1);
assert.notEqual(historyNormalizerEnd, -1);
assert.notEqual(mergeHelperStart, -1);
assert.notEqual(mergeHelperEnd, -1);

function createMergeHarness() {
  const context = {};
  vm.runInNewContext(
    'function sortNums(numbers) { return [...numbers].sort((a,b)=>a-b); }\n' +
    appSource.slice(savedNormalizerStart, savedNormalizerEnd) + '\n' +
    appSource.slice(historyNormalizerStart, historyNormalizerEnd) + '\n' +
    appSource.slice(mergeHelperStart, mergeHelperEnd) +
    '\nthis.mergeCloudSavedRecord=mergeCloudSavedRecord;' +
    '\nthis.normalizeCloudHistoryRecord=normalizeCloudHistoryRecord;',
    context
  );
  return context;
}

test('cloud saved metadata uses the newest sync timestamp and preserves the local ID', () => {
  const context = createMergeHarness();
  const local = {
    id:'local-stable-id', numbers:[1,2,3,4,5,6], mode:'random',
    favorite:false, syncUpdatedAt:'2026-11-18T00:00:00.000Z'
  };
  const newerRemote = {
    id:'remote-device-id', numbers:[1,2,3,4,5,6], mode:'coverage',
    favorite:true, syncUpdatedAt:'2026-11-18T00:05:00.000Z'
  };

  const merged = context.mergeCloudSavedRecord(local,newerRemote);
  assert.equal(merged.id,'local-stable-id');
  assert.equal(merged.mode,'coverage');
  assert.equal(merged.favorite,true);
  assert.equal(merged.syncUpdatedAt,'2026-11-18T00:05:00.000Z');

  const staleRemote = {
    id:'old-device-id', numbers:[1,2,3,4,5,6], mode:'random',
    favorite:false, syncUpdatedAt:'2026-11-17T23:59:00.000Z'
  };
  context.mergeCloudSavedRecord(local,staleRemote);
  assert.equal(local.id,'local-stable-id');
  assert.equal(local.favorite,true);
  assert.equal(local.mode,'coverage');
});

test('cloud history maps duplicate device IDs to one canonical saved-history key', () => {
  const context = createMergeHarness();
  const localSaved = [{id:'local-stable-id',numbers:[1,2,3,4,5,6]}];
  const remoteSavedIds = new Map([
    ['remote-device-a','local-stable-id'],
    ['remote-device-b','local-stable-id']
  ]);
  const base = {
    round:1250, savedId:'remote-device-a', numbers:[1,2,3,4,5,6],
    matches:3, bonusMatch:false, rank:'5등', mode:'coverage'
  };
  const first = context.normalizeCloudHistoryRecord({
    record_key:'old-history-a',
    payload:{...base,id:'old-history-a'}
  },remoteSavedIds,localSaved);
  const second = context.normalizeCloudHistoryRecord({
    record_key:'old-history-b',
    payload:{...base,savedId:'remote-device-b',id:'old-history-b'}
  },remoteSavedIds,localSaved);

  assert.equal(first.savedId,'local-stable-id');
  assert.equal(first.id,'1250:local-stable-id');
  assert.equal(second.id,first.id);
});

test('cloud merge refreshes dependent backtest after data reconciliation', () => {
  assert.match(appSource, /if\(savedBacktestResult\) runSavedBacktest\(\);/);
  assert.match(appSource, /if\(dataReady && latestVerification==='official'\) autoCheckLatestDraw\(\);/);
});

test('saved-combination tombstones carry a number fingerprint for duplicate-device copies', () => {
  const start = appSource.indexOf('function markCloudDeleted(');
  const end = appSource.indexOf('\nfunction cloudHeaders(',start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  const state = {rows:null,scheduled:0};
  const context = {
    loadCloudTombstones:()=>[],
    persistCloudTombstones(rows){state.rows=rows;},
    scheduleCloudSync(){state.scheduled++;},
    sortNums(numbers){return [...numbers].sort((a,b)=>a-b);}
  };
  vm.runInNewContext(appSource.slice(start,end)+'\nthis.markCloudDeleted=markCloudDeleted;',context);
  context.markCloudDeleted('saved_combination','device-a-id',[6,5,4,3,2,1]);
  assert.equal(state.rows[0].numbers_key,'1-2-3-4-5-6');
  assert.equal(state.scheduled,1);
});

test('cloud sync suppresses old duplicate copies but permits a later re-save', () => {
  const start = appSource.indexOf('function deletedSavedNumberMap(');
  const end = appSource.indexOf('\nfunction buildLocalCloudRows()',start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  const context = {};
  vm.runInNewContext(
    'function sortNums(numbers) { return [...numbers].sort((a,b)=>a-b); }\n' +
    appSource.slice(start,end) +
    '\nthis.deletedSavedNumberMap=deletedSavedNumberMap;' +
    '\nthis.isSavedCombinationDeleted=isSavedCombinationDeleted;',
    context
  );
  const deletedAt='2026-11-18T15:00:00.000Z';
  const tombstones=context.deletedSavedNumberMap([
    {category:'saved_combination',record_key:'old-id',numbers_key:'1-2-3-4-5-6',deleted_at:deletedAt}
  ]);
  assert.equal(context.isSavedCombinationDeleted({
    numbers:[6,5,4,3,2,1],
    syncUpdatedAt:'2026-11-18T14:59:59.000Z'
  },tombstones),true);
  assert.equal(context.isSavedCombinationDeleted({
    numbers:[1,2,3,4,5,6],
    syncUpdatedAt:'2026-11-18T15:00:01.000Z'
  },tombstones),false);
  assert.equal(context.isSavedCombinationDeleted({
    numbers:[1,2,3,4,5,6]
  },tombstones),true);
  assert.match(appSource, /payload:row\.numbers_key\?\{numbers_key:row\.numbers_key\}:\{\}/);
});

test('cloud sync paginates all remote rows instead of truncating at the REST row limit', async () => {
  const start=appSource.indexOf('async function fetchAllCloudRows(');
  const end=appSource.indexOf('\nasync function cloudUpsert(',start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  const requests=[];
  const context={
    async cloudRequest(url,options,token){
      requests.push({url,options,token});
      const offset=Number(new URL(url,'https://local.invalid').searchParams.get('offset'));
      if(offset===0)return Array.from({length:1000},(_,i)=>({id:String(i)}));
      if(offset===1000)return Array.from({length:200},(_,i)=>({id:String(1000+i)}));
      return [];
    }
  };
  vm.runInNewContext(appSource.slice(start,end)+'\nthis.fetchAllCloudRows=fetchAllCloudRows;',context);
  const rows=await context.fetchAllCloudRows('test-token');
  assert.equal(rows.length,1200);
  assert.deepEqual(requests.map(item=>Number(new URL(item.url,'https://local.invalid').searchParams.get('offset'))),[0,1000]);
  assert.ok(requests.every(item=>item.token==='test-token'));
});

test('cloud upsert sends large history collections in bounded batches', async () => {
  const start=appSource.indexOf('async function cloudUpsert(');
  const end=appSource.indexOf('\nasync function performCloudSync()',start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  const requests=[];
  const context={
    cloudSession:{user:{id:'user-a'}},
    async cloudRequest(url,options,token){requests.push({url,options,token});}
  };
  vm.runInNewContext(appSource.slice(start,end)+'\nthis.cloudUpsert=cloudUpsert;',context);
  const rows=Array.from({length:501},(_,index)=>({
    category:'check_history',record_key:String(index),payload:{round:index+1},deleted_at:null
  }));
  await context.cloudUpsert(rows,'test-token');
  assert.deepEqual(requests.map(request=>JSON.parse(request.options.body).length),[250,250,1]);
  assert.ok(requests.every(request=>request.token==='test-token'));
});
