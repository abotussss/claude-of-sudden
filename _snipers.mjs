/**
 * ARE THERE ACTUALLY SNIPERS AMONG THE AI? — 「あとスナイパー持ってるAIはちゃんといる？」
 *
 *   node _snipers.mjs [--url=…] [--frames=2600] [--scale=10] [--out=shots/snipers]
 *
 * The archetype was authored as one slot in ten of every mix (src/ai/agent.js
 * ARCHETYPE_MIX) with a bolt profile: ~0.9 rounds/s, 55 damage, a quarter of
 * the carbine's cone, a 5-round magazine. That is a claim about a table. This
 * is the question the table cannot answer: in a REAL match, how many men on
 * each side end up carrying it, how many rounds they actually fire, and
 * whether any of it kills anybody.
 *
 * Everything here is counted off the live roster and the canonical events, and
 * a sniper is photographed in the world at the end so the rifle can be SEEN
 * rather than inferred from a flag.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4424/?seed=7';
const FRAMES = Number(args.frames ?? 2600);
const SCALE = Number(args.scale ?? 10);
const OUT = args.out ?? 'shots/snipers';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match')?.phase === 'live', null, { timeout: 180000 });

/* Count shots and kills BY ARCHETYPE, off the canonical events. `ai:fire`
 * is not a thing, so the shots are counted on the agents' own fire counter
 * and the kills on `damage:dealt` with a source we can resolve back to a bot. */
await page.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const ai = ctx.peek('ai');
  window.__SNIPE__ = { shots: 0, other: 0, kills: 0, killsOther: 0, dmg: 0 };
  const isSniper = (a) => a?.archetype === 'sniper' || a?.sniper === true;
  // Wrap each agent's shot path once: every agent that exists now and every
  // one that respawns goes through the same prototype method.
  const list = ai?.agents ?? ai?.list ?? [];
  const proto = list[0] ? Object.getPrototypeOf(list[0]) : null;
  if (proto && !proto.__snipeWrapped) {
    for (const name of ['_fireRound', '_shoot', 'shoot', 'fire']) {
      if (typeof proto[name] !== 'function') continue;
      const orig = proto[name];
      proto[name] = function (...a) {
        const r = orig.apply(this, a);
        if (r !== false) {
          if (isSniper(this)) window.__SNIPE__.shots++;
          else window.__SNIPE__.other++;
        }
        return r;
      };
      proto.__snipeWrapped = name;
      break;
    }
  }
  ctx.events.on('damage:dealt', (p) => {
    const s = p?.source;
    if (!s || typeof s !== 'object') return;
    if (!isSniper(s)) { if (p.killed) window.__SNIPE__.killsOther++; return; }
    window.__SNIPE__.dmg += p.amount ?? 0;
    if (p.killed) window.__SNIPE__.kills++;
  });
});

const wrapped = await page.evaluate(() => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  const list = ai?.agents ?? ai?.list ?? [];
  return { n: list.length, wrap: Object.getPrototypeOf(list[0] ?? {}).__snipeWrapped ?? null };
});
console.log(`[snipers] roster ${wrapped.n} agents, shot hook = ${wrapped.wrap ?? 'NONE (falling back to per-agent counters)'}`);

/** Who is carrying what, right now, by team. */
const census = () =>
  page.evaluate(() => {
    const ai = window.__ENGINE__.ctx.peek('ai');
    const list = ai?.agents ?? ai?.list ?? [];
    const byTeam = {};
    for (const a of list) {
      const t = String(a.team);
      byTeam[t] ??= { total: 0, sniper: 0, arch: {}, names: [] };
      byTeam[t].total++;
      byTeam[t].arch[a.archetype] = (byTeam[t].arch[a.archetype] ?? 0) + 1;
      if (a.archetype === 'sniper' || a.sniper === true) {
        byTeam[t].sniper++;
        byTeam[t].names.push(`${a.callsign ?? a.name ?? '?'}(dmg ${a.weaponDamage}, mag ${a.magSize}, rate ${(+a.fireRate).toFixed(2)}/s)`);
      }
    }
    return byTeam;
  });

