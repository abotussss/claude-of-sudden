/**
 * AI — soldier assembly. Turns the part library into a finished, skinned,
 * material-grouped character. One geometry per visual variant, shared by every
 * instance of that variant; only the skeleton is per-instance.
 */

import * as THREE from 'three';
import { RIG, GRIP_R, GRIP_L, BORE_DIR } from './rig.js';
import { CharacterBuilder, Noise, appendMesh, computeNormals, emptyMesh } from './geo.js';
import * as P from './parts.js';
import { buildWeapon } from './weapon.js';
import { CLOTH_TILE } from './textures.js';

/**
 * Metres of surface per texture tile. `cloth` is deliberately large: it is the
 * tile that has to carry the 0.2-0.4 m camo macro blotches, and the 1.5 mm weave
 * it can no longer resolve is supplied by the shader detail layer instead.
 */
const MATERIALS = {
  cloth: { tile: CLOTH_TILE },
  plate: { tile: 0.42 },
  gear: { tile: 0.26 },
  // Boots and gloves share the cordura bake with the pouches but NOT its
  // roughness: leather-and-rubber footwear is markedly smoother than webbing,
  // and having the whole kit sit at one gloss is half of why the figure reads as
  // one extruded blob. Own material name -> own geometry group -> own roughness.
  boot: { tile: 0.26 },
  skin: { tile: 0.20 },
  polymer: { tile: 0.15 },
  steel: { tile: 0.18 },
  rubber: { tile: 0.11 },
  glass: { tile: 1.0 },
};

/**
 * Roughness multiplier per material set, applied on top of the baked roughness
 * map so the *relative* variation the bake carries is preserved.
 *
 *   cloth 0.85   matte ripstop, map averages 0.905
 *   plate 0.55   laminate over foam, map averages 0.62
 *   boot  0.70   waxed leather / rubber, cordura map averages 0.79
 *
 * These three are the values the silhouette needs: at 25 m the only thing that
 * separates a plate carrier from the jacket under it is the width of its
 * specular lobe.
 */
const ROUGH = { cloth: 0.85 / 0.905, plate: 0.55 / 0.62, boot: 0.7 / 0.79 };

/** Detail tile size in metres — must match `bakeDetail` in textures.js. */
const DETAIL_TILE = 0.05;

/**
 * ALBEDO BUDGET (linear, after the vertex tint multiplies the map)
 *
 * MEASURED, not asserted — `node src/ai/selftest.mjs` prints this table from the
 * geometry and the real bakes, and `SoldierMaterials` prints the cloth map's mean
 * and range at boot. Current values:
 *
 *   uniform cloth      0.092-0.094   map mean 0.104, every texel in 0.040-0.152
 *   helmet cover       0.064         deliberately off the uniform value
 *   mag/admin pouches  0.058-0.076
 *   knee + elbow pads  0.057-0.063
 *   carrier            0.047         laminate, and smoother than the cloth
 *   webbing / sling    0.051-0.054
 *   boots              0.032
 *   gloves             0.032-0.048
 *   skin               0.152-0.190
 *
 * Real desert multicam is 0.18-0.32 and that is what this used to target, but the
 * environment it stands in currently behaves like 0.05-0.09 albedo on screen
 * (see the measurement table in textures.js), so a physically-honest uniform
 * rendered brighter than sunlit plaster and read as a white mannequin. The whole
 * kit is therefore scaled by one documented constant, `KIT_CAL`, which keeps the
 * *hierarchy* — cloth brightest, pouches under it, carrier under that, boots and
 * gloves darkest — because that internal value structure is what breaks the "one
 * extruded blob" read at 25 m. Raise `CLOTH_BUDGET.mean` and `KIT_CAL` together
 * if the world's albedo is ever brought up to physical values.
 */
const GEAR = {
  webbing: [0.70, 0.70, 0.70],
  sling: [0.70, 0.70, 0.70],
  pouch: [0.84, 0.84, 0.84],
  pouchAlt: [0.76, 0.76, 0.76],
  dump: [0.72, 0.72, 0.72],
  belt: [0.62, 0.61, 0.57],
  pad: [0.55, 0.55, 0.55],
  strap: [0.56, 0.56, 0.56],
  wrap: [0.56, 0.54, 0.50],
  glove: [0.38, 0.372, 0.363],
  boot: [0.22, 0.209, 0.198],
  lace: [0.21, 0.204, 0.198],
  // A hard ballistic mask is moulded polymer, not webbing: near-black with a
  // clean sheen, which is what makes the lower face read as a mask at 35 m
  // instead of another patch of tan cloth.
  mask: [0.62, 0.63, 0.66],
};

/**
 * Visual variants. Each is a different silhouette, not a recolour: helmet vs
 * wrapped head, full plate vs chest rig, carbine vs long rifle.
 *
 * The three tints are hue shifts at roughly unit luminance — value is set per
 * part by the table above, so a variant can change colour family without
 * dragging every piece of its kit out of the albedo budget.
 */
export const VARIANTS = {
  vanguard: {
    camo: 'arid',
    clothTint: [1.03, 1.0, 0.94],
    gearTint: [1.08, 0.98, 0.80], // coyote brown
    plateTint: [1.02, 0.96, 0.84],
    skinTint: [1.0, 0.94, 0.88],
    helmet: true,
    helmetCover: true,
    helmetTint: [0.72, 0.72, 0.68],
    goggles: true,
    gogglesDown: true,
    faceWrap: true,
    beard: false,
    kneePads: true,
    fullCarrier: true,
    weapon: 'carbine',
    bulk: 1.0,
    scale: 1.0,
  },
  irregular: {
    camo: 'woodland',
    clothTint: [0.98, 1.02, 0.94],
    gearTint: [0.92, 0.96, 0.74], // olive drab
    plateTint: [0.90, 0.94, 0.80],
    skinTint: [0.86, 0.80, 0.74],
    helmet: false,
    headWrap: true,
    goggles: false,
    // dark wrap-around shooting glasses: the bare head needs a hard horizontal
    // dark band at the eye line or it is a featureless egg at 35 m
    shades: true,
    faceWrap: true,
    beard: true,
    kneePads: false,
    fullCarrier: false,
    weapon: 'ak',
    bulk: 0.94,
    scale: 0.985,
  },
  breacher: {
    camo: 'urban',
    clothTint: [0.98, 0.99, 1.02],
    gearTint: [0.84, 0.86, 0.90], // wolf grey
    plateTint: [0.86, 0.88, 0.92],
    skinTint: [1.06, 0.98, 0.92],
    helmet: true,
    helmetCover: false, // bare painted shell instead of a cloth cover
    helmetTint: [0.82, 0.83, 0.86],
    // goggles parked on the shell (not over the eyes like vanguard) plus a hard
    // ballistic half-mask: same helmet family, completely different head read
    goggles: true,
    gogglesDown: false,
    faceWrap: true,
    maskHard: true,
    beard: true,
    kneePads: true,
    fullCarrier: true,
    weapon: 'carbine',
    bulk: 1.06,
    scale: 1.025,
  },
};

