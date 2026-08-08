import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type().toUpperCase()+':', m.text().slice(0,300)); });
await p.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
try { await p.waitForFunction('window.__READY__===true', null, { timeout: 90000 }); console.log('READY ok'); }
catch { console.log('NOT READY'); }
await b.close();
