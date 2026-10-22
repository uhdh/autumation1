import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolveComplexes } from '../complex-matching.js';
import { locationIndex } from '../buyer-core.js';
await mkdir('.data-cache', { recursive: true });
const refresh = process.argv.includes('--refresh');
async function sheet(id, file) {
  if (!refresh) { try { return JSON.parse(await readFile(`.data-cache/${file}`, 'utf8')); } catch {} }
  const response = await fetch('https://datafile.seoul.go.kr/bigfile/iot/sheet/json/download.do', {
    method: 'POST', body: new URLSearchParams({ infId: id, srvType: 'S', serviceKind: '0', pageNo: '1', ssUserId: 'SAMPLE_VIEW' }), signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.DATA) || data.DATA.length < 500) throw new Error(`${id}: incomplete`);
  await writeFile(`.data-cache/${file}`, JSON.stringify(data)); return data;
}
const raw = await sheet('OA-15818', 'complex-locations.json');
const master = await sheet('OA-21232', 'station-master.json');
const kapt = JSON.parse(await readFile('.data-cache/kapt-seoul.json', 'utf8'));
const market = JSON.parse(await readFile('market-data.json', 'utf8'));
const coordinates = raw.DATA.filter(r => r.use_yn === 'Y').map(r => ({ code: r.apt_cd, name: r.apt_nm, gu: r.sgg_addr, dong: r.emd_addr, address: r.apt_rdn_addr, lat: Number(r.ycrd), lng: Number(r.xcrd) }));
const validCoordinates = coordinates.filter(r => locationIndex([r]).size === 1);
const matches = resolveComplexes(market.rows, kapt.rows, validCoordinates);
const located = matches.filter(r => locationIndex([r]).size === 1);
if (located.length < 1000) throw new Error('Insufficient coordinate linkage');
const stations = master.DATA.map(r => ({ id: r.bldn_id, name: r.bldn_nm, line: r.route, lat: Number(r.lat), lng: Number(r.lot) })).filter(r => r.name && r.line && r.lat > 36 && r.lat < 39 && r.lng > 125 && r.lng < 129);
if (stations.length < 700 || !stations.some(s => s.line === '9호선') || !stations.some(s => s.line === '신분당선')) throw new Error('Station master incomplete');
const date = new Date().toISOString().slice(0, 10);
await writeFile('seoul_apt_complex.json', JSON.stringify(kapt.rows));
await writeFile('seoul_apt_locations.json', JSON.stringify({ asOf: date, complexDate: kapt.sourceDate, rows: located, metadata: matches.filter(r => !Number.isFinite(r.lat)), source: 'https://data.seoul.go.kr/dataList/OA-15818/A/1/datasetView.do', counts: { linked: matches.length, located: located.length, complexes: kapt.rows.length } }));
await writeFile('station-data.json', JSON.stringify({ asOf: date, source: 'https://data.seoul.go.kr/dataList/OA-21232/A/1/datasetView.do', stations }));
console.log(JSON.stringify({ matched: matches.length, located: located.length, stations: stations.length }));
