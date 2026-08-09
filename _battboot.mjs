import { chromium } from 'playwright';
const URL = process.argv[2];
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e.stack || e.message)));
p.on('console', m => { const t = m.text(); if (/\[batt|batt\]|Error|error/i.test(t)) console.log('  ' + t.slice(0,300)); });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
try { await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 }); } catch (e) { console.log('READY TIMEOUT'); }
const st = await p.evaluate(() => {
  const e = window.__ENGINE__; const m = e?.ctx.peek('match');
  const bt = m?.battery;
  return { id: e?.ctx.peek('world')?.level?.id, phase: m?.phase,
    batt: bt ? { ready: bt.ready, n: bt.vehicles.length, proof: bt.proof } : null };
});
console.log(JSON.stringify(st));
console.log('[pageerror]', errs.length ? errs[0].slice(0,600) : 'none');
await b.close();
