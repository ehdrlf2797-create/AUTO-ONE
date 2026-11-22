'use strict';

const OFFICIAL_LATEST_URL = 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do';
const HISTORY_SOURCES = [
  'https://raw.githubusercontent.com/visionary153/lotto-api/main/results/all.json',
  'https://visionary153.github.io/lotto-api/results/all.json'
];
const HISTORY_TTL_MS = 6 * 60 * 60 * 1000;
const HISTORY_MINIMUM_ROUNDS = 1000;
const REQUEST_TIMEOUT_MS = 12000;
const CACHE = globalThis.__LUCKY645_API_CACHE || (globalThis.__LUCKY645_API_CACHE = {
  history: null,
  historyFetchedAt: 0,
  historySource: null,
  latest: null,
  latestFetchedAt: 0
});

function asInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function normalizeDate(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  let normalized = null;
  if (/^\d{8}$/.test(text)) {
    normalized = text.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    normalized = text;
  }
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== normalized
    ? null
    : normalized;
}

function normalizeDraw(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const rawNumbers = raw.numbers ?? raw.winNumbers ?? [
    raw.tm1WnNo ?? raw.drwtNo1 ?? raw.n1,
    raw.tm2WnNo ?? raw.drwtNo2 ?? raw.n2,
    raw.tm3WnNo ?? raw.drwtNo3 ?? raw.n3,
    raw.tm4WnNo ?? raw.drwtNo4 ?? raw.n4,
    raw.tm5WnNo ?? raw.drwtNo5 ?? raw.n5,
    raw.tm6WnNo ?? raw.drwtNo6 ?? raw.n6
  ];
  if (!Array.isArray(rawNumbers)) return null;

  const round = asInteger(raw.round ?? raw.draw_no ?? raw.ltEpsd ?? raw.drwNo);
  const numbers = rawNumbers.map(asInteger);
  const bonus = asInteger(raw.bonus ?? raw.bonus_no ?? raw.bnsWnNo ?? raw.bnusNo);

  if (!round || round < 1 || numbers.length !== 6 ||
      numbers.some(number => number === null || number < 1 || number > 45) ||
      new Set(numbers).size !== 6 ||
      bonus === null || bonus < 1 || bonus > 45 || numbers.includes(bonus)) {
    return null;
  }

  const dateValue = raw.date || raw.ltRflYmd || raw.drwNoDate;
  const date = normalizeDate(dateValue);
  if (dateValue && !date) return null;

  let ranks;
  if (Array.isArray(raw.ranks)) {
    ranks = raw.ranks.map(item => {
      const rank = asInteger(item?.rank);
      const rawPrize = item?.prize == null ? null : asInteger(item.prize);
      const rawWinners = item?.winners == null ? null : asInteger(item.winners);
      return {
        rank,
        prize: rawPrize !== null && rawPrize >= 0 ? rawPrize : null,
        winners: rawWinners !== null && rawWinners >= 0 ? rawWinners : null
      };
    }).filter(item => item.rank !== null && item.rank >= 1 && item.rank <= 5);
  } else {
    ranks = [1, 2, 3, 4, 5].map(rank => {
      const rawPrize = asInteger(raw[`rnk${rank}WnAmt`]);
      const rawWinners = asInteger(raw[`rnk${rank}WnNope`]);
      return {
        rank,
        prize: rawPrize !== null && rawPrize >= 0 ? rawPrize : null,
        winners: rawWinners !== null && rawWinners >= 0 ? rawWinners : null
      };
    }).filter(item => item.prize !== null || item.winners !== null);
  }

  // Only the official whole-episode sales field is authoritative for sales.
  // Third-party mirrors may misuse `totalSales` for prize payouts; never trust it here.
  const rawSales = asInteger(raw.wholEpsdSumNtslAmt);
  const rawPrizePayout = asInteger(raw.rlvtEpsdSumNtslAmt ?? raw.totalPrizePayout);
  return {
    round,
    date,
    numbers: [...numbers].sort((a, b) => a - b),
    bonus,
    ranks,
    totalSales: rawSales !== null && rawSales >= 0 ? rawSales : null,
    totalPrizePayout: rawPrizePayout !== null && rawPrizePayout >= 0 ? rawPrizePayout : null,
    source: typeof raw.source === 'string' ? raw.source : undefined
  };
}

function extractOfficialLatest(payload) {
  const rows = payload?.data?.list ??
    payload?.data?.result?.pstLtEpstInfo?.lt645 ??
    payload?.list;
  if (Array.isArray(rows)) {
    const newest = rows
      .map(raw => ({
        raw,
        round: asInteger(raw?.round ?? raw?.draw_no ?? raw?.ltEpsd ?? raw?.drwNo)
      }))
      .filter(item => item.round !== null)
      .sort((a, b) => b.round - a.round)[0];
    // 최신 원본 행이 잘못된 경우 과거의 유효한 회차를 최신 결과로 가장하지 않습니다.
    return newest ? normalizeDraw(newest.raw) : null;
  }
  return normalizeDraw(payload?.data ?? payload);
}

function extractHistory(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.results ?? payload?.data ?? [];
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeDraw).filter(Boolean).sort((a, b) => a.round - b.round);
}

