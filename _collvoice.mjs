/**
 * DID THE SET PIECE ACTUALLY MAKE A SOUND, AND HOW BIG WAS IT?
 *
 *   node _collvoice.mjs --url=http://127.0.0.1:4596/?map=town  --event=cathedral
 *   node _collvoice.mjs --url=http://127.0.0.1:4596/?map=plains --event=act0|act1|act2
 *
 * A CALL COUNT IS NOT A MEASUREMENT, and this subsystem has shipped five bugs
 * that prove it: a voice that plays at a gain of zero, a voice that is refused
 * by a full pool and a voice that throws all look identical to `play()` being
 * called once. So this taps THREE layers and prints all three:
 *
 *   1. THE CALL. Every `audio.play('collapse_*')` the match makes, with the
 *      options bag it passed and the BOOLEAN `_playCollapse` returned. `false`
 *      is a voice that was asked for and did not play.
 *   2. THE EMITTER. The spatial field is sampled at 20 Hz and every live
 *      emitter tagged `collapse` is recorded with its `distGain` (the attenuated
 *      output gain — this is the number that is zero when a voice is "playing"
 *      inaudibly), its `sendGain` (the reverb pass `_onExplosion` once killed by
 *      overriding it to 1.0) and its `userGain`.
 *   3. THE MIX. `watchdog.out.peak` across the event, plus `mixer.deafness` and
 *      the ambience duck — because the duck and the concussion are half of what
 *      `_playCollapse` is FOR and they only fire on `collapse_sub`.
 *
 * THE HONEST LIMIT: headless Chrome renders through a null sink under
 * `--mute-audio`. Everything below is node graphs, gain values and call counts.
 * Nothing here has heard anything.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4596/?map=town';
const EVENT = String(args.event ?? 'cathedral');
const SCALE = Number(args.scale ?? 2);
const WARM = Number(args.warm ?? 30000);
const RUN = Number(args.run ?? 60000);

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
  if (/ACT |CATHEDRAL|cathedral|crash\]|MAGAZINE|STRUCTURE DOWN/.test(t)) lines.push(t.slice(0, 200));
});

console.log(`[collvoice] booting ${URL} …`);
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const boot = await p.evaluate(async (scale) => {
  const e = window.__ENGINE__;
  const a = e.ctx.peek('audio');
  try { await a?.start?.(); } catch { /* reported */ }
  window.__CALLS__ = [];
  window.__SAMP__ = [];
  const orig = a.play.bind(a);
  a.play = (kind, pos, opts) => {
    const r = orig(kind, pos, opts);
    if (typeof kind === 'string' && kind.startsWith('collapse_')) {
      window.__CALLS__.push({
        t: +e.time.elapsed.toFixed(2), kind, ok: r === true,
        opts: JSON.stringify(opts ?? {}),
        pos: pos ? [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)] : null,
      });
    }
    return r;
  };
  /**
   * WHO TOOK THE SLOT BACK. A `play()` that returns true has claimed an
   * emitter; it has NOT kept it. The field is over its render cap during a
   * salvo (measured at 60 live against a cap of 24), every acquire on that
   * frame runs the STEAL path, and a voice can therefore be evicted between the
   * frame it starts and the next sample — which reads exactly like a voice that
   * never played. So the pool's own two doors are wrapped: `acquire` (claimed,
   * or refused outright) and `detach` (given back, and how much of the voice
   * was still owed when it happened).
   */
  window.__EV__ = [];
  const fld = a.field;
  const oacq = fld.acquire.bind(fld);
  window.__REQ__ = null;
  fld.acquire = (o) => {
    window.__REQ__ = o;                 // whoever is asking, for the detach hook
    const r = oacq(o);
    window.__REQ__ = null;
    if (o?.tag === 'collapse') {
      // On a REFUSAL, dump every candidate the scan saw. "The pool was full" is
      // not a diagnosis; which slots were there, at what priority, on which bus
      // and how close to done, is.
      const dump = r ? null : fld.emitters.map((x, i) => ({
        i, free: x.free, tr: x.tracked, pri: x.priority, bus: x.busName,
        left: +(x.endTime - a.actx.currentTime).toFixed(2), tag: x.kindTag,
      })).filter((x) => !x.free || !x.tr);
      window.__EV__.push({ t: +a.actx.currentTime.toFixed(2), ev: r ? 'acquire' : 'REFUSED',
        gain: o.gain, idx: r ? fld.emitters.indexOf(r) : -1, pri: o.priority, bus: o.bus,
        load: fld.stats.active, cap: fld.stats.cap, stolen: fld.stats.stolen,
        internals: r ? null : { load: fld._load(), capacity: fld.capacity,
          busLoad: fld._busLoad(o.bus), busCap: fld._busCap(o.bus) },
        dump });
    }
    return r;
  };
  for (const em of fld.emitters) {
    const od = em.detach.bind(em);
    em.detach = function detach() {
      if (this.kindTag === 'collapse' && !this.free) {
        const q = window.__REQ__;
        window.__EV__.push({ t: +a.actx.currentTime.toFixed(2), ev: 'DETACH',
          gain: this.userGain, idx: fld.emitters.indexOf(this),
          owed: +(this.endTime - a.actx.currentTime).toFixed(2), stolen: fld.stats.stolen,
          // WHO TOOK IT. `null` is the field's own `update()` expiring the slot
          // on time, which is not a theft at all; anything else is a live steal
          // and names the voice that outbid a 0.995.
          by: q ? `${q.tag ?? '?'}/${q.bus}/pri=${q.priority}` : 'expired',
          myPri: this.priority });
      }
      return od();
    };
  }
  window.__TIMER__ = setInterval(() => {
    const f = a.field;
    if (!f) return;
    const now = a.actx.currentTime;
    const live = [];
    for (const em of f.emitters) {
      if (em.free || em.kindTag !== 'collapse') continue;
      live.push({
        bus: em.busName,
        /**
         * `armed` IS THE WHOLE REASON THIS FIELD EXISTS. Every gain on an
         * emitter is written with `setValueAtTime(v, startAt)` and `startAt` is
         * `currentTime + dist / 343` — which for an event 300 m away is most of
         * a second in the FUTURE. Reading `.value` before then returns whatever
         * the last voice to use that recycled slot left behind, so a sample
         * taken inside the propagation delay reports a stale number as if it
         * were this voice's. Only `armed` samples are counted below.
         */
        armed: now >= (em.startAt ?? 0),
        dist: +(em.distGain?.gain.value ?? -1).toFixed(4),
        send: +(em.sendGain?.gain.value ?? -1).toFixed(4),
        user: +(em.userGain ?? -1).toFixed(2),
        occ: +(em.occ ?? -1).toFixed(2),
        d: +(em.dist ?? -1).toFixed(1),
        left: +((em.endTime ?? now) - now).toFixed(2),
      });
    }
    const w = a.watchdog;
    window.__SAMP__.push({
      t: +e.time.elapsed.toFixed(2),
      /**
       * THE TWO CLOCKS, BECAUSE THE POOL HAS A DEADLINE ON EACH. `field.update`
       * frees a slot on `now > endTime` (audio clock) OR `wall > wallEnd` (real
       * clock), and the wall one is a BACKSTOP for a render thread that has
       * stalled. Headless Chrome renders through a null sink, so if these two
       * diverge here it is the harness stalling and not the game — and an
       * eviction blamed on it would be an artefact. Measured, not assumed.
       */
      atime: +a.actx.currentTime.toFixed(3),
      wall: +(performance.now() / 1000).toFixed(3),
      coll: live.length, live,
      act: f.stats.active, cap: f.stats.cap, dropped: f.stats.dropped, stolen: f.stats.stolen,
      peak: +(w?.out.peak ?? 0).toFixed(4), rms: +(w?.out.rms ?? 0).toFixed(5),
      deaf: +(a.mixer?.deafness ?? 0).toFixed(3),
      duckA: +(a.mixer?.buses.ambience.duck.gain.value ?? 1).toFixed(3),
      errors: a.stats.errors,
    });
  }, 50);
  e.time.scale = scale;
  return { running: a.running, state: a.actx?.state ?? 'none', battle: !!a.battle,
    script: document.querySelector('script[src*="assets/"]')?.getAttribute('src') ?? null };
}, SCALE);
console.log('[collvoice] audio at boot:', JSON.stringify(boot));

