/**
 * DID THE PLOUGH MAKE A SOUND, DID IT TRAVEL, AND DID ANYTHING TAKE ITS SLOT?
 *
 *   node _ploughvoice.mjs [--url=http://127.0.0.1:4599/?map=plains] [--warm=30000]
 *
 * A CALL COUNT IS NOT A MEASUREMENT — this subsystem has shipped six bugs that
 * prove it, and three of them (a voice at the wrong gain, a voice refused by a
 * full pool, a voice whose slot was stolen ten milliseconds in) are INVISIBLE
 * to `play() was called once`. So this taps five layers:
 *
 *   1. THE CALL. `audio.startPlough`, and whether it returned a handle or null.
 *   2. THE SLOT. Every `field.acquire` tagged `plough`, with the full pool dump
 *      on a refusal, and every `detach` of one — naming the requester that took
 *      it and how much of the voice was still owed.
 *   3. THE GAIN. `distGain` (the attenuated output — the number that is zero
 *      when a voice is "playing" inaudibly), `sendGain` and `userGain` at 20 Hz.
 *   4. THAT IT MOVES. The emitter's own position every sample. A voice anchored
 *      at the impact point while the wreck travels 157 m is a sound coming from
 *      somewhere the wreck is not, and it looks perfect to every other probe.
 *   5. THE CONTROL. `collapse_sub` fires from the same object 0.04 s earlier at
 *      the same place, so its emitter is in the same field at the same distance
 *      and the two `distGain`s are directly comparable. That is the only honest
 *      way to say how big this voice is without being able to hear it.
 *
 * THE HONEST LIMIT: headless Chrome renders through a null sink under
 * `--mute-audio`. Everything below is node graphs, gain values, positions and
 * call counts. Nothing here has heard anything.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4599/?map=plains';
const WARM = Number(args.warm ?? 30000);
const RUN = Number(args.run ?? 22000);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-frame-rate-limit',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 900, height: 560 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
const lines = [];
p.on('console', (m) => {
  const t = m.text();
  if (/crash\]|\[audio\]/.test(t)) lines.push(t.slice(0, 200));
});

console.log(`[ploughvoice] booting ${URL} …`);
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const boot = await p.evaluate(async (bare) => {
  const e = window.__ENGINE__;
  const a = e.ctx.peek('audio');
  try { await a?.start?.(); } catch { /* reported below */ }
  window.__CALLS__ = [];
  window.__EV__ = [];
  window.__SAMP__ = [];

  /**
   * `--bare` IS THE CONTROL, and it is the only way to say what this voice
   * costs or adds. The same match, the same act, the same 34 m blast, the same
   * 27 fire cells — without the plough. `out.rms` over the identical window is
   * then a DIFFERENCE rather than a claim. Same idea as `audiotest --bare`.
   */
  const os = a.startPlough.bind(a);
  a.startPlough = (pos, o) => {
    const r = bare ? null : os(pos, o);
    window.__CALLS__.push({
      t: +e.time.elapsed.toFixed(2), ok: !!r,
      pos: pos ? [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)] : null,
      running: a.running, state: a.actx?.state ?? 'none',
    });
    return r;
  };

  const fld = a.field;
  const oacq = fld.acquire.bind(fld);
  window.__REQ__ = null;
  fld.acquire = (o) => {
    window.__REQ__ = o;
    const r = oacq(o);
    window.__REQ__ = null;
    if (o?.tag === 'plough' || o?.tag === 'collapse') {
      // On a REFUSAL, dump every slot the scan could see. "The pool was full"
      // is not a diagnosis; which slots, at what priority, on which bus and how
      // near done, is.
      const dump = r ? null : fld.emitters.map((x, i) => ({
        i, free: x.free, tr: x.tracked, pri: x.priority, bus: x.busName,
        left: +(x.endTime - a.actx.currentTime).toFixed(2), tag: x.kindTag,
      })).filter((x) => !x.free);
      window.__EV__.push({
        t: +a.actx.currentTime.toFixed(2), ev: r ? 'acquire' : 'REFUSED', tag: o.tag,
        gain: o.gain, pri: o.priority, bus: o.bus, tracked: !!o.tracked,
        idx: r ? fld.emitters.indexOf(r) : -1,
        load: fld.stats.active, cap: fld.stats.cap, stolen: fld.stats.stolen, dump,
      });
    }
    return r;
  };
  for (const em of fld.emitters) {
    const od = em.detach.bind(em);
    em.detach = function detach() {
      if ((this.kindTag === 'plough' || this.kindTag === 'collapse') && !this.free) {
        const q = window.__REQ__;
        window.__EV__.push({
          t: +a.actx.currentTime.toFixed(2), ev: 'DETACH', tag: this.kindTag,
          idx: fld.emitters.indexOf(this), gain: this.userGain,
          owed: +(this.endTime - a.actx.currentTime).toFixed(2), myPri: this.priority,
          // null is the field's own update() expiring the slot on time, which
          // is not a theft at all. Anything else names the voice that outbid it.
          by: q ? `${q.tag ?? '?'}/${q.bus}/pri=${q.priority}` : 'expired-or-owner',
        });
      }
      return od();
    };
  }

  window.__TIMER__ = setInterval(() => {
    const f = a.field;
    if (!f) return;
    const now = a.actx.currentTime;
    const wall = performance.now() / 1000;
    const live = [];
    for (const em of f.emitters) {
      if (em.free || (em.kindTag !== 'plough' && em.kindTag !== 'collapse')) continue;
      live.push({
        tag: em.kindTag, bus: em.busName, tr: !!em.tracked,
        // @see _collvoice.mjs: every gain is written with setValueAtTime at
        // `startAt`, which for a distant source is in the FUTURE. Reading
        // `.value` before then returns whatever the recycled slot left behind.
        armed: now >= (em.startAt ?? 0),
        dist: +(em.distGain?.gain.value ?? -1).toFixed(4),
        send: +(em.sendGain?.gain.value ?? -1).toFixed(4),
        user: +(em.userGain ?? -1).toFixed(2),
        m: +(em.dist ?? -1).toFixed(1),
        occ: +(em.occ ?? -1).toFixed(2),
        x: +em.pos.x.toFixed(1), y: +em.pos.y.toFixed(1), z: +em.pos.z.toFixed(1),
        lease: em.tracked ? +(em.lease - wall).toFixed(2) : null,
        left: +((em.endTime ?? now) - now).toFixed(2),
      });
    }
    const c = e.ctx.peek('match')?.crash;
    const w = a.watchdog;
    window.__SAMP__.push({
      t: +e.time.elapsed.toFixed(2),
      skid: c && c._t >= 0 ? +(c._t - c._fall).toFixed(2) : null,
      voices: live,
      act: f.stats.active, cap: f.stats.cap, dropped: f.stats.dropped, stolen: f.stats.stolen,
      peak: +(w?.out.peak ?? 0).toFixed(4), rms: +(w?.out.rms ?? 0).toFixed(5),
      deaf: +(a.mixer?.deafness ?? 0).toFixed(3),
      errors: a.stats.errors,
    });
  }, 50);
  return { running: a.running, state: a.actx?.state ?? 'none', bare: !!bare };
}, !!args.bare);
console.log('[ploughvoice] audio at boot:', JSON.stringify(boot));