/**
 * ════════════════════════════════════════════════════════════════════════════
 * AND THE TEN WHO FALL OUT OF THE HELICOPTER — 「増援の精鋭はもっと赤色を赤黒くして
 * 強そうにして」
 * ════════════════════════════════════════════════════════════════════════════
 * DERIVED, exactly as `<dress>Dmr` and the two civilians are, and off EVERY
 * dress rather than off the enemy's one. That is not generality for its own
 * sake: `TEAM_VARIANTS` is `match`'s table and the drop's recipient is
 * `1 - RULES.playerTeam`, so hard-coding `irregular` here would be the same
 * PAINT-BY-INDEX mistake the header over `TEAM_DRESS` records shipping twice.
 * A spearhead of MY side wearing MY dress is what deriving guarantees, and it
 * costs one extra key per dress that no match on this map ever builds
 * (`AiSystem.variant` is lazy — only the geometry actually spawned is baked).
 *
 * IT IS THE CIVILIAN GATE RUN BACKWARDS. `civil: true` DELETES the carrier, the
 * pouches, the pads and the gloves, because a man in his own clothes is defined
 * by what he is not carrying; the spearhead is defined by what he is, so every
 * line below ADDS:
 *
 *   THE THIRD MAGAZINE POUCH   `fullCarrier`, which is the widest thing on the
 *                              chest and the one that survives 27 px.
 *   THE KNEE PADS              `kneePads`, hard cups on the shins.
 *   A HARD BALLISTIC MASK      `maskHard`. The wrap becomes moulded polymer at
 *                              `GEAR.mask` — near-black with a sheen — so the
 *                              lower face reads as equipment instead of cloth.
 *   MASS                       `bulk` +14 % and `scale` +4 %. He is a bigger
 *                              man in more kit, which is the read at any range.
 *
 * WHAT IT DELIBERATELY DOES NOT ADD IS A HELMET, and that is the one piece of
 * kit the tempting version of this puts on him. @see `TEAM_VARIANTS` in
 * `src/match/rules.js`: the two armies are split HELMET vs HEAD WRAP on purpose,
 * so a helmeted enemy elite would carry the FRIENDLY silhouette at the range
 * where silhouette is all that is left. The head keeps his own army's outline
 * and gains a black face inside it.
 *
 * AND HE IS DARKER — 「赤黒く」. Two multipliers, in two different places, and
 * they compose:
 *
 *   HERE, the garment tints are scaled by `SPEAR_VALUE`, which multiplies the
 *   camo bake's albedo and therefore takes the whole per-part value hierarchy
 *   (cloth over pouches over carrier over boots) down together rather than
 *   flattening it.
 *   IN `textures.js`, `TEAM_DRESS.spearhead` rotates that darkened albedo to a
 *   crimson of about HALF the ordinary hostile's luminance at a higher mix
 *   strength. @see the note there for the measurement and for why the hue has
 *   to be carried by the tint rather than left to the light.
 *
 * `spear: true` is the flag `AiSystem._applyTeamRims` reads to choose that
 * dress, keyed off the VARIANT rather than off a team index for the same reason
 * as everything else in this block.
 */
export const SPEAR_SUFFIX = 'Spearhead';

/**
 * What the garment tints are multiplied by — a value split of a stop and a
 * quarter before the dress is applied at all.
 *
 * IT IS SET BY PHOTOGRAPH AND IT IS NOT A LINEAR DIAL. The first cut ran 0.55,
 * which is a 3:1 albedo split against the ordinary hostile once the two dresses
 * are applied, and it photographed at an sRGB LUMINANCE RATIO OF 0.79-0.95:
 * more than half of what lands on a man's torso at these ranges does not scale
 * with his albedo at all (sky fill, the sheen, and the team rim's own added
 * light), so halving the cloth does nowhere near half the pixel. @see
 * `TEAM_DRESS.spearhead` and `TEAM_RIM.spearhead`, which is where the rest of
 * the separation had to come from, and `_eliteread.mjs` for the frames.
 */
const SPEAR_VALUE = 0.36;

/** True for a dress derived above. Read by `AiSystem._applyTeamRims`. */
export function isSpearheadDress(name) {
  return VARIANTS[name]?.spear === true;
}

