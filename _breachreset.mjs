/**
 * DOES THE WALL COME BACK? — the second half of the wiring gap.
 *
 * `world.breachAll(down)` is documented as "the round reset" and nothing in
 * `match` had ever called it, so the first shell that took an elevation off a
 * cache house took it off for the rest of the SESSION. This proves the call
 * that was added, and proves it against the collision world rather than against
 * a boolean: a ray is fired straight through the middle of the opening before,
 * during and after, on `MASK.CHARACTER` — the mask a man walks on.
 *
 *   node _breachreset.mjs [url] [seed]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4335/';
const SEED = process.argv[3] ?? '12';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const w = ctx.peek('world');
  const m = ctx.peek('match');
  const ph = ctx.peek('physics');
  const V3 = e.camera.position.constructor;

  // A ray across the elevation, 1.2 m up, from 2.5 m outside to 2.5 m inside.
  const solid = (br) => {
    const n = br.normal;
    const from = new V3(
      br.position.x + n.x * 2.5, br.position.y + 1.2, br.position.z + n.z * 2.5
    );
    const dir = new V3(-n.x, 0, -n.z).normalize();
    return !!ph.raycastAny(from.x, from.y, from.z, dir.x, dir.y, dir.z, 5, ph.MASK.CHARACTER);
  };

  const rows = [];
  const before = (w.breaches ?? []).map((br) => ({ id: br.id, down: br.down, solid: solid(br) }));

  // THE GAMEPLAY PATH, not `breach(id)`: the entry point `_mainGun` now fires.
  const target = w.breaches[0];
  const at = new V3(target.position.x, target.position.y + 1.2, target.position.z);
  const opened = w.damageAt(at, 1);
  const during = (w.breaches ?? []).map((br) => ({ id: br.id, down: br.down, solid: solid(br) }));

  // …and the second time, which must be null (already open) and change nothing.
  const again = w.damageAt(at, 1);
  // …and a hit that is under the bar.
  const weak = w.damageAt(new V3(w.breaches[1].position.x, w.breaches[1].position.y + 1.2,
    w.breaches[1].position.z), 0.4);

  // THE ROUND RESET — the real one.
  m._restartMatch();
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  const after = (w.breaches ?? []).map((br) => ({ id: br.id, down: br.down, solid: solid(br) }));

  return {
    n: w.breaches.length,
    opened: opened ? { id: opened.id, name: opened.name, holeW: opened.holeW, holeH: opened.holeH,
      reach: opened.reach, strength: opened.strength } : null,
    again: again ? again.id : null,
    weak: weak ? weak.id : null,
    before, during, after, rows,
  };
});

const line = (tag, rows) =>
  console.log(`  ${tag.padEnd(7)} ` + rows.map((r) => `${r.id}:${r.down ? 'OPEN' : 'shut'}/${r.solid ? 'solid' : 'THROUGH'}`).join('  '));

console.log(`\n=== breach reset, seed ${SEED} — ${out.n} breachable walls ===`);
console.log(`  damageAt(wall 0, strength 1) -> ${out.opened ? `${out.opened.name} (${out.opened.holeW.toFixed(1)}x${out.opened.holeH.toFixed(1)} m, reach ${out.opened.reach}, bar ${out.opened.strength})` : 'NULL'}`);
console.log(`  the same hit again          -> ${out.again ?? 'null (already open)'}`);
console.log(`  a hit at strength 0.4       -> ${out.weak ?? 'null (under the bar)'}`);
line('before', out.before);
line('during', out.during);
line('after', out.after);
const ok =
  out.opened && !out.again && !out.weak &&
  out.before.every((r) => !r.down && r.solid) &&
  out.during.some((r) => r.down && !r.solid) &&
  out.after.every((r) => !r.down && r.solid);
console.log(`\n  RESET RESTORES: ${ok ? 'YES' : 'NO'}`);
console.log(errs.length ? `pageerrors: ${errs}` : 'pageerror: none');
await b.close();