console.log(`[collvoice] warming the match up (${WARM / 1000}s wall) …`);
await p.waitForTimeout(WARM);

const fired = await p.evaluate((ev) => {
  const m = window.__ENGINE__.ctx.peek('match');
  if (!m) return 'no match';
  if (ev === 'cathedral') {
    if (!m._beginCathedralEvent) return 'no cathedral event';
    m._beginCathedralEvent(m.ctx.time.elapsed, 0.99);
    return 'cathedral';
  }
  const i = Number(ev.replace('act', ''));
  const a = m._acts?.[i];
  if (!a) return `no act ${i}`;
  m._nf.i = i;
  m._beginAct(a, m.ctx.time.elapsed, 0.99);
  return `${a.spec.id} "${a.spec.name}"`;
}, EVENT);
console.log(`[collvoice] fired: ${fired}`);
if (fired.startsWith('no ')) { await b.close(); process.exit(1); }

await p.waitForTimeout(RUN);

const out = await p.evaluate(() => {
  clearInterval(window.__TIMER__);
  const a = window.__ENGINE__.ctx.peek('audio');
  return { calls: window.__CALLS__, samp: window.__SAMP__, ev: window.__EV__, errors: a.stats.errors,
    dropped: a.field?.stats.dropped ?? -1, stolen: a.field?.stats.stolen ?? -1 };
});

