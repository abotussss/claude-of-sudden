/**
 * VAULT GATE — can a PLAYER actually get through the low windows?
 *
 *   node tools/vaultcheck.mjs [--url=…]
 *
 * WHY. `bayKinds` authors a handful of low, wide, glassless openings — W1's is
 * commented as "the A lane's window entry" — and they are load-bearing for the
 * map: they are the way into a building that does not cost you the walk round
 * to its door. Five were declared. Every one of them was verified by RAYCAST,
 * which proves a hole exists in the wall and nothing whatsoever about whether a
 * 0.32 m capsule with a 0.42 m step height and a 1.85 m mantle ceiling can get
 * through it. Nobody had ever driven a player at one.
 *
 * That distinction is not academic. The doorways on this map all raycast clear
 * too, and 15 of 16 of them were impassable — see `indoorcheck` and the plinth.
 *
 * So this drives the real controller at each low opening, holding forward AND
 * jump, because `_tryLedge` only fires an unprompted vault below
 * `MOVE.mantle.autoVaultMax` (0.72 m) and these sills sit at about 0.95 m:
 * above that the vault is deliberately an explicit action, so a player has to
 * ask for it. It then checks the capsule finished INSIDE the footprint.
 *
 * Shares indoorcheck's hardening, and for the same reasons — see the long note
 * at the top of that file. The match is stopped (it teleports the subject to a
 * spawn at every round start and pins the feet during the freeze phase), the
 * keypress is verified rather than assumed (Input.beginFrame drains pendingDown
 * before pendingUp, so a press and a release in one frame annihilate), and the
 * distance travelled is reported so a teleport cannot masquerade as a result.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  /** Split on the FIRST `=`: `--url=…/?seed=12` was truncated to `…/?seed`, so
   *  the gate measured seed 0 while reporting the seed it was given. */
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4173/';

