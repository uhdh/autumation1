import { initSubway, updateSubway, resetSubway, activateExploreTab, subwaySelectionLabel } from './buyer-subway.js';
import { initPropertyFilters, resetPropertyFilters, passesProperties, propertyFiltersActive, propertyBadges, renderPropertySummary } from './buyer-filters.js';
import { resetInsights, loadMarket, metricFor, insightHTML, showAnalysis, initInsights, fitsCommute, commuteActive, routesFor, growthInterval } from './buyer-insights.js';
import { initMap, updateMap, hasLocation, showOnMap } from './buyer-map.js';
import { numberOrNull, budgetOf, groupTrades, recentMonths, median, assessHome, assessRoutes } from './buyer-core.js';

const $ = id => document.getElementById(id);
const form = $('profile-form');
const storageKey = 'excelzip-buyer-v1';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => value === null || !Number.isFinite(value) ? '미확인' : `${(value / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 3 })}억`;
const won = value => value === null ? '미확인' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만원`;
const defaults = [ ['home', '현재 집'], ['me', '내 직장'], ['partner', '배우자 직장'], ['parents', '시댁'], ['inlaws', '처가'] ];
let destinations = defaults.map(([id, name]) => ({ id, name, place: '', mode: '대중교통', visits: '', limit: '', required: false }));
let groups = [], selected = [], notes = {}, query = null, visibleCount = 15, searchSeq = 0, toastTimer;
let stored;
try { stored = JSON.parse(localStorage.getItem(storageKey)); } catch { stored = null; }

function profile() { return Object.fromEntries(new FormData(form)); }
function noteFor(g) { return notes[g.id] || { asking: '', repair: '', routes: {}, memo: '' }; }
function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
function persist() {
  if (!$('remember').checked) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify({ profile: profile(), destinations, selected, notes }));
    $('storage-status').textContent = '이 브라우저에만 저장 중입니다. 공용 기기에서는 저장을 꺼주세요.';
  } catch { $('storage-status').textContent = '기기 저장에 실패했습니다. 현재 입력은 이 화면에서만 유지됩니다.'; }
}

function renderDestinations() {
  $('destinations').innerHTML = destinations.map(d => `<details class="destination" data-destination="${d.id}" ${d.place ? 'open' : ''}><summary>${d.name}${d.place ? ` · ${escape(d.place)}` : ' 추가'}</summary>
    <label>장소<input data-place-field="place" value="${escape(d.place)}" maxlength="200" placeholder="예: 여의도역 / 회사 건물명" aria-label="${d.name} 장소"></label>
    <div class="field-pair"><label>이동수단<select data-place-field="mode" aria-label="${d.name} 이동수단">${['대중교통', '자동차', '도보', '자전거'].map(m => `<option ${d.mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label><label>주 왕복 횟수<input data-place-field="visits" aria-label="${d.name} 주 왕복 횟수" type="number" min="0" max="30" step="0.5" value="${escape(d.visits)}" placeholder="예: 5"></label></div>
    <label>편도 허용시간 (분)<input data-place-field="limit" aria-label="${d.name} 편도 허용시간" type="number" min="1" max="1440" value="${escape(d.limit)}" placeholder="예: 60"></label>
    <label class="checkbox"><input data-place-field="required" type="checkbox" ${d.required ? 'checked' : ''}> 반드시 지킬 이동시간</label></details>`).join('');
  $('places-count').textContent = `${destinations.filter(d => d.place.trim()).length}곳`;
}

function updateBudget() {
  const p = profile(), funds = p.mode === 'funds';
  $('direct-fields').hidden = false; $('funds-fields').hidden = !funds;
  form.elements.budgetEok.required = true;
  form.elements.budgetEok.disabled = false;
  form.elements.budget.disabled = funds;
  for (const k of ['cash', 'loan', 'reserve', 'costs']) { form.elements[k].required = funds; form.elements[k].disabled = !funds; }
  const budget = budgetOf(profile());
  if (funds) form.elements.budgetEok.value = budget === null ? '' : String(budget / 10000);
  const lower = numberOrNull(p.priceMinEok);
  const rangeError = lower === null || budget === null ? '최소·최대 가격을 입력해 주세요.' : lower * 10000 > budget ? '최소 가격은 최대 가격 이하여야 합니다.' : '';
  form.elements.priceMinEok.setCustomValidity(rangeError);
  $('price-range-error').textContent = rangeError;
  $('budget-value').textContent = budget === null ? '입력 전' : money(budget);
  $('budget-explanation').textContent = funds ? '현금 + 입력한 대출 한도 − 비상금 − 부대비용' : '입력한 집값 상한 · 후보별 수리비는 별도 차감';
  $('quick-summary').textContent = budget === null ? '지역과 예산을 고르면 바로 살펴볼 수 있어요.' : funds ? `대출 ${money(Number(p.loan))} + 내 돈 ${money(Number(p.cash))} · 집값 ${money(budget)} 이하${Number(p.costs) === 0 && Number(p.reserve) === 0 ? ' (부대비용·비상금 미반영)' : ' (입력한 비용 차감)'}` : `${money(budget)} 이하로 살펴보기 · 집값 기준`;
  if (!rangeError) $('quick-summary').textContent += ` · 탐색 ${money(lower * 10000)}~${money(budget)}`;
  document.querySelectorAll('[data-budget]').forEach(button => button.setAttribute('aria-pressed', Number(button.dataset.budget) === budget));
}

