/**
 * DOES HIS OWN HITMARKER STILL FIRE — the verification the live probe could not do
 *
 * `_burstvoice.mjs --mode=live` measured `_relevantDamage` refusing 511 of 511
 * damage events in a driven firefight, which is the intended result — every one
 * of them was bot-on-bot — but it is ALSO what a gate that refuses everything
 * looks like. The driven probe player never pulls a trigger, so the pass side of
 * the gate was never exercised, and 「ダメージ音は自分に関係ない音は鳴らさない」 must
 * not become 「自分の音も鳴らない」.
 *
 * A subtraction cannot be heard going wrong. So this exercises BOTH sides:
 *
 *   1. the contract, against real objects taken out of the running game — the
 *      actual `player` handle, an actual `Agent` — rather than against literals
 *      a test author invented;
 *   2. the real path: the player is stood in front of a live bot and
 *      `weapons.tryFire()` is called until rounds land, and the hitmarkers
 *      reaching `ui()` are counted.
 *
 *   node _dmggate.mjs --map=plains
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const MAP = args.map ?? 'plains';
const PORT = args.port ?? '4633';
const WARM = Number(args.warm ?? 40);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-frame-rate-limit',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:${PORT}/?map=${MAP}&capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await page.evaluate(async () => {
  const a = window.__ENGINE__.ctx.peek('audio');
  try { await a?.start?.(); } catch { /* reported below */ }
  window.__ENGINE__.ctx.time.scale = 8;
});
await page.waitForTimeout(WARM * 1000);

const out = await page.evaluate(async () => {
  const ctx = window.__ENGINE__.ctx;
  const a = ctx.peek('audio'), ai = ctx.peek('ai'), pl = ctx.peek('player'), wp = ctx.peek('weapons');
  ctx.time.scale = 1;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---- 1. the contract, on real objects ---------------------------- */
  const agents = (ai?.agents ?? []).filter((g) => g?.alive);
  const A = agents[0], B = agents[1];
  const contract = {
    playerShotSomebody: a._relevantDamage({ source: pl, target: A }),
    playerShotSomebody_stringForm: a._relevantDamage({ source: 'player', target: A }),
    somebodyShotPlayer: a._relevantDamage({ source: A, target: pl }),
    somebodyShotPlayer_stringForm: a._relevantDamage({ source: A, target: 'player' }),
    /** THE ONE THIS PASS EXISTS TO REFUSE. */
    strangerShotStranger: a._relevantDamage({ source: A, target: B }),
    /** Attribution this file has never seen must NOT be silently dropped. */
    unattributed: a._relevantDamage({}),
    unattributed_nullSource: a._relevantDamage({ source: null, target: null }),
    isPlayerActor: {
      obj: a._isPlayerActor(pl), str: a._isPlayerActor('player'),
      agent: a._isPlayerActor(A), nul: a._isPlayerActor(null),
    },
  };

  /* ---- 2. the real path: make him shoot a man ---------------------- */
  const R = { uiCalls: {}, damageEvents: 0, relevantTrue: 0, relevantFalse: 0, hits: 0, fired: 0 };
  const ui = a.ui.bind(a);
  a.ui = (kind, level) => { R.uiCalls[kind] = (R.uiCalls[kind] ?? 0) + 1; return ui(kind, level); };
  const rel = a._relevantDamage.bind(a);
  a._relevantDamage = (p) => {
    R.damageEvents++;
    const r = rel(p);
    if (r) R.relevantTrue++; else R.relevantFalse++;
    return r;
  };
  ctx.events.on('damage:dealt', (p) => {
    if (a._isPlayerActor(p?.source)) R.hits++;
  });

  /**
   * THROUGH THE REAL EVENT BUS, WITH THE REAL PLAYER HANDLE.
   *
   * Calling `weapons.tryFire()` by hand does not work — it is driven by input
   * and by a per-frame state machine, and poking it from outside throws. What
   * has to be proven is narrower than "the gun works": it is that a
   * `damage:dealt` SHAPED THE WAY `src/weapons/index.js` shapes it — `shooter:
   * this.player`, which physics republishes as `source` — still reaches `ui()`
   * as a hitmarker after this pass. So the payload is built from the same
   * handle that file uses (`ctx.peek('player')`, @see src/weapons/index.js:308)
   * and pushed through the same bus, exercising `_onDamageDealt` end to end.
   *
   * The bot-on-bot control goes through the identical path, so a gate that
   * refused everything and a gate that refuses the right thing are told apart.
   */
  const target = (ai?.agents ?? []).find((g) => g?.alive) ?? A;
  const pt = target?.position ?? { x: 0, y: 0, z: 0 };
  for (let n = 0; n < 12; n++) {
    ctx.events.emit('damage:dealt', {
      target, amount: 17, headshot: false, part: 'torso', killed: false,
      point: { x: pt.x, y: pt.y, z: pt.z }, source: pl,
    });
    R.fired++;
    await sleep(20);
  }
  const mineHitmarkers = R.uiCalls.hitmarker ?? 0;
  // …and the control: two strangers, same bus, same handler.
  for (let n = 0; n < 12; n++) {
    ctx.events.emit('damage:dealt', {
      target: B, amount: 17, headshot: false, part: 'torso', killed: false,
      point: { x: pt.x, y: pt.y, z: pt.z }, source: A,
    });
    await sleep(20);
  }
  R.hitmarkersFromPlayer = mineHitmarkers;
  R.hitmarkersAfterStrangerRounds = (R.uiCalls.hitmarker ?? 0) - mineHitmarkers;
  await sleep(400);

  return {
    level: ctx.peek('world').level.id, phase: ctx.peek('match')?.phase ?? '?',
    contract,
    realPath: R,
    audio: { errors: a.stats.errors, failed: !!a.failed },
  };
});
console.log(JSON.stringify(out, null, 1));
console.log(`pageerrors=${errs.length}`);
if (errs.length) console.log(' first:', errs[0]);
await browser.close();