console.log(`[ploughvoice] warming the match up (${WARM / 1000}s) …`);
await p.waitForTimeout(WARM);
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });

/**
 * STAND THE LISTENER SOMEWHERE THE EVENT IS AUDIBLE AND FIXED, so `distGain`
 * means something. 90 m off the track's midpoint, which is about where a man
 * holding C or the fortress actually is when this happens.
 */
const stood = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ph = e.ctx.peek('physics');
  const c = m.crash;
  m._checkWinConditions = () => {};
  const n = c._cx.length;
  const mx = (c._cx[0] + c._cx[n - 1]) / 2;
  const mz = (c._cz[0] + c._cz[n - 1]) / 2;
  const x = mx + c._hz * 90, z = mz - c._hx * 90;
  const y = ph.groundHeight(x, z, 400) + 1.7;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  const V3 = e.camera.position.constructor;
  e.camera.position.set(x, y, z);
  e.camera.lookAt(new V3(mx, y - 1, mz));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  const pl = e.ctx.peek('player');
  if (pl) { pl.applyDamage = () => {}; setInterval(() => pl.heal?.(100), 250); }
  return { x: +x.toFixed(1), z: +z.toFixed(1), mx: +mx.toFixed(1), mz: +mz.toFixed(1) };
});
console.log(`[ploughvoice] listener at (${stood.x}, ${stood.z}), scar midpoint (${stood.mx}, ${stood.mz})`);

console.log('[ploughvoice] fired:', await p.evaluate(() => window.__ENGINE__.ctx.peek('match').crash.fire()));
await p.waitForTimeout(RUN);

const out = await p.evaluate(() => {
  clearInterval(window.__TIMER__);
  const a = window.__ENGINE__.ctx.peek('audio');
  return { calls: window.__CALLS__, ev: window.__EV__, samp: window.__SAMP__,
    errors: a.stats.errors, dropped: a.field?.stats.dropped ?? -1,
    stolen: a.field?.stats.stolen ?? -1, leaked: a.field?.stats.leaked ?? -1 };
});

console.log(`\n  startPlough CALLS (${out.calls.length})`);
if (!out.calls.length) console.log('    NONE — the act never asked for the voice at all.');
for (const c of out.calls) {
  console.log(`    t=${String(c.t).padStart(7)}  handle=${c.ok}  at=${c.pos?.join(',')}  ` +
    `running=${c.running} ctx=${c.state}`);
}

