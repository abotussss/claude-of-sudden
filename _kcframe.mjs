/**
 * WHAT THE KILL CAM ACTUALLY PUTS ON SCREEN — 「キルカメラもちゃんと相手を表示して」
 *
 *   node _kcframe.mjs [--url=…] [--seed=7] [--case=bot|air|drone|all]
 *
 * The strip is not the question. The PICTURE is. So this drives the real damage
 * paths (a bot's round is the byte-identical `damage:dealt` `AiSystem` emits;
 * an airstrike is `airstrike.fire`, the same call the telegraph ends in), then
 * every frame of the cam it measures WHERE THE KILLER IS IN THE FRAME:
 *
 *   ndc      the killer's chest projected through the live camera. |x|,|y| <= 1
 *            is on screen; y < -1 is below the bottom edge.
 *   offAxis  degrees between the camera's forward axis and the killer.
 *   clear    is there a wall between the camera and the killer.
 *   behind   is the killer BEHIND the camera (dot < 0), which is the failure
 *            the wall-avoid pull-in produces.
 *
 * Nothing here decides anything: it only reports. Screenshots at the settle.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const SEED = args.seed ?? '7';
const URL = args.url ?? `http://127.0.0.1:4573/?seed=${SEED}`;
const SHOTS = args.shots ?? 'shots';
const CASE = args.case ?? 'all';
const TAG = args.tag ?? '';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message)));

console.log(`[kc] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(
  () => window.__ENGINE__.ctx.peek('match').phase === 'live',
  null,
  { timeout: 180000 }
);
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.time.scale = 1;
  const ai = e.ctx.peek('ai');
  ai.combatEnabled = false;
  ai.protect(e.ctx.peek('player'), 9999);
  window.__M__ = e.ctx.peek('match');
  window.__AI__ = ai;
  window.__P__ = e.ctx.peek('player');
  window.__UI__ = e.ctx.peek('ui');
  window.__W__ = e.ctx.peek('weapons');
});
await page.mouse.click(800, 450);
await page.waitForTimeout(400);

/** Read the frame: where the killer is relative to what the camera is showing. */
const sample = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = window.__M__;
    const sp = m.spectator;
    const cam = e.ctx.camera;
    const k = sp.kill;
    const out = {
      t: +e.time.elapsed.toFixed(2),
      mode: sp.mode,
      active: sp.active,
      killCam: sp.killCam,
      killT: +sp.killT.toFixed(2),
      killFor: +sp.killFor.toFixed(2),
      strip: window.__UI__.killCamStrip.text,
      stripVisible: window.__UI__.killCamStrip.visible,
      vmVisible: window.__W__?.viewmodel?.rig?.visible ?? null,
      cam: [+cam.position.x.toFixed(2), +cam.position.y.toFixed(2), +cam.position.z.toFixed(2)],
    };
    if (!k) return out;
    out.name = k.name;
    out.cause = k.cause;
    out.dist = +k.dist.toFixed(1);
    out.env = k.environmental;
    out.tracking = !!k.actor;
    // The point the camera is meant to be framing, and the target it looks at.
    const at = sp._killAt;
    out.killAt = [+at.x.toFixed(2), +at.y.toFixed(2), +at.z.toFixed(2)];
    out.look = [+sp._look.x.toFixed(2), +sp._look.y.toFixed(2), +sp._look.z.toFixed(2)];
    out.camToKiller = +cam.position.distanceTo(at).toFixed(2);
    /**
     * NOT THE POINT THE CAMERA IS AIMED AT — that would measure itself. His
     * HEAD and his FEET, so "on screen" means the whole man is in the frame and
     * `size` is how much of the screen he stands up.
     */
    const eyeH = k.env ? 0 : (k.actor?.eyeHeight ?? 1.55);
    const headY = k.env ? 0.6 : eyeH + 0.12;
    const P = new (at.constructor)(at.x, at.y + headY * 0.75, at.z);
    const head = new (at.constructor)(at.x, at.y + headY, at.z);
    const feet = new (at.constructor)(at.x, at.y + 0.05, at.z);
    cam.updateMatrixWorld(true);
    const ndc = P.clone().project(cam);
    const nh = head.clone().project(cam);
    const nf = feet.clone().project(cam);
    out.ndc = [+ndc.x.toFixed(3), +ndc.y.toFixed(3), +ndc.z.toFixed(3)];
    out.head = [+nh.x.toFixed(2), +nh.y.toFixed(2)];
    out.feet = [+nf.x.toFixed(2), +nf.y.toFixed(2)];
    out.size = +Math.abs(nh.y - nf.y).toFixed(3);
    const inFrame = (n) => Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1 && n.z > -1 && n.z < 1;
    out.onScreen = inFrame(nh) && inFrame(nf);
    // Behind the camera? dot of (killer - cam) with the camera's forward axis.
    const fwd = new (at.constructor)(0, 0, -1).applyQuaternion(cam.quaternion);
    const to = P.clone().sub(cam.position);
    const d = to.length() || 1e-4;
    out.behind = to.dot(fwd) < 0;
    out.offAxis = +((Math.acos(Math.max(-1, Math.min(1, to.dot(fwd) / d))) * 180) / Math.PI).toFixed(1);
    // Is the level in the way between the camera and the man?
    const phys = e.ctx.peek('physics');
    out.clear = phys.lineOfSight(cam.position, P, phys.MASK.WORLD);
    // Is the mesh even drawn (off-screen actor LOD lives in `ai`)?
    if (k.actor?.group) {
      out.meshVisible = k.actor.group.visible;
      out.actorAlive = k.actor.alive !== false && k.actor.dead !== true;
    }
    return out;
  });

