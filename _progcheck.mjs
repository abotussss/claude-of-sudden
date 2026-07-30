/**
 * PROGRAM COUNT — the load-bearing check for the team dress.
 *
 *   node _progcheck.mjs --port=4231
 *
 * `SoldierMaterials._attachShader` sets `customProgramCacheKey`, and the team
 * dress snippet is injected into EVERY character material rather than only the
 * garments precisely so that key does not have to change. This boots the game,
 * lets `prewarmMaterials` compile every character variant, spawns one man of
 * each so nothing is missed, and prints:
 *
 *   - `renderer.info.programs.length`
 *   - the cache keys of every program whose key names a character material
 *   - any pageerror
 *
 * Run it on this build and on the parent commit; the character program count has
 * to be the same number.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const PORT = Number(args.port ?? 4231);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/?capture=1&shot=hero`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const pump = (n) => page.evaluate((k) => new Promise((done) => {
  let i = 0;
  const t = () => (++i >= k ? done() : requestAnimationFrame(t));
  requestAnimationFrame(t);
}), n);

const read = () => page.evaluate(() => {
  const r = window.__ENGINE__.ctx.peek('render').renderer;
  const keys = [];
  for (const p of r.info.programs ?? []) {
    const k = String(p.cacheKey ?? '');
    // `customProgramCacheKey` is appended to three's own key; ours all start 'ai-'
    const m = k.match(/ai-[a-z0-9.\-]+/);
    if (m) keys.push(m[0]);
  }
  keys.sort();
  return { total: r.info.programs?.length ?? 0, character: keys.length, keys };
});

const atBoot = await read();
await pump(30);

/* Spawn one of every variant so nothing a match would build is missed. */
const afterSpawn = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const V3 = e.ctx.camera.position.constructor;
  ai.combatEnabled = false;
  ai.clearAgents();
  const cam = e.ctx.camera.position;
  let i = 0;
  for (const [v, team] of [['vanguard', 0], ['breacher', 0], ['irregular', 1]]) {
    ai.spawn(v, new V3(cam.x + 3 + i * 1.5, cam.y - 1.6, cam.z - 6), 0, { team, name: `P${i}`, role: 'rifleman' });
    i++;
  }
  return ai.agents.length;
});
await pump(60);
const settled = await read();

console.log(JSON.stringify({
  boot: { total: atBoot.total, character: atBoot.character },
  spawned: afterSpawn,
  settled: { total: settled.total, character: settled.character },
  characterKeys: [...new Set(settled.keys)].sort(),
  errors: errs,
}, null, 1));
await browser.close();
