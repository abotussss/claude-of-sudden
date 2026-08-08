/**
 * DEV ONLY — a gait bench for the soldier's locomotion.
 *
 * `preview.js` renders one pose at a time and drives the animator with its own
 * frame counter, which is fine for looking at the model and useless for looking
 * at a *cycle*: nothing there controls the stride phase, nothing translates the
 * actor, and there is no ground under the feet, so the foot IK — which is on for
 * every soldier in the game — never runs.
 *
 * This page fixes all three. The actor is integrated exactly as `agent.js`
 * integrates him: a fixed dt, the animator's own phase clock, a real ground
 * probe, and the group translated forward at the same `speed` the animator is
 * told about. That makes two things measurable that otherwise are not:
 *
 *   FOOT SLIDE   a planted foot must be stationary IN THE WORLD. Because the
 *                actor really moves here, the world position of the foot is the
 *                honest test: sample it while it is on the ground and any
 *                movement is skating.
 *   FLIGHT       both feet off the ground at once is what separates a run from
 *                a fast walk. With the ground probe live it can be counted.
 *
 * It also lays a whole cycle out as a strip of columns in one frame, which is
 * the only way to judge a gait by eye without a video.
 *
 *   node src/ai/gaitcheck.mjs --clip=run --speed=4.2
 */

import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { SoldierMaterials } from './textures.js';
import { buildSoldier } from './soldier.js';
import { RIG } from './rig.js';
import { Animator } from './animator.js';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x171b1f);
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 120);

/* ---- environment, matched to preview.js so the model reads the same ---- */
{
  const envScene = new THREE.Scene();
  const g = new THREE.SphereGeometry(20, 32, 24);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader:
      'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      varying vec3 vP;
      void main(){
        vec3 d = normalize(vP);
        vec3 sky = mix(vec3(0.55,0.68,0.92), vec3(0.16,0.22,0.32), clamp(d.y*1.4,0.0,1.0));
        vec3 ground = vec3(0.18,0.16,0.13);
        vec3 c = mix(ground, sky, smoothstep(-0.12, 0.10, d.y));
        float s = max(0.0, dot(d, normalize(vec3(-0.45,0.62,0.35))));
        c += vec3(6.0,5.4,4.6) * pow(s, 900.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(g, m));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
}

const key = new THREE.DirectionalLight(0xfff3e0, 3.1);
key.position.set(-3.2, 4.4, 2.6);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -2.2;
key.shadow.camera.right = 2.2;
key.shadow.camera.top = 2.6;
key.shadow.camera.bottom = -0.4;
key.shadow.bias = -0.0006;
scene.add(key);
const rim = new THREE.DirectionalLight(0x9fc4ff, 1.1);
rim.position.set(2.6, 2.0, -3.4);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0x9ab4d0, 0x2a231b, 0.55));

/* ---- ground: world-space stripes every 0.25 m, so a skating foot is
       visible against a fixed reference rather than against nothing ---- */
{
  const N = 64;
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const dark = i < 3 ? 1 : 0; // one 3/64 stripe per tile
    const v = dark ? 26 : 150;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 1, N, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 240); // plane is 60 m deep -> one stripe every 0.25 m
  const g = new THREE.PlaneGeometry(24, 60).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({
      map: tex,
      color: 0x3a3a3a,
      roughness: 0.98,
      metalness: 0,
    })
  );
  mesh.position.z = 20;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

/* ---- the actor ---- */
const variantName = q.get('variant') ?? 'vanguard';
const rng = new Rng(0xa11ce);
const materials = new SoldierMaterials(rng.fork(), {
  size: 512,
  anisotropy: 8,
  camo: ['arid', 'woodland', 'urban'],
});
const def = buildSoldier(variantName, { rng: rng.fork(), materials });
const { bones, skeleton, root } = RIG.createSkeleton();
const mesh = new THREE.SkinnedMesh(def.geometry, def.materials);
mesh.castShadow = true;
mesh.receiveShadow = true;
const group = new THREE.Group();
group.add(root);
group.add(mesh);
mesh.bind(skeleton);
scene.add(group);

/** Flat ground at y = 0, exactly the shape `AiSystem.probeGround` returns. */
const probeOut = { y: 0, nx: 0, ny: 1, nz: 0, hit: true };
const animator = new Animator(RIG, bones, {
  weapon: def.weapon,
  rng: rng.fork(),
  probe: (x, z, fromY, out) => {
    out.y = 0;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.hit = true;
    return true;
  },
});
void probeOut;

