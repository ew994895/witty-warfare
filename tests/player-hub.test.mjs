import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPair, SignJWT} from 'jose';
import {Match} from '../server/match.js';
import {PLAYER_DATA_EPOCH, PlayerHub, playerHub} from '../server/player-hub.js';
import {verifyGoogleCredential} from '../server/google-sign-in.js';
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
      try{const result=callback();db.exec('COMMIT');return result;}
      catch(error){db.exec('ROLLBACK');throw error;}
    }
  }});
  return {db,hub};
}

test('Google is the only account flow and returning players keep their progress',async()=>{
  const {db,hub}=hubFixture();
  const clientId='test-client.apps.googleusercontent.com';
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const call=async(path,body,session)=>{
    const response=await hub.fetch(new Request('https://players/'+path, {
      method:body?'POST':'GET',
      body:body?JSON.stringify(body):undefined,
      headers:session?{Authorization:'Bearer '+session}:{}
    }));
    return {status:response.status,...await response.json()};
  };
  const token=(nonce,sub,audience=clientId)=>new SignJWT({nonce})
    .setProtectedHeader({alg:'RS256'}).setIssuer('https://accounts.google.com').setSubject(sub)
    .setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const signIn=async(subject,session)=>{
    const {nonce}=await call('google-challenge',{},session);
    return call('google-sign-in',{credential:await token(nonce,subject)},session);
  };
  try{
    assert.equal((await call('sign-in-options')).googleClientId,null);
    hub.googleId=clientId;
    hub.verifyGoogle=(credential,id)=>verifyGoogleCredential(credential,id,publicKey);
    assert.equal((await call('sign-in-options')).googleClientId,clientId);
    assert.equal((await call('create',{handle:'guest',name:'Guest'})).status,401);
    const firstChallenge=await call('google-challenge',{});
    const firstCredential=await token(firstChallenge.nonce,'google-alfa');
    const firstEnrollment=await call('google-sign-in',{credential:firstCredential});
    assert.equal((await call('google-sign-in',{credential:firstCredential})).status,409);
    const player=await call('google-enroll',{enrollment:firstEnrollment.enrollment,handle:'alfa',name:'Alfa'});
    assert.deepEqual(player.profile,{handle:'alfa',name:'Alfa',googleLinked:true});
    assert.equal((await call('google-sign-in',{credential:firstCredential},player.session)).status,409);
    db.prepare("INSERT INTO profiles VALUES ('bravo','Bravo')").run();
    db.prepare("INSERT INTO stats (handle,playlist,wins) VALUES ('alfa','public',7)").run();
    db.prepare("INSERT INTO friendships VALUES ('alfa','bravo','alfa',1)").run();
    const returning=await signIn('google-alfa');
    const saved=await call('profile',null,returning.session);
    assert.equal(saved.stats[0].wins,7);
    assert.equal(saved.friends[0].handle,'bravo');
    assert.equal(typeof (await call('ticket',{},returning.session)).ticket,'string');

    const challenge=await call('google-challenge',{});
    const wrongApp=await token(challenge.nonce,'google-new','different.apps.googleusercontent.com');
    assert.equal((await call('google-sign-in',{credential:wrongApp})).status,401);
    const registration=await signIn('google-new');
    assert.equal(registration.status,200,registration.error);
    const {enrollment}=registration;
    assert.match(enrollment,/^[a-f0-9]{64}$/);
    const taken=await call('google-enroll',{enrollment,handle:'bravo',name:'Delta'});
    assert.equal(taken.status,409,taken.error);
    const newPlayer=await call('google-enroll',{enrollment,handle:'delta',name:'Delta'});
    assert.equal(newPlayer.status,201);
    assert.equal(newPlayer.profile.googleLinked,true);
    assert.equal((await call('google-enroll',{enrollment,handle:'extra',name:'Extra'})).status,401);
    assert.equal((await signIn('google-new')).profile.handle,'delta');
  }finally{db.close();}
});

test('account reset uses a new store and discards reports from the retired store',async()=>{
  const {db,hub}=hubFixture();
  try{
    const binding={idFromName:name=>name,get:id=>id};
    assert.notEqual(playerHub({PLAYERS:binding}),'players');
    db.prepare("INSERT INTO profiles VALUES ('alpha','Alpha')").run();
    const old={
      id:'outbox-v1',playlist:'public',players:[
        {handle:'alpha',won:true,kills:5,humanKills:5,deaths:0,shots:5,hits:5,headshots:0,bestStreak:5,score:500}
      ]
    };
    const send=body=>hub.fetch(new Request('https://players/internal/record',{method:'POST',body:JSON.stringify(body)}));
    assert.equal((await send(old)).status,200);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM stats').get().count,0);
    assert.equal((await send({...old,epoch:PLAYER_DATA_EPOCH})).status,200);
    assert.equal(db.prepare('SELECT kills FROM stats').get().kills,5);
  }finally{db.close();}
});

test('the account database records completed matches once and ranks only public human eliminations',async()=>{
  const {db,hub}=hubFixture();
  try{
    const sample=(handle,overrides)=>({
      handle,won:false,kills:0,humanKills:0,deaths:0,shots:0,hits:0,headshots:0,bestStreak:0,score:0,...overrides
    });
    for(const handle of ['alpha','bravo','charlie','delta']){
      db.prepare('INSERT INTO profiles VALUES (?,?)').run(handle,handle.toUpperCase());
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

test('five placements unlock rating, and Ranked lifetime stats only record once',async()=>{
  const {db,hub}=hubFixture();
  try{
    const names=Array.from({length:8},(_,i)=>'ranked'+i);
    for(const name of names)db.prepare('INSERT INTO profiles VALUES (?,?)').run(name,name);
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
      const report={id,winner,abandoned:[],playlist:'ranked',players:[{
        handle:names[0],won:true,kills:5,humanKills:5,deaths:2,shots:10,hits:5,headshots:1,bestStreak:3,score:500
      }]};
      const publish=epoch=>hub.fetch(new Request('https://players/internal/ranked-record',{
        method:'POST',body:JSON.stringify({...report,epoch})
      }));
      assert.equal((await publish(PLAYER_DATA_EPOCH-1)).status,200);
      assert.equal(hub.ranked.standing(names[0]).played,game-1);
      assert.equal((await publish(PLAYER_DATA_EPOCH)).status,200);
      assert.equal((await publish(PLAYER_DATA_EPOCH)).status,200);
      const stats=db.prepare("SELECT matches,kills FROM stats WHERE handle=? AND playlist='ranked'").get(names[0]);
      assert.equal(stats.matches,game);
      assert.equal(stats.kills,5*game);
      assert.equal(hub.ranked.standing(names[0]).played,game);
      assert.equal(hub.ranked.result(id,names[0]).played,game);
      if(game<5)assert.equal(hub.ranked.standing(names[0]).rating,null);
      now+=60_000;
    }
    assert.ok(hub.ranked.standing(names[0]).rating>1000);
    assert.ok(hub.ranked.ladder().some(row=>row.handle===names[0]));
  }finally{db.close();}
});
