import test from 'node:test';
import assert from 'node:assert/strict';
import { locationIndex, locationKey } from '../buyer-core.js';
import { readFile } from 'node:fs/promises';

test('지도는 구·동·이름이 유일하게 일치하는 유효 좌표만 사용한다', async () => {
  const home = { gu: '강남구', dong: '압구정동', name: '현대2차', lat: 37.53, lng: 127.03 };
  const index = locationIndex([home, { ...home, gu: '강동구', dong: '둔촌동', lat: 37.52 }]);
  assert.equal(index.get(locationKey(home)).lat, 37.53);
  assert.equal(index.get(locationKey({ ...home, name: '현대 2차' })).lat, 37.53);
  assert.equal(index.get(locationKey({ ...home, name: '현대' })), undefined);
  assert.equal(index.get(locationKey({ ...home, dong: '삼성동' })), undefined);
  assert.equal(locationIndex([home, home]).get(locationKey(home)), null);
  assert.equal(locationIndex([{ ...home, lat: 0 }, { ...home, lng: '127' }]).size, 0);
  const data = JSON.parse(await readFile(new URL('../seoul_apt_locations.json', import.meta.url), 'utf8'));
  assert.ok(data.rows.length > 2000);
  assert.ok(data.rows.every(r => locationIndex([r]).size === 1));
});
