/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE UPLINK, PHOTOGRAPHED — the button, the sign, and both ends of the strike
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   BASE=http://127.0.0.1:4629/ node _satshots.mjs
 *
 * NACHTFELD is authored at hour 21.65. Nothing here changes the lighting; every
 * frame is the map as it is played.
 *
 * THE POSE IS READ BACK OFF THE PLAYER AND PRINTED INTO EVERY FRAME'S CAPTION.
 * `player.teleport(eye, rot)` reads a pitch ONLY when `rot` is an object, so
 * `rot` is `{ x: pitch, y: yaw }` throughout — two earlier passes on this tree
 * shipped "look up" screenshots that came out level because they passed a
 * number. @see `src/dev/shots.js` and `_tzshots.mjs`.
 *
 * AND THE HUD IS ON FOR THE LAST TWO. `_tzshots.mjs` hides `ui.root` because it
 * is photographing a building; frames 05-08 here are photographing a TELEGRAPH,
 * and a telegraph with the HUD switched off is a photograph of the thing not
 * happening.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4629/';
const DIR = 'shots/satcall';
mkdirSync(DIR, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${BASE}?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id),
  ' hour =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.hour));

const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/** Run to `phase === 'live'` — nothing about a prompt or a zone means anything before. */
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await p.waitForFunction(() => window.__ENGINE__.ctx.peek('match')?.phase === 'live', null, { timeout: 120000 });
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });

const hud = (on) => p.evaluate((on) => {
  const ui = window.__ENGINE__.ctx.peek('ui');
  if (ui?.root) ui.root.style.display = on ? '' : 'none';
  if (!on) ui?.banner?.hide?.();
}, on);

/**
 * FREEZE THE MATCH FOR THE STILL FRAMES ONLY. `_tzshots.mjs` learnt this the
 * hard way: with the match live, a man posed on a capture point is shot and
 * respawned 130 m away and the shutter fires on a spawn. The strike frames run
 * with the match LIVE, because `MatchSystem.update` is what advances the strike.
 * `setControlEnabled(false)` is NOT part of it — with control off nothing pushes
 * the movement state into the camera and `teleport` has nowhere to land.
 */
const freeze = (on) => p.evaluate((on) => {
  const m = window.__ENGINE__.ctx.peek('match');
  if (!m) return;
  if (on) { m.__realUpdate = m.__realUpdate ?? m.update; m.update = () => {}; }
  else if (m.__realUpdate) m.update = m.__realUpdate;
}, on);

async function shot(name, eye, rot, note) {
  const pose = await p.evaluate(([eye, rot]) => {
    const pl = window.__ENGINE__.ctx.peek('player');
    pl.teleport(eye, rot);
    return null;
  }, [eye, rot]);
  await wait(8);
  const back = await p.evaluate(() => {
    const pl = window.__ENGINE__.ctx.peek('player');
    return { x: +pl.position.x.toFixed(2), y: +pl.position.y.toFixed(2), z: +pl.position.z.toFixed(2), yaw: +pl.yaw.toFixed(3) };
  });
  await p.screenshot({ path: `${DIR}/${name}.png` });
  console.log(`  ${name.padEnd(30)} at (${back.x}, ${back.y}, ${back.z}) yaw ${back.yaw}  ${note}`);
  return pose;
}

/** Where the console actually is, asked of the record rather than assumed. */
const K = await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const k = m.caches.list.find((q) => q.id === 'NF-TOWER-SATCALL');
  return { x: k.position.x, y: k.position.y, z: k.position.z };
});
console.log('  console at', JSON.stringify(K));

/* ── 01-04  the object, and the sign that points at it ───────────────────── */
await hud(false);
await freeze(true);
// at the console, looking down at the button
await shot('01-console-close', { x: K.x, y: K.y + 1.62, z: K.z - 1.9 }, { x: -0.34, y: Math.PI },
  'the button, from where a man stands to press it');
// standing back in the cab, so the console reads against the eight amber ones
await shot('02-console-in-cab', { x: K.x + 4.6, y: K.y + 1.62, z: K.z + 3.4 }, { x: -0.12, y: -2.35 },
  'the cab: the uplink is the only red thing in it');
// the whole tower from 150 m, the range the sign has to carry at
await shot('03-tower-150m-west', { x: -142, y: 8.0, z: -34 }, { x: 0.10, y: -Math.PI / 2 },
  'both bands and the line to the cab, from 150 m');
/**
 * FROM ZONE D, standing on the point the tower overlooks. `yaw = π` was the
 * first cut and it photographed THE FORTRESS: forward is `(-sin yaw, -cos yaw)`
 * (measured, @see `_nfsat.mjs`), so π looks at +z and the tower is at z -32,
 * i.e. at -z from D's centre. `yaw = 0` is the tower.
 */
await shot('04-from-zone-D', { x: 0, y: 5.0, z: 13.0 }, { x: 0.40, y: 0 },
  'from zone D (0,0) — the uplink band and its line up to the cab');

