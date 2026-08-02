/**
 * WHAT GROUND DO THE BOMBER AND STRAFE LINES ACTUALLY HAVE, IN BOTH CATHEDRAL
 * STATES? — a boot-time measurement, no event fired.
 *
 *   node _runhost.mjs [--url=…] [--seed=N]
 *
 * Boots, prints every `[bomber]`/`[strafe]` boot line, then swaps the
 * cathedral's COLLISION (never `setRazed`, never `onRaze`) and re-probes:
 *   - every impact point of every run,
 *   - every debris/grit chunk's rest pose and settled pose,
 * reporting how far each moves and what is above/below it in each state.
 * Restores the level before it returns.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);
const URL = (args.url ?? 'http://127.0.0.1:4452/') + (args.seed ? `?seed=${args.seed}` : '');

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
const logs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => logs.push(m.text()));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const levelSeed = await page.evaluate(() => window.__ENGINE__?.levelSeed ?? null);

console.log(`\nRUNHOST  levelSeed=${levelSeed}  ${URL}`);
for (const l of logs) {
  if (/^\[(bomber|strafe)\]/.test(l)) console.log('  BOOT: ' + l);
}

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const w = e.ctx.peek('world');
  const m = e.ctx.peek('match');
  const k = w.cathedral;
  const MASK = ph.MASK.WORLD;
  const V3 = e.camera.position.constructor;
  const M4 = e.camera.matrixWorld.constructor;
  const mat = new M4();
  const pos = new V3();
  const sc = new V3();
  const q = e.camera.quaternion.clone();

  const g = (x, z, from = 60) => {
    const h = ph.groundHeight(x, z, from);
    return Number.isFinite(h) ? h : -99;
  };
  // What is the FIRST surface coming down from the sky at (x,z)?
  const roof = (x, z) => {
    const h = ph.raycast(x, 60, z, 0, -1, 0, 120, MASK);
    return h.hit ? h.point.y : NaN;
  };

  const probe = () => {
    const runs = [];
    for (const src of [
      { sys: m.bomber, key: 'debris', pts: (r) => r.bombs.map((b) => b.impact), tag: 'bomber' },
      { sys: m.strafe, key: 'grit', pts: (r) => r.impacts.map((p) => p.at), tag: 'strafe' },
    ]) {
      for (const r of src.sys?.runs ?? []) {
        const pts = src.pts(r).map((p) => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2), y: +p.y.toFixed(2), probe: +g(p.x, p.z).toFixed(2) }));
        const mesh = r[src.key];
        const rest = [];
        const settled = [];
        for (const [arr, into] of [[mesh.userData.rest, rest], [mesh.userData.settled, settled]]) {
          for (let i = 0; i < arr.length; i += 16) {
            mat.fromArray(arr, i);
            mat.decompose(pos, q, sc);
            into.push({
              i: i / 16,
              x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2),
              half: +(Math.max(sc.x, sc.y, sc.z) * 0.5).toFixed(3),
              // The first solid strictly BELOW this chunk's own underside — not
              // "the ground at this xz", which for a buried chunk is the surface
              // over its head and makes every burial read as resting on itself.
              gnd: +g(pos.x, pos.z, pos.y - Math.max(sc.x, sc.y, sc.z) * 0.5 - 0.01).toFixed(2),
              roof: +roof(pos.x, pos.z).toFixed(2),
            });
          }
        }
        runs.push({ tag: src.tag, id: r.id, pts, rest, settled });
      }
    }
    return runs;
  };

  // Every building on this map that can stop existing, swapped one at a time.
  const hosts = [];
  for (const rec of w.demolitions ?? []) {
    if (typeof rec.setCollision === 'function') hosts.push({ id: rec.id, set: (d) => rec.setCollision(d) });
  }
  if (k) hosts.push({ id: 'CATHEDRAL', set: (d) => k.setCollision(d, ph) });

  const before = probe();
  const perHost = [];
  for (const h of hosts) {
    h.set(true);
    const p = probe();
    h.set(false);
    let n = 0;
    const detail = [];
    for (let i = 0; i < before.length; i++) {
      for (let j = 0; j < before[i].pts.length; j++) {
        if (Math.abs(before[i].pts[j].probe - p[i].pts[j].probe) > 0.02) {
          n++;
          detail.push(`${before[i].tag}/${before[i].id}#${j} ${before[i].pts[j].probe}->${p[i].pts[j].probe}`);
        }
      }
    }
    perHost.push({ id: h.id, n, detail });
  }
  // All of them down at once: what is left standing under a run is permanent.
  for (const h of hosts) h.set(true);
  const allDown = probe();
  for (const h of hosts) h.set(false);
  /**
   * THE RAZED STATE AS THE GAME REACHES IT — the collision swapped AND the two
   * systems' own per-frame compare run, so what is measured is where the poses
   * end up rather than where the boot bake left them. `razed` is poked directly
   * instead of calling `setRazed`, which would fire `onRaze` and start the
   * cathedral's own two-thousand-chunk collapse inside a measurement.
   */
  k.setCollision(true, ph);
  const wasRazed = k.razed;
  k.razed = true;
  m.bomber?._syncHosts?.();
  m.strafe?._syncHosts?.();
  const razed = probe();
  k.razed = wasRazed;
  m.bomber?._syncHosts?.();
  m.strafe?._syncHosts?.();
  k.setCollision(false, ph);
  const after = probe();

  // sanity: restoring must give back exactly the standing numbers
  let drift = 0;
  for (let i = 0; i < before.length; i++) {
    for (let j = 0; j < before[i].pts.length; j++) {
      if (before[i].pts[j].probe !== after[i].pts[j].probe) drift++;
    }
  }
  return { before, razed, allDown, perHost, drift, razedFlag: k.razed };
});

