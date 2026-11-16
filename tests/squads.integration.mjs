import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import WebSocket from 'ws';
import {createFixturePlayer} from './google-auth-client.mjs';

const origin=process.env.ROOM_TEST_ORIGIN||'http://127.0.0.1:8787';
const sockets=[];
async function api(path,body,session,status=200){
  const response=await fetch(origin+'/api/account/'+path,{
    method:body?'POST':'GET',
    headers:{...(session?{Authorization:'Bearer '+session}:{}),...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined
  });
  assert.equal(response.status,status,`${path} ${body?.action??''}`);
  return response.json();
}

async function until(check,message,timeout=8000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    const value=await check();
    if(value)return value;
    await sleep(50);
  }
  throw Error(message);
}

async function connect(path,user){
  const url=new URL(path,origin);
  url.protocol=url.protocol==='https:'?'wss:':'ws:';
  url.searchParams.set('session',randomUUID());
  if(user)url.searchParams.set('ticket',(await api('ticket',{},user.session)).ticket);
  const ws=new WebSocket(url);
  sockets.push(ws);
  const client={ws,send:message=>ws.send(JSON.stringify(message))};
  ws.on('error',error=>{client.error=error;});
  ws.on('message',raw=>{
    const message=JSON.parse(raw);
    if(message.type==='welcome'){
      client.last=message.snapshot;
      client.room=message.roomId;
      client.id=message.id;
    }else if(message.type==='snapshot')client.last=message;
    else if(message.type==='probe')client.send({type:'probeReply',n:message.n});
  });
  await until(()=>client.last||client.error,'Squad socket did not connect');
  if(client.error)throw client.error;
  return client;
}

const action=(user,action,fields={},status=200)=>api('squad',{action,...fields},user.session,status);
const party=user=>api('squad',null,user.session).then(data=>data.party);
try{
  const users=await Promise.all(Array.from({length:5},(_,i)=>createFixturePlayer(api,'Squad QA '+i)));
  const [leader,...members]=users;
  const {party:squad}=await action(leader,'create');
  for(const member of members){
    await action(leader,'invite',{handle:member.handle},403);
    await api('friends',{action:'request',handle:member.handle},leader.session);
    await api('friends',{action:'accept',handle:leader.handle},member.session);
    await action(leader,'invite',{handle:member.handle});
  }
  for(const member of members.slice(0,3)){
    const inbox=await api('squad',null,member.session);
    assert.equal(inbox.invites[0].sender,leader.handle);
    await action(member,'accept',{squad:squad.id});
  }
  await action(members[3],'accept',{squad:squad.id},409);
  await action(leader,'queue',{rules:'tdm'},409);
  await action(members[0],'queue',{rules:'tdm'},403);
  for(const member of members.slice(0,3))await action(member,'ready',{ready:true});
  const cancelled=(await action(leader,'queue',{rules:'tdm'})).party.match;
  assert.ok(cancelled.room);
  await action(members[0],'cancel');
  assert.equal((await party(leader)).match,null);
  await assert.rejects(connect('/api/party-play/'+cancelled.room,leader),/404/);
  for(const member of members.slice(0,3))await action(member,'ready',{ready:true});

  const {room}= (await action(leader,'queue',{rules:'tdm'})).party.match;
  const partyPath='/api/party-play/'+room;
  const host=await connect(partyPath,leader);
  assert.equal(host.last.phase,'staging');
  await assert.rejects(connect(partyPath,members[3]),/403/);
  await assert.rejects(connect('/api/quick-play/'+room),/409/);
  assert.equal(host.last.phase,'staging');
  const squadSockets=[host,...await Promise.all(members.slice(0,3).map(user=>connect(partyPath,user)))];
  const squadIds=new Set(squadSockets.map(client=>client.id));
  await until(()=>squadSockets.every(client=>client.last.phase==='playing'),'All squad seats should start together');
  assert.ok(squadSockets.every(client=>client.room===room));
  assert.ok(host.last.actors.filter(actor=>squadIds.has(actor.id)).every(actor=>actor.team==='blue'));

  let guest;
  await until(async()=>{
    guest=await connect('/api/quick-play?rules=tdm');
    if(guest.room===room)return true;
    guest.ws.close(1000,'Left room');
    return false;
  },'Squad room should backfill through ordinary Quick Play');
  assert.equal(guest.last.actors.find(actor=>actor.id===guest.id).team,'red');
  const original=squadSockets[1];
  original.ws.terminate();
  const resumed=await connect(partyPath,members[0]);
  assert.equal(resumed.id,original.id);
  squadSockets[1]=resumed;
  console.log('PASS: friends and readiness, cancellation, squad check-in, same team, public backfill and reconnect');

  if(!process.env.ROOM_TEST_SKIP_ROUND){
    await until(()=>squadSockets.every(client=>client.last.phase==='results'),'Squad should reach results together',193000);
    for(const client of squadSockets)client.send({type:'vote',round:client.last.round,mapId:'switchyard'});
    await until(()=>squadSockets.every(client=>client.last.round===2),'Squad should remain for the next round',18000);
    assert.ok(squadSockets.every(client=>client.last.mapId==='switchyard'));
    assert.ok(host.last.actors.filter(actor=>squadIds.has(actor.id)).every(actor=>actor.team==='blue'));
    console.log('PASS: voted map and squad persist into the next public round');
  }
  for(const client of squadSockets)client.ws.close(1000,'Left room');
  assert.equal((await party(leader)).members.length,4);
  await action(leader,'leave');
  assert.equal(await party(leader),null);
  const remaining=await party(members[0]);
  assert.equal(remaining.members.length,3);
  assert.ok(remaining.members.some(member=>member.handle===remaining.leader));
  const nextLeader=members.find(member=>member.handle===remaining.leader);
  for(const member of members.slice(0,3).filter(member=>member!==nextLeader))await action(member,'ready',{ready:true});
  const ffa=(await action(nextLeader,'queue',{rules:'ffa'})).party.match;
  const ffaSquad=await Promise.all(members.slice(0,3).map(member=>connect('/api/party-play/'+ffa.room,member)));
  await until(()=>ffaSquad.every(client=>client.last.phase==='playing'),'Free-for-all squad should start together');
  assert.ok(ffaSquad.every(client=>client.last.rules==='ffa'&&client.last.actors.every(actor=>actor.team===null)));
  console.log('PASS: leadership transfers and the squad shares a free-for-all without teams');
}finally{
  for(const socket of sockets)socket.terminate();
}
