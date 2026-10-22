// 금액 단위: 만원. 실제 대출 심사나 세액 산정이 아닌 사용자 입력 시나리오 계산.
export function numberOrNull(value) {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function budgetOf(p) {
  if (p.mode !== 'funds') return numberOrNull(p.budget);
  const values = ['cash', 'loan', 'reserve', 'costs'].map(k => numberOrNull(p[k]));
  if (values.some(v => v === null)) return null;
  const [cash, loan, reserve, costs] = values;
  return Math.max(0, cash + loan - reserve - costs);
}

export function monthlyPayment(principal, annualRate, years) {
  if ([principal, annualRate, years].some(v => numberOrNull(v) === null) || years <= 0) return null;
  const months = years * 12;
  const rate = annualRate / 1200;
  return rate === 0 ? principal / months : principal * rate / (1 - (1 + rate) ** -months);
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 이름을 줄이거나 동 이름을 추측하지 않는다. 중복 단지는 좌표를 선택하지 않는다.
export function locationKey(g) {
  return JSON.stringify([g.gu, g.dong, g.name, g.jibun].map(v => String(v ?? '').normalize('NFC').replace(/\s/g, '')));
}
export function locationIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    if (!row.gu || !row.dong || !row.name || !Number.isFinite(row.lat) || !Number.isFinite(row.lng) ||
      row.lat < 37.4 || row.lat > 37.72 || row.lng < 126.75 || row.lng > 127.2) continue;
    const key = locationKey(row);
    index.set(key, index.has(key) ? null : row);
  }
  return index;
}

export function recentMonths(count, now = new Date()) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

export function tradeSearchJobs(districts, district, months) {
  const regions = districts.filter(d => /^11\d{3}$/.test(d.lawd_cd) && (district === 'all' || d.lawd_cd === district));
  // 서울 전체일 때 최근 월의 모든 구부터 보여준다.
  return months.flatMap(month => regions.map(region => ({ ...region, month })));
}

export function groupTrades(items, lawdCd, guName) {
  const groups = new Map();
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const amount = numberOrNull(it.dealAmountManwon);
    const area = numberOrNull(it.excluUseAr);
    const y = Number(it.dealYear), m = Number(it.dealMonth), d = Number(it.dealDay);
    const date = new Date(y, m - 1, d);
    if (it.isCancelled || !it.aptNm || !it.umdNm || !amount || !area ||
      y < 2000 || date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) continue;
    // 같은 이름도 동·지번이 다르면 분리하고, 서로 다른 전용면적을 합치지 않는다.
    const id = JSON.stringify([lawdCd, it.umdNm, it.jibun || '', it.aptNm, area]);
    if (!groups.has(id)) groups.set(id, { id, name: it.aptNm, dong: it.umdNm, jibun: it.jibun || '',
      gu: guName, area, buildYear: numberOrNull(it.buildYear), trades: [] });
    groups.get(id).trades.push({ amount, date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      month: `${y}${String(m).padStart(2, '0')}`, floor: it.floor || '-', type: it.dealingGbn || '미확인' });
  }
  return [...groups.values()].map(g => {
    g.trades.sort((a, b) => b.date.localeCompare(a.date));
    const amounts = g.trades.map(t => t.amount);
    return { ...g, count: amounts.length, price: median(amounts), min: Math.min(...amounts), max: Math.max(...amounts) };
  });
}

export function assessHome(group, note, profile) {
  const asking = numberOrNull(note.asking);
  const price = asking ?? group.price;
  const repair = numberOrNull(note.repair);
  const budget = budgetOf(profile);
  const headroom = budget === null || repair === null ? null : budget - price - repair;
  let payment = null;
  if (profile.mode === 'funds' && headroom !== null && headroom >= 0) {
    const needed = Math.max(0, price + repair + Number(profile.costs) + Number(profile.reserve) - Number(profile.cash));
    const rate = numberOrNull(profile.rate), years = numberOrNull(profile.years);
    payment = needed === 0 ? 0 : rate === null || years === null ? null : monthlyPayment(needed, rate, years);
  }
  const existing = numberOrNull(profile.existing);
  const monthly = payment === null || existing === null ? null : payment + existing;
  const cap = numberOrNull(profile.monthlyCap);
  return { price, asking, headroom, payment, monthly, monthlyOver: monthly !== null && cap !== null ? monthly > cap : null };
}

export function assessRoutes(destinations, routes = {}) {
  let weekly = 0, complete = true;
  const rows = destinations.filter(d => d.place.trim()).map(d => {
    const r = routes[d.id] || {};
    // 목적지나 이동수단이 바뀌면 예전 시간은 재사용하지 않는다.
    const valid = r.place === d.place && r.mode === d.mode;
    const out = valid ? numberOrNull(r.out) : null;
    const back = valid ? numberOrNull(r.back) : null;
    const limit = numberOrNull(d.limit), visits = numberOrNull(d.visits);
    const status = limit === null ? 'unset' : out === null || back === null ? 'unknown' : Math.max(out, back) > limit ? 'over' : 'ok';
    if (out === null || back === null || visits === null) complete = false;
    else weekly += (out + back) * visits;
    return { ...d, out, back, status };
  });
  return { rows, weekly: rows.length && complete ? weekly : null,
    over: rows.some(r => r.required && r.status === 'over'),
    unknown: rows.some(r => r.required && (r.status === 'unknown' || r.status === 'unset')) };
}
