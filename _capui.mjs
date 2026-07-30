/**
 * WHAT A PLAYER WOULD SEE — the three things this pass changed, driven with real
 * keys and photographed at the moment they are supposed to be legible.
 *
 *   node _capui.mjs [--url=…] [--shots=shots/capui]
 *
 *   1. THE CAPTURE PANEL. Walk the human into a zone on W and screenshot the
 *      panel at 0 %, mid bar, CONTESTED (an enemy body put in the circle),
 *      the CAPTURED card, and the UNDER ATTACK card once it is ours and being
 *      taken back.
 *   2. THE FRAG CLOCK. Resupply at one grenade stack, spend the frags, and try a
 *      DIFFERENT stack immediately — which must refuse with the seconds on it,
 *      because the per-cache cooldown would not stop that circuit — then again
 *      after sixty seconds, which must hand them over.
 *   3. THE PICKUPS. Stand at one cache of every kind and photograph the world
 *      marker and the two-row prompt.
 *
 * The bots are frozen (`ai.combatEnabled = false`) and the player is protected,
 * so nothing here is decided by a firefight.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4221/';
const SHOTS = args.shots ?? 'shots/capui';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message)));

let fails = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });
const scale = (s) => page.evaluate((v) => { window.__ENGINE__.time.scale = v; }, s);

console.log(`[capui] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await scale(8);
await page.waitForFunction(
  () => window.__ENGINE__.ctx.peek('match').phase === 'live',
  null,
  { timeout: 180000 }
);
await page.waitForTimeout(1200);
await scale(1);
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  ai.combatEnabled = false;
  ai.protect(e.ctx.peek('player'), 99999);
  window.__M__ = m;
  window.__UI__ = e.ctx.peek('ui');
});
await page.mouse.click(800, 450); // pointer lock — `input.enabled`
await page.waitForTimeout(400);

/** Everything the harness asserts on, read off the live widgets. */
const hud = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = window.__M__;
    const ui = window.__UI__;
    const p = e.ctx.peek('player');
    const wp = e.ctx.peek('weapons');
    const c = m.caches.nearest(p.position);
    const z = m.capture.zoneAt(p.position);
    return {
      t: +e.time.elapsed.toFixed(2),
      capture: {
        mode: ui.capturePanel.mode,
        zone: ui.capturePanel.zoneId,
        visible: ui.capturePanel.visible,
        text: ui.capturePanel.text,
        progress: +ui.capturePanel.progress.toFixed(3),
      },
      zone: z
        ? { id: z.id, owner: z.owner, progress: +z.progress.toFixed(3), contested: z.contested,
            counts: [z.counts[0], z.counts[1]], rate: +(z.rate ?? 0).toFixed(4) }
        : null,
      prompt: {
        txt: document.querySelector('.ow-prompt-row:not(.alt) .ow-prompt-txt')?.textContent ?? '',
        sub: document.querySelector('.ow-prompt-row:not(.alt) .ow-prompt-sub')?.textContent ?? '',
        cap: document.querySelector('.ow-prompt-row:not(.alt) .ow-prompt-cap')?.textContent ?? '',
        altTxt: document.querySelector('.ow-prompt-row.alt .ow-prompt-txt')?.textContent ?? '',
        altSub: document.querySelector('.ow-prompt-row.alt .ow-prompt-sub')?.textContent ?? '',
        altCap: document.querySelector('.ow-prompt-row.alt .ow-prompt-cap')?.textContent ?? '',
      },
      toast: ui.pickupToast.text,
      beaconStrip: ui.beaconStrip.text,
      markers: Array.from(document.querySelectorAll('.ow-cache'))
        .filter((n) => n.style.display !== 'none')
        .map((n) => `${n.querySelector('.ow-cache-label').textContent}/${n.querySelector('.ow-cache-sub').textContent}`),
      frags: wp.grenadeCount,
      fragCd: +m.caches.grenadeCooldown(e.time.elapsed).toFixed(1),
      fragBadge: document.querySelector('.ow-slot-cd')?.textContent ?? '',
      near: c ? `${c.id}/${c.kind}` : null,
      playerTeam: m.playerTeam,
    };
  });

