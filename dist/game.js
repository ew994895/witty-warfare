import * as THREE from './vendor/three.module.js';
import {RoomConnection,onlineOrigin} from './network.js?v=12';
import {MAPS,getMap,createMap} from './maps.js';
import {VOTE_SECONDS,nextArena} from './rounds.js';
import {GAME_RULES,GUN_ORDER,OBJECTIVE_RULES,TEAMS,TEAM_NAMES,TEAM_COLORS,isObjective,isTeamGame,opponents,roomSettings,spawnTeamBias,teamWinner} from './rules.js?v=12';
import {createPlayerHub} from './player-hub.js?v=12';
import {createObjectiveDisplay} from './objectives-ui.js?v=12';
import {createGamepadInput} from './gamepad.js?v=16';
import {createLobbyAudio} from './lobby-audio.js?v=15';
import {createRoomControls} from './room-controls.js?v=12';
import {STEP,WEAPONS,PRIMARY_COUNT,PISTOL,KNIFE,meleeTrace,clamp,damp,createPlayer,stepMovement,moveBody,overlap,createArsenal,switchWeapon,startReload,tickArsenal,fireRound,trace,createNav} from './core.js';
const $=id=>document.getElementById(id), canvas=$('game');
let renderer;
try {renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});}catch(e){$('error').hidden=false;$('error').textContent='This game needs WebGL. Please open it in a browser with WebGL enabled.';throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.autoClear=false;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.setSize(innerWidth,innerHeight);renderer.setClearColor(0x8faeb3);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
const scene=new THREE.Scene();scene.fog=new THREE.Fog(0xa6bbba,32,90);const camera=new THREE.PerspectiveCamera(90,innerWidth/innerHeight,.06,120);camera.rotation.order='YXZ';scene.add(camera);
scene.add(new THREE.HemisphereLight(0xe5f5f7,0x526856,2.6));const sun=new THREE.DirectionalLight(0xffe1b5,3.5);sun.position.set(-20,35,15);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-38,right:38,top:38,bottom:-38,near:1,far:90});sun.shadow.bias=-.0007;scene.add(sun);
let activeMap=createMap('dust-court'),solids=activeMap.solids,spawns=activeMap.spawns,nav=createNav(solids,activeMap.navBounds);
const world=new THREE.Group();scene.add(world);const materials=new Map();
function mat(c){if(!materials.has(c))materials.set(c,new THREE.MeshStandardMaterial({color:c,roughness:1}));return materials.get(c)}
function textTexture(text){const c=document.createElement('canvas');c.width=512;c.height=128;const g=c.getContext('2d');g.fillStyle='#314e48';g.fillRect(0,0,512,128);g.fillStyle='#e3e6ba';g.font='bold 60px monospace';g.textAlign='center';g.fillText(text,256,86);return new THREE.CanvasTexture(c)}
function buildWorld(map){
 for(const mesh of [...world.children]){world.remove(mesh);mesh.geometry.dispose();if(mesh.userData.ownsMaterial){mesh.material.map?.dispose();mesh.material.dispose();}}
 for(const b of map.boxes){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...b.size),b.label?new THREE.MeshBasicMaterial({map:textTexture(b.label)}):mat(b.color));mesh.position.set(b.position.x,b.position.y,b.position.z);mesh.rotation.set(b.rotation.x,b.rotation.y,b.rotation.z);mesh.castShadow=b.position.y>0;mesh.receiveShadow=true;mesh.userData.ownsMaterial=!!b.label;world.add(mesh);}
 renderer.setClearColor(map.sky);scene.fog.color.setHex(map.fog);scene.fog.near=map.half*1.5;scene.fog.far=map.half*3.4;
 camera.far=Math.max(120,map.half*5);camera.updateProjectionMatrix();sun.color.setHex(map.sun);sun.intensity=map.light;sun.position.set(-map.half*.7,map.half*1.45,map.half*.65);
 Object.assign(sun.shadow.camera,{left:-map.half-4,right:map.half+4,top:map.half+4,bottom:-map.half-4,near:1,far:map.half*4});sun.shadow.camera.updateProjectionMatrix();world.updateMatrixWorld(true);
}
// Viewmodel has its own camera: it never clips into cover or grows when zooming.
const viewScene=new THREE.Scene(),viewCamera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.01,10);
viewScene.add(new THREE.HemisphereLight(0xf3f6e8,0x68756d,3));const gunLight=new THREE.DirectionalLight(0xffdfab,2.8);gunLight.position.set(-2,4,3);viewScene.add(gunLight);
const gun=new THREE.Group();viewScene.add(gun);
let muzzle;
function gunBox(x,y,z,w,h,d,c){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(c));m.position.set(x,y,z);gun.add(m);return m;}
function buildGun(){
 for(const m of [...gun.children]){gun.remove(m);m.geometry?.dispose();if(m===muzzle)m.material.dispose();}
 muzzle=null;const id=arsenal.index,w=WEAPONS[id],sniper=id===1,shotgun=id===2;
 if(id===KNIFE){
  gunBox(0,-.22,-.5,.105,.15,.13,0x8b9f83);gunBox(0,-.12,-.52,.045,.20,.045,0x293f35);gunBox(0,-.025,-.52,.115,.018,.055,0x788b7e);
  const blade=new THREE.Shape();blade.moveTo(-.031,-.015);blade.lineTo(-.031,.19);blade.lineTo(.008,.29);blade.lineTo(.036,.17);blade.lineTo(.031,-.015);blade.closePath();
  const metal=new THREE.Mesh(new THREE.ExtrudeGeometry(blade,{depth:.014,bevelEnabled:false}),mat(w.color));metal.position.set(0,0,-.53);gun.add(metal);gunBox(-.015,.075,-.51,.009,.15,.004,0x8caaa8);return;
 }
 if(id===PISTOL){
  gunBox(0,-.065,-.55,.067,.075,.25,w.color);gunBox(0,-.11,-.48,.065,.04,.18,0x263d36);gunBox(0,-.17,-.42,.055,.14,.08,0x314a3f);gunBox(.01,-.235,-.4,.1,.14,.14,0x8b9f83);
  gunBox(0,-.033,-.665,.008,.05,.015,0x20382d);gunBox(0,0,-.665,.009,.009,.008,0xdfff71);gunBox(-.022,-.01,-.445,.012,.025,.02,0x20382d);gunBox(.022,-.01,-.445,.012,.025,.02,0x20382d);
 }else{
  const compact=id===3;gunBox(0,-.115,-.55,id===5?.13:.10,.13,compact?.27:.38,w.color);gunBox(0,-.08,-.85,shotgun?.073:id===5?.055:.035,.035,sniper?.57:compact?.16:.3,0x293b37);
  gunBox(0,-.14,-.3,.085,.11,compact?.12:.22,0x3b4f47);gunBox(0,-.235,-.5,id===5?.17:.06,id===5?.17:.16,id===5?.18:.09,0x30453e);gunBox(0,-.21,-.36,.06,.13,.07,0x263a33);
  gunBox(.013,-.28,-.31,.105,.16,.13,0x8b9f83);gunBox(-.07,-.205,-.68,.1,.11,.16,0x8b9f83);gunBox(0,-.057,-.61,.065,.018,.28,0x22362f);
  gunBox(0,-.035,-.76,.018,.06,.018,0x20382d);gunBox(0,0,-.76,.009,.009,.009,0xdfff71);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.021,.027,24),mat(0x172c26));ring.position.set(0,0,-.46);gun.add(ring);
  if(sniper)gunBox(0,-.01,-.61,.07,.07,.23,0x344945);if(shotgun)gunBox(0,-.17,-.77,.09,.055,.2,0x665334);
  if(id===3){gunBox(0,-.27,-.56,.045,.19,.07,0x2d4541);gunBox(.06,-.08,-.58,.015,.025,.18,0x7e91bd);}
  if(id===4){gunBox(0,-.13,-.75,.085,.085,.24,0x3c6d68);for(let i=0;i<4;i++)gunBox(.045,-.10,-.68-i*.045,.012,.018,.018,0x152f2b);}
  if(id===5){gunBox(0,-.02,-.62,.11,.025,.14,0x3f5044);gunBox(0,-.09,-.97,.07,.07,.10,0x324237);}
 }
 muzzle=new THREE.Mesh(new THREE.ConeGeometry(id===PISTOL?.035:.055,.18,5),new THREE.MeshBasicMaterial({color:0xffe9a7,transparent:true,opacity:.9}));muzzle.rotation.x=-Math.PI/2;muzzle.position.set(0,-.065,id===PISTOL?-.73:sniper?-1.17:-1.04);gun.add(muzzle);muzzle.visible=false;
}
const player=createPlayer(1,14);player.name='YOU';player.id=-1;
let arsenal=createArsenal(),state='lobby',remaining=180,simTime=0,selected=0,difficulty='normal',ads=0,kick=0,gunKick=0,bloom=0,flashTime=0,hitTime=0,damageTime=0,messageTime=0,damageAngle=0,streak=0,bestStreak=0,shots=0,hits=0,headshots=0,lastKill=-20,lastHurt=-20;
let pendingShot=false;
let mouseDown=false,rightDown=false,toggleAim=false,aiming=false,lookMode='locked',hadLock=false,lockPending=false,edgeX=0,mouseInside=false,jumpBuffer=0,sound=true,audioContext,noiseBuffer;
const keys=new Set(),effects=[],numbers=[],feeds=[];
let prefs={sensitivity:1,adsSensitivity:.85,controllerSensitivity:1,fov:90,volume:.55,name:'Rookie',best:0};try{prefs={...prefs,...JSON.parse(localStorage.getItem('voxel-strike-v2')||'{}')}}catch{}
if(Number.isInteger(prefs.primary)&&prefs.primary>=0&&prefs.primary<PRIMARY_COUNT)selected=prefs.primary;
function savePrefs(){try{localStorage.setItem('voxel-strike-v2',JSON.stringify(prefs))}catch{}}

