import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import WebSocket from 'ws';

const origin = process.env.ROOM_TEST_ORIGIN || 'http://127.0.0.1:8787';
const sockets = [];
const makeKey = () => randomBytes(32).toString('hex');

async function request(path, {method = 'GET', body, session, status = 200} = {}) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      ...(session ? {Authorization:'Bearer '+session} : {}),
      ...(body ? {'Content-Type':'application/json'} : {})
    },
    body:body?JSON.stringify(body):undefined
  });
  assert.equal(response.status,status,path);
  return response.json();
}
const api = (path, options) => request('/api/account/' + path,options);
const post = (path,body,session,status) => api(path,{method:'POST',body,session,status});

async function player(name) {
  const handle = 'qa_' + randomBytes(5).toString('hex');
  const key = makeKey();
  const account = await post('create',{handle,name,key},undefined,201);
  assert.deepEqual(account.profile,{handle,name});
  assert.equal(account.key,undefined);
  return {handle,key,session:account.session};
}

async function until(check, message, timeout = 8000) {
  const end = Date.now() + timeout;
  while(Date.now()<end) {
    const result = await check();
    if(result)return result;
    await sleep(100);
  }
  throw new Error(message);
}

function connect(code,ticket,session=randomUUID()) {
  const url = new URL('/api/rooms/' + code + '/socket',origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('session',session);
  url.searchParams.set('ticket',ticket);
  url.searchParams.set('name','Unverified name');
  const socket = new WebSocket(url);
  sockets.push(socket);
  const client = {socket};
  socket.on('error',error=>{client.error=error;});
  socket.on('message',raw=>{
    const m=JSON.parse(raw);
    if(m.type==='welcome'){client.id=m.id;client.last=m.snapshot;}
    if(m.type==='snapshot')client.last=m;
    if(m.type==='probe')socket.send(JSON.stringify({type:'probeReply',n:m.n}));
  });
  return client;
}

try {
  await api('profile',{status:401});
  await request('/api/account/internal/record',{method:'POST',body:{},status:404});
  const a=await player('Account QA A'),b=await player('Account QA B');
  await post('create',{handle:a.handle,name:'Account QA A',key:makeKey()},undefined,409);
  await post('sign-in',{key:makeKey()},undefined,401);
  await post('sign-out',{},a.session);
  await api('profile',{session:a.session,status:401});
  a.session=(await post('sign-in',{key:a.key})).session;
  await api('profile',{method:'PATCH',session:a.session,body:{name:'Verified QA'}});
  await post('friends',{action:'request',handle:b.handle},a.session);
  await post('friends',{action:'accept',handle:b.handle},a.session,409);
  const incoming=await api('profile',{session:b.session});
  assert.equal(incoming.friends[0].status,'received');
  const {code}=await request('/api/rooms',{method:'POST',body:{duration:120,botCount:0},status:201});
  await post('invites',{handle:b.handle,code},a.session,403);
  await post('friends',{action:'accept',handle:a.handle},b.session);
  await post('invites',{handle:b.handle,code},a.session);
  assert.equal((await api('profile',{session:b.session})).invites[0].code,code);
  assert.equal((await api('profile',{session:a.session})).invites.length,0);
  const [first,second]=await Promise.all([post('ticket',{},a.session),post('ticket',{},b.session)]);
  const firstClient=connect(code,first.ticket),secondClient=connect(code,second.ticket);
  await until(()=>firstClient.last&&secondClient.last,'Signed-in friends join the same room');
  assert.ok(secondClient.last.actors.some(actor=>actor.name==='Verified QA'));
  assert.ok(secondClient.last.actors.every(actor=>actor.account===undefined));
  const spent=connect(code,first.ticket);
  await until(()=>spent.error,'A used play ticket must be rejected');
  assert.match(spent.error.message,/401/);
  for(const client of [firstClient,secondClient])client.socket.send(JSON.stringify({
    type:'inputs',frames:[{seq:0,yaw:0,pitch:0,forward:1,weapon:0}]
  }));
  console.log('PASS: optional account sessions, private identity, friend request and room invite, single-use play tickets');

  if(!process.env.ROOM_TEST_SKIP_ROUND) {
    await until(()=>firstClient.last?.phase==='results','Custom round completes',135000);
    const profile=await until(async()=>{
      const data=await api('profile',{session:a.session});
      return data.stats.length&&data;
    },'Completed round is saved to the profile');
    assert.equal(profile.stats[0].playlist,'custom');
    assert.equal(profile.stats[0].matches,1);
    const ranks=await api('rankings');
    assert.ok(!ranks.ranks.some(row=>row.handle===a.handle));
    assert.equal((await api('profile',{session:b.session})).stats[0].matches,1);
    console.log('PASS: real match records both signed-in players once and excludes custom results from public rankings');
  }
  await post('friends',{action:'remove',handle:b.handle},a.session);
  const after=await api('profile',{session:b.session});
  assert.equal(after.friends.length,0);
  assert.equal(after.invites.length,0);
} finally {
  for(const socket of sockets) {
    if(socket.readyState===WebSocket.OPEN)socket.close(1000,'Left room');
    else socket.terminate();
  }
}
