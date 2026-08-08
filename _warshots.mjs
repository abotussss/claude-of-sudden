/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE AMBIENT WAR, PHOTOGRAPHED — and the honesty ramp photographed with it
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _warshots.mjs [--url=…] [--out=shots/warfield]
 *
 * 「そこらじゅうに銃撃や銃弾が飛び交い、爆撃もあり」 is a VISUAL requirement and no
 * number tests it. `_warfield.mjs` can prove that eleven engagements fired
 * eleven thousand rounds and that none of them came within 65 m of the eye;
 * it cannot say whether any of it reads.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IT ARMS AN ENGAGEMENT AND IT DOES NOT CHANGE ONE
 * ────────────────────────────────────────────────────────────────────────────
 * `arm()` sets a fight's own `on` flag and burst clock, which is exactly what
 * its scheduler does on its own every ten to twenty-six seconds. The RATE, the
 * frontage, the beaten zone, the tracer fraction and above all `_audible` are
 * untouched, so what is in frame is what the player gets — only sooner. The
 * alternative is a probe that waits for a random burst and photographs the gaps
 * between them.
 *
 * THE LAST PAIR OF FRAMES IS THE POINT. Same engagement, same second, camera at
 * 120 m and then at 30 m: the fire is there and then it is not, because a
 * muzzle flash on this map may not promise a man who is not there. @see the
 * honesty ramp in `src/match/warfield.js`.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4609/?map=plains&capture=1';