const sampleGamepad=createGamepadInput();
let controller=null,controllerActive=false;
let soloVote=null,soloVoteEnds=0,captureOnClick=false;
let rules='ffa',scoreLimit=0,teamScores={blue:0,red:0},modeWinner=null,zoneRadius=0;
const stormRing=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({length:128},(_,i)=>{
 const angle=i*Math.PI*2/128;
 return new THREE.Vector3(Math.cos(angle),.08,Math.sin(angle));
})),new THREE.LineBasicMaterial({color:0xff68bd}));
stormRing.visible=false;
scene.add(stormRing);
const objectiveDisplay=createObjectiveDisplay(scene,$('objectiveMarkers'),$('objectiveHud'));
let online=null,netSequence=0,netPending=[],netRound=0,netReload=false;const remoteActors=new Map();
const botNames=['MOSS','BRICK','GLITCH','DUNE','ECHO'],bots=[];
function part(g,x,y,z,w,h,d,c){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(c));m.position.set(x,y,z);m.castShadow=true;g.add(m);return m;}
function makeAvatar(b,i){
 const g=new THREE.Group();b.group=g;const c=[0xde6c52,0xc8647c,0xd89451,0xd4ac54,0xb56d99][i%5];
 b.baseColor=c;
 b.uniform=[part(g,0,1.02,0,.62,.64,.38,c),part(g,0,1.77,0,.49,.09,.49,c),
   part(g,-.4,1.03,.05,.18,.55,.23,c),part(g,.4,1.03,.05,.18,.55,.23,c)];
 part(g,0,1.5,0,.44,.46,.44,0xd7b89c);
 part(g,0,1.55,.225,.37,.13,.04,0x20383a);
 b.legs=[part(g,-.18,.37,0,.23,.7,.28,0x364e4d),part(g,.18,.37,0,.23,.7,.28,0x364e4d)];
 part(g,.24,1.13,.42,.14,.13,.55,0x203933);
 b.marker=new THREE.Mesh(new THREE.OctahedronGeometry(.10),new THREE.MeshBasicMaterial({color:0xff715e}));
 b.marker.position.y=2.1;
 g.add(b.marker);
 scene.add(g);
 b.label=document.createElement('span');
 b.label.className='player-label';
 $('playerLabels').append(b.label);
 return b;
}
function colorAvatar(actor){
 const team=actor.team||'';
 if(actor.label.dataset.team===team)return;
 actor.label.dataset.team=team;
 const color=TEAM_COLORS[team];
 for(const part of actor.uniform)part.material=mat(color??actor.baseColor);
 actor.marker.material.color.setHex(color??0xff715e);
}
function makeBot(i){
 return makeAvatar({...createPlayer(),id:i,name:botNames[i]||'FLINT',bot:true,cool:1,path:[],pathClock:0,
   target:null,react:0,aim:new THREE.Vector3(0,0,1),phase:i,think:0,visibleTarget:false},i);
}
for(let i=0;i<botNames.length;i++)bots.push(makeBot(i));
const lobbyBots=Array.from({length:6},(_,i)=>{
 const bot=makeBot(i);
 bot.team=TEAMS[i%2];
 colorAvatar(bot);
 bot.marker.material.color.setHex(0xffe8a1);
 bot.marker.scale.setScalar(1.7);
 bot.marker.position.set(.24,1.13,.61);
 bot.marker.visible=false;
 bot.label.hidden=true;
 return bot;
});
const lobbyAudio=createLobbyAudio();
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const LOBBY_STEP=1/30;
let lobbyTime=0,lobbyAccumulator=0;
const actors=[player,...bots];scene.updateMatrixWorld(true);
function direction(yaw,pitch){return new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch))}
function eye(a){return new THREE.Vector3(a.x,a.feet+(a===player?a.eye:1.5),a.z)}
function visible(a,b){const o=eye(a),target=eye(b),d=target.clone().sub(o),distance=d.length();return trace(o,d.normalize(),solids,[],null,distance).distance>=distance-.01;}
function tone(freq,duration=.08,volume=.06,type='sine',output=audioContext?.destination){if(!sound||audioContext?.state!=='running'||prefs.volume<=0)return;const t=audioContext.currentTime,o=audioContext.createOscillator(),g=audioContext.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);o.frequency.exponentialRampToValueAtTime(Math.max(30,freq*.7),t+duration);g.gain.setValueAtTime(volume*prefs.volume,t);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.connect(g).connect(output);o.start(t);o.stop(t+duration);}
function initAudio(){try{audioContext??=new (window.AudioContext||window.webkitAudioContext)();if(audioContext.state!=='running')audioContext.resume().catch(()=>{});if(!noiseBuffer){noiseBuffer=audioContext.createBuffer(1,audioContext.sampleRate*.25,audioContext.sampleRate);const d=noiseBuffer.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;}}catch{}}
function shotAudio(index=0,volume=1,output=audioContext?.destination){if(!sound||audioContext?.state!=='running'||prefs.volume<=0)return;const profiles=[[2800,.11,130],[1800,.2,75],[1400,.17,90],[3600,.07,180],[2600,.09,145],[1500,.17,90],[3200,.085,210]],profile=profiles[index]||profiles[0];const t=audioContext.currentTime,n=audioContext.createBufferSource(),filter=audioContext.createBiquadFilter(),g=audioContext.createGain();n.buffer=noiseBuffer;filter.type='lowpass';filter.frequency.value=profile[0];g.gain.setValueAtTime(.3*volume*prefs.volume,t);g.gain.exponentialRampToValueAtTime(.001,t+profile[1]);n.connect(filter).connect(g).connect(output);n.start(t);n.stop(t+.23);tone(profile[2],.09,.13*volume,'triangle',output);return n;}
function feed(text){feeds.unshift({text,time:4.5});feeds.splice(4);renderFeed()}
function renderFeed(){$('feed').replaceChildren(...feeds.map(f=>{const e=document.createElement('div');e.textContent=f.text;return e;}))}
function message(text,sub='',time=1.7){$('message').textContent=text;$('messageSub').textContent=sub;messageTime=time;}
function tracer(from,to,color=0xffe6a5){const geo=new THREE.BufferGeometry().setFromPoints([from,to]),m=new THREE.LineBasicMaterial({color,transparent:true,opacity:.65}),line=new THREE.Line(geo,m);scene.add(line);effects.push({mesh:line,time:.065,max:.065});}
function impact(pos,color=0xd1c5a2){const m=new THREE.Mesh(new THREE.BoxGeometry(.055,.055,.055),new THREE.MeshBasicMaterial({color,transparent:true}));m.position.copy(pos);scene.add(m);effects.push({mesh:m,time:.22,max:.22});}
function damageNumber(amount,target,head){const el=document.createElement('span');el.className='damage-number'+(head?' head':'');el.textContent=Math.round(amount);$('numbers').append(el);numbers.push({el,pos:new THREE.Vector3(target.x,target.feet+1.9,target.z),time:.65});}
function resetTransient(){arsenal.burstRemaining=0;pendingShot=false;mouseDown=rightDown=toggleAim=aiming=false;keys.clear();edgeX=0;jumpBuffer=0;}
function chooseSpawn(a,roster){return [...spawns].sort((p,q)=>spawnRating(q,a,roster)-spawnRating(p,a,roster))[0];}
function spawnRating(p,a,roster){let rating=99;const temp={...a,x:p[0],z:p[1],feet:0};for(const other of roster){if(other===a||other.dead>0)continue;const dist=Math.hypot(other.x-p[0],other.z-p[1]);rating=Math.min(rating,dist+(opponents(a,other)?(visible(temp,other)?-9:0):10));}return rating+spawnTeamBias(p,a.team);}
function respawnActor(a,roster=actors){const p=chooseSpawn(a,roster);Object.assign(a,{x:p[0],z:p[1],feet:0,vx:0,vz:0,vy:0,hp:100,dead:0,shield:1.3,grounded:true,crouch:0,slide:0,slideReady:true,eye:1.56});
 if(a===player){player.yaw=Math.atan2(player.x,player.z);player.pitch=0;arsenal=createArsenal(selected);kick=gunKick=ads=0;pendingShot=rightDown=toggleAim=mouseDown=false;lastHurt=simTime;buildGun();message('BACK IN','Spawn protection · ends when you fire',1.2)}else{a.path=[];a.target=null;a.cool=1;a.think=0;a.group.visible=true;}}
function applyDamage(target,amount,attacker,head=false){if(!opponents(attacker,target)||target.dead>0||target.shield>0)return false;target.hp=Math.max(0,target.hp-amount);
 if(target===player){lastHurt=simTime;damageTime=.34;damageAngle=Math.atan2(attacker.x-player.x,attacker.z-player.z)+player.yaw+Math.PI;tone(70,.11,.07,'triangle');}
 if(target.hp===0){target.deaths++;target.dead=1.25;target.vx=target.vz=0;attacker.kills++;const bonus=attacker===player?(head?50:0)+(player.slide>0?25:0)+(!player.grounded?25:0):0;attacker.score+=100+bonus;
 if(attacker.team)teamScores[attacker.team]++;
 feed(`${attacker.name}  ${head?'◆':'▸'}  ${target.name}`);
 if(target===player){streak=0;mouseDown=rightDown=toggleAim=false;message(`${attacker.name} GOT YOU`,'Back in the arena in 1.2s',1.25)}else target.group.visible=false;
 if(attacker===player){streak++;bestStreak=Math.max(streak,bestStreak);if(head)headshots++;const multi=simTime-lastKill<3.2;lastKill=simTime;message(`${arsenal.index===KNIFE?'KNIFE ELIMINATION':head?'HEADSHOT':multi?'DOUBLE ELIMINATION':'ELIMINATION'}  +${100+bonus}`,`${streak} STREAK${!player.grounded?' · AIRBORNE':''}${player.slide>0?' · SLIDE':''}`);tone(head?1050:760,.15,.13);hitTime=.22;$('hitmarker').classList.add('kill');}
 }return true;}
