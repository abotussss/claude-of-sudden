import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL=process.argv[2]; const OUT='shots/batt'; mkdirSync(OUT,{recursive:true});
const b=await chromium.launch({headless:true,args:['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio']});
const p=await b.newPage({viewport:{width:1280,height:720}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e.message)));
await p.goto(URL,{waitUntil:'domcontentloaded'});
await p.waitForFunction('window.__READY__===true',null,{timeout:300000});
await p.waitForFunction(()=>window.__ENGINE__.ctx.peek('match').phase==='live',null,{timeout:180000});
await p.evaluate(()=>{const m=window.__ENGINE__.ctx.peek('match');m.battery.arm(m.playerTeam,m._batteryPads());
  const e=window.__ENGINE__; e.input.frozen=true;e.input.enabled=false;e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.viewScene?.traverse?.(o=>{if(o.isMesh||o.isInstancedMesh||o.isSprite)o.visible=false;});});
await p.evaluate(()=>{window.__ENGINE__.ctx.time.scale=8;});
await p.waitForFunction(()=>window.__ENGINE__.ctx.peek('match').battery.vehicles[1].state==='station',null,{timeout:200000});
await p.evaluate(()=>{window.__ENGINE__.ctx.time.scale=0.02;});
const d=await p.evaluate(()=>{
  const THREE=window.__ENGINE__.THREE ?? null;
  const bt=window.__ENGINE__.ctx.peek('match').battery;
  const v=bt.vehicles[1];
  const hm=bt._hullMesh;
  const mtx=new (hm.matrixWorld.constructor)();
  hm.getMatrixAt(1,mtx);
  const cam=window.__ENGINE__.camera;
  return {v:{x:+v.x.toFixed(1),y:+v.y.toFixed(1),z:+v.z.toFixed(1)},
    count:hm.count, vis:hm.visible, gvis:bt.group.visible, parent:!!hm.parent,
    inst1:[...mtx.elements].slice(12,15).map(n=>+n.toFixed(1)),
    matType:hm.material.type, matColor:hm.material.color.getHexString(),
    hasMap:!!hm.material.map, geoTris:hm.geometry.index.count/3,
    layers:hm.layers.mask, camLayers:cam.layers.mask,
    bs: hm.geometry.boundingSphere ? +hm.geometry.boundingSphere.radius.toFixed(1) : null,
    frustum: hm.frustumCulled,
  };
});
console.log(JSON.stringify(d));
// bright unlit material test
await p.evaluate(()=>{
  const bt=window.__ENGINE__.ctx.peek('match').battery;
  const T=bt._hullMesh.material.constructor;
  void T;
  bt._hullMesh.material.emissive?.setHex?.(0xff00ff);
  bt._hullMesh.material.emissiveIntensity=4;
  bt._teamMesh.material.emissive?.setHex?.(0x00ff00);
  bt._teamMesh.material.emissiveIntensity=4;
  bt._hullMesh.material.needsUpdate=true; bt._teamMesh.material.needsUpdate=true;
});
await p.evaluate(async ([vx,vy,vz])=>{
  const c=window.__ENGINE__.camera;
  for(let i=0;i<40;i++){c.position.set(vx+22,vy+9,vz+22);c.lookAt(vx,vy+2,vz);c.updateMatrixWorld(true);
    await new Promise(r=>requestAnimationFrame(r));}
},[d.v.x,d.v.y,d.v.z]);
await p.screenshot({path:`${OUT}/dbg-emissive.png`});
console.log('[pageerror]',errs.length?errs[0]:'none');
await b.close();
