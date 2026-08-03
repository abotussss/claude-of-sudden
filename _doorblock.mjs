/**
 * DOORWAY GATE — 「またなぜ屋内で通路可能な扉とかの出入り口に邪魔な物理判定のある
 * 障害物置くの？？？」
 *
 * Enumerates EVERY opening a player is supposed to walk through — the exterior
 * doors, the doorways cut in the interior partitions on every floor, and (with
 * `?breach=down`) the holes blown in the cache houses' walls — and drives the
 * REAL player capsule through each one against the REAL physics BVH.
 *
 * An opening passes when at least one lane across its clear width is walkable
 * from 1.4 m outside to 1.4 m inside. Every lane that is not walkable is
 * attributed: `?boxtag` records every collision proxy on the map with its
 * world box and the stack that authored it, so a blocked opening comes back
 * with the PROP KIND and the CONSTRUCTION SITE standing in it, not just a
 * coordinate.
 *
 *   node _doorblock.mjs [--url=…] [--seeds=1,2,3] [--breach] [--verbose]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4513/';
const SEEDS = String(args.seeds ?? '1').split(',');
const VERBOSE = !!args.verbose;

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });

const PROBE = () => {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world');
  const phys = c.peek('physics');
  const A = w.A;
  const TAG = A.constructor.TAG ?? [];
  const B = w.layout.BUILDINGS;
  const MASK = phys.MASK.CHARACTER;
  const V = c.camera.position.constructor;

  const R = 0.32, H = 1.78, STEP = 0.42;
  const _a = new V(), _b = new V(), _wp = new V();

  /** The standable surface nearest `wantY` in this column, or null. */
  const surfaceNear = (lx, lz, wantY, tol) => {
    w.levelToWorld(lx, 0, lz, _wp);
    let from = wantY + 2.6, best = null;
    for (let s = 0; s < 8; s++) {
      const hit = phys.raycast(_wp.x, from, _wp.z, 0, -1, 0, from - (wantY - 3.0), MASK);
      if (!hit.hit) break;
      const fy = hit.point.y;
      from = fy - 0.06;
      if (fy < wantY - tol) break;
      if (hit.normal && hit.normal.y < 0.5) continue;
      if (Math.abs(fy - wantY) <= tol) { best = fy; break; }
    }
    return best;
  };

  /** Room for the capsule to STAND at this level-space point on floor `fy`. */
  const stands = (lx, lz, fy) => {
    w.levelToWorld(lx, 0, lz, _wp);
    _a.set(_wp.x, fy + STEP + R, _wp.z);
    _b.set(_wp.x, fy + H - R + 0.02, _wp.z);
    return phys.checkCapsule(_a, _b, R - 0.005, MASK);
  };

  /**
   * WHAT IS STANDING THERE. Every tagged proxy whose world box overlaps a
   * capsule of radius R at `p`, between step height and head height.
   */
  const blamed = (lx, lz, fy) => {
    w.levelToWorld(lx, 0, lz, _wp);
    /**
     * The band the CAPSULE occupies at this sample, measured off the floor the
     * capsule is standing on there and not off the opening's nominal floor: a
     * pavement outside a threshold is a step lower, so a 0.45 m planter reads
     * as "under step height" against the room's floor and is exactly what the
     * capsule walked into. Anything whose top is below the local step height is
     * genuinely stepped over and is not a culprit — that is the same rule
     * `footprintR` uses, and it is what keeps the floor slabs out of this list.
     */
    const y0 = fy + STEP - 0.03, y1 = fy + H;
    const out = [];
    for (const t of TAG) {
      if (t.wy + t.sy / 2 < y0 || t.wy - t.sy / 2 > y1) continue;
      // into the box's own frame
      const dx = _wp.x - t.wx, dz = _wp.z - t.wz;
      const cs = Math.cos(-t.wry), sn = Math.sin(-t.wry);
      // yaw about +Y: x' = x cos - z sin is the inverse for -ry
      const bx = dx * cs + dz * sn;
      const bz = -dx * sn + dz * cs;
      const ox = Math.abs(bx) - t.sx / 2, oz = Math.abs(bz) - t.sz / 2;
      const d = Math.hypot(Math.max(ox, 0), Math.max(oz, 0));
      if (ox < 0 && oz < 0) { out.push({ t, d: 0 }); continue; }
      if (d < R) out.push({ t, d });
    }
    out.sort((p, q) => p.d - q.d);
    return out.slice(0, 3).map(({ t, d }) => ({
      kind: t.k === 'prop' ? t.id : `${t.k}:${t.surface}`,
      size: [+t.sx.toFixed(2), +t.sy.toFixed(2), +t.sz.toFixed(2)],
      top: +(t.wy + t.sy / 2 - fy).toFixed(2),
      gap: +d.toFixed(2),
      scope: t.scope,
      // the innermost world/* frames of the authoring stack
      at: String(t.at ?? '').split('\n').slice(1, 9)
        .map((l) => l.trim().replace(/^at\s+/, ''))
        .filter((l) => !/_collideProto|Assembler\.(place|put|box|_tag)|\bplace\b|\bput\b/.test(l))
        .slice(0, 3),
    }));
  };

  // ------------------------------------------------------------ openings --
  const IN = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  const openings = [];
  for (let bi = 0; bi < B.length; bi++) {
    const spec = B[bi];
    if (!spec.enterable) continue;
    const info = w.buildings[bi];
    if (!info) continue;
    const gy = info.floorY[0] + 0.13;
    for (const d of info.doors) {
      openings.push({
        id: `${spec.id} door s${d.side}`, kind: 'door', building: spec.id, floor: 0,
        x: d.wp[0], z: d.wp[2], y: gy, w: 1.12,
        nx: IN[d.side][0], nz: IN[d.side][1],
      });
    }
    for (let i = 0; i < (info.innerDoors ?? []).length; i++) {
      const h = info.innerDoors[i];
      const L = Math.hypot(h.nx, h.nz) || 1;
      openings.push({
        id: `${spec.id} inner f${h.floor} #${i}`, kind: 'inner', building: spec.id, floor: h.floor,
        x: h.x, z: h.z, y: h.y, w: h.w, nx: h.nx / L, nz: h.nz / L,
      });
    }
  }
  // …and the breached elevations, but only when this boot actually opened them
  // (`?breach=down`): a wall that is still standing is not an opening.
  for (const b of w.breaches ?? []) {
    if (!b.down || !b.level) continue;
    const bi = B.findIndex((s) => s.id === b.building);
    const gy = bi >= 0 && w.buildings[bi] ? w.buildings[bi].floorY[0] + 0.13 : 0;
    openings.push({
      id: `${b.id} breach`, kind: 'breach', building: b.building, floor: 0,
      x: b.level.x, z: b.level.z, y: gy, w: b.holeW,
      nx: IN[b.side][0], nz: IN[b.side][1],
    });
  }

  // ----------------------------------------------------------- the drive --
  const STEP_S = 0.14;
  const rows = [];
  for (const o of openings) {
    const tx = -o.nz, tz = o.nx;
    const half = Math.max(0.02, o.w / 2 - R - 0.02);
    const nLane = 5;
    const lanes = [];
    for (let li = 0; li < nLane; li++) {
      const u = nLane === 1 ? 0 : (li / (nLane - 1) - 0.5) * 2 * half;
      let ok = true; const bad = [];
      for (let s = -1.4; s <= 1.4001; s += STEP_S) {
        const lx = o.x + o.nx * s + tx * u;
        const lz = o.z + o.nz * s + tz * u;
        const fy = surfaceNear(lx, lz, o.y, 0.5);
        if (fy === null || !stands(lx, lz, fy)) {
          ok = false;
          bad.push({ s: +s.toFixed(2), u: +u.toFixed(2), lx, lz, fy, noFloor: fy === null });
        }
      }
      lanes.push({ u: +u.toFixed(2), ok, bad });
    }
    const pass = lanes.some((l) => l.ok);
    const row = { id: o.id, kind: o.kind, building: o.building, floor: o.floor, pass,
      lanes: lanes.filter((l) => l.ok).length, of: nLane, culprits: [] };
    if (!pass) {
      const seen = new Map();
      for (const l of lanes) {
        for (const bd of l.bad) {
          for (const cul of blamed(bd.lx, bd.lz, bd.fy ?? o.y)) {
            const k = cul.kind + '|' + cul.at.join('>');
            if (!seen.has(k)) seen.set(k, { ...cul, n: 0 });
            seen.get(k).n++;
          }
        }
      }
      row.culprits = [...seen.values()].sort((a, b2) => b2.n - a.n).slice(0, 4);
      /**
       * NOTHING TAGGED THERE MEANS IT IS NOT A PROP. Merged mass — a wall, a
       * plinth, a relief deck, a site work — is in the BVH under a surface
       * mesh, not under a proxy record, so the fallback names the MESH that is
       * actually in the way rather than reporting "blocked by nothing".
       */
      if (!row.culprits.length) {
        const near = new Map();
        for (const l of lanes) {
          for (const bd of l.bad.slice(0, 4)) {
            w.levelToWorld(bd.lx, 0, bd.lz, _wp);
            for (let k = 0; k < 8; k++) {
              const a2 = (k / 8) * Math.PI * 2;
              const h = phys.raycast(_wp.x, (bd.fy ?? o.y) + 0.9, _wp.z,
                Math.cos(a2), 0, Math.sin(a2), 0.7, MASK);
              if (!h.hit || !h.object) continue;
              const key = `${h.object.name} (${h.surface})`;
              near.set(key, (near.get(key) ?? 0) + 1);
            }
          }
        }
        row.meshes = [...near.entries()].sort((a2, b2) => b2[1] - a2[1]).slice(0, 3);
      }
      row.noFloor = lanes.every((l) => l.bad.every((b2) => b2.noFloor));
      const all = lanes.flatMap((l) => l.bad);
      row.bad = all.length;
      row.badNoFloor = all.filter((b2) => b2.noFloor).length;
      row.at = all.slice(0, 3).map((b2) => [b2.s, b2.u]);
    }
    rows.push(row);
  }
  return { rows, tags: TAG.length };
};

