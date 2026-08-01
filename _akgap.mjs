/**
 * PART ATTACHMENT MEASUREMENT.
 *
 * Every piece a weapon model hands to `Assembly.add` is recorded with its
 * transformed axis-aligned bounds and the ak.js line that authored it, then
 * every part is scored by the AABB gap to its NEAREST other part. A part whose
 * nearest neighbour is millimetres away is not attached to the weapon.
 *
 *   node partgap.mjs [ak|rifle|smg|sniper|pistol|knife|grenade]
 */
import * as THREE from 'three';
import { Assembly } from './src/weapons/geometry.js';

const ROOT = process.env.REPO;
const which = process.argv[2] ?? 'ak';

const rec = [];
let capture = null;
const origAdd = Assembly.prototype.add;
Assembly.prototype.add = function (geo, mat, t = null) {
  const g = geo.clone();
  if (t) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(t.x ?? 0, t.y ?? 0, t.z ?? 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0, 'XYZ')),
      new THREE.Vector3(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1)
    );
    g.applyMatrix4(m);
  }
  g.computeBoundingBox();
  rec.push({
    asm: this.name,
    mat,
    box: g.boundingBox.clone(),
    where: siteOf(new Error().stack),
  });
  g.dispose();
  return origAdd.call(this, geo, mat, t);
};

function siteOf(stack) {
  const lines = String(stack).split('\n');
  for (const l of lines) {
    const m = l.match(/\/(?:src\/weapons\/(?:models\/)?)?([a-z_]+\.m?js):(\d+):/);
    if (m && m[1] !== 'geometry.js' && m[1] !== '_akgap.mjs') return `${m[1]}:${m[2]}`;
  }
  return '?';
}

const mod = await import(
  which.endsWith('.mjs') || which.startsWith('./') ? which : `./src/weapons/models/${which}.js`
);
const build =
  mod[`build${which[0].toUpperCase()}${which.slice(1)}`] ??
  Object.values(mod).find((f) => typeof f === 'function');
const model = build();

/* Seat the moving assemblies exactly as Viewmodel._build does, so a magazine is
 * measured where it hangs and not at the origin. */
const seat = {
  magazine: model.nodes.magSeat,
  charging: model.nodes.chargeRest,
  bolt: model.nodes.boltRest,
  slide: model.nodes.slideRest,
  trigger: model.nodes.triggerPivot,
  selector: model.nodes.selectorPivot,
};
for (const r of rec) {
  for (const [key, node] of Object.entries(seat)) {
    if (!node) continue;
    const asm = model.moving?.[key];
    if (!asm || asm.name !== r.asm) continue;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(node.pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(node.rot)),
      new THREE.Vector3(1, 1, 1)
    );
    r.box.applyMatrix4(m);
  }
}

/** AABB-to-AABB gap; 0 when they overlap or touch. */
function gap(a, b) {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.hypot(dx, dy, dz);
}

/* CONNECTED COMPONENTS. A part that touches a part that touches the receiver is
 * attached; only a whole CLUSTER that touches nothing else is floating. Scoring
 * each part by its own nearest neighbour cannot see a four-piece front sight
 * assembly hanging together 43 mm above the barrel. */
const parent = rec.map((_, i) => i);
const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
const union = (a, b) => {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent[ra] = rb;
};
const TOUCH = 1e-4; // 0.1 mm
for (let i = 0; i < rec.length; i++) {
  for (let j = i + 1; j < rec.length; j++) {
    if (gap(rec[i].box, rec[j].box) <= TOUCH) union(i, j);
  }
}
const comps = new Map();
for (let i = 0; i < rec.length; i++) {
  const r = find(i);
  if (!comps.has(r)) comps.set(r, []);
  comps.get(r).push(i);
}
if (process.env.PAIRS) {
  for (const spec of process.env.PAIRS.split(';')) {
    const [a, b] = spec.split('->');
    const A = rec.filter((r) => r.where.endsWith(':' + a));
    const B = rec.filter((r) => r.where.endsWith(':' + b));
    let best = Infinity;
    for (const x of A) for (const y of B) best = Math.min(best, gap(x.box, y.box));
    console.log(`[pair] line ${a} (${A.length} part(s), ${A[0]?.mat}) -> line ${b} (${B.length} part(s), ${B[0]?.mat}) : ${(best * 1000).toFixed(2)} mm`);
  }
}
{
  let worst = 0; let over = 0; const rows = [];
  for (let i = 0; i < rec.length; i++) {
    let best = Infinity; let bj = -1;
    for (let j = 0; j < rec.length; j++) { if (i===j) continue; const g = gap(rec[i].box, rec[j].box); if (g < best) { best = g; bj = j; } }
    rows.push({ i, best, bj });
    if (best > worst) worst = best;
    if (best > 1e-4) over++;
  }
  rows.sort((a,b)=>b.best-a.best);
  console.log(`[perpart] every part's distance to its NEAREST neighbouring part:`);
  console.log(`[perpart]   worst ${(worst*1000).toFixed(2)} mm;  ${over} of ${rec.length} parts are further than 0.1 mm from anything`);
  for (const r of rows.slice(0, 8)) {
    if (r.best <= 1e-4) break;
    console.log(`[perpart]   ${(r.best*1000).toFixed(2).padStart(7)} mm  ${rec[r.i].where} ${rec[r.i].mat}  ->  ${rec[r.bj].where} ${rec[r.bj].mat}`);
  }
}
const mats=new Map();for(const r of rec)mats.set(r.mat,(mats.get(r.mat)||0)+1);console.log('[mats]',[...mats.keys()].sort().join(' '),'=',mats.size);
const groups = [...comps.values()].sort((a, b) => b.length - a.length);
console.log(`[partgap] ${which}: ${rec.length} parts, ${groups.length} connected clusters`);
for (let gi = 0; gi < groups.length; gi++) {
  const g = groups[gi];
  // distance from this cluster to the nearest part outside it
  let best = Infinity;
  let bestPair = null;
  for (const i of g) {
    for (let j = 0; j < rec.length; j++) {
      if (find(j) === find(i)) continue;
      const d = gap(rec[i].box, rec[j].box);
      if (d < best) {
        best = d;
        bestPair = [i, j];
      }
    }
  }
  const label = gi === 0 ? 'MAIN' : `float`;
  const mm = best === Infinity ? 0 : best * 1000;
  const who = g.map((i) => rec[i].where).join(' ');
  console.log(
    `  ${label.padEnd(5)} ${String(g.length).padStart(3)} part(s)  gap to rest of weapon ${mm
      .toFixed(2)
      .padStart(7)} mm` + (bestPair ? `  (${rec[bestPair[0]].where} -> ${rec[bestPair[1]].where})` : '')
  );
  if (gi > 0 || groups.length < 6) console.log(`        ${who}`);
  if (gi > 0) {
    const cand = [];
    for (const i of g)
      for (let j = 0; j < rec.length; j++) {
        if (find(j) === find(i)) continue;
        cand.push({ d: gap(rec[i].box, rec[j].box), a: rec[i].where, b: rec[j].where, m: rec[j].mat });
      }
    cand.sort((x, y) => x.d - y.d);
    const seen = new Set();
    for (const c of cand) {
      if (seen.has(c.b)) continue;
      seen.add(c.b);
      console.log(`          -> ${c.b} ${c.m}  ${(c.d * 1000).toFixed(2)} mm   (from ${c.a})`);
      if (seen.size >= 4) break;
    }
  }
}
