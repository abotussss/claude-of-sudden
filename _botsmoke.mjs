/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PLAYER'S CAN AND A BOT'S CAN, SIDE BY SIDE, AS `fx` RECEIVES THEM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node _botsmoke.mjs --url=http://127.0.0.1:4540/
 *
 * `AiSystem._detonateThrown` and `ThrownGrenades._smoke` are two copies of one
 * drawing and they have now drifted twice. A PHOTOGRAPH cannot tell them apart
 * cheaply — it needs a control plate, a ruler and an exposure correction (@see
 * `_smokemeasure.mjs`) — but the drift is entirely in the arguments, so the
 * decisive test is to intercept `fx.addSmokeSource` and read them.
 *
 * What is printed is the option bag each path sends and the DRAWN DIMENSIONS it
 * implies, because none of the four numbers is a size on its own:
 *
 *   `Ambience._puff` spawns inside ±0.6 * radius, is born radius * (0.7..1.2)
 *   across, and grows to radius * growth. `rate * life` is the live sprite
 *   count, which is what the `fx.lit` ring has to hold.
 *
 * A pass is the two bags being equal field for field at the same gameplay
 * radius. Anything else is the drift, printed.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4540/';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=7`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const fx = e.ctx.peek('fx');
  const ai = e.ctx.peek('ai');
  const wp = e.ctx.peek('weapons');
  const m = e.ctx.peek('match');
  const V3 = e.camera.position.constructor;
  const frame = () => new Promise((r) => requestAnimationFrame(r));

  const seen = [];
  const add0 = fx.addSmokeSource.bind(fx);
  fx.addSmokeSource = (p, o) => {
    seen.push({ ...o });
    return add0(p, o);
  };

  const sp = m.spawns.attack[0].position;
  const at = new V3(sp.x + 12, sp.y + 0.2, sp.z);

  /* ---- the player's own, which is the authority ---------------------- */
  const g = wp?.grenades ?? wp?.thrown;
  g?._smoke?.(at, { smokeRadius: 10, smokeDuration: 14 });
  await frame();
  const player = seen.pop() ?? null;

  /* ---- and a bot's ---------------------------------------------------- */
  ai._detonateThrown('smoke', at, 0);
  await frame();
  const bot = seen.pop() ?? null;

  return {
    litCapacity: fx.lit?.capacity ?? 0,
    particleBudget: e.ctx.config?.q?.particleBudget ?? null,
    aiGameplayRadius: ai._smokeR,
    player,
    bot,
  };
});

await page.close();
await browser.close();

const dims = (o) => (o ? {
  gameplayRadius: 10,
  footprint: +(o.radius).toFixed(2),
  spawnDiscDiameter: +(o.radius * 1.2).toFixed(2),
  newbornPuffAcross: [+(o.radius * 0.7).toFixed(2), +(o.radius * 1.2).toFixed(2)],
  fullyGrownPuffAcross: +(o.radius * o.growth).toFixed(2),
  liveSprites: Math.round(o.rate * o.life),
} : null);

const same = out.player && out.bot
  && ['rate', 'radius', 'growth', 'life', 'rise', 'dark', 'haze', 'duration']
    .every((k) => Math.abs((out.player[k] ?? 0) - (out.bot[k] ?? 0)) < 1e-9);

console.log(JSON.stringify({
  pageerrors: errs,
  litCapacity: out.litCapacity,
  particleBudget: out.particleBudget,
  aiGameplayRadius: out.aiGameplayRadius,
  playerBag: out.player,
  botBag: out.bot,
  playerDrawn: dims(out.player),
  botDrawn: dims(out.bot),
  identical: same,
}, null, 2));
