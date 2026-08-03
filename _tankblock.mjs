/**
 * CAN YOU STILL WALK THROUGH THE TANK?
 *
 * 「戦車への物理判定つけて、キャラが通り過ぎることが可能なので」. Three measurements,
 * all against a hull that is really on the field:
 *
 *   PLAYER   teleport him onto the hull centre and ask where he ends up, then
 *            walk him at it for two seconds and ask how deep he got. The old
 *            build put him at the centre and left him there.
 *   BOTS     count men whose feet are inside a hull's plan rectangle, every
 *            frame, for the whole sortie. Also the closest anybody got.
 *   NOBODY WEDGED  every man's travel over the run, and how many were run over.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4500/';
const SPEED = Number(process.argv[3] ?? 6);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const res = await page.evaluate(async (SPEED) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  const pl = e.ctx.peek('player');
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  e.ctx.time.scale = SPEED;
  while (m.phase !== 'live') await frame();
  const armour = m.tank;
  armour.fire();
  for (let i = 0; i < 40; i++) await frame();
  const t = armour.tanks.find((x) => x.state !== 'parked');
  if (!t) return { error: 'no hull rolled' };

  const inside = (x, z, y, v, pad = 0) => {
    const dx = x - v.position.x, dz = z - v.position.z;
    const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const rel = y - v.position.y;
    if (rel > v.bodyHigh || rel + 1.7 < v.bodyLow) return false;
    return Math.abs(lx) < v.halfW - pad && Math.abs(lz) < v.halfL - pad;
  };

  /* ---- the player, dropped on the hull centre ------------------------- */
  const hp = () => Math.round(Number(pl.health?.value ?? pl.health) || 0);
  const local = (x, z, y, v) => {
    const dx = x - v.position.x, dz = z - v.position.z;
    const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
    return { lx: +(dx * c - dz * s).toFixed(2), lz: +(dx * s + dz * c).toFixed(2), y: +(y - v.position.y).toFixed(2) };
  };
  pl.teleport({ x: t.position.x, y: t.position.y + 1.6, z: t.position.z }, 0);
  const trail = [];
  for (let i = 0; i < 10; i++) {
    await frame();
    const f0 = pl.feetPosition;
    trail.push({ f: i, ...local(f0.x, f0.z, f0.y, t), in: inside(f0.x, f0.z, f0.y, t), hp: hp() });
  }
  const f = pl.feetPosition;
  const player = {
    startedInside: true,
    ejectedByFrame: trail.findIndex((r) => !r.in),
    endInside: inside(f.x, f.z, f.y, t),
    health: hp(), dead: !!pl.dead,
    halfW: +t.halfW.toFixed(2), halfL: +t.halfL.toFixed(2),
    trail,
  };

  /* ---- …and the player WALKING into it, which is the real complaint ---- */
  // 4.8 m/s straight at the hull's flank, driven through the same controller
  // `Movement.step` uses. Measures how deep into the plan rectangle he gets.
  let deepest = 0, everIn = 0;
  for (let i = 0; i < 90; i++) {
    const c2 = pl.character;
    const dx = t.position.x - c2.position.x;
    const dz = t.position.z - c2.position.z;
    const d = Math.hypot(dx, dz) || 1;
    c2.move((dx / d) * 0.08, 0, (dz / d) * 0.08);
    pl.feetPosition.set(c2.position.x, c2.position.y, c2.position.z);
    await frame();
    const p2 = local(c2.position.x, c2.position.z, c2.position.y, t);
    if (inside(c2.position.x, c2.position.z, c2.position.y, t)) {
      everIn++;
      const pen = Math.min(t.halfW - Math.abs(p2.lx), t.halfL - Math.abs(p2.lz));
      if (pen > deepest) deepest = pen;
    }
  }
  player.walkIn = { frames: 90, framesInsideHull: everIn, deepest: +deepest.toFixed(2), health: hp() };

  /* ---- the bots, for the rest of the sortie ---------------------------- */
  const start = new Map();
  for (const a of ai.agents) if (a.alive) start.set(a.name, { x: a.position.x, z: a.position.z });
  let frames = 0, manFramesInside = 0, worstMen = 0, nearest = 1e9, crushKills = 0;
  const kills0 = armour.tanks.reduce((n, x) => n + x.stats.kills, 0);
  // A kill under the tracks vs. a kill down the barrel: measured by range.
  const byRange = { under4m: 0, over4m: 0 };
  e.ctx.events.on('actor:death', (ev) => {
    const by = ev?.by;
    if (!by?.isTank || !ev.actor?.position) return;
    const d = Math.hypot(ev.actor.position.x - by.position.x, ev.actor.position.z - by.position.z);
    if (d < 4) byRange.under4m++; else byRange.over4m++;
  });
  for (let i = 0; i < 900; i++) {
    await frame();
    frames++;
    let n = 0;
    for (const v of armour.tanks) {
      if (v.solid !== true) continue;
      for (const a of ai.agents) {
        if (!a.alive) continue;
        if (inside(a.position.x, a.position.z, a.position.y, v)) n++;
        const d = Math.hypot(a.position.x - v.position.x, a.position.z - v.position.z);
        if (d < nearest) nearest = d;
      }
    }
    manFramesInside += n;
    if (n > worstMen) worstMen = n;
  }
  crushKills = armour.tanks.reduce((n, x) => n + x.stats.kills, 0) - kills0;
  let barely = 0, live = 0;
  for (const a of ai.agents) {
    if (!a.alive || !start.has(a.name)) continue;
    live++;
    const p = start.get(a.name);
    if (Math.hypot(a.position.x - p.x, a.position.z - p.z) < 3) barely++;
  }
  return {
    player,
    bots: {
      frames, manFramesInside, worstMen,
      nearest: +nearest.toFixed(2),
      liveTracked: live, barelyMoved: barely, tankKillsDuringRun: crushKills, tankKillRange: byRange,
      hullStates: armour.tanks.map((x) => `${x.id}:${x.state}${x.solid ? '/solid' : ''}`),
    },
  };
}, SPEED);

console.log(JSON.stringify(res, null, 2));
console.log('pageerrors:', errs.length, errs.slice(0, 4));
await b.close();
