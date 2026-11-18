'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

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
        { id: 'strategy-a', label: '장기 빈도', averageMatches: 0.82, randomWinRate: 0.6 }
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
