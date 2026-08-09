/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE VIEW HE IS ACTUALLY COMPLAINING ABOUT — a standing eye on the objective,
 * turned through 360°
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfobj360.mjs [--url=http://127.0.0.1:4635/?map=plains&capture=1]
 *                      [--out=shots/nf360x-before] [--nophoto]
 *
 * `_plaincross.mjs` walks the LINE between two pads and reports the corridor
 * along it. That is the right measurement for a crossing and it is the wrong one
 * for 「障害物が少ない」 said a third time, because a man on a capture point is not
 * walking a line — he is standing still and turning round, and every bearing he
 * turns through is a bearing somebody can shoot him down. A route metric can go
 * from 115 m to 62 m while the ring the man is standing in is untouched.
 *
 * So: stand at each of the five capture points and both bases, eye at 1.62 m
 * (`STANCE.stand`), and fire 72 rays at 5° through the WORLD mask.
 *
 *   open      metres to the first occluder on that bearing (capped at 400)
 *   mean      the mean of those 72 — "how far can I see, on average, from here"
 *   p50/p90   the median and the ninth decile, because a mean is moved by one
 *             mountain and the ninth decile is the bearing that kills you
 *   naked     the share of the 72 with NOTHING inside 120 m. `Agent.viewRange`
 *             is 58 m; 120 m of clear bearing is a man visible from both ends of
 *             it at once with nothing to break either.
 *   near      the share with something inside 12 m — cover within a sprint step
 *   worstArc  the widest CONTIGUOUS wedge, in degrees, on which every bearing is
 *             naked. This is the headline: 180° of naked arc is a man who can
 *             only be shot from half the compass, and 340° is one who cannot
 *             stand there at all.
 *
 * …and eight photographs per stand at 45°, so the number and the frame are the
 * same pose. The frame is the evidence; the number is what makes two builds
 * comparable.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4635/?map=plains&capture=1';
const OUT = args.out ?? 'shots/nf360x-before';
const PHOTO = !args.nophoto;
if (PHOTO) mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level.id=${level}  out=${PHOTO ? OUT : '(no photos)'}`);
if (level !== 'plains') { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

/** The stands: every capture point and both bases, off `PLAINS.pads` itself. */
const STANDS = await page.evaluate(() => {
  const w = window.__ENGINE__.ctx.peek('world');
  const pads = w.level.pads ?? w.layout.PADS;
  return pads.filter((p) => !p.datum).map((p) => ({ id: p.id, x: p.x, z: p.z }));
});

/* ---- the measurement, before anything is posed --------------------------- */
const rows = await page.evaluate((stands) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const w = e.ctx.peek('world');
  const MASK = ph.MASK.WORLD;
  const EYE = 1.62, N = 72, FAR = 400, NAKED = 120, NEAR = 12;
  const out = [];
  for (const s of stands) {
    const gy = w.groundHeight(s.x, s.z);
    const y = gy + EYE;
    const open = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const dx = Math.sin(a), dz = Math.cos(a);
      const h = ph.raycast(s.x, y, s.z, dx, 0, dz, FAR, MASK);
      open.push(h.hit ? h.distance : FAR);
    }
    const sorted = open.slice().sort((p, q) => p - q);
    const naked = open.map((v) => v >= NAKED);
    // widest contiguous naked wedge, on a ring
    let worst = 0;
    if (naked.every(Boolean)) worst = 360;
    else {
      let run = 0;
      for (let i = 0; i < N * 2; i++) {
        if (naked[i % N]) { run++; if (run > worst) worst = run; } else run = 0;
      }
      worst = Math.min(worst, N) * (360 / N);
    }
    out.push({
      id: s.id, x: s.x, z: s.z, y: +y.toFixed(2),
      mean: +(open.reduce((p, q) => p + q, 0) / N).toFixed(1),
      p50: +sorted[Math.floor(N * 0.5)].toFixed(1),
      p90: +sorted[Math.floor(N * 0.9)].toFixed(1),
      min: +sorted[0].toFixed(1),
      naked: +(naked.filter(Boolean).length / N * 100).toFixed(0),
      near: +(open.filter((v) => v < NEAR).length / N * 100).toFixed(0),
      worstArc: +worst.toFixed(0),
      open: open.map((v) => +v.toFixed(1)),
    });
  }
  return out;
}, STANDS);

console.log('\nstand      mean    p50    p90    min   naked%  near%  worstArc');
for (const r of rows) {
  console.log(
    `${r.id.padEnd(9)} ${String(r.mean).padStart(6)} ${String(r.p50).padStart(6)} ` +
    `${String(r.p90).padStart(6)} ${String(r.min).padStart(6)} ` +
    `${String(r.naked).padStart(6)} ${String(r.near).padStart(6)} ${String(r.worstArc).padStart(9)}°`);
}
const mAll = (k) => +(rows.reduce((p, r) => p + r[k], 0) / rows.length).toFixed(1);
console.log(`\nALL STANDS  mean ${mAll('mean')} m · naked ${mAll('naked')} % · near ${mAll('near')} % · worstArc ${mAll('worstArc')}°`);
if (args.json) writeFileSync(args.json, JSON.stringify(rows, null, 1));

/* ---- and the photographs ------------------------------------------------- */
if (PHOTO) {
  await page.evaluate(() => {
    const e = window.__ENGINE__;
    e.input.frozen = true; e.input.enabled = false;
    e.ctx.peek('ui')?.debugState?.('clean');
    const pl = e.ctx.peek('player');
    if (pl) pl.applyDamage = () => {};
  });
  await page.evaluate(() => (window.__ENGINE__.time.scale = 6));
  await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
  /**
   * THE SUBJECT IS THE GROUND, SO THE HUD, THE VIEWMODEL AND EIGHTY MEN COME
   * OUT OF THE FRAME. The first run of this photographed the south base with
   * forty bots stood in a spawn cluster across the whole lower half of it —
   * a picture of the crowd, not of the plain the complaint is about.
   */
  await page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    m.roundClock = 1e6; m._checkWinConditions = () => {};
    e.time.scale = 1;
    const ai = e.ctx.peek('ai');
    if (ai) {
      ai.combatEnabled = false;
      ai.protect?.(e.ctx.peek('player'), 1e6);
      if (ai.root) ai.root.visible = false;
    }
    e.ctx.peek('ui')?.setHudVisible?.(0);
    const wp = e.ctx.peek('weapons');
    if (wp?.viewmodel?.anchor) wp.viewmodel.anchor.visible = false;
  });
  const frames = (n) => page.evaluate((k) =>
    new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

  for (const r of rows) {
    for (let k = 0; k < 8; k++) {
      const deg = k * 45;
      const pose = await page.evaluate(([x, z, y, deg]) => {
        const e = window.__ENGINE__;
        const V3 = e.camera.position.constructor;
        const a = (deg * Math.PI) / 180;
        e.camera.position.set(x, y, z);
        e.camera.lookAt(new V3(x + Math.sin(a) * 60, y - 1.2, z + Math.cos(a) * 60));
        e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
        return `${x.toFixed(1)},${y.toFixed(2)},${z.toFixed(1)} yaw ${deg}`;
      }, [r.x, r.z, r.y, deg]);
      await frames(10);
      const f = `${OUT}/${r.id}-${String(deg).padStart(3, '0')}.png`;
      await page.screenshot({ path: f });
      console.log(`${f}   pose ${pose}   open ${r.open[Math.round(deg / 5)]} m`);
    }
  }
}
if (errs.length) console.log('PAGE ERRORS', errs.length, errs.slice(0, 3));
await b.close();