function shoot(freshTrigger){if(player.dead>0||!fireRound(arsenal,freshTrigger))return;if(online){onlineShot();return;}const w=WEAPONS[arsenal.index],targets=actors.filter(a=>opponents(player,a));player.shield=0;
 if(w.mode==='melee'){
  gunKick=1;tone(280,.15,.10,'triangle');const hit=meleeTrace(eye(player),direction(player.yaw,player.pitch),solids,targets,player,w.range);
  if(hit&&applyDamage(hit.actor,w.damage,player,false)){hitTime=.17;$('hitmarker').style.color='#eaffcf';damageNumber(w.damage,hit.actor,false);tone(130,.1,.15,'triangle');}return;
 }
 shots++;let connected=false,damageSum=0,lastTarget=null,lastHead=false;
 // This uses current input pose, not the previous render's camera matrix.
 const origin=eye(player),forward=direction(player.yaw,player.pitch+kick),right=new THREE.Vector3(Math.cos(player.yaw),0,-Math.sin(player.yaw)),up=right.clone().cross(forward).normalize();
 const spread=w.hip*(1-ads)+w.ads*ads+(w.mode==='auto'&&arsenal.index!==1&&arsenal.index!==2?bloom*(arsenal.index===5?.013:.007)*(1-ads*.9):0);
 for(let i=0;i<w.pellets;i++){const angle=w.pellets>1?i*2.399963:Math.random()*Math.PI*2;const radius=w.pellets>1?Math.sqrt((i+.5)/w.pellets):Math.sqrt(Math.random());const dir=forward.clone().addScaledVector(right,Math.cos(angle)*spread*radius).addScaledVector(up,Math.sin(angle)*spread*radius).normalize();const hit=trace(origin,dir,solids,targets,player);const pos=origin.clone().addScaledVector(dir,hit.distance);
 if(i===0||w.pellets>1&&i%3===0){const muzzlePos=origin.clone().addScaledVector(forward,.65).addScaledVector(right,.15*(1-ads));muzzlePos.y-=.12;tracer(muzzlePos,pos)}
 if(hit.actor){const falloff=clamp(1-(hit.distance-w.fallStart)/w.fallLength,w.minDamage,1);const amount=w.damage*(hit.head?w.head:1)*falloff;
 if(applyDamage(hit.actor,amount,player,hit.head)){connected=true;damageSum+=amount;lastTarget=hit.actor;lastHead||=hit.head;impact(pos,0xe5ff81);}}
 else if(hit.distance<90)impact(pos);
 }
 if(connected){hits++;hitTime=.15;$('hitmarker').style.color=lastHead?'#ffe18a':'#eaffcf';damageNumber(damageSum,lastTarget,lastHead);tone(lastHead?1150:850,.045,.09);}
 shotAudio(arsenal.index);kick=Math.min(.10,kick+w.kick*(ads>.5?.65:1));gunKick=1;flashTime=.04;bloom=Math.min(1,bloom+.2);
}
function reload(){if(online)netReload=true;if(player.dead===0&&startReload(arsenal)){rightDown=toggleAim=false;tone(240,.08,.06,'triangle');}}
function changeWeapon(i){if(rules==='gun')return;if(state==='playing'&&player.dead===0&&switchWeapon(arsenal,i)){pendingShot=mouseDown=rightDown=toggleAim=false;keys.delete('KeyF');ads=kick=gunKick=flashTime=0;buildGun();tone(310,.05,.04,'triangle');syncLoadout();}}
function syncLoadout(){document.querySelectorAll('[data-weapon]').forEach(b=>b.classList.toggle('selected',+b.dataset.weapon===selected));$('weaponType').textContent=WEAPONS[selected].type;$('weaponDescription').textContent=WEAPONS[selected].description;}
function acquire(b,roster,skill){
 const available=roster.filter(a=>opponents(b,a)&&a.dead===0&&a.shield===0);
 available.sort((a,c)=>Math.hypot(a.x-b.x,a.z-b.z)-Math.hypot(c.x-b.x,c.z-b.z));
 b.target=available.find(a=>visible(b,a))||available[0]||null;
 b.react=skill==='easy'?.65:skill==='hard'?.22:.4;
}
function updateBot(b,dt,preview=false){
 const squad=preview?lobbyBots:bots;
 const roster=preview?squad:actors;
 const skill=preview?'normal':difficulty;
 const time=preview?lobbyTime:simTime;
 if(b.dead>0){
   b.dead-=dt;
   if(b.dead<=0)respawnActor(b,roster);
   return;
 }
 b.shield=Math.max(0,b.shield-dt);
 if(skill==='practice')return;
 b.think-=dt;b.pathClock-=dt;b.cool-=dt;
 if(!b.target||b.target.dead>0||b.think<=0){acquire(b,roster,skill);b.think=1.6+Math.random()*.6;}
 const target=b.target;
 if(!target)return;
 const dx=target.x-b.x,dz=target.z-b.z,dist=Math.hypot(dx,dz)||1;
 // Visibility is shared for aiming and path choice.
 const sees=dist<activeMap.sight&&visible(b,target);
 if(!sees)b.react=skill==='hard'?.2:.45;
 else b.react-=dt;
 let mx=0,mz=0;
 if(sees){
   const strafe=Math.sin(time*.9+b.phase*3)>0?1:-1;
   const approach=dist>12?1:dist<5?-.7:0;
   mx=dx/dist*approach+dz/dist*.5*strafe;
   mz=dz/dist*approach-dx/dist*.5*strafe;
 }else{
   if(b.pathClock<=0){b.path=nav.path(b,target);b.pathClock=.6;}
   while(b.path.length&&Math.hypot(b.path[0].x-b.x,b.path[0].z-b.z)<.5)b.path.shift();
   if(b.path.length){mx=b.path[0].x-b.x;mz=b.path[0].z-b.z;}
 }
 const len=Math.hypot(mx,mz)||1,speed=activeMap.botSpeed*(skill==='hard'?1.4:1);
 moveBody(b,mx/len*speed*dt,mz/len*speed*dt,solids);
 for(const other of squad){
   if(other===b||other.dead>0)continue;
   const x=b.x-other.x,z=b.z-other.z,d=Math.hypot(x,z);
   if(d>0&&d<.75)moveBody(b,x/d*dt,z/d*dt,solids);
 }
 const origin=eye(b),targetPos=eye(target);
 targetPos.y-=.25;
 const desired=targetPos.sub(origin).normalize();
 b.aim.lerp(desired,1-Math.exp(-(skill==='hard'?10:5)*dt)).normalize();
 b.group.rotation.y=Math.atan2(b.aim.x,b.aim.z);
 if(!sees||b.react>0||b.cool>0||target.shield>0)return;
 b.cool=skill==='hard'?.2:skill==='easy'?.5:.31;
 const err=skill==='hard'?.022:skill==='easy'?.11:.055;
 const dir=b.aim.clone().add(new THREE.Vector3((Math.random()-.5)*err,(Math.random()-.5)*err,(Math.random()-.5)*err)).normalize();
 const hit=trace(origin,dir,solids,roster.filter(a=>opponents(b,a)),b);
 const end=origin.clone().addScaledVector(dir,hit.distance);
 if(preview){
   const muzzle=origin.clone().addScaledVector(b.aim,.5);
   muzzle.y-=.18;
   tracer(muzzle,end,b.team==='blue'?0x83d5ff:0xff987d);
   b.flash=.095;
   if(sound&&prefs.volume>0)lobbyAudio.play(audioContext,muzzle,camera.position,camera.matrixWorld.elements,shotAudio);
   if(hit.actor&&!hit.actor.shield){
     hit.actor.hp=Math.max(0,hit.actor.hp-(hit.head?38:28));
     if(hit.actor.hp===0)hit.actor.dead=1.2;
   }
   return;
 }
 tracer(origin,end,0xff9c79);
 if(hit.actor)applyDamage(hit.actor,hit.head?23:17,b,hit.head);
 if(Math.hypot(b.x-player.x,b.z-player.z)<20)shotAudio(0,.12);
}
function inLobby(){return state==='lobby'||state==='staging';}
function resetLobbyPreview(){
 lobbyTime=lobbyAccumulator=0;
 const [x,,z]=activeMap.look;
 const starts=[...spawns].sort((a,b)=>Math.hypot(a[0]-x,a[1]-z)-Math.hypot(b[0]-x,b[1]-z));
 for(const [i,bot] of lobbyBots.entries()){
   Object.assign(bot,createPlayer(...starts[i]),{shield:0,cool:.35+i*.09,target:null,path:[],
     pathClock:0,think:0,flash:0,stride:i,walk:0});
   bot.aim.set(x-bot.x,0,z-bot.z).normalize();
   bot.group.rotation.y=Math.atan2(bot.aim.x,bot.aim.z);
   bot.group.position.set(bot.x,0,bot.z);
 }
}
function animateLobby(dt){
 if(document.hidden)return;
 if(reducedMotion.matches){lobbyAudio.mute();fadeEffects(dt);return;}
 lobbyTime+=dt;
 lobbyAccumulator+=dt;
 while(lobbyAccumulator>=LOBBY_STEP){
   lobbyAccumulator-=LOBBY_STEP;
   for(const bot of lobbyBots){
     const {x,z}=bot;
     bot.flash=Math.max(0,bot.flash-LOBBY_STEP);
     updateBot(bot,LOBBY_STEP,true);
     const distance=Math.hypot(bot.x-x,bot.z-z);
     bot.stride+=Math.min(distance,.3)*4.3;
     bot.walk=damp(bot.walk,distance>.005?.65:0,16,LOBBY_STEP);
   }
 }
 fadeEffects(dt);
}
function orbitLobbyCamera(){
 const [x,y,z]=activeMap.look;
 const [startX,startY,startZ]=activeMap.preview;
 const radius=Math.min(Math.hypot(startX-x,startZ-z),activeMap.half*1.28);
 const angle=Math.atan2(startZ-z,startX-x)+lobbyTime*Math.PI/26;
 const height=Math.max(12,Math.min(startY,activeMap.half*.6))+Math.sin(lobbyTime*.19)*.9;
 camera.position.set(x+Math.cos(angle)*radius,height,z+Math.sin(angle)*radius);
 camera.lookAt(x,y,z);
 camera.fov=67;
}
function fadeEffects(dt){
 for(let i=effects.length-1;i>=0;i--){
   const effect=effects[i];
   effect.time-=dt;
   if(effect.time>0){
     effect.mesh.material.opacity=effect.time/effect.max;
     continue;
   }
   scene.remove(effect.mesh);
   effect.mesh.geometry.dispose();
   effect.mesh.material.dispose();
   effects.splice(i,1);
 }
}
function clearEffects(){for(const e of effects){scene.remove(e.mesh);e.mesh.geometry.dispose();e.mesh.material.dispose();}effects.length=0;for(const n of numbers)n.el.remove();numbers.length=0;feeds.length=0;renderFeed();}
function start(nextMap){if(online)return;if(nextMap)selectMap(nextMap,false);resetTransient();clearEffects();if(!$('name').readOnly)prefs.name=$('name').value.trim()||'Rookie';prefs.primary=selected;savePrefs();difficulty=$('difficulty').value;rules=$('playlist').value;scoreLimit=roomSettings({rules}).scoreLimit;teamScores={blue:0,red:0};remaining=+$('duration').value;simTime=0;streak=bestStreak=shots=hits=headshots=0;lastKill=lastHurt=-20;
 Object.assign(player,createPlayer(...spawns[0]),{id:-1,name:$('name').value.trim()||'Rookie',inactive:false});player.yaw=Math.atan2(player.x,player.z);for(let i=0;i<bots.length;i++){const b=bots[i];Object.assign(b,createPlayer(...spawns[i+1]),{cool:1+i*.2,path:[],pathClock:0,think:0,target:null});b.group.visible=true;}
 const teamSpawns=[...spawns].sort((a,b)=>b[1]-a[1]);
 for(const [i,actor] of actors.entries()){
   actor.team=rules==='tdm'?TEAMS[i%2]:null;
   if(actor.team){
     const n=Math.floor(i/2);
     [actor.x,actor.z]=teamSpawns[actor.team==='blue'?n:teamSpawns.length-1-n];
   }
   if(actor.bot)colorAvatar(actor);
 }
 player.yaw=Math.atan2(player.x,player.z);
 if(difficulty==='practice'){[player.x,player.z]=activeMap.practice[0];[bots[0].x,bots[0].z]=activeMap.practice[1];player.yaw=Math.atan2(player.x-bots[0].x,player.z-bots[0].z);}
 arsenal=createArsenal(selected);ads=kick=gunKick=bloom=hitTime=damageTime=0;buildGun();state='playing';$('lobby').hidden=$('pause').hidden=$('results').hidden=true;$('hud').hidden=false;document.body.classList.add('playing');canvas.focus();window.scrollTo(0,0);initAudio();if(nextMap||controllerActive)armMouseCapture();else requestLock();message(nextMap?'NEW ROUND':activeMap.name.toUpperCase(),`${nextMap?activeMap.name+' · ':''}${activeMap.size} · ${difficulty==='practice'?'AIM PRACTICE':ruleLabel(rules).toUpperCase()}${controllerActive?' · Hold RB + tap LB to slide-hop':' · Hold SPACE + tap SHIFT to slide-hop'}`,4);updateHud();}
function pause(){if(state!=='playing')return;$('pauseLoadoutSection').hidden=rules==='gun'||player.inactive;state='paused';resetTransient();$('pause').hidden=false;$('leaderboard').hidden=true;syncMatchLoadout();renderRoomControls();if(document.pointerLockElement)document.exitPointerLock();}
function resume(){if(state!=='paused')return;resetTransient();state='playing';$('pause').hidden=true;canvas.focus();initAudio();if(controllerActive)armMouseCapture();else requestLock();}
function lobby(){if(online)leaveOnline();state='lobby';rules='ffa';player.team=null;objectiveDisplay.sync(rules,null,player);for(const bot of bots){bot.team=null;colorAvatar(bot);}renderRoomControls();resetTransient();if(document.pointerLockElement)document.exitPointerLock();$('lobby').hidden=false;$('pause').hidden=$('results').hidden=$('hud').hidden=true;document.body.classList.remove('playing','aiming','scoped');camera.fov=prefs.fov;camera.updateProjectionMatrix();const startingMap=getMap(prefs.mapId).id;if(activeMap.id!==startingMap)selectMap(startingMap,false);else{clearEffects();resetLobbyPreview();}syncLoadout();}
function finish(){
 const competitive=online?.mode==='ranked';
 $('mapVoting').hidden=competitive;
 $('resultsLoadoutSection').hidden=competitive||rules==='gun';
 $('rankedResult').hidden=$('rankedAgain').hidden=!competitive;
 $('rankedAgain').disabled=competitive;
 if(competitive)showRankedResult(online);
 $('hostSettings').open=false;
 $('pause').hidden=$('leaderboard').hidden=true;
 if(!online){
   soloVote=null;
   soloVoteEnds=performance.now()+VOTE_SECONDS*1000;
 }
 syncMatchLoadout();state='results';resetTransient();if(document.pointerLockElement)document.exitPointerLock();$('hud').hidden=true;$('results').hidden=false;document.body.classList.remove('scoped');
 const standings=rankedActors();
 const rank=standings.indexOf(player)+1;
 renderRoomControls();
 $('results').firstElementChild.scrollTop=0;
 renderResults();
 const winner=isTeamGame(rules)?teamWinner(teamScores):null;
 const [leader,runnerUp]=standings;
 const tiesLeader=actor=>actor&&leader&&actor.score===leader.score&&(!scoreLimit||actor.kills===leader.kills);
 const tied=tiesLeader(player)&&tiesLeader(runnerUp);
 const modeResult=rules==='gun'||rules==='storm';
 const place=modeResult?(modeWinner===player.id?'VICTORY.':modeWinner?'ROUND COMPLETE.':'DRAW.'):
   tied?'DRAW.':rank===1?'ARENA CONQUERED.':`YOU PLACED #${rank}.`;
 $('resultTitle').textContent=difficulty==='practice'&&!online?'Practice complete.':isTeamGame(rules)?(winner?(winner===player.team?'VICTORY.':'DEFEAT.'):'DRAW.'):place;
 $('resultName').textContent=`${competitive?'Ranked':online?.mode==='public'?'Quick Play':online?'Custom Room':'Vs AI'} · ${ruleLabel(rules)} · ${activeMap.name} · ${player.score} points · ${bestStreak} best streak · ${headshots} headshots`;
 const winningActor=modeResult&&actors.find(actor=>actor.id===modeWinner);
 if(winningActor)$('resultName').textContent+=' · Winner '+winningActor.name;
 $('finalKills').textContent=player.kills;$('finalDeaths').textContent=player.deaths;$('finalAccuracy').textContent=(shots?Math.round(hits/shots*100):0)+'%';
 const best=player.score>prefs.best;if(best){prefs.best=player.score;savePrefs()}$('personalBest').textContent=best?'NEW PERSONAL BEST':`PERSONAL BEST  ${prefs.best}`;}
