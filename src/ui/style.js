import { FONT_STACK, FONT_DISPLAY, FONT_MONO } from './util.js';

/**
 * All HUD styling lives here as one injected stylesheet.
 *
 * Design system
 * -------------
 *  scale     every dimension is `calc(N * var(--k))` where --k is set from the
 *            viewport height (1080p == 1.0). The HUD therefore holds its
 *            proportions from 720p to 4K without re-authoring.
 *  spacing   4px grid: --u. Screen margins are 6u (24px @1080p), the same
 *            margin CoD uses (~2.2% of height).
 *  type      one condensed system stack, uppercase, tabular figures, three
 *            ink levels (94% / 58% / 30%) and one accent per semantic:
 *            amber = caution, red = threat, cyan = friendly/objective.
 *  contrast  every text run carries a two-stop shadow (tight dark + wide
 *            dark bloom) so it survives a blown-out sky *and* a black
 *            interior without a scrim behind it.
 */

const CSS = `
.ow-hud, .ow-hud * { margin:0; padding:0; box-sizing:border-box; }

.ow-hud {
  --k: 1;
  --u: calc(4px * var(--k));
  --pad: calc(var(--u) * 6.5);

  --ink:   rgba(238,244,247,.95);
  --ink-2: rgba(214,227,234,.60);
  --ink-3: rgba(196,210,219,.30);
  --hair:  rgba(255,255,255,.15);
  --hair-2:rgba(255,255,255,.07);

  --amber: #ffb02a;
  --red:   #ff3f31;
  --blood: #8d0f0a;
  --cyan:  #79d2ff;
  --friend:#8fc8ff;
  --enemy: #ff7a63;
  --ok:    #a8e86a;

  --sh: 0 1px 2px rgba(0,0,0,.92), 0 0 calc(10px * var(--k)) rgba(0,0,0,.45);
  --sh-hard: 0 1px 1px rgba(0,0,0,.95);

  /* Symmetric synthesized outlines. An offset drop-shadow is a web-overlay
     tell and it fights whatever direction the scene key light comes from; a
     ring of eight equal-radius hard shadows reads as a drawn outline and is
     direction-free. Each is paired with one tight soft shadow for the seat. */
  --oc: #080c10;
  --o1:
    calc(1.5px * var(--k)) 0 0 var(--oc), calc(-1.5px * var(--k)) 0 0 var(--oc),
    0 calc(1.5px * var(--k)) 0 var(--oc), 0 calc(-1.5px * var(--k)) 0 var(--oc),
    calc(1.1px * var(--k)) calc(1.1px * var(--k)) 0 var(--oc),
    calc(-1.1px * var(--k)) calc(1.1px * var(--k)) 0 var(--oc),
    calc(1.1px * var(--k)) calc(-1.1px * var(--k)) 0 var(--oc),
    calc(-1.1px * var(--k)) calc(-1.1px * var(--k)) 0 var(--oc);
  --o2:
    calc(2px * var(--k)) 0 0 var(--oc), calc(-2px * var(--k)) 0 0 var(--oc),
    0 calc(2px * var(--k)) 0 var(--oc), 0 calc(-2px * var(--k)) 0 var(--oc),
    calc(1.45px * var(--k)) calc(1.45px * var(--k)) 0 var(--oc),
    calc(-1.45px * var(--k)) calc(1.45px * var(--k)) 0 var(--oc),
    calc(1.45px * var(--k)) calc(-1.45px * var(--k)) 0 var(--oc),
    calc(-1.45px * var(--k)) calc(-1.45px * var(--k)) 0 var(--oc);
  /* outline + tight soft seat, no directional offset */
  --sh-o1: var(--o1), 0 0 calc(4px * var(--k)) rgba(3,6,9,.8);
  --sh-o2: var(--o2), 0 0 calc(5px * var(--k)) rgba(3,6,9,.85);

  --ff: ${FONT_STACK};
  --fd: ${FONT_DISPLAY};
  --fm: ${FONT_MONO};

  position: fixed; inset: 0;
  pointer-events: none;
  z-index: 10;
  font-family: var(--ff);
  font-weight: 600;
  color: var(--ink);
  letter-spacing: .06em;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "lnum" 1;
  -webkit-font-smoothing: antialiased;
  text-transform: uppercase;
  overflow: hidden;
  contain: layout style;
  user-select: none;
}

.ow-hud .lbl {
  font-size: calc(10.5px * var(--k));
  letter-spacing: .2em;
  color: var(--ink-2);
  text-shadow: var(--sh);
}
.ow-layer { position:absolute; inset:0; }

/* ============================================================== crosshair */
.ow-cross { position:absolute; left:50%; top:50%; width:0; height:0; }
.ow-blade {
  position:absolute; left:0; top:0;
  width: calc(1.6px * var(--k));
  height: calc(8px * var(--k));
  margin-left: calc(-0.8px * var(--k));
  margin-top: calc(-4px * var(--k));
  background: linear-gradient(to top, rgba(255,255,255,.62), #fff 62%);
  box-shadow: 0 0 0 1px rgba(0,0,0,.55), 0 0 calc(3px * var(--k)) rgba(0,0,0,.75);
  transform-origin: 50% 50%;
  will-change: transform, opacity;
}
.ow-dot {
  position:absolute; left:0; top:0;
  width: calc(2.2px * var(--k)); height: calc(2.2px * var(--k));
  margin-left: calc(-1.1px * var(--k)); margin-top: calc(-1.1px * var(--k));
  background:#fff; border-radius:50%;
  box-shadow: 0 0 0 1px rgba(0,0,0,.6), 0 0 calc(4px * var(--k)) rgba(0,0,0,.7);
  will-change: opacity, transform;
}
/* thin lower "shotgun" reference tick — reads as a real reticle, not a plus */
.ow-cross-ads { position:absolute; left:0; top:0; }

/* ============================================================ hitmarkers */
.ow-hit {
  position:absolute; left:50%; top:50%;
  width: calc(56px * var(--k)); height: calc(56px * var(--k));
  margin-left: calc(-28px * var(--k)); margin-top: calc(-28px * var(--k));
  will-change: transform, opacity;
}
.ow-hit svg { width:100%; height:100%; display:block; overflow:visible; }

/* =============================================== directional damage arcs */
.ow-dmg {
  position:absolute; left:50%; top:50%;
  width: calc(340px * var(--k)); height: calc(340px * var(--k));
  margin-left: calc(-170px * var(--k)); margin-top: calc(-170px * var(--k));
  will-change: transform, opacity;
}
.ow-dmg svg { width:100%; height:100%; display:block; overflow:visible; }

/* ============================================================ hurt state */
.ow-blood { position:absolute; inset:-7%; will-change: opacity, transform; }
.ow-blood-a {
  position:absolute; inset:0;
  background:
    radial-gradient(ellipse 78% 74% at 50% 50%, rgba(0,0,0,0) 62%, rgba(122,14,10,.30) 86%, rgba(74,8,5,.60) 100%);
  filter: url(#ow-warp);
}
.ow-blood-b {
  position:absolute; inset:0; opacity:.5; mix-blend-mode:multiply;
  background:
    radial-gradient(circle at 2% 22%,  rgba(96,10,8,.75) 0, rgba(96,10,8,0) 17%),
    radial-gradient(circle at 99% 58%, rgba(96,10,8,.7) 0, rgba(96,10,8,0) 15%),
    radial-gradient(circle at 26% 101%,rgba(88,10,8,.75) 0, rgba(88,10,8,0) 19%),
    radial-gradient(circle at 74% -2%, rgba(88,10,8,.7) 0, rgba(88,10,8,0) 18%);
  filter: url(#ow-warp);
}
.ow-desat { position:absolute; inset:0; backdrop-filter: saturate(.6) contrast(1.04) brightness(.97); }
.ow-hitflash { position:absolute; inset:0;
  background: radial-gradient(ellipse 90% 86% at 50% 50%, rgba(150,16,10,.22) 40%, rgba(160,18,12,.62) 100%);
  mix-blend-mode:screen; }
.ow-lowbeat {
  position:absolute; inset:0;
  background: radial-gradient(ellipse 76% 70% at 50% 50%, rgba(0,0,0,0) 64%, rgba(150,14,10,.34) 100%);
}

/* ====================================================== vitals (bottom left)
   The most important number on the screen, so it gets the mirror position to
   the ammo block: bottom-left of the safe area, labelled, with a numeric
   readout and a genuinely dark track so the empty part of the bar is legible
   over sunlit gravel. Armour is a visually distinct second row — thinner,
   cyan, plate-segmented — so it can never be mistaken for health. */
.ow-vitals {
  position:absolute; left:var(--pad); bottom:var(--pad);
  width: calc(196px * var(--k));
}
.ow-vt-head {
  display:flex; align-items:baseline; justify-content:space-between;
  margin-bottom: calc(var(--u) * 1.1);
}
.ow-vt-lbl {
  font-size: calc(9.5px * var(--k)); letter-spacing:.24em; color: var(--ink-2);
  text-shadow: var(--sh-o1);
}
.ow-vt-num {
  font-family: var(--fd); font-size: calc(26px * var(--k)); font-weight:700;
  letter-spacing:.02em; line-height:.85; color: var(--ink);
  text-shadow: var(--o2), 0 0 calc(12px * var(--k)) rgba(0,0,0,.5);
  will-change: color, transform;
}
.ow-vt-num i {
  font-style:normal; font-family: var(--ff); font-size: calc(11px * var(--k));
  color: var(--ink-3); letter-spacing:.1em; margin-left: calc(2px * var(--k));
}
/* health track: dark well + hairline, five 20 HP segments */
.ow-vt-track {
  position:relative; height: calc(9px * var(--k));
  background: rgba(5,9,12,.72);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.55), 0 0 0 1px rgba(216,232,240,.16),
              0 calc(1px * var(--k)) calc(4px * var(--k)) rgba(0,0,0,.5);
  overflow:hidden;
}
.ow-vt-track > i {
  position:absolute; left:0; top:0; bottom:0; width:100%;
  transform-origin:left center;
  background: linear-gradient(to bottom, #fbfdfc 0%, #e1e7e4 46%, #b3bcb9 100%);
  will-change: transform;
}
.ow-vt-track > u {
  position:absolute; left:0; right:0; top:0; bottom:0;
  background-image: repeating-linear-gradient(to right,
    rgba(0,0,0,0) 0, rgba(0,0,0,0) calc(20% - 1px),
    rgba(4,8,11,.85) calc(20% - 1px), rgba(4,8,11,.85) 20%);
}
.ow-vitals.low .ow-vt-track > i { background: linear-gradient(to bottom, #ffd98a, #f2a01c); }
.ow-vitals.low .ow-vt-num { color: var(--amber); }
.ow-vitals.crit .ow-vt-track > i { background: linear-gradient(to bottom, #ff8b7a, #e02414); }
.ow-vitals.crit .ow-vt-num { color: var(--red); }
/* MED KIT, under the health bar and only while he is below full. A red cross
   and one line: how far, or HOLD F, or how many seconds until the post is back.
   Same symbol as the world marker and the standard on the ground, so the three
   are recognisably one feature. */
.ow-vt-med {
  display:flex; align-items:center; gap: calc(var(--u) * 1.2);
  margin-top: calc(var(--u) * 1.2);
  font-size: calc(9.5px * var(--k)); letter-spacing:.2em; font-weight:700;
  color: rgba(255,214,206,.92); text-shadow: var(--sh-o1);
  will-change: opacity;
}
.ow-vt-med > i {
  position:relative; display:block; flex:none;
  width: calc(11px * var(--k)); height: calc(11px * var(--k));
  background: #e02b1c; box-shadow: 0 0 0 1px rgba(0,0,0,.6);
}
/* the cross itself: two bars, so it survives at 11 px with no glyph rendering */
.ow-vt-med > i::before, .ow-vt-med > i::after {
  content:''; position:absolute; background:#fff;
}
.ow-vt-med > i::before { left:calc(4px * var(--k)); top:calc(2px * var(--k));
  width:calc(3px * var(--k)); height:calc(7px * var(--k)); }
.ow-vt-med > i::after  { top:calc(4px * var(--k)); left:calc(2px * var(--k));
  height:calc(3px * var(--k)); width:calc(7px * var(--k)); }
.ow-vt-med.reach { color:#ffffff; }
.ow-vt-med.cold { color: var(--ink-3); }
.ow-vt-med.cold > i { background: #6a3630; }

/* armour: thinner, cyan, plate-segmented, its own label */
.ow-armour {
  display:flex; align-items:center; gap: calc(var(--u) * 1.4);
  margin-top: calc(var(--u) * 1.5);
}
.ow-armour .ow-vt-lbl { color: rgba(150,206,238,.7); }
.ow-arm-plates { display:flex; gap: calc(var(--u) * .8); flex:1; }
.ow-plate {
  flex:1; height: calc(5px * var(--k));
  background: rgba(5,9,12,.7);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.5), 0 0 0 1px rgba(121,190,230,.18);
  position:relative; overflow:hidden;
}
.ow-plate i {
  position:absolute; left:0; top:0; bottom:0; width:100%;
  background: linear-gradient(to bottom, #bde9ff, #3ba6e2);
  transform-origin: left center;
}

/* ================================================================== ammo
   The whole block is ONE column of fixed width (--ammo-w) pinned to the right
   margin, so every row shares the same left edge and no row can ever grow
   sideways into another. Rows are explicit grids with an 8px gutter; the
   equipment counts get their own row above the weapon name rather than sharing
   the head row, which is what used to collide. */
.ow-ammo {
  position:absolute; right:var(--pad); bottom:var(--pad);
  --ammo-w: calc(168px * var(--k));
  --gut: calc(8px * var(--k));
  width: var(--ammo-w);
  text-align:right; line-height:1;
}
.ow-ammo-head {
  display:grid; grid-auto-flow:column; grid-auto-columns:max-content;
  justify-content:end; align-items:center;
  column-gap: var(--gut); margin-bottom:calc(var(--u) * 1.1);
}
.ow-ammo-name {
  font-size: calc(12.5px * var(--k)); letter-spacing:.22em;
  color: var(--ink); text-shadow: var(--sh-o1);
  white-space:nowrap; overflow:hidden; text-overflow:clip;
  max-width: calc(var(--ammo-w) - 52px * var(--k));
}
.ow-ammo-mode {
  font-size: calc(9.5px * var(--k)); letter-spacing:.2em; color: var(--ink-2);
  border:1px solid var(--hair); padding: calc(1.5px * var(--k)) calc(4px * var(--k));
  background: rgba(6,10,13,.34);
  text-shadow: var(--sh-hard); white-space:nowrap;
}
.ow-ammo-row {
  display:grid; grid-auto-flow:column; grid-auto-columns:max-content;
  justify-content:end; align-items:baseline;
  column-gap: calc(var(--gut) * .55);
}
.ow-ammo-cur {
  font-family: var(--fd);
  font-size: calc(56px * var(--k)); font-weight:700; letter-spacing:.02em;
  color: var(--ink); text-shadow: var(--o2), 0 0 calc(16px * var(--k)) rgba(0,0,0,.55);
  will-change: color, transform;
}
.ow-ammo-sep { font-size: calc(20px * var(--k)); color: var(--ink-3); font-weight:400;
  text-shadow: var(--sh-o1); }
.ow-ammo-res { font-family: var(--fd); font-size: calc(24px * var(--k)); color: var(--ink-2);
  text-shadow: var(--sh-o1); }
.ow-ammo-low .ow-ammo-cur { color: var(--amber); }
.ow-ammo-empty .ow-ammo-cur { color: var(--red); }

.ow-mag {
  display:flex; justify-content:flex-end; gap: calc(1.6px * var(--k));
  margin-top: calc(var(--u) * 1.1);
}
.ow-mag b {
  display:block; width: calc(2.6px * var(--k)); height: calc(10px * var(--k));
  background: var(--ink); box-shadow: 0 0 0 1px rgba(4,8,11,.75);
}
/* spent rounds read as an empty *socket*, not a pale ghost: a dark well is the
   only thing that survives gravel at this size */
.ow-mag b.off { background: rgba(6,10,13,.62); box-shadow: 0 0 0 1px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.07); }
.ow-mag b.warn { background: var(--amber); }

.ow-reload {
  margin-top: calc(var(--u) * 1.6);
  font-size: calc(10.5px * var(--k)); letter-spacing:.28em; color: var(--amber);
  text-shadow: var(--sh-o1);
}
.ow-reload-bar {
  margin-top: calc(var(--u) * .8); margin-left:auto; margin-right:0;
  width: calc(86px * var(--k)); height: calc(2.5px * var(--k));
  background: rgba(6,10,13,.7); box-shadow: 0 0 0 1px rgba(0,0,0,.4);
}
.ow-reload-bar i { display:block; height:100%; width:0; background: var(--amber); transform-origin:left; }

/* equipment: its own row, in flow, above the weapon name */
.ow-equip {
  display:grid; grid-auto-flow:column; grid-auto-columns:max-content;
  justify-content:end; align-items:center;
  column-gap: calc(var(--gut) * 2); margin-bottom: calc(var(--u) * 1.4);
}
.ow-slot {
  display:grid; grid-auto-flow:column; grid-auto-columns:max-content;
  align-items:center; column-gap: var(--gut); opacity:.9;
}
.ow-slot svg { width: calc(13px * var(--k)); height: calc(16.5px * var(--k)); display:block;
  filter: drop-shadow(0 0 calc(2px * var(--k)) rgba(0,0,0,.95)); }
.ow-slot span { font-size: calc(11px * var(--k)); color: var(--ink-2); text-shadow: var(--sh-o1);
  min-width: calc(7px * var(--k)); text-align:left; }
.ow-slot.empty { opacity:.34; }
/* The frag resupply clock. Amber because it is a caution, not a count, and it
   is only in the DOM while it is running. */
.ow-slot-cd { font-size: calc(9px * var(--k)); letter-spacing:.14em; color: var(--amber);
  text-shadow: var(--sh-o1); }

/* ============================================================== killfeed */
.ow-killfeed {
  position:absolute; right:var(--pad); top:calc(var(--pad) + var(--u) * 2);
  display:flex; flex-direction:column; align-items:flex-end;
  gap: calc(var(--u) * 1.1);
}
/* Rows sit in the top right, which in daylight is sky: the scrim has to be
   dark and dense enough to matter (58%), feathered only at the far end so it
   dissolves instead of terminating in a rectangle. */
.ow-kf-row {
  position:relative;
  display:flex; align-items:center; gap: calc(var(--u) * 1.6);
  font-size: calc(13.5px * var(--k)); letter-spacing:.09em;
  padding: calc(var(--u) * .8) calc(var(--u) * 1.5);
  border-right: calc(2px * var(--k)) solid rgba(255,255,255,.18);
  text-shadow: var(--sh-o1);
  will-change: transform, opacity;
}
.ow-kf-row::before {
  content:''; position:absolute; inset:0; z-index:-1;
  background: rgba(5,9,12,.58);
  -webkit-mask-image: linear-gradient(to right, rgba(0,0,0,0) 0%, #000 22%, #000 100%);
          mask-image: linear-gradient(to right, rgba(0,0,0,0) 0%, #000 22%, #000 100%);
}
.ow-kf-row.mine::before { background: rgba(26,17,3,.66); }
.ow-kf-row.mine { border-right-color: var(--amber); }
.ow-kf-a { color: var(--friend); }
.ow-kf-v { color: var(--enemy); }
.ow-kf-row.mine .ow-kf-a { color: #fff; }
.ow-kf-w { display:flex; align-items:center; gap:calc(var(--u) * .8); opacity:.9; }
.ow-kf-w svg { width: calc(31px * var(--k)); height: calc(12px * var(--k)); display:block;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,.9)); }
.ow-kf-hs svg { width: calc(12px * var(--k)); height: calc(12px * var(--k)); display:block;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,.9)); }

/* =============================================================== compass */
.ow-compass {
  position:absolute; left:50%; top:calc(var(--pad) * .7);
  width: calc(470px * var(--k)); height: calc(41px * var(--k));
  transform: translateX(-50%);
  -webkit-mask-image: linear-gradient(to right, transparent, #000 16%, #000 84%, transparent);
          mask-image: linear-gradient(to right, transparent, #000 16%, #000 84%, transparent);
  overflow:hidden;
}
/* Scrim: 45% dark behind the tape, feathered horizontally over the outer 20%
   at each end so it dissolves rather than terminating in a rectangle, and
   rolled off at the very top and bottom edge. The previous 23-29% version was
   too weak to do anything at all against blown cloud — grey cardinals on white
   sky, unreadable. The glyphs additionally carry a symmetric dark outline. */
.ow-compass::before {
  content:''; position:absolute; inset:0;
  background: linear-gradient(to bottom,
    rgba(3,6,9,0) 0%, rgba(3,6,9,.45) 20%, rgba(3,6,9,.45) 66%,
    rgba(3,6,9,.20) 88%, rgba(3,6,9,0) 100%);
  -webkit-mask-image: linear-gradient(to right, rgba(0,0,0,0) 0%, #000 20%, #000 80%, rgba(0,0,0,0) 100%);
          mask-image: linear-gradient(to right, rgba(0,0,0,0) 0%, #000 20%, #000 80%, rgba(0,0,0,0) 100%);
}
/* NO will-change:transform HERE — deliberate, do not "optimise" it back.
   It promoted the strip to its own composited layer, and a composited layer is
   rasterised ONCE at whatever sub-pixel raster translation its transform happened
   to have at the moment the compositor first rastered it; later transform changes
   only move the cached texture. That moment is wall-clock bound, so the anti-
   aliasing of all 144 ticks and the cardinal labels depended on how long boot took
   — the single remaining reason enabling shader pre-warm shifted pixels after the
   capture harness was made frame-deterministic (~0.06% of pixels, up to 70/255,
   confined to this strip). Unpromoted, the strip is repainted from its current
   transform every frame, which is a pure function of heading. The paint is a
   470x41 css-px band; the hint was not buying anything measurable. */
.ow-compass-strip { position:absolute; left:0; top:0; height:100%; }
.ow-tick {
  position:absolute; top: calc(19px * var(--k));
  width:1px; background: rgba(255,255,255,.7);
  height: calc(4px * var(--k));
  box-shadow: 0 0 0 1px rgba(4,8,11,.6), 0 0 calc(2px * var(--k)) rgba(0,0,0,.9);
}
.ow-tick.maj { height: calc(7.5px * var(--k)); width: calc(1.5px * var(--k)); background: rgba(255,255,255,.95); }
.ow-tick-l {
  position:absolute; top: calc(1px * var(--k)); transform: translateX(-50%);
  font-size: calc(13.5px * var(--k)); letter-spacing:.1em; font-weight:700;
  color: #fff; text-shadow: var(--sh-o1);
}
.ow-tick-l.sub { font-size: calc(10px * var(--k)); font-weight:700; color: rgba(233,243,249,.9);
  top: calc(3.5px * var(--k)); }
.ow-compass-base {
  position:absolute; left:0; right:0; top: calc(18px * var(--k)); height:1px;
  background: linear-gradient(to right, transparent, rgba(255,255,255,.4), transparent);
  box-shadow: 0 1px 0 rgba(4,8,11,.5);
}
.ow-compass-caret {
  position:absolute; left:50%; top:calc(12.5px * var(--k)); transform:translateX(-50%);
  width:0; height:0;
  border-left: calc(4.5px * var(--k)) solid transparent;
  border-right: calc(4.5px * var(--k)) solid transparent;
  border-top: calc(5.5px * var(--k)) solid var(--amber);
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.95));
}
.ow-compass-obj {
  position:absolute; top: calc(28px * var(--k)); transform:translateX(-50%);
  font-size: calc(9.5px * var(--k)); letter-spacing:.06em;
  width: calc(13px * var(--k)); height: calc(13px * var(--k));
  display:flex; align-items:center; justify-content:center;
  color:#08161c; background: var(--cyan);
  box-shadow: 0 1px 2px rgba(0,0,0,.8);
  will-change: transform;
}

/* ============================================================= match bar */
.ow-match {
  position:absolute; left:50%; top:calc(var(--pad) * .7 + 45px * var(--k));
  transform: translateX(-50%);
  display:flex; align-items:center; gap: calc(var(--u) * 2.5);
  font-size: calc(11px * var(--k)); letter-spacing:.18em;
  color: var(--ink-2); text-shadow: var(--sh-o1);
}
.ow-match b { font-family: var(--fd); font-size: calc(19px * var(--k)); font-weight:700;
  letter-spacing:.04em; }
.ow-match .us { color: var(--friend); }
.ow-match .them { color: var(--enemy); }
.ow-match .clock { color: var(--ink); font-variant-numeric: tabular-nums; }
.ow-match .sep { width:1px; height: calc(11px * var(--k)); background: var(--hair); }

/* =============================================================== minimap */
.ow-minimap {
  position:absolute; left:var(--pad); top:var(--pad);
  width: calc(178px * var(--k)); height: calc(178px * var(--k));
}
/* scrim — a soft dark plate a few px larger than the widget so the map sits on
   the frame instead of floating on top of it. Behind the canvas, so it only
   reads in the margin, under the corner brackets and the N / zone labels. */
.ow-minimap::before {
  content:''; position:absolute;
  inset: calc(-7px * var(--k));
  border-radius: calc(10px * var(--k));
  background: rgba(4,8,11,.07);
  box-shadow: 0 0 calc(16px * var(--k)) calc(6px * var(--k)) rgba(4,8,11,.05);
  pointer-events:none;
}
/* The panel used to be the darkest thing in a frame whose sky tops out at 236,
   which pulled the eye straight into the corner. Its plate now sits in the
   mid-lows (see minimap.js) and the drop shadow is lighter to match. */
.ow-minimap canvas {
  position:absolute; inset:0; width:100%; height:100%; display:block;
  border-radius: calc(4px * var(--k));
  box-shadow: inset 0 0 0 1px rgba(196,220,238,.16), 0 calc(2px * var(--k)) calc(10px * var(--k)) rgba(0,0,0,.3);
}
.ow-mm-corner { position:absolute; width:calc(9px * var(--k)); height:calc(9px * var(--k)); }
.ow-mm-corner::before, .ow-mm-corner::after { content:''; position:absolute; background:rgba(255,255,255,.32); }
.ow-mm-corner::before { width:100%; height:1px; }
.ow-mm-corner::after { width:1px; height:100%; }
.ow-mm-corner.tl { left:calc(-1px * var(--k)); top:calc(-1px * var(--k)); }
.ow-mm-corner.tr { right:calc(-1px * var(--k)); top:calc(-1px * var(--k)); }
.ow-mm-corner.tr::before { right:0; } .ow-mm-corner.tr::after { right:0; }
.ow-mm-corner.bl { left:calc(-1px * var(--k)); bottom:calc(-1px * var(--k)); }
.ow-mm-corner.bl::before { bottom:0; }
.ow-mm-corner.br { right:calc(-1px * var(--k)); bottom:calc(-1px * var(--k)); }
.ow-mm-corner.br::before { bottom:0; right:0; } .ow-mm-corner.br::after { right:0; }
.ow-mm-n {
  position:absolute; left:50%; top:calc(-13px * var(--k)); transform:translateX(-50%);
  font-size: calc(9.5px * var(--k)); letter-spacing:.2em; color:var(--ink-2); text-shadow:var(--sh);
}
.ow-mm-tag {
  position:absolute; left:0; top:calc(100% + var(--u)); display:flex; gap:calc(var(--u)*1.5);
  font-size: calc(9.5px * var(--k)); letter-spacing:.2em; color:var(--ink-3); text-shadow:var(--sh);
}

/* ========================================================= world markers */
.ow-mk {
  position:absolute; left:0; top:0;
  display:flex; flex-direction:column; align-items:center;
  will-change: transform, opacity;
}
.ow-mk-glyph { position:relative; width:calc(16px * var(--k)); height:calc(16px * var(--k)); }
.ow-mk-glyph svg { position:absolute; inset:0; width:100%; height:100%; display:block; overflow:visible;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.85)); }
.ow-mk-letter {
  position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  font-size: calc(9.5px * var(--k)); color:#08161c; font-weight:700;
}
.ow-mk-dist {
  margin-top: calc(var(--u) * .6);
  font-size: calc(10px * var(--k)); letter-spacing:.12em; color: var(--ink);
  text-shadow: var(--sh);
}
.ow-mk-name { font-size: calc(9px * var(--k)); letter-spacing:.18em; color: var(--ink-2); text-shadow:var(--sh); }
.ow-mk.threat .ow-mk-dist { color: var(--red); }

/* ------------------------------------------------------- friend or foe ---
 * THE TARGET BRACKETS on a hostile, and the tick on a friendly. See
 * WorldMarkers.updateTargets for why one is a bracket and the other is not.
 *
 * The corner arms are a FIXED length and a FIXED border width in HUD units, so
 * the mark reads with the same weight whether the box is 26 px tall at 70 m or
 * 300 px tall at 3 m — the box changes size, the brackets do not change shape.
 * Both marks carry their own dark outline (a drop-shadow) because the map is
 * sunlit plaster: a warm line on a warm wall is invisible without one, which is
 * the same lesson the team rim learned.
 */
.ow-tgt {
  position:absolute; left:0; top:0; color: var(--enemy);
  will-change: transform, width, height, opacity;
  filter: drop-shadow(0 0 calc(1.5px * var(--k)) rgba(0,0,0,.9));
}
.ow-tgt-c {
  position:absolute; width:calc(7px * var(--k)); height:calc(7px * var(--k));
  border:0 solid currentColor; box-sizing:border-box;
}
.ow-tgt-c.tl { left:0;  top:0;    border-left-width:calc(2px * var(--k)); border-top-width:calc(2px * var(--k)); }
.ow-tgt-c.tr { right:0; top:0;    border-right-width:calc(2px * var(--k)); border-top-width:calc(2px * var(--k)); }
.ow-tgt-c.bl { left:0;  bottom:0; border-left-width:calc(2px * var(--k)); border-bottom-width:calc(2px * var(--k)); }
.ow-tgt-c.br { right:0; bottom:0; border-right-width:calc(2px * var(--k)); border-bottom-width:calc(2px * var(--k)); }
/* the centre pip: only while the figure is too small to be a figure */
.ow-tgt-pip {
  position:absolute; left:50%; top:50%; width:calc(3px * var(--k)); height:calc(3px * var(--k));
  margin:calc(-1.5px * var(--k)) 0 0 calc(-1.5px * var(--k));
  background: currentColor; border-radius:50%;
  opacity: var(--pip, 0);
}
/* clamped to the screen edge: keep the corners, drop the pip */
.ow-tgt.edge { color: #ff5a44; }
.ow-tgt.edge .ow-tgt-pip { opacity:0; }

.ow-fr {
  position:absolute; left:0; top:0; color: var(--friend);
  will-change: transform, opacity;
  filter: drop-shadow(0 0 calc(1.5px * var(--k)) rgba(0,0,0,.9));
}
/* a small open chevron, point down, sitting over the head */
.ow-fr-tick {
  position:absolute; left:0; top:0; width:calc(9px * var(--k)); height:calc(9px * var(--k));
  margin:calc(-4.5px * var(--k)) 0 0 calc(-4.5px * var(--k));
  border:0 solid currentColor;
  border-right-width:calc(1.8px * var(--k)); border-bottom-width:calc(1.8px * var(--k));
  box-sizing:border-box; transform: rotate(45deg);
}

/* grenade danger */
.ow-nade { position:absolute; left:0; top:0; will-change: transform, opacity; }
.ow-nade-ring {
  position:absolute; left:50%; top:50%; width:calc(30px * var(--k)); height:calc(30px * var(--k));
  margin:calc(-15px * var(--k)) 0 0 calc(-15px * var(--k));
  border: calc(1.5px * var(--k)) solid var(--red); border-radius:50%;
  will-change: transform, opacity;
}
.ow-nade-core {
  position:absolute; left:50%; top:50%; width:calc(15px * var(--k)); height:calc(15px * var(--k));
  margin:calc(-7.5px * var(--k)) 0 0 calc(-7.5px * var(--k));
}
.ow-nade-core svg { width:100%; height:100%; display:block; filter:drop-shadow(0 1px 2px rgba(0,0,0,.9)); }
.ow-nade-label {
  position:absolute; left:50%; top:calc(13px * var(--k)); transform:translateX(-50%);
  font-size: calc(9px * var(--k)); letter-spacing:.24em; color:var(--red); white-space:nowrap;
  text-shadow: var(--sh);
}

/* ---------------------------------------------------- incoming air (world)
   The impact reticle for an airstrike / bomb stick / cannon line. Bigger and
   colder than the grenade indicator on purpose: a grenade is a thing on the
   floor near you, this is an AREA to leave, and it has to be readable at 90 m.
   '.close' (inside 22 m) goes to full red and gains a seat, because at that
   range the marker is no longer information, it is an instruction. */
.ow-air { position:absolute; left:0; top:0; color:#ff6a52; will-change: transform, opacity; }
.ow-air-ring {
  position:absolute; left:50%; top:50%;
  width:calc(26px * var(--k)); height:calc(26px * var(--k));
  margin:calc(-13px * var(--k)) 0 0 calc(-13px * var(--k));
  border: calc(1.6px * var(--k)) solid currentColor; border-radius:50%;
  box-shadow: 0 0 calc(3px * var(--k)) rgba(0,0,0,.75);
  will-change: transform, opacity;
}
.ow-air-core {
  position:absolute; left:50%; top:50%;
  width:calc(30px * var(--k)); height:calc(30px * var(--k));
  margin:calc(-15px * var(--k)) 0 0 calc(-15px * var(--k));
}
.ow-air-core svg { width:100%; height:100%; display:block;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.95)); }
.ow-air-chev {
  position:absolute; left:50%; top:50%;
  width:calc(22px * var(--k)); height:calc(22px * var(--k));
  margin:calc(-11px * var(--k)) 0 0 calc(-11px * var(--k));
}
.ow-air-chev svg { width:100%; height:100%; display:block; overflow:visible;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.9)); }
.ow-air-label {
  position:absolute; left:50%; top:calc(19px * var(--k)); transform:translateX(-50%);
  font-size: calc(9.5px * var(--k)); letter-spacing:.24em; font-weight:700;
  color: currentColor; white-space:nowrap; text-shadow: var(--sh-o1);
}
.ow-air.close { color: var(--red); }
.ow-air.close .ow-air-label { font-size: calc(11px * var(--k)); }

/* ---------------------------------------------------------- caches (world)
   The pickups, marked where they stand. Supply green when there is something
   to take, dim when the crate is resupplying, and full white with the key on
   it once you are inside the 2.6 m the interaction actually reaches — the
   three states a player has to be able to tell apart from across a street. */
.ow-cache {
  position:absolute; left:0; top:0; color: var(--ok);
  display:flex; flex-direction:column; align-items:center;
  transform-origin: 50% 50%;
  will-change: transform, opacity;
}
.ow-cache-glyph { position:relative; width:calc(17px * var(--k)); height:calc(17px * var(--k)); }
.ow-cache-glyph svg { position:absolute; inset:0; width:100%; height:100%; display:block;
  overflow:visible; filter: drop-shadow(0 1px 2px rgba(0,0,0,.9)); }
.ow-cache-chev { width:calc(15px * var(--k)); height:calc(15px * var(--k)); }
.ow-cache-chev svg { width:100%; height:100%; display:block; overflow:visible;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.9)); }
.ow-cache-label {
  margin-top: calc(var(--u) * .5);
  font-size: calc(10px * var(--k)); letter-spacing:.2em; font-weight:700;
  color: currentColor; white-space:nowrap; text-shadow: var(--sh-o1);
  will-change: transform;
}
.ow-cache-sub {
  font-size: calc(9px * var(--k)); letter-spacing:.2em;
  color: var(--ink-2); white-space:nowrap; text-shadow: var(--sh-o1);
}
.ow-cache.cold { color: var(--ink-3); }
.ow-cache.cold .ow-cache-sub { color: var(--ink-3); }
.ow-cache.reach { color: #ffffff; }
.ow-cache.reach .ow-cache-sub { color: var(--amber); font-weight:700; }
/* MED KIT. Not supply green — a dressing station is not a resupply dump, and
   the whole reported failure is that the two were indistinguishable at any
   range where the 9 px label is unreadable. White ink over the red-cross glyph,
   a hair larger than the other four, and a bigger tap area for the eye. */
.ow-cache.med { color: #ffffff; }
.ow-cache.med .ow-cache-glyph { width:calc(21px * var(--k)); height:calc(21px * var(--k)); }
.ow-cache.med .ow-cache-label { color: #ffffff; }
.ow-cache.med .ow-cache-sub { color: rgba(255,190,180,.9); }
.ow-cache.med.cold .ow-cache-label { color: var(--ink-3); }

/* ---------------------------------------------------------- armour (world)
   THE ENEMY TANK. Same corner-bracket grammar as .ow-tgt — a hostile is marked
   by geometry, not by hue — one size up and with a top rule, so "armour" and
   "a man" are never the same read. The tag hangs above the box with the name,
   what is left of it, and the range. */
.ow-veh {
  position:absolute; left:0; top:0; color: var(--enemy);
  will-change: transform, width, height, opacity;
  filter: drop-shadow(0 0 calc(2px * var(--k)) rgba(0,0,0,.9));
}
.ow-veh-c {
  position:absolute; width:calc(11px * var(--k)); height:calc(9px * var(--k));
  border:0 solid currentColor; box-sizing:border-box;
}
.ow-veh-c.tl { left:0;  top:0;    border-left-width:calc(3px * var(--k)); border-top-width:calc(3px * var(--k)); }
.ow-veh-c.tr { right:0; top:0;    border-right-width:calc(3px * var(--k)); border-top-width:calc(3px * var(--k)); }
.ow-veh-c.bl { left:0;  bottom:0; border-left-width:calc(3px * var(--k)); border-bottom-width:calc(3px * var(--k)); }
.ow-veh-c.br { right:0; bottom:0; border-right-width:calc(3px * var(--k)); border-bottom-width:calc(3px * var(--k)); }
.ow-veh-tag {
  position:absolute; left:50%; bottom:100%; transform:translateX(-50%);
  display:flex; flex-direction:column; align-items:center;
  padding-bottom: calc(var(--u) * .8);
}
.ow-veh-l {
  font-size: calc(10.5px * var(--k)); letter-spacing:.24em; font-weight:700;
  color: currentColor; white-space:nowrap; text-shadow: var(--sh-o1);
}
.ow-veh-track {
  width: calc(46px * var(--k)); height: calc(3px * var(--k));
  margin-top: calc(var(--u) * .4);
  background: rgba(6,12,16,.72); border:calc(1px * var(--k)) solid rgba(0,0,0,.55);
}
.ow-veh-track i {
  display:block; height:100%; width:100%; background: currentColor;
  transform-origin: left; transform: scaleX(1);
}
.ow-veh-d {
  margin-top: calc(var(--u) * .3);
  font-size: calc(9px * var(--k)); letter-spacing:.2em;
  color: var(--ink-2); white-space:nowrap; text-shadow: var(--sh-o1);
}
/* Under a third left: the mark goes amber, which on this HUD has meant
   "the state of this thing is about to change" everywhere else. */
.ow-veh.weak .ow-veh-track i { background: var(--amber); }
.ow-veh.weak .ow-veh-l { color: var(--amber); }
.ow-veh-chev {
  position:absolute; left:50%; top:50%;
  width:calc(20px * var(--k)); height:calc(20px * var(--k));
  margin:calc(-10px * var(--k)) 0 0 calc(-10px * var(--k));
}
.ow-veh-chev svg { width:100%; height:100%; display:block; overflow:visible;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.9)); }
/* Clamped to the edge: the corners would be a box around nothing. */
.ow-veh.edge .ow-veh-c { display:none; }
.ow-veh.edge .ow-veh-track { display:none; }

/* ---------------------------------------------------------- drones (world)
   THE AIRFRAME, MARKED. Corner brackets again — in this HUD corners have meant
   "this is a target" since the infantry mark — at a third the tank's weight and
   with a hard 34 px floor, because the thing being bracketed is 0.62 m across
   and 3 px at the range where finding it matters.

   FRIEND OR FOE IS THE COLOUR AND ALSO THE SHAPE. --enemy with brackets for a
   hostile; --friend with a pip and NO brackets for your own, because a friendly
   drone is not a thing you shoot and a bracket says it is. The hostile/friendly
   split is decided in match from playerTeam and never from a team index. */
.ow-drn {
  position:absolute; left:0; top:0; color: var(--enemy);
  will-change: transform, width, height, opacity;
  filter: drop-shadow(0 0 calc(2px * var(--k)) rgba(0,0,0,.95));
}
.ow-drn-c {
  position:absolute; width:calc(7px * var(--k)); height:calc(7px * var(--k));
  border:0 solid currentColor; box-sizing:border-box;
}
.ow-drn-c.tl { left:0;  top:0;    border-left-width:calc(2px * var(--k)); border-top-width:calc(2px * var(--k)); }
.ow-drn-c.tr { right:0; top:0;    border-right-width:calc(2px * var(--k)); border-top-width:calc(2px * var(--k)); }
.ow-drn-c.bl { left:0;  bottom:0; border-left-width:calc(2px * var(--k)); border-bottom-width:calc(2px * var(--k)); }
.ow-drn-c.br { right:0; bottom:0; border-right-width:calc(2px * var(--k)); border-bottom-width:calc(2px * var(--k)); }
/* The pip is the whole of a friendly's mark and is hidden on a hostile: two
   marks on one drone would make the brackets ambiguous. */
.ow-drn-pip {
  position:absolute; left:50%; top:50%;
  width:calc(5px * var(--k)); height:calc(5px * var(--k));
  margin:calc(-2.5px * var(--k)) 0 0 calc(-2.5px * var(--k));
  background: currentColor; transform: rotate(45deg); display:none;
}
.ow-drn-tag {
  position:absolute; left:50%; bottom:100%; transform:translateX(-50%);
  display:flex; flex-direction:column; align-items:center;
  padding-bottom: calc(var(--u) * .6);
}
.ow-drn-l {
  font-size: calc(9.5px * var(--k)); letter-spacing:.22em; font-weight:700;
  color: currentColor; white-space:nowrap; text-shadow: var(--sh-o1);
}
.ow-drn-track {
  width: calc(30px * var(--k)); height: calc(2.5px * var(--k));
  margin-top: calc(var(--u) * .3);
  background: rgba(6,12,16,.72); border:calc(1px * var(--k)) solid rgba(0,0,0,.55);
}
.ow-drn-track i {
  display:block; height:100%; width:100%; background: currentColor;
  transform-origin: left; transform: scaleX(1);
}
.ow-drn-d {
  margin-top: calc(var(--u) * .2);
  font-size: calc(8.5px * var(--k)); letter-spacing:.2em;
  color: var(--ink-2); white-space:nowrap; text-shadow: var(--sh-o1);
}
/* Half a bar left is one more round of anything: amber, the colour this HUD
   uses everywhere for "the state of this thing is about to change". */
.ow-drn.weak .ow-drn-track i { background: var(--amber); }
/* IT HAS YOU. The brackets thicken and the whole mark goes white-hot on the
   dive — the same escalation the lock strip and the scream carry. */
.ow-drn.lock .ow-drn-c { border-width:calc(2.6px * var(--k)); }
.ow-drn.lock .ow-drn-l { letter-spacing:.3em; }
.ow-drn.dive { color: #ffffff; }
.ow-drn.dive .ow-drn-l { color: #ffffff; }
/* YOUR OWN: a pip, no brackets, no bar. Present, not a problem to solve. */
.ow-drn.friendly { color: var(--friend); }
.ow-drn.friendly .ow-drn-c { display:none; }
.ow-drn.friendly .ow-drn-pip { display:block; }
.ow-drn.friendly .ow-drn-track { display:none; }
.ow-drn-chev {
  position:absolute; left:50%; top:50%;
  width:calc(16px * var(--k)); height:calc(16px * var(--k));
  margin:calc(-8px * var(--k)) 0 0 calc(-8px * var(--k));
}
.ow-drn-chev svg { width:100%; height:100%; display:block; overflow:visible;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.9)); }
/* Clamped to the edge: the corners would be a box around nothing. */
.ow-drn.edge .ow-drn-c { display:none; }
.ow-drn.edge .ow-drn-pip { display:none; }
.ow-drn.edge .ow-drn-track { display:none; }

/* ======================================================== damage numbers */
.ow-dn {
  position:absolute; left:0; top:0; font-family: var(--fd);
  font-size: calc(17px * var(--k)); font-weight:700; letter-spacing:.03em;
  color: var(--ink); text-shadow: 0 1px 2px rgba(0,0,0,.95), 0 0 calc(8px * var(--k)) rgba(0,0,0,.6);
  will-change: transform, opacity;
}
.ow-dn.hs   { color: var(--amber); font-size: calc(21px * var(--k)); }
.ow-dn.kill { color: var(--red);   font-size: calc(23px * var(--k)); }
.ow-dn.armour { color: var(--cyan); }

/* ================================================================ prompt */
.ow-prompt {
  position:absolute; left:50%; top:58%;
  transform: translate(-50%,-50%);
  display:flex; flex-direction:column; align-items:flex-start;
  gap: calc(var(--u) * 1.8);
  will-change: opacity, transform;
}
/* One verb per row: keycap + caption on the left, the verb on the right. */
.ow-prompt-row { display:flex; align-items:center; gap: calc(var(--u) * 2); }
.ow-prompt-keywrap { display:flex; flex-direction:column; align-items:center; gap: calc(var(--u) * .5); }
.ow-prompt-cap {
  font-size: calc(8.5px * var(--k)); letter-spacing:.24em; font-weight:700;
  color: var(--amber); text-shadow: var(--sh-o1);
}
/* The second verb is real but secondary: same construction, one step back. */
.ow-prompt-row.alt .ow-key { border-color: rgba(255,255,255,.34); }
.ow-prompt-row.alt .ow-prompt-cap { color: var(--cyan); }
.ow-prompt-row.alt .ow-prompt-txt { font-size: calc(11px * var(--k)); color: var(--ink-2); }
.ow-key {
  min-width: calc(22px * var(--k)); height: calc(22px * var(--k));
  padding: 0 calc(var(--u) * 1.2);
  display:flex; align-items:center; justify-content:center;
  font-size: calc(11px * var(--k)); letter-spacing:.06em;
  border: 1px solid rgba(255,255,255,.55); border-radius: calc(2px * var(--k));
  background: rgba(8,11,14,.42);
  box-shadow: 0 1px 3px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.14);
  text-shadow: var(--sh-hard);
}
.ow-prompt-txt { font-size: calc(13.5px * var(--k)); letter-spacing:.2em; text-shadow: var(--sh-o1); }
.ow-prompt-sub { font-size: calc(10.5px * var(--k)); letter-spacing:.2em; color:var(--ink-2);
  text-shadow: var(--sh-o1); }
.ow-prompt-arc { position:absolute; left:calc(-6px * var(--k)); top:50%; }

/* ================================================================ banner */
.ow-banner {
  position:absolute; left:50%; top:31%;
  transform: translate(-50%,-50%);
  text-align:center;
  /* wide side padding on purpose: the scrim's outer 20% is a feather, so the
     band has to be substantially wider than the type for the type to sit on
     the solid part of it */
  padding: calc(var(--u) * 4) calc(var(--u) * 30);
  will-change: opacity, transform;
}
/* A soft radial haze over a blown sky does nothing except add milk: at 62% in
   the middle and 0 at the edge, its average density is far too low to seat white
   type on a 236-luma cloud. This is a flat 60% dark band, feathered across the
   outer 20% at each end (and rolled off top/bottom so it is a band, not a box). */
.ow-banner::before {
  content:''; position:absolute; inset:0; z-index:-1;
  background: linear-gradient(to bottom,
    rgba(4,7,10,0) 0%, rgba(4,7,10,.60) 20%, rgba(4,7,10,.60) 80%, rgba(4,7,10,0) 100%);
  -webkit-mask-image: linear-gradient(to right, rgba(0,0,0,0) 0%, #000 20%, #000 80%, rgba(0,0,0,0) 100%);
          mask-image: linear-gradient(to right, rgba(0,0,0,0) 0%, #000 20%, #000 80%, rgba(0,0,0,0) 100%);
}
.ow-banner-t {
  font-family: var(--fd);
  font-size: calc(30px * var(--k)); letter-spacing:.3em; font-weight:700;
  text-shadow: var(--sh-o2);
}
.ow-banner-s {
  margin-top: calc(var(--u) * 1.4);
  font-size: calc(12px * var(--k)); letter-spacing:.3em; color: var(--amber); font-weight:700;
  text-shadow: var(--sh-o1);
}
.ow-banner-rule {
  margin: calc(var(--u) * 1.4) auto 0; width: calc(120px * var(--k)); height:1px;
  background: linear-gradient(to right, transparent, rgba(255,255,255,.5), transparent);
}

/* =========================================================== incoming air
   The strip, top centre, under the round line. It is the only element in the
   HUD with a hard red rule and a solid seat: everything else in this sheet is
   information you read when you choose to, and this is information that has
   four seconds to change what you are doing. Sits at 128px @1080p, clear of
   .ow-round (72px + type) and well above the crosshair. */
.ow-aa {
  position:absolute; left:50%; top: calc(var(--pad) * .7 + 106px * var(--k));
  transform: translateX(-50%);
  display:flex; align-items:center; gap: calc(var(--u) * 2.2);
  padding: calc(var(--u) * 1.4) calc(var(--u) * 3.4) calc(var(--u) * 1.4) calc(var(--u) * 2.4);
  background: linear-gradient(180deg, rgba(26,6,4,.56), rgba(10,4,4,.40));
  border-left: calc(2.5px * var(--k)) solid var(--red);
  box-shadow: 0 calc(2px * var(--k)) calc(14px * var(--k)) rgba(0,0,0,.55);
  will-change: opacity, transform;
}
.ow-aa-arrow {
  width: calc(22px * var(--k)); height: calc(22px * var(--k));
  color: var(--red); flex: 0 0 auto;
  will-change: transform;
}
.ow-aa-arrow svg { width:100%; height:100%; display:block;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.9)); }
.ow-aa-col { min-width: calc(186px * var(--k)); }
.ow-aa-t {
  font-family: var(--fd);
  font-size: calc(18px * var(--k)); letter-spacing:.22em; font-weight:700;
  color: #ffd9cf; text-shadow: var(--sh-o1);
}
.ow-aa-s {
  margin-top: calc(var(--u) * .4);
  font-size: calc(10px * var(--k)); letter-spacing:.22em;
  color: var(--ink-2); text-shadow: var(--sh);
}
.ow-aa-bar {
  margin-top: calc(var(--u) * 1.1);
  height: calc(2px * var(--k)); background: rgba(255,255,255,.16);
}
.ow-aa-bar > i {
  display:block; height:100%; width:100%; background: var(--red);
  transform-origin:left; transform:scaleX(1);
}
/* The salvo is a different weapon and says so: amber rule, wider type. */
.ow-aa.salvo { border-left-color: var(--amber);
  background: linear-gradient(180deg, rgba(34,18,2,.58), rgba(12,7,2,.42)); }
.ow-aa.salvo .ow-aa-t { color: #ffe6bd; letter-spacing:.3em; }
.ow-aa.salvo .ow-aa-arrow { color: var(--amber); }
.ow-aa.salvo .ow-aa-bar > i { background: var(--amber); }
.ow-aa.landed .ow-aa-t { color: #fff; }

/* ======================================================== pickup receipt
   What you just took, or why you did not get it. Sits between the interaction
   prompt (58%) and the capture panel (74%) — the eye is already down there
   because that is where the prompt it answers is. */
.ow-pick {
  position:absolute; left:50%; top:64.5%;
  transform: translate(-50%,-50%);
  display:flex; align-items:center; gap: calc(var(--u) * 2);
  padding: calc(var(--u) * 1.6) calc(var(--u) * 4) calc(var(--u) * 1.6) calc(var(--u) * 2.4);
  background: linear-gradient(180deg, rgba(8,20,10,.62), rgba(5,10,7,.44));
  box-shadow: 0 calc(2px * var(--k)) calc(12px * var(--k)) rgba(0,0,0,.5);
  will-change: opacity, transform;
}
.ow-pick-rule { width: calc(3px * var(--k)); align-self:stretch; background: var(--ok); }
.ow-pick-t {
  font-family: var(--fd); font-size: calc(19px * var(--k)); font-weight:700;
  letter-spacing:.24em; color: var(--ok); text-shadow: var(--sh-o1);
}
.ow-pick-s {
  margin-top: calc(var(--u) * .4);
  font-size: calc(10px * var(--k)); letter-spacing:.24em; color: var(--ink-2);
  text-shadow: var(--sh-o1);
}
.ow-pick.weapon { background: linear-gradient(180deg, rgba(6,18,28,.62), rgba(4,9,14,.44)); }
.ow-pick.weapon .ow-pick-rule { background: var(--cyan); }
.ow-pick.weapon .ow-pick-t { color: var(--cyan); }
.ow-pick.beacon { background: linear-gradient(180deg, rgba(24,18,4,.62), rgba(12,9,3,.44)); }
.ow-pick.beacon .ow-pick-rule { background: var(--amber); }
.ow-pick.beacon .ow-pick-t { color: var(--amber); }
/* The refusal. It is the same element on purpose: the answer to "why did my
   hold do nothing" has to arrive where the answer to "what did I get" does. */
.ow-pick.deny { background: linear-gradient(180deg, rgba(28,6,4,.62), rgba(13,4,3,.44)); }
.ow-pick.deny .ow-pick-rule { background: var(--red); }
.ow-pick.deny .ow-pick-t { color: #ffb3a6; font-size: calc(16px * var(--k)); }

/* =============================================================== beacon
   The thirty seconds, under the minimap. */
.ow-bcn {
  position:absolute; left:var(--pad); top: calc(var(--pad) + 196px * var(--k));
  width: calc(178px * var(--k));
  padding-left: calc(var(--u) * 1.8);
  border-left: calc(2.5px * var(--k)) solid var(--ok);
  will-change: opacity;
}
.ow-bcn-head { display:flex; align-items:center; gap: calc(var(--u) * 1.2); }
.ow-bcn-glyph { width: calc(13px * var(--k)); height: calc(13px * var(--k)); color: var(--ok); }
.ow-bcn-glyph svg { width:100%; height:100%; display:block; overflow:visible;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.9)); }
.ow-bcn-t {
  font-size: calc(11px * var(--k)); letter-spacing:.22em; font-weight:700;
  color: var(--ok); text-shadow: var(--sh-o1);
}
.ow-bcn-c {
  margin-left:auto; font-family: var(--fd); font-size: calc(16px * var(--k));
  color: var(--ok); text-shadow: var(--sh-o1);
}
.ow-bcn-track {
  margin-top: calc(var(--u) * 1); height: calc(2.5px * var(--k));
  background: rgba(255,255,255,.16);
}
.ow-bcn-track > i {
  display:block; height:100%; width:100%; background: var(--ok);
  transform-origin:left; transform:scaleX(1);
}
.ow-bcn-s {
  margin-top: calc(var(--u) * .8);
  font-size: calc(9px * var(--k)); letter-spacing:.2em; color: var(--ink-2);
  text-shadow: var(--sh-o1);
}
.ow-bcn.cold { border-left-color: var(--ink-3); }
.ow-bcn.cold .ow-bcn-glyph, .ow-bcn.cold .ow-bcn-t, .ow-bcn.cold .ow-bcn-c { color: var(--ink-3); }
.ow-bcn.cold .ow-bcn-track > i { background: var(--ink-3); }

/* ============================================================== capture
   DOMINATION's centrepiece — see src/ui/capture.js. It is deliberately the
   biggest thing on the HUD after the banner: the zone strip reports all three
   points at 30 px, and the one you are STANDING IN needed to be an event.
   Low centre (74% of height) so it is clear of the crosshair, clear of the
   interaction prompt at 58%, and nowhere near the corners the ammo, health and
   minimap own. */
.ow-cap {
  position:absolute; left:50%; top:74%;
  transform: translate(-50%,0);
  transform-origin: 50% 50%;
  display:flex; flex-direction:column; align-items:center;
  gap: calc(var(--u) * 1.4);
  padding: calc(var(--u) * 2.6) calc(var(--u) * 9) calc(var(--u) * 2.2);
  will-change: opacity, transform;
}
/* Flat feathered band, same construction as the banner's: a radial haze cannot
   seat white type on a 236-luma sky. */
.ow-cap::before {
  content:''; position:absolute; inset:0; z-index:-1;
  background: linear-gradient(to bottom,
    rgba(4,7,10,0) 0%, rgba(4,7,10,.66) 18%, rgba(4,7,10,.66) 82%, rgba(4,7,10,0) 100%);
  -webkit-mask-image: linear-gradient(to right, rgba(0,0,0,0) 0%, #000 18%, #000 82%, rgba(0,0,0,0) 100%);
          mask-image: linear-gradient(to right, rgba(0,0,0,0) 0%, #000 18%, #000 82%, rgba(0,0,0,0) 100%);
}
.ow-cap-head { display:flex; align-items:center; gap: calc(var(--u) * 2.4); }
.ow-cap-verb {
  font-family: var(--fd);
  font-size: calc(29px * var(--k)); letter-spacing:.28em; font-weight:700;
  text-shadow: var(--sh-o2);
}
.ow-cap-badge-wrap { position:relative; width: calc(34px * var(--k)); height: calc(34px * var(--k)); }
.ow-cap-badge {
  position:absolute; inset:0;
  display:flex; align-items:center; justify-content:center;
  font-family: var(--fd); font-size: calc(23px * var(--k)); font-weight:700;
  letter-spacing:.02em; color:#07100f;
  box-shadow: 0 calc(1px * var(--k)) calc(4px * var(--k)) rgba(0,0,0,.75);
}
/* The heartbeat, and the shockwave on a capture. Scaled from update(). */
.ow-cap-ring {
  position:absolute; inset: calc(-3px * var(--k));
  border: calc(1.6px * var(--k)) solid var(--friend);
  will-change: transform, opacity;
}
.ow-cap-name {
  font-size: calc(11px * var(--k)); letter-spacing:.26em;
  color: var(--ink-2); text-shadow: var(--sh-o1);
}
.ow-cap-track {
  position:relative; width: calc(520px * var(--k)); height: calc(20px * var(--k));
  background: rgba(5,8,11,.62);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.18);
  overflow:hidden;
}
.ow-cap-fill {
  position:absolute; left:0; top:0; width:100%; height:100%;
  transform-origin:left; transform:scaleX(0);
  will-change: transform;
}
/* The lit leading edge: where the bar IS this second, not where it has been. */
.ow-cap-edge {
  position:absolute; top:0; height:100%;
  width: calc(3px * var(--k)); margin-left: calc(-1.5px * var(--k));
  box-shadow: 0 0 calc(9px * var(--k)) currentColor;
  will-change: left, opacity;
}
/* Quarter ticks — a bar with no scale on it cannot be read as "nearly". */
.ow-cap-ticks {
  position:absolute; inset:0;
  background: repeating-linear-gradient(to right,
    rgba(0,0,0,0) 0, rgba(0,0,0,0) calc(25% - 1px),
    rgba(4,7,10,.55) calc(25% - 1px), rgba(4,7,10,.55) 25%);
}
.ow-cap-pct {
  position:absolute; inset:0;
  display:flex; align-items:center; justify-content:center;
  font-family: var(--fd); font-size: calc(15px * var(--k)); letter-spacing:.14em;
  color: var(--ink); text-shadow: var(--o1);
}
.ow-cap-foot {
  display:flex; align-items:center; gap: calc(var(--u) * 1.8);
  font-size: calc(10.5px * var(--k)); letter-spacing:.2em;
}
.ow-cap-pips { display:flex; gap: calc(var(--u) * .8); align-items:center; }
.ow-cap-pips.them { flex-direction: row-reverse; }
.ow-cap-pip {
  width: calc(7px * var(--k)); height: calc(7px * var(--k));
  box-shadow: 0 1px 2px rgba(0,0,0,.8);
}
.ow-cap-n {
  font-family: var(--fd); font-size: calc(17px * var(--k)); font-weight:700;
  min-width: calc(14px * var(--k)); text-align:center; text-shadow: var(--sh-o1);
}
.ow-cap-read {
  min-width: calc(168px * var(--k)); text-align:center;
  text-shadow: var(--sh-o1);
}
.ow-cap-clock {
  font-size: calc(11px * var(--k)); letter-spacing:.3em; font-weight:700;
  color: var(--amber); text-shadow: var(--sh-o1);
}
/* One of yours going, and you are not on it. Same panel, different alarm. */
.ow-cap.threat .ow-cap-verb { color: var(--enemy); }
.ow-cap.threat .ow-cap-clock { color: var(--enemy); }
.ow-cap.threat::before {
  background: linear-gradient(to bottom,
    rgba(26,5,4,0) 0%, rgba(26,5,4,.62) 18%, rgba(26,5,4,.62) 82%, rgba(26,5,4,0) 100%);
}
.ow-cap.contest .ow-cap-clock { color: var(--amber); }
.ow-cap.won .ow-cap-verb { color: var(--ink); letter-spacing:.36em; }
.ow-cap.won .ow-cap-clock { color: var(--ok); }
.ow-cap.won::before {
  background: linear-gradient(to bottom,
    rgba(6,18,26,0) 0%, rgba(6,18,26,.62) 18%, rgba(6,18,26,.62) 82%, rgba(6,18,26,0) 100%);
}

/* ================================================================== menu */
.ow-menu {
  position:absolute; inset:0; pointer-events:auto;
  background: linear-gradient(105deg, rgba(4,6,8,.90) 0%, rgba(4,6,8,.72) 46%, rgba(4,6,8,.42) 100%);
  backdrop-filter: blur(calc(9px * var(--k))) saturate(.7) brightness(.8);
  opacity:0; will-change: opacity;
}
.ow-menu-inner {
  position:absolute; left: calc(var(--u) * 22); top:50%;
  transform: translateY(-50%);
  width: calc(430px * var(--k));
  padding-left: calc(var(--u) * 4.5);
  border-left: calc(2px * var(--k)) solid var(--amber);
}
.ow-menu h1 {
  font-family: var(--fd);
  font-size: calc(46px * var(--k)); font-weight:700; letter-spacing:.3em;
  text-shadow: 0 2px 6px rgba(0,0,0,.8);
}
.ow-menu .sub {
  margin-top: calc(var(--u) * 1.2); font-size: calc(10px * var(--k));
  letter-spacing:.28em; color: var(--ink-3);
}
.ow-menu .rule {
  margin: calc(var(--u) * 5) 0 calc(var(--u) * 2); height:1px;
  background: linear-gradient(to right, rgba(255,255,255,.28), rgba(255,255,255,0));
}
.ow-row {
  display:flex; align-items:center; justify-content:space-between;
  gap: calc(var(--u) * 4); padding: calc(var(--u) * 3.2) 0;
  border-bottom: 1px solid var(--hair-2);
}
.ow-row > .name { font-size: calc(11.5px * var(--k)); letter-spacing:.2em; color: var(--ink); }
.ow-row > .val { font-family: var(--fm); font-size: calc(11px * var(--k)); color: var(--amber);
  letter-spacing:.04em; min-width: calc(46px * var(--k)); text-align:right; }
.ow-seg { display:flex; gap:0; }
.ow-seg button {
  appearance:none; border:1px solid var(--hair); border-right:0; background:rgba(255,255,255,.03);
  color: var(--ink-2); font-family:var(--ff); font-weight:600; text-transform:uppercase;
  font-size: calc(10px * var(--k)); letter-spacing:.16em;
  padding: calc(var(--u) * 1.3) calc(var(--u) * 2.2);
  cursor:pointer; position:relative; transition: color .12s, background .12s;
}
.ow-seg button:last-child { border-right:1px solid var(--hair); }
.ow-seg button:hover { color: var(--ink); background: rgba(255,255,255,.07); }
.ow-seg button.on { color:#0b0d0f; background: var(--ink); }
.ow-slider { position:relative; width: calc(190px * var(--k)); height: calc(18px * var(--k)); }
.ow-slider .track {
  position:absolute; left:0; right:0; top:50%; height: calc(2px * var(--k));
  transform: translateY(-50%); background: rgba(255,255,255,.16);
}
.ow-slider .fill {
  position:absolute; left:0; top:50%; height: calc(2px * var(--k));
  transform: translateY(-50%); background: var(--amber);
}
.ow-slider .knob {
  position:absolute; top:50%; width: calc(9px * var(--k)); height: calc(9px * var(--k));
  background: var(--amber); transform: translate(-50%,-50%) rotate(45deg);
  box-shadow: 0 0 calc(6px * var(--k)) rgba(255,176,42,.5);
}
.ow-slider input {
  position:absolute; inset:0; width:100%; height:100%; margin:0;
  appearance:none; background:transparent; cursor:pointer; opacity:0;
}
.ow-btns { margin-top: calc(var(--u) * 5); display:flex; gap: calc(var(--u) * 2.5); }
.ow-btn {
  appearance:none; border:1px solid var(--hair); background: rgba(255,255,255,.04);
  color: var(--ink); font-family: var(--ff); font-weight:600; text-transform:uppercase;
  font-size: calc(11px * var(--k)); letter-spacing:.2em;
  padding: calc(var(--u) * 2.2) calc(var(--u) * 5);
  cursor:pointer; transition: background .12s, border-color .12s;
}
.ow-btn:hover { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.4); }
.ow-btn.primary { background: var(--amber); border-color: var(--amber); color:#100b02; }
.ow-btn.primary:hover { background:#ffc251; }
.ow-menu .hint {
  margin-top: calc(var(--u) * 4); font-size: calc(9.5px * var(--k));
  letter-spacing:.2em; color: var(--ink-3);
}

/* ============================================================ map select */
/* The picker. Same design system as the pause menu — amber rule, condensed
   uppercase, --k scaling — but CENTRED rather than left-anchored, because it is
   two objects being compared rather than a list of settings being adjusted.
   No --friend/--enemy anywhere in here: those two mean "relative to
   RULES.playerTeam" on this HUD and a map card has no team. */
.ow-mapsel {
  position:absolute; inset:0; pointer-events:auto;
  background: radial-gradient(120% 100% at 50% 40%, rgba(4,6,8,.86), rgba(2,3,4,.96));
  backdrop-filter: blur(calc(11px * var(--k))) saturate(.65) brightness(.75);
  opacity:0; will-change: opacity;
  display:flex; align-items:center; justify-content:center;
}
.ow-mapsel-inner { position:relative; width: calc(760px * var(--k)); max-width: 92vw; }
.ow-mapsel-head { display:flex; align-items:baseline; gap: calc(var(--u) * 3); }
.ow-mapsel h1 {
  font-family: var(--fd); font-size: calc(34px * var(--k)); font-weight:700;
  letter-spacing:.3em; color: var(--ink); text-shadow: 0 2px 6px rgba(0,0,0,.8);
}
.ow-mapsel .sub { font-size: calc(10px * var(--k)); letter-spacing:.28em; color: var(--ink-3); }
.ow-mapsel .rule {
  margin: calc(var(--u) * 3) 0 calc(var(--u) * 4); height:1px;
  background: linear-gradient(to right, var(--amber), rgba(255,176,42,0) 70%);
}
.ow-mapsel-grid { display:flex; gap: calc(var(--u) * 4); align-items:stretch; }

.ow-mapcard {
  appearance:none; flex:1 1 0; min-width:0; text-align:left; cursor:pointer;
  font-family: var(--ff); color: var(--ink);
  background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.015));
  border:1px solid var(--hair); border-top-width: calc(2px * var(--k));
  border-top-color: rgba(255,255,255,.18);
  padding: calc(var(--u) * 4);
  transition: background .12s, border-color .12s, transform .12s;
}
.ow-mapcard:hover { background: rgba(255,255,255,.09); border-color: rgba(255,255,255,.42); }
.ow-mapcard.on { border-top-color: var(--amber); background: rgba(255,176,42,.07); }
.ow-mapcard .art {
  display:block; width:100%; aspect-ratio:1 / 1; margin-bottom: calc(var(--u) * 3);
}
.ow-mapart { display:block; width:100%; height:100%; }
.ow-mapart .frame { fill: rgba(255,255,255,.02); stroke: var(--hair-2); stroke-width:.8; }
.ow-mapart .street { stroke: rgba(255,255,255,.10); stroke-width:1.1; }
.ow-mapart .ring { fill:none; stroke: rgba(255,255,255,.16); stroke-width:1.4; }
.ow-mapart .ring.in { stroke: rgba(255,255,255,.07); stroke-width:.9; }
.ow-mapart .block { fill: rgba(255,255,255,.13); stroke: rgba(255,255,255,.20); stroke-width:.6; }
.ow-mapart .landmark { fill: rgba(255,255,255,.30); stroke:none; }
.ow-mapart .base { fill:none; stroke: var(--ink-2); stroke-width:1.2; }
.ow-mapart .zone { fill: rgba(255,176,42,.22); stroke: var(--amber); stroke-width:1.2; }
.ow-mapart .fire { fill: rgba(255,110,40,.55); stroke:none; }

.ow-mapcard .top { display:flex; align-items:baseline; gap: calc(var(--u) * 2); }
.ow-mapcard .name {
  font-family: var(--fd); font-size: calc(24px * var(--k)); letter-spacing:.16em;
  color: var(--ink);
}
.ow-mapcard .live {
  font-size: calc(8.5px * var(--k)); letter-spacing:.24em; color:#100b02;
  background: var(--amber); padding: calc(1.5px * var(--k)) calc(5px * var(--k));
}
.ow-mapcard .sub {
  margin-top: calc(var(--u) * .8); font-size: calc(9.5px * var(--k));
  letter-spacing:.26em; color: var(--ink-3);
}
.ow-mapcard .facts {
  display:flex; gap: calc(var(--u) * 5); margin-top: calc(var(--u) * 3);
  padding-top: calc(var(--u) * 2.5); border-top:1px solid var(--hair-2);
}
.ow-mapcard .facts .k {
  font-size: calc(8.5px * var(--k)); letter-spacing:.22em; color: var(--ink-3);
}
.ow-mapcard .facts .v {
  font-family: var(--fm); font-size: calc(13px * var(--k)); letter-spacing:.02em;
  color: var(--amber); margin-top: calc(var(--u) * .5);
}
.ow-mapcard .note {
  margin-top: calc(var(--u) * 2.5); font-size: calc(9px * var(--k));
  letter-spacing:.14em; line-height:1.5; color: var(--ink-2);
}

.ow-mapsel-foot {
  margin-top: calc(var(--u) * 4); font-size: calc(9px * var(--k));
  letter-spacing:.2em; color: var(--ink-3);
}
.ow-mapsel .ow-btns { margin-top: calc(var(--u) * 3.5); }
.ow-mapsel .hint {
  margin-top: calc(var(--u) * 3); font-size: calc(9.5px * var(--k));
  letter-spacing:.2em; color: var(--ink-3);
}

/* The reload curtain. Covers the panel so the click cannot be repeated and so
   the navigation reads as a transition rather than a crash. */
.ow-mapsel-deploy {
  position:absolute; inset: calc(var(--u) * -4); z-index:2;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap: calc(var(--u) * 2);
  background: rgba(3,5,7,.93);
  border-left: calc(2px * var(--k)) solid var(--amber);
}
.ow-mapsel-deploy .n {
  font-family: var(--fd); font-size: calc(44px * var(--k)); letter-spacing:.3em;
  color: var(--ink); text-shadow: 0 2px 8px rgba(0,0,0,.9);
}
.ow-mapsel-deploy .s {
  font-size: calc(10px * var(--k)); letter-spacing:.32em; color: var(--amber);
}

/* The discoverability line, shown under the HUD until the first pointer lock.
   Never built in capture mode — see MapSelect's constructor. */
.ow-maphint {
  position:absolute; left:50%; bottom: calc(var(--pad) * 1.4);
  transform: translateX(-50%); white-space:nowrap;
  font-size: calc(9.5px * var(--k)); letter-spacing:.26em;
  color: var(--ink-2); text-shadow: var(--sh-o1);
  border-top:1px solid var(--hair-2); border-bottom:1px solid var(--hair-2);
  padding: calc(var(--u) * 1) calc(var(--u) * 3);
}

/* ========================================================== round / mode */
/* Everything below belongs to the demolition mode: the alive-count strip, the
   C4 fuse panel, the scoreboard and the spectator line. Same design system as
   the rest of the HUD — 4px grid, one condensed stack, --k scaling, two-stop
   text shadows — so nothing reads as bolted on. */

.ow-round {
  position:absolute; left:50%; top: calc(var(--pad) * .7 + 72px * var(--k));
  transform: translateX(-50%);
  display:flex; align-items:center; gap: calc(var(--u) * 3);
  white-space: nowrap;
}
/* --pipw / --pipgap are written on .ow-round by RoundStrip._layout, which
   compresses the pips when a side is too big to draw at full pitch. The
   FALLBACKS are the values this sheet always had, and they are also exactly
   what _layout emits whenever the roster fits — so 20 v 20 is unchanged. */
.ow-round-pips { display:flex; gap: var(--pipgap, calc(var(--u) * .9)); align-items:center; }
.ow-round-pips.them { flex-direction: row-reverse; }
.ow-pip {
  display:block;
  width: var(--pipw, calc(4.5px * var(--k))); height: calc(11px * var(--k));
  background: var(--friend);
  box-shadow: 0 0 calc(4px * var(--k)) rgba(0,0,0,.75);
  transform: skewX(-12deg);
}
.ow-round-pips.them .ow-pip { background: var(--enemy); }
/* Specificity, deliberately: a two-class descendant rule outranks a bare
   .ow-pip.down, so a dead man on the enemy side would keep his red pip. Both
   sides get an explicit down rule.
   (And no backticks in here: this whole sheet is a JS template literal.) */
.ow-round-pips .ow-pip.down,
.ow-round-pips.them .ow-pip.down { background: rgba(255,255,255,.13); box-shadow:none; }

/* THE COUNT IN FIGURES, flanking the phase readout. Forty marks cannot be
   counted and the count is the point of the strip, so the number is written as
   well. Colour is --friend / --enemy through .us / .them, which are the local
   player's point of view — never a team index. */
.ow-round-count {
  font-family: var(--fm); font-size: calc(11.5px * var(--k)); letter-spacing:.04em;
  min-width: calc(46px * var(--k)); text-shadow: var(--sh-o1);
}
.ow-round-count.us { color: var(--friend); text-align:right; }
.ow-round-count.them { color: var(--enemy); text-align:left; }
/* What the strip could not draw. Hidden unless it is non-zero. */
.ow-round-more {
  font-family: var(--fm); font-size: calc(9.5px * var(--k)); letter-spacing:.02em;
  color: var(--ink-3); text-shadow: var(--sh-o1);
}
.ow-round-mid { text-align:center; min-width: calc(150px * var(--k)); }
.ow-round-phase {
  font-size: calc(9.5px * var(--k)); letter-spacing:.22em;
  color: var(--ink-3); text-shadow: var(--sh-o1);
}
.ow-round-alert {
  margin-top: calc(var(--u) * .5);
  font-size: calc(11.5px * var(--k)); letter-spacing:.2em;
  color: var(--amber); text-shadow: var(--sh-o1);
}

/* --------------------------------------------------------------- C4 */
.ow-c4 {
  position:absolute; left:50%; bottom: calc(var(--pad) * 3.6);
  transform: translateX(-50%);
  display:flex; align-items:center; gap: calc(var(--u) * 2);
  padding: calc(var(--u) * 1.2) calc(var(--u) * 2.4);
  background: linear-gradient(180deg, rgba(8,11,14,.42), rgba(8,11,14,.28));
  border-top: 1px solid var(--hair); border-bottom: 1px solid var(--hair-2);
}
.ow-c4-l { font-size: calc(10.5px * var(--k)); letter-spacing:.2em; color: var(--ink);
  text-shadow: var(--sh-o1); }
.ow-c4-track { width: calc(150px * var(--k)); height: calc(2.5px * var(--k));
  background: rgba(255,255,255,.14); }
.ow-c4-track > i { display:block; height:100%; width:100%; background: var(--amber);
  transform-origin:left; transform:scaleX(1); }
.ow-c4-clock { font-family: var(--fd); font-size: calc(17px * var(--k));
  color: var(--ink); text-shadow: var(--sh-o1); min-width: calc(34px * var(--k)); }

/* -------------------------------------------------------- scoreboard */
.ow-sb {
  position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  background: rgba(4,6,8,.46);
}
/* --sbw is written by Scoreboard.update when the roster needs a second column
   of rows per side; 660 is the one-column-a-side width this panel has always
   had, so the town's board is the width it was. */
.ow-sb-panel {
  width: min(calc(var(--sbw, 660) * 1px * var(--k)), 88vw);
  padding: calc(var(--u) * 5) calc(var(--u) * 5.5) calc(var(--u) * 5);
  background: linear-gradient(180deg, rgba(10,13,17,.90), rgba(10,13,17,.74));
  border: 1px solid var(--hair);
  box-shadow: 0 calc(18px * var(--k)) calc(50px * var(--k)) rgba(0,0,0,.6);
}
.ow-sb-head { border-bottom: 1px solid var(--hair); padding-bottom: calc(var(--u) * 2);
  margin-bottom: calc(var(--u) * 3); }
.ow-sb-title { font-family: var(--fd); font-size: calc(22px * var(--k));
  letter-spacing:.1em; color: var(--ink); }
.ow-sb-sub { margin-top: calc(var(--u) * .8); font-size: calc(10.5px * var(--k));
  letter-spacing:.2em; color: var(--ink-2); }
.ow-sb-cols { display:flex; gap: calc(var(--u) * 5); }
/* One side: its team header, then however many columns of rows the roster
   needs. At one column this nests to exactly what .ow-sb-col used to be. */
.ow-sb-side { flex:1 1 0; min-width:0; }
.ow-sb-subs { display:flex; gap: calc(var(--u) * 3); }
.ow-sb-col { flex:1 1 0; min-width:0; }
/* Men the panel did not have room for, and why they are the ones missing.
   Stated, never elided — a row that is not drawn has to be accounted for. */
.ow-sb-more {
  margin-top: calc(var(--u) * 1.6); font-size: calc(9.5px * var(--k));
  letter-spacing:.14em; color: var(--ink-3); text-shadow: var(--sh-o1);
}
/* The header row is segmented to match .ow-sb-subs — same count, same gap, same
   flex share — so K and D sit over every column of numbers, not just the first.
   With one sub-column this is one segment and renders as it always did. */
.ow-sb-team {
  display:flex; gap: calc(var(--u) * 3);
  font-size: calc(11px * var(--k)); letter-spacing:.24em;
  padding-bottom: calc(var(--u) * 1.2); border-bottom: 1px solid var(--hair-2);
  margin-bottom: calc(var(--u) * 1.2);
}
.ow-sb-teamseg {
  flex:1 1 0; min-width:0;
  display:flex; align-items:baseline; gap: calc(var(--u) * 2);
}
.ow-sb-team .n { flex:1 1 auto; }
/* Alive over total for the side — the same fact the pip strip draws in marks,
   and the one readout that stays true when the rows have to be rationed. */
.ow-sb-team .c {
  font-family: var(--fm); font-size: calc(10px * var(--k)); letter-spacing:.04em;
  color: var(--ink-3);
}
.ow-sb-team .k, .ow-sb-team .d {
  width: calc(28px * var(--k)); text-align:right;
  font-size: calc(9.5px * var(--k)); color: var(--ink-3); letter-spacing:.1em;
}
.ow-sb-row {
  display:flex; align-items:baseline; gap: calc(var(--u) * 2);
  padding: calc(var(--u) * .9) 0;
  font-size: calc(11.5px * var(--k)); letter-spacing:.1em; color: var(--ink-2);
  border-bottom: 1px solid rgba(255,255,255,.045);
}
.ow-sb-row .n { flex:1 1 auto; overflow:hidden; text-overflow:clip; }
.ow-sb-row .k, .ow-sb-row .d {
  font-family: var(--fd); font-size: calc(15px * var(--k));
  width: calc(28px * var(--k)); text-align:right;
}
.ow-sb-row .k { color: var(--ink); }
.ow-sb-row .d { color: var(--ink-3); }
.ow-sb-row.you { color: var(--amber); }
.ow-sb-row.you .k { color: var(--amber); }
.ow-sb-row.dead { opacity:.42; }

/* --------------------------------------------------------- spectator */
.ow-spec {
  position:absolute; left:50%; bottom: calc(var(--pad) * 6.4);
  transform: translateX(-50%); text-align:center;
  font-size: calc(12px * var(--k)); letter-spacing:.22em;
  color: var(--ink); text-shadow: var(--sh-o1);
}
.ow-spec-hint { margin-top: calc(var(--u) * .8); font-size: calc(9px * var(--k));
  letter-spacing:.2em; color: var(--ink-3); }

/* ========================================================= drone lock
   You have been captured by a suicide drone.  It sits UNDER the air-alert
   strip and above the crosshair, because it is the same class of information
   (something lethal is on its way, turn this way) and the two can be on screen
   at once.  See src/ui/dronelock.js for why the whole thing exists. */
.ow-dl {
  position:absolute; left:50%; top: calc(var(--pad) * .7 + 168px * var(--k));
  transform: translateX(-50%);
  display:flex; align-items:center; gap: calc(var(--u) * 2.2);
  padding: calc(var(--u) * 1.3) calc(var(--u) * 3.4) calc(var(--u) * 1.3) calc(var(--u) * 2.4);
  background: linear-gradient(180deg, rgba(30,4,6,.62), rgba(12,3,4,.46));
  border-left: calc(2.5px * var(--k)) solid var(--red);
  box-shadow: 0 calc(2px * var(--k)) calc(14px * var(--k)) rgba(0,0,0,.55);
  will-change: opacity, transform;
}
.ow-dl-arrow { width: calc(20px * var(--k)); height: calc(20px * var(--k));
  color: var(--red); flex: 0 0 auto; will-change: transform; }
.ow-dl-arrow svg { width:100%; height:100%; display:block;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.9)); }
.ow-dl-col { min-width: calc(212px * var(--k)); }
.ow-dl-t {
  font-family: var(--fd);
  font-size: calc(17px * var(--k)); letter-spacing:.26em; font-weight:700;
  color: #ffd2c8; text-shadow: var(--sh-o1);
}
.ow-dl-s { margin-top: calc(var(--u) * .4);
  font-size: calc(9.5px * var(--k)); letter-spacing:.22em;
  color: var(--ink-2); text-shadow: var(--sh); }
.ow-dl-bar { margin-top: calc(var(--u) * 1); height: calc(2px * var(--k));
  background: rgba(255,255,255,.16); }
.ow-dl-bar > i { display:block; height:100%; width:100%; background: var(--red);
  transform-origin:left; transform:scaleX(1); }
/* Committed.  A different problem and a different colour: nothing you do with
   your feet solves this one. */
.ow-dl.dive { border-left-color: #fff2ec;
  background: linear-gradient(180deg, rgba(58,6,6,.74), rgba(20,4,4,.56)); }
.ow-dl.dive .ow-dl-t { color:#fff; letter-spacing:.32em; }
.ow-dl.dive .ow-dl-arrow { color:#fff2ec; }
.ow-dl.dive .ow-dl-bar > i { background:#fff2ec; }
/* It worked.  A break has to be as legible as the lock was. */
.ow-dl.clear { border-left-color: var(--ok);
  background: linear-gradient(180deg, rgba(8,22,10,.6), rgba(4,10,6,.44)); }
.ow-dl.clear .ow-dl-t { color: var(--ok); }
.ow-dl.clear .ow-dl-arrow { color: var(--ok); }
/* The frame treatment: the one cue that reads with the eye down a sight. */
.ow-dl-edge {
  position:absolute; inset:0; pointer-events:none;
  background: radial-gradient(ellipse 74% 62% at 50% 50%,
    rgba(0,0,0,0) 52%, rgba(190,26,18,.30) 84%, rgba(150,16,10,.56) 100%);
  will-change: opacity;
}
.ow-dl-edge.dive { background: radial-gradient(ellipse 68% 56% at 50% 50%,
  rgba(0,0,0,0) 44%, rgba(226,44,26,.42) 78%, rgba(196,22,12,.72) 100%); }

/* ============================================================== kill cam
   Who killed you, with what, from how far, and how long until you are back.
   Bottom-centre and BELOW the spectate bar it replaces the meaning of: the
   eye is already low because that is where ELIMINATED left it. */
.ow-kc {
  position:absolute; left:50%; bottom: calc(var(--pad) * 3.1);
  transform: translateX(-50%); text-align:center;
  min-width: calc(280px * var(--k));
  padding: calc(var(--u) * 1.8) calc(var(--u) * 4) calc(var(--u) * 1.6);
  background: linear-gradient(180deg, rgba(26,6,5,.62), rgba(8,4,4,.46));
  border-top: calc(2px * var(--k)) solid var(--enemy);
  box-shadow: 0 calc(2px * var(--k)) calc(16px * var(--k)) rgba(0,0,0,.6);
  will-change: opacity, transform;
}
.ow-kc-tag { font-size: calc(8.5px * var(--k)); letter-spacing:.42em;
  color: var(--ink-3); text-shadow: var(--sh); }
.ow-kc-t { margin-top: calc(var(--u) * .8);
  font-family: var(--fd); font-size: calc(21px * var(--k)); font-weight:700;
  letter-spacing:.2em; color: var(--enemy); text-shadow: var(--sh-o1); }
.ow-kc-s { margin-top: calc(var(--u) * .5);
  font-size: calc(10px * var(--k)); letter-spacing:.24em;
  color: var(--ink-2); text-shadow: var(--sh-o1); }
.ow-kc-bar { margin-top: calc(var(--u) * 1.6); height: calc(2px * var(--k));
  background: rgba(255,255,255,.14); }
.ow-kc-bar > i { display:block; height:100%; width:100%; background: var(--enemy);
  transform-origin:left; transform:scaleX(1); }
/* Your own side did it — the row in the feed is blue and so is this. */
.ow-kc.friendly { border-top-color: var(--friend); }
.ow-kc.friendly .ow-kc-t { color: var(--friend); }
.ow-kc.friendly .ow-kc-bar > i { background: var(--friend); }
/* Nobody did it: an airstrike, the church, a drone, your own frag.  Amber,
   because "WORLD killed you" is a different sentence from a name. */
.ow-kc.env { border-top-color: var(--amber); }
.ow-kc.env .ow-kc-t { color: #ffdca4; }
.ow-kc.env .ow-kc-bar > i { background: var(--amber); }

/* ============================================================== fadeouts */
.ow-hidden { display:none !important; }

/* ---- scope overlay (see ui/scope.js) ------------------------------------ */
.ow-scope{position:absolute; inset:0; pointer-events:none; z-index:40;}
.ow-scope-body{position:absolute; inset:0;}
.ow-scope-vert{position:absolute; left:50%; top:0; bottom:0; width:1px;
  transform:translateX(-0.5px); background:rgba(12,14,16,0.92);}
.ow-scope-horz{position:absolute; top:50%; left:0; right:0; height:1px;
  transform:translateY(-0.5px); background:rgba(12,14,16,0.92);}
.ow-scope-dot{position:absolute; left:50%; width:3px; height:3px; margin-left:-1.5px;
  border-radius:50%; background:rgba(12,14,16,0.92);}

`;

const DEFS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <!-- organic edge for the blood vignette: banded turbulence displacing the
         gradient so the hurt overlay never reads as a clean radial ramp -->
    <filter id="ow-warp" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.006 0.011" numOctaves="4" seed="17" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="34" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
</svg>`;

let installed = false;

export function installStyles() {
  if (installed && document.getElementById('ow-ui-style')) return;
  const s = document.createElement('style');
  s.id = 'ow-ui-style';
  s.textContent = CSS;
  document.head.appendChild(s);
  const d = document.createElement('div');
  d.id = 'ow-ui-defs';
  d.innerHTML = DEFS;
  document.body.appendChild(d);
  installed = true;
}

export function removeStyles() {
  document.getElementById('ow-ui-style')?.remove();
  document.getElementById('ow-ui-defs')?.remove();
  installed = false;
}
