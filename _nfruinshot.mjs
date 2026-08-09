/**
 * THE BUILDINGS THEMSELVES — from inside, and at 30 / 100 / 200 m.
 *
 *   node _nfruinshot.mjs [--url=…] [--out=shots/nfruin] [--n=4]
 *
 * A sightline number says a ray stopped somewhere. It does not say the thing it
 * stopped on reads as a building, that the inside of it is lit, or that the
 * walls have faces rather than sky in them — and this map has shipped a shaft
 * you could see through, ground sheets that were black from below and a 40 m
 * slab that read as a ceiling. So: `?covertag` for where the solver actually put
 * things, then a camera at a standing eye.
 *
 * THE THREE RANGES ARE THE ARGUMENT. 30 m is "can I fight in this", 100 m is
 * "does it break the sightline it is standing in", 200 m is the whole claim —
 * a berm at 200 m on a night map subtends 0.7° and is not there.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4635/?map=plains&capture=1&covertag=1';
const OUT = args.out ?? 'shots/nfruin';
const N = Number(args.n ?? 4);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
let tag = '';
page.on('console', (m) => { const t = m.text(); if (t.includes('cover sites:')) tag = t; });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level.id=${level}  out=${OUT}`);
if (level !== 'plains') { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

const KINDS = new Set(['hall', 'terrace', 'silos', 'blockhouse']);
const shells = [];
const m = tag.match(/cover sites: (.*)$/);
if (m) {
  for (const tok of m[1].trim().split(/\s+/)) {
    const mm = tok.match(/^([a-z]+)@(-?\d+),(-?\d+)$/);
    if (mm && KINDS.has(mm[1])) shells.push({ kind: mm[1], x: +mm[2], z: +mm[3] });
  }
}
console.log(`${shells.length} shells: ${shells.map((s) => `${s.kind}@${s.x},${s.z}`).join(' ')}`);

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  const pl = e.ctx.peek('player'); if (pl) pl.applyDamage = () => {};
});
await page.evaluate(() => (window.__ENGINE__.time.scale = 6));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const mm = e.ctx.peek('match');
  mm.roundClock = 1e6; mm._checkWinConditions = () => {};
  e.time.scale = 1;
  const ai = e.ctx.peek('ai');
  if (ai) { ai.combatEnabled = false; ai.protect?.(e.ctx.peek('player'), 1e6); if (ai.root) ai.root.visible = false; }
  e.ctx.peek('ui')?.setHudVisible?.(0);
  const wp = e.ctx.peek('weapons');
  if (wp?.viewmodel?.anchor) wp.viewmodel.anchor.visible = false;
});
const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/** Stand at `from`, eye 1.62 over whatever is under it, look at `at`. */
const place = (fx, fz, ax, az, ay = 4) => page.evaluate(([fx, fz, ax, az, ay]) => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const h = ph.raycast(fx, 300, fz, 0, -1, 0, 400, ph.MASK.WORLD);
  const y = (h.hit ? h.point.y : 0) + 1.62;
  e.camera.position.set(fx, y, fz);
  // `ay === null` means AIM LEVEL — the eye's own height, not a fixed altitude.
  e.camera.lookAt(new V3(ax, ay === null ? y : ay, az));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  return `${fx.toFixed(1)},${y.toFixed(2)},${fz.toFixed(1)}`;
}, [fx, fz, ax, az, ay]);

