(function (root) {
  'use strict';
  const ARCHIVE_SCHEMA = 'lucky645-research-history-v1';
  const MAX_RUNS = 12;
  function normalizeReport(report) {
    if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('연구 보고서 형식이 올바르지 않습니다.');
    const version = Number(report.version), createdAt = typeof report.createdAt === 'string' ? report.createdAt : '';
    const createdTime = Date.parse(createdAt), drawCount = Number(report.drawCount);
    const strategies = report.evaluation && report.evaluation.strategies;
    if (!Number.isInteger(version) || version < 1 || version > 2 || !createdAt || !Number.isFinite(createdTime) ||
        !Number.isSafeInteger(drawCount) || drawCount < 150 || !Array.isArray(strategies) || strategies.length < 1 || strategies.length > 100)
      throw new Error('필수 연구 결과 필드 또는 버전이 올바르지 않습니다.');
    for (const item of strategies) {
      const baseline = Number.isFinite(Number(item && item.baselineAverage))
        ? Number(item.baselineAverage)
        : Number(report.evaluation.baselineAverage ?? 0.8);
      const average = Number(item && item.averageMatches);
      if (!item || typeof item.id !== 'string' || !item.id || typeof item.label !== 'string' ||
          !Number.isFinite(average) || average < 0 || average > 6 ||
          !Number.isFinite(baseline) || baseline < 0 || baseline > 6 ||
          (item.delta !== undefined && !Number.isFinite(Number(item.delta))) ||
          (item.zScore !== undefined && !Number.isFinite(Number(item.zScore))))
        throw new Error('전략 성능 데이터가 올바르지 않습니다.');
    }
    const simulationCount = Number(report.simulationCount ?? (version === 1 ? 0 : NaN));
    if (!Number.isSafeInteger(simulationCount) || simulationCount < 0 || simulationCount > 10000000 || (version >= 2 && simulationCount < 1))
      throw new Error('시뮬레이션 횟수가 올바르지 않습니다.');
    const cloned = JSON.parse(JSON.stringify(report));
    cloned.runId = String(report.runId || createdAt).slice(0, 128);
    cloned.createdAt = new Date(createdTime).toISOString();
    cloned.simulationCount = simulationCount;
    cloned.evaluation.candidateCount = Number.isSafeInteger(Number(cloned.evaluation.candidateCount)) ? Number(cloned.evaluation.candidateCount) : 0;
    cloned.evaluation.strategies = cloned.evaluation.strategies.map(item => {
      const baseline = Number.isFinite(Number(item.baselineAverage)) ? Number(item.baselineAverage) : Number(cloned.evaluation.baselineAverage ?? 0.8);
      const average = Number(item.averageMatches);
      return { ...item, baselineAverage: baseline, delta: Number.isFinite(Number(item.delta)) ? Number(item.delta) : average - baseline,
        zScore: Number.isFinite(Number(item.zScore)) ? Number(item.zScore) : 0 };
    });
    return cloned;
  }
  function normalizeArchive(raw) {
    if (!raw || raw.schema !== ARCHIVE_SCHEMA || !Array.isArray(raw.runs) || raw.runs.length < 1 || raw.runs.length > 100)
      throw new Error('LUCKY 645 연구 이력 JSON 파일이 아니거나 실행 목록이 올바르지 않습니다.');
    return raw.runs.map(normalizeReport);
  }
  function mergeRuns(...groups) {
    const byId = new Map();
    for (const group of groups) for (const raw of Array.isArray(group) ? group : []) {
      let item; try { item = normalizeReport(raw); } catch (_) { continue; }
      const key = item.runId || item.createdAt, existing = byId.get(key);
      if (!existing || Date.parse(item.createdAt) > Date.parse(existing.createdAt)) byId.set(key, item);
    }
    return Array.from(byId.values()).sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0, MAX_RUNS);
  }
  const api = { normalizeReport, normalizeArchive, mergeRuns, MAX_RUNS };
  root.Lucky645ResearchHistory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
