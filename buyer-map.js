import { locationKey, locationIndex } from './buyer-core.js';

const status = document.getElementById('map-status');
let map, maps, popup, openCode, index, latest = [], onChoose;
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
  for (const [code, marker] of complexMarkers) if (!located.has(code)) {
    marker.setMap(null); complexMarkers.delete(code);
    if (openCode === code) closePopup();
  }
  for (const { location, homes } of located.values()) {
    const content = document.createElement('div'); content.className = 'map-popup';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'map-close';
    close.textContent = '닫기'; close.onclick = closePopup; content.append(close);
    const title = document.createElement('strong'); title.textContent = location.name; content.append(title);
    const address = document.createElement('p'); address.textContent = location.address; content.append(address);
    for (const g of homes) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'map-home';
      button.textContent = `${g.area}㎡ · ${money(g.price)} → 후보 보기`;
      button.onclick = () => onChoose(g.id); content.append(button);
    }
    let marker = complexMarkers.get(location.code);
    if (!marker) {
      const dot = document.createElement('button'); dot.type = 'button'; dot.className = 'map-dot';
      marker = new maps.CustomOverlay({ map, position: new maps.LatLng(location.lat, location.lng), content: dot, xAnchor: .5, yAnchor: .5, clickable: true });
      dot.onclick = () => openPopup(marker, location.code);
      complexMarkers.set(location.code, marker);
    }
    marker.getContent().title = `${location.name} · ${money(Math.min(...homes.map(g => g.price)))}부터`;
    marker.getContent().setAttribute('aria-label', marker.getContent().title);
    marker.popupContent = content;
    if (openCode === location.code) popup.setContent(content);
    for (const g of homes) markers.set(g.id, marker);
  }
  status.textContent = `${located.size}개 단지 표시 · 조건에 맞는 ${groups.length}개 단지·면적 중 ${count}개 위치 연결. 위치 미확인 ${groups.length - count}개는 목록에만 표시합니다.`;
}

function closePopup() { popup?.setMap(null); openCode = undefined; }
function openPopup(marker, code) {
  openCode = code; popup.setPosition(marker.getPosition()); popup.setContent(marker.popupContent); popup.setMap(map);
  map.panTo(marker.getPosition());
}

export function showOnMap(id) {
  const marker = markers.get(id);
  if (!marker) return;
  document.getElementById('map-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  map.setLevel(4); map.setCenter(marker.getPosition());
  openPopup(marker, [...complexMarkers].find(([, value]) => value === marker)[0]);
}
export function hasLocation(g) { return !!index?.get(locationKey(g)); }

export async function initMap(ready) {
  try {
    maps = await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => reject(new Error('지도 응답 시간 초과')), 15000);
      const fail = () => { clearTimeout(timer); reject(new Error('지도 연결 실패')); };
      // Browser-public JavaScript key, restricted to registered SDK domains. Never use a REST/admin key here.
      script.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=1f6f50888ac7bb2ebef9834430d76519&autoload=false';
      script.async = true; script.onerror = fail;
      script.onload = () => {
        if (!window.kakao?.maps) { fail(); return; }
        window.kakao.maps.load(() => { clearTimeout(timer); resolve(window.kakao.maps); });
      };
      document.head.append(script);
    });
    const container = document.getElementById('candidate-map');
    map = new maps.Map(container, { center: new maps.LatLng(37.5665, 126.978), level: 8, scrollwheel: false });
    map.addControl(new maps.ZoomControl(), maps.ControlPosition.RIGHT);
    popup = new maps.CustomOverlay({ xAnchor: .5, yAnchor: .5, zIndex: 10, clickable: true });
    maps.event.addListener(map, 'click', closePopup);
    container.addEventListener('keydown', e => { if (e.key === 'Escape') closePopup(); });
    container.addEventListener('error', e => { if (e.target.tagName === 'IMG') document.getElementById('map-error').hidden = false; }, true);
    new ResizeObserver(() => { const center = map.getCenter(); map.relayout(); map.setCenter(center); }).observe(container);
    document.getElementById('map-fit').onclick = () => {
      closePopup();
      const bounds = new maps.LatLngBounds();
      for (const marker of complexMarkers.values()) bounds.extend(marker.getPosition());
      if (complexMarkers.size) { map.setBounds(bounds, 25, 25, 25, 25); if (map.getLevel() < 4) map.setLevel(4); }
      else { map.setLevel(8); map.setCenter(new maps.LatLng(37.5665, 126.978)); }
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
