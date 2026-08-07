/**
 * Who zeroes the moon? `sky` computes moonLight.intensity = 0.129 at 21:40 (its
 * own published ambient is 0.9x that number and reads 0.1162), yet the light
 * arrives at the renderer at 0 and `_syncSun` therefore falls back to the
 * 4.3-intensity daylight sun. This reads the value straight after the sky writes
 * it, then again after a frame, and prints the renderer's culling record.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4603/?map=plains&capture=1';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const rec = () => p.evaluate(() => {
  const e = window.__ENGINE__, sky = e.ctx.peek('sky'), r = e.ctx.peek('render');
  const ent = r.lights.filter((l) => l.light === sky.moonLight || l.light === sky.sunLight)
    .map((l) => ({ name: l.light.name, base: l.baseIntensity, applied: l.applied, range: l.range, live: l.light.intensity, vis: l.light.visible }));
  return { moonI: sky.moonLight.intensity, sunI: sky.sunLight.intensity, entries: ent, activeSun: r.activeSun?.name };
});

console.log('as booted          ', JSON.stringify(await rec()));
await p.evaluate(() => window.__ENGINE__.ctx.peek('sky').setTimeOfDay(21.65));
console.log('right after setHour', JSON.stringify(await rec()));
await p.evaluate(() => new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d))));
console.log('after 2 frames     ', JSON.stringify(await rec()));
await p.evaluate(() => new Promise((d) => { let i = 0; const t = () => (++i > 60 ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
console.log('after 60 frames    ', JSON.stringify(await rec()));
await b.close();