function renderResults() {
  const p = profile(), budget = budgetOf(p), min = numberOrNull(p.areaMin), max = numberOrNull(p.areaMax);
  const areaMatches = groups.filter(g => (min === null || g.area >= min) && (max === null || g.area <= max));
  const lower = numberOrNull(p.priceMinEok);
  const validRange = lower !== null && budget !== null && lower * 10000 <= budget && form.elements.budgetEok.validity.valid;
  const inBudget = areaMatches.filter(g => validRange && g.price >= lower * 10000 && g.price <= budget);
  const budgetMatches = $('include-over').checked ? areaMatches.filter(g => validRange && g.price >= lower * 10000) : inBudget;
  const commuteMatches = budgetMatches.filter(fitsCommute);
  const propertyMatches = commuteMatches.filter(passesProperties);
  renderPropertySummary(commuteMatches, propertyMatches);
  const result = updateSubway(propertyMatches);
  const sort = $('sort').value;
  const metric = g => sort === 'jeonse' ? metricFor(g)?.jeonse?.pct : sort === 'growth' ? metricFor(g)?.growth[growthInterval()]?.pct : metricFor(g)?.valuation?.score;
  result.sort((a, b) => ['jeonse', 'growth', 'value'].includes(sort) ? (metric(b) ?? -Infinity) - (metric(a) ?? -Infinity) : sort === 'commute' && commuteActive() ? Math.max(...routesFor(a).map(r => Math.max(r.out.minutes, r.back.minutes))) - Math.max(...routesFor(b).map(r => Math.max(r.out.minutes, r.back.minutes))) : sort === 'fit' && budget !== null ? Math.abs(a.price - budget) - Math.abs(b.price - budget) : sort === 'recent' ? b.trades[0].date.localeCompare(a.trades[0].date) : sort === 'count' ? b.count - a.count : a.price - b.price);
  updateMap(result, id => {
    const position = result.findIndex(g => g.id === id);
    if (position < 0) return;
    visibleCount = Math.max(visibleCount, position + 1); renderResults();
    const card = [...document.querySelectorAll('[data-candidate]')].find(el => el.dataset.candidate === id);
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' }); card?.focus({ preventScroll: true });
  });
  $('result-tools').hidden = !query;
  if (!query) return;
  if (!query.loading && query.failed.length === query.total) {
    $('search-status').className = 'status error';
    $('search-status').textContent = `${query.gu} · 전체 기간 조회 실패 — 거래가 0건이라는 뜻이 아닙니다.`;
    $('candidate-list').innerHTML = '<div class="empty-state"><h3>거래 정보를 가져오지 못했어요.</h3><p>연결 상태를 확인하고 후보 찾기를 다시 눌러주세요.<br>이미 담아둔 비교 노트는 유지됩니다.</p></div>';
    $('more-results').hidden = true;
    return;
  }
  const missing = query.failed.length ? ` · ${query.failed.length}개 구·월 조회 실패 — 일부 자료` : '';
  const changed = p.district !== query.district || Number(p.period) !== query.months.length;
  $('search-status').className = `status${query.failed.length ? ' error' : ''}`;
  $('search-status').textContent = `${query.gu} · ${query.months.at(-1)}~${query.months[0]} · ${groups.length}개 단지·면적 중 예산·면적 조건 ${inBudget.length}개${query.loading ? ` · ${query.done}/${query.total}개 구·월 조회 중` : ''}${missing}${query.snapshot ? ` · 서울시 ${query.snapshot} 수집 자료` : ''}${commuteActive() ? ` · 이동조건 충족 ${commuteMatches.length}개 / 시간 초과·미확인 ${budgetMatches.length - commuteMatches.length}개` : ''}${changed ? ' · 지역/기간 변경은 후보 찾기를 눌러 적용하세요.' : ''}`;
  if (subwaySelectionLabel()) $('search-status').textContent += ` · ${subwaySelectionLabel()} · ${result.length}개 단지·면적`;
  if (!result.length) {
    $('candidate-list').innerHTML = query.loading ? '<div class="empty-state"><h3>예산에 맞는 집을 찾고 있어요.</h3><p>조회된 지역부터 차례로 보여드릴게요.</p></div>' : `<div class="empty-state"><h3>${groups.length ? '지금 조건에 맞는 후보가 없어요.' : '표시할 거래가 없습니다.'}</h3><p>${!groups.length ? '조회 기간이나 지역을 바꿔보세요. 오류가 표시됐다면 다시 조회할 수 있습니다.' : !validRange ? '최소·최대 가격 범위를 확인해 주세요.' : subwaySelectionLabel() ? '선택한 역 주변에 현재 조건을 만족하는 후보가 없습니다. 역 선택을 해제하거나 범위·예산을 넓혀보세요.' : propertyFiltersActive() ? '단지 조건을 해제하거나 기준을 넓혀보세요. 조건 정보 미확인 단지도 제외됩니다.' : commuteActive() && inBudget.length ? '예산에 맞는 후보는 있지만 이동시간 상한을 넘거나 위치·경로를 확인할 수 없습니다. 역 선택을 해제하거나 시간을 늘려보세요.' : budget === null ? '집값 예산을 먼저 입력해주세요.' : `면적 조건에 맞는 후보 ${areaMatches.length}개 중 예산 안의 후보는 ${inBudget.length}개입니다.<br>예산 초과 후보를 확인하거나 면적 범위를 넓혀보세요.`}</p></div>`;
  } else {
    $('candidate-list').innerHTML = result.slice(0, visibleCount).map(g => {
      const picked = selected.some(s => s.id === g.id), headroom = budget === null ? null : budget - g.price;
      return `<article tabindex="-1" data-candidate="${escape(g.id)}" class="candidate${picked ? ' selected' : ''}"><div><div class="address">${escape(g.gu)} ${escape(g.dong)} · 전용 ${g.area}㎡</div><h3>${escape(g.name)}</h3><div class="address">${g.buildYear ? `${g.buildYear}년 준공` : '준공연도 미확인'} · 지번 ${escape(g.jibun || '미확인')}</div><div class="address">${propertyBadges(g).map(escape).join(' · ')}</div><div class="badges"><span class="badge${headroom !== null && headroom < 0 ? ' over' : ''}">${headroom === null ? '예산 미입력' : headroom < 0 ? `${money(-headroom)} 예산 초과` : `예산 내 · ${money(headroom)} 여유`}</span><span class="badge${g.count < 5 ? ' warn' : ''}">거래 ${g.count}건${g.count < 5 ? ' · 표본 적음' : ''}</span>${g.failedMonths?.length ? '<span class="badge warn">일부 기간 누락</span>' : query.loading && g.loadedMonths?.length < query.months.length ? '<span class="badge warn">기간 조회 중</span>' : ''}</div></div>
      <div class="candidate-price"><small>조회 기간 실거래 중앙값</small><strong>${money(g.price)}</strong></div>
      ${insightHTML(g)}<div class="candidate-bottom"><p>최근 ${g.trades[0].date}<br>실거래 ${money(g.min)} ~ ${money(g.max)} · 매물 아님</p><div class="candidate-actions">${hasLocation(g) ? `<button class="secondary" data-map="${escape(g.id)}">지도</button>` : '<span class="hint">위치 미연결</span>'}<button class="secondary" data-analysis="${escape(g.id)}">분석 근거</button><button class="secondary" data-trades="${escape(g.id)}">가격 흐름</button><button class="${picked ? 'secondary' : 'primary'}" data-pick="${escape(g.id)}">${picked ? '비교에서 빼기' : '비교에 담기'}</button></div></div></article>`;
    }).join('');
  }
  $('more-results').hidden = result.length <= visibleCount;
  $('more-results').textContent = `후보 더 보기 (${Math.min(visibleCount, result.length)} / ${result.length})`;
}

