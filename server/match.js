import {ArenaObjectives} from './objectives.js';
import {MAPS,createMap,getMap} from '../dist/maps.js';
import {STEP,WEAPONS,createPlayer,createArsenal,stepMovement,createNav,trace,meleeTrace,clamp,damp,switchWeapon,tickArsenal,startReload,fireRound} from '../dist/core.js';
import {VOTE_SECONDS,nextArena} from '../dist/rounds.js';
import {BOT_SKILLS,GUN_ORDER,MAX_PLAYERS,STORM_LIVES,TEAMS,humanLimit,isObjective,isTeamGame,opponents,roomSettings,spawnTeamBias,stormRadius,teamWinner} from '../dist/rules.js';
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
   this.ranked=config.ranked===true;
   this.rankedTeams=new Map((config.seats||[]).map(seat=>[seat.handle,seat.team]));
   this.map=createMap(getMap(config.mapId).id);
   this.nav=createNav(this.map.solids,this.map.navBounds);
   this.configure(roomSettings(this.ranked?{rules:'tdm',botCount:0}:config));
   this.time=0;
   const waiting=!this.public&&config.intermission===true;
   this.remaining=waiting?0:this.duration;
   this.phase=this.ranked?'staging':waiting?'results':'playing';
   this.round=Number.isSafeInteger(config.round)&&config.round>0?config.round:1;
   this.nextSettings=waiting&&config.nextSettings?roomSettings(config.nextSettings):null;
   this.actors=[];
   this.host=null;
   this.events=[];
   this.eventId=0;
   this.lifeSerial=0;
   this.history=[];
   this.votes=new Map();
   this.voteRemaining=0;
   this.teamScores={blue:0,red:0};
   this.roundWinner=null;
   this.stormReady=false;
   this.objectives=isObjective(this.settings.rules)?new ArenaObjectives(this):null;
   if(!waiting)this.fillBots(false);
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
   this.prepareModeActor(bot);
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
   if(!isTeamGame(rules))desired.set(null,seats);
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
     if(need===0){
       this.objectives?.release(actor);
       return false;
     }
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
 join(id,name,primary=0,account=null){
   const humans=this.humans();
   let actor=humans.find(a=>a.id===id);
   if(actor){
     actor.queue=[];
     actor.inputAge=0;
     if(this.ranked&&actor.inactive){
       actor.inactive=actor.abandoned=false;
       this.respawn(actor);
     }
     return actor;
   }
   if(this.ranked&&(!this.rankedTeams.has(account)||this.phase!=='staging'))return null;
   const nextLimit=humanLimit(this.nextSettings??this.settings);
   const limit=this.phase==='results'?nextLimit:Math.min(humanLimit(this.settings),nextLimit);
   if(humans.length>=limit)return null;
   actor=this.actor(id,name,false,primary);
   actor.account=account;
   actor.joinedAt=this.time;
   actor.roundStartInput=actor.received;
   actor.team=null;
   this.prepareModeActor(actor);
   const lateStorm=this.settings.rules==='storm'&&this.phase==='playing'&&this.duration-this.remaining>=15;
   if(lateStorm){
     actor.waitingForRound=true;
     actor.inactive=true;
     actor.dead=999;
     actor.lives=0;
   }
   if(isTeamGame(this.settings.rules)){
     const blue=humans.filter(a=>a.team==='blue').length;
     actor.team=this.settings.teamSetup==='humans-vs-bots'||blue<=humans.length-blue?'blue':'red';
   }
   if(this.ranked)actor.team=this.rankedTeams.get(account);
   this.actors.push(actor);
   if(!lateStorm&&(this.public||this.phase==='playing')){
     this.fillBots();
     this.respawn(actor);
   }
   if(!this.ranked&&!this.host)this.host=id;
   return actor;
 }
 leave(id){
   const index=this.actors.findIndex(a=>a.id===id&&!a.bot);
   if(index<0)return;
   if(this.ranked&&this.phase!=='staging'){
     this.actors[index].abandoned=true;
     this.disconnect(id);
     return;
   }
   this.objectives?.release(this.actors[index]);
   this.actors.splice(index,1);
   this.votes.delete(id);
   if(this.host===id)this.host=this.humans()[0]?.id||null;
   if(this.phase==='playing'&&(this.settings.rules!=='storm'||this.duration-this.remaining<15))this.fillBots();
 }
 disconnect(id){
   const actor=this.actors.find(a=>a.id===id);
   if(!actor)return;
   actor.queue=[];
   this.objectives?.release(actor);
   if(this.ranked&&this.phase==='playing'){
     actor.inactive=true;
     actor.dead=999;
   }
 }
 startRanked(){
   if(!this.ranked||this.phase!=='staging'||this.humans().length!==this.rankedTeams.size)return false;
   this.phase='playing';
   for(const actor of this.actors)this.respawn(actor);
   return true;
 }
 queueSettings(id,value,round){
   if(this.ranked||this.public||id!==this.host||round!==this.round||!value||typeof value!=='object')return false;
   const settings=roomSettings(value);
   if(this.humans().length>humanLimit(settings))return false;
   this.nextSettings=settings;
   return true;
 }
 chooseTeam(id,team,round){
   const settings=this.nextSettings??this.settings;
   if(this.ranked||this.public||round!==this.round||!isTeamGame(settings.rules)||settings.teamSetup!=='mixed'||!['auto',...TEAMS].includes(team))return false;
   const actor=this.humans().find(a=>a.id===id);
   if(!actor)return false;
   actor.teamPreference=team;
   return true;
 }
 assignTeams(){
   const humans=this.humans();
   if(!isTeamGame(this.settings.rules)||this.settings.teamSetup==='humans-vs-bots'){
     for(const actor of humans)actor.team=isTeamGame(this.settings.rules)?'blue':null;
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
 prepareModeActor(actor){
   actor.objectiveScore=this.objectives?0:undefined;
   actor.objectivePath=null;
   actor.stage=this.settings.rules==='gun'?0:undefined;
   actor.lives=this.settings.rules==='storm'?STORM_LIVES:undefined;
   actor.inactive=actor.waitingForRound=false;
   if(actor.stage!==undefined)this.equipStage(actor);
 }
 equipStage(actor){
   const weapon=GUN_ORDER[Math.min(actor.stage,GUN_ORDER.length-1)];
   actor.arsenal=createArsenal();
   actor.arsenal.index=weapon;
   actor.arsenal.slots=[weapon];
   actor.arsenal.switching=.22;
 }
 stormTick(){
   const radius=stormRadius(this.map,this.duration-this.remaining,this.duration);
   for(const actor of this.actors){
     if(actor.inactive||actor.dead>0||Math.hypot(actor.x,actor.z)<=radius)continue;
     actor.hp=Math.max(0,actor.hp-18*STEP);
     actor.lastHurt=this.time;
     if(actor.hp===0){
       this.eliminate(actor);
       this.event({type:'stormDeath',id:actor.id});
     }
   }
   const alive=this.actors.filter(actor=>!actor.inactive);
   if(alive.length>=2)this.stormReady=true;
   if(this.stormReady&&alive.length<=1&&this.duration-this.remaining>=15){
     this.roundWinner=alive[0]?.id??null;
     this.finishRound();
   }
 }
 eliminate(target){
   this.objectives?.release(target);
   target.deaths++;
   target.dead=this.settings.respawnTime;
   target.vx=target.vz=0;
   target.streak=0;
   if(target.lives!==undefined&&--target.lives===0){
     target.inactive=true;
     target.dead=999;
   }
 }
 inputs(id,frames){const a=this.actors.find(a=>a.id===id&&!a.bot);if(!a||this.phase!=='playing'||!Array.isArray(frames)||frames.length>16)return;for(const raw of frames){const i=validateInput(raw);if(!i||i.seq<=a.received||a.queue.length>=32)continue;a.received=i.seq;a.queue.push(i);}}
 spawnPoints(actor){
   if(this.settings.rules==='storm')return this.stormSpawns();
   if(this.settings.rules==='ctf'&&actor.team){
     const side=actor.team==='blue'?1:-1;
     const home=this.map.spawns.filter(p=>p[1]*side>0);
     if(home.length)return home;
   }
   return this.map.spawns;
 }
 respawn(a){this.objectives?.release(a);const candidates=this.spawnPoints(a).map(p=>({p,r:Math.min(...this.actors.filter(b=>b!==a&&b.dead===0).map(b=>Math.hypot(b.x-p[0],b.z-p[1])+(opponents(a,b)?0:10)),100)+spawnTeamBias(p,a.team)})).sort((a,b)=>b.r-a.r);const p=candidates[0].p;const stats={kills:a.kills,deaths:a.deaths,score:a.score};Object.assign(a,createPlayer(...p),stats);a.yaw=Math.atan2(a.x,a.z);a.arsenal=createArsenal(a.nextPrimary??a.arsenal.primary);a.nextPrimary=a.arsenal.primary;if(a.stage!==undefined)this.equipStage(a);a.path=[];a.queue=[];a.lastHurt=this.time;a.life=++this.lifeSerial;a.botCool=1;a.botReact=.4;a.ack=a.received;a.recoil=a.bloom=a.ads=0;this.event({type:'spawn',id:a.id});}
 stormSpawns(){
   const radius=stormRadius(this.map,this.duration-this.remaining,this.duration);
   const safe=this.map.spawns.filter(p=>Math.hypot(...p)<=radius);
   return safe.length?safe:[...this.map.spawns].sort((a,b)=>Math.hypot(...a)-Math.hypot(...b)).slice(0,3);
 }
 visible(a,b){const o=eye(a),d={x:b.x-o.x,y:b.feet+b.eye-o.y,z:b.z-o.z},len=Math.hypot(d.x,d.y,d.z);for(const k of ['x','y','z'])d[k]/=len||1;return trace(o,d,this.map.solids,[],null,len).distance>=len-.01;}
 event(e){this.events.push({...e,n:++this.eventId});if(this.events.length>80)this.events.shift();}
 damage(target,amount,attacker,head){
   const enemy=opponents(attacker,target);
   if(target===attacker||this.phase!=='playing'||target.dead>0||target.shield>0||(!enemy&&!this.settings.friendlyFire))return false;
   target.hp=Math.max(0,target.hp-amount);
   target.lastHurt=this.time;
   this.event({type:'hit',by:attacker.id,id:target.id,amount,head,friendly:!enemy});
   if(target.hp)return true;
   this.eliminate(target);
   if(!enemy){
     this.event({type:'kill',by:attacker.id,id:target.id,friendly:true,points:0});
     return true;
   }
   attacker.kills++;
   if(!target.bot)attacker.humanKills=(attacker.humanKills||0)+1;
   attacker.streak++;
   attacker.bestStreak=Math.max(attacker.bestStreak,attacker.streak);
   const bonus=(head?50:0)+(attacker.slide>0?25:0)+(!attacker.grounded?25:0);
   attacker.score+=100+bonus;
   if(head)attacker.headshots++;
   this.event({type:'kill',by:attacker.id,id:target.id,head,points:100+bonus});
   if(attacker.stage!==undefined){
     attacker.stage++;
     if(attacker.stage===GUN_ORDER.length){
       this.roundWinner=attacker.id;
       this.finishRound();
     }
   }
   if(this.objectives)this.objectives.dropTag(target);
   else if(attacker.team)this.addTeamScore(attacker.team,1);
   else if(this.settings.scoreLimit&&attacker.kills>=this.settings.scoreLimit)this.finishRound();
   return true;
 }
 addTeamScore(team,points){
   this.teamScores[team]+=points;
   this.checkTeamLimit();
 }
 checkTeamLimit(){
   const winner=teamWinner(this.teamScores);
   if(winner&&this.settings.scoreLimit&&this.teamScores[winner]>=this.settings.scoreLimit)this.finishRound();
 }
 rewindActors(a){if(a.bot)return this.actors;const age=clamp((a.rtt||.06)+.05,.05,.2),time=this.time-age;let frame=this.history[0];for(const past of this.history){if(past.time>time)break;frame=past;}if(!frame)return this.actors;return this.actors.map(live=>{const old=frame.actors.find(p=>p.id===live.id&&p.life===live.life);return old?{...live,...old,dead:live.dead,live}:live;});}
 shoot(a,fresh){if(a.dead>0||!fireRound(a.arsenal,fresh))return;const w=WEAPONS[a.arsenal.index],o=eye(a),d=direction(a.yaw,a.pitch+(a.recoil||0));const stage=a.stage;a.shield=0;if(w.mode!=='melee')a.shots++;const targets=this.rewindActors(a).filter(target=>target.id!==a.id&&(opponents(a,target)||this.settings.friendlyFire));let connected=false;const marks=[];
 if(w.mode==='melee'){const h=meleeTrace(o,d,this.map.solids,targets,null,w.range);if(h)connected=this.damage(h.actor.live||h.actor,w.damage,a,false);}
 else for(let n=0;n<w.pellets;n++){const spread=w.hip*(1-(a.ads||0))+w.ads*(a.ads||0)+(w.mode==='auto'&&![1,2].includes(a.arsenal.index)?(a.bloom||0)*(a.arsenal.index===5?.013:.007)*(1-(a.ads||0)*.9):0),angle=w.pellets>1?n*2.399963:this.random()*Math.PI*2,radius=Math.sqrt(w.pellets>1?(n+.5)/w.pellets:this.random());const right={x:Math.cos(a.yaw),y:0,z:-Math.sin(a.yaw)},up={x:Math.sin(a.yaw)*Math.sin(a.pitch),y:Math.cos(a.pitch),z:Math.cos(a.yaw)*Math.sin(a.pitch)};let ray={};for(const k of ['x','y','z'])ray[k]=d[k]+right[k]*Math.cos(angle)*spread*radius+up[k]*Math.sin(angle)*spread*radius;const len=Math.hypot(ray.x,ray.y,ray.z);for(const k of ['x','y','z'])ray[k]/=len;const h=trace(o,ray,this.map.solids,targets,null);if(n===0||n%3===0)marks.push({x:o.x+ray.x*h.distance,y:o.y+ray.y*h.distance,z:o.z+ray.z*h.distance});if(h.actor){const amount=a.bot?(h.head?23:17):w.damage*(h.head?w.head:1)*clamp(1-(h.distance-w.fallStart)/w.fallLength,w.minDamage,1);connected=this.damage(h.actor.live||h.actor,amount,a,h.head)||connected;}}
 if(connected&&w.mode!=='melee')a.hits++;a.recoil=Math.min(.1,(a.recoil||0)+w.kick*(a.ads>.5?.65:1));a.bloom=Math.min(1,(a.bloom||0)+.2);this.event({type:'shot',by:a.id,weapon:a.arsenal.index,from:o,to:marks});if(a.stage!==stage&&this.phase==='playing')this.equipStage(a);}
 botInput(a){if(a.skill==='practice')return {yaw:a.yaw,pitch:0,weapon:a.arsenal.index};a.navTime-=STEP;
 if(this.settings.rules==='storm'&&Math.hypot(a.x,a.z)>stormRadius(this.map,this.duration-this.remaining,this.duration)-2){
   const center={x:0,z:0};
   if(!a.stormPath||a.navTime<=0){
     a.path=this.nav.path(a,center);
     a.navTime=.65;
   }
   a.stormPath=true;
   while(a.path.length&&Math.hypot(a.path[0].x-a.x,a.path[0].z-a.z)<.7)a.path.shift();
   const goal=a.path[0]||center;
   return {yaw:Math.atan2(a.x-goal.x,a.z-goal.z),pitch:0,forward:1,weapon:a.arsenal.index};
 }
 if(a.stormPath){a.stormPath=false;a.navTime=0;}
 const objective=this.objectives?.botGoal(a);
 const target=this.actors.filter(b=>opponents(a,b)&&b.dead===0)
   .sort((b,c)=>Math.hypot(b.x-a.x,b.z-a.z)-Math.hypot(c.x-a.x,c.z-a.z))[0];
 if(!target&&!objective)return null;
 const dx=(target?.x??a.x)-a.x,dz=(target?.z??a.z)-a.z,dist=Math.hypot(dx,dz);
 const sees=target&&dist<this.map.sight&&this.visible(a,target);
 let goal=objective??target;
 if(objective||!sees){
   const pathKey=objective?.id??null;
   if(a.navTime<=0||a.objectivePath!==pathKey){
     a.path=this.nav.path(a,goal);
     a.navTime=.7;
     a.objectivePath=pathKey;
   }
   while(a.path.length&&Math.hypot(a.path[0].x-a.x,a.path[0].z-a.z)<.7)a.path.shift();
   goal=a.path[0]||goal;
 }
 const moveYaw=Math.atan2(a.x-goal.x,a.z-goal.z),aimYaw=Math.atan2(-dx,-dz);
 const error=a.skill==='hard'?.012:a.skill==='easy'?.09:.04;
 const yaw=sees?aimYaw+Math.sin(this.time*9+a.id.length)*error:moveYaw;
 a.botReact=sees?Math.max(0,(a.botReact||0)-STEP):(a.skill==='hard'?.2:.45);
 const melee=a.arsenal.index===GUN_ORDER.at(-1);
 let forward=melee?1:sees?(dist>12?1:dist<5?-.6:0):1;
 let side=sees?(Math.sin(this.time+a.id.length)>0?.45:-.45):0;
 if(objective){
   const moving=Math.hypot(objective.x-a.x,objective.z-a.z)>(objective.radius ? .55*objective.radius : .7);
   forward=moving?Math.cos(yaw-moveYaw):0;
   side=moving?Math.sin(yaw-moveYaw):0;
 }
 return {seq:0,yaw,pitch:target?Math.atan2(target.feet+target.eye-.25-(a.feet+a.eye),dist||1):0,
   forward,side,jump:false,crouch:false,aim:Boolean(sees),fire:Boolean(sees&&(!melee||dist<1.8)&&a.botReact===0&&target.shield===0),
   fresh:true,weapon:a.arsenal.index,reload:a.arsenal.mags[a.arsenal.index]===0};
 }
 step(){if(this.phase==='results'){if(!this.public)return;this.voteRemaining=Math.max(0,this.voteRemaining-STEP);if(!this.voteRemaining)this.beginRound(this.chooseNextMap());return;}if(this.phase!=='playing')return;this.time+=STEP;this.remaining=Math.max(0,this.remaining-STEP);if(!this.remaining){
   if(this.settings.rules==='storm'){
     const [first,second]=this.actors.filter(a=>!a.inactive).sort((a,b)=>b.lives-a.lives||b.kills-a.kills);
     if(first&&(!second||first.lives!==second.lives||first.kills!==second.kills))this.roundWinner=first.id;
   }
   if(this.settings.rules==='gun'){
     const [first,second]=[...this.actors].sort((a,b)=>b.stage-a.stage);
     if(first&&(!second||first.stage!==second.stage))this.roundWinner=first.id;
   }
   this.finishRound();
   return;
 }if(this.settings.rules==='storm'){
   this.stormTick();
   if(this.phase==='results')return;
 }for(const a of this.actors){if(a.inactive)continue;a.shield=Math.max(0,a.shield-STEP);if(a.dead>0){if(!a.bot){const i=a.queue.shift();if(i)a.ack=i.seq;}a.dead=Math.max(0,a.dead-STEP);if(!a.dead)this.respawn(a);continue;}let input=a.bot?this.botInput(a):a.queue.shift();if(!input){a.inputAge+=STEP;input={seq:a.ack,yaw:a.yaw,pitch:a.pitch,weapon:a.arsenal.index};}else{a.inputAge=0;if(!a.bot)a.ack=input.seq;}a.lastInput=input;a.recoil=damp(a.recoil||0,0,12,STEP);a.bloom=damp(a.bloom||0,0,6,STEP);a.ads=damp(a.ads||0,input.aim?1:0,a.arsenal.index===1?15:22,STEP);applyInput(a,input,this.map.solids);if(a.bot){const speed=Math.hypot(a.vx,a.vz),cap=this.map.botSpeed*(a.skill==='hard'?1.4:1);if(speed>cap){a.vx*=cap/speed;a.vz*=cap/speed;}}a.botCool=Math.max(0,(a.botCool||0)-STEP);if((input.fire||a.arsenal.burstRemaining>0)&&(!a.bot||!a.botCool)){this.shoot(a,!!input.fresh);if(a.bot)a.botCool=a.skill==='hard'?.2:a.skill==='easy'?.5:.31;if(this.phase==='results')return;}if(a.arsenal.mags[a.arsenal.index]===0&&a.arsenal.cooldown===0)startReload(a.arsenal);if(a.hp<100&&this.time-a.lastHurt>4)a.hp=Math.min(100,a.hp+22*STEP);}
 this.objectives?.step();
 this.history.push({time:this.time,actors:this.actors.map(a=>({id:a.id,life:a.life,x:a.x,z:a.z,feet:a.feet,crouch:a.crouch}))});while(this.history.length>30)this.history.shift();}
 setLoadout(id,primary,respawnNow=false){const a=this.actors.find(a=>a.id===id&&!a.bot);if(!a||a.stage!==undefined||a.inactive||!Number.isInteger(primary)||primary<0||primary>=6)return false;a.nextPrimary=primary;if(respawnNow&&this.phase==='playing'&&a.dead===0){a.deaths++;a.streak=0;this.respawn(a);}return true;}
 vote(id,mapId,round=this.round){if(this.ranked||this.phase!=='results'||round!==this.round||!MAPS.some(m=>m.id===mapId)||!this.actors.some(a=>a.id===id&&!a.bot))return false;this.votes.set(id,mapId);return true;}
 voteCounts(){return Object.fromEntries(MAPS.map(m=>[m.id,[...this.votes.values()].filter(v=>v===m.id).length]));}
 chooseNextMap(){return nextArena(this.map.id,this.voteCounts(),this.random);}
 finishRound(){
   this.phase='results';
   this.voteRemaining=this.public?VOTE_SECONDS:0;
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
   this.roundWinner=null;
   this.stormReady=false;
   this.objectives=isObjective(this.settings.rules)?new ArenaObjectives(this):null;
   this.actors=this.humans();
   this.assignTeams();
   this.fillBots(false);
   for(const a of this.actors){
     a.kills=a.deaths=a.score=a.streak=a.bestStreak=a.shots=a.hits=a.headshots=a.humanKills=0;
     this.prepareModeActor(a);
     a.joinedAt=this.time;
     a.roundStartInput=a.received;
     this.respawn(a);
   }
 }
 restart(id,round,settings){
   if(this.public||!this.host||id!==this.host||this.phase!=='results'||round!==this.round)return false;
   if(settings!==undefined&&!this.queueSettings(id,settings,round))return false;
   this.beginRound(this.chooseNextMap());
   return true;
 }
 snapshot(){return {phase:this.phase,round:this.round,mapId:this.map.id,remaining:this.remaining,roundWinner:this.roundWinner,zoneRadius:this.settings.rules==='storm'?stormRadius(this.map,this.duration-this.remaining,this.duration):undefined,rules:this.settings.rules,scoreLimit:this.settings.scoreLimit,teamScores:this.teamScores,objective:this.objectives?.snapshot(),settings:this.public||this.ranked?undefined:this.settings,nextSettings:this.nextSettings,host:this.host,voteRemaining:this.voteRemaining,voteCounts:this.voteCounts(),votes:Object.fromEntries(this.votes),actors:this.actors.map(a=>({id:a.id,name:a.name,bot:a.bot,objectiveScore:a.objectiveScore,lives:a.lives,stage:a.stage,inactive:a.inactive,waitingForRound:a.waitingForRound,team:a.team,teamPreference:a.teamPreference,skill:a.skill,ack:a.ack,...Object.fromEntries(poseKeys.map(k=>[k,a[k]])),primary:a.arsenal.primary,pendingPrimary:a.nextPrimary??a.arsenal.primary,life:a.life||0,streak:a.streak,bestStreak:a.bestStreak,shots:a.shots,hits:a.hits,headshots:a.headshots})),eventId:this.eventId};}
}
