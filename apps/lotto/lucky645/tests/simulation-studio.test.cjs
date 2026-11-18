'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const start = appSource.indexOf('function simulationRandomIndex(');
const end = appSource.indexOf('\nasync function runPortfolioSimulation()', start);
assert.notEqual(start, -1, 'simulation helpers must exist');
assert.notEqual(end, -1, 'simulation helpers must end before portfolio simulation');

function seededRng(seed = 123456789) {
  let value = seed >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makeContext() {
  const context = {};
  vm.runInNewContext(
    appSource.slice(start, end) +
      '\nthis.createFrequencySimulationState=createFrequencySimulationState;' +
      '\nthis.simulateFrequencyDraw=simulateFrequencyDraw;' +
      '\nthis.simulateFrequencyDistribution=simulateFrequencyDistribution;' +
      '\nthis.simulateFrequencyDistributionAsync=simulateFrequencyDistributionAsync;' +
      '\nthis.rankSimulationNumbers=rankSimulationNumbers;' +
      '\nthis.buildSimulationCombinations=buildSimulationCombinations;',
    context
  );
  context.window = { setTimeout: callback => setTimeout(callback, 0) };
  return context;
}

test('one simulated draw selects exactly six distinct valid numbers', () => {
  const context = makeContext();
  const counts = Array(46).fill(0);
  context.simulateFrequencyDraw(counts, () => 0.5);
  assert.equal(counts.reduce((sum, count) => sum + count, 0), 6);
  assert.equal(counts.slice(1).filter(count => count === 1).length, 6);
  assert.equal(counts.slice(1).filter(count => count > 1).length, 0);
  assert.equal(counts[0], 0);
});

test('frequency simulation counts all six numbers per draw and returns the theoretical baseline', () => {
  const context = makeContext();
  const result = context.simulateFrequencyDistribution(1000, seededRng(20261119));
  assert.equal(result.attempts, 1000);
  assert.equal(result.totalNumbers, 6000);
  assert.equal(result.numberCounts.length, 46);
  assert.equal(result.numberCounts[0], 0);
  assert.equal(result.expectedPerNumber, 6000 / 45);
  assert.ok(result.numberCounts.slice(1).every(count => Number.isInteger(count) && count >= 0));
  assert.ok(Number.isFinite(result.chiSquare) && result.chiSquare >= 0);
  assert.equal(result.ranking.length, 45);
});

test('frequency simulation is reproducible with the same seeded random stream', () => {
  const context = makeContext();
  const a = context.simulateFrequencyDistribution(10000, seededRng(77));
  const b = context.simulateFrequencyDistribution(10000, seededRng(77));
  assert.deepEqual(Array.from(a.numberCounts), Array.from(b.numberCounts));
  assert.deepEqual(
    Array.from(a.ranking, row => [row.number, row.count]),
    Array.from(b.ranking, row => [row.number, row.count])
  );
});

test('frequency ranking sorts by count descending and breaks ties by number ascending', () => {
  const context = makeContext();
  const counts = Array.from({ length: 45 }, (_, index) => index < 3 ? 9 : 1);
  const ranking = context.rankSimulationNumbers({ counts });
  assert.deepEqual(
    Array.from(ranking.slice(0, 4), row => [row.number, row.count]),
    [[1, 9], [2, 9], [3, 9], [4, 1]]
  );
});

test('frequency simulation rejects unsupported sample sizes', () => {
  const context = makeContext();
  assert.throws(
    () => context.simulateFrequencyDistribution(1234, seededRng()),
    /1,000 \/ 10,000 \/ 50,000 \/ 100,000/
  );
});

test('chunked frequency simulation reports progress and preserves all counts', async () => {
  const context = makeContext();
  const progress = [];
  const result = await context.simulateFrequencyDistributionAsync(
    10000,
    seededRng(20261119),
    (completed, total) => progress.push([completed, total])
  );
  assert.equal(result.totalNumbers, 60000);
  assert.deepEqual(progress, [[0, 10000], [5000, 10000], [10000, 10000]]);
});

test('simulation combination builder creates unique six-number tickets from the top candidate pool', () => {
  const context = makeContext();
  const profile = { counts: Array.from({ length: 45 }, (_, index) => 100 - index) };
  const result = context.buildSimulationCombinations(profile, 8, 10, seededRng(20261119));
  assert.deepEqual(Array.from(result.pool), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(result.tickets.length, 10);
  const keys = result.tickets.map(ticket => Array.from(ticket).join('-'));
  assert.equal(new Set(keys).size, 10);
  for (const ticket of result.tickets) {
    assert.equal(ticket.length, 6);
    assert.equal(new Set(ticket).size, 6);
    assert.deepEqual(Array.from(ticket), [...ticket].sort((a, b) => a - b));
    assert.ok(ticket.every(number => result.pool.includes(number)));
  }
});

test('simulation combination builder skips tickets already in the saved collection', () => {
  const context = makeContext();
  const profile = { counts: Array.from({ length: 45 }, (_, index) => 100 - index) };
  const existing = [{ numbers: [1, 2, 3, 4, 5, 6] }];
  const result = context.buildSimulationCombinations(profile, 8, 10, seededRng(12), existing);
  assert.equal(result.tickets.length, 10);
  assert.ok(result.tickets.every(ticket => ticket.join('-') !== '1-2-3-4-5-6'));
});

test('six-number candidate pool produces at most one unique ticket', () => {
  const context = makeContext();
  const profile = { counts: Array.from({ length: 45 }, (_, index) => 100 - index) };
  const result = context.buildSimulationCombinations(profile, 6, 10, seededRng(9));
  assert.equal(result.tickets.length, 1);
  assert.deepEqual(Array.from(result.tickets[0]), [1, 2, 3, 4, 5, 6]);
});

test('simulation combination builder rejects unsupported controls', () => {
  const context = makeContext();
  const profile = { counts: Array.from({ length: 45 }, (_, index) => 100 - index) };
  assert.throws(() => context.buildSimulationCombinations(profile, 7, 3, seededRng()), /후보 번호 수/);
  assert.throws(() => context.buildSimulationCombinations(profile, 8, 4, seededRng()), /후보 번호 수/);
});
