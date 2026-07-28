/**
 * THROUGH-ROUTE GATE — is every interior a ROUTE, or is it a room you get
 * trapped in?
 *
 *   node tools/throughcheck.mjs [--url=…] [--verbose] [--only=W2,E3]
 *
 * WHY. `indoorcheck` proves you can get IN. That is only half of what an
 * interior on a demolition map has to be. An enterable building whose only way
 * out is the door you came through is a cul-de-sac: you cannot use it to cross
 * from the mid street to a site, anyone who follows you in has you cornered, and
 * the building may as well have been solid. The map's own layout note claims W2
 * and E2 are "a covered way from mid straight into the site" — nothing in the
 * repo has ever verified that the two sides of that claim are joined up on the
 * inside.
 *
 * WHAT IS ACTUALLY PROVED HERE, precisely, because a gate that overstates
 * itself is worse than no gate:
 *
 *   For every enterable building, a grid of the REAL PLAYER CAPSULE
 *   (r = 0.32 m, h = 1.78 m — src/core/config.js UNITS) is swept over the
 *   building's ground-floor footprint against the REAL physics BVH, and a
 *   4-connected flood fill with the player's 0.42 m step height is run from
 *   just inside each exit. The flood is CONFINED TO THE FOOTPRINT, so a route
 *   it finds cannot have stepped outside and walked around — which is the whole
 *   meaning of "without retracing". An exit passes when the flood from it
 *   reaches a DIFFERENT exit at least MIN_SEP metres away.
 *
 * WHY A CAPSULE SWEEP AND NOT A DRIVEN WALK. `indoorcheck` drives the real
 * controller because a door is a straight line: stand off, hold W, see where you
 * end up. A through-route is not a straight line — it turns around partitions
 * and past furniture — and a bot-less harness holding W cannot steer. Driving
 * the controller down a route it cannot find would fail buildings for the
 * harness's inability to walk round a table, which is precisely the
 * untrustworthy NO the other gates were rewritten to avoid. The capsule is the
 * same collision shape the controller uses against the same static BVH, so
 * "the capsule fits in this cell" is the same fact the controller acts on;
 * what is NOT proved is the controller's own step/slide behaviour along the
 * route. `indoorcheck` covers that at every threshold.
 *
 * EXITS are the doors the builder actually cut (`world.buildings[i].doors`) plus
 * the AUTHORED vault-in windows (`bayKinds` openings with `state: 'open'`,
 * `grille: false` and a sill under the 1.85 m mantle ceiling) — the same set
 * `vaultcheck` drives a player through. An incidental glassless window is not
 * counted: half of them get bars rolled onto them after the fact, so treating
 * one as an exit would let a building pass on an opening the player cannot use.
 *
 * The match is stopped and the bots cleared first, for the reasons written out
 * at length in `indoorcheck.mjs` — none of them apply to a raycast, but the
 * boot settle is shared and a live round moves props.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const URL = args.url ?? 'http://127.0.0.1:4173/';
const VERBOSE = !!args.verbose;
const ONLY = typeof args.only === 'string' ? args.only.split(',') : null;

/**
 * Two exits closer together than this are the same way out — a pair of doors in
 * one bay is not a through-route, it is a wide door. 3 m is a little over two
 * bay widths (3.05 m), so a genuine second opening on the same face still counts
 * while a double leaf does not.
 */
const MIN_SEP = 3.0;

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const step = (n) => page.evaluate((n) => new Promise((r) => {
  let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

await page.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const m = c.peek('match'), ai = c.peek('ai');
  if (m && !m.__throughcheckStopped) { m.update = () => {}; m.__throughcheckStopped = true; }
  if (ai) { ai.combatEnabled = false; try { ai.clearAgents(); } catch { /* ok */ } }
});
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await step(60);
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });

/**
 * The whole measurement runs in one page call: the physics BVH cannot be
 * marshalled out, and a round trip per cell would be tens of thousands of them.
 */
