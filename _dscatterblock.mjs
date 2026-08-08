/**
 * A COPY OF `_scatterblock.mjs`, DIFFERING IN THE URL AND NOTHING ELSE.
 *
 * The original assembles `${URL}?${q.join('&')}`, which is this tree's
 * truncating append: hand it `http://host/?map=plains` and it produces
 * `?map=plains?boxtag`, so the map id parses as the string "plains?boxtag", no
 * level matches, `getLevel` falls back to the town, AND `Assembler.TAG` is never
 * armed because there is no `boxtag` parameter either — which is the "TAG not
 * armed" this gate answers with on the plain. Here the map is its own argument
 * (`--map=plains|town`), the query is assembled once, and the run echoes
 * `world.level.id` so the map is observed rather than intended.
 *
 * The measurement is the original's, unchanged.
 */
/**
 * WHAT ON THE GROUND IS TALL ENOUGH TO STOP A WALKING MAN?
 *
 *   node _scatterblock.mjs [--url=…] [--band=0.42,0.95] [--max=40] [--json]
 *
 * 「地面に落ちている石ころオブジェが移動の妨げです、ジャンプしないと乗り越えられない」
 *
 * `STANCE.stand.stepHeight` is 0.42 and `CharacterController.move` lifts a
 * grounded move by exactly that before sliding it, so a proxy whose top clears
 * the ground by 0.42 + eps is a WALL to a walking man and a proxy at 0.41 is not
 * there at all. `_protoBox` refuses a proxy under 0.42 — but it measures the
 * PROTOTYPE, in prototype space, before `put`'s scale jitter (+/-8 %) and before
 * the loose tilt lifts a corner. So the interesting population is everything
 * whose top sits just over the line, and nothing in the tree enumerates it:
 * `solidcheck` asks the opposite question (is a thing you can see actually
 * there) and passes harder the more solid the litter is.
 *
 * This reconstructs every collision proxy from `?boxtag` — which records the
 * WORLD centre, the world extents and the authoring stack for each one — drops
 * it against `world.groundHeight` at its own centre, and reports, per authoring
 * kind, how far over the step line the top of it stands.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4615/';
const MAP = args.map ?? 'plains';
const band = String(args.band ?? '0.30,0.95').split(',').map(Number);
const MAXROWS = Number(args.max ?? 40);

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('  pageerror', String(e.message).slice(0, 200)));
const q = ['boxtag', `map=${MAP}`];
if (args.seed) q.push(`seed=${args.seed}`);
if (args.flags) q.push(...String(args.flags).split(','));
await page.goto(`${URL}?${q.join('&')}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

console.log('  level =', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));
const out = await page.evaluate(({ band }) => {
  const w = window.__ENGINE__.ctx.peek('world');
  const tag = w.A?.constructor?.TAG;
  if (!tag) return { err: 'Assembler.TAG not armed — boot with ?boxtag' };
  const STEP = 0.42;
  const rows = new Map();
  let total = 0, grounded = 0;
  for (const b of tag) {
    total++;
    if (b.wx === undefined) return { err: 'TAG has no world centre — old build' };
    const g = w.groundHeight(b.wx, b.wz);
    if (!Number.isFinite(g)) continue;
    const bot = b.wy - b.sy / 2;
    // Standing ON the ground, not on a table, a roof or a floor slab.
    if (bot > g + 0.30 || bot < g - 0.60) continue;
    grounded++;
    const h = b.wy + b.sy / 2 - g;         // how far the top clears the ground
    if (h < band[0] || h > band[1]) continue;
    const line = String(b.at).split('\n').slice(1)
      .map((s) => s.trim())
      .find((s) => !/builder\.js/.test(s)) ?? '?';
    const src = line.replace(/^at\s+/, '').replace(/https?:\/\/[^/]+\//, '').replace(/\?[^:)]*/, '');
    const key = b.k === 'prop' ? `prop:${b.id}` : `${b.k}:${b.surface}`;
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { key, n: 0, over: 0, hMin: 9, hMax: 0, hSum: 0, srcs: new Map() }));
    r.n++; r.hSum += h; r.hMin = Math.min(r.hMin, h); r.hMax = Math.max(r.hMax, h);
    if (h > STEP) r.over++;
    r.srcs.set(src, (r.srcs.get(src) ?? 0) + 1);
  }
  return {
    total, grounded,
    rows: [...rows.values()].map((r) => ({
      key: r.key, n: r.n, over: r.over,
      hMin: +r.hMin.toFixed(3), hAvg: +(r.hSum / r.n).toFixed(3), hMax: +r.hMax.toFixed(3),
      srcs: [...r.srcs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    })).sort((a, b) => b.over - a.over || b.n - a.n),
  };
}, { band });

