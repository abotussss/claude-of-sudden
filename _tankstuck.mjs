/**
 * IS THE MAN WHO IS NOT MOVING THE TANK'S FAULT?
 *
 * `stuckcheck` names a bot; it cannot say why. This forces both hulls out, runs
 * the same 1 Hz sampler, and for every man reports his travel, the closest he
 * ever came to a hull, and the seconds he spent PINNED by one (`_hullPin`,
 * which is only ever non-zero for a man a stopped hull could not shove).
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4500/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await p.evaluate(() => {
  const e = window.__ENGINE__;
  e.ctx.time.scale = 8;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  window.__S__ = { last: new Map(), stuck: new Map(), worst: new Map(), moved: new Map(), near: new Map(), pin: new Map(), n: 0 };
  window.__FIRE__ = () => { try { m.tank?.fire?.(); } catch (err) { /* parked already */ } };
  window.__TICK__ = () => {
    const S = window.__S__; S.n++;
    const hulls = (m.tank?.tanks ?? []).filter((t) => t.solid === true);
    for (const a of ai.agents) {
      if (!a.alive) continue;
      const k = a.name;
      const q = a.position;
      const prev = S.last.get(k);
      const wants = (a.desiredSpeed ?? 0) > 0.1;
      if (prev) {
        const d = Math.hypot(q.x - prev.x, q.z - prev.z);
        S.moved.set(k, (S.moved.get(k) ?? 0) + d);
        S.stuck.set(k, wants && d < 0.15 ? (S.stuck.get(k) ?? 0) + 1 : 0);
      }
      S.last.set(k, { x: q.x, z: q.z });
      S.worst.set(k, Math.max(S.worst.get(k) ?? 0, S.stuck.get(k) ?? 0));
      S.pin.set(k, Math.max(S.pin.get(k) ?? 0, a._hullPin ?? 0));
      for (const t of hulls) {
        const d = Math.hypot(q.x - t.position.x, q.z - t.position.z);
        if (d < (S.near.get(k) ?? 1e9)) S.near.set(k, d);
      }
    }
  };
});
await wait(200);
await p.evaluate(() => window.__FIRE__());
for (let i = 0; i < 40; i++) { await wait(8); await p.evaluate(() => { window.__TICK__(); window.__FIRE__(); }); }
const r = await p.evaluate(() => {
  const S = window.__S__;
  const rows = [...S.worst.entries()].map(([k, v]) => ({
    name: k, stuck: v,
    moved: +(S.moved.get(k) ?? 0).toFixed(1),
    nearestHull: +(S.near.get(k) ?? 999).toFixed(1),
    pinnedSec: +(S.pin.get(k) ?? 0).toFixed(2),
  }));
  rows.sort((a, c) => c.stuck - a.stuck || a.moved - c.moved);
  const m = window.__ENGINE__.ctx.peek('match');
  return { rows, samples: S.n, hulls: (m.tank?.tanks ?? []).map((t) => `${t.id}:${t.state}${t.solid ? '/solid' : ''}`) };
});
console.log(' hulls:', r.hulls.join(' '), '· samples', r.samples);
console.log(' name         stuck  moved     nearest hull   pinned s');
for (const x of r.rows.slice(0, 12)) {
  console.log(`  ${x.name.padEnd(11)} ${String(x.stuck).padStart(5)}  ${String(x.moved).padStart(7)} m ${String(x.nearestHull).padStart(12)} m ${String(x.pinnedSec).padStart(8)}`);
}
const nearAndStuck = r.rows.filter((x) => x.stuck >= 5 && x.nearestHull < 8);
const everPinned = r.rows.filter((x) => x.pinnedSec > 0);
console.log(`\n  stuck>=5 AND within 8 m of a hull: ${nearAndStuck.length} / ${r.rows.length}`);
console.log(`  men a hull ever had to release:    ${everPinned.length} / ${r.rows.length}`);
console.log('  pageerrors:', errs.length, errs.slice(0, 3));
await b.close();
