/** HOW MUCH OF THE FRAME IS EMP? Renders a pose with the fields on and off and
 *  reports the share of pixels the fields changed, and by how much. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
const args = Object.fromEntries(process.argv.slice(2).map((a)=>{const s=a.replace(/^--/,'');const i=s.indexOf('=');return i<0?[s,true]:[s.slice(0,i),s.slice(i+1)];}));
const OUT = args.out ?? 'shots/empframe';
mkdirSync(OUT, { recursive: true });
const POSES = [
  ['north-road', 0, -102, [0, 8, 18], 1.62],
  ['inside-r14', -8, -94, [40, 6, -94], 1.62],
  ['centre-open', 0, -8, [90, 8, -8], 1.62],
  ['outside-r10-4m', 46, 0, [32, 5, 0], 1.62],
  ['far-r10-100m', 132, 0, [32, 6, 0], 1.62],
];
const b = await chromium.launch({ headless:true, args:['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport:{width:1280,height:720} });
const errs=[]; p.on('pageerror', e=>errs.push(String(e.message)));
await p.goto('http://127.0.0.1:4636/?map=plains&capture=1', { waitUntil:'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match'); if (m) m.update = () => {};
  const ui = window.__ENGINE__.ctx.peek('ui'); ui?.banner?.hide?.(); if (ui?.root) ui.root.style.display='none';
});
const wait=(n)=>p.evaluate((n)=>new Promise(r=>{let i=0;const t=()=>(++i>=n?r():requestAnimationFrame(t));requestAnimationFrame(t);}),n);
const setVis=(on)=>p.evaluate((on)=>{ const g=window.__ENGINE__.scene.getObjectByName('match-emp'); if(g) g.visible=on; },on);
console.log('  pose              px changed   mean |d|   max |d|   green-dominant px');
for (const [name,x,z,at,eye] of POSES) {
  await p.evaluate(({x,z,at,eye})=>{
    const c=window.__ENGINE__.ctx, ph=c.peek('physics');
    let f=ph.groundHeight(x,z,60); if(!Number.isFinite(f)) f=c.peek('world').groundHeight(x,z);
    const ey=f+eye, dx=at[0]-x, dy=at[1]-ey, dz=at[2]-z;
    c.peek('player').teleport({x,y:ey,z},{x:Math.atan2(dy,Math.hypot(dx,dz)),y:Math.atan2(-dx,-dz)});
  },{x,z,at,eye});
  await setVis(true); await wait(70);
  const on = PNG.sync.read(await p.screenshot({ path: `${OUT}/${name}-on.png` }));
  await setVis(false); await wait(70);
  const off = PNG.sync.read(await p.screenshot({ path: `${OUT}/${name}-off.png` }));
  await setVis(true);
  let n=0,sum=0,max=0,dom=0;
  const N=on.width*on.height;
  for(let i=0;i<N;i++){
    const o=i*4;
    const d=Math.max(Math.abs(on.data[o]-off.data[o]),Math.abs(on.data[o+1]-off.data[o+1]),Math.abs(on.data[o+2]-off.data[o+2]));
    if(d>6){n++;sum+=d;if(d>max)max=d;}
    // a pixel the field OWNS: green clearly over red and blue in the ON frame
    if(on.data[o+1]>70 && on.data[o+1]-on.data[o]>28 && on.data[o+1]-on.data[o+2]>10 && d>18) dom++;
  }
  console.log(`  ${name.padEnd(16)} ${(n/N*100).toFixed(1).padStart(6)}%   ${(sum/Math.max(1,n)).toFixed(1).padStart(7)}   ${String(max).padStart(6)}   ${(dom/N*100).toFixed(1).padStart(6)}%`);
}
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
