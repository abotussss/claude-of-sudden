/**
 * ════════════════════════════════════════════════════════════════════════════
 * WHO TOOK THE GROUND AWAY? — the caller behind 「次元のはざまに落とされる」
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfvoidwho.mjs [--url=…] [--run=420] [--scale=8]
 *
 * `_nfvoid.mjs` proves the plain is whole at boot and full of holes at t = 420,
 * which narrows the cause to something that calls `StaticWorld.removeObject`
 * (or clears an object's triangles) DURING the match. There are several
 * candidates on this map — demolition takes blocks down, the armour ploughs prop
 * cells, the airstrike razes — and they belong to different agents, so the fix
 * cannot be routed until the caller is named rather than guessed.
 *
 * So: wrap `removeObject` before anything runs, and record for every call the
 * object id, its mesh name, its triangle count and the JS stack that made it.
 * Then the answer is a function name and a file, not a coordinate.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4624/?map=plains';
const RUN = Number(args.run ?? 420);
const SCALE = Number(args.scale ?? 8);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id=' + await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id));

/* ---- what is standing under the plain right now, by object ------------- */
const before = await p.evaluate(() => {
  const ph = window.__ENGINE__.ctx.peek('physics');
  const sw = ph.staticWorld;
  const raw = {};
  const hits = new Map();
  for (let z = -170; z <= 170; z += 2) {
    for (let x = -170; x <= 170; x += 2) {
      if (x * x + z * z > 170 * 170) continue;
      if (!sw.raycast(x, 140, z, 0, -1, 0, 260, ph.MASK.CHARACTER, raw)) continue;
      hits.set(raw.object, (hits.get(raw.object) ?? 0) + 1);
    }
  }
  const rows = [...hits].sort((a, b2) => b2[1] - a[1]).map(([id, n]) => {
    const o = sw.objects[id];
    return { id, n, name: o?.mesh?.name ?? o?.name ?? '(unnamed)', tris: o?.triCount ?? o?.count ?? null };
  });
  /* ---- and instrument the removal path -------------------------------- */
  window.__REMOVED__ = [];
  const orig = sw.removeObject.bind(sw);
  sw.removeObject = (id) => {
    const o = sw.objects[id];
    window.__REMOVED__.push({
      id,
      name: o?.mesh?.name ?? o?.name ?? '(unnamed)',
      stack: (new Error().stack ?? '').split('\n').slice(1, 5).join(' | '),
    });
    return orig(id);
  };
  return rows.slice(0, 25);
});
console.log('\n  what the plain stands on, by BVH object (2 m lattice, floor hits):');
for (const r of before) console.log(`    obj ${String(r.id).padStart(4)}  ${String(r.n).padStart(7)} floor cells   ${r.name}`);

await p.evaluate((s) => { window.__ENGINE__.ctx.time.scale = s; }, SCALE);
await p.waitForTimeout(Math.ceil((RUN / SCALE) * 1000));

const after = await p.evaluate(() => {
  const ph = window.__ENGINE__.ctx.peek('physics');
  const sw = ph.staticWorld;
  const raw = {};
  let gone = 0, tot = 0;
  const byObj = new Map();
  for (let z = -170; z <= 170; z += 2) {
    for (let x = -170; x <= 170; x += 2) {
      if (x * x + z * z > 170 * 170) continue;
      tot++;
      if (!sw.raycast(x, 140, z, 0, -1, 0, 260, ph.MASK.CHARACTER, raw)) { gone++; continue; }
      byObj.set(raw.object, (byObj.get(raw.object) ?? 0) + 1);
    }
  }
  const groups = new Map();
  for (const r of window.__REMOVED__) {
    const k = r.name + ' ||| ' + r.stack;
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  return {
    gone, tot,
    removed: window.__REMOVED__.length,
    groups: [...groups].sort((a, b2) => b2[1] - a[1]).slice(0, 12),
    floors: [...byObj].sort((a, b2) => b2[1] - a[1]).slice(0, 12).map(([id, n]) => ({
      id, n, name: sw.objects[id]?.mesh?.name ?? '(unnamed)',
    })),
    phase: window.__ENGINE__.ctx.peek('match')?.phase ?? '?',
  };
});
console.log(`\n  after ${RUN} s (phase=${after.phase}): ${after.gone} of ${after.tot} lattice cells have no floor`);
console.log(`  removeObject called ${after.removed} times. By object + caller:`);
for (const [k, n] of after.groups) {
  const [name, stack] = k.split(' ||| ');
  console.log(`    ${String(n).padStart(5)} x  ${name}`);
  console.log(`             ${stack}`);
}
console.log('\n  what is still holding the plain up:');
for (const r of after.floors) console.log(`    obj ${String(r.id).padStart(4)}  ${String(r.n).padStart(7)} floor cells   ${r.name}`);
console.log(errs.length ? `\n[pageerror] ${errs.length}: ${errs[0]}` : '\n[pageerror] none');
await b.close();
