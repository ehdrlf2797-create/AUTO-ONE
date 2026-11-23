'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/app.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');
const exportUtilsSource = fs.readFileSync(path.join(root, 'assets/export-utils.js'), 'utf8');
const storageScopeSource = fs.readFileSync(path.join(root, 'assets/storage-scope.js'), 'utf8');
const researchHistorySource = fs.readFileSync(path.join(root, 'assets/research-history.js'), 'utf8');

test('frontend draw normalization preserves official sales and payout without trusting third-party totalSales', () => {
  const start = app.indexOf('function sortNums(numbers)');
  const end = app.indexOf('\nfunction extractDraws(json)', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  vm.runInNewContext(
    app.slice(start, end) + '\nthis.normalizeDraw = normalizeDraw;',
    context
  );

  const base = {
    round: 1250,
    numbers: [1, 5, 18, 23, 27, 28],
    bonus: 8,
    totalSales: 58496443856,
    wholEpsdSumNtslAmt: 116992886000,
    rlvtEpsdSumNtslAmt: 58496443856
  };
  const draw = context.normalizeDraw(base);
  assert.equal(draw.totalSales, 116992886000);
  assert.equal(draw.totalPrizePayout, 58496443856);

  const missingOfficialSales = context.normalizeDraw({
    ...base,
    wholEpsdSumNtslAmt: undefined,
    rlvtEpsdSumNtslAmt: undefined
  });
  assert.equal(missingOfficialSales.totalSales, null);
  assert.equal(missingOfficialSales.totalPrizePayout, null);

  const csvDraw = context.normalizeDraw({
    ...base,
    wholEpsdSumNtslAmt: undefined,
    rlvtEpsdSumNtslAmt: undefined,
    totalSales: 58496443856,
    totSellamnt: 116992886000,
    rnk1WnAmt: 100, rnk1WnNope: 2,
    rnk2WnAmt: 20, rnk2WnNope: 3,
    rnk3WnAmt: 5, rnk3WnNope: 4,
    rnk4WnAmt: 4, rnk4WnNope: 5,
    rnk5WnAmt: 1, rnk5WnNope: 6
  });
  assert.equal(csvDraw.totalSales, 116992886000);
  assert.equal(csvDraw.totalPrizePayout, 306);
});

test('historical ambiguous totalSales aliases cannot overwrite CSV sales or rank payout', () => {
  const start = app.indexOf('function sortNums(numbers)');
  const end = app.indexOf('\nfunction extractDraws(json)', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  vm.runInNewContext(app.slice(start, end) + '\nthis.normalizeDraw = normalizeDraw;', context);

  const round289 = context.normalizeDraw({
    round: 289,
    date: '2008-06-14',
    numbers: [3, 14, 33, 37, 38, 42],
    bonus: 10,
    totalSales: 19703321500,
    totSellamnt: 39406643000,
    ranks: [
      {rank:1, prize:0, winners:0},
      {rank:2, prize:63761694, winners:24},
      {rank:3, prize:1501748, winners:1019},
      {rank:4, prize:58541, winners:52281},
      {rank:5, prize:5000, winners:880103}
    ]
  });
  assert.equal(round289.totalSales, 39406643000);
  assert.equal(round289.totalPrizePayout, 10521658889);

  const round296 = context.normalizeDraw({
    round: 296,
    date: '2008-08-02',
    numbers: [3, 8, 15, 27, 30, 45],
    bonus: 44,
    totalSales: 31688949500,
    totSellamnt: 63377899000,
    ranks: [
      {rank:1, prize:3066088275, winners:8},
      {rank:2, prize:46243415, winners:53},
      {rank:3, prize:1186303, winners:2066},
      {rank:4, prize:54498, winners:89945},
      {rank:5, prize:5000, winners:1435988}
    ]
  });
  assert.equal(round296.totalSales, 63377899000);
  assert.equal(round296.totalPrizePayout, 41512271803);
});

test('CSV history parser maps total sales and derives complete rank payout totals', () => {
  const helperStart = app.indexOf('function sortNums(numbers)');
  const normalizerEnd = app.indexOf('\nfunction extractDraws(json)', helperStart);
  const csvStart = app.indexOf('function parseCsvLine(line)');
  const csvEnd = app.indexOf('\n\nasync function refreshData', csvStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(normalizerEnd, -1);
  assert.notEqual(csvStart, -1);
  assert.notEqual(csvEnd, -1);

  const context = {};
  vm.runInNewContext(
    app.slice(helperStart, normalizerEnd) + '\n' +
    app.slice(csvStart, csvEnd) +
    '\nthis.parseCsv = parseCsv;',
    context
  );
  const csv = [
    'drwNo,drwNoDate,n1,n2,n3,n4,n5,n6,bonus,firstWinamnt,firstPrzwnerCo,secondWinamnt,secondPrzwnerCo,thirdWinamnt,thirdPrzwnerCo,fourthWinamnt,fourthPrzwnerCo,fifthWinamnt,fifthPrzwnerCo,totSellamnt',
    '1251,2026-11-21,14,18,19,29,40,45,1,2068843286,14,50284386,96,1693196,2851,50000,146963,5000,2505977,116992886000'
  ].join('\n');
  const [draw] = context.parseCsv(csv);
  assert.equal(draw.totalSales, 116992886000);
  assert.equal(draw.totalPrizePayout, 58496443856);

  const incompleteRanks = context.normalizeDraw({
    round: 1251,
    numbers: [14, 18, 19, 29, 40, 45],
    bonus: 1,
    ranks: [
      {rank:1, prize:10, winners:1},
      {rank:1, prize:20, winners:1},
      {rank:2, prize:10, winners:1},
      {rank:3, prize:10, winners:1},
      {rank:4, prize:10, winners:1},
      {rank:5, prize:10, winners:1}
    ]
  });
  assert.equal(incompleteRanks.totalPrizePayout, null);
  assert.deepEqual(Array.from(incompleteRanks.ranks, item => item.rank), [2,3,4,5],
    'all occurrences of a duplicate rank must be excluded from frontend payout data');
});

test('mergeDraws keeps trusted winning numbers and fills missing financial metrics from CSV', () => {
  const helperStart = app.indexOf('function sortNums(numbers)');
  const normalizerEnd = app.indexOf('\nfunction extractDraws(json)', helperStart);
  const mergeStart = app.indexOf('function sourceTrust(source)');
  const mergeEnd = app.indexOf('\nfunction hasRealDrawData', mergeStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(normalizerEnd, -1);
  assert.notEqual(mergeStart, -1);
  assert.notEqual(mergeEnd, -1);

  const context = {};
  vm.runInNewContext(
    app.slice(helperStart, normalizerEnd) + '\n' +
    app.slice(mergeStart, mergeEnd) +
    '\nthis.mergeDraws = mergeDraws;',
    context
  );
  const officialNumbers = [14, 18, 19, 29, 40, 45];
  const preferred = {
    round: 1251, date: '2026-11-21', numbers: officialNumbers, bonus: 1,
    ranks: [], source: 'GitHub 원본 JSON'
  };
  const csvBackup = {
    round: 1251, date: '2026-11-21', numbers: [1, 2, 3, 4, 5, 6], bonus: 7,
    source: 'CSV 보조 사본', totSellamnt: 116992886000,
    rnk1WnAmt: 2068843286, rnk1WnNope: 14,
    rnk2WnAmt: 50284386, rnk2WnNope: 96,
    rnk3WnAmt: 1693196, rnk3WnNope: 2851,
    rnk4WnAmt: 50000, rnk4WnNope: 146963,
    rnk5WnAmt: 5000, rnk5WnNope: 2505977
  };
  const [merged] = context.mergeDraws([preferred], [csvBackup]);
  assert.deepEqual(Array.from(merged.numbers), officialNumbers);
  assert.equal(merged.source, 'GitHub 원본 JSON');
  assert.equal(merged.totalSales, 116992886000);
  assert.equal(merged.totalPrizePayout, 58496443856);
  assert.equal(merged.ranks.length, 5);
});

test('all nine app sections are reachable from the mobile navigation', () => {
  const navStart = html.indexOf('<nav class="mobile-nav"');
  assert.notEqual(navStart, -1, 'mobile navigation must exist');
  const navEnd = html.indexOf('</nav>', navStart);
  assert.notEqual(navEnd, -1, 'mobile navigation must be closed');
  const nav = html.slice(navStart, navEnd);
  const pages = [...nav.matchAll(/data-page="([^"]+)"/g)].map(match => match[1]);

  assert.equal(pages.length, 9, 'all nine sections should be represented');
  assert.equal(new Set(pages).size, 9, 'navigation targets should be unique');
  for (const page of pages) {
    assert.ok(html.includes(`id="page-${page}"`), `missing page container for ${page}`);
  }
  assert.match(nav, /aria-label="주요 메뉴"/, 'mobile navigation needs an accessible label');
});

test('mobile navigation stays visible and respects device safe areas', () => {
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /\.mobile-nav\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.mobile-nav button\.active/);
});

test('interactive controls have a visible keyboard focus state', () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /outline:\s*2px solid var\(--lime\)/);
});

test('layout includes reduced-motion and compact-phone adaptations', () => {
  assert.match(css, /@media\s*\(max-width:\s*420px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('status updates are announced to assistive technology', () => {
  assert.match(html, /id="dataStatus"[^>]*role="status"[^>]*aria-live="polite"/);
});

test('HTML element IDs are unique and every app.js DOM lookup exists', () => {
  const app = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(ids).size, ids.length, 'HTML IDs must be unique');
  const idSet = new Set(ids);
  const lookups = [...app.matchAll(/\$\(['"]([^'"]+)['"]\)/g)].map(match=>match[1]);
  const missing = [...new Set(lookups.filter(id=>!idSet.has(id)))];
  assert.deepEqual(missing, [], 'all literal app.js DOM lookups must exist in index.html');
});

test('static assets use explicit cache-busting versions and load shared utilities first', () => {
  assert.ok(html.includes('<link rel="stylesheet" href="/assets/app.css?v=20261123-sales-payout-ui-1" />'));
  assert.ok(html.includes('<script defer src="/assets/export-utils.js?v=20261124-export-utils-1"></script>'));
  assert.ok(html.includes('<script defer src="/assets/app.js?v=20261124-security-storage-1"></script>'));
  assert.ok(html.indexOf('/assets/export-utils.js') < html.indexOf('/assets/app.js'),
    'shared export utilities must load before the app entry point');
});

test('deployment adds clickjacking and cross-domain policy protection', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  const globalHeaders = config.headers.find(item=>item.source==='/(.*)')?.headers || [];
  const values = Object.fromEntries(globalHeaders.map(item=>[item.key.toLowerCase(),item.value]));
  assert.equal(values['x-frame-options'],'DENY');
  assert.equal(values['x-permitted-cross-domain-policies'],'none');
});

test('saved report aggregation scans history once and preserves prior report metrics', () => {
  const app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
  const start=app.indexOf('function buildSavedCheckReportStats(');
  const end=app.indexOf('\nfunction renderSavedReports()',start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  const context={};
  vm.runInNewContext(
    app.slice(start,end)+'\nthis.buildSavedCheckReportStats=buildSavedCheckReportStats;',
    context
  );
  const saved=[
    {id:'a',numbers:[1,2,3,4,5,6]},
    {id:'b',numbers:[7,8,9,10,11,12]}
  ];
  const history=[
    {id:'1',savedId:'a',round:1250,checkedAt:'2026-11-14T10:00:00Z',rank:'4등',matches:4},
    {id:'2',savedId:'b',round:1250,checkedAt:'2026-11-14T11:00:00Z',rank:'1등',matches:6},
    {id:'3',savedId:'a',round:1249,checkedAt:'2026-11-08T10:00:00Z',rank:'5등',matches:3},
    {id:'4',savedId:'b',round:1248,checkedAt:'2026-11-01T10:00:00Z',rank:'낙첨',matches:1},
    {id:'5',savedId:'unknown',round:1247,checkedAt:'2026-10-25T10:00:00Z',rank:'2등',matches:5}
  ];
  const report=context.buildSavedCheckReportStats(saved,history);
  assert.equal(report.total,5);
  assert.equal(report.top,2);
  assert.equal(report.low,2);
  assert.equal(report.last.id,'1');
  assert.equal(report.rows[0].entry.id,'b');
  assert.equal(report.rows[0].checks,2);
  assert.equal(report.rows[0].wins,1);
  assert.equal(report.rows[0].top3,1);
  assert.equal(report.rows[0].avg,3.5);
  assert.equal(report.rows[1].entry.id,'a');
  assert.equal(report.rows[1].checks,2);
  assert.equal(report.rows[1].avg,3.5);
  assert.deepEqual(Array.from(report.recentHistory,row=>row.id),['2','1','3','4','5']);
});

test('saved report keeps only 30 newest history rows while counting the entire history', () => {
  const app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
  const start=app.indexOf('function buildSavedCheckReportStats(');
  const end=app.indexOf('\nfunction renderSavedReports()',start);
  const context={};
  vm.runInNewContext(app.slice(start,end)+'\nthis.buildSavedCheckReportStats=buildSavedCheckReportStats;',context);
  const history=Array.from({length:5000},(_,index)=>({
    id:String(index),savedId:'a',round:index+1,
    checkedAt:new Date(index*1000).toISOString(),rank:'낙첨',matches:index%7
  }));
  const report=context.buildSavedCheckReportStats([{id:'a'}],history);
  assert.equal(report.total,5000);
  assert.equal(report.recentHistory.length,30);
  assert.equal(report.recentHistory[0].round,5000);
  assert.equal(report.recentHistory.at(-1).round,4971);
  assert.equal(report.rows[0].checks,5000);
  assert.ok(report.rows[0].avg>=0 && report.rows[0].avg<=6);
});

test('saved report renderer uses pre-aggregated stats rather than filtering history per saved ticket', () => {
  const app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
  const start=app.indexOf('function renderSavedReports() {');
  const end=app.indexOf('\nfunction exportSavedCheckHistory()',start);
  const renderer=app.slice(start,end);
  assert.match(renderer,/buildSavedCheckReportStats\(saved,savedCheckHistory\)/);
  assert.doesNotMatch(renderer,/savedCheckHistory\.filter\(/);
});



test('dedicated simulation page exposes run, graph, result storage, and number-combination controls', () => {
  assert.match(html, /id="page-simulation"/);
  assert.match(html, /data-page="simulation"/);
  assert.match(html, /id="runSimulationStudioBtn"/);
  assert.match(html, /id="simulationFrequencyChart"/);
  assert.match(html, /id="simulationProfileSelect"/);
  assert.match(html, /id="buildSimulationTicketsBtn"/);
  assert.match(html, /id="saveSimulationTicketsBtn"/);
  assert.match(css, /\.simulation-frequency-grid/);
  assert.match(css, /\.simulation-expected-marker/);
});


test('generator page supports one-click bulk save and displays deduplicated odds summary', () => {
  assert.match(html, /id="saveAllResultsBtn"[^>]*disabled/);
  assert.match(html, /id="generatedSummary"/);
  assert.match(html, /id="results"/);
  assert.match(app, /function saveAllGenerated\(\)/);
  assert.match(app, /buildBulkSavedEntries\(generated,saved,generatedMode\)/);
  assert.match(app, /function summarizeGeneratedTickets\(tickets, savedEntries = \[\]\)/);
  assert.match(app, /TOTAL_LOTTO_COMBINATIONS = 8145060/);
  assert.match(app, /if\(!persistSaved\(\[\.\.\.prepared\.entries,\.\.\.saved\]\)\) return false/);
  assert.match(css, /\.generator-summary/);
  assert.match(css, /\.generator-result-actions/);
});


test('research lab is reachable and exposes fixed research configuration', () => {
  assert.match(html, /id="page-research"/);
  assert.match(html, /data-page="research"/);
  assert.match(html, /id="runResearchBtn"/);
  assert.match(html, /100 전략 · 무작위 200명 · 1,000,000회/);
  assert.match(html, /\/assets\/research\.js\?v=20261122-research-restore-1/);
  assert.match(app, /runResearchLab/);
  assert.match(app, /RESEARCH_CANDIDATES_KEY/);
  assert.match(app, /RESEARCH_HISTORY_KEY/);
  assert.match(html, /id="researchHistoryList"/);
  assert.match(html, /id="researchCompareSelect"/);
  assert.match(html, /id="exportResearchHistoryBtn"/);
  assert.match(html, /id="importResearchHistoryBtn"/);
  assert.match(html, /id="researchHistoryImportFile"/);
  assert.match(html, /\/assets\/research-history\.js\?v=20261122-import-session-guard-1/);
  assert.match(app, /function importResearchHistoryFile\(file\)/);
  assert.match(app, /function renderResearchHistory\(\)/);
  assert.match(app, /function exportResearchHistory\(\)/);
  assert.match(app, /function syncResearchRuns\(token,/);
  assert.match(app, /lucky645_research_runs/);
});


test('research control stays clickable for actionable preflight diagnostics', () => {
  const section = html.slice(html.indexOf('id="page-research"'), html.indexOf('id="page-checker"'));
  assert.match(section, /id="runResearchBtn"[^>]*aria-busy="false"/);
  assert.doesNotMatch(section, /id="runResearchBtn"[^>]*disabled/);
  assert.match(section, /id="researchRunMessage"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(app, /button\.disabled = researchRunning;/);
  assert.match(app, /데이터 사전 검사 실패:/);
  assert.match(app, /updateResearchProgress\('2\/4 무작위 기준선 '/);
  assert.match(app, /updateResearchProgress\('3\/4 전략 토너먼트 '/);
  assert.match(app, /updateResearchProgress\('4\/4 몬테카를로 '/);
  assert.match(app, /recordResearchRun\(report\)/);
});


test('research lab includes randomized tournament and run-history comparison surfaces', () => {
  assert.match(html, /무작위 200명/);
  assert.match(html, /5개 시간순 구간/);
  assert.match(app, /randomWinRate/);
  assert.match(app, /researchCompareSummary/);
  assert.match(app, /RESEARCH_HISTORY_KEY/);
  assert.match(app, /MAX_RESEARCH_HISTORY = 12/);
  assert.match(css, /\.research-history-row/);
  assert.match(css, /\.research-tournament-summary/);
});


test('cloud sync panel exposes status, counts, retry and backup management', () => {
  assert.match(html, /id="cloudSyncDetails"/);
  assert.ok(html.includes('app.css?v=20261123-sales-payout-ui-1'));
  assert.match(html, /id="cloudSyncNowBtn"/);
  assert.match(app, /lastSuccessAt/);
  assert.match(app, /uploaded/);
  assert.match(app, /downloaded/);
  assert.match(app, /status:'error'/);
  assert.match(app, /syncCloudData\(\)\.catch/);
  assert.match(app, /MAX_RESEARCH_BACKUPS = 5/);
  assert.match(app, /86400000/);
  assert.match(app, /downloadLatestResearchBackup/);
  assert.match(app, /restoreLatestResearchBackup/);
});

test('research backup restore merges with current records and rolls back on persistence failure', () => {
  assert.match(app, /Lucky645ResearchHistory\.mergeRuns\(backup\.runs,researchHistory\)/);
  assert.match(app, /if\(!persistResearchState\(\)\)\{researchHistory=previous\.history/);
  assert.match(app, /현재 연구 이력과 병합할까요/);
});


test('automatic research restore points are isolated by signed-in account', () => {
  assert.match(app, /String\(item\.userId\|\|'local'\)===owner/);
  assert.match(app, /userId:cloudSession\?\.user\?\.id\|\|'local'/);
});


test('account switching reloads account-scoped backups and preserves other accounts when persisting', () => {
  assert.match(app, /researchBackups=loadResearchBackups\(\);\s*renderCloudAuth\(\);/);
  assert.match(app, /const otherAccounts=stored\.filter\(item=>item&&String\(item\.userId\|\|'local'\)!==owner\)/);
  assert.match(app, /const currentAccount=researchBackups\.map\(item=>\(\{\.\.\.item,userId:owner\}\)\)/);
  assert.match(app, /function downloadLatestResearchBackup\(\)\s*\{\s*const backup=researchBackups\[0\]; if\(!backup\|\|String\(backup\.userId\|\|'local'\)!==\(cloudSession\?\.user\?\.id\|\|'local'\)\)return;/);
});

test('research sync uploads changed local winner for same run ID but not stale copies', () => {
  assert.match(app, /selectRunsToUpload\(researchHistory, remoteReports\)/);
  assert.match(researchHistorySource, /function selectRunsToUpload\(localRuns, remoteRuns\)/);
});


test('cloud sync pins all reads and writes to the initiating account session', () => {
  assert.match(app, /let cloudSessionGeneration = 0/);
  assert.match(app, /function assertCloudSyncSession\(expectedUserId,expectedGeneration=cloudSessionGeneration\)/);
  assert.match(app, /const syncUserId=cloudSession\.user\.id;\s*const syncGeneration=cloudSessionGeneration;/);
  assert.match(app, /cloudUpsert\(\[\.\.\.activeRows,\.\.\.deletedRows\],token,syncUserId,syncGeneration\)/);
  assert.match(app, /syncResearchRuns\(token,syncUserId,syncGeneration\)/);
  assert.match(app, /user_id:expectedUserId/);
});

test('switching or signing out during cloud sync invalidates the old sync generation', () => {
  assert.match(app, /if\(previousUserId!==nextUserId\)\{\s*cloudSessionGeneration\+\+/);
  assert.match(app, /if\(cloudSyncPromise\)cloudSyncRequested=Boolean\(nextUserId\)/);
  assert.match(app, /if\(cloudSessionGeneration===syncGeneration&&cloudSession\?\.user\?\.id===syncUserId\)/);
});


test('account-owned browser records use isolated namespaces and migrate legacy data only to the first account', () => {
  assert.match(storageScopeSource, /function createAccountStorage\(options\)/);
  assert.match(storageScopeSource, /const scopedKeys = new Set/);
  assert.match(storageScopeSource, /return name \+ '::' \+ String\(owner\)/);
  assert.match(storageScopeSource, /if \(seen\.length === 0\)/);
  assert.match(storageScopeSource, /storage\.removeItem\(name\)/);
  assert.match(app, /window\.Lucky645Storage\.createAccountStorage\(/);
  assert.match(app, /function accountScopedStorageKey\(key,userId\)/);
  assert.match(app, /function appStorageGet\(key\)/);
  assert.match(app, /function appStorageSet\(key,value\)/);
  assert.match(app, /function reloadAccountScopedState\(\)/);
  assert.match(app, /if\(previousUserId!==nextUserId\)reloadAccountScopedState\(\)/);
  assert.match(app, /activateAccountStorageScope\(nextUserId\)/);
  assert.match(app, /let researchRunGeneration = 0/);
  assert.match(app, /if\(runGeneration!==researchRunGeneration\)return/);
  assert.match(app, /researchRunGeneration\+\+/);
  for (const key of ['SAVED_KEY','SAVED_CHECKS_KEY','AUTO_CHECK_KEY','SIMULATION_HISTORY_KEY','RESEARCH_REPORT_KEY','RESEARCH_HISTORY_KEY','RESEARCH_CANDIDATES_KEY','CLOUD_SYNC_META_KEY']) {
    assert.match(app, new RegExp(key));
  }
});


test('account storage module migrates legacy data once and isolates accounts', () => {
  const storage = new Map([
    ['lucky645_saved','legacy-ticket-data'],
    ['lucky645_simulation_history_v1','legacy-sim-data']
  ]);
  const localStorage = {
    getItem:key=>storage.has(key)?storage.get(key):null,
    setItem:(key,value)=>storage.set(key,String(value)),
    removeItem:key=>storage.delete(key)
  };
  let activeUser = null;
  const context = {window:{}};
  vm.runInNewContext(storageScopeSource, context);
  const scope = context.window.Lucky645Storage.createAccountStorage({
    storage:localStorage,
    scopedKeys:['lucky645_saved','lucky645_simulation_history_v1'],
    seenKey:'lucky645_account_scope_seen_v1',
    getCurrentUserId:()=>activeUser
  });

  assert.equal(scope.activate('account-A'),true);
  assert.equal(storage.get('lucky645_saved::account-A'),'legacy-ticket-data');
  assert.equal(storage.get('lucky645_simulation_history_v1::account-A'),'legacy-sim-data');
  assert.equal(storage.has('lucky645_saved'),false);

  activeUser='account-A';
  scope.set('lucky645_saved','account-A-ticket');
  assert.equal(scope.get('lucky645_saved'),'account-A-ticket');
  assert.equal(scope.activate('account-B'),true);
  activeUser='account-B';
  assert.equal(scope.get('lucky645_saved'),null);
  scope.set('lucky645_saved','account-B-ticket');
  activeUser=null;
  assert.equal(scope.get('lucky645_saved'),null);
  activeUser='account-A';
  assert.equal(scope.get('lucky645_saved'),'account-A-ticket');
  activeUser='account-B';
  assert.equal(scope.get('lucky645_saved'),'account-B-ticket');
  assert.equal(scope.key('unscoped'),'unscoped');
});

test('account storage migration failure preserves legacy data and does not mark the account as initialized', () => {
  const storage = new Map([['lucky645_saved','legacy-ticket-data']]);
  let failScopedWrite = true;
  const localStorage = {
    getItem:key=>storage.has(key)?storage.get(key):null,
    setItem(key,value) {
      if (failScopedWrite && key === 'lucky645_saved::account-A') throw new Error('quota exceeded');
      storage.set(key,String(value));
    },
    removeItem:key=>storage.delete(key)
  };
  const context={window:{}};
  vm.runInNewContext(storageScopeSource,context);
  const scope=context.window.Lucky645Storage.createAccountStorage({
    storage:localStorage,
    scopedKeys:['lucky645_saved'],
    seenKey:'seen',
    getCurrentUserId:()=>null
  });

  assert.equal(scope.activate('account-A'),false);
  assert.equal(storage.get('lucky645_saved'),'legacy-ticket-data');
  assert.equal(storage.has('seen'),false);
  failScopedWrite=false;
  assert.equal(scope.activate('account-A'),true);
  assert.equal(storage.get('lucky645_saved::account-A'),'legacy-ticket-data');
  assert.equal(storage.has('lucky645_saved'),false);
});


test('asynchronous backup imports stay pinned to the account that started the import', () => {
  assert.match(app, /function assertAccountScope\(expectedUserId,expectedGeneration\)/);
  assert.match(app, /async function importSavedBackup\(file\)[\s\S]*?const importOwner=cloudSession\?\.user\?\.id\|\|'local';[\s\S]*?const importGeneration=cloudSessionGeneration;[\s\S]*?const fileText=await file\.text\(\);[\s\S]*?assertAccountScope\(importOwner,importGeneration\)/);
  assert.match(app, /async function importResearchHistoryFile\(file\)[\s\S]*?const importOwner=cloudSession\?\.user\?\.id\|\|'local';[\s\S]*?const importGeneration=cloudSessionGeneration;[\s\S]*?const fileText=await file\.text\(\);[\s\S]*?assertAccountScope\(importOwner,importGeneration\)/);
  assert.match(app, /syncResearchRuns\(token,importOwner,importGeneration\)/);
});


test('latest draw card renders sales and total payout independently and never turns missing values into zero', () => {
  assert.ok(html.includes('id="latestSales"'));
  assert.ok(html.includes('id="latestPayout"'));
  const start = app.indexOf('function renderLatest()');
  const end = app.indexOf('\nfunction loadResearchReport()', start);
  assert.ok(start >= 0 && end > start);
  const elements = Object.fromEntries([
    'latestRound','latestBalls','latestVerification','latestDate','latestSourceLabel',
    'latestBonus','latestSales','latestPayout','checkRound','statDrawCount'
  ].map(id => [id, {textContent:'',innerHTML:'',className:'',value:''}]));
  const draw = {
    round:1251,date:'2026-11-21',numbers:[14,18,19,29,40,45],bonus:1,
    totalSales:116992886000,totalPrizePayout:58496443856
  };
  const context = {
    $: id => elements[id],
    latest:draw,
    draws:[draw],
    latestVerification:'official',
    FALLBACK_DRAW:{source:'fallback'},
    hasRealDrawData:()=>true,
    ball:number=>`[${number}]`,
    formatDrawMoney:value=>value == null ? '자료 없음' : `${Number(value).toLocaleString('ko-KR')}원`,
    formatNumber:value=>Number(value||0).toLocaleString('ko-KR')
  };
  vm.runInNewContext(app.slice(start,end)+'\nthis.renderLatest=renderLatest;',context);
  context.renderLatest();
  assert.equal(elements.latestSales.textContent,'116,992,886,000원');
  assert.equal(elements.latestPayout.textContent,'58,496,443,856원');
  context.latest={...draw,totalSales:null,totalPrizePayout:null};
  context.renderLatest();
  assert.equal(elements.latestSales.textContent,'자료 없음');
  assert.equal(elements.latestPayout.textContent,'자료 없음');
});

test('draw history table shows distinct sales and payout columns with explicit missing values', () => {
  const start = app.indexOf('function renderHistory()');
  const end = app.indexOf('\nasync function getDraw(', start);
  assert.ok(start >= 0 && end > start);
  const elements = {
    historyPageLabel:{textContent:''},
    prevHistory:{disabled:false},
    nextHistory:{disabled:false},
    historyList:{innerHTML:''}
  };
  const draw = {
    round:1251,date:'2026-11-21',numbers:[14,18,19,29,40,45],bonus:1,
    ranks:[{rank:1,winners:14}],totalSales:116992886000,totalPrizePayout:58496443856
  };
  const context = {
    draws:[draw],historySearchActive:false,filteredHistory:null,historyPage:0,
    $:id=>elements[id],
    ball:number=>`[${number}]`,
    escapeHtml:String,
    formatNumber:value=>Number(value||0).toLocaleString('ko-KR'),
    formatDrawMoney:value=>value == null ? '자료 없음' : `${Number(value).toLocaleString('ko-KR')}원`
  };
  vm.runInNewContext(app.slice(start,end)+'\nthis.renderHistory=renderHistory;',context);
  context.renderHistory();
  assert.ok(elements.historyList.innerHTML.includes('<th>판매액</th>'));
  assert.ok(elements.historyList.innerHTML.includes('<th>총 당첨금</th>'));
  assert.ok(elements.historyList.innerHTML.includes('116,992,886,000원'));
  assert.ok(elements.historyList.innerHTML.includes('58,496,443,856원'));
  draw.totalSales=null;
  draw.totalPrizePayout=null;
  context.renderHistory();
  assert.equal((elements.historyList.innerHTML.match(/자료 없음/g)||[]).length,2);
});



test('draw data refresh exposes a manual retry and always restores the refresh control', () => {
  const start = app.indexOf('async function refreshData(');
  const end = app.indexOf('\nfunction updateTopStats()', start);
  assert.notEqual(start, -1, 'refresh workflow must exist');
  assert.notEqual(end, -1, 'refresh workflow must have a clear boundary');
  const refreshSource = app.slice(start, end);

  assert.match(html, /id="refreshBtn"/, 'manual refresh control must exist');
  assert.match(app, /\$\('refreshBtn'\)\.addEventListener\('click',\(\)=>refreshData\(true\)\)/);
  assert.match(refreshSource, /if \(isRefreshing\) return;/, 'duplicate refresh requests must be blocked');
  assert.match(refreshSource, /refreshButton\.disabled = true/);
  assert.match(refreshSource, /status\.textContent = '데이터 연결 확인 필요'/);
  assert.match(refreshSource, /status\.title = errors\.join/);
  assert.match(refreshSource, /finally \{[\s\S]*isRefreshing = false;[\s\S]*refreshButton\.disabled = false;/,
    'refresh lock and button must be restored after both success and failure');
});

test('refresh failure reports the error and releases the retry control', async () => {
  const start = app.indexOf('async function refreshData(');
  const end = app.indexOf('\nfunction updateTopStats()', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const status = {textContent:'', title:'', style:{}};
  const refreshButton = {disabled:false};
  const context = {
    $: id => id === 'dataStatus' ? status : (id === 'refreshBtn' ? refreshButton : null),
    isRefreshing:false,
    syncMeta:{status:'idle', errors:[]},
    persistSyncMeta(){},
    API_ALL_SOURCES:[],
    API_PROXY_LATEST:'/api/lotto?type=latest',
    API_LATEST:'https://official.invalid/latest',
    API_LATEST_FALLBACK:'https://mirror.invalid/latest',
    CSV_FALLBACK:'https://csv.invalid/history.csv',
    getJson:async () => { throw new Error('source_unavailable'); },
    getText:async () => { throw new Error('csv_unavailable'); },
    isUnavailableLocalProxy:() => false,
    draws:[],
    FALLBACK_DRAW:{round:1,source:'fallback',numbers:[],bonus:0},
    mergeDraws:() => { throw new Error('forced_refresh_failure'); },
    hasRealDrawData:() => false,
    renderLatest(){},
    toast(){}
  };

  vm.createContext(context);
  vm.runInContext(app.slice(start,end) + '\nthis.refreshData = refreshData;', context);
  await context.refreshData(false);

  assert.equal(status.textContent, '데이터 연결 확인 필요');
  assert.match(status.title, /forced_refresh_failure/);
  assert.equal(context.syncMeta.status, 'error');
  assert.equal(context.isRefreshing, false);
  assert.equal(refreshButton.disabled, false);
});


test('a late refresh-token response cannot restore the previous account after account switching', async () => {
  const start = app.indexOf('async function cloudAccessToken()');
  const end = app.indexOf('\nfunction renderCloudAuth(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  let resolveRefresh;
  const refreshResponse = new Promise(resolve => { resolveRefresh = resolve; });
  const context = {
    cloudSession:{user:{id:'account-A'},access_token:'expired-A',refresh_token:'refresh-A',expires_at:1},
    cloudSessionGeneration:0,
    cloudAuth:() => refreshResponse,
    saveCloudSession(session) {
      const previousId=this.cloudSession?.user?.id||'';
      const nextId=session?.user?.id||'';
      if(previousId!==nextId)this.cloudSessionGeneration++;
      this.cloudSession=session;
    },
    appStorageGet:() => null,
    renderCloudAuth(){}
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start,end)+'\nthis.refreshAccessToken = cloudAccessToken;',context);

  const pending = context.refreshAccessToken();
  context.cloudSession={user:{id:'account-B'},access_token:'access-B',refresh_token:'refresh-B',expires_at:9999999999};
  context.cloudSessionGeneration++;
  resolveRefresh({user:{id:'account-A'},access_token:'access-A-new',refresh_token:'refresh-A-new',expires_in:3600});

  await assert.rejects(pending,/계정이 변경되어 이전 로그인 세션 갱신을 취소했습니다/);
  assert.equal(context.cloudSession.user.id,'account-B');
  assert.equal(context.cloudSession.access_token,'access-B');
  assert.equal(context.cloudSessionGeneration,1);
});


test('CSV export quotes cells and neutralizes imported spreadsheet formula payloads', () => {
  const context = {window:{}};
  vm.runInNewContext(exportUtilsSource, context);
  const csvCell = context.window.Lucky645ExportUtils.csvCell;
  assert.equal(typeof csvCell, 'function');

  const cases = [
    ['=1+1', "'=1+1"],
    ['+SUM(1,1)', "'+SUM(1,1)"],
    ['-1+cmd|/C calc', "'-1+cmd|/C calc"],
    ['@SUM(1,1)', "'@SUM(1,1)"],
    ['\t=HYPERLINK("https://example.invalid","open")', "'\t=HYPERLINK(\"https://example.invalid\",\"open\")"],
    ['  @SUM(1,1)', "'  @SUM(1,1)"],
    ['ordinary label', 'ordinary label'],
    [-12, '-12']
  ];

  for (const [input, expected] of cases) {
    assert.equal(csvCell(input), '"' + expected.replace(/"/g, '""') + '"');
  }
  assert.match(app, /rows\.map\(row=>row\.map\(window\.Lucky645ExportUtils\.csvCell\)\.join\(','\)\)/,
    'every exported CSV field must pass through the shared sanitizer');
  assert.match(html, /assets\/export-utils\.js\?v=/,
    'export utilities must load as a script before app.js');
});


test('backup import limits reject oversized saved-entry and history arrays before processing', () => {
  const start = app.indexOf('function validateSavedBackupLimits(');
  const end = app.indexOf('\nfunction normalizeSavedEntry', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    MAX_SAVED_BACKUP_ENTRIES:10000,
    MAX_SAVED_BACKUP_CHECK_HISTORY:50000,
    formatNumber:value=>Number(value).toLocaleString('ko-KR')
  };
  vm.runInNewContext(
    app.slice(start, end) + '\nthis.validateSavedBackupLimits = validateSavedBackupLimits;',
    context
  );

  assert.doesNotThrow(() => context.validateSavedBackupLimits([], []));
  assert.throws(
    () => context.validateSavedBackupLimits(Array(10001), []),
    /최대 10,000개/
  );
  assert.throws(
    () => context.validateSavedBackupLimits([], Array(50001)),
    /최대 50,000건/
  );
});


test('backup restore storage transaction rolls back earlier keys when a later write fails', () => {
  const start = app.indexOf('function writeStorageTransaction(entries)');
  const end = app.indexOf('\nasync function importSavedBackup', start);
  assert.ok(start >= 0 && end > start, 'transaction helper must exist before the backup importer');

  const storage = new Map([
    ['saved::account-A', 'old-saved'],
    ['history::account-A', 'old-history']
  ]);
  const writes = [];
  const context = {
    appStorageGet:key=>storage.has(key)?storage.get(key):null,
    appStorageSet(key,value) {
      writes.push([key,String(value)]);
      if (key === 'history::account-A' && value === 'new-history') {
        throw new Error('quota exceeded');
      }
      storage.set(key,String(value));
    },
    appStorageRemove:key=>storage.delete(key)
  };
  vm.runInNewContext(
    app.slice(start,end) + '\nthis.writeStorageTransaction = writeStorageTransaction;',
    context
  );

  assert.throws(() => context.writeStorageTransaction([
    ['saved::account-A','new-saved'],
    ['history::account-A','new-history'],
    ['meta::account-A','new-meta']
  ]), /기존 저장값으로 되돌렸습니다/);
  assert.equal(storage.get('saved::account-A'),'old-saved');
  assert.equal(storage.get('history::account-A'),'old-history');
  assert.equal(storage.has('meta::account-A'),false);
  assert.deepEqual(writes,[
    ['saved::account-A','new-saved'],
    ['history::account-A','new-history'],
    ['saved::account-A','old-saved']
  ]);
});

test('backup restore storage transaction commits all entries when every write succeeds', () => {
  const start = app.indexOf('function writeStorageTransaction(entries)');
  const end = app.indexOf('\nasync function importSavedBackup', start);
  const storage = new Map();
  const context = {
    appStorageGet:key=>storage.has(key)?storage.get(key):null,
    appStorageSet:(key,value)=>storage.set(key,String(value)),
    appStorageRemove:key=>storage.delete(key)
  };
  vm.runInNewContext(
    app.slice(start,end) + '\nthis.writeStorageTransaction = writeStorageTransaction;',
    context
  );
  assert.equal(context.writeStorageTransaction([
    ['saved','new-saved'],['history','new-history'],['meta','new-meta']
  ]),true);
  assert.equal(storage.get('saved'),'new-saved');
  assert.equal(storage.get('history'),'new-history');
  assert.equal(storage.get('meta'),'new-meta');
});

test('backup importer stages state and writes saved data, history and metadata transactionally', () => {
  const start = app.indexOf('async function importSavedBackup(file)');
  const end = app.indexOf('\nfunction modeLabel(mode)',start);
  assert.ok(start >= 0 && end > start);
  const importer = app.slice(start,end);
  assert.match(importer,/const nextSaved = saved\.map/);
  assert.match(importer,/const nextHistory = savedCheckHistory\.map/);
  assert.match(importer,/const nextMeta = \{\.\.\.autoCheckMeta\}/);
  assert.match(importer,/writeStorageTransaction\(\[/);
  assert.match(importer,/saved = nextSaved;[\s\S]*savedCheckHistory = boundedNextHistory;[\s\S]*autoCheckMeta = nextMeta;/);
  assert.doesNotMatch(importer,/persistAutoCheckMeta\(\)|persistSavedCheckHistory\(\)|persistSaved\(\)/,
    'the importer must not partially commit its individual storage records');
});


test('saved collection capacity accepts configured maxima and rejects overflow', () => {
  const start = app.indexOf('function assertSavedCollectionCapacity(');
  const end = app.indexOf('\nfunction normalizeSavedEntry',start);
  assert.ok(start >= 0 && end > start);
  const context = {
    MAX_SAVED_ENTRIES:10000,
    MAX_SAVED_BACKUP_CHECK_HISTORY:50000,
    formatNumber:value=>Number(value).toLocaleString('ko-KR')
  };
  vm.runInNewContext(
    app.slice(start,end) + '\nthis.assertSavedCollectionCapacity = assertSavedCollectionCapacity;',
    context
  );
  assert.doesNotThrow(() => context.assertSavedCollectionCapacity(10000,50000));
  assert.throws(() => context.assertSavedCollectionCapacity(10001,50000), /번호 보관함은 최대 10,000개/);
  assert.throws(() => context.assertSavedCollectionCapacity(10000,50001), /확인 이력은 최대 50,000건/);
});

test('manual, bulk and simulation saves respect the saved collection limit without mutating on overflow', () => {
  assert.match(app,/function saveCombination\(numbers,mode=activeMode\)[\s\S]*?if\(saved\.length>=MAX_SAVED_ENTRIES\)/);
  assert.match(app,/function saveAllGenerated\(\)[\s\S]*?if\(saved\.length\+prepared\.added>MAX_SAVED_ENTRIES\)/);
  const start=app.indexOf('function saveSimulationTicketSet()');
  const end=app.indexOf('\nfunction exportAnalyticsCsv',start);
  const simulationSave=app.slice(start,end);
  assert.match(simulationSave,/if\(saved\.length\+entries\.length>MAX_SAVED_ENTRIES\)/);
  assert.match(simulationSave,/persistSaved\(\[\.\.\.entries,\.\.\.saved\]\)/);
  assert.doesNotMatch(simulationSave,/saved\.unshift\(/,
    'simulation ticket save must stage records rather than mutate live state before persistence');
});
