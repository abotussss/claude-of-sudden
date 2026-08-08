/** Echo the plain's own build lines (cover sites, smoke banks, tank legs). */
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
const lines = [];
const want = /nachtfeld|\[tank\]|cover|smoke/i;
p.on('console', (m) => { const t = m.text(); if (want.test(t)) lines.push(t); });
p.on('pageerror', (e) => lines.push('PAGEERROR ' + e.message));
await p.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await p.waitForTimeout(3000);
for (const l of lines) console.log(l);
await b.close();
