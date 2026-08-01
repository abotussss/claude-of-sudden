/**
 * EYE-LEVEL SITE PHOTOGRAPHY — look at the map from where it is fought.
 *
 *   node tools/eyeshot.mjs --out=/tmp/site --url=http://127.0.0.1:4205/
 *   node tools/eyeshot.mjs --out=/tmp/site --only=A-attack-north
 *
 * `src/dev/shots.js` holds the canonical hero/lighting frames and its poses are
 * fixed there. This is the gameplay equivalent and its poses are LEVEL-SPACE
 * and AUTHORED HERE, because they have to move when the sites move: stand at
 * each courtyard's attacker mouth looking in, stand on the defence's hold
 * looking out, and stand on the overwatch looking down at the plant spot. The
 * camera is dropped onto whatever the physics says the floor is at that point,
 * so a pose cannot silently end up buried in a terrace or floating over a deck.
 *
 * Why it exists: every gate in this repo is a number, and no number in it could
 * tell you a bomb site was bare. Somebody has to look.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    /**
     * SPLIT ON THE FIRST `=` ONLY. `split('=')` destructured to `[k, v]` threw
     * away everything after the second one, so `--url=…/?seed=12` reached the
     * page as `…/?seed`, `Number('')` became 0, and this gate measured seed 0
     * while reporting the seed it was asked for. It "passed" on the seed a
     * sweep failed 8 boots out of 8. A tool that silently measures something
     * other than what it was pointed at is worse than a tool that crashes.
     */
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4173/';
const OUT = resolve(String(args.out ?? 'shots/site'));
const W = Number(args.w ?? 1280);
const H = Number(args.h ?? 720);
const ONLY = args.only ? String(args.only).split(',') : null;

/**
 * Poses, in LEVEL space (the coordinates src/world/layout.js authors in, AFTER
 * its 1.5x — i.e. what `world.worldToLevel` returns).
 *
 *   from:  [x, z]  where the eye stands; the floor under it is measured
 *   look:  [x, z]  what it is pointed at, at `lookY` above that floor
 *   dy:    lift the eye off the floor by this (1.62 = standing eye)
 *   lookY: how far above the FLOOR AT THE TARGET to aim
 *   atY:   put the EYE at this absolute height instead of floor + dy. The floor
 *          probe uses MASK.WORLD, which by design does not see `LAYER.CLIP` — so
 *          the only way to stand on one of the rooftop gangways (whose decks are
 *          clip, see src/world/links.js) is to say how high it is.
 *   lookAbs: aim at this absolute height instead — use it whenever the target
 *          stands next to a wall, a gate or a block, because the floor under a
 *          point 1 m from a 10 m gate is the top of the gate and the frame comes
 *          back pointing at the sky. Four of the boundary poses did exactly that.
 */