for (const key of Object.keys(VARIANTS)) {
  const base = VARIANTS[key];
  const dim = (c, k = SPEAR_VALUE) => [c[0] * k, c[1] * k, c[2] * k];
  VARIANTS[`${key}${SPEAR_SUFFIX}`] = {
    ...base,
    spear: true,
    clothTint: dim(base.clothTint),
    gearTint: dim(base.gearTint),
    plateTint: dim(base.plateTint),
    // The shell, if this dress has one at all. A spearhead of the player's own
    // side keeps his helmet — it is his army's silhouette, not the elite's cue.
    helmetTint: base.helmetTint ? dim(base.helmetTint) : undefined,
    // NOT dimmed: skin is not a garment, it takes no team dress, and a grey
    // face under a black mask is a corpse rather than a soldier.
    skinTint: base.skinTint,
    faceWrap: true,
    maskHard: true,
    kneePads: true,
    fullCarrier: true,
    bulk: (base.bulk ?? 1) * 1.14,
    scale: (base.scale ?? 1) * 1.04,
  };
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * AND A TWIN OF EACH ONE HOLDING A LONG GUN — 「あとスナイパー持ってるAIはちゃんと
 * いる？」
 * ────────────────────────────────────────────────────────────────────────────
 * A soldier is ONE SKINNED GEOMETRY PER VARIANT with the rifle baked into it at
 * `HandR` — that is what keeps a man at one draw call per material — so the
 * held weapon cannot vary per man. It CAN vary per variant, and the sniper is
 * not "per man": he is one archetype, so he can have his own variant.
 *
 * `<name>Dmr` is the same soldier in every other respect — same camo, same
 * gear, same face, same bulk, so the side still reads as one side — carrying
 * `weapon: 'sniper'` instead. Built lazily by `AiSystem.variant` on the first
 * sniper of that dress, and `prewarmMaterials` already walks `VARIANTS` by key,
 * so its nine materials are compiled with everybody else's.
 *
 * It is deliberately derived rather than authored: a fourth hand-written
 * variant is a fourth thing to keep in step with `TEAM_VARIANTS`, and the one
 * fact that has to hold — a sniper of MY side wears MY dress — is exactly what
 * deriving guarantees. @see `Agent`'s constructor for the swap.
 */
export const DMR_SUFFIX = 'Dmr';
for (const key of Object.keys(VARIANTS)) {
  VARIANTS[`${key}${DMR_SUFFIX}`] = { ...VARIANTS[key], weapon: 'sniper' };
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * AND TWO WHO ARE NOT SOLDIERS AT ALL — 「民間軍は私服にして軍服にはしないように」
 * ════════════════════════════════════════════════════════════════════════════
 * DERIVED, exactly as `<dress>Dmr` is, and off `irregular` because it is the
 * one entry with no helmet on it: everything a civilian must NOT have is then
 * a `false` in one small table instead of a fourth hand-written variant to keep
 * in step with `TEAM_VARIANTS`.
 *
 * TWO ENTRIES AND NOT SIX. The Dmr loop twins EVERY dress because a sniper of
 * MY side has to wear MY side's uniform; a civilian belongs to neither side and
 * has no dress to agree with, so twinning all three would be three extra
 * geometries and three extra material sets bought for nothing.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY LEGIBILITY IS THE WHOLE MECHANIC AND HOW IT IS PAID FOR
 * ────────────────────────────────────────────────────────────────────────────
 * Killing an armed one is free and killing an unarmed one costs capture score,
 * so if the player cannot tell them apart BEFORE he fires the penalty is a
 * random tax rather than a decision. Three cues, deliberately redundant,
 * ordered by the range at which each one survives:
 *
 *   1. SILHOUETTE, against BOTH ARMIES (works at any range, in any light).
 *      Every soldier on this map is a helmet or a head wrap over a plate
 *      carrier with three magazine pouches, a radio, an antenna, a dump pouch,
 *      knee pads and a slung rifle. A civilian has NONE of it: `civil: true`
 *      deletes the carrier, the webbing, every pouch, the pads, the gloves and
 *      the sling, and drops `bulk` from 0.94 to 0.83. What is left is a person
 *      in a shirt and trousers, and that read does not depend on colour.
 *
 *   2. VALUE, armed against unarmed (survives shade, dust and 27 pixels).
 *      One plain cloth bake (`CAMO.civil`), two tints: the militiaman's work
 *      jacket at 0.42x lands ~0.045 linear — DARKER than any uniform on the
 *      map — and the civilian's shirt at 3.05x lands ~0.33, which is brighter
 *      than sunlit plaster on this level. @see the measurement table in
 *      textures.js: 7:1 between the two of them, and neither of them anywhere
 *      near the 0.075-0.11 band both armies live in.
 *
 *   3. HEAD AND HANDS, at the range you actually fight indoors (under ~20 m).
 *      The militiaman is wrapped — shemagh and face wrap, no skin above the
 *      collar — and carries a chest bandolier of AK magazines that reads even
 *      when the rifle itself is behind a doorframe. The civilian is BARE:
 *      bare head, bare face, bare hands, and nothing in either of them.
 *
 * NEITHER TAKES THE TEAM DRESS OR THE TEAM RIM. @see `resolveMaterials` — the
 * civilian slots are registered under no variant, so `setTeamDress` and
 * `setTeamRim` cannot reach them and a civilian can never be repainted into
 * one army's crimson or the other's slate. He is a third thing on purpose, and
 * the militiaman deliberately does not get the hostile's free red outline:
 * 「これはゲーム上アナウンスなし」 — the player's first contact IS the discovery.
 */
export const CIVIL_VARIANTS = Object.freeze({ armed: 'civilArmed', unarmed: 'civilUnarmed' });

/**
 * Cloth tint per kind. Multiplies the ONE `camo_civil` bake. @see CAMO.civil.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY GREEN AND CREAM AND NOT "DARK" AND "LIGHT" — PHOTOGRAPHED, NOT ASSERTED
 * ────────────────────────────────────────────────────────────────────────────
 * The first pass was near-neutral: 0.44/0.42/0.36 and 3.05/3.00/2.82, on the
 * theory that a 7:1 VALUE ratio was enough on its own. Looked at
 * (`_civread.mjs`, four men in one line at 12 m, 16:30, sun behind them), it was
 * not, and the failure was not the one being guarded against. Both civilians
 * came back BLUE — militiaman rgb 77/73/68 reading navy on screen, civilian
 * 101/99/99 reading pale blue — because a low-chroma albedo standing in its own
 * shadow is lit by SKY FILL, and the sky fill on this map is blue. The frame
 * therefore had four men in it of whom three read as some value of the
 * FRIENDLY's slate, and the friendly's slate is the one colour on the map that
 * means "do not shoot".
 *
 * So the hue is now carried by the tint rather than left to the light:
 *
 *   MILITIAMAN, DARK OLIVE. Green is the one hue neither army uses — the
 *   friendly is slate (cool) and the hostile is crimson (warm) — so it cannot
 *   be confused with either at the value it sits at, and enough chroma survives
 *   the sky fill for the shadow side to still read green. It is also simply
 *   what a militia work jacket is. ~0.051 linear: under both armies' 0.078-0.085.
 *
 *   CIVILIAN, WARM CREAM. ~0.34 linear, four times either army and brighter
 *   than the sunlit plaster he stands against (~0.05-0.09 on screen; @see the
 *   measurement table in textures.js). At that albedo his own colour dominates
 *   the sky fill instead of the other way round, and value alone separates him
 *   from every other figure in the frame at any range.
 */
const CIVIL_CLOTH = {
  armed: [0.34, 0.58, 0.24], // dark olive work jacket, ~0.051 linear
  unarmed: [3.62, 3.24, 2.52], // unbleached cotton shirt, ~0.34 linear
};

{
  const base = VARIANTS.irregular;
  /** Everything a soldier has that a man in his own clothes does not. */
  const undress = {
    civil: true,
    camo: 'civil',
    helmet: false,
    helmetCover: false,
    goggles: false,
    gogglesDown: false,
    shades: false,
    maskHard: false,
    kneePads: false,
    fullCarrier: false,
  };
  VARIANTS[CIVIL_VARIANTS.armed] = {
    ...base,
    ...undress,
    clothTint: CIVIL_CLOTH.armed,
    // the wrap, the bandolier, the belt and the boots go with the jacket:
    // a militiaman's kit is his own and it stays out of both armies' hues
    gearTint: [0.74, 0.92, 0.52],
    skinTint: [0.84, 0.78, 0.72],
    headWrap: true,
    faceWrap: true,
    beard: true,
    bandolier: true,
    weapon: 'ak',
    bulk: 0.86,
    scale: 0.985,
  };
  VARIANTS[CIVIL_VARIANTS.unarmed] = {
    ...base,
    ...undress,
    clothTint: CIVIL_CLOTH.unarmed,
    // his belt and shoes are the only dark things on him, which is what stops
    // the pale shirt reading as a single flat slab
    gearTint: [0.92, 0.84, 0.68],
    skinTint: [1.00, 0.90, 0.80],
    // BARE. No wrap over the head, nothing across the face, nothing in either
    // hand — this is the man the score penalty is about and he must never be
    // mistaken for the one beside him.
    headWrap: false,
    faceWrap: false,
    beard: false,
    bandolier: false,
    weapon: null,
    bulk: 0.83,
    scale: 0.97,
  };
}

const bp = (name) => {
  const v = RIG.bindPos[RIG.index(name)];
  return [v.x, v.y, v.z];
};

/**
 * Build one variant.
 * @returns { geometry, materials: THREE.Material[], weapon, stats }
 */
export function buildSoldier(name, { rng, materials }) {
  const V = VARIANTS[name] ?? VARIANTS.vanguard;
  /**
   * A MAN IN HIS OWN CLOTHES. @see `CIVIL_VARIANTS` — this gates off every
   * piece of soldier kit rather than recolouring it, because the silhouette is
   * the cue that survives when the colour does not.
   *
   * THE MATERIAL SLOT ORDER IS STILL `MATERIAL_SLOTS`, and that is why the belt
   * and its buckle move rather than simply being kept: `gear` first appears on
   * a soldier at the elbow pad and `polymer` at the spare magazine, and both of
   * those are gone here. Read the note on `MATERIAL_SLOTS` — the order is the
   * opaque draw order. Belt (gear) goes in before the boots and the buckle
   * (polymer) after them, which lands the civilian's slots as
   * cloth/gear/boot/rubber/polymer/skin/steel: a subsequence of the canonical
   * nine, which is exactly what the assertion at the bottom asks for.
   */
  const civ = V.civil === true;
  const nz = new Noise(rng.fork());
  const B = new CharacterBuilder(RIG, { noise: nz, materials: MATERIALS });

  const shR = bp('UpperArmR'), elR = bp('ForearmR'), wrR = bp('HandR');
  const shL = bp('UpperArmL'), elL = bp('ForearmL'), wrL = bp('HandL');
  const hipR = bp('UpLegR'), knR = bp('LegR'), anR = bp('FootR');
  const hipL = bp('UpLegL'), knL = bp('LegL'), anL = bp('FootL');
  const head = bp('Head');

  /* ---------------- occlusion proxies (drives baked vertex AO) -------- */
  B.occlude([0, 0.95, -0.01], [0, 1.42, 0.0], 0.155, 1.0); // torso core
  if (!civ) {
    B.occlude([0, 1.17, 0.130], [0, 1.40, 0.138], 0.11, 1.0); // front plate
    B.occlude([0, 1.20, -0.105], [0, 1.40, -0.112], 0.105, 0.8); // back plate
  }
  B.occlude([-0.17, 1.16, 0.02], [-0.17, 1.30, 0.02], 0.055, 0.7); // right side
  B.occlude([0.17, 1.16, 0.02], [0.17, 1.30, 0.02], 0.055, 0.7);
  B.occlude([0, 1.63, 0.0], [0, 1.81, -0.012], 0.106, 1.0); // helmet interior
  // Brim shadow. The rim moved up onto the brow (head bone 1.552 + 0.118), and
  // this proxy is what puts the dark band across the eye sockets that makes the
  // newly-exposed face read as a face instead of a bright patch of skin.
  B.occlude([-0.10, 1.672, 0.058], [0.10, 1.672, 0.058], 0.050, 1.0);
  // eye sockets themselves: a small proxy per orbit, so the globe sits in shade
  B.occlude([-0.033, 1.650, 0.055], [-0.033, 1.650, 0.075], 0.022, 0.9);
  B.occlude([0.033, 1.650, 0.055], [0.033, 1.650, 0.075], 0.022, 0.9);
  B.occlude(shR, elR, 0.058, 0.7);
  B.occlude(shL, elL, 0.058, 0.7);
  B.occlude(hipR, knR, 0.085, 0.8);
  B.occlude(hipL, knL, 0.085, 0.8);
  B.occlude([0, 0.90, -0.01], [0, 1.05, -0.01], 0.15, 0.8); // belt line
  // strap crossings — shoulder yokes and the diagonal sling run. These are the
  // places a real uniform is darkest: sweat, webbing dye and ground-in dust all
  // collect where nylon rubs cloth.
  B.occlude([-0.085, 1.42, 0.06], [-0.085, 1.42, -0.06], 0.048, 1.0);
  B.occlude([0.085, 1.42, 0.06], [0.085, 1.42, -0.06], 0.048, 1.0);
  B.occlude([-0.13, 1.40, 0.055], [0.10, 1.10, 0.115], 0.032, 0.9); // sling diagonal
  if (!civ) B.occlude([-0.02, 1.02, 0.10], [-0.02, 1.02, -0.10], 0.10, 0.6); // carrier hem
  // cuffs, elbows and knees: the three places a uniform is always ground in
  B.occlude(wrR, [wrR[0], wrR[1] + 0.05, wrR[2]], 0.044, 0.9);
  B.occlude(wrL, [wrL[0], wrL[1] + 0.05, wrL[2]], 0.044, 0.9);
  B.occlude(elR, [elR[0], elR[1] - 0.02, elR[2] - 0.01], 0.052, 0.8);
  B.occlude(elL, [elL[0], elL[1] - 0.02, elL[2] - 0.01], 0.052, 0.8);
  B.occlude(knR, [knR[0], knR[1] - 0.03, knR[2] + 0.01], 0.072, 0.8);
  B.occlude(knL, [knL[0], knL[1] - 0.03, knL[2] + 0.01], 0.072, 0.8);
  B.occlude([anR[0], anR[1] + 0.09, anR[2]], [anR[0], anR[1] + 0.15, anR[2]], 0.062, 0.8);
  B.occlude([anL[0], anL[1] + 0.09, anL[2]], [anL[0], anL[1] + 0.15, anL[2]], 0.062, 0.8);
  B.occlude(GRIP_R, [GRIP_R[0] + BORE_DIR[0] * 0.4, GRIP_R[1] + BORE_DIR[1] * 0.4 + 0.09, GRIP_R[2] + BORE_DIR[2] * 0.4], 0.045, 0.6);
  if (!civ) {
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.078;
      B.occlude([x, 1.20, 0.160], [x, 1.28, 0.164], 0.040, 0.8); // mag pouches
    }
  }

  /* ---------------- uniform ------------------------------------------ */
  B.add(P.jacketTorso(nz, { bulk: V.bulk }), {
    material: 'cloth',
    bones: ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'ClavicleR', 'ClavicleL', 'UpperArmR', 'UpperArmL'],
    bias: [1, 1, 1, 1, 0.8, 0.55, 0.55, 0.30, 0.30],
    colour: [1, 1, 1],
    grime: 0.85,
    dirt: 0.20,
    dust: 0.34,
    wear: 0.08,
    name: 'jacket',
  });
  B.add(P.pelvis(nz), {
    material: 'cloth',
    bones: ['Hips', 'Spine', 'UpLegR', 'UpLegL'],
    bias: [1, 0.7, 0.5, 0.5],
    colour: [0.97, 0.97, 0.97],
    grime: 0.9,
    dirt: 0.35,
    dust: 0.2,
    name: 'pelvis',
  });
  B.add(P.collar(nz), {
    material: 'cloth',
    bones: ['Neck', 'Spine2', 'Head'],
    bias: [1, 0.8, 0.3],
    colour: [0.92, 0.92, 0.91],
    grime: 1.0,
    dust: 0.3,
    name: 'collar',
  });

  // sleeves
  for (const [sh, el, wr, side, suffix] of [
    [shR, elR, wrR, -1, 'R'],
    [shL, elL, wrL, 1, 'L'],
  ]) {
    // deltoid cap. The sleeve tube alone meets the torso in a socket, which is
    // half of the "tube arms" read; this gives the shoulder an actual shape and
    // a highlight to catch the key light on.
    B.add(P.shoulderCap(nz, sh, side), {
      material: 'cloth',
      bones: [`Clavicle${suffix}`, `UpperArm${suffix}`, 'Spine2'],
      bias: [0.8, 1, 0.4],
      colour: [1, 1, 1],
      grime: 0.7,
      dust: 0.5,
      wear: 0.06,
      name: `shoulder${suffix}`,
    });
    /**
     * SLEEVE PROFILE — 9 samples from the shoulder (t=0) through the elbow
     * (t=0.5, index 4) to the cuff (t=1).
     *
     * The old array was [0.050, 0.062, 0.056, 0.050, 0.046, 0.042, 0.038]:
     * monotonically shrinking from just below the shoulder all the way to the
     * wrist. A limb whose radius only ever decreases is a cone, and a cone is
     * the thing the eye refuses to read as an arm no matter what is painted on
     * it. Two masses are missing from it, and both are named in the brief:
     *
     *   - the elbow is not the narrowest point (it should be, between the
     *     triceps above and the flexor bulge below);
     *   - there is no FOREARM. A real forearm swells to about 110% of the elbow
     *     roughly a third of the way down and then tapers hard to a wrist about
     *     60% of that — the classic double curve. Straight taper is a broomstick.
     */
    B.add(
      P.limbTube(nz, [sh[0] + side * 0.012, sh[1] + 0.055, sh[2]], el, wr,
        [0.055, 0.062, 0.059, 0.052, 0.047, 0.052, 0.047, 0.039, 0.036], {
        rings: 22,
        seg: 16,
        fold: 0.0016,
        // 3 mm creases: at 35 m that is sub-pixel as displacement but the normals
        // it generates are what put light and shade *inside* the sleeve outline.
        crease: 0.0030,
        bend: [0, 0, -1], // sleeve bunches inside the elbow
      }),
      {
        material: 'cloth',
        bones: [`Clavicle${suffix}`, `UpperArm${suffix}`, `Forearm${suffix}`, `Hand${suffix}`, 'Spine2'],
        bias: [0.5, 1, 1, 0.7, 0.25],
        colour: [1, 1, 1],
        grime: 0.8,
        dirt: 0.15,
        dust: 0.3,
        wear: 0.12,
        name: `sleeve${suffix}`,
      }
    );
    // elbow reinforcement patch — soldier kit; a shirt has a sleeve and no pad
    if (!civ) B.add(
      P.limbTube(
        nz,
        [el[0] * 0.98 + sh[0] * 0.02, el[1] + 0.05, el[2] - 0.005],
        el,
        [el[0] * 0.98 + wr[0] * 0.02, el[1] - 0.05, el[2] + 0.004],
        [0.050, 0.054, 0.050],
        { rings: 5, seg: 14, fold: 0.001 }
      ),
      {
        material: 'gear',
        bones: [`UpperArm${suffix}`, `Forearm${suffix}`],
        bias: [1, 1],
        colour: GEAR.pad,
        grime: 1.0,
        dirt: 0.25,
        dust: 0.22,
        wear: 0.16,
        name: `elbowPad${suffix}`,
      }
    );
  }

  /**
   * THE CIVILIAN'S BELT, AND WHY IT IS HERE RATHER THAN WITH THE WEBBING.
   * It is a trouser belt, not load-bearing gear, so it survives the undress —
   * and it is the FIRST `gear` part on this figure, which is what keeps his
   * material slots a subsequence of `MATERIAL_SLOTS`. @see `civ` above.
   */
  if (civ) {
    B.add(P.belt(nz), {
      material: 'gear',
      bones: ['Hips', 'Spine'],
      bias: [1, 0.5],
      colour: GEAR.belt,
      grime: 1.0,
      dirt: 0.4,
      dust: 0.25,
      wear: 0.3,
      name: 'belt',
    });
  }

  // trousers
  for (const [hip, kn, an, suffix] of [
    [hipR, knR, anR, 'R'],
    [hipL, knL, anL, 'L'],
  ]) {
    /**
     * TROUSER PROFILE — 9 samples from the hip (t=0) through the knee (t=0.5,
     * index 4) to the boot cuff (t=1), plus a rearward offset for the calf.
     *
     * The old array was [0.090, 0.085, 0.076, 0.068, 0.062, 0.060, 0.064] and it
     * had the same disease as the sleeve, but worse, because the leg is longer
     * and there is nothing else on it to look at: the knee (0.068) was WIDER
     * than the calf (0.060), so the lower leg was a straight stick that got
     * thinner all the way down. In the walk cycle it was the loudest non-human
     * cue on the model — two noodles swinging under a torso.
     *
     * Real: the knee is the narrowest point of the whole leg above the ankle,
     * the calf belly peaks about a third of the way down the shin at ~115% of
     * the knee, and it peaks BEHIND the tibia, not around it. `offset` supplies
     * that asymmetry; a symmetric bump would just look like a swollen joint.
     */
    B.add(
      P.limbTube(nz, hip, kn, [an[0], an[1] + 0.085, an[2] + 0.008],
        [0.098, 0.093, 0.085, 0.074, 0.065, 0.075, 0.069, 0.058, 0.059], {
        rings: 24,
        seg: 17,
        fold: 0.0018,
        // trousers crease harder than sleeves and stack on the boot cuff
        crease: 0.0042,
        bend: [0, 0, -1], // gathers behind the knee
        flat: 0.94, // a thigh is nearly as deep as it is wide; 0.88 read flat
        offset: (t) => [0, -0.024 * Math.exp(-((t - 0.60) ** 2) / 0.0090)],
      }),
      {
        material: 'cloth',
        bones: ['Hips', `UpLeg${suffix}`, `Leg${suffix}`, `Foot${suffix}`],
        bias: [0.6, 1, 1, 0.5],
        colour: [0.98, 0.98, 0.97],
        grime: 0.8,
        dirt: 0.72,
        dust: 0.22,
        wear: 0.10,
        name: `leg${suffix}`,
      }
    );
    // cargo pocket on the outer thigh
    const side = suffix === 'R' ? -1 : 1;
    B.add(
      P.pouch(nz, {
        hx: 0.052, hy: 0.070, hz: 0.026,
        x: hip[0] + side * 0.062, y: hip[1] - 0.16, z: 0.026,
        rz: side * 0.06, ry: side * 0.55, bend: 0.11,
      }),
      {
        material: 'cloth',
        bones: [`UpLeg${suffix}`, 'Hips'],
        bias: [1, 0.4],
        colour: [0.95, 0.95, 0.94],
        grime: 0.9,
        dirt: 0.5,
        dust: 0.4,
        wear: 0.16,
        name: `cargo${suffix}`,
      }
    );
    if (V.kneePads) {
      /**
       * RIGID TO THE SHIN, not smooth-bound across the joint.
       *
       * A knee pad is a hard cup on a pair of elastic straps. It does not
       * deform, and it does not straddle the hinge: the straps are cinched
       * around the shin and the cup rides the patella with it. Smooth-binding
       * it (`bones: [Leg, UpLeg]`, `bias: [1, 0.5]`) gave its upper half to the
       * thigh and its cup to the shin, so the two ends went opposite ways the
       * moment the knee bent — fine at the 30 degrees the old locomotion ever
       * reached, and torn wide open at the 90 the run cycle now reaches in
       * mid-swing. Photographed at 2.4 m off the flexed knee it was a grey slab
       * hanging in the air beside the leg with its straps stretched into wires.
       *
       * `bone` (rigid, weight 1) instead of `bones` is the whole fix. It costs
       * nothing, it cannot stretch, and it is what the object actually does.
       * The part NAME is untouched, so `PART_MUL` and tools/lethality.mjs — which
       * key damage off the ragdoll's own part table, not this one — are not in
       * the blast radius either way.
       */
      B.add(P.kneePad(nz, kn, side), {
        material: 'gear',
        bone: `Leg${suffix}`,
        colour: GEAR.pad,
        grime: 1.0,
        dirt: 0.9,
        dust: 0.28,
        wear: 0.20,
        name: `knee${suffix}`,
      });
    }
    // boots
    B.add(P.boot(nz, an, side), {
      material: 'boot',
      bones: [`Leg${suffix}`, `Foot${suffix}`, `Toe${suffix}`],
      bias: [0.55, 1, 0.6],
      colour: GEAR.boot,
      grime: 0.9,
      dirt: 0.85,
      dust: 0.5,
      wear: 0.3,
      name: `boot${suffix}`,
    });
    B.add(P.bootSole(an), {
      material: 'rubber',
      bones: [`Foot${suffix}`, `Toe${suffix}`],
      bias: [1, 0.8],
      grime: 0.9,
      dirt: 1.0,
      name: `sole${suffix}`,
    });
    B.add(P.bootLaces(an), {
      material: 'boot',
      bone: `Foot${suffix}`,
      colour: GEAR.lace,
      grime: 0.9,
      dirt: 0.85,
      name: `laces${suffix}`,
    });
  }

  /**
   * …AND ITS BUCKLE, which is the first `polymer` on a figure that carries no
   * spare magazine and no antenna. Same reason as the belt: slot ORDER. It is
   * also the one hard, glossy thing on a man made entirely of cloth, and at
   * 6 m it is the highlight that says the shape at his waist is a belt.
   */
  if (civ) {
    B.add(
      P.pouch(nz, { hx: 0.028, hy: 0.022, hz: 0.012, x: 0.0, y: 0.962, z: 0.108 }),
      { material: 'polymer', bones: ['Hips', 'Spine'], bias: [1, 0.4], grime: 0.5, wear: 0.35, name: 'buckle' }
    );
  }

  /* ---------------- load-bearing gear -------------------------------- */
  if (!civ) {
  B.add(P.plateCarrier(nz, V), {
    material: 'plate',
    bones: ['Spine', 'Spine1', 'Spine2', 'ClavicleR', 'ClavicleL'],
    bias: [0.7, 1, 1, 0.45, 0.45],
    colour: [0.72, 0.72, 0.72],
    grime: 0.85,
    dirt: 0.3,
    dust: 0.30,
    wear: 0.18,
    name: 'carrier',
  });
  B.add(P.carrierWebbing(), {
    material: 'gear',
    bones: ['Spine1', 'Spine2'],
    bias: [1, 1],
    colour: GEAR.webbing,
    grime: 1.0,
    dust: 0.3,
    wear: 0.26,
    name: 'webbing',
  });

  // magazine pouches across the front, deliberately not evenly loaded
  const nPouch = V.fullCarrier ? 3 : 2;
  for (let i = 0; i < nPouch; i++) {
    const t = nPouch === 1 ? 0.5 : i / (nPouch - 1);
    const x = (t - 0.5) * (nPouch > 2 ? 0.156 : 0.09);
    B.add(
      P.pouch(nz, {
        hx: 0.033, hy: 0.056, hz: 0.034,
        x, y: 1.236 + rng.range(-0.006, 0.006), z: 0.148,
        rx: -0.10, rz: rng.range(-0.05, 0.05),
        lidTilt: i === 1 ? -0.5 : 0,
        bend: 0.26,
      }),
      {
        material: 'gear',
        bones: ['Spine1', 'Spine2', 'Spine'],
        bias: [1, 0.8, 0.4],
        colour: i === 1 ? GEAR.pouchAlt : GEAR.pouch,
        grime: 0.9,
        dirt: 0.25,
        dust: 0.5,
        wear: 0.30,
        name: `magPouch${i}`,
      }
    );
    // a magazine sticking out of the open pouch
    if (i === 1) {
      const mag = P.pouch(nz, {
        hx: 0.0145, hy: 0.042, hz: 0.023,
        x, y: 1.308, z: 0.152, rx: -0.12,
      });
      B.add(mag, {
        material: 'polymer',
        bones: ['Spine1', 'Spine2'],
        bias: [1, 0.8],
        grime: 0.4,
        wear: 0.2,
        name: 'spareMag',
      });
    }
  }

  // radio on the left chest, admin pouch on the right, IFAK on the belt
  B.add(
    P.pouch(nz, {
      hx: 0.032, hy: 0.058, hz: 0.028,
      x: 0.112, y: 1.336, z: 0.118, ry: 0.35, rz: 0.10, bend: 0.24,
    }),
    {
      material: 'gear',
      bones: ['Spine2', 'ClavicleL', 'Spine1'],
      bias: [1, 0.5, 0.5],
      colour: GEAR.pouchAlt,
      grime: 0.9,
      dust: 0.5,
      wear: 0.22,
      name: 'radio',
    }
  );
  // antenna
  {
    const ant = P.pouch(nz, { hx: 0.005, hy: 0.075, hz: 0.005, x: 0.116, y: 1.424, z: 0.104, rx: -0.18 });
    B.add(ant, {
      material: 'polymer',
      bones: ['Spine2', 'ClavicleL'],
      bias: [1, 0.6],
      grime: 0.3,
      name: 'antenna',
    });
  }
  B.add(P.belt(nz), {
    material: 'gear',
    bones: ['Hips', 'Spine'],
    bias: [1, 0.5],
    colour: GEAR.belt,
    grime: 1.0,
    dirt: 0.4,
    dust: 0.25,
    wear: 0.26,
    name: 'belt',
  });
  B.add(P.hipPouch(nz, -1), {
    material: 'gear',
    bones: ['Hips', 'Spine'],
    bias: [1, 0.4],
    colour: GEAR.dump,
    grime: 0.95,
    dirt: 0.6,
    dust: 0.45,
    wear: 0.26,
    name: 'dumpPouch',
  });
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * THE BANDOLIER — WHAT SAYS "ARMED" WHEN THE RIFLE IS BEHIND A DOORFRAME
   * ══════════════════════════════════════════════════════════════════════════
   * The gun in his hands is the honest cue and it is not always available: a
   * man leaning out of a room shows his torso a beat before he shows the AK,
   * and a rifle held low against a dark jacket in an unlit interior is a
   * silhouette question the player is being asked to answer in about a third of
   * a second. So the militiaman also wears four AK magazines on a strap across
   * his chest, and NOTHING else on this figure has anything on its chest at all
   * — the unarmed civilian's is bare cloth and both armies wear a plate carrier
   * that fills it edge to edge. The magazines are `polymer`, which lands them
   * near-black and glossy against a matte jacket, and the strap is `gear`.
   *
   * It is the diagonal that reads, not the boxes: a bright line from the left
   * shoulder to the right hip is the one mark on this map that means "armed".
   */
  if (civ && V.bandolier) {
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      // shoulder (left, high, back) down to the right hip (low, front)
      const x = 0.108 - t * 0.196;
      const y = 1.408 - t * 0.30;
      const z = 0.052 + t * 0.078;
      B.add(
        P.pouch(nz, { hx: 0.030, hy: 0.020, hz: 0.014, x, y, z, rz: 0.98, rx: -0.12 }),
        {
          material: 'gear',
          bones: ['Spine2', 'Spine1', 'Spine'],
          bias: [1, 0.9, 0.4],
          colour: GEAR.webbing,
          grime: 1.0,
          dirt: 0.5,
          dust: 0.35,
          wear: 0.34,
          name: `bandolier${i}`,
        }
      );
      if (i === 4) continue;
      B.add(
        P.pouch(nz, { hx: 0.0135, hy: 0.041, hz: 0.021, x: x - 0.010, y: y + 0.012, z: z + 0.016, rz: 0.98, rx: -0.12 }),
        {
          material: 'polymer',
          bones: ['Spine2', 'Spine1', 'Spine'],
          bias: [1, 0.9, 0.4],
          grime: 0.45,
          wear: 0.28,
          name: `bandolierMag${i}`,
        }
      );
    }
  }

  /* ---------------- head --------------------------------------------- */
  const wrapped = V.faceWrap;
  B.add(P.headMesh(nz, head, {}), {
    material: 'skin',
    bone: 'Head',
    colour: [1, 1, 1],
    grime: 0.3,
    dirt: 0.06,
    name: 'head',
  });
  B.add(P.nose(nz, head), { material: 'skin', bone: 'Head', grime: 0.25, name: 'nose' });
  B.add(P.ear(nz, head, -1), { material: 'skin', bone: 'Head', grime: 0.45, name: 'earR' });
  B.add(P.ear(nz, head, 1), { material: 'skin', bone: 'Head', grime: 0.45, name: 'earL' });
  for (const side of [-1, 1]) {
    B.add(P.eyeball(head, side), {
      material: 'polymer',
      bone: 'Head',
      // Was 0.55 — a pale bead, and at 3 m the eye read as a highlight stuck on
      // the face. What the viewer actually recognises is a DARK aperture inside
      // the brow's shadow with one specular pin in it, and the polymer set is
      // glossy enough to supply the pin on its own.
      colour: [0.20, 0.185, 0.175],
      grime: 0.2,
      name: 'eye',
    });
  }
  // neck
  B.add(
    P.limbTube(nz, [head[0], head[1] - 0.10, head[2] - 0.012], [head[0], head[1] - 0.05, head[2] - 0.008], [head[0], head[1], head[2]],
      [0.058, 0.056, 0.054], { rings: 5, seg: 14, fold: 0.001 }),
    {
      material: 'skin',
      bones: ['Neck', 'Head', 'Spine2'],
      bias: [1, 0.7, 0.4],
      grime: 0.5,
      name: 'neck',
    }
  );

  if (wrapped) {
    // A hard ballistic mask is moulded polymer on the *same* geometry: the seam
    // and the bridge fold read as the mask's edge and nose vent instead of a
    // cloth hem, and it lands far darker than any cloth in the kit, which is
    // what gives that variant a legible face at range.
    B.add(P.faceWrap(nz, head, V), {
      material: V.maskHard ? 'polymer' : 'gear',
      bones: ['Head', 'Neck'],
      bias: [1, 0.5],
      colour: V.maskHard ? GEAR.mask : V.helmet ? GEAR.wrap : [0.78, 0.74, 0.66],
      grime: V.maskHard ? 0.5 : 0.85,
      dirt: V.maskHard ? 0.1 : 0.2,
      dust: V.maskHard ? 0.2 : 0.3,
      wear: V.maskHard ? 0.3 : 0.1,
      name: 'faceWrap',
    });
  }

  if (V.helmet) {
    // A covered helmet is CLOTH, not plastic: the camo cover is the single
    // biggest reason a helmet reads as a helmet rather than a bowling ball. Its
    // tint deliberately lands off the uniform value so the head separates from
    // the torso at range. A bare shell goes on the laminate set instead.
    B.add(P.helmet(nz, head, V), {
      material: V.helmetCover ? 'cloth' : 'plate',
      bone: 'Head',
      colour: V.helmetTint ?? [1, 1, 1],
      grime: 0.6,
      dirt: 0.2,
      dust: 0.55,
      wear: 0.4,
      name: 'helmet',
    });
    B.add(P.helmetHardware(nz, head), {
      material: 'polymer',
      bone: 'Head',
      grime: 0.5,
      wear: 0.3,
      name: 'helmetHW',
    });
    B.add(P.chinStrap(head), {
      material: 'gear',
      bones: ['Head', 'Neck'],
      bias: [1, 0.4],
      colour: GEAR.strap,
      grime: 0.95,
      dust: 0.25,
      wear: 0.18,
      name: 'chinStrap',
    });
    if (V.goggles) {
      const g = P.goggles(head, V.gogglesDown);
      B.add(g.frame, { material: 'polymer', bone: 'Head', grime: 0.4, wear: 0.35, name: 'goggleFrame' });
      B.add(g.strap, {
        material: 'gear',
        bone: 'Head',
        colour: GEAR.strap,
        grime: 0.85,
        dust: 0.3,
        name: 'goggleStrap',
      });
      B.add(P.goggleLens(head, V.gogglesDown), {
        material: 'glass',
        bone: 'Head',
        colour: [1, 1, 1],
        grime: 0.15,
        name: 'goggleLens',
      });
    }
  } else if (V.headWrap) {
    const wrap = P.headScarf(nz, head);
    B.add(wrap, {
      // hue comes from the variant's cloth tint; the VALUE sits below the uniform
      // so the head is never the brightest thing on the figure
      material: 'cloth',
      bone: 'Head',
      colour: [0.82, 0.80, 0.76],
      grime: 0.8,
      dirt: 0.25,
      dust: 0.4,
      wear: 0.14,
      name: 'shemagh',
    });
  }

  if (V.shades) {
    const s = P.sunglasses(head);
    B.add(s.frame, { material: 'polymer', bone: 'Head', grime: 0.4, wear: 0.3, name: 'shadeFrame' });
    B.add(s.lens, {
      material: 'glass',
      bone: 'Head',
      colour: [1, 1, 1],
      grime: 0.2,
      name: 'shadeLens',
    });
  }

  /* ---------------- hands + weapon ----------------------------------- */
  const bore = new THREE.Vector3(...BORE_DIR).normalize();
  const palmR = new THREE.Vector3(-0.55, 0.35, -0.75).normalize();
  const palmL = new THREE.Vector3(0.75, 0.30, -0.60).normalize();
  const gripAxisR = new THREE.Vector3(0.18, 0.92, -0.34).normalize(); // down the grip
  const gripAxisL = bore.clone();

  /**
   * BARE HANDS ON A CIVILIAN. The same geometry — `P.glove` IS the hand — on
   * the `skin` set with the head's own tint instead of the cordura set at
   * GEAR.glove (0.032-0.048 linear, i.e. near black). At the range a room is
   * fought at, two pale hands on a pale shirt are the second thing that says
   * "there is nothing in them"; the knuckle guards go with the gloves.
   */
  const handMat = civ ? 'skin' : 'boot';
  const handTint = civ ? undefined : GEAR.glove;
  B.add(P.glove(nz, wrR, [gripAxisR.x, gripAxisR.y, gripAxisR.z], [palmR.x, palmR.y, palmR.z], -1), {
    material: handMat,
    bones: ['HandR', 'ForearmR'],
    bias: [1, 0.35],
    colour: handTint,
    grime: 0.9,
    dirt: civ ? 0.12 : 0.3,
    dust: 0.25,
    wear: 0.28,
    name: 'gloveR',
  });
  if (!civ) B.add(P.knuckleGuard(wrR, [gripAxisR.x, gripAxisR.y, gripAxisR.z], [palmR.x, palmR.y, palmR.z]), {
    material: 'polymer',
    bone: 'HandR',
    grime: 0.5,
    wear: 0.35,
    name: 'knuckleR',
  });
  B.add(P.glove(nz, wrL, [gripAxisL.x, gripAxisL.y, gripAxisL.z], [palmL.x, palmL.y, palmL.z], 1), {
    material: handMat,
    bones: ['HandL', 'ForearmL'],
    bias: [1, 0.35],
    colour: handTint,
    grime: 0.9,
    dirt: civ ? 0.12 : 0.3,
    dust: 0.25,
    wear: 0.28,
    name: 'gloveL',
  });
  if (!civ) B.add(P.knuckleGuard(wrL, [gripAxisL.x, gripAxisL.y, gripAxisL.z], [palmL.x, palmL.y, palmL.z]), {
    material: 'polymer',
    bone: 'HandL',
    grime: 0.5,
    wear: 0.35,
    name: 'knuckleL',
  });

  /**
   * NOTHING IN EITHER HAND. `V.weapon: null` is the unarmed civilian and it is
   * the ONE fact the score penalty turns on, so it is expressed as the absence
   * of the mesh rather than as a hidden or a shrunken one. `steel` (and the
   * optic's `glass`) simply never appear in his slot list; `MATERIAL_SLOTS` is
   * a subsequence test, so a shorter list is not a violation of it, and
   * `resolveMaterials` is driven by what was actually emitted.
   */
  const W = V.weapon ? buildWeapon(nz, V.weapon, rng) : null;
  if (W) {
    B.add(W.steel, { material: 'steel', bone: 'HandR', grime: 0.55, wear: 0.25, name: 'wpnSteel' });
    B.add(W.polymer, { material: 'polymer', bone: 'HandR', grime: 0.5, wear: 0.3, name: 'wpnPoly' });
    B.add(W.rubber, { material: 'rubber', bone: 'HandR', grime: 0.6, name: 'wpnRubber' });
    if (W.glass.p.length) {
      B.add(W.glass, { material: 'glass', bone: 'HandR', grime: 0.1, name: 'wpnGlass' });
    }
  }

  // sling: body-bound so it stays on the chest as the arms move. Soldier kit —
  // the militiaman carries his rifle in his hands and his ammunition on a strap.
  if (W && !civ) B.add(P.sling(W.foregrip, W.stockTop), {
    material: 'gear',
    bones: ['Spine2', 'Spine1', 'ClavicleR', 'ClavicleL', 'Hips'],
    bias: [1, 0.8, 0.5, 0.5, 0.3],
    colour: GEAR.sling,
    grime: 1.0,
    dust: 0.2,
    wear: 0.22,
    name: 'sling',
  });

  const built = B.build();
  // Guard the prewarm contract: see MATERIAL_SLOTS.
  if (built.materialNames.join() !== MATERIAL_SLOTS.filter((s) => built.materialNames.includes(s)).join()) {
    console.warn(
      `[ai] material slot order changed (${built.materialNames.join()}); ` +
        'update MATERIAL_SLOTS or prewarmMaterials will reorder opaque draws'
    );
  }
  const mats = resolveMaterials(name, built.materialNames, materials);

  return {
    geometry: built.geometry,
    materials: mats,
    parts: built.parts,
    weapon: W,
    stats: { vertices: built.vertices, triangles: built.triangles },
    variant: V,
  };
}

