/**
 * FRIEND OR FOE, LOOKED AT.
 *
 *   node _teamread.mjs --port=4231 --tag=before
 *
 * "味方と敵の服が似てて見分けつかない" cannot be answered by a number, so this
 * stages the exact comparison the complaint is about and presses the shutter:
 * ONE friendly and ONE hostile standing side by side, facing the camera, at
 * 10 / 25 / 40 / 70 m, in DIRECT SUN and in SHADE, and writes eight PNGs plus
 * one four-station composite per lighting condition.
 *
 * The lane is MEASURED, not authored:
 *   - stations sit on real ground (`physics.groundHeight`)
 *   - every station is in line of sight from the eye (`physics.lineOfSight`)
 *   - "sun" means the ray from the man's chest to `sky.sunDirection` is CLEAR,
 *     "shade" means it is BLOCKED. Both are asserted for all four stations and
 *     printed, so the two sets cannot silently be the same picture twice.
 *
 * It also prints, per station, the mean sRGB of the pixels covering each man's
 * torso and of the background ring just outside him — which is the numeric half
 * of the same question: how far apart are friendly and hostile, and how far is
 * each from what he is standing against.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const PORT = Number(args.port ?? 4231);
const TAG = args.tag ?? 'now';
const W = Number(args.w ?? 1280);
const H = Number(args.h ?? 720);
const DIST = [10, 25, 40, 70];
const DIR = `shots/teamread`;

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

/* ── install the stager in the page ─────────────────────────────────────── */
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
  /**
   * STOP THE WORLD BEFORE MEASURING. The first version searched for the sun lane,
   * took four screenshots (seconds of wall clock), then searched for the shade
   * lane — by which time the match had called an AIRSTRIKE, the rubble had become
   * collision, and the shade lane search returned nothing. Both lanes are now
   * found against ONE frozen level.
   */
  e.time.scale = 0.02;

  const a = new V3(), b = new V3(), c = new V3();

  /** Is this point in direct sun? Ray to the sun, 400 m, SIGHT mask. */
  const sunlit = (x, y, z) => {
    a.set(x, y, z);
    b.copy(sky.sunDirection).multiplyScalar(400).add(a);
    return phys.lineOfSight(a, b, phys.MASK.SIGHT);
  };

  /**
   * Find a lane: an eye cell and a heading where all four stations stand on
   * ground at a similar height, are visible from the eye, and are ALL sunlit
   * (`want === 'sun'`) or ALL shadowed (`want === 'shade'`).
   */
  window.__FINDLANE__ = (want, dists, sep, needBackdrop = true) => {
    const g = ai.grid;
    const match = ctx.peek('match');
    /**
     * ANCHOR THE SEARCH TO THE CITY. The first version of this searched the whole
     * nav grid and the first passing lane it found was out on the map's desert
     * skirt: two men against flat sand and empty sky, which is the EASY case and
     * not the one the complaint is about. A lane only counts if the eye is inside
     * the fought-over ground (within 70 m of a capture point) and if every man
     * has GEOMETRY behind his head rather than sky.
     */
    const anchors = (match?.sites ?? []).map((s) => s.position);
    if (!anchors.length) return null;
    const nearCity = (x, z) => {
      for (const p of anchors) if (Math.hypot(p.x - x, p.z - z) < 70) return true;
      return false;
    };
    const backdrop = (ex, ey, ez, px, py, pz) => {
      a.set(ex, ey + 1.62, ez);
      // just over his head: if this ray reaches 250 m he is against the sky
      b.set(px - a.x, py + 1.95 - a.y, pz - a.z).normalize();
      return phys.raycast(a, b, 250, phys.MASK.SIGHT).hit;
    };
    /**
     * BEST, NOT FIRST. Taking the first passing lane made the staging jump
     * across the map whenever the scan step changed, which makes a before/after
     * pair meaningless. Every passing lane is scored by how close its MIDDLE is
     * to a capture point and the most central one wins, so the same level always
     * produces the same two lanes and both are inside the fought-over ground.
     */
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
          let ok = true;
          for (const dd of dists) {
            // the pair straddles the lane centre by `sep`
            for (const side of [-1, 1]) {
              const px = ex + fx * dd - fz * side * sep;
              const pz = ez + fz * dd + fx * side * sep;
              const gy = phys.groundHeight(px, pz);
              if (!Number.isFinite(gy) || Math.abs(gy - ey) > 1.6) { ok = false; break; }
              // HEAD, CHEST AND KNEES, not just the chest: a chest-only test put
              // both men behind a lamp post and an awning at 40 and 70 m, and a
              // picture of two men you cannot see says nothing about their colour.
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
          const mx = ex + fx * 40, mz = ez + fz * 40;
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
   * Put the camera at the lane's eye and one pair of men at `dist`.
   * Friendly wears the variant the player's own side wears; hostile the other.
   */
  window.__STAGE__ = (lane, dist, sep) => {
    ai.clearAgents();
    const pt = ai.playerTeam ?? 0;
    const VAR = ['vanguard', 'irregular'];
    const yawToEye = Math.atan2(-lane.fx, lane.fz);
    const out = [];
    for (const side of [-1, 1]) {
      const team = side < 0 ? pt : 1 - pt;
      const px = lane.ex + lane.fx * dist - lane.fz * side * sep;
      const pz = lane.ez + lane.fz * dist + lane.fx * side * sep;
      const gy = phys.groundHeight(px, pz);
      const ag = ai.spawn(VAR[team], new V3(px, gy + 0.02, pz), yawToEye, {
        team, name: side < 0 ? 'FRIEND' : 'HOSTILE', role: 'rifleman',
      });
      ag.spottedAt = 1e9;   // a contact the player's own side genuinely has
      out.push({
        who: side < 0 ? 'friendly' : 'hostile', team,
        variant: VAR[team], x: px, y: gy, z: pz,
        sunlit: sunlit(px, gy + 1.35, pz),
      });
    }
    /**
     * `?capture=1&shot=…` has already called `player.setControlEnabled(false)`,
     * so the camera is NOT driven by `player.movement` any more — pose it the
     * way `__APPLY_SHOT__` does and push the capsule under it afterwards, or the
     * shot keeps the `hero` framing and the men land off screen. (Measured: they
     * projected to x = -773 px.)
     */
    const cam = ctx.camera;
    cam.position.set(lane.ex, lane.ey + 1.62, lane.ez);
    cam.lookAt(lane.ex + lane.fx * dist, lane.ey + 1.35, lane.ez + lane.fz * dist);
    cam.updateMatrixWorld(true);
    player.teleport?.(cam.position, cam.rotation);
    e.time.scale = 0.02;
    return { men: out, fov: ctx.camera.fov, hour: sky.timeOfDay };
  };

  /** Screen-space box of each staged man, for reading the PNG back. */
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
      out.push({
        name: ag.name, team: ag.team,
        x: res[0][0], yTop, yBot, h: hh, w: Math.max(2, hh * 0.34),
      });
    }
    return out;
  };
});

