/**
 * THE PICTURE THAT MATTERS — a civilian photographed WHERE HE ACTUALLY LIVES.
 *
 *   node _civroom.mjs --port=4485 --tag=now
 *
 * `_civread.mjs` stages the four-way comparison on an open street, which is the
 * controlled test. This is the uncontrolled one: it lets the match place its own
 * civilians in its own buildings, then walks the camera to a real one and takes
 * the shot from the range and in the light a room is actually fought in.
 *
 * For every civilian it can reach it writes one PNG from ~5.5 m, and — because
 * the whole mechanic is a comparison — it also stages the OTHER kind beside him
 * so the pair can be read against each other in the same interior light.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const PORT = Number(args.port ?? 4485);
const TAG = args.tag ?? 'now';
const DIR = 'shots/civroom';
mkdirSync(DIR, { recursive: true });

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
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 6; });

const pump = (n) => page.evaluate((k) => new Promise((done) => {
  let i = 0;
  const t = () => (++i >= k ? done() : requestAnimationFrame(t));
  requestAnimationFrame(t);
}), n);

for (let i = 0; i < 16; i++) {
  const n = await page.evaluate(() => {
    const c = window.__ENGINE__.ctx.peek('match')?.civilians;
    let a = 0, u = 0;
    for (const r of c?.list ?? []) if (r.agent.alive) { if (r.unarmed) u++; else a++; }
    return [a, u];
  });
  if (n[0] >= 2 && n[1] >= 1) { console.log(`have ${n[0]} armed / ${n[1]} unarmed on the map`); break; }
  await pump(200);
}

/**
 * Freeze the world, then for each live civilian: put a twin of the OTHER kind
 * on the nearest room cell 1.4 m to his side, walk the camera to 5.5 m in the
 * doorway direction, and take the shot.
 */
const shots = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const ai = ctx.peek('ai');
  const phys = ctx.peek('physics');
  const player = ctx.peek('player');
  const m = ctx.peek('match');
  const V3 = ctx.camera.position.constructor;
  e.input.frozen = true;
  e.input.enabled = false;
  ai.combatEnabled = false;
  e.time.scale = 0.02;

  const g = ai.grid;
  const out = [];
  window.__PAIRS__ = [];
  for (const rec of m.civilians.list) {
    if (!rec.agent.alive) continue;
    const a = rec.agent;
    // A twin of the other kind, 1.4 m to one side, on a real room cell.
    let twin = null;
    for (let d = 0; d < 12 && !twin; d++) {
      const th = (d / 12) * Math.PI * 2;
      const tx = a.position.x + Math.sin(th) * 1.5;
      const tz = a.position.z + Math.cos(th) * 1.5;
      const i = g.nearest(tx, tz, a.position.y, 2, 1.0);
      if (i < 0 || !g.indoor || g.indoor[i] !== 1) continue;
      twin = new V3(g.worldX(i % g.nx), g.floor[i], g.worldZ((i / g.nx) | 0));
    }
    if (!twin) continue;
    /**
     * AN EYE IN THE SAME ROOM. The first run only asked for a clear sight line
     * and got two pictures taken from the street through a doorway and a window
     * — honest, but not the shot: what the mechanic is about is the moment the
     * player is INSIDE with them, in interior light, at the width of a room. So
     * the eye cell has to be `indoor` too.
     */
    let eye = null;
    for (const reach of [5.5, 4.5, 6.5, 3.6]) {
      for (let d = 0; d < 48 && !eye; d++) {
        const th = (d / 48) * Math.PI * 2;
        const px = a.position.x + Math.sin(th) * reach;
        const pz = a.position.z + Math.cos(th) * reach;
        const ci = g.nearest(px, pz, a.position.y, 1, 1.0);
        if (ci < 0 || !g.indoor || g.indoor[ci] !== 1) continue;
        const p = new V3(g.worldX(ci % g.nx), g.floor[ci] + 1.62, g.worldZ((ci / g.nx) | 0));
        const q1 = new V3(a.position.x, a.position.y + 1.35, a.position.z);
        const q2 = new V3(twin.x, twin.y + 1.35, twin.z);
        if (p.distanceTo(q1) < 2.5) continue;
        if (phys.lineOfSight(p, q1, phys.MASK.SIGHT) && phys.lineOfSight(p, q2, phys.MASK.SIGHT)) eye = p;
      }
      if (eye) break;
    }
    if (!eye) continue;
    const yawToEye = Math.atan2(eye.x - twin.x, eye.z - twin.z);
    const other = ai.spawn(
      rec.unarmed ? 'civilArmed' : 'civilUnarmed',
      twin, yawToEye,
      { team: a.team, name: rec.unarmed ? 'MILITIA' : 'CIVILIAN',
        role: rec.unarmed ? 'civil' : 'civilUnarmed' }
    );
    a.yaw = Math.atan2(eye.x - a.position.x, eye.z - a.position.z);
    window.__PAIRS__.push({ eye, look: new V3(a.position.x, a.position.y + 1.3, a.position.z) });
    out.push({ kind: rec.unarmed ? 'unarmed+armed' : 'armed+unarmed', staged: other.variantName });
    if (out.length >= 4) break;
  }
  window.__GO__ = (k) => {
    const p = window.__PAIRS__[k];
    ctx.camera.position.copy(p.eye);
    ctx.camera.lookAt(p.look);
    ctx.camera.updateMatrixWorld(true);
    player.teleport?.(ctx.camera.position, ctx.camera.rotation);
    e.time.scale = 0.02;
  };
  return out;
});
console.log('staged pairs:', JSON.stringify(shots));

for (let k = 0; k < shots.length; k++) {
  await page.evaluate((i) => window.__GO__(i), k);
  await pump(50);
  const path = `${DIR}/${TAG}-${k}-${shots[k].kind}.png`;
  await page.screenshot({ path });
  console.log('wrote', path);
}
/**
 * AND THE RECEIPT. Kill the staged unarmed civilian with the local player as
 * the source and photograph what the player is told — which must be AFTER the
 * fact and must be the only thing this whole feature ever puts on his HUD.
 */
const receipt = await page.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const m = ctx.peek('match');
  const ai = ctx.peek('ai');
  const player = ctx.peek('player');
  const target = ai.agents.find((a) => a.alive && a.aiPacifist === true);
  if (!target) return { err: 'no unarmed civilian left' };
  ctx.camera.lookAt(target.position.x, target.position.y + 1.3, target.position.z);
  ctx.camera.updateMatrixWorld(true);
  if (m.capture.score[m.playerTeam] < 40) m.capture.score[m.playerTeam] = 40;
  const before = m.capture.score[m.playerTeam];
  target.applyDamage(400, 'torso', target.position.clone(), null, player);
  const ui = ctx.peek('ui');
  return {
    before, after: m.capture.score[m.playerTeam],
    banner: `${ui?.banner?.title?.textContent ?? ''} / ${ui?.banner?.sub?.textContent ?? ''}`,
  };
});
console.log('RECEIPT', JSON.stringify(receipt));
await pump(8);
await page.screenshot({ path: `${DIR}/${TAG}-receipt.png` });
console.log('wrote', `${DIR}/${TAG}-receipt.png`);

console.log(errs.length ? `ERRORS: ${errs.slice(0, 4).join(' | ')}` : 'no pageerrors');
await browser.close();
