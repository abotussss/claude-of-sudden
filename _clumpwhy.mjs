/**
 * WHERE THE PACK FORMS, and what the fireteam cut actually produced.
 * Diagnostic only. Reports, per sample: the fireteam size histogram, and for
 * every man in a >=6-man 8 m circle, what he was doing and how far he was from
 * the nearest capture point.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4365/';
const SEED = +(args.seed ?? 1);
const SAMPLES = +(args.samples ?? 60);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((k) => new Promise((r) => { let i = 0; const t = () => (++i >= k ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await wait(90);
await p.evaluate(() => {
  const e = window.__ENGINE__, ai = e.ctx.peek('ai'), m = e.ctx.peek('match');
  const bases = [...m.spawns.attack, ...m.spawns.defend].map((s) => s.position);
  const zones = m.capture ? m.capture.zones : [];
  window.__D__ = { ftSize: {}, states: {}, modes: {}, zoneDist: [], packs: 0, samples: 0, laneOn: 0, laneOff: 0, ftLane0: 0, ftLaneN: 0, bucket: {} };
  window.__TICK__ = () => {
    const D = window.__D__; D.samples++;
    const seen = new Set();
    for (const sq of ai.squads ?? []) {
      for (const ft of sq.fireteams ?? []) {
        D.ftSize[ft.members.length] = (D.ftSize[ft.members.length] ?? 0) + 1;
        if (ft.lane === 0) D.ftLane0++; else D.ftLaneN++;
      }
    }
    const live = [[], []];
    for (const a of ai.agents) {
      if (!a.alive) continue;
      if (a._hasVia) D.laneOn++; else D.laneOff++;
      let inBase = false;
      for (const bp of bases) if (Math.hypot(bp.x - a.position.x, bp.z - a.position.z) < 30) { inBase = true; break; }
      if (!inBase) (live[a.team] ?? live[0]).push(a);
    }
    for (let t = 0; t < 2; t++) {
      const L = live[t];
      for (const c of L) {
        let n = 0;
        for (const o of L) { const dx = o.position.x - c.position.x, dz = o.position.z - c.position.z; if (dx * dx + dz * dz <= 64) n++; }
        if (n < 6) continue;
        D.packs++;
        const k = `${c.state}`;
        D.states[k] = (D.states[k] ?? 0) + 1;
        const mo = c.objective ? c.objective.mode : 'none';
        D.modes[mo] = (D.modes[mo] ?? 0) + 1;
        let best = 999;
        for (const z of zones) best = Math.min(best, Math.hypot(z.position.x - c.position.x, z.position.z - c.position.z));
        D.zoneDist.push(Math.round(best));
        const key = c.objective ? (c.objective.site ?? 'pos') : 'none';
        D.bucket[key] = (D.bucket[key] ?? 0) + 1;
      }
    }
  };
});
for (let i = 0; i < SAMPLES; i++) { await wait(12); await p.evaluate(() => window.__TICK__()); }
console.log(JSON.stringify(await p.evaluate(() => {
  const D = window.__D__;
  const z = D.zoneDist.sort((a, b) => a - b);
  const q = (f) => (z.length ? z[Math.floor(z.length * f)] : -1);
  return {
    samples: D.samples, packMen: D.packs,
    ftSize: D.ftSize, ftLane0: D.ftLane0, ftLaneN: D.ftLaneN,
    laneOn: D.laneOn, laneOff: D.laneOff,
    packState: D.states, packMode: D.modes, packSite: D.bucket,
    packZoneDist: { p10: q(0.1), median: q(0.5), p90: q(0.9), within12: z.filter((x) => x <= 12).length / (z.length || 1) },
  };
}), null, 1));
await b.close();
