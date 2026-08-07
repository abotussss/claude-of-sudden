/**
 * THE SCAR AT THREE RANGES, AT NIGHT — the only gate the fire has.
 *
 *   node _scarshot.mjs [--url=…] [--out=shots/scar] [--tag=before]
 *
 * `_nfcrashshot.mjs` photographs the whole act from four AUTHORED vantages and
 * answers "did something come down". This answers the one question that killed
 * the first two versions of this fire and that no number in the repo can ask:
 * WHAT DOES THE BURNING PLAIN LOOK LIKE FROM WHERE A PLAYER STANDS. The cone
 * version passed every number it had and photographed as 189 white paper cones;
 * the billboard version that replaced it was signed off by its own author as
 * "still slightly pale at distance, not final".
 *
 * THE CAMERA POSITIONS ARE SEARCHED, NOT AUTHORED, and that is the lesson of
 * `_nfcrashshot.mjs`'s first two attempts — both of which stood inside a
 * structure they had measured their stand-off from the CENTRE of. For each
 * range this sweeps every bearing around the scar's midpoint at 5°, throws away
 * any that leaves the playable bounds, any whose ground the world does not
 * answer for, and any whose sight line to the fire is blocked by geometry
 * (`MASK.SIGHT`, from eye height to flame height) — then takes the survivor
 * closest to broadside, so the scar is seen across its width rather than down
 * its length. It prints the bearing it chose and why, so a photograph can never
 * again be of the inside of a fortress.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4599/?map=plains&capture=1';
const OUT = args.out ?? 'shots/scar';
const TAG = args.tag ?? 'now';
const RANGES = String(args.ranges ?? '20,80,200').split(',').map(Number);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.stack ?? e.message)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
if (level !== 'plains') { console.error(`NOT THE PLAIN (${level})`); await b.close(); process.exit(2); }

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
  const pl = e.ctx.peek('player');
  if (pl) { pl.applyDamage = () => {}; setInterval(() => pl.heal?.(100), 250); }
});
const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

await page.evaluate(() => (window.__ENGINE__.time.scale = 8));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._checkWinConditions = () => {};
  window.__ENGINE__.time.scale = 1;
});

console.log('crash fired:', await page.evaluate(() => window.__ENGINE__.ctx.peek('match').crash.fire()));
// Approach + plough, then a few seconds so every tongue has finished growing
// (`grow = clamp(age * 1.9, 0, 1)` — the last cell lights at skid 5.0).
await page.waitForFunction(
  () => { const c = window.__ENGINE__.ctx.peek('match').crash; return c._t < 0 && c._burn > 0; },
  null, { timeout: 180000 }
);
await frames(240);

const geom = await page.evaluate(() => {
  const c = window.__ENGINE__.ctx.peek('match').crash;
  const ph = window.__ENGINE__.ctx.peek('physics');
  const n = c._cx.length;
  const mx = (c._cx[0] + c._cx[n - 1]) / 2;
  const mz = (c._cz[0] + c._cz[n - 1]) / 2;
  return { mx, mz, my: ph.groundHeight(mx, mz, 400), hx: c._hx, hz: c._hz, len: c._len };
});
console.log(`  scar midpoint (${geom.mx.toFixed(1)}, ${geom.my.toFixed(1)}, ${geom.mz.toFixed(1)}), ` +
  `${geom.len.toFixed(0)} m long, heading (${geom.hx.toFixed(2)}, ${geom.hz.toFixed(2)})`);

/**
 * TWO EYE HEIGHTS PER RANGE, AND THE SECOND ONE IS NOT A CHEAT.
 *
 * At standing height on a plain that rolls, most bearings at 80 and 200 m have
 * a rise across them and the honest answer to "what does it look like from
 * there" is "you can see a third of it". That is worth photographing — it is
 * where a player stands — but it cannot be the only frame, because a
 * photograph of a hillside proves nothing about a flame. So each range is shot
 * from a man's eye AND from high enough to clear the ground between (0.12 x the
 * range), and the fire has to hold up in both.
 */
