/**
 * THE BOUNDARY FLOOD, as a page function a harness can call.
 *
 * This is `tools/boundcheck.mjs`'s in-page measurement lifted out verbatim —
 * same capsule, same moves, same authored-content classification, same void
 * regions and leak crossings — so that a SWEEP over seeds and the GATE agree on
 * what a hole is. boundcheck.mjs is untouched and remains the gate; nothing here
 * is allowed to be more permissive than it, and anything this reports must be
 * confirmed by running the real gate on the seed.
 *
 * The only additions are `engineSeed` (so a failing run names the URL that
 * reproduces it) and `siteDump`, which reports the tagged collision boxes inside
 * a level-space window — the instrument for "WHICH authored thing is missing".
 */

/** @param {{CELL:number, SLACK:number, window?:number[]}} opts */
export function floodReport({ CELL, SLACK, window: win = null, pathLen = 24 }) {
  const c = window.__ENGINE__.ctx;
  const w = c.peek('world'), phys = c.peek('physics');
  const L = w.layout;
  if (!L) return { err: 'world does not expose layout' };
  const V = c.camera.position.constructor;
  const MASK = phys.MASK.CHARACTER;

  const R = 0.32, H = 1.78, STEP = 0.42, MANTLE_UP = 1.85, DROP_MAX = 6.0, MREACH = 1.05;
  const SCAN_TOP = 8.0;
  const MAXSURF = 3;
  const _a = new V(), _b = new V(), _wp = new V(), _wq = new V();

  const rects = [];
  const addRect = (x0, z0, x1, z1, pad, tag) => rects.push({
    x0: Math.min(x0, x1) - pad, x1: Math.max(x0, x1) + pad,
    z0: Math.min(z0, z1) - pad, z1: Math.max(z0, z1) + pad, tag,
  });
  const S = L.STREET;
  addRect(-S.kerb, S.zMin, S.kerb, S.zMax, 0.6, 'street');
  for (const a of L.ALLEYS ?? []) addRect(a.rect[0], a.rect[1], a.rect[2], a.rect[3], 0.6, 'lane');
  for (const b of L.BUILDINGS ?? []) {
    addRect(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2, 1.2, `bldg ${b.id}`);
  }
  for (const p of L.SITEWORKS ?? []) addRect(p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2, 1.5, `sitework ${p.id}`);
  for (const t of L.RELIEF?.terraces ?? []) addRect(t.rect[0], t.rect[1], t.rect[2], t.rect[3], 2.0, `terrace ${t.id}`);
  for (const d of L.RELIEF?.decks ?? []) addRect(d.rect[0], d.rect[1], d.rect[2], d.rect[3], 1.5, `deck ${d.id}`);
  for (const b of L.RELIEF?.blocks ?? []) addRect(b.rect[0], b.rect[1], b.rect[2], b.rect[3], 1.5, `block ${b.id}`);
  if (L.GATE) addRect(-L.GATE.outerW, L.GATE.z - L.GATE.depth, L.GATE.outerW, L.GATE.z + L.GATE.depth, 2.5, 'gate');
  for (const f of w.features ?? []) {
    const p = w.worldToLevel(f.position.x, f.position.y, f.position.z, new V());
    addRect(p.x, p.z, p.x, p.z, 3.5, `feature ${f.id}`);
  }

  const rectTag = (lx, lz, slack) => {
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (lx >= r.x0 - slack && lx <= r.x1 + slack && lz >= r.z0 - slack && lz <= r.z1 + slack) return r.tag;
    }
    return null;
  };
  const authoredTag = (lx, lz, slack, surface) =>
    (surface && surface !== 'sand' ? surface : null) ?? rectTag(lx, lz, slack);

  const core = [];
  const addCore = (x0, z0, x1, z1) => core.push({
    x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1),
  });
  addCore(-S.kerb, S.zMin, S.kerb, S.zMax);
  for (const a of L.ALLEYS ?? []) addCore(a.rect[0], a.rect[1], a.rect[2], a.rect[3]);
  for (const b of L.BUILDINGS ?? []) addCore(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2);
  for (const t of L.RELIEF?.terraces ?? []) addCore(t.rect[0], t.rect[1], t.rect[2], t.rect[3]);
  for (const d of L.RELIEF?.decks ?? []) addCore(d.rect[0], d.rect[1], d.rect[2], d.rect[3]);
  const inCore = (lx, lz) => {
    for (let i = 0; i < core.length; i++) {
      const r = core[i];
      if (lx >= r.x0 && lx <= r.x1 && lz >= r.z0 && lz <= r.z1) return true;
    }
    return false;
  };

  const EXT = 168 * (L.SCALE ?? 1) * 0.5 + 2;
  const nx = Math.ceil((EXT * 2) / CELL) + 1;
  const nz = nx;
  const idx = (ix, iz) => iz * nx + ix;
  const lxOf = (ix) => -EXT + ix * CELL;
  const lzOf = (iz) => -EXT + iz * CELL;

  const cellNodes = new Array(nx * nz);
  const nodeY = [], nodeCell = [], nodeSurf = [];
  let rays = 0;
  const column = (ci) => {
    let list = cellNodes[ci];
    if (list !== undefined) return list;
    list = [];
    const ix = ci % nx, iz = (ci / nx) | 0;
    w.levelToWorld(lxOf(ix), 0, lzOf(iz), _wp);
    let from = SCAN_TOP;
    for (let s = 0; s < MAXSURF; s++) {
      rays++;
      const hit = phys.raycast(_wp.x, from, _wp.z, 0, -1, 0, from + 3.0, MASK);
      if (!hit.hit) break;
      const fy = hit.point.y;
      if (fy < -1.2) break;
      from = fy - 0.06;
      if (hit.normal && hit.normal.y < 0.5) continue;
      _a.set(_wp.x, fy + STEP + R, _wp.z);
      _b.set(_wp.x, fy + H - R + 0.02, _wp.z);
      if (!phys.checkCapsule(_a, _b, R - 0.005, MASK)) continue;
      list.push(nodeY.length);
      nodeY.push(fy); nodeCell.push(ci); nodeSurf.push(hit.surface);
      if (from < -1.2) break;
    }
    cellNodes[ci] = list;
    return list;
  };

  const clearBetween = (lo, hi) => {
    const lc = nodeCell[lo], hc = nodeCell[hi];
    w.levelToWorld(lxOf(lc % nx), 0, lzOf((lc / nx) | 0), _a);
    w.levelToWorld(lxOf(hc % nx), 0, lzOf((hc / nx) | 0), _b);
    const dx = _b.x - _a.x, dz = _b.z - _a.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return true;
    rays++;
    return !phys.raycast(_a.x, nodeY[hi] + 0.3, _a.z, dx / d, 0, dz / d, d, MASK).hit;
  };

  const tags = [];
  const tagOf = (k) => {
    let t = tags[k];
    if (t !== undefined) return t;
    const ci = nodeCell[k];
    t = authoredTag(lxOf(ci % nx), lzOf((ci / nx) | 0), SLACK, nodeSurf[k]);
    tags[k] = t;
    return t;
  };
  const inPlay = [];
  const playOf = (k) => {
    let t = inPlay[k];
    if (t !== undefined) return t;
    const ci = nodeCell[k];
    t = nodeSurf[k] !== 'sand' || inCore(lxOf(ci % nx), lzOf((ci / nx) | 0));
    inPlay[k] = t;
    return t;
  };

  const seedNodes = [];
  for (const sp of w.spawnPoints ?? []) {
    const q = w.worldToLevel(sp.position.x, sp.position.y, sp.position.z, _wq);
    const ix = Math.round((q.x + EXT) / CELL), iz = Math.round((q.z + EXT) / CELL);
    let best = -1, bestD = Infinity;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        for (const k of column(idx(jx, jz))) {
          const d = dx * dx + dz * dz + Math.abs(nodeY[k]) * 4;
          if (d < bestD) { bestD = d; best = k; }
        }
      }
    }
    if (best >= 0) seedNodes.push(best);
  }

  const RING = Math.ceil(MREACH / CELL);
  const flood = (authoredOnly, pred = null) => {
    const seen = new Set();
    const queue = [];
    let head = 0;
    let cur = -1;
    const push = (k) => {
      if (seen.has(k)) return;
      if (authoredOnly && !playOf(k)) return;
      seen.add(k); queue.push(k);
      if (pred) pred.set(k, cur);
    };
    for (const s of seedNodes) push(s);
    while (head < queue.length) {
      cur = queue[head++];
      const ci = nodeCell[cur], y = nodeY[cur];
      const ix = ci % nx, iz = (ci / nx) | 0;
      for (let dz = -RING; dz <= RING; dz++) {
        for (let dx = -RING; dx <= RING; dx++) {
          if (dx === 0 && dz === 0) continue;
          const step1 = Math.abs(dx) + Math.abs(dz) === 1;
          if (!step1 && Math.hypot(dx, dz) * CELL > MREACH) continue;
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          for (const k of column(idx(jx, jz))) {
            if (seen.has(k)) continue;
            const dy = nodeY[k] - y;
            const ady = Math.abs(dy);
            if (ady <= STEP) { if (step1) push(k); continue; }
            if (dy > 0) {
              if (dy > MANTLE_UP) continue;
              if (!step1 && !clearBetween(cur, k)) continue;
              push(k);
            } else {
              if (ady > DROP_MAX) continue;
              if (!step1 && !clearBetween(k, cur)) continue;
              push(k);
            }
          }
        }
      }
    }
    return seen;
  };

  const pred = new Map();
  const seen = flood(false, pred);
  const play = flood(true);

  const reachedCell = new Map();
  for (const k of seen) {
    const ci = nodeCell[k];
    const prev = reachedCell.get(ci);
    if (prev && prev.y <= nodeY[k]) continue;
    reachedCell.set(ci, { lx: lxOf(ci % nx), lz: lzOf((ci / nx) | 0), y: nodeY[k], tag: tagOf(k) });
  }

  const voidCells = [];
  for (const [ci, e] of reachedCell) if (e.tag === null) voidCells.push(ci);
  const voidSet = new Set(voidCells);

  const regions = [];
  const done = new Set();
  for (const start of voidCells) {
    if (done.has(start)) continue;
    const q = [start]; done.add(start);
    let n = 0, sx = 0, sz = 0, far = 0, farAt = null;
    const bbox = [Infinity, Infinity, -Infinity, -Infinity];
    while (q.length) {
      const ci = q.pop(); n++;
      const e = reachedCell.get(ci);
      sx += e.lx; sz += e.lz;
      bbox[0] = Math.min(bbox[0], e.lx); bbox[1] = Math.min(bbox[1], e.lz);
      bbox[2] = Math.max(bbox[2], e.lx); bbox[3] = Math.max(bbox[3], e.lz);
      const d = Math.hypot(e.lx, e.lz);
      if (d > far) { far = d; farAt = [Math.round(e.lx), Math.round(e.lz)]; }
      const ix = ci % nx, iz = (ci / nx) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = idx(ix + dx, iz + dz);
          if (voidSet.has(j) && !done.has(j)) { done.add(j); q.push(j); }
        }
      }
    }
    regions.push({
      area: +(n * CELL * CELL).toFixed(1), cells: n,
      centre: [Math.round(sx / n), Math.round(sz / n)], far: +far.toFixed(1), farAt,
      bbox: bbox.map((v) => Math.round(v)),
    });
  }
  regions.sort((a, b) => b.area - a.area);

  const leaks = [];
  const crossOf = new Map();
  const crossing = (k) => {
    if (crossOf.has(k)) return crossOf.get(k);
    const chain = [];
    let cur = k, found = -1;
    while (cur !== undefined && cur >= 0) {
      if (crossOf.has(cur)) { found = crossOf.get(cur); break; }
      if (play.has(cur)) { found = chain.length ? chain[chain.length - 1] : -1; break; }
      chain.push(cur);
      cur = pred.get(cur);
    }
    for (const n of chain) crossOf.set(n, found);
    crossOf.set(k, found);
    return found;
  };
  const byCross = new Map();
  for (const ci of voidCells) {
    let node = -1;
    for (const k of column(ci)) if (seen.has(k)) { node = k; break; }
    if (node < 0) continue;
    const x = crossing(node);
    if (x < 0) continue;
    byCross.set(x, (byCross.get(x) ?? 0) + 1);
  }
  for (const [k, n] of byCross) {
    const ci = nodeCell[k];
    const lx = lxOf(ci % nx), lz = lzOf((ci / nx) | 0);
    const near = leaks.find((e) => Math.hypot(e.lx - lx, e.lz - lz) < 5);
    if (near) { near.n += n; continue; }
    leaks.push({ lx: Math.round(lx), lz: Math.round(lz), y: +nodeY[k].toFixed(2), from: nodeSurf[k], n });
  }
  leaks.sort((a, b) => b.n - a.n);

  /**
   * THE PATH THE FLOOD TOOK OUT. A leak position on its own says where the hole
   * is; the last twenty steps in to it say which way the player walked through
   * it, which is what tells a fix whether the missing thing is a wall, a block
   * or a cap.
   */
  const pathTo = (k) => {
    const out = [];
    let cur = k;
    for (let i = 0; i < pathLen && cur !== undefined && cur >= 0; i++) {
      const ci = nodeCell[cur];
      out.push([Math.round(lxOf(ci % nx)), Math.round(lzOf((ci / nx) | 0)), +nodeY[cur].toFixed(1), nodeSurf[cur]]);
      cur = pred.get(cur);
    }
    return out;
  };
  const leakPaths = [];
  for (const [k] of [...byCross.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) leakPaths.push(pathTo(k));

  /** Every reached cell inside a level-space window [x0,z0,x1,z1], for eyeballing. */
  let windowCells = null;
  if (win) {
    windowCells = [];
    for (const [, e] of reachedCell) {
      if (e.lx >= win[0] && e.lx <= win[2] && e.lz >= win[1] && e.lz <= win[3]) {
        windowCells.push([Math.round(e.lx * 10) / 10, Math.round(e.lz * 10) / 10, +e.y.toFixed(2), e.tag]);
      }
    }
  }

  return {
    engineSeed: window.__ENGINE__.levelSeed,
    rays,
    reached: reachedCell.size,
    reachedArea: +(reachedCell.size * CELL * CELL).toFixed(0),
    voidArea: +(voidCells.length * CELL * CELL).toFixed(0),
    regions: regions.slice(0, 8),
    regionCount: regions.length,
    leaks: leaks.slice(0, 10),
    leakCount: leaks.length,
    leakPaths,
    windowCells,
  };
}
