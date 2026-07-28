/**
 * GRIP SEARCH — find a shooting-hand target that actually closes all four
 * fingers on the handle.
 *
 *   node tools/gripfit.mjs [--url=…] [--only=rifle,knife]
 *
 * WHY THIS EXISTS. The right hand on the carbine touched the grip with the
 * index finger and missed with the other three by 14.7, 17.2 and 23.8 mm; the
 * knife missed with all four by up to 17.9 mm. Both were authored by reasoning
 * about the geometry — deriving the knuckle row from the grip's rake, placing
 * the wrist a palm-thickness off the surface — and the reasoning did not
 * survive contact with the actual solve. Three separate attempts at deriving
 * the carbine's numbers produced three different answers and none of them
 * closed the hand.
 *
 * So stop arguing and search. `Viewmodel.debugRefitRight` re-runs the real
 * contact solve for a trial target and reports the achieved fingertip gaps, and
 * this walks the five degrees of freedom (wrist position, plus the finger and
 * dorsal directions) by coordinate descent until every fingertip is on the
 * handle. It prints numbers to paste back into the model.
 *
 * It does NOT judge how the result LOOKS — four fingertips on a cylinder can
 * still be a hand at an absurd wrist angle. Always follow with
 * `tools/handshot.mjs` and look at the pictures.
 */

