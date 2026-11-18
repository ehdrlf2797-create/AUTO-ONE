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

  function percentile(sortedValues, fraction) {
    if (!sortedValues.length) return 0;
    const index = Math.max(0, Math.min(sortedValues.length - 1, Math.ceil(fraction * sortedValues.length) - 1));
    return sortedValues[index];
  }

  async function evaluateStrategies(draws, strategies, onProgress, options) {
    const { prefix, lastSeen } = buildPrefixData(draws);
    const testStart = Math.max(100, Math.floor(draws.length * 0.8));
    const testCount = draws.length - testStart;
    if (testCount < 30) throw new Error('독립 검증 구간이 30회보다 짧습니다.');

    const baselineCount = Math.max(100, Math.min(500, Math.floor(Number(options && options.baselineCount) || 200)));
    const foldCount = Math.min(5, Math.max(3, Math.floor(testCount / 10)));
    const seed = String(options && options.seed || 'lucky645-research-default-v2');
    const baselineSumByOffset = new Float64Array(testCount);
    const foldBounds = Array.from({ length: foldCount }, (_, fold) => ({
      start: Math.floor(fold * testCount / foldCount),
      end: Math.floor((fold + 1) * testCount / foldCount)
    }));
    const baselineEntrants = [];
    const baselineFoldTotals = Array(foldCount).fill(0);
    let baselineTotal = 0;

    // 토너먼트의 무작위 기준선은 하나의 운 좋은 조합이 아니라 독립 시드의 무작위 참가자 여러 명으로 구성합니다.
    for (let entrantIndex = 0; entrantIndex < baselineCount; entrantIndex++) {
      const rng = createRng('lucky645:random-entrant:v2:' + seed + ':' + entrantIndex);
      let total = 0;
      const foldTotals = Array(foldCount).fill(0);
      for (let offset = 0; offset < testCount; offset++) {
        const actual = draws[testStart + offset].numbers;
        const matches = scoreTicket(randomTicket(rng), actual);
        total += matches;
        baselineTotal += matches;
        baselineSumByOffset[offset] += matches;
        for (let fold = 0; fold < foldCount; fold++) {
          if (offset >= foldBounds[fold].start && offset < foldBounds[fold].end) {
            foldTotals[fold] += matches;
            baselineFoldTotals[fold] += matches;
            break;
          }
        }
      }
      baselineEntrants.push({ averageMatches: total / testCount, foldTotals });
      if ((entrantIndex + 1) % 25 === 0) {
        if (typeof onProgress === 'function') onProgress({ stage: 'baselines', completed: entrantIndex + 1, total: baselineCount });
        await new Promise((resolve) => root.setTimeout(resolve, 0));
      }
    }

    const baselineAverage = baselineTotal / (baselineCount * testCount);
    const baselineByRound = Array.from(baselineSumByOffset, value => value / baselineCount);
    const baselineFoldAverages = foldBounds.map((bounds, fold) => {
      const length = Math.max(1, bounds.end - bounds.start);
      return baselineFoldTotals[fold] / (baselineCount * length);
    });
    const randomScores = baselineEntrants.map(item => item.averageMatches).sort((a, b) => a - b);
    const randomMean = baselineAverage;
    const randomVariance = randomScores.reduce((sum, value) => sum + (value - randomMean) ** 2, 0) / Math.max(1, randomScores.length - 1);
    const randomStdDev = Math.sqrt(randomVariance);
    const results = [];

    for (let strategyIndex = 0; strategyIndex < strategies.length; strategyIndex++) {
      const strategy = strategies[strategyIndex];
      const rng = createRng('lucky645:' + strategy.id + ':v2:' + seed);
      let total = 0, hits3 = 0, hits4 = 0, hits5 = 0, hits6 = 0;
      let diffTotal = 0, diffSquares = 0;
      const foldTotals = Array(foldCount).fill(0);
      const foldHits3 = Array(foldCount).fill(0);

      for (let offset = 0; offset < testCount; offset++) {
        const index = testStart + offset;
        const ticket = pickStrategyTicket(strategy, index, prefix, lastSeen, rng);
        const matches = scoreTicket(ticket, draws[index].numbers);
        const difference = matches - baselineByRound[offset];
        total += matches;
        if (matches >= 3) hits3++;
        if (matches >= 4) hits4++;
        if (matches >= 5) hits5++;
        if (matches === 6) hits6++;
        diffTotal += difference;
        diffSquares += difference * difference;
        for (let fold = 0; fold < foldCount; fold++) {
          if (offset >= foldBounds[fold].start && offset < foldBounds[fold].end) {
            foldTotals[fold] += matches;
            if (matches >= 3) foldHits3[fold]++;
            break;
          }
        }
      }

      const averageMatches = total / testCount;
      const delta = diffTotal / testCount;
      const variance = Math.max(0, diffSquares / testCount - delta * delta);
      const standardError = Math.sqrt(variance / testCount);
      const zScore = standardError > 0 ? delta / standardError : 0;
      const foldStats = foldBounds.map((bounds, fold) => {
        const length = Math.max(1, bounds.end - bounds.start);
        const average = foldTotals[fold] / length;
        const foldDelta = average - baselineFoldAverages[fold];
        return {
          fold: fold + 1,
          startRound: draws[testStart + bounds.start].round,
          endRound: draws[testStart + bounds.end - 1].round,
          testCount: length,
          averageMatches: average,
          baselineAverage: baselineFoldAverages[fold],
          delta: foldDelta,
          hit3Rate: foldHits3[fold] / length
        };
      });
      const positiveFolds = foldStats.filter(item => item.delta > 0).length;
      const randomWins = randomScores.filter(value => value <= averageMatches).length;
      const randomWinRate = randomWins / baselineCount;
      const adjustedSignificance = delta > 0 && zScore >= 3.5 && positiveFolds >= Math.ceil(foldCount * 0.8);
      results.push({
        ...strategy,
        testCount,
        averageMatches,
        baselineAverage,
        delta,
        hits3,
        hits4,
        hits5,
        hits6,
        hit3Rate: hits3 / testCount,
        zScore,
        foldStats,
        positiveFolds,
        foldCount,
        randomWins,
        randomWinRate,
        randomPercentile: randomWinRate * 100,
        adjustedSignificance,
        verdict: adjustedSignificance ? 'candidate' : 'not_verified'
      });
      if (typeof onProgress === 'function') onProgress({ stage: 'strategies', completed: strategyIndex + 1, total: strategies.length });
      if (strategyIndex < strategies.length - 1) await new Promise((resolve) => root.setTimeout(resolve, 0));
    }

    results.sort((a, b) =>
      b.averageMatches - a.averageMatches ||
      b.randomWinRate - a.randomWinRate ||
      b.positiveFolds - a.positiveFolds ||
      a.id.localeCompare(b.id)
    );
    const top = results[0];
    return {
      strategies: results,
      baselineAverage,
      testStartRound: draws[testStart].round,
      testEndRound: draws[draws.length - 1].round,
      testCount,
      trainingCount: testStart,
      candidateCount: results.filter((item) => item.adjustedSignificance).length,
      thresholdZ: 3.5,
      foldCount,
      baselineCount,
      tournament: {
        entrantCount: baselineCount + strategies.length,
        strategyCount: strategies.length,
        randomBaselineCount: baselineCount,
        randomMean,
        randomStdDev,
        randomP05: percentile(randomScores, 0.05),
        randomP50: percentile(randomScores, 0.50),
        randomP95: percentile(randomScores, 0.95),
        topStrategyId: top && top.id,
        topStrategyAverage: top ? top.averageMatches : 0,
        topStrategyRandomWinRate: top ? top.randomWinRate : 0,
        note: '무작위 참가자들은 동일한 검증 회차에서 각각 독립된 시드로 생성되었습니다. 토너먼트 순위는 과거 검증 결과이며 미래 당첨 확률을 뜻하지 않습니다.'
      },
      note: '전략 성능은 동일 회차의 무작위 참가자 평균과 비교하고, 5개 시간순 구간에서 재현성을 확인합니다. 후보 등록은 양의 차이, z ≥ 3.5, 80% 이상 구간의 양의 차이를 모두 요구하는 탐색 기준입니다.'
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

  async function runMonteCarlo(attempts, referenceTicket, onProgress, seed) {
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
    const rng = createRng('lucky645-monte-carlo-1m-v2:' + String(seed || 'default'));
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
    const baselineCount = Number(options && options.baselineCount || 200);
    if (strategyCount !== 100) throw new Error('현재 연구 프로토콜은 100개 전략 비교로 고정되어 있습니다.');
    if (attempts !== 1000000) throw new Error('현재 연구 프로토콜은 1,000,000회 시뮬레이션으로 고정되어 있습니다.');
    if (!Number.isInteger(baselineCount) || baselineCount < 100 || baselineCount > 500) {
      throw new Error('무작위 토너먼트 참가자는 100~500명 범위여야 합니다.');
    }
    const seed = String(options && options.seed || 'run-' + Date.now());
    const strategies = generateStrategies();
    const evaluation = await evaluateStrategies(draws, strategies, progress => {
      if (typeof onProgress === 'function') onProgress(progress);
    }, { baselineCount, seed });
    const monteCarlo = await runMonteCarlo(attempts, [1, 2, 3, 4, 5, 6], (done, total) => {
      if (typeof onProgress === 'function') onProgress({ stage: 'montecarlo', completed: done, total });
    }, seed);
    const createdAt = new Date().toISOString();
    return {
      version: 2,
      runId: createdAt + '-' + seed,
      seed,
      createdAt,
      elapsedMs: null,
      drawCount: draws.length,
      firstRound: draws[0].round,
      lastRound: draws[draws.length - 1].round,
      strategyCount: strategies.length,
      simulationCount: attempts,
      baselineCount,
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
