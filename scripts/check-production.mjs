import { execFileSync } from 'node:child_process';
const expected = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
let verified = false;
for (let attempt = 0; attempt < 40; attempt++) {
  const release = await fetch(`https://excelzip.pages.dev/release.json?t=${Date.now()}`).then(r => r.json()).catch(() => null);
  if (release?.commit === expected) { console.log(`Production verified: ${expected}`); verified = true; break; }
  await new Promise(resolve => setTimeout(resolve, 15000));
}
if (!verified) throw new Error('Production did not reach the committed snapshot within 10 minutes');