function armMouseCapture(){captureOnClick=true;fallbackMouse();}
function fallbackMouse(){if(state!=='playing')return;lookMode='embedded';$('mouseNotice').hidden=controllerActive;$('mouseHint').textContent='Move to look · Hold near the screen edge to turn';}
function requestLock(){if(lockPending||document.pointerLockElement===canvas)return;lookMode='locked';$('mouseNotice').hidden=true;lockPending=true;try{const request=canvas.requestPointerLock?.();if(!canvas.requestPointerLock)fallbackMouse();request?.catch(fallbackMouse).finally(()=>lockPending=false);setTimeout(()=>{lockPending=false;if(state==='playing'&&document.pointerLockElement!==canvas)fallbackMouse()},400);}catch{lockPending=false;fallbackMouse()}}
function controllerLook(dt){
 if(!controllerActive||!controller)return;
 const zoom=(1-ads)+ads*WEAPONS[arsenal.index].zoom/prefs.fov*prefs.adsSensitivity;
 const rate=prefs.controllerSensitivity*zoom*dt;
 player.yaw-=controller.lookX*3.9*rate;
 player.pitch=clamp(player.pitch-controller.lookY*2.8*rate,-1.45,1.45);
}
function movementInput(active=true){
 return {
  forward:active?clamp((keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0)+(controllerActive?controller?.forward??0:0),-1,1):0,
  side:active?clamp((keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)+(controllerActive?controller?.side??0:0),-1,1):0,
  jump:active&&(keys.has('Space')||jumpBuffer>0||padHeld('a')||padHeld('rb')),
  crouch:active&&(keys.has('ShiftLeft')||keys.has('ShiftRight')||keys.has('ControlLeft')||padHeld('b')||padHeld('lb'))
 };
}
function padHeld(button){return controllerActive&&Boolean(controller?.held.has(button));}
function updateScoresVisibility(){
 $('leaderboard').hidden=state!=='playing'||!(keys.has('Tab')||padHeld('view'));
}
function updateHud(){const w=WEAPONS[arsenal.index];$('pauseBtn').textContent=controllerActive?'MENU / PAUSE':'ESC / PAUSE';$('health').textContent=Math.ceil(player.hp);$('healthBar').style.width=player.hp+'%';$('ammo').textContent=w.mode==='melee'?'MELEE':arsenal.mags[arsenal.index];$('ammo').classList.toggle('melee-ammo',w.mode==='melee');$('reserve').textContent=w.mode==='melee'?'':` / ${w.mag}`;$('gunName').textContent=w.name;$('callsign').textContent=player.name.toUpperCase();$('kills').textContent=player.kills;$('points').textContent=player.score;$('streak').textContent=`${streak} STREAK`;$('timer').textContent=Math.floor(remaining/60)+':'+String(Math.floor(remaining%60)).padStart(2,'0');$('speed').textContent=Math.round(Math.hypot(player.vx,player.vz)*10);$('movementState').textContent=player.slide>0?'SLIDING':!player.grounded?'AIRBORNE':player.crouch>.5?'CROUCHED':'SPEED';
 $('reloadLabel').textContent=w.mode==='melee'?'SLASH · 65 DAMAGE · 2.2m REACH':arsenal.reloading>0?'RELOADING…':controllerActive?'RT FIRE · X RELOAD':arsenal.mags[arsenal.index]===0?'R TO RELOAD':w.mode==='semi'?'CLICK TO FIRE · R RELOAD':w.mode==='burst'?'3 ROUNDS / CLICK · R RELOAD':'HOLD TO FIRE · R RELOAD';for(let n=0;n<3;n++){const slot=$('slot'+n),id=arsenal.slots[n];slot.hidden=id===undefined;if(slot.hidden)continue;slot.classList.toggle('active',id===arsenal.index);slot.textContent=`${controllerActive?'':n===1?'2 / E':n===2?'3 / Q':'1'}  ${WEAPONS[id].name}`;}$('reloadProgress').style.transform=`scaleX(${arsenal.reloading>0?1-arsenal.reloading/w.reload:0})`;$('spawnProtection').hidden=player.shield===0||player.dead>0;
 $('killsLabel').textContent=isTeamGame(rules)?'YOUR ELIMINATIONS':'ELIMINATIONS';
 renderTeamTally('teamHud',true);
 renderModeTally();
 if(!$('leaderboard').hidden){
   $('boardRules').textContent=ruleLabel(rules).toUpperCase();
   $('boardScoreLabel').textContent=isObjective(rules)?'OBJ':'POINTS';
   $('boardNote').textContent=isObjective(rules)?OBJECTIVE_RULES[rules].brief:rules==='tdm'?'Hold TAB to view · most team kills wins':scoreLimit?'Hold TAB to view · most kills wins':'Hold TAB to view · highest score wins';
   renderTeamTally('boardTeams');
   renderStandings('boardRows');
 }
}
function simulate(dt){if(online){simulateOnline(dt);return;}simTime+=dt;remaining=Math.max(0,remaining-dt);if(remaining===0){finish();return}player.shield=Math.max(0,player.shield-dt);tickArsenal(arsenal,dt);kick=damp(kick,0,12,dt);gunKick=damp(gunKick,0,18,dt);bloom=damp(bloom,0,6,dt);
 aiming=arsenal.index!==KNIFE&&(rightDown||toggleAim||padHeld('lt'))&&arsenal.reloading===0&&arsenal.switching===0&&player.dead===0;ads=damp(ads,aiming?1:0,arsenal.index===1?15:22,dt);
 if(player.dead>0){player.dead-=dt;if(player.dead<=0)respawnActor(player)}else{
 if(!controllerActive&&lookMode==='embedded'&&mouseInside)player.yaw-=edgeX*2.7*dt;
 const keyLook=2*((1-ads)+ads*WEAPONS[arsenal.index].zoom/prefs.fov);if(keys.has('ArrowLeft'))player.yaw+=keyLook*dt;if(keys.has('ArrowRight'))player.yaw-=keyLook*dt;
 if(keys.has('ArrowUp'))player.pitch=clamp(player.pitch+dt,-1.45,1.45);if(keys.has('ArrowDown'))player.pitch=clamp(player.pitch-dt,-1.45,1.45);
 controllerLook(dt);
 const input={...movementInput(),aim:aiming,mobility:WEAPONS[arsenal.index].mobility};
 stepMovement(player,input,solids,dt);jumpBuffer=Math.max(0,jumpBuffer-dt);if(player.landed&&Math.hypot(player.vx,player.vz)>3)tone(90,.045,.035,'triangle');
 if(mouseDown||pendingShot||keys.has('KeyF')||padHeld('rt')||arsenal.burstRemaining>0){shoot(pendingShot);pendingShot=false;if(arsenal.mags[arsenal.index]===0&&arsenal.cooldown===0)reload();}
 if(player.hp<100&&simTime-lastHurt>4)player.hp=Math.min(100,player.hp+22*dt);
 }
 for(const bot of bots){
   if(scoreLimit&&Math.max(teamScores.blue,teamScores.red)>=scoreLimit)break;
   updateBot(bot,dt);
 }
 if(scoreLimit&&Math.max(teamScores.blue,teamScores.red)>=scoreLimit){finish();return;}
 fadeEffects(dt);
 for(const f of feeds)f.time-=dt;if(feeds.some(f=>f.time<=0)){for(let i=feeds.length-1;i>=0;i--)if(feeds[i].time<=0)feeds.splice(i,1);renderFeed()}
 for(const n of numbers){n.time-=dt;n.pos.y+=dt*.65;}for(let i=numbers.length-1;i>=0;i--)if(numbers[i].time<=0){numbers[i].el.remove();numbers.splice(i,1)}
 messageTime=Math.max(0,messageTime-dt);hitTime=Math.max(0,hitTime-dt);damageTime=Math.max(0,damageTime-dt);flashTime=Math.max(0,flashTime-dt);
}
function render(dt,time){
 const preview=inLobby();
 if(!preview)lobbyAudio.mute();
 stormRing.visible=rules==='storm'&&(state==='playing'||state==='paused');
 if(stormRing.visible)stormRing.scale.set(zoneRadius,1,zoneRadius);
 if(preview)orbitLobbyCamera();
 else if(state==='results'||player.inactive){camera.position.set(activeMap.preview[0]+Math.sin(time*.025)*1.4,activeMap.preview[1],activeMap.preview[2]);camera.lookAt(...activeMap.look);camera.fov=75;}
 else{camera.position.set(player.x,player.feet+player.eye,player.z);camera.rotation.set(clamp(player.pitch+kick,-1.5,1.5),player.yaw,0,'YXZ');const speed=Math.hypot(player.vx,player.vz);camera.fov=damp(camera.fov,prefs.fov*(1-ads)+WEAPONS[arsenal.index].zoom*ads+Math.max(0,speed-9)*.45*(1-ads),18,dt);
 const sway=Math.sin(simTime*12)*Math.min(speed/9,1)*.008*(1-ads);const reload=arsenal.reloading>0?Math.sin(Math.PI*(1-arsenal.reloading/WEAPONS[arsenal.index].reload)):0;
 gun.position.set(.24*(1-ads),-.17*(1-ads)+sway-reload*.3-arsenal.switching*.8,-.1+gunKick*.05);gun.rotation.set(gunKick*.035-reload*.45,0,-reload*.35);if(arsenal.index===KNIFE){const swing=Math.sin(Math.min(1,(WEAPONS[KNIFE].interval-arsenal.cooldown)/WEAPONS[KNIFE].interval)*Math.PI);gun.position.x-=swing*.38;gun.position.y+=swing*.08;gun.rotation.z=-.3-swing*1.2;gun.rotation.x=-swing*.4;}if(muzzle)muzzle.visible=flashTime>0&&ads<.8;
 $('scope').hidden=!(arsenal.index===1&&ads>.92&&player.dead===0);document.body.classList.toggle('scoped',!$('scope').hidden);document.body.classList.toggle('aiming',ads>.8);
 $('crosshair').style.opacity=player.dead>0||ads>.8?'0':'1';$('crosshair').style.transform=`translate(-50%,-50%) scale(${1+bloom*.6+speed*.012})`;$('hitmarker').style.opacity=hitTime>0?'1':'0';if(hitTime===0)$('hitmarker').classList.remove('kill');$('damage').style.opacity=damageTime*1.7;$('damageArrow').style.opacity=damageTime>0?'1':'0';$('damageArrow').style.transform=`translate(-50%,-50%) rotate(${damageAngle}rad)`;
 $('message').style.opacity=$('messageSub').style.opacity=messageTime>0?'1':'0';}
 camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
 objectiveDisplay.render(camera,state==='playing');
 for(const b of [...bots,...remoteActors.values()]){b.group.visible=!preview&&b.dead===0&&(online?remoteActors.has(b.id):bots.includes(b));const blend=online?1-Math.exp(-18*dt):1;b.group.position.lerp(new THREE.Vector3(b.x,b.feet,b.z),blend);b.group.scale.y=1-b.crouch*.25;const walk=(state==='playing'||online)&&difficulty!=='practice'?Math.sin(simTime*11+b.phase)*.5:0;b.legs[0].rotation.x=walk;b.legs[1].rotation.x=-walk;}
 for(const bot of lobbyBots){
   bot.group.visible=preview&&bot.dead===0;
   bot.marker.visible=bot.group.visible&&bot.flash>0&&!reducedMotion.matches;
   if(!bot.group.visible)continue;
   bot.group.position.set(bot.x,bot.feet,bot.z);
   const walk=reducedMotion.matches?0:Math.sin(bot.stride)*bot.walk;
   bot.legs[0].rotation.x=walk;
   bot.legs[1].rotation.x=-walk;
 }
 for(const n of numbers){const v=n.pos.clone().project(camera);n.el.style.display=v.z>1?'none':'';n.el.style.left=(v.x*.5+.5)*innerWidth+'px';n.el.style.top=(-v.y*.5+.5)*innerHeight+'px';n.el.style.opacity=Math.min(1,n.time*4);}
 renderNames();renderer.clear();renderer.render(scene,camera);if((state==='playing'||state==='paused')&&player.dead===0&&!(arsenal.index===1&&ads>.92)){renderer.clearDepth();renderer.render(viewScene,viewCamera);}
}
function selectMap(id,persist=true){
 if(state!=='lobby'&&state!=='results')return;
 clearEffects();activeMap=createMap(id);solids=activeMap.solids;spawns=activeMap.spawns;nav=createNav(solids,activeMap.navBounds);buildWorld(activeMap);resetLobbyPreview();
 for(let i=0;i<bots.length;i++){const b=bots[i];Object.assign(b,createPlayer(...spawns[i+1]),{target:null,path:[],pathClock:0,think:0});b.group.visible=true;}
 Object.assign(player,createPlayer(...spawns[0]));
 for(const button of document.querySelectorAll('[data-map]')){const selected=button.dataset.map===activeMap.id;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}
 $('mapDescription').textContent=activeMap.description;$('mapDimensions').textContent=`${activeMap.half*2} × ${activeMap.half*2}m`;$('mapTag').textContent=activeMap.tag;
 $('heroMapName').textContent=activeMap.name.toUpperCase();$('heroMapSize').textContent=activeMap.size;$('hudMap').textContent=`${activeMap.name.toUpperCase()} · ${activeMap.size}`;$('boardMap').textContent=activeMap.name.toUpperCase();$('pauseMap').textContent=activeMap.name.toUpperCase();
 if(persist){prefs.mapId=activeMap.id;savePrefs();}
}
function mapThumb(map){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('aria-hidden','true');
 const scale=100/(map.half*2+2);const rect=(x,z,w,d,color)=>{const r=document.createElementNS(svg.namespaceURI,'rect');r.setAttribute('x',String(50+(x-w/2)*scale));r.setAttribute('y',String(50+(z-d/2)*scale));r.setAttribute('width',String(w*scale));r.setAttribute('height',String(d*scale));r.setAttribute('fill','#'+color.toString(16).padStart(6,'0'));svg.append(r);};
 rect(0,0,map.half*2,map.half*2,map.ground);
 for(const b of map.boxes)if(b.solid)rect(b.position.x,b.position.z,b.size[0],b.size[2],b.color);
 const p=map.spawns[0];rect(p[0],p[1],map.half*.09,map.half*.09,0xdfff71);return svg;
}
for(const config of MAPS){const b=document.querySelector(`[data-map="${config.id}"]`);b.querySelector('.map-thumb').append(mapThumb(createMap(config.id)));b.onclick=()=>selectMap(config.id);}
selectMap(getMap(prefs.mapId).id,false);
function bindSettings(id,key){$(id).value=prefs[key];$(id+'Value').textContent=prefs[key];$(id).oninput=e=>{prefs[key]=+e.target.value;$(id+'Value').textContent=prefs[key];savePrefs()};}
$('name').value=prefs.name;bindSettings('sensitivity','sensitivity');bindSettings('adsSensitivity','adsSensitivity');bindSettings('controllerSensitivity','controllerSensitivity');bindSettings('fov','fov');bindSettings('volume','volume');
$('play').onclick=()=>start();$('resume').onclick=resume;$('pauseBtn').onclick=pause;$('exit').onclick=()=>{if(online?.mode!=='ranked'||confirm('Leave this ranked match? If you don’t return, it can count as a loss.'))lobby();};$('back').onclick=lobby;$('sound').onclick=()=>{
 sound=!sound;
 $('sound').textContent=sound?'SOUND ON ◖))':'SOUND OFF ◖)';
 $('sound').setAttribute('aria-pressed',String(sound));
 if(!sound)lobbyAudio.mute();
};
function unlockLobbyAudio(){
 if(inLobby()&&sound&&audioContext?.state!=='running')initAudio();
}
document.addEventListener('click',unlockLobbyAudio);
document.addEventListener('keydown',unlockLobbyAudio);
const lobbySettings=$('lobbySettings');
$('openSettings').onclick=()=>{
 $('lobbyPreferences').append($('preferences'));
 $('fullscreenStatus').hidden=true;
 lobbySettings.showModal();
};
$('closeSettings').onclick=()=>lobbySettings.close();
lobbySettings.addEventListener('close',()=>$('pausePreferences').append($('preferences')));
$('fullscreen').onclick=async event=>{
 const status=$('fullscreenStatus');
 status.hidden=true;
 try{
  if(document.fullscreenElement)await document.exitFullscreen();
  else await document.documentElement.requestFullscreen();
 }catch{
  status.textContent=event.isTrusted?'Fullscreen is unavailable in this browser view.':'Click or tap Fullscreen to toggle it.';
  status.hidden=false;
 }
};
document.addEventListener('fullscreenchange',()=>{
 $('fullscreen').textContent=document.fullscreenElement?'EXIT FULLSCREEN':'ENTER FULLSCREEN';
 $('fullscreenStatus').hidden=true;
});
syncLoadout();
for(const b of document.querySelectorAll('[data-weapon]'))b.onclick=()=>{selected=+b.dataset.weapon;syncLoadout()};
window.addEventListener('keydown',e=>{
 if(e.target.matches('input,select')&&state!=='playing')return;
 if(state==='playing'&&['Space','Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','ControlLeft'].includes(e.code))e.preventDefault();
 if(e.code==='Escape'&&state==='paused'){resume();return;}if(e.code==='Escape'&&state==='playing'){pause();return}if(state!=='playing')return;keys.add(e.code);
 if(e.code==='Tab'){updateScoresVisibility();updateHud()}
 if(e.repeat)return;if(e.code==='Space')jumpBuffer=.12;if(e.code==='KeyR')reload();if(e.code==='KeyT')toggleAim=!toggleAim;if(e.code==='KeyQ')changeWeapon(KNIFE);if(e.code==='KeyE')changeWeapon(arsenal.index===PISTOL?arsenal.primary:PISTOL);if(e.code==='KeyF')pendingShot=true;if(e.code==='KeyM')requestLock();if(/^Digit[123]$/.test(e.code))changeWeapon(arsenal.slots[+e.code.slice(-1)-1]);
});
window.addEventListener('keyup',e=>{keys.delete(e.code);if(e.code==='Tab')updateScoresVisibility();});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('mousedown',e=>{if(state!=='playing')return;e.preventDefault();canvas.focus();if(e.button===0){if(captureOnClick){setControllerActive(false);captureOnClick=false;requestLock();}mouseDown=true;pendingShot=true;}if(e.button===2)rightDown=true;initAudio();});
window.addEventListener('mouseup',e=>{if(e.button===0)mouseDown=false;if(e.button===2)rightDown=false;});
canvas.addEventListener('mouseenter',()=>mouseInside=true);canvas.addEventListener('mouseleave',()=>{mouseInside=false;edgeX=0;});
document.addEventListener('mousemove',e=>{if(state!=='playing'||player.dead>0)return;const locked=document.pointerLockElement===canvas;if(!locked&&(controllerActive||!(lookMode==='embedded'&&e.target===canvas)))return;
 const sens=.002*prefs.sensitivity*((1-ads)+ads*prefs.adsSensitivity*WEAPONS[arsenal.index].zoom/prefs.fov);player.yaw-=e.movementX*sens;player.pitch=clamp(player.pitch-e.movementY*sens,-1.45,1.45);
 if(!locked){edgeX=e.clientX<40?-Math.pow(1-e.clientX/40,2):e.clientX>innerWidth-40?Math.pow((e.clientX-innerWidth+40)/40,2):0;mouseInside=true;}});
