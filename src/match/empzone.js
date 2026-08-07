import * as THREE from 'three';

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
 * 4. WHERE THEY ARE, AND WHY THEY ARE NOT WIRED THROUGH `MatchSystem`
 * ──────────────────────────────────────────────────────────────────────────
 * Derived, not authored: `ctx.peek('world').level.pads` is the plain's own
 * published pad table (`PADS` in `src/world/levels/plains.js`), and the field on
 * a pad is that pad's own `r1` — the radius at which its flattening has finished
 * blending back into the swell. So the field is exactly the made ground, and if
 * anybody moves zone A the field moves with it with nothing to keep in sync.
 * There is no entry in `MAP_RULES`, no line in `MatchSystem` and no second parse
 * of `?map=`: the selector is `world.level.id`, which is the rule
 * `src/match/geography.js` exists to state.
 *
 * ZONES A AND B, WHICH IS TWO OF FIVE AND ONE PER SIDE. A is the north side's
 * shoulder (-118, -104) and B is the south's (118, 104): they are the FURTHEST
 * PAIR ON THE MAP, 314.6 m apart on opposite corners, which is the placement
 * that matters. Two fields next to each other would be one 70 m no-fly area on
 * one flank; at opposite corners each side has exactly one piece of drone-proof
 * ground and it is the piece furthest from the other man's. Between them they
 * take about 7 % of the play area. The middle — D with its tower and its
 * fortress, C, E, both bases and every metre between them — is drone country,
 * which it has to be or twenty launches a match have nowhere to go.
 *
 * THE TOWN GETS NONE, and that is a decision rather than an omission. The town
 * is the map the player actually plays; its counter-play to a drone is already
 * authored and already measured (「one second out of its sight drops the lock —
 * the eight enterable buildings and every alley on this map are all inside that
 * second」), and dropping two 34 m domes into a street plan he knows would be a
 * change to a working map that nobody asked for. The plain is the map with no
 * roofs, and it is the map that needed this.
 */

/** Green-white. NOT the friend hex and NOT the enemy hex. @see the header. */
const EMP_HEX = 0x7dffd6;
/** Which pads carry a field. @see the header for why two, and why these two. */
const EMP_PADS = ['A', 'B'];
/** Posts around the rim: the boundary at eye level. */
const POSTS = 14;
const POST_H = 11.5;
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

    float uFar = mix(1.0, 0.34, smoothstep(90.0, 300.0, d));
    float uNear = smoothstep(0.5, 4.0, d);
    a *= uFar * mix(uNear * mix(0.5, 1.0, prox), 1.0, uGround);

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
    const pads = world?.level?.pads;
    if (!Array.isArray(pads) || !pads.length) { this.ready = true; return this; }

    const dome = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const post = new THREE.CylinderGeometry(0.26, 0.85, POST_H, 7, 1, true);
    this._geo.push(dome, post);

    for (const id of EMP_PADS) {
      const p = pads.find((q) => q.id === id);
      if (!p) continue;
      const y = world.groundHeight ? world.groundHeight(p.x, p.z) : (p.y ?? 0);
      const r = p.r1 ?? p.r0 ?? 30;
      const z = new Zone(id, p.x, y, p.z, r);

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
      g.name = `emp-${id}`;
      const shell = new THREE.Mesh(dome, z.mat);
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
       */
      for (let i = 0; i < POSTS; i++) {
        const a = (i / POSTS) * Math.PI * 2;
        const px = z.position.x + Math.cos(a) * r;
        const pz = z.position.z + Math.sin(a) * r;
        const py = world.groundHeight ? world.groundHeight(px, pz) : z.position.y;
        const m = new THREE.Mesh(post, z.mat);
        m.position.set(px, py + POST_H * 0.5 - 0.4, pz);
        m.userData.owNoShadow = true;
        m.userData.owNoPrepass = true;
        m.renderOrder = 6;
        g.add(m);
      }

      const band = this._ringGeometry(world, z);
      this._geo.push(band);
      const ring = new THREE.Mesh(band, z.ringMat);
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
      console.info(
        `[match] EMP: ${this.zones.length} field(s) — ` +
          this.zones.map((z) => `${z.id} r${z.r.toFixed(0)}m at (${z.position.x.toFixed(0)}, ${z.position.z.toFixed(0)})`).join(' · ')
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
    const N = 128;
    const pos = new Float32Array(N * 2 * 3);
    const nor = new Float32Array(N * 2 * 3);
    const idx = new Uint16Array(N * 6);
    const gy = (x, zz) => (world.groundHeight ? world.groundHeight(x, zz) : z.position.y);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const cx = Math.cos(a), cz = Math.sin(a);
      for (let k = 0; k < 2; k++) {
        const rr = z.r + (k === 0 ? -1.7 : 1.7);
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
  deflect(from, want, margin = 8) {
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      const R = z.r + margin;
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
