import assert from 'node:assert/strict';
import {test} from 'node:test';
import {STEP,overlap} from '../dist/core.js';
import {MAPS} from '../dist/maps.js';
import {OBJECTIVE_RULES,roomSettings} from '../dist/rules.js';
import {Match} from '../server/match.js';
import {roundRecord} from '../server/round-record.js';

const place=(actor,point)=>Object.assign(actor,{x:point.x,z:point.z,feet:point.y||0,dead:0,shield:0});
const tick=(match,seconds)=>{for(let i=0;i<Math.round(seconds/STEP);i++){match.time+=STEP;match.objectives.step();}};
const duel=(rules,config={})=>{
  const match=new Match({rules,botCount:0,...config});
  return [match,match.join('blue','Blue'),match.join('red','Red')];
};

test('objective modes use balanced teams, defaults and capacity limits',()=>{
  for(const [rules,definition] of Object.entries(OBJECTIVE_RULES)){
    const settings=roomSettings({rules,maxPlayers:3});
    assert.equal(settings.maxPlayers,8);
    assert.equal(settings.scoreLimit,definition.limit);
    const match=new Match({rules,public:true});
    match.join('human','Guest');
    assert.equal(match.actors.length,8);
    assert.equal(match.actors.filter(actor=>actor.team==='blue').length,4);
    assert.equal(match.actors.filter(actor=>actor.team==='red').length,4);
  }
});

test('every hill, control zone and flag base is open and reachable from both teams',()=>{
  for(const map of MAPS){
    for(const rules of ['hardpoint','domination','ctf']){
      const match=new Match({rules,mapId:map.id,botCount:0});
      const sites=[...match.objectives.zones,...match.objectives.flags];
      for(const site of sites){
        assert.ok(!match.map.solids.some(solid=>overlap(site.x,site.z,solid,site.radius||1.55)),map.id);
        for(const zSide of [-1,1]){
          const starts=match.map.spawns.filter(p=>p[1]*zSide>0);
          assert.ok(starts.some(([x,z])=>match.nav.path({x,z},site).length>0),map.id+' '+site.id);
        }
      }
    }
  }
});

test('Hardpoint awards time only while a single team controls the active hill and rotates on schedule',()=>{
  const [match,blue,red]=duel('hardpoint');
  const first=match.objectives.snapshot().zones[0];
  place(blue,first);
  place(red,first);
  tick(match,2);
  assert.equal(first.contested,true);
  assert.deepEqual(match.teamScores,{blue:0,red:0});
  place(red,{x:20,z:20});
  tick(match,2);
  assert.equal(match.teamScores.blue,2);
  assert.equal(blue.objectiveScore,2);
  match.time=30;
  match.objectives.step();
  assert.notEqual(match.objectives.snapshot().zones[0].id,first.id);
  assert.equal(match.objectives.snapshot().movesIn,30);
});

test('Domination captures uncontested zones, keeps ownership without players and allows recapture',()=>{
  const [match,blue,red]=duel('domination');
  const zone=match.objectives.zones[1];
  place(blue,zone);
  place(red,zone);
  tick(match,2.1);
  assert.equal(zone.owner,null);
  place(red,{x:21,z:20});
  tick(match,2);
  assert.equal(zone.owner,'blue');
  assert.equal(blue.objectiveScore,1);
  place(blue,{x:-20,z:20});
  tick(match,2);
  assert.ok(match.teamScores.blue>0);
  place(red,zone);
  tick(match,2);
  assert.equal(zone.owner,'red');
  assert.equal(red.objectiveScore,1);
});

test('Capture the Flag requires the home flag and recovers dropped flags',()=>{
  const [match,blue,red]=duel('ctf',{scoreLimit:1});
  const [blueFlag,redFlag]=match.objectives.flags;
  assert.ok(blue.z>0&&red.z<0);
  place(blue,redFlag.home);
  place(red,blueFlag.home);
  match.objectives.step();
  assert.equal(blueFlag.carrier,red.id);
  assert.equal(redFlag.carrier,blue.id);
  place(blue,blueFlag.home);
  place(red,{x:0,z:0});
  match.objectives.step();
  assert.equal(match.teamScores.blue,0);
  match.disconnect(red.id);
  assert.ok(blueFlag.returnAt>0);
  place(blue,blueFlag);
  match.objectives.step();
  assert.equal(blueFlag.carrier,null);
  assert.equal(blueFlag.returnAt,0);
  assert.equal(blue.objectiveScore,1);
  place(blue,blueFlag.home);
  match.objectives.step();
  assert.equal(match.teamScores.blue,1);
  assert.equal(match.phase,'results');
  assert.equal(blue.objectiveScore,2);
});

test('Capture the Flag drops a flag on death and returns it when untouched',()=>{
  const [match,blue,red]=duel('ctf');
  const [,redFlag]=match.objectives.flags;
  place(blue,redFlag.home);
  match.objectives.step();
  place(blue,{x:1,z:17});
  assert.ok(match.damage(blue,100,red,false));
  assert.equal(redFlag.carrier,null);
  assert.ok(redFlag.returnAt>0);
  match.time=redFlag.returnAt;
  place(red,{x:-20,z:-20});
  match.objectives.step();
  assert.ok(match.objectives.atHome(redFlag));
  assert.deepEqual(match.teamScores,{blue:0,red:0});
});

test('Kill Confirmed scores enemy tags and denies friendly tags without scoring kills',()=>{
  const [match,blue,red]=duel('confirmed');
  const redAlly=match.join('ally','Ally');
  redAlly.team='red';
  const drop={x:1,z:14};
  place(red,drop);
  place(blue,{x:6,z:17});
  place(redAlly,{x:12,z:17});
  assert.ok(match.damage(red,100,blue,true));
  assert.equal(blue.kills,1);
  assert.equal(match.teamScores.blue,0);
  assert.equal(match.objectives.tags.length,1);
  place(redAlly,drop);
  match.objectives.step();
  assert.equal(match.teamScores.blue,0);
  assert.equal(redAlly.objectiveScore,1);
  place(redAlly,{x:12,z:17});
  place(red,drop);
  assert.ok(match.damage(red,100,blue,false));
  place(blue,drop);
  match.objectives.step();
  assert.equal(match.teamScores.blue,1);
  assert.equal(blue.objectiveScore,1);
  assert.equal(match.objectives.tags.length,0);
});

test('bots prioritize objectives and the next map rebuilds objectives and contributions',()=>{
  const match=new Match({rules:'hardpoint',mapId:'switchyard'});
  const host=match.join('host','Host',0,'verified');
  const bot=match.actors.find(actor=>actor.bot);
  const hill=match.objectives.snapshot().zones[0];
  assert.equal(match.objectives.botGoal(bot).id,hill.id);
  assert.ok(match.botInput(bot));
  host.received=0;
  match.time=20;
  match.addTeamScore(host.team,75);
  assert.equal(roundRecord(match,'objective').players[0].won,true);
  match.vote(host.id,'pine-ridge');
  assert.ok(match.restart(host.id,match.round));
  assert.equal(match.map.id,'pine-ridge');
  assert.notEqual(match.objectives.snapshot().zones[0].z,hill.z);
  assert.equal(host.objectiveScore,0);
  assert.deepEqual(match.teamScores,{blue:0,red:0});
});