const c0 = await census();
console.log('\n=== WHO IS CARRYING THE BOLT GUN (roster at round start) ===');
for (const [t, v] of Object.entries(c0)) {
  console.log(`  team ${t}: ${v.sniper} sniper / ${v.total} men   archetypes ${JSON.stringify(v.arch)}`);
  for (const n of v.names) console.log(`      ${n}`);
}

/* Run the match. */
await page.evaluate((s) => { window.__ENGINE__.time.scale = s; }, SCALE);
const f0 = await page.evaluate(() => window.__ENGINE__.time.frame);
await page.waitForFunction((t) => window.__ENGINE__.time.frame >= t, f0 + FRAMES, { timeout: 420000 }).catch(() => console.log('  (frame budget not reached; numbers below are for the time that did elapse)'));
await page.evaluate(() => { window.__ENGINE__.time.scale = 1; });

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const list = ai?.agents ?? ai?.list ?? [];
  let liveSnipers = 0;
  for (const a of list) if ((a.archetype === 'sniper' || a.sniper === true) && a.health > 0) liveSnipers++;
  return {
    ...window.__SNIPE__,
    elapsed: +e.time.elapsed.toFixed(1),
    liveSnipers,
    aiStats: ai?.stats ?? null,
  };
});

console.log('\n=== A REAL MATCH ===');
console.log(`  game time elapsed        ${out.elapsed} s`);
console.log(`  sniper rounds fired      ${out.shots}`);
console.log(`  every other bot's rounds ${out.other}`);
console.log(`  sniper damage dealt      ${out.dmg.toFixed(0)}`);
console.log(`  sniper KILLS             ${out.kills}   (all other bots: ${out.killsOther})`);
console.log(`  snipers alive at the end ${out.liveSnipers}`);

const c1 = await census();
console.log('\n=== ROSTER AT THE END (respawns re-draw the persona) ===');
for (const [t, v] of Object.entries(c1)) {
  console.log(`  team ${t}: ${v.sniper} sniper / ${v.total} men`);
}

/* ---- photograph one, holding the rifle --------------------------------- */
const shot = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const list = ai?.agents ?? ai?.list ?? [];
  const s = list.find((a) => (a.archetype === 'sniper' || a.sniper === true) && a.health > 0)
    ?? list.find((a) => a.archetype === 'sniper' || a.sniper === true);
  if (!s) return null;
  const cam = e.ctx.camera;
  const V = cam.position.constructor;
  // Stand off 4.5 m at chest height, looking at him.
  const p = s.position;
  const yaw = (s.yaw ?? 0) + Math.PI * 0.62;
  cam.position.set(p.x + Math.sin(yaw) * 4.5, p.y + 1.35, p.z + Math.cos(yaw) * 4.5);
  cam.lookAt(new V(p.x, p.y + 1.15, p.z));
  cam.updateMatrixWorld();
  const pl = e.ctx.peek('player');
  if (pl?.setControlEnabled) pl.setControlEnabled(false);
  e.ctx.peek('ui')?.setHudVisible?.(false);
  e.ctx.peek('weapons').viewmodel.trackCamera = false;
  e.ctx.peek('weapons').viewmodel.anchor.visible = false;
  return { callsign: s.callsign ?? s.name ?? '?', team: s.team, hp: s.health, dmg: s.weaponDamage, at: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)] };
});
if (shot) {
  await page.evaluate(() => new Promise((r) => { let i = 0; const t = () => (++i >= 30 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
  await page.screenshot({ path: `${OUT}/sniper-bot.png` });
  console.log(`\n[snipers] photographed ${shot.callsign} (team ${shot.team}, hp ${shot.hp}, weaponDamage ${shot.dmg}) at ${JSON.stringify(shot.at)}`);
  console.log(`[snipers] wrote ${OUT}/sniper-bot.png`);
} else {
  console.log('\n[snipers] NO SNIPER ON THE ROSTER TO PHOTOGRAPH');
}

console.log(`\npageerrors: ${errs.length}`);
for (const e of errs.slice(0, 4)) console.log('  ' + e);
await browser.close();