console.log(`  restore drift: ${out.drift} (must be 0)   cathedral.razed=${out.razedFlag}`);
console.log('  per-host impact moves:');
for (const h of out.perHost) console.log(`    ${h.id.padEnd(12)} ${h.n}  ${h.detail.slice(0,8).join('  ')}`);
console.log('  impacts still above 3 m with EVERY perishable building down (= permanent roofs):');
for (let i = 0; i < out.before.length; i++) {
  const b = out.before[i], a = out.allDown[i];
  const hi = a.pts.map((p, j) => [j, p.probe]).filter(([, y]) => y > 3);
  console.log(`    ${b.tag}/${b.id}: ${hi.length}/${a.pts.length}  ${hi.map(([j, y]) => `#${j}=${y}`).join(' ')}`);
}
for (let i = 0; i < out.before.length; i++) {
  const b = out.before[i];
  const r = out.razed[i];
  const moved = b.pts.filter((p, j) => Math.abs(p.probe - r.pts[j].probe) > 0.02);
  console.log(
    `\n  ${b.tag} ${b.id}: ${b.pts.length} impacts, ${moved.length} move when the cathedral is razed`
  );
  for (let j = 0; j < b.pts.length; j++) {
    const p = b.pts[j];
    const rp = r.pts[j];
    const mv = Math.abs(p.probe - rp.probe) > 0.02;
    console.log(
      `     ${String(j).padStart(2)}  baked y ${String(p.y).padStart(7)}   standing ${String(p.probe).padStart(7)}` +
        `   razed ${String(rp.probe).padStart(7)}${mv ? '   <-- moves ' + (rp.probe - p.probe).toFixed(2) + ' m' : ''}`
    );
  }
  for (const [name, key] of [['rest', 'rest'], ['settled', 'settled']]) {
    const bs = b[key];
    const rs = r[key];
    // Each state judged against its OWN ground and its OWN poses.
    const air = (a) => a.filter((c) => c.y - c.half > c.gnd + 1.5);
    const open = (a) => air(a).filter((c) => !(c.roof > c.y + c.half - 0.01));
    const sky = open(bs);
    const skyRazed = open(rs);
    console.log(
      `     ${name}: ${bs.length} chunks · ` +
        `STANDING ${air(bs).length} with >1.5 m of air, ${sky.length} of them in OPEN SKY · ` +
        `RAZED ${air(rs).length} with >1.5 m of air, ${skyRazed.length} of them in OPEN SKY`
    );
    if (sky.length || skyRazed.length) {
      const s = (sky.length ? sky : skyRazed).slice().sort((x, y2) => y2.y - x.y).slice(0, 4);
      for (const c of s) {
        console.log(
          `        eg #${c.i} at ${c.x}, ${c.y}, ${c.z}  half ${c.half}  next solid below ${c.gnd}  first surface from the sky ${c.roof}`
        );
      }
    }
  }
}
if (errs.length) console.log('PAGE ERRORS', errs.slice(0, 4));
await browser.close();
