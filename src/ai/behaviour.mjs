#!/usr/bin/env node
/**
 * BEHAVIOUR TELEMETRY — does every bot behave differently, and does any of them
 * actually fight? (agent-local measurement aid, same role as `aicost.mjs`)
 *
 * The complaint this exists to answer is "ただその位置に配置するだけの行動を AI に
 * させないで" — stop giving the bots behaviour that is just standing where they
 * were put — and "もっと戦争らしく撃ち合いまくって". Both are measurable, and both
 * are measurable in a way that a screenshot cannot fake:
 *
 *   - metres travelled per bot per minute of LIVE round time, per side
 *   - the share of live actor-time each STATE holds, per side
 *   - rounds fired per minute, per side
 *   - THE SPREAD: the coefficient of variation across bots of distance moved,
 *     of shots fired, and of time spent static in cover. If personality is
 *     reaching behaviour, two men on the same side produce different numbers;
 *     if the CV is near zero the traits are decorative and the work is not done.
 *
 * Everything is bucketed by callsign, not by actor: a respawn is a NEW `Agent`,
 * so per-object accumulation would report thirty short lives instead of fifteen
 * soldiers. Only `phase === 'live'` time is counted — freeze time is not
 * behaviour.
 *
 *   node src/ai/behaviour.mjs --port=4291 --seconds=200 --scale=6
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const PORT = Number(args.port ?? 4291);
const SECONDS = Number(args.seconds ?? 200);
const SCALE = Number(args.scale ?? 6);
const LABEL = args.label ?? 'run';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio',
    '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await page.evaluate((scale) => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const m = e.ctx.peek('match');

  // the C4 goes to a bot: nobody is at the keyboard, so a human carrier means
  // every attacking round times out and measures nothing.
  e.events.on('match:round', () => {
    if (m.bomb.carrier !== m.player) return;
    const bots = m._botsByTeam[m.attackers].filter((a) => a.alive);
    if (bots.length) { m.bomb.giveTo(bots[0]); m._assignObjectives(); }
  });

  const bots = new Map();          // "team:callsign" -> record
  const rec = (a) => {
    const key = `${a.team}:${a.name}`;
    let r = bots.get(key);
    if (!r) {
      r = { name: a.name, team: a.team, dist: 0, shots: 0, live: 0, kills: 0,
        states: {}, static: 0, atCover: 0, peek: 0, skills: [], traits: null };
      bots.set(key, r);
    }
    return r;
  };
  window.__BEH__ = { bots, live: 0, rounds: 0, deaths: 0 };

  const origFire = ai.onAgentFire.bind(ai);
  ai.onAgentFire = (a, o, d) => { rec(a).shots++; return origFire(a, o, d); };

  let last = e.time.elapsed;
  const tick = () => {
    const t = e.time.elapsed;
    const dt = t - last;
    last = t;
    if (m.phase === 'live' && dt > 0 && dt < 0.5) {
      window.__BEH__.live += dt;
      for (const a of ai.agents) {
        if (!a.alive) continue;
        const r = rec(a);
        r.live += dt;
        r.states[a.state] = (r.states[a.state] ?? 0) + dt;
        if (a._lastX === undefined) { a._lastX = a.position.x; a._lastZ = a.position.z; }
        const dx = a.position.x - a._lastX, dz = a.position.z - a._lastZ;
        const step = Math.hypot(dx, dz);
        // a teleport is a respawn, not a walk
        if (step < 3) r.dist += step;
        a._lastX = a.position.x; a._lastZ = a.position.z;
        if (a.speed < 0.15) r.static += dt;
        if (a.cover && a.position.distanceTo(a.coverPos) < 1.0) r.atCover += dt;
        if (a.peeking) r.peek += dt;
        if (r.skills.length < 1) r.skills.push(+a.skill.toFixed(2));
        if (!r.traits && a.traits) r.traits = { ...a.traits };
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  e.events.on('match:round', () => { window.__BEH__.rounds++; });
  e.events.on('actor:death', () => { window.__BEH__.deaths++; });
  e.time.scale = scale;
}, SCALE);

const t0 = Date.now();
while ((Date.now() - t0) / 1000 < SECONDS) await page.waitForTimeout(2000);

const out = await page.evaluate(() => {
  const b = window.__BEH__;
  return {
    live: +b.live.toFixed(1), rounds: b.rounds, deaths: b.deaths,
    bots: [...b.bots.values()].map((r) => ({ ...r, live: +r.live.toFixed(1) })),
    frameMs: +(window.__ENGINE__.time.dt / window.__ENGINE__.time.scale * 1000).toFixed(2),
  };
});
await browser.close();

/* ---------------- reduction ---------------- */
const cv = (v) => {
  if (v.length < 2) return NaN;
  const mean = v.reduce((a, x) => a + x, 0) / v.length;
  if (!mean) return NaN;
  const sd = Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / (v.length - 1));
  return +(sd / mean).toFixed(3);
};
const stat = (v) => {
  const s = v.slice().sort((a, x) => a - x);
  return { n: s.length, min: +s[0]?.toFixed(1), median: +s[s.length >> 1]?.toFixed(1),
    max: +s[s.length - 1]?.toFixed(1), cv: cv(v) };
};

const side = (team) => {
  const rows = out.bots.filter((r) => r.team === team && r.live > 8);
  const perMin = rows.map((r) => (r.dist / r.live) * 60);
  const shotsMin = rows.map((r) => (r.shots / r.live) * 60);
  const staticFrac = rows.map((r) => (r.static / r.live) * 100);
  const states = {};
  let live = 0;
  for (const r of rows) { live += r.live; for (const k in r.states) states[k] = (states[k] ?? 0) + r.states[k]; }
  const pct = {};
  for (const k of Object.keys(states).sort((a, b) => states[b] - states[a])) {
    pct[k] = +((states[k] / live) * 100).toFixed(1);
  }
  return {
    bots: rows.length,
    actorMinutes: +(live / 60).toFixed(1),
    metresPerBotPerMin: stat(perMin),
    shotsPerBotPerMin: stat(shotsMin),
    shotsPerMinTotal: +((rows.reduce((a, r) => a + r.shots, 0) / live) * 60 * rows.length).toFixed(0),
    staticPctOfTime: stat(staticFrac),
    atCoverPct: +((rows.reduce((a, r) => a + r.atCover, 0) / live) * 100).toFixed(1),
    peekPct: +((rows.reduce((a, r) => a + r.peek, 0) / live) * 100).toFixed(1),
    stateTimePct: pct,
  };
};

console.log(JSON.stringify({
  label: LABEL,
  liveSeconds: out.live, rounds: out.rounds, deaths: out.deaths,
  team0: side(0), team1: side(1),
  perBot: out.bots.filter((r) => r.live > 8).map((r) => ({
    t: r.team, name: r.name, skill: r.skills[0],
    mPerMin: +((r.dist / r.live) * 60).toFixed(0),
    shotsPerMin: +((r.shots / r.live) * 60).toFixed(0),
    staticPct: +((r.static / r.live) * 100).toFixed(0),
    live: r.live,
    traits: r.traits,
  })).sort((a, b) => a.t - b.t || b.mPerMin - a.mPerMin),
  errors: errors.slice(0, 6),
}, null, 2));