const SPRINT = 7.01;   // m/s — the ceiling W alone can produce; above it is a teleport
const WALK_S = 3.0;    // seconds of SIMULATED time per attempt
const MANTLE_MAX = 1.85; // MOVE.mantle.maxHeight

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const step = (n) => page.evaluate((n) => new Promise((r) => {
  let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

const quiesce = () => page.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const m = c.peek('match'), pl = c.peek('player'), ai = c.peek('ai');
  if (m) {
    if (!m.__vaultcheckStopped) { m.update = () => {}; m.__vaultcheckStopped = true; }
    m.timer = Infinity; m.roundClock = Infinity;
  }
  if (ai) { ai.combatEnabled = false; try { ai.clearAgents(); } catch { /* ok */ } }
  if (pl) {
    pl.movementLocked = false;
    pl.setControlEnabled?.(true);
    if (pl.movement) { pl.movement.movementLocked = false; pl.movement.sprinting = false; }
    pl.alive = true;
  }
});

await quiesce();
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await step(90);
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
await quiesce();

/** Every ground-floor opening low enough to be a way in. */
const list = await page.evaluate((MANTLE_MAX) => {
  const c = window.__ENGINE__.ctx, w = c.peek('world');
  const B = w.layout?.BUILDINGS;
  if (!B || !w.buildings) return null;
  const V = c.camera.position.constructor;
  const out = [];
  B.forEach((b, i) => {
    if (!b.enterable) return;
    for (const win of w.buildings[i]?.windows ?? []) {
      if (win.f !== 0) continue;
      /**
       * Only GLASSLESS openings. The first cut of this filter took every
       * ground-floor window under the mantle ceiling and duly reported 18 of 54
       * unvaultable — but most of those are glazed, curtained or boarded, and a
       * pane of glass you cannot dive through is the window working correctly.
       * `state === 'open'` is the one `windowState` returns with no glass in it.
       *
       * A grille is not recorded on `info.windows`; `buildFacade` rolls one onto
       * about half of all ground-floor openings after the fact. So an 'open'
       * window can still be barred, and one that fails here for that reason is a
       * real finding rather than a false alarm — it is an opening the map reads
       * as a way in and the player cannot use.
       */
      if (win.state !== 'open') continue;
      const sill = win.y - win.h / 2;
      if (sill > MANTLE_MAX || sill < 0.3) continue;
      /**
       * Is this one of the AUTHORED vault-ins, or an ordinary window that
       * happened to roll glassless? Only the authored ones set `grille: false`;
       * the rest get bars about half the time, and a barred window nobody can
       * dive through is the map working as intended, not a defect. Recover the
       * bay index the same way `buildFacade` derived it so the two agree.
       */
      const len = win.side === 0 || win.side === 2 ? b.w : b.d;
      const bays = Math.max(1, Math.round(len / 3.05));
      const bay = Math.round((win.x + len / 2) / (len / bays) - 0.5);
      const authored = !!b.bayKinds?.[win.side]?.[0]?.[bay];
      // the panel matrix is level space (see the note in indoorcheck)
      const p = new V(win.x, 0, 0).applyMatrix4(win.pm);
      out.push({ id: b.id, x: b.x, z: b.z, w: b.w, d: b.d, side: win.side, authored,
                 state: win.state, sill: +sill.toFixed(2), ow: +win.w.toFixed(2),
                 lx: p.x, lz: p.z });
    }
  });
  return out;
}, MANTLE_MAX);
if (!list) {
  console.log('[vaultcheck] world does not expose layout/buildings');
  await browser.close(); process.exit(2);
}

async function vault(v) {
  await quiesce();
  const start = await page.evaluate(([v]) => {
    const c = window.__ENGINE__.ctx, pl = c.peek('player'), w = c.peek('world');
    const V = c.camera.position.constructor;
    const OUT = [[0, -1], [1, 0], [0, 1], [-1, 0]][v.side];
    const outL = new V(v.lx + OUT[0] * 3, 0, v.lz + OUT[1] * 3);
    const wantW = w.levelToWorld(outL.x, 0.2, outL.z, new V());
    const aimW = w.levelToWorld(v.lx, 0, v.lz, new V());
    pl.respawnAt({ x: wantW.x, y: wantW.y, z: wantW.z });
    const yaw = Math.atan2(-(aimW.x - wantW.x), -(aimW.z - wantW.z));
    pl.movement.yaw = yaw; pl.yaw = yaw;
    const q = pl.position ?? c.camera.position;
    const l = w.worldToLevel(q.x, q.y, q.z, new V());
    return { drift: Math.hypot(q.x - wantW.x, q.z - wantW.z),
             lvl: [+l.x.toFixed(1), +l.z.toFixed(1)] };
  }, [v]);

  // Forward, and ask for the vault: above autoVaultMax it will not fire on its own.
  await step(4);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  await step(3);
  const held = await page.evaluate(() => window.__ENGINE__.ctx.input.down.has('KeyW'));
  if (!held) {
    await page.keyboard.up('KeyW'); await step(6);
    await page.keyboard.down('KeyW'); await step(3);
  }
  const res = await page.evaluate(([v, secs]) => new Promise((done) => {
    const c = window.__ENGINE__.ctx, pl = c.peek('player'), w = c.peek('world');
    const V = c.camera.position.constructor;
    const tmp = new V();
    const t0 = c.time.elapsed;
    const p0 = pl.position ?? c.camera.position;
    const s = { x: p0.x, z: p0.z };
    let best = -Infinity, everIn = false, frames = 0, heldFrames = 0, vaulted = false;
    const tick = () => {
      const q = pl.position ?? c.camera.position;
      const l = w.worldToLevel(q.x, q.y, q.z, tmp);
      const margin = Math.min(v.w / 2 - Math.abs(l.x - v.x), v.d / 2 - Math.abs(l.z - v.z));
      if (margin > best) best = margin;
      if (margin > 0.3) everIn = true;
      const st = pl.movement?.state;
      if (st === 'vault' || st === 'mantle') vaulted = true;
      frames++;
      if (c.input.down.has('KeyW')) heldFrames++;
      if (c.time.elapsed - t0 >= secs) {
        const l2 = w.worldToLevel(q.x, q.y, q.z, new V());
        return done({ everIn, vaulted, best: +best.toFixed(2), frames, heldFrames,
          sim: +(c.time.elapsed - t0).toFixed(2),
          dist: +Math.hypot(q.x - s.x, q.z - s.z).toFixed(1),
          end: [+l2.x.toFixed(1), +l2.z.toFixed(1)] });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), [v, WALK_S]);
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyW');
  return { ...start, ...res,
    teleport: res.dist > SPRINT * res.sim + 1,
    invalid: res.heldFrames < res.frames * 0.9 };
}

const rows = [];
for (const v of list) rows.push({ v, r: await vault(v) });

console.log('\n  window          sill  open  kind   in?  vaulted  start(lvl)        end(lvl)         moved  maxDepth');
let fail = 0, ports = 0, bad = 0, extraOk = 0, extraNo = 0;
for (const { v, r } of rows) {
  if (v.authored) { if (!r.everIn) fail++; }
  else if (r.everIn) extraOk++;
  else extraNo++;
  if (r.teleport) ports++;
  if (r.invalid) bad++;
  const flag = r.invalid ? ` <-- INVALID: W held ${r.heldFrames}/${r.frames}`
    : r.teleport ? ' <-- TELEPORT' : r.drift > 1.0 ? ` <-- START DRIFT ${r.drift.toFixed(1)}m` : '';
  console.log(
    `  ${(v.id + ' s' + v.side).padEnd(14)} ${String(v.sill).padStart(4)}  ${String(v.ow).padStart(4)}   ` +
    `${(r.everIn ? 'YES' : 'NO ')}  ${(r.vaulted ? 'yes' : 'no ').padEnd(7)} ` +
    `[${String(r.lvl[0]).padStart(6)},${String(r.lvl[1]).padStart(6)}]  ` +
    `[${String(r.end[0]).padStart(6)},${String(r.end[1]).padStart(6)}]  ` +
    `${String(r.dist).padStart(5)}m  ${String(r.best).padStart(6)}m${flag}`
  );
}
if (errs.length) console.log('\n[vaultcheck] page errors', errs.slice(0, 4));
if (ports) console.log(`\n[vaultcheck] ${ports} attempt(s) TELEPORTED — fix the harness`);
if (bad) console.log(`\n[vaultcheck] ${bad} attempt(s) INVALID — the keypress never reached the game`);
const authored = rows.filter((x) => x.v.authored).length;
console.log(
  `\n  incidental glassless openings (not authored as entries, bars rolled by dice):` +
  ` ${extraOk} passable, ${extraNo} barred`
);
console.log(fail ? `\n[vaultcheck] FAIL — ${fail}/${authored} AUTHORED vault-in windows cannot be used`
                 : `\n[vaultcheck] PASS — all ${authored} authored vault-in windows put a player inside`);
await browser.close();
process.exit(fail || ports || bad || errs.length ? 1 : 0);