/* ══════════════════════════ 1. THE CAPTURE PANEL ═══════════════════════ */
console.log('\n── 1. the capture panel ────────────────────────────────────');

const staged = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = window.__M__;
  const ai = e.ctx.peek('ai');
  const p = e.ctx.peek('player');
  const me = m.playerTeam;
  let zone = null;
  for (const z of m.sites) {
    if (z.owner === me) continue;
    if (z.counts[0] || z.counts[1]) continue;
    zone = z;
    break;
  }
  if (!zone) return { ok: false, reason: 'no empty zone that is not already ours' };
  // A staging point OUTSIDE the circle with a straight walkable line into it —
  // holding W steers nothing. Same sweep `_domplayer.mjs` uses.
  const clear = (x0, z0, x1, z1, y) => {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(2, Math.ceil(d));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      if (ai.grid.nearest(x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, y, 1, 1.2) < 0) return false;
    }
    return true;
  };
  let placed = null;
  for (let i = 0; i < 36 && !placed; i++) {
    const th = (i / 36) * Math.PI * 2;
    const r = zone.radius + 5;
    const x = zone.position.x + Math.cos(th) * r;
    const z2 = zone.position.z + Math.sin(th) * r;
    const y = ai.groundAt(x, z2, zone.position.y + 4);
    if (!Number.isFinite(y)) continue;
    if (!clear(x, z2, zone.position.x, zone.position.z, y)) continue;
    placed = { x, y, z: z2 };
  }
  if (!placed) return { ok: false, reason: 'no clear approach' };
  p.health.reset(true);
  p.setControlEnabled(true);
  p.movement.velocity.set(0, 0, 0);
  p.movement.teleport(placed.x, placed.y + 0.1, placed.z);
  // Face the middle of the point.
  p.movement.yaw = Math.atan2(zone.position.x - placed.x, zone.position.z - placed.z) + Math.PI;
  p.movement.pitch = 0;
  ai.protect(p, 99999);
  return { ok: true, zone: zone.id, name: zone.name, owner: zone.owner, from: [+placed.x.toFixed(1), +placed.z.toFixed(1)] };
});
console.log('  staged:', JSON.stringify(staged));
if (!staged.ok) { console.error('cannot stage'); await browser.close(); process.exit(1); }

// Walk in. Real key, held.
await page.keyboard.down('KeyW');
await page.waitForFunction(
  () => {
    const m = window.__M__;
    const p = window.__ENGINE__.ctx.peek('player');
    return !!m.capture.zoneAt(p.position);
  },
  null,
  { timeout: 60000 }
);
const h0 = await hud();
await shot('cap-1-enter');
// Two more steps to get off the rim and onto the point, then stand on it. W held
// any longer walks him straight out the far side and the bar bleeds back — which
// is correct behaviour and useless for photographing a capture.
await page.waitForTimeout(900);
await page.keyboard.up('KeyW');
console.log(`  entered: ${JSON.stringify(h0.capture)} zone=${JSON.stringify(h0.zone)}`);
check('the panel is up the moment he is on the point', h0.capture.visible === true, h0.capture.text);
check('…and it is about the zone he is in', h0.capture.zone === staged.zone);
check('…at the bottom of the bar', h0.capture.progress < 0.3, `${h0.capture.progress}`);
check('…with a live rate to count down from', (h0.zone?.rate ?? 0) > 0, `${h0.zone?.rate}/s`);

// Mid bar.
await page.waitForFunction(
  () => window.__UI__.capturePanel.progress > 0.45 && window.__UI__.capturePanel.progress < 0.72,
  null,
  { timeout: 60000 }
);
const h1 = await hud();
await shot('cap-2-mid');
console.log(`  mid: ${h1.capture.text}`);
check('mid bar reads as a capture in progress', /CAPTURING/.test(h1.capture.text ?? ''), h1.capture.text);
check('…and says how long it has left', /CAPTURED IN \d+S/.test(h1.capture.text ?? ''), h1.capture.text);

