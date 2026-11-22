'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const historyHelpers = require('../assets/research-history.js');

const appSource = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const historyStart = appSource.indexOf('function loadResearchHistory(');
const candidateStart = appSource.indexOf('function loadResearchCandidates()', historyStart);
const persistStart = appSource.indexOf('function persistResearchState()', candidateStart);
const resultsStart = appSource.indexOf('function renderResearchResults()', persistStart);
const summaryStart = appSource.indexOf('function researchReportSummary(', resultsStart);
const renderHistoryStart = appSource.indexOf('function renderResearchHistory()', summaryStart);
assert.ok(historyStart >= 0 && candidateStart > historyStart && persistStart > candidateStart);
assert.ok(resultsStart > persistStart && summaryStart > resultsStart && renderHistoryStart > summaryStart);

function makeReport(index) {
  return {
    version: 2,
    runId: 'run-' + index,
    createdAt: '2026-11-' + String(index + 1).padStart(2, '0') + 'T00:00:00.000Z',
    drawCount: 1250,
    firstRound: 1,
    lastRound: 1250,
    simulationCount: 1000000,
    evaluation: {
      baselineAverage: 0.8,
      candidateCount: 0,
      testCount: 250,
      strategies: [
        { id: 'strategy-a', label: '장기 빈도', averageMatches: 0.82, baselineAverage: 0.8, delta: 0.02, zScore: 0.5, randomWinRate: 0.6 }
      ]
    }
  };
}

function contextWithStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const storage = {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
  const context = {
    localStorage: storage,
    appStorageGet(key) { return storage.getItem(key); },
    appStorageSet(key,value) { return storage.setItem(key,value); },
    appStorageRemove(key) { return storage.removeItem(key); },
    window: { Lucky645ResearchHistory: historyHelpers },
    RESEARCH_HISTORY_KEY: 'history',
    RESEARCH_REPORT_KEY: 'report',
    RESEARCH_CANDIDATES_KEY: 'candidates',
    MAX_RESEARCH_HISTORY: 12,
    researchReport: null,
    researchHistory: [],
    researchCandidates: [],
    researchCompareRunId: '',
    toast() {},
    Number,
    String,
    Array,
    JSON,
    Math
  };
  vm.createContext(context);
  vm.runInContext(
    appSource.slice(historyStart, candidateStart) +
    appSource.slice(persistStart, resultsStart) +
    appSource.slice(summaryStart, renderHistoryStart),
    context
  );
  return { context, storage, data };
}

test('legacy last-report storage is migrated into research history', () => {
  const legacy = makeReport(0);
  const { context } = contextWithStorage({ report: JSON.stringify(legacy) });
  context.researchReport = legacy;
  const history = context.loadResearchHistory(legacy);
  assert.equal(history.length, 1);
  assert.equal(history[0].runId, 'run-0');
});

test('research run archive is newest-first and capped at twelve records', () => {
  const { context } = contextWithStorage();
  for (let index = 0; index < 15; index++) context.recordResearchRun(makeReport(index));
  assert.equal(context.researchHistory.length, 12);
  assert.equal(context.researchHistory[0].runId, 'run-14');
  assert.equal(context.researchHistory[11].runId, 'run-3');
  assert.equal(context.researchCompareRunId, 'run-13');
});

test('research archive, latest report and candidates persist together', () => {
  const { context, data } = contextWithStorage();
  const report = makeReport(2);
  context.researchReport = report;
  context.recordResearchRun(report);
  context.researchCandidates = [{ id: 'candidate-a', label: 'candidate', delta: 0.01 }];
  assert.equal(context.persistResearchState(), true);
  assert.equal(JSON.parse(data.get('report')).runId, 'run-2');
  assert.equal(JSON.parse(data.get('history')).length, 1);
  assert.equal(JSON.parse(data.get('candidates')).length, 1);
});

test('run comparison summary derives averages and best strategy metrics', () => {
  const { context } = contextWithStorage();
  const summary = context.researchReportSummary(makeReport(0));
  assert.equal(summary.average, 0.82);
  assert.equal(summary.baseline, 0.8);
  assert.equal(summary.topAverage, 0.82);
  assert.equal(summary.topWinRate, 0.6);
  assert.equal(summary.baselineCount, 0);
});

const archive = require('../assets/research-history.js');

function validReport(id, createdAt) {
  return {
    version: 2, runId: id, createdAt, drawCount: 200, firstRound: 1, lastRound: 200,
    simulationCount: 1000000,
    evaluation: { candidateCount: 0, strategies: [{
      id: 'random-20', label: '무작위 · 20회', averageMatches: 0.8,
      baselineAverage: 0.79, delta: 0.01, zScore: 0.5
    }] }
  };
}

