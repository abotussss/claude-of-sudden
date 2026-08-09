import * as THREE from 'three';
import { forMap } from './geography.js';
import { mergeGeometries } from './airstrike.js';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE EMP AREAS — 「EMPエリアでドローンを無効化」
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Two domes of dead air on NACHTFELD. A drone that crosses one loses power in
 * the frame it enters: the rotors stop, the strobe and the halo go out, the
 * warhead is dead with it, and the airframe falls out of the sky and hits the
 * ground with a puff of dust and no bang.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 1. WHY "CUT POWER AND FALL" AND NOT THE OTHER TWO
 * ──────────────────────────────────────────────────────────────────────────
 * The three honest readings of "disabled" were: cut power and fall; hold
 * position and go dead; lose control and drift. The requirement they are being
 * judged against is that it must read as THE AREA DID THIS and not as MY DRONE
 * BROKE, from a man on the ground who did not fire a shot.
 *
 *   HOLD POSITION is the worst of the three. A drone hanging motionless at 22 m
 *   looks exactly like a drone loitering at 22 m, which is what they all do
 *   between locks. Nothing happened, visibly.
 *
 *   DRIFT is a slow read and an ambiguous one — a drone wandering off looks like
 *   a drone that lost its lock, which is a thing that already happens whenever
 *   anybody steps into a doorway.
 *
 *   FALLING IS UNMISTAKABLE and it is the only one of the three that ends on the
 *   ground where somebody is standing. What makes it read as the AREA rather
 *   than as a lucky rifle round is the pair of things that go with it:
 *
 *     THE WARHEAD DOES NOT FUNCTION. Every other end of a drone in this game
 *     goes off — the dive that connects, the wall it flies into, the life clock
 *     (`_scuttle`) and the round that kills it (`_takeRound`) are all
 *     `Drones._detonate`. This is the ONE silent death in the system, and
 *     silence after a fall is the tell: a drone somebody shot down explodes.
 *
 *     THE FIELD DISCHARGES. `discharge()` flashes the dome and its ground ring
 *     white at the moment the drone dies, so the thing that killed it is the
 *     thing that lit up. That is the whole sentence, said in the world rather
 *     than on the HUD.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 2. YOU SEE IT BEFORE IT COSTS YOU ANYTHING
 * ──────────────────────────────────────────────────────────────────────────
 * "An invisible region that eats your kit" is the failure this is written
 * against, so THE VOLUME THAT KILLS IS THE VOLUME THAT IS DRAWN, to the metre:
 * `bites()` is a sphere test against `r` about the pad centre and the dome is
 * `SphereGeometry(r, …)` about the same point. There is no generous inner
 * trigger and no invisible margin — what you can see is what is dead air.
 *
 * Three reads at three ranges, all of them procedural and none of them a HUD
 * element:
 *
 *   AT 200 m  the dome. 34 m of radius standing off a night sky, lit by its own
 *             rim rather than by the moon, so it is a silhouette from anywhere
 *             on the plain.
 *   AT 40 m   the fourteen posts on the rim. The dome is thinnest where it meets
 *             the ground — that is where its surface is edge-on to a man walking
 *             at it — and the posts are what put the BOUNDARY at eye level.
 *   AT 0.5 m  the lattice. @see `FIELD_FS`: three scales of procedural cell
 *             structure, a drifting grain and a vertical sweep, so the surface
 *             is never a flat wash of colour at any distance the player can put
 *             his face at. There is no texture and no asset anywhere in here.
 *
 * AND THE OTHER HALF OF "SEEING IT COSTS YOU NOTHING": IT HAS TO GET OUT OF THE
 * WAY. The first cut of this file passed the far read and failed the near one —
 * photographed at 4 m outside the rim, the dome was a green wall across two
 * thirds of the screen and the man on the ridge behind it was gone. A hazard
 * you can see from 200 m is worth nothing if walking up to it blinds you. @see
 * the `prox` block in `FIELD_FS`: inside about two and a half radii the RIM is
 * spent down to an eighth and what is left is the lattice, which is a membrane
 * rather than a pane. The ground band keeps its full weight throughout, because
 * that is the read a man standing in one actually needs.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 3. THE COLOUR IS NOBODY'S, DELIBERATELY
 * ──────────────────────────────────────────────────────────────────────────
 * `src/match/drone.js` paints every drone RELATIVE TO `RULES.playerTeam` and
 * says at length why (painting by team index has shipped the wrong colour twice
 * in this project). An EMP field is the other case: it is not an objective and
 * it is not a threat that belongs to a side — it kills both sides' drones on
 * identical terms — so it must not wear either the friend hex or the enemy hex,
 * or it reads as somebody's installation. `EMP_HEX` is a green-white that is
 * neither `HALO_FRIEND` (0x8fc8ff) nor `HALO_ENEMY` (0xff7a63) nor any zone
 * colour, and it is a literal here for the same reason those are: `src/match`
 * may not import `src/ui`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 4. WHERE THEY ARE — TWENTY OF THEM, AND THE SIZE IS DECIDED BY ONE NUMBER
 * ──────────────────────────────────────────────────────────────────────────
 * 「EMPドームはもっと小さいのを至る所に設置して」.
 *
 * It was two fields, each derived from a capture pad's own `r1`, i.e. 34 m at
 * zone A and 34 m at zone B. That was two places on a 350 m plain, and both of
 * them were a capture point — so the only drone-proof ground on the map was
 * ground you had to be fighting over to stand on.
 *
 * IT IS TWENTY NOW, IN TEN PAIRS THROUGH THE ORIGIN, and the pairing is the
 * plain's own symmetry rather than a preference: `PLAINS_RUNS` in `bomber.js`
 * spells out why ("a line biased at one base is a line that permanently taxes
 * one team"), and a field is a bigger favour than a bomb line. Every field has
 * its exact image, so the two sides get the same map.
 *
 *   11 084 m², 11.4 % of the r 176 disc, against 7 263 m² and 7.5 % in two.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THERE ARE THREE SIZES AND NOT ONE — `RULES.droneAltitude` IS 22
 * ────────────────────────────────────────────────────────────────────────────
 * The volume that kills is the volume that is drawn (@see section 2, which is
 * not negotiable), and what is drawn is a HEMISPHERE. So a field of radius r
 * has its crown r metres over the pad, and a drone cruising at
 * `RULES.droneAltitude` = 22 m flies straight over anything under 22.
 *
 * That is the whole cost of 「小さいの」 and it has to be paid explicitly rather
 * than discovered: a map of nothing but 10 m domes would take a drone that
 * DIVES at a man standing in one and would never once take a drone that was
 * merely passing — and "a hazard nobody ever sees work is a hazard nobody
 * believes in" is this file's own sentence about the other half of the same
 * balance. So the set is graded:
 *
 *   r 24  x2   the only pair whose crown clears the cruise lane, sited on the
 *              widest open ground either side of the centre. These are the
 *              fields a drone flies INTO.
 *   r 14  x6   the shoulder fields — a dive into one is dead, and a drone that
 *              descends to lock is inside the top of one.
 *   r 10  x12  the pockets: two hundred and thirty metres of frontage between
 *              them, sixteen of the twenty within reach of a fight.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT DECIDES WHERE ONE MAY GO, MEASURED RATHER THAN ASSERTED
 * ────────────────────────────────────────────────────────────────────────────
 * THE TRENCH NETWORK CONSTRAINS THEM, AND IT IS THE BINDING CONSTRAINT.
 * `plains-trench.js` cuts 999 m over 44 bays and states its own coverage —
 * "within 25 m of a cut, whole disc 79.4 %" — so a rule that keeps a whole dome
 * off every cut leaves 8.3 % of the map eligible at r 8 and ONE lattice cell at
 * r 26. Measured on the 2 m lattice this table was searched on. Every centre
 * below is therefore held 14 m off the nearest centreline — nobody's fire bay
 * is under the middle of a shell, where the shell is highest over his head —
 * and the four that still take a length of cut inside their rim are the poses
 * section 2's lid measurement is re-taken at, because a camera BELOW the
 * surrounding ground is the case that cost this file two fixes.
 *
 * THE BOMBING RULES DO NOT CONSTRAIN THEM, and that is worth stating rather
 * than leaving unsaid. `bomber.js`' eight runs, `airstrike.js`' salvos,
 * `skyfall.js`' five drone craters and the mountain battery all resolve their
 * impacts against `MASK.WORLD` and their clearances against capture radii and
 * spawn pads; a field is `transparent`, `depthWrite: false`, has no collider,
 * no nav cell and no entry in any keep-out — a bomb passes through one without
 * knowing it was there. The one place a bombing rule and a field DO meet is
 * `skyfall.js`' burning region, which denies 8 546 m² of the west for 260 s,
 * and no centre is inside 30 m of that plough's spine: a drone-proof pocket in
 * ground nobody may stand on is a pocket that does not exist.
 *
 * AND THEY ARE OFF THE CAPTURE CIRCLES' WALKABLE GROUND. Every centre clears
 * `radius 14` plus its own rim plus 8 m, so no field touches a point a side is
 * standing on to score. The argument for that is the one the old placement got
 * wrong: A and B WERE the fields, so holding a point and being drone-proof were
 * the same act, and a side that took A was also destroying its own drones on
 * the rail (@see `Drones._clearOfDeadAir`, 7 of 20). Twenty pockets that are
 * near the fighting and not on it is the counter-play without the coupling.
 *
 * THE SELECTOR IS `world.level.id` through `forMap`, which is the rule
 * `src/match/geography.js` exists to state — no entry in `MAP_RULES`, no line
 * in `MatchSystem`, no second parse of `?map=`.
 *
 * THE TOWN GETS NONE, and that is a decision rather than an omission. The town
 * is the map the player actually plays; its counter-play to a drone is already
 * authored and already measured (「one second out of its sight drops the lock —
 * the eight enterable buildings and every alley on this map are all inside that
 * second」), and dropping domes into a street plan he knows would be a change to
 * a working map that nobody asked for. The plain is the map with no roofs, and
 * it is the map that needed this.
 */

/** Green-white. NOT the friend hex and NOT the enemy hex. @see the header. */
const EMP_HEX = 0x7dffd6;

/**
 * THE FIELDS, in world space (which on this map is level space — @see
 * `geography.js`). Ten pairs; each entry's image through the origin is built
 * with it, so the table says half of what is on the map and cannot go
 * asymmetric by editing.
 *
 * Searched, not composed, on a 2 m lattice against the four constraints in the
 * header — 14 m off every trench centreline, off every capture circle, off both
 * base pads and both works, and clear of the plough's spine — taking the site
 * that maximised distance from everything already placed, with the middle third
 * weighted (the same trick `plains-trench.js` used for the same reason: the
 * fight is in the middle). `cut` is the distance from the nearer of the pair to
 * the nearest trench centreline, in metres, and it is the number to look at
 * first if this table is ever moved.
 */
const PLAINS_FIELDS = [
  { x: -70, z: -54, r: 24 },   // cut 36.2 / 14.0 · |r| 88 — the centre-west pair
  { x: 70, z: -128, r: 14 },   // cut 20.3 / 19.0 · |r| 146
  { x: 52, z: -52, r: 14 },    // cut 14.4 / 14.1 · |r| 74
  { x: -8, z: -94, r: 14 },    // cut 20.4 / 18.3 · |r| 94
  { x: 126, z: -28, r: 10 },   // cut 18.5 / 14.4 · |r| 129
  { x: 32, z: 0, r: 10 },      // cut 29.2 / 15.7 · |r| 32 — 18 m off D's circle
  { x: 102, z: -80, r: 10 },   // cut 23.4 / 28.4 · |r| 130
  { x: -128, z: -22, r: 10 },  // cut 14.9 / 15.7 · |r| 130
  { x: -54, z: -112, r: 10 },  // cut 14.2 / 14.2 · |r| 124
  { x: 32, z: -146, r: 10 },   // cut 24.0 / 21.0 · |r| 149
];

/** @see `forMap` — an unknown map gets nothing, which is the town's answer. */
const FIELDS = { plains: PLAINS_FIELDS, town: [] };

/** Posts around the rim: the boundary at eye level. */
const POSTS = 14;
/**
 * A POST IS A FRACTION OF ITS OWN FIELD, not a constant. 11.5 m of post on a
 * 34 m dome was 0.34 of the radius; the same fraction on a 10 m dome is 3.4 m,
 * which is still over an eye and is what the posts are for. A constant 11.5
 * would have stood a fence taller than the dome it marks.
 */
const POST_F = 0.34;
/** Seconds a discharge flash takes to fall away. */
const FLASH_FALL = 0.9;

/* ─────────────────────────────────────────────────────────── the shaders ── */
/**
 * One vertex program for all three meshes. It hands the fragment stage the
 * WORLD position and the WORLD normal and nothing else — every scale of detail
 * below is a function of where the surface is in the world, so the dome, the
 * posts and the ground ring share one continuous field instead of each carrying
 * its own unrelated pattern.
 */
const FIELD_VS = /* glsl */ `
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/**
 * THE DETAIL LAYER, AND IT IS WHAT KEEPS THIS OFF THE "FLAT UNTEXTURED SURFACE"
 * LIST. Four terms, deliberately at four different scales so the surface has
 * something in it at 200 m, at 40 m, at 2 m and at 0.5 m:
 *
 *   CELLS      three triangle waves on three rotated axes, min'd together — a
 *              honeycomb lattice for the price of nine `fract`s and no texture.
 *              Struck twice, at 0.42 m and at 3.1 m, so walking up to it reveals
 *              structure inside structure rather than the same cell magnified.
 *   GRAIN      two octaves of value noise drifting on `uT`, which is what stops
 *              the lattice reading as a decal pinned to the geometry.
 *   SWEEP      a slow vertical scan. The one term that is not view-dependent, so
 *              it is the thing that says "powered" from a fixed camera.
 *   FRESNEL    `1 - |N·V|`, which is why the dome is a bright RIM and a faint
 *              wall: a translucent shell shaded flat looks like a bubble of
 *              paint, and the rim is what makes it read as a volume you are
 *              outside of, or (from within) inside of.
 *
 * AND IT IS HELD DOWN AT BOTH ENDS OF THE RANGE. `uFar` fades it toward a third
 * of its strength past 90 m — the night sky on this map is metered off the
 * ground the player is standing on, and `src/world/levels/plains.js` records
 * what happened the last time something bright stood past the fog: the
 * auto-exposure took the plain to black. `uNear` fades it out inside 4 m so a
 * man standing with his face in the dome can still see the man shooting at him.
 */
const FIELD_FS = /* glsl */ `
  precision highp float;
  varying vec3 vW;
  varying vec3 vN;
  uniform float uT;
  uniform float uFlash;
  uniform vec3 uColor;
  uniform vec3 uCentre;
  uniform float uGround;
  uniform float uR;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash(i);
    float n100 = hash(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z);
  }
  /** A honeycomb from three rotated triangle waves. */
  float cells(vec3 p, float k) {
    vec3 q = p * k;
    float a = abs(fract(q.x * 0.866 + q.z * 0.5) - 0.5);
    float b = abs(fract(q.x * 0.866 - q.z * 0.5) - 0.5);
    float c = abs(fract(q.z + q.y * 0.28) - 0.5);
    return min(a, min(b, c));
  }

  void main() {
    vec3 V = normalize(cameraPosition - vW);
    float d = length(cameraPosition - vW);
    float fres = pow(1.0 - abs(dot(normalize(vN), V)), 2.1);

    float lat = 1.0 - smoothstep(0.0, 0.055, cells(vW, 1.0 / 3.1));
    float fine = 1.0 - smoothstep(0.0, 0.10, cells(vW + vec3(11.0, 0.0, 7.0), 1.0 / 0.42));
    float grain = vnoise(vW * 0.35 + vec3(0.0, uT * 0.55, 0.0)) * 0.65
                + vnoise(vW * 1.4 - vec3(uT * 0.3, 0.0, uT * 0.2)) * 0.35;
    float h = vW.y - uCentre.y;
    float sweep = 0.5 + 0.5 * sin(h * 1.15 - uT * 2.2);

    // ══════════════════════════════════════════════════════════════════════
    // HOW CLOSE THE MAN IS TO THE FIELD, IN RADII — and it is the term that
    // makes this survivable to stand near.
    // ══════════════════════════════════════════════════════════════════════
    // PHOTOGRAPHED -- shots/emp-A-boundary.png, before this line: standing 4 m
    // outside the rim, the dome was a GREEN WALL across two thirds of the
    // screen -- the ridge fires, the skyline and any man on it washed out
    // behind it. The header claimed this had been budgeted for and it had not.
    //
    // WHY IT HAPPENS, AND WHY THE EXISTING GUARDS DO NOT CATCH IT. uNear
    // fades the surface within 4 m OF THE CAMERA, which handles the metre of
    // shell you have your face in. It cannot touch the problem, which is the
    // FAR wall: from the rim the opposite side of the dome is 70 m away, edge
    // on, so fres is near 1 over an enormous slice of screen. A shell whose
    // alpha peaks at grazing incidence fills the view of anyone standing in
    // its own plane. That is inherent, and no per-fragment distance ramp
    // reaches it -- the fragments are far away, they are just everywhere.
    //
    // SO IT IS ANSWERED WITH THE ONE QUANTITY THAT ACTUALLY DESCRIBES THE
    // SITUATION: where the CAMERA is relative to the whole field. Outside two
    // and a half radii the dome subtends little enough screen that a bright rim
    // costs nothing and is the entire long-range read; at the rim and within,
    // the same rim is a wall. prox is 0 at the boundary and inward, 1 past
    // 2.6 r, and uR is the only new uniform in the file.
    float camR = length(cameraPosition.xz - uCentre.xz);
    float prox = smoothstep(uR, uR * 2.6, camR);

    // THE WEIGHTS ARE A READABILITY BUDGET, NOT A LOOK. A man standing INSIDE
    // one of these has to be able to fight in it -- the same mistake the plains
    // level records the far mountains making, where the auto-exposure metered on
    // them and the ground went black. So the lattice LINES carry the read and
    // the gaps between them are all but clear: 0.014 of base against 0.40 of
    // rim, and the RIM IS THE PART THAT IS SPENT AT RANGE. Up close it drops to
    // an eighth and the lattice is what is left, which is a membrane you can see
    // a man through rather than a pane of glass you cannot.
    float rim = mix(0.12, 1.0, prox);
    float a = 0.014
            + lat * 0.115
            + fine * 0.05 * (0.4 + 0.6 * grain)
            + fres * 0.40 * rim
            + sweep * 0.045 * (0.5 + 0.5 * grain);
    // The ground band is a mark on the floor rather than a shell in the air, so
    // it carries none of the fresnel and all of the lattice -- AND NONE OF THE
    // PROXIMITY FADE EITHER. It is the thing that tells a man standing in one
    // where the edge is, which is precisely the read he needs at the range the
    // shell has to get out of his way at.
    a = mix(a, 0.13 + lat * 0.20 + fine * 0.09 + sweep * 0.09, uGround);

    // ══════════════════════════════════════════════════════════════════════
    // AND IT IS NOT A LID — 「天井みたいな意味のわからないグラフィックが至る所」
    // ══════════════════════════════════════════════════════════════════════
    // Measured over the whole plain: of everything a player can have DRAWN
    // OVERHEAD and not explain, 84 % is these two shells — 2 835 m² at B and
    // 2 754 m² at A, 34 m of hemisphere resident from boot. Standing at A's
    // centre and looking level they are 18.4 % of the frame, which is the field
    // and is the point; looking UP they are a green wireframe ceiling over the
    // entire sky, which is nothing and is the complaint.
    //
    // The elevation of the fragment ABOVE THE CAMERA'S OWN HORIZON is the one
    // quantity that separates those two. Under ~15° it is the wall you walk at,
    // over ~37° it is the roof you cannot walk to. So the roof goes, and only
    // the roof, and only for the man who is close enough for it to be over him:
    // prox is 0 at the rim and inward and 1 past 2.6 r, so at a hundred metres
    // the dome is still a whole dome and still the long-range read the header
    // spends its rim budget on. (The GROUND BAND was excused entirely here, on
    // the grounds that it is the mark that tells a man standing inside where the
    // edge is. That exemption is withdrawn below — @see the next block.)
    //
    // WHAT THIS MUST NOT DO is make the field invisible from outside — "an
    // invisible region that eats your kit" is the failure this file was written
    // against. It cannot: the fourteen rim posts stand at ground level and are
    // therefore at ~0° from any eye outside, the band is not faded at all, and
    // past 2.6 r nothing here applies.
    vec3 D = vW - cameraPosition;
    float elev = D.y / max(0.001, length(D));
    float lid = 1.0 - smoothstep(0.26, 0.60, elev);

    // ══════════════════════════════════════════════════════════════════════
    // AN ANGLE IS NOT A CEILING. HEIGHT OVER THE HEAD IS.
    // ══════════════════════════════════════════════════════════════════════
    // The paragraph above was measured from a man STANDING ON THE PAD and it is
    // right for him. It is wrong for the man it was written for. Re-measured at
    // the real camera pose on the trench floor at (-140, -93), eye y -0.42,
    // 24.6 m from A's centre so prox is 0 and every fade here is at full
    // authority (_empwhy.mjs):
    //
    //   emp-shell  997 of 1225 vertices over the eye   alpha peaks 0.136
    //   emp-post   8 of 16 on three of the fourteen    alpha peaks 0.136
    //   emp-band   40 of 256                           alpha 0.51, FLAT
    //
    // and the peak is at elev 0.26-0.30 EVERY TIME -- the bottom of the ramp
    // above, where lid is 1 and this code believes it is looking at a wall. It
    // is not. At 53 m, 15 deg of elevation is 13.8 m of shell OVER HIS HEAD; the
    // band that reads 0.51 is 6.5 m over it at 22 m. A 34 m shell is big enough
    // that its low-elevation band is a roof, and a man standing in a cut sees
    // the sky through a SLOT -- the only part of the field he can see at all is
    // the part this test was excusing.
    //
    // So the test gains the quantity the angle cannot express: how far over his
    // head the fragment actually is, in metres. Both must hold for the surface
    // to be kept -- near his horizon AND not stacked above him.
    float rise = D.y;
    float over = 1.0 - smoothstep(1.2, 4.5, rise);
    float keep = min(lid, over);

    float uFar = mix(1.0, 0.34, smoothstep(90.0, 300.0, d));
    float uNear = smoothstep(0.5, 4.0, d);
    a *= uFar * mix(uNear * mix(0.5, 1.0, prox), 1.0, uGround);
    // AND THE BAND LOSES ITS BLANKET EXEMPTION, because the sentence that earned
    // it -- "it is the mark that tells a man standing inside where the edge is"
    // -- is a statement about a man standing ON the floor it is drawn on. Two
    // metres down in a cut it is not his floor, it is a green ribbon in his sky,
    // and it was the brightest thing in the frame. over is 1 wherever the band
    // is at or below head height, so nothing moves for the man it was for.
    a *= mix(keep, 1.0, prox);

    // AND THE BAND IS EXCUSED THE FRESNEL IN THE COLOUR TOO, which was the other
    // half of the same oversight: the alpha above already excludes it, but the
    // brightness did not, and a flat ring seen from 4 m is edge-on everywhere it
    // is not underfoot -- so fres ~ 1 across the whole thing and it came out at
    // 2.1x the base colour, a white glare lying across the lower screen. It is a
    // mark on the floor. A mark on the floor is not a rim.
    vec3 col = uColor * (0.45 + 0.75 * (lat + fine * 0.5) + fres * 0.9 * (1.0 - uGround));
    // The discharge: the whole surface goes to white and then falls away.
    col = mix(col, vec3(1.6, 1.9, 1.75), uFlash * 0.85);
    a = clamp(a + uFlash * 0.55, 0.0, 0.95);

    gl_FragColor = vec4(col, a);
  }