const report = await page.evaluate(([MIN_SEP, MANTLE_MAX]) => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), phys = c.peek('physics');
  const B = w.layout?.BUILDINGS;
  if (!B || !w.buildings) return null;
  const V = c.camera.position.constructor;
  /**
   * The mask the CHARACTER CONTROLLER uses, not MASK.WORLD — it is
   * STATIC | PROP | CLIP, so a clip brush authored to keep a player out is
   * honoured here exactly as it is honoured by the real capsule.
   * `CharacterController.checkCapsule` also shaves 5 mm off the radius; matched,
   * so this test is neither stricter nor looser than the one the game runs.
   */
  const MASK = phys.MASK.CHARACTER;

  const R = 0.32;      // UNITS.playerRadius
  const H = 1.78;      // UNITS.playerHeight
  const STEP = 0.42;   // STANCE.stand.stepHeight
  const CELL = 0.22;   // finer than the capsule radius, so a 1.12 m door resolves
  /** Height the floor probe drops from: above any step, below the first slab
   *  (the shortest ground floor on the map is K1's at 3.2 m). */
  const PROBE_Y = 1.75;

  const OUT = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const _a = new V(), _b = new V(), _wp = new V();

  const out = [];
  for (let bi = 0; bi < B.length; bi++) {
    const spec = B[bi];
    if (!spec.enterable) continue;
    const info = w.buildings[bi];
    if (!info) continue;

    // ------------------------------------------------------------- exits --
    const exits = [];
    for (const d of info.doors) {
      exits.push({ kind: 'door', side: d.side, lx: d.wp[0], lz: d.wp[2] });
    }
    for (const win of info.windows ?? []) {
      if (win.f !== 0 || win.state !== 'open') continue;
      const sill = win.y - win.h / 2;
      if (sill > MANTLE_MAX || sill < 0.3) continue;
      // Recover the bay the same way buildFacade derived it, so "authored"
      // here means the same thing it means in vaultcheck.
      const len = win.side === 0 || win.side === 2 ? spec.w : spec.d;
      const bays = Math.max(1, Math.round(len / 3.05));
      const bay = Math.round((win.x + len / 2) / (len / bays) - 0.5);
      if (!spec.bayKinds?.[win.side]?.[0]?.[bay]) continue;
      const p = _wp.set(win.x, 0, 0).applyMatrix4(win.pm);
      exits.push({ kind: 'window', side: win.side, lx: p.x, lz: p.z, sill: +sill.toFixed(2) });
    }

    // ------------------------------------------------------------- grid --
    const x0 = spec.x - spec.w / 2, z0 = spec.z - spec.d / 2;
    const nx = Math.floor(spec.w / CELL) + 1;
    const nz = Math.floor(spec.d / CELL) + 1;
    const n = nx * nz;
    const floor = new Float32Array(n).fill(NaN);
    const free = new Uint8Array(n);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const lx = x0 + ix * CELL, lz = z0 + iz * CELL;
        w.levelToWorld(lx, 0, lz, _wp);
        const down = phys.raycast(_wp.x, PROBE_Y, _wp.z, 0, -1, 0, 4.5, MASK);
        if (!down.hit) continue;
        const fy = down.point.y;
        const i = iz * nx + ix;
        floor[i] = fy;
        /**
         * Standing room for the real capsule, tested against the real BVH —
         * but from STEP HEIGHT up, not from the soles.
         *
         * `checkCapsule` takes the two sphere CENTRES, so a capsule placed at
         * the feet bulges 0.32 m sideways at ankle level and clips anything low
         * standing beside it. That is not how the controller moves: it steps
         * over anything under `STANCE.stand.stepHeight`. Measured, the
         * difference is not academic — W2's mattress is a 0.2 m collision box
         * and testing from the soles ringed it with "blocked" cells, cut the
         * only free cell at the side-3 door off from the rest of the room, and
         * reported a perfectly walkable living room as a dead end. Starting the
         * capsule at 0.42 m models the step and leaves everything at knee height
         * and above blocking, which is the real constraint.
         * `checkCapsule` returns TRUE when the capsule is CLEAR.
         */
        _a.set(_wp.x, fy + STEP + R, _wp.z);
        _b.set(_wp.x, fy + H - R + 0.02, _wp.z);
        if (!phys.checkCapsule(_a, _b, R - 0.005, MASK)) continue;
        free[i] = 1;
      }
    }

    // --------------------------------------------------- exit anchor cells --
    /** Nearest free cell to a point, searched in rings; -1 when walled in. */
    const nearestFree = (lx, lz, maxR) => {
      const cx = Math.round((lx - x0) / CELL), cz = Math.round((lz - z0) / CELL);
      const rings = Math.ceil(maxR / CELL);
      let best = -1, bestD = Infinity;
      for (let r = 0; r <= rings; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const ix = cx + dx, iz = cz + dz;
            if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
            const i = iz * nx + ix;
            if (!free[i]) continue;
            const d = dx * dx + dz * dz;
            if (d < bestD) { bestD = d; best = i; }
          }
        }
        if (best >= 0) break;
      }
      return best;
    };
    for (const e of exits) {
      // Step INWARD off the wall plane: the threshold cell itself sits in the
      // 0.34 m wall and the capsule does not fit in the reveal.
      const inn = OUT[e.side];
      e.cell = nearestFree(e.lx - inn[0] * 0.85, e.lz - inn[1] * 0.85, 1.6);
      e.blocked = e.cell < 0;
    }

    // ----------------------------------------------------------- flood fill --
    const comp = new Int32Array(n).fill(-1);
    let nComp = 0;
    const queue = new Int32Array(n);
    for (const e of exits) {
      if (e.blocked || comp[e.cell] >= 0) continue;
      const id = nComp++;
      let head = 0, tail = 0;
      queue[tail++] = e.cell; comp[e.cell] = id;
      while (head < tail) {
        const cur = queue[head++];
        const ix = cur % nx, iz = (cur / nx) | 0;
        const fy = floor[cur];
        for (let k = 0; k < 4; k++) {
          const jx = ix + (k === 0 ? 1 : k === 1 ? -1 : 0);
          const jz = iz + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          const j = jz * nx + jx;
          if (!free[j] || comp[j] >= 0) continue;
          if (Math.abs(floor[j] - fy) > STEP) continue;
          comp[j] = id; queue[tail++] = j;
        }
      }
    }

    // --------------------------------------------------------- verdict --
    for (const e of exits) {
      e.comp = e.blocked ? -1 : comp[e.cell];
      e.reaches = [];
    }
    for (const e of exits) {
      if (e.blocked) continue;
      for (const f of exits) {
        if (f === e || f.blocked || f.comp !== e.comp) continue;
        if (Math.hypot(f.lx - e.lx, f.lz - e.lz) < MIN_SEP) continue;
        e.reaches.push(`${f.kind[0]}s${f.side}`);
      }
    }

    let cells = 0;
    for (let i = 0; i < n; i++) if (free[i]) cells++;
    /**
     * The occupancy grid as text, for `--map`. A dead end is never obvious from
     * a verdict line — you need to see WHERE the capsule stopped fitting — and
     * dumping it here is the difference between fixing the wall that is actually
     * in the way and guessing at the plan in layout.js.
     * '#' does not fit, and the component letter where it does.
     */
    const rowsTxt = [];
    const hitTxt = [];
    for (let iz = nz - 1; iz >= 0; iz--) {
      let s = '', h = '';
      for (let ix = 0; ix < nx; ix++) {
        const i = iz * nx + ix;
        s += !free[i] ? '#' : comp[i] < 0 ? '.' : String.fromCharCode(97 + (comp[i] % 26));
        // What the capsule stood on, in 0.2 m steps — a '#' cell whose floor is
        // 1.2 m up is a shelf, not a wall, and the two want different fixes.
        h += Number.isNaN(floor[i]) ? ' ' : '0123456789abcdefgh'[Math.min(17, Math.max(0, Math.round(floor[i] / 0.2)))];
      }
      rowsTxt.push(s);
      hitTxt.push(h);
    }
    out.push({
      id: spec.id, w: spec.w, d: spec.d, cells,
      grid: { x0, z0, cell: CELL, nx, nz, rows: rowsTxt, heights: hitTxt },
      exits: exits.map((e) => ({
        kind: e.kind, side: e.side, blocked: e.blocked, comp: e.comp,
        reaches: e.reaches, at: [+e.lx.toFixed(1), +e.lz.toFixed(1)],
        sill: e.sill ?? null,
      })),
    });
  }
  return out;
}, [MIN_SEP, 1.85]);