/* ── 05-08  the strike: the telegraph, and the rounds ────────────────────── */
await hud(true);
await freeze(false);

/**
 * Hand the target point to the enemy so there is something legal to call on,
 * then call it FROM THE CONSOLE — the man has to be at the post, because
 * `_satTarget` picks off his own bearing.
 */
const called = await p.evaluate((K) => {
  const c = window.__ENGINE__.ctx;
  const m = c.peek('match');
  const pl = c.peek('player');
  const z = m.sites.find((q) => q.id === 'C') ?? m.sites[0];
  z.owner = 1 - m.playerTeam;
  z.ownedSince = c.time.elapsed;
  pl.teleport({ x: K.x, y: K.y + 1.6, z: K.z - 1.0 },
    { x: 0, y: Math.atan2(-(z.position.x - K.x), -(z.position.z - K.z)) });
  m._sat.readyAt = 0;
  const denied = m._satCall();
  return { denied, target: m._sat.zone?.id ?? null, prompt: m._cachePrompt.sub };
}, K);
console.log('  called:', JSON.stringify(called));

/**
 * WAIT ON THE STRIKE'S OWN CLOCK, NOT ON A FRAME COUNT. Headless this renderer
 * runs at about 13 Hz, so "3 seconds in" counted in frames at 60 Hz is 14 s and
 * every frame is of the wrong beat. `_sat.t` is the seconds since the call.
 */
const at = (secs) => p.evaluate((secs) => new Promise((r) => {
  const m = window.__ENGINE__.ctx.peek('match');
  const t = () => (m._sat.t >= secs || m._sat.t < 0 ? r(+m._sat.t.toFixed(2)) : requestAnimationFrame(t));
  requestAnimationFrame(t);
}), secs);

/** The defender's eye: standing ON the point, which is who the telegraph is for. */
const pose = await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const z = m._sat.zone;
  return z ? { x: z.position.x, y: z.position.y, z: z.position.z, id: z.id } : null;
});

if (pose) {
  /**
   * `d` IS THE WHOLE DIFFERENCE BETWEEN THE TWO PAIRS OF FRAMES. 05/06 are the
   * DEFENDER'S view and are taken standing ON the point, which is who the
   * telegraph is for. 07/08 are the strike itself and are taken 34 m out —
   * because the first cut took them at 5.5 m, the man was killed by his own
   * call ("KILLED BY BOMBARDMENT · INDIRECT FIRE · 7.8M", which is its own
   * proof) and both frames are a white screen of dust with nothing legible in
   * them. A photograph of a bombardment has to be far enough out to see it.
   */
  const stand = async (t, name, note, d) => {
    const got = await at(t);
    await p.evaluate(([pose, d]) => {
      const k = d / Math.SQRT2;
      window.__ENGINE__.ctx.peek('player').teleport(
        { x: pose.x + k, y: pose.y + 1.7 + d * 0.16, z: pose.z + k },
        { x: -0.06 - d * 0.004, y: Math.PI / 4 });
    }, [pose, d]);
    await p.screenshot({ path: `${DIR}/${name}.png` });
    console.log(`  ${name.padEnd(30)} _sat.t = ${got}s on ${pose.id} from ${d} m  ${note}`);
  };
  await stand(0.4, '05-telegraph-first-pulse', 'ON the point: the strip, twelve reticles, the first pulse', 7.8);
  await stand(6.2, '06-telegraph-late', 'ON the point: the ring has tightened, the count is nearly out', 7.8);
  /**
   * …AND HE WALKS OUT BEFORE THE FIRST ROUND, WHICH IS THE WHOLE POINT OF THE
   * TELEGRAPH. The previous cut stayed on the circle through the impact: he was
   * killed ("KILLED BY BOMBARDMENT · INDIRECT FIRE · 7.8M" — its own proof that
   * this thing is lethal, kept as `06b`), and 07/08 were then a KILLCAM of a
   * dead man in a dust cloud rather than photographs of a bombardment. Moved at
   * t=8.2 of a 9.0 s lead, i.e. the last moment the warning allows, and healed
   * because a man who took a graze is not what these two frames are about.
   */
  await at(8.2);
  await p.evaluate(([pose, d]) => {
    const c = window.__ENGINE__.ctx;
    const pl = c.peek('player');
    const k = d / Math.SQRT2;
    pl.teleport({ x: pose.x + k, y: pose.y + 1.7 + d * 0.16, z: pose.z + k }, { x: -0.06 - d * 0.004, y: Math.PI / 4 });
    pl.health?.heal?.(200);
  }, [pose, 34]);
  await stand(9.8, '07-rounds-landing', 'from 34 m, alive: the stick walking the circle', 34);
  await stand(13.5, '08-rounds-landing-late', 'the far half of the circle', 34);
  await at(99);
  await p.screenshot({ path: `${DIR}/09-after.png` });
  console.log('  09-after                       the point after the strike');
}

console.log(`\npageerrors = ${errs.length}${errs.length ? ' :: ' + errs[0] : ''}`);
await b.close();
