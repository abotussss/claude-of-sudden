#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════════
 * RADIO + STORES TELEMETRY — the numbers `src/ai/radio.js` and the cache legs
 * exist to move, measured on a live match.
 * ════════════════════════════════════════════════════════════════════════════
 * I cannot listen to this build. Every acoustic claim in the report is a
 * MEASUREMENT taken here or it is not made, which is why this file exists
 * rather than a paragraph asserting that the chatter sounds good.
 *
 * WHAT IT REPORTS
 *   per side   transmissions per minute of live round, the DISTINCT kinds used,
 *              the fraction of calls that wanted an answer and got one, and the
 *              LONGEST SILENCE while that side was in contact — the last one is
 *              the number that says whether a firefight ever goes dead, and it
 *              is only counted while `heat >= HOT_HEAT` because forty seconds of
 *              quiet with nobody fighting is the correct behaviour
 *   audio      voices used and STOLEN on the 72-emitter spatial field, plus
 *              per-frame occupancy of the `voice` and `weapons` buses against
 *              their quotas (12 % and 45 %). Sampled from `audio.field.emitters`
 *              directly — the field is read, never written
 *   stores     cache legs by REASON (ammo / grenade / vantage / contest /
 *              veteran), crates actually opened by a bot, and how much of the
 *              roster ever ran dry
 *   cost       AI subsystem milliseconds per frame and whole-frame ms at 30
 *              actors, same wrap as `src/ai/behaviour.mjs`
 *
 * A/B IS A RUNTIME SWITCH, NOT A SECOND BUILD, and that is deliberate: another
 * agent owns `src/world` and was editing the map while this was written, so two
 * builds are two different maps and the comparison would be worthless. Both
 * arms run the same bundle in the same process lifetime.
 *
 *   --radio=0     `ai.radio.enabled = false` — the net is silent, everything
 *                 else is identical. This is the "before" for the audio numbers.
 *   --ammo=0      every agent spawns with an effectively infinite reserve, i.e.
 *                 the behaviour before `Agent.reserve` existed. The "before"
 *                 for the shots-per-minute regression check.
 *   --need=0      `match._needCache` returns null — the cache legs fall back to
 *                 the old contest/veteran rules only.
 *
 *   node src/ai/radiocheck.mjs --port=4222 --seconds=200 --scale=6 --label=on
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const PORT = Number(args.port ?? 4222);
const SECONDS = Number(args.seconds ?? 200);
const SCALE = Number(args.scale ?? 6);
const LABEL = args.label ?? 'run';
const RADIO = args.radio !== '0';
const AMMO = args.ammo !== '0';
const NEED = args.need !== '0';
const DUMP = Number(args.dump ?? 0);
/** `--earshot=0` plays every enemy call however far away — the WORST CASE for
 *  the voice budget, and the arm that bounds "can chatter evict gunfire". */
const EARSHOT = args.earshot !== '0';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

/* The autoplay gesture, then the graph. A keypress rather than a click: the
 * canvas click asks for pointer lock, which headless Chromium refuses noisily. */
await page.keyboard.press('KeyP');
await page.evaluate(() => window.__AUDIO__?.start?.());
await page.waitForFunction(() => window.__AUDIO__?.running === true, null, { timeout: 20000 })
  .catch(() => console.log('[radio] WARNING: AudioContext never started — audio numbers are void'));

