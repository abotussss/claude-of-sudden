/**
 * A* FOR A 3.3 m HULL, so a route to a capture point can be SCOUTED instead of
 * guessed. The node test is the one `Armour._bakePath` asks along its polyline —
 * ground under the sample, and (HULL_W + CLEARANCE) / 2 of side room at hull
 * height — asked on a lattice, with the CLIMB rule folded in: mass whose top is
 * no higher than CLIMB_TOP over its own ground is something a tracked vehicle
 * drives over, so it is not a wall.
 *
 * Prints a simplified polyline in authored (widened) units, ready to paste into
 * `ROUTES` and then to be re-measured by `_tankroute.mjs`.
 *
 * Usage: node _hullpath.mjs <url> '<json [{id,from:[x,z],to:[x,z]}]>' [climbTop]
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4291/';
const JOBS = JSON.parse(process.argv[3] ?? '[]');
const CLIMB = +(process.argv[4] ?? 1.0);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const out = await page.evaluate(([JOBS, CLIMB]) => {
  const e = window.__ENGINE__, w = e.ctx.peek('world'), phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const SCALE = 1.5, MASK = phys.MASK.WORLD;
  const RAD = 2.25;              // (HULL_W + CLEARANCE) / 2, rounded up
  const GS = 1.5;                // lattice, authored units
  const X0 = -78, X1 = 78, Z0 = -66, Z1 = 66;
  const NX = Math.round((X1 - X0) / GS) + 1, NZ = Math.round((Z1 - Z0) / GS) + 1;
  const o = new V3(), d = new V3(), down = new V3(0, -1, 0), p = new V3();
  const wx = new Float32Array(NX * NZ), wz = new Float32Array(NX * NZ), wy = new Float32Array(NX * NZ);
  const pass = new Uint8Array(NX * NZ);
  /** free span perpendicular to each of the four travel axes, per node. */
  const span = new Float32Array(NX * NZ * 4);
  const NEED = 4.4;
  /**
   * How far a side probe really gets. Mass whose top is climbable is DRIVEN
   * OVER, so the ray resumes past it — which is the whole difference between
   * "the street is 4 m wide" and "there is a kerb in it".
   */
  const freeDist = (ox, oy, oz, dx, dz, max) => {
    let travelled = 0;
    for (let iter = 0; iter < 4; iter++) {
      o.set(ox + dx * travelled, oy, oz + dz * travelled);
      d.set(dx, 0, dz);
      const h = phys.raycast(o, d, max - travelled, MASK);
      if (!h?.hit) return max;
      const at = travelled + h.distance;
      const hx = ox + dx * (at + 0.2), hz = oz + dz * (at + 0.2);
      o.set(hx, oy + 29, hz);
      d.set(0, -1, 0);
      const t = phys.raycast(o, d, 45, MASK);
      const topY = t?.hit ? oy + 29 - t.distance : NaN;
      /**
       * OVER THE ROAD THE TANK IS ON, never over the obstacle's own top —
       * `groundHeight` at a point past a wall's face comes back as the WALL's
       * top, so measuring against it makes every wall in the level 0 m tall and
       * climbable. This is `_bakePlough`'s rule: `oy` is road + 1.0.
       */
      const base = oy - 1.0;
      if (!Number.isFinite(topY) || topY - base > CLIMB) return at;
      travelled = at + 0.4;
      if (travelled >= max) return max;
    }
    return travelled;
  };
  const t0 = performance.now();
  const ux = new Float32Array(4), uz = new Float32Array(4);
  for (let iz = 0; iz < NZ; iz++) {
    for (let ix = 0; ix < NX; ix++) {
      const k = iz * NX + ix;
      const ax = X0 + ix * GS, az = Z0 + iz * GS;
      w.levelToWorld(ax * SCALE, 0, az * SCALE, p);
      wx[k] = p.x; wz[k] = p.z;
      const g = phys.groundHeight(p.x, p.z, 40);
      if (!Number.isFinite(g)) continue;
      wy[k] = g;
      // the four travel axes, in WORLD, taken from the level's own plan axes
      const axes = [[1, 0], [0, 1], [1, 1], [1, -1]];
      let any = 0;
      for (let a = 0; a < 4; a++) {
        const q = w.levelToWorld((ax + axes[a][0]) * SCALE, 0, (az + axes[a][1]) * SCALE, new V3());
        let tx = q.x - p.x, tz = q.z - p.z;
        const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        ux[a] = tx; uz[a] = tz;
        const s = freeDist(p.x, g + 1.0, p.z, tz, -tx, 6) + freeDist(p.x, g + 1.0, p.z, -tz, tx, 6);
        span[k * 4 + a] = s;
        if (s >= NEED) any = 1;
      }
      pass[k] = any;
    }
  }
  const sweepMs = performance.now() - t0;
  const idx = (ax, az) => {
    const ix = Math.round((ax - X0) / GS), iz = Math.round((az - Z0) / GS);
    if (ix < 0 || ix >= NX || iz < 0 || iz >= NZ) return -1;
    return iz * NX + ix;
  };
  const res = [];
  // dir -> which of the four travel axes its perpendicular span was measured on
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 1], [0, -1, 1], [1, 1, 2], [-1, -1, 2], [1, -1, 3], [-1, 1, 3]];
  /**
   * A NODE TEST ALONE JUMPS WALLS. The lattice is 2.25 m and a street wall is
   * thinner than that, so two nodes with room either side can sit on opposite
   * sides of a building. The edge itself has to be swept.
   */
  const fwd = new Int8Array(NX * NZ * 8);
  const clearAB = (a, b, di) => {
    const ck = a * 8 + di;
    if (fwd[ck]) return fwd[ck] > 0;
    const len = Math.hypot(wx[b] - wx[a], wz[b] - wz[a]);
    const dx = (wx[b] - wx[a]) / len, dz = (wz[b] - wz[a]) / len;
    const ok = freeDist(wx[a], wy[a] + 1.0, wz[a], dx, dz, len + 0.2) >= len;
    fwd[ck] = ok ? 1 : -1;
    return ok;
  };
  const edgeOk = (a, b, ax, di) =>
    span[a * 4 + ax] >= NEED && span[b * 4 + ax] >= NEED && clearAB(a, b, di);
  for (const job of JOBS) {
    const s = idx(job.from[0], job.from[1]), g = idx(job.to[0], job.to[1]);
    if (s < 0 || g < 0) { res.push({ id: job.id, err: 'endpoint off lattice' }); continue; }
    if (!pass[s] || !pass[g]) { res.push({ id: job.id, err: `endpoint blocked (from ${pass[s]} to ${pass[g]})` }); continue; }
    /**
     * PER-JOB NO-GO CIRCLES, in the same authored units — the other capture
     * points' stand-off rings, so a scouted spoke cannot be the "trimmed at
     * the 16 m stand-off on E" drop `_bakeLegs` printed for RED->B.
     * `avoid: [[x, z, r], …]`.
     */
    const AV = job.avoid ?? [];
    const avoidOk = (k) => {
      if (!AV.length) return true;
      const ax = X0 + (k % NX) * GS, az = Z0 + ((k / NX) | 0) * GS;
      for (const [vx, vz, vr] of AV) {
        if (Math.hypot(ax - vx, az - vz) < vr) return false;
      }
      return true;
    };
    if (!avoidOk(s) || !avoidOk(g)) { res.push({ id: job.id, err: 'endpoint inside an avoid circle' }); continue; }
    const gsc = new Float32Array(NX * NZ).fill(Infinity);
    const prev = new Int32Array(NX * NZ).fill(-1);
    const open = [s]; gsc[s] = 0;
    const gx = g % NX, gz = (g / NX) | 0;
    let found = false;
    while (open.length) {
      let bi = 0, bf = Infinity;
      for (let i = 0; i < open.length; i++) {
        const k = open[i];
        const f = gsc[k] + Math.hypot((k % NX) - gx, ((k / NX) | 0) - gz);
        if (f < bf) { bf = f; bi = i; }
      }
      const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      if (cur === g) { found = true; break; }
      const cx = cur % NX, cz = (cur / NX) | 0;
      for (let di = 0; di < DIRS.length; di++) {
        const [dx, dz, ax] = DIRS[di];
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nx >= NX || nz < 0 || nz >= NZ) continue;
        const nk = nz * NX + nx;
        if (!pass[nk] || !avoidOk(nk) || !edgeOk(cur, nk, ax, di)) continue;
        const step = Math.hypot(dx, dz) + Math.abs(wy[nk] - wy[cur]) * 0.5;
        if (gsc[cur] + step < gsc[nk]) { gsc[nk] = gsc[cur] + step; prev[nk] = cur; open.push(nk); }
      }
    }
    if (!found) { res.push({ id: job.id, err: 'NO HULL ROUTE' }); continue; }
    const chain = [];
    for (let k = g; k >= 0; k = prev[k]) chain.push(k);
    chain.reverse();
    /**
     * DOUGLAS-PEUCKER, NOT "KEEP EVERY BEND". A lattice A* WEAVES — it steps
     * one cell off the line and back to buy a cheaper diagonal — and a bend-
     * keeping simplifier writes every one of those wobbles into the polyline.
     * `Armour._bakePath` takes its travel direction from a sample's NEIGHBOURS,
     * so a 2.25 m wobble swings the perpendicular the side probes are fired
     * along by 45 degrees and the street it measures is not the street. Fitting
     * a tolerance instead keeps the dodges that matter and drops the weave.
     */
    const raw = chain.map((k) => [X0 + (k % NX) * GS, Z0 + (((k / NX) | 0)) * GS]);
    const EPS = 1.1;
    const keep = new Uint8Array(raw.length);
    keep[0] = keep[raw.length - 1] = 1;
    const stack = [[0, raw.length - 1]];
    while (stack.length) {
      const [a, c] = stack.pop();
      if (c <= a + 1) continue;
      const ax = raw[a][0], az = raw[a][1];
      let vx = raw[c][0] - ax, vz = raw[c][1] - az;
      const vl = Math.hypot(vx, vz) || 1; vx /= vl; vz /= vl;
      let worst = 0, wi = -1;
      for (let i = a + 1; i < c; i++) {
        const dx = raw[i][0] - ax, dz = raw[i][1] - az;
        const off = Math.abs(dx * vz - dz * vx);
        if (off > worst) { worst = off; wi = i; }
      }
      if (worst > EPS && wi > 0) { keep[wi] = 1; stack.push([a, wi], [wi, c]); }
    }
    const poly = raw.filter((_, i) => keep[i]);
    res.push({ id: job.id, cells: chain.length, poly });
  }
  /* ---- flood the component that contains each job's START, and draw it ---- */
  const comp = new Uint8Array(NX * NZ);
  for (const job of JOBS) {
    const s = idx(job.from[0], job.from[1]);
    if (s < 0 || !pass[s]) continue;
    const stack = [s];
    while (stack.length) {
      const c = stack.pop();
      if (comp[c]) continue;
      comp[c] = 1;
      const cx = c % NX, cz = (c / NX) | 0;
      for (let di = 0; di < DIRS.length; di++) {
        const [dx, dz, ax] = DIRS[di];
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nx >= NX || nz < 0 || nz >= NZ) continue;
        const nk = nz * NX + nx;
        if (pass[nk] && !comp[nk] && edgeOk(c, nk, ax, di)) stack.push(nk);
      }
    }
  }
  const map = [];
  for (let iz = NZ - 1; iz >= 0; iz--) {
    let row = '';
    for (let ix = 0; ix < NX; ix++) {
      const k = iz * NX + ix;
      row += comp[k] ? 'o' : pass[k] ? '.' : '#';
    }
    map.push(`${String(Math.round(Z0 + iz * GS)).padStart(4)} ${row}`);
  }
  return { res, map, sweepMs: Math.round(sweepMs), NX, NZ, open: pass.reduce((a, v) => a + v, 0) };
}, [JOBS, CLIMB]);
console.log(`lattice ${out.NX}x${out.NZ}, ${out.open} passable nodes, swept in ${out.sweepMs} ms (climbTop ${CLIMB})`);
for (const r of out.res) {
  if (r.err) { console.log(`${r.id}: ${r.err}`); continue; }
  console.log(`${r.id}: ${r.cells} cells`);
  console.log(`  ${JSON.stringify(r.poly.map((q) => [+q[0].toFixed(1), +q[1].toFixed(1)]))}`);
}
if (process.env.MAP) console.log(out.map.join('\n'));
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
