'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const renderStart = appSource.indexOf('function renderResearchLab() {');
const progressStart = appSource.indexOf('function updateResearchProgress(', renderStart);
const runStart = appSource.indexOf('async function runResearchLab()', progressStart);
const runEnd = appSource.indexOf('\nfunction navigate(page)', runStart);
assert.ok(renderStart >= 0 && progressStart > renderStart && runStart > progressStart && runEnd > runStart);

function node() {
  const classes = new Set();
  return {
    textContent: '',
    innerHTML: '',
    className: '',
    title: '',
    disabled: false,
    style: {},
    attributes: {},
    classList: { add: name => classes.add(name), contains: name => classes.has(name) },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}

function validDraws(count = 200) {
  return Array.from({ length: count }, (_, index) => ({
    round: index + 1,
    numbers: Array.from({ length: 6 }, (_, offset) => ((index * 7 + offset * 11) % 45) + 1)
  }));
}

function makeContext(engineOverride) {
  const ids = [
    'researchDrawCount','researchRoundRange','researchCandidateCount','researchCandidateBadge',
    'researchDataStatus','runResearchBtn','researchCandidateList','researchRunMessage',
    'researchProgressWrap','researchProgressBar','researchProgressLabel','researchProgressPct',
    'researchCompareSelect','researchCompareSummary','researchHistoryList'
  ];
  const nodes = Object.fromEntries(ids.map(id => [id, node()]));
  const engine = engineOverride || {
    normalizeDraws(rows) { return rows; },
    async runStudy(rows, options, onProgress) {
      onProgress({ stage: 'baselines', completed: 25, total: 200 });
      onProgress({ stage: 'strategies', completed: 25, total: 100 });
      onProgress({ stage: 'montecarlo', completed: 250000, total: 1000000 });
      return {
        version: 2,
        runId: 'test-run-2026',
        seed: 'test-seed',
        createdAt: '2026-11-19T00:00:00.000Z',
        drawCount: rows.length,
        strategyCount: options.strategyCount,
        simulationCount: options.simulations,
        evaluation: { strategies: [], candidateCount: 0 },
        monteCarlo: {}
      };
    }
  };
  const context = {
    window: { Lucky645Research: engine },
    draws: validDraws(),
    dataReady: false,
    researchCandidates: [],
    researchReport: null,
    researchHistory: [],
    researchCompareRunId: '',
    MAX_RESEARCH_HISTORY: 12,
    researchRunning: false,
    researchRunGeneration: 0,
    cloudSession: null,
    researchLastRunMessage: '',
    researchLastRunTone: 'normal',
    $: id => nodes[id] || null,
    formatNumber: value => Number(value || 0).toLocaleString('en-US'),
    formatSyncTime: value => String(value || '-'),
    escapeHtml: value => String(value),
    toast() {},
    persistResearchState() { return true; },
    renderResearchResults() {},
    renderResearchHistory() {},
    recordResearchRun(report) { context.researchHistory = [report, ...context.researchHistory].slice(0, 12); },
    renderResearchLab() {},
    Date,
    Set,
    Promise,
    Math
  };
  context.__nodes = nodes;
  vm.createContext(context);
  vm.runInContext(
    appSource.slice(renderStart, progressStart) +
    appSource.slice(progressStart, runStart) +
    appSource.slice(runStart, runEnd),
    context
  );
  return context;
}

test('research button remains actionable while data readiness is unresolved and explains the state', () => {
  const context = makeContext();
  context.renderResearchLab();
  assert.equal(context.__nodes.runResearchBtn.disabled, false);
  assert.match(context.__nodes.researchRunMessage.textContent, /연속성 검사/);
  assert.equal(context.__nodes.runResearchBtn.attributes['aria-busy'], 'false');
});

test('research preflight failures are shown in the lab instead of only a transient toast', async () => {
  const engine = {
    normalizeDraws() { throw new Error('회차 81번 누락'); },
    async runStudy() { throw new Error('runStudy must not be called'); }
  };
  const context = makeContext(engine);
  await context.runResearchLab();
  assert.match(context.__nodes.researchRunMessage.textContent, /회차 81번 누락/);
  assert.match(context.__nodes.researchRunMessage.className, /research-message-warning/);
  assert.equal(context.__nodes.runResearchBtn.disabled, false);
});

test('research run invokes 100 strategies and one million simulations and exposes live progress', async () => {
  let release;
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const report = {
    version: 1,
    createdAt: '2026-11-19T00:00:00.000Z',
    drawCount: 200,
    strategyCount: 100,
    simulationCount: 1000000,
    evaluation: { strategies: [], candidateCount: 0 },
    monteCarlo: {}
  };
  const engine = {
    normalizeDraws(rows) { return rows; },
    async runStudy(rows, options, onProgress) {
      assert.equal(rows.length, 200);
      assert.equal(options.strategyCount, 100);
      assert.equal(options.simulations, 1000000);
      assert.equal(options.baselineCount, 200);
      onProgress({ stage: 'strategies', completed: 25, total: 100 });
      enteredResolve();
      await new Promise(resolve => { release = resolve; });
      onProgress({ stage: 'montecarlo', completed: 1000000, total: 1000000 });
      return report;
    }
  };
  const context = makeContext(engine);
  const task = context.runResearchLab();
  await entered;
  assert.equal(context.__nodes.runResearchBtn.disabled, true);
  assert.match(context.__nodes.runResearchBtn.textContent, /전략 평가 25\/100/);
  assert.equal(context.__nodes.researchProgressWrap.style.display, 'block');
  assert.match(context.__nodes.researchRunMessage.textContent, /25 \/ 100개 완료/);
  release();
  await task;
  assert.equal(context.researchReport.simulationCount, 1000000);
  assert.equal(context.researchHistory.length, 1);
  assert.equal(context.__nodes.runResearchBtn.disabled, false);
  assert.equal(context.__nodes.runResearchBtn.attributes['aria-busy'], 'false');
  assert.match(context.__nodes.researchRunMessage.textContent, /연구 완료/);
  assert.equal(context.__nodes.researchProgressPct.textContent, '100%');
});
