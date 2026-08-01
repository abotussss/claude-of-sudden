/**
 * THE PICTURE THE PLAYER TOOK — one side from directly overhead, mid-match.
 *
 * The complaint was a screenshot of ten men shoulder to shoulder walking one
 * line, so the acceptance is a screenshot too. Everything about the frame is
 * FIXED so two builds can be laid side by side: the level seed is pinned, the
 * shot is taken after a fixed number of frames at a fixed time scale, and the
 * camera pose is derived from the LEVEL (the midpoint of the side's road in
 * from its own spawn) and not from where the men happen to be — a camera that
 * frames itself on the men would rescale the picture to hide the difference.
 *
 *   node _packshot.mjs --url=… --seed=3 --tag=before [--team=1] [--alt=95]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4365/';
const SEED = +(args.seed ?? 3);
const TEAM = +(args.team ?? 1);
const ALT = +(args.alt ?? 95);
const TAG = args.tag ?? 'after';
const OUT = args.out ?? 'shots/packs';
const FRAMES = +(args.frames ?? 520);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?seed=${SEED}&capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
  for (const n of document.querySelectorAll('.ow-hud')) n.style.display = 'none';
  if (e.viewScene) e.viewScene.visible = false;
  e.ctx.time.scale = 8;
});
const frames = (n) => page.evaluate((k) => new Promise((d) => {
  let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);


/**
 * ────────────────────────────────────────────────────────────────────────────
 * PHOTOGRAPH THE WORST MOMENT, because that is the one the player photographed.
 * ────────────────────────────────────────────────────────────────────────────
 * A frame taken at a fixed clock is a coin toss — measured, three fixed instants
 * gave the pre-fireteam build 5/4/4 men in its worst circle and this build
 * 3/5/2, which says nothing at all. The statistic that matters is a worst case,
 * so the picture has to be of one: the run is watched for a FIXED window, every
 * sample scored exactly the way `_clump.mjs` scores it (own side, 8 m, base
 * pockets excluded), and the shutter opens on the worst moment that window
 * produced. Window, seed, sampling rate and camera geometry are identical for
 * every build, so the only thing that differs between two of these frames is
 * the behaviour.
 */
const SCORE = ({ team }) => {
  const e = window.__ENGINE__, ai = e.ctx.peek('ai'), m = e.ctx.peek('match');
  const bases = [...m.spawns.attack, ...m.spawns.defend].map((s) => s.position);
  const men = [];
  for (const a of ai.agents) {
    if (!a.alive || a.team !== team) continue;
    let inBase = false;
    for (const b of bases) if (Math.hypot(b.x - a.position.x, b.z - a.position.z) < 30) { inBase = true; break; }
    if (!inBase) men.push(a);
  }
  let best = { n: 0, x: 0, z: 0 };
  for (const c of men) {
    let n = 0, cx = 0, cz = 0;
    for (const o of men) {
      const dx = o.position.x - c.position.x, dz = o.position.z - c.position.z;
      if (dx * dx + dz * dz <= 64) { n++; cx += o.position.x; cz += o.position.z; }
    }
    if (n > best.n) best = { n, x: cx / n, z: cz / n };
  }
  return best;
};

/**
 * THE SHUTTER OPENS ON THE FRAME THAT WAS SCORED. Remembering the worst moment
 * and re-aiming at it afterwards photographs an empty street — the men have
 * walked on. So every time the run beats its own record the camera is placed
 * and the picture is taken INSIDE that evaluation's frame, overwriting the last
 * one. What survives is the worst moment the window actually produced.
 */
const place = ({ team, alt, at }) => {
  const e = window.__ENGINE__, m = e.ctx.peek('match');
  const sc = team === 0 ? m._spawnCentre.attack : m._spawnCentre.defend;
  /**
   * A DRONE BEHIND THE SIDE'S OWN ROAD IN, not a plan view: straight down at
   * ninety metres the roofs are most of the frame and a soldier is four pixels.
   * The bearing is level geometry — this side's gate toward the map's centre —
   * and only the point it is aimed at is the pack itself.
   */
  const L = Math.hypot(sc.x, sc.z) || 1;
  const V3 = e.camera.position.constructor;
  e.camera.position.set(at.x + (sc.x / L) * alt * 1.15, alt, at.z + (sc.z / L) * alt * 1.15);
  e.camera.lookAt(new V3(at.x, 1.6, at.z));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  e.camera.updateMatrixWorld(true);
  return e.ctx.peek('ai').agents.filter((a) => a.alive && a.team === team).length;
};

const HUNT = +(args.hunt ?? 220);
await frames(FRAMES);
const file = `${OUT}/side${TEAM}-seed${SEED}-${TAG}.png`;
let best = { n: 0, x: 0, z: 0 }, men = 0;
for (let i = 0; i < HUNT; i++) {
  await frames(4);
  const s = await page.evaluate(SCORE, { team: TEAM });
  if (s.n <= best.n) continue;
  best = s;
  men = await page.evaluate(place, { team: TEAM, alt: ALT, at: s });
  await page.screenshot({ path: file });
}
console.log(JSON.stringify({
  file, worstIn8m: best.n, at: [+best.x.toFixed(0), +best.z.toFixed(0)],
  liveMen: men, seed: SEED, pageerrors: errs.slice(0, 3),
}));
await b.close();
