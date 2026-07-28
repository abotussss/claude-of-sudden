/**
 * MATCH — the thing on the ground that says "you are standing on site A".
 *
 * The bomb sites were invisible. `_siteAt` is an 8 m circle on a courtyard that
 * looks exactly like the courtyard next to it, so the only way to know you could
 * plant was to press the key and see whether a prompt appeared. Every demolition
 * map in the genre paints its sites, for exactly this reason.
 *
 * Built here rather than in `src/world` on purpose: the sites are resolved at
 * BOOT, and `resolveLayout` will move one if the level geometry has sealed the
 * authored point off. Marks authored into the level would then be in the wrong
 * place and nothing would say so. Building them from the resolved positions
 * means the paint is always where the trigger is, by construction.
 *
 * Procedural like everything else — a ring, four corner brackets and a block
 * letter, no textures, no text rendering.
 */

import * as THREE from 'three';

const RING_W = 0.32;

export class SiteMarks {
  /**
   * @param {object} ctx    engine context
   * @param {Array}  sites  resolved sites: { id, position, radius }
   */
  constructor(ctx, sites) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'match-site-marks';
    this._geos = [];

    /**
     * PAINTED CONCRETE, from the shared library — not a bare
     * MeshStandardMaterial.
     *
     * The first version was a flat `MeshStandardMaterial` in saturated yellow,
     * and standing on it at eye level it read as a sheet of coloured plastic
     * laid on the road. ARCHITECTURE.md's quality bar forbids exactly that:
     * "No flat/untextured surfaces. Every material needs albedo variation, a
     * normal map, roughness variation, and a detail layer visible at 0.5 m."
     * Road paint is the easiest thing in the world to get wrong that way, and I
     * only caught it because I finally looked from a standing eye rather than
     * from directly overhead — the one view that flatters flat geometry.
     *
     * Taking `concrete_floor` and tinting it keeps the surface's own grain,
     * wear and normal map underneath the colour, which is what worn line
     * marking actually looks like.
     */
    const lib = ctx.peek('materials');
    this.paint =
      lib?.get?.('concrete_floor', {
        tint: 0xd8ad22,
        roughness: [0.74, 0.16, 0.4],
        wear: [0.42, 0.8, 0.6, 0],
      }) ??
      new THREE.MeshStandardMaterial({ color: 0xc8a01c, roughness: 0.82 });
    this._ownMaterial = !lib?.get;

    for (const s of sites) this._buildOne(s);
    ctx.scene.add(this.group);
  }

  _buildOne(site) {
    const r = site.radius;
    const y = site.position.y + 0.012; // just proud, so it never z-fights the road

    // --- the perimeter ring, drawn as a flat annulus -----------------------
    const ring = new THREE.RingGeometry(r - RING_W, r, 48, 1);
    ring.rotateX(-Math.PI / 2);
    this._add(ring, site.position.x, y, site.position.z);

    // --- four corner brackets, so the shape reads even where the ring is
    //     hidden under a crate ------------------------------------------------
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const cx = site.position.x + Math.cos(a) * (r - 1.1);
      const cz = site.position.z + Math.sin(a) * (r - 1.1);
      /**
       * A real L, not a plus. The two bars have to be OFFSET by half their own
       * length or they cross at the centre and draw a "+", which is what the
       * first version did — legible, but it reads as a marker pin rather than
       * as the corner of a zone.
       */
      const L = 1.9;
      for (const [ox, oz, w, d] of [
        [L * 0.5, 0, L, RING_W],
        [0, L * 0.5, RING_W, L],
      ]) {
        const g = new THREE.BoxGeometry(w, 0.02, d);
        g.translate(ox, 0, oz);
        g.rotateY(a);
        this._add(g, cx, y, cz);
      }
    }

    // --- the letter, lying on the ground at the centre ---------------------
    /**
     * 2.6 m, and OFF CENTRE.
     *
     * It was 4.5 m in the middle of the circle, sized from a top-down capture.
     * From a standing eye, on the site, that is not a letter — it is one
     * enormous yellow shape under your feet that you cannot read at all. A
     * ground glyph is read from a DISTANCE and at a shallow angle, so it wants
     * to be modest and set back toward the edge where the approach sees it,
     * not sat on.
     */
    const off = r * 0.45;
    for (const g of letterStrokes(site.id, 2.6)) {
      g.rotateX(-Math.PI / 2);
      this._add(g, site.position.x, y + 0.004, site.position.z - off);
    }
  }

  _add(geo, x, y, z) {
    geo.translate(x, y, z);
    const m = new THREE.Mesh(geo, this.paint);
    m.receiveShadow = true;
    m.castShadow = false;
    // Paint on a road is not a shadow caster and not worth a prepass slot.
    m.userData.owNoShadow = true;
    m.userData.owNoPrepass = true;
    this.group.add(m);
    this._geos.push(geo);
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const g of this._geos) g.dispose();
    this._geos.length = 0;
    // Library materials are shared and owned by `materials`; only free our own.
    if (this._ownMaterial) this.paint.dispose();
  }
}

/**
 * Block letters from boxes, authored in a 1x1 square and scaled to `size`.
 * Only the two glyphs the mode uses — adding more is a matter of listing
 * strokes, not of pulling in a font.
 */
function letterStrokes(ch, size) {
  const t = 0.2; // stroke thickness, in glyph units
  /** [cx, cy, w, h, rot] in glyph units, origin at the centre. */
  const STROKES = {
    // A: two legs and a crossbar
    A: [
      [-0.24, 0, t, 1.0, 0.26],
      [0.24, 0, t, 1.0, -0.26],
      [0, -0.16, 0.62, t, 0],
    ],
    // B: spine plus two bowls, squared off — a block B, not a typeface B
    B: [
      [-0.3, 0, t, 1.0, 0],
      [0.02, 0.4, 0.5, t, 0],
      [0.02, 0.0, 0.5, t, 0],
      [0.02, -0.4, 0.5, t, 0],
      [0.28, 0.2, t, 0.4, 0],
      [0.28, -0.2, t, 0.4, 0],
    ],
  };
  const list = STROKES[ch] ?? STROKES.A;
  return list.map(([cx, cy, w, h, rot]) => {
    const g = new THREE.BoxGeometry(w * size, h * size, 0.02);
    if (rot) g.rotateZ(rot);
    g.translate(cx * size, cy * size, 0);
    return g;
  });
}
