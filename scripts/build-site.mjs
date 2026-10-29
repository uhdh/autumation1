// Only explicitly public files enter the deployment artifact.
import { mkdir, copyFile, writeFile, readFile, unlink } from 'node:fs/promises';
export const publicFiles = ['index.html', 'buy.html', 'about.html', 'privacy.html', 'buyer.js', 'buyer-subway.js', 'buyer-core.js', 'buyer-filters.js', 'buyer-map.js', 'buyer-insights.js', 'buyer.css', 'market-core.js', 'market-data.json', 'rail-data.json', 'station-data.json', 'seoul_apt_complex.json', 'seoul_apt_locations.json', 'seoul_chopuma.json', 'seoul_lawd_codes.json', '_headers', '404.html', 'robots.txt'];
await mkdir('dist', { recursive: true });
// Pages already serves extensionless HTML URLs; rewriting /buy to /buy.html loops.
await unlink('dist/_redirects').catch(e => { if (e.code !== 'ENOENT') throw e; });
for (const file of publicFiles) await copyFile(file, `dist/${file}`);
await copyFile('index.html', 'dist/excel.html');
await copyFile('buy.html', 'dist/index.html');
const data = JSON.parse(await readFile('market-data.json', 'utf8'));
await writeFile('dist/release.json', JSON.stringify({ builtAt: new Date().toISOString(), dataAsOf: data.asOf, commit: process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || 'local' }));
console.log(`Public artifact: ${publicFiles.length} files. Raw data, notes, tests and credentials excluded.`);
