/**
 * VERTICAL GATE — can the PLAYER actually get upstairs, and onto the roof?
 *
 *   node tools/floorcheck.mjs [--url=…] [--only=W1,E1] [--map=W1] [--verbose]
 *
 * WHY IT EXISTS. `throughcheck` proved every interior is a through-route and
 * passed 8/8 while the player was still reporting "２回構造は？？上がれないけど"
 * — the second floors exist and you cannot get up to them. The two do not
 * disagree because either is wrong: `throughcheck` is a SINGLE-VALUED height
 * field over the ground floor. It drops one ray from y = 1.75 per cell and
 * keeps the first thing it hits, so a stair is invisible to it (the ray lands on
 * a tread, not the floor), an upper storey is invisible to it (the ray starts
 * below the slab), and a room that is a cul-de-sac ON FLOOR 1 cannot be
 * expressed in its grid at all. It measures a floor plan. The player lives in a
 * building.
 *
 * WHAT THIS PROVES. For every enterable building, EVERY horizontal surface the
 * player could stand on inside the footprint is found — not one per (x, z) but
 * ALL of them, by casting down the column repeatedly and stepping the origin
 * past each hit. Each surface is then tested for standing room with the REAL
 * player capsule (r = 0.32, h = 1.78, from `STANCE.stand.stepHeight` = 0.42 up,
 * exactly as `throughcheck` does and for the same measured reason) against the
 * REAL physics BVH under `MASK.CHARACTER`. The surfaces are linked 4-ways when
 * they are within one step height of each other, which is precisely what the
 * character controller can walk, and a stair — nineteen 0.19 m treads at 0.275 m
 * run — links itself into that graph without being special-cased.
 *
 * The flood is then seeded ONLY from just inside the ground-floor exits, i.e.
 * from where a player actually arrives. A floor is REACHED when the flood gets
 * to it. That is the player's own question, asked in the player's own terms.
 *
 * NOT PROVED: the controller's step/slide behaviour on the treads themselves.
 * `--climb` adds that — it drives the real player controller up each authored
 * flight with W held and reports the height gained — and it is the same
 * stimulus `indoorcheck` uses at the thresholds.
 *
 * NO DEAD ENDS, UPSTAIRS TOO. Every reached level is also scored for WAYS OUT:
 * a stair link to another level, a reachable exterior door, an open window or
 * balcony on that level a player can vault (sill under `MOVE.mantle.maxHeight`
 * = 1.85 above the floor he is standing on), or the roof. One way out is a
 * cul-de-sac — you can be cornered on it — so a level needs two.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const URL = args.url ?? 'http://127.0.0.1:4173/';
const ONLY = typeof args.only === 'string' ? args.only.split(',') : null;
const VERBOSE = !!args.verbose;
const CLIMB = !!args.climb;

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

const step = (n) => page.evaluate((n) => new Promise((r) => {
  let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

const quiesce = () => page.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const m = c.peek('match'), ai = c.peek('ai'), pl = c.peek('player');
  if (m && !m.__floorcheckStopped) { m.update = () => {}; m.__floorcheckStopped = true; }
  if (m) { m.timer = Infinity; m.roundClock = Infinity; }
  if (ai) { ai.combatEnabled = false; try { ai.clearAgents(); } catch { /* ok */ } }
  if (pl) {
    pl.movementLocked = false; pl.setControlEnabled?.(true); pl.alive = true;
    if (pl.movement) { pl.movement.movementLocked = false; pl.movement.sprinting = false; }
  }
  c.peek('ui')?.banner?.hide?.();
});

await quiesce();
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await step(70);
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });
await quiesce();

