import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetOf, monthlyPayment, groupTrades, recentMonths, assessHome, assessRoutes, tradeSearchJobs } from '../buyer-core.js';
import { readFile } from 'node:fs/promises';

test('서울 전체 기본 탐색: 대출 6억과 현금 4억, 25개구의 최근 월부터 조회', async () => {
  assert.equal(budgetOf({ mode: 'funds', cash: 40000, loan: 60000, reserve: 0, costs: 0 }), 100000);
  const districts = JSON.parse(await readFile(new URL('../seoul_lawd_codes.json', import.meta.url), 'utf8'));
  const jobs = tradeSearchJobs(districts, 'all', ['202610', '202609', '202608']);
  assert.equal(jobs.length, 75);
  assert.equal(new Set(jobs.slice(0, 25).map(j => j.lawd_cd)).size, 25);
  assert.ok(jobs.slice(0, 25).every(j => j.month === '202610'));
  assert.equal(new Set(jobs.map(j => `${j.lawd_cd}:${j.month}`)).size, 75);
  assert.equal(tradeSearchJobs(districts, '11440', ['202610', '202609']).length, 2);
  assert.equal(tradeSearchJobs(districts, 'unknown', ['202610']).length, 0);
});

test('구매 예산과 월 부담: 누락값·0% 금리·대출초과를 구분한다', () => {
  const p = { mode: 'funds', cash: '30000', loan: '40000', reserve: '2000', costs: '3000', rate: '4', years: '30', existing: '30', monthlyCap: '200' };
  assert.equal(budgetOf(p), 65000);
  assert.equal(budgetOf({ ...p, loan: '' }), null);
  assert.equal(budgetOf({ ...p, cash: -1 }), null);
  assert.equal(budgetOf({ mode: 'direct', budget: '80000' }), 80000);
  assert.equal(monthlyPayment(36000, 0, 30), 100);
  assert.ok(Math.abs(monthlyPayment(40000, 4, 30) - 190.9661) < .001);
  assert.equal(monthlyPayment(100, 4, 0), null);
  const a = assessHome({ price: 60000 }, { asking: '', repair: '5000' }, p);
  assert.equal(a.headroom, 0);
  assert.equal(a.monthlyOver, true);
  assert.equal(assessHome({ price: 60000 }, { repair: '' }, p).headroom, null);
  assert.equal(assessHome({ price: 60000 }, { asking: '70000', repair: '0' }, p).payment, null);
  assert.equal(assessHome({ price: 20000 }, { repair: '0' }, { ...p, rate: '', years: '' }).payment, 0);
});

test('동명 단지·지번·면적을 분리하고 취소와 잘못된 거래를 제외한다', () => {
  const base = { aptNm: '현대', umdNm: '가동', jibun: '1', excluUseAr: 84.9, dealYear: '2026', dealMonth: '9', dealDay: '10', dealAmountManwon: 60000 };
  const groups = groupTrades([base, { ...base, dealAmountManwon: 80000 }, { ...base, jibun: '2' }, { ...base, umdNm: '나동' }, { ...base, excluUseAr: 59.9 }, { ...base, isCancelled: true }, { ...base, dealAmountManwon: -1 }, { ...base, dealDay: '31' }], '11440', '마포구');
  assert.equal(groups.length, 4);
  assert.equal(groups[0].price, 70000);
  assert.equal(groups[0].count, 2);
  assert.deepEqual(recentMonths(3, new Date(2026, 0, 31)), ['202601', '202512', '202511']);
});

test('개별 왕복시간·필수조건·목적지 변경·미입력을 구분한다', () => {
  const d = [{ id: 'me', place: '여의도', mode: '대중교통', visits: 5, limit: 60, required: true }, { id: 'partner', place: '강남', mode: '대중교통', visits: 3, limit: 45, required: true }];
  const routes = { me: { place: '여의도', mode: '대중교통', out: 20, back: 30 }, partner: { place: '강남', mode: '대중교통', out: 50, back: 40 } };
  const result = assessRoutes(d, routes);
  assert.equal(result.weekly, 520);
  assert.equal(result.over, true);
  assert.equal(result.unknown, false);
  assert.equal(assessRoutes(d, { me: routes.me }).weekly, null);
  assert.equal(assessRoutes(d, { me: routes.me }).unknown, true);
  assert.equal(assessRoutes([{ ...d[0], place: '신촌' }], routes).rows[0].out, null);
  assert.equal(assessRoutes([{ ...d[0], mode: '자동차' }], routes).rows[0].out, null);
  assert.equal(assessRoutes([{ ...d[0], limit: '' }], routes).unknown, true);
});