const POSES = [
  // ---- SITE A, plant zone at level (-42, -10.5) ---------------------------
  { id: 'A-attack-north', from: [-40, 3], look: [-42, -10.5], doc: "the attacker's own lane mouth, walking in from the north" },
  { id: 'A-attack-conn', from: [-31, -6], look: [-42, -10.5], doc: 'the connector mouth from mid — the flank' },
  { id: 'A-plant', from: [-42, -10.5], look: [-42, 4], doc: 'standing ON the plant spot, looking back up the attack lane' },
  { id: 'A-defend-hold', from: [-36, -18], look: [-42, -8], doc: "the defence's ground hold, looking at the plant zone" },
  { id: 'A-overwatch', from: [-52, -9], look: [-42, -10.5], dy: 2.9 + 1.62, doc: 'the A-deck, looking down at the plant spot' },
  // ---- SITE B, plant zone at level (42, -10.5) ---------------------------
  { id: 'B-attack-north', from: [40, 3], look: [42, -10.5], doc: "the attacker's own lane mouth, walking in from the north" },
  { id: 'B-attack-conn', from: [31, -6], look: [42, -10.5], doc: 'the connector mouth from mid — the flank' },
  { id: 'B-plant', from: [42, -10.5], look: [42, 4], doc: 'standing ON the plant spot, looking back up the attack lane' },
  { id: 'B-defend-hold', from: [36, -18], look: [42, -8], doc: "the defence's ground hold, looking at the plant zone" },
  { id: 'B-overwatch', from: [52, -5], look: [42, -10.5], dy: 2.9 + 1.62, doc: 'the B-deck, looking down at the plant spot' },
  { id: 'B-south-overwatch', from: [32.3, -19.6], look: [42, -10.5], dy: 3.0 + 1.62, doc: "the defence's own south catwalk" },
  { id: 'A-south-overwatch', from: [-32.3, -19.6], look: [-42, -10.5], dy: 3.0 + 1.62, doc: "the defence's own south catwalk" },
  /**
   * Close range, for judging the masonry rather than the layout. The SITEWORKS
   * table authors in unscaled level space and these are in scaled — the
   * coordinates `world.worldToLevel` hands back — so each is 1.5x its entry:
   * the A south plinth is authored at (-26.8, -9.8) and stands at (-40.2, -14.7).
   */
  /**
   * ---- THE EDGE OF THE MAP ------------------------------------------------
   * The six places `tools/boundcheck.mjs` measured the play area leaking into
   * 5 645 m² of empty sand, photographed from inside. There is no number that
   * can tell you a boundary reads as a boundary rather than as a wall somebody
   * dropped behind the spawn, so these are the frames that judge the cordon.
   */
  { id: 'bound-N-spawn', from: [0, 62], look: [0, 73], lookAbs: 2.2, doc: "the attack spawn looking north at the closed end of the street" },
  { id: 'bound-N-west', from: [-4, 61], look: [-9.4, 70], lookAbs: 2.0, doc: 'the old west crossing at x -10, z 68, from inside the spawn' },
  { id: 'bound-N-east', from: [4, 61], look: [9.4, 70], lookAbs: 2.0, doc: 'the same crossing on the east side' },
  { id: 'bound-S-spawn', from: [0, -62], look: [0, -74], lookAbs: 3.0, doc: 'the defence spawn looking south at the gate and its flanks' },
  { id: 'bound-S-gate', from: [4, -79], look: [-9, -84], lookAbs: 1.6, doc: 'the pocket behind the gate arch, now closed on both sides' },
  { id: 'bound-party-A', from: [-33, 43], look: [-46, 50], lookAbs: 3.0, doc: 'the 0.75 m slot between BW1 and W5, now a party wall' },
  { id: 'bound-party-B', from: [33, 43], look: [46, 50], lookAbs: 3.0, doc: 'the same slot on the east row' },
  /**
   * ---- WHAT IS UPSTAIRS, AND HOW YOU GET FROM ONE ROOF TO THE NEXT ---------
   * The caches in `src/world/features.js` and the gangways in
   * `src/world/links.js`. `floorcheck` can prove there is room to stand at a
   * cache and that a deck walks end to end; it cannot say whether the thing you
   * climbed two storeys for looks like it was put there on purpose.
   *
   * `dy` is measured from the FLOOR AT `from`, and the floor over an interior is
   * the roof — so every one of these stands on a roof or on a gangway on
   * purpose, and the two interior ones are shot from the stairhead side where
   * the floor the ray finds is the storey itself.
   */
  { id: 'link-W1-W2', from: [-22, 27], look: [-22, 13], lookAbs: 7.7, doc: 'standing on the W1-W2 gangway over connector 1' },
  { id: 'link-W2-W3', from: [-20, 4], look: [-20, -16], lookAbs: 7.7, doc: 'the W2-W3 gangway over connector 2' },
  { id: 'link-E2-E3', from: [14, -17], look: [14, -2], lookAbs: 8.6, doc: 'the E2-E3 ramp, looking down the 3 m fall' },
  { id: 'link-E1-E2', from: [18, 27], look: [18, 10], lookAbs: 10.7, doc: 'the E1-E2 gangway, from E1 s roof' },
  { id: 'roof-W1-vantage', from: [-13, 24], look: [-16.5, 26.5], lookAbs: 7.4, doc: "W1's roof nest and the stairhead light well" },
  { id: 'roof-E2-vantage', from: [16, 9], look: [21, 4.5], lookAbs: 10.4, doc: "E2's roof nest over site B's approach" },
  { id: 'roof-K1-vantage', from: [0, 15], look: [0, 18], lookAbs: 4.2, doc: "the mid island's nest, the most contested 4 m² on the map" },
  /**
   * ---- THE SAME FOUR LINKS FROM ABOVE -------------------------------------
   * An eye-level frame on a 1.4 m deck 6 m up is honest but hard to read — the
   * first pass produced four frames nobody could identify, because at eye level
   * on a roof the nearest object is the stairhead and it fills the lens. `atY`
   * puts the lens in the air instead, and at 12-14 m the whole span, both
   * landings and the connector underneath are in one frame.
   */
  { id: 'drone-W1-W2', from: [-22, 31], atY: 18, look: [-22, 18], lookAbs: 7.5, doc: 'the W1-W2 gangway and connector 1 under it' },
  { id: 'drone-W2-W3', from: [-20, -23], atY: 18, look: [-20, -7], lookAbs: 7.5, doc: 'the W2-W3 gangway over connector 2' },
  { id: 'drone-E1-E2', from: [18, 33], atY: 22, look: [18, 18], lookAbs: 10.5, doc: 'the E1-E2 gangway, three storeys up' },
  { id: 'drone-E2-E3', from: [14, -23], atY: 20, look: [14, -7], lookAbs: 9.0, doc: 'the E2-E3 ramp and its 3.05 m fall' },
  { id: 'drone-W1-roof', from: [-14, 41], atY: 13, look: [-14, 32.6], lookAbs: 7.0, doc: "W1's roof: the nest, the clutter and the stairhead light well" },
  { id: 'drone-K1-roof', from: [0, 27], atY: 10, look: [0, 18], lookAbs: 3.6, doc: "the mid island's nest over connector 1" },
  /**
   * ---- STAIR TOPS, AT EYE LEVEL, FROM THE LANDING -------------------------
   * Standing where the flight puts you, looking the way it was climbing. The
   * three roof ones are the frames "天井が塞がっているように見えます" was about.
   */
  { id: 'stair-W1-roof', from: [-27.97, 28.6], atY: 8.12, look: [-27.97, 33], lookAbs: 7.6, doc: "W1's roof flight: out of the stairhead" },
  { id: 'stair-W1-roof-up', from: [-27.97, 27.6], atY: 8.12, look: [-27.4, 28.6], lookAbs: 9.4, doc: "and the light well over the same landing" },
  { id: 'stair-E1-f2', from: [12.6, 25.6], atY: 8.12, look: [12.6, 30], lookAbs: 7.6, doc: "E1's second flight arriving on floor 2" },
  { id: 'stair-E2-roof', from: [27.4, 6.6], atY: 11.17, look: [27.4, 11], lookAbs: 10.6, doc: "E2's roof flight, three storeys up" },
  /** ---- THE CACHES THEMSELVES, at the distance you first see one --------- */
  { id: 'cache-W1-ammo', from: [-17.6, 25.4], atY: 1.75, look: [-14.2, 25.4], lookAbs: 1.0, doc: "W1's ground-floor ammunition dump — the one a bot can reach" },
  { id: 'cache-E1-weapon', from: [18.6, 26.7], atY: 5.07, look: [15.2, 26.7], lookAbs: 4.1, doc: "E1's first-floor weapon rack" },
  { id: 'A-close-plinth', from: [-40.2, -19.4], look: [-40.2, -14.7], lookY: 0.7, doc: 'the south plinth at 4.7 m' },
  { id: 'A-close-spine', from: [-42.1, -9.6], look: [-42.1, -6.0], lookY: 0.9, doc: 'the spine wall at 3.6 m' },
  { id: 'A-close-gate', from: [-38.4, 9.6], look: [-43.8, 4.8], lookY: 1.8, doc: 'the north gatehouse at 7 m' },
];

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-angle=metal',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--force-color-profile=srgb',
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--mute-audio',
  ],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));