/**
 * Every material slot a soldier's geometry is grouped by, IN THE ORDER
 * `CharacterBuilder.build()` emits them — which is the order the parts are added
 * above, deduplicated. All three variants use all nine.
 *
 * THE ORDER IS LOad-BEARING, and this is not a style preference. `THREE.Material`
 * hands out globally incrementing ids and three sorts the opaque render list by
 * `material.id` (`painterSortStable`), including the nine groups *within* one
 * soldier. Create them in a different order and the goggle lens draws before its
 * frame instead of after it; with a depth prepass in front, whichever coplanar
 * surface is drawn last wins the equal-depth test. MEASURED: prewarming these in
 * a hand-written order moved 2 pixels of the `combat` shot by 1/255 and failed
 * the pixel gate. `buildSoldier` asserts the order below still matches.
 */
export const MATERIAL_SLOTS = Object.freeze([
  'cloth', 'gear', 'boot', 'rubber', 'plate', 'polymer', 'skin', 'glass', 'steel',
]);

/**
 * Resolve a variant's material slot names to real materials.
 *
 * Split out of `buildSoldier` on purpose: `AiSystem.prewarmMaterials()` needs
 * every material a variant will ever ask for so their shader programs can be
 * compiled while a loading screen is up, and it must be able to get them WITHOUT
 * building a single triangle (geometry construction draws from the shared RNG
 * stream, so doing it early would move every downstream random draw and change
 * the picture). `SoldierMaterials.get()` is a pure function of its key and opts,
 * so calling it early is free of side effects.
 *
 * `detail` is the second half of the two-scale system: the base tile carries the
 * macro camo and the garment seams, this tile carries the weave and the webbing
 * ribbing. `scale` converts the base tile's UVs (metres / tile) into the detail
 * tile's, so the physical size of a thread is identical on a sleeve, a pouch and
 * a boot without any per-part tuning.
 */
