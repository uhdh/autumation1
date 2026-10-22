import { median } from './buyer-core.js';

export const marketKey = g => JSON.stringify([g.gu, g.dong, g.jibun, g.name].map(v => String(v ?? '').replace(/\s/g, '')), null, 0);
export const areaKey = g => `${marketKey(g)}:${Math.floor(g.area)}`;
export function monthOffset(month, offset) {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(4)) - 1 + offset, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
// rows: [YYYYMMDD, 만원, 층, 전용면적, 거래유형]. 취소/권리 거래는 수집 단계에서 제외.
export const validSale = t => Number(t[2]) >= 5 && t[4] === '중개거래' && t[1] > 0;
export function growth(sales, asOf, interval = 3) {
  if (![3, 6, 9, 12].includes(interval)) return null;
  const end = monthOffset(asOf, -1), start = monthOffset(asOf, -3);
  const baseStart = monthOffset(start, -interval), baseEnd = monthOffset(end, -interval);
  const select = (a, b) => sales.filter(t => validSale(t) && t[0].slice(0, 6) >= a && t[0].slice(0, 6) <= b);
  const current = select(start, end), base = select(baseStart, baseEnd);
  if (base.length < 2 || current.length < 2) return null;
  const before = Math.max(...base.map(t => t[1])), after = Math.max(...current.map(t => t[1]));
  return { pct: (after / before - 1) * 100, before, after, baseCount: base.length, currentCount: current.length, baseStart, baseEnd, start, end };
}
export function jeonseRatio(sales, rents, asOf) {
  for (let i = 0; i < 6; i++) {
    const month = monthOffset(asOf, -i);
    const sale = sales.filter(t => validSale(t) && t[0].startsWith(month));
    const rent = rents[month]; // [표본 수, 보증금 합계], 월세 0인 전세만 집계
    if (sale.length && rent?.[0] > 0) {
      const saleMean = mean(sale.map(t => t[1])), rentMean = rent[1] / rent[0];
      return { month, pct: rentMean / saleMean * 100, saleMean, rentMean, saleCount: sale.length, rentCount: rent[0] };
    }
  }
  return null;
}
export function priceBasis(sales, asOf) {
  const current = sales.filter(t => validSale(t) && t[0].slice(0, 6) >= monthOffset(asOf, -2) && t[0].slice(0, 6) <= asOf).sort((a, b) => b[0].localeCompare(a[0]));
  if (current.length < 3) return null;
  // ponytail: 확보한 완전한 연도의 Q4만 사용. 2020~2023 원자료 확보 후 전고점/전저점 기준을 추가.
  for (const year of ['2024', '2025']) {
    const past = sales.filter(t => validSale(t) && t[0] >= `${year}1001` && t[0] <= `${year}1231`);
    if (past.length >= 2) return { period: `${year}Q4`, past: Math.max(...past.map(t => t[1])), current: median(current.slice(0, 3).map(t => t[1])), high: Math.max(...current.map(t => t[1])), count: current.length, pastCount: past.length };
  }
  return null;
}
export function relativeValue(target, peers) {
  if (!target.basis) return null;
  const t = target.basis;
  const comparisons = peers.filter(p => p.key !== target.key && p.area === target.area && p.basis?.period === t.period && Math.abs(p.basis.past / t.past - 1) <= .05).map(p => {
    const historic = (p.basis.past / t.past - 1) * 100;
    const delta = (p.basis.current / t.current - 1) * 100 - historic;
    const highDelta = (p.basis.high / t.high - 1) * 100 - historic;
    const classify = n => n > 1 ? 'under' : n < -1 ? 'over' : 'same';
    const category = classify(delta) === classify(highDelta) ? classify(delta) : 'mixed';
    return { key: p.key, name: p.name, gu: p.gu, dong: p.dong, past: p.basis.past, current: p.basis.current, delta, category };
  });
  const counts = Object.fromEntries(['under', 'over', 'same', 'mixed'].map(k => [k, comparisons.filter(c => c.category === k).length]));
  const n = counts.under + counts.over + counts.same;
  // 비교 단지 3개 미만은 판단 보류. 원 서비스 복제가 아닌 명시적인 자체 산식.
  if (n < 3) return { score: null, label: '비교 자료 부족', counts, comparisons, period: t.period };
  const label = !counts.under && !counts.over ? '격차 유지' : counts.under >= counts.over * 1.5 ? '상대 저평가 후보' : counts.over >= counts.under * 1.5 ? '상대 고평가' : '판정 엇갈림';
  return { score: Math.round(counts.under / n * 1000) / 10, label, counts, comparisons, period: t.period };
}

export function distanceM(a, b) {
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
// 목적지에서 역방향 최단경로를 계산한다. 6호선 응암 순환의 방향을 보존한다.
export function stationTimes(network, destination, transferMinutes = 5, reverse = false) {
  const dist = new Map(network.stations.map(s => [s.id, s.name === destination ? 0 : Infinity]));
  const pending = new Set(dist.keys());
  const adj = new Map(network.stations.map(s => [s.id, []]));
  for (const [a, b, minutes] of network.edges) {
    const from = reverse ? a : b, to = reverse ? b : a;
    adj.get(from)?.push([to, minutes === 'transfer' ? transferMinutes : minutes]);
  }
  while (pending.size) {
    let at = null;
    for (const id of pending) if (at === null || dist.get(id) < dist.get(at)) at = id;
    if (!Number.isFinite(dist.get(at))) break;
    pending.delete(at);
    for (const [to, cost] of adj.get(at)) if (dist.get(to) > dist.get(at) + cost) dist.set(to, dist.get(at) + cost);
  }
  return dist;
}
export function commuteEstimate(location, network, times, walkFactor = 1.3, extra = 10) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null;
  let best = null;
  for (const station of network.stations) {
    const distance = distanceM(location, station) * walkFactor;
    if (distance > 1500 || !Number.isFinite(times.get(station.id))) continue;
    const walk = distance <= 500 ? 5 : distance <= 1000 ? 10 : 15;
    const minutes = Math.ceil(times.get(station.id) + walk + extra);
    if (!best || minutes < best.minutes) best = { minutes, station: station.name, line: station.line, distance: Math.round(distance), walk, rail: times.get(station.id), extra };
  }
  return best;
}
