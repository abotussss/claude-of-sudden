/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHO ARE THE THREE, AND ARE THEY WEDGED OR IS IT THE THRESHOLD?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node _stuckwho.mjs --url=http://127.0.0.1:4628/?map=town&capture=1
 *
 * `tools/stuckcheck.mjs` reports a COUNT — "bots stuck >=5 consecutive samples:
 * 3 / 41" — and a name, and nothing else. A name is not a diagnosis: a man
 * pinned against a kerb, a man standing in a doorway he has chosen to hold, and
 * a man the gate's own arithmetic has misclassified all print the same line.
 *
 * SO THIS RUNS STUCKCHECK'S EXACT CLASSIFIER — `desiredSpeed > 0.1`, sampled
 * every 8 frames at `time.scale = 8`, a sample counted stuck when the man moved
 * under 0.15 m in the plan since the last one, five consecutive of them — and
 * for every man it flags, records what the engine knew about him at each of
 * those samples: his state, his rung on the unstick ladder, whether he had a
 * path at all, what he was standing on and how far he was from the waypoint he
 * was steering at.
 *
 * IT ALSO MEASURES WHAT THE GATE CANNOT SEE, which is the point:
 *
 *   dY          `stuckcheck` measures `hypot(dx, dz)` and a stair, a ladder and
 *               a vault are all Y. A man climbing at 1.2 m/s scores 0.00 m.
 *   fine track  the plan distance he ACTUALLY covered between two samples,
 *               integrated per frame rather than measured end to end, so a man
 *               shuffling 3 m back and forth in a doorway is told apart from a
 *               man who has not moved a millimetre.
 *   speed       `speed` against `desiredSpeed`: a man being refused by the
 *               collider reads a desire and no velocity; a man the AI has told
 *               to hold reads neither.
 *
 * The classification is stuckcheck's, verbatim, so the count printed here is
 * the count that gate prints. Nothing is decided here — it only reports.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4628/?map=town&capture=1';
const SAMPLES = +(args.samples ?? 40);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

