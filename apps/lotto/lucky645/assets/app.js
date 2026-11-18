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
const API_ALL_SOURCES = [
  '/api/lotto?type=all',
  'https://raw.githubusercontent.com/visionary153/lotto-api/main/results/all.json',
  'https://visionary153.github.io/lotto-api/results/all.json'
];
const API_PROXY_LATEST = '/api/lotto?type=latest';
const API_LATEST = 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do';
const API_LATEST_FALLBACK = 'https://raw.githubusercontent.com/visionary153/lotto-api/main/results/latest.json';
const API_PROXY_BATCH = '/api/lotto?type=round';
const API_BATCH = 'https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do';
const CSV_FALLBACK = 'https://cashlogy.kr/lotto/excel.csv';
const CACHE_KEY = 'lucky645_draws_cache_v1';
const SAVED_KEY = 'lucky645_saved';
const SYNC_KEY = 'lucky645_sync_meta_v1';
const SAVED_CHECKS_KEY = 'lucky645_saved_check_history_v1';
const AUTO_CHECK_KEY = 'lucky645_auto_check_meta_v1';
const MAX_BACKUP_FILE_SIZE = 12 * 1024 * 1024;
const SUPABASE_URL = 'https://absljxjxrrhmswhpthol.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_OPEj3uNdx3wX7r9C6KDuuA_IuyeTD9p';
const CLOUD_TOMBSTONES_KEY = 'lucky645_cloud_tombstones_v1';
const CLOUD_SESSION_KEY = 'lucky645_cloud_session_v1';
let cloudSession = loadCloudSession();
let cloudApplying = false;
let cloudSyncTimer = null;
let cloudSyncPromise = null;
let cloudSyncRequested = false;

let draws = loadCachedDraws();
let latest = draws.at(-1) || FALLBACK_DRAW;
let latestVerification = 'pending';
let dataReady = false;
let activeMode = 'random';
let generated = [];
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
let isRefreshing = false;

const $ = id => document.getElementById(id);
const formatNumber = n => Number(n || 0).toLocaleString('ko-KR');
const money = n => `${formatNumber(n)}원`;
const escapeHtml = value => String(value).replace(/[&<>\"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[character]));

function normalizeSyncTimestamp(value) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function normalizeSavedEntry(entry, index = 0) {
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.numbers)) return null;
  const numbers = entry.numbers.map(Number);
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
    const value = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.map(normalizeSavedEntry).filter(Boolean);
  } catch (_) { return []; }
}

function normalizeSavedCheckRecord(item) {
  if (!item || typeof item !== 'object') return null;
  const round = Number(item.round);
  const numbers = Array.isArray(item.numbers) ? item.numbers.map(Number) : [];
  const matches = Number(item.matches);
  const rank = String(item.rank || '낙첨');
  if (!Number.isInteger(round) || round < 1 || !Number.isInteger(matches) || matches < 0 || matches > 6 ||
      numbers.length !== 6 || new Set(numbers).size !== 6 || numbers.some(n => !Number.isInteger(n) || n < 1 || n > 45) ||
      !['1등','2등','3등','4등','5등','낙첨'].includes(rank)) return null;
  return {
    id: String(item.id || `${round}-${item.savedId || ''}`).slice(0,120),
    savedId: String(item.savedId || '').slice(0,100),
    numbers: sortNums(numbers), round, date: typeof item.date === 'string' ? item.date.slice(0,20) : '',
    matches, bonusMatch: Boolean(item.bonusMatch), rank, winningNumbers: Array.isArray(item.winningNumbers) ? item.winningNumbers.map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=45).slice(0,6) : [],
    bonus: Number.isInteger(Number(item.bonus)) ? Number(item.bonus) : null,
    checkedAt: typeof item.checkedAt === 'string' ? item.checkedAt.slice(0,40) : '',
    source: typeof item.source === 'string' ? item.source.slice(0,40) : '확인',
    mode: ['random','balanced','stats','hybrid','custom','coverage'].includes(item.mode) ? item.mode : 'random'
  };
}

function loadSavedCheckHistory() {
  try { const raw = JSON.parse(localStorage.getItem(SAVED_CHECKS_KEY) || '[]'); return Array.isArray(raw) ? raw.map(normalizeSavedCheckRecord).filter(Boolean).slice(-50000) : []; }
  catch (_) { return []; }
}

