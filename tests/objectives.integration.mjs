import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import WebSocket from 'ws';
import {createMap} from '../dist/maps.js';
import {createNav} from '../dist/core.js';

const origin=process.env.ROOM_TEST_ORIGIN||'http://127.0.0.1:8787';
const sockets=[];
async function until(check,message,timeout=8000){
  const end=Date.now()+timeout;
  while(Date.now()<end){const value=check();if(value)return value;await sleep(50);}
  throw new Error(message);
}
async function join(path,name){
  const url=new URL(path,origin);
  url.protocol=url.protocol==='https:'?'wss:':'ws:';
  url.searchParams.set('session',randomUUID());
  url.searchParams.set('name',name);
  url.searchParams.set('primary','3');
  const socket=new WebSocket(url);
  sockets.push(socket);
  const client={socket,seq:0,send:message=>socket.send(JSON.stringify(message))};
  socket.on('error',error=>{client.error=error;});
  socket.on('message',raw=>{
    const message=JSON.parse(raw);
    if(message.type==='welcome'){client.id=message.id;client.last=message.snapshot;}
    if(message.type==='snapshot')client.last=message;
  });
  await until(()=>client.last||client.error,'Socket receives welcome');
  if(client.error)throw client.error;
  return client;
}
const close=socket=>socket.close(1000,'Left room');
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

async function walk(client,map,target,complete){
  const nav=createNav(map.solids,map.navBounds);
  let route=[],plannedAt=0;
  const end=Date.now()+30_000;
  while(Date.now()<end){
    if(complete())return;
    const own=client.last.actors.find(actor=>actor.id===client.id);
    if(Date.now()-plannedAt>1800){
      route=nav.path(own,target);
      plannedAt=Date.now();
    }
    while(route.length&&distance(own,route[0])<.48)route.shift();
    const next=route[0]||target;
    const yaw=Math.atan2(own.x-next.x,own.z-next.z);
    const forward=distance(own,target)<.45?0:Math.min(1,Math.max(.24,distance(own,next)/1.7));
    client.send({type:'inputs',frames:Array.from({length:4},()=>({seq:++client.seq,yaw,pitch:0,forward,weapon:3}))});
    await sleep(34);
  }
  throw new Error('Player did not reach objective '+target.id);
}

try{
  for(const rules of ['hardpoint','domination','ctf','confirmed']){
    const guest=await join('/api/quick-play?rules='+rules,'Objective QA');
    assert.equal(guest.last.rules,rules);
    assert.equal(guest.last.actors.length,8);
    assert.equal(guest.last.actors.filter(actor=>actor.team==='blue').length,4);
    assert.ok(guest.last.objective);
    close(guest.socket);
  }
  if(!process.env.ROOM_TEST_SKIP_ROUND){
    const response=await fetch(origin+'/api/rooms',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({rules:'ctf',mapId:'switchyard',botCount:0,maxPlayers:2,scoreLimit:1})
    });
    assert.equal(response.status,201);
    const {code}=await response.json();
    const path='/api/rooms/'+code+'/socket';
    const host=await join(path,'Flag runner'),guest=await join(path,'Flag witness');
    const [own,enemy]=host.last.objective.flags;
    const map=createMap(host.last.mapId);
    await walk(host,map,{...enemy.base,id:'red flag'},()=>host.last.objective.flags[1].carrier===host.id);
    await until(()=>guest.last.objective.flags[1].carrier===host.id,'Other player sees the flag carrier');
    await walk(host,map,{...own.base,id:'blue base'},()=>host.last.phase==='results');
    await until(()=>guest.last.phase==='results','Other player sees results');
    assert.equal(guest.last.teamScores.blue,1);
    assert.equal(guest.last.actors.find(actor=>actor.id===host.id).objectiveScore,1);
    host.send({type:'vote',round:1,mapId:'pine-ridge'});
    await until(()=>guest.last.voteCounts['pine-ridge']===1,'Other player sees map vote');
    host.send({type:'restart',round:1,settings:{rules:'domination',botCount:0,maxPlayers:2}});
    await until(()=>host.last.round===2&&guest.last.round===2,'Both stay for the next round');
    assert.equal(guest.last.mapId,'pine-ridge');
    assert.equal(guest.last.rules,'domination');
    assert.equal(guest.last.objective.zones.length,3);
    assert.deepEqual(guest.last.teamScores,{blue:0,red:0});
    console.log('PASS: live flag pickup and capture, both clients see the score, and the same room switches maps and objective modes');
  }
  console.log('PASS: four separate Quick Play objective modes with balanced teams');
}finally{
  for(const socket of sockets)if(socket.readyState===WebSocket.OPEN)close(socket);else socket.terminate();
}