`;

/** One field. Everything about it is derived; nothing here is authored twice. */
class Zone {
  constructor(id, x, y, z, r) {
    this.id = id;
    /** Centre, at the ground. The dome is a hemisphere of `r` about this. */
    this.position = new THREE.Vector3(x, y, z);
    this.r = r;
    this.r2 = r * r;
    /**
     * How far outside the rim a CRUISING drone is steered. @see `deflect`.
     * A fraction of the field rather than a constant 8 m: twenty fields at a
     * flat 8 turned 28.5 % of the plain into ground no drone would fly over,
     * where two of them made it 9.5 %. The margin is "do not blunder into it",
     * and what counts as blundering scales with the size of the thing.
     */
    this.margin = Math.max(3, r * 0.34);
    /** Discharge, 1 at the flash and 0 at rest. */
    this.flash = 0;
    /** Drones this field has killed. Measurement only. */
    this.kills = 0;
    this.mat = null;
    this.ringMat = null;
    this.group = null;
  }
}

export class EmpZones {
  constructor(ctx) {
    this.ctx = ctx;
    this.ready = false;
    /** @type {Zone[]} — empty on every map that has no pads for it. */
    this.zones = [];
    this.group = new THREE.Group();
    this.group.name = 'match-emp';
    this._geo = [];
    this._mat = [];
    this._t = 0;
    /* scratch — nothing below allocates */
    this._v = new THREE.Vector3();
  }

  /**
   * Read the level, place a field on each named pad, build the three meshes.
   * A map with no matching pads builds nothing and every query below is a
   * cheap `false` — @see the header for why the town is that map.
   */
  build() {
    const world = this.ctx.peek('world');
    /**
     * TEN AUTHORED PAIRS -> TWENTY FIELDS. The mirror is built here rather than
     * written down, so the table cannot go asymmetric by somebody editing one
     * line of it. @see `PLAINS_FIELDS`.
     */
    const table = forMap(FIELDS, world, 'EMP fields');
    const spec = [];
    for (let i = 0; i < table.length; i++) {
      const f = table[i];
      spec.push({ id: `${i + 1}N`, x: f.x, z: f.z, r: f.r });
      spec.push({ id: `${i + 1}S`, x: -f.x, z: -f.z, r: f.r });
    }
    if (!spec.length) { this.ready = true; return this; }

    const dome = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.5);
    /** Unit height, scaled per field — @see `POST_F`. */
    const post = new THREE.CylinderGeometry(0.26, 0.85, 1, 7, 1, true);
    this._geo.push(dome, post);

    for (const f of spec) {
      const y = world.groundHeight ? world.groundHeight(f.x, f.z) : 0;
      const r = f.r;
      const z = new Zone(f.id, f.x, y, f.z, r);

      const mk = (ground) => {
        const m = new THREE.ShaderMaterial({
          uniforms: {
            uT: { value: 0 },
            uFlash: { value: 0 },
            uColor: { value: new THREE.Color(EMP_HEX) },
            uCentre: { value: z.position.clone() },
            uGround: { value: ground },
            /** The field's own radius, so `prox` is in radii. Never written again. */
            uR: { value: r },
          },
          vertexShader: FIELD_VS,
          fragmentShader: FIELD_FS,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        this._mat.push(m);
        return m;
      };
      z.mat = mk(0);
      z.ringMat = mk(1);

      const g = new THREE.Group();
      g.name = `emp-${f.id}`;
      const shell = new THREE.Mesh(dome, z.mat);
      /**
       * NAMED, AND THE NAMES ARE A MEASUREMENT TOOL. The shell, the fourteen
       * posts and the ground band are three different surfaces with three
       * different jobs and three different fade budgets; unnamed they all report
       * as `match-emp/emp-A/<Mesh>` and a ceiling census cannot say which of them
       * is over the trench. It cost a full run to find out that the band was.
       */
      shell.name = 'emp-shell';
      shell.position.copy(z.position);
      shell.scale.setScalar(r);
      // A transparent shell is not a shadow caster and is not depth-prepass mass.
      shell.userData.owNoShadow = true;
      shell.userData.owNoPrepass = true;
      shell.renderOrder = 6;
      g.add(shell);

      /**
       * THE POSTS, ON THE RIM AND ON THE GROUND UNDER IT. Their feet are put at
       * `world.groundHeight` rather than at the pad datum, because the field's
       * radius is the pad's OUTER blend and the swell has come back by then — a
       * post placed at the centre's height would stand 1-2 m in the air on one
       * bearing and be buried on another.
       *
       * ONE MESH FOR ALL FOURTEEN, AND THAT IS A DRAW-CALL FACT RATHER THAN
       * TIDINESS. Two fields at 16 meshes each was 32 draws; twenty would be
       * 320 on a map that renders 960 in total, i.e. a third more of them for
       * scenery that is `depthWrite: false` and sorted. Merging is free here
       * because `FIELD_VS` hands the fragment stage the WORLD position (@see its
       * own note) — the pattern is a function of where the surface IS, so
       * fourteen posts baked into one static geometry look exactly like
       * fourteen posts with fourteen matrices. It is 3 draws a field now.
       */
      const postH = r * POST_F;
      const parts = [];
      for (let i = 0; i < POSTS; i++) {
        const a = (i / POSTS) * Math.PI * 2;
        const px = z.position.x + Math.cos(a) * r;
        const pz = z.position.z + Math.sin(a) * r;
        const py = world.groundHeight ? world.groundHeight(px, pz) : z.position.y;
        const q = post.clone();
        q.scale(1, postH, 1);
        q.translate(px, py + postH * 0.5 - 0.4, pz);
        parts.push(q);
      }
      const postGeo = mergeGeometries(parts);
      for (const q of parts) q.dispose();
      this._geo.push(postGeo);
      const posts = new THREE.Mesh(postGeo, z.mat);
      posts.name = 'emp-post';
      posts.userData.owNoShadow = true;
      posts.userData.owNoPrepass = true;
      posts.renderOrder = 6;
      g.add(posts);

      const band = this._ringGeometry(world, z);
      this._geo.push(band);
      const ring = new THREE.Mesh(band, z.ringMat);
      ring.name = 'emp-band';
      ring.userData.owNoShadow = true;
      ring.userData.owNoPrepass = true;
      ring.renderOrder = 5;
      g.add(ring);

      z.group = g;
      this.group.add(g);
      this.zones.push(z);
    }

    if (this.zones.length) {
      this.ctx.scene.add(this.group);
      let area = 0;
      for (const z of this.zones) area += Math.PI * z.r * z.r;
      console.info(
        `[match] EMP: ${this.zones.length} field(s), ${area.toFixed(0)} m2 — ` +
          this.zones.map((z) => `${z.id}r${z.r.toFixed(0)}@(${z.position.x.toFixed(0)},${z.position.z.toFixed(0)})`).join(' ')
      );
    }
    this.ready = true;
    return this;
  }

  /**
   * The band on the floor, laid ON the swell: two rings of vertices at r ± 1.7
   * with every Y taken from `world.groundHeight`, so it follows the ground
   * instead of clipping through it the way a flat disc would. 128 segments over
   * a 214 m circumference is a 1.7 m chord, which is inside the terrain mesh's
   * own 3.18 m quads — it cannot bridge a feature the ground has.
   */
  _ringGeometry(world, z) {
    /**
     * …AND BOTH OF THESE ARE FRACTIONS OF THE FIELD NOW. 128 segments and a
     * ±1.7 m band were a 1.7 m chord and a 10 % ribbon on a 34 m circle; on a
     * 10 m one they would be a 0.5 m chord (two and a half times the vertices
     * this needs) and a ribbon a THIRD of the radius wide, which is a disc with
     * a hole in it rather than a mark on the floor. Held to a chord no coarser
     * than 1.7 m — the number the original was chosen for, against the terrain
     * mesh's own 3.18 m quads — and a band no wider than the original's.
     */
    const N = Math.max(40, Math.min(128, Math.round((Math.PI * 2 * z.r) / 1.7)));
    const half = Math.max(0.75, Math.min(1.7, z.r * 0.09));
    const pos = new Float32Array(N * 2 * 3);
    const nor = new Float32Array(N * 2 * 3);
    const idx = new Uint16Array(N * 6);
    const gy = (x, zz) => (world.groundHeight ? world.groundHeight(x, zz) : z.position.y);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const cx = Math.cos(a), cz = Math.sin(a);
      for (let k = 0; k < 2; k++) {
        const rr = z.r + (k === 0 ? -half : half);
        const x = z.position.x + cx * rr;
        const zz = z.position.z + cz * rr;
        const o = (i * 2 + k) * 3;
        pos[o] = x;
        pos[o + 1] = gy(x, zz) + 0.09;
        pos[o + 2] = zz;
        nor[o] = 0; nor[o + 1] = 1; nor[o + 2] = 0;
      }
      const j = (i + 1) % N;
      const a0 = i * 2, a1 = i * 2 + 1, b0 = j * 2, b1 = j * 2 + 1;
      const o = i * 6;
      idx[o] = a0; idx[o + 1] = b0; idx[o + 2] = a1;
      idx[o + 3] = a1; idx[o + 4] = b0; idx[o + 5] = b1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  }

  /* ==================================================================== */
  /* the queries — the whole of what `drone.js` asks this file             */
  /* ==================================================================== */

  /**
   * IS THIS POINT IN DEAD AIR? The same sphere the dome is drawn as, to the
   * metre. @see the header: there is no invisible margin anywhere in here.
   */
  bites(p) {
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      const dx = p.x - z.position.x;
      const dz = p.z - z.position.z;
      // Below the pad is still inside the hemisphere; above the crown is not.
      const dy = Math.max(0, p.y - z.position.y);
      if (dx * dx + dy * dy + dz * dz < z.r2) return z;
    }
    return null;
  }

  /**
   * PUSH A CRUISING DRONE'S WAYPOINT OUT OF A FIELD — the flight is meant to
   * read as a hazard the operators know about, not as twenty drones queueing up
   * to fly into a wall. `drone.js` applies this in `climb` / `hunt` / `recover`
   * ONLY: a committed dive is committed, which is what makes standing inside one
   * of these a real defence rather than a trivia.
   *
   * Radial, to the rim plus a margin, and it mutates `want` in place. A drone
   * steering at a point on the rim orbits the field, which is the behaviour
   * wanted — it stays over the fight it is meant to be over.
   */
  deflect(from, want, margin = 0) {
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      const R = z.r + (margin || z.margin);
      const dx = want.x - z.position.x;
      const dz = want.z - z.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-3) {
        // Dead centre: push it away from where the drone actually is, so two
        // drones on opposite sides do not both get sent through the middle.
        const ax = from.x - z.position.x;
        const az = from.z - z.position.z;
        const al = Math.hypot(ax, az) || 1;
        want.x = z.position.x + (ax / al) * R;
        want.z = z.position.z + (az / al) * R;
      } else {
        want.x = z.position.x + (dx / d) * R;
        want.z = z.position.z + (dz / d) * R;
      }
    }
  }

  /** The field just took something. Flash it. @see the header. */
  discharge(zone) {
    if (!zone) return;
    zone.flash = 1;
    zone.kills++;
  }

  /* ==================================================================== */

  /** Two uniform writes per zone. Nothing here allocates. */
  update(dt) {
    if (!this.zones.length) return;
    this._t += dt;
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      if (z.flash > 0) z.flash = Math.max(0, z.flash - dt / FLASH_FALL);
      z.mat.uniforms.uT.value = this._t;
      z.ringMat.uniforms.uT.value = this._t;
      // Squared, so the flash is a hard strike and a soft tail rather than a
      // linear ramp that reads as a fade-in.
      const f = z.flash * z.flash;
      z.mat.uniforms.uFlash.value = f;
      z.ringMat.uniforms.uFlash.value = f;
    }
  }

  reset() {
    for (const z of this.zones) { z.flash = 0; z.kills = 0; }
  }

  dispose() {
    this.group.removeFromParent();
    for (const g of this._geo) g.dispose();
    this._geo.length = 0;
    for (const m of this._mat) m.dispose();
    this._mat.length = 0;
    this.zones.length = 0;
    this.ready = false;
  }
}
