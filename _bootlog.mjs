import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio','--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const lines = [];
page.on('console', (m) => lines.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => lines.push(`[pageerror] ${e.message}`));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
try { await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 }); }
catch (e) { lines.push('[BOOT TIMEOUT] ' + e.message); }
await page.waitForTimeout(4000);
for (const l of lines) if (/\[world\]|\[ai\]|\[match\]|error|Error|warn|not walkable/i.test(l)) console.log(l);
console.log('--- total console lines:', lines.length);
await browser.close();
