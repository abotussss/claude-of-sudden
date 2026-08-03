/**
 * CAN YOU SEE OUT OF D? — 「瓦礫による視認性の悪さが問題 視認性を改善しろ」
 *
 *   node _dsight.mjs [--url=…] [--seed=N] [--drawn=0] [--cath=down]
 *
 * `_dbury.mjs` measures whether a man can STAND in D. Three passes of raising
 * that number did not answer the complaint, because the complaint is not about
 * standing — it is about SEEING. A capture point you can walk around and cannot
 * shoot out of is worse than a small one.
 *
 * So this measures the thing that was never measured: from a standing eye at
 * every walkable position inside the circle, on the razed map, how far can you
 * see, and how much of your own point can you see across?
 *
 *   reach     mean metres to the first occluder, over 36 azimuths per eye. The
 *             single number for "am I in a canyon".
 *   out8      the fraction of those rays that clear the 8 m circle at all —
 *             i.e. how many bearings you can shoot an APPROACHING man on.
 *   out20     the fraction that reach 20 m: the bearings you hold the map from.
 *   blind     the fraction stopped inside 4 m — a face full of rubble.
 *   mutual    of all pairs of walkable positions inside the circle, the share
 *             with a clear eye-to-eye line. "Can the two men holding this point
 *             see each other, and can the man who walks in see them."
 *
 * A, B, C and E are the standard: they are the four zones the player is
 * implicitly comparing D against when he says D is unfightable.
 *
 * The eye is 1.62 m, which is where `STANCE.stand` puts it, and that is the
 * whole argument for the fix: mass under about 1.5 m is cover you fire OVER,
 * mass over it is a wall you cannot see past.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND FOR FIVE PASSES THIS FILE CERTIFIED A ZONE THE PLAYER COULD NOT SEE OUT OF
 * ────────────────────────────────────────────────────────────────────────────
 * Two defects, and they compound:
 *
 *   1. IT MEASURED `?cath=down`. That flag swaps `world`'s two cached cathedral
 *      forms and NOTHING ELSE. The real in-match collapse also drops ~2156
 *      chunks from the `CATHEDRAL` salvo, and the boot flag never creates one of
 *      them. Every screenshot taken that way shows an empty, tidy ruin.
 *   2. IT CAST ONLY AGAINST `MASK.WORLD`. `Airstrike`'s chunks are DRAWN-ONLY —
 *      picture, no collision, not one triangle in the BVH — so a ray fired at
 *      `MASK.WORLD` passes clean through a 3 m slab and reports the metres
 *      behind it. Measured at D's centre after the real event: the ray said
 *      14.4 m clear along S and the rendered frame was filled edge to edge with
 *      grey masonry at and above eye height a metre in front of the camera.
 *
 * `_floatcheck.mjs` was taught to sweep drawn-only mass for exactly this family
 * of defect and this file was not, so:
 *
 *   · the driver runs the REAL SCHEDULED COLLAPSE (time scale up, wait for
 *     `world.cathedral.razed` and every cathedral site baked, then let the dust
 *     clear at normal speed). `--cath=down` restores the old boot-flag boot and
 *     is kept for one purpose only: printing both tables side by side is how you
 *     see how much of the zone is made of mass no collision probe can find.
 *   · every ray is cast against BOTH worlds. The solid half is `physics.raycast`
 *     as before; the drawn half is an exact ray/OBB test over every instance of
 *     every mesh on the settle program, in the pose it is CURRENTLY DRAWN IN,
 *     through a 2 m XZ grid so 36 000 rays against 12 000 boxes is a second.
 *     Debris is identified by `aMot`+`aOff` — `makeChunkMaterial`'s own
 *     attributes — and not by a list of owners, for the reason written down in
 *     `_floatcheck.mjs`: a list is a thing somebody has to remember to add to.
 *
 * Both numbers are printed. `solid` is what this file used to say; `seen` is
 * what the player's eye does. `--drawn=0` turns the second half off.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4521/';
/** Cast against the drawn chunks as well as the collision world. */
const DRAWN = args.drawn !== '0' && args.drawn !== false;
/** Boot the flag instead of playing the event. For the comparison table only. */
const FLAG = args.cath === 'down';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
const q = [];
if (FLAG) q.push('cath=down');
if (args.seed) q.push(`seed=${args.seed}`);
await page.goto(URL + (q.length ? `?${q.join('&')}` : ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
/**
 * ────────────────────────────────────────────────────────────────────────────
 * THE REAL EVENT, PLAYED — NOT `_beginCathedralEvent`, AND NOT `?cath=down`
 * ────────────────────────────────────────────────────────────────────────────
 * `_beginCathedralEvent` throws when poked from outside and the boot flag is the
 * bug. So the clock is run forward and the match scores its own way to
 * `RULES.cathedralScore`, the beat sheet fires the salvo, the shell follows
 * `cathedralRazeDelay` later, and the 2156 chunks of the building settle onto
 * the ruin — which is the state the complaint is about and the only one worth
 * measuring.
 */
let fired = null;
if (!FLAG) {
  fired = await page.evaluate(async () => {
    const e = window.__ENGINE__;
    const w = e.ctx.peek('world');
    const m = e.ctx.peek('match');
    m.roundClock = 1e6;
    m._checkWinConditions = () => {};
    e.ctx.time.scale = 10;
    const rf = () => new Promise((r) => requestAnimationFrame(r));
    for (let i = 0; i < 24000; i++) {
      await rf();
      const cath = m.airstrike.sites.filter((s) => /^CATH/.test(s.id));
      if (w.cathedral?.razed && cath.length >= 4 && cath.every((s) => s.struck && s.baked)) {
        return { razed: true, frames: i, sites: cath.length };
      }
    }
    return { razed: !!w.cathedral?.razed, frames: -1 };
  });
  // Let the dust clear at normal speed — it is opaque for a long time.
  await page.evaluate(() => (window.__ENGINE__.ctx.time.scale = 1));
  await page.waitForTimeout(14000);
}
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').allZones.some((z)=>z.id==='D')", null, { timeout: 60000 });

const out = await page.evaluate(({ DRAWN }) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ph = e.ctx.peek('physics');
  const g = e.ctx.peek('ai').grid;
  const MASK = ph.MASK.WORLD;
  const EYE = 1.62;
  const FAR = 40;
  const NAZ = 36;

  /* ====================================================================== */
  /* THE DRAWN MASS, WHICH CARRIES NO COLLISION AT ALL                      */
  /* ====================================================================== */
  /**
   * Every instance of every mesh on the settle program, as an oriented box in
   * the pose `instanceMatrix` is drawing it in, indexed by a 2 m XZ grid.
   *
   * ORIENTED, NOT AXIS-ALIGNED. A chunk is spun about a random axis when it
   * settles, and its world AABB is up to 73 % wider than the slab inside it —
   * an AABB probe would report occlusion the player can see straight past and
   * this file has told the player enough things that were not so.
   */
  const CELL = 2.0;
  let boxes = null;
  if (DRAWN) {
    const M4 = e.camera.matrixWorld.constructor;
    const V3 = e.camera.position.constructor;
    const mat = new M4();
    const pos = new V3();
    const sc = new V3();
    const qq = e.camera.quaternion.clone();
    const cen = [];
    const hlf = [];
    const rot = [];
    const shown = (o) => {
      for (let p = o; p; p = p.parent) if (!p.visible) return false;
      return true;
    };
    e.ctx.scene.traverse((o) => {
      if (!o.isInstancedMesh || !(o.count > 0)) return;
      const geo = o.geometry;
      // `makeChunkMaterial`'s own instanced attributes. @see `_floatcheck.mjs`.
      if (!(geo?.getAttribute?.('aMot') && geo.getAttribute('aOff'))) return;
      if (!shown(o)) return;
      o.updateWorldMatrix(true, false);
      const arr = o.instanceMatrix.array;
      const n = Math.min(o.count, arr.length / 16);
      for (let i = 0; i < n; i++) {
        mat.fromArray(arr, i * 16);
        mat.premultiply(o.matrixWorld);
        mat.decompose(pos, qq, sc);
        const el = new M4().makeRotationFromQuaternion(qq).elements;
        cen.push(pos.x, pos.y, pos.z);
        hlf.push(Math.abs(sc.x) * 0.5, Math.abs(sc.y) * 0.5, Math.abs(sc.z) * 0.5);
        // Column-major basis: (el[0],el[1],el[2]) is the world direction of the
        // box's own local +X, and so on. The transpose takes world -> local.
        rot.push(el[0], el[1], el[2], el[4], el[5], el[6], el[8], el[9], el[10]);
      }
    });
    const N = cen.length / 3;
    const C = new Float64Array(cen);
    const H = new Float64Array(hlf);
    const R = new Float64Array(rot);
    /* the XZ grid */
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const ex = new Float64Array(N);
    const ez = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const r = i * 9;
      const h = i * 3;
      // World extent of the oriented box along X and Z.
      ex[i] = Math.abs(R[r]) * H[h] + Math.abs(R[r + 3]) * H[h + 1] + Math.abs(R[r + 6]) * H[h + 2];
      ez[i] = Math.abs(R[r + 2]) * H[h] + Math.abs(R[r + 5]) * H[h + 1] + Math.abs(R[r + 8]) * H[h + 2];
      x0 = Math.min(x0, C[h] - ex[i]); x1 = Math.max(x1, C[h] + ex[i]);
      z0 = Math.min(z0, C[h + 2] - ez[i]); z1 = Math.max(z1, C[h + 2] + ez[i]);
    }
    const nx = Math.max(1, Math.ceil((x1 - x0) / CELL) + 1);
    const nz = Math.max(1, Math.ceil((z1 - z0) / CELL) + 1);
    const cells = new Array(nx * nz);
    for (let i = 0; i < N; i++) {
      const h = i * 3;
      const ax0 = Math.max(0, Math.floor((C[h] - ex[i] - x0) / CELL));
      const ax1 = Math.min(nx - 1, Math.floor((C[h] + ex[i] - x0) / CELL));
      const az0 = Math.max(0, Math.floor((C[h + 2] - ez[i] - z0) / CELL));
      const az1 = Math.min(nz - 1, Math.floor((C[h + 2] + ez[i] - z0) / CELL));
      for (let cz = az0; cz <= az1; cz++) {
        for (let cx = ax0; cx <= ax1; cx++) {
          const k = cz * nx + cx;
          (cells[k] ??= []).push(i);
        }
      }
    }
    boxes = { N, C, H, R, x0, z0, nx, nz, cells };
  }

  /** Nearest drawn-mass hit along a ray, or `far`. Exact ray/OBB slabs. */
  const castDrawn = (ox, oy, oz, dx, dy, dz, far) => {
    if (!boxes) return far;
    const { C, H, R, x0, z0, nx, nz, cells } = boxes;
    let best = far;
    /* 2D DDA over the XZ grid */
    let cx = Math.floor((ox - x0) / CELL);
    let cz = Math.floor((oz - z0) / CELL);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tdx = stepX ? Math.abs(CELL / dx) : Infinity;
    const tdz = stepZ ? Math.abs(CELL / dz) : Infinity;
    let tmx = stepX
      ? (x0 + (cx + (stepX > 0 ? 1 : 0)) * CELL - ox) / dx
      : Infinity;
    let tmz = stepZ
      ? (z0 + (cz + (stepZ > 0 ? 1 : 0)) * CELL - oz) / dz
      : Infinity;
    if (tmx < 0) tmx = Infinity;
    if (tmz < 0) tmz = Infinity;
    let t = 0;
    while (t <= best) {
      if (cx >= 0 && cz >= 0 && cx < nx && cz < nz) {
        const list = cells[cz * nx + cx];
        if (list) {
          for (let li = 0; li < list.length; li++) {
            const i = list[li];
            const h = i * 3;
            const r = i * 9;
            const px = ox - C[h], py = oy - C[h + 1], pz = oz - C[h + 2];
            let lo = -Infinity;
            let hi = best;
            for (let a = 0; a < 3; a++) {
              const rx = R[r + a * 3], ry = R[r + a * 3 + 1], rz = R[r + a * 3 + 2];
              const p = px * rx + py * ry + pz * rz;
              const d = dx * rx + dy * ry + dz * rz;
              const ha = H[h + a];
              if (d > -1e-9 && d < 1e-9) {
                if (p < -ha || p > ha) { lo = Infinity; break; }
                continue;
              }
              let t1 = (-ha - p) / d;
              let t2 = (ha - p) / d;
              if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
              if (t1 > lo) lo = t1;
              if (t2 < hi) hi = t2;
              if (lo > hi) { lo = Infinity; break; }
            }
            if (lo !== Infinity && hi >= 0 && lo < best) best = Math.max(0, lo);
          }
        }
      }
      if (tmx < tmz) {
        if (tmx > best) break;
        t = tmx; cx += stepX; tmx += tdx;
      } else {
        if (tmz > best) break;
        t = tmz; cz += stepZ; tmz += tdz;
      }
      if (!Number.isFinite(t)) break;
    }
    return best;
  };

  const t0 = performance.now();
  const rows = [];
  for (const z of m.allZones) {
    const C = z.position;
    const R = z.radius;
    /* every walkable cell inside the circle, with the grid's own floor */
    const pts = [];
    for (let iz = g.cellZ(C.z - R); iz <= g.cellZ(C.z + R); iz++) {
      for (let ix = g.cellX(C.x - R); ix <= g.cellX(C.x + R); ix++) {
        const x = g.worldX(ix);
        const zz = g.worldZ(iz);
        if (Math.hypot(x - C.x, zz - C.z) > R) continue;
        const i = g.index(ix, iz);
        if (!g.flags[i]) continue;
        pts.push([x, g.floor[i] + EYE, zz]);
      }
    }
    let rays = 0;
    let sum = 0;
    let sumSolid = 0;
    let out8 = 0;
    let out20 = 0;
    let blind = 0;
    /** Rays a drawn chunk stops that the collision world does not. */
    let onlyDrawn = 0;
    const perEye = [];
    for (const [x, y, zz] of pts) {
      let s = 0;
      for (let a = 0; a < NAZ; a++) {
        const th = (a / NAZ) * 6.283185;
        const dx = Math.cos(th);
        const dz = Math.sin(th);
        const h = ph.raycast(x, y, zz, dx, 0, dz, FAR, MASK);
        const solid = h.hit ? h.distance : FAR;
        const d = Math.min(solid, castDrawn(x, y, zz, dx, 0, dz, FAR));
        rays++;
        sum += d;
        sumSolid += solid;
        if (d < solid - 0.05) onlyDrawn++;
        s += d;
        if (d >= 8) out8++;
        if (d >= 20) out20++;
        if (d < 4) blind++;
      }
      perEye.push(s / NAZ);
    }
    /* mutual visibility, on a capped sample so the pair count stays sane */
    const step = Math.max(1, Math.ceil(pts.length / 46));
    const samp = pts.filter((_, i) => i % step === 0);
    let pairs = 0;
    let seen = 0;
    for (let i = 0; i < samp.length; i++) {
      for (let j = i + 1; j < samp.length; j++) {
        const a = samp[i];
        const b = samp[j];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const dz = b[2] - a[2];
        const L = Math.hypot(dx, dy, dz);
        if (L < 0.1) continue;
        pairs++;
        const h = ph.raycast(a[0], a[1], a[2], dx / L, dy / L, dz / L, L - 0.05, MASK);
        if (h.hit) continue;
        if (castDrawn(a[0], a[1], a[2], dx / L, dy / L, dz / L, L - 0.05) < L - 0.05) continue;
        seen++;
      }
    }
    perEye.sort((p, q2) => p - q2);
    rows.push({
      id: z.id,
      n: pts.length,
      reach: +(sum / Math.max(1, rays)).toFixed(2),
      solid: +(sumSolid / Math.max(1, rays)).toFixed(2),
      worstEye: +(perEye[0] ?? 0).toFixed(2),
      medEye: +(perEye[perEye.length >> 1] ?? 0).toFixed(2),
      out8: +((100 * out8) / Math.max(1, rays)).toFixed(1),
      out20: +((100 * out20) / Math.max(1, rays)).toFixed(1),
      blind: +((100 * blind) / Math.max(1, rays)).toFixed(1),
      mutual: +((100 * seen) / Math.max(1, pairs)).toFixed(1),
      drawnOnly: +((100 * onlyDrawn) / Math.max(1, rays)).toFixed(1),
    });
  }
  return { rows, drawn: boxes?.N ?? 0, ms: Math.round(performance.now() - t0) };
}, { DRAWN });

