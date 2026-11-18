'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeDraw,
  extractOfficialLatest,
  extractHistory,
  isContinuousHistory
} = require('../api/lotto.js').__test;

const officialRound = {
  ltEpsd: 1250,
  ltRflYmd: '20261114',
  tm1WnNo: 1,
  tm2WnNo: 5,
  tm3WnNo: 18,
  tm4WnNo: 23,
  tm5WnNo: 27,
  tm6WnNo: 28,
  bnsWnNo: 8,
  rnk1WnNope: 9,
  rnk1WnAmt: 3103164459
};

test('normalizes an official draw into the shared LUCKY 645 model', () => {
  const draw = normalizeDraw(officialRound);

  assert.deepEqual(draw.numbers, [1, 5, 18, 23, 27, 28]);
  assert.equal(draw.round, 1250);
  assert.equal(draw.date, '2026-11-14');
  assert.equal(draw.bonus, 8);
  assert.equal(draw.ranks[0].winners, 9);
  assert.equal(draw.ranks[0].prize, 3103164459);
});

test('rejects duplicate, out-of-range and invalid bonus numbers', () => {
  assert.equal(normalizeDraw({...officialRound, tm6WnNo: 27}), null);
  assert.equal(normalizeDraw({...officialRound, tm1WnNo: 46}), null);
  assert.equal(normalizeDraw({...officialRound, bnsWnNo: 1}), null);
  assert.equal(normalizeDraw({...officialRound, ltEpsd: 0}), null);
});

test('extracts the newest valid draw from the official response shape', () => {
  const result = extractOfficialLatest({data:{list:[
    {...officialRound, ltEpsd:1249},
    officialRound
  ]}});
  assert.equal(result.round, 1250);
});

test('normalizes array history and rejects incomplete sequences', () => {
  const one = normalizeDraw({...officialRound, ltEpsd:1});
  const two = normalizeDraw({...officialRound, ltEpsd:2});
  const history = extractHistory([two, one]);

  assert.deepEqual(history.map(row => row.round), [1, 2]);
  assert.equal(isContinuousHistory(history), true);
  assert.equal(isContinuousHistory([one, {...two, round:3}]), false);
});

test('history integrity rejects gaps and duplicate rounds', () => {
  const one = normalizeDraw({...officialRound, ltEpsd:1});
  const two = normalizeDraw({...officialRound, ltEpsd:2});
  assert.equal(isContinuousHistory([one, {...two, round:3}]), false);
  assert.equal(isContinuousHistory([one, one]), false);
});

test('validates calendar dates and still allows missing optional dates', () => {
  const { normalizeDate } = require('../api/lotto.js').__test;
  assert.equal(normalizeDate('20261114'), '2026-11-14');
  assert.equal(normalizeDate('2026-11-14'), '2026-11-14');
  assert.equal(normalizeDate('20260230'), null);
  assert.equal(normalizeDate('2026-13-01'), null);
  assert.equal(normalizeDate('not-a-date'), null);
  assert.equal(normalizeDate(''), null);

  assert.equal(normalizeDraw({...officialRound, ltRflYmd:'20260230'}), null);
  assert.equal(normalizeDraw({...officialRound, ltRflYmd:''}).date, null);
});

test('does not disguise an invalid newest official row as an older valid round', () => {
  const invalidNewest = {...officialRound, ltEpsd:1251, tm1WnNo:46};
  assert.equal(extractOfficialLatest({data:{list:[officialRound, invalidNewest]}}), null);
});

test('negative optional prize, winner and sales values are discarded', () => {
  const draw = normalizeDraw({
    ...officialRound,
    ranks:[{rank:1,prize:-100,winners:-1}],
    wholEpsdSumNtslAmt:-500
  });
  assert.equal(draw.ranks[0].prize, null);
  assert.equal(draw.ranks[0].winners, null);
  assert.equal(draw.totalSales, null);
});

test('status endpoint documents that cache metrics are per serverless instance', async () => {
  const handler = require('../api/lotto.js');
  const response = {
    headers:{},
    setHeader(name,value){this.headers[name]=value;},
    end(body){this.body=body;}
  };
  await handler({method:'GET',url:'/api/lotto?type=status',query:{type:'status'}},response);
  const status = JSON.parse(response.body);
  assert.equal(response.statusCode,200);
  assert.equal(status.cacheScope,'serverless-instance-memory');
  assert.match(status.cacheNote,/다른 인스턴스의 캐시 상태를 대표하지 않습니다/);
});