const aimTarget = new THREE.Vector3(0, 1.6, 40);

/* ---- simulation, integrated the way agent.js integrates ---- */
const SIM_DT = 1 / 120;
let simT = 0;

const _v = new THREE.Vector3();
/** World position of a bone (metres). */
function bonePos(name) {
  return animator.bonePos(name, _v).clone();
}

function reset(cfg) {
  animator.footIk = cfg.footIk !== 0;
  group.position.set(0, 0, 0);
  group.rotation.set(0, 0, 0);
  group.updateMatrixWorld(true);
  animator.phase = 0;
  animator.blend = 1;
  animator.state.clip = cfg.clip;
  animator.prevClip = cfg.clip;
  simT = 0;
}

function step(cfg) {
  animator.setState({
    clip: cfg.clip,
    speed: cfg.speed,
    aimTarget,
    lookTarget: aimTarget,
    aimWeight: cfg.aim,
    suppress: 0,
  });
  group.position.z += cfg.speed * SIM_DT;
  group.updateMatrixWorld(true);
  animator.update(SIM_DT, simT);
  simT += SIM_DT;
  group.updateMatrixWorld(true);
}

/**
 * Sole contact points, in the Foot bone's own frame. The bone's +Y runs down
 * the foot toward the toe and its +Z is the sole normal, so the sole plane is
 * 0.088 m along -Z and the two ends of it are +0.142 (toe) and -0.075 (heel)
 * along +Y. These are the points that must not move while the foot is down —
 * the ankle itself is ALLOWED to move, because the foot rolls over them.
 */
const SOLE = {
  heelR: [0, -0.075, -0.088],
  toeR: [0, 0.1423, -0.088],
  heelL: [0, -0.075, -0.088],
  toeL: [0, 0.1423, -0.088],
};
const _s = new THREE.Vector3();

/** One sample of everything the gait can be judged on numerically. */
function sample(cfg) {
  const out = { t: simT, phase: animator.phase, rootZ: group.position.z, speed: cfg.speed };
  for (const n of ['heelR', 'toeR', 'heelL', 'toeL']) {
    const b = bones[RIG.index(n.endsWith('R') ? 'FootR' : 'FootL')];
    _s.fromArray(SOLE[n]).applyMatrix4(b.matrixWorld);
    out[n] = [_s.x, _s.y, _s.z];
  }
  for (const n of [
    'FootR', 'FootL', 'ToeR', 'ToeL', 'Hips', 'Head', 'HandR', 'UpLegR', 'UpLegL',
  ]) {
    const p = bonePos(n);
    out[n] = [p.x, p.y, p.z];
  }
  out.hipLocalY = bones[0].position.y;
  return out;
}

/**
 * Integrate `cycles` stride cycles and return every sample. The caller does the
 * arithmetic in node, where it can be printed.
 */
function record(cfg) {
  reset(cfg);
  // settle: the crossfade and the IK need a few frames before the numbers mean
  // anything, and the phase must come back to 0 afterwards
  for (let i = 0; i < 60; i++) step(cfg);
  reset(cfg);
  const out = [];
  const strideHz = strideHzFor(cfg);
  const steps = Math.round(cfg.cycles / strideHz / SIM_DT);
  for (let i = 0; i < steps; i++) {
    step(cfg);
    out.push(sample(cfg));
  }
  return { strideHz, dt: SIM_DT, samples: out };
}

/** Mirror of the animator's own phase rate, so the driver can size a cycle. */
function strideHzFor(cfg) {
  const s = cfg.speed;
  if (cfg.clip === 'sprint') return Math.max(1.3, s / 2.55);
  if (cfg.clip === 'run') return Math.max(1.1, s / 2.05);
  // @see `ADVANCE` in clips.js. This table is `Animator.update`'s and has to
  // stay its twin, or `gaitcheck` measures a stride the game never plays.
  if (cfg.clip === 'advance') return Math.max(0.75, s / 1.72);
  if (cfg.clip === 'walk') return Math.max(0.55, s / 1.42);
  if (cfg.clip === 'crouchWalk') return Math.max(0.4, s / 0.95);
  return 0.19;
}

/* ---- the strip ---- */

