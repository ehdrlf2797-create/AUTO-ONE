(function (root) {
  'use strict';

  function createDomain() {
    function sortNumbers(numbers) {
      return [...numbers].sort((a,b)=>a-b);
    }

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
      const numbers = Array.isArray(nums) && nums.length === 6 ? nums.map(Number) : [];
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
    
      // Duplicate ranks are ambiguous and must never be used to derive a frontend payout.
      const rankCounts = new Map();
      for (const item of ranks) rankCounts.set(item.rank, (rankCounts.get(item.rank) || 0) + 1);
      ranks = ranks.filter(item => rankCounts.get(item.rank) === 1);
    
      // Official API: wholEpsdSumNtslAmt. Cashlogy CSV: totSellamnt.
      // Do not treat third-party totalSales aliases as authoritative.
      const salesValue = raw.wholEpsdSumNtslAmt != null && raw.wholEpsdSumNtslAmt !== ''
        ? Number(raw.wholEpsdSumNtslAmt)
        : (raw.totSellamnt == null || raw.totSellamnt === '' ? null : Number(raw.totSellamnt));
      const payoutValue = raw.rlvtEpsdSumNtslAmt ?? raw.totalPrizePayout;
      const payoutNumber = payoutValue == null || payoutValue === '' ? null : Number(payoutValue);
      const totalSales = Number.isSafeInteger(salesValue) && salesValue >= 0 ? salesValue : null;
      let totalPrizePayout = Number.isSafeInteger(payoutNumber) && payoutNumber >= 0 ? payoutNumber : null;
      // CSV exports rank-level individual prize and winner counts, so derive the total only
      // when all five ranks are complete. The official aggregate always takes precedence.
      const payoutRanks = [1, 2, 3, 4, 5].map(rank => ranks.find(item => item.rank === rank));
      if (totalPrizePayout === null &&
          payoutRanks.every(item => item && item.prize !== null && item.winners !== null)) {
        const derivedPayout = payoutRanks.reduce((sum, item) => sum + item.prize * item.winners, 0);
        totalPrizePayout = Number.isSafeInteger(derivedPayout) ? derivedPayout : null;
      }
    
      const dateRaw = String(raw.date ?? raw.ltRflYmd ?? raw.drwNoDate ?? '').trim();
      let date = '';
      if (/^\d{8}$/.test(dateRaw)) date = `${dateRaw.slice(0,4)}-${dateRaw.slice(4,6)}-${dateRaw.slice(6,8)}`;
      else if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) date = dateRaw;
      if (date) { const parsed = new Date(`${date}T00:00:00Z`); if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) date = ''; }
      return {
        round,
        date,
        numbers: sortNumbers(numbers),
        bonus,
        ranks,
        totalSales,
        totalPrizePayout,
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
        if (!current) {
          map.set(draw.round, draw);
          continue;
        }
    
        // Preserve winning numbers from the more trusted source, but enrich missing
        // financial fields from a lower-trust CSV backup instead of discarding them.
        const preferred = sourceTrust(draw.source) >= sourceTrust(current.source) ? draw : current;
        const fallback = preferred === draw ? current : draw;
        const fallbackRanks = new Map((fallback.ranks || []).map(item => [item.rank, item]));
        const preferredRanks = new Map((preferred.ranks || []).map(item => [item.rank, item]));
        const ranks = [...new Set([...fallbackRanks.keys(), ...preferredRanks.keys()])]
          .sort((a,b)=>a-b)
          .map(rank => {
            const main = preferredRanks.get(rank) || {};
            const extra = fallbackRanks.get(rank) || {};
            return {
              rank,
              prize: main.prize ?? extra.prize ?? null,
              winners: main.winners ?? extra.winners ?? null
            };
          });
        map.set(draw.round, {
          ...fallback,
          ...preferred,
          totalSales: preferred.totalSales ?? fallback.totalSales ?? null,
          totalPrizePayout: preferred.totalPrizePayout ?? fallback.totalPrizePayout ?? null,
          ranks
        });
      }
      return [...map.values()].sort((a,b)=>a.round-b.round);
    }
    

    return Object.freeze({
      normalizeDraw,
      extractDraws,
      normalizeOfficial,
      isContinuousHistory,
      sourceTrust,
      mergeDraws
    });
  }

  root.Lucky645DataDomain = Object.freeze({createDomain});
})(typeof window !== 'undefined' ? window : globalThis);