/* ---- CONTESTED: put an enemy body in the circle -------------------- */
/**
 * Put `n` enemy bodies in the circle and hold them there. `position` alone is
 * not enough — the character CONTROLLER owns where an Agent ends up next frame,
 * so it has to be teleported too, and `working` is the documented flag that
 * freezes a man where he stands.
 */
const putFoesOn = async (n) =>
  page.evaluate((count) => {
    const m = window.__M__;
    const z = m.sites.find((s) => s.id === window.__ZID__);
    let k = 0;
    for (const a of m._botsByTeam[1 - m.playerTeam]) {
      if (!a.alive || k >= count) continue;
      const x = z.position.x + (k ? 1.2 : -1.2);
      const zz = z.position.z + (k ? 1.2 : -1.2);
      a.working = true;
      a.position.set(x, z.position.y, zz);
      a.controller?.teleport(x, z.position.y, zz);
      k++;
    }
    return { placed: k, counts: [z.counts[0], z.counts[1]] };
  }, n);
const releaseFoes = () =>
  page.evaluate(() => {
    const m = window.__M__;
    const z = m.sites.find((s) => s.id === window.__ZID__);
    for (const a of m._botsByTeam[1 - m.playerTeam]) {
      if (a.working !== true) continue;
      a.working = null;
      const x = z.position.x + 30;
      a.position.set(x, a.position.y, z.position.z + 30);
      a.controller?.teleport(x, a.position.y, z.position.z + 30);
    }
  });
await page.evaluate((id) => { window.__ZID__ = id; }, staged.zone);
// Hold them there for a beat: an Agent update can still move a man.
let placed = null;
for (let i = 0; i < 14; i++) {
  placed = await putFoesOn(1);
  await page.waitForTimeout(70);
}
console.log(`  foes on the point: ${JSON.stringify(placed)}`);
const h2 = await hud();
await shot('cap-3-contested');
console.log(`  contested: ${h2.capture.text} · counts=${JSON.stringify(h2.zone?.counts)}`);
check('both sides in the circle reads CONTESTED', /CONTESTED/.test(h2.capture.text ?? ''), h2.capture.text);
check('…and the panel says what to do about it', /KILL THEM OR LEAVE|DEADLOCK|OUTNUMBERED/.test(h2.capture.text ?? ''), h2.capture.text);
await releaseFoes();

/* ---- the CAPTURED card --------------------------------------------- */
await page.waitForFunction(() => window.__UI__.capturePanel.mode === 'won', null, { timeout: 90000 });
const h3 = await hud();
await shot('cap-4-captured');
console.log(`  captured: ${h3.capture.text}`);
check('the flip gets its own card', h3.capture.mode === 'won', h3.capture.text);
check('…and says what the capture just bought', /FORWARD SPAWN OPEN/.test(h3.capture.text ?? ''), h3.capture.text);

/* ---- UNDER ATTACK: ours, being taken, and we are not on it ---------- */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = window.__M__;
  const p = e.ctx.peek('player');
  const z = m.sites.find((s) => s.id === window.__ZID__);
  // Step the human well clear of the circle he just took…
  const x = z.position.x + z.radius + 9;
  const y = e.ctx.peek('ai').groundAt(x, z.position.z, z.position.y + 4);
  p.movement.teleport(x, (Number.isFinite(y) ? y : z.position.y) + 0.1, z.position.z);
});
// …and put two of theirs on it, for long enough that the bar is visibly going.
let threatCounts = null;
for (let i = 0; i < 26; i++) {
  threatCounts = await putFoesOn(2);
  await page.waitForTimeout(90);
}
console.log(`  foes on our point: ${JSON.stringify(threatCounts)}`);
const h4 = await hud();
await shot('cap-5-under-attack');
console.log(`  threat: ${h4.capture.text}`);
check('a zone of ours being taken warns us from off the point',
  h4.capture.mode === 'threat', `${h4.capture.mode} — ${h4.capture.text}`);
