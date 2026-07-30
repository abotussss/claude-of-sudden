/**
 * Eye-level photography of the new middle and the two new base districts,
 * plus the cathedral salvo caught mid-collapse. Poses in LEVEL space (post 1.5x).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const URL = args.url ?? 'http://127.0.0.1:4220/';
const OUT = resolve(String(args.out ?? 'shots/cath'));
const ONLY = args.only ? String(args.only).split(',') : null;

const POSES = [
  { id: '01-cath-nave', from: [0, -20], atY: 1.78, look: [0, 18], lookAbs: 7.0, doc: 'down the nave from the narthex to the apse' },
  { id: '02-cath-crossing', from: [0, 8], atY: 1.78, look: [0, -20], lookAbs: 12.0, doc: 'the crossing and the rose window over the south portal' },
  { id: '03-cath-aisle', from: [-11.5, -10], atY: 1.78, look: [-11.5, 16], lookAbs: 2.4, doc: 'the west aisle, through the arcade' },
  { id: '04-cath-point', from: [0, -8], atY: 1.78, look: [0, 4], lookAbs: 2.6, doc: 'standing on capture point C, under the dome' },
  { id: '05-cath-gallery', from: [-11.5, -4], atY: 7.25, look: [0, 10], lookAbs: 2.0, doc: 'the gallery over the west aisle, looking down into the nave' },
  { id: '06-cath-altar', from: [0, 10], atY: 1.78, look: [0, 19], lookAbs: 2.6, doc: 'the choir screen and the altar platform' },
  { id: '07-cath-front', from: [0, -34], look: [0, -22], lookY: 11.0, doc: 'the south front, three portals and the rose, from the street' },
  { id: '08-cath-flank', from: [19, -22], look: [19, 12], lookY: 5.0, doc: 'the east flank street, buttresses and flyers' },
  { id: '09-cath-drone', from: [30, -40], atY: 26, look: [0, -3], lookAbs: 18, doc: 'the whole building from the south-east' },
  { id: '09b-cath-dome', from: [0, -40], atY: 22, look: [0, -2], lookAbs: 21, doc: 'the crossing dome and the campanile from the south' },
  { id: '10-street-wide', from: [0, 44], atY: 26, look: [0, -6], lookAbs: 10, doc: 'the widened mid boulevard, north end to the cathedral' },
  { id: '11-north-base', from: [0, 96], look: [0, 66], lookY: 3.0, doc: 'the attack base district: the N row and its two mouths' },
  { id: '12-zone-A', from: [0, 70], look: [0, 56], lookY: 1.2, doc: 'zone A in the north plaza, between W5 and E5' },
  { id: '13-zone-A-close', from: [3.5, 50], look: [0, 58], lookY: 1.0, doc: 'zone A from the cathedral side, over its screens' },
  { id: '14-south-base', from: [0, -100], look: [0, -70], lookY: 3.0, doc: 'the defence base district and the gate behind it' },
  { id: '15-zone-B', from: [0, -74], look: [0, -60], lookY: 1.2, doc: 'zone B in the south plaza, between W4 and E4' },
  { id: '16-district-drone', from: [0, 108], atY: 34, look: [0, 60], lookAbs: 8, doc: 'the north district from above: plaza, block row, spawn compound' },
];
/** Fired mid-shot: [id, delaySeconds]. */
const COLLAPSE = [
  { id: '20-collapse-flank', from: [22, -34], look: [16, -16], lookAbs: 8.0, at: 0.75, doc: 'CATH-W, three quarters of a second after it goes off' },
  { id: '21-collapse-wide', from: [34, -44], atY: 28, look: [2, -6], lookAbs: 12, at: 1.5, doc: 'the whole salvo in the air' },
  { id: '22-collapse-settled', from: [22, -30], look: [16, -14], lookAbs: 4.0, at: 8.0, doc: 'the mound in the flank street once it has settled' },
];

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    '--force-color-profile=srgb', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
});
const place = async (pose) => page.evaluate((p) => {
  const e = window.__ENGINE__, world = e.ctx.peek('world'), phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const floor = (lx, lz) => {
    const w = world.levelToWorld(lx, 0, lz, new V3());
    const h = phys.raycast(w.x, 40, w.z, 0, -1, 0, 80, phys.MASK.WORLD);
    w.y = h.hit ? h.point.y : 0; return w;
  };
  const from = floor(p.from[0], p.from[1]);
  const to = floor(p.look[0], p.look[1]);
  if (p.lookAbs !== undefined) to.y = p.lookAbs - (p.lookY ?? 1.2);
  const cam = e.camera;
  cam.position.set(from.x, p.atY !== undefined ? p.atY : from.y + (p.dy ?? 1.62), from.z);
  cam.lookAt(new V3(to.x, to.y + (p.lookY ?? 1.2), to.z));
  e.ctx.peek('player')?.teleport?.(cam.position, cam.rotation);
  return +from.y.toFixed(2);
}, pose);
const frames = (n) => page.evaluate((k) => new Promise((d) => {
  let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

mkdirSync(OUT, { recursive: true });
for (const p of POSES) {
  if (ONLY && !ONLY.includes(p.id)) continue;
  const y = await place(p);
  await frames(50);
  await page.screenshot({ path: `${OUT}/${p.id}.png`, type: 'png' });
  console.log(`  ${p.id.padEnd(22)} floor ${String(y).padStart(6)}  ${p.doc}`);
}

// ---- the salvo ----
if (!ONLY || ONLY.some((o) => o.startsWith('2'))) {
  const info = await page.evaluate(() => {
    const s = window.__ENGINE__.ctx.peek('match')?.airstrike;
    if (!s) return 'no airstrike';
    s.enabled = false;
    const g = s.salvos.find((x) => x.id === 'CATHEDRAL');
    if (!g) return 'no CATHEDRAL salvo';
    for (let i = 0; i < g.sites.length; i++) s.fire(g.sites[i].index, g);
    return `fired ${g.sites.map((x) => x.id).join('+')} — ${g.chunkCount} chunks`;
  });
  console.log(`  [salvo] ${info}`);
  let t = 0;
  for (const p of COLLAPSE) {
    if (ONLY && !ONLY.includes(p.id)) continue;
    await place(p);
    const wait = Math.max(1, Math.round((p.at - t) * 60));
    await frames(wait);
    t = p.at;
    await page.screenshot({ path: `${OUT}/${p.id}.png`, type: 'png' });
    console.log(`  ${p.id.padEnd(22)} t=${p.at}s  ${p.doc}`);
  }
}
if (errs.length) console.log('[shots] PAGE ERRORS', errs.slice(0, 8));
await browser.close();
process.exit(errs.length ? 1 : 0);
