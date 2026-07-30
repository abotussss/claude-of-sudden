#!/usr/bin/env node
/**
 * DOLLCHECK — the ragdoll blow-up gate.
 *
 * WHY THIS EXISTS. The player reported corpses that "turn into slime"
 * (「敵の死体コレ、ELIMINATEDした時になんでこんなスライムみたいになってしまうの？」) —
 * a body that should be 1.8 m long lying in a courtyard, drawn instead as a long
 * thin shape smeared over several metres. Nothing in the engine noticed, because
 * a ragdoll that has come apart still steps, still sleeps and still writes bone
 * transforms; only the *skin between* the bones is wrong, and no numeric check
 * looked at where the bones actually were.
 *
 * So this does. It kills actors every way the game can kill them — a bullet into
 * each hit region, a blast on a live man, a blast on a corpse that has already
 * settled, and enough kills to churn the corpse pool past `ai.corpseLimit` — and
 * for every ragdoll on the map it measures three things that have an authored
 * right answer:
 *
 *   span        the largest side of the bone bounding box. A man is 1.8 m; a
 *               body on the floor is under ~2 m in its longest axis. > 3 m is
 *               the bug the player photographed.
 *   stretch     max |tail - head| / boneLen. The bone lengths are authored by
 *               `specFromSkeleton` from the death pose, so 1.0 is exact and
 *               anything above it is a distance constraint that did not converge.
 *   jointDrift  for every bone with a parent, how much further its head has
 *               drifted from the parent's tail than it was in the bind pose.
 *               This is the one that catches limbs coming OFF, and it was the
 *               real fault: branch children in a bone table (Hips -> UpLegL/R,
 *               Spine2 -> ClavicleL/R) get their own particles, so before the
 *               fix nothing positional held an arm or a leg to the torso at all.
 *
 * It also reports connectivity — the number of disconnected particle islands in
 * each doll's constraint graph — which is a static property of the rig and is
 * the fastest way to see the fault come back.
 *
 * Usage:
 *   node src/physics/dollcheck.mjs                 # boots its own vite
 *   node src/physics/dollcheck.mjs --url=http://127.0.0.1:4212/
 *   node src/physics/dollcheck.mjs --verbose       # per-doll table
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import net from 'node:net';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const PORT = Number(args.port ?? 5214);
const URL = args.url ?? `http://127.0.0.1:${PORT}/`;
const TIMEOUT = Number(args.timeout ?? 240000);
const VERBOSE = !!args.verbose;

/* Gate thresholds. See the header for what each one means. */
const MAX_SPAN = 3.0;        // metres, largest AABB side
const MAX_STRETCH = 1.15;    // ratio of solved bone length to authored length
const MAX_DRIFT = 0.08;      // metres of joint separation beyond the bind pose

const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.setTimeout(400, () => (s.destroy(), res(false)));
  });

async function ensureServer() {
  if (args.url || (await portOpen(PORT))) return null;
  const root = resolve(import.meta.dirname, '../..');
  const p = spawn(resolve(root, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, OW_NO_HMR: '1' },
  });
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(PORT)) return p;
  }
  p.kill();
  throw new Error('vite failed to start');
}

const server = await ensureServer();

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE ' + m.text());
});