console.log(`\n  CALLS (${out.calls.length})`);
if (!out.calls.length) console.log('    NONE — the event played no collapse voice at all.');
for (const c of out.calls) {
  console.log(`    t=${String(c.t).padStart(7)}  ${c.kind.padEnd(14)} ok=${String(c.ok).padEnd(5)} ` +
    `pos=${c.pos ? c.pos.join(',') : 'null'}  ${c.opts}`);
}

console.log(`\n  POOL EVENTS (${out.ev.length}) — every acquire/detach of a collapse-tagged slot`);
for (const e of out.ev) {
  console.log(`    t=${String(e.t).padStart(8)}  ${e.ev.padEnd(8)} slot=${String(e.idx).padStart(3)} ` +
    `gain=${e.gain}${e.internals ? `  _load=${e.internals.load}/${e.internals.capacity} busLoad=${e.internals.busLoad}/${e.internals.busCap} pri=${e.pri}` : ''}${e.owed !== undefined ? `  owed=${e.owed}s  pri=${e.myPri}  BY ${e.by}` : `  load=${e.load}/${e.cap}`}  field.stolen=${e.stolen}`);
  if (e.dump) {
    const busy = e.dump.filter((x) => !x.free);
    console.log(`      every slot the scan could see: ${busy.length} busy, ${e.dump.length - busy.length} free`);
    for (const x of e.dump) {
      console.log(`        [${String(x.i).padStart(3)}] ${x.free ? 'FREE' : 'busy'} ` +
        `${x.tr ? 'TRACKED' : '       '} pri=${String(x.pri).padEnd(6)} ${String(x.bus).padEnd(9)} ` +
        `left=${String(x.left).padStart(8)} tag=${x.tag}`);
    }
  }
}

// The frames a collapse emitter was live on, and the loudest gain each voice
// reached. A voice at dist=0 is playing into silence; that is the bug class.
const withColl = out.samp.filter((s) => s.coll > 0);
const armed = out.samp.filter((s) => s.live.some((l) => l.armed));
let peakDist = 0, peakSend = 0, maxColl = 0;
for (const s of withColl) {
  maxColl = Math.max(maxColl, s.coll);
  for (const l of s.live) {
    if (!l.armed) continue;               // @see `armed` — a stale slot is not a measurement
    peakDist = Math.max(peakDist, l.dist);
    peakSend = Math.max(peakSend, l.send);
  }
}
const peakAll = out.samp.reduce((m, s) => Math.max(m, s.peak), 0);
const peakWin = withColl.reduce((m, s) => Math.max(m, s.peak), 0);
const deafMax = out.samp.reduce((m, s) => Math.max(m, s.deaf), 0);
const duckMin = out.samp.reduce((m, s) => Math.min(m, s.duckA), 1);

console.log(`\n  EMITTERS  frames-with-a-collapse-emitter=${withColl.length}/${out.samp.length}  ` +
  `(armed=${armed.length})  max-concurrent=${maxColl}  ` +
  `peak distGain=${peakDist.toFixed(4)}  peak sendGain=${peakSend.toFixed(4)}`);
console.log(`  MIX       out.peak over the run=${peakAll.toFixed(4)}  over the collapse window=${peakWin.toFixed(4)}  ` +
  `max deafness=${deafMax.toFixed(3)}  min ambience duck=${duckMin.toFixed(3)}`);
const s0 = out.samp[0], s1 = out.samp[out.samp.length - 1];
const dA = s1.atime - s0.atime, dW = s1.wall - s0.wall;
console.log(`  CLOCKS    audio advanced ${dA.toFixed(1)}s while wall advanced ${dW.toFixed(1)}s ` +
  `— render speed ${(100 * dA / dW).toFixed(0)}% (a real device is ~100%; below that the ` +
  `field's WALL backstop expires voices early and that is the harness, not the game)`);
console.log(`  POOL      dropped=${out.dropped} stolen=${out.stolen}  audio.stats.errors=${out.errors}`);

console.log('\n  trace (only frames where a collapse voice was live)');
for (const s of withColl.slice(0, 40)) {
  console.log(`    t=${String(s.t).padStart(7)} coll=${s.coll} act=${String(s.act).padStart(2)}/${s.cap} ` +
    `peak=${s.peak.toFixed(4)} deaf=${s.deaf.toFixed(3)} duckA=${s.duckA.toFixed(3)} ` +
    `[${s.live.map((l) => `${l.armed ? '' : 'PRE:'}${l.bus} m=${l.d} occ=${l.occ} ` +
      `d=${l.dist} s=${l.send} u=${l.user} left=${l.left}`).join(' | ')}]`);
}

console.log('\n  console');
for (const l of lines.slice(-16)) console.log(`    ${l}`);
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 4).join(' | ')}` : '\n0 pageerrors');
await b.close();
