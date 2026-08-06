/**
 * THE PARADROP, LOOKED AT — 「増援の精鋭はもっと赤色を赤黒くして強そうにして」
 *
 *   node _eliteread.mjs --port=4555 --tag=now
 *
 * A colour is judged by eye and by nothing else, so this stages the ONE
 * comparison the request is about and presses the shutter: an ELITE standing
 * beside an ORDINARY HOSTILE of the same army, in the same frame, in the same
 * light, with the player's own FRIENDLY in it as the control that says the
 * side read still works —
 *
 *     FRIEND    the player's own side's soldier      (vanguard)
 *     HOSTILE   the enemy army's ordinary rifleman   (irregular)
 *     ELITE     the enemy army's paradrop            (irregularSpearhead)
 *     ELITE-DMR the paradrop's bolt gun              (irregularSpearheadDmr)
 *
 * — at 5 / 6 / 12 / 20 / 35 m in DIRECT SUN and in SHADE. The lane search, the
 * sun/shade assertion and the torso read-back are `_civread.mjs`'s and
 * `_teamread.mjs`'s before it; what changed is who stands in the lane and which
 * pair the separation is measured between.
 *
 * It prints, per man, the mean sRGB over his torso and the background ring just
 * outside him, his luminance, and |HOSTILE-ELITE| in sRGB — which is the numeric
 * half of "can he tell an elite from an ordinary hostile at the distance he
 * actually fights at". THE BLUE TRAP IS WHY THE SHADE ROW EXISTS: a low-chroma
 * albedo in its own shadow is lit by sky fill, and the militia's first pass came
 * back navy for exactly that reason (@see `CIVIL_CLOTH`), so `b > r` on any row
 * of this report is a failure however good the value split looks.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const PORT = Number(args.port ?? 4555);
const TAG = args.tag ?? 'now';
const W = Number(args.w ?? 1280);
const H = Number(args.h ?? 720);
const DIST = [5, 6, 12, 20, 35];
/** Lateral offsets across the lane, metres. Four men, widest pair outboard. */
const LANES = [-2.1, -0.7, 0.7, 2.1];
const DIR = `shots/eliteread`;

mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e.message)));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push('CONSOLE ' + m.text());
});

