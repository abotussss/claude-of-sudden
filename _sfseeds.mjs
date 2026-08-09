/**
 * FIRE IT FOR REAL, ON MORE THAN ONE SEED, AND THEN RESET THE ROUND AND FIRE IT
 * AGAIN.
 *
 *   node _sfseeds.mjs [--url=…] [--seeds=1,7,23]
 *
 * A boot probe passes a broken build. `Crash.build()` returns early on the town
 * and `reset()` once had no `ready` guard, which threw 2 688 times there while a
 * boot probe read 0 errors — that was this file's own subject. So this one
 * plays the act to the end, checks the state it leaves behind, RESETS THE ROUND
 * and fires it a second time, on every seed given.
 *
 * What it asserts, per seed:
 *
 *   after the event   180 chunks down, uAnim 0 (the settled pose is memcpy'd
 *                     and the shader has stopped rotating anything), both blast
 *                     meshes back to one instance and still VISIBLE (the
 *                     prewarm argument), both fires' uBlast back to the
 *                     identity, and NOT ONE CHUNK with daylight under it
 *   after reset()     the west back on the grid, the fire out, the chunk mesh
 *                     back to one parked instance under the map
 *   second firing     all of it again, because a round reset that half-works is
 *                     invisible to every boot gate in this repo
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4639/';
const SEEDS = String(args.seeds ?? '1,7,23').split(',').map(Number);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
let bad = 0;

for (const seed of SEEDS) {
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
  await p.goto(`${BASE}?map=plains&capture=1&seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
  const lvl = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
  await p.evaluate(() => {
    const e = window.__ENGINE__;
    e.input.frozen = true; e.input.enabled = false;
    e.ctx.peek('player')?.setControlEnabled?.(false);
    e.time.scale = 8;
  });
  await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });

  /** Read the whole state of this feature in one round trip. */
  const read = () => p.evaluate(() => {
    const e = window.__ENGINE__;
    const ph = e.ctx.peek('physics');
    const s = e.ctx.peek('match').crash._sky;
    const M = s.chunks.instanceMatrix.array;
    const S = s._chunkSettled;
    let drift = 0;
    let floating = 0;
    if (s.chunks.count > 1) {
      for (let i = 0; i < S.length; i++) drift = Math.max(drift, Math.abs(M[i] - S[i]));
      for (let i = 0; i < S.length / 16; i++) {
        const b = i * 16;
        const half = 0.5 * Math.hypot(
          Math.hypot(S[b], S[b + 1], S[b + 2]),
          Math.hypot(S[b + 4], S[b + 5], S[b + 6]),
          Math.hypot(S[b + 8], S[b + 9], S[b + 10])
        );
        if (S[b + 13] - half - ph.groundHeight(S[b + 12], S[b + 14], 400) > 0) floating++;
      }
    }
    return {
      t: +(s._t ?? -1).toFixed(1), det: +(s._det ?? -1).toFixed(1), burn: Math.round(s._burn),
      denied: s._denied, live: s._live,
      chunkCount: s.chunks.count, chunkY: +M[13].toFixed(0), uAnim: s._chunkU.uAnim.value,
      addCount: s._blastAdd.geometry.instanceCount, smokeCount: s._blastSmoke.geometry.instanceCount,
      addVis: s._blastAdd.visible, smokeVis: s._blastSmoke.visible,
      settledDrift: +drift.toFixed(4), floating,
      regionBlast: [...s._fireU.uBlast.value].map((v) => +v.toFixed(2)),
      scarBlast: s._scarFire ? [...s._scarFire.uBlast.value].map((v) => +v.toFixed(2)) : null,
      flamesVisible: s.flames.visible,
    };
  });
  /** Play `sec` act-seconds at x8 and stop. */
  const play = (sec) => p.evaluate((sec) => new Promise((done) => {
    const e = window.__ENGINE__;
    e.ctx.peek('match')._checkWinConditions = () => {};
    const t0 = e.ctx.time.elapsed;
    const tick = () => (e.ctx.time.elapsed - t0 >= sec ? done() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), sec);

  const out = [];
  for (const pass of [1, 2]) {
    await p.evaluate(() => window.__ENGINE__.ctx.peek('match').crash.fire());
    /**
     * SAMPLE THE WAVEFRONT ON ITS WAY OUT. `uBlast` is the only part of this
     * event that is invisible to a still photograph taken from outside the
     * fire, so it is read off both materials while it is running: the region's
     * and — the one that would be silently dropped — the satellite scar's.
     */
    if (pass === 1) {
      const wave = await p.evaluate(() => new Promise((done) => {
        const e = window.__ENGINE__;
        const s = e.ctx.peek('match').crash._sky;
        const rows = [];
        const tick = () => {
          if (s._det >= 0) {
            rows.push([+s._det.toFixed(2),
              [...s._fireU.uBlast.value].map((v) => +v.toFixed(2)),
              s._scarFire ? [...s._scarFire.uBlast.value].map((v) => +v.toFixed(2)) : null]);
          }
          if (s._det > 2.2 || rows.length > 400) done(rows.filter((_, i) => i % 4 === 0).slice(0, 8));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }));
      console.log(`  wavefront (det s, region uBlast, scar uBlast): ${JSON.stringify(wave)}`);
    }
    await play(32);
    const after = await read();
    out.push([`pass ${pass} · +32 s`, after]);
    /** Now put the round back, exactly as `MatchSystem._beginRound` does. */
    await p.evaluate(() => window.__ENGINE__.ctx.peek('match').crash.reset());
    await play(1);
    out.push([`pass ${pass} · reset`, await read()]);
  }

  console.log(`\n── seed ${seed} (level.id=${lvl}) ──`);
  for (const [tag, s] of out) {
    const fired = tag.includes('+32');
    const want = fired
      ? (s.chunkCount === 180 && s.uAnim === 0 && s.settledDrift < 1e-3 && s.floating === 0
        && s.addCount === 1 && s.smokeCount === 1 && s.addVis && s.smokeVis
        && s.denied === true && s.regionBlast[3] === 0 && s.scarBlast[3] === 0)
      : (s.chunkCount === 1 && s.chunkY === -400 && s.denied === false && s.live === false
        && s.addCount === 1 && s.smokeCount === 1 && s.flamesVisible === false
        && s.regionBlast[3] === 0);
    if (!want) bad++;
    console.log(`  ${want ? 'OK  ' : 'FAIL'} ${tag.padEnd(16)} ${JSON.stringify(s)}`);
  }
  console.log(errs.length ? `  PAGEERRORS(${errs.length}) ${errs[0]}` : '  0 pageerrors');
  if (errs.length) bad++;
  await p.close();
}
console.log(bad ? `\n${bad} FAILURES` : '\nALL SEEDS OK');
await b.close();
process.exit(bad ? 1 : 0);
