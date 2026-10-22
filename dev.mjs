// 로컬 화면 확인: node dev.mjs (거래·뉴스는 공개 배포 API 사용, 로컬 Functions 검증은 node --test)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const publicFiles = new Set(['index.html', 'buy.html', 'about.html', 'privacy.html', 'station-data.json', 'buyer.js', 'buyer-filters.js', 'buyer-core.js', 'buyer.css', 'buyer-insights.js', 'market-core.js', 'market-data.json', 'rail-data.json', 'buyer-map.js', 'seoul_apt_locations.json', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'seoul_lawd_codes.json', 'seoul_apt_complex.json', 'seoul_chopuma.json']);
const mime = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (['/api/apt-trade', '/api/apt-news'].includes(url.pathname)) {
      const upstream = await fetch(`https://excelzip.pages.dev${url.pathname}${url.search}`, { signal: AbortSignal.timeout(55000) });
      res.writeHead(upstream.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(await upstream.text()); return;
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!publicFiles.has(file)) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': mime[file.split('.').at(-1)], 'cache-control': 'no-store' });
    res.end(await readFile(new URL(file, import.meta.url)));
  } catch { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: '연결을 확인하고 다시 시도해 주세요.' })); }
}).listen(8789, '127.0.0.1', () => console.log('Local preview: http://127.0.0.1:8789/buy.html'));
