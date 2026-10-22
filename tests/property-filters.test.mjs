import test from 'node:test';
import assert from 'node:assert/strict';
import { propertyDecision, propertyIndex } from '../buyer-filters.js';
import { locationKey } from '../buyer-core.js';

test('단지 조건은 교집합, 경계 포함, 미확인 제외, 동명 단지 분리', () => {
  const filters = { households: 1000, school: true, stationM: 500, maxAge: 10 };
  const facts = { households: 1000, school: true, station: { distance: 500 }, year: 2016 };
  assert.equal(propertyDecision(facts, filters, 2026).pass, true);
  for (const change of [{ households: 999 }, { households: null }, { school: false }, { station: null }, { station: { distance: 501 } }, { year: 2015 }, { year: 2027 }]) {
    assert.equal(propertyDecision({ ...facts, ...change }, filters, 2026).pass, false);
  }
  assert.equal(propertyDecision({ households: null, school: null, station: null, year: null }, { households: null, school: false, stationM: null, maxAge: null }).pass, true);
  const rows = [{ gu: '강남구', dong: '압구정동', kaptName: '현대', kaptCode: 'A', householdCount: 1000, buildYearMonth: '2000.01' }, { gu: '강동구', dong: '둔촌동', kaptName: '현대', kaptCode: 'B', householdCount: 500 }];
  const key = locationKey({ ...rows[0], name: '현대' });
  assert.equal(propertyIndex(rows, []).get(key).households, 1000);
  assert.equal(propertyIndex([...rows, { ...rows[0], kaptCode: 'C' }], []).get(key), null);
});
