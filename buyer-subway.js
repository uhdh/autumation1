import { locationIndex, locationKey } from './buyer-core.js';
import { distanceM } from './market-core.js';

const initials = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
export function matchesStation(name, query) {
  const clean = value => String(value).replace(/\s/g, '').toLowerCase();
  const chars = [...clean(name)], wanted = [...clean(query)];
  return chars.some((_, offset) => wanted.every((c, i) => {
    const actual = chars[offset + i];
    if (!actual) return false;
    const code = actual.charCodeAt(0) - 0xac00;
    return c === actual || (initials.includes(c) && code >= 0 && code < 11172 && initials[Math.floor(code / 588)] === c);
  })) || wanted.length === 0;
}

// Keep line-specific station identities; equal names are not proof of a shared station.
export function nearbyStations(location, stations, radius) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return [];
  return stations.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map(station => ({ station, distance: distanceM(location, station) }))
    .filter(row => row.distance <= radius);
}

const $ = id => document.getElementById(id);
const colors = ['#0052a4', '#00853e', '#bc5100', '#007b9e', '#8051a2', '#995329', '#687421', '#c33672', '#857340'];
let stations = [], locations = new Map(), neighbors = new Map(), ready = false;
let activeTab = 'map', selected = '', line = '', radius = 500, query = '', limit = 12, rerender = () => {};
let summaries = new Map();
const stationKey = s => `${s.line}:${s.id}`;
const money = n => `${(n / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억`;
function lineColor(name) { return colors[Number(name.match(/^(\d)호선$/)?.[1]) - 1] || '#35695e'; }
function button(text, cls) {
  const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; return b;
}

export function subwaySelectionLabel() {
  const s = stations.find(s => stationKey(s) === selected);
  return activeTab === 'subway' && s ? `${s.name} · ${s.line} 직선 ${radius}m` : '';
}
export function activateExploreTab(name) {
  activeTab = name === 'subway' ? 'subway' : 'map';
  for (const tab of ['map', 'subway']) {
    $(`tab-${tab}`).setAttribute('aria-selected', String(activeTab === tab));
    $(`tab-${tab}`).tabIndex = activeTab === tab ? 0 : -1;
  }
  $('map-view').hidden = activeTab !== 'map';
  $('subway-panel').hidden = activeTab !== 'subway';
  $('map-fit').hidden = activeTab !== 'map';
  $('explore-heading').textContent = activeTab === 'map' ? '지도에서 둘러보기' : '역 주변에서 둘러보기';
  const url = new URL(location.href);
  if (activeTab === 'subway') url.searchParams.set('view', 'subway'); else url.searchParams.delete('view');
  history.replaceState(null, '', url);
  rerender();
}

function renderStations() {
  if (!ready) return;
  const search = query.trim();
  const all = stations.filter(s => (!line || s.line === line) && matchesStation(s.name, search));
  const hits = all.filter(s => search || summaries.get(stationKey(s))?.homes.length || stationKey(s) === selected);
  hits.sort((a, b) => (summaries.get(stationKey(b))?.homes.length || 0) - (summaries.get(stationKey(a))?.homes.length || 0) || a.name.localeCompare(b.name, 'ko'));
  $('subway-status').textContent = `${hits.length}개 역 · ${subwaySelectionLabel() || '역을 선택하면 아래 아파트 목록을 좁힙니다.'}`;
  $('subway-clear').hidden = !selected;
  const nodes = hits.slice(0, limit).map(s => {
    const id = stationKey(s), summary = summaries.get(id);
    const b = button('', 'subway-station'); b.dataset.stationKey = id;
    b.setAttribute('aria-pressed', String(id === selected));
    const badge = document.createElement('span'); badge.className = 'subway-line-badge'; badge.textContent = s.line; badge.style.backgroundColor = lineColor(s.line);
    const title = document.createElement('strong'); title.textContent = s.name;
    const detail = document.createElement('span'); detail.className = 'subway-station-detail';
    detail.textContent = summary?.homes.length ? `${summary.homes.length}개 단지·면적 · ${money(summary.min)}부터` : '현재 조건에 맞는 주변 아파트 없음';
    b.append(badge, title, detail);
    b.onclick = () => { selected = selected === id ? '' : id; rerender(); };
    return b;
  });
  if (!nodes.length) {
    const empty = document.createElement('p'); empty.className = 'subway-empty';
    empty.textContent = search ? '검색한 역이 없습니다. 역 이름이나 노선을 바꿔보세요.' : '현재 조건에 맞는 주변 아파트가 없습니다. 예산·지역·범위를 바꿔보세요.'; nodes.push(empty);
  }
  const focusedStation = document.activeElement?.dataset?.stationKey;
  $('subway-stations').replaceChildren(...nodes);
  if (focusedStation) [...$('subway-stations').children].find(el => el.dataset.stationKey === focusedStation)?.focus({ preventScroll: true });
  $('subway-more').hidden = hits.length <= limit;
  $('subway-more').textContent = `역 더 보기 (${Math.min(limit, hits.length)} / ${hits.length})`;
}

