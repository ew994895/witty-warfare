import assert from 'node:assert/strict';
import {test} from 'node:test';
import {GUN_ORDER,stormRadius} from '../dist/rules.js';
import {Match} from '../server/match.js';

test('Gun Game locks the weapon, promotes on eliminations, and ends on the final knife stage',()=>{
  const match=new Match({rules:'gun',mapId:'switchyard',botCount:0},()=>0);
  const a=match.join('a','A'),b=match.join('b','B');
  assert.equal(match.setLoadout(a.id,4,true),false);
  for(const [stage,weapon] of GUN_ORDER.entries()){
    assert.equal(a.stage,stage);
    assert.equal(a.arsenal.index,weapon);
    assert.deepEqual(a.arsenal.slots,[weapon]);
    Object.assign(a,{x:-13,z:13,feet:0,yaw:0,pitch:0,dead:0,recoil:0});
    Object.assign(b,{x:-13,z:12,feet:0,dead:0,hp:1,shield:0});
    a.arsenal.cooldown=a.arsenal.switching=0;
    match.shoot(a,true);
  }
  assert.equal(match.phase,'results');
  assert.equal(match.roundWinner,a.id);
  assert.equal(a.kills,GUN_ORDER.length);
  assert.ok(match.restart(a.id,match.round));
  assert.equal(a.stage,0);
});

test('Storm Survival shrinks the zone, consumes lives, and keeps late joiners out until next round',()=>{
  const match=new Match({rules:'storm',botCount:0});
  const a=match.join('a','A'),b=match.join('b','B');
  assert.equal(a.lives,3);
  match.stormTick();
  match.remaining=10;
  assert.ok(stormRadius(match.map,170,180)<10);
  const late=match.join('late','Late');
  assert.ok(late.waitingForRound&&late.inactive);
  Object.assign(a,{x:0,z:0});
  for(let life=2;life>=0;life--){
    Object.assign(b,{x:20,z:20,hp:.05,dead:0});
    match.stormTick();
    assert.equal(b.lives,life);
    if(life)assert.equal(match.phase,'playing');
  }
  assert.equal(b.inactive,true);
  assert.equal(match.phase,'results');
  assert.equal(match.roundWinner,a.id);
  assert.ok(match.restart(a.id,match.round));
  assert.equal(late.inactive,false);
  assert.equal(late.lives,3);
});