let exitCode = 0;
const rows = [];

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await page.waitForFunction('window.__READY__===true', null, { timeout: TIMEOUT });
  // The match owns who exists; nothing can be killed until it has put men on the
  // map. Without this the first two cases silently measure zero ragdolls.
  await page.waitForFunction(
    () => (window.__ENGINE__?.ctx.peek('ai')?.agents ?? []).filter((a) => a.alive).length >= 8,
    null, { timeout: 60000 }
  );

  /* ---------------- page-side instrument ---------------- */
  await page.evaluate(() => {
    const e = window.__ENGINE__;
    const ai = e.ctx.peek('ai');
    const phys = e.ctx.peek('physics');
    const V3 = ai._v.constructor;

    // Nobody shoots and nobody advances: every death in this run is one we asked
    // for, so a measurement can be attributed to the way the man was killed.
    ai.combatEnabled = false;

    const dist = (ax, ay, az, bx, by, bz) => Math.hypot(ax - bx, ay - by, az - bz);

    /** Disconnected particle islands in the doll's positional constraint graph. */
    const islands = (rd) => {
      const par = new Int32Array(rd.particleCount);
      for (let i = 0; i < par.length; i++) par[i] = i;
      const find = (a) => {
        while (par[a] !== a) a = par[a] = par[par[a]];
        return a;
      };
      const uni = (a, b) => {
        a = find(a); b = find(b);
        if (a !== b) par[a] = b;
      };
      for (let i = 0; i < rd.boneCount; i++) uni(rd.boneHead[i], rd.boneTail[i]);
      // whatever positional attachments the solver declares for branch joints
      const at = rd.attach;
      if (at) for (let k = 0; k < at.length; k += 2) uni(at[k], at[k + 1]);
      const set = new Set();
      for (let i = 0; i < rd.boneCount; i++) set.add(find(rd.boneHead[i]));
      return set.size;
    };

    const measure = (rd, label) => {
      const a = rd.aabb;
      const ex = a.maxx - a.minx, ey = a.maxy - a.miny, ez = a.maxz - a.minz;
      let stretch = 0, worstBone = '';
      for (let i = 0; i < rd.boneCount; i++) {
        const h = rd.boneHead[i], t = rd.boneTail[i];
        const l = dist(rd.px[h], rd.py[h], rd.pz[h], rd.px[t], rd.py[t], rd.pz[t]);
        const r = l / rd.boneLen[i];
        if (r > stretch) { stretch = r; worstBone = rd.spec[i].name; }
      }
      let drift = -Infinity, worstJoint = '';
      for (let i = 0; i < rd.boneCount; i++) {
        const p = rd.boneParent[i];
        if (p < 0) continue;
        const ch = rd.boneHead[i], pt = rd.boneTail[p];
        const cur = dist(rd.px[ch], rd.py[ch], rd.pz[ch], rd.px[pt], rd.py[pt], rd.pz[pt]);
        const sc = rd.spec[i].head, sp = rd.spec[p].tail;
        const rest = dist(sc[0], sc[1], sc[2], sp[0], sp[1], sp[2]);
        const d = cur - rest;
        if (d > drift) { drift = d; worstJoint = `${rd.spec[p].name}->${rd.spec[i].name}`; }
      }
      return {
        label,
        id: rd.id,
        bones: rd.boneCount,
        particles: rd.particleCount,
        islands: islands(rd),
        span: Math.max(ex, ey, ez),
        ex, ey, ez,
        diag: Math.hypot(ex, ey, ez),
        stretch,
        worstBone,
        drift: drift === -Infinity ? 0 : drift,
        worstJoint,
        sleeping: !!rd.sleeping,
        minY: a.miny,
        age: rd.age,
      };
    };

    /** Every ragdoll physics is still simulating. */
    const sampleAll = (label) => phys.ragdolls.map((rd) => measure(rd, label));

    /** Advance `sec` of simulated time, capped so a stall cannot hang the gate. */
    const run = (sec) =>
      new Promise((done) => {
        const t0 = e.time.elapsed;
        let frames = 0;
        const tick = () => {
          if (e.time.elapsed - t0 >= sec || ++frames > sec * 400) return done(frames);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

    const BONE_OF = { head: 'Head', torso: 'Spine1', arm: 'ForearmR', leg: 'LegR' };

    /** Nearest live actor to the player that we have not already used. */
    const pickLive = (used) => {
      const eye = e.camera.position;
      let best = null, bd = Infinity;
      for (const a of ai.agents) {
        if (!a.alive || used.has(a.id)) continue;
        const d = a.position.distanceTo(eye);
        if (d < bd) { bd = d; best = a; }
      }
      return best;
    };

    const shoot = (a, part) => {
      const p = new V3();
      a.animator.bonePos(BONE_OF[part] ?? 'Spine1', p);
      // a round arriving horizontally from the player's side of the map
      const d = new V3().subVectors(a.position, e.camera.position).setY(0);
      if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
      d.normalize();
      a.applyDamage(400, part, p, d, null);
      return { part, id: a.id, pos: p.toArray().map((v) => +v.toFixed(2)) };
    };

    const blastAt = (pos, radius, damage) => {
      // The real path: `ai` takes the damage off the event and `physics` shoves
      // every ragdoll inside the radius off the same event.
      e.events.emit('explosion', { position: pos, radius, damage });
    };

    window.__DOLL__ = { sampleAll, measure, run, pickLive, shoot, blastAt, ai, phys, V3, islands };
    return {
      corpseLimit: ai.corpseLimit,
      maxRagdolls: phys.maxRagdolls,
      agents: ai.agents.length,
      alive: ai.agents.filter((a) => a.alive).length,
    };
  }).then((cfg) => {
    console.log(
      `[doll] ai.corpseLimit=${cfg.corpseLimit} physics.maxRagdolls=${cfg.maxRagdolls} ` +
        `actors=${cfg.agents} alive=${cfg.alive}`
    );
    if (cfg.maxRagdolls < cfg.corpseLimit) {
      console.log(
        `[doll] FAIL cap mismatch: physics keeps ${cfg.maxRagdolls} ragdolls but ai keeps ` +
          `${cfg.corpseLimit} corpses, so ${cfg.corpseLimit - cfg.maxRagdolls} bodies are drawn ` +
          'by a disposed solver and freeze wherever they were — mid-air included.'
      );
      exitCode = 1;
    }
  });

  /* ---------------- case 1: a bullet into each region ---------------- */
  for (const part of ['head', 'torso', 'arm', 'leg']) {
    const got = await page.evaluate(async (p) => {
      const D = window.__DOLL__;
      const used = new Set();
      const shots = [];
      for (let k = 0; k < 3; k++) {
        const a = D.pickLive(used);
        if (!a) break;
        used.add(a.id);
        shots.push(D.shoot(a, p));
        await D.run(0.15);
      }
      await D.run(4.5);
      return { shots, dolls: D.sampleAll('bullet:' + p) };
    }, part);
    rows.push(...got.dolls);
    console.log(`[doll] bullet:${part.padEnd(6)} killed ${got.shots.length}, ${got.dolls.length} dolls live`);
  }

  /* ---------------- case 2: killed by a blast ---------------- */
  {
    const got = await page.evaluate(async () => {
      const D = window.__DOLL__;
      const a = D.pickLive(new Set());
      if (!a) return { dolls: D.sampleAll('blast:kill'), n: 0 };
      // airstrike numbers: RULES.airstrikeRadius 15, airstrikeDamage 260
      const pos = new D.V3(a.position.x, a.position.y + 0.6, a.position.z);
      D.blastAt(pos, 15, 260);
      await D.run(5.0);
      return { dolls: D.sampleAll('blast:kill'), n: 1 };
    });
    rows.push(...got.dolls);
    console.log(`[doll] blast:kill    radius 15 dmg 260, ${got.dolls.length} dolls live`);
  }

  /* ---------------- case 3: a blast on corpses that had settled ---------------- */
  {
    const got = await page.evaluate(async () => {
      const D = window.__DOLL__;
      const before = D.sampleAll('settled');
      // centre the blast on the pile of bodies we have already made
      let cx = 0, cy = 0, cz = 0, n = 0;
      for (const rd of D.phys.ragdolls) {
        cx += (rd.aabb.minx + rd.aabb.maxx) * 0.5;
        cy += (rd.aabb.miny + rd.aabb.maxy) * 0.5;
        cz += (rd.aabb.minz + rd.aabb.maxz) * 0.5;
        n++;
      }
      if (!n) return { before, after: [] };
      const pos = new D.V3(cx / n, cy / n + 0.5, cz / n);
      D.blastAt(pos, 15, 260);
      await D.run(0.5);
      const peak = D.sampleAll('blast:corpse:peak');
      await D.run(5.0);
      return { before, after: D.sampleAll('blast:corpse'), peak };
    });
    rows.push(...got.after, ...(got.peak ?? []));
    console.log(
      `[doll] blast:corpse  settled dolls before ${got.before.length}, after ${got.after.length}`
    );
  }

  /* ---------------- case 4: churn the pool past corpseLimit ---------------- */
  {
    const got = await page.evaluate(async () => {
      const D = window.__DOLL__;
      const parts = ['head', 'torso', 'arm', 'leg'];
      const used = new Set();
      let killed = 0;
      // Past `corpseLimit` AND past `maxRagdolls`, twice over, so every doll in
      // the pool has been created after some other doll was evicted.
      const want = Math.max(D.ai.corpseLimit, D.phys.maxRagdolls) * 2 + 4;
      for (let k = 0; k < want; k++) {
        const a = D.pickLive(used);
        if (!a) {
          // out of live men: let the match respawn some
          used.clear();
          await D.run(2.0);
          continue;
        }
        used.add(a.id);
        D.shoot(a, parts[k % parts.length]);
        killed++;
        await D.run(0.35);
      }
      await D.run(5.0);
      return {
        killed,
        dolls: D.sampleAll('recycled'),
        corpses: D.ai.agents.filter((a) => !a.alive).length,
      };
    });
    rows.push(...got.dolls);
    console.log(
      `[doll] recycled     ${got.killed} kills, ${got.corpses} corpses, ${got.dolls.length} dolls live`
    );
  }

  /* ---------------- verdict ---------------- */
  /**
   * A DOLL THAT IS UNDER THE FLOOR IS NOT A SOLVER MEASUREMENT. `src/world` is
   * live in this repo and a corpse that fell through a hole in the level is in
   * free fall with no contacts at all — its bones stretch because gravity is the
   * only thing acting on it, which says nothing about the constraint solver this
   * gate exists to check. They are counted and printed, never silently dropped.
   */
  const under = rows.filter((r) => r.minY < -0.5);
  const graded = rows.filter((r) => r.minY >= -0.5);
  const bad = graded.filter(
    (r) => r.span > MAX_SPAN || r.stretch > MAX_STRETCH || r.drift > MAX_DRIFT || r.islands > 1
  );
  const worst = (k) => graded.reduce((m, r) => (r[k] > m[k] ? r : m), graded[0] ?? { [k]: 0 });

  if (VERBOSE) {
    const pad = (s, n) => String(s).padEnd(n);
    console.log(
      `\n${pad('case', 20)}${pad('id', 5)}${pad('isl', 5)}${pad('span', 8)}${pad('stretch', 9)}` +
        `${pad('drift', 9)}${pad('minY', 8)}${pad('slp', 5)}worst`
    );
    for (const r of rows) {
      console.log(
        `${pad(r.label, 20)}${pad(r.id, 5)}${pad(r.islands, 5)}${pad(r.span.toFixed(2), 8)}` +
          `${pad(r.stretch.toFixed(3), 9)}${pad(r.drift.toFixed(3), 9)}` +
          `${pad(r.minY.toFixed(2), 8)}${pad(r.sleeping ? 'y' : 'n', 5)}` +
          `${r.worstBone} / ${r.worstJoint}`
      );
    }
  }

  console.log(`\n=== DOLLCHECK — ${rows.length} ragdoll samples ===`);
  if (under.length) {
    console.log(
      `  ${under.length} sample(s) had a bone below y=-0.5 — a body that fell through the level, ` +
        'not a solver result. Not graded. Lowest: ' +
        `${Math.min(...under.map((r) => r.minY)).toFixed(2)} m [${under[0].label}]`
    );
  }
  if (graded.length) {
    const ws = worst('span'), wt = worst('stretch'), wd = worst('drift'), wi = worst('islands');
    console.log(`  islands  worst ${wi.islands}   (1 = one connected body)`);
    console.log(`  span     worst ${ws.span.toFixed(2)} m  limit ${MAX_SPAN}  [${ws.label}]`);
    console.log(
      `  stretch  worst ${wt.stretch.toFixed(3)}  limit ${MAX_STRETCH}  [${wt.label} ${wt.worstBone}]`
    );
    console.log(
      `  drift    worst ${wd.drift.toFixed(3)} m  limit ${MAX_DRIFT}  [${wd.label} ${wd.worstJoint}]`
    );
    console.log(`  over limit: ${bad.length} / ${graded.length} graded samples`);
  } else {
    console.log('  no ragdolls were produced — the gate measured nothing');
    exitCode = 1;
  }
  if (bad.length) {
    exitCode = 1;
    for (const r of bad.slice(0, 12)) {
      console.log(
        `  BAD ${r.label} #${r.id}: islands ${r.islands} span ${r.span.toFixed(2)} ` +
          `stretch ${r.stretch.toFixed(3)} (${r.worstBone}) drift ${r.drift.toFixed(3)} (${r.worstJoint})`
      );
    }
  }

  if (errors.length) {
    console.log(`\n=== ${errors.length} console/page errors ===`);
    for (const l of errors.slice(0, 10)) console.log(' ', l);
    if (errors.some((l) => l.startsWith('PAGEERROR'))) exitCode = 1;
  }
} catch (err) {
  console.error('dollcheck failed:', err);
  exitCode = 1;
} finally {
  await browser.close();
  server?.kill();
}

console.log(exitCode === 0 ? '\nDOLLCHECK: PASS' : '\nDOLLCHECK: FAIL');
process.exit(exitCode);
