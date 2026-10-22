import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { growth, jeonseRatio, priceBasis, relativeValue, stationTimes, commuteEstimate, monthOffset } from '../market-core.js';
const sale = (date, amount, floor = 10, type = '중개거래') => [date, amount, floor, 84.9, type];

test('완료 월 기준 상승률: 구간 이동, 최고가, 2건 조건, 직거래·저층 제외', () => {
  const rows = [sale('20260101', 80000), sale('20260301', 70000), sale('20260701', 85000), sale('20260930', 90000), sale('20261001', 999999), sale('20260901', 999999, 1), sale('20260902', 999999, 10, '직거래')];
  const g = growth(rows, '202610', 6);
  assert.equal(g.pct, 12.5); assert.equal(g.baseStart, '202601'); assert.equal(g.end, '202609');
  assert.equal(g.currentCount, 2); assert.equal(growth(rows.slice(1), '202610', 6), null);
  assert.equal(growth(rows, '202610', 7), null); assert.equal(monthOffset('202601', -1), '202512');
});
test('전세가율은 최근 공통 월의 평균값 사용, 월간 가격을 이월하지 않는다', () => {
  const rows = [sale('20261001', 100000), sale('20260901', 80000), sale('20260902', 100000), sale('20260903', 20000, 1)];
  const r = jeonseRatio(rows, { '202609': [2, 108000], '202608': [1, 50000] }, '202610');
  assert.equal(r.pct, 60); assert.equal(r.month, '202609'); assert.equal(r.saleCount, 2);
  assert.equal(jeonseRatio(rows, { '202604': [1, 40000] }, '202610'), null);
});
test('상대평가: 표본·같은 면적·과거가격 유사성·혼재·분모 부족', () => {
  assert.equal(priceBasis([sale('20260801', 80000)], '202610'), null);
  const basis = priceBasis([sale('20241001', 100000), sale('20241201', 90000), sale('20260801', 80000), sale('20260901', 90000), sale('20261001', 85000)], '202610');
  assert.equal(basis.current, 85000); assert.equal(basis.period, '2024Q4');
  const target = { key: 'target', area: 84, basis: { ...basis, current: 80000, high: 80000 } };
  const peer = (key, current, high = current, area = 84) => ({ key, name: key, area, basis: { ...basis, current, high } });
  const result = relativeValue(target, [target, peer('a', 100000), peer('b', 100000), peer('c', 80000), peer('mixed', 100000, 60000), peer('other-area', 100000, 100000, 59)]);
  assert.deepEqual(result.counts, { under: 2, over: 0, same: 1, mixed: 1 });
  assert.equal(result.score, 66.7); assert.equal(result.label, '상대 저평가 후보');
  assert.equal(relativeValue(target, [peer('only', 100000)]).score, null);
});
test('공식 철도 그래프: 지선·환승·응암 단방향과 위치 미확인', async () => {
  const rail = JSON.parse(await readFile(new URL('../rail-data.json', import.meta.url), 'utf8'));
  const edge = (a, b) => rail.edges.some(e => e[0] === a && e[1] === b);
  assert.ok(edge('2:성수', '2:용답')); assert.ok(!edge('2:시청', '2:용답'));
  assert.ok(edge('2:신도림', '2:도림천')); assert.ok(!edge('2:신설동', '2:도림천'));
  assert.ok(edge('5:강동', '5:둔촌동')); assert.ok(!edge('5:하남검단산', '5:둔촌동'));
  assert.ok(edge('7:건대입구', '7:자양')); assert.ok(edge('7:자양', '7:청담'));
  assert.ok(edge('6:응암', '6:역촌')); assert.ok(!edge('6:역촌', '6:응암'));
  const out = stationTimes(rail, '강남');
  assert.equal(out.get('2:역삼'), 1); assert.equal(out.get('2:강남'), 0);
  assert.ok(stationTimes(rail, '역촌').get('6:응암') < stationTimes(rail, '역촌', 5, true).get('6:응암'));
  assert.equal(commuteEstimate(null, rail, out), null);
  assert.equal(commuteEstimate({ lat: 0, lng: 0 }, rail, out), null);
  const gangnam = rail.stations.find(s => s.id === '2:강남');
  assert.equal(commuteEstimate(gangnam, rail, out).minutes, 15);
});
test('공개 스냅샷은 실자료·지표·근거 건수를 보유하고 키가 중복되지 않는다', async () => {
  const data = JSON.parse(await readFile(new URL('../market-data.json', import.meta.url), 'utf8'));
  assert.ok(data.sourceCounts.sales > 100000 && data.sourceCounts.rents > 100000);
  assert.equal(new Set(data.rows.map(g => g.key)).size, data.rows.length);
  assert.ok(data.rows.filter(g => g.jeonse).length > 1000);
  assert.ok(data.rows.filter(g => g.growth[3]).length > 500);
  assert.ok(data.rows.filter(g => g.valuation?.score > 0).length > 10);
  for (const g of data.rows) {
    assert.ok(g.sales.every(t => t[0] <= data.asOf && Number.isFinite(t[1]) && t[1] > 0));
    if (g.growth[3]) assert.ok(g.growth[3].currentCount >= 2 && g.growth[3].baseCount >= 2);
    if (g.valuation?.score != null) assert.ok(g.valuation.counts.under + g.valuation.counts.over + g.valuation.counts.same >= 3);
  }
});