if (!report) {
  console.log('[throughcheck] world does not expose layout/buildings');
  await browser.close(); process.exit(2);
}

const rows = ONLY ? report.filter((r) => ONLY.includes(r.id)) : report;
console.log('\n  building  exit      at(lvl)          floor cells  reaches (>= ' + MIN_SEP + ' m away)');
let dead = 0, blocked = 0;
for (const b of rows) {
  let first = true;
  for (const e of b.exits) {
    const tag = `${e.kind === 'door' ? 'door' : 'win '} s${e.side}` + (e.sill ? ` @${e.sill}` : '');
    const verdict = e.blocked ? 'UNREACHABLE FROM INSIDE'
      : e.reaches.length ? e.reaches.join(' ')
        : '<-- DEAD END';
    if (e.blocked) blocked++;
    else if (!e.reaches.length) dead++;
    console.log(
      `  ${(first ? b.id : '').padEnd(9)} ${tag.padEnd(9)} ` +
      `[${String(e.at[0]).padStart(6)},${String(e.at[1]).padStart(6)}]  ` +
      `${String(first ? b.cells : '').padStart(11)}  ${verdict}`
    );
    first = false;
  }
  if (!b.exits.length) { console.log(`  ${b.id.padEnd(9)} NO EXITS AT ALL`); dead++; }
}