for (const D of RANGES) {
 for (const [suffix, eye] of [['', 1.7], ['-hi', Math.max(1.7, D * 0.12)]]) {
  const chosen = await page.evaluate(([g, D, eye]) => {
    const e = window.__ENGINE__;
    const ph = e.ctx.peek('physics');
    const MASK = ph.MASK.SIGHT;
    /**
     * THREE SIGHT LINES, NOT ONE. The first cut tested the MIDPOINT only and
     * put the 200 m camera on a ridge with the fortress squarely between it and
     * a 157 m fire — the midpoint happened to show through a gap in the
     * battlements, so the test passed and the photograph was of a wall. A scar
     * is a line: both ends have to be visible or the photograph is not of it.
     */
    const aims = [
      { x: g.mx, y: g.my + 2.5, z: g.mz },
      { x: g.mx + g.hx * g.len * 0.45, y: g.my + 2.5, z: g.mz + g.hz * g.len * 0.45 },
      { x: g.mx - g.hx * g.len * 0.45, y: g.my + 2.5, z: g.mz - g.hz * g.len * 0.45 },
    ];
    const aim = aims[0];
    /**
     * Broadside first: the perpendicular of the heading, both ways, then out.
     * `(cos, sin)` has to come out as `(hz, -hx)`, so the arguments are
     * `atan2(-hx, hz)` and NOT `atan2(hz, -hx)` — the first cut had them the
     * other way round and every camera stood ON the scar, twenty metres along
     * the track from its own midpoint, i.e. inside the fire it was photographing.
     */
    const perp = Math.atan2(-g.hx, g.hz);
    let best = null;
    const cands = [];
    for (let k = 0; k <= 36; k++) {
      for (const s of (k === 0 ? [1] : [1, -1])) {
        cands.push({ th: perp + s * k * Math.PI / 36, off: k * 5 * s });
      }
    }
    for (const c of cands) {
      const x = g.mx + Math.cos(c.th) * D;
      const z = g.mz + Math.sin(c.th) * D;
      if (Math.abs(x) > 195 || Math.abs(z) > 195) continue;
      const down = ph.raycast({ x, y: 300, z }, { x: 0, y: -1, z: 0 }, 400, ph.MASK.WORLD);
      if (!down?.hit) continue;
      const y = down.point.y + eye;
      let clear = 0;
      for (const a of aims) {
        const dir = { x: a.x - x, y: a.y - y, z: a.z - z };
        const len = Math.hypot(dir.x, dir.y, dir.z);
        if (!ph.raycast({ x, y, z }, dir, len - 1.0, MASK)?.hit) clear++;
      }
      /**
       * THE MIDPOINT IS MANDATORY, THE ENDS ARE A PREFERENCE. Requiring all
       * three outright found no bearing at any range and that is not a bug in
       * the search — a plain that ROLLS puts the far end of a 157 m scar behind
       * a rise from twenty metres away, which is simply what standing next to
       * it looks like. So the scan takes the most complete view it can get,
       * nearest to broadside, and prints how much of the fire it could see.
       */
      if (!clear) continue;
      if (!best || clear > best.clear) best = { x, y, z, off: c.off, clear, ground: +down.point.y.toFixed(2) };
      if (clear === 3) break;
    }
    return best;
  }, [geom, D, eye]);
  if (!chosen) { console.log(`  ${D} m${suffix}: NO CLEAR BEARING`); continue; }
  await page.evaluate(([c, g]) => {
    const e = window.__ENGINE__;
    const V3 = e.camera.position.constructor;
    e.camera.position.set(c.x, c.y, c.z);
    e.camera.lookAt(new V3(g.mx, g.my + 2.0, g.mz));
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  }, [chosen, geom]);
  await frames(10);
  const name = `SCAR-${TAG}-${String(D).padStart(3, '0')}m${suffix}`;
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  · ${name}.png — from (${chosen.x.toFixed(0)}, ${chosen.z.toFixed(0)}) ` +
    `eye ${chosen.y.toFixed(1)}, ${chosen.off}° off broadside, ` +
    `${chosen.clear}/3 of the scar in clear sight`);
 }
}

console.log(errs.length ? `\nPAGEERRORS(${errs.length}):\n  ${errs.slice(0, 3).join('\n  ')}` : '\n0 pageerrors');
await b.close();
