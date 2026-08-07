/**
 * A COPY OF `_tankdiag.mjs`, DIFFERING IN ONE LINE: THE URL.
 *
 * The original does `${URL}?capture=1`, which is the truncating append this
 * tree has been bitten by — hand it `http://host/?map=plains` and it produces
 * `?map=plains?capture=1`, the map id parses as the string "plains?capture=1",
 * no level matches, and it silently measures the TOWN while reporting itself as
 * the plain. Here the map is its own argument and the query is assembled once,
 * and the run echoes `world.level.id` so the map is observed rather than
 * intended. Nothing else is changed: the measurement is the original's.
 */
/**
 * DOES THE TANK EXIST, AND DOES ANYBODY EVER SEE IT?
 *
 * The player has never once seen it. `_events.mjs` marked "tank" at t=0 in every
 * run because its test was `m.tank || m.tanks?.length` and `m.tank` is the
 * Armour INSTANCE, which is truthy from boot — it says nothing about a sortie.
 * This probe measures the sortie itself, per frame, off `match.tank.tanks[]`.
 *
 *   created?      the boot log + tanks.length + chunk counts
 *   when?         the match second `state` first leaves 'parked'
 *   how long?     seconds between roll and park/dead
 *   does it move? total path metres travelled, and world-space displacement
 *   is it drawn?  root.visible, and whether it is inside the camera frustum
 *   seen/shot?    health lost, main-gun shots fired, kill credit
 */
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:4579/';
const MAP = process.env.MAP ?? 'town';
const URL = process.argv[2] ?? 'http://127.0.0.1:4272/';
const SPEED = Number(process.argv[3] ?? 12);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
const logs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { const t = m.text(); if (/\[tank\]|\[match\] cathedral|\[airstrike\] (SALVO|FINAL)/.test(t)) logs.push(t); });
await page.goto(`${BASE}?capture=1&map=${MAP}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('map', await page.evaluate(() => window.__ENGINE__?.ctx?.peek('world')?.level?.id ?? '?'));

const res = await page.evaluate(async (SPEED) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = SPEED; // NOT `e.timeScale`/`e.speed` — neither exists, so the old
  // line was a no-op and every "12x" run in this file was real time.
  
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const matchTime = m.roundClock;
  const t = () => +(matchTime - m.roundClock).toFixed(1);
  const armour = m.tank;
  const boot = {
    ready: !!armour?.ready,
    n: armour?.tanks?.length ?? 0,
    buildMs: +(armour?.buildMs ?? 0).toFixed(1),
    rows: (armour?.tanks ?? []).map((x) => ({
      id: x.id, team: x.team, chunks: x.chunkCount,
      routeLen: +x.path.length.toFixed(1), samples: x.path.n,
      narrowest: +x.path.narrowest.toFixed(1),
      start: [+x.path.X[0].toFixed(1), +x.path.Z[0].toFixed(1)],
      end: [+x.path.X[x.path.n - 1].toFixed(1), +x.path.Z[x.path.n - 1].toFixed(1)],
      meshes: x.meshes.length,
    })),
  };
  const per = {};
  for (const x of armour?.tanks ?? []) per[x.id] = {
    rolledAt: null, endedAt: null, endState: null, sMax: 0, dispMax: 0,
    framesVisible: 0, framesOnScreen: 0, framesAlive: 0,
    minHealth: x.health, shots: 0, seenByBotFrames: 0, nearestBotEver: 1e9,
    x0: null, z0: null, focusSum: 0, focusN: 0, focusMin: 1e9, nearSum: 0, nearN: 0,
  };
  let shots = 0;
  const onTank = (ev) => { if (ev.phase === 'fire') shots++; };
  e.ctx.events.on('match:tank', onTank);

  // frustum test without allocating in the hot loop is fine here — probe code
  const THREE_Frustum = e.camera.projectionMatrix.constructor; // Matrix4
  const events = [];
  const seen = {};
  const mark = (k) => { if (!seen[k]) { seen[k] = true; events.push([k, t(), m.score ? m.score.slice() : null]); } };

  const start = performance.now();
  let lastShots = 0;
  while (performance.now() - start < 560000) {
    await new Promise((r) => requestAnimationFrame(r));
    if (m.phase !== 'live') { events.push(['MATCH END (' + m.phase + ')', t(), m.score ? m.score.slice() : null]); break; }
    const w = e.ctx.peek('world');
    if (w?.cathedral?.razed) mark('CATHEDRAL RAZED');
    if (m._cathedralCalled) mark('cathedral salvo called');
    if (m.sites?.some?.((s) => s.id === 'D')) mark('SITE D live');
    for (const d of w?.demolitions ?? []) if (d.down) mark('block down: ' + d.id);
    for (const x of armour?.tanks ?? []) {
      const p = per[x.id];
      if (x.state !== 'parked') {
        if (p.rolledAt === null) { p.rolledAt = t(); p.x0 = x.position.x; p.z0 = x.position.z; events.push(['TANK ' + x.id + ' ROLLS', t(), m.score.slice()]); }
        p.sMax = Math.max(p.sMax, x.s);
        if (p.x0 !== null) p.dispMax = Math.max(p.dispMax, Math.hypot(x.position.x - p.x0, x.position.z - p.z0));
        if (x.root.visible) p.framesVisible++;
        if (x.alive) p.framesAlive++;
        p.minHealth = Math.min(p.minHealth, x.health);
        /**
         * "ON SCREEN" HERE IS A WEAK TEST AND SAYING SO IS PART OF THE ANSWER:
         * the probe freezes the player in spawn and never turns the camera, so
         * a hull that drives away down the map is out of a 900x600 frustum
         * whatever it does. The number that means something is how far the tank
         * is from `_airFocus` — the centre of the fight, with the player's own
         * eye weighted as four men, which is what every air event is aimed with.
         */
        const v = x.position.clone(); v.y += 1.5; v.project(e.camera);
        if (v.z > 0 && v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) p.framesOnScreen++;
        const f = m._airFocus;
        if (f) {
          const d = Math.hypot(f.x - x.position.x, f.z - x.position.z);
          p.focusSum += d; p.focusN++;
          if (d < p.focusMin) p.focusMin = d;
        }
        let near = 0;
        for (const a of e.ctx.peek('ai')?.agents ?? []) {
          if (!a.alive) continue;
          if (Math.hypot(a.position.x - x.position.x, a.position.z - x.position.z) < 40) near++;
        }
        p.nearSum += near; p.nearN++;
        // nearest bot
        for (const a of e.ctx.peek('ai')?.agents ?? []) {
          if (!a.alive) continue;
          const d = Math.hypot(a.position.x - x.position.x, a.position.z - x.position.z);
          if (d < p.nearestBotEver) p.nearestBotEver = d;
        }
      } else if (p.rolledAt !== null && p.endedAt === null) {
        p.endedAt = t(); p.endState = x.health <= 0 ? 'destroyed' : 'withdrew';
        events.push(['TANK ' + x.id + ' ' + p.endState.toUpperCase(), t(), m.score.slice()]);
      }
      if (x.state === 'dead' && p.endedAt === null) { p.endedAt = t(); p.endState = 'destroyed'; events.push(['TANK ' + x.id + ' DESTROYED', t(), m.score.slice()]); }
    }
    if (shots !== lastShots) lastShots = shots;
    if (m.roundClock <= 0) { events.push(['CLOCK EXPIRED', t(), m.score]); break; }
  }
  e.ctx.events.off?.('match:tank', onTank);
  for (const k in per) { per[k].nearestBotEver = per[k].nearestBotEver > 1e8 ? null : +per[k].nearestBotEver.toFixed(1); per[k].sMax = +per[k].sMax.toFixed(1); per[k].dispMax = +per[k].dispMax.toFixed(1); }
  return {
    boot, per, events, shots,
    sorties: armour?._sorties ?? null,
    phase: m.phase, clockLeft: +m.roundClock.toFixed(1), score: m.score, matchTime,
    rulesFirstDelay: window.__RULES__?.tankFirstDelay ?? null,
  };
}, SPEED);

console.log(`\n=== BOOT ===`);
console.log(`  ready=${res.boot.ready}  tanks=${res.boot.n}  buildMs=${res.boot.buildMs}`);
for (const r of res.boot.rows) console.log(`  ${r.id} team${r.team} route ${r.routeLen}m/${r.samples} samples narrowest ${r.narrowest}m  ${r.chunks} wreck chunks  ${r.meshes} meshes  start(${r.start}) end(${r.end})`);
console.log(`\n=== MATCH (clock ${res.matchTime}s, ended "${res.phase}" ${res.clockLeft}s left, score ${JSON.stringify(res.score)}) ===`);
console.log('  event                          t(s)   score');
for (const [k, tt, s] of res.events) console.log(`  ${String(k).padEnd(28)} ${String(tt).padStart(6)}   ${JSON.stringify(s)}`);
console.log(`\n=== PER TANK ===  (sorties launched: ${res.sorties}, main-gun shots: ${res.shots})`);
for (const [id, p] of Object.entries(res.per)) {
  console.log(`  ${id}: rolled=${p.rolledAt} ended=${p.endedAt} (${p.endState}) life=${p.rolledAt !== null && p.endedAt !== null ? (p.endedAt - p.rolledAt).toFixed(1) : '—'}s`);
  console.log(`      travelled ${p.sMax} m along path, max displacement ${p.dispMax} m`);
  console.log(`      frames: visible ${p.framesVisible}, ON SCREEN ${p.framesOnScreen}, alive ${p.framesAlive}`);
  console.log(`      health ${Math.round(p.minHealth)}/2600 min, nearest bot ever ${p.nearestBotEver} m`);
  console.log(`      distance to the CENTRE OF THE FIGHT: min ${p.focusMin > 1e8 ? '—' : p.focusMin.toFixed(1)} m, mean ${p.focusN ? (p.focusSum / p.focusN).toFixed(1) : '—'} m`);
  console.log(`      live bots within 40 m, mean ${p.nearN ? (p.nearSum / p.nearN).toFixed(1) : '—'}`);
}
console.log(`\n=== CONSOLE ===`);
for (const l of logs) console.log('  ' + l);
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