const VIEW = {
  // `height` is what the camera looks at; `fit` is the vertical extent in metres
  // the column covers. Both are set so a standing 1.8 m man has head-room and
  // the ground line is well inside the frame — a gait can only be judged if the
  // ground the feet are supposed to be on is visible.
  side: { az: 90, height: 0.92, dist: 4.2, fit: 2.30 },
  three: { az: 42, height: 0.92, dist: 4.2, fit: 2.30 },
  front: { az: 0, height: 0.92, dist: 4.2, fit: 2.30 },
  legs: { az: 90, height: 0.60, dist: 3.2, fit: 1.75 },
  knee: { az: 62, height: 0.56, dist: 2.4, fit: 0.85 },
};

/**
 * Render `cols` evenly spaced phases of one cycle as columns of one image. The
 * actor keeps translating between columns — the camera tracks him — so each
 * column is a real frame of a real run, not a pose sampled in a vacuum.
 */
function strip(cfg) {
  const cols = cfg.cols;
  const colW = Math.floor(cfg.width / cols);
  const W = colW * cols;
  const H = cfg.height;
  renderer.setSize(W, H, false);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  renderer.setScissorTest(true);
  renderer.setClearColor(0x171b1f, 1);
  renderer.setViewport(0, 0, W, H);
  renderer.setScissor(0, 0, W, H);
  renderer.clear();

  const V = VIEW[cfg.view] ?? VIEW.side;
  const strideHz = strideHzFor(cfg);
  // `ph0` / `phSpan` window the strip onto part of the cycle, which is the only
  // way to look hard at a stance that occupies a third of it.
  const span = cfg.phSpan ?? 1;
  const frames = 1 / strideHz / SIM_DT;
  const perCol = Math.max(1, Math.round((frames * span) / cols));

  reset(cfg);
  for (let i = 0; i < 60; i++) step(cfg); // settle
  reset(cfg);
  for (let i = 0, n = Math.round(frames * (cfg.ph0 ?? 0)); i < n; i++) step(cfg);

  camera.aspect = colW / H;
  camera.fov = (2 * Math.atan(V.fit / 2 / V.dist) * 180) / Math.PI;
  camera.updateProjectionMatrix();

  const az = (V.az * Math.PI) / 180;
  for (let i = 0; i < cols; i++) {
    if (i > 0) for (let k = 0; k < perCol; k++) step(cfg);
    else step(cfg);
    const cz = group.position.z;
    camera.position.set(Math.sin(az) * V.dist, V.height, cz + Math.cos(az) * V.dist);
    camera.lookAt(0, V.height, cz);
    key.position.set(-3.2, 4.4, cz + 2.6);
    key.target.position.set(0, 0.9, cz);
    key.target.updateMatrixWorld();
    renderer.setViewport(i * colW, 0, colW, H);
    renderer.setScissor(i * colW, 0, colW, H);
    renderer.render(scene, camera);
  }
  renderer.setScissorTest(false);
  return { cols, colW, W, H, perCol, strideHz };
}

/** A single still at a chosen distance — the "does it read at 40 m" shot. */
function still(cfg) {
  const W = cfg.width;
  const H = cfg.height;
  renderer.setSize(W, H, false);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  renderer.setScissorTest(false);
  renderer.setClearColor(0x171b1f, 1);
  renderer.setViewport(0, 0, W, H);
  renderer.clear();
  reset(cfg);
  for (let i = 0; i < 60; i++) step(cfg);
  const d = cfg.dist;
  const az = ((cfg.az ?? 22) * Math.PI) / 180;
  const cz = group.position.z;
  camera.aspect = W / H;
  // A 1.9 m subject at a fixed on-screen height, whatever the distance: this is
  // a test of pixel density and silhouette, not of framing.
  camera.fov = (2 * Math.atan(1.9 / (cfg.fill ?? 0.62) / 2 / d) * 180) / Math.PI;
  camera.position.set(Math.sin(az) * d, 1.05 + d * 0.02, cz + Math.cos(az) * d);
  camera.lookAt(0, 1.0, cz);
  camera.updateProjectionMatrix();
  key.position.set(-3.2, 4.4, cz + 2.6);
  key.target.position.set(0, 0.9, cz);
  key.target.updateMatrixWorld();
  renderer.render(scene, camera);
  return { W, H, dist: d };
}

window.__gait = { record, strip, still, stats: def.stats };
window.__READY__ = true;
