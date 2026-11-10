import {STEP,trace} from '../dist/core.js';
import {TEAMS} from '../dist/rules.js';

const SITES = {
  switchyard:{zones:[[-10,0],[5,-2],[11,11]],bases:[[0,14],[0,-14]]},
  'dust-court':{zones:[[-14,0],[0,5],[13,0]],bases:[[0,17],[0,-17]]},
  'pine-ridge':{zones:[[-20,0],[0,-9],[20,0]],bases:[[0,34],[0,-34]]}
};
const HILL_SECONDS=30, CAPTURE_SECONDS=2, CONTROL_TICK=2, RETURN_SECONDS=15, TAG_SECONDS=15;
const HILL_ORDER=[1,0,2];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const alive=actor=>!actor.inactive&&actor.dead===0;
const point=([x,z])=>({x,y:0,z});

export class ArenaObjectives {
  constructor(match) {
    this.match=match;
    this.rules=match.settings.rules;
    const sites=SITES[match.map.id];
    this.zones=(this.rules==='hardpoint'||this.rules==='domination'?sites.zones:[]).map((position,i)=>({
      id:'zone-'+i,label:'ABC'[i],...point(position),radius:3.25,owner:null,
      controlling:null,contested:false,progress:0
    }));
    this.flags=(this.rules==='ctf'?sites.bases:[]).map((position,i)=>{
      const home=point(position), team=TEAMS[i];
      return {id:'flag-'+team,team,home,...home,carrier:null,returnAt:0};
    });
    this.tags=[];
    this.nextTag=0;
    this.hill=0;
    this.nextHill=match.time+HILL_SECONDS;
    this.tickProgress=0;
    this.holdTeam=null;
  }

  touches(actor,target,radius){
    if(!alive(actor)||distance(actor,target)>radius||Math.abs(actor.feet-target.y)>1.4)return false;
    const origin={x:actor.x,y:actor.feet+.25,z:actor.z};
    const vector={x:target.x-origin.x,y:target.y+.25-origin.y,z:target.z-origin.z};
    const length=Math.hypot(vector.x,vector.y,vector.z);
    if(length<.05)return true;
    for(const axis of ['x','y','z'])vector[axis]/=length;
    return trace(origin,vector,this.match.map.solids,[],null,length).distance>=length-.04;
  }

  occupants(zone){
    return this.match.actors.filter(actor=>actor.team&&alive(actor)&&actor.feet<1.5&&distance(actor,zone)<=zone.radius);
  }

  presence(zone){
    const players=this.occupants(zone);
    const team=players[0]?.team??null;
    zone.contested=players.some(player=>player.team!==team);
    zone.controlling=zone.contested?null:team;
    return players;
  }

  credit(actor,action,team){
    actor.objectiveScore=(actor.objectiveScore||0)+1;
    this.match.event({type:'objective',action,id:actor.id,team});
  }

  hardpoint(){
    const now=this.match.time;
    if(now>=this.nextHill){
      this.hill=(this.hill+1)%HILL_ORDER.length;
      this.nextHill+=HILL_SECONDS;
      this.holdTeam=null;
      this.tickProgress=0;
    }
    const zone=this.zones[HILL_ORDER[this.hill]];
    const players=this.presence(zone);
    if(zone.controlling!==this.holdTeam){
      this.holdTeam=zone.controlling;
      this.tickProgress=0;
    }
    if(!this.holdTeam)return;
    this.tickProgress+=STEP;
    if(this.tickProgress+1e-8<1)return;
    this.tickProgress-=1;
    for(const actor of players)actor.objectiveScore=(actor.objectiveScore||0)+1;
    this.match.addTeamScore(this.holdTeam,1);
  }

  domination(){
    for(const zone of this.zones){
      const before=zone.controlling;
      const players=this.presence(zone);
      if(!zone.controlling||zone.controlling===zone.owner||before!==zone.controlling)zone.progress=0;
      if(!zone.controlling||zone.controlling===zone.owner)continue;
      zone.progress=Math.min(1,zone.progress+STEP/CAPTURE_SECONDS);
      if(zone.progress+1e-8<1)continue;
      zone.owner=zone.controlling;
      zone.progress=0;
      for(const actor of players)this.credit(actor,'captureZone',zone.owner);
    }
    this.tickProgress+=STEP;
    if(this.tickProgress+1e-8<CONTROL_TICK)return;
    this.tickProgress-=CONTROL_TICK;
    // Apply both sides' points before checking the limit so simultaneous ticks are fair.
    for(const zone of this.zones)if(zone.owner)this.match.teamScores[zone.owner]++;
    this.match.checkTeamLimit();
  }

  atHome(flag){return !flag.carrier&&!flag.returnAt;}

  returnFlag(flag){
    Object.assign(flag,flag.home,{carrier:null,returnAt:0});
  }

