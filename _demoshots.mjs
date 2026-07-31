/**
 * THE COLLAPSE, PHOTOGRAPHED — intact, mid-fall and settled, plus the cost of
 * the frame it fires on measured against its neighbours.
 *
 *   node _demoshots.mjs [url=http://127.0.0.1:4252/] [out=shots/demo]
 *
 * Poses are AUTHORED level units (widened, pre-1.5x), like `_look.mjs`.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const OUT = (args.find((a) => a.startsWith('out=')) ?? 'out=shots/demo').slice(4);
const URL = (args.find((a) => a.startsWith('url=')) ?? 'url=http://127.0.0.1:4252/').slice(4);
mkdirSync(OUT, { recursive: true });

/** id, camera (authored x,z), look-at (authored x,z), eye height, target height */
const POSES = [
  { id: 'NW6', from: [-79, 46], look: [-65, 46], eye: 2.0, aim: 6.0 },
  { id: 'NW6-close', site: 'NW6', from: [-72.5, 46], look: [-63, 46], eye: 1.7, aim: 2.5 },
  { id: 'NW6-high', site: 'NW6', from: [-76, 33], look: [-65, 46], eye: 13.0, aim: 3.0 },
  { id: 'NW1', from: [-81, 24], look: [-65, 24], eye: 2.0, aim: 6.0 },
  { id: 'WC6', from: [-73.5, 31], look: [-80.25, 22], eye: 2.0, aim: 3.5 },
];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--force-color-profile=srgb'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
const strikeLog = [];
page.on('console', (m) => {
  const t = m.text();
  if (/\[airstrike\] IMPACT|\[world\] demolition/.test(t)) strikeLog.push(t.slice(0, 220));
});

/** `down=1` boots with `?demo=down` and photographs the settled map only. */
const DOWN = args.includes('down=1');
await page.goto(`${URL}${DOWN ? '?demo=down&capture=1' : '?capture=1'}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
  // The scheduler must not drop a second building into the middle of a shot.
  const st = e.ctx.peek('match')?.airstrike;
  if (st) st.enabled = false;
  // A rolling frame-time sampler, so the fire frame can be read against its
  // neighbours rather than against a stopwatch.
  window.__FT__ = [];
  let last = performance.now();
  const tick = (t) => {
    window.__FT__.push(+(t - last).toFixed(2));
    if (window.__FT__.length > 4000) window.__FT__.shift();
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const reposeFn = (pose) => {
    const e = window.__ENGINE__;
    const world = e.ctx.peek('world');
    const phys = e.ctx.peek('physics');
    const V3 = e.camera.position.constructor;
    const S = 1.5;
    const at = (lx, lz) => {
      const w = world.levelToWorld(lx * S, 0, lz * S, new V3());
      const h = phys.raycast(w.x, 40, w.z, 0, -1, 0, 90, phys.MASK.WORLD);
      w.y = h.hit ? h.point.y : 0;
      return w;
    };
    const from = at(pose.from[0], pose.from[1]);
    const to = at(pose.look[0], pose.look[1]);
    const cam = e.camera;
    cam.position.set(from.x, from.y + pose.eye, from.z);
    cam.lookAt(new V3(to.x, pose.aim, to.z));
    e.ctx.peek('player')?.teleport?.(cam.position, cam.rotation);
};

const place = async (p) => {
  await page.evaluate(reposeFn, p);
  await page.waitForTimeout(700);
};

/**
 * The match respawns the player when a round starts and that moves the camera,
 * so the pose is re-applied immediately before every exposure rather than once
 * per building. Costs one evaluate; saves a shot of a spawn wall.
 */
const shot = async (name, pose) => {
  await page.evaluate(reposeFn, pose);
  await page.screenshot({ path: `${OUT}/${name}.png` });
};

const report = [];
for (const p of POSES) {
  const id = p.site ?? p.id;
  await place(p);
  await shot(`${p.id}-${DOWN ? '0-booted-down-pre' : '1-intact'}`, p);

  if (DOWN) {
    await shot(`${p.id}-0-booted-down`, p);
    continue;
  }
  const fired = await page.evaluate((sid) => {
    const st = window.__ENGINE__.ctx.peek('match').airstrike;
    const site = st.sites.find((s) => s.id === sid);
    if (!site || site.struck) return null;
    const mark = window.__FT__.length;
    st.fire(site.index);
    return { mark, chunks: site.chunkCount };
  }, id);
  if (!fired) {
    report.push(`${p.id}: already struck — no fire measured`);
    await page.waitForTimeout(200);
    await shot(`${p.id}-3-settled`, p);
    continue;
  }
  await page.waitForTimeout(620);
  await shot(`${p.id}-2-collapsing`, p);
  await page.waitForTimeout(500);
  await shot(`${p.id}-2b-collapsing`, p);
  await page.waitForTimeout(7100);
  await shot(`${p.id}-3-settled`, p);

  const ft = await page.evaluate((mark) => {
    const a = window.__FT__;
    return { around: a.slice(Math.max(0, mark - 6), mark + 7), mark };
  }, fired.mark);
  report.push(
    `${p.id}: ${fired.chunks} chunks · frames round the fire frame (ms) ` +
      ft.around.map((v, i) => (i === 6 ? `[${v}]` : `${v}`)).join(' ')
  );
}

console.log(`\n[demoshots] ${OUT}/`);
for (const l of strikeLog) console.log('   ', l);
console.log('');
for (const l of report) console.log('   ', l);
if (errs.length) console.log('\nPAGE ERRORS', errs);
await browser.close();
process.exit(errs.length ? 1 : 0);
