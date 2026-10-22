import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = async file => JSON.parse(await readFile(file, 'utf8'));
const data = await read('market-data.json'), places = await read('seoul_apt_locations.json');
assert.ok(data.rows.length > 5000 && data.sourceCounts.sales > 50000 && data.sourceCounts.rents > 50000, 'Unexpected source shrink');
assert.equal(new Set(data.rows.map(r => r.key)).size, data.rows.length);
assert.ok(data.rows.every(r => r.sales.length && r.sales.every(t => /^20\d{6}$/.test(t[0]) && Number.isFinite(t[1]) && t[1] > 0 && t[0] <= data.asOf)));
assert.ok(places.rows.length > 2000, 'Coordinate linkage regressed');
const previous = await fetch('https://excelzip.pages.dev/market-data.json').then(async r => r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null).catch(() => null);
if (previous?.rows) {
  assert.ok(data.asOf >= previous.asOf, 'Snapshot moved backwards');
  assert.ok(data.rows.length >= previous.rows.length * .75, 'More than 25% of market rows disappeared');
}
console.log('Data validation passed');
