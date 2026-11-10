import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import WebSocket from 'ws';

const origin=process.env.ROOM_TEST_ORIGIN||'http://127.0.0.1:8787';
const clients=[];
async function api(path,body,session,status=200){
  const response=await fetch(origin+'/api/account/'+path,{
    method:body?'POST':'GET',
    headers:{...(session?{Authorization:'Bearer '+session}:{}),...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined
  });
  assert.equal(response.status,status,path);
  return response.json();
}
async function until(check,message,timeout=8000){
  const end=Date.now()+timeout;
  while(Date.now()<end){const value=await check();if(value)return value;await sleep(100);}
  throw new Error(message);
}
async function join(path,session){
  const url=new URL(path,origin);
  url.protocol=url.protocol==='https:'?'wss:':'ws:';
  url.searchParams.set('session',randomUUID());
  if(session)url.searchParams.set('ticket',(await api('ticket',{},session)).ticket);
  const ws=new WebSocket(url);
  clients.push(ws);
  const client={ws};
  ws.on('error',error=>{client.error=error;});
  ws.on('message',raw=>{
    const m=JSON.parse(raw);
    if(m.type==='welcome'){client.id=m.id;client.last=m.snapshot;}
    if(m.type==='snapshot')client.last=m;
  });
  await until(()=>client.last||client.error,'Socket receives a welcome');
  if(client.error)throw client.error;
  return client;
}
const close=client=>client.ws.close(1000,'Left room');

try{
  await api('ranked-queue',{action:'join'},undefined,401);
  const gun=await join('/api/quick-play?rules=gun');
  const storm=await join('/api/quick-play?rules=storm');
  assert.equal(gun.last.rules,'gun');
  assert.equal(storm.last.rules,'storm');
  assert.equal(storm.last.actors.find(actor=>actor.id===storm.id).lives,3);
  close(gun);
  close(storm);
  const users=await Promise.all(Array.from({length:8},(_,i)=>api('create',{
    handle:'rk_'+randomBytes(5).toString('hex'),name:'Ranked QA '+i,key:randomBytes(32).toString('hex')
  },undefined,201)));
  const waiting=await Promise.all(users.slice(0,7).map(user=>api('ranked-queue',{action:'join'},user.session)));
  assert.ok(waiting.every(result=>result.queued&&!result.matchId));
  const eighth=await api('ranked-queue',{action:'join'},users[7].session);
  assert.ok(eighth.matchId);
  const assigned=await Promise.all(users.map(user=>api('ranked-queue',{action:'join'},user.session)));
  assert.ok(assigned.every(result=>result.matchId===eighth.matchId));
  const path='/api/ranked/'+eighth.matchId+'/socket';
  await assert.rejects(join(path),/401/);
  const first=await Promise.all(users.slice(0,7).map(user=>join(path,user.session)));
  assert.ok(first.every(player=>player.last.phase==='staging'));
  const last=await join(path,users[7].session);
  const everyone=[...first,last];
  await until(()=>everyone.every(player=>player.last.phase==='playing'),'All eight start together');
  assert.equal(last.last.actors.length,8);
  assert.ok(last.last.actors.every(player=>!player.bot));
  assert.equal(last.last.actors.filter(player=>player.team==='blue').length,4);
  const old=everyone[0];
  old.ws.terminate();
  const resumed=await join(path,users[0].session);
  assert.equal(resumed.id,old.id);
  assert.equal(resumed.last.actors.length,8);
  console.log('PASS: new public modes, signed-in Ranked queue, full 4v4 start, and reserved reconnect');
  if(!process.env.ROOM_TEST_SKIP_ROUND){
    close(last);
    await until(()=>resumed.last.phase==='results','Ranked match reaches results',195000);
    assert.equal(resumed.last.voteRemaining,0);
    const pending=await until(async()=>(
      await api('ranked-result',{id:eighth.matchId},users[0].session)).result,'Rating result is recorded');
    const quit=(await api('ranked-result',{id:eighth.matchId},users[7].session)).result;
    assert.deepEqual(pending,{delta:0,rating:null,played:1,placements:5});
    assert.equal(quit.delta,-16);
    assert.equal(quit.played,1);
    assert.equal((await api('ranked-ladder')).ranks.length,0);
    console.log('PASS: Ranked completion, no map vote, placement progress, and abandonment loss');
  }
}finally{
  for(const ws of clients)if(ws.readyState===WebSocket.OPEN)ws.close(1000,'Left room');else ws.terminate();
}
