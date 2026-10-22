import { areaKey, stationTimes, commuteEstimate } from './market-core.js';
import { locationIndex, locationKey } from './buyer-core.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => `${(n / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억`;
const pct = n => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
let data, loading, index = new Map(), network, locations, routes = [], cache = new Map();
let routeOptions = { walkFactor: 1.3, extra: 10 };
export function resetInsights() {
  routes = []; cache = new Map(); routeOptions = { walkFactor: 1.3, extra: 10 };
  document.querySelectorAll('[data-route-station]').forEach(el => { el.value = ''; });
  document.querySelectorAll('[data-route-limit]').forEach(el => { el.value = '60'; });
  $('walk-factor').value = '1.3'; $('route-extra').value = '10'; $('transfer-minutes').value = '5';
  $('growth-interval').value = '3';
  $('commute-status').textContent = '역을 선택하면 예산과 이동시간을 함께 만족하는 후보를 보여줍니다.';
}
export async function loadMarket() {
  if (!loading) loading = fetch('/market-data.json').then(async r => {
    if (!r.ok) throw new Error('분석 자료를 불러오지 못했습니다.');
    const value = await r.json();
    if (!Array.isArray(value.rows) || !/^20\d{6}$/.test(value.asOf)) throw new Error('분석 자료 형식 오류');
    data = value; index = new Map(data.rows.map(g => [g.key, g]));
    $('analysis-status').textContent = `서울시 공개자료 · ${data.asOf.slice(0, 4)}.${data.asOf.slice(4, 6)}.${data.asOf.slice(6)} 수집 · 면적 정수㎡별 분석 · 현재 매물이 아닙니다.`;
    const age = (Date.now() - Date.parse(`${data.asOf.slice(0, 4)}-${data.asOf.slice(4, 6)}-${data.asOf.slice(6)}T00:00:00+09:00`)) / 86400000;
    if (age > 7) $('analysis-status').textContent += ` 자료 수집 후 ${Math.floor(age)}일 경과 · 최신 거래 확인 필요.`;
    return data;
  }).catch(e => { loading = null; throw e; });
  return loading;
}
export const metricFor = g => index.get(areaKey(g));
export const growthInterval = () => Number($('growth-interval').value);
export const commuteActive = () => routes.length > 0;
export function routesFor(g) {
  if (!network || !locations || !routes.length) return null;
  const key = locationKey(g);
  if (cache.has(key)) return cache.get(key);
  const location = locations.get(key);
  const result = routes.map(r => ({ label: r.label, destination: r.destination, limit: r.limit,
    out: commuteEstimate(location, network, r.out, routeOptions.walkFactor, routeOptions.extra),
    back: commuteEstimate(location, network, r.back, routeOptions.walkFactor, routeOptions.extra) }));
  cache.set(key, result); return result;
}
export function fitsCommute(g) {
  if (!routes.length) return true;
  return routesFor(g)?.every(r => r.out && r.back && Math.max(r.out.minutes, r.back.minutes) <= r.limit) || false;
}
export function insightHTML(g) {
  const m = metricFor(g), growth = m?.growth[growthInterval()];
  const r = routesFor(g);
  return `<div class="insight-strip"><span>전세가율 <b>${m?.jeonse ? `${m.jeonse.pct.toFixed(1)}%` : '자료 부족'}</b></span><span>${growthInterval()}개월 최고가 <b>${growth ? pct(growth.pct) : '자료 부족'}</b></span><span>${m?.valuation?.score !== null && m?.valuation ? `${esc(m.valuation.label)} <b>${m.valuation.score}점</b>` : '상대평가 자료 부족'}</span></div>${r ? `<p class="commute-summary">${r.map(row => `${row.label} ${esc(row.destination)} · ${row.out && row.back ? `갈 때 ${row.out.minutes}분 / 올 때 ${row.back.minutes}분 예상` : '경로 미확인'}`).join('<br>')}</p>` : ''}`;
}
export function showAnalysis(g) {
  const m = metricFor(g), growth = m?.growth[growthInterval()], j = m?.jeonse, v = m?.valuation, r = routesFor(g);
  $('analysis-title').textContent = `${g.name} · ${Math.floor(g.area)}㎡대 분석`;
  $('analysis-content').innerHTML = `<p>수집 ${data?.asOf || '미확인'} · 같은 지번·단지명의 면적 정수부끼리 비교합니다.</p>
    <h3>전세가율</h3>${j ? `<p><strong>${j.pct.toFixed(1)}%</strong> · ${j.month} 기준<br>평균 전세 ${money(j.rentMean)} (${j.rentCount}건) ÷ 평균 매매 ${money(j.saleMean)} (${j.saleCount}건)</p>` : '<p>최근 6개월에 매매·전세가 함께 있는 월이 없습니다.</p>'}
    <h3>${growthInterval()}개월 최고가 변화</h3>${growth ? `<p><strong>${pct(growth.pct)}</strong><br>${growth.baseStart}~${growth.baseEnd} 최고 ${money(growth.before)} (${growth.baseCount}건)<br>→ ${growth.start}~${growth.end} 최고 ${money(growth.after)} (${growth.currentCount}건)</p>` : '<p>두 3개월 구간에 각각 유효 거래 2건 이상이 필요합니다.</p>'}
    <h3>과거 유사가격 대비 상대평가</h3>${v ? `<p><strong>${esc(v.label)}${v.score === null ? '' : ` · ${v.score}점`}</strong><br>${v.period} 최고가 ±5% 이내·같은 면적 정수㎡인 서울 단지와 비교합니다.<br>대상 과거 최고가 ${money(m.basis.past)} (${m.basis.pastCount}건) · 현재 최신 3건 중앙값 ${money(m.basis.current)}<br>저평가 요소 ${v.counts.under} · 고평가 요소 ${v.counts.over} · 유지 ${v.counts.same} · 혼재 ${v.counts.mixed}</p>
      <div class="table-scroll"><table><caption>비교 ${v.comparisonCount}개 중 최대 10개 · 가격 격차 변화</caption><thead><tr><th>비교 단지</th><th>과거</th><th>현재</th><th>변화</th><th>판정</th></tr></thead><tbody>${v.comparisons.map(c => `<tr><td>${esc(c.gu)} ${esc(c.name)}</td><td>${money(c.past)}</td><td>${money(c.current)}</td><td>${c.delta.toFixed(1)}%p</td><td>${({ under: '저평가 요소', over: '고평가 요소', same: '격차 유지', mixed: '혼재' })[c.category]}</td></tr>`).join('')}</tbody></table></div>` : '<p>최근 3개월 거래 3건과 과거 4분기 거래 2건 이상이 필요합니다.</p>'}
    <p class="hint">자체 상대비교 산식입니다. (비교단지/대상단지 현재가격 − 비교단지/대상단지 과거가격) × 100을 ±1%p로 구분합니다. 중앙값·최고가 판정이 다르면 혼재로 제외합니다. 유효 비교 3개 이상일 때 저평가 요소 비율을 점수로 표시합니다. 입지·연식·층 차이를 보정한 적정가격이나 상승 확률이 아닙니다.</p>
    <h3>출퇴근 추정</h3>${r ? r.map(row => `<p><b>${row.label} · ${esc(row.destination)}</b><br>${row.out ? `갈 때 ${row.out.minutes}분 = 도보 ${row.out.walk}분 + 철도·환승 ${row.out.rail.toFixed(1)}분 + 여유 ${row.out.extra}분 (${esc(row.out.station)} ${row.out.line}호선)` : '가는 경로 미확인'}<br>${row.back ? `올 때 ${row.back.minutes}분 (${esc(row.back.station)} ${row.back.line}호선)` : '오는 경로 미확인'}</p>`).join('') : '<p>출퇴근 조건에서 목적지 역을 선택하면 계산합니다.</p>'}
    <p class="hint">1~8호선 중 공개 자료에 있는 구간만 사용합니다. 9호선·신분당선·코레일 등은 미포함이며 실제 최단 경로와 다를 수 있습니다. 역간시간 2024.08, 좌표 2025.08 자료. 단지-역 직선거리에 우회계수를 적용한 도보 추정이며 실시간 길찾기가 아닙니다.</p>`;
  $('analysis-dialog').showModal();
}
export async function initInsights(render) {
  $('close-analysis').onclick = () => $('analysis-dialog').close();
  $('growth-interval').onchange = render;
  try {
    const responses = await Promise.all([fetch('/rail-data.json'), fetch('/seoul_apt_locations.json')]);
    if (responses.some(r => !r.ok)) throw new Error();
    const [rail, loc] = await Promise.all(responses.map(r => r.json()));
    network = rail; locations = locationIndex(loc.rows);
    const names = [...new Set(network.stations.map(s => s.name))].sort((a, b) => a.localeCompare(b, 'ko'));
    const fields = [['me', '내 직장'], ['partner', '배우자 직장'], ['home', '현재 집'], ['parents', '시댁'], ['inlaws', '처가']];
    const field = ([id, label]) => `<div class="field-pair route-choice"><label>${label} 가까운 역<select data-route-station="${id}" data-label="${label}"><option value="">선택 안 함</option>${names.map(name => `<option>${esc(name)}</option>`).join('')}</select></label><label>편도 상한 (분)<input data-route-limit="${id}" required type="number" min="10" max="180" value="60"></label></div>`;
    $('station-fields').innerHTML = fields.slice(0, 2).map(field).join('') + `<details><summary>현재 집·시댁·처가도 추가</summary>${fields.slice(2).map(field).join('')}</details>`;
    $('commute-controls').addEventListener('change', () => {
      if ([...$('commute-controls').querySelectorAll('input')].some(el => !el.checkValidity())) { $('commute-status').textContent = '시간과 보정값의 허용 범위를 확인해 주세요. 마지막 유효 조건을 유지합니다.'; return; }
      const transfer = Number($('transfer-minutes').value);
      routeOptions = { walkFactor: Number($('walk-factor').value), extra: Number($('route-extra').value) };
      routes = [...document.querySelectorAll('[data-route-station]')].filter(el => el.value).map(el => ({ label: el.dataset.label, destination: el.value, limit: Number(document.querySelector(`[data-route-limit="${el.dataset.routeStation}"]`).value), out: stationTimes(network, el.value, transfer), back: stationTimes(network, el.value, transfer, true) }));
      cache = new Map();
      $('commute-status').textContent = routes.length ? `${routes.length}곳 모두 갈 때·올 때 상한을 충족하는 후보만 표시합니다. 위치·경로 미확인 후보는 제외됩니다.` : '역을 선택하면 예산과 이동시간을 함께 만족하는 후보를 보여줍니다.';
      render();
    });
    $('commute-controls').disabled = false;
  } catch { $('commute-status').textContent = '철도 자료를 불러오지 못했습니다. 새로고침하거나 비교 노트의 수동 이동시간을 이용하세요.'; }
}