await page.goto(`http://127.0.0.1:${PORT}/?capture=1&shot=hero`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const ai = ctx.peek('ai');
  const phys = ctx.peek('physics');
  const sky = ctx.peek('sky');
  const player = ctx.peek('player');
  const V3 = ctx.camera.position.constructor;

  e.input.frozen = true;
  e.input.enabled = false;
  ai.combatEnabled = false;
  // Stop the world before measuring: an airstrike between the sun lane and the
  // shade lane changes the level under the second search. @see _teamread.mjs.
  e.time.scale = 0.02;

  const a = new V3(), b = new V3(), c = new V3();

  const sunlit = (x, y, z) => {
    a.set(x, y, z);
    b.copy(sky.sunDirection).multiplyScalar(400).add(a);
    return phys.lineOfSight(a, b, phys.MASK.SIGHT);
  };

  /**
   * `frontLit` IS THE CHANGE FROM `_civread.mjs` AND IT IS NOT COSMETIC. That
   * probe asks only that the men have a clear line to the sun, which the first
   * lane found here satisfied with the sun BEHIND THEM: four backlit
   * silhouettes, all of them dark, which is the one lighting condition under
   * which no albedo change can be judged at all. A colour is judged by eye, so
   * the sun lane has to be a lane the sun is actually falling down.
   */
  window.__FINDLANE__ = (want, dists, offs, needBackdrop = true, frontLit = false) => {
    const g = ai.grid;
    const match = ctx.peek('match');
    const anchors = (match?.sites ?? []).map((s) => s.position);
    if (!anchors.length) return null;
    const nearCity = (x, z) => {
      for (const p of anchors) if (Math.hypot(p.x - x, p.z - z) < 70) return true;
      return false;
    };
    const backdrop = (ex, ey, ez, px, py, pz) => {
      a.set(ex, ey + 1.62, ez);
      b.set(px - a.x, py + 1.95 - a.y, pz - a.z).normalize();
      return phys.raycast(a, b, 250, phys.MASK.SIGHT).hit;
    };
    let best = null;
    let bestScore = Infinity;
    for (let iz = 2; iz < g.nz - 2; iz += 2) {
      for (let ix = 2; ix < g.nx - 2; ix += 2) {
        const i = iz * g.nx + ix;
        if (g.flags[i] !== 1) continue;
        const ex = g.worldX(ix), ez = g.worldZ(iz), ey = g.floor[i];
        if (!Number.isFinite(ey) || !nearCity(ex, ez)) continue;
        for (let d = 0; d < 48; d++) {
          const th = (d / 48) * Math.PI * 2;
          const fx = Math.sin(th), fz = -Math.cos(th);
          // The camera looks down +f; the sun is up `sunDirection`. A negative
          // dot is the sun behind the eye, i.e. on the men's faces.
          if (frontLit && fx * sky.sunDirection.x + fz * sky.sunDirection.z > -0.25) continue;
          let ok = true;
          for (const dd of dists) {
            for (const off of offs) {
              const px = ex + fx * dd - fz * off;
              const pz = ez + fz * dd + fx * off;
              const gy = phys.groundHeight(px, pz);
              if (!Number.isFinite(gy) || Math.abs(gy - ey) > 1.6) { ok = false; break; }
              a.set(ex, ey + 1.62, ez);
              let clear = true;
              for (const hy of [1.68, 1.35, 0.55]) {
                b.set(px, gy + hy, pz);
                if (!phys.lineOfSight(a, b, phys.MASK.SIGHT)) { clear = false; break; }
              }
              if (!clear) { ok = false; break; }
              const lit = sunlit(px, gy + 1.35, pz);
              if (want === 'sun' ? !lit : lit) { ok = false; break; }
              if (needBackdrop && !backdrop(ex, ey, ez, px, gy, pz)) { ok = false; break; }
            }
            if (!ok) break;
          }
          if (!ok) continue;
          const mx = ex + fx * 20, mz = ez + fz * 20;
          let score = Infinity;
          for (const q of anchors) score = Math.min(score, Math.hypot(q.x - mx, q.z - mz));
          if (score < bestScore) {
            bestScore = score;
            best = { ex, ey, ez, fx, fz, yaw: Math.atan2(fx, -fz), score: +score.toFixed(1) };
          }
        }
      }
    }
    return best;
  };

  /**
   * The cast, in lane order, at `dist`.
   *
   * `elite: true` IS THE WHOLE POINT OF THE STAGING and it is passed to
   * `ai.spawn` exactly as `src/match/index.js:_landReinforcement` passes it —
   * the dress swap lives in the `Agent` constructor, so a probe that named
   * `irregularSpearhead` directly would be photographing a variant no match can
   * produce. The team is resolved off `ai.playerTeam` for the same reason.
   */
  window.__STAGE__ = (lane, dist, cast, offs) => {
    ai.clearAgents();
    const pt = ai.playerTeam ?? 0;
    const yawToEye = Math.atan2(-lane.fx, lane.fz);
    const out = [];
    for (let i = 0; i < cast.length; i++) {
      const m = cast[i];
      const off = offs[i];
      const px = lane.ex + lane.fx * dist - lane.fz * off;
      const pz = lane.ez + lane.fz * dist + lane.fx * off;
      const gy = phys.groundHeight(px, pz);
      const team = m.friendly ? pt : 1 - pt;
      const ag = ai.spawn(m.variant, new V3(px, gy + 0.02, pz), yawToEye, {
        team, name: m.name, role: m.role, elite: m.elite === true,
      });
      // The bolt gun is a DEALT slot, so the man who is supposed to be carrying
      // one is forced here rather than hoped for.
      ag.spottedAt = 1e9;
      out.push({
        who: m.name, variant: ag.variantName, weapon: ag.weaponId,
        skill: +(ag.skill ?? 0).toFixed(2), hp: ag.maxHealth,
        sunlit: sunlit(px, gy + 1.35, pz),
      });
    }
    const cam = ctx.camera;
    cam.position.set(lane.ex, lane.ey + 1.62, lane.ez);
    cam.lookAt(lane.ex + lane.fx * dist, lane.ey + 1.35, lane.ez + lane.fz * dist);
    cam.updateMatrixWorld(true);
    player.teleport?.(cam.position, cam.rotation);
    e.time.scale = 0.02;
    return { men: out, fov: ctx.camera.fov, hour: sky.timeOfDay };
  };

  window.__BOXES__ = () => {
    const cam = ctx.camera;
    const w = window.innerWidth, h = window.innerHeight;
    const out = [];
    for (const ag of ai.agents) {
      if (!ag.alive) continue;
      const res = [];
      for (const dy of [0.15, 1.75]) {
        c.set(ag.position.x, ag.position.y + dy, ag.position.z).project(cam);
        res.push([(c.x * 0.5 + 0.5) * w, (-c.y * 0.5 + 0.5) * h]);
      }
      const yTop = res[1][1], yBot = res[0][1];
      const hh = Math.max(2, yBot - yTop);
      out.push({ name: ag.name, x: res[0][0], yTop, yBot, h: hh, w: Math.max(2, hh * 0.34) });
    }
    return out;
  };
});