function routeLabel(row) {
  return row.status === 'ok' ? '입력한 허용시간 이내' : row.status === 'over' ? `허용시간 ${row.limit}분 초과` : row.status === 'unset' ? '허용시간 미설정' : '왕복 각각의 시간 확인 필요';
}

function assessmentHTML(g) {
  const a = assessHome(g, noteFor(g), profile()), routes = assessRoutes(destinations, noteFor(g).routes);
  const rough = budgetOf(profile());
  const estimate = rough === null ? null : rough - a.price;
  return `<span>${a.asking === null ? '실거래 중앙값 기준' : '직접 입력한 매물 가격 기준'} · ${money(a.price)}</span>
    <strong class="${(a.headroom ?? estimate) < 0 ? 'negative' : 'positive'}">${a.headroom === null ? estimate === null ? '예산 미설정' : estimate < 0 ? `${money(-estimate)} 예산 초과` : `${money(estimate)} 집값 차액` : a.headroom < 0 ? `${money(-a.headroom)} 예산 초과` : `${money(a.headroom)} 예산 여유`}</strong>
    ${a.headroom === null ? '<span>수리비 입력 전 · 최종 구매 여력은 별도 확인</span>' : ''}
    ${profile().mode === 'funds' && numberOrNull(profile().rate) !== null && numberOrNull(profile().years) !== null ? `<span>예상 신규대출 월 상환 ${won(a.payment)}<br>기존 대출 포함 ${won(a.monthly)}${a.monthlyOver === true ? ' <b class="negative">· 월 상환 상한 초과</b>' : a.monthlyOver === false ? ' · 입력한 상한 이내' : ''}</span>` : ''}
    ${routes.rows.length ? `<span>등록 거점 주간 왕복 ${routes.weekly === null ? '시간 미확인' : `${routes.weekly.toLocaleString()}분`}<br>${routes.over ? '<b class="negative">필수 이동조건 미달</b>' : routes.unknown ? '필수 이동조건 확인 필요' : routes.rows.some(r => r.required) ? '입력한 필수 이동조건 충족' : '필수 이동조건 미설정'}</span>` : ''}`;
}

