(function (root) {
  'use strict';

  const ENDPOINTS = Object.freeze({
    history: Object.freeze([
      '/api/lotto?type=all',
      'https://raw.githubusercontent.com/visionary153/lotto-api/main/results/all.json',
      'https://visionary153.github.io/lotto-api/results/all.json'
    ]),
    latestProxy: '/api/lotto?type=latest',
    officialLatest: 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do',
    latestMirror: 'https://raw.githubusercontent.com/visionary153/lotto-api/main/results/latest.json',
    roundProxy: '/api/lotto?type=round',
    officialRound: 'https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do',
    csvHistory: 'https://cashlogy.kr/lotto/excel.csv'
  });

  function createAdapter(options = {}) {
    const fetchImpl = options.fetchImpl || root.fetch?.bind(root);
    const AbortControllerImpl = options.AbortController || root.AbortController;
    const setTimer = options.setTimeout || root.setTimeout?.bind(root);
    const clearTimer = options.clearTimeout || root.clearTimeout?.bind(root);
    const normalizeDraw = options.normalizeDraw;

    function startRequest(timeout) {
      if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
      if (typeof AbortControllerImpl !== 'function') throw new TypeError('AbortController is required.');
      if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
        throw new TypeError('Timer functions are required.');
      }
      const controller = new AbortControllerImpl();
      const timer = setTimer(() => controller.abort(), timeout);
      return {controller,timer};
    }

    async function getJson(url, timeout = 12000) {
      const {controller,timer} = startRequest(timeout);
      try {
        const response = await fetchImpl(url, {
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
          headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const type = response.headers?.get?.('content-type') || '';
        const body = await response.text();
        if (type.includes('text/html') || body.trimStart().startsWith('<')) {
          throw new Error('JSON이 아닌 웹페이지가 반환됐습니다.');
        }
        try {
          return JSON.parse(body);
        } catch (_) {
          throw new Error('JSON 형식이 올바르지 않습니다.');
        }
      } finally {
        clearTimer(timer);
      }
    }

    function isUnavailableLocalProxy(url, error) {
      if (!String(url).startsWith('/api/')) return false;
      const message = String(error?.message || '');
      return /HTTP 404|Failed to parse URL|Invalid URL|relative URL/i.test(message);
    }

    async function getText(url, timeout = 12000) {
      const {controller,timer} = startRequest(timeout);
      try {
        const response = await fetchImpl(url, {
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return await response.text();
      } finally {
        clearTimer(timer);
      }
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
          cells.push(value.trim());
          value = '';
        } else value += character;
      }
      cells.push(value.trim());
      return cells;
    }

    function parseCsv(text) {
      if (typeof normalizeDraw !== 'function') {
        throw new TypeError('A draw normalizer is required to parse CSV history.');
      }
      const lines = String(text || '').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
      if (lines.length < 2) return [];
      const headers = parseCsvLine(lines[0]).map(value => value.trim());
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

    return Object.freeze({getJson,getText,isUnavailableLocalProxy,parseCsv,parseCsvLine});
  }

  root.Lucky645DataSource = Object.freeze({ENDPOINTS,createAdapter});
})(typeof window !== 'undefined' ? window : globalThis);