const pump = (n) => page.evaluate((k) => new Promise((done) => {
  let i = 0;
  const t = () => (++i >= k ? done() : requestAnimationFrame(t));
  requestAnimationFrame(t);
}), n);

function region(png, x0, y0, x1, y1) {
  let r = 0, g = 0, b = 0, n = 0;
  const X0 = Math.max(0, Math.floor(x0)), X1 = Math.min(png.width - 1, Math.ceil(x1));
  const Y0 = Math.max(0, Math.floor(y0)), Y1 = Math.min(png.height - 1, Math.ceil(y1));
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    const i = (y * png.width + x) * 4;
    r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; n++;
  }
  return n ? { r: r / n, g: g / n, b: b / n, n } : null;
}
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const fmt = (c) => c ? `${c.r.toFixed(0)}/${c.g.toFixed(0)}/${c.b.toFixed(0)}` : '-';

const CAST = [
  { name: 'FRIEND', variant: 'vanguard', role: 'field', friendly: true },
  { name: 'HOSTILE', variant: 'irregular', role: 'field', friendly: false },
  { name: 'ELITE', variant: 'irregular', role: 'field', friendly: false, elite: true },
  { name: 'ELITE2', variant: 'irregular', role: 'field', friendly: false, elite: true },
];

const LANEFILE = `${DIR}/lanes.json`;
let lanes = {};
if (!args.relane && existsSync(LANEFILE)) {
  lanes = JSON.parse(readFileSync(LANEFILE, 'utf8'));
  console.log('[eliteread] lanes pinned from', LANEFILE);
}
for (const want of ['sun', 'shade']) {
  if (lanes[want]) continue;
  const lit = want === 'sun';
  lanes[want] = await page.evaluate(([w, d, o, f]) => window.__FINDLANE__(w, d, o, true, f), [want, DIST, LANES, lit]);
  if (lanes[want]) { lanes[want].strict = true; lanes[want].frontLit = lit; continue; }
  lanes[want] = await page.evaluate(([w, d, o, f]) => window.__FINDLANE__(w, d, o, false, f), [want, DIST, LANES, lit]);
  if (lanes[want]) { lanes[want].strict = false; lanes[want].frontLit = lit; continue; }
  // No front-lit lane on this map at this hour: fall back rather than skip.
  lanes[want] = await page.evaluate(([w, d, o]) => window.__FINDLANE__(w, d, o, false, false), [want, DIST, LANES]);
  if (lanes[want]) { lanes[want].strict = false; lanes[want].frontLit = false; }
}
if (lanes.sun && lanes.shade) writeFileSync(LANEFILE, JSON.stringify(lanes, null, 1));