if (args.map) {
  const want = args.map === true ? rows.map((b) => b.id) : String(args.map).split(',');
  for (const b of rows) {
    if (!want.includes(b.id)) continue;
    const g = b.grid;
    console.log(`\n  ${b.id} ground floor — '#' the capsule does not fit, a letter per connected region`);
    console.log(`  +Z up, +X right, ${g.cell} m per character, origin level [${g.x0.toFixed(2)}, ${g.z0.toFixed(2)}]`);
    // Mark each exit's anchor cell with a digit so it can be found in the grid.
    const marked = g.rows.map((r) => r.split(''));
    b.exits.forEach((e, k) => {
      const ix = Math.round((e.at[0] - g.x0) / g.cell);
      const iz = Math.round((e.at[1] - g.z0) / g.cell);
      const row = g.nz - 1 - Math.max(0, Math.min(g.nz - 1, iz));
      const col = Math.max(0, Math.min(g.nx - 1, ix));
      marked[row][col] = String(k);
      console.log(`    ${k} = ${e.kind} side ${e.side}`);
    });
    for (const r of marked) console.log('    ' + r.join(''));
    if (args.heights) {
      console.log(`  ${b.id} floor height, 0.2 m per step ('0' = ground, ' ' = no floor found)`);
      for (const r of g.heights) console.log('    ' + r);
    }
  }
}

const total = rows.reduce((n, b) => n + b.exits.length, 0);
const ok = rows.filter((b) => b.exits.length && b.exits.every((e) => !e.blocked && e.reaches.length));
console.log(`\n  exits that lead somewhere else: ${total - dead - blocked}/${total}`);
console.log(`  buildings that are through-routes from every exit: ${ok.length}/${rows.length}`);
if (VERBOSE) console.log('\n[throughcheck] raw', JSON.stringify(rows, null, 1));
if (errs.length) console.log('\n[throughcheck] page errors', errs.slice(0, 4));
console.log(
  dead || blocked
    ? `\n[throughcheck] FAIL — ${dead} exit(s) are a dead end, ${blocked} unreachable from inside`
    : `\n[throughcheck] PASS — every exit of all ${rows.length} enterable buildings reaches another way out`
);
await browser.close();
process.exit(dead || blocked || errs.length ? 1 : 0);
