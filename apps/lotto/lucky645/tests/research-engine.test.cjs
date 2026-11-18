'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/research.js'), 'utf8');
function loadResearch() {
  const context = { setTimeout };
  vm.runInNewContext(source, context);
  return context.Lucky645Research;
}
function makeDraws(count = 220) {
  return Array.from({ length: count }, (_, index) => ({
    round: index + 1,
    numbers: Array.from({ length: 6 }, (_, offset) => ((index * 7 + offset * 11) % 45) + 1)
  }));
}

test('research engine generates exactly 100 unique strategies', () => {
  const research = loadResearch();
  const strategies = research.generateStrategies();
  assert.equal(strategies.length, 100);
  assert.equal(new Set(strategies.map(item => item.id)).size, 100);
  assert.equal(new Set(strategies.map(item => item.family)).size, 10);
});

test('research data validation rejects gaps, invalid tickets and insufficient history', () => {
  const research = loadResearch();
  assert.equal(research.normalizeDraws(makeDraws(150)).length, 150);
  assert.throws(() => research.normalizeDraws(makeDraws(149)), /최소 150회/);
  const gap = makeDraws(150);
  gap[70].round = 999;
  assert.throws(() => research.normalizeDraws(gap), /연속되지 않습니다/);
  const invalid = makeDraws(150);
  invalid[10].numbers = [1, 1, 2, 3, 4, 5];
  assert.throws(() => research.normalizeDraws(invalid), /유효하지 않은 회차/);
});

test('100 strategies compete against 100 random entrants across chronological folds', async () => {
  const research = loadResearch();
  const draws = research.normalizeDraws(makeDraws(220));
  const result = await research.evaluateStrategies(
    draws,
    research.generateStrategies(),
    null,
    { baselineCount: 100, seed: 'research-test-seed' }
  );
  assert.equal(result.strategies.length, 100);
  assert.equal(result.testCount, 44);
  assert.equal(result.trainingCount, 176);
  assert.equal(result.baselineCount, 100);
  assert.equal(result.foldCount, 4);
  assert.ok(Number.isFinite(result.baselineAverage));
  assert.ok(result.strategies.every(item => Number.isFinite(item.averageMatches)));
  assert.ok(result.strategies.every(item => Number.isFinite(item.zScore)));
  assert.ok(result.strategies.every(item => item.baselineAverage === result.baselineAverage));
  assert.ok(result.strategies.every(item => item.foldStats.length === result.foldCount));
  assert.ok(result.strategies.every(item => item.positiveFolds >= 0 && item.positiveFolds <= result.foldCount));
  assert.ok(result.strategies.every(item => item.randomWinRate >= 0 && item.randomWinRate <= 1));
  assert.equal(result.tournament.randomBaselineCount, 100);
  assert.equal(result.tournament.strategyCount, 100);
  assert.ok(result.tournament.randomP05 <= result.tournament.randomP50);
  assert.ok(result.tournament.randomP50 <= result.tournament.randomP95);
  assert.equal(result.thresholdZ, 3.5);
});

test('random tournament is reproducible for the same seed', async () => {
  const research = loadResearch();
  const draws = research.normalizeDraws(makeDraws(180));
  const strategies = research.generateStrategies();
  const first = await research.evaluateStrategies(draws, strategies, null, { baselineCount: 100, seed: 'stable-seed' });
  const second = await research.evaluateStrategies(draws, strategies, null, { baselineCount: 100, seed: 'stable-seed' });
  assert.equal(first.baselineAverage, second.baselineAverage);
  assert.deepEqual(
    first.strategies.slice(0, 10).map(item => [item.id, item.averageMatches, item.randomWinRate, item.positiveFolds]),
    second.strategies.slice(0, 10).map(item => [item.id, item.averageMatches, item.randomWinRate, item.positiveFolds])
  );
});

test('exact match distribution sums to one and jackpot probability matches 6/45', () => {
  const research = loadResearch();
  const distribution = research.exactMatchDistribution();
  assert.equal(distribution.length, 7);
  assert.ok(Math.abs(distribution.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.ok(Math.abs(distribution[6] - 1 / 8145060) < 1e-15);
});

test('Monte Carlo simulation accounts for six selections per draw and every result', async () => {
  const research = loadResearch();
  const result = await research.runMonteCarlo(1000, [1, 2, 3, 4, 5, 6]);
  assert.equal(result.attempts, 1000);
  assert.equal(result.totalSelections, 6000);
  assert.equal(result.numberCounts.reduce((sum, value) => sum + value, 0), 6000);
  assert.equal(result.matchCounts.reduce((sum, value) => sum + value, 0), 1000);
  assert.equal(result.groupedObserved.reduce((sum, value) => sum + value, 0), 1000);
  assert.ok(result.numberCounts.slice(1).every(value => Number.isInteger(value)));
});

test('research protocol refuses non-requested simulation and strategy counts', async () => {
  const research = loadResearch();
  await assert.rejects(
    research.runStudy(makeDraws(160), { strategyCount: 50, simulations: 1000000 }),
    /100개 전략/
  );
  await assert.rejects(
    research.runStudy(makeDraws(160), { strategyCount: 100, simulations: 10000 }),
    /1,000,000회/
  );
  await assert.rejects(
    research.runStudy(makeDraws(160), { strategyCount: 100, simulations: 1000000, baselineCount: 50 }),
    /100~500명/
  );
});