const report = [];
const shoot = async (lane, want, d, cast, offs, label) => {
  const st = await page.evaluate(([l, dd, cc, oo]) => window.__STAGE__(l, dd, cc, oo), [lane, d, cast, offs]);
  await pump(45);
  const path = `${DIR}/${TAG}-${want}-${label}.png`;
  await page.screenshot({ path });
  const boxes = await page.evaluate(() => window.__BOXES__());
  const png = PNG.sync.read(readFileSync(path));
  const rows = [];
  for (const bx of boxes) {
    const half = bx.w * 0.5;
    const t0 = bx.yTop + bx.h * 0.22, t1 = bx.yTop + bx.h * 0.58;
    const body = region(png, bx.x - half, t0, bx.x + half, t1);
    const oL = region(png, bx.x - half * 3.5, t0, bx.x - half * 1.4, t1);
    const oR = region(png, bx.x + half * 1.4, t0, bx.x + half * 3.5, t1);
    const bg = oL && oR
      ? { r: (oL.r + oR.r) / 2, g: (oL.g + oR.g) / 2, b: (oL.b + oR.b) / 2 } : null;
    rows.push({ name: bx.name, px: +bx.h.toFixed(1), body, bg });
  }
  const by = (n) => rows.find((r) => r.name === n);
  const Ho = by('HOSTILE'), El = by('ELITE');
  /**
   * `dL` is the man against the GROUND BESIDE HIM, and it is the guard on the
   * whole exercise: darkening a figure is only legibility while he still
   * separates from his own background. A dark man on this map is a man WITH
   * MORE contrast, not less — @see the `TEAM_DRESS.hostile` note on rust brown
   * at the value of sunlit sand — and this is the number that says so.
   */
  const parts = rows.map((r) => `${r.name} ${fmt(r.body)} L${lum(r.body).toFixed(0)}`
    + (r.bg ? ` dL${(lum(r.body) - lum(r.bg)).toFixed(0)}` : ''));
  const sep = Ho?.body && El?.body
    ? Math.hypot(Ho.body.r - El.body.r, Ho.body.g - El.body.g, Ho.body.b - El.body.b) : NaN;
  const dv = Ho?.body && El?.body ? (lum(El.body) / lum(Ho.body)) : NaN;
  const line = `${want} ${label.padStart(5)}  px ${String(rows[0]?.px ?? 0).padStart(6)}  ` +
    parts.join('  ') + `  |HOST-ELITE| ${sep.toFixed(1)}  Lratio ${dv.toFixed(2)}`;
  console.log(line);
  report.push({ want, d, label, line, path, men: st.men, fov: st.fov, hour: st.hour, sep, dv });
};

for (const want of ['sun', 'shade']) {
  const lane = lanes[want];
  if (!lane) { console.log(`[eliteread] NO ${want.toUpperCase()} LANE`); continue; }
  console.log(`\n=== ${want.toUpperCase()} lane: eye ${lane.ex.toFixed(1)},${lane.ey.toFixed(1)},` +
    `${lane.ez.toFixed(1)} yaw ${(lane.yaw * 180 / Math.PI).toFixed(0)}deg, ` +
    `mid ${lane.score}m from a capture point, backdrop=${lane.strict} ===`);
  for (const d of DIST) await shoot(lane, want, d, CAST, LANES, `${String(d).padStart(2, '0')}m`);
}

writeFileSync(`${DIR}/${TAG}-report.json`, JSON.stringify(report, null, 1));
console.log(`\n[eliteread] fov ${report[0]?.fov} hour ${report[0]?.hour}`);
console.log('[eliteread] cast', JSON.stringify(report[0]?.men ?? []));
if (errs.length) console.log('[eliteread] ERRORS', errs.slice(0, 8));
await browser.close();
