import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {Match} from '../server/match.js';
import {PlayerHub} from '../server/player-hub.js';
import {roundRecord} from '../server/round-record.js';

function hubFixture() {
  const db = new DatabaseSync(':memory:');
  const hub = new PlayerHub({storage:{
    sql:{
      exec(query,...values) {
        if(query.trimStart().startsWith('CREATE TABLE')){
          db.exec(query);
          return {toArray:()=>[]};
        }
        const rows=db.prepare(query).all(...values);
        return {toArray:()=>rows};
      }
    },
    transactionSync(callback){
      db.exec('BEGIN');
      try{callback();db.exec('COMMIT');}
      catch(error){db.exec('ROLLBACK');throw error;}
    }
  }});
  return {db,hub};
}

test('the account database records completed matches once and ranks only public human eliminations',async()=>{
  const {db,hub}=hubFixture();
  try{
    const sample=(handle,overrides)=>({
      handle,won:false,kills:0,humanKills:0,deaths:0,shots:0,hits:0,headshots:0,bestStreak:0,score:0,...overrides
    });
    for(const handle of ['alpha','bravo','charlie','delta']){
      db.prepare('INSERT INTO profiles VALUES (?,?,?)').run(handle,handle.toUpperCase(),'fixture-'+handle);
    }
    const first={id:'round-one',playlist:'public',players:[
      sample('alpha',{humanKills:3,kills:4,bestStreak:2,score:400,won:true}),
      sample('bravo',{humanKills:3,kills:3}),
      sample('charlie',{kills:9,won:true})
    ]};
    hub.record(first);
    hub.record(first);
    hub.record({id:'round-two',playlist:'custom',players:[sample('delta',{humanKills:20,kills:20,won:true})]});
    hub.record({id:'round-three',playlist:'public',players:[sample('alpha',{kills:1,bestStreak:1,score:100})]});
    const {ranks}=await (await hub.fetch(new Request('https://players/rankings'))).json();
    assert.deepEqual(ranks.map(row=>[row.handle,row.eliminations,row.matches]),[['alpha',3,2],['bravo',3,1]]);
    const best=db.prepare('SELECT best_streak, best_score, kills FROM stats WHERE handle=?').get('alpha');
    assert.equal(best.best_streak,2);
    assert.equal(best.best_score,400);
    assert.equal(best.kills,5);
  }finally{db.close();}
});

test('round records use server stats, count humans separately and omit spectators and guests',()=>{
  const match=new Match({public:true});
  const a=match.join('a','A',0,'alpha');
  const b=match.join('b','B');
  match.join('c','Idle',0,'charlie');
  const bot=match.actors.find(actor=>actor.bot);
  match.time=30;
  match.inputs(a.id,[{seq:0,yaw:0,pitch:0}]);
  b.shield=bot.shield=0;
  match.damage(bot,100,a,false);
  match.damage(b,100,a,true);
  match.finishRound();
  assert.deepEqual(roundRecord(match,'test'),{id:'test',playlist:'public',players:[{
    handle:'alpha',won:true,kills:2,humanKills:1,deaths:0,shots:0,hits:0,headshots:1,bestStreak:2,score:250
  }]});
});

test('team wins follow the team score and old round inputs do not create a new stat entry',()=>{
  const match=new Match({rules:'tdm',botCount:0});
  const a=match.join('a','A',0,'alpha'), b=match.join('b','B',0,'bravo');
  match.inputs(a.id,[{seq:0,yaw:0,pitch:0}]);
  match.inputs(b.id,[{seq:0,yaw:0,pitch:0}]);
  match.time=30;
  match.teamScores.blue=8;
  assert.deepEqual(roundRecord(match,'one').players.map(player=>player.won),[true,false]);
  match.beginRound('pine-ridge');
  match.time=60;
  assert.deepEqual(roundRecord(match,'two').players,[]);
});

test('five placements unlock rating, ranking is match-result based, and recording is idempotent',()=>{
  const {db,hub}=hubFixture();
  try{
    const names=Array.from({length:8},(_,i)=>'ranked'+i);
    for(const name of names)db.prepare('INSERT INTO profiles VALUES (?,?,?)').run(name,name,'fixture-'+name);
    let now=10_000;
    let winner;
    for(let game=1;game<=5;game++){
      const ids=names.map(handle=>hub.ranked.queue(handle,'join',now).matchId).filter(Boolean);
      assert.equal(ids.length,1);
      const id=ids[0],info=hub.ranked.info(id,names[0],now);
      assert.equal(info.seats.length,8);
      assert.equal(info.seats.filter(seat=>seat.team==='blue').length,4);
      assert.equal(hub.ranked.info(id,'outsider',now),null);
      assert.ok(hub.ranked.start(id,now));
      winner=info.seats.find(seat=>seat.handle===names[0]).team;
      hub.ranked.record({id,winner,abandoned:[]});
      hub.ranked.record({id,winner,abandoned:[]});
      assert.equal(hub.ranked.standing(names[0]).played,game);
      assert.equal(hub.ranked.result(id,names[0]).played,game);
      if(game<5)assert.equal(hub.ranked.standing(names[0]).rating,null);
      now+=60_000;
    }
    assert.ok(hub.ranked.standing(names[0]).rating>1000);
    assert.ok(hub.ranked.ladder().some(row=>row.handle===names[0]));
  }finally{db.close();}
});