document.addEventListener('pointerlockchange',()=>{const locked=document.pointerLockElement===canvas;if(locked){hadLock=true;lookMode='locked';$('mouseNotice').hidden=true;}else{const wasLocked=hadLock;hadLock=false;if(wasLocked&&state==='playing')pause();}});
$('captureMouse').onclick=()=>{captureOnClick=false;canvas.focus();requestLock();};
document.addEventListener('pointerlockerror',fallbackMouse);window.addEventListener('blur',()=>{if(state==='playing')pause();resetTransient()});document.addEventListener('visibilitychange',()=>{if(document.hidden){lobbyAudio.mute();pause();}});
window.addEventListener('resize',()=>{camera.aspect=viewCamera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();viewCamera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});

function ruleLabel(value){return GAME_RULES[value]||GAME_RULES.ffa;}
function rankedActors(){
 return [...actors].sort((a,b)=>(isTeamGame(rules)?TEAMS.indexOf(a.team)-TEAMS.indexOf(b.team):0)||
   (isObjective(rules)?(b.objectiveScore||0)-(a.objectiveScore||0):0)||
   (rules==='storm'?(b.lives||0)-(a.lives||0):0)||(scoreLimit||rules!=='ffa'?b.kills-a.kills:0)||b.score-a.score);
}
function renderStandings(id){
 $(id).replaceChildren(...rankedActors().map((actor,i)=>{
   const row=document.createElement('div');
   if(actor===player)row.classList.add('you');
   const name=actor.name+(actor.bot?' · BOT':'');
   const label=actor.team?TEAM_NAMES[actor.team][0]:i+1;
   for(const value of [label,name,actor.kills,actor.deaths,isObjective(rules)?actor.objectiveScore||0:actor.score]){
     const cell=document.createElement('span');
     cell.textContent=value;
     row.append(cell);
   }
   if(actor.team){
     row.firstElementChild.classList.add('team-'+actor.team);
     row.firstElementChild.setAttribute('aria-label',TEAM_NAMES[actor.team]+' team');
   }
   return row;
 }));
}
function renderTeamTally(id,showGoal=false){
 const root=$(id);
 root.hidden=!isTeamGame(rules);
 if(root.hidden)return;
 const goal=showGoal&&scoreLimit?scoreLimit:0;
 const key=[rules,teamScores.blue,teamScores.red,player.team,goal].join(':');
 if(root.dataset.score===key)return;
 root.dataset.score=key;
 root.replaceChildren(...TEAMS.map(team=>{
   const score=document.createElement('span');
   score.dataset.team=team;
   score.classList.toggle('own-team',team===player.team);
   score.textContent=`${TEAM_NAMES[team]} ${teamScores[team]}${team===player.team?' · YOU':''}`;
   return score;
 }));
 if(goal){
   const target=document.createElement('span');
   target.textContent=`FIRST TO ${goal}${isObjective(rules)?' '+OBJECTIVE_RULES[rules].unit.toUpperCase():''}`;
   root.append(target);
 }
}
function renderModeTally(){
 const root=$('modeHud');
 root.hidden=rules!=='gun'&&rules!=='storm';
 if(root.hidden)return;
 let label,danger=false;
 if(rules==='gun'){
   const stage=Math.min(GUN_ORDER.length,1+(player.stage||0));
   label=`WEAPON ${stage}/${GUN_ORDER.length} · ${WEAPONS[GUN_ORDER[stage-1]].name}`;
 }else{
   danger=!player.inactive&&Math.hypot(player.x,player.z)>zoneRadius;
   const alive=actors.filter(actor=>!actor.inactive).length;
   label=player.inactive?(player.waitingForRound?'NEXT ROUND · WAITING':'ELIMINATED · SPECTATING'):
     `${player.lives} LIVES · ${alive} ALIVE · ${danger?'OUTSIDE THE ZONE':Math.round(zoneRadius)+'m SAFE ZONE'}`;
 }
 if(root.textContent===label)return;
 const chip=document.createElement('span');
 chip.classList.toggle('danger',danger);
 chip.textContent=label;
 root.replaceChildren(chip);
}
function renderResults(){
 $('resultScoreLabel').textContent=isObjective(rules)?'OBJ':'PTS';
 renderTeamTally('resultTeams');
 renderStandings('matchStandings');
}
function renderNames(){const forward=direction(player.yaw,player.pitch);for(const b of [...bots,...remoteActors.values()]){b.label.hidden=true;if(state!=='playing'||b.dead>0||!b.group.visible)continue;const dist=Math.hypot(b.x-player.x,b.z-player.z);if(dist>30||dist<.5||!visible(player,b))continue;const toward=new THREE.Vector3(b.x-player.x,b.feet+b.eye-player.feet-player.eye,b.z-player.z).normalize();if(forward.dot(toward)<(player.team&&player.team===b.team ? .7:.96))continue;const v=new THREE.Vector3(b.group.position.x,b.group.position.y+2-b.crouch*.3,b.group.position.z).project(camera);if(v.z>1||Math.abs(v.x)>1||Math.abs(v.y)>1)continue;b.label.hidden=false;b.label.textContent=b.name;b.label.style.left=(v.x*.5+.5)*innerWidth+'px';b.label.style.top=(-v.y*.5+.5)*innerHeight+'px';b.label.style.opacity=String(.65*(1-dist/40));}}
function onlineShot(){const w=WEAPONS[arsenal.index];player.shield=0;gunKick=1;flashTime=.04;bloom=Math.min(1,bloom+.2);kick=Math.min(.1,kick+w.kick*(ads>.5?.65:1));if(w.mode==='melee')tone(280,.15,.1,'triangle');else shotAudio(arsenal.index);}
function leaveOnline(){
 online?.net?.close();
 online=null;
 lastRoomSettings='';
 lastTeamPreference='';
 $('hostSettings').open=false;
 netPending=[];
 for(const a of remoteActors.values()){
   scene.remove(a.group);
   a.group.traverse(m=>m.geometry?.dispose());
   a.marker.material.dispose();
   a.label.remove();
 }
 remoteActors.clear();
 actors.splice(0,actors.length,player,...bots);
 $('onlineStatus').hidden=$('roomControls').hidden=$('pauseCopyRoom').hidden=true;
 $('pauseTitle').textContent='Arena paused.';
 $('copyRoom').textContent='COPY INVITE';
 $('pauseCopyRoom').textContent='COPY ROOM INVITE';
 $('resultsCopyRoom').textContent='COPY INVITE';
 setRoomLink(null);
 $('cancelRanked').hidden=true;
 setJoining(false);
}
function readNetArsenal(data){const old=arsenal.index;arsenal=createArsenal(data.primary);Object.assign(arsenal,data);for(const i of netPending){switchWeapon(arsenal,i.weapon);tickArsenal(arsenal,STEP);if(i.reload)startReload(arsenal);if(i.fire||arsenal.burstRemaining>0)fireRound(arsenal,i.fresh);}if(old!==arsenal.index)buildGun();}
const objectiveEvents={
 captureZone:'ZONE CAPTURED',takeFlag:'FLAG TAKEN',dropFlag:'FLAG DROPPED',returnFlag:'FLAG RETURNED',
 captureFlag:'FLAG CAPTURED',confirm:'KILL CONFIRMED',deny:'KILL DENIED'
};
function syncOnline(m,welcome=false){if(!online)return;const own=m.actors.find(a=>a.id===online.id);if(!own)return;const priorDead=player.dead>0,priorLife=player.life,lookYaw=player.yaw,lookPitch=player.pitch;netPending=netPending.filter(i=>i.seq>own.ack);Object.assign(player,own);rules=m.rules||'ffa';modeWinner=m.roundWinner;zoneRadius=m.zoneRadius||0;player.inactive=Boolean(own.inactive);scoreLimit=m.scoreLimit||0;if(m.teamScores)teamScores=m.teamScores;objectiveDisplay.sync(rules,m.objective,player);const respawned=priorLife!==own.life;player.name=own.name;if(respawned){ads=kick=gunKick=bloom=0;pendingShot=rightDown=toggleAim=mouseDown=false;netReload=false;}if(welcome||respawned||priorDead&&own.dead===0||netRound!==m.round)netPending=[];if(own.dead===0)for(const i of netPending){player.yaw=i.yaw;player.pitch=i.pitch;stepMovement(player,{...i,mobility:WEAPONS[i.weapon]?.mobility||1},solids,STEP);}if(!welcome&&!respawned&&!priorDead&&netRound===m.round){player.yaw=lookYaw;player.pitch=lookPitch;}if(m.arsenal)readNetArsenal(m.arsenal);remaining=m.remaining;streak=own.streak;bestStreak=own.bestStreak;shots=own.shots;hits=own.hits;headshots=own.headshots;if(online.requestedPrimary===own.pendingPrimary)delete online.requestedPrimary;selected=online.requestedPrimary??own.pendingPrimary??own.primary;syncLoadout();syncMatchLoadout();
 const present=new Set();for(const data of m.actors){if(data.id===online.id)continue;present.add(data.id);let a=remoteActors.get(data.id);if(!a){a=makeAvatar({...createPlayer(data.x,data.z),id:data.id,path:[],phase:remoteActors.size},remoteActors.size);a.group.position.set(data.x,data.feet,data.z);remoteActors.set(data.id,a);}const teleport=welcome||a.life!==data.life;Object.assign(a,data);colorAvatar(a);if(teleport)a.group.position.set(data.x,data.feet,data.z);a.group.rotation.y=data.yaw+Math.PI;}
 for(const [id,a]of remoteActors)if(!present.has(id)){scene.remove(a.group);a.group.traverse(o=>o.geometry?.dispose());a.marker.material.dispose();a.label.remove();remoteActors.delete(id);}actors.splice(0,actors.length,player,...remoteActors.values());for(const b of bots){b.group.visible=false;b.label.hidden=true;}
 for(const event of m.events||[]){const attacker=actors.find(a=>a.id===event.by),victim=actors.find(a=>a.id===event.id);if(event.type==='shot'&&event.by!==online.id){for(const p of event.to)tracer(new THREE.Vector3(event.from.x,event.from.y,event.from.z),new THREE.Vector3(p.x,p.y,p.z),attacker?.bot?0xff9c79:0xffe6a5);if(attacker&&Math.hypot(attacker.x-player.x,attacker.z-player.z)<25)shotAudio(event.weapon,.13);}if(event.type==='hit'){if(event.by===online.id){hitTime=.15;$('hitmarker').style.color=event.head?'#ffe18a':'#eaffcf';if(victim)damageNumber(event.amount,victim,event.head);tone(event.head?1150:850,.045,.09);}if(event.id===online.id){damageTime=.34;tone(70,.11,.07,'triangle');}}if(event.type==='objective'){
   const label=objectiveEvents[event.action];
   if(event.id===online.id)message(label,'',1.35);
   if(event.action.endsWith('Flag'))feed(`${victim?.name||TEAM_NAMES[event.team]} · ${label.toLowerCase()}`);
 }if(event.type==='stormDeath'){
   feed(`${victim?.name||'Player'} · Storm`);
   if(event.id===online.id)message('STORM ELIMINATION',player.inactive?'Spectating until the round ends':'Respawning',2);
 }if(event.type==='kill'){feed(`${attacker?.name||'Player'} ${event.friendly?'×':event.head?'◆':'▸'} ${victim?.name||'Player'}`);if(event.by===online.id){if(event.friendly)message('TEAMMATE DOWN','Friendly fire is on');else{message(`${event.head?'HEADSHOT':'ELIMINATION'} +${event.points}`,`${streak} STREAK`);hitTime=.22;$('hitmarker').classList.add('kill');}}if(event.id===online.id){netPending=[];toggleAim=rightDown=mouseDown=false;message(`${attacker?.name||'PLAYER'} GOT YOU`,player.inactive?'Spectating until the round ends':`Respawning in ${Math.max(0,player.dead).toFixed(1)}s`,player.inactive?3:Math.max(1,player.dead));}}}
 online.humans=m.actors.filter(a=>!a.bot).length;
 if(online.mode==='custom')online.controls={settings:m.settings,next:m.nextSettings,host:m.host,preference:own.teamPreference,round:m.round};
 if(m.phase==='staging'){
   state='staging';
   $('roomError').textContent=`Ranked match found · ${online.humans}/8 connected`;
   $('cancelRanked').hidden=false;
   return;
 }
 $('cancelRanked').hidden=true;
 const newRound=netRound!==m.round;netRound=m.round;if(m.phase==='results'&&state!=='results'){finish();}else if(m.phase==='playing'&&(state==='results'||state==='staging'||welcome||newRound)){state='playing';$('results').hidden=$('lobby').hidden=$('pause').hidden=true;$('hud').hidden=false;document.body.classList.add('playing');if(newRound||online.mode==='ranked')message(m.round===1?'MATCH LIVE':'NEW ROUND',`${activeMap.name} · ${ruleLabel(rules)}`);canvas.focus();if(document.pointerLockElement!==canvas)armMouseCapture();}if(state==='results'){renderResults();if(online.mode!=='ranked')renderVoting(m.voteRemaining,m.votes?.[online.id],m.voteCounts);}renderRoomControls();updateOnlineStatus();updateHud();}
