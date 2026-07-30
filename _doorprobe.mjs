import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 480 } });
await p.goto('http://127.0.0.1:4220/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log((await p.evaluate(() => {
  const c = window.__ENGINE__.ctx, w = c.peek('world'), phys = c.peek('physics');
  const V = c.camera.position.constructor;
  const S = w.buildings.find((i) => i.spec.id === 'S2').spec;
  const rows = [`S2 x=${S.x} z=${S.z} w=${S.w} d=${S.d}  (level, scaled)`];
  // sweep a line of downward + sideways rays across the band 1.1 m inside the -Z wall
  const z0 = S.z - S.d / 2;
  for (const dz of [0.3, 0.7, 1.1, 1.5, 2.0, 2.6]) {
    let line = `  z=${(z0 + dz).toFixed(2)} (${dz.toFixed(1)} m in): `;
    for (let lx = -2.0; lx <= 2.01; lx += 0.5) {
      const wp = w.levelToWorld(lx, 0, z0 + dz, new V());
      const d1 = phys.raycast(wp.x, 2.2, wp.z, 0, -1, 0, 5, phys.MASK.CHARACTER);
      const top = d1.hit ? d1.point.y : -9;
      const up = phys.raycast(wp.x, top + 0.05, wp.z, 0, 1, 0, 3, phys.MASK.CHARACTER);
      line += `[${lx.toFixed(1)}: floor ${top.toFixed(2)} ${d1.hit ? d1.surface : '-'}${up.hit ? ` CEIL@${(up.distance).toFixed(2)} ${up.surface}` : ''}] `;
    }
    rows.push(line);
  }
  // and what meshes are inside the footprint
  const names = new Set();
  w.root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.computeBoundingBox?.();
    names.add(o.name);
  });
  rows.push('mesh names: ' + [...names].slice(0, 40).join(' '));
  return rows.join('\n');
})));
await b.close();
