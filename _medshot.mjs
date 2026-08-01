/**
 * PHOTOGRAPH THE MEDICAL ZONE, and take a kit while the camera is on it.
 *
 * Two claims have to be visible rather than logged: that a dressing station
 * LOOKS like one from down the lane (the ammunition dump `world` built there
 * looks like every other crate on the map, which is the whole reason `match`
 * paints a disc and stands a cross over it), and that HOLD F returns
 * `RULES.medicHeal` to a wounded man of either side.
 *
 * The player is hurt to 42 HP first, because `RULES.regen` is false and a man on
 * 100 is refused by design — photographing the refusal would prove nothing about
 * the feature.
 *
 *   node _medshot.mjs [url] [seed]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.argv[2] ?? 'http://127.0.0.1:4294/';
const SEED = process.argv[3] ?? '11';
const OUT = 'shots/verify';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const frames = (n) =>
  page.evaluate(
    (k) =>
      new Promise((d) => {
        let i = 0;
        const t = () => (++i >= k ? d() : requestAnimationFrame(t));
        requestAnimationFrame(t);
      }),
    n
  );

await page.evaluate(
  () =>
    new Promise((done) => {
      const e = window.__ENGINE__;
      e.input.frozen = true;
      e.input.enabled = false;
      e.ctx.peek('player')?.setControlEnabled?.(false);
      e.time.scale = 8;
      const m = e.ctx.peek('match');
      const t = () => (m.phase === 'live' ? (e.time.scale = 1, done()) : requestAnimationFrame(t));
      t();
    })
);

/** Stand `d` metres off the post on its own facing, at eye height. */
const stand = (d) =>
  page.evaluate((dist) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const V3 = e.camera.position.constructor;
    const c = m.caches.list.find((x) => x.kind === 'medic');
    if (!c) return null;
    const phys = e.ctx.peek('physics');
    const p = c.position;
    /**
     * PICK A BEARING WITH A CLEAR LINE TO THE POST.
     *
     * The first version used the cache's own `yaw`, which for an indoor feature
     * points at the middle of its floor plate — off a flank square it put the
     * camera inside the building next door and every photograph was of a dark
     * wall. Sweep sixteen bearings and take the first from which the post is
     * actually visible, which is the same `lineOfSight` test `src/ai` uses to
     * decide whether a man can see a blast.
     */
    const eye = new V3();
    const target = new V3(p.x, p.y + 1.0, p.z);
    let best = null;
    for (let i = 0; i < 16; i++) {
      const th = (i / 16) * Math.PI * 2;
      eye.set(p.x + Math.cos(th) * dist, p.y + 1.65, p.z + Math.sin(th) * dist);
      if (phys.lineOfSight(eye, target, phys.MASK.SIGHT)) { best = eye.clone(); break; }
    }
    if (!best) best = new V3(p.x, p.y + 1.65, p.z + dist);
    e.camera.position.copy(best);
    e.camera.lookAt(target);
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    return { id: c.id, kind: c.kind, label: c.label, cam: [+best.x.toFixed(1), +best.z.toFixed(1)] };
  }, d);

/**
 * FIRST, PROVE THE DRESSING IS WHERE IT SAYS IT IS. A merged mesh that ends up
 * at the origin, or inside the floor, would still be "in the scene" — so the
 * bounding box is read back and compared against the post it was built for.
 */
const geom = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const g = m.caches.medGroup;
  if (!g) return { err: 'no medGroup' };
  const out = [];
  g.traverse((o) => {
    if (!o.geometry) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    out.push({
      name: o.name,
      tris: (o.geometry.index?.count ?? 0) / 3,
      min: [+bb.min.x.toFixed(1), +bb.min.y.toFixed(2), +bb.min.z.toFixed(1)],
      max: [+bb.max.x.toFixed(1), +bb.max.y.toFixed(2), +bb.max.z.toFixed(1)],
      visible: o.visible,
      inScene: !!o.parent,
    });
  });
  return { posts: m.caches.list.filter((c) => c.kind === 'medic').map((c) => c.id), meshes: out };
});
console.log('dressing:', JSON.stringify(geom));

/** An elevated three-quarter view, so the ground paint and the standard both read. */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const c = m.caches.list.find((x) => x.kind === 'medic');
  const p = c.position;
  const target = new V3(p.x, p.y + 1.0, p.z);
  const eye = new V3();
  let best = null;
  for (let i = 0; i < 24 && !best; i++) {
    const th = (i / 24) * Math.PI * 2;
    eye.set(p.x + Math.cos(th) * 7.5, p.y + 4.2, p.z + Math.sin(th) * 7.5);
    if (phys.lineOfSight(eye, target, phys.MASK.SIGHT)) best = eye.clone();
  }
  e.camera.position.copy(best ?? new V3(p.x, p.y + 4.2, p.z + 7.5));
  e.camera.lookAt(new V3(p.x, p.y + 0.4, p.z));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
});
await frames(30);
await page.screenshot({ path: `${OUT}/med-0-zone.png` });

const far = await stand(11);
await frames(30);
await page.screenshot({ path: `${OUT}/med-1-lane.png` });
console.log('post:', JSON.stringify(far));

await stand(2.1);
await frames(24);
await page.screenshot({ path: `${OUT}/med-2-prompt-full.png` });

/* ---- hurt him, then take a kit -------------------------------------- */
const before = await page.evaluate(() => {
  const p = window.__ENGINE__.ctx.peek('player');
  p.health.value = 42;
  return { hp: p.health.value, max: p.health.max };
});
await frames(20);
await page.screenshot({ path: `${OUT}/med-3-prompt-hurt.png` });

const took = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const p = e.ctx.peek('player');
  const c = m.caches.nearest(p.position);
  if (!c) return { err: 'no cache in reach — the camera is not on the post' };
  const hp0 = p.health.value;
  const got = m.caches.take(c, e.time.elapsed);
  return {
    kind: c.kind,
    hp0,
    hp1: p.health.value,
    got,
    denied: m.caches.denied,
    cooldown: +(c.readyAt - e.time.elapsed).toFixed(1),
    stats: { medkits: m.caches.stats.medkits, healed: m.caches.stats.healed },
  };
});
await frames(16);
await page.screenshot({ path: `${OUT}/med-4-taken.png` });

/** …and immediately again, to photograph the per-post cooldown refusal. */
const again = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const p = e.ctx.peek('player');
  const c = m.caches.nearest(p.position);
  const got = m.caches.take(c, e.time.elapsed);
  return { got, denied: m.caches.denied ? { ...m.caches.denied } : null };
});
await frames(14);
await page.screenshot({ path: `${OUT}/med-5-cooldown.png` });

console.log('before:', JSON.stringify(before));
console.log('take:  ', JSON.stringify(took));
console.log('again: ', JSON.stringify(again));
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
