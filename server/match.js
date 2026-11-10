import {MAPS,createMap,getMap} from '../dist/maps.js';
import {STEP,WEAPONS,createPlayer,createArsenal,stepMovement,createNav,trace,meleeTrace,clamp,damp,switchWeapon,tickArsenal,startReload,fireRound} from '../dist/core.js';
import {VOTE_SECONDS,nextArena} from '../dist/rounds.js';
import {BOT_SKILLS,MAX_PLAYERS,TEAMS,humanLimit,opponents,roomSettings,spawnTeamBias} from '../dist/rules.js';
export {VOTE_SECONDS};
export const CAPACITY=MAX_PLAYERS;
export const poseKeys=['x','z','feet','vx','vz','vy','yaw','pitch','grounded','crouch','slide','slideReady','eye','hp','dead','shield','kills','deaths','score'];
export function cleanName(value){return String(value||'Rookie').replace(/[\x00-\x1f\x7f<>]/g,'').trim().slice(0,16)||'Rookie';}
export function validateInput(v){if(!v||!Number.isSafeInteger(v.seq)||v.seq<0||!Number.isFinite(v.yaw)||!Number.isFinite(v.pitch))return null;return {seq:v.seq,yaw:v.yaw%(Math.PI*2),pitch:clamp(v.pitch,-1.45,1.45),forward:clamp(Number(v.forward)||0,-1,1),side:clamp(Number(v.side)||0,-1,1),jump:!!v.jump,crouch:!!v.crouch,aim:!!v.aim,fire:!!v.fire,fresh:!!v.fresh,reload:!!v.reload,weapon:Number.isInteger(v.weapon)?v.weapon:0};}
export function applyInput(a,i,solids){a.yaw=i.yaw;a.pitch=i.pitch;switchWeapon(a.arsenal,i.weapon);tickArsenal(a.arsenal,STEP);if(i.reload)startReload(a.arsenal);stepMovement(a,{...i,mobility:WEAPONS[a.arsenal.index].mobility,aim:i.aim&&!a.arsenal.reloading&&!a.arsenal.switching&&a.arsenal.index!==7},solids,STEP);}
const direction=(yaw,pitch)=>({x:-Math.sin(yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(yaw)*Math.cos(pitch)});
const eye=a=>({x:a.x,y:a.feet+a.eye,z:a.z});
export class Match{
 constructor(config={},random=Math.random){
   this.random=random;
   this.public=config.public===true;
   this.map=createMap(getMap(config.mapId).id);
   this.nav=createNav(this.map.solids,this.map.navBounds);
   this.configure(roomSettings(config));
   this.time=0;
   this.remaining=this.duration;
   this.phase='playing';
   this.round=1;
   this.actors=[];
   this.host=null;
   this.events=[];
   this.eventId=0;
   this.lifeSerial=0;
   this.history=[];
   this.votes=new Map();
   this.voteRemaining=0;
   this.teamScores={blue:0,red:0};
   this.fillBots(false);
 }
 configure(settings){
   this.settings=settings;
   this.duration=settings.duration;
   this.difficulty=settings.difficulty;
 }
 actor(id,name,bot=false,primary=0){const p=this.map.spawns[this.actors.length%this.map.spawns.length];return {...createPlayer(...p),id,name:cleanName(name),bot,arsenal:createArsenal(primary),queue:[],ack:-1,received:-1,inputAge:0,lastHurt:-20,streak:0,bestStreak:0,shots:0,hits:0,headshots:0,navTime:0,path:[]};}
 addBot(n,team){
   const names=['MOSS','BRICK','GLITCH','DUNE','ECHO','FLINT','NOVA','PIXEL'];
   const bot=this.actor('bot-'+n,names[n],true);
   bot.team=team;
   const override=this.settings.botSkills[n];
   const skill=override&&override!=='default'?override:this.difficulty;
   bot.skill=skill==='mixed'?BOT_SKILLS[Math.floor(this.random()*BOT_SKILLS.length)]:skill;
   this.actors.push(bot);
   return bot;
 }
 humans(){return this.actors.filter(actor=>!actor.bot);}
 fillBots(spawn=true){
   const {rules,maxPlayers,botCount,teamSetup}=this.settings;
   const humans=this.humans();
   let seats=botCount===-1?maxPlayers-humans.length:Math.min(botCount,maxPlayers-humans.length);
   const desired=new Map();
   if(rules==='ffa')desired.set(null,seats);
   else if(teamSetup==='humans-vs-bots'){
     desired.set('red',Math.min(seats,maxPlayers/2));
   }else{
     const blue=humans.filter(a=>a.team==='blue').length;
     const counts={blue,red:humans.length-blue};
     desired.set('blue',0);
     desired.set('red',0);
     while(seats-->0){
       const team=counts.blue<=counts.red?'blue':'red';
       desired.set(team,desired.get(team)+1);
       counts[team]++;
     }
   }
   this.actors=this.actors.filter(actor=>{
     if(!actor.bot)return true;
     const need=desired.get(actor.team)||0;
     if(need===0)return false;
     desired.set(actor.team,need-1);
     return true;
   });
   const used=new Set(this.actors.map(a=>a.id));
   let n=0;
   for(const [team,count] of desired){
     for(let i=0;i<count;i++){
       while(used.has('bot-'+n))n++;
       const bot=this.addBot(n++,team);
       if(spawn)this.respawn(bot);
     }
   }
 }
 join(id,name,primary=0){
   const humans=this.humans();
   let actor=humans.find(a=>a.id===id);
   if(actor){actor.queue=[];actor.inputAge=0;return actor;}
   const limit=Math.min(humanLimit(this.settings),humanLimit(this.nextSettings??this.settings));
   if(humans.length>=limit)return null;
   actor=this.actor(id,name,false,primary);
   actor.team=null;
   if(this.settings.rules==='tdm'){
     const blue=humans.filter(a=>a.team==='blue').length;
     actor.team=this.settings.teamSetup==='humans-vs-bots'||blue<=humans.length-blue?'blue':'red';
   }
   this.actors.push(actor);
   this.fillBots();
   this.respawn(actor);
   if(!this.host)this.host=id;
   return actor;
 }
 leave(id){
   const index=this.actors.findIndex(a=>a.id===id&&!a.bot);
   if(index<0)return;
   this.actors.splice(index,1);
   this.votes.delete(id);
   if(this.host===id)this.host=this.humans()[0]?.id||null;
   if(this.phase==='playing')this.fillBots();
 }
 queueSettings(id,value,round){
   if(this.public||id!==this.host||round!==this.round||!value||typeof value!=='object')return false;
   const settings=roomSettings(value);
   if(this.humans().length>humanLimit(settings))return false;
   this.nextSettings=settings;
   return true;
 }
 chooseTeam(id,team,round){
   const settings=this.nextSettings??this.settings;
   if(this.public||round!==this.round||settings.rules!=='tdm'||settings.teamSetup!=='mixed'||!['auto',...TEAMS].includes(team))return false;
   const actor=this.humans().find(a=>a.id===id);
   if(!actor)return false;
   actor.teamPreference=team;
   return true;
 }
 assignTeams(){
   const humans=this.humans();
   if(this.settings.rules==='ffa'||this.settings.teamSetup==='humans-vs-bots'){
     for(const actor of humans)actor.team=this.settings.rules==='tdm'?'blue':null;
     return;
   }
   const counts={blue:0,red:0};
   const half=this.settings.maxPlayers/2;
   const assigned=new Set();
   for(const choice of [actor=>actor.teamPreference,actor=>actor.teamPreference==='auto'?null:actor.team]){
     for(const actor of humans){
       const team=choice(actor);
       if(!TEAMS.includes(team)||counts[team]===half||assigned.has(actor))continue;
       actor.team=team;
       counts[team]++;
       assigned.add(actor);
     }
   }
   for(const actor of humans){
     if(assigned.has(actor))continue;
     actor.team=counts.blue<=counts.red?'blue':'red';
     counts[actor.team]++;
   }
 }
 inputs(id,frames){const a=this.actors.find(a=>a.id===id&&!a.bot);if(!a||this.phase!=='playing'||!Array.isArray(frames)||frames.length>16)return;for(const raw of frames){const i=validateInput(raw);if(!i||i.seq<=a.received||a.queue.length>=32)continue;a.received=i.seq;a.queue.push(i);}}
 respawn(a){const candidates=this.map.spawns.map(p=>({p,r:Math.min(...this.actors.filter(b=>b!==a&&b.dead===0).map(b=>Math.hypot(b.x-p[0],b.z-p[1])+(opponents(a,b)?0:10)),100)+spawnTeamBias(p,a.team)})).sort((a,b)=>b.r-a.r);const p=candidates[0].p;const stats={kills:a.kills,deaths:a.deaths,score:a.score};Object.assign(a,createPlayer(...p),stats);a.yaw=Math.atan2(a.x,a.z);a.arsenal=createArsenal(a.nextPrimary??a.arsenal.primary);a.nextPrimary=a.arsenal.primary;a.path=[];a.queue=[];a.lastHurt=this.time;a.life=++this.lifeSerial;a.botCool=1;a.botReact=.4;a.ack=a.received;a.recoil=a.bloom=a.ads=0;this.event({type:'spawn',id:a.id});}
 visible(a,b){const o=eye(a),d={x:b.x-o.x,y:b.feet+b.eye-o.y,z:b.z-o.z},len=Math.hypot(d.x,d.y,d.z);for(const k of ['x','y','z'])d[k]/=len||1;return trace(o,d,this.map.solids,[],null,len).distance>=len-.01;}
 event(e){this.events.push({...e,n:++this.eventId});if(this.events.length>80)this.events.shift();}
 damage(target,amount,attacker,head){
   const enemy=opponents(attacker,target);
   if(target===attacker||this.phase!=='playing'||target.dead>0||target.shield>0||(!enemy&&!this.settings.friendlyFire))return false;
   target.hp=Math.max(0,target.hp-amount);
   target.lastHurt=this.time;
   this.event({type:'hit',by:attacker.id,id:target.id,amount,head,friendly:!enemy});
   if(target.hp)return true;
   target.deaths++;
   target.dead=this.settings.respawnTime;
   target.vx=target.vz=0;
   target.streak=0;
   if(!enemy){
     this.event({type:'kill',by:attacker.id,id:target.id,friendly:true,points:0});
     return true;
   }
   attacker.kills++;
   attacker.streak++;
   attacker.bestStreak=Math.max(attacker.bestStreak,attacker.streak);
   const bonus=(head?50:0)+(attacker.slide>0?25:0)+(!attacker.grounded?25:0);
   attacker.score+=100+bonus;
   if(head)attacker.headshots++;
   this.event({type:'kill',by:attacker.id,id:target.id,head,points:100+bonus});
   const score=attacker.team?++this.teamScores[attacker.team]:attacker.kills;
   if(this.settings.scoreLimit&&score>=this.settings.scoreLimit)this.finishRound();
   return true;
 }
 rewindActors(a){if(a.bot)return this.actors;const age=clamp((a.rtt||.06)+.05,.05,.2),time=this.time-age;let frame=this.history[0];for(const past of this.history){if(past.time>time)break;frame=past;}if(!frame)return this.actors;return this.actors.map(live=>{const old=frame.actors.find(p=>p.id===live.id&&p.life===live.life);return old?{...live,...old,dead:live.dead,live}:live;});}
 shoot(a,fresh){if(a.dead>0||!fireRound(a.arsenal,fresh))return;const w=WEAPONS[a.arsenal.index],o=eye(a),d=direction(a.yaw,a.pitch+(a.recoil||0));a.shield=0;if(w.mode!=='melee')a.shots++;const targets=this.rewindActors(a).filter(target=>target.id!==a.id&&(opponents(a,target)||this.settings.friendlyFire));let connected=false;const marks=[];
 if(w.mode==='melee'){const h=meleeTrace(o,d,this.map.solids,targets,null,w.range);if(h)connected=this.damage(h.actor.live||h.actor,w.damage,a,false);}
 else for(let n=0;n<w.pellets;n++){const spread=w.hip*(1-(a.ads||0))+w.ads*(a.ads||0)+(w.mode==='auto'&&![1,2].includes(a.arsenal.index)?(a.bloom||0)*(a.arsenal.index===5?.013:.007)*(1-(a.ads||0)*.9):0),angle=w.pellets>1?n*2.399963:this.random()*Math.PI*2,radius=Math.sqrt(w.pellets>1?(n+.5)/w.pellets:this.random());const right={x:Math.cos(a.yaw),y:0,z:-Math.sin(a.yaw)},up={x:Math.sin(a.yaw)*Math.sin(a.pitch),y:Math.cos(a.pitch),z:Math.cos(a.yaw)*Math.sin(a.pitch)};let ray={};for(const k of ['x','y','z'])ray[k]=d[k]+right[k]*Math.cos(angle)*spread*radius+up[k]*Math.sin(angle)*spread*radius;const len=Math.hypot(ray.x,ray.y,ray.z);for(const k of ['x','y','z'])ray[k]/=len;const h=trace(o,ray,this.map.solids,targets,null);if(n===0||n%3===0)marks.push({x:o.x+ray.x*h.distance,y:o.y+ray.y*h.distance,z:o.z+ray.z*h.distance});if(h.actor){const amount=a.bot?(h.head?23:17):w.damage*(h.head?w.head:1)*clamp(1-(h.distance-w.fallStart)/w.fallLength,w.minDamage,1);connected=this.damage(h.actor.live||h.actor,amount,a,h.head)||connected;}}
 if(connected&&w.mode!=='melee')a.hits++;a.recoil=Math.min(.1,(a.recoil||0)+w.kick*(a.ads>.5?.65:1));a.bloom=Math.min(1,(a.bloom||0)+.2);this.event({type:'shot',by:a.id,weapon:a.arsenal.index,from:o,to:marks});}
 botInput(a){if(a.skill==='practice')return {yaw:a.yaw,pitch:0,weapon:a.arsenal.primary};a.navTime-=STEP;const targets=this.actors.filter(b=>opponents(a,b)&&b.dead===0).sort((b,c)=>Math.hypot(b.x-a.x,b.z-a.z)-Math.hypot(c.x-a.x,c.z-a.z)),target=targets[0];if(!target)return null;const dx=target.x-a.x,dz=target.z-a.z,dist=Math.hypot(dx,dz),sees=dist<this.map.sight&&this.visible(a,target);let goal=target;if(!sees){if(a.navTime<=0){a.path=this.nav.path(a,target);a.navTime=.7;}while(a.path.length&&Math.hypot(a.path[0].x-a.x,a.path[0].z-a.z)<.7)a.path.shift();goal=a.path[0]||target;}const yaw=Math.atan2(a.x-goal.x,a.z-goal.z),aimYaw=Math.atan2(-dx,-dz),error=a.skill==='hard'?.012:a.skill==='easy'?.09:.04;
 // Bots move with the same collision rules and keep their existing slower pace.
 a.botReact=sees?Math.max(0,(a.botReact||0)-STEP):(a.skill==='hard'?.2:.45);let forward=sees?(dist>12?1:dist<5?-.6:0):1,side=sees?Math.sin(this.time+a.id.length)>.0?.45:-.45:0;return {seq:0,yaw:sees?aimYaw+Math.sin(this.time*9+a.id.length)*error:yaw,pitch:Math.atan2(target.feet+target.eye-.25-(a.feet+a.eye),dist||1),forward,side,jump:false,crouch:false,aim:true,fire:sees&&a.botReact===0&&target.shield===0,fresh:true,weapon:a.arsenal.primary,reload:a.arsenal.mags[a.arsenal.index]===0};}
 step(){if(this.phase==='results'){this.voteRemaining=Math.max(0,this.voteRemaining-STEP);if(!this.voteRemaining)this.beginRound(this.chooseNextMap());return;}if(this.phase!=='playing')return;this.time+=STEP;this.remaining=Math.max(0,this.remaining-STEP);if(!this.remaining){this.finishRound();return;}for(const a of this.actors){a.shield=Math.max(0,a.shield-STEP);if(a.dead>0){if(!a.bot){const i=a.queue.shift();if(i)a.ack=i.seq;}a.dead=Math.max(0,a.dead-STEP);if(!a.dead)this.respawn(a);continue;}let input=a.bot?this.botInput(a):a.queue.shift();if(!input){a.inputAge+=STEP;input={seq:a.ack,yaw:a.yaw,pitch:a.pitch,weapon:a.arsenal.index};}else{a.inputAge=0;if(!a.bot)a.ack=input.seq;}a.lastInput=input;a.recoil=damp(a.recoil||0,0,12,STEP);a.bloom=damp(a.bloom||0,0,6,STEP);a.ads=damp(a.ads||0,input.aim?1:0,a.arsenal.index===1?15:22,STEP);applyInput(a,input,this.map.solids);if(a.bot){const speed=Math.hypot(a.vx,a.vz),cap=this.map.botSpeed*(a.skill==='hard'?1.4:1);if(speed>cap){a.vx*=cap/speed;a.vz*=cap/speed;}}a.botCool=Math.max(0,(a.botCool||0)-STEP);if((input.fire||a.arsenal.burstRemaining>0)&&(!a.bot||!a.botCool)){this.shoot(a,!!input.fresh);if(a.bot)a.botCool=a.skill==='hard'?.2:a.skill==='easy'?.5:.31;if(this.phase==='results')return;}if(a.arsenal.mags[a.arsenal.index]===0&&a.arsenal.cooldown===0)startReload(a.arsenal);if(a.hp<100&&this.time-a.lastHurt>4)a.hp=Math.min(100,a.hp+22*STEP);}this.history.push({time:this.time,actors:this.actors.map(a=>({id:a.id,life:a.life,x:a.x,z:a.z,feet:a.feet,crouch:a.crouch}))});while(this.history.length>30)this.history.shift();}
 setLoadout(id,primary,respawnNow=false){const a=this.actors.find(a=>a.id===id&&!a.bot);if(!a||!Number.isInteger(primary)||primary<0||primary>=6)return false;a.nextPrimary=primary;if(respawnNow&&this.phase==='playing'&&a.dead===0){a.deaths++;a.streak=0;this.respawn(a);}return true;}
 vote(id,mapId,round=this.round){if(this.phase!=='results'||round!==this.round||!MAPS.some(m=>m.id===mapId)||!this.actors.some(a=>a.id===id&&!a.bot))return false;this.votes.set(id,mapId);return true;}
 voteCounts(){return Object.fromEntries(MAPS.map(m=>[m.id,[...this.votes.values()].filter(v=>v===m.id).length]));}
 chooseNextMap(){return nextArena(this.map.id,this.voteCounts(),this.random);}
 finishRound(){
   this.phase='results';
   this.voteRemaining=VOTE_SECONDS;
   this.votes.clear();
   this.event({type:'results'});
 }
 beginRound(mapId){
   if(this.nextSettings){
     this.configure(this.nextSettings);
     this.nextSettings=null;
   }
   this.map=createMap(mapId);
   this.nav=createNav(this.map.solids,this.map.navBounds);
   this.remaining=this.duration;
   this.phase='playing';
   this.round++;
   this.history=[];
   this.votes.clear();
   this.voteRemaining=0;
   this.teamScores={blue:0,red:0};
   this.actors=this.humans();
   this.assignTeams();
   this.fillBots(false);
   for(const a of this.actors){
     a.kills=a.deaths=a.score=a.streak=a.bestStreak=a.shots=a.hits=a.headshots=0;
     this.respawn(a);
   }
 }
 restart(id){if(id!==this.host||this.phase!=='results'||this.voteRemaining>0)return false;this.beginRound(this.chooseNextMap());return true;}
 snapshot(){return {phase:this.phase,round:this.round,mapId:this.map.id,remaining:this.remaining,rules:this.settings.rules,scoreLimit:this.settings.scoreLimit,teamScores:this.teamScores,settings:this.public?undefined:this.settings,nextSettings:this.nextSettings,host:this.host,voteRemaining:this.voteRemaining,voteCounts:this.voteCounts(),votes:Object.fromEntries(this.votes),actors:this.actors.map(a=>({id:a.id,name:a.name,bot:a.bot,team:a.team,teamPreference:a.teamPreference,skill:a.skill,ack:a.ack,...Object.fromEntries(poseKeys.map(k=>[k,a[k]])),primary:a.arsenal.primary,pendingPrimary:a.nextPrimary??a.arsenal.primary,life:a.life||0,streak:a.streak,bestStreak:a.bestStreak,shots:a.shots,hits:a.hits,headshots:a.headshots})),eventId:this.eventId};}
}