function simulateOnline(dt){simTime+=dt;tickArsenal(arsenal,dt);kick=damp(kick,0,12,dt);gunKick=damp(gunKick,0,18,dt);bloom=damp(bloom,0,6,dt);const active=state==='playing'&&!player.inactive&&online.net.socket?.readyState===WebSocket.OPEN;aiming=active&&arsenal.index!==KNIFE&&(rightDown||toggleAim||padHeld('lt'))&&!arsenal.reloading&&!arsenal.switching&&player.dead===0;ads=damp(ads,aiming?1:0,arsenal.index===1?15:22,dt);
 if(active&&player.dead===0){if(!controllerActive&&lookMode==='embedded'&&mouseInside)player.yaw-=edgeX*2.7*dt;const look=2*((1-ads)+ads*WEAPONS[arsenal.index].zoom/prefs.fov);player.yaw+=((keys.has('ArrowLeft')?1:0)-(keys.has('ArrowRight')?1:0))*look*dt;player.pitch=clamp(player.pitch+((keys.has('ArrowUp')?1:0)-(keys.has('ArrowDown')?1:0))*dt,-1.45,1.45);controllerLook(dt);}
 const input={seq:++netSequence,yaw:player.yaw,pitch:player.pitch,...movementInput(active),aim:aiming,weapon:arsenal.index,reload:netReload,fire:active&&(mouseDown||pendingShot||keys.has('KeyF')||padHeld('rt')),fresh:active&&pendingShot};netReload=false;jumpBuffer=Math.max(0,jumpBuffer-dt);
 if(player.dead===0){stepMovement(player,{...input,mobility:WEAPONS[arsenal.index].mobility},solids,dt);if(input.fire||arsenal.burstRemaining>0)shoot(input.fresh);if(arsenal.mags[arsenal.index]===0&&arsenal.cooldown===0)reload();}pendingShot=false;if(active||state==='paused'){netPending.push(input);if(netPending.length>240)netPending.shift();online.net.input(input);}fadeEffects(dt);for(const f of feeds)f.time-=dt;for(let n=feeds.length-1;n>=0;n--)if(feeds[n].time<=0)feeds.splice(n,1);renderFeed();for(const n of numbers){n.time-=dt;n.pos.y+=dt*.65;}for(let n=numbers.length-1;n>=0;n--)if(numbers[n].time<=0){numbers[n].el.remove();numbers.splice(n,1);}messageTime=Math.max(0,messageTime-dt);hitTime=Math.max(0,hitTime-dt);damageTime=Math.max(0,damageTime-dt);flashTime=Math.max(0,flashTime-dt);}
