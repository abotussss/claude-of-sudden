/**
 * DID THE FIFTEEN ACTUALLY TURN UP, AND DID THEY STAY INDOORS.
 *
 *   node _civrun.mjs --port=4485
 *
 * Boots a headless match, runs it at speed, and reports what
 * `src/match/civilians.js` measured about itself, plus the one thing it cannot
 * measure about itself: how many of the men it placed are, at each sample,
 * standing on a cell `ai.grid` calls indoors. 「基本屋内にのみ滞留」.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const PORT = Number(args.port ?? 4485);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = [];
const warns = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e.message)));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push('CONSOLE ' + m.text());
  const t = m.text();
  if (/\[civil\]/.test(t) || /material slot order/.test(t)) warns.push(t);
});

await page.goto(`http://127.0.0.1:${PORT}/?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await page.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  ctx.time.scale = 6;
  /**
   * DID THE ARMED ONES ACTUALLY FIGHT — 「武装している人は攻撃してきます」 — and
   * did an unarmed one ever so much as want to. `weapon:fire` carries no
   * shooter (it is a reused payload for the flash), so this samples the two
   * fields that decide a shot instead, once a frame, and counts the MEN rather
   * than the frames: `shooters` is how many distinct militiamen ever pulled a
   * trigger, which is the number the claim is about.
   */
  window.__CIVFIRE__ = { armedFrames: 0, unarmedFrames: 0, shooters: new Set(), engaged: new Set() };
  const ai = ctx.peek('ai');
  const tick = () => {
    const c = window.__CIVFIRE__;
    for (const a of ai.agents) {
      if (!a.alive || a.aiCivil !== true) continue;
      if (a.aiPacifist === true) { if (a.wantFire || a.hasTarget) c.unarmedFrames++; continue; }
      if (a.hasTarget) c.engaged.add(a.id);
      if (a.wantFire) { c.armedFrames++; c.shooters.add(a.id); }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const pump = (n) => page.evaluate((k) => new Promise((done) => {
  let i = 0;
  const t = () => (++i >= k ? done() : requestAnimationFrame(t));
  requestAnimationFrame(t);
}), n);

const sample = () => page.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const m = ctx.peek('match');
  const ai = ctx.peek('ai');
  const c = m?.civilians;
  if (!c) return { t: ctx.time.elapsed, none: true };
  const g = ai.grid;
  let indoors = 0, outdoors = 0, fleeing = 0, armedAlive = 0, unarmedAlive = 0;
  const wheres = [];
  for (const r of c.list) {
    if (!r.agent.alive) continue;
    if (r.unarmed) unarmedAlive++; else armedAlive++;
    if (r.fleeing) fleeing++;
    const i = g.nearest(r.agent.position.x, r.agent.position.z, r.agent.position.y, 2, 1.4);
    const inside = i >= 0 && g.indoor && g.indoor[i] === 1;
    if (inside) indoors++; else outdoors++;
    if (!inside && !r.fleeing) {
      const ai2 = i >= 0 ? `cell indoor=${g.indoor ? g.indoor[i] : '?'}` : 'off-grid';
      wheres.push(`${r.unarmed ? 'U' : 'A'}@${r.agent.position.x.toFixed(0)},${r.agent.position.z.toFixed(0)}` +
        ` ${r.agent.position.distanceTo(r.anchor).toFixed(1)}m from home` +
        ` leashed=${r.leashed} obj=${r.agent.objective?.mode ?? '-'}` +
        ` blocked=${r.agent.objectiveBlocked === true} tgt=${r.agent.hasTarget === true}` +
        ` spd=${(r.agent.desiredSpeed ?? 0).toFixed(1)} ${ai2}` +
        ` anchorIndoor=${(() => { const j = g.nearest(r.anchor.x, r.anchor.z, r.anchor.y, 2, 1.4); return j >= 0 && g.indoor && g.indoor[j] === 1; })()}`);
    }
  }
  return {
    t: +ctx.time.elapsed.toFixed(0),
    report: c.report(),
    alive: `${armedAlive}A/${unarmedAlive}U`,
    indoors, outdoors, fleeing,
    strays: wheres.slice(0, 5),
    score: m.score ? `${m.score[0]}-${m.score[1]}` : '-',
    hp: c.list.length ? c.list[0].agent.maxHealth : null,
    wpn: c.list.map((r) => r.agent.weaponId).filter((v, i, a) => a.indexOf(v) === i).join(','),
    fire: {
      militiamenWhoFired: window.__CIVFIRE__.shooters.size,
      militiamenWhoEngaged: window.__CIVFIRE__.engaged.size,
      armedFireFrames: window.__CIVFIRE__.armedFrames,
      unarmedWantedToFireFrames: window.__CIVFIRE__.unarmedFrames,
    },
  };
});

for (let k = 0; k < 10; k++) {
  await pump(260);
  const s = await sample();
  console.log(
    `t=${String(s.t).padStart(3)}s  alive ${s.alive ?? '-'}  indoors ${s.indoors}/` +
    `${(s.indoors ?? 0) + (s.outdoors ?? 0)}  fleeing ${s.fleeing}  score ${s.score}` +
    (s.strays?.length ? `\n           STRAY OUTDOORS: ${s.strays.join(' | ')}` : '')
  );
  if (k === 9) {
    console.log('\n' + s.report);
    console.log(`maxHealth ${s.hp} · weapons carried [${s.wpn}]`);
  }
}
console.log('\nconsole [civil]/slot lines:', warns.length ? warns : '(none)');
console.log(errs.length ? `ERRORS (${errs.length}): ` + errs.slice(0, 5).join(' | ') : 'no pageerrors');
await browser.close();