const OUT = args.out ?? 'shots/warfield';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.stack ?? e.message)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level=${level}  out=${OUT}`);
if (level !== 'plains') { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  const ui = e.ctx.peek('ui');
  ui?.debugState?.('clean');
  /**
   * THE HUD AND THE VIEWMODEL GO. `debugState('clean')` stops the demo
   * timeline and clears the markers but leaves the chrome up at full opacity,
   * and the first run of this probe photographed the ambient war behind a
   * minimap, a score bar, a GO banner and an M4. `hudTarget` is the fader the
   * HUD damps toward every frame; `viewScene` is the separately-composited
   * first-person pass. Probe-side only — nothing in `src/ui` is touched.
   */
  if (ui) ui.hudTarget = 0;
  e.ctx.viewScene.visible = false;
  const pl = e.ctx.peek('player');
  if (pl) { pl.applyDamage = () => {}; pl._nfHeal = setInterval(() => pl.heal?.(100), 250); }
});
await page.evaluate(() => (window.__ENGINE__.time.scale = 6));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._checkWinConditions = () => {};
});
// Let the GO banner and the round-start chrome finish, then real time.
await page.waitForTimeout(2500);
await page.evaluate(() => { window.__ENGINE__.time.scale = 1; window.__ENGINE__.ctx.peek('ui').hudTarget = 0; });

const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/** Stand at a world point, feet on whatever is under it, look at another. */
const place = (from, at, eye = 1.62) => page.evaluate(([f, a, eye]) => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const h = phys.raycast(f[0], 300, f[1], 0, -1, 0, 400, phys.MASK.WORLD);
  const y = (h.hit ? h.point.y : 0) + eye;
  e.camera.position.set(f[0], y, f[1]);
  e.camera.lookAt(new V3(a[0], a[1], a[2]));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  return +y.toFixed(2);
}, [from, at, eye]);

/** Start these engagements' bursts now, and hold them for `secs`. */
const arm = (ids, secs = 40) => page.evaluate(([ids, secs]) => {
  const w = window.__ENGINE__.ctx.peek('match').warfield;
  const out = [];
  for (const f of w.fights) {
    if (!ids.includes(f.id)) continue;
    f.on = true; f.t = secs; f.acc = 0; f.swap = 0.7;
    out.push(f.id);
  }
  return out;
}, [ids, secs]);

/** What the ramp is doing to each engagement from where the camera is now. */
const gains = () => page.evaluate(() => {
  const w = window.__ENGINE__.ctx.peek('match').warfield;
  return w.fights.map((f) => `${f.id}:${w._audible(f).toFixed(2)}${f.on ? '*' : ''}`).join(' ');
});

const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log(`    · ${name}.png`); };

/**
 * A SEQUENCE rather than a frame. A tracer lives 0.4 s and a burst swaps ends
 * every second; one photograph of a firefight is a photograph of whatever was
 * in the air on that frame, which is not the same question as "does this read".
 */
const burst = async (name, n = 4, gap = 7) => {
  for (let i = 1; i <= n; i++) { await frames(gap); await shot(`${name}-${i}`); }
};

/**
 * THE CAMERAS ARE MEASURED, NOT GUESSED. The first set of frames were taken
 * from the obvious places — the centre capture point, the control tower — and
 * the obvious places on NACHTFELD are behind the fortress and inside the
 * tower. `_warvantage.mjs` scans the walkable disc for standing positions with
 * an unobstructed chest-height ray to BOTH ends of an engagement at a range
 * where the honesty ramp is at full strength; these are its answers.
 */
const CAMS = [
  {
    tag: '1-from-D-looking-west',
    why: 'on the D pad beside the control tower — WESTCENTRE at 125 m and WESTGAP at 156 m, both ends of both visible.',
    from: [-6, -36], at: [-94, 0, 58], eye: 1.62,
    arm: ['WESTCENTRE', 'WESTGAP', 'RIMM174'],
  },
  {
    tag: '2-from-A-trench-looking-north',
    why: 'down in A-STELLUNG at zone A, eye at the trench floor, RIMM102 on the mountain face 133 m out.',
    from: [-134, -104], at: [-40, 29, -198], eye: 1.62,
    arm: ['RIMM102', 'NORTHEAST'],
  },
  {
    tag: '3-high-over-the-south',
    why: '26 m up over the south of the field looking north-west, the whole west half in one frame.',
    from: [40, 150], at: [-94, 0, 58], eye: 26,
    arm: ['WESTCENTRE', 'WESTGAP', 'SOUTHWEST', 'RIMM174', 'RIM114'],
  },
  {
    tag: '4-from-B-looking-north-west',
    why: 'zone B across the open middle at EASTCENTRE, 124 m, with the fortress and the works in the mid-ground.',
    from: [118, 104], at: [94, -1, -58], eye: 1.62,
    arm: ['EASTCENTRE', 'EASTGAP'],
  },
  {
    tag: '5-from-the-north-base',
    why: 'the attack spawn pocket looking east down the map: NORTHEAST at 147 m and RIMM26 beyond it.',
    from: [-14, -150], at: [79, 2, -140], eye: 1.62,
    arm: ['NORTHEAST', 'RIMM26'],
  },
];

/**
 * EVERY CAMERA GETS AN OFF CONTROL, and the first run of this probe is why.
 *
 * NACHTFELD at night is FULL of orange point sources that are nobody's rifle —
 * burning wrecks, the works' practicals, the fires the crash leaves, the ridge.
 * A photograph of a bright cluster on the horizon does not say whether it is
 * ambient fire or a fire, and the first set of frames out of this probe could
 * not answer that question about its own subject. Two frames with
 * `warfield.enabled` false, from the same camera, second apart, settle it: what
 * is in the ON frames and not in the OFF frames is this subsystem, and nothing
 * else in the frame is.
 */
for (const c of CAMS) {
  console.log(`\n  ${c.tag} — ${c.why}`);
  const y = await place(c.from, c.at, c.eye);
  const armed = await arm(c.arm);
  console.log(`    eye at y=${y}, armed [${armed.join(', ')}]`);
  await frames(10);
  console.log(`    ramp: ${await gains()}`);
  await burst(c.tag);
  await page.evaluate(() => { window.__ENGINE__.ctx.peek('match').warfield.enabled = false; });
  await frames(20);
  await place(c.from, c.at, c.eye);
  await burst(`${c.tag}-OFF-control`, 2, 8);
  await page.evaluate(() => { window.__ENGINE__.ctx.peek('match').warfield.enabled = true; });
}

/* ── the shelling, caught mid-walk ───────────────────────────────────────── */
console.log('\n  6-shelling — waiting for a barrage to open');
await place([0, 0], [-40, 60, -200], 1.62);
/**
 * The next barrage, now. This sets the GAP's clock to zero — the same thing
 * the scheduler does every nine to twenty-six seconds — and changes nothing
 * about where the walk goes, how many shells it is or how far out they land.
 */
await page.evaluate(() => { window.__ENGINE__.ctx.peek('match').warfield._gun.t = 0; });
try {
  await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match').warfield._gun.left > 1, null, { timeout: 60000 });
  const aim = await page.evaluate(() => {
    const g = window.__ENGINE__.ctx.peek('match').warfield._gun;
    return { x: g.x, z: g.z, left: g.left, r: +Math.hypot(g.x, g.z).toFixed(0) };
  });
  console.log(`    barrage at (${aim.x.toFixed(0)}, ${aim.z.toFixed(0)}) r=${aim.r} m, ${aim.left} shells to go`);
  await place([0, 0], [aim.x, 40, aim.z], 1.62);
  await burst('6-shelling', 5, 12);
} catch { console.log('    ! no barrage opened inside the window'); }

/* ── the honesty ramp, with a CONTROL ─────────────────────────────────────── */
/**
 * THE PAIR THAT MATTERS, AND THE PAIR THAT PROVES IT IS THE PAIR.
 *
 * Same engagement, same camera, one frame with `warfield.enabled` true and one
 * with it false — at 128 m where the ramp is at 1.00 and at 54 m where it is at
 * 0.05. The control frames exist because the first run of this probe
 * photographed a bright cluster of flashes at the near position and there was
 * no way to tell from the photograph whether it was ambient fire the ramp had
 * failed to suppress or a real firefight forty men were having. A screenshot
 * that cannot answer that question is not evidence about this subsystem.
 */
console.log('\n  7-ramp — WESTCENTRE from 128 m and from 54 m, with an OFF control at each');
for (const [tag, from] of [['far-128m', [7, -6]], ['near-54m', [-69, 42]]]) {
  await place(from, [-94, 1, 58], 1.62);
  await arm(['WESTCENTRE'], 30);
  await frames(12);
  const g = await page.evaluate(() => {
    const w = window.__ENGINE__.ctx.peek('match').warfield;
    const f = w.fights.find((q) => q.id === 'WESTCENTRE');
    const c = w._cam;
    return { gain: +w._audible(f).toFixed(3), d: +Math.min(Math.hypot(c.x - f.ax, c.z - f.az), Math.hypot(c.x - f.bx, c.z - f.bz)).toFixed(0) };
  });
  console.log(`    ${tag}: nearest end ${g.d} m, ramp gain ${g.gain}`);
  await page.evaluate(() => { window.__ENGINE__.ctx.peek('match').warfield.enabled = true; });
  await burst(`7-ramp-${tag}-ON`, 3, 8);
  await page.evaluate(() => { window.__ENGINE__.ctx.peek('match').warfield.enabled = false; });
  await frames(20);
  await burst(`7-ramp-${tag}-OFF-control`, 2, 8);
  await page.evaluate(() => { window.__ENGINE__.ctx.peek('match').warfield.enabled = true; });
}

console.log(errs.length ? `\nPAGEERRORS(${errs.length}):\n  ${errs.slice(0, 3).join('\n  ')}` : '\n0 pageerrors');
await b.close();