function renderComparison() {
  $('compare-count').textContent = `${selected.length}/3`;
  $('comparison').hidden = !selected.length;
  $('compare-shortcut').hidden = !selected.length;
  if (!selected.length) { $('compare-list').innerHTML = '<div class="compare-empty">후보에서 ‘비교에 담기’를 누르면 이곳에 표시됩니다.</div>'; return; }
  $('compare-list').innerHTML = selected.map(g => {
    const note = noteFor(g), routeAssessment = assessRoutes(destinations, note.routes);
    return `<article class="compare-card" data-home="${escape(g.id)}"><div class="compare-top"><div><div class="address">${escape(g.gu)} ${escape(g.dong)}</div><h3>${escape(g.name)}</h3></div><button class="remove" data-pick="${escape(g.id)}" aria-label="${escape(g.name)} 비교에서 빼기">빼기</button></div>
      <p class="reference">전용 ${g.area}㎡ · 거래 ${g.count}건<br>조회 거래 ${g.trades.at(-1).date} ~ ${g.trades[0].date}<br>실거래 중앙값 ${money(g.price)}${g.failedMonths?.length ? `<br><span class="negative">${g.failedMonths.length}개월 조회 누락 · 일부 자료</span>` : ''}</p>
      <div class="assessment" data-assessment>${assessmentHTML(g)}</div>
      <details><summary>매물 가격·수리비 넣어보기</summary><label>검토 중인 매물 가격 (만원)<input data-note="asking" aria-label="${escape(g.name)} 매물 가격" type="number" min="1" max="10000000" value="${escape(note.asking)}" placeholder="없으면 실거래 중앙값 사용"></label>
      <label>별도 수리비 예상 (만원)<input data-note="repair" aria-label="${escape(g.name)} 수리비" type="number" min="0" max="1000000" value="${escape(note.repair)}" placeholder="수리비가 들지 않으면 0"></label>
      </details>
      <details ${!routeAssessment.rows.length ? 'hidden' : ''}><summary>가족의 이동시간 <span>직접 확인·입력</span></summary><p class="hint">가는 시간과 돌아오는 시간을 직접 입력합니다. 자동 조회값이 아닙니다.</p>
      ${routeAssessment.rows.map(d => `<div class="route-row" data-route="${d.id}"><strong>${d.name}${d.required ? ' · 필수' : ''}</strong><small>${escape(d.place)} · ${d.mode} · 주 ${d.visits === '' ? '?' : escape(d.visits)}회</small><div class="field-pair"><label>가는 편도 (분)<input data-direction="out" aria-label="${escape(g.name)} ${d.name} 가는 시간" type="number" min="0" max="1440" value="${d.out ?? ''}" placeholder="미확인"></label><label>오는 편도 (분)<input data-direction="back" aria-label="${escape(g.name)} ${d.name} 오는 시간" type="number" min="0" max="1440" value="${d.back ?? ''}" placeholder="미확인"></label></div><p class="route-status ${d.status === 'over' ? 'negative' : ''}">${routeLabel(d)}</p></div>`).join('')}</details>
      <details><summary>메모·매물 링크 남기기</summary><div class="notes"><label>이 집의 장점·포기할 점·임장 메모<textarea data-note="memo" maxlength="2000" placeholder="예: 배우자 출근은 짧지만 주차 확인 필요">${escape(note.memo)}</textarea></label><label>검토한 매물 링크<input type="url" data-note="link" maxlength="2000" value="${escape(note.link || '')}" placeholder="https://…"></label></div></details></article>`;
  }).join('');
}

