import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const arg=(k,d)=>{const a=process.argv.find(s=>s.startsWith(`--${k}=`));return a?a.slice(a.indexOf('=')+1):d;};
const URL=arg('url','http://127.0.0.1:4634/?map=plains');
const OUT=arg('out','shots/batt'); mkdirSync(OUT,{recursive:true});
const b=await chromium.launch({headless:true,args:['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio']});
const p=await b.newPage({viewport:{width:1280,height:720}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e.message)));
await p.goto(URL+'&seed=11',{waitUntil:'domcontentloaded'});
await p.waitForFunction('window.__READY__===true',null,{timeout:300000});
await p.waitForFunction(()=>window.__ENGINE__.ctx.peek('match').phase==='live',null,{timeout:180000});
await p.evaluate(()=>{const m=window.__ENGINE__.ctx.peek('match');m.battery.arm(m.playerTeam,m._batteryPads());});
await p.evaluate(()=>{window.__ENGINE__.ctx.time.scale=6;});
await p.waitForFunction(()=>window.__ENGINE__.ctx.peek('match').battery.vehicles[1].state==='station',null,{timeout:200000});
await p.evaluate(()=>{window.__ENGINE__.ctx.time.scale=1;});
const info=await p.evaluate(()=>{
  const bt=window.__ENGINE__.ctx.peek('match').battery;
  const v=bt.vehicles[1];
  const e=window.__ENGINE__;
  const pl=e.ctx.peek('player');
  const ex=v.x*0.88, ez=v.z*0.88, ey=v.y+6;
  const dx=v.x-ex, dz=v.z-ez, dy=(v.y+2)-ey, flat=Math.hypot(dx,dz);
  pl.teleport({x:ex,y:ey,z:ez},{x:Math.atan2(dy,flat),y:Math.atan2(-dx,-dz)});
  e.input.frozen=true;e.input.enabled=false;pl.setControlEnabled?.(false);
  return {v:{x:+v.x.toFixed(1),y:+v.y.toFixed(1),z:+v.z.toFixed(1),state:v.state,vis:v.visible},
    eye:[+ex.toFixed(1),+ey.toFixed(1),+ez.toFixed(1)], dist:+Math.hypot(dx,dz,dy).toFixed(1),
    groupVis:bt.group.visible, hullCount:bt._hullMesh.count, teamCount:bt._teamMesh.count,
    inScene: !!bt.group.parent};
});
console.log(JSON.stringify(info));
await p.waitForTimeout(1500);
await p.screenshot({path:`${OUT}/dbg-closeup.png`});
console.log('[pageerror]',errs.length?errs[0]:'none');
await b.close();