// closed at the end — phase B needs the page
if (out.err) { console.log(out.err); process.exit(2); }
if (args.json) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }

console.log(`\n  ${out.total} proxies, ${out.grounded} of them standing on the ground`);
console.log(`  band ${band[0]}–${band[1]} m over ground; stepHeight = 0.42\n`);
console.log(`  ${'kind'.padEnd(22)} ${'n'.padStart(5)} ${'>0.42'.padStart(6)}  ${'min'.padStart(6)} ${'avg'.padStart(6)} ${'max'.padStart(6)}  author`);
for (const r of out.rows.slice(0, MAXROWS)) {
  console.log(`  ${r.key.padEnd(22)} ${String(r.n).padStart(5)} ${String(r.over).padStart(6)}  ` +
    `${String(r.hMin).padStart(6)} ${String(r.hAvg).padStart(6)} ${String(r.hMax).padStart(6)}  ` +
    r.srcs.map(([s, n]) => `${s} x${n}`).join(' | '));
}
const over = out.rows.reduce((a, r) => a + r.over, 0);
console.log(`\n  ${over} ground proxies stand over the step line inside the band\n`);

/* ========================================================================== */
/* PHASE B — WALK A MAN AT A RUBBLE MOUND                                     */
/* ========================================================================== */
/**
 * The table above measures how TALL a thing is; the complaint is about what
 * happens when you walk into one, and a stepped pile is tall AND crossable.
 * So the mounds are driven the way `tools/solidcheck.mjs` drives its props: the
 * real controller, W held for real frames, and the man's own closest approach
 * to the middle of the pile is the answer. `minR` near zero is a man standing
 * on top of it; `minR` near the pile's own half-width plus a capsule radius is
 * a man with his nose against a wall.
 */