console.log(`\n  POOL EVENTS (${out.ev.length}) — every acquire/detach of a plough- or collapse-tagged slot`);
for (const e of out.ev) {
  console.log(`    t=${String(e.t).padStart(8)}  ${e.ev.padEnd(8)} ${String(e.tag).padEnd(9)} ` +
    `slot=${String(e.idx).padStart(3)} gain=${e.gain}` +
    `${e.pri !== undefined ? ` pri=${e.pri} bus=${e.bus} tracked=${e.tracked} load=${e.load}/${e.cap}` : ''}` +
    `${e.owed !== undefined ? `  owed=${e.owed}s  myPri=${e.myPri}  BY ${e.by}` : ''}`);
  if (e.dump) {
    console.log(`      ${e.dump.length} busy slots the scan could see:`);
    for (const x of e.dump) {
      console.log(`        [${String(x.i).padStart(3)}] ${x.tr ? 'TRACKED' : '       '} ` +
        `pri=${String(x.pri).padEnd(6)} ${String(x.bus).padEnd(9)} left=${String(x.left).padStart(8)} tag=${x.tag}`);
    }
  }
}

const withPlough = out.samp.filter((s) => s.voices.some((v) => v.tag === 'plough'));
console.log(`\n  THE PLOUGH EMITTER — ${withPlough.length} samples of ${out.samp.length} ` +
  `(${(withPlough.length * 0.05).toFixed(2)}s live at 20 Hz)`);
if (withPlough.length) {
  console.log('     t   skid   dist(m)  distGain  sendGain  user  occ   lease   position');
  for (let i = 0; i < withPlough.length; i += 4) {
    const s = withPlough[i];
    for (const v of s.voices) {
      if (v.tag !== 'plough') continue;
      console.log(`  ${String(s.t).padStart(6)} ${String(s.skid ?? '-').padStart(6)} ` +
        `${String(v.m).padStart(8)} ${String(v.dist).padStart(9)} ${String(v.send).padStart(9)} ` +
        `${String(v.user).padStart(5)} ${String(v.occ).padStart(5)} ${String(v.lease).padStart(7)} ` +
        `(${v.x}, ${v.y}, ${v.z})${v.armed ? '' : '  PRE-ARM'}`);
    }
  }
  // DID IT TRAVEL? A voice anchored at the impact point looks identical to a
  // travelling one in every counter this subsystem has.
  let d = 0, prev = null, maxStep = 0;
  for (const s of withPlough) {
    const v = s.voices.find((x) => x.tag === 'plough');
    if (prev) {
      const st = Math.hypot(v.x - prev.x, v.y - prev.y, v.z - prev.z);
      d += st; maxStep = Math.max(maxStep, st);
    }
    prev = v;
  }
  const g = withPlough.map((s) => s.voices.find((x) => x.tag === 'plough')).filter((v) => v.armed);
  console.log(`\n  TRAVELLED  ${d.toFixed(1)} m along the emitter's own path, ` +
    `largest step between samples ${maxStep.toFixed(1)} m ` +
    `(the wreck ploughs 157 m; anchored at the impact point this is 0)`);
  console.log(`  GAIN       distGain ${Math.min(...g.map((v) => v.dist)).toFixed(4)} .. ` +
    `${Math.max(...g.map((v) => v.dist)).toFixed(4)}   userGain ${g[0]?.user}   ` +
    `sendGain ${Math.min(...g.map((v) => v.send)).toFixed(4)} .. ${Math.max(...g.map((v) => v.send)).toFixed(4)}`);
} else {
  console.log('    NEVER IN THE FIELD — it was called, or refused, but no emitter ever carried it.');
}

const coll = out.samp.flatMap((s) => s.voices.filter((v) => v.tag === 'collapse' && v.armed));
if (coll.length) {
  console.log(`\n  CONTROL — collapse voices in the same field, same event, same place:` +
    ` distGain ${Math.min(...coll.map((v) => v.dist)).toFixed(4)} .. ` +
    `${Math.max(...coll.map((v) => v.dist)).toFixed(4)} (userGain ${coll[0].user})`);
}

/**
 * THE WINDOW IS `skid`, NOT "frames with a plough emitter in them", so the same
 * five seconds are measured with the voice and without it. `Crash` publishes
 * `_t` and `_fall` whatever the audio subsystem did.
 */
const win = out.samp.filter((s) => s.skid !== null && s.skid >= 0 && s.skid <= 5.5);
const peakAll = out.samp.reduce((m, s) => Math.max(m, s.peak), 0);
const peakWin = win.reduce((m, s) => Math.max(m, s.peak), 0);
const rmsWin = win.length ? win.reduce((m, s) => m + s.rms, 0) / win.length : 0;
const rmsAll = out.samp.reduce((m, s) => m + s.rms, 0) / Math.max(1, out.samp.length);
console.log(`\n  MIX        out.peak over the run ${peakAll.toFixed(4)}, over the plough window ${peakWin.toFixed(4)};` +
  `  mean out.rms ${rmsAll.toExponential(2)} over the run, ${rmsWin.toExponential(2)} ` +
  `over the ${win.length} samples of the plough window`);
console.log(`  POOL       dropped=${out.dropped} stolen=${out.stolen} leaked=${out.leaked}  ` +
  `audio.stats.errors=${out.errors}`);
console.log('\n  console');
for (const l of lines.slice(-14)) console.log(`    ${l}`);
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 4).join(' | ')}` : '\n0 pageerrors');
await b.close();
