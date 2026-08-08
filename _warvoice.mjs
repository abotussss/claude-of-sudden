/**
 * WHAT THE AMBIENT WAR IS ACTUALLY PLAYED AT — `src/match/warfield.js` `_say`
 *
 * `warfield` exists for 「そこらじゅうに銃撃や銃弾が飛び交い、爆撃もあり」 and is built
 * on one hard requirement: the player must be able to tell ambient fire from
 * being shot at. That is a claim about LEVEL and about SPECTRUM, so it has to be
 * measured at the emitter rather than at the call.
 *
 * `_say` is wrapped, so every `field.acquire` that happens inside it is
 * attributed to warfield and to nothing else — the battle layer's own far
 * voices go through the identical code path and cannot otherwise be told apart.
 * What is recorded per voice: the bus it landed on, the priority it asked with,
 * its distance, the OCCLUSION the field measured for it, the `gain` argument it
 * carried and the level that actually reaches `distGain` (`atten * gain`, where
 * `atten = attenuation(dist) * (1 - 0.62 * occ)`), computed rather than read
 * because `distGain` is scheduled a propagation delay into the future.
 *
 * The battle layer's far voices are recorded the same way for comparison — they
 * are the reference, because they are the OTHER distant gunfire on the map and
 * the two must not be 7 dB apart.
 *
 *   node _warvoice.mjs --map=plains --seconds=90
 *   node _warvoice.mjs --map=town   --seconds=90     (exposure should be nil)
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const MAP = args.map ?? 'plains';
const SECONDS = Number(args.seconds ?? 90);
const WARM = Number(args.warm ?? 30);
const PORT = args.port ?? '4620';
const URL = `http://127.0.0.1:${PORT}/?map=${MAP}&capture=1${args.seed ? `&seed=${args.seed}` : ''}`;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-frame-rate-limit',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

await page.evaluate(async () => {
  const a = window.__ENGINE__.ctx.peek('audio');
  try { await a?.start?.(); } catch { /* reported below */ }
  window.__ENGINE__.ctx.time.scale = 6;
});
await page.waitForTimeout(WARM * 1000);

const boot = await page.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const a = ctx.peek('audio'), f = a.field, m = ctx.peek('match');
  const w = m?.warfield;
  ctx.time.scale = 1;
  const M = { war: [], battleFar: [], sayCalls: [], strikeTails: 0, playCalls: {} };
  window.__M__ = M;
  let inSay = false;

  if (w?._say) {
    const orig = w._say.bind(w);
    w._say = (f2, gain) => { inSay = true; try { return orig(f2, gain); } finally { inSay = false; } };
  }
  // Which entry point warfield used — `play('far', …)` before the fix,
  // `playFar` after. Both are counted so a run cannot be misread.
  const play = a.play.bind(a);
  a.play = (k, p, o) => { if (inSay) M.playCalls[`play:${k}`] = (M.playCalls[`play:${k}`] ?? 0) + 1; return play(k, p, o); };
  if (a.playFar) {
    const pf = a.playFar.bind(a);
    a.playFar = (x, y, z, o) => { if (inSay) M.playCalls['playFar'] = (M.playCalls['playFar'] ?? 0) + 1; return pf(x, y, z, o); };
  }

  const ac = f.acquire.bind(f);
  f.acquire = (spec) => {
    const em = ac(spec);
    if (em) {
      const atten = f.attenuation(em.dist) * (1 - 0.62 * (em.occ ?? 0));
      const row = {
        bus: spec.bus ?? '?', pri: +(spec.priority ?? 0.5),
        d: +em.dist.toFixed(1), occ: +(em.occ ?? 0).toFixed(3),
        g: +(spec.gain ?? 1).toFixed(3),
        lvl: +Math.min(4, atten * (spec.gain ?? 1)).toFixed(5),
      };
      if (inSay) { if (M.war.length < 3000) M.war.push(row); }
      else if (spec.tag === 'far' && M.battleFar.length < 3000) M.battleFar.push(row);
    }
    return em;
  };

  return {
    level: ctx.peek('world').level.id,
    phase: m?.phase ?? '?',
    warfield: w ? { ready: !!w.ready, enabled: !!w.enabled, fights: w.fights?.length ?? 0 } : null,
  };
});
console.log('[warvoice] boot:', JSON.stringify(boot));

await page.waitForTimeout(SECONDS * 1000);

const out = await page.evaluate((secs) => {
  const M = window.__M__, ctx = window.__ENGINE__.ctx;
  const a = ctx.peek('audio'), w = ctx.peek('match')?.warfield;
  const stat = (rows) => {
    if (!rows.length) return { n: 0 };
    const lv = rows.map((r) => r.lvl).sort((p, q) => p - q);
    const oc = rows.map((r) => r.occ);
    const buses = {};
    for (const r of rows) buses[`${r.bus}@${r.pri}`] = (buses[`${r.bus}@${r.pri}`] ?? 0) + 1;
    const mean = (x) => +(x.reduce((s, n) => s + n, 0) / x.length).toFixed(4);
    return {
      n: rows.length, buses,
      distMed: rows.map((r) => r.d).sort((p, q) => p - q)[rows.length >> 1],
      gainArgMean: mean(rows.map((r) => r.g)),
      occMean: mean(oc), occOver0_5: oc.filter((o) => o > 0.5).length,
      lvlMed: lv[lv.length >> 1], lvlMean: mean(lv),
    };
  };
  return {
    level: ctx.peek('world').level.id,
    seconds: secs,
    warfieldStats: w?.stats ? { ...w.stats } : null,
    entryPoints: M.playCalls,
    warfieldVoice: stat(M.war),
    battleFarVoice: stat(M.battleFar),
    audio: { errors: a.stats.errors, failed: !!a.failed },
  };
}, SECONDS);

const dB = (a, b) => (a && b ? `${(20 * Math.log10(a / b)).toFixed(1)} dB` : 'n/a');
console.log(JSON.stringify(out, null, 1));
console.log(`warfield vs battle far, at distGain: ${dB(out.warfieldVoice.lvlMed, out.battleFarVoice.lvlMed)}`);
console.log(`pageerrors=${errs.length}`);
if (errs.length) console.log(' first:', errs[0]);
await browser.close();