const DRIVE = Number(args.drive ?? 0);
if (DRIVE > 0) {
  const mounds = await page.evaluate(({ n }) => {
    const w = window.__ENGINE__.ctx.peek('world');
    const tag = w.A.constructor.TAG;
    const by = new Map();
    for (const b of tag) {
      if (b.k !== 'box' || !/kit\.js/.test(String(b.at))) continue;
      if (!/moundProxy|rubbleMound/.test(String(b.at))) continue;
      const k = `${b.wx.toFixed(2)},${b.wz.toFixed(2)}`;
      const m = by.get(k) ?? by.set(k, { c: [b.wx, b.wz], hw: 0, top: -9, base: 9 }).get(k);
      m.hw = Math.max(m.hw, b.sx / 2);
      m.top = Math.max(m.top, b.wy + b.sy / 2);
      m.base = Math.min(m.base, b.wy - b.sy / 2);
    }
    // The ones a man could actually be walking across: outdoors, on open ground.
    return [...by.values()]
      .filter((m) => w.isOpen(m.c[0], m.c[1], 0.2) && m.top - m.base > 0.30)
      .sort((a, b) => (b.top - b.base) - (a.top - a.base))
      .slice(0, n);
  }, { n: DRIVE });

  const step = (k) => page.evaluate((k) => new Promise((r) => {
    let i = 0; const t = () => (++i >= k ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
  }), k);

  console.log('  --- walking the real controller at the widest mounds ---');
  console.log(`  ${'mound(world)'.padEnd(18)} ${'hw'.padStart(5)} ${'rise'.padStart(5)}  ${'minR'.padStart(6)} ${'climb'.padStart(6)} ${'moved'.padStart(6)}  verdict`);
  let crossed = 0, stopped = 0, skipped = 0;
  for (const m of mounds) {
    const start = await page.evaluate((m) => {
      const c = window.__ENGINE__.ctx;
      const pl = c.peek('player'), phys = c.peek('physics');
      const V = c.camera.position.constructor;
      const a = new V(), b = new V();
      for (const extra of [2.6, 3.4, 1.9]) {
        for (let s = 0; s < 24; s++) {
          const th = (s / 24) * Math.PI * 2;
          const px = m.c[0] + Math.sin(th) * (m.hw + extra);
          const pz = m.c[1] + Math.cos(th) * (m.hw + extra);
          const fy = phys.groundHeight(px, pz, m.base + 4, phys.MASK.WORLD);
          if (!isFinite(fy) || Math.abs(fy - m.base) > 0.8) continue;
          a.set(px, fy + 0.42 + 0.32, pz); b.set(px, fy + 1.78 - 0.32 + 0.02, pz);
          if (!phys.checkCapsule(a, b, 0.315, phys.MASK.CHARACTER)) continue;
          pl.respawnAt({ x: px, y: fy + 0.05, z: pz });
          const yaw = Math.atan2(-(m.c[0] - px), -(m.c[1] - pz));
          pl.movement.yaw = yaw; pl.yaw = yaw;
          return { ok: true, from: [+px.toFixed(1), +pz.toFixed(1)], y0: fy };
        }
      }
      return { ok: false };
    }, m);
    if (!start.ok) { skipped++; console.log(`  ${`[${m.c[0].toFixed(1)},${m.c[1].toFixed(1)}]`.padEnd(18)} — no clear standoff, skipped`); continue; }
    await step(5);
    await page.keyboard.down('KeyW');
    await step(3);
    if (!await page.evaluate(() => window.__ENGINE__.ctx.input.down.has('KeyW'))) {
      await page.keyboard.up('KeyW'); await step(6);
      await page.keyboard.down('KeyW'); await step(3);
    }
    const r = await page.evaluate(([m, y0]) => new Promise((done) => {
      const c = window.__ENGINE__.ctx;
      const pl = c.peek('player');
      const t0 = c.time.elapsed;
      const p0 = pl.position ?? c.camera.position;
      const s = { x: p0.x, z: p0.z };
      let minR = Infinity, climb = -9, frames = 0, held = 0;
      const tick = () => {
        const q = pl.position ?? c.camera.position;
        minR = Math.min(minR, Math.hypot(q.x - m.c[0], q.z - m.c[1]));
        climb = Math.max(climb, q.y - y0);
        frames++; if (c.input.down.has('KeyW')) held++;
        if (c.time.elapsed - t0 >= 3.0) {
          return done({ minR: +minR.toFixed(2), climb: +climb.toFixed(2), frames, held,
            moved: +Math.hypot(q.x - s.x, q.z - s.z).toFixed(1) });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }), [m, start.y0]);
    await page.keyboard.up('KeyW');
    // A man who never left the start line measures nothing — a respawn into a
    // pocket he cannot walk out of, not a verdict about the pile.
    const invalid = r.held < r.frames * 0.9 || r.moved < 1.0;
    /**
     * HE IS OVER IT WHEN HIS FEET GOT UP IT. `minR` alone is too strict on a
     * pile whose crest is a point — a man can ride the whole thing and pass a
     * span beside the exact middle — so the test is the CLIMB: three quarters
     * of the pile's own rise, under his own power, with W the only input.
     */
    const ok = r.climb >= (m.top - m.base) * 0.75 || r.minR <= 0.45;
    if (invalid) skipped++; else if (ok) crossed++; else stopped++;
    console.log(`  ${`[${m.c[0].toFixed(1)},${m.c[1].toFixed(1)}]`.padEnd(18)} ` +
      `${m.hw.toFixed(2).padStart(5)} ${(m.top - m.base).toFixed(2).padStart(5)}  ` +
      `${String(r.minR).padStart(6)} ${String(r.climb).padStart(6)} ${String(r.moved).padStart(6)}  ` +
      (invalid ? `INVALID (W ${r.held}/${r.frames})` : ok ? 'walked over' : 'STOPPED'));
  }
  console.log(`\n  ${crossed} walked over, ${stopped} stopped, ${skipped} unusable\n`);
}