const report = await page.evaluate((MANTLE) => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), phys = c.peek('physics');
  const B = w.layout?.BUILDINGS;
  if (!B || !w.buildings) return null;
  const V = c.camera.position.constructor;
  const MASK = phys.MASK.CHARACTER;

  const R = 0.32;      // UNITS.playerRadius
  const H = 1.78;      // UNITS.playerHeight
  const STEP = 0.42;   // STANCE.stand.stepHeight
  const CELL = 0.22;
  const MAXSURF = 10;  // surfaces per column; a 4-storey block has ~6
  const _a = new V(), _b = new V(), _wp = new V();

  const out = [];
  for (let bi = 0; bi < B.length; bi++) {
    const spec = B[bi];
    if (!spec.enterable) continue;
    const info = w.buildings[bi];
    if (!info) continue;

    const roofY = info.roofY;
    const floorY = info.floorY.slice();
    const top = roofY + 4.5;

    // The footprint, plus a 1 m skirt so an EXTERIOR stair or a fire escape
    // hung off the wall is inside the grid and can be found by the same flood.
    const PAD = 1.0;
    const x0 = spec.x - spec.w / 2 - PAD, z0 = spec.z - spec.d / 2 - PAD;
    const nx = Math.floor((spec.w + PAD * 2) / CELL) + 1;
    const nz = Math.floor((spec.d + PAD * 2) / CELL) + 1;

    // ---------------------------------------------------- surface columns --
    /** For cell i, `sy[i]` is a sorted (descending) list of standable heights. */
    const sy = new Array(nx * nz);
    const nodeY = []; const nodeCell = [];
    const cellNodes = new Array(nx * nz);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const ci = iz * nx + ix;
        const lx = x0 + ix * CELL, lz = z0 + iz * CELL;
        w.levelToWorld(lx, 0, lz, _wp);
        const ys = []; const list = [];
        let from = top;
        for (let s = 0; s < MAXSURF; s++) {
          const hit = phys.raycast(_wp.x, from, _wp.z, 0, -1, 0, from + 1.0, MASK);
          if (!hit.hit) break;
          const fy = hit.point.y;
          if (fy < -0.6) break;
          from = fy - 0.06;
          // Standing room, from step height up — the controller steps over
          // anything below 0.42 rather than colliding with it.
          _a.set(_wp.x, fy + STEP + R, _wp.z);
          _b.set(_wp.x, fy + H - R + 0.02, _wp.z);
          if (!phys.checkCapsule(_a, _b, R - 0.005, MASK)) continue;
          ys.push(fy);
          list.push(nodeY.length);
          nodeY.push(fy); nodeCell.push(ci);
          if (from < -0.6) break;
        }
        sy[ci] = ys; cellNodes[ci] = list;
      }
    }

    // ------------------------------------------------------------- links --
    const n = nodeY.length;
    const adjHead = new Int32Array(n).fill(-1);
    const adjNext = []; const adjTo = [];
    const link = (a, b) => {
      adjTo.push(b); adjNext.push(adjHead[a]); adjHead[a] = adjTo.length - 1;
    };
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const ci = iz * nx + ix;
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          const jx = ix + dx, jz = iz + dz;
          if (jx >= nx || jz >= nz) continue;
          const cj = jz * nx + jx;
          for (const a of cellNodes[ci]) {
            for (const b of cellNodes[cj]) {
              if (Math.abs(nodeY[a] - nodeY[b]) > STEP) continue;
              link(a, b); link(b, a);
            }
          }
        }
      }
    }

    // -------------------------------------------------- exits and seeding --
    const OUT = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const openings = [];
    for (const d of info.doors) {
      openings.push({ kind: 'door', side: d.side, f: 0, lx: d.wp[0], lz: d.wp[2], y: d.wp[1] ?? 0 });
    }
    for (const win of info.windows ?? []) {
      if (win.state !== 'open') continue;
      const base = floorY[win.f] ?? 0;
      const sill = win.y - win.h / 2;             // above that floor's datum
      if (sill > MANTLE || sill < 0.3) continue;
      const len = win.side === 0 || win.side === 2 ? spec.w : spec.d;
      const bays = Math.max(1, Math.round(len / 3.05));
      const bay = Math.round((win.x + len / 2) / (len / bays) - 0.5);
      if (!spec.bayKinds?.[win.side]?.[win.f]?.[bay]) continue;
      const p = _wp.set(win.x, 0, 0).applyMatrix4(win.pm);
      openings.push({ kind: 'window', side: win.side, f: win.f, lx: p.x, lz: p.z, y: base, sill: +sill.toFixed(2) });
    }
    for (const bal of info.balconies ?? []) {
      const p = _wp.set(bal.x, 0, 0).applyMatrix4(bal.pm);
      openings.push({ kind: 'balcony', side: bal.side, f: null, lx: p.x, lz: p.z, y: bal.y });
    }

    /** The node nearest (lx, lz, wantY) that has standing room. */
    const nearestNode = (lx, lz, wantY, maxR, dy) => {
      const cx = Math.round((lx - x0) / CELL), cz = Math.round((lz - z0) / CELL);
      const rings = Math.ceil(maxR / CELL);
      let best = -1, bestD = Infinity;
      for (let r = 0; r <= rings; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const ix = cx + dx, iz = cz + dz;
            if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
            for (const k of cellNodes[iz * nx + ix]) {
              if (Math.abs(nodeY[k] - wantY) > dy) continue;
              const d = dx * dx + dz * dz;
              if (d < bestD) { bestD = d; best = k; }
            }
          }
        }
        if (best >= 0) break;
      }
      return best;
    };

    const seeds = [];
    for (const e of openings) {
      if (e.f !== 0) continue;
      const inn = OUT[e.side];
      const k = nearestNode(e.lx - inn[0] * 0.85, e.lz - inn[1] * 0.85, floorY[0], 1.6, 1.2);
      e.node = k;
      if (k >= 0) seeds.push(k);
    }

    // ---------------------------------------------------------- the flood --
    const seen = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0, tail = 0;
    for (const s of seeds) if (!seen[s]) { seen[s] = 1; queue[tail++] = s; }
    while (head < tail) {
      const cur = queue[head++];
      for (let e = adjHead[cur]; e !== -1; e = adjNext[e]) {
        const j = adjTo[e];
        if (seen[j]) continue;
        seen[j] = 1; queue[tail++] = j;
      }
    }

    // --------------------------------------------------------- per level --
    /** Levels: every floor slab, plus the roof. `band` is how far above the
     *  datum a surface still counts as "standing on this level" — a stair tread
     *  1.4 m up is not the first floor, and 0.75 m clears furniture and the
     *  0.13 m ground step without reaching the next slab (2.9 m away). */
    const BAND = 0.75;
    const levels = [];
    for (let f = 0; f < floorY.length; f++) levels.push({ name: `F${f}`, y: floorY[f], f });
    levels.push({ name: 'roof', y: roofY, f: floorY.length });

    for (const L of levels) {
      let free = 0, reach = 0;
      for (let k = 0; k < n; k++) {
        if (nodeY[k] < L.y - 0.35 || nodeY[k] > L.y + BAND) continue;
        free++; if (seen[k]) reach++;
      }
      L.free = free; L.reach = reach;
    }

    // ------------------------------------------------------- ways out --
    /**
     * A level's ways out. A stair is counted once per level pair per LOCATION:
     * every reached node that touches a node more than 1.2 m higher or lower in
     * the vertical is a rung of the same flight, so they are clustered by XY at
     * 3 m before counting.
     */
    for (const L of levels) {
      const ways = [];
      // vertical links out of this level
      const clusters = [];
      for (let k = 0; k < n; k++) {
        if (!seen[k]) continue;
        if (nodeY[k] < L.y - 0.35 || nodeY[k] > L.y + BAND) continue;
        for (let e = adjHead[k]; e !== -1; e = adjNext[e]) {
          const j = adjTo[e];
          const inLevel = nodeY[j] >= L.y - 0.35 && nodeY[j] <= L.y + BAND;
          if (inLevel) continue;
          const dir = nodeY[j] > nodeY[k] ? 'up' : 'down';
          const cx = nodeCell[k] % nx, cz = (nodeCell[k] / nx) | 0;
          let hit = false;
          for (const cl of clusters) {
            if (cl.dir === dir && Math.hypot(cl.x - cx, cl.z - cz) * CELL < 3.0) { hit = true; break; }
          }
          if (!hit) clusters.push({ dir, x: cx, z: cz });
        }
      }
      for (const cl of clusters) ways.push(`stair-${cl.dir}`);
      // openings a player standing on this level can use
      for (const e of openings) {
        const inn = OUT[e.side] ?? [0, 0];
        const k = nearestNode(e.lx - inn[0] * 0.85, e.lz - inn[1] * 0.85, L.y, 1.8, 1.0);
        if (k < 0 || !seen[k]) continue;
        if (e.kind === 'door' && Math.abs(L.y - floorY[0]) > 0.5) continue;
        if (e.kind === 'window' && (floorY[e.f] === undefined || Math.abs(floorY[e.f] - L.y) > 0.6)) continue;
        if (e.kind === 'balcony' && Math.abs(e.y - L.y) > 1.4) continue;
        ways.push(`${e.kind}-s${e.side}`);
      }
      L.ways = ways;
    }

    out.push({
      id: spec.id, floors: spec.floors ?? 1, roofY: +roofY.toFixed(2),
      nodes: n, levels: levels.map((L) => ({
        name: L.name, y: +L.y.toFixed(2), free: L.free, reach: L.reach, ways: L.ways,
      })),
      openings: openings.map((e) => ({ kind: e.kind, side: e.side, f: e.f, sill: e.sill ?? null })),
      grid: { x0, z0, cell: CELL, nx, nz },
      // The dump for --map: for each level, '#' no standing room, '.' standing
      // room the flood never reached, 'o' reached.
      maps: levels.map((L) => {
        const rows = [];
        for (let iz = nz - 1; iz >= 0; iz--) {
          let s = '';
          for (let ix = 0; ix < nx; ix++) {
            const ci = iz * nx + ix;
            let ch = '#';
            for (const k of cellNodes[ci]) {
              if (nodeY[k] < L.y - 0.35 || nodeY[k] > L.y + BAND) continue;
              ch = seen[k] ? 'o' : '.'; if (ch === 'o') break;
            }
            s += ch;
          }
          rows.push(s);
        }
        return { name: L.name, rows };
      }),
    });
  }
  return out;
}, 1.85);