test('validates the exported research archive schema and normalizes timestamps', () => {
  const rows = archive.normalizeArchive({
    schema: 'lucky645-research-history-v1',
    runs: [validReport('run-a', '2026-11-18T00:00:00.000Z')]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].runId, 'run-a');
  assert.equal(rows[0].createdAt, '2026-11-18T00:00:00.000Z');
});

test('rejects the complete archive if any report is invalid', () => {
  assert.throws(() => archive.normalizeArchive({
    schema: 'lucky645-research-history-v1',
    runs: [validReport('run-a', '2026-11-18T00:00:00.000Z'), { version: 2 }]
  }));
});

test('rejects malformed metrics, invalid dates and oversized strategy sets', () => {
  const invalidMetric = validReport('bad', '2026-11-18T00:00:00.000Z');
  invalidMetric.evaluation.strategies[0].averageMatches = 9;
  assert.throws(() => archive.normalizeReport(invalidMetric));
  const invalidDate = validReport('bad-date', 'not-a-date');
  assert.throws(() => archive.normalizeReport(invalidDate));
  const tooMany = validReport('many', '2026-11-18T00:00:00.000Z');
  tooMany.evaluation.strategies = Array.from({length:101}, (_,i)=>({...tooMany.evaluation.strategies[0],id:'s'+i}));
  assert.throws(() => archive.normalizeReport(tooMany));
});

test('merges by run id, keeps newest copy and caps local history at twelve', () => {
  const oldRows = Array.from({length:14}, (_,i)=>validReport('run-'+i,new Date(Date.UTC(2026,0,i+1)).toISOString()));
  const merged = archive.mergeRuns(oldRows,[validReport('run-13','2026-02-01T00:00:00.000Z')]);
  assert.equal(merged.length,12);
  assert.equal(merged[0].runId,'run-13');
  assert.equal(merged.filter(row=>row.runId==='run-13').length,1);
});

test('migrates a legacy v1 report with missing newer metrics', () => {
  const legacy = {
    version: 1, createdAt: '2026-10-01T00:00:00.000Z', drawCount: 200,
    evaluation: { strategies: [{ id: 'legacy', label: '구형 전략', averageMatches: 0.81 }] }
  };
  const normalized = archive.normalizeReport(legacy);
  assert.equal(normalized.runId, legacy.createdAt);
  assert.equal(normalized.simulationCount, 0);
  assert.equal(normalized.evaluation.strategies[0].baselineAverage, 0.8);
  assert.ok(Math.abs(normalized.evaluation.strategies[0].delta - 0.01) < 1e-12);
  assert.equal(normalized.evaluation.strategies[0].zScore, 0);
});


test('rejects duplicate run IDs in a backup instead of silently choosing one', () => {
  assert.throws(() => archive.normalizeArchive({
    schema: 'lucky645-research-history-v1',
    runs: [
      validReport('duplicate-run', '2026-11-18T00:00:00.000Z'),
      validReport('duplicate-run', '2026-11-19T00:00:00.000Z')
    ]
  }), /중복된 연구 실행 ID/);
});

test('local report wins an imported copy when run ID and timestamp are equal', () => {
  const local = validReport('same-run', '2026-11-18T00:00:00.000Z');
  local.evaluation.strategies[0].label = '현재 로컬 기록';
  const backup = validReport('same-run', '2026-11-18T00:00:00.000Z');
  backup.evaluation.strategies[0].label = '백업 파일 기록';
  const merged = archive.mergeRuns([backup], [local]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].evaluation.strategies[0].label, '현재 로컬 기록');
});

function restoreContext(initial = {}, options = {}) {
  const data = new Map(Object.entries(initial));
  let failKey = options.failKey || '';
  let failCount = options.failCount || 0;
  const storage = {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) {
      if (key === failKey && failCount > 0) { failCount--; throw new Error('quota exceeded'); }
      data.set(key, String(value));
    },
    removeItem(key) { data.delete(key); }
  };
  const oldReport = options.oldReport || makeReport(0);
  const oldHistory = options.oldHistory || [oldReport];
  const context = {
    localStorage: storage,
    appStorageGet: key => storage.getItem(key),
    appStorageSet: (key,value) => storage.setItem(key,value),
    appStorageRemove: key => storage.removeItem(key),
    window: { Lucky645ResearchHistory: archive },
    RESEARCH_REPORT_KEY: 'report',
    RESEARCH_HISTORY_KEY: 'history',
    RESEARCH_CANDIDATES_KEY: 'candidates',
    MAX_RESEARCH_HISTORY: 12,
    MAX_BACKUP_FILE_SIZE: 12 * 1024 * 1024,
    researchReport: oldReport,
    researchHistory: oldHistory,
    researchCandidates: [{ id: 'keep', label: 'keep' }],
    cloudSession: null,
    cloudSessionGeneration: 0,
    assertAccountScope(expectedUserId,expectedGeneration) {
      if(expectedUserId!=='local'||expectedGeneration!==0) throw new Error('account changed');
    },
    confirm: () => true,
    toast() {},
    renderResearchLab() {},
    Number, String, Array, JSON, Math, Date, Set, Map, TextEncoder
  };
  vm.createContext(context);
  const persistStart = appSource.indexOf('function persistResearchState()');
  const persistEnd = appSource.indexOf('\nfunction renderResearchResults()', persistStart);
  const importStart = appSource.indexOf('async function importResearchHistoryFile(file)');
  const importEnd = appSource.indexOf('\nasync function fetchAllResearchRuns(token)', importStart);
  assert.ok(persistStart >= 0 && persistEnd > persistStart);
  assert.ok(importStart >= 0 && importEnd > importStart);
  vm.runInContext(appSource.slice(persistStart, persistEnd) + '\n' + appSource.slice(importStart, importEnd), context);
  return { context, data };
}

