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
