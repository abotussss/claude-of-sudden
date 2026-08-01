/**
 * PHOTOGRAPH THE DROP. Park a camera off a zone the losing side holds, force one
 * reinforcement sortie, and shoot the helicopter, the canopies and the men on
 * the ground — because "it fired" is a console line and "you can see it" is a
 * different claim that has to be photographed.
 *
 * It also SMOKE TESTS the whole path in one run: the aircraft flies, ten canopies
 * open, ten Agents are created at touchdown, and every one of them carries
 * `noRespawn`. Those four counts are printed at the end.
 *
 *   node _dropshot.mjs [url] [seed]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.argv[2] ?? 'http://127.0.0.1:4294/';
const SEED = process.argv[3] ?? '11';
const OUT = 'shots/verify';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (/REINFORCEMENT|reinforce|medical/i.test(t)) logs.push(t);
});
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const frames = (n) =>
  page.evaluate(
    (k) =>
      new Promise((d) => {
        let i = 0;
        const t = () => (++i >= k ? d() : requestAnimationFrame(t));
        requestAnimationFrame(t);
      }),
    n
  );

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
});
// Let the match go live, then run it forward past `reinforceFirstDelay`.
await page.evaluate(
  () =>
    new Promise((done) => {
      const m = window.__ENGINE__.ctx.peek('match');
      window.__ENGINE__.time.scale = 10;
      const t = () => (m.phase === 'live' ? done() : requestAnimationFrame(t));
      t();
    })
);
await page.evaluate(
  () =>
    new Promise((done) => {
      const e = window.__ENGINE__;
      const m = e.ctx.peek('match');
      const want = m.roundClock - 130;
      const t = () => {
        // …and wait for the losing side to actually own something, so the drop
        // lands on a held zone rather than on a base cluster.
        const held = m.sites.some((z) => z.owner >= 0);
        if (m.roundClock <= want && held) {
          e.time.scale = 1;
          done();
        } else requestAnimationFrame(t);
      };
      t();
    })
);

/** Park the camera short of the drop zone, on the approach bearing. */
const aim = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  // Whichever side is behind is the one that will be given the drop.
  const team = m.score[0] <= m.score[1] ? 0 : 1;
  const zone = m._dropZone(team) ?? m.sites.find((z) => z.owner === team) ?? m.sites[0];
  window.__DROPTEAM__ = team;
  window.__DROPZONE__ = zone;
  const c = zone.position;
  const from = new V3(c.x + 30, 0, c.z + 30);
  const h = phys.raycast(from.x, 60, from.z, 0, -1, 0, 90, phys.MASK.WORLD);
  e.camera.position.set(from.x, (h.hit ? h.point.y : 0) + 1.62, from.z);
  e.camera.lookAt(new V3(c.x, 26, c.z));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  return { team, zone: zone.id, score: m.score.slice() };
});
console.log('drop side:', JSON.stringify(aim));

const place = () =>
  page.evaluate((up) => {
    const e = window.__ENGINE__;
    const V3 = e.camera.position.constructor;
    const c = window.__DROPZONE__.position;
    const r = e.ctx.peek('match').reinforce;
    // Track the aircraft while it is up, then settle on the ground it dropped on.
    const look = r?.run && up ? r.heli.matrix.elements : null;
    const tx = look ? look[12] : c.x;
    const ty = look ? look[13] : 2;
    const tz = look ? look[14] : c.z;
    e.camera.lookAt(new V3(tx, ty, tz));
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    return {
      busy: !!r?.run,
      out: r?.run?.out ?? 0,
      landed: r?.run?.landed ?? 0,
    };
  }, true);

await frames(20);
await page.screenshot({ path: `${OUT}/drop-00-before.png` });

const fired = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const t = 600 - m.roundClock;
  return m._callReinforcement(window.__DROPTEAM__, t, true, false);
});
console.log('fired:', fired);

/**
 * DRIVEN BY THE SORTIE, NOT BY A FRAME BUDGET. The first version stopped after
 * 480 frames and photographed ten men still under canopy — a drop is ~4.5 s of
 * run plus 0.85 s of freefall plus 46 m at `reinforceDescent`, which is over
 * eighteen seconds from the call to the last pair of boots. Loop until the run
 * clears itself, with a hard cap so a bug cannot hang the probe.
 */
for (let i = 1; i <= 60; i++) {
  await frames(22);
  const s = await place();
  await frames(2);
  if (i <= 24) await page.screenshot({ path: `${OUT}/drop-${String(i).padStart(2, '0')}.png` });
  console.log(`  t${i} busy=${s.busy} out=${s.out} landed=${s.landed}`);
  if (!s.busy && i > 4) break;
}
// One more once everybody is down and walking.
await frames(90);
await place();
await page.screenshot({ path: `${OUT}/drop-99-landed.png` });

const res = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const rein = m.roster.filter((r) => r.reinforcement);
  return {
    stats: m.reinforceStats,
    used: m._reinforceUsed,
    rosterTotal: m.roster.length,
    reinforcements: rein.length,
    allNoRespawn: rein.every((r) => r.noRespawn === true),
    aliveReinforcements: rein.filter((r) => r.alive).length,
    names: rein.map((r) => r.name),
    rosterSize: [m._rosterSize(0), m._rosterSize(1)],
    agents: m.ai.agents.filter((a) => a.alive).length,
  };
});
console.log(logs.join('\n'));
console.log(JSON.stringify(res, null, 1));
console.log(errs.length ? `[pageerror] ${errs.slice(0, 4).join(' | ')}` : '[pageerror] none');
await b.close();
