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
  /**
   * `MOVE.mantle.maxHeight`. A ledge between STEP and this is not walked up, it
   * is PULLED up — and a stack of two crates or a container beside a wall is
   * therefore a route, which is how the mid island's roof was always meant to
   * be reached. Modelling only the step height is what made the first run of
   * this tool report K1's roof unreachable when the map has a three-block
   * mantle chain leaning on it.
   */
  const MANTLE_UP = 1.85;
  /**
   * How far the player will step OFF a ledge. `MOVE.land` starts hurting at
   * about 14 m/s, which is a 10 m fall; 6 m (≈ 10.8 m/s) is the height a player
   * will actually take voluntarily, and it is two storeys, so a balcony or a
   * roof parapet counts as a way out and a fourth-floor window does not.
   */
  const DROP_MAX = 6.0;
  /**
   * How far away, HORIZONTALLY, a ledge can be and still be mantled.
   *
   * `MOVE.mantle.reach` is 0.62 measured from the capsule SURFACE, so the face
   * can be 0.62 + 0.32 = 0.94 m from where the player is standing, and
   * `landDepth` puts the spot he ends up on another 0.46 past the lip. Linking
   * only touching cells is therefore wrong and it measured wrong: beside K1's
   * mantle chain the ground cell that touches the container has no standing
   * room at all (the capsule is inside the container), the nearest one that
   * does is 0.56 m away, and the gate called the map's only authored route onto
   * the mid island's roof "UNREACHABLE" — which the map's own comment says it
   * built on purpose. So vertical links get the real reach; walking links stay
   * at one cell, because walking is one cell at a time.
   */
  const MREACH = 1.05;
  const CELL = 0.28;
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

    /**
     * The footprint plus a 4 m skirt. An EXTERIOR route up — a fire escape, a
     * ramp, or the container-and-crate mantle chain leaning on K1 — stands
     * OUTSIDE the building it serves, so a grid clipped to the footprint cannot
     * see it and scores the roof unreachable when it is not. 4 m reaches past
     * the widest authored chain (`RELIEF.blocks`) and no further, because
     * everything in this grid is raycast.
     */
    const PAD = 4.0;
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
          /**
           * A FLOOR FACES UP. The BVH reports backfaces, so a downward ray
           * through a slab returns its UNDERSIDE as well as its top, and the
           * underside passes a standing-room test because the room it tests is
           * the open air above the slab. That is a phantom floor 0.26 m inside
           * every roof on the map. 0.5 is the same 46-degree limit `nav.js`
           * uses for a walkable normal.
           */
          if (hit.normal && hit.normal.y < 0.5) continue;
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

    /**
     * ------------------------------------------------------------- links --
     * Three kinds of edge between adjacent columns, and they are DIRECTED,
     * because getting up and getting down are not the same move:
     *
     *   |dy| <= STEP        walk, both ways
     *   dy <= MANTLE_UP     mantle up, one way up (and step off, coming back)
     *   dy <= DROP_MAX      step off a ledge, one way DOWN only
     *
     * A drop edge is what makes a balcony or a parapet a genuine way out of an
     * upper floor without pretending you can climb back in through it.
     */
    const n = nodeY.length;
    const adjHead = new Int32Array(n).fill(-1);
    const adjNext = []; const adjTo = []; const adjKind = [];
    const link = (a, b, kind) => {
      adjTo.push(b); adjKind.push(kind); adjNext.push(adjHead[a]); adjHead[a] = adjTo.length - 1;
    };
    const RING = Math.ceil(MREACH / CELL);
    /**
     * Nothing solid between the two of them at the height of the higher one.
     * Without this a 1.05 m window would happily mantle a player THROUGH a wall
     * onto whatever stands on the other side of it. One ray, at 0.3 m above the
     * ledge, which is where his chest goes over.
     */
    const clearBetween = (lo, hi) => {
      const lc = nodeCell[lo], hc = nodeCell[hi];
      const ax = x0 + (lc % nx) * CELL, az = z0 + ((lc / nx) | 0) * CELL;
      const bx = x0 + (hc % nx) * CELL, bz = z0 + ((hc / nx) | 0) * CELL;
      w.levelToWorld(ax, 0, az, _a);
      w.levelToWorld(bx, 0, bz, _b);
      const dx = _b.x - _a.x, dz = _b.z - _a.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-4) return true;
      const y = nodeY[hi] + 0.3;
      const r = phys.raycast(_a.x, y, _a.z, dx / d, 0, dz / d, d, MASK);
      return !r.hit;
    };
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const ci = iz * nx + ix;
        if (!cellNodes[ci].length) continue;
        for (let dz = -RING; dz <= RING; dz++) {
          for (let dx = -RING; dx <= RING; dx++) {
            if (dz < 0 || (dz === 0 && dx <= 0)) continue;   // each pair once
            const jx = ix + dx, jz = iz + dz;
            if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
            const step1 = Math.abs(dx) + Math.abs(dz) === 1;
            const far = Math.hypot(dx, dz) * CELL;
            if (!step1 && far > MREACH) continue;
            const cj = jz * nx + jx;
            for (const a of cellNodes[ci]) {
              for (const b of cellNodes[cj]) {
                const dy = nodeY[b] - nodeY[a];
                const ady = Math.abs(dy);
                if (ady <= STEP) {
                  // walking is one cell at a time
                  if (step1) { link(a, b, 0); link(b, a, 0); }
                  continue;
                }
                const [lo, hi] = dy > 0 ? [a, b] : [b, a];   // hi is the higher one
                if (!step1 && !clearBetween(lo, hi)) continue;
                if (ady <= MANTLE_UP) { link(lo, hi, 1); link(hi, lo, 2); continue; }
                if (ady <= DROP_MAX) link(hi, lo, 2);
              }
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
      // `bal.y` is PANEL-LOCAL (0.02) — the floor height is in `pm`. Reading it
      // as a world height put every balcony on the map at y = 0.02 and had this
      // tool crediting the GROUND floor with balconies three storeys up.
      const p = _wp.set(bal.x, bal.y, 0).applyMatrix4(bal.pm);
      openings.push({ kind: 'balcony', side: bal.side, f: null, lx: p.x, lz: p.z, y: p.y });
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

    /**
     * The flood starts where a player starts: OUTSIDE, on the street. Every
     * ground-level surface in the 1-cell border ring of the grid is a seed, plus
     * the cell just inside each ground-floor opening — the ring alone would miss
     * a building whose skirt is walled off, and the door anchors alone would
     * miss an exterior route in (a ramp, a crate chain) that starts on the
     * pavement. `floorY[0] + 2.0` keeps a neighbouring building's ROOF, which
     * can clip the corner of a 4 m skirt, out of the seed set.
     */
    const seeds = [];
    for (const e of openings) {
      if (e.f !== 0) continue;
      const inn = OUT[e.side];
      const k = nearestNode(e.lx - inn[0] * 0.85, e.lz - inn[1] * 0.85, floorY[0], 1.6, 1.2);
      e.node = k;
      if (k >= 0) seeds.push(k);
    }
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        if (ix > 0 && iz > 0 && ix < nx - 1 && iz < nz - 1) continue;
        for (const k of cellNodes[iz * nx + ix]) {
          if (nodeY[k] > floorY[0] + 2.0) continue;
          seeds.push(k);
        }
      }
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

    /** Only cells inside the real footprint are THIS building's floors — the
     *  4 m skirt is the street, and on a tight row it is the neighbour's roof. */
    const inFoot = new Uint8Array(nx * nz);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const lx = x0 + ix * CELL, lz = z0 + iz * CELL;
        if (Math.abs(lx - spec.x) <= spec.w / 2 - 0.2 && Math.abs(lz - spec.z) <= spec.d / 2 - 0.2) {
          inFoot[iz * nx + ix] = 1;
        }
      }
    }
    const onLevel = (k, L) => nodeY[k] >= L.y - 0.35 && nodeY[k] <= L.y + BAND && inFoot[nodeCell[k]];

    for (const L of levels) {
      let free = 0, reach = 0;
      for (let k = 0; k < n; k++) {
        if (!onLevel(k, L)) continue;
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
    const KIND = ['walk', 'mantle', 'drop'];
    for (const L of levels) {
      const clusters = [];
      for (let k = 0; k < n; k++) {
        if (!seen[k] || !onLevel(k, L)) continue;
        for (let e = adjHead[k]; e !== -1; e = adjNext[e]) {
          const j = adjTo[e];
          // leaving this level means leaving its height band OR leaving the
          // footprint at a walkable height — a balcony door is the second one
          const bandOut = nodeY[j] < L.y - 0.35 || nodeY[j] > L.y + BAND;
          const footOut = !inFoot[nodeCell[j]] && Math.abs(nodeY[j] - L.y) < BAND;
          if (!bandOut && !footOut) continue;
          const dir = nodeY[j] > nodeY[k] + 0.1 ? 'up' : nodeY[j] < nodeY[k] - 0.1 ? 'down' : 'out';
          const tag = `${KIND[adjKind[e]]}-${dir}`;
          const cx = nodeCell[k] % nx, cz = (nodeCell[k] / nx) | 0;
          let hit = false;
          for (const cl of clusters) {
            if (cl.tag === tag && Math.hypot(cl.x - cx, cl.z - cz) * CELL < 3.5) { hit = true; break; }
          }
          if (!hit) clusters.push({ tag, x: cx, z: cz });
        }
      }
      /**
       * Two ways out means two SEPARATE PLACES, not two labels. A stair you can
       * both climb and descend is one hole in the floor, and being able to go
       * down it as well as up it does not help you if somebody is standing in
       * it — which is the whole meaning of "屋内に入ったら行き止まりはやめて".
       * So the count is over distinct locations at least 3.5 m apart.
       */
      const spots = [];
      for (const cl of clusters) {
        if (spots.some((s) => Math.hypot(s.x - cl.x, s.z - cl.z) * CELL < 3.5)) continue;
        spots.push(cl);
      }
      L.ways = clusters.map((c) => c.tag);
      L.exits = spots.length;
    }

    out.push({
      id: spec.id, floors: spec.floors ?? 1, roofY: +roofY.toFixed(2),
      nodes: n, levels: levels.map((L) => ({
        name: L.name, y: +L.y.toFixed(2), free: L.free, reach: L.reach,
        ways: L.ways, exits: L.exits,
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
              if (!onLevel(k, L)) continue;
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
        const sb = spec.setback;
        const fs = { w: spec.w, d: spec.d, x: spec.x, z: spec.z };
        if (sb && fl.floor >= sb.from) {
          const side = sb.side ?? spec.streetSide ?? 0;
          if (side === 1) { fs.x = spec.x - sb.depth / 2; fs.w = spec.w - sb.depth; }
          else if (side === 3) { fs.x = spec.x + sb.depth / 2; fs.w = spec.w - sb.depth; }
          else if (side === 0) { fs.z = spec.z + sb.depth / 2; fs.d = spec.d - sb.depth; }
          else { fs.z = spec.z - sb.depth / 2; fs.d = spec.d - sb.depth; }
        }
        const iw = fs.w - t * 2, id = fs.d - t * 2;
        const base = info.floorY[fl.floor] + (fl.floor === 0 ? 0.13 : 0);
        const lx = fs.x - iw / 2 + fl.x * iw, lz = fs.z - id / 2 + fl.z * id;
        const ry = fl.ry ?? 0;
        const ax = Math.sin(ry), az = Math.cos(ry);
        // distance back along the climb axis to the inside face of the wall
        const toWall = ax !== 0
          ? (ax > 0 ? lx - (fs.x - iw / 2) : (fs.x + iw / 2) - lx)
          : (az > 0 ? lz - (fs.z - id / 2) : (fs.z + id / 2) - lz);
        list.push({
          id: spec.id, floor: fl.floor, ry,
          lx, lz, standoff: Math.max(0.35, toWall - 0.45),
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
      /**
       * Stand off the bottom tread, CLAMPED INSIDE the building. A flight is
       * authored hard against a wall, so the naive "1.1 m back along the climb
       * axis" spot is usually in the masonry or out in the street, and the
       * first run of this harness scored five perfectly good flights as
       * unclimbable because the capsule started outside and walked into a
       * facade. `f.standoff` is how far back it can go and still be indoors.
       */
      const back = Math.min(1.1, f.standoff);
      const sW = w.levelToWorld(f.lx - ax * back, f.base + 0.25, f.lz - az * back, new V());
      const tW = w.levelToWorld(f.lx + ax * 3, f.base, f.lz + az * 3, new V());
      /**
       * `respawnAt` snaps the feet to `physics.groundHeight(x, z, y + 6)`,
       * which casts DOWN from six metres up — so asking it for a spot on the
       * first floor lands you on the ROOF. Reset the controller with it, then
       * teleport to the exact height the flight actually starts at.
       */
      pl.respawnAt({ x: sW.x, y: sW.y, z: sW.z });
      pl.movement.teleport(sW.x, sW.y, sW.z);
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
        : L.exits < 2 ? `<-- ONE WAY OUT (${L.ways.join(',') || 'none'})`
          : `${L.exits} ways: ${[...new Set(L.ways)].join(' ')}`;
    if (L.free > 0 && !got) unreached++;
    else if (got && L.exits < 2) culdesac++;
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS OVER YOUR HEAD ON THE STAIRS, WHERE THE STAIRS ARRIVE, AND WHETHER
 * THERE IS ANYTHING THERE WHEN YOU GET THERE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The flood above passed 24/24 levels and 8/8 roofs while the player was
 * reporting "階段も上がれるけど天井が塞がってるように見えます" — you can climb the
 * stairs but the ceiling above looks sealed. Both can be true, and this is the
 * gap: the flood samples ONE COLUMN AT A TIME and links columns that are within
 * a step of each other, so it will happily walk up a flight whose soffit is
 * 1.2 m over the treads — the capsule test it runs is the standing room in the
 * column, and a climber's head is not in the column his feet are in.
 *
 * `stairGeometry` in src/world/buildings.js cuts the void in the slab above a
 * flight at `nextY - slabT - 1.78 - 0.06`, pulled back by a capsule radius, a
 * tread and a hand's breadth, and the ONLY thing that has ever checked that
 * arithmetic is the arithmetic itself. So: walk every authored flight tread by
 * tread with the real BVH, cast up from each tread, and require 1.9 m of air.
 *
 * Then the other half of the complaint, which is the same complaint: a stair
 * that arrives at a slab. Every flight's top landing is tested for standing
 * room, for head clearance, for a walkable floor CONTINUING past it, and for
 * something worth arriving at — the nearest published `world.features` cache.
 * A flight whose top has no authored content is a flight nobody has a reason to
 * climb, which is the whole of "屋上だったり３階のエリアなどにもメリットを与えて".
 *
 * The four rooftop gangways in `world.links` get the same treatment: the deck is
 * walked end to end and every sample must be standable, or the link is a hole.
 */
const extra = await page.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), phys = c.peek('physics');
  const V = c.camera.position.constructor;
  const MASK = phys.MASK.CHARACTER;
  const R = 0.32, H = 1.78, STEP = 0.42;
  /** A climbing man needs his own height plus a little. */
  const HEAD = 1.9;
  const _a = new V(), _b = new V(), _p = new V(), _q = new V();

  const world = (lx, ly, lz) => w.levelToWorld(lx, ly, lz, _p);
  /** Standing room with the real capsule, feet at (lx, ly, lz) in LEVEL space. */
  const stands = (lx, ly, lz, up = 0) => {
    world(lx, ly, lz);
    _a.set(_p.x, _p.y + up + R, _p.z);
    _b.set(_p.x, _p.y + H - R + 0.02, _p.z);
    return phys.checkCapsule(_a, _b, R - 0.02, MASK);
  };
  /** Metres of air over a point; Infinity when nothing is above it at all. */
  const headroom = (lx, ly, lz) => {
    world(lx, ly, lz);
    const hit = phys.raycast(_p.x, _p.y + 0.12, _p.z, 0, 1, 0, 6, MASK);
    return hit.hit ? hit.distance + 0.12 : Infinity;
  };
  /** The floor under a point, searching down from `from`. */
  const floorAt = (lx, ly, lz, from = 1.2) => {
    world(lx, ly, lz);
    const hit = phys.raycast(_p.x, _p.y + from, _p.z, 0, -1, 0, from + 1.6, MASK);
    return hit.hit && hit.normal.y > 0.5 ? hit.point.y : null;
  };

  const features = (w.features ?? []).map((f) => ({ id: f.id, kind: f.kind, ...f.level }));
  const nearestFeature = (lx, ly, lz) => {
    let best = null, bd = Infinity;
    for (const f of features) {
      const d = Math.hypot(f.x - lx, (f.y - ly) * 1.5, f.z - lz);
      if (d < bd) { bd = d; best = f; }
    }
    return { d: bd, f: best };
  };

  // ------------------------------------------------------------- flights --
  const flights = [];
  for (const info of w.buildings ?? []) {
    const spec = info.spec;
    if (!spec.enterable) continue;
    for (const g of info.stairs ?? []) {
      const ax = Math.sin(g.ry), az = Math.cos(g.ry);
      let minHead = Infinity, minAt = 0, blocked = 0;
      for (let i = 0; i < g.steps; i++) {
        const along = (i + 0.5) * g.run;
        const lx = g.ox + ax * along, lz = g.oz + az * along;
        const ly = g.base + (i + 1) * g.rise;
        const hr = headroom(lx, ly, lz);
        if (hr < minHead) { minHead = hr; minAt = i; }
        if (!stands(lx, ly, lz, STEP)) blocked++;
      }
      // the landing at the top, and the floor it is supposed to deliver you to
      const fwd = g.D + g.landing / 2 + 0.1;
      const lx = g.ox + ax * fwd, lz = g.oz + az * fwd;
      const topY = g.top;
      const landHead = headroom(lx, topY, lz);
      const landStand = stands(lx, topY, lz, 0.1);
      let onward = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const px = lx + dx * 1.3, pz = lz + dz * 1.3;
        const fy = floorAt(px, topY + 0.5, pz, 0.9);
        if (fy === null) continue;
        const wy = world(lx, topY, lz).y;
        if (Math.abs(fy - wy) <= STEP && stands(px, topY + (fy - wy), pz, 0.05)) onward++;
      }
      /**
       * IS THERE DAYLIGHT AT THE TOP? The player's words were "階段も上がれるけど
       * 天井が塞がっているように見えます" — the treads all measure 2.6 m of clearance,
       * so what he was looking at was the stairhead's own lid closing the top of
       * the shaft. A flight that arrives on the roof has to show sky.
       */
      const up = phys.raycast(world(lx, topY + 0.5, lz).x, _p.y, _p.z, 0, 1, 0, 14, MASK);
      const sky = !up.hit;
      const nf = nearestFeature(lx, topY, lz);
      /**
       * A REASON TO CLIMB IT, asked of the LEVEL and not of a radius. The first
       * cut of this used "a cache within 12 m of the landing" and failed W1's
       * flights at 12.8 m — W1 is 21 m across, so the cache on the floor the
       * stair arrives at is the length of the building away and that is fine.
       * What matters is that the storey you come out on has something in it.
       */
      const arriveFloor = g.floor + 1 >= (spec.floors ?? 1) ? 'roof' : g.floor + 1;
      const onLevel = (w.features ?? []).find((f) => f.building === spec.id && String(f.floor) === String(arriveFloor));
      flights.push({
        id: spec.id, floor: g.floor, steps: g.steps, arrive: String(arriveFloor),
        levelCache: onLevel?.id ?? null,
        base: +g.base.toFixed(2), top: +topY.toFixed(2),
        minHead: minHead === Infinity ? 99 : +minHead.toFixed(2), minAt, blocked,
        landHead: landHead === Infinity ? 99 : +landHead.toFixed(2), landStand, onward, sky,
        feature: nf.f?.id ?? null, featureD: +nf.d.toFixed(1),
      });
    }
  }

  // --------------------------------------------------------------- links --
  const links = [];
  for (const l of w.links ?? []) {
    const len = Math.hypot(l.z1 - l.z0, l.y1 - l.y0);
    const n = Math.max(4, Math.round(len / 0.35));
    let ok = 0, worstGap = 0, run = 0;
    const bad = [];
    /**
     * INSET both ends by 0.6 m of span. The last 0.9 m at each end is laid OVER
     * the building's own parapet and its boarding steps — the deck's end face,
     * the top step and the roof are all within a few centimetres of each other
     * there, and sampling the corner of the end face measured a hole in a deck
     * that is continuous. The ends are proven by the roof flood above; what this
     * walk is for is the part with nothing under it.
     */
    const INSET = 0.6 / Math.max(1, len);
    for (let i = 0; i <= n; i++) {
      const f = INSET + (i / n) * (1 - INSET * 2);
      const lz = l.z0 + (l.z1 - l.z0) * f;
      const ly = l.y0 + (l.y1 - l.y0) * f;
      const fy = floorAt(l.x, ly + 0.6, lz, 0.9);
      const wy = world(l.x, ly, lz).y;
      const good = fy !== null && Math.abs(fy - wy) < 0.5 && stands(l.x, ly + (fy - wy) + 0.02, lz);
      if (good) { ok++; run = 0; } else {
        run++; if (run * (len / n) > worstGap) worstGap = run * (len / n);
        bad.push({ i, f: +f.toFixed(2), lz: +lz.toFixed(2), want: +ly.toFixed(2), got: fy === null ? null : +(fy - world(l.x, 0, lz).y + 0).toFixed(2) });
      }
    }
    const nf = nearestFeature(l.x, l.y1, l.z1);
    links.push({
      id: l.id, span: l.span, fall: l.fall, samples: n + 1, ok,
      worstGap: +worstGap.toFixed(2), bad: bad.slice(0, 6), feature: nf.f?.id ?? null, featureD: +nf.d.toFixed(1),
    });
  }

  // ------------------------------------------------------------ features --
  const feats = [];
  for (const f of w.features ?? []) {
    /**
     * Room to stand AT it, on a ring at arm's length, and the head clearance
     * measured THERE. Measuring it over the cache itself measures the crate: the
     * first run of this reported 0.47 m of headroom over a grenade box, which is
     * the height of the grenade box.
     */
    /**
     * The ring is 1.25 m for a dump and 1.9 m for a VANTAGE, because a vantage's
     * own sandbags stand at 1.05 and 1.2 m: measured at 1.25 m the nest scored
     * 1-3 of 8 and the tool was reporting the cover as an obstruction. A firing
     * position is used from the middle, so that is tested too.
     */
    const ring = f.kind === 'vantage' ? 1.9 : 1.25;
    let around = 0, head = 0;
    if (f.kind === 'vantage' && stands(f.level.x, f.level.y, f.level.z, STEP)) {
      around++;
      head = Math.max(head, headroom(f.level.x, f.level.y, f.level.z));
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const px = f.level.x + Math.cos(a) * ring, pz = f.level.z + Math.sin(a) * ring;
      if (!stands(px, f.level.y, pz, STEP)) continue;
      around++;
      const hr = headroom(px, f.level.y, pz);
      if (hr > head) head = hr;
    }
    feats.push({
      id: f.id, kind: f.kind, floor: String(f.floor), indoor: f.indoor,
      bot: f.botReachable, around, head: head === Infinity ? 99 : +head.toFixed(2),
    });
  }
  return { flights, links, feats };
});

console.log('\n  EVERY FLIGHT — head clearance over the treads, and what is at the top');
console.log('  building  flight  treads  min head   at   blocked   landing head/stand/ways  sky  arrives  cache on that level');
let stairFail = 0;
for (const f of extra.flights) {
  const bad = f.minHead < 1.9 || f.blocked > 0 || !f.landStand || f.landHead < 1.9 || f.onward < 1
    || !f.levelCache || (f.arrive === 'roof' && !f.sky);
  if (bad) stairFail++;
  console.log(
    `  ${f.id.padEnd(9)} f${f.floor}      ${String(f.steps).padStart(6)}  ${String(f.minHead).padStart(8)}  ` +
    `${String(f.minAt).padStart(3)}  ${String(f.blocked).padStart(7)}   ` +
    `${String(f.landHead).padStart(5)} / ${f.landStand ? 'yes' : 'NO '} / ${f.onward}   ` +
    `${(f.sky ? 'yes' : ' - ').padEnd(4)} ${f.arrive.padEnd(6)}   ${(f.levelCache ?? '-').padEnd(20)} (nearest ${f.featureD} m)` +
    (bad ? '   <-- ' + [
      f.minHead < 1.9 ? `SEALED CEILING over tread ${f.minAt}` : null,
      f.blocked ? `NO ROOM ON ${f.blocked} TREAD(S)` : null,
      !f.landStand ? 'LANDING BLOCKED' : null,
      f.landHead < 1.9 ? 'LANDING CEILING' : null,
      f.onward < 1 ? 'ARRIVES AT NOTHING' : null,
      !f.levelCache ? 'NOTHING ON THE LEVEL IT ARRIVES AT' : null,
      f.arrive === 'roof' && !f.sky ? 'NO DAYLIGHT AT THE TOP — it reads as sealed' : null,
    ].filter(Boolean).join(', ') : '')
  );
}

console.log('\n  BUILDING TO BUILDING — the real capsule walked across every published link');
console.log('  link       span   fall   standable samples   worst gap   nearest cache');
let linkFail = 0;
for (const l of extra.links) {
  const bad = l.ok < l.samples || l.worstGap > 0;
  if (bad) linkFail++;
  console.log(
    `  ${l.id.padEnd(10)} ${String(l.span).padStart(5)}  ${String(l.fall).padStart(5)}   ` +
    `${String(l.ok).padStart(9)}/${String(l.samples).padEnd(6)}   ${String(l.worstGap).padStart(9)}   ` +
    `${(l.feature ?? '-').padEnd(20)} ${String(l.featureD).padStart(5)} m` +
    (bad ? '   <-- A HOLE IN THE DECK ' + JSON.stringify(l.bad) : '')
  );
}
if (!extra.links.length) console.log('        (world publishes no links)');

console.log('\n  THE CACHES — is there room to stand at one, and can a bot reach it');
console.log('  cache                     kind      floor   indoor  bot   standable ring   head');
let featFail = 0;
for (const f of extra.feats) {
  const bad = f.around < 3 || f.head < 1.9;
  if (bad) featFail++;
  console.log(
    `  ${f.id.padEnd(25)} ${f.kind.padEnd(9)} ${f.floor.padEnd(6)}  ${(f.indoor ? 'yes' : 'no').padEnd(6)}  ` +
    `${(f.bot ? 'yes' : '-').padEnd(4)}  ${String(f.around).padStart(9)}/8      ${String(f.head).padStart(5)}` +
    (bad ? '   <-- ' + (f.around < 3 ? 'BURIED' : 'NO HEADROOM') : '')
  );
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
console.log(`  flights with head clearance, a landing and a reason: ${extra.flights.length - stairFail}/${extra.flights.length}`);
console.log(`  building-to-building links you can walk across:      ${extra.links.length - linkFail}/${extra.links.length}`);
console.log(`  caches with room to stand at them:                   ${extra.feats.length - featFail}/${extra.feats.length}`);
const fails = unreached || culdesac || climbFail || stairFail || linkFail || featFail;
console.log(
  fails
    ? `\n[floorcheck] FAIL — ${unreached} level(s) unreachable, ${culdesac} cul-de-sac(s), ${climbFail} flight(s) not climbable, ` +
      `${stairFail} flight(s) sealed/pointless, ${linkFail} broken link(s), ${featFail} buried cache(s)`
    : `\n[floorcheck] PASS — every standable level of all ${rows.length} enterable buildings is reachable and has two ways out; ` +
      `every flight has 1.9 m over its treads and something at the top; every link walks`
);
await browser.close();
process.exit(fails || errs.length ? 1 : 0);