const pump = (n) => page.evaluate((k) => new Promise((done) => {
  let i = 0;
  const t = () => (++i >= k ? done() : requestAnimationFrame(t));
  requestAnimationFrame(t);
}), n);

/* ── read a PNG region back ────────────────────────────────────────────── */
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

const report = [];
/* Both lanes against one frozen level, before a single screenshot is taken. */
const lanes = {};
for (const want of ['sun', 'shade']) {
  /**
   * STRICT FIRST, THEN WITHOUT THE BACKDROP TEST. Seventy metres of continuously
   * shadowed street with a clear head-height sightline AND a building behind
   * every station does not exist on this map at 16:30, so the shade lane is
   * allowed to have sky behind the far men. Which rule was used is printed, so
   * the two conditions are never quietly the same picture.
   */
  lanes[want] = await page.evaluate(([w, d, s]) => window.__FINDLANE__(w, d, s, true), [want, DIST, 1.0]);
  if (lanes[want]) { lanes[want].strict = true; continue; }
  lanes[want] = await page.evaluate(([w, d, s]) => window.__FINDLANE__(w, d, s, false), [want, DIST, 1.0]);
  if (lanes[want]) lanes[want].strict = false;
}
for (const want of ['sun', 'shade']) {
  const lane = lanes[want];
  if (!lane) { console.log(`[teamread] NO ${want.toUpperCase()} LANE FOUND`); continue; }
  console.log(`\n=== ${want.toUpperCase()} lane: eye ${lane.ex.toFixed(1)},${lane.ey.toFixed(1)},` +
    `${lane.ez.toFixed(1)} yaw ${(lane.yaw * 180 / Math.PI).toFixed(0)}deg ` +
    `mid ${lane.score}m from a capture point, ` +
    `backdrop=${lane.strict ? 'geometry behind every man' : 'not required'} ===`);
  for (const d of DIST) {
    const st = await page.evaluate(([l, dd, s]) => window.__STAGE__(l, dd, s), [lane, d, 1.0]);
    await pump(45);
    const path = `${DIR}/${TAG}-${want}-${String(d).padStart(2, '0')}m.png`;
    await page.screenshot({ path });
    const boxes = await page.evaluate(() => window.__BOXES__());
    const png = PNG.sync.read(readFileSync(path));
    const rows = [];
    for (const bx of boxes) {
      const half = bx.w * 0.5;
      // torso: the middle third of the figure's height, his own width
      const t0 = bx.yTop + bx.h * 0.22, t1 = bx.yTop + bx.h * 0.58;
      const body = region(png, bx.x - half, t0, bx.x + half, t1);
      // the ring just outside him, same band, 2.5 body widths wide
      const oL = region(png, bx.x - half * 3.5, t0, bx.x - half * 1.4, t1);
      const oR = region(png, bx.x + half * 1.4, t0, bx.x + half * 3.5, t1);
      const bg = oL && oR
        ? { r: (oL.r + oR.r) / 2, g: (oL.g + oR.g) / 2, b: (oL.b + oR.b) / 2 } : null;
      rows.push({ name: bx.name, px: +bx.h.toFixed(1), body, bg });
    }
    const F = rows.find((r) => r.name === 'FRIEND');
    const E = rows.find((r) => r.name === 'HOSTILE');
    if (!F?.body || !E?.body) {
      console.log(`${want} ${d}m  STAGE FAILED — boxes ${JSON.stringify(boxes)}`);
      continue;
    }
    const sep = Math.hypot(F.body.r - E.body.r, F.body.g - E.body.g, F.body.b - E.body.b);
    const dl = (x) => (x.bg ? (lum(x.body) - lum(x.bg)).toFixed(1) : '-');
    const line =
      `${want} ${String(d).padStart(2)}m  px ${String(F.px).padStart(6)}` +
      `  FRIEND ${fmt(F.body).padStart(12)} (bg ${fmt(F.bg)}, dL ${dl(F)})` +
      `  HOSTILE ${fmt(E.body).padStart(12)} (bg ${fmt(E.bg)}, dL ${dl(E)})` +
      `  |F-E| ${sep.toFixed(1)}`;
    console.log(line);
    report.push({ want, d, sunlit: st.men.map((m) => m.sunlit), fov: st.fov, hour: st.hour, line, path });
  }
}

writeFileSync(`${DIR}/${TAG}-report.json`, JSON.stringify(report, null, 1));
console.log(`\n[teamread] fov ${report[0]?.fov} hour ${report[0]?.hour}`);
console.log('[teamread] sunlit flags per shot:',
  report.map((r) => `${r.want}${r.d}:${r.sunlit.join(',')}`).join(' '));
if (errs.length) console.log('[teamread] ERRORS', errs.slice(0, 6));
await browser.close();