const wait = (n) => p.evaluate((n) => new Promise((r) => {
  let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await wait(200);

await p.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const ai = ctx.peek('ai');
  const phys = ctx.peek('physics');
  const match = ctx.peek('match');
  const S = {
    last: new Map(), run: new Map(), rows: new Map(), samples: 0,
    moved: new Map(), worst: new Map(),
    // per-frame plan distance, accumulated between samples
    fine: new Map(), finePrev: new Map(),
  };
  window.__S__ = S;

  /** Integrate the real path length between samples, one frame at a time. */
  const perFrame = () => {
    for (const a of ai.agents ?? []) {
      if (!a.alive) continue;
      const k = a.name ?? String(a.id);
      const q = a.position;
      const prev = S.finePrev.get(k);
      if (prev) S.fine.set(k, (S.fine.get(k) ?? 0) + Math.hypot(q.x - prev.x, q.z - prev.z));
      S.finePrev.set(k, { x: q.x, z: q.z });
    }
    requestAnimationFrame(perFrame);
  };
  requestAnimationFrame(perFrame);

  const zones = (match?.allZones ?? match?.sites ?? []).map((z) =>
    ({ id: z.id, x: z.position.x, z: z.position.z }));

  window.__T__ = () => {
    S.samples++;
    for (const a of ai.agents ?? []) {
      if (!a.alive) continue;
      const q = a.position;
      const k = a.name ?? String(a.id);
      const prev = S.last.get(k);
      // stuckcheck's own test, verbatim
      const wants = (a.desiredSpeed ?? a.speed ?? 1) > 0.1;
      let d = null, dy = null;
      if (prev) {
        d = Math.hypot(q.x - prev.x, q.z - prev.z);
        dy = q.y - prev.y;
        S.moved.set(k, (S.moved.get(k) ?? 0) + d);
        const stuck = wants && d < 0.15;
        const r = stuck ? (S.run.get(k) ?? 0) + 1 : 0;
        S.run.set(k, r);
        S.worst.set(k, Math.max(S.worst.get(k) ?? 0, r));
        if (stuck) {
          let g = null;
          try { g = phys.groundHeight(q.x, q.z, 30); } catch { g = null; }
          let near = '-', nd = 1e9;
          for (const z of zones) {
            const zd = Math.hypot(q.x - z.x, q.z - z.z);
            if (zd < nd) { nd = zd; near = `${z.id}+${zd.toFixed(0)}m`; }
          }
          const list = S.rows.get(k) ?? [];
          list.push({
            s: S.samples,
            at: [+q.x.toFixed(1), +q.y.toFixed(2), +q.z.toFixed(1)],
            dPlan: +d.toFixed(3),
            dY: +dy.toFixed(3),
            fine: +(S.fine.get(k) ?? 0).toFixed(2),
            want: +(a.desiredSpeed ?? -1).toFixed(2),
            spd: +(a.speed ?? -1).toFixed(2),
            state: a.state,
            rung: a.stuckRung,
            // THE POST MANOEUVRE, because `_trackProgress` opens by exempting
            // it: `if (this.post && this.postPhase > 0) return` — no rung of
            // the unstick ladder can ever fire on these men, by design, and
            // their recovery is `_runPost`'s own POST_PHASE_T = 12 s clock.
            post: a.post ? (a.post.id ?? 'yes') : null,
            phase: a.postPhase ?? null,
            pTimer: a.post ? +(a.postTimer ?? 0).toFixed(1) : null,
            pWp: a.post ? (a.postWp ?? null) : null,
            detT: +(a._detourTimer ?? 0).toFixed(2),
            progT: +(a._progTime ?? 0).toFixed(2),
            stallT: +(a._stallTime ?? 0).toFixed(2),
            path: (a.path?.length ?? 0),
            hasT: !!a.hasMoveTarget,
            toT: a.hasMoveTarget ? +a.position.distanceTo(a.moveTarget).toFixed(1) : null,
            noRoute: a._noRouteSince >= 0,
            crouch: !!a.crouch,
            sup: +(a.suppression ?? 0).toFixed(2),
            fire: !!a.wantFire,
            overGround: g == null ? null : +(q.y - g).toFixed(2),
            near,
            team: a.team,
          });
          S.rows.set(k, list);
        }
      }
      S.fine.set(k, 0);
      S.last.set(k, { x: q.x, y: q.y, z: q.z });
    }
  };
});

for (let i = 0; i < SAMPLES; i++) { await wait(8); await p.evaluate(() => window.__T__()); }

const out = await p.evaluate(() => {
  const S = window.__S__;
  const rows = [...S.worst.entries()].map(([k, v]) =>
    ({ name: k, worst: v, moved: +(S.moved.get(k) ?? 0).toFixed(1), detail: S.rows.get(k) ?? [] }));
  rows.sort((a, c) => c.worst - a.worst);
  const ps = window.__ENGINE__.ctx.peek('ai').postStats ?? null;
  return { n: rows.length, samples: S.samples, rows, postStats: ps && JSON.parse(JSON.stringify(ps)) };
});

const hard = out.rows.filter((r) => r.worst >= 5);
console.log(`\n  ${out.n} live bots, ${out.samples} samples`);
console.log(`  bots stuck >=5 consecutive samples: ${hard.length} / ${out.n}   <- this is the gate\n`);
for (const r of out.rows.slice(0, 8)) {
  console.log(`  ${r.name.padEnd(12)} worst run ${String(r.worst).padStart(3)}   moved ${String(r.moved).padStart(7)} m` +
    (r.worst >= 5 ? '   <<< FLAGGED' : ''));
}
console.log('\n=== EVERY STUCK SAMPLE OF EVERY FLAGGED MAN ===');
for (const r of hard) {
  console.log(`\n  --- ${r.name}  (worst run ${r.worst}, total moved ${r.moved} m)`);
  for (const d of r.detail) console.log('     ' + JSON.stringify(d));
}
console.log('\n=== postStats (the manoeuvre this gate is about) ===');
console.log('  ' + JSON.stringify(out.postStats));
console.log(`\npageerrors ${errs.length} ${errs[0] ?? ''}`);
await b.close();
