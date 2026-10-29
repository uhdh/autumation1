import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesStation, nearbyStations } from '../buyer-subway.js';

test('역 검색은 초성·혼합 입력·공백을 지원하고 다른 역을 제외한다', () => {
  for (const query of ['ㄱㄴ', 'ㄱ남', '강 남', '']) assert.ok(matchesStation('강남', query));
  assert.ok(matchesStation('홍대입구', 'ㅎㄷㅇㄱ'));
  assert.equal(matchesStation('강변', 'ㄱㄴ'), false);
  assert.equal(matchesStation('강남', '강남역삼'), false);
});

test('역 주변은 직선거리 범위를 지키고 위치 미확인을 제외한다', () => {
  const origin = { lat: 37.5, lng: 127 };
  const stations = [
    { id: 'a', name: '같은이름', line: '2호선', ...origin },
    { id: 'b', name: '같은이름', line: '7호선', lat: 37.52, lng: 127 },
    { id: 'c', name: '근처', line: '2호선', lat: 37.504, lng: 127 },
    { id: 'd', name: '좌표없음' },
  ];
  assert.deepEqual(nearbyStations(origin, stations, 300).map(r => r.station.id), ['a']);
  assert.deepEqual(nearbyStations(origin, stations, 500).map(r => r.station.id), ['a', 'c']);
  assert.deepEqual(nearbyStations(null, stations, 500), []);
  assert.deepEqual(nearbyStations({lat: NaN, lng:127}, stations, 500), []);
});