function showTrades(id) {
  const g = groups.find(g => g.id === id) || selected.find(g => g.id === id);
  if (!g) return;
  $('trade-title').textContent = `${g.name} · 전용 ${g.area}㎡`;
  const months = query?.months ? [...query.months].reverse() : [...new Set(g.trades.map(t => t.month))].sort();
  const buckets = months.map(month => ({ month, values: g.trades.filter(t => t.month === month).map(t => t.amount) }));
  const ceiling = Math.max(...g.trades.map(t => t.amount));
  $('trade-content').innerHTML = `<p>${escape(g.gu)} ${escape(g.dong)} ${escape(g.jibun)} · 취소 거래 제외<br>월별 중앙값과 거래 건수입니다. 거래가 없는 달은 연결하지 않습니다.</p><div class="chart" aria-label="월별 실거래 중앙값 막대그래프">${buckets.map(b => `<div class="chart-column">${b.values.length ? `<span class="chart-value">${money(median(b.values))}</span><div class="bar" style="height:${Math.max(4, median(b.values) / ceiling * 75)}px"></div>` : '<span class="no-trade">—</span>'}<small>${b.month.slice(2, 4)}.${b.month.slice(4)}<br>${g.failedMonths?.includes(b.month) ? '조회 실패' : query?.loading && !g.loadedMonths?.includes(b.month) ? '조회 중' : `${b.values.length}건`}</small></div>`).join('')}</div><p>${g.count < 5 ? '거래 표본이 적습니다. 이 자료만으로 가격 추세나 저평가를 판단하지 않습니다.' : '층·계약 조건 차이가 포함된 과거 거래입니다. 가격 차이가 곧 저평가를 의미하지 않습니다.'} 이번 달 자료는 신고에 따라 추가·정정될 수 있습니다.</p><div class="table-scroll"><table><caption class="hint">조회된 거래 ${g.count}건 전체</caption><thead><tr><th scope="col">계약일</th><th scope="col">거래금액</th><th scope="col">층</th><th scope="col">거래유형</th></tr></thead><tbody>${g.trades.map(t => `<tr><td>${t.date}</td><td>${money(t.amount)}</td><td>${escape(t.floor)}</td><td>${escape(t.type)}</td></tr>`).join('')}</tbody></table></div>`;
  $('trade-dialog').showModal();
}

