/**
 * ════════════════════════════════════════════════════════════════════════════
 * IF YOU ARE IN THE TOWER WHEN IT FALLS, CAN YOU WALK OUT? —
 * 「管制塔の中にいるときに爆撃されると出れなくなる」
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   BASE=http://127.0.0.1:4626/ node _tztrap.mjs
 *
 * Brings NF-TOWER down for real — `rec.setDown(true)` is the one call the act's
 * `raze` beat makes — and then FLOODS THE REAL COLLISION SURFACE from where the
 * man is standing.
 *
 * A flood rather than 24 marched bearings, and the difference is the whole
 * point: the control room has four piers, twelve equipment racks, a plotting
 * table and twenty-two crates in it, so a straight line out of the middle of it
 * hits furniture on almost every bearing and reports a trap that is not there.
 * A man walks round a crate. The flood is over a 0.4 m lattice; a neighbour is
 * reachable when the floor under it is within `maxStep` 0.45 of the floor he is
 * on and a TORSO capsule (from `maxStep` up, because a grounded move lifts by
 * exactly that) is clear there.
 *
 * THE ANSWER IS ONE NUMBER: does the flood reach the plain — a cell whose floor
 * is within half a metre of `world.groundHeight` — and how far out does it get.
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4626/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${BASE}?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const ph = e.ctx.peek('physics');
  const rec = (w.demolitions ?? []).find((r) => r.id === 'NF-TOWER');
  if (!rec) return { error: 'no NF-TOWER record' };
  const T = { x: rec.position.x, z: rec.position.z };
  const CELL = 0.4, R = 0.34, HEAD = 1.7, STEP = 0.45, REACH = 44;
  const MASK = ph.MASK.CHARACTER;
  const plain = w.groundHeight(T.x, T.z);

  const free = (x, y, z) =>
    ph.checkCapsule({ x, y: y + STEP + R, z }, { x, y: y + HEAD - R, z }, R, MASK);

  /** Flood from (x0,z0) standing on `y0`. Returns what it could reach. */
  const flood = (x0, z0, y0) => {
    const seen = new Map();
    const key = (ix, iz) => ix * 4096 + iz;
    const ix0 = Math.round((x0 - T.x) / CELL), iz0 = Math.round((z0 - T.z) / CELL);
    const q = [[ix0, iz0, y0]];
    seen.set(key(ix0, iz0), y0);
    let far = 0, onPlain = 0, minY = y0, maxY = y0;
    const lim = Math.ceil(REACH / CELL);
    while (q.length) {
      const [ix, iz, y] = q.pop();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const jx = ix + dx, jz = iz + dz;
        if (Math.abs(jx) > lim || Math.abs(jz) > lim) continue;
        const k = key(jx, jz);
        if (seen.has(k)) continue;
        const x = T.x + jx * CELL, z = T.z + jz * CELL;
        /**
         * FIVE RAYS PER CELL, NOT ONE, AND THE LATTICE PHASE IS WHY. The stair
         * gates on this podium leave a 0.15 m gap between the deck edge and the
         * flight's inner edge; a lattice anchored on the tower's axis lands a
         * sample IN that gap, the single ray comes back with the apron three
         * metres down, and the flood reports a deck nobody can leave. A man is
         * 0.68 m wide. So the cell is standable if ANY of its centre or corners
         * is, and the highest such reading is the floor he is on.
         */
        let f = -Infinity;
        for (const [ox, oz] of [[0, 0], [0.16, 0.16], [-0.16, 0.16], [0.16, -0.16], [-0.16, -0.16]]) {
          const h = ph.groundHeight(x + ox, z + oz, y + HEAD);
          if (Number.isFinite(h) && Math.abs(h - y) <= STEP && h > f && free(x + ox, h, z + oz)) f = h;
        }
        if (!Number.isFinite(f)) { seen.set(k, null); continue; }
        seen.set(k, f);
        q.push([jx, jz, f]);
        const d = Math.hypot(x - T.x, z - T.z);
        if (d > far) far = d;
        if (Math.abs(f - w.groundHeight(x, z)) < 0.55) onPlain++;
        if (f < minY) minY = f;
        if (f > maxY) maxY = f;
      }
    }
    let n = 0;
    for (const v of seen.values()) if (v !== null) n++;
    return { cells: n, reach: +far.toFixed(1), onPlain, minY: +minY.toFixed(2), maxY: +maxY.toFixed(2) };
  };

  const roomFloor = ph.groundHeight(T.x + 3.4, T.z, 12.5);
  const res = {
    at: [T.x, T.z], plain: +plain.toFixed(2), roomFloor: +roomFloor.toFixed(2), runs: [],
  };
  const add = (label, x, z, fromY) => {
    const y = ph.groundHeight(x, z, fromY);
    res.runs.push({ label, start: [x, z, Number.isFinite(y) ? +y.toFixed(2) : null], ...(Number.isFinite(y) ? flood(x, z, y) : { cells: 0, reach: 0, onPlain: 0 }) });
  };

  /**
   * IN THE DOOR REVEAL, NOT IN THE MIDDLE OF THE ROOM. The middle is a plotting
   * table with four piers round it and the flood then starts on top of a crate;
   * `DOOR_CLEAR` guarantees this square metre is empty.
   */
  add('INTACT — a man in the control room', T.x + 4.6, T.z, 12.5);
  add('INTACT — a man on the P1 deck', T.x, T.z - 16, 12);

  rec.setDown(true);
  res.afterAxis = +ph.groundHeight(T.x, T.z, 60).toFixed(2);
  const landed = ph.groundHeight(T.x + 4.6, T.z, roomFloor + 1.4);
  res.landedOn = Number.isFinite(landed) ? +landed.toFixed(2) : null;
  add('RAZED — where the man in the control room lands', T.x + 4.6, T.z, roomFloor + 1.4);
  add('RAZED — the tower axis', T.x, T.z, 60);
  add('RAZED — where the P1 deck was', T.x, T.z - 16, 60);
  rec.setDown(false);
  return res;
});

if (out.error) console.log(out.error);
else {
  console.log(`NF-TOWER at (${out.at})   plain ${out.plain}   control-room floor ${out.roomFloor}`);
  console.log(`after the raze: the tower axis reads ${out.afterAxis}; a man in the room lands on ${out.landedOn}`);
  console.log('');
  for (const r of out.runs) {
    console.log(`${r.label}`);
    console.log(`    start ${JSON.stringify(r.start)}  ->  ${r.cells} cells, reach ${r.reach} m, ` +
      `${r.onPlain} of them AT GRADE, floor ${r.minY}..${r.maxY}`);
  }
}
console.log('\npageerrors', errs.length, errs[0] ?? '');
await b.close();
