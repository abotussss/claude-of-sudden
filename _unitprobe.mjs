import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 480 } });
await p.goto('http://127.0.0.1:4253/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 480000 });
console.log(JSON.stringify(await p.evaluate(()=>{
  const e=window.__ENGINE__, w=e.ctx.peek('world'), m=e.ctx.peek('match'), phys=e.ctx.peek('physics');
  const V3=e.camera.position.constructor;
  const c=w.cathedral;
  const iv=(w.interiorVolumes||[]).find(v=>v.building===c.id);
  const D=m.allZones.find(z=>z.id==='D');
  // walk +X in WORLD from the cathedral centre until the ray stops hitting the building
  const centre=w.levelToWorld(c.cx,0,c.cz,new V3());
  const hits=[];
  for(let d=0; d<=30; d+=1){
    const h=phys.raycast(centre.x+d, 40, centre.z, 0,-1,0, 90, phys.MASK.WORLD);
    hits.push(h.hit? +h.point.y.toFixed(1) : -1);
  }
  return {
    cathRecord:{cx:c.cx,cz:c.cz,hw:c.hw,hd:c.hd,floorY:c.floorY},
    centreWorld:[+centre.x.toFixed(1),+centre.z.toFixed(1)],
    Dworld:[+D.position.x.toFixed(1),+D.position.z.toFixed(1)],
    Dradius:D.radius,
    xformScale:+(w.A?.xform?.elements? Math.hypot(w.A.xform.elements[0],w.A.xform.elements[1],w.A.xform.elements[2]):-1).toFixed(3),
    interiorVol: iv? {hw:iv.hw, hd:iv.hd, cx:+iv.cx.toFixed(1), cz:+iv.cz.toFixed(1)}:null,
    surfaceYalongPlusX_every1m: hits,
  };
})));
await b.close();
