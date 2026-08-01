/** Which authored things live in a level-space window. */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true];
}));
const win = String(args.win ?? '55,-10,128,95').split(',').map(Number);
const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto(`${args.url ?? 'http://127.0.0.1:4279/'}?seed=${Number(args.seed ?? 12)}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const r = await page.evaluate((win) => {
  const w = window.__ENGINE__.ctx.peek('world');
  const L = w.layout;
  const hit = (x0, z0, x1, z1) => !(x1 < win[0] || x0 > win[2] || z1 < win[1] || z0 > win[3]);
  const bl = L.BUILDINGS.filter((b) => hit(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2))
    .map((b) => ({ id: b.id, x: b.x, z: b.z, w: b.w, d: b.d, floors: b.floors, groundH: b.groundH, enterable: !!b.enterable, skipSides: b.skipSides }));
  return { SCALE: L.SCALE, kerb: L.STREET.kerb, zMin: L.STREET.zMin, zMax: L.STREET.zMax,
    buildings: bl,
    alleys: (L.ALLEYS ?? []).filter((a) => hit(...a.rect)).map((a) => a.rect),
    flat: (L.FLAT ?? []).filter((f) => hit(...f)) };
}, win);
console.log(JSON.stringify(r, null, 1));
await browser.close();
