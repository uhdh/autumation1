import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveComplexes } from '../complex-matching.js';
import { locationKey } from '../buyer-core.js';

test('주소 연결: 이름 변경 허용, 중복 필지·재건축·주소 불일치 차단', () => {
  const trade = { gu: '강남구', dong: '압구정동', jibun: '10', name: '현대2', buildYear: 1980 };
  const info = { gu: trade.gu, dong: trade.dong, jibun: '10', parcels: ['10', '11'], kaptName: '압구정현대2차', kaptCode: 'A', buildYearMonth: '1980.01', householdCount: 1000 };
  const coord = { gu: trade.gu, dong: trade.dong, code: 'A', lat: 37.53, lng: 127.03 };
  assert.equal(resolveComplexes([trade], [info], [coord])[0].lat, 37.53);
  assert.equal(resolveComplexes([{ ...trade, jibun: '11' }], [info], [coord]).length, 1);
  assert.equal(resolveComplexes([trade], [info, { ...info, kaptCode: 'B' }], [coord]).length, 0);
  assert.equal(resolveComplexes([{ ...trade, buildYear: 2025 }], [info], [coord]).length, 0);
  assert.equal(resolveComplexes([{ ...trade, jibun: '12', name: info.kaptName }], [info], [coord]).length, 0);
  assert.equal(resolveComplexes([{ ...trade, gu: '강동구', dong: '둔촌동' }], [info], [coord]).length, 0);
  assert.notEqual(locationKey(trade), locationKey({ ...trade, jibun: '11' }));
});

test('출시 자료: 연결 식별자 유일성, 세대수·좌표·수도권 추가 노선', async () => {
  const data = JSON.parse(await readFile('seoul_apt_locations.json', 'utf8'));
  const stations = JSON.parse(await readFile('station-data.json', 'utf8'));
  assert.equal(new Set(data.rows.map(locationKey)).size, data.rows.length);
  assert.ok(data.rows.length > 2000);
  assert.ok(data.rows.every(r => r.code && r.jibun && r.households > 0 && r.year > 1900));
  for (const line of ['9호선', '신분당선', '경의중앙선', '신림선']) assert.ok(stations.stations.some(s => s.line === line));
});