let totalBad = 0;
for (const seed of SEEDS) {
  const url = `${BASE}?seed=${seed}&boxtag=1${args.breach ? '&breach=down' : ''}`;
  const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
  const { rows, tags } = await page.evaluate(PROBE);
  const bad = rows.filter((r) => !r.pass);
  totalBad += bad.length;
  const byKind = {};
  for (const r of rows) {
    byKind[r.kind] ??= [0, 0];
    byKind[r.kind][1]++;
    if (r.pass) byKind[r.kind][0]++;
  }
  console.log(`\n===== SEED ${seed} — ${tags} tagged proxies =====`);
  for (const k of Object.keys(byKind)) {
    console.log(`  ${k.padEnd(7)} ${byKind[k][0]}/${byKind[k][1]} passable`);
  }
  for (const r of bad) {
    console.log(`  BLOCKED  ${r.id.padEnd(24)} ${String(r.lanes)}/${r.of} lanes` +
      `   ${r.bad} bad samples (${r.badNoFloor} with no floor at all) at ${JSON.stringify(r.at)}` +
      (r.noFloor ? '   <- NO FLOOR EITHER SIDE — not a furniture problem' : ''));
    if (r.meshes?.length) console.log(`             <- untagged mass: ${JSON.stringify(r.meshes)}`);
    for (const cul of r.culprits) {
      console.log(`             <- ${cul.kind.padEnd(16)} ${JSON.stringify(cul.size)} top+${cul.top} gap ${cul.gap} x${cul.n}` +
        `  ${cul.scope ? '[' + cul.scope + '] ' : ''}${cul.at.join(' < ')}`);
    }
  }
  if (VERBOSE) console.log(JSON.stringify(rows, null, 1));
  if (errs.length) console.log('  page errors', errs.slice(0, 3));
  await page.close();
}
console.log(`\n[doorblock] ${totalBad} blocked opening(s) over ${SEEDS.length} seed(s)`);
await browser.close();
process.exit(totalBad ? 1 : 0);