const createSettingsForm=createRoomControls($('createRoomFields'));
const liveSettingsForm=createRoomControls($('liveRoomFields'));
let lastRoomSettings='',lastTeamPreference='';
function renderRoomControls(){
 const root=$('liveRoomOptions');
 const controls=online?.controls;
 const visible=controls?.settings&&(state==='paused'||state==='results');
 const waiting=visible&&state==='results';
 const host=visible&&controls.host===online.id;
 $('roomIntermission').hidden=!waiting;
 $('pauseFriendInvite').hidden=!(visible&&state==='paused'&&accountProfile);
 $('resultsFriendInvite').hidden=!(waiting&&accountProfile);
 $('startNextMatch').hidden=!(waiting&&host);
 root.hidden=!visible;
 if(!visible)return;
 if(waiting){
   const count=online.humans;
   const status=online.status||(host?'You host this room':'Waiting for the host to start');
   $('intermissionCode').textContent='ROOM '+online.code;
   $('intermissionStatus').textContent=`${count} ${count===1?'player':'players'} in room · ${status}`;
   $('startNextMatch').disabled=Boolean(online.starting||online.status);
 }
 $('saveRoomSettings').textContent=waiting?'SAVE NEXT MATCH RULES':'QUEUE FOR NEXT ROUND';
 const container=$(state==='results'?'resultsRoomSettings':'pauseRoomSettings');
 if(root.parentNode!==container)container.append(root);
 const settings=controls.next??controls.settings;
 $('hostSettings').hidden=!host;
 const teamChoice=isTeamGame(settings.rules)&&settings.teamSetup==='mixed';
 $('teamPreferenceLabel').hidden=!teamChoice;
 const key=JSON.stringify([online.code,controls.round,controls.host,Boolean(controls.next),settings]);
 if(key!==lastRoomSettings){
   lastRoomSettings=key;
   if(host)liveSettingsForm.write(settings);
   $('liveRoomStatus').textContent=controls.next?'Host settings queued for the next round.':'';
 }
 const preference=controls.preference||'auto';
 if(preference!==lastTeamPreference||$('teamPreference').value!==preference){
   lastTeamPreference=preference;
   if(!$('teamPreference').matches(':focus'))$('teamPreference').value=preference;
 }
 root.hidden=!host&&!teamChoice&&!controls.next;
}
$('saveRoomSettings').onclick=()=>{
 if(!online?.controls)return;
 $('liveRoomStatus').textContent='Saving next round settings…';
 online.net.send({type:'roomSettings',round:netRound,settings:liveSettingsForm.read()});
};
$('startNextMatch').onclick=()=>{
 if(state!=='results'||!online||online.controls?.host!==online.id||online.starting||online.status)return;
 online.starting=true;
 $('liveRoomStatus').textContent='Starting next match…';
 online.net.send({type:'restart',round:netRound,settings:liveSettingsForm.read()});
 renderRoomControls();
};
$('teamPreference').onchange=()=>{
 if(!online?.controls)return;
 online.net.send({type:'teamPreference',round:netRound,team:$('teamPreference').value});
};

const modeButtons=[...document.querySelectorAll('[data-mode]')];
const modeText={
 public:'Drop in and keep playing. Bots fill open slots and map votes roll into the next match.',
 ranked:'Signed-in 4v4 Team Deathmatch. Eight humans start together and team results change your rating.',
 ai:'Play offline against bots. Pick your starting arena and difficulty.',
 custom:'Create a private match or join friends with an invite code.'
};
function selectMode(mode){
 for(const button of modeButtons){
   const active=button.dataset.mode===mode;
   button.classList.toggle('selected',active);
   button.setAttribute('aria-pressed',String(active));
 }
 $('playNote').textContent=mode==='custom'?'Vote and adjust rules between matches. The host starts the next match.':mode==='ranked'?'Five placement matches unlock your rating. Queue again after each match.':'Vote after each match. The next round starts automatically.';
 $('quickPlay').hidden=mode!=='public';
 $('rankedPlay').hidden=mode!=='ranked';
 for(const option of $('playlist').options){
   const onlineOnly=isObjective(option.value)||['gun','storm'].includes(option.value);
   option.disabled=option.hidden=onlineOnly&&mode==='ai';
 }
 if($('playlist').selectedOptions[0]?.disabled)$('playlist').value='ffa';
 $('play').hidden=mode!=='ai';
 $('customEntry').hidden=mode!=='custom';
 $('matchSettings').hidden=mode!=='ai';
 $('createSettings').hidden=mode!=='custom';
 $('playlistLabel').hidden=$('playlist').hidden=mode==='custom'||mode==='ranked';
 $('modePill').textContent=mode==='public'?'8 SLOTS':mode==='ai'?'OFFLINE':mode==='ranked'?'4V4 · TDM':'INVITE ONLY';
 const picksStartingMap=mode==='custom'||mode==='ai';
 $('startingMapPicker').hidden=$('heroMapSize').hidden=$('heroMapBadge').hidden=!picksStartingMap;
 $('heroMode').textContent=mode==='public'?ruleLabel($('playlist').value).toUpperCase():mode==='ai'?'VS AI':mode==='ranked'?'RANKED TDM':'CUSTOM ROOMS';
 updatePlaylistPreview(mode);
 $('roomError').textContent='';
}
function updatePlaylistPreview(mode){
 const playlist=mode==='public'?$('playlist').value:null;
 $('lobbyLoadout').hidden=playlist==='gun';
 $('modeDescription').textContent=playlist==='gun'?'One elimination per weapon. Finish the knife stage to win.':
   playlist==='storm'?'Three lives. Stay inside the shrinking ring and outlast the arena.':OBJECTIVE_RULES[playlist]?.brief||modeText[mode];
}
function setJoining(joining){
 for(const button of [...modeButtons,$('playlist'),$('play'),$('quickPlay'),$('rankedPlay'),$('createRoom'),$('joinRoom')])button.disabled=joining;
}
function setRoomLink(code){
 const url=new URL(location.href);
 if(code)url.searchParams.set('room',code);
 else url.searchParams.delete('room');
 history.replaceState(null,'',url);
}
function updateOnlineStatus(){
 if(online.status)return;
 const label=online.mode==='ranked'?'RANKED · 4V4 TDM':online.mode==='public'?`PUBLIC · ${online.humans}/8 HUMANS`:`CUSTOM · ${online.code}`;
 const text=online.ping==null?label:`${label} · ${online.ping}ms`;
 if($('onlineStatus').textContent!==text)$('onlineStatus').textContent=text;
}
function getGuestSession(){
 try{
   let session=sessionStorage.getItem('witty-room-session');
   if(!session){
     session=crypto.randomUUID();
     sessionStorage.setItem('witty-room-session',session);
   }
   return session;
 }catch{return crypto.randomUUID();}
}
let rankedSearch=null;
async function findRanked(){
 if(rankedSearch||online)return;
 if(!accountProfile){
   hub.open();
   $('hubStatus').textContent='Create an account or sign in to queue for Ranked.';
   return;
 }
 const search={timer:null,request:null};
 rankedSearch=search;
 setJoining(true);
 $('cancelRanked').hidden=false;
 $('roomError').textContent='Searching for eight ranked players…';
 async function poll(){
   try{
     search.request=hub.queueRanked('join');
     const result=await search.request;
     if(rankedSearch!==search)return;
     if(result.matchId){
       rankedSearch=null;
       setJoining(false);
       enterRoom('ranked',result.matchId);
       return;
     }
     $('roomError').textContent=`Ranked search · ${result.count} searching · 8 needed`;
     search.timer=setTimeout(poll,2500);
   }catch(error){
     if(rankedSearch!==search)return;
     rankedSearch=null;
     setJoining(false);
     $('cancelRanked').hidden=true;
     $('roomError').textContent=error.message;
   }
 }
 poll();
}
$('cancelRanked').onclick=async()=>{
 if(online?.mode==='ranked'){lobby();return;}
 const search=rankedSearch;
 if(!search)return;
 rankedSearch=null;
 clearTimeout(search.timer);
 $('cancelRanked').hidden=true;
 try{await search.request;await hub.queueRanked('cancel');}catch{}
 setJoining(false);
 $('roomError').textContent='Ranked search cancelled.';
};
$('rankedAgain').onclick=()=>{lobby();selectMode('ranked');findRanked();};
async function showRankedResult(connection){
 $('rankedResult').textContent='Saving ranked result…';
 for(let tries=0;tries<8&&online===connection;tries++){
   try{
     const {result}=await hub.rankedResult(connection.rankedId);
     if(online!==connection)return;
     if(result){
       const delta=(result.delta>=0?'+':'')+result.delta;
       $('rankedAgain').disabled=false;
       $('rankedResult').textContent=result.rating===null?
         `Placement ${result.played}/${result.placements} · ${delta} rating`:
         `${delta} rating · New rating ${result.rating}`;
       return;
     }
   }catch{}
   await new Promise(resolve=>setTimeout(resolve,1000));
 }
 if(online===connection){
   $('rankedAgain').disabled=false;
   $('rankedResult').textContent='Result pending. Check your Player Hub shortly.';
 }
}
async function enterRoom(action,rankedId){
 if(online||$('quickPlay').disabled)return;
 initAudio();
 setJoining(true);
 const isPublic=action==='public';
 const isRanked=action==='ranked';
 $('roomError').textContent=isRanked?'Connecting to ranked match…':isPublic?'Finding a public match…':action==='create'?'Creating your room…':'Joining room…';
 try{
   let code=isPublic||isRanked?null:$('roomCode').value.trim().toUpperCase();
   if(action==='create'){
     const response=await fetch(onlineOrigin()+'/api/rooms',{
       method:'POST',
       headers:{'Content-Type':'application/json'},
       body:JSON.stringify({mapId:activeMap.id,...createSettingsForm.read()})
     });
     if(!response.ok)throw new Error('The room service is unavailable. Please try again.');
     code=(await response.json()).code;
   }
   if(!isPublic&&!isRanked&&!/^[A-Z2-9]{8}$/.test(code))throw new Error('Enter an eight-character room code.');
   const session=getGuestSession();
   const connection={code,id:session,mode:isRanked?'ranked':isPublic?'public':'custom',rankedId,net:null};
   online=connection;
   if(!$('name').readOnly)prefs.name=$('name').value.trim()||'Rookie';
   prefs.primary=selected;
   savePrefs();
   connection.net=new RoomConnection(code,{session,name:$('name').value.trim()||'Rookie',primary:selected,...(isRanked?{rankedId}:isPublic?{rules:$('playlist').value}:{})},{
     ticket:()=>hub.ticket(),
     welcome:m=>{
       if(online!==connection)return;
       online.id=m.id;
       online.status='';
       online.starting=false;
       state='lobby';
       if(activeMap.id!==m.config.mapId)selectMap(m.config.mapId,false);
       netSequence=Math.max(netSequence,m.snapshot.actors.find(a=>a.id===m.id)?.ack||0);
       netPending=[];
       resetTransient();
       clearEffects();
       difficulty=m.config.difficulty||'normal';
       arsenal=createArsenal(selected);
       buildGun();
       netRound=0;
       syncOnline({...m.snapshot,arsenal:m.arsenal},true);
       $('onlineStatus').hidden=false;
       $('roomControls').hidden=$('pauseCopyRoom').hidden=isPublic||isRanked;
       $('roomCodeLabel').textContent=code;
       if(code)$('roomCode').value=code;
       if(state!=='staging')$('roomError').textContent='';
       $('pauseTitle').textContent='Match continues online.';
       setRoomLink(code);
     },
     snapshot:m=>{if(online===connection)syncOnline(m);},
     status:text=>{
       if(online!==connection)return;
       online.status=text;
       $(state==='lobby'||state==='staging'?'roomError':'onlineStatus').textContent=text;
       renderRoomControls();
     },
     ping:ms=>{
       if(online!==connection)return;
       online.ping=ms;
       updateOnlineStatus();
     },
     roomUpdate:m=>{
       if(online!==connection)return;
       if(m.type==='restartResult'){
         if(!m.accepted){
           online.starting=false;
           $('liveRoomStatus').textContent='Could not start. Check the player limit and try again.';
           renderRoomControls();
         }
         return;
       }
       const settings=m.type==='roomSettingsResult';
       $('liveRoomStatus').textContent=settings
         ?m.accepted?'Host settings queued for the next round.':'Settings could not be queued. Check host access and room capacity.'
         :m.accepted?'Team preference saved for the next round.':'Team choice is unavailable for this round.';
     },
     failed:text=>{
       if(online!==connection)return;
       lobby();
       $('roomError').textContent=text;
     }
   });
 }catch(error){
   if(online)leaveOnline();
   $('roomError').textContent=error.message;
   setJoining(false);
 }
}
for(const button of modeButtons)button.onclick=()=>selectMode(button.dataset.mode);
$('quickPlay').onclick=()=>enterRoom('public');
$('rankedPlay').onclick=findRanked;
$('createRoom').onclick=()=>enterRoom('create');
$('joinRoom').onclick=()=>enterRoom('join');
$('roomCode').onkeydown=event=>{if(event.key==='Enter')enterRoom('join');};
$('pauseCopyRoom').onclick=$('resultsCopyRoom').onclick=()=>$('copyRoom').click();
$('copyRoom').onclick=async()=>{
 const code=online?.code;
 if(!code)return;
 try{
   await navigator.clipboard.writeText(location.href);
   if(online?.code!==code)return;
   $('copyRoom').textContent='LINK COPIED';
   $('pauseCopyRoom').textContent='INVITE LINK COPIED';
   $('resultsCopyRoom').textContent='LINK COPIED';
 }catch{
   if(online?.code!==code)return;
   $('copyRoom').textContent='ROOM: '+code;
   $('pauseCopyRoom').textContent='ROOM CODE: '+code;
   $('resultsCopyRoom').textContent=code;
 }
};
const invited=new URL(location.href).searchParams.get('room');
if(invited)$('roomCode').value=invited.toUpperCase();
selectMode(invited?'custom':'public');
$('playlist').onchange=()=>{
 if(modeButtons[0].getAttribute('aria-pressed')==='true'){
   $('heroMode').textContent=ruleLabel($('playlist').value).toUpperCase();
   updatePlaylistPreview('public');
 }
};

