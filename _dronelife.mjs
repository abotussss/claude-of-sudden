/**
 * THE SUICIDE DRONE'S WHOLE LIFECYCLE, EVERY EXIT, AND THE TWO ENDS THE SALVAGE
 * WAS CUT OFF AT — the launch reset, the stats, `reset()` and `dispose()`.
 *
 * Five exits exist and each one has to be walked, because the pool is REUSED:
 * a slot that came down in dead air is the slot the next launch flies out of,
 * and the salvaged `_empKill` leaves five fields and two materials on it.
 *
 *   detonate  the dive that connects
 *   dead+boom a round kills it, and the warhead functions
 *   scuttle   the life clock runs out
 *   emp+down  an EMP field cuts the power; it falls and lands SILENT
 *   retire    `reset()` / `dispose()` take one out of the air
 *
 * The URL is assembled here rather than taken as a prefix: several probes in
 * this tree do `${URL}?capture=1`, which turns a `?map=plains` argument into
 * `?map=plains?capture=1` and silently runs the town. @see the map echo below,
 * which is the proof rather than the intent.
 */
import { chromium } from 'playwright';

const MAP = process.argv[2] ?? 'plains';
const url = `http://127.0.0.1:4579/?capture=1&seed=7&map=${MAP}`;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 1; });

const out = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const dr = window.__DRONES__;
  const ai = e.ctx.peek('ai');
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const report = { map: e.ctx.peek('world')?.level?.id, steps: [] };
  const note = (k, v) => report.steps.push([k, v]);

  /** Everything on a drone that a reused slot must have had put back. */
  const snap = (d) => ({
    state: d.state, alive: d.alive, health: d.health, life: +d.life.toFixed(1),
    rotorRate: +d.rotorRate.toFixed(1), spinX: +d.spinX.toFixed(2), spinZ: +d.spinZ.toFixed(2),
    fallT: +d.fallT.toFixed(2), fallT_ok: d.fallT === 0,
    rotX: +d.group.rotation.x.toFixed(3), rotZ: +d.group.rotation.z.toFixed(3),
    strobeDead: d.strobe.material === dr._deadStrobe,
    haloDead: d.halo.material === dr._deadHalo,
    collider: !!d.collider, visible: d.group.visible, mark: d.mark.visible,
    aim: d.aim.visible, warning: d.warning, target: !!d.target,
    aiTargetable: ai.targetable(d),
  });

  const zone = dr.emp?.zones?.[0] ?? null;
  report.fields = (dr.emp?.zones ?? []).map((z) => ({ id: z.id, r: +z.r.toFixed(1) }));

  /* ── 1. EMP: the exit the salvage was mid-way through ─────────────────── */
  if (zone) {
    const d = dr.fire(0);
    d.position.set(zone.position.x, zone.position.y + 18, zone.position.z);
    d.vel.set(6, 2, 0);
    d.state = 'hunt';
    const before = { empKilled: dr.stats.empKilled, crashed: dr.stats.crashed, detonated: dr.stats.detonated };
    let fell = null, landed = null;
    for (let i = 0; i < 900; i++) {
      await frame();
      if (!fell && d.state === 'fall') fell = { snap: snap(d), flash: +zone.flash.toFixed(2), kills: zone.kills };
      if (fell && !d.alive) { landed = snap(d); break; }
    }
    note('empFall', fell);
    note('empLanded', landed);
    note('empStats', {
      empKilled: dr.stats.empKilled - before.empKilled,
      crashed: dr.stats.crashed - before.crashed,
      // MUST be 0: the one silent death in the system. @see empzone.js.
      detonated: dr.stats.detonated - before.detonated,
    });

    /* ── 2. THE SAME SLOT, RELAUNCHED — the launch reset under test ─────── */
    const d2 = dr.fire(1);
    note('relaunchSameSlot', d2 && d2.slot === d.slot);
    note('relaunch', d2 ? snap(d2) : null);
  } else {
    note('empFall', 'no fields on this map');
  }

  /* ── 3. A ROUND KILLS ONE: dead THEN boom ─────────────────────────────── */
  {
    const d = dr.fire(0);
    d.position.set(0, 60, 0);
    const seen = [];
    const off = (p) => { if (p.id === d.id) seen.push(p.phase); };
    e.ctx.events.on('match:drone', off);
    const b = { shotDown: dr.stats.shotDown, detonated: dr.stats.detonated };
    e.ctx.events.emit('damage:dealt', { target: d, amount: 999 });
    e.ctx.events.off('match:drone', off);
    note('shotDown', {
      phases: seen, alive: d.alive, collider: !!d.collider,
      shotDown: dr.stats.shotDown - b.shotDown, detonated: dr.stats.detonated - b.detonated,
    });
  }

  /* ── 4. THE LIFE CLOCK ────────────────────────────────────────────────── */
  {
    const d = dr.fire(0);
    d.position.set(0, 60, 0);
    d.life = 0.001;
    const b = { scuttled: dr.stats.scuttled, detonated: dr.stats.detonated };
    for (let i = 0; i < 20 && d.alive; i++) await frame();
    note('scuttle', {
      alive: d.alive,
      scuttled: dr.stats.scuttled - b.scuttled, detonated: dr.stats.detonated - b.detonated,
    });
  }

  /* ── 5. A DRONE IN DEAD AIR WHEN THE MATCH RESETS ─────────────────────── */
  if (zone) {
    const d = dr.fire(0);
    d.position.set(zone.position.x, zone.position.y + 18, zone.position.z);
    for (let i = 0; i < 60 && d.state !== 'fall'; i++) await frame();
    const falling = d.state === 'fall';
    dr.reset();
    note('resetWhileFalling', {
      wasFalling: falling, alive: d.alive, visible: d.group.visible, mark: d.mark.visible,
      collider: !!d.collider,
      statsZero: Object.entries(dr.stats).every(([, v]) => (Array.isArray(v) ? v[0] === 0 && v[1] === 0 : v === 0)),
      fieldFlash: +zone.flash.toFixed(2), fieldKills: zone.kills,
      left: dr.left, aloft: dr.aloft,
    });
  }

  /* ── 6. THE BUDGET, AND THAT IT IS A HARD CEILING ─────────────────────── */
  {
    let got = 0;
    for (let i = 0; i < 40; i++) { if (dr.fire(i & 1)) got++; else break; }
    note('budget', { fired: got, left: dr.left, aloft: dr.aloft, poolLen: dr.list.length });
    dr.reset();
  }

  /* ── 7. DISPOSE — the fields go with the drones ───────────────────────── */
  {
    const scene = e.ctx.scene;
    const has = (n) => { let f = false; scene.traverse((o) => { if (o.name === n) f = true; }); return f; };
    const before = { drones: has('match-drones'), emp: has('match-emp') };
    const info = e.renderer?.info?.memory ? { ...e.renderer.info.memory } : null;
    dr.dispose();
    const after = { drones: has('match-drones'), emp: has('match-emp'), empNulled: dr.emp === null, ready: dr.ready };
    note('dispose', { before, after, memBefore: info, memAfter: e.renderer?.info?.memory ? { ...e.renderer.info.memory } : null });
  }
  return report;
});

console.log(JSON.stringify(out, null, 1));
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs.slice(0, 4).join(' | ')}` : 'pageerrors: none');
await browser.close();
