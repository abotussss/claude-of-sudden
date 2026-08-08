/**
 * THE RUBBLE SIZE THE OLD `towerMass` PRODUCED, measured the same way the live
 * one is measured by `_tzchunks.mjs`.
 *
 *   node _tzbefore.mjs
 *
 * `_buildMesh` composes each chunk's matrix with `scale = (hz*2, hy*2, hx*2)`
 * and the site has no scale of its own, so a chunk's drawn edges ARE the
 * `fracture` cell's extents. That makes this exact rather than an estimate: the
 * table below is the mass table at HEAD, run through the SAME `splits` the game
 * runs, with the tower's own fixed seed.
 */
import { splits } from './src/match/airstrike.js';
import { Rng } from './src/core/rng.js';

const SH_R = 6.5, SH_WALL = 0.95, ROOM_Y = 6.74, ROOF_Y = 25.8;
const FLOORS = [ROOM_Y, 11.6, 16.4, 21.2];
const CAB_R = 8.6, CAB_TOP = 31.0, MAST_TOP = 38.5;

/** VERBATIM from `plains-tower.js` at HEAD — only `y()` is dropped (unused here). */
function oldMass() {
  const n = (m, per = 1.6) => Math.max(1, Math.round(m / per));
  const t = SH_WALL;
  const W = SH_R * 2;
  const H = ROOF_Y - ROOM_Y;
  const parts = [
    { id: 'shaftXp', mat: 1, size: [t, H, W], cut: [1, n(H), n(W)] },
    { id: 'shaftXn', mat: 1, size: [t, H, W], cut: [1, n(H), n(W)] },
    { id: 'shaftZp', mat: 1, size: [W - t * 2, H, t], cut: [n(W), n(H), 1] },
    { id: 'shaftZn', mat: 1, size: [W - t * 2, H, t], cut: [n(W), n(H), 1] },
  ];
  for (let f = 1; f < FLOORS.length; f++) {
    parts.push({ id: `slab${f}`, mat: 1, size: [W - t * 2, 0.28, W - t * 2], cut: [n(W, 2.1), 1, n(W, 2.1)] });
  }
  parts.push({ id: 'roof', mat: 1, size: [W, 0.4, W], cut: [n(W, 2.1), 1, n(W, 2.1)] });
  parts.push({ id: 'cab', mat: 0, size: [CAB_R * 2, 3.2, CAB_R * 2], cut: [n(CAB_R * 2, 1.5), 3, n(CAB_R * 2, 1.5)] });
  parts.push({ id: 'cabroof', mat: 1, size: [CAB_R * 2, 0.34, CAB_R * 2], cut: [n(CAB_R * 2, 2.0), 1, n(CAB_R * 2, 2.0)] });
  parts.push({ id: 'mast', mat: 0, size: [1.5, MAST_TOP - CAB_TOP, 1.5], cut: [1, n(MAST_TOP - CAB_TOP, 1.4), 1] });
  return parts;
}

const rng = new Rng(0x7a11e2);
const edges = [];
for (const part of oldMass()) {
  // `_buildDemoSite` swaps x and z on the way into `fracture`; the SET of edge
  // lengths is unchanged by a relabelling, so it is measured as authored.
  const [dx, dy, dz] = part.size;
  const [nx, ny, nz] = part.cut;
  const bx = splits(nx, dx, rng), by = splits(ny, dy, rng), bz = splits(nz, dz, rng);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    edges.push(Math.max(bx[i + 1] - bx[i], by[j + 1] - by[j], bz[k + 1] - bz[k]));
  }
}
edges.sort((a, b) => a - b);
const q = (p) => +edges[Math.min(edges.length - 1, Math.floor(edges.length * p))].toFixed(2);
console.log(JSON.stringify({
  chunks: edges.length,
  longestEdge: { min: q(0), p25: q(0.25), median: q(0.5), p75: q(0.75), p95: q(0.95), max: q(0.999) },
  over1_5: edges.filter((x) => x > 1.5).length,
  over2_0: edges.filter((x) => x > 2.0).length,
}, null, 1));