test('restore merges a valid archive and retains the existing local copy on timestamp ties', async () => {
  const current = validReport('shared-run', '2026-11-18T00:00:00.000Z');
  current.evaluation.strategies[0].label = '현재 로컬 기록';
  const backup = validReport('shared-run', '2026-11-18T00:00:00.000Z');
  backup.evaluation.strategies[0].label = '백업 파일 기록';
  const { context } = restoreContext({}, { oldReport: current, oldHistory: [current] });
  await context.importResearchHistoryFile({ size: 10, text: async () => JSON.stringify({
    schema: 'lucky645-research-history-v1', runs: [backup]
  }) });
  assert.equal(context.researchHistory.length, 1);
  assert.equal(context.researchHistory[0].evaluation.strategies[0].label, '현재 로컬 기록');
});

test('restore storage failure rolls back local state and all previously written keys', async () => {
  const oldReport = makeReport(0);
  const oldHistory = [oldReport];
  const initial = {
    report: JSON.stringify(oldReport),
    history: JSON.stringify(oldHistory),
    candidates: JSON.stringify([{ id: 'keep', label: 'keep' }])
  };
  const { context, data } = restoreContext(initial, { oldReport, oldHistory, failKey: 'candidates', failCount: 1 });
  const incoming = makeReport(5);
  await context.importResearchHistoryFile({ size: 10, text: async () => JSON.stringify({
    schema: 'lucky645-research-history-v1', runs: [incoming]
  }) });
  assert.equal(context.researchReport.runId, oldReport.runId);
  assert.deepEqual(JSON.parse(JSON.stringify(context.researchHistory.map(item => item.runId))), [oldReport.runId]);
  assert.deepEqual(Object.fromEntries(data), initial);
});

test('invalid backup leaves both memory and local storage untouched', async () => {
  const oldReport = makeReport(0);
  const initial = {
    report: JSON.stringify(oldReport),
    history: JSON.stringify([oldReport]),
    candidates: JSON.stringify([{ id: 'keep', label: 'keep' }])
  };
  const { context, data } = restoreContext(initial, { oldReport, oldHistory: [oldReport] });
  await context.importResearchHistoryFile({ size: 10, text: async () => JSON.stringify({
    schema: 'lucky645-research-history-v1', runs: [validReport('ok', '2026-11-18T00:00:00.000Z'), { version: 99 }]
  }) });
  assert.equal(context.researchReport.runId, oldReport.runId);
  assert.deepEqual(Object.fromEntries(data), initial);
});


test('uploads local research report edits when local copy wins a same-ID conflict', () => {
  const local = validReport('edited-run', '2026-11-20T00:00:00.000Z');
  local.evaluation.strategies[0].label = '로컬 수정본';
  const remote = validReport('edited-run', '2026-11-20T00:00:00.000Z');
  remote.evaluation.strategies[0].label = '서버 이전본';
  const upload = archive.selectRunsToUpload([local], [remote]);
  assert.equal(upload.length, 1);
  assert.equal(upload[0].evaluation.strategies[0].label, '로컬 수정본');
});

test('does not upload a stale local research report over a newer cloud copy', () => {
  const local = validReport('same-run', '2026-11-19T00:00:00.000Z');
  const remote = validReport('same-run', '2026-11-20T00:00:00.000Z');
  const upload = archive.selectRunsToUpload([local], [remote]);
  assert.equal(upload.length, 0);
});

test('uploads missing research reports and skips identical cloud copies', () => {
  const local = validReport('local-only', '2026-11-20T00:00:00.000Z');
  const identical = validReport('same-run', '2026-11-19T00:00:00.000Z');
  assert.deepEqual(archive.selectRunsToUpload([local, identical], [identical]).map(row => row.runId), ['local-only']);
});
