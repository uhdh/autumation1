import { locationKey } from './buyer-core.js';

const clean = s => String(s || '').normalize('NFC').replace(/\s/g, '');
const parcelKey = r => JSON.stringify([r.gu, r.dong, r.jibun].map(clean));
function uniqueIndex(rows, key) {
  const map = new Map();
  for (const row of rows) { const k = key(row); map.set(k, map.has(k) ? null : row); }
  return map;
}
export function resolveComplexes(trades, complexes, coordinates) {
  const parcels = uniqueIndex(complexes.flatMap(c => (c.parcels || [c.jibun]).filter(Boolean).map(jibun => ({ ...c, jibun }))), parcelKey);
  const names = uniqueIndex(complexes, c => JSON.stringify([c.gu, c.dong, c.kaptName].map(clean)));
  const coords = uniqueIndex(coordinates, c => c.code);
  const roads = uniqueIndex(coordinates.filter(c => c.address), c => clean(c.address));
  const result = [];
  const seen = new Set();
  for (const trade of trades) {
    const key = locationKey(trade);
    if (seen.has(key)) continue;
    seen.add(key);
    let info = parcels.get(parcelKey(trade)), method = 'parcel';
    if (!info) {
      info = names.get(JSON.stringify([trade.gu, trade.dong, trade.name].map(clean)));
      method = 'exact-name';
      // A known address disagreement must never be concealed by a name match.
      if (info?.jibun && !(info.parcels || [info.jibun]).map(clean).includes(clean(trade.jibun))) info = null;
    }
    if (!info) continue;
    const year = Number(info.buildYearMonth?.slice(0, 4)) || null;
    // Rebuilt complexes can reuse the parcel and name; do not attach old trades.
    if (year && trade.buildYear && Math.abs(year - trade.buildYear) > 1) continue;
    let location = coords.get(info.kaptCode) || roads.get(clean(info.address));
    if (location?.gu !== trade.gu || location?.dong !== trade.dong) location = null;
    result.push({ gu: trade.gu, dong: trade.dong, jibun: trade.jibun, name: trade.name,
      code: info.kaptCode, officialName: info.kaptName, address: info.address,
      households: info.householdCount, year, match: method,
      lat: location?.lat ?? null, lng: location?.lng ?? null });
  }
  return result;
}
