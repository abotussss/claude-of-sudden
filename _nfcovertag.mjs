/** Echo the cover solver's own site list and smoke banks. */
import { chromium } from 'playwright';
const port = process.argv[2] ?? '4613';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
p.on('console', (m) => { const t = m.text(); if (t.includes('nachtfeld')) console.log(t); });
await p.goto(`http://127.0.0.1:${port}/?map=plains&covertag=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await b.close();