async function search(event) {
  event.preventDefault();
  const p = profile(), budget = budgetOf(p), min = numberOrNull(p.areaMin), max = numberOrNull(p.areaMax);
  if (budget === null || budget <= 0) { toast('구매 가능한 집값 예산을 입력해 주세요.'); return; }
  if (min !== null && max !== null && min > max) { toast('최소 면적이 최대 면적보다 큽니다.'); return; }
  const seq = ++searchSeq;
  $('search-button').disabled = true; $('search-button').textContent = '공개 거래 자료 불러오는 중…';
  try {
    const snapshot = await loadMarket();
    if (seq !== searchSeq) return;
    const months = recentMonths(Number(p.period), new Date(Number(snapshot.asOf.slice(0, 4)), Number(snapshot.asOf.slice(4, 6)) - 1, 1));
    const regions = new Map();
    for (const row of snapshot.rows) {
      if (p.district !== 'all' && row.lawdCd !== p.district) continue;
      if (!regions.has(row.lawdCd)) regions.set(row.lawdCd, { gu: row.gu, items: [] });
      for (const [date, amount, floor, area, type] of row.sales) {
        if (!months.includes(date.slice(0, 6))) continue;
        regions.get(row.lawdCd).items.push({ aptNm: row.name, umdNm: row.dong, jibun: row.jibun, excluUseAr: area, dealYear: date.slice(0, 4), dealMonth: date.slice(4, 6), dealDay: date.slice(6), dealAmountManwon: amount, floor: String(floor), buildYear: row.buildYear, dealingGbn: type });
      }
    }
    groups = [...regions].flatMap(([code, region]) => groupTrades(region.items, code, region.gu).map(g => ({ ...g, loadedMonths: months, failedMonths: [] })));
    visibleCount = 15;
    query = { district: p.district, gu: form.elements.district.selectedOptions[0].textContent, months, failed: [], total: 1, done: 1, loading: false, snapshot: snapshot.asOf };
    selected = selected.map(g => groups.find(fresh => fresh.id === g.id) || g);
    renderResults(); renderComparison(); persist();
    if (!event.auto && matchMedia('(max-width:700px)').matches) $('results').scrollIntoView({ behavior: 'smooth' });
  } catch {
    if (seq !== searchSeq) return;
    $('search-status').className = 'status error';
    $('search-status').textContent = '공개 거래 자료를 불러오지 못했습니다. 집 찾아보기를 눌러 다시 시도하세요. 기존 결과가 있다면 이전 조건의 결과입니다.';
  } finally {
    if (seq === searchSeq) { $('search-button').disabled = false; $('search-button').textContent = '집 찾아보기 →'; }
  }
}

