/**
 * HOW LONG DOES IT ACTUALLY TAKE TO KILL THE TANK.
 *
 * Not algebra out of a comment — the real `explosion` and `fireBullet` paths,
 * fired at the real hull with the real colliders enabled, counted until it
 * brews up. A frag is emitted with the EXACT payload `src/weapons/grenades.js`
 * emits (`damage: 0`, `impulse: blastDamage * 0.9`, `source: 'grenade'`), so
 * this measures the tank's own listener rather than a mock.
 *
 * Usage: node _tankttk.mjs [url] [seed]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4290/';
const SEED = process.argv[3] ?? '7';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const m = ctx.peek('match');
  const phys = ctx.peek('physics');
  const a = m?.tank ?? m?.armour;
  if (!a?.ready) return { error: `no armour (match keys: ${m ? Object.keys(m).filter((k) => /tank|arm/i.test(k)).join(',') : 'no match'})` };
  const V3 = e.camera.position.constructor;

  const roll = () => {
    a.reset();
    a.fire();
    for (let i = 0; i < 4; i++) a.update(1 / 60, false);
  };
  const full = a.tanks[0].health;

  /* ---- 1. FRAGS, detonating on the hull ------------------------------- */
  // The exact payload src/weapons/grenades.js:187-193 emits.
  const frag = (t, offset) => {
    const p = new V3(t.position.x, t.position.y + 1.4 + offset, t.position.z);
    ctx.events.emit('explosion', {
      position: p, radius: 7.5, damage: 0, impulse: 165 * 0.9, source: 'grenade',
    });
  };
  const fragAt = (t, dist) => {
    const p = new V3(t.position.x + dist, t.position.y + 1.4, t.position.z);
    ctx.events.emit('explosion', {
      position: p, radius: 7.5, damage: 0, impulse: 165 * 0.9, source: 'grenade',
    });
  };

  roll();
  let t = a.tanks[0];
  const h0 = t.health;
  frag(t, 0);
  const oneFrag = h0 - t.health;

  roll(); t = a.tanks[0];
  let nFrag = 0;
  while (t.alive && nFrag < 60) { frag(t, 0); nFrag++; }
  const fragKill = t.alive ? null : nFrag;

  // a frag that lands 3 m off the hull
  roll(); t = a.tanks[0];
  const h1 = t.health;
  fragAt(t, 3);
  const fragOff3 = h1 - t.health;

  roll(); t = a.tanks[0];
  let nFrag3 = 0;
  while (t.alive && nFrag3 < 200) { fragAt(t, 3); nFrag3++; }
  const frag3Kill = t.alive ? null : nFrag3;

  /* ---- 2. RIFLE ROUNDS, through the real ballistics path -------------- */
  // Fire from 9 m away straight at the centre of a named box.
  const shootAt = (t, local, damage, limit) => {
    const from = new V3(), to = new V3();
    let n = 0, dealt = 0;
    const parts = {};
    while (t.alive && n < limit) {
      to.set(local[0], local[1], local[2]).applyMatrix4(t.root.matrixWorld);
      // stand off along the box's own outward direction
      const dir = new V3(local[0], 0, local[2]);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize().transformDirection(t.root.matrixWorld);
      from.copy(to).addScaledVector(dir, 9);
      const d = new V3().subVectors(to, from).normalize();
      const before = t.health;
      phys.fireBullet({
        origin: from, dir: d, damage, penetration: 1.4, maxDist: 40,
        mask: phys.MASK.BULLET, shooter: null,
      });
      const got = before - t.health;
      dealt += got;
      n++;
      if (got <= 0 && n > 3) break; // not reaching the box at all
    }
    return { rounds: n, dealt: +dealt.toFixed(0), killed: !t.alive, perRound: +(dealt / Math.max(1, n)).toFixed(2), parts };
  };

  roll(); t = a.tanks[0];
  const deck = shootAt(t, [0, 1.85, -2.0], 17, 400);
  roll(); t = a.tanks[0];
  const turret = shootAt(t, [0, 2.0, -0.3], 17, 900);
  roll(); t = a.tanks[0];
  const hull = shootAt(t, [0, 1.25, 3.0], 17, 1200);
  // The AKM, and the bolt gun — a roof vantage looking down on the engine deck
  // is the cheapest shot on the map if 1.7 is too generous.
  roll(); t = a.tanks[0];
  const deckAk = shootAt(t, [0, 1.85, -2.0], 21, 400);
  roll(); t = a.tanks[0];
  const deckSniper = shootAt(t, [0, 1.85, -2.0], 125, 200);
  roll(); t = a.tanks[0];
  const hullSniper = shootAt(t, [0, 1.25, 3.0], 125, 400);

  /* ---- 3. what the stats block recorded ------------------------------- */
  roll(); t = a.tanks[0];
  frag(t, 0); frag(t, 0);
  const statsAfter2 = JSON.parse(JSON.stringify(t.stats));

  a.reset();
  return {
    full, oneFrag: +oneFrag.toFixed(0), fragKill,
    fragOff3: +fragOff3.toFixed(0), frag3Kill,
    deck, turret, hull, deckAk, deckSniper, hullSniper, statsAfter2,
    tankHealth: full,
  };
});

if (out.error) console.log('ERROR', out.error);
else {
  console.log(`tankHealth ${out.full}`);
  console.log(`\n--- FRAGS (M67: 7.5 m, 165 blastDamage, published as impulse 148.5) ---`);
  console.log(`  one frag ON the hull       ${out.oneFrag} damage  (${(100 * out.oneFrag / out.full).toFixed(1)}% of full health)`);
  console.log(`  frags to kill, at contact  ${out.fragKill ?? 'DID NOT DIE'}`);
  console.log(`  one frag 3 m off the hull  ${out.fragOff3} damage`);
  console.log(`  frags to kill, 3 m off     ${out.frag3Kill ?? 'DID NOT DIE'}`);
  console.log(`\n--- M4 ROUNDS (17 damage, 30-round magazine, 240 carried) ---`);
  const mag = { deck: 30, turret: 30, hull: 30, 'deck (AKM 21)': 30, 'deck (sniper 125)': 5, 'hull (sniper 125)': 5 };
  for (const [k, v] of Object.entries({
    deck: out.deck, turret: out.turret, hull: out.hull,
    'deck (AKM 21)': out.deckAk, 'deck (sniper 125)': out.deckSniper, 'hull (sniper 125)': out.hullSniper,
  })) {
    console.log(`  ${k.padEnd(18)} ${String(v.rounds).padStart(5)} rounds ` +
      `(${(v.rounds / mag[k]).toFixed(1)} magazines), ${v.perRound}/round, killed=${v.killed}`);
  }
  console.log(`\n--- stats block after 2 frags ---`);
  console.log(' ', JSON.stringify(out.statsAfter2));
}
if (errs.length) console.log('\nPAGEERRORS:', errs);
await b.close();