function syncMatchLoadout(){for(const b of document.querySelectorAll('[data-loadout]')){const active=+b.dataset.loadout===selected;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));}const current=arsenal.primary,pending=selected!==current;$('loadoutStatus').textContent=pending?`${WEAPONS[selected].name} ready for your next respawn.`:`${WEAPONS[current].name} equipped. Choose a primary for your next respawn.`;$('respawnLoadout').textContent=`RESPAWN WITH ${WEAPONS[selected].name} ↗`;$('respawnLoadout').disabled=player.dead>0;}
function selectMatchLoadout(primary){selected=primary;prefs.primary=primary;savePrefs();syncLoadout();syncMatchLoadout();if(online){online.requestedPrimary=primary;online.net.settings.primary=primary;online.net.send({type:'loadout',primary});}}
function equipAndRespawn(){if(player.dead>0)return;if(online)online.net.send({type:'loadout',primary:selected,respawn:true});else{player.deaths++;streak=0;resetTransient();respawnActor(player);}resume();}
function renderVoting(remaining,mine,counts){
 const waiting=online?.mode==='custom';
 $('voteCountdown').hidden=$('voteProgress').hidden=waiting;
 if(!waiting){
   const countdown=`${Math.ceil(remaining)}s`;
   if($('voteCountdown').textContent!==countdown)$('voteCountdown').textContent=countdown;
   $('voteProgress').value=remaining;
 }
 for(const b of document.querySelectorAll('[data-vote-map]')){
   const active=b.dataset.voteMap===mine;
   b.classList.toggle('selected',active);
   b.setAttribute('aria-pressed',String(active));
   const count=counts?.[b.dataset.voteMap]||0;
   const label=`${count} ${count===1?'VOTE':'VOTES'}`;
   if(b.lastElementChild.textContent!==label)b.lastElementChild.textContent=label;
 }
 const status=mine
   ?`Your vote: ${getMap(mine).name}. ${waiting?'Voting closes when the host starts.':'Next round starts automatically.'}`
   :waiting?'Vote anytime before the host starts the next match.':'Pick a map or let the next arena rotate in.';
 if($('voteStatus').textContent!==status)$('voteStatus').textContent=status;
}
function updateSoloVoting(now){
 const remaining=Math.max(0,(soloVoteEnds-now)/1000);
 const counts=soloVote?{[soloVote]:1}:{};
 if(remaining===0)start(nextArena(activeMap.id,counts));
 else renderVoting(remaining,soloVote,counts);
}
for(const target of ['pauseLoadout','resultsLoadout'])for(let n=0;n<PRIMARY_COUNT;n++){const b=document.createElement('button');b.type='button';b.dataset.loadout=n;b.setAttribute('aria-pressed','false');const name=document.createElement('b');name.textContent=WEAPONS[n].name;const type=document.createElement('span');type.textContent=WEAPONS[n].label;b.append(name,type);b.onclick=()=>selectMatchLoadout(n);$(target).append(b);}
for(const config of MAPS){const b=document.createElement('button');b.type='button';b.className='map-card';b.dataset.voteMap=config.id;b.setAttribute('aria-pressed','false');const thumb=document.createElement('span');thumb.className='map-thumb';thumb.append(mapThumb(createMap(config.id)));const size=document.createElement('span');size.className='map-size';size.textContent=config.size;const name=document.createElement('b');name.textContent=config.name;const count=document.createElement('span');count.className='vote-count';count.textContent='0 VOTES';b.append(thumb,size,name,count);b.onclick=()=>{
 if(state!=='results')return;
 if(online)online.net.send({type:'vote',mapId:config.id,round:netRound});
 else if(performance.now()<soloVoteEnds){
   soloVote=config.id;
   updateSoloVoting(performance.now());
 }
};$('voteOptions').append(b);}
$('respawnLoadout').onclick=equipAndRespawn;$('resumeTop').onclick=resume;

let accountProfile=null;
const hub=createPlayerHub(onlineOrigin,profile=>{
 accountProfile=profile;
 $('name').readOnly=Boolean(profile);
 $('name').value=profile?profile.name:prefs.name;
 renderRoomControls();
},code=>{
 lobby();
 selectMode('custom');
 $('roomCode').value=code;
 enterRoom('join');
});
$('pauseFriendInvite').onclick=$('resultsFriendInvite').onclick=()=>{if(online?.code&&accountProfile)hub.open(online.code);};
function setControllerActive(active){
 if(controllerActive===active)return;
 controllerActive=active;
 document.body.classList.toggle('controller-active',active);
 if(active)$('mouseNotice').hidden=true;
 updateScoresVisibility();
}
function controllerMenu(){
 if(!['a','b','menu','up','down','left','right'].some(controller.pressed))return;
 const modal=lobbySettings.open?lobbySettings:$('playerHub').open?$('playerHub'):null;
 const modalClose=modal?.querySelector('.hub-top button');
 const root=modal??(state==='paused'?$('pause'):state==='results'?$('results'):$('lobby'));
 const visible=element=>!element.disabled&&element.getClientRects().length>0;
 const controls=[...root.querySelectorAll('button,select,input:not([type="hidden"]),summary')].filter(visible);
 const primary=modalClose??(state==='lobby'
   ? ['quickPlay','rankedPlay','play','joinRoom','createRoom'].map($).find(element=>visible(element)&&(element.id!=='joinRoom'||$('roomCode').value.trim()))
   : controls.find(element=>element.id===(state==='paused'?'resume':'startNextMatch')));
 const focused=document.activeElement;
 const current=controls.indexOf(focused);
 const direction=(controller.pressed('down')||controller.pressed('right')?1:0)-(controller.pressed('up')||controller.pressed('left')?1:0);

 if(controller.pressed('b')){
  if(modalClose)modalClose.click();
  else if(state==='paused')resume();
  else if(state==='staging'||(state==='lobby'&&!$('cancelRanked').hidden))$('cancelRanked').click();
  return;
 }
 if(controller.pressed('menu')&&!modal&&state!=='staging'){
  if(state==='paused')resume();
  else if(state==='lobby'&&!$('cancelRanked').hidden)$('cancelRanked').click();
  else primary?.click();
  return;
 }
 if(direction&&controls.length){
  const horizontal=controller.pressed('left')||controller.pressed('right');
  if(horizontal&&focused.tagName==='SELECT'&&current>=0){
   const options=[...focused.options].filter(option=>!option.disabled&&!option.hidden);
   const selectedIndex=options.findIndex(option=>option.selected);
   const option=options[clamp(selectedIndex+direction,0,options.length-1)];
   if(option&&focused.value!==option.value){
    focused.value=option.value;
    focused.dispatchEvent(new Event('change',{bubbles:true}));
   }
  }else if(horizontal&&focused.type==='range'&&current>=0){
   if(direction>0)focused.stepUp();else focused.stepDown();
   focused.dispatchEvent(new Event('input',{bubbles:true}));
  }else{
   const next=current<0?(primary??controls[0]):controls[(current+direction+controls.length)%controls.length];
   next.focus();
  }
  return;
 }
 if(controller.pressed('a')){
  const target=current>=0?focused:primary;
  if(target?.matches('button,summary,input[type="checkbox"]'))target.click();
 }
}
let canReadGamepads=typeof navigator.getGamepads==='function';
const controllerUnavailable='Controller access is unavailable in this browser view. Try opening the game in its own tab.';
if(!canReadGamepads)$('controllerStatus').textContent=controllerUnavailable;
function pollController(){
 if(document.hidden||!canReadGamepads)return;
 const previous=controller;
 try{controller=sampleGamepad(navigator.getGamepads());}
 catch{
  canReadGamepads=false;
  controller=null;
  $('controllerStatus').textContent=controllerUnavailable;
 }
 if(previous!==null&&controller===null){
  if(controllerActive&&state==='playing')pause();
  setControllerActive(false);
  if(canReadGamepads)$('controllerStatus').textContent='Controller disconnected · reconnect and press a button';
  return;
 }
 if(!controller)return;
 if(controller.connected){
  $('controllerStatus').textContent='Controller connected · D-pad browse · A select · Menu play';
  setControllerActive(true);
 }
 if(controller.active)setControllerActive(true);
 if(state==='playing'&&controllerActive)updateScoresVisibility();
 if(!controller.active)return;
 if(state!=='playing'){
  controllerMenu();
  return;
 }
 if(controller.pressed('menu')){pause();$('resume').focus();return;}
 if(player.dead>0||player.inactive)return;
 if(controller.pressed('a')||controller.pressed('rb'))jumpBuffer=.12;
 if(controller.pressed('x'))reload();
 if(controller.pressed('y')){
  const slots=arsenal.slots;
  changeWeapon(slots[(slots.indexOf(arsenal.index)+1)%slots.length]);
 }
 if(controller.pressed('rt'))pendingShot=true;
}
document.addEventListener('visibilitychange',()=>{
 if(document.hidden)sampleGamepad([]);
});
buildGun();let previous=performance.now(),accumulator=0,hudClock=0;
function frame(now){requestAnimationFrame(frame);const dt=Math.min((now-previous)/1000,.1);previous=now;pollController();if(state==='playing'||online&&state==='paused'){accumulator+=dt;while(accumulator>=STEP&&(state==='playing'||online&&state==='paused')){simulate(STEP);accumulator-=STEP;}hudClock+=dt;if(hudClock>.05){updateHud();hudClock=0}}else{accumulator=0;if(inLobby())animateLobby(dt);else if(state==='results'&&!online)updateSoloVoting(now);}render(dt,now/1000);}requestAnimationFrame(frame);