check('…with the clock on it', /LOST IN \d+S/.test(h4.capture.text ?? ''), h4.capture.text);
await page.evaluate(() => {
  const m = window.__M__;
  for (const a of m._botsByTeam[1 - m.playerTeam]) if (a.working === true) a.working = null;
});

/* ══════════════════════ 2. THE ONE MINUTE FRAG CLOCK ═══════════════════ */
console.log('\n── 2. frags: one per minute, per player ────────────────────');

const stacks = await page.evaluate(() =>
  window.__M__.caches.list.filter((c) => c.kind === 'grenade').map((c) => c.id)
);
console.log(`  grenade stacks on this map: ${stacks.join(', ')}`);
check('there is more than one grenade stack (the per-cache cooldown is not the rule)',
  stacks.length > 1, `${stacks.length} stacks`);

/** Stand on a cache's painted square, facing it. @see _cachetest.mjs */
const goTo = (id) =>
  page.evaluate((cid) => {
    const e = window.__ENGINE__;
    const m = window.__M__;
    const p = e.ctx.peek('player');
    const c = m.caches.list.find((x) => x.id === cid);
    if (!c) return null;
    p.health.reset(true);
    p.setControlEnabled(true);
    p.movement.yaw = c.yaw;
    p.movement.pitch = 0;
    p.movement.velocity.set(0, 0, 0);
    p.movement.teleport(c.position.x - Math.sin(c.yaw) * 1.1, c.position.y + 0.05, c.position.z - Math.cos(c.yaw) * 1.1);
    e.ctx.peek('ai').protect(p, 99999);
    return { id: c.id, kind: c.kind, label: c.label, near: m.caches.nearest(p.position)?.id ?? null };
  }, id);

const press = async (ms) => {
  await page.keyboard.down('KeyF');
  await page.waitForTimeout(ms);
  await page.keyboard.up('KeyF');
  await page.waitForTimeout(260);
};

/** Throw every frag we are carrying, for real. */
const emptyPouch = async () => {
  const n = await page.evaluate(() => window.__ENGINE__.ctx.peek('weapons').grenadeCount);
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Digit4');
    await page.waitForTimeout(650);
    await page.mouse.down();
    await page.waitForTimeout(360);
    await page.mouse.up();
    await page.waitForTimeout(1500);
  }
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(500);
  return page.evaluate(() => window.__ENGINE__.ctx.peek('weapons').grenadeCount);
};

console.log('  at stack:', JSON.stringify(await goTo(stacks[0])));
await page.waitForTimeout(500);
console.log(`  emptying the pouch: ${await emptyPouch()} frags left`);
await goTo(stacks[0]);
await page.waitForTimeout(500);
await press(900);
const g1 = await hud();
await shot('frag-1-resupplied');
console.log(`  after HOLD F: frags=${g1.frags} cd=${g1.fragCd}s badge="${g1.fragBadge}" toast="${g1.toast}"`);
check('the first resupply is handed over', g1.frags > 0, `${g1.frags} frags`);
check('…and it starts a sixty second clock', g1.fragCd > 55 && g1.fragCd <= 60, `${g1.fragCd}s`);
check('…which the HUD carries beside the frag count', /\d+S/.test(g1.fragBadge), `badge "${g1.fragBadge}"`);

// Spend them, then try a DIFFERENT stack — the per-cache cooldown cannot refuse
// this one, so whatever refuses it is the per-player rule.
console.log(`  emptying again: ${await emptyPouch()} frags left`);
const other = stacks[1];
console.log('  at a DIFFERENT stack:', JSON.stringify(await goTo(other)));
await page.waitForTimeout(500);
const gPre = await hud();
console.log(`  prompt before pressing: "${gPre.prompt.cap} ${gPre.prompt.txt} / ${gPre.prompt.sub}"`);
check('the prompt says the frags are not available yet, before he presses',
  /READY IN \d+S/.test(gPre.prompt.sub), gPre.prompt.sub);
