/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CAN A BOT SEE THROUGH THE WORLD'S SMOKE? — the bank sightline gate
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node src/ai/bankcheck.mjs --url=http://127.0.0.1:4598/ --map=plains
 *
 * NACHTFELD authors permanent banks of smoke off its burning wrecks, one on
 * each open crossing, because the player asked for them: 「平原での移動にもう少し
 * 無防備な時間を少なくして」. `plains-cover.js` states in its own header that they
 * are cover to the CAMERA and not to `AiSystem._smokeBlocks` — a bot sees
 * straight through. That is worse than no smoke, because it tells the player he
 * is concealed while every man on the map still has him.
 *
 * This is the gate for the fix, and it does not measure a share of a match — it
 * asks the engine the question directly, which is the only way to get an answer
 * that is not confounded by where men happened to walk.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE TEST
 * ───────────────────────────────────────────────────────────────────────────
 * For every bank the world published (`userData.fxSmoke`, read back out of the
 * scene the same way `AiSystem._scanBanks` reads it), a CHORD is constructed:
 * two points on opposite sides of the bank, `STANDOFF` metres out from its
 * centre, at a man's eye height. That is exactly the shot a bot would have
 * across a screened crossing.
 *
 *   THROUGH   the chord passes through the middle of the bank. `_smokeBlocks`
 *             must refuse it. Every one of these that returns false is a bot
 *             looking through a wall of smoke.
 *   GRAZE     the same chord pushed sideways by 1.6x the footprint, so it
 *             passes CLEAR of the bank. `_smokeBlocks` must allow it — this is
 *             the guard against a fix that simply blinds everybody, which
 *             would read as a win on the first number and cost the map its
 *             entire volume of fire.
 *
 * Eight bearings per bank so the answer cannot depend on one lucky axis.
 *
 * `_smokeBlocks` is called directly rather than through `_sightTo`, on purpose:
 * `_sightTo` also runs a physics ray, a cone test and a range test, so a
 * failure there could be geometry, darkness or distance. This isolates the one
 * thing the change is responsible for.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4598/';
const MAP = args.map ?? 'plains';
const SEED = args.seed ?? '7';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&map=${MAP}&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 600000 });

const out = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const ctx = e.ctx;
  const ai = ctx.peek('ai');
  const world = ctx.peek('world');
  const level = world?.level?.id ?? '?';
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  // `_scanBanks` runs in `update`, so give the system a frame to have found them.
  await frame(); await frame();

  /** Metres out from a bank's centre the two ends of a chord sit. */
  const STANDOFF = 26;
  /** A man's eye, near enough. */
  const EYE = 1.6;

  const banks = [];
  (world?.root ?? ctx.scene)?.traverse?.((o) => {
    const cfg = o.userData?.fxSmoke;
    if (!cfg) return;
    o.updateWorldMatrix(true, false);
    const p = new (Object.getPrototypeOf(ai._v).constructor)();
    p.setFromMatrixPosition(o.matrixWorld);
    banks.push({ x: p.x, y: p.y, z: p.z, r: cfg.radius ?? 0.35 });
  });

  const A = { x: 0, y: 0, z: 0 };
  const B = { x: 0, y: 0, z: 0 };
  let through = 0, throughBlocked = 0, graze = 0, grazeBlocked = 0;

  for (const b of banks) {
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      // THROUGH the middle
      A.x = b.x - dx * STANDOFF; A.z = b.z - dz * STANDOFF; A.y = b.y + EYE;
      B.x = b.x + dx * STANDOFF; B.z = b.z + dz * STANDOFF; B.y = b.y + EYE;
      through++;
      if (ai._smokeBlocks(A, B)) throughBlocked++;
      // …and the same chord pushed CLEAR of it
      const ox = -dz * b.r * 1.6, oz = dx * b.r * 1.6;
      A.x += ox; A.z += oz; B.x += ox; B.z += oz;
      graze++;
      if (ai._smokeBlocks(A, B)) grazeBlocked++;
    }
  }
  return {
    level, banks: banks.length, bankN: ai._bankN ?? 0,
    through, throughBlocked, graze, grazeBlocked,
    radii: banks.map((b) => +b.r.toFixed(1)).slice(0, 4),
  };
});
await browser.close();

const pc = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)} %` : '—');
console.log(`[bankcheck] ${out.level}: ${out.banks} world bank(s) tagged, AiSystem registered ${out.bankN}`);
console.log(`  THROUGH the bank  ${out.throughBlocked}/${out.through} refused  (${pc(out.throughBlocked, out.through)})  — want 100 %`);
console.log(`  CLEAR of the bank ${out.grazeBlocked}/${out.graze} refused  (${pc(out.grazeBlocked, out.graze)})  — want 0 %`);
console.log(`  footprints: ${out.radii.join(', ')} m`);
console.log(`  pageerrors ${errs.length}`);
const ok = out.banks === 0
  ? true
  : out.throughBlocked === out.through && out.grazeBlocked === 0;
console.log(out.banks === 0
  ? '[bankcheck] this map authors no banks — nothing to screen'
  : ok ? '[bankcheck] PASS — the banks stop bot sight, and only where they are'
    : '[bankcheck] FAIL');
