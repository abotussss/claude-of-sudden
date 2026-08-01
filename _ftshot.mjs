/**
 * THE PICTURES. The complaint is visual and so is the acceptance.
 *
 *   *-side-*.png   one side seen from above, so "four men one team, different
 *                  ways in" is either in the frame or it is not.
 *   *-roof-*.png   a man put on a roof, photographed on it, at the lip, in the
 *                  air, and back in the street.
 *
 * The camera is re-placed immediately before every shot and the player capsule
 * is teleported onto it — `src/player` drives the camera every frame, so a pose
 * set once and left is overwritten before the shutter. @see _dropcam.mjs.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4355/';
const OUT = args.out ?? 'shots/fireteams';
const TAG = args.tag ?? 'after';
const ROOF = !!args.roof;
const args_rank = args.rank ?? 0;
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL.includes('?') ? `${URL}&capture=1` : `${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
  // the HUD and the rifle are three quarters of the frame from a camera this
  // high, and neither is what the picture is of
  for (const n of document.querySelectorAll('.ow-hud')) n.style.display = 'none';
  if (e.viewScene) e.viewScene.visible = false;
  e.ctx.time.scale = 8;
});
const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
const place = (cam, at) => page.evaluate(([cam, at]) => {
  const e = window.__ENGINE__;
  const V3 = e.camera.position.constructor;
  e.camera.position.set(cam[0], cam[1], cam[2]);
  e.camera.lookAt(new V3(at[0], at[1], at[2]));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  e.camera.updateMatrixWorld(true);
}, [cam, at]);

await frames(ROOF ? 240 : 420);

if (!ROOF) {
  /* ---- the side from above -------------------------------------------- */
  for (const shot of [0, 1, 2]) {
    if (shot) await frames(170);
    const info = await page.evaluate(() => {
      const ai = window.__ENGINE__.ctx.peek('ai');
      const men = ai.agents.filter((a) => a.alive && a.team === 0);
      let clump = 0;
      for (const m of men) {
        let n = 0;
        for (const o of men) if (Math.hypot(o.position.x - m.position.x, o.position.z - m.position.z) < 8) n++;
        if (n > clump) clump = n;
      }
      const teams = new Set();
      for (const m of men) teams.add(m.fireteam ? m.fireteam.id : 0);
      /**
       * FRAME ON A UNIT. With fireteams that is the biggest one that is still
       * together; without them (the baseline build) there are none, so it is
       * the four men closest to the busiest man — which is the clump, and is
       * exactly the comparison the picture is for.
       */
      let group = null, best = -1;
      const byFt = new Map();
      for (const m of men) {
        if (!m.fireteam) continue;
        let g = byFt.get(m.fireteam.id);
        if (!g) byFt.set(m.fireteam.id, (g = []));
        g.push(m);
      }
      for (const g of byFt.values()) {
        let cx = 0, cz = 0;
        for (const m of g) { cx += m.position.x; cz += m.position.z; }
        cx /= g.length; cz /= g.length;
        let far = 0;
        for (const m of g) far = Math.max(far, Math.hypot(m.position.x - cx, m.position.z - cz));
        const score = g.length * 10 - far;      // together, and four of them
        if (g.length >= 3 && far < 26 && score > best) { best = score; group = g; }
      }
      if (!group) {
        let hub = men[0], hubN = -1;
        for (const m of men) {
          let n = 0;
          for (const o of men) if (Math.hypot(o.position.x - m.position.x, o.position.z - m.position.z) < 25) n++;
          if (n > hubN) { hubN = n; hub = m; }
        }
        group = men
          .slice()
          .sort((a, b) => hub.position.distanceToSquared(a.position) - hub.position.distanceToSquared(b.position))
          .slice(0, 4);
      }
      let hub = men[0], hubN = -1;
      for (const m of men) {
        let n = 0;
        for (const o of men) if (Math.hypot(o.position.x - m.position.x, o.position.z - m.position.z) < 20) n++;
        if (n > hubN) { hubN = n; hub = m; }
      }
      let cx = 0, cy = 0, cz = 0, hx = 0, hz = 0;
      for (const m of group) {
        cx += m.position.x; cy += m.position.y; cz += m.position.z;
        hx += Math.sin(m.yaw); hz += Math.cos(m.yaw);
      }
      const n = group.length;
      const hl = Math.hypot(hx, hz) || 1;
      return {
        cx: cx / n, cy: cy / n, cz: cz / n, hx: hx / hl, hz: hz / hl,
        hubx: hub.position.x, huby: hub.position.y, hubz: hub.position.z, hubN,
        men: men.length, teams: teams.size, clump, group: n,
        who: group.map((m) => ({ ft: m.fireteam ? m.fireteam.id : 0, seat: m.ftSeat, x: +m.position.x.toFixed(1), z: +m.position.z.toFixed(1) })),
      };
    });
    /**
     * STRAIGHT DOWN, and it has to be: a side that is properly spread cannot
     * fit in a ground-level frame, which is the whole difference the picture
     * is of. The camera is over the busiest man, so the clump — if there is
     * one — is dead centre.
     */
    for (const [tagh, h] of [['wide', 62], ['close', 34]]) {
      const eye = [info.hubx, info.huby + h, info.hubz + h * 0.1];
      await place(eye, [info.hubx, info.huby, info.hubz]);
      await frames(4);
      await place(eye, [info.hubx, info.huby, info.hubz]);
      await page.screenshot({ path: `${OUT}/${TAG}-side-${shot}-${tagh}.png` });
    }
    console.log(`  shot ${shot}: ${info.men} men, ${info.teams} fireteams, densest 8 m circle holds ${info.clump}, ${info.hubN} within 20 m of the busiest man`);
    console.log('    ' + JSON.stringify(info.who));
  }
} else {
  /* ---- a man leaving a roof ------------------------------------------- */
  const put = await page.evaluate((RANK) => {
    const ai = window.__ENGINE__.ctx.peek('ai');
    const g = ai.grid;
    const per = new Map();
    for (let i = 0; i < g.flags.length; i++) {
      if (!g.flags[i] || !(g.floor[i] > 4.0) || g.escape[g.comp[i]] < 0) continue;
      let e = per.get(g.comp[i]);
      if (!e) per.set(g.comp[i], (e = { c: g.comp[i], cells: [] }));
      e.cells.push(i);
    }
    const roof = [...per.values()].sort((a, c) => c.cells.length - a.cells.length)[RANK];
    // the cell of that roof with a drop off it, so the lip is in the frame
    let lip = roof.cells.find((c) => g.drop[c]) ?? roof.cells[0];
    // …and start him a few metres back from it
    const lx = g.worldX(lip % g.nx), lz = g.worldZ((lip / g.nx) | 0), ly = g.floor[lip];
    let start = lip, bestD = -1;
    for (const c of roof.cells) {
      const d = (g.worldX(c % g.nx) - lx) ** 2 + (g.worldZ((c / g.nx) | 0) - lz) ** 2;
      if (d > bestD && d < 9 * 9) { bestD = d; start = c; }
    }
    const a = ai.agents.find((m) => m.alive);
    const sx = g.worldX(start % g.nx), sz = g.worldZ((start / g.nx) | 0), sy = g.floor[start];
    a.position.set(sx, sy + 0.05, sz);
    a.controller?.teleport(sx, sy + 0.05, sz);
    a.velocity.set(0, 0, 0);
    a.hasMoveTarget = false; a.pathLen = 0; a.repathTimer = 0; a.objectiveBlocked = false;
    // order him to the ground under the lip and keep ordering him there
    let goal = -1, bd = Infinity;
    for (let q = 0; q < g.flags.length; q += 7) {
      if (!g.flags[q] || g.comp[q] !== g.escape[roof.c] || g.floor[q] > 2.0) continue;
      const d = (g.worldX(q % g.nx) - lx) ** 2 + (g.worldZ((q / g.nx) | 0) - lz) ** 2;
      if (d < bd) { bd = d; goal = q; }
    }
    window.__G__ = { x: g.worldX(goal % g.nx), y: g.floor[goal], z: g.worldZ((goal / g.nx) | 0) };
    window.__A__ = a;
    // The picture is of him LEAVING, and a man who finds a target from up there
    // is entitled to stay and shoot (which is the other half of what was asked
    // for). So for the photograph only, he is kept out of contact.
    window.__ORD__ = () => {
      if (!a.alive) return;
      ai.protect(a, 9999);
      a.hasTarget = false;
      a.targetVisible = false;
      a.lastKnownAge = 1e6;
      if (a.state !== 'advance') a._setState('advance');
      a.setObjective('defuse', window.__G__, null, null);
    };
    return { name: a.name, comp: roof.c, cells: roof.cells.length, roofY: +sy.toFixed(1), lip: [+lx.toFixed(1), +ly.toFixed(1), +lz.toFixed(1)], start: [+sx.toFixed(1), +sz.toFixed(1)] };
  }, +(args_rank));
  console.log('roof man:', JSON.stringify(put));
  await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 2; });
  let down = 0;
  for (let i = 0; i < 70; i++) {
    await page.evaluate(() => window.__ORD__());
    await frames(3);
    const s = await page.evaluate(() => {
      const a = window.__A__;
      return { x: a.position.x, y: a.position.y, z: a.position.z, yaw: a.yaw, grounded: a.grounded, state: a.state };
    });
    // over his shoulder and to the side, so the parapet and the street are both in shot
    const d = 7.5;
    await place([s.x - Math.sin(s.yaw + 1.15) * d, s.y + 3.4, s.z - Math.cos(s.yaw + 1.15) * d], [s.x, s.y + 0.6, s.z]);
    await frames(2);
    await page.screenshot({ path: `${OUT}/${TAG}-roof-${String(i).padStart(2, '0')}.png` });
    console.log(`  ${String(i).padStart(2, '0')} y=${s.y.toFixed(2)} ${s.grounded ? 'ground' : 'AIR'} ${s.state}`);
    if (s.y < 1.5 && s.grounded) { if (down++ > 3) break; }
  }
}
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3)}` : '[pageerror] none');
await b.close();
