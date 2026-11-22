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

test('static JavaScript uses an explicit cache-busting version', () => {
  assert.match(html, /<script defer src="\/assets\/app\.js\?v=20261122-sync-status-1"><\/script>/);
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
  assert.match(html, /\/assets\/research-history\.js\?v=20261122-research-restore-1/);
  assert.match(app, /function importResearchHistoryFile\(file\)/);
  assert.match(app, /function renderResearchHistory\(\)/);
  assert.match(app, /function exportResearchHistory\(\)/);
  assert.match(app, /function syncResearchRuns\(token\)/);
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
  assert.match(html, /app\.css\?v=20261122-sync-status-1/);
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