if (!report) {
  console.log('[floorcheck] world does not expose layout/buildings');
  await browser.close(); process.exit(2);
}

const rows = ONLY ? report.filter((r) => ONLY.includes(r.id)) : report;

// ------------------------------------------------------- optional real climb --
let climbs = null;
if (CLIMB) {
  climbs = [];
  const flights = await page.evaluate(() => {
    const c = window.__ENGINE__.ctx, w = c.peek('world');
    const B = w.layout.BUILDINGS; const list = [];
    for (let i = 0; i < B.length; i++) {
      const spec = B[i]; const info = w.buildings[i];
      if (!spec.enterable || !info || !spec.stairFlights) continue;
      const t = spec.t ?? 0.34;
      for (const fl of spec.stairFlights) {
        const fs = { w: spec.w, d: spec.d, x: spec.x, z: spec.z };
        const iw = fs.w - t * 2, id = fs.d - t * 2;
        const base = info.floorY[fl.floor] + (fl.floor === 0 ? 0.13 : 0);
        list.push({
          id: spec.id, floor: fl.floor, ry: fl.ry ?? 0,
          lx: fs.x - iw / 2 + fl.x * iw, lz: fs.z - id / 2 + fl.z * id,
          base, want: (info.floorY[fl.floor + 1] ?? info.roofY),
        });
      }
    }
    return list;
  });
  for (const f of flights) {
    await quiesce();
    await page.evaluate((f) => {
      const c = window.__ENGINE__.ctx, pl = c.peek('player'), w = c.peek('world');
      const V = c.camera.position.constructor;
      // Stand 1.1 m in front of the bottom tread, on the flight's own axis.
      const ax = Math.sin(f.ry), az = Math.cos(f.ry); // the +Z climb direction
      const sW = w.levelToWorld(f.lx - ax * 1.1, f.base + 0.3, f.lz - az * 1.1, new V());
      const tW = w.levelToWorld(f.lx + ax * 3, f.base, f.lz + az * 3, new V());
      pl.respawnAt({ x: sW.x, y: sW.y, z: sW.z });
      const yaw = Math.atan2(-(tW.x - sW.x), -(tW.z - sW.z));
      pl.movement.yaw = yaw; pl.yaw = yaw;
    }, f);
    await step(6);
    await page.keyboard.down('KeyW');
    await step(3);
    if (!(await page.evaluate(() => window.__ENGINE__.ctx.input.down.has('KeyW')))) {
      await page.keyboard.up('KeyW'); await step(6); await page.keyboard.down('KeyW'); await step(3);
    }
    const r = await page.evaluate(() => new Promise((done) => {
      const c = window.__ENGINE__.ctx, pl = c.peek('player');
      const t0 = c.time.elapsed; let topY = -Infinity, held = 0, frames = 0;
      const tick = () => {
        const q = pl.position ?? c.camera.position;
        if (q.y > topY) topY = q.y;
        frames++; if (c.input.down.has('KeyW')) held++;
        if (c.time.elapsed - t0 >= 5.0) return done({ topY, held, frames, endY: q.y });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    await page.keyboard.up('KeyW');
    climbs.push({ ...f, ...r, gained: r.topY - f.base, need: f.want - f.base });
  }
}

// ------------------------------------------------------------------ report --
console.log('\n  building  level   y      standable  reached   ways out');
let unreached = 0, culdesac = 0, roofless = 0;
for (const b of rows) {
  let first = true;
  let anyRoof = false;
  for (const L of b.levels) {
    const isRoof = L.name === 'roof';
    const got = L.reach > 0;
    if (isRoof && got) anyRoof = true;
    const verdict = L.free === 0 ? 'no standing room'
      : !got ? '<-- UNREACHABLE'
        : L.ways.length < 2 ? `<-- ONE WAY OUT (${L.ways.join(',') || 'none'})`
          : L.ways.join(' ');
    if (L.free > 0 && !got) unreached++;
    else if (got && L.ways.length < 2) culdesac++;
    console.log(
      `  ${(first ? b.id : '').padEnd(9)} ${L.name.padEnd(6)} ${String(L.y).padStart(5)}  ` +
      `${String(L.free).padStart(9)}  ${String(L.reach).padStart(7)}   ${verdict}`
    );
    first = false;
  }
  if (!anyRoof) roofless++;
}

if (climbs) {
  console.log('\n  DRIVEN CLIMB — the real controller, W held for 5 s at the foot of each flight');
  console.log('  building  flight  base    needed   gained   verdict');
  for (const c of climbs) {
    const ok = c.gained > c.need - 0.35;
    console.log(
      `  ${c.id.padEnd(9)} f${c.floor}      ${c.base.toFixed(2).padStart(5)}   ` +
      `${c.need.toFixed(2).padStart(6)}   ${c.gained.toFixed(2).padStart(6)}   ` +
      `${ok ? 'CLIMBED' : '<-- DID NOT GET UP'}${c.held < c.frames * 0.9 ? ' (INVALID: W not held)' : ''}`
    );
  }
}

if (args.map) {
  const want = args.map === true ? rows.map((b) => b.id) : String(args.map).split(',');
  for (const b of rows) {
    if (!want.includes(b.id)) continue;
    for (const m of b.maps) {
      console.log(`\n  ${b.id} ${m.name} — '#' no standing room, '.' standable but never reached, 'o' reached`);
      for (const r of m.rows) console.log('    ' + r);
    }
  }
}

const lv = rows.flatMap((b) => b.levels.filter((L) => L.free > 0));
const got = lv.filter((L) => L.reach > 0);
const roofs = rows.flatMap((b) => b.levels.filter((L) => L.name === 'roof' && L.free > 0));
const roofsGot = roofs.filter((L) => L.reach > 0);
console.log(`\n  levels the player can reach: ${got.length}/${lv.length}`);
console.log(`  roofs the player can reach:  ${roofsGot.length}/${roofs.length}`);
console.log(`  levels with two ways out:    ${got.length - culdesac}/${got.length}`);
if (VERBOSE) console.log('\n[floorcheck] raw', JSON.stringify(rows, null, 1));
if (errs.length) console.log('\n[floorcheck] page errors', errs.slice(0, 4));
const climbFail = climbs ? climbs.filter((c) => c.gained <= c.need - 0.35).length : 0;
console.log(
  unreached || culdesac || climbFail
    ? `\n[floorcheck] FAIL — ${unreached} level(s) unreachable, ${culdesac} cul-de-sac(s), ${climbFail} flight(s) not climbable`
    : `\n[floorcheck] PASS — every standable level of all ${rows.length} enterable buildings is reachable and has two ways out`
);
await browser.close();
process.exit(unreached || culdesac || climbFail || errs.length ? 1 : 0);