await page.evaluate(({ scale, radio, ammo, need, earshot }) => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const m = e.ctx.peek('match');
  const audio = window.__AUDIO__;

  if (!radio) ai.radio.enabled = false;
  if (!earshot) ai.radio._earshot = () => true;
  if (!need) m._needCache = () => null;
  if (!ammo) {
    // The behaviour before `Agent.reserve`: a magazine always comes from
    // somewhere. Wrapping `spawn` rather than editing the class keeps the two
    // arms on one bundle. @see the header.
    const orig = ai.spawn.bind(ai);
    ai.spawn = (...a) => {
      const ag = orig(...a);
      if (ag) { ag.reserve = 1e9; ag.startReserve = 1e9; }
      return ag;
    };
    for (const a of ai.agents) { a.reserve = 1e9; a.startReserve = 1e9; }
  }

  // the C4 goes to a bot in the demolition ruleset — nobody is at the keyboard.
  e.events.on('match:round', () => {
    if (!m.bomb || m.bomb.carrier !== m.player) return;
    const bots = (m._botsByTeam?.[m.attackers] ?? []).filter((a) => a.alive);
    if (bots.length) { m.bomb.giveTo(bots[0]); m._assignObjectives(); }
  });

  const acc = {
    live: 0, rounds: 0, deaths: 0, shots: 0,
    busSamples: 0, busSum: {}, busMax: {}, fieldSum: 0, fieldMax: 0,
    dryBotSamples: 0, botSamples: 0, everDry: {}, seen: {},
    aiMs: [], frameMs: [], actorsMax: 0,
  };
  window.__RC__ = acc;

  const origFire = ai.onAgentFire.bind(ai);
  ai.onAgentFire = (a, o, d) => { acc.shots++; return origFire(a, o, d); };

  let pending = 0;
  for (const k of ['update', 'lateUpdate']) {
    const orig = ai[k].bind(ai);
    ai[k] = (...a) => { const t0 = performance.now(); orig(...a); pending += performance.now() - t0; };
  }

  let lastRaw = performance.now();
  let last = e.time.elapsed;
  const tick = () => {
    const nowRaw = performance.now();
    const t = e.time.elapsed;
    const dt = t - last;
    last = t;
    if (m.phase === 'live') {
      acc.aiMs.push(pending);
      acc.frameMs.push(nowRaw - lastRaw);
      if (ai.stats.alive > acc.actorsMax) acc.actorsMax = ai.stats.alive;
      if (dt > 0 && dt < 0.5) {
        acc.live += dt;
        for (const a of ai.agents) {
          if (!a.alive) continue;
          acc.botSamples++;
          acc.seen[a.name] = 1;
          if (a.dry) { acc.dryBotSamples++; acc.everDry[a.name] = 1; }
        }
        /**
         * PER-BUS OCCUPANCY. `acquire()` only cannibalises its own bus once it
         * is OVER its quota; under it, a full field lets any bus steal from any
         * other. So the question "can chatter evict gunfire" is answered by two
         * numbers: how close the voice bus ever gets to its 12 % cap, and
         * whether the field is ever full at all.
         */
        const f = audio?.field;
        if (f?.emitters) {
          const per = {};
          let busy = 0;
          for (const em of f.emitters) {
            if (em.free) continue;
            busy++;
            per[em.busName] = (per[em.busName] ?? 0) + 1;
          }
          for (const k in per) {
            acc.busSum[k] = (acc.busSum[k] ?? 0) + per[k];
            if (per[k] > (acc.busMax[k] ?? 0)) acc.busMax[k] = per[k];
          }
          acc.busSamples++;
          acc.fieldSum += busy;
          if (busy > acc.fieldMax) acc.fieldMax = busy;
        }
      }
    }
    pending = 0;
    lastRaw = nowRaw;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  e.events.on('match:round', () => { acc.rounds++; });
  e.events.on('actor:death', () => { acc.deaths++; });
  e.time.scale = scale;
}, { scale: SCALE, radio: RADIO, ammo: AMMO, need: NEED, earshot: EARSHOT });

const t0 = Date.now();
while ((Date.now() - t0) / 1000 < SECONDS) await page.waitForTimeout(2000);

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const m = e.ctx.peek('match');
  const acc = window.__RC__;
  const f = window.__AUDIO__?.field;
  return {
    acc: {
      live: acc.live, rounds: acc.rounds, deaths: acc.deaths, shots: acc.shots,
      busSamples: acc.busSamples, busSum: acc.busSum, busMax: acc.busMax,
      fieldSum: acc.fieldSum, fieldMax: acc.fieldMax,
      dryBotSamples: acc.dryBotSamples, botSamples: acc.botSamples,
      everDry: Object.keys(acc.everDry).length, seen: Object.keys(acc.seen).length,
      aiMs: acc.aiMs, frameMs: acc.frameMs, actorsMax: acc.actorsMax,
    },
    radio: ai.radio.report(),
    audio: window.__AUDIO__?.report?.() ?? null,
    emitters: f?.emitters?.length ?? 0,
    caps: f ? { voice: f._busCap('voice'), weapons: f._busCap('weapons'), foley: f._busCap('foley') } : null,
    caches: m.caches ? { ...m.caches.stats, bot: m.caches.botList.length, kinds: m.caches.botKindCounts() } : null,
  };
});
await browser.close();

