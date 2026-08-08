/**
 * WHO IS HOLDING THE WEAPONS QUOTA?
 *
 * `_gunchain` measured 47 % of weapons-bus acquires REFUSED while the field as
 * a whole sat at 44 of 72. That means the weapons bus is pinned at its own
 * 32-slot cap. This samples the live field and reports, per bus, how many slots
 * are held, how many are `tracked` (unstealable), and by which tag.
 *
 *   node _poolwho.mjs [--map=town] [--seconds=45] [--scale=6]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const MAP = args.map ?? 'town';
const SECONDS = Number(args.seconds ?? 45);
const SCALE = Number(args.scale ?? 6);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-frame-rate-limit',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:4594/?map=${MAP}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await page.evaluate(async (scale) => {
  const e = window.__ENGINE__, ctx = e.ctx;
  const a = ctx.peek('audio');
  try { await a?.start?.(); } catch { /* reported below */ }
  const M = { snaps: [], tagHold: {}, busHold: {}, trackedHold: {}, n: 0,
    farOffers: 0, farVoices: 0 };
  window.__M__ = M;
  if (a?.battle) {
    for (const k of ['offerFar', 'play', 'update', '_play', '_fire']) {
      if (typeof a.battle[k] === 'function' && k === 'offerFar') {
        const o = a.battle[k].bind(a.battle);
        a.battle[k] = (...ar) => { M.farOffers++; return o(...ar); };
      }
    }
  }
  setInterval(() => {
    const f = a?.field; if (!f?.emitters) return;
    M.n++;
    const bus = {}, tr = {}, tag = {};
    for (const em of f.emitters) {
      if (em.free) continue;
      const b = em.busName ?? '?';
      bus[b] = (bus[b] ?? 0) + 1;
      if (em.tracked) tr[b] = (tr[b] ?? 0) + 1;
      const t = `${b}:${em.tag ?? 'untagged'}${em.tracked ? '(tracked)' : ''}`;
      tag[t] = (tag[t] ?? 0) + 1;
    }
    for (const k in bus) M.busHold[k] = (M.busHold[k] ?? 0) + bus[k];
    for (const k in tr) M.trackedHold[k] = (M.trackedHold[k] ?? 0) + tr[k];
    for (const k in tag) M.tagHold[k] = (M.tagHold[k] ?? 0) + tag[k];
    M.snaps.push({ t: +ctx.time.elapsed.toFixed(1), bus, tracked: tr });
  }, 200);
  ctx.time.scale = scale;
}, SCALE);

await page.waitForTimeout(SECONDS * 1000);

const out = await page.evaluate(() => {
  const e = window.__ENGINE__, M = window.__M__;
  const a = e.ctx.peek('audio');
  const mean = (o) => { const r = {}; for (const k in o) r[k] = +(o[k] / M.n).toFixed(2); return r; };
  const top = Object.entries(M.tagHold).sort((x, y) => y[1] - x[1]).slice(0, 14)
    .map(([k, v]) => [k, +(v / M.n).toFixed(2)]);
  return {
    level: e.ctx.peek('world').level.id, phase: e.ctx.peek('match')?.phase ?? '?',
    seconds: +e.ctx.time.elapsed.toFixed(1), samples: M.n,
    capacity: a.field.emitters.length,
    caps: { weapons: a.field.busCap('weapons'), foley: a.field.busCap('foley'),
      voice: a.field.busCap('voice'), ambience: a.field.busCap('ambience') },
    meanHeldByBus: mean(M.busHold),
    meanTrackedByBus: mean(M.trackedHold),
    topHolders_meanSlots: top,
    farOffers: M.farOffers,
    stolen: a.stats.stolen, dropped: a.stats.dropped, errors: a.stats.errors,
  };
});
console.log(JSON.stringify(out, null, 2));
console.log('pageerrors=' + errs.length); if (errs.length) console.log(errs[0]);
await browser.close();