await press(900);
const g2 = await hud();
await shot('frag-2-refused-inside-60s');
console.log(`  after HOLD F inside the window: frags=${g2.frags} cd=${g2.fragCd}s toast="${g2.toast}"`);
check('INSIDE the minute it refuses', g2.frags === 0, `${g2.frags} frags`);
check('…and says why, with the seconds', /COOLDOWN|READY IN/.test(g2.toast ?? ''), `toast "${g2.toast}"`);

// Now wait the minute out.
await scale(8);
await page.waitForFunction(
  () => window.__M__.caches.grenadeCooldown(window.__ENGINE__.time.elapsed) <= 0,
  null,
  { timeout: 120000 }
);
await scale(1);
await page.waitForTimeout(400);
// A death anywhere in that minute hands out a fresh loadout, so empty the pouch
// again before the last press — otherwise "POUCH FULL" is what gets measured
// and the rule under test is never exercised. (It happened on the first run.)
await goTo(other);
await page.waitForTimeout(400);
const carried = await page.evaluate(() => window.__ENGINE__.ctx.peek('weapons').grenadeCount);
if (carried > 0) console.log(`  respawned with frags — emptying again: ${await emptyPouch()} left`);
await goTo(other);
await page.waitForTimeout(500);
await press(900);
const g3 = await hud();
await shot('frag-3-allowed-after-60s');
console.log(`  after the minute: frags=${g3.frags} cd=${g3.fragCd}s toast="${g3.toast}"`);
check('OUTSIDE the minute it hands them over', g3.frags > 0, `${g3.frags} frags`);
check('…and the clock restarts', g3.fragCd > 55, `${g3.fragCd}s`);

/* ══════════════════════════ 3. THE PICKUPS ═════════════════════════════ */
console.log('\n── 3. the caches, and whether you could miss them ──────────');

const kinds = await page.evaluate(() => {
  const seen = {};
  for (const c of window.__M__.caches.list) if (!seen[c.kind]) seen[c.kind] = c.id;
  return seen;
});
console.log(`  one of each kind: ${JSON.stringify(kinds)}`);

for (const [kind, id] of Object.entries(kinds)) {
  await goTo(id);
  await page.waitForTimeout(700);
  const s = await hud();
  await shot(`cache-${kind}`);
  console.log(
    `  ${kind} (${id}): prompt="${s.prompt.cap} ${s.prompt.txt} / ${s.prompt.sub}" ` +
      `alt="${s.prompt.altCap} ${s.prompt.altTxt} / ${s.prompt.altSub}" markers=${JSON.stringify(s.markers)}`
  );
  check(`${kind}: the prompt names the HOLD`, s.prompt.cap === 'HOLD', s.prompt.cap);
  check(`${kind}: …and the TAP is its own row`, s.prompt.altCap === 'TAP' && /BEACON/.test(s.prompt.altTxt),
    `${s.prompt.altCap} ${s.prompt.altTxt}`);
  check(`${kind}: the cache is marked in the world`, s.markers.length > 0, s.markers.join(' · '));
  check(`${kind}: …and the one in reach says HOLD F`, s.markers.some((m) => /HOLD F/.test(m)),
    s.markers.join(' · '));
}

/* ---- and the beacon, which is the least discoverable of the four ---- */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = window.__M__;
  m.caches.beacon.active = false;
  m.caches.beacon.readyAt = 0;
  void e;
});
await goTo(kinds.ammo ?? Object.values(kinds)[0]);
await page.waitForTimeout(500);
await press(120); // a TAP
const b = await hud();
await shot('beacon-up');
console.log(`  beacon: strip="${b.beaconStrip}" toast="${b.toast}"`);
check('a TAP puts the beacon up', /BEACON ONLINE/.test(b.toast ?? ''), `${b.toast}`);
check('…and it has its own clock on screen', /BEACON ONLINE \d+S/.test(b.beaconStrip ?? ''), `${b.beaconStrip}`);

/* ══════════════════════════════ verdict ═══════════════════════════════ */
console.log(`\n[capui] page errors: ${errors.length}`);
for (const e of errors) console.log('  ' + e);
console.log(`[capui] ${fails} failed check(s)`);
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