form.addEventListener('submit', search);
form.addEventListener('invalid', event => {
  const dialog = event.target.closest('dialog');
  if (dialog && !dialog.open) dialog.showModal();
  if (event.target.name === 'budgetEok') { $('custom-budget').setAttribute('aria-expanded', 'true'); updateBudget(); }
  const details = event.target.closest('details'); if (details) details.open = true;
}, true);
form.addEventListener('input', event => {
  if (event.target.name === 'budgetEok') {
    form.elements.mode.value = 'direct';
    const value = numberOrNull(event.target.value);
    form.elements.budget.value = value === null ? '' : String(Math.round(value * 10000));
  }
  const row = event.target.closest('[data-destination]');
  if (row) {
    const d = destinations.find(d => d.id === row.dataset.destination), key = event.target.dataset.placeField;
    if (key) d[key] = key === 'required' ? event.target.checked : event.target.value;
    $('places-count').textContent = `${destinations.filter(d => d.place.trim()).length}곳`;
    renderComparison();
  } else { updateBudget(); renderResults(); renderComparison(); }
  persist();
  if (['district', 'period'].includes(event.target.name) && form.checkValidity() && budgetOf(profile()) > 0) form.requestSubmit();
});
$('include-over').addEventListener('change', renderResults);
$('sort').addEventListener('change', renderResults);
$('more-results').addEventListener('click', () => { visibleCount += 15; renderResults(); });
document.addEventListener('click', event => {
  const analysis = event.target.closest('[data-analysis]');
  if (analysis) { const g = groups.find(g => g.id === analysis.dataset.analysis); if (g) showAnalysis(g); }
  const mapButton = event.target.closest('[data-map]');
  if (mapButton) { activateExploreTab('map'); showOnMap(mapButton.dataset.map); }
  const opener = event.target.closest('[data-open]');
  if (opener) $(opener.dataset.open).showModal();
  const closer = event.target.closest('[data-close]');
  if (closer) {
    const dialog = $(closer.dataset.close);
    const invalid = [...dialog.querySelectorAll('input,select')].find(el => !el.disabled && !el.checkValidity());
    if (invalid) { invalid.closest('details')?.setAttribute('open', ''); invalid.reportValidity(); return; }
    dialog.close(); renderResults(); renderComparison(); persist();
  }
  const budgetButton = event.target.closest('[data-budget]');
  if (budgetButton) {
    if (budgetOf(profile()) !== Number(budgetButton.dataset.budget)) form.elements.mode.value = 'direct';
    form.elements.budget.value = budgetButton.dataset.budget;
    form.elements.budgetEok.value = String(Number(budgetButton.dataset.budget) / 10000);
    $('custom-budget').setAttribute('aria-expanded', 'false'); updateBudget(); renderComparison(); persist();
    const current = profile();
    if (query?.district === current.district && query.months.length === Number(current.period) && (query.loading || groups.length)) renderResults();
    else if (form.elements.district.value) form.requestSubmit();
  }
  const pick = event.target.closest('[data-pick]');
  if (pick) {
    const id = pick.dataset.pick, index = selected.findIndex(g => g.id === id);
    if (index >= 0) selected.splice(index, 1);
    else {
      if (selected.length >= 3) { toast('비교는 최대 3개입니다. 담아둔 후보를 하나 빼주세요.'); return; }
      const g = groups.find(g => g.id === id); if (!g) return;
      selected.push(g); toast(`비교에 담았습니다 (${selected.length}/3). 아래에서 매물과 이동시간을 입력하세요.`);
    }
    renderResults(); renderComparison(); persist();
  }
  const trade = event.target.closest('[data-trades]');
  if (trade) showTrades(trade.dataset.trades);
});
$('custom-budget').addEventListener('click', () => {
  form.elements.mode.value = 'direct'; $('custom-budget').setAttribute('aria-expanded', 'true'); updateBudget(); form.elements.budgetEok.focus();
});
$('compare-list').addEventListener('input', event => {
  const card = event.target.closest('[data-home]'); if (!card) return;
  const g = selected.find(g => g.id === card.dataset.home); if (!g) return;
  const note = notes[g.id] ||= { asking: '', repair: '', routes: {}, memo: '' };
  if (event.target.dataset.note) note[event.target.dataset.note] = event.target.validity.valid ? event.target.value : '';
  const route = event.target.closest('[data-route]');
  if (route) {
    const d = destinations.find(d => d.id === route.dataset.route);
    const old = note.routes[d.id];
    const r = old?.place === d.place && old?.mode === d.mode ? old : { place: d.place, mode: d.mode, out: '', back: '' };
    r[event.target.dataset.direction] = event.target.validity.valid ? event.target.value : '';
    note.routes[d.id] = r;
    const row = assessRoutes([d], note.routes).rows[0];
    route.querySelector('.route-status').textContent = routeLabel(row);
    route.querySelector('.route-status').classList.toggle('negative', row.status === 'over');
  }
  const invalid = [...card.querySelectorAll('input')].some(input => !input.validity.valid);
  card.querySelector('[data-assessment]').innerHTML = invalid ? '<strong class="negative">입력값을 확인해 주세요.</strong><span>금액과 시간은 표시된 허용 범위 안에서 입력해 주세요.</span>' : assessmentHTML(g); persist();
});
$('close-trades').addEventListener('click', () => $('trade-dialog').close());
$('remember').addEventListener('change', () => {
  if ($('remember').checked) persist();
  else {
    try { localStorage.removeItem(storageKey); $('storage-status').textContent = '기기 저장을 지웠습니다. 현재 화면의 입력은 임시 보관합니다.'; }
    catch { $('storage-status').textContent = '저장 삭제에 실패했습니다. 브라우저의 사이트 데이터에서 삭제해 주세요.'; }
  }
});
$('reset').addEventListener('click', () => {
  if (!confirm('저장된 조건과 비교 노트를 모두 지울까요?')) return;
  try { localStorage.removeItem(storageKey); } catch { toast('기기 저장을 지우지 못했습니다. 브라우저 사이트 데이터를 확인해 주세요.'); return; }
  searchSeq++; form.reset(); $('remember').checked = false;
  $('custom-budget').setAttribute('aria-expanded', 'false');
  destinations = defaults.map(([id, name]) => ({ id, name, place: '', mode: '대중교통', visits: '', limit: '', required: false }));
  selected = []; notes = {}; groups = []; query = null; $('sort').value = 'fit'; $('include-over').checked = false; resetInsights(); resetPropertyFilters(); resetSubway(); renderPropertySummary([], []); updateMap([], () => {});
  $('search-button').disabled = false; $('search-button').innerHTML = '집 찾아보기 →';
  $('candidate-list').classList.remove('busy'); $('candidate-list').innerHTML = '<div class="empty-state"><h3>입력을 모두 지웠습니다.</h3><p>새 조건으로 집 찾기를 시작할 수 있습니다.</p></div>';
  $('search-status').textContent = '조건을 입력하면 실제 거래가 있는 단지·면적을 찾아드립니다.';
  $('search-status').className = 'status'; $('result-tools').hidden = true; $('more-results').hidden = true;
  $('storage-status').textContent = '기본은 임시 보관입니다. 새로고침하면 사라집니다.';
  renderDestinations(); updateBudget(); renderComparison();
});