/** The `n` shells furthest apart, so the set is not four of one quarter. */
const chosen = [];
for (const s of shells) {
  if (chosen.length >= N) break;
  if (chosen.some((c) => (c.x - s.x) ** 2 + (c.z - s.z) ** 2 < 90 * 90)) continue;
  chosen.push(s);
}
for (const s of chosen) {
  /**
   * WHERE TO STAND, AND IT IS A SEARCH RATHER THAN A BEARING. The first cut
   * stood the camera on the radius through the shell, which at 100 m from a
   * building near the centre puts the control tower and the fortress between the
   * lens and the subject — a photograph of somebody else's work captioned with
   * this one's. Twelve bearings, and the one taken is the one whose ray to the
   * shell gets furthest before it hits anything: the clearest view of it that
   * the map allows from that range.
   */
  for (const d of [30, 100, 200]) {
    const spot = await page.evaluate(([sx, sz, d]) => {
      const e = window.__ENGINE__, ph = e.ctx.peek('physics'), w = e.ctx.peek('world');
      let best = null;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const fx = sx + Math.cos(a) * d, fz = sz + Math.sin(a) * d;
        if (Math.hypot(fx, fz) > 170 || !w.isOpen(fx, fz, 1)) continue;
        const y = w.groundHeight(fx, fz) + 1.62;
        const L = Math.hypot(sx - fx, sz - fz);
        const h = ph.raycast(fx, y, fz, (sx - fx) / L, 0, (sz - fz) / L, d + 40, ph.MASK.WORLD);
        const reach = h.hit ? h.distance : d + 40;
        if (!best || reach > best.reach) best = { fx, fz, reach: +reach.toFixed(1) };
      }
      return best;
    }, [s.x, s.z, d]);
    if (!spot) { console.log(`  ${s.kind}@${s.x},${s.z} at ${d} m — no open stand at that range`); continue; }
    const gx = spot.fx, gz = spot.fz;
    const pose = await place(gx, gz, s.x, s.z, 4.5);
    await frames(10);
    const f = `${OUT}/${s.kind}-${s.x}_${s.z}-${String(d).padStart(3, '0')}m.png`;
    await page.screenshot({ path: f });
    console.log(`${f}   eye ${pose}   clear line ${spot.reach} m of ${d}`);
  }
  /**
   * …AND FROM INSIDE IT, TURNED FOUR WAYS.
   *
   * THE STAND IS A SEARCH AND THE AIM IS LEVEL. The first cut stood the camera
   * on the shell's own centre and aimed at y = 2.0 from an eye at 1.62, which on
   * a blockhouse with an internal cross wall through the middle of it is a
   * photograph of one course of brick 40 cm away, tilted. Nine offsets over the
   * footprint, take the one with the most room round it.
   *
   * AND IT WAITS FOR THE EXPOSURE. `render`'s auto-exposure adapts over about a
   * second and the camera has just come in off a lit plain, so a frame pumped
   * ten steps after the teleport is metered for OUTSIDE the building. Ninety.
   */
  const inside = await page.evaluate(([sx, sz]) => {
    const e = window.__ENGINE__, ph = e.ctx.peek('physics'), w = e.ctx.peek('world');
    let best = null;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const d = i === 0 ? 0 : 2.2;
      const fx = sx + Math.cos(a) * d, fz = sz + Math.sin(a) * d;
      const y = w.groundHeight(fx, fz) + 1.62;
      let room = 1e9;
      for (let k = 0; k < 8; k++) {
        const b = (k / 8) * Math.PI * 2;
        const h = ph.raycast(fx, y, fz, Math.sin(b), 0, Math.cos(b), 30, ph.MASK.WORLD);
        room = Math.min(room, h.hit ? h.distance : 30);
      }
      if (!best || room > best.room) best = { fx, fz, room: +room.toFixed(2) };
    }
    return best;
  }, [s.x, s.z]);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const pose = await place(inside.fx, inside.fz,
      inside.fx + Math.sin(a) * 30, inside.fz + Math.cos(a) * 30, null);
    await frames(90);
    const f = `${OUT}/${s.kind}-${s.x}_${s.z}-inside-${k * 90}.png`;
    await page.screenshot({ path: f });
    console.log(`${f}   eye ${pose}`);
  }
}
if (errs.length) console.log('PAGE ERRORS', errs.length, errs.slice(0, 3));
await b.close();
