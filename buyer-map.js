import { locationKey, locationIndex } from './buyer-core.js';

const status = document.getElementById('map-status');
let map, layer, index, latest = [], onChoose;
const markers = new Map(), complexMarkers = new Map();
const money = n => `${(n / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억`;

export function updateMap(groups, choose) {
  latest = groups; onChoose = choose;
  if (!map || !index) return;
  markers.clear();
  const located = new Map();
  let count = 0;
  for (const g of groups) {
    const location = index.get(locationKey(g));
    if (!location) continue;
    count++;
    if (!located.has(location.code)) located.set(location.code, { location, homes: [] });
    located.get(location.code).homes.push(g);
  }
  for (const [code, marker] of complexMarkers) if (!located.has(code)) { layer.removeLayer(marker); complexMarkers.delete(code); }
  for (const { location, homes } of located.values()) {
    const content = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = location.name; content.append(title);
    const address = document.createElement('p'); address.textContent = location.address; content.append(address);
    for (const g of homes) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'map-home';
      button.textContent = `${g.area}㎡ · ${money(g.price)} → 후보 보기`;
      button.onclick = () => onChoose(g.id); content.append(button);
    }
    const marker = complexMarkers.get(location.code) || L.circleMarker([location.lat, location.lng], { radius: 7, color: '#fff', weight: 1.5, fillColor: '#1b5145', fillOpacity: .85 }).addTo(layer);
    marker.bindPopup(content); complexMarkers.set(location.code, marker);
    marker.bindTooltip(`${location.name} · ${money(Math.min(...homes.map(g => g.price))) }부터`);
    for (const g of homes) markers.set(g.id, marker);
  }
  status.textContent = `${located.size}개 단지 표시 · 조건에 맞는 ${groups.length}개 단지·면적 중 ${count}개 위치 연결. 위치 미확인 ${groups.length - count}개는 목록에만 표시합니다.`;
}

export function showOnMap(id) {
  const marker = markers.get(id);
  if (!marker) return;
  document.getElementById('map-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  map.setView(marker.getLatLng(), 15); marker.openPopup();
}
export function hasLocation(g) { return !!index?.get(locationKey(g)); }

export async function initMap(ready) {
  try {
    if (!window.L) throw new Error('지도 라이브러리');
    map = L.map('candidate-map', { scrollWheelZoom: false }).setView([37.5665, 126.978], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).on('tileerror', () => { document.getElementById('map-error').hidden = false; }).addTo(map);
    layer = L.layerGroup().addTo(map);
    document.getElementById('map-fit').onclick = () => {
      const points = [...markers.values()].map(marker => marker.getLatLng());
      if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [25, 25], maxZoom: 15 });
      else map.setView([37.5665, 126.978], 11);
    };
    const response = await fetch('/seoul_apt_locations.json');
    if (!response.ok) throw new Error('좌표 자료');
    const data = await response.json(); index = locationIndex(data.rows);
    document.getElementById('place-date').textContent = `${data.asOf} 수집 · 단지정보 ${data.complexDate} 기준`;
    updateMap(latest, onChoose); ready();
  } catch {
    status.textContent = '지도를 불러오지 못했습니다. 후보 목록은 계속 이용할 수 있습니다.';
    document.getElementById('map-fit').disabled = true;
  }
}
