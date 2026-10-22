// node scripts/build-market-data.mjs [--refresh] [--as-of=20261022]
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { growth, jeonseRatio, priceBasis, relativeValue, areaKey, monthOffset } from '../market-core.js';

await mkdir('.data-cache', { recursive: true });
let asOf = process.argv.find(a => a.startsWith('--as-of='))?.split('=')[1];
if (asOf && !/^20\d{6}$/.test(asOf)) throw new Error('Invalid --as-of YYYYMMDD');
const refresh = process.argv.includes('--refresh');
const sourceFiles = {};
async function source(file, download) {
  const record = async bytes => {
    sourceFiles[file] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, retrievedAt: (await stat(`.data-cache/${file}`)).mtime.toISOString() };
    return bytes;
  };
  if (!refresh) { try { return await record(await readFile(`.data-cache/${file}`)); } catch {} }
  const response = await download();
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000 || bytes.subarray(0, 200).toString().includes('<html')) throw new Error(`${file}: download failed`);
  await writeFile(`.data-cache/${file}`, bytes);
  return record(bytes);
}
async function sheet(id, file) {
  const data = JSON.parse((await source(file, () => fetch('https://datafile.seoul.go.kr/bigfile/iot/sheet/json/download.do', {
    method: 'POST', body: new URLSearchParams({ infId: id, srvType: 'S', serviceKind: '0', pageNo: '1', ssUserId: 'SAMPLE_VIEW', strWhere: " AND RCPT_YR >= TO_CHAR(NOW(), 'YYYY')", strOrderby: 'CTRT_DAY DESC', filterCol: 'BLDG_USG', txtFilter: '아파트' }), signal: AbortSignal.timeout(180000)
  }))).toString());
  if (!Array.isArray(data.DATA) || data.DATA.length < 1000) throw new Error(`${id}: incomplete source`);
  return data.DATA;
}
const sales = await sheet('OA-21275', 'sales-current.json');
const rents = await sheet('OA-21276', 'rents-current.json');
const collectedDay = Object.values(sourceFiles).map(s => new Date(new Date(s.retrievedAt).getTime() + 9 * 3600000).toISOString().slice(0, 10).replaceAll('-', '')).sort()[0];
asOf ||= collectedDay;
if (asOf > collectedDay) throw new Error('Cached sources are older than --as-of. Run --refresh.');
const compact = new Map();
const text = s => String(s ?? '').trim();
function identity(r, area) {
  if (!/^11\d{3}$/.test(r.cgg_cd) || !r.stdg_nm || !r.bldg_nm || !/^\d+$/.test(r.mno) || !/^\d+$/.test(r.sno || '0') || !Number.isFinite(area) || area <= 0 || !/^20\d{6}$/.test(r.ctrt_day) || r.ctrt_day > asOf) return null;
  const iso = `${r.ctrt_day.slice(0, 4)}-${r.ctrt_day.slice(4, 6)}-${r.ctrt_day.slice(6)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
  return { gu: text(r.cgg_nm), lawdCd: r.cgg_cd, dong: text(r.stdg_nm), name: text(r.bldg_nm), area: Math.floor(area),
    jibun: `${r.lotno_se === '2' ? '산' : ''}${Number(r.mno)}${Number(r.sno) ? `-${Number(r.sno)}` : ''}`, buildYear: Number(r.arch_yr) || null };
}
for (const r of sales) {
  if (r.bldg_usg !== '아파트' || r.rtrcn_day || r.rght_se || r.ctrt_day < '20240101') continue;
  const g = identity(r, Number(r.arch_area));
  const amount = Number(r.thing_amt);
  if (!g || !Number.isFinite(amount) || amount <= 0) continue;
  const key = areaKey(g);
  if (!compact.has(key)) compact.set(key, { ...g, key, sales: [], rents: {} });
  compact.get(key).sales.push([r.ctrt_day, amount, Number(r.flr), Number(r.arch_area), text(r.dclr_se)]);
}
for (const r of rents) {
  if (r.bldg_usg !== '아파트' || r.rent_se !== '전세' || r.rtfe === null || Number(r.rtfe) !== 0 || !(Number(r.grfe) > 0)) continue;
  const g = identity(r, Number(r.rent_area));
  if (!g) continue;
  const group = compact.get(areaKey(g));
  if (!group) continue;
  const bucket = group.rents[r.ctrt_day.slice(0, 6)] ||= [0, 0]; bucket[0]++; bucket[1] += Number(r.grfe);
}
const month = asOf.slice(0, 6);
const rows = [...compact.values()].map(g => ({ ...g, basis: priceBasis(g.sales, month),
  growth: Object.fromEntries([3, 6, 9, 12].map(n => [n, growth(g.sales, month, n)])), jeonse: jeonseRatio(g.sales, g.rents, month) }));
const peers = rows.filter(g => g.basis);
for (const g of rows) {
  g.valuation = relativeValue(g, peers);
  // 상세 비교는 10개까지 표시하지만 점수는 전체 후보로 계산한다.
  if (g.valuation) { g.valuation.comparisonCount = g.valuation.comparisons.length; g.valuation.comparisons = g.valuation.comparisons.sort((a, b) => b.delta - a.delta).slice(0, 10); }
  delete g.rents;
  g.sales = g.sales.filter(t => t[0].slice(0, 6) >= monthOffset(month, -11));
}
const published = rows.filter(g => g.sales.length);
const payload = { asOf, saleFrom: '202401', rentFrom: '202601', sourceFiles: { ...sourceFiles }, sourceCounts: { sales: sales.length, rents: rents.length },
  sources: ['https://data.seoul.go.kr/dataList/OA-21275/S/1/datasetView.do', 'https://data.seoul.go.kr/dataList/OA-21276/S/1/datasetView.do'], rows: published };
await writeFile('market-data.json', JSON.stringify(payload));
console.log(JSON.stringify({ rows: published.length, jeonse: published.filter(g => g.jeonse).length, growth: published.filter(g => g.growth[3]).length, valuation: published.filter(g => g.valuation?.score !== null && g.valuation).length }));

async function csv(file, infId, seq, infSeq) {
  const bytes = await source(file, () => fetch('https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false', { method: 'POST', body: new URLSearchParams({ infId, seq, infSeq, seqNo: '' }) }));
  const lines = new TextDecoder('euc-kr').decode(bytes).trim().split(/\r?\n/);
  // ponytail: 이 두 공개 CSV에는 따옴표 필드가 없다. 형식이 바뀌면 조용히 오독하지 않고 중단.
  if (lines.some(l => l.includes('"'))) throw new Error('CSV format changed: use a full CSV parser');
  const width = lines[0].split(',').length;
  return lines.slice(1).map(line => { const cells = line.split(',').map(s => s.trim()); if (cells.length !== width) throw new Error('CSV column mismatch'); return cells; });
}
const coords = await csv('rail-stations.csv', 'OA-22534', '1', '2');
const times = await csv('rail-times.csv', 'OA-12034', '9', '1');
const stationName = s => ({ '서울': '서울역', '뚝섬유원지': '자양', '신내역': '신내', '당고개': '불암산', '총신대입구': '이수' }[s] || s);
const stations = coords.map(r => ({ id: `${r[1]}:${stationName(r[3])}`, line: r[1], name: stationName(r[3]), lat: Number(r[4]), lng: Number(r[5]) }));
if (stations.some(s => !Number.isFinite(s.lat) || !Number.isFinite(s.lng))) throw new Error('Invalid station coordinates');
const ids = new Set(stations.map(s => s.id)), edges = [], missing = [];
let previous;
for (const r of times) {
  const [seq, line, rawName, duration] = r, name = stationName(rawName), id = `${line}:${name}`;
  const [m, sec] = duration.split(':').map(Number), minutes = m + sec / 60;
  let from = previous;
  // 분기점은 행 순서로 연결하면 잘못된 노선이 되므로 실제 분기역으로 연결한다.
  if (line === '2' && name === '용답') from = '2:성수';
  if (line === '2' && name === '도림천') from = '2:신도림';
  if (line === '5' && name === '둔촌동') from = '5:강동';
  if (minutes > 0 && from?.startsWith(`${line}:`)) {
    if (ids.has(from) && ids.has(id)) {
      edges.push([from, id, minutes]);
      if (!(line === '6' && Number(seq) >= 180 && Number(seq) <= 185)) edges.push([id, from, minutes]);
    } else missing.push([from, id]);
  }
  previous = id;
}
for (const a of stations) for (const b of stations) if (a.name === b.name && a.id !== b.id) edges.push([a.id, b.id, 'transfer']);
await writeFile('rail-data.json', JSON.stringify({ asOf, timesDate: '2024-08-10', coordinatesDate: '2025-08-14', sources: ['https://data.seoul.go.kr/dataList/OA-12034/F/1/datasetView.do', 'https://data.seoul.go.kr/dataList/OA-22534/L/1/datasetView.do'], stations, edges, missing }));
console.log(JSON.stringify({ stations: stations.length, edges: edges.length, missing }));
