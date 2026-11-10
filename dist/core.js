// Shared, deterministic gameplay rules. Simulation runs at 120 Hz.
export const STEP = 1 / 120;
export const PRIMARY_COUNT=6, PISTOL=6, KNIFE=7;
export const WEAPONS = [
  {name:'RANGER',type:'ALL-ROUNDER',label:'ASSAULT RIFLE',mode:'auto',mag:30,damage:26,head:1.6,interval:.105,reload:1.45,hip:.014,ads:.0007,pellets:1,kick:.014,zoom:64,color:0xa8b8a0,mobility:1,fallStart:25,fallLength:130,minDamage:.75,description:'Balanced automatic fire. Reliable at any distance.'},
  {name:'LONGSHOT',type:'PRECISION',label:'SNIPER RIFLE',mode:'auto',mag:5,damage:95,head:1.6,interval:.94,reload:1.95,hip:.075,ads:0,pellets:1,kick:.043,zoom:32,color:0x869eaa,mobility:1,fallStart:25,fallLength:130,minDamage:.75,description:'Scoped precision. Land a headshot for a one-shot elimination.'},
  {name:'BREACHER',type:'CLOSE QUARTERS',label:'SHOTGUN',mode:'auto',mag:6,damage:19,head:1.2,interval:.72,reload:1.75,hip:.085,ads:.055,pellets:8,kick:.038,zoom:68,color:0xc4a57a,mobility:1,fallStart:5,fallLength:22,minDamage:.15,description:'Eight pellets per shot. Devastating up close.'},
  {name:'VIPER',type:'RUN & GUN',label:'SUBMACHINE GUN',mode:'auto',mag:32,damage:20,head:1.5,interval:.064,reload:1.25,hip:.022,ads:.002,pellets:1,kick:.009,zoom:70,color:0x899fbc,mobility:1.05,fallStart:10,fallLength:45,minDamage:.45,description:'Blistering fire rate, quick reload, and light handling. Best up close.'},
  {name:'RELAY',type:'CONTROLLED BURSTS',label:'BURST RIFLE',mode:'burst',burst:3,burstGap:.27,mag:24,damage:34,head:1.45,interval:.075,reload:1.65,hip:.014,ads:.0005,pellets:1,kick:.012,zoom:60,color:0x84b4b1,mobility:1,fallStart:32,fallLength:150,minDamage:.8,description:'Three rounds per click. A full close-range burst deals 102 damage.'},
  {name:'TITAN',type:'SUSTAINED FIRE',label:'MACHINE GUN',mode:'auto',mag:60,damage:24,head:1.5,interval:.115,reload:2.85,hip:.027,ads:.003,pellets:1,kick:.019,zoom:66,color:0x9c9a82,mobility:.9,fallStart:24,fallLength:100,minDamage:.65,description:'A 60-round magazine for long fights. Heavier handling and slower reload.'},
  {name:'SIDEKICK',type:'SECONDARY',label:'PISTOL',mode:'semi',mag:12,damage:30,head:1.6,interval:.19,reload:1.05,hip:.016,ads:.001,pellets:1,kick:.022,zoom:72,color:0xb2bcc0,mobility:1.04,fallStart:14,fallLength:70,minDamage:.55},
  {name:'EDGE',type:'MELEE',label:'KNIFE',mode:'melee',mag:null,damage:65,head:1,interval:.46,reload:0,hip:0,ads:0,pellets:0,kick:0,zoom:90,color:0xd8e3df,mobility:1.1,range:2.2}
];
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const damp=(a,b,rate,dt)=>b+(a-b)*Math.exp(-rate*dt);
export function createPlayer(x=0,z=0){return {x,z,feet:0,vx:0,vz:0,vy:0,yaw:0,pitch:0,grounded:true,crouch:0,slide:0,slideReady:true,landed:false,eye:1.56,hp:100,dead:0,shield:1.2,kills:0,deaths:0,score:0};}
export function overlap(x,z,s,r=.34){return Math.abs(x-s.x)<s.w+r&&Math.abs(z-s.z)<s.d+r;}
export function moveBody(p,dx,dz,solids){
 const parts=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dz))/.15));
 for(let n=0;n<parts;n++){
  const x=p.x+dx/parts;if(!solids.some(s=>s.h>p.feet+.12&&overlap(x,p.z,s))){p.x=x}else p.vx=0;
  const z=p.z+dz/parts;if(!solids.some(s=>s.h>p.feet+.12&&overlap(p.x,z,s))){p.z=z}else p.vz=0;
 }
}
export function stepMovement(p,input,solids,dt){
 p.landed=false;
 let f=input.forward||0,s=input.side||0;const len=Math.hypot(f,s);if(len>1){f/=len;s/=len;}
 const wx=-Math.sin(p.yaw)*f+Math.cos(p.yaw)*s,wz=-Math.cos(p.yaw)*f-Math.sin(p.yaw)*s;
 let speed=Math.hypot(p.vx,p.vz);
 if(!input.crouch)p.slideReady=true;
 if(input.crouch&&p.grounded&&speed>5.5&&p.slideReady){p.slide=.7;p.slideReady=false;const boost=Math.min(18,speed+2.1)/speed;p.vx*=boost;p.vz*=boost;}
 const sliding=p.slide>0&&input.crouch;
 p.crouch=damp(p.crouch,input.crouch?1:0,20,dt);p.eye=1.56-p.crouch*.62;
 // Jump before ground friction: a timely hop carries speed into the air.
 if(input.jump&&p.grounded){p.vy=8.5;p.grounded=false;}
 if(p.grounded&&!sliding){const friction=Math.exp(-11*dt);p.vx*=friction;p.vz*=friction;}
 if(sliding){p.slide=Math.max(0,p.slide-dt);if(p.grounded){p.vx*=Math.exp(-.65*dt);p.vz*=Math.exp(-.65*dt);}}
 else p.slide=0;
 if(len>0){
   const target=(p.grounded?(input.crouch?3.4:input.aim?6.8:9):9)*(input.mobility||1);
   const along=p.vx*wx+p.vz*wz;
   const accel=p.grounded?(sliding?14:105):22;
   const add=Math.max(0,Math.min(target-along,accel*dt));p.vx+=wx*add;p.vz+=wz*add;
   if(sliding){const v=Math.hypot(p.vx,p.vz);const turn=1-Math.exp(-5*dt);const nx=p.vx*(1-turn)+wx*v*turn,nz=p.vz*(1-turn)+wz*v*turn;const m=Math.hypot(nx,nz)||1;p.vx=nx/m*v;p.vz=nz/m*v;}
 }
 speed=Math.hypot(p.vx,p.vz);if(speed>18){p.vx*=18/speed;p.vz*=18/speed;}
 moveBody(p,p.vx*dt,p.vz*dt,solids);
 const before=p.feet;p.vy-=24*dt;p.feet+=p.vy*dt;let floor=0;
 for(const b of solids)if(overlap(p.x,p.z,b,.28)&&before>=b.h-.06)floor=Math.max(floor,b.h);
 if(p.feet<=floor&&p.vy<=0){p.landed=!p.grounded;p.feet=floor;p.vy=0;p.grounded=true;}else p.grounded=false;
 // A crouched landing primes a boost for the next step, including held-jump hops.
 if(p.landed&&input.crouch&&p.slideReady){const v=Math.hypot(p.vx,p.vz);if(v>5.5){const boost=Math.min(18,v+2.1)/v;p.vx*=boost;p.vz*=boost;p.slide=.7;p.slideReady=false;}}
}
export function createArsenal(primary=0){
 if(!Number.isInteger(primary)||primary<0||primary>=PRIMARY_COUNT)primary=0;
 return {primary,slots:[primary,PISTOL,KNIFE],index:primary,mags:WEAPONS.map(w=>w.mag),cooldowns:WEAPONS.map(()=>0),reloading:0,reloadIndex:-1,switching:0,burstRemaining:0,
 get cooldown(){return this.cooldowns[this.index]},set cooldown(value){this.cooldowns[this.index]=value}};
}
export function switchWeapon(a,index){if(index===a.index||!a.slots.includes(index))return false;a.index=index;a.reloading=0;a.reloadIndex=-1;a.burstRemaining=0;a.switching=index===PISTOL?.16:index===KNIFE?.13:.22;return true;}
export function startReload(a){const w=WEAPONS[a.index];if(w.mode==='melee'||a.reloading||a.switching||a.mags[a.index]===w.mag)return false;a.burstRemaining=0;a.reloading=w.reload;a.reloadIndex=a.index;return true;}
export function tickArsenal(a,dt){for(let i=0;i<a.cooldowns.length;i++)a.cooldowns[i]=Math.max(0,a.cooldowns[i]-dt);a.switching=Math.max(0,a.switching-dt);if(a.reloading>0){a.reloading=Math.max(0,a.reloading-dt);if(a.reloading===0){a.mags[a.reloadIndex]=WEAPONS[a.reloadIndex].mag;a.reloadIndex=-1;}}}
// A fresh trigger starts semi-auto shots and bursts. A started burst completes after release.
export function fireRound(a,freshTrigger=true){
 const w=WEAPONS[a.index];if(a.cooldown>0||a.reloading||a.switching||a.mags[a.index]===0)return false;
 if(w.mode==='semi'&&!freshTrigger)return false;
 if(w.mode==='burst'){
   if(a.burstRemaining===0){if(!freshTrigger)return false;a.burstRemaining=w.burst;}
   a.burstRemaining--;
 }
 if(w.mode!=='melee')a.mags[a.index]--;
 if(a.mags[a.index]===0)a.burstRemaining=0;
 a.cooldown=w.mode==='burst'&&a.burstRemaining===0?w.burstGap:w.interval;return true;
}
export function rayBox(o,d,b,max=100){let lo=0,hi=max;for(const key of ['x','y','z']){const min=b.min[key],max=b.max[key];if(Math.abs(d[key])<1e-9){if(o[key]<min||o[key]>max)return null;continue;}let a=(min-o[key])/d[key],c=(max-o[key])/d[key];if(a>c)[a,c]=[c,a];lo=Math.max(lo,a);hi=Math.min(hi,c);if(hi<lo)return null;}return lo;}
export function solidBox(s){return {min:{x:s.x-s.w,y:0,z:s.z-s.d},max:{x:s.x+s.w,y:s.h,z:s.z+s.d}};}
export function trace(o,d,solids,actors,ignore=null,max=90){let nearest=max,result=null;for(const s of solids){const t=rayBox(o,d,solidBox(s),nearest);if(t!==null&&t<nearest){nearest=t;result={distance:t,actor:null,head:false};}}
 for(const a of actors){if(a===ignore||a.dead>0)continue;const feet=a.feet||0,duck=a.crouch||0,headY=feet+1.5-duck*.62;
 const volumes=[{head:true,min:{x:a.x-.24,y:headY-.24,z:a.z-.24},max:{x:a.x+.24,y:headY+.24,z:a.z+.24}},{head:false,min:{x:a.x-.36,y:feet+.05,z:a.z-.3},max:{x:a.x+.36,y:headY-.22,z:a.z+.3}}];
 for(const b of volumes){const t=rayBox(o,d,b,nearest);if(t!==null&&t<nearest){nearest=t;result={distance:t,actor:a,head:b.head};}}
 }return result||{distance:max,actor:null,head:false};}
