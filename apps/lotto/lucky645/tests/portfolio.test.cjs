'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '../assets/app.js'), 'utf8');
const start = appSource.indexOf('function createCoveragePortfolio(');
const end = appSource.indexOf('\nfunction renderGenerated()', start);
assert.notEqual(start, -1, 'portfolio helpers must exist');
assert.notEqual(end, -1, 'portfolio helpers must be placed before renderGenerated');

function makeContext() {
  const context = {};
  const helpers = appSource.slice(start, end);
  vm.runInNewContext(
    'function sortNums(numbers) { return [...numbers].sort((a,b)=>a-b); }\n' +
    'function randomUnit() { return 0.5; }\n' +
    helpers +
    '\nthis.createCoveragePortfolio=createCoveragePortfolio;' +
    '\nthis.createRandomPortfolio=createRandomPortfolio;' +
    '\nthis.evaluateTicketPortfolio=evaluateTicketPortfolio;' +
    '\nthis.simulatePortfolioStrategies=simulatePortfolioStrategies;' +
    '\nthis.simulatePortfolioStrategiesAsync=simulatePortfolioStrategiesAsync;',
    context
  );
  return context;
}

function seededRng(seed = 123456789) {
  let value = seed >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

test('ten coverage tickets cover all 45 numbers with balanced exposure', () => {
  const context = makeContext();
  const tickets = context.createCoveragePortfolio(10, [], seededRng());
  assert.equal(tickets.length, 10);
  assert.equal(new Set(tickets.map(ticket => ticket.join('-'))).size, 10);

  const exposure = Array(46).fill(0);
  for (const ticket of tickets) {
    assert.equal(ticket.length, 6);
    assert.equal(new Set(ticket).size, 6);
    assert.ok(ticket.every(number => Number.isInteger(number) && number >= 1 && number <= 45));
    ticket.forEach(number => exposure[number]++);
  }

  assert.equal(exposure.slice(1).filter(count => count > 0).length, 45);
  assert.ok(Math.max(...exposure.slice(1)) - Math.min(...exposure.slice(1)) <= 1);
});

test('coverage generation avoids existing saved and already-generated tickets', () => {
  const context = makeContext();
  const existing = [[1,2,3,4,5,6], [7,8,9,10,11,12]];
  const tickets = context.createCoveragePortfolio(5, existing.map(numbers => ({numbers})), seededRng(98765));
  const allKeys = [...existing, ...tickets].map(numbers => numbers.join('-'));
  assert.equal(tickets.length, 5);
  assert.equal(new Set(allKeys).size, allKeys.length);
});

test('portfolio simulator compares equal ticket counts with identical jackpot odds', () => {
  const context = makeContext();
  const result = context.simulatePortfolioStrategies(1000, seededRng(20261118));
  assert.equal(result.attempts, 1000);
  assert.equal(result.ticketCount, 10);
  assert.equal(result.jackpotProbability, 10 / 8145060);
  assert.ok(result.coverage.coverage >= 44.9);
  assert.ok(result.random.coverage > 0 && result.random.coverage <= 45);
  for (const strategy of ['random','coverage']) {
    for (const metric of ['any3','any4','any5','any6']) {
      assert.ok(result[strategy][metric] >= 0 && result[strategy][metric] <= 1);
    }
  }
});

test('backtest range selection returns the requested latest draw window', () => {
  const start = appSource.indexOf('function selectBacktestDraws(');
  const end = appSource.indexOf('\nfunction runSavedBacktest()', start);
  assert.notEqual(start, -1, 'backtest range helper must exist');
  assert.notEqual(end, -1, 'backtest range helper must end before the runner');
  const context = {};
  vm.runInNewContext(
    appSource.slice(start, end) + '\nthis.selectBacktestDraws=selectBacktestDraws;',
    context
  );
  const history = Array.from({length:1250},(_,index)=>({round:index+1}));
  assert.equal(context.selectBacktestDraws(history,'all').length,1250);
  assert.equal(context.selectBacktestDraws(history,'100').length,100);
  assert.equal(context.selectBacktestDraws(history,'100')[0].round,1151);
  assert.equal(context.selectBacktestDraws(history,'250').at(-1).round,1250);
  assert.equal(context.selectBacktestDraws(history,'invalid').length,1250);
});

test('portfolio simulation async runner reports progress and completes in chunks', async () => {
  const context = makeContext();
  context.window = { setTimeout: callback => setTimeout(callback,0) };
  const progress = [];
  const result = await context.simulatePortfolioStrategiesAsync(
    1000,
    seededRng(20261118),
    (completed,total) => progress.push([completed,total])
  );
  assert.equal(result.attempts,1000);
  assert.equal(progress.length,4);
  assert.deepEqual(progress.map(item=>item[0]),[250,500,750,1000]);
  assert.ok(progress.every(item=>item[1]===1000));
  assert.equal(result.ticketCount,10);
});

test('portfolio simulator has a fast non-cryptographic default RNG and UI explicitly uses it', () => {
  assert.match(appSource, /function simulatePortfolioStrategies\(count, rng = Math\.random\)/);
  assert.match(appSource, /simulatePortfolioStrategiesAsync\(attempts, Math\.random,/);
  assert.match(appSource, /async function runPortfolioSimulation\(\)/);
});

test('backtest is recalculated after saved combinations and draw data change', () => {
  assert.match(appSource, /if \(savedBacktestResult\) runSavedBacktest\(\);/);
  assert.match(appSource, /savedBacktestRange'\)\.addEventListener\('change'/);
  assert.match(appSource, /fromRound:selectedDraws\[0\]\.round/);
});

test('portfolio simulator rejects unsupported run counts', () => {
  const context = makeContext();
  assert.throws(
    () => context.simulatePortfolioStrategies(1234, seededRng()),
    /1,000 \/ 5,000 \/ 10,000/
  );
});

test('coverage strategy is supported by saved tickets and check history modes', () => {
  const modes = [...appSource.matchAll(/\['random','balanced','stats','hybrid','custom','coverage'\]/g)];
  assert.ok(modes.length >= 2, 'saved ticket and check history validation should recognize coverage mode');
  assert.match(appSource, /coverage:'번호 커버리지 분산'/);
});

test('analytics preparation reuses already-normalized ordered history', () => {
  const start=appSource.indexOf('function prepareAnalyticsSample(');
  const end=appSource.indexOf('\nfunction calculateAnalytics(',start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  const context={};
  vm.runInNewContext(
    'function sortNums(numbers) { return [...numbers].sort((a,b)=>a-b); }\n' +
    appSource.slice(start,end) +
    '\nthis.prepareAnalyticsSample=prepareAnalyticsSample;',
    context
  );
  const canonical=[
    {round:1,numbers:[1,2,3,4,5,6]},
    {round:2,numbers:[2,4,6,8,10,12]}
  ];
  assert.equal(context.prepareAnalyticsSample(canonical),canonical);
});

test('analytics preparation sorts and validates non-canonical history safely', () => {
  const start=appSource.indexOf('function prepareAnalyticsSample(');
  const end=appSource.indexOf('\nfunction calculateAnalytics(',start);
  const context={};
  vm.runInNewContext(
    'function sortNums(numbers) { return [...numbers].sort((a,b)=>a-b); }\n' +
    appSource.slice(start,end) +
    '\nthis.prepareAnalyticsSample=prepareAnalyticsSample;',
    context
  );
  const input=[
    {round:2,numbers:[12,10,8,6,4,2]},
    {round:1,numbers:[6,5,4,3,2,1]},
    {round:3,numbers:[1,1,2,3,4,5]}
  ];
  const sample=context.prepareAnalyticsSample(input);
  assert.deepEqual(sample.map(row=>row.round),[1,2]);
  assert.deepEqual(sample[0].numbers,[1,2,3,4,5,6]);
  assert.deepEqual(sample[1].numbers,[2,4,6,8,10,12]);
});

test('saved backtest now precomputes draw lookups and prize tables only once', () => {
  assert.match(appSource,/const preparedDraws = selectedDraws\.map\(draw =>/);
  assert.match(appSource,/numberSet:new Set\(draw\.numbers\)/);
  assert.match(appSource,/prizeByRank/);
});

