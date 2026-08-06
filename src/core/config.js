/**
 * Central tuning + quality configuration.
 * Subsystems read from here rather than hardcoding magic numbers, so the
 * quality scaler and the capture harness can drive everything from one place.
 */

export const PHYSICS_HZ = 120;
export const FIXED_DT = 1 / PHYSICS_HZ;
/** Never simulate more than this many physics steps in one frame (spiral-of-death guard). */
export const MAX_SUBSTEPS = 8;

/** Real-world units are metres, seconds, kilograms. */
export const UNITS = {
  gravity: -9.81 * 2.1, // Games use exaggerated gravity; CoD-like feel.
  playerHeight: 1.78,
  playerCrouchHeight: 1.12,
  playerRadius: 0.32,
  eyeOffset: 0.12, // below top of capsule
};

/**
 * ONE FIELD THE UPSTREAM PRESETS DID NOT HAVE, added because the 7v7 mode
 * doubled the actor count and the presets could no longer reach a playable
 * frame rate on an M1 Pro at Retina.
 *
 * `pixelRatio`   the cap on `devicePixelRatio`, which was hardcoded to 1.5 in
 *                render/index.js. MEASURED on an M1 Pro at 1728x1080: going
 *                from 1.5 to 1.0 takes the drawing buffer from 4.20 MP to
 *                1.87 MP and roughly DOUBLES the frame rate at every preset
 *                (8→16, 8→16, 12→24, 23→45 fps p50). It is the single largest
 *                lever in the whole build and it was not exposed.
 *
 * A per-actor shadow-caster budget was tried here too and REMOVED: in a frozen
 * A/B (time.scale = 0, budgets interleaved) capping the casters changed neither
 * the frame time nor the draw-call count, and it costs every soldier past the
 * cap their cast shadow. The cascades are dominated by the level, not by the
 * thirteen characters.
 */
export const QUALITY_PRESETS = {
  low: {
    pixelRatio: 1.0,
    renderScale: 0.72,
    shadowMapSize: 1024,
    cascades: 3,
    shadowDistance: 60,
    taa: false,
    gtao: false,
    ssr: false,
    volumetrics: false,
    motionBlur: false,
    bloom: true,
    anisotropy: 4,
    particleBudget: 2000,
    decalBudget: 64,
  },
  medium: {
    /**
     * MEDIUM WAS THE WORST COMBINATION IN THE FILE FOR SEEING ANYTHING.
     *
     * "画質がMediumでも非常に敵を視認しにくい". Multiply it out: pixelRatio 1.0 on
     * a Retina display is already half linear resolution, `renderScale` 0.85 is
     * applied on top of that, so the 3D scene was drawn at 0.425x linear — about
     * 18% of the native pixel count — and then TAA smeared what was left over
     * several frames and motion blur smeared it again. A man at 40 m is a
     * handful of pixels before any of that happens.
     *
     * renderScale goes to 1.0 (the 3D is drawn at the buffer's own resolution)
     * and motion blur comes off. TAA stays: it is the anti-aliasing, and at full
     * render scale it sharpens the silhouette rather than destroying it.
     */
    pixelRatio: 1.0,
    renderScale: 1.0,
    shadowMapSize: 2048,
    cascades: 3,
    shadowDistance: 90,
    taa: true,
    gtao: true,
    ssr: false,
    volumetrics: true,
    motionBlur: false,
    bloom: true,
    anisotropy: 8,
    particleBudget: 6000,
    decalBudget: 128,
  },
  high: {
    pixelRatio: 1.25,
    renderScale: 1.0,
    shadowMapSize: 2048,
    cascades: 4,
    shadowDistance: 140,
    taa: true,
    gtao: true,
    ssr: true,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    anisotropy: 16,
    particleBudget: 12000,
    decalBudget: 256,
  },
  ultra: {
    pixelRatio: 1.5,
    renderScale: 1.0,
    shadowMapSize: 4096,
    cascades: 4,
    shadowDistance: 200,
    taa: true,
    gtao: true,
    ssr: true,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    anisotropy: 16,
    particleBudget: 24000,
    decalBudget: 512,
  },
};

export const DEFAULTS = {
  /**
   * MEASURED, not chosen for looks. On an M1 Pro (16-core GPU) at 1728x1080
   * with a full 7v7 round live, p50 was 8 fps at `ultra` and 24 fps at
   * `medium`. `ultra` is unplayable on the machine this was built on, so it is
   * no longer the default — it is still one click away in the pause menu, and
   * `?q=ultra` still selects it.
   */
  quality: 'medium',
  /**
   * WHICH MAP. `'town'` is AL-MARIYA, the market town this repo shipped with;
   * `'plains'` is NACHTFELD, the night plain. Set from `?map=` in src/main.js.
   * The registry and the level contract live in `src/world/levels/index.js`;
   * an unknown id falls back to this default with a warning rather than
   * throwing, so a typo in a tool's query string cannot turn every gate in
   * `tools/` into a silent 240 s boot timeout.
   */
  map: 'town',
  fov: 80, // horizontal-ish vertical FOV, CoD default feel
  adsFovScale: 0.72,
  sensitivity: 0.0022,
  adsSensScale: 0.65,
  invertY: false,
  exposure: 1.0,
  /** Capture mode disables anything nondeterministic so screenshots are stable. */
  deterministic: false,
};

export function createConfig(overrides = {}) {
  const cfg = { ...DEFAULTS, ...overrides };
  cfg.q = { ...QUALITY_PRESETS[cfg.quality] };
  cfg.setQuality = (name) => {
    if (!QUALITY_PRESETS[name]) throw new Error(`unknown quality preset "${name}"`);
    cfg.quality = name;
    Object.assign(cfg.q, QUALITY_PRESETS[name]);
  };
  return cfg;
}