function isContinuousHistory(draws) {
  if (!Array.isArray(draws) || draws.length === 0) return false;
  if (draws[0].round !== 1 || draws.length !== draws[draws.length - 1].round) return false;
  for (let index = 0; index < draws.length; index += 1) {
    if (draws[index].round !== index + 1) return false;
  }
  return true;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) throw new Error(`upstream_http_${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  if (!body || contentType.includes('text/html') || body.trimStart().startsWith('<')) {
    throw new Error('upstream_non_json_response');
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error('upstream_invalid_json');
  }
}

async function getOfficialLatest() {
  if (CACHE.latest && Date.now() - CACHE.latestFetchedAt < 60_000) {
    return CACHE.latest;
  }

  const payload = await fetchJson(OFFICIAL_LATEST_URL);
  const latest = extractOfficialLatest(payload);
  if (!latest) throw new Error('official_latest_invalid');

  CACHE.latest = payload;
  CACHE.latestFetchedAt = Date.now();
  return payload;
}

async function getHistory() {
  if (CACHE.history && Date.now() - CACHE.historyFetchedAt < HISTORY_TTL_MS) {
    return { draws: CACHE.history, source: CACHE.historySource, cached: true };
  }

  const errors = [];
  for (const sourceUrl of HISTORY_SOURCES) {
    try {
      const payload = await fetchJson(sourceUrl);
      const draws = extractHistory(payload);
      if (draws.length < HISTORY_MINIMUM_ROUNDS || !isContinuousHistory(draws)) {
        throw new Error('history_integrity_check_failed');
      }

      const source = sourceUrl.includes('raw.githubusercontent.com')
        ? 'GitHub raw history mirror'
        : 'GitHub Pages history mirror';

      CACHE.history = draws;
      CACHE.historyFetchedAt = Date.now();
      CACHE.historySource = source;
      return { draws, source, cached: false };
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (CACHE.history) {
    return {
      draws: CACHE.history,
      source: CACHE.historySource,
      cached: true,
      stale: true,
      warning: 'history_upstream_unavailable'
    };
  }

  throw new Error(errors[0] || 'history_unavailable');
}

function officialCompatibleDraw(draw) {
  return {
    round: draw.round,
    date: draw.date,
    numbers: draw.numbers,
    bonus: draw.bonus,
    ranks: draw.ranks,
    totalSales: draw.totalSales,
    totalPrizePayout: draw.totalPrizePayout
  };
}

function sendJson(res, status, payload, cacheControl = 'no-store') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Origin');
  res.end(JSON.stringify(payload));
}

async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  const requestUrl = new URL(req.url || '/', 'https://auto-one.invalid');
  const kind = String(req.query?.type ?? requestUrl.searchParams.get('type') ?? 'latest');
  const roundValue = req.query?.round ?? requestUrl.searchParams.get('round');

  try {
    if (kind === 'latest') {
      const payload = await getOfficialLatest();
      return sendJson(res, 200, payload, 'public, s-maxage=60, stale-while-revalidate=120');
    }

    if (kind === 'all') {
      const result = await getHistory();
      res.setHeader('X-Lotto-Source', result.source);
      if (result.stale) res.setHeader('X-Lotto-Stale', 'true');
      return sendJson(res, 200, result.draws, 'public, s-maxage=300, stale-while-revalidate=600');
    }

    if (kind === 'round') {
      const round = asInteger(roundValue);
      if (!round || round < 1) return sendJson(res, 400, { error: 'invalid_round' });

      const result = await getHistory();
      const draw = result.draws.find(item => item.round === round);
      if (!draw) return sendJson(res, 404, { error: 'round_not_found', round });

      return sendJson(res, 200, {
        data: { list: [officialCompatibleDraw(draw)] },
        _meta: { source: result.source, verification: 'history', stale: Boolean(result.stale) }
      }, 'public, s-maxage=3600, stale-while-revalidate=86400');
    }

    if (kind === 'status') {
      return sendJson(res, 200, {
        cacheScope: 'serverless-instance-memory',
        cacheNote: '이 상태는 현재 서버리스 인스턴스의 메모리 캐시만 나타냅니다. 다른 인스턴스의 캐시 상태를 대표하지 않습니다.',
        history: {
          available: Boolean(CACHE.history),
          rounds: CACHE.history?.length || 0,
          source: CACHE.historySource,
          fetchedAt: CACHE.historyFetchedAt ? new Date(CACHE.historyFetchedAt).toISOString() : null,
          stale: Boolean(CACHE.history && Date.now() - CACHE.historyFetchedAt >= HISTORY_TTL_MS)
        },
        officialLatest: {
          available: Boolean(CACHE.latest),
          fetchedAt: CACHE.latestFetchedAt ? new Date(CACHE.latestFetchedAt).toISOString() : null
        }
      });
    }

    return sendJson(res, 400, { error: 'unsupported_type', supported: ['latest', 'all', 'round', 'status'] });
  } catch (error) {
    const safeCode = String(error?.message || 'data_unavailable').replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
    return sendJson(res, 503, {
      error: 'lotto_data_unavailable',
      code: safeCode,
      message: '공식 당첨 데이터 또는 검증된 누적 데이터를 현재 확인할 수 없습니다.'
    });
  }
}

module.exports = handler;
module.exports.__test = {
  normalizeDate,
  normalizeDraw,
  extractOfficialLatest,
  extractHistory,
  isContinuousHistory
};