  release(actor){
    for(const flag of this.flags){
      if(flag.carrier!==actor.id)continue;
      Object.assign(flag,{x:actor.x,y:actor.feet,z:actor.z,carrier:null,returnAt:this.match.time+RETURN_SECONDS});
      this.match.event({type:'objective',action:'dropFlag',id:actor.id,team:flag.team});
    }
  }

  ctf(){
    for(const flag of this.flags){
      if(flag.carrier){
        const carrier=this.match.actors.find(actor=>actor.id===flag.carrier);
        if(carrier&&alive(carrier)){
          Object.assign(flag,{x:carrier.x,y:carrier.feet,z:carrier.z});
          continue;
        }
        if(carrier)this.release(carrier);
        else Object.assign(flag,{carrier:null,returnAt:this.match.time+RETURN_SECONDS});
      }
      if(flag.returnAt&&this.match.time>=flag.returnAt)this.returnFlag(flag);
      const touching=this.match.actors.filter(actor=>actor.team&&this.touches(actor,flag,1.55));
      const defender=flag.returnAt&&touching.find(actor=>actor.team===flag.team);
      if(defender){
        this.returnFlag(flag);
        this.credit(defender,'returnFlag',flag.team);
        continue;
      }
      const thief=touching.find(actor=>actor.team!==flag.team);
      if(thief){
        flag.carrier=thief.id;
        flag.returnAt=0;
        thief.shield=0;
        this.match.event({type:'objective',action:'takeFlag',id:thief.id,team:flag.team});
      }
    }
    for(const flag of this.flags){
      if(!flag.carrier)continue;
      const actor=this.match.actors.find(candidate=>candidate.id===flag.carrier);
      const base=this.flags.find(candidate=>candidate.team===actor?.team);
      if(!base||!this.atHome(base)||!this.touches(actor,base.home,1.75))continue;
      this.returnFlag(flag);
      this.credit(actor,'captureFlag',actor.team);
      this.match.addTeamScore(actor.team,1);
      if(this.match.phase!=='playing')return;
    }
  }

  dropTag(actor){
    if(this.rules!=='confirmed')return;
    this.tags.push({id:'tag-'+(++this.nextTag),team:actor.team,x:actor.x,y:actor.feet,z:actor.z,expires:this.match.time+TAG_SECONDS});
    if(this.tags.length>24)this.tags.shift();
  }

  confirmed(){
    for(let i=this.tags.length-1;i>=0;i--){
      const tag=this.tags[i];
      if(tag.expires<=this.match.time){this.tags.splice(i,1);continue;}
      const picker=this.match.actors.filter(actor=>actor.team&&this.touches(actor,tag,1.45))
        .sort((a,b)=>distance(a,tag)-distance(b,tag))[0];
      if(!picker)continue;
      this.tags.splice(i,1);
      const enemy=picker.team!==tag.team;
      this.credit(picker,enemy?'confirm':'deny',picker.team);
      if(enemy)this.match.addTeamScore(picker.team,1);
      if(this.match.phase!=='playing')return;
    }
  }

  step(){
    if(this.rules==='hardpoint')this.hardpoint();
    else if(this.rules==='domination')this.domination();
    else if(this.rules==='ctf')this.ctf();
    else this.confirmed();
  }

  botGoal(actor){
    if(this.rules==='hardpoint')return this.zones[HILL_ORDER[this.hill]];
    if(this.rules==='domination'){
      const options=this.zones.filter(zone=>zone.owner!==actor.team||zone.contested);
      return [...(options.length?options:this.zones)].sort((a,b)=>distance(actor,a)-distance(actor,b))[0];
    }
    if(this.rules==='ctf'){
      const own=this.flags.find(flag=>flag.team===actor.team);
      const enemy=this.flags.find(flag=>flag.team!==actor.team);
      if(!own||!enemy)return null;
      if(enemy.carrier===actor.id)return {...own.home,id:'home-'+actor.team};
      if(!this.atHome(own)&&Number(actor.id.slice(4))%2===0)return own;
      if(enemy.carrier)return {...own.home,id:'escort-'+actor.team};
      return enemy;
    }
    return this.tags.filter(tag=>distance(actor,tag)<23).sort((a,b)=>distance(actor,a)-distance(actor,b))[0]??null;
  }

  snapshot(){
    if(this.rules==='hardpoint')return {zones:[this.zones[HILL_ORDER[this.hill]]],movesIn:Math.max(0,this.nextHill-this.match.time)};
    if(this.rules==='domination')return {zones:this.zones};
    if(this.rules==='ctf')return {flags:this.flags.map(flag=>({...flag,base:flag.home,home:this.atHome(flag),returnsIn:flag.returnAt?Math.max(0,flag.returnAt-this.match.time):0}))};
    return {tags:this.tags};
  }
}
