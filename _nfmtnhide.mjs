/**
 * THE BLACK OVER OSTKEHLE'S TRENCH FLOOR, REPRODUCED RATHER THAN ACCEPTED.
 *
 *   node _nfmtnhide.mjs [--url=…] [--at=82,-100] [--pitch=0,35,89]
 *
 * A second agent reported that hiding `world_mountain_lit` clears the whole
 * frame from an eye on OSTKEHLE's trench floor. `_nfmtnlit.mjs` measured that
 * batch and it is 17 600 triangles of boulder, none bigger than 0.59 m², none
 * lower than y 3.7 m, in a ring out at the rim — so it cannot be a lid over a
 * floor 90 m inside it, and the claim and the geometry disagree.
 *
 * A disagreement between a photograph and a measurement is settled by taking the
 * photograph again with the measurement's question attached. This stands at that
 * eye and shoots the SAME frame four times — everything on; `world_mountain_lit`
 * off; `world_mountain_rock` off; both off — at each pitch given, including
 * straight up. If the black is a lid, it is still there at pitch 89 with the
 * mountain hidden. If it is the rim seen from a hole, it is gone at pitch 89 in
 * every one of the four.
 *
 * It also prints, per shot, the mean luminance of the frame and of its top
 * third, so "black" is a number rather than an impression, and the horizontal
 * distance from the eye to the nearest vertex of each batch.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4615/?map=plains&capture=1';
const AT = String(args.at ?? '82,-100').split(',').map(Number);
const PITCH = String(args.pitch ?? '0,35,89').split(',').map(Number);
const OUT = args.out ?? 'shots/mtnhide';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 960, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('  level =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

await p.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
});
const frames = (n) => p.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

const near = await p.evaluate(([ax, az]) => {
  const e = window.__ENGINE__;
  const out = {};
  e.scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !/^world_mountain/.test(o.name)) return;
    const pa = o.geometry.getAttribute('position');
    let best = 1e9, lowest = 1e9;
    for (let i = 0; i < pa.count; i++) {
      const d = Math.hypot(pa.getX(i) - ax, pa.getZ(i) - az);
      if (d < best) best = d;
      if (pa.getY(i) < lowest) lowest = pa.getY(i);
    }
    out[o.name] = { nearest: +best.toFixed(1), lowestY: +lowest.toFixed(1) };
  });
  const ph = e.ctx.peek('physics');
  const h = ph.raycast(ax, 300, az, 0, -1, 0, 400, ph.MASK.WORLD);
  out._floorY = h.hit ? +h.point.y.toFixed(2) : null;
  // straight up, against collision, from a standing eye on that floor
  const up = ph.raycast(ax, (h.hit ? h.point.y : 0) + 1.62, az, 0, 1, 0, 120, ph.MASK.WORLD);
  out._upHit = up.hit ? +up.point.y.toFixed(2) : 'none within 120 m';
  return out;
}, AT);
console.log('  nearest vertex of each mountain batch to the eye, and its lowest vertex:');
for (const [k, v] of Object.entries(near)) {
  if (k.startsWith('_')) continue;
  console.log(`    ${k.padEnd(22)} nearest ${String(v.nearest).padStart(7)} m   lowest y ${v.lowestY}`);
}
console.log(`    trench floor y ${near._floorY}   ray straight up hits: ${near._upHit}`);

const CASES = [
  ['all-on', []],
  ['no-mountain_lit', ['world_mountain_lit']],
  ['no-mountain_rock', ['world_mountain_rock']],
  ['no-both', ['world_mountain_lit', 'world_mountain_rock']],
];

for (const pitch of PITCH) {
  for (const [tag, hide] of CASES) {
    const lum = await p.evaluate(([ax, az, pitch, hide]) => {
      const e = window.__ENGINE__, ph = e.ctx.peek('physics');
      e.scene.traverse((o) => { if (o.isMesh && /^world_mountain/.test(o.name)) o.visible = !hide.includes(o.name); });
      const h = ph.raycast(ax, 300, az, 0, -1, 0, 400, ph.MASK.WORLD);
      const y = (h.hit ? h.point.y : 0) + 1.62;
      /**
       * TAKE THE CAMERA OFF THE PLAYER FIRST, then put the player under the
       * camera — the pattern `src/dev/shots.js` uses and the one this probe's
       * first run did not. Setting `camera.position` alone lasts exactly until
       * the next frame, when the player system writes its own transform back
       * over it; the first run of this probe photographed wherever the player
       * happened to be and reported it as the trench floor, which is the same
       * error that invalidated the bisect this is checking.
       */
      const pl = e.ctx.peek('player');
      pl?.setControlEnabled?.(false);
      e.camera.position.set(ax, y, az);
      e.camera.rotation.set(pitch * Math.PI / 180, 0, 0, 'YXZ');
      pl?.teleport?.(e.camera.position, e.camera.rotation);
      e.camera.position.set(ax, y, az);
      e.camera.rotation.set(pitch * Math.PI / 180, 0, 0, 'YXZ');
      return null;
    }, [AT[0], AT[1], pitch, hide]);
    await frames(6);
    await p.evaluate(([ax, az, pitch]) => {
      const e = window.__ENGINE__, ph = e.ctx.peek('physics');
      const h = ph.raycast(ax, 300, az, 0, -1, 0, 400, ph.MASK.WORLD);
      e.camera.position.set(ax, (h.hit ? h.point.y : 0) + 1.62, az);
      e.camera.rotation.set(pitch * Math.PI / 180, 0, 0, 'YXZ');
    }, [AT[0], AT[1], pitch]);
    await frames(2);
    const buf = await p.screenshot({ path: `${OUT}/p${pitch}-${tag}.png` });
    // mean luminance of the frame and of its top third, straight off the PNG
    const png = (await import('pngjs')).PNG.sync.read(buf);
    let all = 0, top = 0, nTop = 0;
    for (let yy = 0; yy < png.height; yy++) {
      for (let xx = 0; xx < png.width; xx++) {
        const i = (yy * png.width + xx) * 4;
        const l = 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
        all += l;
        if (yy < png.height / 3) { top += l; nTop++; }
      }
    }
    console.log(`  pitch ${String(pitch).padStart(2)}°  ${tag.padEnd(18)} mean ${(all / (png.width * png.height)).toFixed(1)}  top-third ${(top / nTop).toFixed(1)}`);
  }
}
console.log(errs.length ? `PAGEERRORS: ${errs[0]}` : '0 pageerrors');
await b.close();