function loadAutoCheckMeta() {
  try { const raw = JSON.parse(localStorage.getItem(AUTO_CHECK_KEY) || '{}'); return {
    lastRound: Number.isInteger(Number(raw.lastRound)) && Number(raw.lastRound) > 0 ? Number(raw.lastRound) : 0,
    lastCheckedAt: typeof raw.lastCheckedAt === 'string' ? raw.lastCheckedAt : '',
    lastStatus: typeof raw.lastStatus === 'string' ? raw.lastStatus.slice(0,40) : '대기'
  }; } catch (_) { return {lastRound:0,lastCheckedAt:'',lastStatus:'대기'}; }
}

function persistSavedCheckHistory() {
  try {
    localStorage.setItem(SAVED_CHECKS_KEY, JSON.stringify(savedCheckHistory.slice(-50000)));
    if (!cloudApplying) scheduleCloudSync();
    return true;
  } catch (_) {
    toast('당첨 확인 이력을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.');
    return false;
  }
}
function persistAutoCheckMeta() {
  try { localStorage.setItem(AUTO_CHECK_KEY, JSON.stringify(autoCheckMeta)); if (!cloudApplying) scheduleCloudSync(); return true; }
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

function renderSavedReports() {
  const total = savedCheckHistory.length;
  const top = savedCheckHistory.filter(row=>['1등','2등','3등'].includes(row.rank)).length;
  const low = savedCheckHistory.filter(row=>['4등','5등'].includes(row.rank)).length;
  const last = savedCheckHistory.slice().sort((a,b)=>b.round-a.round)[0];
  const kpis = $('savedCheckKpis');
  if (kpis) kpis.innerHTML = `<div class="saved-insight-card"><span>누적 조합 확인</span><strong>${formatNumber(total)}건</strong></div><div class="saved-insight-card"><span>1~3등 결과</span><strong>${formatNumber(top)}건</strong></div><div class="saved-insight-card"><span>4~5등 결과</span><strong>${formatNumber(low)}건</strong></div><div class="saved-insight-card"><span>최근 확인 회차</span><strong>${last ? `${last.round}회` : '-'}</strong></div>`;
  const status = $('savedCheckStatus');
  if (status) status.innerHTML = `자동 확인 기준: <strong>${autoCheckMeta.lastRound ? `${autoCheckMeta.lastRound}회` : '아직 설정되지 않음'}</strong> · 마지막 확인: ${escapeHtml(formatSyncTime(autoCheckMeta.lastCheckedAt))} · ${escapeHtml(autoCheckMeta.lastStatus || '대기')}<br><span class="analytics-mini">공식 최신 회차가 업데이트되고 페이지에서 데이터 확인이 완료될 때 실행됩니다. 브라우저를 닫은 동안에는 확인되지 않습니다.</span>`;
  const history = $('savedCheckHistory');
  if (history) {
    const rows = savedCheckHistory.slice().sort((a,b)=>b.round-a.round || String(b.checkedAt).localeCompare(String(a.checkedAt))).slice(0,30);
    history.innerHTML = rows.length ? `<div class="table-wrap"><table class="saved-history-table"><thead><tr><th>회차</th><th>내 조합</th><th>일치</th><th>보너스</th><th>결과</th><th>확인 방식</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${row.round}회</td><td>${row.numbers.join(', ')}</td><td>${row.matches}개</td><td>${row.bonusMatch?'일치':'-'}</td><td><strong>${row.rank}</strong></td><td>${escapeHtml(row.source)}</td></tr>`).join('')}</tbody></table></div><div class="analytics-mini" style="margin-top:8px">최근 30건 표시 · 전체 이력 ${formatNumber(total)}건</div>` : '<div class="empty">아직 당첨 확인 이력이 없습니다. 최신 공식 회차 확인 또는 직접 비교를 실행해 주세요.</div>';
  }
  const perf = $('savedPerformance');
  if (perf) {
    const rows = saved.map(entry=>{ const checks=savedCheckHistory.filter(row=>row.savedId===entry.id); const wins=checks.filter(row=>row.rank!=='낙첨').length; const top3=checks.filter(row=>['1등','2등','3등'].includes(row.rank)).length; const avg=checks.length?checks.reduce((sum,row)=>sum+row.matches,0)/checks.length:0; return {entry,checks:checks.length,wins,top3,avg}; }).sort((a,b)=>b.top3-a.top3 || b.wins-a.wins || b.avg-a.avg || b.checks-a.checks);
    perf.innerHTML = rows.length ? `<div class="table-wrap"><table class="saved-history-table"><thead><tr><th>순위</th><th>저장 조합</th><th>비교 횟수</th><th>당첨 결과</th><th>1~3등</th><th>평균 일치</th></tr></thead><tbody>${rows.map((row,i)=>`<tr><td>${i+1}</td><td>${row.entry.numbers.join(', ')}</td><td>${row.checks}</td><td>${row.wins}</td><td>${row.top3}</td><td>${row.avg.toFixed(2)}개</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">저장한 조합이 없습니다.</div>';
  }
}

function exportSavedCheckHistory() {
  if (!savedCheckHistory.length) return toast('내보낼 당첨 확인 이력이 없습니다.');
  const rows=[['회차','추첨일','저장ID','번호','일치개수','보너스일치','등수','확인시각','확인방식']];
  savedCheckHistory.forEach(row=>rows.push([row.round,row.date,row.savedId,row.numbers.join(' '),row.matches,row.bonusMatch?'Y':'N',row.rank,row.checkedAt,row.source]));
  const csv='\uFEFF'+rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
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

  for (const entry of saved) {
    const mode = entry.mode || 'random';
    if (!byMode[mode]) byMode[mode] = {checks:0,win:0,top3:0};
    for (const draw of selectedDraws) {
      const result = compareNumbers(entry.numbers, draw);
      const rank = result.rank;
      rankCounts[rank] = (rankCounts[rank] || 0) + 1;
      checks++;
      byMode[mode].checks++;
      if (rank !== '낙첨') byMode[mode].win++;
      if (['1등','2등','3등'].includes(rank)) byMode[mode].top3++;

      const key = period === 'month'
        ? (draw.date ? draw.date.slice(0,7) : '날짜 없음')
        : (draw.date ? draw.date.slice(0,4) : '날짜 없음');
      if (!byPeriod[key]) byPeriod[key] = {checks:0,win:0,top3:0};
      byPeriod[key].checks++;
      if (rank !== '낙첨') byPeriod[key].win++;
      if (['1등','2등','3등'].includes(rank)) byPeriod[key].top3++;

      if (rank !== '낙첨') {
        const prize = draw.ranks?.find(item => Number(item.rank) === Number(rank[0]))?.prize;
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
    const value = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}');
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
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(syncMeta)); } catch (_) {}
}

function formatSyncTime(value) {
  if (!value) return '기록 없음';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '시간 정보 오류' : date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

function loadCachedDraws() {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return mergeDraws([], value.map(normalizeDraw).filter(Boolean));
  } catch (_) { return []; }
}

function persistSaved() {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); } catch (_) {}
  renderSaved();
  updateTopStats();
  if (!cloudApplying) scheduleCloudSync();
  if (savedBacktestResult) runSavedBacktest();
}

function persistDraws() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(draws)); } catch (_) {}
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

function normalizeDraw(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const nums = raw.numbers ?? raw.winNumbers ?? [
    raw.tm1WnNo ?? raw.n1 ?? raw.drwtNo1,
    raw.tm2WnNo ?? raw.n2 ?? raw.drwtNo2,
    raw.tm3WnNo ?? raw.n3 ?? raw.drwtNo3,
    raw.tm4WnNo ?? raw.n4 ?? raw.drwtNo4,
    raw.tm5WnNo ?? raw.n5 ?? raw.drwtNo5,
    raw.tm6WnNo ?? raw.n6 ?? raw.drwtNo6
  ];
  const round = Number(raw.round ?? raw.draw_no ?? raw.ltEpsd ?? raw.drwNo);
  const numbers = Array.isArray(nums) ? nums.map(Number) : [];
  const bonus = Number(raw.bonus ?? raw.bonus_no ?? raw.bnsWnNo ?? raw.bnusNo);
  if (!Number.isSafeInteger(round) || round < 1 || numbers.length !== 6 || new Set(numbers).size !== 6 ||
      numbers.some(number => !Number.isInteger(number) || number < 1 || number > 45) ||
      !Number.isInteger(bonus) || bonus < 1 || bonus > 45 || numbers.includes(bonus)) return null;

  let ranks = raw.ranks || raw.divisions;
  if (Array.isArray(ranks)) {
    ranks = ranks.map(item => {
      const prizeValue = item?.prize ?? item?.amount;
      const winnerValue = item?.winners ?? item?.winnerCount;
      return {
        rank: Number(item?.rank),
        prize: prizeValue == null || prizeValue === '' || !Number.isFinite(Number(prizeValue)) ? null : Number(prizeValue),
        winners: winnerValue == null || winnerValue === '' || !Number.isFinite(Number(winnerValue)) ? null : Number(winnerValue)
      };
    }).filter(item => Number.isInteger(item.rank) && item.rank >= 1 && item.rank <= 5);
  } else {
    ranks = [1,2,3,4,5].map(rank => {
      const prizeValue = raw[`rnk${rank}WnAmt`] ?? raw[['first','second','third','fourth','fifth'][rank-1]+'Winamnt'];
      const winnerValue = raw[`rnk${rank}WnNope`] ?? raw[['first','second','third','fourth','fifth'][rank-1]+'PrzwnerCo'];
      return {
        rank,
        prize: prizeValue == null || prizeValue === '' ? null : Number(prizeValue),
        winners: winnerValue == null || winnerValue === '' ? null : Number(winnerValue)
      };
    }).filter(item => Number.isFinite(item.prize) || Number.isFinite(item.winners));
  }
  ranks = ranks.map(item => ({
    rank: item.rank,
    prize: Number.isFinite(item.prize) && item.prize >= 0 ? item.prize : null,
    winners: Number.isFinite(item.winners) && item.winners >= 0 ? item.winners : null
  }));

  const dateRaw = String(raw.date ?? raw.ltRflYmd ?? raw.drwNoDate ?? '').trim();
  let date = '';
  if (/^\d{8}$/.test(dateRaw)) date = `${dateRaw.slice(0,4)}-${dateRaw.slice(4,6)}-${dateRaw.slice(6,8)}`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) date = dateRaw;
  if (date) { const parsed = new Date(`${date}T00:00:00Z`); if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) date = ''; }
  return {
    round,
    date,
    numbers: sortNums(numbers),
    bonus,
    ranks,
    source: typeof raw.source === 'string' ? raw.source.slice(0, 80) : '공개 회차 데이터'
  };
}

function extractDraws(json) {
  let rows = Array.isArray(json) ? json : (json?.results || json?.data?.list || json?.list || json?.data || []);
  if (!Array.isArray(rows) && rows && typeof rows === 'object') rows = Object.values(rows);
  return Array.isArray(rows) ? rows.map(normalizeDraw).filter(Boolean).sort((a,b)=>a.round-b.round) : [];
}

function normalizeOfficial(raw, wantedRound = null) {
  const list = raw?.data?.list || raw?.data?.result?.pstLtEpstInfo?.lt645 || raw?.list;
  if (Array.isArray(list)) {
    const sorted = [...list].sort((a,b)=>Number(b.ltEpsd ?? b.round)-Number(a.ltEpsd ?? a.round));
    const selected = wantedRound == null ? sorted[0] : list.find(item=>Number(item.ltEpsd ?? item.round)===Number(wantedRound));
    return normalizeDraw(selected);
  }
  return normalizeDraw(raw?.data || raw);
}

function isContinuousHistory(list) {
  if (!Array.isArray(list) || !list.length) return false;
  const sorted = [...list].sort((a,b)=>a.round-b.round);
  if (sorted[0].round !== 1 || sorted.length !== sorted[sorted.length-1].round) return false;
  for (let index=0; index<sorted.length; index++) if (sorted[index].round !== index+1) return false;
  return true;
}

function sourceTrust(source) {
  const label = String(source || '');
  if (label.includes('동행복권')) return 50;
  if (label.includes('GitHub') || label.includes('공개 최신')) return 25;
  if (label.includes('CSV')) return 15;
  if (label.includes('저장')) return 10;
  if (label.includes('기본 표시값')) return 0;
  return 20;
}

function mergeDraws(base, incoming) {
  const map = new Map();
  for (const item of [...(Array.isArray(base)?base:[]), ...(Array.isArray(incoming)?incoming:[])]) {
    const draw = item?.round && item?.numbers ? normalizeDraw(item) : null;
    if (!draw) continue;
    const current = map.get(draw.round);
    if (!current || sourceTrust(draw.source) >= sourceTrust(current.source)) map.set(draw.round, draw);
  }
  return [...map.values()].sort((a,b)=>a.round-b.round);
}

function hasRealDrawData(list) {
  return Array.isArray(list) && list.some(draw => draw && draw.source !== FALLBACK_DRAW.source);
}

async function getJson(url, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    const body = await response.text();
    if (type.includes('text/html') || body.trimStart().startsWith('<')) throw new Error('JSON이 아닌 웹페이지가 반환됐습니다.');
    try { return JSON.parse(body); } catch (_) { throw new Error('JSON 형식이 올바르지 않습니다.'); }
  } finally { clearTimeout(timer); }
}

function isUnavailableLocalProxy(url, error) {
  if (!String(url).startsWith('/api/')) return false;
  const message = String(error?.message || '');
  return /HTTP 404|Failed to parse URL|Invalid URL|relative URL/i.test(message);
}

async function getText(url, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}

function parseCsvLine(line) {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      cells.push(value.trim()); value = '';
    } else value += character;
  }
  cells.push(value.trim());
  return cells;
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(s=>s.trim());
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const raw = Object.fromEntries(headers.map((header,index)=>[header,(cells[index]||'').trim()]));
    const draw = normalizeDraw(raw);
    if (draw) rows.push(draw);
  }
  return rows.sort((a,b)=>a.round-b.round);
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

    // 누적 JSON이 불완전하면 CSV 사본을 보조로 읽습니다.
    if (!historicalSource || !isContinuousHistory(draws)) {
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

    if (officialLatest && officialLatest.round < newestAvailable.round) {
      latestVerification = 'mismatch';
      latestSource = '공식 조회와 누적 데이터 회차 불일치';
      errors.push(`공식 API는 ${officialLatest.round}회, 보유 자료는 ${newestAvailable.round}회까지 포함합니다. 최신 여부를 재확인하세요.`);
    } else if (officialLatest && officialLatest.round === newestAvailable.round) {
      latest = officialLatest;
      latestVerification = 'official';
      latestSource = '동행복권 공식 API';
    } else if (officialLatest && officialLatest.round > newestAvailable.round) {
      latest = officialLatest;
      latestVerification = 'official';
      latestSource = '동행복권 공식 API';
    } else if (mirrorLatest && mirrorLatest.round === newestAvailable.round) {
      latest = mirrorLatest;
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
  $('checkRound').value = unverifiedFallback ? '' : latest.round;
  $('statDrawCount').textContent = draws.length.toLocaleString();
}

function navigate(page) {
  document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===`page-${page}`));
  document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
  const labels = {home:'데이터와 무작위 조합으로 만드는 나만의 번호',generator:'원하는 방식으로 로또 번호 조합 생성',stats:'역대 당첨번호 통계와 숫자 분포 분석',analytics:'전체 회차 기반 고급 통계와 무작위 시뮬레이션',checker:'저장한 조합 및 직접 입력 번호 당첨 확인',saved:'내가 보관한 번호 조합 관리',history:'회차별 로또 6/45 당첨 결과'};
  $('pageSubtitle').textContent = labels[page] || labels.home;
  if (page === 'analytics') renderAnalytics();
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
  const ordered = [...draws].sort((a,b)=>a.round-b.round);
  if (analyticsPeriod === 'all') return ordered;
  const count = Number(analyticsPeriod);
  return Number.isInteger(count) && count > 0 ? ordered.slice(-count) : ordered;
}

function calculateAnalytics(input) {
  const sample = (Array.isArray(input) ? input : [])
    .filter(draw => draw && Number.isInteger(Number(draw.round)) && Array.isArray(draw.numbers)
      && draw.numbers.length === 6 && new Set(draw.numbers).size === 6
      && draw.numbers.every(n => Number.isInteger(n) && n >= 1 && n <= 45))
    .map(draw => ({...draw, round:Number(draw.round), numbers:sortNums(draw.numbers)}))
    .sort((a,b)=>a.round-b.round);
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
  $('historyList').innerHTML = `<div class="table-wrap"><table><thead><tr><th>회차</th><th>추첨일</th><th>당첨번호</th><th>보너스</th><th>1등 당첨자</th></tr></thead><tbody>${pageRows.map(draw=>{
    const rank1 = draw.ranks?.find(item=>Number(item.rank)===1);
    const winners = rank1?.winners;
    return `<tr><td><strong>${draw.round}회</strong></td><td>${escapeHtml(draw.date || '-')}</td><td><div class="history-row">${draw.numbers.map(n=>ball(n,true)).join('')}</div></td><td>${ball(draw.bonus,true,true)}</td><td>${winners != null && Number.isFinite(Number(winners)) ? `${formatNumber(winners)}명` : '-'}</td></tr>`;
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

async function importSavedBackup(file) {
  if (!file) return;
  if (file.size > MAX_BACKUP_FILE_SIZE) return toast(`백업 파일은 ${(MAX_BACKUP_FILE_SIZE / 1024 / 1024).toFixed(0)}MB 이하만 불러올 수 있습니다.`);
  try {
    const raw = JSON.parse(await file.text());
    const rows = Array.isArray(raw) ? raw : raw?.saved;
    if (!Array.isArray(rows)) throw new Error('저장 번호 목록이 없습니다.');
    const normalized = rows.map(normalizeSavedEntry).filter(Boolean);
    if (!normalized.length && rows.length) throw new Error('유효한 번호 조합이 없습니다.');
    const localByNumbers = new Map(saved.map(entry=>[entry.numbers.join('-'),entry]));
    const importedIdMap = new Map();
    let added = 0;
    normalized.forEach(entry=>{
      const key = entry.numbers.join('-');
      let local = localByNumbers.get(key);
      if (!local) {
        local = {...entry,id:`import-${Date.now()}-${added}`,syncUpdatedAt:entry.syncUpdatedAt || new Date().toISOString()};
        saved.push(local); localByNumbers.set(key,local); added++;
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
    const importedHistory = Array.isArray(raw?.savedCheckHistory) ? raw.savedCheckHistory.map(normalizeSavedCheckRecord).filter(Boolean) : [];
    const historyKeys = new Set(savedCheckHistory.map(row=>`${Number(row.round)}:${String(row.savedId || row.id)}`));
    let historyAdded = 0;
    importedHistory.forEach(row=>{
      const local = localByNumbers.get(row.numbers.join('-'));
      if (local) row.savedId = local.id;
      else if (importedIdMap.has(row.savedId)) row.savedId = importedIdMap.get(row.savedId);
      const key=`${Number(row.round)}:${String(row.savedId || row.id)}`;
      if(!historyKeys.has(key)){
        row.id = key;
        savedCheckHistory.push(row); historyKeys.add(key); historyAdded++;
      }
    });
    if (raw?.autoCheckMeta && typeof raw.autoCheckMeta === 'object') {
      const importedRound = Number(raw.autoCheckMeta.lastRound);
      const newestKnownRound = Number(draws.at(-1)?.round || latest?.round || 0);
      if (Number.isSafeInteger(importedRound) && importedRound >= 0 && newestKnownRound > 0) {
        autoCheckMeta.lastRound = Math.max(autoCheckMeta.lastRound || 0, Math.min(importedRound,newestKnownRound));
      }
      const importedCheckedAt = normalizeSyncTimestamp(raw.autoCheckMeta.lastCheckedAt);
      if (importedCheckedAt && (!autoCheckMeta.lastCheckedAt || importedCheckedAt > autoCheckMeta.lastCheckedAt)) {
        autoCheckMeta.lastCheckedAt = importedCheckedAt;
      }
      autoCheckMeta.lastStatus = '백업에서 복원 · 회차 기준 검증 완료';
      persistAutoCheckMeta();
    }
    persistSavedCheckHistory();
    persistSaved();
    renderSavedReports();
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
      for (const number of available) lowestExposure = Math.min(lowestExposure, exposure[number]);
      const leastUsed = available.filter(number => exposure[number] === lowestExposure);
      const sample = Number(rng());
      const safeSample = Number.isFinite(sample) ? Math.max(0,Math.min(0.999999999999,sample)) : 0;
      const chosen = leastUsed[Math.floor(safeSample * leastUsed.length)];
      combo.push(chosen);
      available.splice(available.indexOf(chosen),1);
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
  const covered = new Set();
  const exposure = Array(46).fill(0);
  let any3 = false, any4 = false, any5 = false, any6 = false;
  for (const ticket of portfolio) {
    let matches = 0;
    for (const number of ticket) {
      covered.add(number);
      exposure[number]++;
      if (drawNumbers.includes(number)) matches++;
    }
    if (matches >= 3) any3 = true;
    if (matches >= 4) any4 = true;
    if (matches >= 5) any5 = true;
    if (matches === 6) any6 = true;
  }
  return {coverage:covered.size,maxExposure:Math.max(...exposure.slice(1)),any3,any4,any5,any6};
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
    const randomPortfolio = createRandomPortfolio(state.ticketCount,rng);
    const coveragePortfolio = createCoveragePortfolio(state.ticketCount,[],rng);

    for (const [name,portfolio] of [['random',randomPortfolio],['coverage',coveragePortfolio]]) {
      const score = evaluateTicketPortfolio(portfolio,draw);
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
function renderGenerated() {
  $('resultCount').textContent = `${generated.length} 조합`;
  if (!generated.length) {
    $('results').className='empty';
    $('results').innerHTML='아직 생성된 조합이 없습니다.<br>왼쪽에서 방식을 선택하고 생성 버튼을 눌러주세요.';
    return;
  }
  $('results').className='result-list';
  $('results').innerHTML=generated.map((numbers,index)=>`<div class="result-row"><div class="result-left"><span class="result-index">${String(index+1).padStart(2,'0')}</span><div class="result-balls">${numbers.map(n=>ball(n,true)).join('')}</div></div><div class="result-actions"><button class="mini-btn" data-save-result="${index}">저장</button><button class="mini-btn" data-copy-result="${index}">복사</button></div></div>`).join('');
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
  renderGenerated();
  if (generated.length<quantity) toast(`${generated.length}개 조합을 만들었습니다. 조건을 만족하는 서로 다른 조합이 부족합니다.`);
  else if (activeMode==='stats') { const count=drawsForStatsWeighting().length; toast(`${count}회 데이터의 출현 빈도를 약하게 반영했습니다. 당첨 확률은 동일합니다.`); }
  else if (activeMode==='hybrid') { const count=drawsForStatsWeighting().length; toast(`${count}회 통계 참고 조합과 균등 무작위 조합을 50:50으로 혼합했습니다.`); }
  else if (activeMode==='coverage') toast('기존 저장 조합까지 고려해 번호 사용량을 분산했습니다. 1등 확률은 조합 수가 같으면 동일합니다.');
}

function saveCombination(numbers,mode=activeMode) {
  if (!Array.isArray(numbers) || numbers.length!==6 || new Set(numbers).size!==6 || numbers.some(n=>!Number.isInteger(n)||n<1||n>45)) return toast('저장할 번호 조합이 올바르지 않습니다.');
  const key=numbers.join('-');
  if (saved.some(entry=>Array.isArray(entry.numbers) && entry.numbers.join('-')===key)) return toast('이미 보관함에 저장된 조합입니다.');
  saved.unshift({id:`${Date.now()}-${Math.random().toString(16).slice(2)}`,numbers:sortNums(numbers),mode,date:new Date().toLocaleDateString('ko-KR'),favorite:false,syncUpdatedAt:new Date().toISOString()});
  if (!autoCheckMeta.lastRound && dataReady && latestVerification === 'official' && Number(latest?.round)>0) {
    autoCheckMeta.lastRound = Number(latest.round);
    autoCheckMeta.lastCheckedAt = new Date().toISOString();
    autoCheckMeta.lastStatus = '첫 저장 시점 기준 회차 설정';
    persistAutoCheckMeta();
  }
  persistSaved();
  renderSavedReports();
  toast('번호를 보관함에 저장했습니다.');
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


function loadCloudSession() {
  try { return JSON.parse(localStorage.getItem(CLOUD_SESSION_KEY) || 'null'); } catch (_) { return null; }
}
function saveCloudSession(session) {
  cloudSession = session || null;
  try { if (cloudSession) localStorage.setItem(CLOUD_SESSION_KEY, JSON.stringify(cloudSession)); else localStorage.removeItem(CLOUD_SESSION_KEY); } catch (_) {}
  renderCloudAuth();
}
function cloudTombstonesStorageKey() {
  const userId=cloudSession?.user?.id;
  return userId ? CLOUD_TOMBSTONES_KEY+':'+userId : CLOUD_TOMBSTONES_KEY+':local';
}
function loadCloudTombstones() {
  try { const rows=JSON.parse(localStorage.getItem(cloudTombstonesStorageKey())||'[]'); return Array.isArray(rows)?rows:[]; } catch (_) { return []; }
}
function persistCloudTombstones(rows) {
  try { localStorage.setItem(cloudTombstonesStorageKey(), JSON.stringify(rows.slice(-50000))); } catch (_) {}
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
async function cloudRequest(path, options={}, token=null) {
  const response=await fetch(SUPABASE_URL+path,{...options,headers:{...cloudHeaders(token),...(options.headers||{})}});
  const body=await response.text();
  let data=null; try{data=body?JSON.parse(body):null;}catch(_){data={message:body};}
  if(!response.ok) {
    const error=new Error(data?.msg||data?.message||data?.error_description||data?.error||('HTTP '+response.status));
    error.status=response.status;
    error.code=data?.code||data?.error_code||null;
    throw error;
  }
  return data;
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
      try { storedSession=JSON.parse(localStorage.getItem(CLOUD_SESSION_KEY)||'null'); } catch (_) {}
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

  saveCloudSession({...refreshed,expires_at:Math.floor(Date.now()/1000)+Number(refreshed.expires_in||3600)});
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
  const local = localSaved.find(entry => entry.numbers.join('-') === item.numbers.join('-'));
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

async function cloudUpsert(rows, token) {
  if(!rows.length)return;
  const batchSize=250;
  const base='/rest/v1/lucky645_sync_records?on_conflict=user_id,category,record_key';
  for(let index=0;index<rows.length;index+=batchSize) {
    const batch=rows.slice(index,index+batchSize);
    const payload=batch.map(row=>({
      user_id:cloudSession.user.id,
      category:row.category,
      record_key:row.record_key,
      payload:row.payload||{},
      deleted_at:row.deleted_at||null,
      updated_at:new Date().toISOString()
    }));
    await cloudRequest(base,{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(payload)},token);
  }
}
async function performCloudSync() {
  if(!cloudSession?.user?.id) return;
  const message=$('cloudMessage');
  if(message)message.textContent='클라우드 데이터를 안전하게 병합하는 중입니다…';
  const token=await cloudAccessToken();
  if(!token)throw new Error('로그인 세션이 만료됐습니다. 다시 로그인해 주세요.');
  const remote=await fetchAllCloudRows(token);
  const tombstoneMap=new Map(loadCloudTombstones().map(row=>[row.category+':'+row.record_key,row]));
  (remote||[]).filter(row=>row.deleted_at).forEach(row=>tombstoneMap.set(row.category+':'+row.record_key,{
    category:row.category,
    record_key:row.record_key,
    deleted_at:row.deleted_at,
    ...(typeof row.payload?.numbers_key==='string'?{numbers_key:row.payload.numbers_key}:{})
  }));
  const deleted=new Set([...tombstoneMap.keys()]);
  const deletedSavedNumbers=deletedSavedNumberMap([...tombstoneMap.values()]);
  const remoteActive=(remote||[]).filter(row=>{
    if(row.deleted_at||deleted.has(row.category+':'+row.record_key)) return false;
    if(row.category==='saved_combination'&&isSavedCombinationDeleted(row.payload,deletedSavedNumbers)) return false;
    return true;
  });
  const localSavedByNumbers=new Map(saved.map(item=>[item.numbers.join('-'),item]));
  const remoteSavedById=new Map();

  remoteActive.filter(row=>row.category==='saved_combination').forEach(row=>{
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
  remoteActive.filter(row=>row.category==='check_history').forEach(row=>{
    const item=normalizeCloudHistoryRecord(row,remoteSavedById,saved);
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

  const remoteState=remoteActive.find(row=>row.category==='auto_check_state'&&row.record_key==='default')?.payload;
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
    localStorage.setItem(SAVED_KEY,JSON.stringify(saved));
    localStorage.setItem(SAVED_CHECKS_KEY,JSON.stringify(savedCheckHistory));
    localStorage.setItem(AUTO_CHECK_KEY,JSON.stringify(autoCheckMeta));
    renderSaved();renderSavedReports();updateTopStats();
  }finally{cloudApplying=false;}

  if(dataReady && latestVerification==='official') autoCheckLatestDraw();
  if(savedBacktestResult) runSavedBacktest();

  const finalDeleted=new Set([...tombstoneMap.keys()]);
  const finalDeletedSavedNumbers=deletedSavedNumberMap([...tombstoneMap.values()]);
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
  await cloudUpsert([...activeRows,...deletedRows],token);
  if(message)message.textContent='동기화 완료: 저장 조합 '+saved.length+'개 · 확인 이력 '+savedCheckHistory.length+'건. 이 기기와 클라우드 데이터를 병합했습니다.';
}
async function syncCloudData() {
  if(!cloudSession?.user?.id) return;
  if(cloudSyncPromise) {
    cloudSyncRequested=true;
    return cloudSyncPromise;
  }
  cloudSyncPromise=performCloudSync();
  try {
    return await cloudSyncPromise;
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
  $('runPortfolioSimulationBtn').addEventListener('click',runPortfolioSimulation);
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
    if (save) saveCombination(generated[Number(save.dataset.saveResult)]);
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