export function resolveMaterials(name, slots, materials) {
  const V = VARIANTS[name] ?? VARIANTS.vanguard;
  /**
   * ────────────────────────────────────────────────────────────────────────
   * A CIVILIAN WEARS NO SIDE'S COLOUR, AND HE CANNOT BE GIVEN ONE BY MISTAKE
   * ────────────────────────────────────────────────────────────────────────
   * Two switches, both off, and both off by OMISSION rather than by a flag
   * somebody has to remember to honour:
   *
   *   `dress: true`  is what sets `owGarment` and is the only thing
   *                  `setTeamDress` will repaint. Without it his jacket keeps
   *                  its own hue for ever — no crimson, no slate.
   *   `variant: name` is what puts a material into `SoldierMaterials.byVariant`,
   *                  which is the ONLY list `setTeamRim` and `setTeamDress`
   *                  walk. Leaving it off makes both of them a no-op that
   *                  returns 0 for this dress, so `AiSystem._noteVariantTeam`
   *                  can record a civilian as team 1 (which he is — every one
   *                  of them is hostile) without that fact reaching a pixel.
   *
   * The rim is the half that matters most. It is a coloured edge on every
   * hostile at range, i.e. a free "this is an enemy" outline, and 「これはゲーム
   * 上アナウンスなし」 means the player's first contact IS the discovery: a
   * militiaman must not be outlined before he is seen, and an unarmed civilian
   * must not be outlined as a valid target at all.
   */
  const civ = V.civil === true;
  const detail = (set, matName, normal, rough) => ({
    set,
    scale: MATERIALS[matName].tile / DETAIL_TILE,
    normal,
    rough,
  });
  /** Undefined for a civilian: see the block above. Every slot goes through it. */
  const side = civ ? undefined : name;
  /** Likewise — the garment flag `setTeamDress` keys on. */
  const dress = civ ? undefined : true;
  return slots.map((n) => {
    switch (n) {
      case 'cloth':
        return materials.get(`camo_${V.camo}`, {
          key: name,
          variant: side,
          tint: V.clothTint,
          // TEAM DRESS: the garment slots take the side's colour. See TEAM_DRESS.
          dress,
          rough: ROUGH.cloth,
          metal: 1,
          // 1.15, not 1.0: the base tile now carries a 1-2 cm crease field and
          // the folds have to actually catch the key light at 25 m.
          normalScale: 1.15,
          detail: detail('cloth', 'cloth', 0.45, 0.16),
        });
      case 'plate':
        return materials.get('plate', {
          key: name,
          variant: side,
          tint: V.plateTint,
          dress,
          rough: ROUGH.plate,
          normalScale: 1.0,
          detail: detail('nylon', 'plate', 0.45, 0.10),
        });
      case 'gear':
        return materials.get('nylon', {
          key: name,
          variant: side,
          tint: V.gearTint,
          dress,
          normalScale: 1.1,
          detail: detail('nylon', 'gear', 0.5, 0.14),
        });
      case 'boot':
        return materials.get('nylon', {
          key: `${name}_boot`,
          variant: side,
          tint: V.gearTint,
          dress,
          rough: ROUGH.boot,
          normalScale: 1.1,
          detail: detail('nylon', 'boot', 0.5, 0.10),
        });
      case 'skin':
        return materials.get('skin', { key: name, variant: side, tint: V.skinTint, normalScale: 0.8, ao: 0.6 });
      case 'polymer':
        return materials.get('polymer', { key: name, variant: side, normalScale: 1.0 });
      case 'steel':
        return materials.get('steel', { key: name, variant: side, normalScale: 1.0 });
      case 'rubber':
        return materials.get('rubber', { key: name, variant: side, normalScale: 1.2 });
      case 'glass':
        return materials.glass();
      default:
        return materials.get('polymer', { key: name, variant: side });
    }
  });
}
