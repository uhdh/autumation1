import { locationKey } from './buyer-core.js';
import { distanceM } from './market-core.js';
const $ = id => document.getElementById(id);
let metadata = new Map(), locations = new Map(), stations = [], factsCache = new Map(), ready = false, loadError = '';
const defaults = () => ({ households: null, school: false, stationM: null, maxAge: null });
let options = defaults();

export function propertyIndex(rows, schools) {
  const result = new Map(), schoolCodes = new Set(schools.map(s => s.kaptCode));
  for (const row of rows) {
    const value = { households: Number(row.householdCount) > 0 ? Number(row.householdCount) : null,
      year: /^\d{4}\./.test(row.buildYearMonth || '') ? Number(row.buildYearMonth.slice(0, 4)) : null,
      school: schoolCodes.has(row.kaptCode), code: row.kaptCode };
    const aliases = [row.kaptName, ...schools.filter(s => s.kaptCode === row.kaptCode).map(s => s.namuName)];
    for (const name of new Set(aliases)) {
      const key = locationKey({ ...row, name });
      if (!result.has(key)) result.set(key, value);
      else if (result.get(key)?.code !== value.code) result.set(key, null);
    }
  }
  return result;
}
export function propertyDecision(facts, filters, year = new Date().getFullYear()) {
  let unknown = false, rejected = false;
  if (filters.households !== null) {
    if (facts.households === null) unknown = true;
    else if (facts.households < filters.households) rejected = true;
  }
  if (filters.school && facts.school !== true) unknown = true; // 미등재는 비초품아라는 뜻이 아니다.
  if (filters.stationM !== null) {
    if (!facts.station) unknown = true;
    else if (facts.station.distance > filters.stationM) rejected = true;
  }
  if (filters.maxAge !== null) {
    if (!facts.year || facts.year > year) unknown = true;
    else if (year - facts.year > filters.maxAge) rejected = true;
  }
  return { pass: !unknown && !rejected, unknown, rejected };
}
function factsFor(g) {
  const key = locationKey(g);
  const cacheKey = `${key}:${g.buildYear}`;
  if (factsCache.has(cacheKey)) return factsCache.get(cacheKey);
  const info = metadata.get(key), location = locations.get(key);
  let station = null;
  if (location) for (const s of stations) {
    const distance = distanceM(location, s);
    if (!station || distance < station.distance) station = { name: s.name, line: s.line, distance };
  }
  const year = info?.year || (Number(g.buildYear) >= 1900 ? Number(g.buildYear) : null);
  const facts = { households: info?.households ?? null, school: info?.school ?? null, year, station };
  factsCache.set(cacheKey, facts); return facts;
}
export const propertyFiltersActive = () => Object.values(options).some(v => v !== null && v !== false);
export const passesProperties = g => propertyDecision(factsFor(g), options).pass;
export function propertyBadges(g) {
  const f = factsFor(g);
  // 고유명·호선은 공공 정적 데이터지만 마크업에 넣지 않고 텍스트 배열로 반환한다.
  return [f.households ? `${f.households.toLocaleString()}세대` : '세대수 미확인',
    f.school ? '초품아 참고목록' : null,
    f.station ? `${f.station.name} ${f.station.line} · 직선 ${Math.round(f.station.distance)}m` : null].filter(Boolean);
}
export function renderPropertySummary(before, after) {
  const known = before.filter(g => propertyDecision(factsFor(g), options).unknown).length;
  $('property-summary').textContent = ready ? `현재 후보 ${before.length.toLocaleString()} → ${after.length.toLocaleString()}개 단지·면적${propertyFiltersActive() ? ` · 조건 정보 미확인 ${known.toLocaleString()}개 제외` : ' · 조건을 켜면 지도에 바로 반영됩니다.'}` : loadError || '단지 조건 자료를 불러오는 중입니다.';
  const chips = [];
  if (options.households !== null) chips.push(['households', `${options.households.toLocaleString()}세대 이상`]);
  if (options.school) chips.push(['school', '초품아 참고목록']);
  if (options.stationM !== null) chips.push(['station', `역 ${options.stationM}m 이내`]);
  if (options.maxAge !== null) chips.push(['age', `${options.maxAge}년 이내`]);
  $('active-property-filters').replaceChildren(...chips.map(([key, label]) => {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.removeProperty = key;
    button.textContent = `${label} ×`; button.setAttribute('aria-label', `${label} 조건 해제`); return button;
  }));
}
export function resetPropertyFilters() {
  options = defaults();
  for (const id of ['filter-large', 'filter-school', 'filter-station']) $(id).checked = false;
  $('filter-households').value = '1000'; $('filter-station-m').value = '500'; $('filter-age').value = '';
  $('filter-households').disabled = true; $('filter-station-m').disabled = true;
}
export async function initPropertyFilters(render) {
  $('property-controls').addEventListener('input', () => {
    options = { households: $('filter-large').checked ? Number($('filter-households').value) : null,
      school: $('filter-school').checked, stationM: $('filter-station').checked ? Number($('filter-station-m').value) : null,
      maxAge: $('filter-age').value === '' ? null : Number($('filter-age').value) };
    $('filter-households').disabled = !$('filter-large').checked;
    $('filter-station-m').disabled = !$('filter-station').checked;
    render();
  });
  $('reset-property-filters').onclick = () => { resetPropertyFilters(); render(); };
  $('active-property-filters').onclick = event => {
    const button = event.target.closest('[data-remove-property]'); if (!button) return;
    const key = button.dataset.removeProperty;
    if (key === 'age') $('filter-age').value = '';
    else $({ households: 'filter-large', school: 'filter-school', station: 'filter-station' }[key]).checked = false;
    $('property-controls').dispatchEvent(new Event('input', { bubbles: true }));
  };
  try {
    const results = await Promise.all(['/seoul_chopuma.json', '/seoul_apt_locations.json', '/station-data.json'].map(async url => {
      const r = await fetch(url); if (!r.ok) throw new Error(url); return r.json();
    }));
    const [schools, loc, rail] = results;
    const schoolCodes = new Set(schools.map(s => s.kaptCode));
    metadata = new Map([...loc.rows, ...(loc.metadata || [])].map(r => [locationKey(r), { ...r, school: schoolCodes.has(r.code) }]));
    // 위치도 중복된 구·동·단지명에는 연결하지 않는다.
    for (const row of loc.rows) { const key = locationKey(row); locations.set(key, locations.has(key) ? null : row); }
    stations = rail.stations; ready = true; factsCache = new Map();
    $('property-controls').disabled = false; $('reset-property-filters').disabled = false; render();
  } catch { loadError = $('property-summary').textContent = '조건 자료를 불러오지 못했습니다. 새로고침하면 다시 시도합니다. 기본 지도·목록은 계속 사용할 수 있습니다.'; }
}
