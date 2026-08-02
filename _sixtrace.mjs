/**
 * TRACE ONE CLIMB. Teleport a live bot to the foot of a post, hand him the
 * post, and print his y / cursor / speed / grounded every frame until he is up
 * or the clock kills it. The `1:timeout` failures are invisible in aggregate.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs=[]; p.on('pageerror',(e)=>errs.push(String(e.message)));
await p.goto(`http://127.0.0.1:4450/?seed=${+(args.seed ?? 7)}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((k)=>new Promise(r=>{let i=0;const t=()=>(++i>=k?r():requestAnimationFrame(t));requestAnimationFrame(t);}), n);
await p.waitForFunction(() => { const m=window.__ENGINE__.ctx.peek('match'); return m && String(m.phase).toLowerCase()==='live'; }, null, { timeout: 120000 }).catch(()=>{});
await wait(30);
const idx = +(args.post ?? 0);
await p.evaluate((i) => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  const post = ai.stairs.posts[i];
  const a = ai.agents.find((x) => x.alive && !x.post);
  window.__T__ = { rows: [], a, post, name: a.name, building: post.building, route: post.route.map(w=>[+w.x.toFixed(1),+w.y.toFixed(2),+w.z.toFixed(1)]) };
  // put him at the foot and hand him the post directly
  a.position.copy(post.foot); a.position.y += 0.1;
  a.controller?.teleport(a.position.x, a.position.y, a.position.z);
  post.held = a.id; a.post = post; a.postPhase = 1; a.postWp = 1; a.postTimer = 40;
  a.squad?.claimPost(a);
  a.hasTarget = false; a.targetActor = null;
  window.__SAMPLE__ = () => {
    const T = window.__T__;
    T.rows.push([+a.position.x.toFixed(2), +a.position.y.toFixed(2), +a.position.z.toFixed(2),
      a.post ? a.postPhase : -1, a.postWp, +a.speed.toFixed(2), a.grounded ? 1 : 0,
      a.animator.vaulting ? 1 : 0, +(a.controller?.steppedUp ?? 0).toFixed(3)]);
  };
}, idx);
for (let i = 0; i < 260; i++) { await wait(1); await p.evaluate(() => window.__SAMPLE__()); }
const r = await p.evaluate(() => {
  const T = window.__T__, a = T.a, phys = window.__ENGINE__.ctx.peek('physics');
  const wp = a.post ? a.post.route[a.postWp] : null;
  const probe = [];
  if (wp) {
    const dx = wp.x - a.position.x, dz = wp.z - a.position.z;
    const L = Math.hypot(dx, dz) || 1; const fx = dx / L, fz = dz / L;
    for (const h of [0.15, 0.35, 0.60, 0.95, 1.40]) {
      const hit = phys.raycast(a.position.x, a.position.y + h, a.position.z, fx, 0, fz, 2.0, phys.MASK.WORLD);
      probe.push([h, hit.hit ? +hit.distance.toFixed(2) : -1]);
    }
    // and what is directly under the next waypoint
    const dn = phys.raycast(wp.x, wp.y + 1.2, wp.z, 0, -1, 0, 3, phys.MASK.WORLD);
    probe.push(['under-wp', dn.hit ? +dn.point.y.toFixed(2) : -1]);
  }
  return { name: T.name, b: T.building, route: T.route, rows: T.rows,
    stuckAt: [+a.position.x.toFixed(2), +a.position.y.toFixed(2), +a.position.z.toFixed(2)],
    wp: wp ? [+wp.x.toFixed(2), +wp.y.toFixed(2), +wp.z.toFixed(2)] : null,
    wpIndex: a.postWp, phase: a.postPhase, blocked: a.controller?.lastMoveBlocked,
    touchingWall: a.controller?.touchingWall, probe };
});
console.log('agent', r.name, 'building', r.b);
console.log('route', JSON.stringify(r.route));
console.log('x     y     z     ph wp spd gr vlt step');
let last=null;
for (const row of r.rows) { const k=row.slice(1,5).join(','); if (k!==last) { console.log(row.join('  ')); last=k; } }
console.log('final', JSON.stringify(r.rows[r.rows.length-1]));
console.log('stuckAt', JSON.stringify(r.stuckAt), 'wp', JSON.stringify(r.wp), 'idx', r.wpIndex, 'phase', r.phase);
console.log('blocked', r.blocked, 'wall', r.touchingWall, 'forward rays', JSON.stringify(r.probe));
if (errs.length) console.log('pageerrors', errs.slice(0,4));
await b.close();