export function meleeTrace(origin,forward,solids,actors,ignore,range=WEAPONS[KNIFE].range){
 let best=null;const yaw=Math.atan2(-forward.x,-forward.z),pitch=Math.asin(clamp(forward.y,-1,1));
 for(const offset of [0,-.10,.10,-.20,.20])for(const vertical of [0,-.10,.10]){
  const y=yaw+offset,p=pitch+vertical,d={x:-Math.sin(y)*Math.cos(p),y:Math.sin(p),z:-Math.cos(y)*Math.cos(p)};
  const hit=trace(origin,d,solids,actors,ignore,range);if(hit.actor&&(!best||hit.distance<best.distance))best={...hit,head:false};
 }return best;
}
export function createNav(solids,bounds={minX:-27,maxX:27,minZ:-27,maxZ:27,cell:1.5}){
 const {minX,maxX,minZ,maxZ,cell=1.5}=bounds,cols=Math.floor((maxX-minX)/cell)+1,rows=Math.floor((maxZ-minZ)/cell)+1,free=new Uint8Array(cols*rows);
 const point=i=>({x:minX+(i%cols)*cell,z:minZ+Math.floor(i/cols)*cell});
 for(let i=0;i<free.length;i++){const p=point(i);free[i]=!solids.some(s=>overlap(p.x,p.z,s,.5));}
 function index(x,z){let at=clamp(Math.round((z-minZ)/cell),0,rows-1)*cols+clamp(Math.round((x-minX)/cell),0,cols-1);if(free[at])return at;let best=-1,distance=Infinity;for(let i=0;i<free.length;i++)if(free[i]){const p=point(i),d=(p.x-x)**2+(p.z-z)**2;if(d<distance){distance=d;best=i;}}return best;}
 return {path(from,to){const start=index(from.x,from.z),end=index(to.x,to.z);if(start<0||end<0||start===end)return [];
 const prev=new Int32Array(free.length).fill(-1),queue=[start];prev[start]=start;
 for(let q=0;q<queue.length;q++){const at=queue[q];if(at===end)break;for(const next of [at-1,at+1,at-cols,at+cols]){if(next<0||next>=free.length||Math.abs(next%cols-at%cols)>1||!free[next]||prev[next]!==-1)continue;prev[next]=at;queue.push(next);}}
 if(prev[end]===-1)return [];let at=end,route=[];while(at!==start){route.push(point(at));at=prev[at];}return route.reverse();}};
}
