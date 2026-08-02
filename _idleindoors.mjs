/**
 * THE MAN STANDING STILL IN THE HOUSE — the number for item 2.
 *
 * 「AIが屋内にいるとき、外にも出ないしその場で突っ立ったままです」 is a report about
 * something the player watched, and nothing in the repo measured it: `_indoortime`
 * counts how much bot-time is spent indoors (which is a GOAL — the caches are
 * there to pull them in) and `stuckcheck` counts men who WANT to move and do not.
 * A man holding an upper post wants nothing, moves nowhere, and is invisible to
 * both.
 *
 * So: of every alive-bot sample, how many are INDOORS AND STATIONARY, and what
 * do they think they are doing? "Indoors" is strictly inside an enterable
 * building's footprint (inset past the wall) OR above 2.5 m, which is the upper
 * storeys the post system puts men on. "Stationary" is `desiredSpeed` under 0.1
 * — the same field `stuckcheck` reads for intent — held for at least
 * `--dwell` consecutive seconds of game time, so a man pausing at a corner is
 * not counted as a statue.
 *
 *   node _idleindoors.mjs --url=http://127.0.0.1:4481/ [--seed=7] [--samples=340]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4481/';
const SEED = args.seed ?? '7';
const SAMPLES = +(args.samples ?? 340);
const EVERY = +(args.every ?? 20);
const DWELL = +(args.dwell ?? 3);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((n) => new Promise((r) => {
  let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

await p.evaluate((dwell) => {
  const E = window.__ENGINE__;
  const ai = E.ctx.peek('ai');
  const world = E.ctx.peek('world');
  const B = world.layout.BUILDINGS.filter((x) => x.enterable);
  const V3 = ai.agents[0]?.position?.constructor ?? world.features[0].position.constructor;
  const scratch = new V3();
  window.__II__ = {
    bot: 0, indoor: 0, idleIndoor: 0, idleAnywhere: 0, dwellIndoor: 0,
    still: new Map(), why: {}, whoDwell: {}, lastT: E.ctx.time.elapsed,
  };
  window.__IITICK__ = () => {
    const S = window.__II__;
    const now = E.ctx.time.elapsed;
    const dt = Math.max(0.001, now - S.lastT);
    S.lastT = now;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      S.bot++;
      const l = world.worldToLevel(a.position.x, a.position.y, a.position.z, scratch);
      let inside = a.position.y > 2.5;
      if (!inside) {
        for (const x of B) {
          const dx = Math.abs(l.x - x.x) - x.w / 2;
          const dz = Math.abs(l.z - x.z) - x.d / 2;
          if (dx < -0.6 && dz < -0.6) { inside = true; break; }
        }
      }
      const idle = (a.desiredSpeed ?? 0) < 0.1;
      if (idle) S.idleAnywhere++;
      if (!inside) { S.still.delete(a.id); continue; }
      S.indoor++;
      if (!idle) { S.still.delete(a.id); continue; }
      S.idleIndoor++;
      const held = (S.still.get(a.id) ?? 0) + dt;
      S.still.set(a.id, held);
      if (held < dwell) continue;
      S.dwellIndoor++;
      /* WHAT HE THINKS HE IS DOING — the whole reason this file exists. */
      const why = a.post ? `post:phase${a.postPhase}`
        : a.working ? 'working'
          : a.objectiveBlocked ? 'objective-blocked'
            : !a.objective ? 'no-objective'
              : `${a.state}:${a.objective.mode}`;
      S.why[why] = (S.why[why] ?? 0) + 1;
      S.whoDwell[a.name] = +(held.toFixed(1));
    }
  };
}, DWELL);

for (let i = 0; i < SAMPLES; i++) {
  await wait(EVERY);
  await p.evaluate(() => window.__IITICK__());
}

const out = await p.evaluate(() => {
  const S = window.__II__;
  const bot = S.bot || 1;
  return {
    botSamples: S.bot,
    indoorShare: +(S.indoor / bot).toFixed(4),
    idleAnywhereShare: +(S.idleAnywhere / bot).toFixed(4),
    /* THE HEADLINE: share of all alive-bot samples that are a man standing
       still indoors for at least the dwell. */
    idleIndoorsShare: +(S.dwellIndoor / bot).toFixed(4),
    idleIndoorsInstantShare: +(S.idleIndoor / bot).toFixed(4),
    /* …and of the men who ARE indoors, how many are statues. */
    idleShareOfIndoor: S.indoor ? +(S.dwellIndoor / S.indoor).toFixed(3) : 0,
    why: S.why,
    longestDwell: Object.entries(S.whoDwell).sort((a, b) => b[1] - a[1]).slice(0, 8),
  };
});
console.log(JSON.stringify(out, null, 1));
if (errs.length) console.log('PAGEERRORS', errs.slice(0, 5));
await b.close();
