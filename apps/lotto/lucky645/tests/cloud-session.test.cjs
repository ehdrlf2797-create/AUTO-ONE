'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const functionStart = appSource.indexOf('async function cloudAccessToken() {');
const functionEnd = appSource.indexOf('\nfunction renderCloudAuth(', functionStart);

assert.notEqual(functionStart, -1, 'cloudAccessToken must exist in app.js');
assert.notEqual(functionEnd, -1, 'cloudAccessToken must end before renderCloudAuth');

const functionSource = appSource.slice(functionStart, functionEnd);

function createHarness({ session, storedSession, authError, beforeAuthFailure } = {}) {
  const storage = {
    value: storedSession ? JSON.stringify(storedSession) : null,
    getItem(key) {
      return key === 'lucky645_cloud_session_v1' ? this.value : null;
    },
    setItem(key, value) {
      if (key === 'lucky645_cloud_session_v1') this.value = value;
    },
    removeItem(key) {
      if (key === 'lucky645_cloud_session_v1') this.value = null;
    }
  };

  const context = {
    cloudSession: session || null,
    cloudSessionGeneration: 0,
    CLOUD_SESSION_KEY: 'lucky645_cloud_session_v1',
    localStorage: storage,
    appStorageGet: key => storage.getItem(key),
    appStorageSet: (key,value) => storage.setItem(key,value),
    appStorageRemove: key => storage.removeItem(key),
    saveCalls: [],
    saveCloudSession(nextSession) {
      context.cloudSession = nextSession || null;
      context.saveCalls.push(nextSession || null);
      if (nextSession) storage.setItem('lucky645_cloud_session_v1', JSON.stringify(nextSession));
      else storage.removeItem('lucky645_cloud_session_v1');
    },
    renderCloudAuth() {},
    cloudAuth: async () => {
      if (beforeAuthFailure) await beforeAuthFailure(context, storage);
      throw authError;
    }
  };

  vm.runInNewContext(functionSource + '\nthis.cloudAccessToken = cloudAccessToken;', context);

  return { context, storage, run: () => context.cloudAccessToken() };
}

function invalidRefreshError() {
  const error = new Error('refresh token already used');
  error.status = 400;
  error.code = 'refresh_token_already_used';
  return error;
}

test('keeps the new localStorage session when an older concurrent refresh fails', async () => {
  const previous = { access_token: 'old-access', refresh_token: 'old-refresh' };
  const replacement = { access_token: 'new-access', refresh_token: 'new-refresh' };
  const harness = createHarness({
    session: previous,
    storedSession: previous,
    authError: invalidRefreshError(),
    beforeAuthFailure: (_context, storage) => {
      storage.setItem('lucky645_cloud_session_v1', JSON.stringify(replacement));
    }
  });

  assert.equal(await harness.run(), 'new-access');
  assert.equal(harness.context.cloudSession.refresh_token, 'new-refresh');
  assert.deepEqual(harness.context.saveCalls, []);
});

test('keeps a replacement session already present in memory', async () => {
  const previous = { access_token: 'old-access', refresh_token: 'old-refresh' };
  const replacement = { access_token: 'memory-access', refresh_token: 'memory-refresh' };
  const harness = createHarness({
    session: previous,
    storedSession: previous,
    authError: invalidRefreshError(),
    beforeAuthFailure: context => {
      context.cloudSession = replacement;
    }
  });

  assert.equal(await harness.run(), 'memory-access');
  assert.equal(harness.context.cloudSession.refresh_token, 'memory-refresh');
  assert.deepEqual(harness.context.saveCalls, []);
});

test('clears the session when the current refresh token is genuinely invalid', async () => {
  const current = { access_token: 'old-access', refresh_token: 'old-refresh' };
  const harness = createHarness({
    session: current,
    storedSession: current,
    authError: invalidRefreshError()
  });

  await assert.rejects(harness.run(), /다시 로그인해 주세요/);
  assert.equal(harness.context.cloudSession, null);
  assert.deepEqual(harness.context.saveCalls, [null]);
});

test('preserves the session on a temporary server failure', async () => {
  const current = { access_token: 'old-access', refresh_token: 'old-refresh' };
  const networkError = new Error('temporary server failure');
  networkError.status = 503;
  const harness = createHarness({
    session: current,
    storedSession: current,
    authError: networkError
  });

  await assert.rejects(harness.run(), /temporary server failure/);
  assert.equal(harness.context.cloudSession.refresh_token, 'old-refresh');
  assert.deepEqual(harness.context.saveCalls, []);
});