const show = (s) => {
  const bits = [
    `t=${s.t}`,
    `mode=${s.mode}`,
    `killT=${s.killT}/${s.killFor}`,
    s.name ? `"${s.name}"` : '(no kill record)',
  ];
  if (s.ndc) {
    bits.push(
      `head=(${s.head[0]},${s.head[1]}) feet=(${s.feet[0]},${s.feet[1]}) size=${s.size}`,
      s.onScreen ? 'ON-SCREEN' : '*** OFF-SCREEN ***',
      s.behind ? '*** BEHIND CAMERA ***' : '',
      `offAxis=${s.offAxis}°`,
      `camToKiller=${s.camToKiller}m`,
      s.clear ? 'clear' : '*** OCCLUDED ***',
      s.meshVisible === undefined ? '' : s.meshVisible ? 'mesh:drawn' : '*** MESH HIDDEN ***'
    );
  }
  bits.push(`vm=${s.vmVisible}`);
  console.log('   ' + bits.filter(Boolean).join('  '));
};

/**
 * A live enemy and the range to fight him at.
 *
 * `range = 0` leaves the player where he is (the 190 m across-the-map case that
 * reproduced the bug); anything else walks the player back along the line to
 * that distance, which is where the fights on this map actually happen.
 */
const pickFoe = (range = 0) =>
  page.evaluate((want) => {
    const e = window.__ENGINE__;
    const ai = window.__AI__;
    const m = window.__M__;
    const p = window.__P__;
    const foeTeam = 1 - m.playerTeam;
    const live = ai.agents.filter((a) => a.alive !== false && ai.teamOf(a) === foeTeam);
    if (!live.length) return null;
    const phys = e.ctx.peek('physics');
    let best = null;
    for (const a of live) {
      const d = a.position.distanceTo(p.position);
      if (!best || d < best.d) best = { a, d };
    }
    const a = best.a;
    window.__FOE__ = a;
    if (want > 0) {
      // Stand off along a lane that is actually open, so "he was behind a wall"
      // is measured on purpose rather than by accident.
      let yaw = 0;
      let got = 0;
      for (let i = 0; i < 24; i++) {
        const t = (i / 24) * Math.PI * 2;
        const dir = new a.position.constructor(-Math.sin(t), 0, -Math.cos(t));
        const from = a.eye.clone();
        const h = phys.raycast(from, dir, want + 2, phys.MASK.BULLET);
        const free = h.hit ? h.distance : want + 2;
        if (free > got) { got = free; yaw = t; }
      }
      const d = Math.min(want, Math.max(4, got - 1.2));
      const x = a.position.x - Math.sin(yaw) * d;
      const z = a.position.z - Math.cos(yaw) * d;
      p.respawnAt({ x, y: ai.groundAt(x, z, a.position.y + 4), z }, yaw + Math.PI);
      ai.protect(p, 9999);
    }
    const dx = a.position.x - e.ctx.camera.position.x;
    const dz = a.position.z - e.ctx.camera.position.z;
    p.movement.yaw = Math.atan2(-dx, -dz);
    p.movement.pitch = 0;
    const clear = phys.lineOfSight(e.ctx.camera.position, a.eye, phys.MASK.BULLET);
    return {
      name: a.name,
      team: a.team,
      dist: +a.position.distanceTo(p.position).toFixed(1),
      clearLine: clear,
    };
  }, range);