import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4173/';
const ONLY = args.only ? String(args.only).split(',') : ['rifle', 'smg', 'pistol', 'knife'];
/** Which hand to search: `--side=left` for the support hand. */
const SIDE = args.side === 'left' ? 'left' : 'right';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const result = await page.evaluate(([ONLY, SIDE]) => {
  const vm = window.__ENGINE__.ctx.peek('weapons').viewmodel;
  const out = [];

  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  /** Rotate `v` about unit axis `k` by `a` radians (Rodrigues). */
  const rot = (v, k, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
    const cx = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
    return [
      v[0] * c + cx[0] * s + k[0] * d * (1 - c),
      v[1] * c + cx[1] * s + k[1] * d * (1 - c),
      v[2] * c + cx[2] * s + k[2] * d * (1 - c),
    ];
  };

  /**
   * Cost: every fingertip wants to sit ~0.5 mm off the surface. Burying a tip
   * is penalised eight times as hard as leaving it proud, matching the solve's
   * own cost so the search cannot win by driving fingers through the handle.
   */
  /**
   * Cost: contact PLUS a wrist that a human could actually have.
   *
   * The contact-only version of this search worked — it closed every finger on
   * the handle — and the hands still looked wrong, because it had no opinion
   * about how the hand meets the arm. It left the carbine's right wrist at 94
   * degrees and the knife's at 168, i.e. the hand folded back onto its own
   * forearm. A wrist does ~70 of flexion and ~60 of extension at the very
   * extreme and a firing grip lives around 15-35, so anything past 40 is
   * penalised and it climbs steeply: 1 degree over budget costs the same as
   * 0.25 mm of fingertip gap, so 60 degrees of overbend outweighs any grip the
   * search could buy with it.
   */
  const WRIST_BUDGET = 40;
  const cost = (r) => {
    if (!r?.gaps) return 1e9;
    const contact = r.gaps.reduce(
      (s, g) => s + (g < -0.0015 ? (-g - 0.0015) * 8 : Math.abs(g - 0.0005)), 0);
    const over = Math.max(0, (r.wrist ?? 0) - WRIST_BUDGET);
    /**
     * OFF THE END OF THE GRIP IS NOT A GRIP. `onGrip` counts the fingertips
     * whose contact point lies within the handle's authored Z span; the radial
     * test alone is happy with a hand hanging in the air below the magwell, and
     * that is what the wrist-only version of this search produced. Each missing
     * finger costs 5 mm of gap, which no wrist improvement can outbid.
     */
    const off = 4 - (r.onGrip ?? 4);
    /**
     * PAST THE END OF THE ARM IS NOT A POSE. Over ~0.92 extension the two-bone
     * solve is nearly straight and at 0.995 it clamps and the elbow locks; the
     * wrist-aware search reached 1.011 on the carbine's support hand by walking
     * it 0.33 m down the barrel. Steep, because there is no trade here worth
     * making: 0.08 over budget already costs 20 mm of fingertip gap.
     */
    const reach = Math.max(0, (r.ext ?? 0) - 0.92);
    /**
     * THE HAND MUST NOT BE INSIDE THE GUN. The solve models one cylinder and
     * knows nothing about the slide, the frame or the receiver, so every search
     * before this one was free to thread the weapon through the palm — and did,
     * on the pistol, visibly. Weighted hard: 10 mm of total joint burial costs
     * as much as 20 mm of fingertip gap, because a hand inside the weapon is
     * never acceptable and a millimetre of gap often is.
     */
    /**
     * A BUDGET, not zero. Demanding zero was measured and is wrong: it drove the
     * carbine's wrist from 40 to 82 degrees and pushed a finger off the grip,
     * because a hand wrapped round a rifle grip legitimately has joints inside
     * the trigger guard's and the magwell's boxes. 20 mm of TOTAL burial across
     * fifteen joints is what a real grip scores; the pistol was at 72.6 mm and
     * the carbine at 97.9, which is a weapon threaded through the palm.
     */
    const pen = Math.max(0, (r.pen ?? 0) - 0.02);
    return contact + over * 0.00025 + off * 0.005 + reach * 0.25 + pen * 2;
  };

  for (const id of ONLY) {
    const w = vm.weapons.get(id);
    const left = SIDE === 'left';
    const refit = left ? (x, t) => vm.debugRefitLeft(x, t) : (x, t) => vm.debugRefitRight(x, t);
    const g0 = left ? w?.model?.nodes?.gripL : w?.model?.nodes?.gripR;
    const cylNode = left
      ? (w?.model?.nodes?.handguard ?? w?.model?.nodes?.supportCylinder)
      : w?.model?.nodes?.gripCylinder;
    if (!g0 || !cylNode) continue;
    const before = refit(w, {
      pos: g0.pos.slice(), finger: norm(g0.finger.slice()), back: norm(g0.back.slice()),
    });

    /**
     * MULTI-START, because coordinate descent from the authored pose gets
     * stuck. The knife's wrist was at 167 degrees — the hand folded back on its
     * own forearm — and descending from there only reached 155, since escaping
     * it needs the hand ORIENTATION to flip, and no single-axis step of 20
     * degrees improves the score on the way. Seeding from the authored finger
     * rotated a quarter and a half turn about each axis gives the search a start
     * on the far side of that ridge. The authored pose stays in the set, so this
     * can never do worse than the single-start version.
     */
    const seeds = [[norm(g0.finger.slice()), norm(g0.back.slice())]];
    for (const k of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
        seeds.push([norm(rot(g0.finger.slice(), k, a)), norm(rot(g0.back.slice(), k, a))]);
      }
    }

    let bestOverall = { cost: Infinity, pos: g0.pos.slice(), finger: seeds[0][0], back: seeds[0][1] };
    for (const [seedF, seedB] of seeds) {
    let pos = g0.pos.slice();
    let finger = seedF;
    let back = seedB;
    let best = cost(refit(w, { pos, finger, back }));

    // Coordinate descent. Positions in metres, angles in radians; the ranges
    // shrink each round so the first pass can travel and the last can polish.
    for (let round = 0; round < 5; round++) {
      const dp = [0.02, 0.01, 0.005, 0.0025, 0.001][round];
      const da = [0.35, 0.2, 0.1, 0.05, 0.025][round];
      for (let axis = 0; axis < 3; axis++) {
        for (const s of [-1, 1]) {
          for (let k = 1; k <= 4; k++) {
            const t = pos.slice();
            t[axis] += s * dp * k;
            const c = cost(refit(w, { pos: t, finger, back }));
            if (c < best - 1e-9) { best = c; pos = t; }
          }
        }
      }
      // Direction search: swing `finger` about each world axis, and roll `back`
      // about `finger` (which is the wrist roll — the thing that decides which
      // way the knuckles face).
      for (const k of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        for (const s of [-1, 1]) {
          for (let n = 1; n <= 4; n++) {
            const f = norm(rot(finger, k, s * da * n));
            const c = cost(refit(w, { pos, finger: f, back }));
            if (c < best - 1e-9) { best = c; finger = f; }
          }
        }
      }
      for (const s of [-1, 1]) {
        for (let n = 1; n <= 4; n++) {
          const b = norm(rot(back, finger, s * da * n));
          const c = cost(refit(w, { pos, finger, back: b }));
          if (c < best - 1e-9) { best = c; back = b; }
        }
      }
    }

      if (best < bestOverall.cost) bestOverall = { cost: best, pos, finger, back };
    }
    const { pos, finger, back } = bestOverall;
    const after = refit(w, { pos, finger, back });
    out.push({
      id,
      before: before?.gaps?.map((v) => +(v * 1000).toFixed(1)),
      after: after?.gaps?.map((v) => +(v * 1000).toFixed(1)),
      wristBefore: before?.wrist, wristAfter: after?.wrist,
      onBefore: before?.onGrip, onAfter: after?.onGrip,
      extBefore: before?.ext, extAfter: after?.ext,
      penBefore: before?.pen, penAfter: after?.pen,
      pos: pos.map((v) => +v.toFixed(4)),
      finger: finger.map((v) => +v.toFixed(4)),
      back: back.map((v) => +v.toFixed(4)),
    });
  }
  return out;
}, [ONLY, SIDE]);

for (const r of result) {
  const worst = (a) => Math.max(...a.map(Math.abs)).toFixed(1);
  console.log(`\n${r.id}`);
  console.log(`  tip gaps before (mm): [${r.before.join(', ')}]  worst ${worst(r.before)}   wrist ${r.wristBefore} deg   onGrip ${r.onBefore}/4   ext ${r.extBefore}   pen ${(r.penBefore*1000).toFixed(1)}mm`);
  console.log(`  tip gaps after  (mm): [${r.after.join(', ')}]  worst ${worst(r.after)}   wrist ${r.wristAfter} deg   onGrip ${r.onAfter}/4   ext ${r.extAfter}   pen ${(r.penAfter*1000).toFixed(1)}mm`);
  console.log(`      grip${SIDE === 'left' ? 'L' : 'R'}: {`);
  console.log(`        pos: [${r.pos.join(', ')}],`);
  console.log(`        finger: [${r.finger.join(', ')}],`);
  console.log(`        back: [${r.back.join(', ')}],`);
  console.log('      },');
}
if (errs.length) console.log('\n[gripfit] page errors:', errs.slice(0, 5));
await browser.close();
