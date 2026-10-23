import test from 'node:test';
import assert from 'node:assert/strict';

test('Kakao map keeps the viewport, removes filtered dots and popups, and links areas to cards', async t => {
  const element = () => ({ children: [], append(...children) { this.children.push(...children); }, setAttribute() {}, addEventListener() {}, scrollIntoView() {} });
  const nodes = new Map();
  const overlays = [];
  let instance, sdkFails = false;
  class Overlay {
    constructor(options) { Object.assign(this, options); overlays.push(this); }
    setMap(map) { this.map = map; }
    setPosition(position) { this.position = position; }
    getPosition() { return this.position; }
    setContent(content) { this.content = content; }
    getContent() { return this.content; }
  }
  const home = { gu: '성북구', dong: '돈암동', name: '테스트', jibun: '1', code: 'A', lat: 37.6, lng: 127.02, address: '서울', area: 59, price: 70000, id: '59' };
  const originals = Object.fromEntries(['document', 'window', 'ResizeObserver', 'fetch'].map(key => [key, globalThis[key]]));
  t.after(() => { for (const [key, value] of Object.entries(originals)) value === undefined ? delete globalThis[key] : globalThis[key] = value; });
  globalThis.document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement: element,
    head: { append(script) { sdkFails ? script.onerror() : script.onload(); } }
  };
  globalThis.window = { kakao: { maps: {
    load(done) { done(); },
    Map: class { constructor(_, options) { Object.assign(this, options); instance = this; } addControl() {} setLevel(n) { this.level = n; } getLevel() { return this.level; } setCenter(p) { this.center = p; } panTo(p) { this.center = p; } setBounds(b) { this.bounds = b; } },
    LatLng: class { constructor(lat, lng) { Object.assign(this, { lat, lng }); } },
    LatLngBounds: class { points = []; extend(p) { this.points.push(p); } },
    CustomOverlay: Overlay, ZoomControl: class {}, ControlPosition: { RIGHT: 1 }, event: { addListener() {} }
  } } };
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rows: [home], asOf: '2026-10-23', complexDate: '2026-10-16' }) });
  const module = await import('../buyer-map.js?success');
  let chosen, ready = false;
  module.updateMap([home, { ...home, area: 84, id: '84' }], id => { chosen = id; });
  await module.initMap(() => { ready = true; });
  assert.ok(ready);
  assert.equal(overlays.length, 2, 'one popup and one dot for two areas');
  const [popup, dot] = overlays;
  module.showOnMap('84');
  assert.equal(instance.level, 4);
  assert.equal(popup.map, instance);
  popup.content.children.at(-1).onclick();
  assert.equal(chosen, '84');
  const center = instance.center;
  module.updateMap([home], () => {});
  assert.equal(overlays.length, 2, 'reuse retained dots');
  assert.equal(popup.content.children.filter(el => el.className === 'map-home').length, 1);
  assert.equal(instance.center, center, 'filter must not move viewport');
  module.updateMap([], () => {});
  assert.equal(dot.map, null);
  assert.equal(popup.map, null, 'filtered popup must disappear too');
  assert.match(nodes.get('map-status').textContent, /^0개 단지/);
  nodes.get('map-fit').onclick();
  assert.equal(instance.level, 8);
  module.updateMap([home], () => {});
  nodes.get('map-fit').onclick();
  assert.equal(instance.bounds.points.length, 1);
  sdkFails = true;
  const failed = await import('../buyer-map.js?failure');
  await failed.initMap(() => assert.fail('failed SDK cannot signal ready'));
  assert.equal(nodes.get('map-fit').disabled, true);
  assert.match(nodes.get('map-status').textContent, /후보 목록은 계속/);
});
