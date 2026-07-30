/**
 * DRIVE THE HUMAN ONTO A CAPTURE POINT, and prove the bar fills and the point
 * flips — with real keyboard input, at real time scale, reading the answer back
 * off the HUD's own DOM rather than off the state that feeds it.
 *
 *   node _domplayer.mjs [--url=…] [--shot=shots/domination-hud.png]
 *
 * The bots are FROZEN for the measurement (`ai.combatEnabled = false`) and the
 * player is given indefinite spawn protection (`ai.protect`, a documented hook),
 * so the capture that happens can only be the human's: the chosen zone is one
 * with zero bodies of either side in it, and the head count is logged every
 * 200 ms to prove it stays that way.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4210/';
const SHOT = args.shot ?? 'shots/domination-hud.png';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message)));

console.log(`[player] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

// Get to a live round quickly, then run the capture itself at real time.
await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(
  () => window.__ENGINE__.ctx.peek('match').phase === 'live',
  null,
  { timeout: 120000 }
);
await page.waitForTimeout(2000);
await page.evaluate(() => { window.__ENGINE__.time.scale = 1; });

// Freeze the bots and protect the player, then put him just OUTSIDE an empty
// zone he does not own, facing it.
const setup = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  ai.combatEnabled = false;
  ai.protect(m.player, 600);
  const me = m.playerTeam;
  let zone = null;
  for (const z of m.sites) {
    if (z.owner === me) continue;
    if (z.counts[0] || z.counts[1]) continue;
    zone = z;
    break;
  }
  if (!zone) return { ok: false, reason: 'no empty zone that is not already ours' };
  /**
   * A staging point OUTSIDE the circle with a clear STRAIGHT walk into it. The
   * first version aimed at the bearing of the player's own base, which for the
   * two courtyards runs straight through the west/east building row: the player
   * walked 4.5 m, hit a wall and stood there for fifty seconds. Every bearing is
   * tried and the segment is sampled metre by metre against the nav grid, because
   * holding W is a straight line and nothing here steers.
   */
  const clear = (x0, z0, x1, z1, y) => {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(2, Math.ceil(d));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const px = x0 + (x1 - x0) * f;
      const pz = z0 + (z1 - z0) * f;
      if (ai.grid.nearest(px, pz, y, 1, 1.2) < 0) return false;
    }
    return true;
  };
  let placed = null;
  for (let i = 0; i < 36 && !placed; i++) {
    const th = (i / 36) * Math.PI * 2;
    const r = zone.radius + 4;
    const x = zone.position.x + Math.cos(th) * r;
    const z2 = zone.position.z + Math.sin(th) * r;
    const y = ai.groundAt(x, z2, zone.position.y + 4);
    if (!Number.isFinite(y)) continue;
    if (ai.grid.nearest(x, z2, y, 2, 1.2) < 0) continue;
    if (!clear(x, z2, zone.position.x, zone.position.z, zone.position.y)) continue;
    placed = { x, y, z: z2, yaw: Math.atan2(zone.position.x - x, -(zone.position.z - z2)) + Math.PI };
  }
  if (!placed) return { ok: false, reason: 'no walkable ground outside the zone' };
  const v = new (Object.getPrototypeOf(zone.position).constructor)(placed.x, placed.y, placed.z);
  m.player.respawnAt(v, placed.yaw);
  return {
    ok: true,
    zone: zone.id,
    owner: zone.owner,
    radius: zone.radius,
    startDist: +Math.hypot(placed.x - zone.position.x, placed.z - zone.position.z).toFixed(2),
  };
});
console.log('[player] setup', JSON.stringify(setup));
if (!setup.ok) {
  console.log('[player] FAIL — could not stage the run');
  await browser.close();
  process.exit(2);
}

// Real input. Keydown does not need pointer lock — only mouse look does.
await page.click('canvas', { position: { x: 800, y: 450 } }).catch(() => {});
await page.keyboard.down('KeyW');

