/**
 * ════════════════════════════════════════════════════════════════════════════
 * DOES A TWENTY-MINE FIELD ACTUALLY CATCH ANYTHING? — the placement question,
 * isolated from everything else
 * ════════════════════════════════════════════════════════════════════════════
 * `_dtankwar.mjs` ran the whole match and answered NO twice: 20 laid, 20 armed,
 * 0 tripped, with two different placement rules. That run costs 25 minutes and
 * mixes three variables — WHEN the mines went down (t = 0-100 s), WHERE (wherever
 * a bearer happened to be), and whether armour ever came (t = 346 s). This
 * separates them.
 *
 * The armour is rolled BY HAND on the first frame, the whole ration is laid at
 * that moment by a stated rule, and the run then watches for `tripped` while the
 * hulls drive their legs. Three rules are compared, and the comparison is the
 * output:
 *
 *   A  nearest enemy lane to the bearer          — `_dtankwar`'s rule
 *   B  nearest enemy lane WITHIN 45 m OF A ZONE  — the refinement
 *   C  on the enemy lane a hull is ACTUALLY ON, ahead of it — the ceiling, and
 *      not a rule a bot could follow; it is here to say what perfect knowledge
 *      would be worth, so the gap between B and C is the honest cost of the
 *      information a man does not have
 *
 * Usage: BASE=http://127.0.0.1:4638/ MAP=plains node _dminefield.mjs [seed]
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4638/';
const MAP = process.env.MAP ?? 'plains';
const SEEDS = (process.argv[2] ?? '7,12').split(',');
const SECS = Number(process.argv[3] ?? 220);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

for (const SEED of SEEDS) {
  for (const RULE of ['A', 'B', 'C']) {
    const page = await b.newPage({ viewport: { width: 800, height: 520 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message)));
    await page.goto(`${BASE}?capture=1&map=${MAP}&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

    const res = await page.evaluate(async ({ RULE, SECS }) => {
      const e = window.__ENGINE__;
      const m = e.ctx.peek('match');
      const w = e.ctx.peek('weapons');
      const ai = e.ctx.peek('ai');
      const ph = e.ctx.peek('physics');
      e.input.frozen = true; e.input.enabled = false;
      e.ctx.peek('player')?.setControlEnabled?.(false);
      e.time.scale = 8;
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      while (m.phase !== 'live') await frame();
      const armour = m.tank;
      armour.fire();
      for (let i = 0; i < 20; i++) await frame();

      const zones = (m.allZones ?? m.sites ?? []).map((z) => z.position ?? z);
      const put = (x, z, team, owner) => {
        const y = ph.groundHeight(x, z, 60);
        if (!Number.isFinite(y)) return false;
        return w.layMine({ x, y: y + 0.25, z }, { team, owner });
      };

      let laid = 0;
      const spots = [];
      if (RULE === 'C') {
        // Perfect knowledge: down the leg each hull is on, ahead of it.
        let k = 0;
        while (laid < 20) {
          const t = armour.tanks[k % armour.tanks.length];
          k++;
          if (!t.alive) { if (k > 60) break; continue; }
          const leg = t.legs[t.legIx];
          const ahead = 25 + (Math.floor(laid / armour.tanks.length)) * 30;
          const s = Math.min(leg.length - 1, t.s + ahead * t.legDir);
          let i = 0;
          while (i < leg.n - 1 && leg.S[i + 1] < s) i++;
          if (put(leg.X[i], leg.Z[i], t.team === 0 ? 1 : 0, null)) { laid++; spots.push([+leg.X[i].toFixed(0), +leg.Z[i].toFixed(0)]); }
          if (k > 200) break;
        }
      } else {
        // A or B: a bearer's own view of the map.
        const bearers = [];
        for (const team of [0, 1]) {
          let n = 0;
          for (const a of ai?.agents ?? []) {
            if (a.team !== team || !a.alive) continue;
            bearers.push(a);
            if (++n >= 5) break;
          }
        }
        // Give each man his two, walking him to the spot the rule names.
        for (const a of bearers) {
          for (let j = 0; j < 2; j++) {
            let ln = null;
            if (RULE === 'A') {
              ln = armour.laneNear(a.position.x, a.position.z, 400, a.team);
            } else {
              // B: the nearest enemy lane point that is ALSO within 45 m of a
              // capture point, searched by asking round each zone in turn.
              let best = null;
              for (const z of zones) {
                const c = armour.laneNear(z.x, z.z, 45, a.team);
                if (!c) continue;
                const d = Math.hypot(c.x - a.position.x, c.z - a.position.z);
                if (!best || d < best.d2) best = { x: c.x, z: c.z, d2: d, yaw: c.yaw };
              }
              ln = best;
            }
            if (!ln) continue;
            // Two mines from one man are not stacked: the second goes 12 m
            // further down the same lane.
            const off = j * 12;
            const x = ln.x + Math.sin(ln.yaw ?? 0) * off;
            const z = ln.z + Math.cos(ln.yaw ?? 0) * off;
            if (put(x, z, a.team, a)) { laid++; spots.push([+x.toFixed(0), +z.toFixed(0)]); }
            if (laid >= 20) break;
          }
          if (laid >= 20) break;
        }
      }

      const t0 = m.roundClock;
      const kills0 = { ...armour.kills };
      while (t0 - m.roundClock < SECS && m.phase === 'live') await frame();
      const st = { ...w.mineStats };
      return {
        rule: RULE, laid, armed: st.armed, tripped: st.tripped,
        kills: armour.kills, kills0,
        alive: armour.tanks.filter((t) => t.alive).length,
        dead: armour.tanks.filter((t) => t.state === 'dead').map((t) => `${t.id}:${t.lastOrd}`),
        secs: +(t0 - m.roundClock).toFixed(0),
        spots: spots.slice(0, 6),
      };
    }, { RULE, SECS });

    console.log(
      `seed ${SEED} rule ${res.rule}: laid ${res.laid} armed ${res.armed} → TRIPPED ${res.tripped} · ` +
      `hulls dead ${res.dead.length}/6 [${res.dead.join(' ')}] · kills ${JSON.stringify(res.kills)} · ${res.secs}s` +
      (errs.length ? `  [pageerror ${errs.length}]` : '')
    );
    await page.close();
  }
}
await b.close();
