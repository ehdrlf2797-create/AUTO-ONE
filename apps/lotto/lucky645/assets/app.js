'use strict';

const FALLBACK_DRAW = {
  round: 1249,
  date: '2026-11-07',
  numbers: [2, 11, 16, 25, 34, 35],
  bonus: 14,
  ranks: [
    { rank: 1, prize: 2025045509, winners: 14 },
    { rank: 2, prize: 50807594, winners: 93 },
    { rank: 3, prize: 1331016, winners: 3550 },
    { rank: 4, prize: 50000, winners: 162101 },
    { rank: 5, prize: 5000, winners: 2634961 }
  ],
  source: '기본 표시값(최신 회차 연결 전)'
};

// 누적 회차 데이터 사본과 동행복권 최신 회차 API를 함께 사용합니다.
const drawDomain = window.Lucky645DataDomain.createDomain();
const {
  normalizeDraw,
  extractDraws,
  normalizeOfficial,
  isContinuousHistory,
  sourceTrust,
  mergeDraws
} = drawDomain;
const DATA_SOURCE_ENDPOINTS = window.Lucky645DataSource.ENDPOINTS;
const API_ALL_SOURCES = DATA_SOURCE_ENDPOINTS.history;
const API_PROXY_LATEST = DATA_SOURCE_ENDPOINTS.latestProxy;
const API_LATEST = DATA_SOURCE_ENDPOINTS.officialLatest;
const API_LATEST_FALLBACK = DATA_SOURCE_ENDPOINTS.latestMirror;
const API_PROXY_BATCH = DATA_SOURCE_ENDPOINTS.roundProxy;
const API_BATCH = DATA_SOURCE_ENDPOINTS.officialRound;
const CSV_FALLBACK = DATA_SOURCE_ENDPOINTS.csvHistory;
const dataSourceAdapter = window.Lucky645DataSource.createAdapter({ normalizeDraw });
const { getJson, getText, isUnavailableLocalProxy, parseCsv } = dataSourceAdapter;

const CACHE_KEY = 'lucky645_draws_cache_v1';
const SAVED_KEY = 'lucky645_saved';
const SYNC_KEY = 'lucky645_sync_meta_v1';
const SAVED_CHECKS_KEY = 'lucky645_saved_check_history_v1';
const SIMULATION_HISTORY_KEY = 'lucky645_simulation_history_v1';
const RESEARCH_REPORT_KEY = 'lucky645_research_report_v1';
const RESEARCH_CANDIDATES_KEY = 'lucky645_research_candidates_v1';
const RESEARCH_HISTORY_KEY = 'lucky645_research_history_v1';
const MAX_RESEARCH_HISTORY = 12;
const MAX_SIMULATION_HISTORY = 20;
const AUTO_CHECK_KEY = 'lucky645_auto_check_meta_v1';
const MAX_BACKUP_FILE_SIZE = 12 * 1024 * 1024;
const MAX_SAVED_ENTRIES = 10000;
const MAX_SAVED_BACKUP_ENTRIES = MAX_SAVED_ENTRIES;
const MAX_SAVED_BACKUP_CHECK_HISTORY = 50000;
const SUPABASE_URL = 'https://absljxjxrrhmswhpthol.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_OPEj3uNdx3wX7r9C6KDuuA_IuyeTD9p';
const CLOUD_TOMBSTONES_KEY = 'lucky645_cloud_tombstones_v1';
const CLOUD_SESSION_KEY = 'lucky645_cloud_session_v1';
const CLOUD_SYNC_META_KEY = 'lucky645_cloud_sync_meta_v1';
const RESEARCH_BACKUPS_KEY = 'lucky645_research_backups_v1';
const MAX_RESEARCH_BACKUPS = 5;
let cloudSession = loadCloudSession();

const ACCOUNT_SCOPE_SEEN_KEY = 'lucky645_account_scope_seen_v1';
const accountStorage = window.Lucky645Storage.createAccountStorage({
  storage: localStorage,
  scopedKeys: [
    SAVED_KEY, SAVED_CHECKS_KEY, AUTO_CHECK_KEY, SIMULATION_HISTORY_KEY,
    RESEARCH_REPORT_KEY, RESEARCH_HISTORY_KEY, RESEARCH_CANDIDATES_KEY,
    CLOUD_SYNC_META_KEY
  ],
  seenKey: ACCOUNT_SCOPE_SEEN_KEY,
  getCurrentUserId: () => cloudSession?.user?.id
});
function accountScopedStorageKey(key,userId) {
  return accountStorage.key(key,userId);
}
function activateAccountStorageScope(userId) {
  return accountStorage.activate(userId);
}
function appStorageGet(key) {
  return accountStorage.get(key);
}
function appStorageSet(key,value) {
  return accountStorage.set(key,value);
}
function appStorageRemove(key) {
  return accountStorage.remove(key);
}
activateAccountStorageScope(cloudSession?.user?.id);
let cloudSessionGeneration = 0;
let cloudApplying = false;
let cloudSyncTimer = null;
let cloudSyncPromise = null;
let cloudSyncRequested = false;
let cloudSyncMeta = loadCloudSyncMeta();
let researchBackups = loadResearchBackups();

let draws = loadCachedDraws();
let latest = draws.at(-1) || FALLBACK_DRAW;
let latestVerification = 'pending';
let dataReady = false;
let activeMode = 'random';
let generated = [];
let generatedMode = 'random';
let includeNums = [];
let excludeNums = [];
let manualNums = [];
let saved = loadSaved();
let savedCheckHistory = loadSavedCheckHistory();
let autoCheckMeta = loadAutoCheckMeta();
let savedBacktestResult = null;
let savedFilter = 'all';
let statsWeightPeriod = 'all';
let syncMeta = loadSyncMeta();
let historyPage = 0;
let filteredHistory = null;
let historySearchActive = false;
let historyRound = null;
let statsPeriod = 'all';
let analyticsPeriod = 'all';
let lastSimulation = null;
let simulationProfiles = loadSimulationProfiles();
let lastFrequencySimulation = null;
let simulationGeneratedTickets = [];
let researchReport = loadResearchReport();
let researchHistory = loadResearchHistory(researchReport);
let researchCompareRunId = '';
let researchCandidates = loadResearchCandidates();
let researchRunning = false;
let researchRunGeneration = 0;
let researchLastRunMessage = '';
let researchLastRunTone = 'normal';
let isRefreshing = false;

const $ = id => document.getElementById(id);
const formatNumber = n => Number(n || 0).toLocaleString('ko-KR');
const money = n => `${formatNumber(n)}원`;
const formatDrawMoney = value => value != null && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? money(Number(value)) : '자료 없음';
const escapeHtml = value => String(value).replace(/[&<>\"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[character]));

function normalizeSyncTimestamp(value) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}


function normalizeSimulationProfile(item,index=0) {
  if (!item || typeof item !== 'object') return null;
  const attempts=Number(item.attempts);
  const counts=Array.isArray(item.counts)?item.counts.map(Number):[];
  const allowed=[1000,10000,50000,100000];
  if (!allowed.includes(attempts) || counts.length!==45 ||
      counts.some(value=>!Number.isSafeInteger(value)||value<0) ||
      counts.reduce((sum,value)=>sum+value,0)!==attempts*6) return null;
  const createdAt=normalizeSyncTimestamp(item.createdAt);
  if (!createdAt) return null;
  return {
    id:String(item.id||('simulation-'+index)).slice(0,100),
    attempts,
    counts,
    createdAt,
    expectedPerNumber:attempts*6/45
  };
}

function loadSimulationProfiles() {
  try {
    const raw=JSON.parse(appStorageGet(SIMULATION_HISTORY_KEY)||'[]');
    return Array.isArray(raw)?raw.slice(0,MAX_SIMULATION_HISTORY).map(normalizeSimulationProfile).filter(Boolean):[];
  } catch (_) { return []; }
}

function persistSimulationProfiles(nextProfiles) {
  try {
    appStorageSet(SIMULATION_HISTORY_KEY,JSON.stringify(nextProfiles.slice(0,MAX_SIMULATION_HISTORY)));
    simulationProfiles=nextProfiles.slice(0,MAX_SIMULATION_HISTORY);
    return true;
  } catch (_) {
    toast('시뮬레이션 결과를 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.');
    return false;
  }
}


function validateSavedBackupLimits(savedRows, historyRows) {
  if (!Array.isArray(savedRows)) throw new Error('저장 번호 목록이 올바르지 않습니다.');
  if (savedRows.length > MAX_SAVED_BACKUP_ENTRIES) {
    throw new Error(`저장 조합은 한 번에 최대 ${formatNumber(MAX_SAVED_BACKUP_ENTRIES)}개까지 가져올 수 있습니다.`);
  }
  if (Array.isArray(historyRows) && historyRows.length > MAX_SAVED_BACKUP_CHECK_HISTORY) {
    throw new Error(`확인 이력은 한 번에 최대 ${formatNumber(MAX_SAVED_BACKUP_CHECK_HISTORY)}건까지 가져올 수 있습니다.`);
  }
}

function assertSavedCollectionCapacity(savedCount, historyCount) {
  if (savedCount > MAX_SAVED_ENTRIES) {
    throw new Error('번호 보관함은 최대 '+formatNumber(MAX_SAVED_ENTRIES)+'개까지 저장할 수 있습니다.');
  }
  if (historyCount > MAX_SAVED_BACKUP_CHECK_HISTORY) {
    throw new Error('당첨 확인 이력은 최대 '+formatNumber(MAX_SAVED_BACKUP_CHECK_HISTORY)+'건까지 저장할 수 있습니다.');
  }
}

function normalizeSavedEntry(entry, index = 0) {
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.numbers)) return null;
  const numbers = entry.numbers.length === 6 ? entry.numbers.map(Number) : [];
  if (numbers.length !== 6 || new Set(numbers).size !== 6 || numbers.some(number => !Number.isInteger(number) || number < 1 || number > 45)) return null;
  return {
    id: String(entry.id || `restored-${index}`).slice(0, 100),
    numbers: sortNums(numbers),
    mode: ['random','balanced','stats','hybrid','custom','coverage'].includes(entry.mode) ? entry.mode : 'random',
    date: typeof entry.date === 'string' ? entry.date.slice(0, 32) : '',
    favorite: Boolean(entry.favorite),
    syncUpdatedAt: normalizeSyncTimestamp(entry.syncUpdatedAt)
  };
}