/** Kill the player with a bot's round — the payload `AiSystem` itself emits. */
const botKill = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const a = window.__FOE__;
    const p = window.__P__;
    e.ctx.events.emit('damage:dealt', {
      target: p,
      amount: 500,
      headshot: false,
      killed: false,
      point: p.position.clone(),
      from: a.eye.clone(),
      source: a,
    });
    return p.health.dead;
  });

/** The real airstrike, fired on the site nearest the player. */
const airKill = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = window.__M__;
    const p = window.__P__;
    const sites = m.airstrike.sites;
    let bi = 0;
    let bd = Infinity;
    sites.forEach((s, i) => {
      const d = s.position.distanceTo(p.position);
      if (d < bd) { bd = d; bi = i; }
    });
    const s = sites[bi];
    // Stand in it: the strike has to reach the player for the record to be his.
    const gy = e.ctx.peek('ai').groundAt(s.position.x + 3, s.position.z, s.position.y + 8);
    p.respawnAt({ x: s.position.x + 3, y: gy, z: s.position.z }, 0);
    m.airstrike.fire(bi);
    return { site: s.id ?? bi, at: [+s.position.x.toFixed(1), +s.position.y.toFixed(1), +s.position.z.toFixed(1)] };
  });

const runCase = async (label, trigger) => {
  console.log(`\n[kc] ══════════ ${label} ══════════`);
  const info = await trigger();
  console.log('   trigger:', JSON.stringify(info));
  await page.waitForTimeout(250);
  const frames = [];
  for (let i = 0; i < 12; i++) {
    const s = await sample();
    frames.push(s);
    show(s);
    if (i === 5) await page.screenshot({ path: `${SHOTS}/killcam-${label}${TAG}.png` });
    if (!s.killCam && i > 2) break;
    await page.waitForTimeout(260);
  }
  console.log(`   strip: "${frames.find((f) => f.strip)?.strip ?? '(none)'}"`);
  const cam = frames.filter((f) => f.killCam && f.ndc);
  const off = cam.filter((f) => !f.onScreen).length;
  const behind = cam.filter((f) => f.behind).length;
  const occl = cam.filter((f) => !f.clear).length;
  console.log(`   VERDICT ${label}: ${cam.length} cam frames, ` +
    `${off} with the killer OFF SCREEN, ${behind} with him BEHIND the camera, ` +
    `${occl} with a wall in the way; ` +
    `viewmodel visible on ${cam.filter((f) => f.vmVisible !== false).length}`);
  return { label, frames: cam.length, off, behind, occl };
};

const revive = () =>
  page.evaluate(() => {
    const p = window.__P__;
    const m = window.__M__;
    m.spectator.stop();
    window.__UI__.clearKillCam?.();
    // Drop the match's own queued respawn: left in, it fires in the middle of
    // the NEXT case and resets the player under the camera being measured.
    const q = m._respawnQueue;
    if (q) for (let i = q.length - 1; i >= 0; i--) if (q[i].rec?.isPlayer) q.splice(i, 1);
    const pr = m._record?.(p);
    if (pr) pr.alive = true;
    m._playerWasDead = false;
    p.health.reset(true);
    p.setControlEnabled(true);
    window.__AI__.protect(p, 9999);
  });