console.log(`[eyeshot] booting ${URL} …`);
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

// Hand the camera over once: freeze input and take the player off the controls,
// exactly as __APPLY_SHOT__ does, so nothing walks the camera between frames.
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
});

mkdirSync(OUT, { recursive: true });
for (const p of POSES) {
  if (ONLY && !ONLY.includes(p.id)) continue;
  const info = await page.evaluate((pose) => {
    const e = window.__ENGINE__;
    const world = e.ctx.peek('world');
    const phys = e.ctx.peek('physics');
    const V3 = e.camera.position.constructor;
    const floor = (lx, lz) => {
      const w = world.levelToWorld(lx, 0, lz, new V3());
      const h = phys.raycast(w.x, 30, w.z, 0, -1, 0, 60, phys.MASK.WORLD);
      w.y = h.hit ? h.point.y : 0;
      return w;
    };
    const from = floor(pose.from[0], pose.from[1]);
    const to = floor(pose.look[0], pose.look[1]);
    if (pose.lookAbs !== undefined) to.y = pose.lookAbs - (pose.lookY ?? 1.2);
    const cam = e.camera;
    cam.position.set(from.x, pose.atY !== undefined ? pose.atY : from.y + (pose.dy ?? 1.62), from.z);
    cam.lookAt(new V3(to.x, to.y + (pose.lookY ?? 1.2), to.z));
    e.ctx.peek('player')?.teleport?.(cam.position, cam.rotation);
    return { floorY: +from.y.toFixed(2), targetY: +to.y.toFixed(2) };
  }, p);

  await page.evaluate(
    (n) => new Promise((done) => { let i = 0; const t = () => (++i >= n ? done() : requestAnimationFrame(t)); requestAnimationFrame(t); }),
    Number(args.settle ?? 60)
  );
  await page.screenshot({ path: `${OUT}/${p.id}.png`, type: 'png' });
  console.log(`  ${p.id.padEnd(18)} floor y ${String(info.floorY).padStart(6)}  -> ${OUT}/${p.id}.png   ${p.doc}`);
}

if (pageErrors.length) console.log('[eyeshot] page errors', pageErrors.slice(0, 6));
await browser.close();
process.exit(pageErrors.length ? 1 : 0);
