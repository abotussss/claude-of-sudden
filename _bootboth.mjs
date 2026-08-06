/** Boot both maps and count page errors. */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4577/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
let bad = 0;
for (const map of ['town','plains']) {
  const p = await b.newPage({ viewport: { width: 900, height: 520 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message)));
  const warns = [];
  p.on('console', (m) => { if (m.type() === 'warning' && /\[ai\]/.test(m.text())) warns.push(m.text().slice(0,140)); });
  await p.goto(`${URL}?map=${map}&seed=7`, { waitUntil: 'domcontentloaded' });
  let ready = false;
  try { await p.waitForFunction('window.__READY__===true', null, { timeout: 600000 }); ready = true; } catch {}
  console.log(`${map}: __READY__=${ready} pageerrors=${errs.length}`, errs.slice(0,3));
  if (warns.length) console.log(`  [ai] warnings x${warns.length}:`, warns.slice(0,4));
  if (!ready || errs.length) bad++;
  await p.close();
}
await b.close();
process.exit(bad ? 1 : 0);