const results = [];
if (CASE === 'all' || CASE === 'bot') {
  console.log('   foe:', JSON.stringify(await pickFoe(0)));
  results.push(await runCase('bot-far', botKill));
  await revive();
  await page.waitForTimeout(600);
}
if (CASE === 'all' || CASE === 'near') {
  console.log('   foe:', JSON.stringify(await pickFoe(22)));
  await page.waitForTimeout(400);
  results.push(await runCase('bot-near', botKill));
  await revive();
  await page.waitForTimeout(600);
}
if (CASE === 'all' || CASE === 'air') {
  results.push(await runCase('airstrike', airKill));
  await revive();
  await page.waitForTimeout(600);
}
if (CASE === 'all' || CASE === 'crush') {
  /**
   * THE HULL, over the top of him. The three refused shoves that put a man
   * under a moving tank are a wedge that cannot be arranged on demand, so what
   * this drives is the WOUND that path emits, read verbatim off the call site
   * in `src/match/tank.js` (`_shovePlayer`, `tank.crushing`). It measures the
   * attribution — `_recordDamage` -> `describeKiller` -> the strip — and NOT
   * the geometry that gets you there.
   */
  // A hull that is actually on the field, not one still parked off it.
  await page.evaluate(() => window.__M__.tank.fire());
  await page.evaluate(() => { window.__ENGINE__.time.scale = 6; });
  await page.waitForTimeout(4000);
  await page.evaluate(() => { window.__ENGINE__.time.scale = 1; });
  results.push(await runCase('tank-crush', () =>
    page.evaluate(() => {
      const m = window.__M__;
      const p = window.__P__;
      const ai = window.__AI__;
      const t = m.tank.tanks.find((x) => x.state !== 'parked' && x.alive !== false);
      if (!t) return null;
      // Under the tracks, which is where the wound this drives comes from.
      const x = t.position.x + 4;
      const z = t.position.z;
      p.respawnAt({ x, y: ai.groundAt(x, z, t.position.y + 4), z }, t.yaw);
      ai.protect(p, 9999);
      p.applyDamage(9999, t.position, { type: 'explosion', source: t, kind: 'crush' });
      return { hull: t.name, team: t.team, state: t.state, dead: p.health.dead };
    })
  ));
  await revive();
  await page.waitForTimeout(600);
}

/**
 * AND HE GETS IT BACK. The one way to break a player with this is to take the
 * viewmodel off and leave it off, so: die for real, let MATCH'S OWN respawn
 * queue put him back (no harness shortcut), and read the rig.
 */
if (CASE === 'all' || CASE === 'restore') {
  console.log('\n[kc] ══════════ viewmodel restored on the real respawn ══════════');
  console.log('   foe:', JSON.stringify(await pickFoe(0)));
  await botKill();
  await page.waitForTimeout(500);
  const dead = await page.evaluate(() => ({
    dead: window.__P__.health.dead,
    killCam: window.__M__.spectator.killCam,
    rig: window.__W__.viewmodel.rig.visible,
  }));
  console.log(`   while the cam is up: dead=${dead.dead} killCam=${dead.killCam} rig.visible=${dead.rig}`);
  await page.evaluate(() => { window.__ENGINE__.time.scale = 4; });
  await page.waitForFunction(
    () => window.__ENGINE__.ctx.peek('player').health.dead === false,
    null,
    { timeout: 60000 }
  );
  await page.evaluate(() => { window.__ENGINE__.time.scale = 1; });
  await page.waitForTimeout(700);
  const back = await page.evaluate(() => ({
    dead: window.__P__.health.dead,
    killCam: window.__M__.spectator.killCam,
    rig: window.__W__.viewmodel.rig.visible,
    scoped: !!window.__W__.scoped,
    strip: window.__UI__.killCamStrip.active,
  }));
  console.log(`   after the respawn:   dead=${back.dead} killCam=${back.killCam} ` +
    `rig.visible=${back.rig} scoped=${back.scoped} strip.active=${back.strip}`);
  console.log(`   ${dead.rig === false && back.rig === true ? 'PASS' : 'FAIL'}  ` +
    'hidden for the cam, back in his hands on the respawn');
  await page.screenshot({ path: `${SHOTS}/killcam-respawned${TAG}.png` });
}

console.log('\n[kc] summary');
for (const r of results) {
  console.log(`   ${r.label.padEnd(10)} frames=${r.frames} offScreen=${r.off} behind=${r.behind} occluded=${r.occl}`);
}
console.log(`\n[kc] pageerrors: ${errors.length}`);
for (const e of errors) console.log('   ' + e);
await browser.close();
