(function (root) {
  'use strict';

  const TOTAL_COMBINATIONS = 8145060;
  const LOOKBACKS = [20, 30, 50, 75, 100, 150, 200, 300, 500, 1000];
  const FAMILIES = [
    { id: 'hot', label: '최근 빈도 상위', score: 'hot' },
    { id: 'cold', label: '최근 빈도 하위', score: 'cold' },
    { id: 'trend', label: '최근 추세', score: 'trend' },
    { id: 'overdue', label: '미출현 간격', score: 'overdue' },
    { id: 'smooth', label: '빈도 평활화', score: 'smooth' },
    { id: 'long', label: '장기 빈도', score: 'long' },
    { id: 'recent', label: '단기·장기 혼합', score: 'recent' },
    { id: 'hybrid', label: '빈도·간격 혼합', score: 'hybrid' },
    { id: 'random', label: '결정적 무작위', score: 'random' },
    { id: 'balanced', label: '구간 균형 참고', score: 'balanced' }
  ];

  function hashSeed(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0 || 1;
  }

  function createRng(seed) {
    let state = hashSeed(seed);
    return function () {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

  function chooseIndex(rng, max) {
    return Math.floor(rng() * max);
  }

  function normalizeDraws(rows) {
    if (!Array.isArray(rows)) throw new Error('회차 데이터 배열이 필요합니다.');
    const normalized = rows.map((row) => {
      const round = Number(row && row.round);
      const numbers = Array.isArray(row && row.numbers) ? row.numbers.map(Number).sort((a, b) => a - b) : [];
      if (!Number.isSafeInteger(round) || round < 1 || numbers.length !== 6 ||
          new Set(numbers).size !== 6 || numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 45)) {
        throw new Error('유효하지 않은 회차 또는 당첨번호가 포함되어 있습니다.');
      }
      return { round, numbers };
    }).sort((a, b) => a.round - b.round);
    for (let i = 1; i < normalized.length; i++) {
      if (normalized[i].round !== normalized[i - 1].round + 1) {
        throw new Error('전체 회차가 연속되지 않습니다. 데이터 연결 상태를 확인해 주세요.');
      }
    }
    if (normalized.length < 150) throw new Error('전략 검증에는 최소 150회 이상의 연속 데이터가 필요합니다.');
    return normalized;
  }

  function buildPrefixData(draws) {
    const prefix = Array(draws.length + 1);
    const lastSeen = Array(draws.length + 1);
    prefix[0] = new Int32Array(46);
    lastSeen[0] = new Int32Array(46);
    lastSeen[0].fill(-1);
    for (let i = 0; i < draws.length; i++) {
      const counts = new Int32Array(prefix[i]);
      const seen = new Int32Array(lastSeen[i]);
      for (const number of draws[i].numbers) {
        counts[number]++;
        seen[number] = i;
      }
      prefix[i + 1] = counts;
      lastSeen[i + 1] = seen;
    }
    return { prefix, lastSeen };
  }

  function generateStrategies() {
    const strategies = [];
    for (const family of FAMILIES) {
      for (const lookback of LOOKBACKS) {
        strategies.push({
          id: family.id + '-' + lookback,
          family: family.id,
          label: family.label + ' · ' + lookback + '회',
          lookback
        });
      }
    }
    return strategies;
  }

  function randomTicket(rng) {
    const selected = new Set();
    while (selected.size < 6) selected.add(1 + chooseIndex(rng, 45));
    return Array.from(selected).sort((a, b) => a - b);
  }

  function pickStrategyTicket(strategy, index, prefix, lastSeen, rng) {
    const end = index;
    const start = Math.max(0, end - strategy.lookback);
    const longStart = Math.max(0, end - Math.min(1000, strategy.lookback * 4));
    const recentStart = Math.max(0, end - Math.max(10, Math.floor(strategy.lookback / 3)));
    const recentLongStart = Math.max(0, end - Math.min(1000, strategy.lookback * 2));
    const recentCounts = prefix[end].map((value, number) => value - prefix[start][number]);
    const longCounts = prefix[end].map((value, number) => value - prefix[longStart][number]);
    const shortCounts = prefix[end].map((value, number) => value - prefix[recentStart][number]);
    const previousCounts = prefix[end].map((value, number) => value - prefix[recentLongStart][number]);
    const seen = lastSeen[end];
    const windowSize = Math.max(1, end - start);
    const shortSize = Math.max(1, end - recentStart);
    const longSize = Math.max(1, end - longStart);
    const mean = windowSize * 6 / 45;
    const scores = [];

    for (let number = 1; number <= 45; number++) {
      const count = recentCounts[number];
      const overdue = seen[number] < 0 ? end + 1 : end - seen[number];
      const trend = shortCounts[number] / shortSize - previousCounts[number] / Math.max(1, end - recentLongStart);
      let score;
      switch (strategy.family) {
        case 'hot': score = count / windowSize; break;
        case 'cold': score = -count / windowSize; break;
        case 'trend': score = trend; break;
        case 'overdue': score = overdue / Math.max(1, end); break;
        case 'smooth': score = (count + 1) / (windowSize + 45 / 6); break;
        case 'long': score = longCounts[number] / longSize; break;
        case 'recent': score = 0.7 * shortCounts[number] / shortSize + 0.3 * longCounts[number] / longSize; break;
        case 'hybrid': score = 0.75 * count / windowSize + 0.25 * overdue / Math.max(1, end); break;
        case 'random': score = rng(); break;
        case 'balanced': {
          const range = Math.floor((number - 1) / 10);
          const rangePenalty = Math.abs(range - 2) * 0.000001;
          score = (count - mean) / Math.max(1, mean) - rangePenalty;
          break;
        }
        default: score = count / windowSize;
      }
      scores.push({ number, score, tie: rng() });
    }
    scores.sort((a, b) => b.score - a.score || b.tie - a.tie || a.number - b.number);
    return scores.slice(0, 6).map((item) => item.number).sort((a, b) => a - b);
  }

  function scoreTicket(ticket, actual) {
    let matches = 0;
    for (const number of ticket) if (actual.includes(number)) matches++;
    return matches;
  }

  function evaluateStrategies(draws, strategies, onProgress) {
    const { prefix, lastSeen } = buildPrefixData(draws);
    const testStart = Math.max(100, Math.floor(draws.length * 0.8));
    const testCount = draws.length - testStart;
    if (testCount < 30) throw new Error('독립 검증 구간이 30회보다 짧습니다.');
    const baselineRng = createRng('lucky645-research-baseline-v1');
    const baselineScores = new Int8Array(testCount);
    let baselineTotal = 0;
    for (let offset = 0; offset < testCount; offset++) {
      const actual = draws[testStart + offset].numbers;
      const score = scoreTicket(randomTicket(baselineRng), actual);
      baselineScores[offset] = score;
      baselineTotal += score;
    }
    const baselineAverage = baselineTotal / testCount;
    const results = [];

    for (let strategyIndex = 0; strategyIndex < strategies.length; strategyIndex++) {
      const strategy = strategies[strategyIndex];
      const rng = createRng('lucky645:' + strategy.id + ':v1');
      let total = 0, hits3 = 0, hits4 = 0, hits5 = 0, hits6 = 0;
      let diffTotal = 0, diffSquares = 0;
      for (let offset = 0; offset < testCount; offset++) {
        const index = testStart + offset;
        const ticket = pickStrategyTicket(strategy, index, prefix, lastSeen, rng);
        const matches = scoreTicket(ticket, draws[index].numbers);
        const difference = matches - baselineScores[offset];
        total += matches;
        if (matches >= 3) hits3++;
        if (matches >= 4) hits4++;
        if (matches >= 5) hits5++;
        if (matches === 6) hits6++;
        diffTotal += difference;
        diffSquares += difference * difference;
      }
      const delta = diffTotal / testCount;
      const variance = Math.max(0, diffSquares / testCount - delta * delta);
      const standardError = Math.sqrt(variance / testCount);
      const zScore = standardError > 0 ? delta / standardError : 0;
      const adjustedSignificance = delta > 0 && zScore >= 3.5;
      results.push({
        ...strategy,
        testCount,
        averageMatches: total / testCount,
        baselineAverage,
        delta,
        hits3,
        hits4,
        hits5,
        hits6,
        hit3Rate: hits3 / testCount,
        zScore,
        adjustedSignificance,
        verdict: adjustedSignificance ? 'candidate' : 'not_verified'
      });
      if (typeof onProgress === 'function') onProgress(strategyIndex + 1, strategies.length);
    }
    results.sort((a, b) => b.averageMatches - a.averageMatches || b.hit3Rate - a.hit3Rate || a.id.localeCompare(b.id));
    return {
      strategies: results,
      baselineAverage,
      testStartRound: draws[testStart].round,
      testEndRound: draws[draws.length - 1].round,
      testCount,
      trainingCount: testStart,
      candidateCount: results.filter((item) => item.adjustedSignificance).length,
      thresholdZ: 3.5,
      note: '100개 전략에 대한 다중 비교를 고려한 보수적 탐색 기준입니다. 후보 등록은 예측 우위의 확정이나 당첨 보장을 뜻하지 않습니다.'
    };
  }

  function combinations(n, k) {
    if (k < 0 || k > n) return 0;
    let value = 1;
    for (let i = 1; i <= k; i++) value = value * (n - i + 1) / i;
    return value;
  }

  function exactMatchDistribution() {
    const total = combinations(45, 6);
    const exact = [];
    for (let matches = 0; matches <= 6; matches++) {
      exact.push(combinations(6, matches) * combinations(39, 6 - matches) / total);
    }
    return exact;
  }

  async function runMonteCarlo(attempts, referenceTicket, onProgress) {
    const count = Number(attempts);
    if (!Number.isSafeInteger(count) || count < 1 || count > 1000000) {
      throw new Error('몬테카를로 횟수는 1~1,000,000회 범위여야 합니다.');
    }
    const ticket = Array.isArray(referenceTicket) && referenceTicket.length === 6
      ? referenceTicket.slice()
      : [1, 2, 3, 4, 5, 6];
    if (new Set(ticket).size !== 6 || ticket.some((n) => !Number.isInteger(n) || n < 1 || n > 45)) {
      throw new Error('기준 조합이 올바르지 않습니다.');
    }
    const rng = createRng('lucky645-monte-carlo-1m-v1');
    const numberCounts = new Uint32Array(46);
    const matchCounts = new Uint32Array(7);
    const ticketSet = new Set(ticket);
    const batchSize = 10000;
    let completed = 0;
    while (completed < count) {
      const batchEnd = Math.min(count, completed + batchSize);
      for (; completed < batchEnd; completed++) {
        const selected = new Set();
        while (selected.size < 6) selected.add(1 + chooseIndex(rng, 45));
        let matches = 0;
        for (const number of selected) {
          numberCounts[number]++;
          if (ticketSet.has(number)) matches++;
        }
        matchCounts[matches]++;
      }
      if (typeof onProgress === 'function') onProgress(completed, count);
      if (completed < count) await new Promise((resolve) => root.setTimeout(resolve, 0));
    }
    const exact = exactMatchDistribution();
    const groupedObserved = [matchCounts[0], matchCounts[1], matchCounts[2], matchCounts[3] + matchCounts[4] + matchCounts[5] + matchCounts[6]];
    const groupedExpected = [
      exact[0] * count,
      exact[1] * count,
      exact[2] * count,
      (exact[3] + exact[4] + exact[5] + exact[6]) * count
    ];
    let chiSquare = 0;
    for (let i = 0; i < groupedObserved.length; i++) {
      const expected = groupedExpected[i];
      if (expected > 0) chiSquare += (groupedObserved[i] - expected) ** 2 / expected;
    }
    return {
      attempts: count,
      numberCounts: Array.from(numberCounts),
      matchCounts: Array.from(matchCounts),
      groupedObserved,
      groupedExpected,
      chiSquare,
      expectedPerNumber: count * 6 / 45,
      totalSelections: Array.from(numberCounts).reduce((sum, value) => sum + value, 0),
      note: '공정한 6/45 추첨의 기준 분포를 확인하는 실험입니다. 다음 회차의 번호를 예측하거나 당첨 확률을 높이지 않습니다.'
    };
  }

  async function runStudy(rows, options, onProgress) {
    const draws = normalizeDraws(rows);
    const strategyCount = Number(options && options.strategyCount || 100);
    const attempts = Number(options && options.simulations || 1000000);
    if (strategyCount !== 100) throw new Error('현재 연구 프로토콜은 100개 전략 비교로 고정되어 있습니다.');
    if (attempts !== 1000000) throw new Error('현재 연구 프로토콜은 1,000,000회 시뮬레이션으로 고정되어 있습니다.');
    const strategies = generateStrategies();
    const evaluation = evaluateStrategies(draws, strategies, (done, total) => {
      if (typeof onProgress === 'function') onProgress({ stage: 'strategies', completed: done, total });
    });
    const monteCarlo = await runMonteCarlo(attempts, [1, 2, 3, 4, 5, 6], (done, total) => {
      if (typeof onProgress === 'function') onProgress({ stage: 'montecarlo', completed: done, total });
    });
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      drawCount: draws.length,
      firstRound: draws[0].round,
      lastRound: draws[draws.length - 1].round,
      strategyCount: strategies.length,
      simulationCount: attempts,
      evaluation,
      monteCarlo
    };
  }

  root.Lucky645Research = {
    TOTAL_COMBINATIONS,
    generateStrategies,
    normalizeDraws,
    evaluateStrategies,
    exactMatchDistribution,
    runMonteCarlo,
    runStudy
  };
})(typeof window !== 'undefined' ? window : globalThis);