function loadSaved() {
  try {
    const value = JSON.parse(appStorageGet(SAVED_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.map(normalizeSavedEntry).filter(Boolean);
  } catch (_) { return []; }
}

function normalizeSavedCheckRecord(item) {
  if (!item || typeof item !== 'object') return null;
  const round = Number(item.round);
  const numbers = Array.isArray(item.numbers) && item.numbers.length === 6 ? item.numbers.map(Number) : [];
  const matches = Number(item.matches);
  const rank = String(item.rank || '낙첨');
  if (!Number.isInteger(round) || round < 1 || !Number.isInteger(matches) || matches < 0 || matches > 6 ||
      numbers.length !== 6 || new Set(numbers).size !== 6 || numbers.some(n => !Number.isInteger(n) || n < 1 || n > 45) ||
      !['1등','2등','3등','4등','5등','낙첨'].includes(rank)) return null;
  return {
    id: String(item.id || `${round}-${item.savedId || ''}`).slice(0,120),
    savedId: String(item.savedId || '').slice(0,100),
    numbers: sortNums(numbers), round, date: typeof item.date === 'string' ? item.date.slice(0,20) : '',
    matches, bonusMatch: Boolean(item.bonusMatch), rank, winningNumbers: Array.isArray(item.winningNumbers) ? item.winningNumbers.slice(0,6).map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=45) : [],
    bonus: Number.isInteger(Number(item.bonus)) ? Number(item.bonus) : null,
    checkedAt: typeof item.checkedAt === 'string' ? item.checkedAt.slice(0,40) : '',
    source: typeof item.source === 'string' ? item.source.slice(0,40) : '확인',
    mode: ['random','balanced','stats','hybrid','custom','coverage'].includes(item.mode) ? item.mode : 'random'
  };
}

function loadSavedCheckHistory() {
  try {
    const raw = JSON.parse(appStorageGet(SAVED_CHECKS_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    const normalized = [];
    for (let index=raw.length-1; index>=0 && normalized.length<MAX_SAVED_BACKUP_CHECK_HISTORY; index--) {
      const record = normalizeSavedCheckRecord(raw[index]);
      if (record) normalized.push(record);
    }
    return normalized.reverse();
  } catch (_) { return []; }
}

function loadAutoCheckMeta() {
  try { const raw = JSON.parse(appStorageGet(AUTO_CHECK_KEY) || '{}'); return {
    lastRound: Number.isInteger(Number(raw.lastRound)) && Number(raw.lastRound) > 0 ? Number(raw.lastRound) : 0,
    lastCheckedAt: typeof raw.lastCheckedAt === 'string' ? raw.lastCheckedAt : '',
    lastStatus: typeof raw.lastStatus === 'string' ? raw.lastStatus.slice(0,40) : '대기'
  }; } catch (_) { return {lastRound:0,lastCheckedAt:'',lastStatus:'대기'}; }
}

function persistSavedCheckHistory() {
  try {
    appStorageSet(SAVED_CHECKS_KEY, JSON.stringify(savedCheckHistory.slice(-MAX_SAVED_BACKUP_CHECK_HISTORY)));
    if (!cloudApplying) scheduleCloudSync();
    return true;
  } catch (_) {
    toast('당첨 확인 이력을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.');
    return false;
  }
}
function persistAutoCheckMeta() {
  try { appStorageSet(AUTO_CHECK_KEY, JSON.stringify(autoCheckMeta)); if (!cloudApplying) scheduleCloudSync(); return true; }
  catch (_) { toast('자동 확인 기준을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.'); return false; }
}

function recordSavedCheck(draw, source = '수동 확인', knownHistoryKeys = null, deferSave = false) {
  if (!draw || !Array.isArray(saved) || !saved.length) return 0;
  let added = 0;
  const checkedAt = new Date().toISOString();
  const historyKeys = knownHistoryKeys instanceof Set
    ? knownHistoryKeys
    : new Set(savedCheckHistory.map(row => `${row.round}:${row.savedId}`));
  for (const entry of saved) {
    const key = `${draw.round}:${entry.id}`;
    if (historyKeys.has(key)) continue;
    const result = compareNumbers(entry.numbers, draw);
    savedCheckHistory.push({
      id: key, savedId: entry.id, numbers: entry.numbers, round: draw.round, date: draw.date || '',
      matches: result.matched.length, bonusMatch: result.bonusMatch, rank: result.rank,
      winningNumbers: draw.numbers, bonus: draw.bonus, checkedAt, source, mode: entry.mode
    });
    historyKeys.add(key);
    added++;
  }
  if (added && !deferSave) {
    const persisted = persistSavedCheckHistory();
    if (!persisted) savedCheckHistory.splice(savedCheckHistory.length - added, added);
    renderSavedReports();
  }
  return added;
}

function autoCheckLatestDraw() {
  if (!saved.length || !latest || latestVerification !== 'official' || !dataReady) return;
  const currentRound = Number(latest.round);
  if (!Number.isInteger(currentRound) || currentRound < 1) return;

  // 첫 실행은 기준점만 저장합니다. 첫 저장 이전의 회차를 소급 검사하지 않습니다.
  // 가져온 백업이나 다른 기기의 오래된 기준 회차가 최신 공식 회차보다
  // 앞서 있으면 자동 확인이 영구 정지하지 않도록 현재 회차에 맞춥니다.
  if (Number(autoCheckMeta.lastRound) > currentRound) {
    autoCheckMeta.lastRound = currentRound;
    autoCheckMeta.lastCheckedAt = new Date().toISOString();
    autoCheckMeta.lastStatus = '보유한 최신 공식 회차에 맞춰 기준 회차 보정';
    persistAutoCheckMeta();
    renderSavedReports();
    return;
  }

  if (!autoCheckMeta.lastRound) {
    autoCheckMeta.lastRound = currentRound;
    autoCheckMeta.lastCheckedAt = new Date().toISOString();
    autoCheckMeta.lastStatus = '기준 회차 설정';
    persistAutoCheckMeta();
    renderSavedReports();
    return;
  }
  if (currentRound <= autoCheckMeta.lastRound) return;

  // 사이트를 여러 주 동안 열지 않았어도 누적 데이터의 모든 새 회차를 순서대로 확인합니다.
  const previousRound = autoCheckMeta.lastRound;
  const drawByRound = new Map(draws.map(draw => [Number(draw.round), draw]));
  const roundsToCheck = [];
  for (let round = previousRound + 1; round <= currentRound; round++) {
    const draw = drawByRound.get(round);
    if (!draw) {
      autoCheckMeta.lastStatus = `${round}회 데이터 누락 · 다음 새로고침에서 재시도`;
      persistAutoCheckMeta();
      renderSavedReports();
      return; // 누락이 있을 때는 기준 회차를 전진시키지 않습니다.
    }
    roundsToCheck.push(draw);
  }

  const previousHistoryLength = savedCheckHistory.length;
  const knownHistoryKeys = new Set(savedCheckHistory.map(row => `${row.round}:${row.savedId}`));
  let totalAdded = 0;
  for (const draw of roundsToCheck) {
    totalAdded += recordSavedCheck(draw, '공식 회차 자동 확인', knownHistoryKeys, true);
  }
  if (totalAdded && !persistSavedCheckHistory()) {
    savedCheckHistory.splice(previousHistoryLength);
    autoCheckMeta.lastStatus = '브라우저 저장 공간 부족 · 다음 새로고침에서 재시도';
    persistAutoCheckMeta();
    renderSavedReports();
    return;
  }
  autoCheckMeta.lastRound = currentRound;
  autoCheckMeta.lastCheckedAt = new Date().toISOString();
  autoCheckMeta.lastStatus = `${previousRound + 1}~${currentRound}회 · ${roundsToCheck.length}회차 · ${totalAdded}개 조합 확인`;
  persistAutoCheckMeta();
  renderSavedReports();

  if (totalAdded && 'Notification' in window && Notification.permission === 'granted') {
    const checkedRoundSet = new Set(roundsToCheck.map(draw => draw.round));
    const wins = savedCheckHistory.filter(row => checkedRoundSet.has(row.round) && row.rank !== '낙첨');
    const detail = wins.length
      ? `${roundsToCheck.length}개 회차 확인 완료 · 당첨 등급 ${wins.length}건을 발견했습니다.`
      : `${roundsToCheck.length}개 회차에서 ${totalAdded}개 조합을 비교했습니다.`;
    try { new Notification(`LUCKY 645 · ${currentRound}회까지 확인`, { body: detail }); } catch (_) {}
  }
}

function buildSavedCheckReportStats(savedEntries, historyRows) {
  const statsBySavedId = new Map();
  const recentHistory = [];
  let top = 0, low = 0, last = null;
  const compareRecent = (a,b) =>
    Number(b.round)-Number(a.round) ||
    String(b.checkedAt||'').localeCompare(String(a.checkedAt||''));

  for (const row of Array.isArray(historyRows) ? historyRows : []) {
    if (['1등','2등','3등'].includes(row.rank)) top++;
    else if (row.rank === '4등' || row.rank === '5등') low++;
    if (!last || Number(row.round) > Number(last.round)) last = row;

    const savedId = String(row.savedId || '');
    if (savedId) {
      let stats = statsBySavedId.get(savedId);
      if (!stats) {
        stats = {checks:0,wins:0,top3:0,totalMatches:0};
        statsBySavedId.set(savedId,stats);
      }
      stats.checks++;
      if (row.rank !== '낙첨') stats.wins++;
      if (row.rank === '1등' || row.rank === '2등' || row.rank === '3등') stats.top3++;
      stats.totalMatches += Number(row.matches) || 0;
    }

    // Keep only the newest 30 rows instead of sorting the entire history array.
    let left = 0, right = recentHistory.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (compareRecent(row,recentHistory[middle]) < 0) right = middle;
      else left = middle + 1;
    }
    if (left < 30) {
      recentHistory.splice(left,0,row);
      if (recentHistory.length > 30) recentHistory.pop();
    } else if (recentHistory.length < 30) {
      recentHistory.push(row);
    }
  }

  const rows = (Array.isArray(savedEntries) ? savedEntries : []).map(entry => {
    const stats = statsBySavedId.get(String(entry.id)) || {checks:0,wins:0,top3:0,totalMatches:0};
    return {
      entry,
      checks:stats.checks,
      wins:stats.wins,
      top3:stats.top3,
      avg:stats.checks ? stats.totalMatches/stats.checks : 0
    };
  }).sort((a,b)=>b.top3-a.top3 || b.wins-a.wins || b.avg-a.avg || b.checks-a.checks);

  return {
    total:Array.isArray(historyRows)?historyRows.length:0,
    top,low,last,recentHistory,rows
  };
}

function renderSavedReports() {
  const report = buildSavedCheckReportStats(saved,savedCheckHistory);
  const {total,top,low,last, recentHistory:recentRows, rows:performanceRows} = report;
  const kpis = $('savedCheckKpis');
  if (kpis) kpis.innerHTML = `<div class="saved-insight-card"><span>누적 조합 확인</span><strong>${formatNumber(total)}건</strong></div><div class="saved-insight-card"><span>1~3등 결과</span><strong>${formatNumber(top)}건</strong></div><div class="saved-insight-card"><span>4~5등 결과</span><strong>${formatNumber(low)}건</strong></div><div class="saved-insight-card"><span>최근 확인 회차</span><strong>${last ? `${last.round}회` : '-'}</strong></div>`;
  const status = $('savedCheckStatus');
  if (status) status.innerHTML = `자동 확인 기준: <strong>${autoCheckMeta.lastRound ? `${autoCheckMeta.lastRound}회` : '아직 설정되지 않음'}</strong> · 마지막 확인: ${escapeHtml(formatSyncTime(autoCheckMeta.lastCheckedAt))} · ${escapeHtml(autoCheckMeta.lastStatus || '대기')}<br><span class="analytics-mini">공식 최신 회차가 업데이트되고 페이지에서 데이터 확인이 완료될 때 실행됩니다. 브라우저를 닫은 동안에는 확인되지 않습니다.</span>`;
  const history = $('savedCheckHistory');
  if (history) {
    history.innerHTML = recentRows.length ? `<div class="table-wrap"><table class="saved-history-table"><thead><tr><th>회차</th><th>내 조합</th><th>일치</th><th>보너스</th><th>결과</th><th>확인 방식</th></tr></thead><tbody>${recentRows.map(row=>`<tr><td>${row.round}회</td><td>${row.numbers.join(', ')}</td><td>${row.matches}개</td><td>${row.bonusMatch?'일치':'-'}</td><td><strong>${row.rank}</strong></td><td>${escapeHtml(row.source)}</td></tr>`).join('')}</tbody></table></div><div class="analytics-mini" style="margin-top:8px">최근 30건 표시 · 전체 이력 ${formatNumber(total)}건</div>` : '<div class="empty">아직 당첨 확인 이력이 없습니다. 최신 공식 회차 확인 또는 직접 비교를 실행해 주세요.</div>';
  }
  const perf = $('savedPerformance');
  if (perf) {
    perf.innerHTML = performanceRows.length ? `<div class="table-wrap"><table class="saved-history-table"><thead><tr><th>순위</th><th>저장 조합</th><th>비교 횟수</th><th>당첨 결과</th><th>1~3등</th><th>평균 일치</th></tr></thead><tbody>${performanceRows.map((row,i)=>`<tr><td>${i+1}</td><td>${row.entry.numbers.join(', ')}</td><td>${row.checks}</td><td>${row.wins}</td><td>${row.top3}</td><td>${row.avg.toFixed(2)}개</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">저장한 조합이 없습니다.</div>';
  }
}

function exportSavedCheckHistory() {
  if (!savedCheckHistory.length) return toast('내보낼 당첨 확인 이력이 없습니다.');
  const rows=[['회차','추첨일','저장ID','번호','일치개수','보너스일치','등수','확인시각','확인방식']];
  savedCheckHistory.forEach(row=>rows.push([row.round,row.date,row.savedId,row.numbers.join(' '),row.matches,row.bonusMatch?'Y':'N',row.rank,row.checkedAt,row.source]));
  const csv='\uFEFF'+rows.map(row=>row.map(window.Lucky645ExportUtils.csvCell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); const a=document.createElement('a'); a.href=url; a.download=`lucky645-check-history-${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast('당첨 확인 이력 CSV를 저장했습니다.');
}

function exportSavedPdf() {
  const popup=window.open('','_blank','width=980,height=760');
  if (!popup) return toast('팝업이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 시도해 주세요.');
  const rows=savedCheckHistory.slice().sort((a,b)=>b.round-a.round).map(row=>`<tr><td>${row.round}</td><td>${row.numbers.join(', ')}</td><td>${row.matches}</td><td>${row.bonusMatch?'일치':'-'}</td><td>${row.rank}</td><td>${escapeHtml(row.source)}</td></tr>`).join('');
  popup.document.write(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>LUCKY 645 보고서</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#222}h1{font-size:22px}p{color:#555;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:11px}th{background:#f1f3f5}</style><h1>LUCKY 645 · 저장 조합 확인 보고서</h1><p>생성일: ${new Date().toLocaleString('ko-KR')} · 저장 조합 ${saved.length}개 · 확인 이력 ${savedCheckHistory.length}건</p><p>과거 결과는 미래 당첨을 예측하지 않으며 모든 조합의 당첨 확률은 동일합니다.</p><table><thead><tr><th>회차</th><th>내 번호</th><th>일치</th><th>보너스</th><th>등수</th><th>확인 방식</th></tr></thead><tbody>${rows || '<tr><td colspan="6">확인 이력 없음</td></tr>'}</tbody></table></html>`);
  popup.document.close(); popup.focus(); setTimeout(()=>popup.print(),350);
}

function requestDrawNotifications() {
  if (!('Notification' in window)) return toast('이 브라우저는 알림 기능을 지원하지 않습니다.');
  Notification.requestPermission().then(permission=>toast(permission==='granted'?'브라우저 알림을 허용했습니다.':'알림 권한이 허용되지 않았습니다.')).catch(()=>toast('알림 권한 요청에 실패했습니다.'));
}

function selectBacktestDraws(history, range = 'all') {
  if (!Array.isArray(history)) return [];
  if (String(range) === 'all') return history.slice();
  const count = Number(range);
  if (!Number.isInteger(count) || count < 1) return history.slice();
  return history.slice(-count);
}

function runSavedBacktest() {
  const output = $('savedBacktestOutput');
  if (!output) return null;
  savedBacktestResult = null;
  output.className = 'empty';
  output.textContent = '백테스트 계산 중…';

  if (!saved.length) {
    output.textContent = '먼저 번호 조합을 보관함에 저장해 주세요.';
    return null;
  }
  if (!draws.length || !dataReady) {
    output.textContent = '전체 회차 데이터 연결이 완료된 뒤 실행할 수 있습니다.';
    return null;
  }

  const period = $('savedBacktestPeriod')?.value || 'year';
  const range = $('savedBacktestRange')?.value || 'all';
  const selectedDraws = selectBacktestDraws(draws, range);
  if (!selectedDraws.length) {
    output.textContent = '선택한 범위에 비교할 회차 데이터가 없습니다.';
    return null;
  }

  const rankCounts = {'1등':0,'2등':0,'3등':0,'4등':0,'5등':0,'낙첨':0};
  const byPeriod = {};
  const byMode = {};
  let gross = 0, knownPrizeCount = 0, checks = 0;
  const preparedDraws = selectedDraws.map(draw => {
    const prizeByRank = new Map((draw.ranks || []).map(item=>[Number(item.rank),item.prize]));
    return {
      numberSet:new Set(draw.numbers),
      bonus:draw.bonus,
      prizeByRank,
      periodKey:period === 'month'
        ? (draw.date ? draw.date.slice(0,7) : '날짜 없음')
        : (draw.date ? draw.date.slice(0,4) : '날짜 없음')
    };
  });

  for (const entry of saved) {
    const mode = entry.mode || 'random';
    if (!byMode[mode]) byMode[mode] = {checks:0,win:0,top3:0};
    for (const prepared of preparedDraws) {
      let matches = 0;
      let bonusMatch = false;
      for (const number of entry.numbers) {
        if (prepared.numberSet.has(number)) matches++;
        if (number === prepared.bonus) bonusMatch = true;
      }
      const rank = rankName(matches,bonusMatch);
      rankCounts[rank] = (rankCounts[rank] || 0) + 1;
      checks++;
      byMode[mode].checks++;
      const isWin = rank !== '낙첨';
      const isTop3 = rank === '1등' || rank === '2등' || rank === '3등';
      if (isWin) byMode[mode].win++;
      if (isTop3) byMode[mode].top3++;

      const key = prepared.periodKey;
      if (!byPeriod[key]) byPeriod[key] = {checks:0,win:0,top3:0};
      byPeriod[key].checks++;
      if (isWin) byPeriod[key].win++;
      if (isTop3) byPeriod[key].top3++;

      if (isWin) {
        const prize = prepared.prizeByRank.get(Number(rank[0]));
        if (Number.isFinite(prize)) {
          gross += prize;
          knownPrizeCount++;
        }
      }
    }
  }

  const cost = checks * 1000;
  const profit = gross - cost;
  const runAt = new Date().toISOString();
  savedBacktestResult = {
    period, range, rankCounts, byPeriod, byMode, checks, cost, gross, profit,
    knownPrizeCount, drawCount:selectedDraws.length,
    fromRound:selectedDraws[0].round,
    toRound:selectedDraws[selectedDraws.length - 1].round,
    runAt
  };

  const periods = Object.entries(byPeriod).sort((a,b) => a[0].localeCompare(b[0]));
  const visible = period === 'month' ? periods.slice(-18) : periods;
  const max = Math.max(1, ...visible.map(([,value]) => value.win));
  const modeRows = Object.entries(byMode).map(([mode,value]) =>
    `<tr><td>${modeLabel(mode)}</td><td>${formatNumber(value.checks)}</td><td>${formatNumber(value.win)}</td><td>${formatNumber(value.top3)}</td></tr>`
  ).join('');
  const rangeLabel = range === 'all' ? '전체 확보 회차' : `최근 ${formatNumber(selectedDraws.length)}회`;

  output.className = '';
  output.innerHTML =
    `<div class="analytics-mini" style="margin-bottom:12px">분석 기준: <strong>${rangeLabel}</strong> · ${savedBacktestResult.fromRound}~${savedBacktestResult.toRound}회 · ${formatNumber(selectedDraws.length)}회차 · ${formatNumber(saved.length)}개 조합 · 계산 시각 ${escapeHtml(formatSyncTime(runAt))}</div>` +
    `<div class="saved-insight-grid"><div class="saved-insight-card"><span>전체 비교</span><strong>${formatNumber(checks)}건</strong></div><div class="saved-insight-card"><span>가상 구매 비용</span><strong>${money(cost)}</strong></div><div class="saved-insight-card"><span>확인 가능한 상금 합계</span><strong>${money(gross)}</strong></div><div class="saved-insight-card"><span>가상 손익</span><strong>${money(profit)}</strong></div></div>` +
    `<div class="grid-2" style="margin-top:16px"><div><div class="panel-title" style="margin-bottom:10px">등수별 결과</div><div class="analytics-inline-bars">${Object.entries(rankCounts).map(([rank,count])=>`<div class="analytics-inline-row"><span>${rank}</span><div class="bar-track"><div class="bar-fill ${rank==='낙첨'?'cool':''}" style="width:${checks?count/checks*100:0}%"></div></div><strong>${formatNumber(count)}</strong></div>`).join('')}</div></div><div><div class="panel-title" style="margin-bottom:10px">${period==='month'?'월별':'연도별'} 당첨 결과</div><div class="saved-trend">${visible.map(([key,value])=>`<div class="saved-trend-row"><span>${escapeHtml(key)}</span><div class="bar-track"><div class="bar-fill" style="width:${value.win/max*100}%"></div></div><strong>${formatNumber(value.win)}</strong></div>`).join('')||'표시할 기간 데이터가 없습니다.'}</div></div></div>` +
    `<div class="panel-title" style="margin:18px 0 8px">추천 방식별 과거 비교</div><div class="table-wrap"><table class="saved-history-table"><thead><tr><th>추천 방식</th><th>비교</th><th>당첨</th><th>1~3등</th></tr></thead><tbody>${modeRows}</tbody></table></div>` +
    `<div class="analytics-mini" style="margin-top:12px">가상 구매 비용은 조합당 1,000원을 가정했습니다. 상금 데이터가 없는 회차/등수는 상금 합계에 포함되지 않습니다. 실제 과거 구매·당첨 이력이 아니며, 과거 결과는 향후 확률을 바꾸지 않습니다.</div>`;
  return savedBacktestResult;
}
function loadSyncMeta() {
  try {
    const value = JSON.parse(appStorageGet(SYNC_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return {
      lastAttemptAt: typeof value.lastAttemptAt === 'string' ? value.lastAttemptAt : '',
      lastSuccessAt: typeof value.lastSuccessAt === 'string' ? value.lastSuccessAt : '',
      status: ['ok','partial','error','checking'].includes(value.status) ? value.status : 'unknown',
      source: typeof value.source === 'string' ? value.source.slice(0, 100) : '',
      errors: Array.isArray(value.errors) ? value.errors.filter(x => typeof x === 'string').slice(0, 12) : []
    };
  } catch (_) { return {}; }
}

function persistSyncMeta() {
  try { appStorageSet(SYNC_KEY, JSON.stringify(syncMeta)); } catch (_) {}
}

function formatSyncTime(value) {
  if (!value) return '기록 없음';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '시간 정보 오류' : date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

function loadCachedDraws() {
  try {
    const value = JSON.parse(appStorageGet(CACHE_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return mergeDraws([], value.map(normalizeDraw).filter(Boolean));
  } catch (_) { return []; }
}

function persistSaved(nextSaved = saved) {
  const next = Array.isArray(nextSaved) ? nextSaved : saved;
  try {
    appStorageSet(SAVED_KEY, JSON.stringify(next));
  } catch (_) {
    toast('번호 보관함 저장에 실패했습니다. 브라우저 저장 공간을 확인해 주세요.');
    return false;
  }
  if (next !== saved) saved = next;
  renderSaved();
  updateTopStats();
  if (!cloudApplying) scheduleCloudSync();
  if (savedBacktestResult) runSavedBacktest();
  return true;
}

function persistDraws() {
  try { appStorageSet(CACHE_KEY, JSON.stringify(draws)); } catch (_) {}
}

function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function numberColor(number) {
  if (number <= 10) return '#f5c84c';
  if (number <= 20) return '#66aef2';
  if (number <= 30) return '#f16d69';
  if (number <= 40) return '#aab4bf';
  return '#65c98b';
}

function ball(number, small = false, bonus = false) {
  return `<span class="ball ${small ? 'small' : ''} ${bonus ? 'bonus' : ''}" style="background:${numberColor(number)}">${number}</span>`;
}

function sortNums(numbers) { return [...numbers].sort((a,b)=>a-b); }


function hasRealDrawData(list) {
  return Array.isArray(list) && list.some(draw => draw && draw.source !== FALLBACK_DRAW.source);
}

async function refreshData(showToast = true) {
  if (isRefreshing) return;
  isRefreshing = true;
  const status = $('dataStatus');
  const refreshButton = $('refreshBtn');
  if (status) status.textContent = '당첨 데이터 연결 중…';
  if (refreshButton) refreshButton.disabled = true;
  const errors = [];
  syncMeta.lastAttemptAt = new Date().toISOString();
  syncMeta.status = 'checking';
  persistSyncMeta();
  let historicalSource = '';
  let mirrorLatest = null;
  let latestSource = '';
  let officialLatest = null;

  try {
    // 누적 자료는 정합성 검사를 통과한 경우에만 전체 데이터로 인정합니다.
    for (const sourceUrl of API_ALL_SOURCES) {
      try {
        const remote = await getJson(sourceUrl, 12000);
        const all = extractDraws(remote);
        if (all.length >= 1000 && isContinuousHistory(all)) {
          const sourceLabel = sourceUrl.startsWith('/api/') ? 'Vercel 서버 프록시 누적 JSON' : (sourceUrl.includes('raw.githubusercontent.com') ? 'GitHub 원본 JSON' : 'GitHub Pages 누적 데이터');
          all.forEach(draw => { draw.source = sourceLabel; });
          draws = mergeDraws(draws, all);
          historicalSource = sourceLabel;
          break;
        }
        if (all.length) draws = mergeDraws(draws, all);
        errors.push('누적 데이터가 1회부터 끊김 없이 이어지지 않습니다.');
      } catch (error) { if (!isUnavailableLocalProxy(sourceUrl, error)) errors.push(`누적 데이터: ${error.message}`); }
    }

    // 최신 회차는 서버 프록시를 먼저 이용하고, 로컬 실행에서는 공식 사이트에 직접 재시도합니다.
    for (const endpoint of [API_PROXY_LATEST, API_LATEST]) {
      try {
        const officialRaw = await getJson(endpoint, 9000);
        officialLatest = normalizeOfficial(officialRaw);
        if (officialLatest) officialLatest.source = '동행복권 공식 API';
        if (!officialLatest) throw new Error('최신 회차 데이터를 해석하지 못했습니다.');
        const previous = draws.find(draw=>draw.round===officialLatest.round);
        if (previous && (previous.numbers.join(',')!==officialLatest.numbers.join(',') || previous.bonus!==officialLatest.bonus)) {
          errors.push(`${officialLatest.round}회 누적 사본과 동행복권 결과가 달라 공식 결과를 우선 적용했습니다.`);
        }
        draws = mergeDraws(draws, [officialLatest]);
        latestSource = endpoint === API_PROXY_LATEST ? '동행복권 공식 API · 서버 프록시' : '동행복권 공식 API';
        latestVerification = 'official';
        break;
      } catch (error) { if (!isUnavailableLocalProxy(endpoint, error)) errors.push(`공식 최신 조회(${endpoint===API_PROXY_LATEST?'프록시':'직접'}): ${error.message}`); }
    }

    // 공식 API가 막히면 공개 최신 결과 사본을 보조로 사용하되 공식 확인으로 표시하지 않습니다.
    if (!officialLatest) {
      try {
        const fallback = normalizeOfficial(await getJson(API_LATEST_FALLBACK, 8000));
        if (fallback) {
          fallback.source = '공개 최신 결과 사본';
          mirrorLatest = fallback;
          draws = mergeDraws(draws, [fallback]);
          latestSource = '공개 최신 결과 사본';
          latestVerification = 'mirror';
        }
      } catch (error) { errors.push(`최신 결과 보조 조회: ${error.message}`); }
    }

    // CSV 사본은 회차 누락 보완뿐 아니라 JSON에 없는 공식 판매액도 채웁니다.
    const needsCsvEnrichment = draws.some(draw => draw.totalSales == null || draw.totalPrizePayout == null);
    if (!historicalSource || !isContinuousHistory(draws) || needsCsvEnrichment) {
      try {
        const csv = await getText(CSV_FALLBACK, 10000);
        const parsed = parseCsv(csv);
        if (parsed.length >= 1000 && isContinuousHistory(parsed)) {
          parsed.forEach(draw => { draw.source = 'CSV 보조 사본'; });
          draws = mergeDraws(draws, parsed);
          historicalSource = historicalSource || 'Cashlogy CSV 자료';
        } else if (parsed.length) errors.push('CSV 자료가 전체 회차를 포함하지 않습니다.');
      } catch (error) { errors.push(`CSV 보조 자료: ${error.message}`); }
    }

    if (!draws.length) draws = [FALLBACK_DRAW];
    draws = mergeDraws([], draws);
    const newestAvailable = draws.at(-1) || FALLBACK_DRAW;
    latest = newestAvailable;
    const mergedOfficialLatest = officialLatest ? draws.find(draw => draw.round === officialLatest.round) : null;
    const mergedMirrorLatest = mirrorLatest ? draws.find(draw => draw.round === mirrorLatest.round) : null;

    if (officialLatest && officialLatest.round < newestAvailable.round) {
      latestVerification = 'mismatch';
      latestSource = '공식 조회와 누적 데이터 회차 불일치';
      errors.push(`공식 API는 ${officialLatest.round}회, 보유 자료는 ${newestAvailable.round}회까지 포함합니다. 최신 여부를 재확인하세요.`);
    } else if (officialLatest && officialLatest.round === newestAvailable.round) {
      latest = mergedOfficialLatest || officialLatest;
      latestVerification = 'official';
      latestSource = '동행복권 공식 API';
    } else if (officialLatest && officialLatest.round > newestAvailable.round) {
      latest = mergedOfficialLatest || officialLatest;
      latestVerification = 'official';
      latestSource = '동행복권 공식 API';
    } else if (mirrorLatest && mirrorLatest.round === newestAvailable.round) {
      latest = mergedMirrorLatest || mirrorLatest;
      latestVerification = 'mirror';
      latestSource = '공개 최신 결과 사본';
    } else if (String(newestAvailable.source || '').includes('GitHub') || String(newestAvailable.source || '').includes('CSV')) {
      latestVerification = 'history';
      latestSource = newestAvailable.source || historicalSource || '누적 회차 사본';
    } else if (hasRealDrawData(draws)) {
      latestVerification = 'cache';
      latestSource = newestAvailable.source || '저장 데이터';
    } else {
      latestVerification = 'pending';
      latestSource = '확인 필요';
    }

    dataReady = isContinuousHistory(draws);
    persistDraws();
    const syncSucceeded = Boolean(historicalSource || officialLatest || mirrorLatest);
    syncMeta.status = !syncSucceeded ? 'error' : (errors.length || !dataReady ? 'partial' : 'ok');
    syncMeta.lastSuccessAt = syncSucceeded ? new Date().toISOString() : syncMeta.lastSuccessAt;
    syncMeta.source = latestSource;
    syncMeta.errors = errors.slice(0, 12);
    persistSyncMeta();

    const statusSource = latestSource || (historicalSource ? '누적 자료' : '저장 데이터');
    if (status) {
      const checkedAt = formatSyncTime(syncMeta.lastAttemptAt);
      status.textContent = dataReady ? `1~${newestAvailable.round}회 전체 · ${statusSource} · ${checkedAt}` : `${draws.length.toLocaleString()}회 데이터 · 일부 연결 · ${checkedAt}`;
      status.style.color = dataReady && latestVerification === 'official' && errors.length===0 ? 'var(--green)' : 'var(--yellow)';
      status.title = [`마지막 확인: ${checkedAt}`, `최신 결과 출처: ${statusSource}`, ...errors].join('\n') || '회차 누락 없이 데이터를 확인했습니다.';
    }

    renderLatest();
    renderStats();
    renderAnalytics();
    renderResearchLab();
    renderHistory();
    renderHomeRecent();
    renderSaved();
    updateTopStats();
    renderSavedReports();
    autoCheckLatestDraw();
    if (savedBacktestResult) runSavedBacktest();
    $('historySummary').textContent = dataReady
      ? `1회부터 ${newestAvailable.round}회까지 누적 ${draws.length.toLocaleString()}회 · 최신 ${latest.round}회`
      : `현재 확보한 ${draws.length.toLocaleString()}회 데이터 · 전체 회차 누락 여부를 확인할 수 없습니다.`;
    if (showToast) toast(dataReady ? `${draws.length.toLocaleString()}회차 데이터 연결 완료` : '확보된 데이터로 화면을 갱신했습니다.');
  } catch (error) {
    errors.push(`화면 갱신: ${error.message}`);
    syncMeta.status = 'error'; syncMeta.errors = errors.slice(0, 12); persistSyncMeta();
    if (status) {
      status.textContent = '데이터 연결 확인 필요';
      status.style.color = 'var(--yellow)';
      status.title = errors.join('\n');
    }
    latest = draws.at(-1) || FALLBACK_DRAW;
    latestVerification = hasRealDrawData(draws) ? 'cache' : 'pending';
    renderLatest();
    if (showToast) toast('데이터 연결 중 문제가 발생했습니다. 저장된 자료를 표시합니다.');
  } finally {
    isRefreshing = false;
    if (refreshButton) refreshButton.disabled = false;
  }
}

function updateTopStats() {
  if ($('statDrawCount')) $('statDrawCount').textContent = draws.length.toLocaleString();
  if ($('statSaved')) $('statSaved').textContent = saved.length.toLocaleString();
  if ($('savedCount')) $('savedCount').textContent = `${saved.length} 조합`;
}

function renderLatest() {
  if (!$('latestRound')) return;
  const unverifiedFallback = !hasRealDrawData(draws) && latest?.source === FALLBACK_DRAW.source;
  $('latestRound').textContent = unverifiedFallback ? '확인 대기' : `${latest.round}회`;
  $('latestBalls').innerHTML = unverifiedFallback
    ? '<span class="muted">공식 당첨 결과를 확인 중입니다.</span>'
    : latest.numbers.map(number=>ball(number)).join('');
  const verification = $('latestVerification');
  if (verification) {
    const labels = {official:['동행복권 확인','green'],mirror:['외부 사본','yellow'],history:['누적 사본','yellow'],cache:['저장 데이터','yellow'],pending:['확인 필요','yellow'],mismatch:['데이터 불일치','yellow']};
    const [label, tone] = labels[latestVerification] || labels.pending;
    verification.textContent = label;
    verification.className = `badge ${tone}`;
  }
  $('latestDate').textContent = unverifiedFallback ? '공식 데이터 확인 전' : `${(latest.date || '날짜 정보 없음').replaceAll('-','. ')} 추첨`;
  const sourceLabel = $('latestSourceLabel');
  if (sourceLabel) sourceLabel.textContent = ({official:'출처: 동행복권 사이트 조회',mirror:'출처: 공개 데이터 사본',history:'출처: 누적 회차 데이터',cache:'출처: 저장된 데이터',pending:'출처: 확인 필요',mismatch:'출처: 회차 불일치 확인 필요'})[latestVerification] || '출처: 확인 필요';
  $('latestBonus').innerHTML = unverifiedFallback ? '보너스 번호 확인 전' : `보너스 ${ball(latest.bonus,true)}`;
  const latestSales = $('latestSales');
  const latestPayout = $('latestPayout');
  if (latestSales) latestSales.textContent = unverifiedFallback ? '확인 대기' : formatDrawMoney(latest.totalSales);
  if (latestPayout) latestPayout.textContent = unverifiedFallback ? '확인 대기' : formatDrawMoney(latest.totalPrizePayout);
  $('checkRound').value = unverifiedFallback ? '' : latest.round;
  $('statDrawCount').textContent = draws.length.toLocaleString();
}


function loadResearchReport() {
  try {
    const value = JSON.parse(appStorageGet(RESEARCH_REPORT_KEY) || 'null');
    return value && value.version >= 1 && Array.isArray(value.evaluation?.strategies) ? value : null;
  } catch (_) { return null; }
}

function loadResearchHistory(currentReport) {
  try {
    const parsed = JSON.parse(appStorageGet(RESEARCH_HISTORY_KEY) || '[]');
    return window.Lucky645ResearchHistory.mergeRuns(currentReport ? [currentReport] : [], parsed);
  } catch (_) { return currentReport ? [currentReport] : []; }
}

function recordResearchRun(report) {
  const runId = report.runId || report.createdAt;
  report.runId = runId;
  researchHistory = [report, ...researchHistory.filter(item => (item.runId || item.createdAt) !== runId)]
    .slice(0, MAX_RESEARCH_HISTORY);
  researchCompareRunId = researchHistory[1] ? (researchHistory[1].runId || researchHistory[1].createdAt) : '';
}

function loadResearchCandidates() {
  try {
    const value = JSON.parse(appStorageGet(RESEARCH_CANDIDATES_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    const candidates = [];
    for (const item of value) {
      if (item && typeof item.id === 'string' && typeof item.label === 'string') candidates.push(item);
      if (candidates.length >= 100) break;
    }
    return candidates;
  } catch (_) { return []; }
}

function persistResearchState() {
  const keys = [RESEARCH_REPORT_KEY, RESEARCH_HISTORY_KEY, RESEARCH_CANDIDATES_KEY];
  const previous = keys.map(key => appStorageGet(key));
  try {
    if (researchReport) appStorageSet(RESEARCH_REPORT_KEY, JSON.stringify(researchReport));
    appStorageSet(RESEARCH_HISTORY_KEY, JSON.stringify(researchHistory.slice(0, MAX_RESEARCH_HISTORY)));
    appStorageSet(RESEARCH_CANDIDATES_KEY, JSON.stringify(researchCandidates));
    return true;
  } catch (_) {
    keys.forEach((key,index) => { try { if (previous[index] === null) appStorageRemove(key); else appStorageSet(key, previous[index]); } catch (_) {} });
    toast('연구 결과 저장 공간이 부족합니다. 기존 연구 이력은 유지했습니다.');
    return false;
  }
}

function renderResearchResults() {
  const report = researchReport;
  const strategyTarget = $('researchStrategyResults');
  const monteTarget = $('researchMonteCarloResults');
  if (!report) {
    if (strategyTarget) strategyTarget.innerHTML = '<div class="empty">연구 실행 후 100개 전략의 성능 순위를 표시합니다.</div>';
    if (monteTarget) monteTarget.innerHTML = '<div class="empty">몬테카를로 실험 결과가 여기에 표시됩니다.</div>';
    if ($('researchStrategySummary')) $('researchStrategySummary').textContent = '아직 실행 전';
    if ($('researchMonteCarloSummary')) $('researchMonteCarloSummary').textContent = '1,000,000회 대기';
    return;
  }
  const evaluation = report.evaluation;
  const rows = evaluation.strategies || [];
  if ($('researchStrategySummary')) $('researchStrategySummary').textContent = rows.length+'개 전략 · 후보 '+evaluation.candidateCount+'개';
  if (strategyTarget) {
    strategyTarget.className = 'table-wrap research-table-wrap';
    strategyTarget.innerHTML = '<table class="analytics-table research-table"><thead><tr><th>순위</th><th>전략</th><th>평균 일치</th><th>무작위 평균</th><th>차이</th><th>무작위 200전 승률</th><th>양의 구간</th><th>z 점수</th><th>판정</th></tr></thead><tbody>'+rows.map((item,index)=>'<tr><td>'+(index+1)+'</td><td>'+escapeHtml(item.label)+'</td><td>'+item.averageMatches.toFixed(4)+'</td><td>'+item.baselineAverage.toFixed(4)+'</td><td class="'+(item.delta>0?'research-positive':'muted')+'">'+(item.delta>0?'+':'')+item.delta.toFixed(4)+'</td><td>'+(Number.isFinite(item.randomWinRate)?(item.randomWinRate*100).toFixed(1)+'%':'-')+'</td><td>'+(Number.isFinite(item.positiveFolds)?item.positiveFolds+'/'+(item.foldCount||evaluation.foldCount||'-'):'-')+'</td><td>'+item.zScore.toFixed(2)+'</td><td>'+(item.adjustedSignificance?'<span class="badge green">후보 등록</span>':'<span class="badge">미검증</span>')+'</td></tr>').join('')+'</tbody></table><div class="analytics-legend">검증 구간 '+evaluation.testStartRound+'~'+evaluation.testEndRound+'회 ('+formatNumber(evaluation.testCount)+'회) · 학습 '+formatNumber(evaluation.trainingCount)+'회 · 무작위 참가자 '+formatNumber(evaluation.baselineCount||evaluation.tournament?.randomBaselineCount||0)+'명 · 시간순 구간 '+(evaluation.foldCount||'-')+'개 · 후보 기준 z ≥ '+evaluation.thresholdZ.toFixed(1)+'</div>';
  }
  const tournament = evaluation.tournament;
  if (strategyTarget && tournament) {
    strategyTarget.innerHTML += '<div class="research-tournament-summary"><div class="research-tournament-heading"><strong>무작위 토너먼트</strong><span>'+formatNumber(tournament.randomBaselineCount)+'명 참가 · '+(evaluation.foldCount||'-')+'개 시간순 구간</span></div><div class="research-tournament-metrics"><div><span>무작위 평균</span><b>'+tournament.randomMean.toFixed(4)+'</b></div><div><span>무작위 표준편차</span><b>'+tournament.randomStdDev.toFixed(4)+'</b></div><div><span>하위 5% 기준</span><b>'+tournament.randomP05.toFixed(4)+'</b></div><div><span>중앙값</span><b>'+tournament.randomP50.toFixed(4)+'</b></div><div><span>상위 5% 기준</span><b>'+tournament.randomP95.toFixed(4)+'</b></div><div><span>최고 전략의 무작위 승률</span><b>'+((tournament.topStrategyRandomWinRate||0)*100).toFixed(1)+'%</b></div></div><div class="analytics-legend">'+escapeHtml(tournament.note||'무작위 참가자는 동일한 검증 회차를 사용했습니다.')+'</div></div>';
  }
  const monte = report.monteCarlo;
  if ($('researchMonteCarloSummary')) $('researchMonteCarloSummary').textContent = formatNumber(monte.attempts)+'회 완료';
  if (monteTarget) {
    const labels = ['0개 일치','1개 일치','2개 일치','3개 이상'];
    monteTarget.className = 'research-monte-results';
    monteTarget.innerHTML = '<div class="research-result-kpis"><div><span>총 추첨</span><strong>'+formatNumber(monte.attempts)+'</strong></div><div><span>번호 선택 횟수</span><strong>'+formatNumber(monte.totalSelections)+'</strong></div><div><span>번호당 기대 횟수</span><strong>'+formatNumber(Math.round(monte.expectedPerNumber))+'</strong></div><div><span>분포 χ²</span><strong>'+monte.chiSquare.toFixed(2)+'</strong></div></div><div class="table-wrap"><table class="analytics-table"><thead><tr><th>기준 조합 일치</th><th>관측 횟수</th><th>이론 기대</th><th>차이</th></tr></thead><tbody>'+labels.map((label,index)=>'<tr><td>'+label+'</td><td>'+formatNumber(monte.groupedObserved[index])+'</td><td>'+formatNumber(Math.round(monte.groupedExpected[index]))+'</td><td>'+formatNumber(Math.round(monte.groupedObserved[index]-monte.groupedExpected[index]))+'</td></tr>').join('')+'</tbody></table></div><div class="analytics-legend">몬테카를로는 균등 무작위 추첨 분포를 확인하는 보정 실험입니다. 고정 조합의 1등 확률은 여전히 1 / 8,145,060입니다.</div>';
  }
}

function renderResearchLab() {
  const count = draws.length;
  const engineReady = Boolean(window.Lucky645Research);
  if ($('researchDrawCount')) $('researchDrawCount').textContent = formatNumber(count);
  if ($('researchRoundRange')) $('researchRoundRange').textContent = count ? draws[0].round+'회 ~ '+draws.at(-1).round+'회' : '데이터 확인 대기';
  if ($('researchCandidateCount')) $('researchCandidateCount').textContent = String(researchCandidates.length);
  if ($('researchCandidateBadge')) $('researchCandidateBadge').textContent = researchCandidates.length+'개 후보';
  if ($('researchDataStatus')) {
    const ready = dataReady && count >= 150;
    $('researchDataStatus').textContent = !engineReady ? '연구 엔진 로드 확인 필요' : (ready ? '전체 연속 데이터 확인' : '연속성 검사 필요');
    $('researchDataStatus').className = 'badge '+(ready && engineReady ? 'green' : 'yellow');
  }
  const button = $('runResearchBtn');
  if (button) {
    // 데이터/엔진이 준비되지 않았더라도 버튼은 눌러서 구체적인 진단 메시지를 볼 수 있게 합니다.
    button.disabled = researchRunning;
    button.textContent = researchRunning ? '연구 실행 중…' : (researchReport ? '⚗ 전체 연구 다시 실행' : '⚗ 전체 연구 시작');
    button.title = researchRunning ? '현재 연구가 진행 중입니다.' : '실행하면 데이터 무결성을 먼저 검사하고 100개 전략 및 100만 회 시뮬레이션을 시작합니다.';
    button.setAttribute('aria-busy', researchRunning ? 'true' : 'false');
  }
  if ($('researchCandidateList')) {
    $('researchCandidateList').innerHTML = researchCandidates.length
      ? '<div class="table-wrap"><table class="analytics-table"><thead><tr><th>전략</th><th>검증 회차</th><th>평균 일치 차이</th><th>z 점수</th><th>등록 시각</th></tr></thead><tbody>'+researchCandidates.map(item=>'<tr><td>'+escapeHtml(item.label)+'</td><td>'+formatNumber(item.testCount)+'회</td><td>+'+Number(item.delta).toFixed(4)+'</td><td>'+Number(item.zScore).toFixed(2)+'</td><td>'+escapeHtml(formatSyncTime(item.createdAt))+'</td></tr>').join('')+'</tbody></table></div><div class="analytics-legend">후보는 연구 기록으로만 저장됩니다. 실제 추천 조합 생성이나 구매에는 자동 반영되지 않습니다.</div>'
      : '<div class="empty">아직 등록된 후보가 없습니다. 유의미한 개선이 검증되지 않으면 0개로 유지됩니다.</div>';
  }
  const message = $('researchRunMessage');
  if (!researchRunning && dataReady && !researchReport && researchLastRunTone === 'warning') {
    researchLastRunMessage = '';
    researchLastRunTone = 'normal';
  }
  if (message && !researchRunning) {
    message.className = 'notice research-run-message';
    if (researchLastRunMessage) {
      message.textContent = researchLastRunMessage;
      if (researchLastRunTone === 'error') message.classList.add('research-message-error');
      if (researchLastRunTone === 'warning') message.classList.add('research-message-warning');
    } else if (!engineReady) {
      message.textContent = '연구 엔진 스크립트를 불러오지 못했습니다. 페이지를 새로고침한 뒤에도 계속되면 관리자 확인이 필요합니다.';
      message.classList.add('research-message-error');
    } else if (count < 150) {
      message.textContent = '회차 데이터가 '+count+'개입니다. 최소 150회 이상의 유효한 연속 회차가 필요합니다. 데이터 연결이 끝난 뒤 다시 실행해 주세요.';
      message.classList.add('research-message-warning');
    } else if (!dataReady) {
      message.textContent = '화면의 누적 데이터 연속성 검사가 아직 통과되지 않았습니다. 실행 버튼을 누르면 연구 엔진이 회차 누락과 번호 형식을 다시 검사하고, 검사 결과를 이곳에 표시합니다.';
      message.classList.add('research-message-warning');
    } else if (researchReport) {
      message.textContent = '마지막 연구 완료: '+formatSyncTime(researchReport.createdAt)+' · '+formatNumber(researchReport.drawCount)+'회 데이터 · 100개 전략 · '+formatNumber(researchReport.simulationCount)+'회 시뮬레이션. 다시 실행하면 결과를 새로 계산합니다.';
    } else {
      message.textContent = '데이터 '+formatNumber(count)+'회가 준비되었습니다. 버튼을 누르면 ① 전체 회차 검증 ② 무작위 참가자 200명 생성 ③ 100개 전략 토너먼트 ④ 몬테카를로 1,000,000회 순서로 실제 계산합니다. 각 단계의 진행률이 표시됩니다.';
    }
  }
  renderResearchResults();
  renderResearchHistory();
}

function updateResearchProgress(label, completed, total, stageOffset, stageScale) {
  const percent = Math.min(100, Math.round(stageOffset + (total ? completed / total * stageScale : 0)));
  if ($('researchProgressLabel')) $('researchProgressLabel').textContent = label;
  if ($('researchProgressPct')) $('researchProgressPct').textContent = percent+'%';
  if ($('researchProgressBar')) $('researchProgressBar').style.width = percent+'%';
}

async function runResearchLab() {
  if (researchRunning) return;
  const runGeneration=researchRunGeneration;
  const runOwner=cloudSession?.user?.id||'local';
  const message = $('researchRunMessage');
  const button = $('runResearchBtn');
  const showMessage = (text, tone = 'normal') => {
    researchLastRunMessage = text;
    researchLastRunTone = tone;
    if (message) {
      message.textContent = text;
      message.className = 'notice research-run-message'+(tone === 'error' ? ' research-message-error' : tone === 'warning' ? ' research-message-warning' : '');
    }
    if (button) button.disabled = researchRunning;
  };

  // 이전에는 이 조건들이 버튼 자체를 비활성화하거나 토스트만 띄워 사용자가 이유를 알 수 없었습니다.
  if (!window.Lucky645Research) {
    showMessage('실행 중단: 연구 엔진 스크립트가 로드되지 않았습니다. research.js 요청 상태와 브라우저 캐시를 확인해 주세요.', 'error');
    return;
  }

  let validatedDraws;
  try {
    validatedDraws = window.Lucky645Research.normalizeDraws(draws);
  } catch (error) {
    showMessage('데이터 사전 검사 실패: '+error.message+' 현재 확보 회차 '+draws.length+'개. 회차 데이터가 완전히 연결된 후 다시 실행해 주세요.', 'warning');
    if (typeof toast === 'function') toast('연구 실행 조건을 확인해 주세요. 자세한 내용은 연구소 상태 메시지를 확인하세요.');
    return;
  }

  if (validatedDraws.length < 150) {
    showMessage('실행 중단: 검증 데이터가 '+validatedDraws.length+'회입니다. 최소 150회가 필요합니다.', 'warning');
    return;
  }

  researchLastRunMessage = '';
  researchLastRunTone = 'normal';
  researchRunning = true;
  if (message) message.className = 'notice research-run-message';
  if (button) {
    button.disabled = true;
    button.textContent = '연구 준비 중…';
    button.setAttribute('aria-busy', 'true');
  }
  if ($('researchProgressWrap')) $('researchProgressWrap').style.display = 'block';
  if ($('researchProgressBar')) $('researchProgressBar').style.width = '0%';
  if ($('researchRunMessage')) $('researchRunMessage').textContent = '데이터 사전 검사 통과: '+formatNumber(validatedDraws.length)+'개 회차. 이제 100개 전략을 평가합니다.';
  updateResearchProgress('1/4 전체 회차 검증 완료 · 토너먼트 준비', 0, 100, 0, 10);
  const startedAt = Date.now();

  try {
    const report = await window.Lucky645Research.runStudy(validatedDraws, { strategyCount: 100, simulations: 1000000, baselineCount: 200 }, progress => {
      if(runGeneration!==researchRunGeneration)return;
      if (progress.stage === 'baselines') {
        if (button) button.textContent = '무작위 참가자 '+progress.completed+'/'+progress.total;
        updateResearchProgress('2/4 무작위 기준선 '+progress.completed+' / '+progress.total+'명', progress.completed, progress.total, 0, 10);
        if (message) message.textContent = '독립 무작위 기준 참가자를 생성하고 있습니다. '+progress.completed+' / '+progress.total+'명 완료.';
      } else if (progress.stage === 'strategies') {
        if (button) button.textContent = '전략 평가 '+progress.completed+'/'+progress.total;
        updateResearchProgress('3/4 전략 토너먼트 '+progress.completed+' / '+progress.total, progress.completed, progress.total, 10, 40);
        if (message) message.textContent = '100개 전략을 5개 시간순 검증 구간과 무작위 참가자 200명에 비교 중입니다. '+progress.completed+' / '+progress.total+'개 완료.';
      } else if (progress.stage === 'montecarlo') {
        if (button) button.textContent = '시뮬레이션 '+formatNumber(progress.completed)+'회';
        updateResearchProgress('4/4 몬테카를로 '+formatNumber(progress.completed)+' / '+formatNumber(progress.total), progress.completed, progress.total, 50, 50);
        if (message) message.textContent = '몬테카를로 무작위 추첨 계산 중입니다. '+formatNumber(progress.completed)+' / '+formatNumber(progress.total)+'회 완료.';
      }
    });
    if(runGeneration!==researchRunGeneration||(cloudSession?.user?.id||'local')!==runOwner)return;
    report.elapsedMs = Date.now() - startedAt;
    researchReport = report;
    recordResearchRun(report);
    const existing = new Set(researchCandidates.map(item=>item.id));
    const newCandidates = report.evaluation.strategies.filter(item=>item.adjustedSignificance && !existing.has(item.id));
    const createdAt = new Date().toISOString();
    newCandidates.forEach(item=>researchCandidates.unshift({
      id:item.id, label:item.label, family:item.family, lookback:item.lookback,
      testCount:item.testCount, delta:item.delta, zScore:item.zScore, createdAt
    }));
    researchCandidates = researchCandidates.slice(0,100);
    const persisted = persistResearchState();
    if (persisted && typeof cloudSession !== 'undefined' && cloudSession?.access_token) scheduleCloudSync();
    renderResearchLab();
    updateResearchProgress('연구 완료', 1, 1, 100, 0);
    const completion = '연구 완료: '+formatNumber(report.drawCount)+'회 데이터 · 전략 '+report.strategyCount+'개 · 몬테카를로 '+formatNumber(report.simulationCount)+'회 · 소요 '+(report.elapsedMs/1000).toFixed(1)+'초 · 새 후보 '+newCandidates.length+'개.';
    showMessage(completion+(persisted?' 결과와 후보 목록을 이 브라우저에 저장했습니다.':' 계산은 완료했지만 브라우저 저장에 실패했습니다. 저장 공간을 확인해 주세요.'), persisted?'normal':'warning');
    toast('LUCKY 645 연구 완료 · 후보 '+newCandidates.length+'개');
  } catch (error) {
    if(runGeneration!==researchRunGeneration)return;
    const detail = error && error.message ? error.message : String(error);
    showMessage('연구 실행 오류: '+detail+' 진행률과 브라우저 콘솔을 확인해 주세요.', 'error');
    toast('연구 실행 오류가 발생했습니다.');
  } finally {
    if(runGeneration!==researchRunGeneration)return;
    researchRunning = false;
    if (button) {
      button.disabled = false;
      button.textContent = '⚗ 전체 연구 다시 실행';
      button.setAttribute('aria-busy', 'false');
    }
    renderResearchLab();
    // 완료/실패 메시지는 renderResearchLab의 기본 안내문보다 우선합니다.
  }
}


function researchReportSummary(report) {
  const rows = report && report.evaluation && Array.isArray(report.evaluation.strategies) ? report.evaluation.strategies : [];
  const average = rows.length ? rows.reduce((sum,item)=>sum+Number(item.averageMatches||0),0)/rows.length : 0;
  const top = rows[0] || null;
  return {
    average,
    baseline: Number(report?.evaluation?.baselineAverage || 0),
    topAverage: Number(top?.averageMatches || 0),
    topLabel: top?.label || '없음',
    topWinRate: Number(top?.randomWinRate || 0),
    candidates: Number(report?.evaluation?.candidateCount || 0),
    testCount: Number(report?.evaluation?.testCount || 0),
    baselineCount: Number(report?.evaluation?.baselineCount || report?.evaluation?.tournament?.randomBaselineCount || 0)
  };
}

function renderResearchHistory() {
  const select = $('researchCompareSelect');
  const summary = $('researchCompareSummary');
  const list = $('researchHistoryList');
  const history = researchHistory.slice(0, MAX_RESEARCH_HISTORY);
  if (select) {
    const options = history.slice(1).map(item => ({
      id: item.runId || item.createdAt,
      label: formatSyncTime(item.createdAt)+' · '+formatNumber(item.drawCount)+'회 데이터'
    }));
    if (!options.some(item=>item.id===researchCompareRunId)) {
      researchCompareRunId = options[0]?.id || '';
    }
    select.innerHTML = options.length
      ? options.map(item=>'<option value="'+escapeHtml(item.id)+'">'+escapeHtml(item.label)+'</option>').join('')
      : '<option value="">비교할 이전 연구가 없습니다</option>';
    select.disabled = options.length === 0;
    if (researchCompareRunId) select.value = researchCompareRunId;
  }
  if (summary) {
    const current = history[0] || researchReport;
    const previous = history.find(item => (item.runId || item.createdAt) === researchCompareRunId);
    if (!current) {
      summary.className = 'empty';
      summary.textContent = '연구가 아직 실행되지 않았습니다. 첫 실행이 완료되면 이후 연구부터 자동 비교합니다.';
    } else if (!previous) {
      summary.className = 'empty';
      summary.textContent = '첫 연구 이력이 저장되었습니다. 다음 연구 실행 후 성능 변화가 자동 비교됩니다.';
    } else {
      const now = researchReportSummary(current);
      const before = researchReportSummary(previous);
      const delta = now.average - before.average;
      const baselineDelta = now.baseline - before.baseline;
      const signed = value => (value > 0 ? '+' : '') + value.toFixed(4);
      summary.className = 'research-comparison';
      summary.innerHTML = '<div class="research-comparison-heading"><strong>최근 연구와 선택한 이전 연구</strong><span>'+escapeHtml(formatSyncTime(previous.createdAt))+' 기준</span></div><div class="research-comparison-grid"><div><span>100개 전략 평균 변화</span><strong class="'+(delta>0?'research-positive':delta<0?'research-negative':'')+'">'+signed(delta)+'</strong></div><div><span>무작위 기준 평균 변화</span><strong>'+signed(baselineDelta)+'</strong></div><div><span>최고 전략 무작위 승률</span><strong>'+ (now.topWinRate*100).toFixed(1)+'%</strong></div><div><span>채택 후보 변화</span><strong>'+now.candidates+'개 / 이전 '+before.candidates+'개</strong></div></div><div class="analytics-legend">현재 최고 전략: '+escapeHtml(now.topLabel)+' · 직전 최고 전략: '+escapeHtml(before.topLabel)+' · 평균은 각 실행의 100개 전략 평균이며, 실행 간 데이터 구간이 다르면 직접적인 성능 우위로 단정할 수 없습니다.</div>';
    }
  }
  if (list) {
    if (!history.length) {
      list.className = 'empty';
      list.textContent = '완료된 연구 이력이 없습니다.';
    } else {
      list.className = 'research-history-list';
      list.innerHTML = history.map((item,index)=>{
        const summary = researchReportSummary(item);
        const tournament = item.evaluation?.tournament;
        return '<div class="research-history-row"><div class="research-history-main"><strong>'+(index===0?'최근 연구':'이전 연구 '+index)+'</strong><span>'+escapeHtml(formatSyncTime(item.createdAt))+' · '+formatNumber(item.firstRound||1)+'~'+formatNumber(item.lastRound||item.drawCount)+'회차</span></div><div class="research-history-metrics"><span>전략 평균 <b>'+summary.average.toFixed(4)+'</b></span><span>무작위 '+summary.baseline.toFixed(4)+'</span><span>후보 '+summary.candidates+'개</span><span>토너먼트 '+formatNumber(tournament?.randomBaselineCount||summary.baselineCount)+'명</span><span>실험 '+formatNumber(item.simulationCount)+'회</span></div></div>';
      }).join('');
    }
  }
}

async function importResearchHistoryFile(file) {
  if (!file) return;
  const importOwner=cloudSession?.user?.id||'local';
  const importGeneration=cloudSessionGeneration;
  if (file.size > MAX_BACKUP_FILE_SIZE) return toast('연구 이력 파일은 12MB 이하만 불러올 수 있습니다.');
  try {
    const fileText=await file.text();
    assertAccountScope(importOwner,importGeneration);
    const raw = JSON.parse(fileText);
    const imported = window.Lucky645ResearchHistory.normalizeArchive(raw);
    const merged = window.Lucky645ResearchHistory.mergeRuns(imported, researchHistory);
    const oldIds = new Set(researchHistory.map(item => item.runId || item.createdAt));
    const added = merged.filter(item => !oldIds.has(item.runId || item.createdAt)).length;
    if (!confirm('검증된 연구 '+imported.length+'건을 확인했습니다. 기존 이력과 병합하고 최근 12건을 보관할까요?\n새로 추가될 연구: '+added+'건\n기존 기록은 덮어쓰지 않습니다.')) return;
    assertAccountScope(importOwner,importGeneration);
    const previous = { history: researchHistory, report: researchReport };
    researchHistory = merged;
    researchReport = merged[0] || researchReport;
    if (!persistResearchState()) { researchHistory = previous.history; researchReport = previous.report; return; }
    renderResearchLab();
    if (importOwner!=='local'&&cloudSession?.access_token) {
      try {
        const token=await cloudAccessToken();
        assertAccountScope(importOwner,importGeneration);
        await syncResearchRuns(token,importOwner,importGeneration);
      } catch (error) {
        if(importOwner===(cloudSession?.user?.id||'local')&&$('cloudMessage')) $('cloudMessage').textContent = '로컬 복원은 완료했지만 클라우드 동기화는 보류됐습니다: '+error.message;
      }
    }
    toast('연구 이력 복원 완료: '+imported.length+'건 검사, '+added+'건 추가');
  } catch (error) { toast('연구 이력 복원 실패: '+error.message); }
}

async function fetchAllResearchRuns(token) {
  const pageSize = 1000;
  const maxRows = 200000;
  const base = '/rest/v1/lucky645_research_runs?select=run_id,report,created_at,updated_at&order=created_at.desc,run_id.asc';
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const page = await cloudRequest(base + `&limit=${pageSize}&offset=${offset}`, { method: 'GET' }, token);
    if (!Array.isArray(page)) throw new Error('클라우드 연구 이력 응답 형식이 올바르지 않습니다.');
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  throw new Error('연구 이력이 20만 건을 초과했습니다. JSON 백업으로 보관한 뒤 고객지원에 문의해 주세요.');
}

async function syncResearchRuns(token, expectedUserId=cloudSession?.user?.id, expectedGeneration=cloudSessionGeneration) {
  if (!expectedUserId || !token) return { uploaded: 0, downloaded: 0 };
  assertCloudSyncSession(expectedUserId,expectedGeneration);
  const remote = await fetchAllResearchRuns(token);
  assertCloudSyncSession(expectedUserId,expectedGeneration);
  if (!Array.isArray(remote)) throw new Error('클라우드 연구 이력 응답 형식이 올바르지 않습니다.');
  const remoteReports = remote.map(row => {
    const report = window.Lucky645ResearchHistory.normalizeReport(row.report);
    if (String(row.run_id) !== report.runId) throw new Error('클라우드 연구 ID가 보고서와 일치하지 않습니다.');
    return report;
  });
  const merged = window.Lucky645ResearchHistory.mergeRuns(remoteReports, researchHistory);
  const remoteIds = new Set(remoteReports.map(item => item.runId));
  const upload = window.Lucky645ResearchHistory.selectRunsToUpload(researchHistory, remoteReports);
  if (upload.length) {
    const rows = upload.map(report => ({ user_id: expectedUserId, run_id: report.runId || report.createdAt, report, created_at: report.createdAt, updated_at: new Date().toISOString() }));
    assertCloudSyncSession(expectedUserId,expectedGeneration);
    await cloudRequest('/rest/v1/lucky645_research_runs?on_conflict=user_id,run_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows)
    }, token);
  }
  assertCloudSyncSession(expectedUserId,expectedGeneration);
  researchHistory = merged;
  if (merged.length && (!researchReport || Date.parse(merged[0].createdAt) > Date.parse(researchReport.createdAt))) researchReport = merged[0];
  if (!persistResearchState()) throw new Error('클라우드 연구 이력은 읽었지만 이 기기의 저장 공간에 반영하지 못했습니다.');
  renderResearchLab();
  return { uploaded: upload.length, downloaded: remoteReports.length };
}

function exportResearchHistory() {
  if (!researchHistory.length) return toast('내보낼 연구 이력이 없습니다.');
  const payload = {
    schema: 'lucky645-research-history-v1',
    exportedAt: new Date().toISOString(),
    runs: researchHistory
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'lucky645-research-history-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('연구 이력 파일을 내보냈습니다.');
}

function navigate(page) {
  document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===`page-${page}`));
  document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
  const labels = {home:'데이터와 무작위 조합으로 만드는 나만의 번호',generator:'원하는 방식으로 로또 번호 조합 생성',stats:'역대 당첨번호 통계와 숫자 분포 분석',analytics:'전체 회차 기반 고급 통계와 번호 패턴 분석',simulation:'무작위 실험으로 번호별 빈도 그래프와 조합 후보 확인',research:'100개 전략 비교와 백만 회 몬테카를로 검증',checker:'저장한 조합 및 직접 입력 번호 당첨 확인',saved:'내가 보관한 번호 조합 관리',history:'회차별 로또 6/45 당첨 결과'};
  $('pageSubtitle').textContent = labels[page] || labels.home;
  if (page === 'analytics') renderAnalytics();
  if (page === 'simulation') renderSimulationPage();
  if (page === 'research') renderResearchLab();
  window.scrollTo({top:0,behavior:'smooth'});
}
window.navigate = navigate;

function drawsForPeriod() {
  if (statsPeriod === 'all') return draws;
  const count = Number(statsPeriod);
  return draws.slice(-count);
}

function drawsForStatsWeighting() {
  if (statsWeightPeriod === 'all') return draws;
  const count = Number(statsWeightPeriod);
  return draws.slice(-count);
}

function frequencyWeights(sample) {
  const counts = Array(46).fill(0);
  (Array.isArray(sample) ? sample : []).forEach(draw => {
    if (Array.isArray(draw?.numbers)) draw.numbers.forEach(number => {
      if (Number.isInteger(number) && number >= 1 && number <= 45) counts[number]++;
    });
  });
  const expected = sample?.length ? sample.length * 6 / 45 : 0;
  const weights = Array(46).fill(1);
  for (let number = 1; number <= 45; number++) {
    const relative = expected ? (counts[number] - expected) / expected : 0;
    // 최대 ±20%만 반영해 과거 빈도가 지나치게 영향력을 갖지 않도록 합니다.
    weights[number] = Math.max(0.8, Math.min(1.2, 1 + relative * 0.08));
  }
  return { counts, weights, sampleCount: Array.isArray(sample) ? sample.length : 0 };
}

function renderStats() {
  const sample = drawsForPeriod();
  if (!sample.length) return;
  const counts = Array(46).fill(0);
  let odd = 0, even = 0, sumTotal = 0;
  const ranges = [0,0,0,0,0];
  sample.forEach(draw=>{
    draw.numbers.forEach(number=>{
      counts[number]++;
      if (number % 2) odd++; else even++;
      ranges[Math.min(4,Math.floor((number-1)/10))]++;
    });
    sumTotal += draw.numbers.reduce((a,b)=>a+b,0);
  });
  const sortedHot = Array.from({length:45},(_,i)=>i+1).sort((a,b)=>counts[b]-counts[a] || a-b);
  const sortedCold = [...sortedHot].reverse();
  const top = sortedHot.slice(0,10);
  const low = sortedCold.slice(0,10);
  const periodName = statsPeriod === 'all' ? '전체 회차' : `최근 ${statsPeriod}회`;
  $('analysisCount').textContent = sample.length.toLocaleString();
  $('hotNumber').textContent = `${top[0]}번`;
  $('hotCount').textContent = `${counts[top[0]].toLocaleString()}회 출현 · ${periodName}`;
  $('coldNumber').textContent = `${low[0]}번`;
  $('coldCount').textContent = `${counts[low[0]].toLocaleString()}회 출현 · ${periodName}`;
  $('hotChart').innerHTML = chartRows(top,counts,'hot');
  $('coldChart').innerHTML = chartRows(low,counts,'cool');
  $('oddEven').innerHTML = `<div class="chart-list">${barRow('홀수',odd,odd+even,'hot')}${barRow('짝수',even,odd+even,'cool')}</div><div class="panel-desc" style="margin-top:12px">홀수 ${formatNumber(odd)}개 (${(odd/(odd+even)*100).toFixed(1)}%) · 짝수 ${formatNumber(even)}개 (${(even/(odd+even)*100).toFixed(1)}%)</div>`;
  const rangeNames = ['1~10','11~20','21~30','31~40','41~45'];
  $('rangeChart').innerHTML = `<div class="chart-list">${ranges.map((value,index)=>barRow(rangeNames[index],value,odd+even,index%2?'cool':'hot')).join('')}</div><div class="panel-desc" style="margin-top:12px">번호 ${formatNumber(odd+even)}개 집계 · 회차당 번호 6개</div>`;
  $('statsSampleLabel') && ($('statsSampleLabel').textContent = `${periodName} · ${sample[0].round}회~${sample.at(-1).round}회 · 평균 번호 합 ${(sumTotal/sample.length).toFixed(1)}`);
  document.querySelectorAll('[data-period]').forEach(button=>button.classList.toggle('active',button.dataset.period===statsPeriod));
}

function chartRows(numbers,counts,kind) {
  const max = Math.max(...numbers.map(n=>counts[n]),1);
  return `<div class="chart-list">${numbers.map(number=>`<div class="chart-row"><strong>${number}</strong><div class="bar-track"><div class="bar-fill ${kind==='hot'?'hot':'cool'}" style="width:${Math.max(2,counts[number]/max*100)}%"></div></div><strong style="text-align:right">${counts[number]}</strong></div>`).join('')}</div>`;
}

function barRow(label,value,total,kind) {
  const pct = total ? value/total*100 : 0;
  return `<div class="chart-row"><span>${label}</span><div class="bar-track"><div class="bar-fill ${kind==='hot'?'hot':'cool'}" style="width:${pct.toFixed(2)}%"></div></div><strong style="text-align:right">${formatNumber(value)}</strong></div>`;
}

function drawsForAnalytics() {
  // Draws are normalized and kept in ascending round order by mergeDraws().
  if (analyticsPeriod === 'all') return draws;
  const count = Number(analyticsPeriod);
  return Number.isInteger(count) && count > 0 ? draws.slice(-count) : draws;
}

function prepareAnalyticsSample(input) {
  const source = Array.isArray(input) ? input : [];
  let previousRound = 0;
  let isCanonical = true;
  for (const draw of source) {
    if (!draw || !Number.isInteger(draw.round) || draw.round <= previousRound ||
        !Array.isArray(draw.numbers) || draw.numbers.length !== 6) {
      isCanonical = false;
      break;
    }
    previousRound = draw.round;
    for (let index=0; index<6; index++) {
      const number = draw.numbers[index];
      if (!Number.isInteger(number) || number < 1 || number > 45 ||
          (index > 0 && number <= draw.numbers[index-1])) {
        isCanonical = false;
        break;
      }
    }
    if (!isCanonical) break;
  }
  if (isCanonical) return source;

  return source
    .filter(draw => draw && Number.isInteger(Number(draw.round)) && Array.isArray(draw.numbers)
      && draw.numbers.length === 6 && new Set(draw.numbers).size === 6
      && draw.numbers.every(n => Number.isInteger(n) && n >= 1 && n <= 45))
    .map(draw => ({...draw, round:Number(draw.round), numbers:sortNums(draw.numbers)}))
    .sort((a,b)=>a.round-b.round);
}

function calculateAnalytics(input) {
  const sample = prepareAnalyticsSample(input);
  const counts = Array(46).fill(0);
  const lastSeen = Array(46).fill(null);
  const firstSeen = Array(46).fill(null);
  const endings = Array(10).fill(0);
  const ranges = Array(5).fill(0);
  const oddDistribution = Array(7).fill(0);
  const adjacentPairDistribution = Array(7).fill(0);
  const sumBins = [
    {label:'21~89',min:21,max:89,count:0},
    {label:'90~109',min:90,max:109,count:0},
    {label:'110~129',min:110,max:129,count:0},
    {label:'130~149',min:130,max:149,count:0},
    {label:'150~169',min:150,max:169,count:0},
    {label:'170~189',min:170,max:189,count:0},
    {label:'190~255',min:190,max:255,count:0}
  ];
  const pairCounts = new Map();
  const sums = [];
  let totalOdd = 0, totalSum = 0, consecutiveDraws = 0, tripleConsecutiveDraws = 0;
  for (const draw of sample) {
    const nums = draw.numbers;
    let odd = 0, sum = 0, adjacentPairs = 0, hasTripleConsecutive = false;
    for (let i=0;i<nums.length;i++) {
      const n=nums[i];
      counts[n]++;
      lastSeen[n]=draw.round;
      if (firstSeen[n]===null) firstSeen[n]=draw.round;
      endings[n%10]++;
      ranges[Math.min(4,Math.floor((n-1)/10))]++;
      if (n%2) odd++;
      sum+=n;
      if (i>0 && n===nums[i-1]+1) adjacentPairs++;
      if (i>=2 && n===nums[i-1]+1 && nums[i-1]===nums[i-2]+1) hasTripleConsecutive=true;
    }
    totalOdd+=odd;
    totalSum+=sum;
    sums.push(sum);
    oddDistribution[odd]++;
    adjacentPairDistribution[Math.min(6,adjacentPairs)]++;
    if (adjacentPairs>0) consecutiveDraws++;
    if (hasTripleConsecutive) tripleConsecutiveDraws++;
    const bucket=sumBins.find(bin=>sum>=bin.min && sum<=bin.max);
    if (bucket) bucket.count++;
    for (let i=0;i<nums.length;i++) for(let j=i+1;j<nums.length;j++) {
      const key=`${nums[i]}-${nums[j]}`;
      pairCounts.set(key,(pairCounts.get(key)||0)+1);
    }
  }
  const drawCount=sample.length;
  const latestRound=sample.length?sample[sample.length-1].round:0;
  const sortedSums=[...sums].sort((a,b)=>a-b);
  const median=drawCount ? (drawCount%2 ? sortedSums[(drawCount-1)/2] : (sortedSums[drawCount/2-1]+sortedSums[drawCount/2])/2) : 0;
  const hot=Array.from({length:45},(_,i)=>i+1).sort((a,b)=>counts[b]-counts[a]||a-b);
  const overdue=Array.from({length:45},(_,i)=>i+1).map(number=>({
    number, lastSeenRound:lastSeen[number], gap:lastSeen[number]===null?null:latestRound-lastSeen[number], count:counts[number]
  })).sort((a,b)=>(b.gap??Number.MAX_SAFE_INTEGER)-(a.gap??Number.MAX_SAFE_INTEGER)||a.number-b.number);
  const pairs=[...pairCounts.entries()].map(([key,count])=>({numbers:key.split('-').map(Number),count})).sort((a,b)=>b.count-a.count||a.numbers[0]-b.numbers[0]||a.numbers[1]-b.numbers[1]);
  return {
    drawCount, firstRound:sample[0]?.round??null, latestRound,
    counts, firstSeen, lastSeen, hot, cold:[...hot].reverse(), overdue, pairs,
    pairExpected:drawCount*15/990,
    totalNumberDraws:drawCount*6,
    ranges, endings, oddDistribution, adjacentPairDistribution,
    consecutiveDraws, tripleConsecutiveDraws,
    averageSum:drawCount?totalSum/drawCount:0, medianSum:median,
    averageOdd:drawCount?totalOdd/drawCount:0,
    minSum:drawCount?Math.min(...sums):0, maxSum:drawCount?Math.max(...sums):0,
    sumBins, sums
  };
}

function renderInlineDistribution(targetId, labels, values, total, tone='hot') {
  const max=Math.max(...values,1);
  $(targetId).innerHTML=`<div class="analytics-inline-bars">${labels.map((label,index)=>{
    const value=values[index]||0;
    const pct=total?value/total*100:0;
    return `<div class="analytics-inline-row"><span>${escapeHtml(label)}</span><div class="bar-track"><div class="bar-fill ${tone==='cool'?'cool':tone==='hot'?'hot':''}" style="width:${Math.max(value?1:0,value/max*100)}%"></div></div><strong style="text-align:right">${formatNumber(value)}<small class="muted"> (${pct.toFixed(1)}%)</small></strong></div>`;
  }).join('')}</div>`;
}

function renderAnalytics() {
  const sample=drawsForAnalytics();
  const result=calculateAnalytics(sample);
  if (!result.drawCount) {
    ['anaDrawCount','anaAvgSum','anaMedianSum','anaAvgOdd'].forEach(id=>{if($(id))$(id).textContent='-';});
    if ($('anaRoundRange')) $('anaRoundRange').textContent='분석할 회차 없음';
    if ($('analyticsDataQuality')) { $('analyticsDataQuality').textContent='분석 데이터 없음'; $('analyticsDataQuality').className='badge yellow'; }
    ['anaHot','anaOverdue','anaPairs','anaOddDist','anaSumDist','anaRangeDist','anaEndingDist','anaConsecutive'].forEach(id=>{if($(id))$(id).innerHTML='<div class="empty">전체 당첨 데이터를 불러오면 표시됩니다.</div>';});
    if ($('analyticsSampleLabel')) $('analyticsSampleLabel').textContent='분석할 과거 회차 데이터가 없습니다.';
    return result;
  }
  $('anaDrawCount').textContent=formatNumber(result.drawCount);
  $('anaRoundRange').textContent=`${result.firstRound}회 ~ ${result.latestRound}회`;
  $('anaAvgSum').textContent=result.averageSum.toFixed(1);
  $('anaMedianSum').textContent=Number.isInteger(result.medianSum)?String(result.medianSum):result.medianSum.toFixed(1);
  $('anaAvgOdd').textContent=`${result.averageOdd.toFixed(2)}개`;
  $('analyticsSampleLabel').textContent=`${analyticsPeriod==='all'?'전체 누적':`최근 ${analyticsPeriod}회`} · ${result.firstRound}~${result.latestRound}회 · 총 ${formatNumber(result.drawCount)}회 분석` + (dataReady?'':' · 일부/캐시 데이터일 수 있음');
  if ($('analyticsDataQuality')) { $('analyticsDataQuality').textContent=dataReady?'1회부터 연속 회차 검증 완료':'부분 데이터 · 전체 범위 미검증'; $('analyticsDataQuality').className=`badge ${dataReady?'green':'yellow'}`; }
  document.querySelectorAll('[data-analytics-period]').forEach(button=>button.classList.toggle('active',button.dataset.analyticsPeriod===analyticsPeriod));

  const top=result.hot.slice(0,10);
  $('anaHot').innerHTML=chartRows(top,result.counts,'hot');
  const overdueRows=result.overdue.slice(0,10);
  $('anaOverdue').innerHTML=`<div class="table-wrap"><table class="analytics-table"><thead><tr><th>번호</th><th>마지막 출현</th><th>미출현 간격</th><th>표본 내 횟수</th></tr></thead><tbody>${overdueRows.map(item=>`<tr><td class="analytics-number">${item.number}</td><td>${item.lastSeenRound===null?'기간 내 미출현':`${item.lastSeenRound}회`}</td><td>${item.gap===null?'표본 내 0회':`${item.gap}회`}</td><td>${item.count}회</td></tr>`).join('')}</tbody></table></div><div class="analytics-legend">미출현 간격은 마지막 출현 회차와 표본의 최신 회차 차이입니다. 장기 미출현이 다음 추첨 가능성을 높이지 않습니다.</div>`;
  $('anaPairs').innerHTML=`<div class="table-wrap"><table class="analytics-table"><thead><tr><th>순위</th><th>번호 쌍</th><th>동반 출현</th><th>표본 기대값*</th></tr></thead><tbody>${result.pairs.slice(0,10).map((pair,index)=>`<tr><td>${index+1}</td><td class="analytics-number">${pair.numbers[0]} + ${pair.numbers[1]}</td><td>${pair.count}회</td><td>${result.pairExpected.toFixed(1)}회</td></tr>`).join('')}</tbody></table></div><div class="analytics-legend">*각 번호 쌍이 무작위 추첨에서 함께 나올 것으로 기대되는 횟수의 단순 기준치입니다. 이는 예측 점수가 아닙니다.</div>`;
  renderInlineDistribution('anaOddDist',['홀수 0','홀수 1','홀수 2','홀수 3','홀수 4','홀수 5','홀수 6'],result.oddDistribution,result.drawCount,'cool');
  renderInlineDistribution('anaSumDist',result.sumBins.map(bin=>bin.label),result.sumBins.map(bin=>bin.count),result.drawCount,'hot');
  renderInlineDistribution('anaRangeDist',['1~10','11~20','21~30','31~40','41~45'],result.ranges,result.totalNumberDraws,'cool');
  renderInlineDistribution('anaEndingDist',Array.from({length:10},(_,i)=>`${i} 끝`),result.endings,result.totalNumberDraws,'hot');
  renderInlineDistribution('anaConsecutive',['0쌍','1쌍','2쌍','3쌍','4쌍','5쌍','6쌍'],result.adjacentPairDistribution,result.drawCount,'cool');
  $('anaConsecutive').insertAdjacentHTML('beforeend',`<div class="analytics-result-grid" style="margin-top:14px"><div class="analytics-result-card"><span class="small-label">연속쌍 포함 회차</span><strong>${result.consecutiveDraws}회</strong><span class="analytics-mini">${(result.consecutiveDraws/result.drawCount*100).toFixed(1)}%</span></div><div class="analytics-result-card"><span class="small-label">3연속 이상 포함</span><strong>${result.tripleConsecutiveDraws}회</strong><span class="analytics-mini">${(result.tripleConsecutiveDraws/result.drawCount*100).toFixed(1)}%</span></div><div class="analytics-result-card"><span class="small-label">합계 최소 ~ 최대</span><strong>${result.minSum} ~ ${result.maxSum}</strong><span class="analytics-mini">평균 ${result.averageSum.toFixed(1)}</span></div></div>`);
  return result;
}

function simulateCombinations(count, rng=Math.random) {
  const allowed=[1000,5000,10000];
  if (!allowed.includes(Number(count))) throw new Error('시뮬레이션 횟수는 1,000 / 5,000 / 10,000 중 선택해 주세요.');
  const attempts=Number(count), numberCounts=Array(46).fill(0), oddDistribution=Array(7).fill(0);
  const sumBins=[0,0,0,0,0,0,0];
  let totalSum=0, totalOdd=0;
  const binIndex=sum=>sum<90?0:sum<110?1:sum<130?2:sum<150?3:sum<170?4:sum<190?5:6;
  for(let run=0;run<attempts;run++){
    const pool=Array.from({length:45},(_,i)=>i+1);
    let sum=0, odd=0;
    for(let pick=0;pick<6;pick++){
      const raw=Number(rng());
      const safe=Number.isFinite(raw)?Math.max(0,Math.min(0.999999999999,raw)):0;
      const index=pick+Math.floor(safe*(45-pick));
      [pool[pick],pool[index]]=[pool[index],pool[pick]];
      const number=pool[pick];
      numberCounts[number]++;
      sum+=number;
      if(number%2)odd++;
    }
    totalSum+=sum; totalOdd+=odd; oddDistribution[odd]++; sumBins[binIndex(sum)]++;
  }
  return {attempts,totalSum,averageSum:totalSum/attempts,averageOdd:totalOdd/attempts,numberCounts,oddDistribution,sumBins};
}


function simulationRandomIndex(rng,maxExclusive) {
  const raw=Number(rng());
  const safe=Number.isFinite(raw)?Math.max(0,Math.min(0.999999999999,raw)):0;
  return Math.floor(safe*maxExclusive);
}

function createFrequencySimulationState(attempts) {
  const allowed=[1000,10000,50000,100000];
  if (!allowed.includes(Number(attempts))) throw new Error('실험 횟수는 1,000 / 10,000 / 50,000 / 100,000 중에서 선택해 주세요.');
  return {attempts:Number(attempts),completed:0,numberCounts:Array(46).fill(0)};
}

function simulateFrequencyDraw(numberCounts,rng=Math.random) {
  // Floyd 표본 추출: 45개 중 6개를 편향 없이 뽑으며 매 회차 전체 배열을 복사하지 않습니다.
  const selected=new Set();
  for(let index=39;index<45;index++){
    const candidate=simulationRandomIndex(rng,index+1);
    selected.add(selected.has(candidate)?index:candidate);
  }
  for(const index of selected) numberCounts[index+1]++;
}

function simulateFrequencyBatch(state,batchSize,rng=Math.random) {
  const count=Math.max(0,Math.min(Number(batchSize)||0,state.attempts-state.completed));
  for(let index=0;index<count;index++) simulateFrequencyDraw(state.numberCounts,rng);
  state.completed+=count;
  return state;
}

function finalizeFrequencySimulation(state) {
  const expectedPerNumber=state.attempts*6/45;
  let chiSquare=0,totalNumbers=0;
  for(let number=1;number<=45;number++){
    const observed=state.numberCounts[number];
    totalNumbers+=observed;
    const delta=observed-expectedPerNumber;
    chiSquare+=delta*delta/expectedPerNumber;
  }
  const ranking=Array.from({length:45},(_,index)=>({number:index+1,count:state.numberCounts[index+1]}))
    .sort((a,b)=>b.count-a.count||a.number-b.number);
  return {
    attempts:state.attempts,
    numberCounts:state.numberCounts,
    totalNumbers,
    expectedPerNumber,
    chiSquare,
    ranking,
    topNumbers:ranking.slice(0,10)
  };
}

function simulateFrequencyDistribution(count,rng=Math.random) {
  const state=createFrequencySimulationState(count);
  simulateFrequencyBatch(state,state.attempts,rng);
  return finalizeFrequencySimulation(state);
}

async function simulateFrequencyDistributionAsync(count,rng=Math.random,onProgress=()=>{}) {
  const state=createFrequencySimulationState(count);
  const batchSize=5000;
  onProgress(0,state.attempts);
  while(state.completed<state.attempts){
    simulateFrequencyBatch(state,batchSize,rng);
    onProgress(state.completed,state.attempts);
    if(state.completed<state.attempts) await new Promise(resolve=>window.setTimeout(resolve,0));
  }
  return finalizeFrequencySimulation(state);
}

function rankSimulationNumbers(profile) {
  const counts=Array.isArray(profile?.counts)?profile.counts:[];
  if(counts.length!==45) return [];
  return counts.map((count,index)=>({number:index+1,count:Number(count)}))
    .sort((a,b)=>b.count-a.count||a.number-b.number);
}

function buildSimulationCombinations(profile,poolSize,quantity,rng=Math.random,existing=[]) {
  const allowedPoolSizes=[6,8,10,12,15,20];
  const allowedQuantities=[1,3,5,10];
  if(!allowedPoolSizes.includes(Number(poolSize))||!allowedQuantities.includes(Number(quantity))) {
    throw new Error('후보 번호 수 또는 생성 조합 수를 확인해 주세요.');
  }
  const ranking=rankSimulationNumbers(profile);
  if(ranking.length!==45) throw new Error('사용할 시뮬레이션 결과가 올바르지 않습니다.');
  const pool=ranking.slice(0,Number(poolSize)).map(item=>item.number);
  const seen=new Set();
  for(const item of Array.isArray(existing)?existing:[]){
    const numbers=Array.isArray(item)?item:item?.numbers;
    if(Array.isArray(numbers)&&numbers.length===6&&new Set(numbers).size===6) seen.add([...numbers].sort((a,b)=>a-b).join('-'));
  }
  const tickets=[];
  let attempts=0;
  while(tickets.length<Number(quantity)&&attempts<Number(quantity)*250){
    attempts++;
    const candidates=[...pool];
    for(let index=0;index<6;index++){
      const swap=index+simulationRandomIndex(rng,candidates.length-index);
      [candidates[index],candidates[swap]]=[candidates[swap],candidates[index]];
    }
    const ticket=candidates.slice(0,6).sort((a,b)=>a-b);
    const key=ticket.join('-');
    if(seen.has(key)) continue;
    seen.add(key);
    tickets.push(ticket);
  }
  return {pool,tickets};
}

async function runPortfolioSimulation() {
  const button = $('runPortfolioSimulationBtn');
  const output = $('portfolioSimulationOutput');
  const countInput = $('portfolioSimulationCount');
  if (!output) return null;

  const originalLabel = button?.textContent || '포트폴리오 실험 실행';
  if (button) {
    button.disabled = true;
    button.textContent = '실험 준비 중…';
  }
  output.className = 'empty';
  output.textContent = '실험 환경을 준비하고 있습니다. 잠시만 기다려 주세요.';

  try {
    // 먼저 화면을 갱신해 사용자가 클릭 결과를 바로 확인하게 합니다.
    await new Promise(resolve => window.setTimeout(resolve, 0));
    const startedAt = Date.now();
    const attempts = Number(countInput?.value || 5000);
    // 몬테카를로 실험은 보안 토큰이 아니므로 고속 표준 난수를 사용합니다.
    const result = await simulatePortfolioStrategiesAsync(attempts, Math.random, (completed,total) => {
      output.textContent = `포트폴리오 실험 진행 중… ${formatNumber(completed)} / ${formatNumber(total)}회`;
    });
    const elapsedMs = Date.now() - startedAt;
    const random = result.random;
    const coverage = result.coverage;
    const pct = value => (value * 100).toFixed(2) + '%';
    const ratio = 1 / result.jackpotProbability;

    output.className = '';
    output.innerHTML =
      '<div class="analytics-result-grid">' +
        '<div class="analytics-result-card"><span class="small-label">실험 횟수</span><strong>' + formatNumber(result.attempts) + '회</strong><span class="analytics-mini">매 실험 10개 조합씩 비교</span></div>' +
        '<div class="analytics-result-card"><span class="small-label">무작위 평균 커버리지</span><strong>' + random.coverage.toFixed(2) + ' / 45</strong><span class="analytics-mini">번호가 한 번 이상 포함된 개수</span></div>' +
        '<div class="analytics-result-card"><span class="small-label">분산형 평균 커버리지</span><strong>' + coverage.coverage.toFixed(2) + ' / 45</strong><span class="analytics-mini">45개 전체 포함을 목표로 설계</span></div>' +
      '</div>' +
      '<div class="table-wrap" style="margin-top:14px"><table class="analytics-table"><thead><tr><th>비교 지표</th><th>무작위 10조합</th><th>커버리지 분산 10조합</th></tr></thead><tbody>' +
        '<tr><td>평균 번호 커버리지</td><td>' + random.coverage.toFixed(2) + ' / 45</td><td><strong>' + coverage.coverage.toFixed(2) + ' / 45</strong></td></tr>' +
        '<tr><td>3개 이상 일치 조합 존재</td><td>' + pct(random.any3) + '</td><td>' + pct(coverage.any3) + '</td></tr>' +
        '<tr><td>4개 이상 일치 조합 존재</td><td>' + pct(random.any4) + '</td><td>' + pct(coverage.any4) + '</td></tr>' +
        '<tr><td>5개 이상 일치 조합 존재</td><td>' + pct(random.any5) + '</td><td>' + pct(coverage.any5) + '</td></tr>' +
        '<tr><td>1등 정확 일치</td><td>약 1 / ' + formatNumber(Math.round(ratio)) + '</td><td>약 1 / ' + formatNumber(Math.round(ratio)) + '</td></tr>' +
      '</tbody></table></div>' +
      '<div class="notice" style="margin-top:14px"><strong>해석:</strong> 커버리지 분산은 45개 번호를 넓게 사용하는 방식입니다. 3~5개 일치율은 이번 실험에서 관측한 값이며 회차·표본에 따라 흔들립니다. 서로 다른 10개 조합의 1등 확률은 두 방식 모두 같으며, 약 1 / ' + formatNumber(Math.round(ratio)) + '입니다.</div>' +
      '<div class="analytics-mini" style="margin-top:10px">실험은 매번 새 당첨번호 6개를 균등 무작위 추첨해 두 포트폴리오를 비교했습니다. 소요 시간 ' + (elapsedMs / 1000).toFixed(2) + '초 · 과거 빈도나 미출현 번호를 미래 예측에 사용하지 않습니다.</div>';
    toast(formatNumber(result.attempts) + '회 포트폴리오 실험을 완료했습니다.');
    return result;
  } catch (error) {
    output.className = 'empty';
    output.textContent = error?.message || '포트폴리오 실험 중 알 수 없는 오류가 발생했습니다.';
    return null;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}
function runAnalyticsSimulation() {
  try {
    const result=simulateCombinations(Number($('simulationCount').value));
    lastSimulation=result;
    const top=Array.from({length:45},(_,i)=>i+1).sort((a,b)=>result.numberCounts[b]-result.numberCounts[a]||a-b).slice(0,5);
    $('simulationOutput').className='';
    $('simulationOutput').innerHTML=`<div class="analytics-result-grid"><div class="analytics-result-card"><span class="small-label">생성 조합</span><strong>${formatNumber(result.attempts)}개</strong></div><div class="analytics-result-card"><span class="small-label">시뮬레이션 평균 합계</span><strong>${result.averageSum.toFixed(2)}</strong><span class="analytics-mini">이론 평균 138</span></div><div class="analytics-result-card"><span class="small-label">평균 홀수 개수</span><strong>${result.averageOdd.toFixed(3)}개</strong><span class="analytics-mini">이론 기대값 약 3.067개</span></div></div><div class="panel-desc" style="margin-top:14px">이번 실험에서 상대적으로 많이 뽑힌 번호 TOP 5: <strong>${top.join(', ')}</strong></div><div class="panel-desc" style="margin-top:7px">실험은 균등 무작위 조합을 독립적으로 생성한 결과입니다. 실험에서 많이 나온 번호가 실제 추첨에서 유리하다는 뜻은 아닙니다.</div>`;
    toast(`${formatNumber(result.attempts)}회 조합 시뮬레이션을 완료했습니다.`);
    return result;
  } catch(error) { toast(error.message); return null; }
}


function selectedSimulationProfile() {
  const selector=$('simulationProfileSelect');
  const selected=selector?.value||'';
  if(selected==='latest'&&lastFrequencySimulation){
    return {
      id:'latest',
      attempts:lastFrequencySimulation.attempts,
      counts:lastFrequencySimulation.numberCounts.slice(1),
      createdAt:lastFrequencySimulation.createdAt,
      expectedPerNumber:lastFrequencySimulation.expectedPerNumber
    };
  }
  return simulationProfiles.find(profile=>profile.id===selected)||null;
}

function renderSimulationProfileSelector(preferredId=null) {
  const selector=$('simulationProfileSelect');
  if(!selector) return;
  const previous=preferredId||selector.value;
  const options=[];
  if(lastFrequencySimulation) options.push('<option value="latest">이번 실행 결과 · 저장 전</option>');
  simulationProfiles.forEach(profile=>{
    const stamp=new Date(profile.createdAt).toLocaleString('ko-KR');
    options.push('<option value="'+escapeHtml(profile.id)+'">'+formatNumber(profile.attempts)+'회 · '+escapeHtml(stamp)+'</option>');
  });
  selector.innerHTML=options.length?options.join(''):'<option value="">저장된 결과가 없습니다.</option>';
  selector.disabled=!options.length;
  const valid=options.some(option=>option.includes('value="'+previous+'"'));
  if(valid) selector.value=previous;
  else if(lastFrequencySimulation) selector.value='latest';
  else if(simulationProfiles.length) selector.value=simulationProfiles[0].id;
  else selector.value='';
  const selected=selectedSimulationProfile();
  if($('saveSimulationResultBtn')) $('saveSimulationResultBtn').disabled=!lastFrequencySimulation;
  if($('deleteSimulationProfileBtn')) $('deleteSimulationProfileBtn').disabled=!selected||selected.id==='latest';
  if($('buildSimulationTicketsBtn')) $('buildSimulationTicketsBtn').disabled=!selected;
}

function renderSimulationPoolNumbers(profile=selectedSimulationProfile()) {
  const target=$('simulationPoolNumbers');
  if(!target) return;
  if(!profile){
    target.className='simulation-pool-numbers empty';
    target.textContent='먼저 시뮬레이션을 실행하거나 저장된 결과를 선택하세요.';
    return;
  }
  const size=Number($('simulationPoolSize')?.value||8);
  const pool=rankSimulationNumbers(profile).slice(0,size);
  target.className='simulation-pool-numbers';
  target.innerHTML=pool.map(item=>'<span class="simulation-pool-chip">'+ball(item.number,true)+'<small>'+formatNumber(item.count)+'회</small></span>').join('');
}

function renderSimulationProfile(profile=selectedSimulationProfile()) {
  if(!profile){
    $('simulationDrawCount').textContent='-';
    $('simulationExpectedCount').textContent='-';
    $('simulationTopNumber').textContent='-';
    $('simulationTopCount').textContent='실험 결과 대기 중';
    $('simulationFrequencyChart').className='empty';
    $('simulationFrequencyChart').textContent='실험을 실행하면 그래프가 나타납니다.';
    $('simulationHotNumbers').className='empty';
    $('simulationHotNumbers').textContent='실험 결과가 여기에 표시됩니다.';
    $('simulationAllNumbers').className='empty';
    $('simulationAllNumbers').textContent='실험 결과가 여기에 표시됩니다.';
    $('simulationProfileMeta').textContent='실험을 실행한 뒤 저장 버튼을 눌러 빈출 번호 순위를 보관하세요.';
    $('simulationGraphLegend').textContent='각 번호의 이론적 기대 횟수도 함께 표시됩니다.';
    renderSimulationPoolNumbers(null);
    if($('buildSimulationTicketsBtn')) $('buildSimulationTicketsBtn').disabled=true;
    if($('deleteSimulationProfileBtn')) $('deleteSimulationProfileBtn').disabled=true;
    return;
  }
  const ranking=rankSimulationNumbers(profile);
  const expected=profile.attempts*6/45;
  const top=ranking.slice(0,15);
  const max=Math.max(expected,...top.map(item=>item.count),1);
  $('simulationDrawCount').textContent=formatNumber(profile.attempts);
  $('simulationExpectedCount').textContent=formatNumber(expected.toFixed(1));
  $('simulationTopNumber').textContent=ranking[0].number+'번';
  $('simulationTopCount').textContent=formatNumber(ranking[0].count)+'회 출현 · 이론 평균 대비 '+(ranking[0].count-expected>=0?'+':'')+(ranking[0].count-expected).toFixed(1);
  $('simulationGraphLabel').textContent='상위 15개 · 기대 '+formatNumber(expected.toFixed(1))+'회';
  $('simulationFrequencyChart').className='simulation-frequency-chart';
  $('simulationFrequencyChart').innerHTML=top.map((item,index)=>{
    const width=Math.max(1,item.count/max*100);
    const marker=Math.min(99.5,expected/max*100);
    return '<div class="simulation-bar-row"><span class="simulation-rank">'+(index+1)+'. '+item.number+'번</span><div class="simulation-bar-track"><span class="simulation-bar-fill" style="width:'+width.toFixed(2)+'%"></span><i class="simulation-expected-marker" style="left:'+marker.toFixed(2)+'%"></i></div><strong>'+formatNumber(item.count)+'</strong></div>';
  }).join('');
  $('simulationHotNumbers').className='simulation-hot-list';
  $('simulationHotNumbers').innerHTML=ranking.slice(0,10).map((item,index)=>'<div class="simulation-hot-row"><span class="simulation-hot-rank">'+(index+1)+'</span>'+ball(item.number,true)+'<strong>'+formatNumber(item.count)+'회</strong><span class="simulation-deviation">'+(item.count-expected>=0?'+':'')+(item.count-expected).toFixed(1)+'</span></div>').join('');
  $('simulationAllNumbers').className='simulation-frequency-grid';
  $('simulationAllNumbers').innerHTML=ranking.slice().sort((a,b)=>a.number-b.number).map(item=>{
    const deviation=((item.count-expected)/expected*100);
    return '<div class="simulation-frequency-chip"><strong>'+item.number+'</strong><span>'+formatNumber(item.count)+'회</span><small>'+(deviation>=0?'+':'')+deviation.toFixed(1)+'%</small></div>';
  }).join('');
  $('simulationGraphLegend').textContent='세로 기준선은 번호별 이론 평균 '+formatNumber(expected.toFixed(1))+'회입니다. 전체 번호의 기대 출현 수 합계는 '+formatNumber(profile.attempts*6)+'개입니다.';
  $('simulationProfileMeta').textContent=formatNumber(profile.attempts)+'회 실험 · '+new Date(profile.createdAt).toLocaleString('ko-KR')+' · 상위 번호는 이번 표본의 관측 순위입니다.';
  if($('buildSimulationTicketsBtn')) $('buildSimulationTicketsBtn').disabled=false;
  if($('deleteSimulationProfileBtn')) $('deleteSimulationProfileBtn').disabled=profile.id==='latest';
  renderSimulationPoolNumbers(profile);
}

function renderSimulationPage(preferredId=null) {
  renderSimulationProfileSelector(preferredId);
  renderSimulationProfile();
}

async function runSimulationStudio() {
  const button=$('runSimulationStudioBtn');
  const progress=$('simulationStudioProgress');
  const original=button.textContent;
  const attempts=Number($('simulationStudioCount').value);
  button.disabled=true;
  button.textContent='실험 실행 중…';
  progress.textContent='0 / '+formatNumber(attempts)+'회';
  try{
    const result=await simulateFrequencyDistributionAsync(attempts,Math.random,(completed,total)=>{
      progress.textContent=formatNumber(completed)+' / '+formatNumber(total)+'회';
    });
    result.createdAt=new Date().toISOString();
    lastFrequencySimulation=result;
    simulationGeneratedTickets=[];
    $('simulationTicketsOutput').className='empty';
    $('simulationTicketsOutput').textContent='빈출 번호로 조합을 생성하면 여기에 표시됩니다.';
    $('saveSimulationTicketsBtn').disabled=true;
    renderSimulationPage('latest');
    progress.textContent=formatNumber(result.attempts)+'회 실험 완료';
    toast(formatNumber(result.attempts)+'회 시뮬레이션을 완료했습니다.');
    return result;
  }catch(error){
    progress.textContent='실험 실패';
    toast(error?.message||'시뮬레이션을 실행하지 못했습니다.');
    return null;
  }finally{
    button.disabled=false;
    button.textContent=original;
  }
}

function saveCurrentSimulationResult() {
  if(!lastFrequencySimulation) return toast('먼저 시뮬레이션을 실행해 주세요.');
  const profile={
    id:'sim-'+Date.now()+'-'+Math.random().toString(16).slice(2,8),
    attempts:lastFrequencySimulation.attempts,
    counts:lastFrequencySimulation.numberCounts.slice(1),
    createdAt:lastFrequencySimulation.createdAt
  };
  const next=[profile,...simulationProfiles.filter(item=>item.id!==profile.id)].slice(0,MAX_SIMULATION_HISTORY);
  if(!persistSimulationProfiles(next)) return;
  renderSimulationPage(profile.id);
  toast('시뮬레이션 빈도 결과를 이 브라우저에 저장했습니다.');
}

function deleteSelectedSimulationResult() {
  const profile=selectedSimulationProfile();
  if(!profile||profile.id==='latest') return toast('삭제할 저장 결과를 선택해 주세요.');
  if(!confirm('선택한 시뮬레이션 결과를 삭제할까요?')) return;
  const next=simulationProfiles.filter(item=>item.id!==profile.id);
  if(!persistSimulationProfiles(next)) return;
  renderSimulationPage();
  toast('선택한 시뮬레이션 결과를 삭제했습니다.');
}

function buildSimulationTicketSet() {
  const profile=selectedSimulationProfile();
  if(!profile) return toast('먼저 사용할 시뮬레이션 결과를 선택해 주세요.');
  try{
    const poolSize=Number($('simulationPoolSize').value);
    const quantity=Number($('simulationTicketQuantity').value);
    const result=buildSimulationCombinations(profile,poolSize,quantity,Math.random,saved);
    simulationGeneratedTickets=result.tickets;
    $('simulationPoolNumbers').className='simulation-pool-numbers';
    $('simulationPoolNumbers').innerHTML=result.pool.map(number=>{
      const row=rankSimulationNumbers(profile).find(item=>item.number===number);
      return '<span class="simulation-pool-chip">'+ball(number,true)+'<small>'+formatNumber(row?.count||0)+'회</small></span>';
    }).join('');
    $('simulationTicketsOutput').className=result.tickets.length?'result-list':'empty';
    $('simulationTicketsOutput').innerHTML=result.tickets.length?result.tickets.map((numbers,index)=>'<div class="result-row"><div class="result-left"><span class="result-index">'+String(index+1).padStart(2,'0')+'</span><div class="result-balls">'+numbers.map(number=>ball(number,true)).join('')+'</div></div><span class="badge">시뮬레이션 참고</span></div>').join(''):'현재 후보 숫자와 보관함 조합을 기준으로 새로운 조합을 만들지 못했습니다.';
    $('saveSimulationTicketsBtn').disabled=!result.tickets.length;
    if(result.tickets.length<quantity) toast(result.tickets.length+'개 조합만 만들었습니다. 후보 숫자 수를 늘려 보세요.');
    else toast(result.tickets.length+'개 시뮬레이션 참고 조합을 만들었습니다.');
    return result;
  }catch(error){
    toast(error?.message||'조합 생성에 실패했습니다.');
    return null;
  }
}

function saveSimulationTicketSet() {
  if(!simulationGeneratedTickets.length) return toast('먼저 빈출 번호 조합을 생성해 주세요.');
  const known=new Set(saved.map(item=>item.numbers.join('-')));
  const now=new Date();
  const entries=[];
  for(const numbers of simulationGeneratedTickets){
    const key=numbers.join('-');
    if(known.has(key)) continue;
    known.add(key);
    entries.push({
      id:'sim-ticket-'+Date.now()+'-'+Math.random().toString(16).slice(2),
      numbers:sortNums(numbers),
      mode:'stats',
      date:now.toLocaleDateString('ko-KR'),
      favorite:false,
      syncUpdatedAt:now.toISOString()
    });
  }
  if(!entries.length) return toast('생성한 조합은 이미 보관함에 있습니다.');
  if(saved.length+entries.length>MAX_SAVED_ENTRIES) {
    return toast('번호 보관함은 최대 '+formatNumber(MAX_SAVED_ENTRIES)+'개까지 저장할 수 있습니다. 기존 번호를 삭제하지는 않았습니다.');
  }
  if(!persistSaved([...entries,...saved])) return false;
  renderSavedReports();
  toast(entries.length+'개 조합을 내 번호 보관함에 저장했습니다.');
  return true;
}

function exportAnalyticsCsv() {
  const result=calculateAnalytics(drawsForAnalytics());
  if(!result.drawCount)return toast('내보낼 분석 데이터가 없습니다.');
  const lines=['항목,번호,출현횟수,마지막출현회차,미출현간격'];
  for(let n=1;n<=45;n++)lines.push(`번호빈도,${n},${result.counts[n]},${result.lastSeen[n]??''},${result.lastSeen[n]===null?'':result.latestRound-result.lastSeen[n]}`);
  lines.push('동반출현,번호쌍,출현횟수,표본기대값,');
  result.pairs.forEach(pair=>lines.push(`동반출현,${pair.numbers.join('+')},${pair.count},${result.pairExpected.toFixed(3)},`));
  const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`lucky645-analysis-${analyticsPeriod}-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('분석 결과 CSV를 저장했습니다.');
}

function renderHomeRecent() {
  const list = draws.slice(-5).reverse();
  $('homeRecent').innerHTML = list.length ? list.map(draw=>`<div class="history-row" style="padding:8px 0;border-bottom:1px solid var(--line)"><strong style="font-size:11px">${draw.round}회</strong>${draw.numbers.map(n=>ball(n,true)).join('')}<span class="date">${escapeHtml(draw.date || '')}</span></div>`).join('') : '<div class="empty">당첨 데이터가 없습니다.</div>';
}

function renderHistory() {
  const source = historySearchActive ? (filteredHistory ? [filteredHistory] : []) : [...draws].reverse();
  const pageSize = 10;
  const totalPages = Math.max(1,Math.ceil(source.length/pageSize));
  historyPage = Math.min(historyPage,totalPages-1);
  const pageRows = source.slice(historyPage*pageSize,(historyPage+1)*pageSize);
  $('historyPageLabel').textContent = `${historyPage+1} / ${totalPages} 페이지`;
  $('prevHistory').disabled = historyPage===0;
  $('nextHistory').disabled = historyPage>=totalPages-1;
  if (!pageRows.length) {
    $('historyList').innerHTML = '<div class="empty">해당 회차 데이터가 없습니다.</div>';
    return;
  }
  $('historyList').innerHTML = `<div class="table-wrap"><table><thead><tr><th>회차</th><th>추첨일</th><th>당첨번호</th><th>보너스</th><th>1등 당첨자</th><th>판매액</th><th>총 당첨금</th></tr></thead><tbody>${pageRows.map(draw=>{
    const rank1 = draw.ranks?.find(item=>Number(item.rank)===1);
    const winners = rank1?.winners;
    return `<tr><td><strong>${draw.round}회</strong></td><td>${escapeHtml(draw.date || '-')}</td><td><div class="history-row">${draw.numbers.map(n=>ball(n,true)).join('')}</div></td><td>${ball(draw.bonus,true,true)}</td><td>${winners != null && Number.isFinite(Number(winners)) ? `${formatNumber(winners)}명` : '-'}</td><td>${formatDrawMoney(draw.totalSales)}</td><td>${formatDrawMoney(draw.totalPrizePayout)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

async function getDraw(round) {
  if (!Number.isInteger(round) || round < 1 || round > latest.round) return null;
  const existing = draws.find(draw=>draw.round===round);
  if (existing) return existing;
  for (const url of [`${API_PROXY_BATCH}&round=${encodeURIComponent(round)}`, `${API_BATCH}?srchDir=center&srchLtEpsd=${encodeURIComponent(round)}`]) {
    try {
      const raw = await getJson(url,10000);
      const rows = extractDraws(raw);
      draws = mergeDraws(draws, rows);
      persistDraws();
      const found = draws.find(draw=>draw.round===round);
      renderHistory();
      if (found) return found;
    } catch (_) { /* Try the next trusted endpoint. */ }
  }
  return null;
}

function rankName(matchCount, bonusMatch) {
  if (matchCount===6) return '1등';
  if (matchCount===5 && bonusMatch) return '2등';
  if (matchCount===5) return '3등';
  if (matchCount===4) return '4등';
  if (matchCount===3) return '5등';
  return '낙첨';
}

function compareNumbers(numbers, draw) {
  const matched = numbers.filter(number=>draw.numbers.includes(number));
  const bonusMatch = numbers.includes(draw.bonus);
  return { matched, bonusMatch, rank: rankName(matched.length,bonusMatch) };
}

function renderDrawCheck(draw) {
  if (!draw) {
    $('drawToCheck').innerHTML = '<div class="empty">회차 정보를 찾지 못했습니다. 네트워크 연결이나 회차 번호를 확인하세요.</div>';
    return;
  }
  const rank1 = draw.ranks?.find(item=>Number(item.rank)===1);
  const prizeLine = rank1 && (rank1.prize != null || rank1.winners != null) ? `<div class="panel-desc" style="margin-top:10px">1등 ${rank1.winners == null ? '정보 없음' : `${formatNumber(rank1.winners)}명`} · 1인당 ${rank1.prize == null ? '정보 없음' : money(rank1.prize)}</div>` : '';
  $('drawToCheck').innerHTML = `<div class="split"><strong>${draw.round}회 · ${escapeHtml(draw.date || '')}</strong><span class="badge green">당첨 데이터</span></div><div class="latest-numbers">${draw.numbers.map(n=>ball(n)).join('')}</div><div class="latest-meta">보너스 번호 ${ball(draw.bonus,true,true)}</div>${prizeLine}`;
}

function renderSaved() {
  saved = Array.isArray(saved) ? saved.map(normalizeSavedEntry).filter(Boolean) : [];
  $('savedCount').textContent = `${saved.length} 조합 · 즐겨찾기 ${saved.filter(entry=>entry.favorite).length}`;
  document.querySelectorAll('[data-saved-filter]').forEach(button=>button.classList.toggle('active',button.dataset.savedFilter===savedFilter));
  const visible = saved.map((entry,index)=>({entry,index})).filter(item=>savedFilter!=='favorites'||item.entry.favorite);
  if (!visible.length) {
    $('savedList').innerHTML = saved.length
      ? '<div class="empty">즐겨찾기한 조합이 없습니다.<br>별표 버튼으로 마음에 드는 조합을 등록해 주세요.</div>'
      : '<div class="empty">아직 저장된 번호가 없습니다.<br>번호 추천 페이지에서 마음에 드는 조합을 저장해 주세요.</div>';
    return;
  }
  $('savedList').innerHTML = `<div class="result-list">${visible.map(({entry,index})=>{
    const numbers = entry.numbers;
    const compare = compareNumbers(numbers,latest);
    return `<div class="result-row"><div style="min-width:0"><div class="small-label">${escapeHtml(entry.date || '')} · ${modeLabel(entry.mode)}</div><div class="result-balls" style="margin-top:8px">${numbers.map(n=>ball(n,true)).join('')}</div><div class="small-label" style="margin-top:7px">최신 ${latest.round}회 기준: ${compare.rank} · ${compare.matched.length}개 일치${compare.bonusMatch?' · 보너스 일치':''}</div></div><div class="result-actions"><button class="mini-btn favorite-btn ${entry.favorite?'active':''}" data-favorite-saved="${index}" aria-label="즐겨찾기 ${entry.favorite?'해제':'추가'}">${entry.favorite?'★':'☆'}</button><button class="mini-btn" data-copy-saved="${index}">복사</button><button class="mini-btn" data-delete-saved="${index}">삭제</button></div></div>`;
  }).join('')}</div>`;
}

function toggleSavedFavorite(index) {
  if (!saved[index]) return;
  saved[index].favorite = !saved[index].favorite;
  saved[index].syncUpdatedAt = new Date().toISOString();
  persistSaved();
  toast(saved[index].favorite ? '즐겨찾기에 추가했습니다.' : '즐겨찾기에서 해제했습니다.');
}

function exportSavedBackup() {
  if (!saved.length && !savedCheckHistory.length) return toast('백업할 저장 번호 또는 확인 이력이 없습니다.');
  const payload = { app: 'LUCKY 645', version: 2, exportedAt: new Date().toISOString(), saved, savedCheckHistory, autoCheckMeta };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `lucky645-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url), 1000);
  toast('번호 보관함 백업 파일을 저장했습니다.');
}

function writeStorageTransaction(entries) {
  if (!Array.isArray(entries) || entries.some(entry => !Array.isArray(entry) || entry.length !== 2)) {
    throw new Error('저장 작업 형식이 올바르지 않습니다.');
  }
  const previous = entries.map(([key]) => appStorageGet(key));
  const written = [];
  try {
    for (const [key,value] of entries) {
      appStorageSet(key,value);
      written.push(key);
    }
    return true;
  } catch (error) {
    let rollbackFailed = false;
    written.forEach(key => {
      const index = entries.findIndex(entry => entry[0] === key);
      try {
        if (previous[index] === null) appStorageRemove(key);
        else appStorageSet(key, previous[index]);
      } catch (_) {
        rollbackFailed = true;
      }
    });
    const detail = error?.message || '저장 공간 오류';
    throw new Error(rollbackFailed
      ? '백업 복원 중 저장에 실패했고 일부 이전 값 복구도 실패했습니다. 브라우저 저장 공간을 확보한 뒤 데이터를 확인해 주세요. (' + detail + ')'
      : '백업 복원 저장에 실패해 기존 저장값으로 되돌렸습니다. 브라우저 저장 공간을 확인해 주세요. (' + detail + ')');
  }
}

async function importSavedBackup(file) {
  if (!file) return;
  const importOwner=cloudSession?.user?.id||'local';
  const importGeneration=cloudSessionGeneration;
  if (file.size > MAX_BACKUP_FILE_SIZE) return toast(`백업 파일은 ${(MAX_BACKUP_FILE_SIZE / 1024 / 1024).toFixed(0)}MB 이하만 불러올 수 있습니다.`);
  try {
    const fileText=await file.text();
    assertAccountScope(importOwner,importGeneration);
    const raw = JSON.parse(fileText);
    const rows = Array.isArray(raw) ? raw : raw?.saved;
    const importedHistoryRows = Array.isArray(raw?.savedCheckHistory) ? raw.savedCheckHistory : [];
    validateSavedBackupLimits(rows, importedHistoryRows);
    const normalized = rows.map(normalizeSavedEntry).filter(Boolean);
    if (!normalized.length && rows.length) throw new Error('유효한 번호 조합이 없습니다.');

    // Build the complete next state without mutating the live UI state.
    const nextSaved = saved.map(entry => ({...entry,numbers:[...entry.numbers]}));
    const nextHistory = savedCheckHistory.map(item => ({...item,numbers:[...item.numbers],winningNumbers:[...(item.winningNumbers||[])]}));
    const nextMeta = {...autoCheckMeta};
    const localByNumbers = new Map(nextSaved.map(entry=>[entry.numbers.join('-'),entry]));
    const importedIdMap = new Map();
    let added = 0;
    normalized.forEach(entry=>{
      const key = entry.numbers.join('-');
      let local = localByNumbers.get(key);
      if (!local) {
        local = {...entry,id:`import-${Date.now()}-${added}`,syncUpdatedAt:entry.syncUpdatedAt || new Date().toISOString()};
        nextSaved.push(local); localByNumbers.set(key,local); added++;
      } else {
        const wasFavorite = local.favorite;
        mergeCloudSavedRecord(local,entry);
        if (entry.favorite && !wasFavorite) {
          local.favorite = true;
          local.syncUpdatedAt = new Date().toISOString();
        }
      }
      importedIdMap.set(String(entry.id), local.id);
    });

    const importedHistory = importedHistoryRows.map(normalizeSavedCheckRecord).filter(Boolean);
    const historyKeys = new Set(nextHistory.map(row=>`${Number(row.round)}:${String(row.savedId || row.id)}`));
    let historyAdded = 0;
    importedHistory.forEach(row=>{
      const local = localByNumbers.get(row.numbers.join('-'));
      if (local) row.savedId = local.id;
      else if (importedIdMap.has(row.savedId)) row.savedId = importedIdMap.get(row.savedId);
      const key=`${Number(row.round)}:${String(row.savedId || row.id)}`;
      if(!historyKeys.has(key)){
        row.id = key;
        nextHistory.push(row); historyKeys.add(key); historyAdded++;
      }
    });

    if (raw?.autoCheckMeta && typeof raw.autoCheckMeta === 'object') {
      const importedRound = Number(raw.autoCheckMeta.lastRound);
      const newestKnownRound = Number(draws.at(-1)?.round || latest?.round || 0);
      if (Number.isSafeInteger(importedRound) && importedRound >= 0 && newestKnownRound > 0) {
        nextMeta.lastRound = Math.max(nextMeta.lastRound || 0, Math.min(importedRound,newestKnownRound));
      }
      const importedCheckedAt = normalizeSyncTimestamp(raw.autoCheckMeta.lastCheckedAt);
      if (importedCheckedAt && (!nextMeta.lastCheckedAt || importedCheckedAt > nextMeta.lastCheckedAt)) {
        nextMeta.lastCheckedAt = importedCheckedAt;
      }
      nextMeta.lastStatus = '백업에서 복원 · 회차 기준 검증 완료';
    }

    const boundedNextHistory = nextHistory.slice(-MAX_SAVED_BACKUP_CHECK_HISTORY);
    assertSavedCollectionCapacity(nextSaved.length,boundedNextHistory.length);
    assertAccountScope(importOwner,importGeneration);
    writeStorageTransaction([
      [SAVED_KEY,JSON.stringify(nextSaved)],
      [SAVED_CHECKS_KEY,JSON.stringify(boundedNextHistory)],
      [AUTO_CHECK_KEY,JSON.stringify(nextMeta)]
    ]);
    saved = nextSaved;
    savedCheckHistory = boundedNextHistory;
    autoCheckMeta = nextMeta;
    if (!cloudApplying) scheduleCloudSync();
    renderSaved();
    updateTopStats();
    renderSavedReports();
    if (savedBacktestResult) runSavedBacktest();
    toast(`${added}개 조합과 ${historyAdded}개 확인 이력을 가져왔습니다.`);
  } catch (error) { toast(`백업 파일을 읽지 못했습니다: ${error.message}`); }
}


function modeLabel(mode) {
  return ({random:'완전 무작위',balanced:'균형 조합',stats:'통계 참고',hybrid:'통계 + 무작위 혼합',custom:'직접 설정',coverage:'번호 커버리지 분산'})[mode] || '번호 추천';
}

function makeGrid(containerId, selected, onToggle, disabled = []) {
  const host = $(containerId);
  host.innerHTML = Array.from({length:45},(_,index)=>index+1).map(number=>{
    const isSelected = selected.includes(number);
    const isDisabled = disabled.includes(number);
    return `<button class="pick ${isSelected?'selected':''} ${isDisabled?'disabled':''}" data-number="${number}" ${isDisabled?'disabled':''}>${number}</button>`;
  }).join('');
  host.querySelectorAll('[data-number]').forEach(button=>button.addEventListener('click',()=>onToggle(Number(button.dataset.number))));
}

function renderCustomGrids() {
  makeGrid('includeGrid',includeNums,number=>{
    if (includeNums.includes(number)) includeNums=includeNums.filter(n=>n!==number);
    else if (includeNums.length<5) includeNums.push(number);
    else toast('포함 번호는 최대 5개까지 선택할 수 있습니다.');
    renderCustomGrids();
  },excludeNums);
  makeGrid('excludeGrid',excludeNums,number=>{
    if (excludeNums.includes(number)) excludeNums=excludeNums.filter(n=>n!==number);
    else excludeNums.push(number);
    renderCustomGrids();
  },includeNums);
  $('includeCount').textContent = `${includeNums.length} / 5`;
  $('excludeCount').textContent = `${excludeNums.length}개 선택`;
}

function renderManualGrid() {
  makeGrid('manualGrid',manualNums,number=>{
    if (manualNums.includes(number)) manualNums=manualNums.filter(n=>n!==number);
    else if (manualNums.length<6) manualNums.push(number);
    else toast('번호는 6개까지만 선택할 수 있습니다.');
    $('manualCount').textContent = `${manualNums.length} / 6`;
    renderManualGrid();
  });
  $('manualCount').textContent = `${manualNums.length} / 6`;
}

function randomUnit() {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] / 4294967296;
  }
  return Math.random();
}

function randomInt(max) {
  if (!Number.isInteger(max) || max <= 0) return 0;
  if (globalThis.crypto?.getRandomValues) {
    const limit = Math.floor(4294967296 / max) * max;
    const value = new Uint32Array(1);
    let sample;
    do { globalThis.crypto.getRandomValues(value); sample = value[0]; } while (sample >= limit);
    return sample % max;
  }
  return Math.floor(Math.random() * max);
}

function randomPick(pool,count) {
  const items = [...pool];
  for (let i=items.length-1;i>0;i--) {
    const j=randomInt(i+1); [items[i],items[j]]=[items[j],items[i]];
  }
  return sortNums(items.slice(0,count));
}

function weightedPick(pool,weights,count) {
  const remaining=[...pool];
  const result=[];
  while (result.length<count && remaining.length) {
    const total=remaining.reduce((sum,n)=>sum+Math.max(.05,weights[n]||1),0);
    let target=randomUnit()*total;
    let chosen=remaining[remaining.length-1];
    for (const number of remaining) {
      target-=Math.max(.05,weights[number]||1);
      if (target<=0) { chosen=number; break; }
    }
    result.push(chosen);
    remaining.splice(remaining.indexOf(chosen),1);
  }
  return sortNums(result);
}

function isBalanced(numbers,level) {
  const odd=numbers.filter(n=>n%2).length;
  const total=numbers.reduce((a,b)=>a+b,0);
  const buckets=[0,0,0,0,0];
  numbers.forEach(n=>buckets[Math.min(4,Math.floor((n-1)/10))]++);
  // 3연속 번호는 제한하고, 2개 연속 번호는 허용합니다.
  const tripleConsecutive=numbers.some((n,i)=>i>=2 && n===numbers[i-1]+1 && numbers[i-1]===numbers[i-2]+1);
  if (level==='strict') return odd>=2 && odd<=4 && total>=105 && total<=180 && Math.max(...buckets)<=3 && !tripleConsecutive;
  if (level==='soft') return odd>=1 && odd<=5 && total>=75 && total<=195 && !tripleConsecutive;
  return odd>=2 && odd<=4 && total>=90 && total<=190 && Math.max(...buckets)<=4 && !tripleConsecutive;
}

function createCombination(mode,level,providedStatsWeights=null) {
  const excluded=mode==='custom'?excludeNums:[];
  const included=mode==='custom'?includeNums:[];
  if (included.length>5 || new Set(included).size!==included.length || included.some(n=>excluded.includes(n))) return null;
  const pool=Array.from({length:45},(_,i)=>i+1).filter(n=>!excluded.includes(n)&&!included.includes(n));
  if (pool.length+included.length<6) return null;
  const needs=6-included.length;
  const usesHistory = mode==='stats' || mode==='hybrid';
  const statsSample = usesHistory ? drawsForStatsWeighting() : [];
  const statsWeights = usesHistory ? (providedStatsWeights || frequencyWeights(statsSample).weights) : null;
  const applyBalance = mode==='balanced' || (mode==='custom' && level!=='soft');

  for (let attempt=0;attempt<10000;attempt++) {
    const useWeighted = mode==='stats' || (mode==='hybrid' && randomUnit()<0.5);
    const picked=useWeighted && statsWeights ? weightedPick(pool,statsWeights,needs) : randomPick(pool,needs);
    const combo=sortNums([...included,...picked]);
    if (combo.length!==6) continue;
    if (applyBalance && !isBalanced(combo,level)) continue;
    return combo;
  }
  // 조건을 만족하지 못하면 불균형한 조합을 대신 반환하지 않습니다.
  return null;
}

function createCoveragePortfolio(quantity, existing = [], rng = randomUnit) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return [];
  const exposure = Array(46).fill(0);
  const seen = new Set();
  for (const entry of Array.isArray(existing) ? existing : []) {
    const numbers = Array.isArray(entry) ? entry : (Array.isArray(entry?.numbers) ? entry.numbers : []);
    if (numbers.length !== 6 || new Set(numbers).size !== 6 ||
        numbers.some(number => !Number.isInteger(number) || number < 1 || number > 45)) continue;
    const sorted = sortNums(numbers);
    seen.add(sorted.join('-'));
    sorted.forEach(number => exposure[number]++);
  }
  const portfolio = [];
  let attempts = 0;
  while (portfolio.length < quantity && attempts < quantity * 500) {
    attempts++;
    const available = Array.from({length:45},(_,index)=>index+1);
    const combo = [];
    while (combo.length < 6) {
      let lowestExposure = Infinity;
      const leastUsedIndexes = [];
      for (let index=0; index<available.length; index++) {
        const currentExposure = exposure[available[index]];
        if (currentExposure < lowestExposure) {
          lowestExposure = currentExposure;
          leastUsedIndexes.length = 0;
          leastUsedIndexes.push(index);
        } else if (currentExposure === lowestExposure) {
          leastUsedIndexes.push(index);
        }
      }
      const sample = Number(rng());
      const safeSample = Number.isFinite(sample) ? Math.max(0,Math.min(0.999999999999,sample)) : 0;
      const chosenIndex = leastUsedIndexes[Math.floor(safeSample * leastUsedIndexes.length)];
      const chosen = available[chosenIndex];
      combo.push(chosen);
      available.splice(chosenIndex,1);
    }
    const sorted = sortNums(combo);
    const key = sorted.join('-');
    if (seen.has(key)) continue;
    seen.add(key);
    portfolio.push(sorted);
    sorted.forEach(number => exposure[number]++);
  }
  return portfolio;
}

function createRandomPortfolio(quantity, rng = randomUnit) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return [];
  const portfolio = [];
  const seen = new Set();
  let attempts = 0;
  while (portfolio.length < quantity && attempts < quantity * 500) {
    attempts++;
    const pool = Array.from({length:45},(_,index)=>index+1);
    for (let index=0; index<6; index++) {
      const sample = Number(rng());
      const safeSample = Number.isFinite(sample) ? Math.max(0,Math.min(0.999999999999,sample)) : 0;
      const swapIndex = index + Math.floor(safeSample * (45-index));
      [pool[index],pool[swapIndex]] = [pool[swapIndex],pool[index]];
    }
    const combo = sortNums(pool.slice(0,6));
    const key = combo.join('-');
    if (!seen.has(key)) {
      seen.add(key);
      portfolio.push(combo);
    }
  }
  return portfolio;
}

function evaluateTicketPortfolio(portfolio, drawNumbers) {
  const winningNumbers = drawNumbers && typeof drawNumbers.has === 'function'
    ? drawNumbers
    : new Set(drawNumbers || []);
  const covered = new Uint8Array(46);
  const exposure = Array(46).fill(0);
  let coverage = 0;
  let any3 = false, any4 = false, any5 = false, any6 = false;
  for (const ticket of portfolio) {
    let matches = 0;
    for (const number of ticket) {
      if (!covered[number]) {
        covered[number] = 1;
        coverage++;
      }
      exposure[number]++;
      if (winningNumbers.has(number)) matches++;
    }
    if (matches >= 3) any3 = true;
    if (matches >= 4) any4 = true;
    if (matches >= 5) any5 = true;
    if (matches === 6) any6 = true;
  }
  return {coverage,maxExposure:Math.max(...exposure.slice(1)),any3,any4,any5,any6};
}

function createPortfolioSimulationState(count) {
  const attempts = Number(count);
  if (![1000,5000,10000].includes(attempts)) {
    throw new Error('실험 횟수는 1,000 / 5,000 / 10,000 중 선택해 주세요.');
  }
  return {
    attempts,
    completed:0,
    ticketCount:10,
    jackpotProbability:10/8145060,
    random:{coverage:0,maxExposure:0,any3:0,any4:0,any5:0,any6:0},
    coverage:{coverage:0,maxExposure:0,any3:0,any4:0,any5:0,any6:0}
  };
}

function simulatePortfolioBatch(state, batchSize, rng) {
  const end = Math.min(state.attempts, state.completed + batchSize);
  while (state.completed < end) {
    const draw = createRandomPortfolio(1,rng)[0];
    const winningNumbers = new Set(draw);
    const randomPortfolio = createRandomPortfolio(state.ticketCount,rng);
    const coveragePortfolio = createCoveragePortfolio(state.ticketCount,[],rng);

    for (const [name,portfolio] of [['random',randomPortfolio],['coverage',coveragePortfolio]]) {
      const score = evaluateTicketPortfolio(portfolio,winningNumbers);
      state[name].coverage += score.coverage;
      state[name].maxExposure += score.maxExposure;
      state[name].any3 += score.any3 ? 1 : 0;
      state[name].any4 += score.any4 ? 1 : 0;
      state[name].any5 += score.any5 ? 1 : 0;
      state[name].any6 += score.any6 ? 1 : 0;
    }
    state.completed++;
  }
  return state;
}

function finalizePortfolioSimulation(state) {
  const result = {
    attempts:state.attempts,
    ticketCount:state.ticketCount,
    jackpotProbability:state.jackpotProbability,
    random:{...state.random},
    coverage:{...state.coverage}
  };
  for (const name of ['random','coverage']) {
    for (const key of ['coverage','maxExposure','any3','any4','any5','any6']) {
      result[name][key] /= state.attempts;
    }
  }
  return result;
}

function simulatePortfolioStrategies(count, rng = Math.random) {
  const state = createPortfolioSimulationState(count);
  simulatePortfolioBatch(state,state.attempts,rng);
  return finalizePortfolioSimulation(state);
}

async function simulatePortfolioStrategiesAsync(count, rng = Math.random, onProgress = () => {}) {
  const state = createPortfolioSimulationState(count);
  const batchSize = 250;
  while (state.completed < state.attempts) {
    simulatePortfolioBatch(state,batchSize,rng);
    onProgress(state.completed,state.attempts);
    if (state.completed < state.attempts) {
      await new Promise(resolve => window.setTimeout(resolve,0));
    }
  }
  return finalizePortfolioSimulation(state);
}

const TOTAL_LOTTO_COMBINATIONS = 8145060;

function validCombinationKey(numbers) {
  if (!Array.isArray(numbers) || numbers.length !== 6 ||
      numbers.some(number => !Number.isInteger(number) || number < 1 || number > 45) ||
      new Set(numbers).size !== 6) return null;
  return [...numbers].sort((a,b)=>a-b).join('-');
}

function summarizeGeneratedTickets(tickets, savedEntries = []) {
  const keys = new Set();
  const numberSet = new Set();
  let invalidCount = 0;
  let duplicateCount = 0;
  let alreadySavedCount = 0;
  const savedKeys = new Set();
  for (const entry of Array.isArray(savedEntries) ? savedEntries : []) {
    const key = validCombinationKey(Array.isArray(entry) ? entry : entry?.numbers);
    if (key) savedKeys.add(key);
  }
  for (const ticket of Array.isArray(tickets) ? tickets : []) {
    const key = validCombinationKey(ticket);
    if (!key) {
      invalidCount++;
      continue;
    }
    if (keys.has(key)) {
      duplicateCount++;
      continue;
    }
    keys.add(key);
    ticket.forEach(number=>numberSet.add(number));
    if (savedKeys.has(key)) alreadySavedCount++;
  }
  const uniqueCount=keys.size;
  return {
    totalCount:Array.isArray(tickets)?tickets.length:0,
    validCount:uniqueCount,
    uniqueCount,
    duplicateCount,
    invalidCount,
    alreadySavedCount,
    newCount:uniqueCount-alreadySavedCount,
    uniqueNumbers:numberSet.size,
    jackpotProbability:uniqueCount/TOTAL_LOTTO_COMBINATIONS,
    jackpotPercent:uniqueCount/TOTAL_LOTTO_COMBINATIONS*100,
    oneIn:uniqueCount?Math.round(TOTAL_LOTTO_COMBINATIONS/uniqueCount):null
  };
}

function buildBulkSavedEntries(tickets, existingEntries, mode, now = new Date(), idFactory = Math.random) {
  const existingKeys=new Set();
  for(const entry of Array.isArray(existingEntries)?existingEntries:[]){
    const key=validCombinationKey(Array.isArray(entry)?entry:entry?.numbers);
    if(key) existingKeys.add(key);
  }
  const seen=new Set(existingKeys);
  const entries=[];
  let duplicateCount=0;
  let invalidCount=0;
  const createdAt=now.toISOString();
  const date=now.toLocaleDateString('ko-KR');
  for(const ticket of Array.isArray(tickets)?tickets:[]){
    const key=validCombinationKey(ticket);
    if(!key){invalidCount++;continue;}
    if(seen.has(key)){duplicateCount++;continue;}
    seen.add(key);
    entries.push({
      id:'bulk-'+now.getTime()+'-'+entries.length+'-'+idFactory().toString(16).slice(2),
      numbers:key.split('-').map(Number),
      mode:['random','balanced','stats','hybrid','custom','coverage'].includes(mode)?mode:'random',
      date,
      favorite:false,
      syncUpdatedAt:createdAt
    });
  }
  return {entries,added:entries.length,duplicateCount,invalidCount};
}

function ensureSavedAutoCheckBaseline() {
  if (!autoCheckMeta.lastRound && dataReady && latestVerification === 'official' && Number(latest?.round)>0) {
    autoCheckMeta.lastRound = Number(latest.round);
    autoCheckMeta.lastCheckedAt = new Date().toISOString();
    autoCheckMeta.lastStatus = '첫 저장 시점 기준 회차 설정';
    persistAutoCheckMeta();
  }
}

function renderGenerated() {
  const summary=summarizeGeneratedTickets(generated,saved);
  $('resultCount').textContent = String(summary.validCount)+' 조합';
  const saveAllButton=$('saveAllResultsBtn');
  if(saveAllButton){
    saveAllButton.textContent='전체 저장 ('+summary.newCount+')';
    saveAllButton.disabled=summary.newCount===0;
    saveAllButton.title=summary.newCount
      ? '새로 저장할 '+summary.newCount+'개 조합을 한 번에 보관합니다.'
      : '새로 저장할 조합이 없습니다.';
  }
  const summaryPanel=$('generatedSummary');
  if(!generated.length){
    $('results').className='empty';
    $('results').innerHTML='아직 생성된 조합이 없습니다.<br>왼쪽에서 방식을 선택하고 생성 버튼을 눌러주세요.';
    if(summaryPanel){
      summaryPanel.className='generator-summary empty';
      summaryPanel.textContent='조합을 생성하면 중복 여부, 번호 사용 범위와 이번 조합의 1등 확률을 계산합니다.';
    }
    return;
  }
  if(summaryPanel){
    summaryPanel.className='generator-summary';
    const probability=summary.uniqueCount
      ? String(summary.uniqueCount.toLocaleString('ko-KR'))+' / '+TOTAL_LOTTO_COMBINATIONS.toLocaleString('ko-KR')+' (약 1 / '+summary.oneIn.toLocaleString('ko-KR')+')'
      : '계산할 수 있는 유효 조합이 없습니다.';
    summaryPanel.innerHTML=
      '<div class="generator-metric"><span>서로 다른 조합</span><strong>'+summary.uniqueCount+'개</strong></div>'+
      '<div class="generator-metric"><span>번호 사용 범위</span><strong>'+summary.uniqueNumbers+' / 45개</strong></div>'+
      '<div class="generator-metric"><span>중복 조합</span><strong>'+summary.duplicateCount+'개</strong></div>'+
      '<div class="generator-metric generator-odds"><span>이번 조합 묶음의 1등 확률</span><strong>'+probability+'</strong><small>'+summary.jackpotPercent.toFixed(8)+'% · 한 회차 기준</small></div>'+
      '<div class="generator-summary-note">이미 보관함에 있는 조합 '+summary.alreadySavedCount+'개 · 새로 저장할 조합 '+summary.newCount+'개. 번호별 예측 방식이 이 확률을 높여주지는 않습니다.</div>';
  }
  const savedKeys=new Set(saved.map(entry=>validCombinationKey(entry?.numbers)).filter(Boolean));
  $('results').className='result-list';
  $('results').innerHTML=generated.map((numbers,index)=>{
    const key=validCombinationKey(numbers);
    const isSaved=Boolean(key&&savedKeys.has(key));
    return '<div class="result-row"><div class="result-left"><span class="result-index">'+String(index+1).padStart(2,'0')+'</span><div class="result-balls">'+numbers.map(n=>ball(n,true)).join('')+'</div></div><div class="result-actions"><button class="mini-btn" data-save-result="'+index+'" '+(isSaved?'disabled':'')+'>'+(isSaved?'저장됨':'저장')+'</button><button class="mini-btn" data-copy-result="'+index+'">복사</button></div></div>';
  }).join('');
}
function generateNumbers() {
  const quantity=Number($('quantity').value||3);
  const level=$('balanceLevel').value;
  if (![1,3,5,10].includes(quantity)) return toast('생성할 조합 수를 확인해 주세요.');
  if (activeMode==='custom' && includeNums.length>5) return toast('포함 번호는 최대 5개까지 선택할 수 있습니다.');
  if (activeMode==='custom' && includeNums.some(n=>excludeNums.includes(n))) return toast('포함과 제외 번호가 겹칩니다.');
  if (activeMode==='custom' && 45-excludeNums.length<6) return toast('제외 번호가 너무 많습니다.');
  if (['stats','hybrid'].includes(activeMode) && drawsForStatsWeighting().length===0) return toast('통계 자료를 아직 불러오지 못했습니다. 데이터 연결 후 다시 시도해 주세요.');

  const next=[];
  if (activeMode==='coverage') {
    next.push(...createCoveragePortfolio(quantity,[...saved,...generated.map(numbers=>({numbers}))]));
  } else {
    const seen=new Set([...saved,...generated].map(entry=>Array.isArray(entry?.numbers)?sortNums(entry.numbers).join('-'):sortNums(entry).join('-')));
    const statsWeights = ['stats','hybrid'].includes(activeMode) ? frequencyWeights(drawsForStatsWeighting()).weights : null;
    const maxAttempts=quantity*30;
    for (let attempt=0; attempt<maxAttempts && next.length<quantity; attempt++) {
      const combo=createCombination(activeMode,level,statsWeights);
      if (!combo) break;
      const key=combo.join('-');
      if (!seen.has(key)) { seen.add(key); next.push(combo); }
    }
  }
  if (!next.length) {
    toast('현재 선택한 조건을 만족하는 조합을 만들지 못했습니다. 균형 강도를 낮추거나 포함·제외 번호를 조정해 주세요.');
    return;
  }
  generated=next;
  generatedMode=activeMode;
  renderGenerated();
  if (generated.length<quantity) toast(`${generated.length}개 조합을 만들었습니다. 조건을 만족하는 서로 다른 조합이 부족합니다.`);
  else if (activeMode==='stats') { const count=drawsForStatsWeighting().length; toast(`${count}회 데이터의 출현 빈도를 약하게 반영했습니다. 당첨 확률은 동일합니다.`); }
  else if (activeMode==='hybrid') { const count=drawsForStatsWeighting().length; toast(`${count}회 통계 참고 조합과 균등 무작위 조합을 50:50으로 혼합했습니다.`); }
  else if (activeMode==='coverage') toast('기존 저장 조합까지 고려해 번호 사용량을 분산했습니다. 1등 확률은 조합 수가 같으면 동일합니다.');
}

function saveCombination(numbers,mode=activeMode) {
  const key=validCombinationKey(numbers);
  if(!key) return toast('저장할 번호 조합이 올바르지 않습니다.');
  if(saved.some(entry=>validCombinationKey(entry.numbers)===key)) {
    toast('이미 보관함에 저장된 조합입니다.');
    renderGenerated();
    return false;
  }
  if(saved.length>=MAX_SAVED_ENTRIES) {
    toast('번호 보관함은 최대 '+formatNumber(MAX_SAVED_ENTRIES)+'개까지 저장할 수 있습니다. 기존 번호를 삭제한 뒤 다시 시도해 주세요.');
    return false;
  }
  const now=new Date();
  const entry={
    id:String(now.getTime())+'-'+Math.random().toString(16).slice(2),
    numbers:key.split('-').map(Number),
    mode,
    date:now.toLocaleDateString('ko-KR'),
    favorite:false,
    syncUpdatedAt:now.toISOString()
  };
  if(!persistSaved([entry,...saved])) return false;
  ensureSavedAutoCheckBaseline();
  renderSavedReports();
  renderGenerated();
  toast('번호를 보관함에 저장했습니다.');
  return true;
}

function saveAllGenerated() {
  if(!generated.length) return toast('먼저 번호 조합을 생성해 주세요.');
  const prepared=buildBulkSavedEntries(generated,saved,generatedMode);
  if(!prepared.added){
    renderGenerated();
    if(prepared.duplicateCount||prepared.invalidCount) {
      toast('새로 저장할 조합이 없습니다. 중복 '+prepared.duplicateCount+'개, 잘못된 조합 '+prepared.invalidCount+'개');
    } else toast('새로 저장할 조합이 없습니다.');
    return false;
  }
  if(saved.length+prepared.added>MAX_SAVED_ENTRIES) {
    toast('번호 보관함은 최대 '+formatNumber(MAX_SAVED_ENTRIES)+'개까지 저장할 수 있습니다. 일부 조합만 저장하지는 않았습니다.');
    return false;
  }
  // 한 번의 localStorage 쓰기로 전체 저장합니다. 실패하면 saved 메모리 상태도 바꾸지 않습니다.
  if(!persistSaved([...prepared.entries,...saved])) return false;
  ensureSavedAutoCheckBaseline();
  renderSavedReports();
  renderGenerated();
  toast('전체 저장 완료: '+prepared.added+'개 저장, 중복 '+prepared.duplicateCount+'개 건너뜀');
  return true;
}
async function copyNumbers(numbers) {
  const text=numbers.join(', ');
  try { await navigator.clipboard.writeText(text); toast('번호를 클립보드에 복사했습니다.'); }
  catch (_) { window.prompt('아래 번호를 복사하세요.',text); }
}

async function checkRound() {
  const round=Number($('checkRound').value);
  if (!Number.isInteger(round)||round<1) return toast('올바른 회차 번호를 입력해 주세요.');
  $('drawToCheck').innerHTML='<div class="empty">회차 정보를 불러오는 중입니다…</div>';
  const draw=await getDraw(round);
  historyRound=draw;
  renderDrawCheck(draw);
}

async function checkSavedNumbers() {
  if (!saved.length) {
    $('checkResults').innerHTML='<div class="empty">보관함에 저장된 조합이 없습니다.</div>';
    return;
  }
  const input = $('checkRound').value.trim();
  const round = input ? Number(input) : latest.round;
  if (!Number.isInteger(round) || round < 1 || round > latest.round) {
    $('checkResults').innerHTML='<div class="empty">확인 가능한 회차 번호를 입력하고 먼저 불러와 주세요.</div>';
    return;
  }
  $('checkResults').innerHTML='<div class="empty">선택한 회차의 당첨번호를 확인하는 중입니다…</div>';
  const draw = await getDraw(round);
  if (!draw) {
    $('checkResults').innerHTML='<div class="empty">해당 회차 데이터를 불러오지 못했습니다. 회차 번호와 연결 상태를 확인해 주세요.</div>';
    return;
  }
  historyRound = draw;
  recordSavedCheck(draw, '수동 확인');
  $('checkResults').innerHTML=`<div class="small-label" style="margin-bottom:10px">${draw.round}회 당첨번호 기준</div><div class="result-list">${saved.map((entry,index)=>{
    const result=compareNumbers(entry.numbers,draw);
    return `<div class="result-row"><div><div class="small-label">보관함 ${index+1}</div><div class="result-balls" style="margin-top:7px">${entry.numbers.map(n=>ball(n,true)).join('')}</div><div class="small-label" style="margin-top:6px">일치 ${result.matched.length}개 ${result.bonusMatch?'· 보너스 일치':''}</div></div><span class="badge ${result.rank==='낙첨'?'':'green'}">${result.rank}</span></div>`;
  }).join('')}</div>`;
}

async function checkManualNumbers() {
  if (manualNums.length!==6) return toast('당첨 확인을 위해 번호 6개를 선택해 주세요.');
  const round=$('checkRound').value.trim() ? Number($('checkRound').value) : latest.round;
  if (!Number.isInteger(round) || round < 1 || round > latest.round) { $('manualResult').innerHTML='<div class="rank-result"><h3>확인 가능한 회차 번호를 입력해 주세요.</h3></div>'; return; }
  const draw=await getDraw(round);
  if (!draw) { $('manualResult').innerHTML='<div class="rank-result"><h3>회차 정보를 불러오지 못했습니다.</h3></div>'; return; }
  const result=compareNumbers(manualNums,draw);
  $('manualResult').innerHTML=`<div class="rank-result"><h3>${draw.round}회 결과: ${result.rank}</h3><p>일치 번호 ${result.matched.length}개${result.bonusMatch?' · 보너스 번호 일치':''}<br>내 번호: ${sortNums(manualNums).join(', ')}<br>당첨 번호: ${draw.numbers.join(', ')} + 보너스 ${draw.bonus}</p></div>`;
}


function loadCloudSyncMeta() {
  try {
    const value=JSON.parse(appStorageGet(CLOUD_SYNC_META_KEY)||'{}');
    return {userId:String(value.userId||''),lastSuccessAt:normalizeSyncTimestamp(value.lastSuccessAt),
      uploaded:Number.isSafeInteger(value.uploaded)&&value.uploaded>=0?value.uploaded:0,
      downloaded:Number.isSafeInteger(value.downloaded)&&value.downloaded>=0?value.downloaded:0,
      status:['success','error','running'].includes(value.status)?value.status:'idle',
      error:typeof value.error==='string'?value.error.slice(0,500):''};
  } catch (_) { return {userId:'',lastSuccessAt:'',uploaded:0,downloaded:0,status:'idle',error:''}; }
}
function persistCloudSyncMeta() {
  try { appStorageSet(CLOUD_SYNC_META_KEY,JSON.stringify(cloudSyncMeta)); } catch (_) {}
  renderCloudSyncStatus();
}
function renderCloudSyncStatus() {
  const target=$('cloudSyncDetails');
  if(!target)return;
  const sameUser=Boolean(cloudSession?.user?.id&&cloudSyncMeta.userId===cloudSession.user.id);
  const meta=sameUser?cloudSyncMeta:{status:'idle',lastSuccessAt:'',uploaded:0,downloaded:0,error:''};
  const state=meta.status==='success'?'최근 동기화 성공':meta.status==='running'?'동기화 진행 중':meta.status==='error'?'동기화 실패':'동기화 기록 없음';
  const backupTime=researchBackups[0]?.createdAt||'';
  target.innerHTML='<div class="cloud-sync-metrics"><div><span>상태</span><strong>'+state+'</strong></div><div><span>마지막 성공</span><strong>'+escapeHtml(formatSyncTime(meta.lastSuccessAt)||'기록 없음')+'</strong></div><div><span>업로드</span><strong>'+formatNumber(meta.uploaded)+'건</strong></div><div><span>서버에서 읽음</span><strong>'+formatNumber(meta.downloaded)+'건</strong></div><div><span>자동 백업</span><strong>'+researchBackups.length+'/'+MAX_RESEARCH_BACKUPS+'개</strong></div><div><span>최근 백업</span><strong>'+escapeHtml(formatSyncTime(backupTime)||'아직 없음')+'</strong></div></div>'+
    (meta.error?'<div class="cloud-sync-error">오류: '+escapeHtml(meta.error)+'</div>':'')+
    '<div class="cloud-sync-actions"><button class="secondary" id="createResearchBackupBtn">지금 백업</button><button class="secondary" id="downloadResearchBackupBtn" '+(researchBackups.length?'':'disabled')+'>최근 백업 내보내기</button><button class="secondary" id="restoreResearchBackupBtn" '+(researchBackups.length?'':'disabled')+'>최근 백업 복원</button></div>'+
    '<div class="analytics-mini">업로드/읽음 수는 마지막 성공 동기화에서 처리한 레코드 수입니다. 자동 백업은 하루에 최대 1회, 최근 5개를 이 브라우저에 보관합니다.</div>';
  $('createResearchBackupBtn')?.addEventListener('click',()=>{if(createResearchBackup(true))toast('연구 이력 복원 지점을 만들었습니다.');});
  $('downloadResearchBackupBtn')?.addEventListener('click',downloadLatestResearchBackup);
  $('restoreResearchBackupBtn')?.addEventListener('click',restoreLatestResearchBackup);
}
function loadResearchBackups() {
  try {
    const rows=JSON.parse(appStorageGet(RESEARCH_BACKUPS_KEY)||'[]');
    const owner=cloudSession?.user?.id||'local';
    return Array.isArray(rows)?rows.filter(item=>item&&String(item.userId||'local')===owner&&typeof item.createdAt==='string'&&Array.isArray(item.runs)).slice(0,MAX_RESEARCH_BACKUPS):[];
  } catch (_) { return []; }
}
function persistResearchBackups() {
  try {
    const owner=cloudSession?.user?.id||'local';
    let stored=[];
    try { const parsed=JSON.parse(appStorageGet(RESEARCH_BACKUPS_KEY)||'[]'); if(Array.isArray(parsed))stored=parsed; } catch (_) {}
    const otherAccounts=stored.filter(item=>item&&String(item.userId||'local')!==owner);
    const currentAccount=researchBackups.map(item=>({...item,userId:owner}));
    const combined=[...currentAccount,...otherAccounts],counts=new Map(),kept=[];
    for(const item of combined){
      const account=String(item.userId||'local'),count=counts.get(account)||0;
      if(count>=MAX_RESEARCH_BACKUPS)continue;
      counts.set(account,count+1);kept.push(item);
    }
    appStorageSet(RESEARCH_BACKUPS_KEY,JSON.stringify(kept));
    return true;
  } catch (_) { return false; }
}
function createResearchBackup(force=false) {
  if(!researchHistory.length)return false;
  const now=Date.now(), latestTime=Date.parse(researchBackups[0]?.createdAt||'')||0;
  if(!force&&latestTime&&now-latestTime<86400000)return false;
  const snapshot={userId:cloudSession?.user?.id||'local',createdAt:new Date(now).toISOString(),runs:JSON.parse(JSON.stringify(researchHistory)),
    report:researchReport?JSON.parse(JSON.stringify(researchReport)):null,
    candidates:JSON.parse(JSON.stringify(researchCandidates))};
  const previous=researchBackups;
  researchBackups=[snapshot,...researchBackups].slice(0,MAX_RESEARCH_BACKUPS);
  if(!persistResearchBackups()){researchBackups=previous;toast('백업 저장 공간이 부족합니다. 기존 백업을 유지했습니다.');return false;}
  renderCloudSyncStatus();
  return true;
}
function downloadLatestResearchBackup() {
  const backup=researchBackups[0]; if(!backup||String(backup.userId||'local')!==(cloudSession?.user?.id||'local'))return;
  const payload={schema:'lucky645-research-history-v1',exportedAt:new Date().toISOString(),backupCreatedAt:backup.createdAt,runs:backup.runs};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='lucky645-research-backup-'+backup.createdAt.slice(0,10)+'.json';
  document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}
function restoreLatestResearchBackup() {
  const backup=researchBackups[0]; if(!backup||String(backup.userId||'local')!==(cloudSession?.user?.id||'local'))return;
  if(!confirm('최근 자동 백업 '+formatSyncTime(backup.createdAt)+'을 현재 연구 이력과 병합할까요? 기존 이력은 삭제하지 않습니다.'))return;
  const previous={history:researchHistory,report:researchReport,candidates:researchCandidates};
  researchHistory=window.Lucky645ResearchHistory.mergeRuns(backup.runs,researchHistory);
  if(backup.report&&(!researchReport||Date.parse(backup.report.createdAt)>Date.parse(researchReport.createdAt)))researchReport=backup.report;
  researchCandidates=window.Lucky645ResearchHistory.mergeCandidates
    ? window.Lucky645ResearchHistory.mergeCandidates(backup.candidates,researchCandidates)
    : [...researchCandidates,...(backup.candidates||[]).filter(item=>!researchCandidates.some(row=>row.id===item.id))].slice(0,100);
  if(!persistResearchState()){researchHistory=previous.history;researchReport=previous.report;researchCandidates=previous.candidates;return;}
  renderResearchLab();if(cloudSession?.access_token)scheduleCloudSync();
  toast('자동 백업을 현재 연구 이력과 병합했습니다.');
}

function loadCloudSession() {
  try { return JSON.parse(appStorageGet(CLOUD_SESSION_KEY) || 'null'); } catch (_) { return null; }
}
function reloadAccountScopedState() {
  researchRunGeneration++;
  researchRunning=false;
  saved=loadSaved();
  savedCheckHistory=loadSavedCheckHistory();
  autoCheckMeta=loadAutoCheckMeta();
  simulationProfiles=loadSimulationProfiles();
  researchReport=loadResearchReport();
  researchHistory=loadResearchHistory(researchReport);
  researchCandidates=loadResearchCandidates();
  researchCompareRunId=researchHistory[1]?(researchHistory[1].runId||researchHistory[1].createdAt):'';
  syncMeta=loadSyncMeta();
  cloudSyncMeta=loadCloudSyncMeta();
  researchBackups=loadResearchBackups();
  renderSaved();
  renderSavedReports();
  renderSimulationPage();
  renderResearchLab();
  renderCloudSyncStatus();
  updateTopStats();
}

function saveCloudSession(session) {
  const previousUserId=cloudSession?.user?.id||'';
  const nextUserId=session?.user?.id||'';
  if(previousUserId!==nextUserId&&nextUserId)activateAccountStorageScope(nextUserId);
  if(previousUserId!==nextUserId){
    cloudSessionGeneration++;
    clearTimeout(cloudSyncTimer);
    if(cloudSyncPromise)cloudSyncRequested=Boolean(nextUserId);
  }
  cloudSession = session || null;
  try { if (cloudSession) appStorageSet(CLOUD_SESSION_KEY, JSON.stringify(cloudSession)); else appStorageRemove(CLOUD_SESSION_KEY); } catch (_) {}
  if(previousUserId!==nextUserId)reloadAccountScopedState();
  researchBackups=loadResearchBackups();
  renderCloudAuth();
  if(previousUserId!==nextUserId&&nextUserId&&!cloudSyncPromise)scheduleCloudSync();
}
function cloudTombstonesStorageKey() {
  const userId=cloudSession?.user?.id;
  return userId ? CLOUD_TOMBSTONES_KEY+':'+userId : CLOUD_TOMBSTONES_KEY+':local';
}
function loadCloudTombstones() {
  try { const rows=JSON.parse(appStorageGet(cloudTombstonesStorageKey())||'[]'); return Array.isArray(rows)?rows.slice(-50000):[]; } catch (_) { return []; }
}
function persistCloudTombstones(rows) {
  try { appStorageSet(cloudTombstonesStorageKey(), JSON.stringify(rows.slice(-50000))); } catch (_) {}
}
function markCloudDeleted(category, recordKey, metadata = null) {
  const rows=loadCloudTombstones(), key=String(recordKey);
  const numbersKey = category==='saved_combination' && Array.isArray(metadata) &&
    metadata.length===6 && metadata.every(number=>Number.isInteger(Number(number))&&Number(number)>=1&&Number(number)<=45)
      ? sortNums(metadata.map(Number)).join('-')
      : null;
  const existing = rows.find(row=>row.category===category && row.record_key===key);
  if(existing) {
    existing.deleted_at=new Date().toISOString();
    if(numbersKey) existing.numbers_key=numbersKey;
  } else {
    rows.push({category,record_key:key,deleted_at:new Date().toISOString(),...(numbersKey?{numbers_key:numbersKey}:{})});
  }
  persistCloudTombstones(rows);
  scheduleCloudSync();
}
function cloudHeaders(token) {
  const headers={'apikey':SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'};
  if(token) headers.Authorization='Bearer '+token;
  return headers;
}
function shouldRetryCloudRequest(path, options, response, failure) {
  const method=String(options.method||'GET').toUpperCase();
  const headers=options.headers||{};
  const prefer=Object.entries(headers).find(([key])=>key.toLowerCase()==='prefer')?.[1]||'';
  const safeRead=method==='GET'||method==='HEAD';
  // Only retry writes that are explicitly idempotent PostgREST upserts.
  const safeUpsert=method==='POST'&&path.startsWith('/rest/v1/')&&
    /(?:^|[?&])on_conflict=/.test(path)&&/resolution=merge-duplicates/i.test(String(prefer));
  if(!safeRead&&!safeUpsert)return false;
  if(failure) {
    return failure.name!=='AbortError'&&failure.name!=='TimeoutError'&&
      (failure instanceof TypeError||failure.name==='TypeError');
  }
  return [408,503,504,520].includes(Number(response?.status));
}
async function cloudRequest(path, options={}, token=null) {
  const request={...options,headers:{...cloudHeaders(token),...(options.headers||{})}};
  let lastFailure=null;
  for(let attempt=0;attempt<3;attempt++) {
    let response;
    try {
      response=await fetch(SUPABASE_URL+path,request);
      if(!response.ok&&shouldRetryCloudRequest(path,options,response,null)&&attempt<2) {
        await new Promise(resolve=>setTimeout(resolve,300*(2**attempt)));
        continue;
      }
      const body=await response.text();
      let data=null; try{data=body?JSON.parse(body):null;}catch(_){data={message:body};}
      if(!response.ok) {
        const error=new Error(data?.msg||data?.message||data?.error_description||data?.error||('HTTP '+response.status));
        error.status=response.status;
        error.code=data?.code||data?.error_code||null;
        throw error;
      }
      return data;
    } catch(error) {
      lastFailure=error;
      if(error?.status||!shouldRetryCloudRequest(path,options,null,error)||attempt>=2) throw error;
      await new Promise(resolve=>setTimeout(resolve,300*(2**attempt)));
    }
  }
  throw lastFailure||new Error('클라우드 요청에 실패했습니다.');
}
async function cloudAuth(path, body, token=null) {
  return cloudRequest('/auth/v1/'+path,{method:'POST',body:JSON.stringify(body)},token);
}
async function cloudAccessToken() {
  if(!cloudSession?.access_token) return null;
  const expiry=Number(cloudSession.expires_at||0);
  if(expiry && expiry*1000>Date.now()+60000) return cloudSession.access_token;
  if(!cloudSession.refresh_token) {
    saveCloudSession(null);
    return null;
  }

  const attemptedRefreshToken=cloudSession.refresh_token;
  const refreshUserId=cloudSession?.user?.id||'';
  const refreshGeneration=cloudSessionGeneration;
  let refreshed;
  try {
    refreshed=await cloudAuth('token?grant_type=refresh_token',{refresh_token:attemptedRefreshToken});
  } catch(error) {
    const code=String(error?.code||'').toLowerCase();
    const status=Number(error?.status||0);
    const invalidSession=status===400||status===401||
      ['invalid_grant','refresh_token_not_found','refresh_token_already_used','invalid_refresh_token'].includes(code);
    if(invalidSession) {
      // 다른 동기화 요청이나 브라우저 탭이 먼저 토큰을 회전했을 수 있습니다.
      // 실패한 요청의 오래된 토큰이 현재 세션과 다르면 새 세션을 지우지 않습니다.
      let storedSession=null;
      try { storedSession=JSON.parse(appStorageGet(CLOUD_SESSION_KEY)||'null'); } catch (_) {}
      const currentSession=cloudSession?.refresh_token!==attemptedRefreshToken
        ? cloudSession
        : storedSession?.refresh_token!==attemptedRefreshToken ? storedSession : null;
      if(currentSession?.access_token && currentSession?.refresh_token) {
        if(currentSession!==cloudSession) {
          cloudSession=currentSession;
          renderCloudAuth();
        }
        return cloudSession.access_token;
      }
      saveCloudSession(null);
      throw new Error('로그인 세션이 만료되었거나 취소되었습니다. 다시 로그인해 주세요.');
    }
    throw error;
  }

  // A late refresh response must never restore a session after the user switched
  // accounts or signed out while the request was in flight.
  if(cloudSessionGeneration!==refreshGeneration||(cloudSession?.user?.id||'')!==refreshUserId) {
    throw new Error('계정이 변경되어 이전 로그인 세션 갱신을 취소했습니다.');
  }
  // Another tab may already have rotated the refresh token for this same account.
  if(cloudSession?.refresh_token!==attemptedRefreshToken) {
    if(cloudSession?.user?.id===refreshUserId&&cloudSession?.access_token&&cloudSession?.refresh_token) {
      return cloudSession.access_token;
    }
    throw new Error('로그인 세션이 변경되어 다시 동기화해야 합니다.');
  }
  if(refreshed?.user?.id&&refreshed.user.id!==refreshUserId) {
    throw new Error('로그인 계정이 일치하지 않아 세션 갱신을 취소했습니다.');
  }
  saveCloudSession({...refreshed,user:refreshed.user||cloudSession.user,expires_at:Math.floor(Date.now()/1000)+Number(refreshed.expires_in||3600)});
  return cloudSession.access_token;
}
function renderCloudAuth(message='') {
  const signedIn=Boolean(cloudSession?.access_token);
  const form=$('cloudAuthForm'), account=$('cloudAccountPanel'), status=$('cloudStatus');
  if(form) form.style.display=signedIn?'none':'block';
  if(account) account.style.display=signedIn?'block':'none';
  if(status){status.textContent=signedIn?'로그인됨':'로그아웃';status.className='badge '+(signedIn?'green':'yellow');}
  if($('cloudUserEmail')) $('cloudUserEmail').textContent=cloudSession?.user?.email||'로그인 계정';
  if(message && $('cloudMessage')) $('cloudMessage').textContent=message;
  renderCloudSyncStatus();
}
async function cloudSignUp() {
  const email=$('cloudEmail').value.trim(), password=$('cloudPassword').value;
  if(!email||password.length<8) return toast('이메일과 8자 이상의 비밀번호를 입력해 주세요.');
  try{
    const result=await cloudAuth('signup',{email,password});
    if(result?.access_token) {
      saveCloudSession({...result,expires_at:Math.floor(Date.now()/1000)+Number(result.expires_in||3600)});
      await syncCloudData();
    } else if($('cloudMessage')) $('cloudMessage').textContent='회원가입 요청이 접수됐습니다. 이메일 인증 링크를 확인한 뒤 로그인해 주세요.';
  }catch(error){if($('cloudMessage'))$('cloudMessage').textContent='회원가입 실패: '+error.message;}
}
async function cloudSignIn() {
  const email=$('cloudEmail').value.trim(), password=$('cloudPassword').value;
  if(!email||!password) return toast('이메일과 비밀번호를 입력해 주세요.');
  try{
    const result=await cloudAuth('token?grant_type=password',{email,password});
    saveCloudSession({...result,expires_at:Math.floor(Date.now()/1000)+Number(result.expires_in||3600)});
    await syncCloudData();
  }catch(error){if($('cloudMessage'))$('cloudMessage').textContent='로그인 실패: '+error.message;}
}
async function cloudSignOut() {
  try{const token=await cloudAccessToken();if(token)await cloudAuth('logout',{},token);}catch(_){}
  saveCloudSession(null);
  if($('cloudMessage'))$('cloudMessage').textContent='로그아웃했습니다. 이 기기의 로컬 데이터는 그대로 유지됩니다.';
}
function mergeCloudSavedRecord(localEntry, remoteEntry) {
  const normalized = normalizeSavedEntry(remoteEntry);
  if (!normalized) return localEntry || null;
  if (!localEntry) return normalized;

  const localTime = Date.parse(localEntry.syncUpdatedAt || '') || 0;
  const remoteTime = Date.parse(normalized.syncUpdatedAt || '') || 0;
  if (remoteTime > localTime) {
    // Keep the local stable ID so existing check-history links remain valid.
    localEntry.mode = normalized.mode;
    localEntry.date = normalized.date;
    localEntry.favorite = normalized.favorite;
    localEntry.syncUpdatedAt = normalized.syncUpdatedAt;
  }
  return localEntry;
}

function normalizeCloudHistoryRecord(row, remoteSavedById, localSaved) {
  if (!row || !row.payload || typeof row.payload !== 'object') return null;
  const item = normalizeSavedCheckRecord({
    ...row.payload,
    id: row.payload.id || String(row.record_key || '')
  });
  if (!item) return null;

  const mapped = remoteSavedById.get(String(item.savedId));
  if (mapped) item.savedId = mapped;
  const numberKey = item.numbers.join('-');
  const local = localSaved && typeof localSaved.get === 'function'
    ? localSaved.get(numberKey)
    : localSaved.find(entry => entry.numbers.join('-') === numberKey);
  if (local) item.savedId = local.id;
  item.id = item.savedId
    ? `${item.round}:${item.savedId}`
    : String(row.record_key || item.id);
  return item;
}

function deletedSavedNumberMap(tombstones) {
  const deletions = new Map();
  for (const row of Array.isArray(tombstones) ? tombstones : []) {
    if (row?.category !== 'saved_combination' || typeof row.numbers_key !== 'string') continue;
    const deletedAt = Date.parse(row.deleted_at || '');
    if (!Number.isFinite(deletedAt)) continue;
    deletions.set(row.numbers_key,Math.max(deletions.get(row.numbers_key)||0,deletedAt));
  }
  return deletions;
}

function isSavedCombinationDeleted(entry, deletions) {
  if (!entry || !Array.isArray(entry.numbers) || !(deletions instanceof Map)) return false;
  const key = sortNums(entry.numbers.map(Number)).join('-');
  const deletedAt = deletions.get(key);
  if (!deletedAt) return false;
  const updatedAt = Date.parse(entry.syncUpdatedAt || '') || 0;
  // A later explicit save is a new user action and supersedes an older deletion.
  return updatedAt <= deletedAt;
}

function buildLocalCloudRows() {
  const rows=[];
  saved.forEach(item=>rows.push({category:'saved_combination',record_key:String(item.id),payload:item}));
  savedCheckHistory.forEach(item=>rows.push({category:'check_history',record_key:String(item.id||item.round+':'+item.savedId),payload:item}));
  rows.push({category:'auto_check_state',record_key:'default',payload:autoCheckMeta});
  return rows;
}
async function fetchAllCloudRows(token) {
  const pageSize=1000;
  const maxRows=200000;
  const base='/rest/v1/lucky645_sync_records?select=id,category,record_key,payload,deleted_at,updated_at&order=updated_at.asc,id.asc';
  const rows=[];
  for(let offset=0;offset<maxRows;offset+=pageSize) {
    const page=await cloudRequest(base+`&limit=${pageSize}&offset=${offset}`,{method:'GET'},token);
    if(!Array.isArray(page)) throw new Error('클라우드 데이터 응답 형식이 올바르지 않습니다.');
    rows.push(...page);
    if(page.length<pageSize) return rows;
  }
  throw new Error('클라우드 데이터가 한 번에 처리할 수 있는 최대 행 수를 초과했습니다. 고객지원에 문의해 주세요.');
}

async function cloudUpsert(rows, token, expectedUserId=cloudSession?.user?.id, expectedGeneration=cloudSessionGeneration) {
  if(!rows.length)return;
  assertCloudSyncSession(expectedUserId,expectedGeneration);
  const batchSize=250;
  const base='/rest/v1/lucky645_sync_records?on_conflict=user_id,category,record_key';
  for(let index=0;index<rows.length;index+=batchSize) {
    assertCloudSyncSession(expectedUserId,expectedGeneration);
    const batch=rows.slice(index,index+batchSize);
    const payload=batch.map(row=>({
      user_id:expectedUserId,
      category:row.category,
      record_key:row.record_key,
      payload:row.payload||{},
      deleted_at:row.deleted_at||null,
      updated_at:new Date().toISOString()
    }));
    await cloudRequest(base,{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(payload)},token);
    assertCloudSyncSession(expectedUserId,expectedGeneration);
  }
}
function assertAccountScope(expectedUserId,expectedGeneration) {
  const currentUserId=cloudSession?.user?.id||'local';
  if(currentUserId!==expectedUserId||cloudSessionGeneration!==expectedGeneration)
    throw new Error('계정이 변경되어 가져오기를 중단했습니다. 현재 계정에서 다시 시도해 주세요.');
}

function assertCloudSyncSession(expectedUserId,expectedGeneration=cloudSessionGeneration) {
  if(!expectedUserId||cloudSessionGeneration!==expectedGeneration||cloudSession?.user?.id!==expectedUserId)
    throw new Error('로그인 계정이 변경되어 동기화를 중단했습니다. 현재 계정으로 다시 동기화해 주세요.');
}
async function performCloudSync() {
  if(!cloudSession?.user?.id) return;
  const syncUserId=cloudSession.user.id;
  const syncGeneration=cloudSessionGeneration;
  const message=$('cloudMessage');
  cloudSyncMeta={...cloudSyncMeta,userId:cloudSession.user.id,status:'running',error:''};
  persistCloudSyncMeta();
  if(message)message.textContent='클라우드 데이터를 안전하게 병합하는 중입니다…';
  const token=await cloudAccessToken();
  if(!token)throw new Error('로그인 세션이 만료됐습니다. 다시 로그인해 주세요.');
  assertCloudSyncSession(syncUserId,syncGeneration);
  const remote=await fetchAllCloudRows(token);
  assertCloudSyncSession(syncUserId,syncGeneration);
  const tombstoneMap=new Map(loadCloudTombstones().map(row=>[row.category+':'+row.record_key,row]));
  (remote||[]).filter(row=>row.deleted_at).forEach(row=>tombstoneMap.set(row.category+':'+row.record_key,{
    category:row.category,
    record_key:row.record_key,
    deleted_at:row.deleted_at,
    ...(typeof row.payload?.numbers_key==='string'?{numbers_key:row.payload.numbers_key}:{})
  }));
  const deleted=new Set([...tombstoneMap.keys()]);
  const deletedSavedNumbers=deletedSavedNumberMap([...tombstoneMap.values()]);
  const remoteSavedRows=[];
  const remoteHistoryRows=[];
  let remoteState=null;
  for(const row of Array.isArray(remote)?remote:[]) {
    if(row.deleted_at||deleted.has(row.category+':'+row.record_key)) continue;
    if(row.category==='saved_combination') {
      if(!isSavedCombinationDeleted(row.payload,deletedSavedNumbers)) remoteSavedRows.push(row);
    } else if(row.category==='check_history') {
      remoteHistoryRows.push(row);
    } else if(row.category==='auto_check_state'&&row.record_key==='default') {
      remoteState=row.payload;
    }
  }
  // Validate the merged record counts before mutating in-memory state.
  const prospectiveSavedByNumbers=new Map(saved.map(item=>[item.numbers.join('-'),item]));
  const prospectiveRemoteSavedById=new Map();
  for(const row of remoteSavedRows) {
    const item=normalizeSavedEntry(row.payload);
    if(!item)continue;
    const key=item.numbers.join('-');
    let local=prospectiveSavedByNumbers.get(key);
    if(!local) {
      local=item;
      prospectiveSavedByNumbers.set(key,local);
    }
    prospectiveRemoteSavedById.set(String(row.payload?.id || row.record_key),local.id);
    if(prospectiveSavedByNumbers.size>MAX_SAVED_ENTRIES) {
      throw new Error('클라우드 번호 보관함이 최대 '+formatNumber(MAX_SAVED_ENTRIES)+'개를 초과합니다. 로컬 데이터를 덮어쓰지 않고 동기화를 중단했습니다.');
    }
  }
  const prospectiveHistoryKeys=new Set(savedCheckHistory.map(row=>`${Number(row.round)}:${String(row.savedId || row.id)}`));
  assertSavedCollectionCapacity(prospectiveSavedByNumbers.size,prospectiveHistoryKeys.size);
  for(const row of remoteHistoryRows) {
    const item=normalizeCloudHistoryRecord(row,prospectiveRemoteSavedById,prospectiveSavedByNumbers);
    if(!item)continue;
    prospectiveHistoryKeys.add(`${Number(item.round)}:${String(item.savedId || item.id)}`);
    if(prospectiveHistoryKeys.size>MAX_SAVED_BACKUP_CHECK_HISTORY) {
      throw new Error('클라우드 확인 이력이 최대 '+formatNumber(MAX_SAVED_BACKUP_CHECK_HISTORY)+'건을 초과합니다. 로컬 데이터를 덮어쓰지 않고 동기화를 중단했습니다.');
    }
  }

  const localSavedByNumbers=new Map(saved.map(item=>[item.numbers.join('-'),item]));
  const remoteSavedById=new Map();

  remoteSavedRows.forEach(row=>{
    const item=normalizeSavedEntry(row.payload);
    if(!item)return;
    const key=item.numbers.join('-');
    let local=localSavedByNumbers.get(key);
    if(!local){
      local=item;
      saved.push(local);
      localSavedByNumbers.set(key,local);
    }else{
      mergeCloudSavedRecord(local,item);
    }
    remoteSavedById.set(String(row.payload?.id || row.record_key),local.id);
    // 여러 기기에서 같은 번호가 각각 생성되었더라도 저장 조합은 한 개로 합칩니다.
    if(String(row.record_key)!==String(local.id)){
      tombstoneMap.set('saved_combination:'+String(row.record_key),{
        category:'saved_combination',record_key:String(row.record_key),deleted_at:new Date().toISOString()
      });
    }
  });

  const historyKeys=new Set(savedCheckHistory.map(row=>`${Number(row.round)}:${String(row.savedId || row.id)}`));
  remoteHistoryRows.forEach(row=>{
    const item=normalizeCloudHistoryRecord(row,remoteSavedById,localSavedByNumbers);
    if(!item)return;
    const key=`${Number(item.round)}:${String(item.savedId || item.id)}`;
    if(!historyKeys.has(key)){
      item.id=key;
      savedCheckHistory.push(item);
      historyKeys.add(key);
    }
    // 매핑 전 ID로 저장된 이력은 표준화한 키로 옮기고 이전 키를 tombstone 처리합니다.
    if(String(row.record_key)!==String(item.id)){
      tombstoneMap.set('check_history:'+String(row.record_key),{
        category:'check_history',record_key:String(row.record_key),deleted_at:new Date().toISOString()
      });
    }
  });

  const newestKnownRound=Number(draws.at(-1)?.round || latest?.round || 0);
  const remoteRound=Number(remoteState?.lastRound);
  if(remoteState&&Number.isSafeInteger(remoteRound)&&remoteRound>Number(autoCheckMeta.lastRound)&&newestKnownRound>0){
    autoCheckMeta={...remoteState,lastRound:Math.min(remoteRound,newestKnownRound)};
  }

  saved=saved.filter(item=>!deleted.has('saved_combination:'+String(item.id))&&!isSavedCombinationDeleted(item,deletedSavedNumbers));
  savedCheckHistory=savedCheckHistory.filter(item=>!deleted.has('check_history:'+String(item.id||item.round+':'+item.savedId)));
  persistCloudTombstones([...tombstoneMap.values()]);
  cloudApplying=true;
  try{
    appStorageSet(SAVED_KEY,JSON.stringify(saved));
    appStorageSet(SAVED_CHECKS_KEY,JSON.stringify(savedCheckHistory));
    appStorageSet(AUTO_CHECK_KEY,JSON.stringify(autoCheckMeta));
    renderSaved();renderSavedReports();updateTopStats();
  }finally{cloudApplying=false;}

  if(dataReady && latestVerification==='official') autoCheckLatestDraw();
  if(savedBacktestResult) runSavedBacktest();

  const finalDeleted=new Set([...tombstoneMap.keys()]);
  const finalDeletedSavedNumbers=deletedSavedNumberMap([...tombstoneMap.values()]);
  assertCloudSyncSession(syncUserId,syncGeneration);
  const activeRows=buildLocalCloudRows().filter(row=>{
    if(finalDeleted.has(row.category+':'+row.record_key)) return false;
    if(row.category==='saved_combination'&&isSavedCombinationDeleted(row.payload,finalDeletedSavedNumbers)) return false;
    return true;
  });
  const deletedRows=[...tombstoneMap.values()].map(row=>({
    category:row.category,
    record_key:row.record_key,
    payload:row.numbers_key?{numbers_key:row.numbers_key}:{},
    deleted_at:row.deleted_at
  }));
  await cloudUpsert([...activeRows,...deletedRows],token,syncUserId,syncGeneration);
  assertCloudSyncSession(syncUserId,syncGeneration);
  const researchSync = await syncResearchRuns(token,syncUserId,syncGeneration);
  assertCloudSyncSession(syncUserId,syncGeneration);
  const uploaded=activeRows.length+deletedRows.length+researchSync.uploaded;
  const downloaded=remote.length+researchSync.downloaded;
  cloudSyncMeta={userId:cloudSession.user.id,lastSuccessAt:new Date().toISOString(),uploaded,downloaded,status:'success',error:''};
  persistCloudSyncMeta();
  createResearchBackup(false);
  if(message)message.textContent='동기화 완료: 저장 조합 '+saved.length+'개 · 확인 이력 '+savedCheckHistory.length+'건 · 연구 이력 '+researchHistory.length+'건 (업로드 '+uploaded+'건, 서버에서 읽음 '+downloaded+'건).';
}
async function syncCloudData() {
  if(!cloudSession?.user?.id) return;
  if(cloudSyncPromise) {
    cloudSyncRequested=true;
    return cloudSyncPromise;
  }
  const syncUserId=cloudSession.user.id,syncGeneration=cloudSessionGeneration;
  cloudSyncPromise=performCloudSync();
  try {
    return await cloudSyncPromise;
  } catch(error) {
    if(cloudSessionGeneration===syncGeneration&&cloudSession?.user?.id===syncUserId){
      cloudSyncMeta={...cloudSyncMeta,userId:syncUserId,status:'error',error:error?.message||String(error)};
      persistCloudSyncMeta();
    }
    throw error;
  } finally {
    cloudSyncPromise=null;
    if(cloudSyncRequested) {
      cloudSyncRequested=false;
      scheduleCloudSync();
    }
  }
}
function scheduleCloudSync() {
  if(cloudApplying||!cloudSession?.access_token)return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer=setTimeout(()=>syncCloudData().catch(error=>{if($('cloudMessage'))$('cloudMessage').textContent='자동 동기화 보류: '+error.message;}),1400);
}

function bindEvents() {
  $('cloudSignUpBtn').addEventListener('click',cloudSignUp);
  $('cloudSignInBtn').addEventListener('click',cloudSignIn);
  $('cloudSignOutBtn').addEventListener('click',cloudSignOut);
  $('cloudSyncNowBtn').addEventListener('click',()=>syncCloudData().catch(error=>{if($('cloudMessage'))$('cloudMessage').textContent='동기화 실패: '+error.message;}));
  $('cloudPassword').addEventListener('keydown',event=>{if(event.key==='Enter')cloudSignIn();});
  document.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.page)));
  document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
    activeMode=button.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(item=>item.classList.toggle('selected',item.dataset.mode===activeMode));
    $('customArea').style.display=activeMode==='custom'?'block':'none';
    const usesHistoryWeight=['stats','hybrid'].includes(activeMode);
    $('statsWeightControl').style.display=usesHistoryWeight?'block':'none';
    if (usesHistoryWeight) { const help=$('statsWeightControl').querySelector('.field-help'); if(help) help.textContent=`현재 확보한 ${drawsForStatsWeighting().length}회 자료의 빈도를 ${activeMode==='hybrid'?'50:50 혼합 방식으로':'약하게'} 반영합니다. 당첨 확률이 높아지는 것은 아닙니다.`; }
  }));
  document.querySelectorAll('[data-period]').forEach(button=>button.addEventListener('click',()=>{statsPeriod=button.dataset.period;renderStats();}));
  document.querySelectorAll('[data-analytics-period]').forEach(button=>button.addEventListener('click',()=>{analyticsPeriod=button.dataset.analyticsPeriod;renderAnalytics();}));
  $('runSimulationBtn').addEventListener('click',runAnalyticsSimulation);
  $('runResearchBtn').addEventListener('click',runResearchLab);
  if ($('researchCompareSelect')) $('researchCompareSelect').addEventListener('change',()=>{researchCompareRunId=$('researchCompareSelect').value;renderResearchHistory();});
  if ($('exportResearchHistoryBtn')) $('exportResearchHistoryBtn').addEventListener('click',exportResearchHistory);
  if ($('importResearchHistoryBtn')) $('importResearchHistoryBtn').addEventListener('click',()=>$('researchHistoryImportFile').click());
  if ($('researchHistoryImportFile')) $('researchHistoryImportFile').addEventListener('change',event=>{const file=event.target.files?.[0];importResearchHistoryFile(file);event.target.value='';});
  $('runPortfolioSimulationBtn').addEventListener('click',runPortfolioSimulation);
  $('runSimulationStudioBtn').addEventListener('click',runSimulationStudio);
  $('saveSimulationResultBtn').addEventListener('click',saveCurrentSimulationResult);
  $('deleteSimulationProfileBtn').addEventListener('click',deleteSelectedSimulationResult);
  $('simulationProfileSelect').addEventListener('change',()=>{simulationGeneratedTickets=[];$('simulationTicketsOutput').className='empty';$('simulationTicketsOutput').textContent='선택한 결과에서 빈출 번호 조합을 생성해 주세요.';$('saveSimulationTicketsBtn').disabled=true;renderSimulationPage($('simulationProfileSelect').value);});
  $('simulationPoolSize').addEventListener('change',()=>renderSimulationPoolNumbers());
  $('buildSimulationTicketsBtn').addEventListener('click',buildSimulationTicketSet);
  $('saveSimulationTicketsBtn').addEventListener('click',saveSimulationTicketSet);
  $('exportAnalyticsBtn').addEventListener('click',exportAnalyticsCsv);
  $('startHybridBtn').addEventListener('click',()=>{
    activeMode='hybrid';
    statsWeightPeriod=analyticsPeriod;
    $('statsWeightPeriod').value=analyticsPeriod;
    document.querySelectorAll('[data-mode]').forEach(item=>item.classList.toggle('selected',item.dataset.mode==='hybrid'));
    $('customArea').style.display='none';
    $('statsWeightControl').style.display='block';
    const help=$('statsWeightControl').querySelector('.field-help');
    if(help)help.textContent=`${drawsForStatsWeighting().length}회 통계 참고와 균등 무작위 선택을 50:50으로 혼합합니다. 당첨 확률은 동일합니다.`;
    navigate('generator');
  });
  $('generateBtn').addEventListener('click',generateNumbers);
  $('saveAllResultsBtn').addEventListener('click',saveAllGenerated);
  $('statsWeightPeriod').addEventListener('change',event=>{statsWeightPeriod=event.target.value; const count=drawsForStatsWeighting().length; $('statsWeightControl').querySelector('.field-help').textContent=`현재 확보한 ${count}회 자료에서 출현 빈도를 약하게 반영합니다. 당첨 확률이 높아지는 것은 아닙니다.`;});
  $('refreshBtn').addEventListener('click',()=>refreshData(true));
  $('loadRoundBtn').addEventListener('click',checkRound);
  $('checkRound').addEventListener('keydown',event=>{if(event.key==='Enter')checkRound();});
  $('checkSavedBtn').addEventListener('click',checkSavedNumbers);
  $('manualCheckBtn').addEventListener('click',checkManualNumbers);
  $('clearSavedBtn').addEventListener('click',()=>{
    if (!saved.length) return;
    if (confirm('저장한 번호를 모두 삭제할까요?')) { saved.forEach(entry=>markCloudDeleted('saved_combination',String(entry.id),entry.numbers)); saved=[];persistSaved();toast('보관함을 비웠습니다.'); }
  });
  $('historySearchBtn').addEventListener('click',async()=>{
    const round=Number($('historySearch').value);
    if (!Number.isInteger(round)||round<1) { historySearchActive=false;filteredHistory=null;historyPage=0;renderHistory();return; }
    historySearchActive=true;
    const draw=await getDraw(round);
    filteredHistory=draw;
    historyPage=0;
    renderHistory();
    if (!draw) toast('해당 회차 데이터를 찾지 못했습니다.');
  });
  $('historySearch').addEventListener('keydown',event=>{if(event.key==='Enter')$('historySearchBtn').click();});
  $('prevHistory').addEventListener('click',()=>{historyPage=Math.max(0,historyPage-1);renderHistory();});
  $('nextHistory').addEventListener('click',()=>{historyPage++;renderHistory();});
  $('results').addEventListener('click',event=>{
    const save=event.target.closest('[data-save-result]');
    const copy=event.target.closest('[data-copy-result]');
    if (save) saveCombination(generated[Number(save.dataset.saveResult)],generatedMode);
    if (copy) copyNumbers(generated[Number(copy.dataset.copyResult)]);
  });
  document.querySelectorAll('[data-saved-filter]').forEach(button=>button.addEventListener('click',()=>{savedFilter=button.dataset.savedFilter;renderSaved();}));
  $('exportSavedBtn').addEventListener('click',exportSavedBackup);
  $('importSavedBtn').addEventListener('click',()=>$('savedImportFile').click());
  $('exportSavedCheckCsvBtn').addEventListener('click',exportSavedCheckHistory);
  $('exportSavedPdfBtn').addEventListener('click',exportSavedPdf);
  $('requestDrawNotificationsBtn').addEventListener('click',requestDrawNotifications);
  $('runSavedBacktestBtn').addEventListener('click',runSavedBacktest);
  $('savedBacktestPeriod').addEventListener('change',()=>{ if(savedBacktestResult) runSavedBacktest(); });
  $('savedBacktestRange').addEventListener('change',()=>{ if(savedBacktestResult) runSavedBacktest(); });
  $('savedImportFile').addEventListener('change',event=>{const file=event.target.files?.[0];importSavedBackup(file);event.target.value='';});
  $('savedList').addEventListener('click',event=>{
    const remove=event.target.closest('[data-delete-saved]');
    const copy=event.target.closest('[data-copy-saved]');
    const favorite=event.target.closest('[data-favorite-saved]');
    if (favorite) toggleSavedFavorite(Number(favorite.dataset.favoriteSaved));
    if (remove) { const removed=saved[Number(remove.dataset.deleteSaved)]; if(removed) markCloudDeleted('saved_combination',String(removed.id),removed.numbers); saved.splice(Number(remove.dataset.deleteSaved),1);persistSaved();toast('번호를 삭제했습니다.'); }
    if (copy) copyNumbers(saved[Number(copy.dataset.copySaved)].numbers);
  });
}

function init() {
  bindEvents();
  renderCloudAuth();
  renderCustomGrids();
  renderManualGrid();
  updateTopStats();
  renderLatest();
  renderStats();
  renderAnalytics();
  renderSimulationPage();
  renderResearchLab();
  renderHistory();
  renderHomeRecent();
  renderSaved();
  renderSavedReports();
  const status=$('dataStatus');
  if (status) { status.textContent=draws.length ? `저장된 ${draws.length}회 데이터 · 최신 확인 중` : '과거 데이터 연결 확인 중'; status.title=syncMeta.lastAttemptAt ? `마지막 확인: ${formatSyncTime(syncMeta.lastAttemptAt)}\n마지막 성공: ${formatSyncTime(syncMeta.lastSuccessAt)}\n${syncMeta.errors.join('\n')}` : '아직 데이터 확인 기록이 없습니다.'; }
  refreshData(false);
  if(cloudSession?.access_token) syncCloudData().catch(error=>{if($('cloudMessage'))$('cloudMessage').textContent='클라우드 연결 확인 필요: '+error.message;});
}

init();