const read = (zoneId) =>
  page.evaluate((id) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const ui = e.ctx.peek('ui');
    const i = m.sites.findIndex((z) => z.id === id);
    const z = m.sites[i];
    const hud = ui.round?.zones?.[i] ?? null;
    const chip = ui.zoneStrip?.chips?.[i] ?? null;
    return {
      t: +e.time.elapsed.toFixed(2),
      dist: +Math.hypot(m.player.position.x - z.position.x, m.player.position.z - z.position.z).toFixed(2),
      inside: !!(m.capture.zoneAt(m.player.position) === z),
      counts: [...z.counts],
      progress: +z.progress.toFixed(3),
      capTeam: z.capTeam,
      owner: z.owner,
      contested: z.contested,
      hud: hud ? { owner: hud.owner, progress: +hud.progress.toFixed(3), capture: hud.capture, here: hud.here, mine: hud.mine } : null,
      dom: chip
        ? {
            letter: chip.letter.textContent,
            count: chip.count.textContent,
            fill: chip.fill.style.transform,
            boxed: chip.root.style.borderColor,
          }
        : null,
    };
  }, zoneId);

const myTeam = await page.evaluate(() => window.__ENGINE__.ctx.peek('match').playerTeam);
const series = [];
let flipped = false;
let peak = 0;
let walking = true;
for (let i = 0; i < 160; i++) {
  const s = await read(setup.zone);
  series.push(s);
  peak = Math.max(peak, s.progress);
  // Holding W for ever walks him THROUGH the circle and out the far side — the
  // bar reached 0.399 and then decayed while he stood against the opposite wall.
  // Stop at the middle and let presence do the work.
  if (walking && s.inside && s.dist < setup.radius * 0.4) {
    await page.keyboard.up('KeyW');
    walking = false;
  }
  if (s.owner === myTeam) {
    flipped = true;
    series.push(await read(setup.zone));
    break;
  }
  await page.waitForTimeout(200);
}
if (walking) await page.keyboard.up('KeyW');

console.log('\n[player] t      dist inside counts prog cap own | HUD owner/prog/here | DOM count fill');
for (const s of series) {
  console.log(
    `  ${String(s.t).padStart(7)} ${String(s.dist).padStart(6)} ${s.inside ? 'IN ' : 'out'} ` +
      `${s.counts.join('/')}   ${String(s.progress).padStart(5)} ${String(s.capTeam).padStart(2)} ${String(s.owner).padStart(3)} | ` +
      `${s.hud?.owner}/${s.hud?.progress}/${s.hud?.here ? 'HERE' : '-'} | ` +
      `"${s.dom?.count}" ${s.dom?.fill}`
  );
}

await page.screenshot({ path: SHOT });
const hudText = await page.evaluate(() => {
  const ui = window.__ENGINE__.ctx.peek('ui');
  return {
    matchBar: ui.matchBar?.root?.innerText ?? null,
    roundPhase: ui.roundStrip?.phase?.textContent ?? null,
    roundAlert: ui.roundStrip?.alert?.textContent ?? null,
    zoneStrip: ui.zoneStrip?.root?.innerText?.replace(/\n/g, ' | ') ?? null,
    zoneStripVisible: ui.zoneStrip?.root?.style?.display ?? null,
    bombPanelDisplay: ui.bombPanel?.root?.style?.display ?? null,
    promptDisplay: ui.prompt?.root?.style?.display ?? null,
  };
});
console.log('\n[player] HUD read back');
console.log(JSON.stringify(hudText, null, 2));
console.log(`\n[player] screenshot -> ${SHOT}`);
console.log(
  `[player] ${flipped ? "PASS" : "FAIL"} — peak bar ${peak.toFixed(3)}, zone ${setup.zone} ` +
    `owner ${series[series.length - 1].owner} (player team ` +
    `${await page.evaluate(() => window.__ENGINE__.ctx.peek('match').playerTeam)})`
);
console.log('[player] page errors', errors.slice(0, 6));
await browser.close();
process.exit(flipped && !errors.length ? 0 : 1);