console.log(
  `\n  ${FLAG ? '?cath=down (BOOT FLAG — not the event the player plays)' : 'the real scheduled collapse'}` +
    (fired ? `  ·  razed after ${fired.frames} frames, ${fired.sites} cathedral sites baked` : '') +
    `\n  ${DRAWN ? `${out.drawn} drawn instances cast against as oriented boxes` : 'drawn mass NOT cast against (--drawn=0)'}` +
    `  ·  ${out.ms}ms`
);
console.log('\n  eye 1.62 m at every walkable cell in the circle, 36 azimuths, 40 m cap');
console.log('  zone  cells   reach   solid   medEye  worstEye   out>8m   out>20m   blind<4m   mutual   drawn-only');
for (const r of out.rows) {
  console.log(
    `   ${r.id.padEnd(4)} ${String(r.n).padStart(5)}  ${String(r.reach).padStart(6)}m ` +
      `${String(r.solid).padStart(6)}m ${String(r.medEye).padStart(7)}m ${String(r.worstEye).padStart(8)}m ` +
      `${String(r.out8).padStart(7)}% ${String(r.out20).padStart(8)}% ` +
      `${String(r.blind).padStart(9)}% ${String(r.mutual).padStart(7)}% ${String(r.drawnOnly).padStart(11)}%`
  );
}
console.log(
  '\n  reach = first occluder of EITHER kind; solid = what a MASK.WORLD ray alone says.\n' +
    '  drawn-only = the share of bearings a chunk stops and the collision world does not —\n' +
    '  i.e. exactly how wrong this file was for five passes.'
);
console.log('\n  pageErrors', errs.length ? errs.slice(0, 4) : 'none');
await browser.close();