export function updateSubway(homes) {
  if (!ready) return homes;
  summaries = new Map();
  for (const home of homes) {
    const key = locationKey(home);
    if (!neighbors.has(key)) neighbors.set(key, nearbyStations(locations.get(key), stations, 1000));
    for (const { station, distance } of neighbors.get(key)) {
      if (distance > radius) continue;
      const id = stationKey(station);
      if (!summaries.has(id)) summaries.set(id, { homes: [], min: Infinity });
      const entry = summaries.get(id); entry.homes.push(home); entry.min = Math.min(entry.min, home.price);
    }
  }
  if (activeTab === 'subway') renderStations();
  return activeTab === 'subway' && selected ? (summaries.get(selected)?.homes || []).slice() : homes;
}
export function resetSubway() {
  selected = ''; line = ''; query = ''; radius = 500; limit = 12;
  $('subway-search').value = ''; $('subway-radius').value = '500';
  for (const b of $('subway-lines').children) b.setAttribute('aria-pressed', String(b.dataset.line === ''));
  updateSubway([]);
}

export async function initSubway(render) {
  rerender = render;
  for (const [i, name] of ['map', 'subway'].entries()) {
    const tab = $(`tab-${name}`);
    tab.onclick = () => activateExploreTab(name);
    tab.onkeydown = e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 'map' : e.key === 'End' ? 'subway' : ['map', 'subway'][1 - i];
      activateExploreTab(next); $(`tab-${next}`).focus();
    };
  }
  $('subway-search').oninput = e => { query = e.target.value; limit = 12; renderStations(); };
  $('subway-radius').onchange = e => { radius = Number(e.target.value); limit = 12; rerender(); };
  $('subway-clear').onclick = () => { selected = ''; rerender(); };
  $('subway-more').onclick = () => { limit += 12; renderStations(); };
  activateExploreTab(new URL(location.href).searchParams.get('view'));
  try {
    const [rail, loc] = await Promise.all(['/station-data.json', '/seoul_apt_locations.json'].map(async path => {
      const response = await fetch(path); if (!response.ok) throw new Error(path); return response.json();
    }));
    if (!Array.isArray(rail.stations) || !Array.isArray(loc.rows)) throw new Error('Invalid station data');
    stations = rail.stations.filter(s => s.id && s.name && s.line && Number.isFinite(s.lat) && Number.isFinite(s.lng));
    locations = locationIndex(loc.rows); neighbors = new Map();
    const lines = [...new Set(stations.map(s => s.line))].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
    $('subway-lines').replaceChildren(...['', ...lines].map(name => {
      const b = button(name || '전체', 'subway-line'); b.dataset.line = name;
      b.setAttribute('aria-pressed', String(name === line)); b.style.setProperty('--subway-color', lineColor(name));
      b.onclick = () => {
        line = name; selected = ''; limit = 12;
        for (const sibling of $('subway-lines').children) sibling.setAttribute('aria-pressed', String(sibling === b));
        rerender();
      }; return b;
    }));
    ready = true; $('subway-controls').disabled = false; rerender();
  } catch {
    $('subway-status').textContent = '역 정보를 불러오지 못했습니다. 새로고침하거나 지도·아파트 목록을 이용해 주세요.';
  }
}