async function init() {
  renderDestinations(); updateBudget();
  try {
    const response = await fetch('/seoul_lawd_codes.json');
    if (!response.ok) throw new Error();
    const districts = await response.json();
    $('district').innerHTML = '<option value="all" selected>서울 전체</option>' + districts.filter(d => /^11\d{3}$/.test(d.lawd_cd) && typeof d.name === 'string').map(d => `<option value="${d.lawd_cd}">${escape(d.name)}</option>`).join('');
  } catch { $('district').innerHTML = '<option value="">지역 목록을 불러오지 못했습니다</option>'; $('search-status').textContent = '지역 정보를 불러오지 못했습니다. 연결을 확인하고 새로고침해 주세요.'; }
  if (stored && typeof stored === 'object') {
    try {
      for (const [key, value] of Object.entries(stored.profile || {})) {
        const field = form.elements.namedItem(key);
        if (field && ['string', 'number'].includes(typeof value)) field.value = String(value).slice(0, 100);
      }
      destinations = destinations.map(d => {
        const s = stored.destinations?.find?.(s => s.id === d.id);
        if (!s) return d;
        return { ...d, place: typeof s.place === 'string' ? s.place.slice(0, 200) : '',
          mode: ['대중교통', '자동차', '도보', '자전거'].includes(s.mode) ? s.mode : d.mode,
          visits: numberOrNull(s.visits) !== null && Number(s.visits) <= 30 ? String(s.visits) : '',
          limit: numberOrNull(s.limit) !== null && Number(s.limit) <= 1440 ? String(s.limit) : '', required: s.required === true };
      });
      for (const g of (Array.isArray(stored.selected) ? stored.selected : []).slice(0, 3)) {
        const id = JSON.parse(g.id);
        if (!Array.isArray(id) || !/^11\d{3}$/.test(id[0]) || !Array.isArray(g.trades)) continue;
        const items = g.trades.slice(0, 2000).filter(t => typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date)).map(t => ({ aptNm: String(id[3]).slice(0, 150), umdNm: String(id[1]).slice(0, 100), jibun: String(id[2]).slice(0, 100), excluUseAr: id[4], buildYear: g.buildYear, dealYear: t.date.slice(0, 4), dealMonth: t.date.slice(5, 7), dealDay: t.date.slice(8), dealAmountManwon: t.amount, floor: String(t.floor).slice(0, 20), dealingGbn: String(t.type).slice(0, 40) }));
        const restored = groupTrades(items, id[0], String(g.gu).slice(0, 20))[0];
        if (restored) selected.push({ ...restored, failedMonths: Array.isArray(g.failedMonths) ? g.failedMonths.filter(m => /^20\d{2}(0[1-9]|1[0-2])$/.test(m)).slice(0, 12) : [] });
      }
      for (const g of selected) {
        const s = stored.notes?.[g.id]; if (!s || typeof s !== 'object') continue;
        const routes = {};
        for (const d of destinations) {
          const r = s.routes?.[d.id]; if (!r || r.place !== d.place || r.mode !== d.mode) continue;
          routes[d.id] = { place: d.place, mode: d.mode, out: numberOrNull(r.out) !== null && Number(r.out) <= 1440 ? String(r.out) : '', back: numberOrNull(r.back) !== null && Number(r.back) <= 1440 ? String(r.back) : '' };
        }
        notes[g.id] = { asking: numberOrNull(s.asking) !== null ? String(s.asking) : '', repair: numberOrNull(s.repair) !== null ? String(s.repair) : '', memo: typeof s.memo === 'string' ? s.memo.slice(0, 2000) : '', link: typeof s.link === 'string' ? s.link.slice(0, 2000) : '', routes };
      }
      $('remember').checked = true; $('storage-status').textContent = '이 기기에 저장된 조건·후보를 불러왔습니다. 거래는 후보 찾기를 눌러 새로 조회하세요.';
    } catch { toast('저장된 일부 자료를 복원하지 못했습니다. 입력을 확인해 주세요.'); }
    stored = null;
  }
  form.elements.budgetEok.value = form.elements.budget.value ? String(Number(form.elements.budget.value) / 10000) : '';
  updateBudget(); renderDestinations(); renderComparison();
  if (form.elements.district.value && form.checkValidity() && budgetOf(profile()) > 0) search({ preventDefault() {}, auto: true });
}
initSubway(renderResults);
initPropertyFilters(renderResults);
initMap(renderResults);
initInsights(renderResults);
init();