/* ------------------------------- reduction ------------------------------- */
const pctile = (v, p) => (v.length
  ? +v.slice().sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * p))].toFixed(2)
  : NaN);
const cost = (v) => ({ n: v.length, mean: v.length ? +(v.reduce((a, x) => a + x, 0) / v.length).toFixed(2) : NaN,
  p50: pctile(v, 0.5), p95: pctile(v, 0.95), p99: pctile(v, 0.99) });

const a = out.acc;
const mins = a.live / 60;
const nets = out.radio.nets.map((n) => ({
  team: n.team,
  perMinute: +(n.sent / Math.max(0.01, mins)).toFixed(1),
  sent: n.sent,
  distinctKinds: n.distinctKinds,
  answeredFraction: n.wantedAnswer ? +(n.answered / n.wantedAnswer).toFixed(3) : null,
  wantedAnswer: n.wantedAnswer,
  answered: n.answered,
  refusedByAudio: n.refusedByAudio,
  outOfEarshot: n.outOfEarshot,
  droppedFromQueue: n.droppedFromQueue,
  secondsInContact: n.hotSeconds,
  longestSilenceInFirefight: n.maxSilenceInFirefight,
  kinds: n.kinds,
}));

const busMean = {};
for (const k in a.busSum) busMean[k] = +(a.busSum[k] / Math.max(1, a.busSamples)).toFixed(2);

console.log(JSON.stringify({
  label: LABEL,
  arms: { radio: RADIO, ammoEconomy: AMMO, needDrivenLegs: NEED, earshotFilter: EARSHOT },
  liveSeconds: +a.live.toFixed(1),
  rounds: a.rounds,
  deaths: a.deaths,
  shotsPerMinuteOfRound: +(a.shots / Math.max(0.01, mins)).toFixed(0),
  radio: nets,
  audio: {
    fieldEmitters: out.emitters,
    busCaps: out.caps,
    meanBusyEmitters: +(a.fieldSum / Math.max(1, a.busSamples)).toFixed(2),
    maxBusyEmitters: a.fieldMax,
    meanPerBus: busMean,
    maxPerBus: a.busMax,
    voicesStolen: out.audio?.stolen ?? null,
    voicesDropped: out.audio?.dropped ?? null,
  },
  stores: {
    provedBotCaches: out.caches?.bot ?? null,
    provedBotCachesByKind: out.caches?.kinds ?? null,
    legsAmmo: out.caches?.legsAmmo ?? null,
    legsGrenade: out.caches?.legsGrenade ?? null,
    legsVantage: out.caches?.legsVantage ?? null,
    legsContest: out.caches?.legsContest ?? null,
    legsVeteran: out.caches?.legsVeteran ?? null,
    cratesOpenedByBots: out.caches?.botTakes ?? null,
    roundsHandedOver: out.caches?.ammo ?? null,
    fragsHandedOver: out.caches?.frags ?? null,
    botsWhoRanDry: `${a.everDry} of ${a.seen}`,
    dryShareOfBotTime: +((a.dryBotSamples / Math.max(1, a.botSamples)) * 100).toFixed(2) + '%',
  },
  perf: { actorsMax: a.actorsMax, aiMs: cost(a.aiMs), frameMs: cost(a.frameMs) },
  errors: errors.slice(0, 6),
}, null, 2));

if (DUMP) {
  console.log('\n=== LAST TRANSMISSIONS (t, side, kind -> voice, speaker, ans, played) ===');
  for (const e of out.radio.log.slice(-DUMP)) {
    console.log(
      `${String(e.t).padStart(8)}  ${e.radio ? 'FRIENDLY(radio)' : 'ENEMY(world) '} T${e.team}  ` +
      `${e.kind.padEnd(11)} -> ${e.voice.padEnd(20)} ${String(e.speaker).padEnd(9)}` +
      `${e.answerTo ? ' ans#' + e.answerTo : ''}${e.played ? '' : '  [REFUSED BY AUDIO]'}`
    );
  }
}
