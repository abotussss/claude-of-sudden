/** Fire NW6, let it settle, reset the round, and prove the building is back. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('shots/demoreset', { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto('http://127.0.0.1:4252/?capture=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const pose = { from: [-72.5, 46], look: [-63, 46], eye: 1.7, aim: 2.5 };
const repose = (q) => {
  const e = window.__ENGINE__, world = e.ctx.peek('world'), phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor, S = 1.5;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
  const at = (lx, lz) => { const w = world.levelToWorld(lx*S,0,lz*S,new V3());
    const h = phys.raycast(w.x, 40, w.z, 0, -1, 0, 90, phys.MASK.WORLD); w.y = h.hit ? h.point.y : 0; return w; };
  const f = at(q.from[0], q.from[1]), t = at(q.look[0], q.look[1]);
  e.camera.position.set(f.x, f.y + q.eye, f.z);
  e.camera.lookAt(new V3(t.x, q.aim, t.z));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
};
const state = () => p.evaluate(() => {
  const e = window.__ENGINE__, w = e.ctx.peek('world'), st = e.ctx.peek('match').airstrike;
  const rec = w.demolitions.find(d => d.id === 'NW6');
  const s = st.sites.find(x => x.id === 'NW6');
  return { down: rec.down, shellVisible: rec.shell.visible, shellSolid: rec.shell.solid,
    ruinVisible: rec.ruin.visible, ruinSolid: rec.ruin.solid,
    struck: s.struck, baked: s.baked, meshVisible: s.meshes.map(m => m.visible) };
});
await p.evaluate(repose, pose); await p.waitForTimeout(600);
console.log('before  ', JSON.stringify(await state()));
await p.screenshot({ path: 'shots/demoreset/1-before.png' });
// Poll rather than sleep: the match starts rounds on its own and a round start
// calls `airstrike.reset()`, which would put the building back before we looked.
const settled = await p.evaluate(async () => {
  const st = window.__ENGINE__.ctx.peek('match').airstrike;
  const w = window.__ENGINE__.ctx.peek('world');
  st.enabled = false;
  // The match starts rounds on its own and a round start resets the town. Hold it
  // off for the length of the observation, then hand it back.
  const realReset = st.reset.bind(st);
  st.reset = () => {};
  window.__RESTORE_RESET__ = () => { st.reset = realReset; };
  const s = st.sites.find(x => x.id === 'NW6');
  const rec = w.demolitions.find(d => d.id === 'NW6');
  st.fire(s.index);
  const snap = [];
  for (let i = 0; i < 200; i++) {
    await new Promise(r => setTimeout(r, 120));
    snap.push({ t: +s.t.toFixed(2), baked: s.baked, struck: s.struck,
      shellVisible: rec.shell.visible, shellSolid: rec.shell.solid,
      ruinVisible: rec.ruin.visible, ruinSolid: rec.ruin.solid });
    if (s.baked) break;
  }
  return { first: snap[0], last: snap[snap.length - 1], samples: snap.length,
    everInvisibleAndSolid: snap.some(x => !x.shellVisible && x.shellSolid) };
});
console.log('during  ', JSON.stringify(settled));
await p.evaluate(() => window.__RESTORE_RESET__?.());
await p.evaluate(repose, pose);
console.log('settled ', JSON.stringify(await state()));
await p.screenshot({ path: 'shots/demoreset/2-settled.png' });
await p.evaluate(() => window.__ENGINE__.ctx.peek('match').airstrike.reset());
await p.waitForTimeout(1200);
await p.evaluate(repose, pose); await p.waitForTimeout(500);
console.log('reset   ', JSON.stringify(await state()));
await p.screenshot({ path: 'shots/demoreset/3-reset.png' });
if (errs.length) console.log('PAGE ERRORS', errs);
await b.close();
