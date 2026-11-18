'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const helperStart = appSource.indexOf('const TOTAL_LOTTO_COMBINATIONS = 8145060;');
const helperEnd = appSource.indexOf('\nfunction renderGenerated()', helperStart);
assert.notEqual(helperStart, -1, 'generator bulk-save helpers must exist');
assert.notEqual(helperEnd, -1, 'generator helper block must end before renderer');

function makeContext() {
  const context = {};
  vm.runInNewContext(
    appSource.slice(helperStart, helperEnd) +
      '\nthis.validCombinationKey=validCombinationKey;' +
      '\nthis.summarizeGeneratedTickets=summarizeGeneratedTickets;' +
      '\nthis.buildBulkSavedEntries=buildBulkSavedEntries;',
    context
  );
  return context;
}

const tickets = [
  [1, 7, 13, 25, 34, 45],
  [2, 8, 14, 26, 35, 44],
  [3, 9, 15, 27, 36, 43]
];

test('combination fingerprints normalize order and reject invalid tickets', () => {
  const context = makeContext();
  assert.equal(context.validCombinationKey([45, 34, 25, 13, 7, 1]), '1-7-13-25-34-45');
  assert.equal(context.validCombinationKey([1, 1, 2, 3, 4, 5]), null);
  assert.equal(context.validCombinationKey([0, 2, 3, 4, 5, 6]), null);
  assert.equal(context.validCombinationKey([1, 2, 3, 4, 5]), null);
});

test('generated summary counts unique tickets, covered numbers, saved duplicates and exact jackpot odds', () => {
  const context = makeContext();
  const saved = [{ numbers: [45, 34, 25, 13, 7, 1] }];
  const summary = context.summarizeGeneratedTickets(
    [tickets[0], tickets[1], tickets[1], [1, 1, 2, 3, 4, 5]],
    saved
  );
  assert.equal(summary.totalCount, 4);
  assert.equal(summary.uniqueCount, 2);
  assert.equal(summary.duplicateCount, 1);
  assert.equal(summary.invalidCount, 1);
  assert.equal(summary.alreadySavedCount, 1);
  assert.equal(summary.newCount, 1);
  assert.equal(summary.uniqueNumbers, 12);
  assert.equal(summary.jackpotProbability, 2 / 8145060);
  assert.equal(summary.oneIn, Math.round(8145060 / 2));
});

test('one unique generated combination has the official one-in-8,145,060 jackpot probability', () => {
  const context = makeContext();
  const summary = context.summarizeGeneratedTickets([tickets[0]], []);
  assert.equal(summary.uniqueCount, 1);
  assert.equal(summary.jackpotProbability, 1 / 8145060);
  assert.equal(summary.jackpotPercent, 100 / 8145060);
  assert.equal(summary.oneIn, 8145060);
});

test('bulk-save preparation skips existing and repeated tickets and normalizes saved order', () => {
  const context = makeContext();
  const existing = [{ id: 'old', numbers: [45, 34, 25, 13, 7, 1] }];
  const fixedDate = new Date('2026-11-19T12:00:00.000Z');
  let randomCall = 0;
  const result = context.buildBulkSavedEntries(
    [tickets[0], tickets[1], tickets[1], tickets[2], [1, 1, 2, 3, 4, 5]],
    existing,
    'coverage',
    fixedDate,
    () => (++randomCall) / 10
  );
  assert.equal(result.added, 2);
  assert.equal(result.duplicateCount, 2);
  assert.equal(result.invalidCount, 1);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(
    Array.from(result.entries, entry => entry.numbers.join('-')),
    ['2-8-14-26-35-44', '3-9-15-27-36-43']
  );
  assert.ok(result.entries.every(entry => entry.mode === 'coverage'));
  assert.ok(result.entries.every(entry => entry.syncUpdatedAt === fixedDate.toISOString()));
  assert.equal(new Set(result.entries.map(entry => entry.id)).size, 2);
});

test('bulk-save preparation does not add malformed input to the saved collection', () => {
  const context = makeContext();
  const result = context.buildBulkSavedEntries(
    [[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 46], [1, 1, 2, 3, 4, 5]],
    [],
    'not-a-mode',
    new Date('2026-11-19T12:00:00.000Z'),
    () => 0.25
  );
  assert.equal(result.added, 1);
  assert.equal(result.invalidCount, 2);
  assert.equal(result.entries[0].mode, 'random');
});

test('persistSaved is atomic when browser storage is full', () => {
  const persistStart = appSource.indexOf('function persistSaved(nextSaved = saved) {');
  const persistEnd = appSource.indexOf('\nfunction persistDraws()', persistStart);
  assert.notEqual(persistStart, -1);
  assert.notEqual(persistEnd, -1);
  const context = {
    SAVED_KEY: 'saved-key',
    saved: [{ id: 'existing' }],
    localStorage: { setItem() { throw new Error('quota exceeded'); } },
    cloudApplying: true,
    savedBacktestResult: null,
    renderSaved() { throw new Error('must not render after failed write'); },
    updateTopStats() { throw new Error('must not update after failed write'); },
    toast() {}
  };
  vm.runInNewContext(
    appSource.slice(persistStart, persistEnd) + '\nthis.persistSaved=persistSaved;',
    context
  );
  const previous = context.saved;
  const result = context.persistSaved([{ id: 'new' }]);
  assert.equal(result, false);
  assert.equal(context.saved, previous);
  assert.equal(context.saved[0].id, 'existing');
});

test('persistSaved commits the entire collection with one successful storage write', () => {
  const persistStart = appSource.indexOf('function persistSaved(nextSaved = saved) {');
  const persistEnd = appSource.indexOf('\nfunction persistDraws()', persistStart);
  const writes = [];
  let renderCount = 0;
  const context = {
    SAVED_KEY: 'saved-key',
    saved: [{ id: 'existing' }],
    localStorage: { setItem(key, value) { writes.push([key, value]); } },
    cloudApplying: true,
    savedBacktestResult: null,
    renderSaved() { renderCount++; },
    updateTopStats() {},
    toast() {}
  };
  vm.runInNewContext(
    appSource.slice(persistStart, persistEnd) + '\nthis.persistSaved=persistSaved;',
    context
  );
  const next = [{ id: 'new-a' }, { id: 'new-b' }, ...context.saved];
  assert.equal(context.persistSaved(next), true);
  assert.equal(context.saved, next);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], 'saved-key');
  assert.deepEqual(JSON.parse(writes[0][1]).map(item => item.id), ['new-a', 'new-b', 'existing']);
  assert.equal(renderCount, 1);
});
