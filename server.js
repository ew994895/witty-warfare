import {Match} from './server/match.js';
import {QuickPlay} from './server/quick-play.js';
import {roomSettings} from './dist/rules.js';
import {playerHub} from './server/player-hub.js';
import {roundRecord} from './server/round-record.js';
export {PlayerHub} from './server/player-hub.js';
const accountPaths=new Set(['create','sign-in','sign-out','profile','ticket','friends','invites','rankings']);

async function accountRequest(request, env, path, origin){
  const headers=new Headers();
  const authorization=request.headers.get('Authorization');
  if(authorization)headers.set('Authorization',authorization);
  headers.set('X-Witty-Rate-Source',request.headers.get('CF-Connecting-IP')||'local');
  let body;
  if(request.method==='POST'||request.method==='PATCH'){
    const max=2048;
    if(Number(request.headers.get('Content-Length'))>max)return json({error:'Request too large'},413,origin);
    const reader=request.body?.getReader();
    const buffer=new Uint8Array(max);
    let size=0;
    if(reader){
      for(;;){
        const chunk=await reader.read();
        if(chunk.done)break;
        if(size+chunk.value.length>max){
          await reader.cancel();
          return json({error:'Request too large'},413,origin);
        }
        buffer.set(chunk.value,size);
        size+=chunk.value.length;
      }
    }
    const raw=new TextDecoder().decode(buffer.subarray(0,size));
    try{
      const value=raw?JSON.parse(raw):{};
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid account request');
      body=JSON.stringify(value);
    }catch{return json({error:'Invalid account request'},400,origin);}
  }
  const response=await playerHub(env).fetch('https://players/'+path,{method:request.method,headers,body});
  return json(await response.json(),response.status,origin);
}

async function withPlayerIdentity(request, env){
  const url=new URL(request.url);
  const ticket=url.searchParams.get('ticket');
  url.searchParams.delete('ticket');
  const headers=new Headers(request.headers);
  headers.delete('X-Witty-Account');
  headers.delete('X-Witty-Callsign');
  if(ticket){
    const response=await playerHub(env).fetch('https://players/internal/redeem',{method:'POST',body:JSON.stringify({ticket})});
    if(!response.ok)return null;
    const profile=await response.json();
    headers.set('X-Witty-Account',profile.handle);
    // Header values are ASCII; callsigns can contain Unicode.
    headers.set('X-Witty-Callsign',encodeURIComponent(profile.name));
  }
  return new Request(url,{method:request.method,headers});
}
const sessionId=req=>new URL(req.url).searchParams.get('session');
const validSession=id=>/^[a-zA-Z0-9-]{20,64}$/.test(id||'');
async function playerId(roomId, session){
  // Snapshots expose player IDs, while the guest session is a private credential.
  const input=new TextEncoder().encode(roomId+':'+session);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',input),0,16);
  return Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('');
}
const allowedOrigin=(req,env)=>{const origin=req.headers.get('Origin');return !origin||origin===new URL(req.url).origin||origin==='https://witty-warfare.pages.dev';};
const json=(data,status=200,origin='')=>Response.json(data,{status,headers:{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Cache-Control':'no-store'}});
export default {async fetch(req,env){const url=new URL(req.url);if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(req);const origin=req.headers.get('Origin')||'';if(!allowedOrigin(req,env))return json({error:'Origin not allowed'},403);if(req.method==='OPTIONS')return new Response(null,{headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, PATCH, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Vary':'Origin'}});
 const accountPath=url.pathname.match(/^\/api\/account\/([a-z-]+)$/)?.[1];
 if(accountPaths.has(accountPath))return accountRequest(req,env,accountPath,origin);
 if(url.pathname==='/api/health')return json({ok:true,version:1},200,origin);
 if(url.pathname==='/api/rooms'&&req.method==='POST'){if(Number(req.headers.get('content-length'))>2048)return json({error:'Request too large'},413,origin);let config;try{config=await req.json();}catch{return json({error:'Invalid room settings'},400,origin);}const bytes=crypto.getRandomValues(new Uint8Array(8)),alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',code=[...bytes].map(b=>alphabet[b%32]).join('');const room=env.ROOMS.get(env.ROOMS.idFromName(code));await room.fetch(new Request('https://room/init',{method:'POST',body:JSON.stringify({mapId:config?.mapId,...roomSettings(config??{})})}));return json({code},201,origin);}
 if(req.headers.get('Upgrade')?.toLowerCase()==='websocket'){
   req=await withPlayerIdentity(req,env);
   if(!req)return json({error:'Play ticket expired'},401,origin);
   const custom=url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{8})\/socket$/);
   if(custom)return env.ROOMS.get(env.ROOMS.idFromName(custom[1])).fetch(req);
   const publicRoom=url.pathname.match(/^\/api\/quick-play\/([a-f0-9-]{36})$/);
   if(publicRoom)return env.ROOMS.get(env.ROOMS.idFromName('public:'+publicRoom[1])).fetch(req);
   if(url.pathname==='/api/quick-play'){
     if(!validSession(sessionId(req)))return json({error:'Invalid session'},400,origin);
     const directory=url.searchParams.get('rules')==='tdm'?'public-directory-tdm':'public-directory';
     return env.ROOMS.get(env.ROOMS.idFromName(directory)).fetch(req);
   }
 }
 return json({error:'Room not found'},404,origin);
}};
export class ArenaRoom{
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.match=null;this.clients=new Map();this.disconnected=new Map();this.clock=null;this.previous=0;this.accumulator=0;this.config=null;this.ready=ctx.blockConcurrencyWhile(async()=>{this.config=await ctx.storage.get('config');if(this.config)this.match=new Match(this.config);});}
 async fetch(req){
  await this.ready;
  const url=new URL(req.url);
  if(url.pathname==='/api/quick-play'){
    this.quickPlay??=new QuickPlay(this.ctx.storage,this.env.ROOMS);
    return this.quickPlay.join(req);
  }
  if(url.pathname==='/init'&&req.method==='POST'){
    if(!this.config){
      const config=await req.json();
      await this.ctx.storage.put('config',config);
      this.config=config;
      this.match=new Match(config);
    }
    return Response.json({ok:true});
  }
  const session=sessionId(req);
  if(!validSession(session))return Response.json({error:'Invalid session'},{status:400});
  if(url.pathname==='/quick-start'&&!this.config){
    const config={mapId:'dust-court',rules:url.searchParams.get('rules'),public:true};
    await this.ctx.storage.put('config',config);
    this.config=config;
    this.match=new Match(config);
  }
  const account=req.headers.get('X-Witty-Account');
  const name=account?decodeURIComponent(req.headers.get('X-Witty-Callsign')):url.searchParams.get('name');
  const id=await playerId(this.ctx.id.toString(),account?'account:'+account:session);
  this.expireSeats(Date.now());
  const idlePublic=this.config?.public&&!this.clients.size&&!this.disconnected.size;
  if(!this.match||(idlePublic&&url.pathname!=='/quick-start')){
    return Response.json({error:'Room not found. Check the code or create a room.'},{status:404});
  }
  const a=this.match.join(id,name,Number(url.searchParams.get('primary')),account);if(!a)return Response.json({error:'This room is full'},{status:409});const pair=new WebSocketPair(),[client,socket]=Object.values(pair);socket.accept();const old=this.clients.get(id);if(old)old.socket.close(4000,'Reconnected elsewhere');const state={socket,eventId:this.match.eventId,round:this.match.round,tokens:90,tokenTime:Date.now()};this.clients.set(id,state);this.disconnected.delete(id);
 socket.addEventListener('message',event=>{if(this.clients.get(id)!==state)return;const now=Date.now();state.tokens=Math.min(90,state.tokens+(now-state.tokenTime)*.06);state.tokenTime=now;if(state.tokens<1||typeof event.data!=='string'||event.data.length>16000){socket.close(1008,'Too many messages');return;}state.tokens--;let data;try{data=JSON.parse(event.data);}catch{return;}if(!data||typeof data!=='object')return;if(data.type==='probeReply'&&data.n===state.probe){const actor=this.match.actors.find(a=>a.id===id);if(actor)actor.rtt=Math.min(.5,(Date.now()-state.probeTime)/1000);state.probe=null;}if(data.type==='inputs')this.match.inputs(id,data.frames);if(data.type==='loadout')this.match.setLoadout(id,data.primary,data.respawn===true);if(data.type==='vote')this.match.vote(id,data.mapId,data.round);if(data.type==='roomSettings'){
   const accepted=this.match.queueSettings(id,data.settings,data.round);
   if(accepted&&this.match.phase==='results')this.persistConfig();
   socket.send(JSON.stringify({type:'roomSettingsResult',accepted}));
 }if(data.type==='teamPreference'){
   const accepted=this.match.chooseTeam(id,data.team,data.round);
   socket.send(JSON.stringify({type:'teamPreferenceResult',accepted}));
 }if(data.type==='restart'){
   const accepted=this.match.restart(id,data.round,data.settings);
   if(accepted)this.persistConfig();
   socket.send(JSON.stringify({type:'restartResult',accepted}));
 }if(data.type==='ping')socket.send(JSON.stringify({type:'pong',at:data.at}));});
 const close=event=>{
  try{socket.close(1000,'Connection closed');}catch{}
  if(this.clients.get(id)!==state)return;
  this.clients.delete(id);
  if(event.code===1000&&event.reason==='Left room'){
    this.match.leave(id);
  }else{
    this.disconnected.set(id,Date.now()+15000);
    const actor=this.match.actors.find(a=>a.id===id);
    if(actor)actor.queue=[];
  }
  if(!this.clients.size){clearInterval(this.clock);this.clock=null;}
 };
 socket.addEventListener('close',close);
 socket.addEventListener('error',close);
 const roomId=this.config.public?(url.pathname.startsWith('/api/')?url.pathname.split('/').at(-1):url.searchParams.get('assignedRoom')):undefined;
 state.roomId=roomId;
 socket.send(JSON.stringify(this.welcome(id,a.arsenal,this.match.snapshot(),roomId)));
 this.startClock();
 return new Response(null,{status:101,webSocket:client});
 }
 expireSeats(now){
  for(const [id,expiry] of this.disconnected){
    if(now<expiry)continue;
    this.match.leave(id);
    this.disconnected.delete(id);
  }
 }
 welcome(id,arsenal,snapshot,roomId){
  return {type:'welcome',id,roomId,config:{mapId:this.match.map.id,duration:this.match.duration,difficulty:this.match.difficulty},snapshot,arsenal};
 }
 persistConfig(){
  const match=this.match;
  const intermission=!match.public&&match.phase==='results';
  this.lastRound=match.round;
  this.config={...this.config,...match.settings,mapId:match.map.id,round:match.round,intermission,
   nextSettings:intermission?match.nextSettings:null};
  this.ctx.storage.put('config',this.config);
 }
 recordCompletedRound(){
  const match=this.match;
  if(match.phase!=='results'||this.reportedRound===match.round)return;
  this.reportedRound=match.round;
  const report=roundRecord(match,crypto.randomUUID());
  if(!report.players.length)return;
  this.ctx.waitUntil(Promise.all([
    this.ctx.storage.put('report:'+report.id,report),
    this.ctx.storage.setAlarm(Date.now()+1000)
  ]));
 }
 async alarm(){
  const reports=await this.ctx.storage.list({prefix:'report:',limit:20});
  // Arm the retry before contacting the hub so an interrupted flush can resume.
  if(reports.size)await this.ctx.storage.setAlarm(Date.now()+30_000);
  for(const [key,report] of reports){
    const result=await playerHub(this.env).fetch('https://players/internal/record',{
      method:'POST',body:JSON.stringify(report)
    });
    if(!result.ok)throw new Error('Could not save match result');
    await this.ctx.storage.delete(key);
  }
 }
 startClock(){if(this.clock)return;this.previous=Date.now();this.accumulator=0;this.clock=setInterval(()=>{const now=Date.now();this.accumulator+=Math.min((now-this.previous)/1000,.1);this.previous=now;this.expireSeats(now);while(this.accumulator>=1/120){this.match.step();this.accumulator-=1/120;}this.recordCompletedRound();const waiting=!this.match.public&&this.match.phase==='results';
 if(this.lastRound!==this.match.round||waiting!==Boolean(this.config.intermission))this.persistConfig();
 if(waiting&&now<(this.nextResultsSnapshot??0))return;
 this.nextResultsSnapshot=waiting?now+125:0;
 const snapshot=this.match.snapshot();for(const [id,c]of this.clients){const actor=this.match.actors.find(a=>a.id===id);try{if(c.round!==this.match.round){c.round=this.match.round;c.eventId=this.match.eventId;c.socket.send(JSON.stringify(this.welcome(id,actor?.arsenal,snapshot,c.roomId)));continue;}if(!c.probeTime||now-c.probeTime>3000){c.probe=crypto.randomUUID();c.probeTime=now;c.socket.send(JSON.stringify({type:'probe',n:c.probe}));}c.socket.send(JSON.stringify({type:'snapshot',...snapshot,arsenal:actor?.arsenal,events:this.match.events.filter(e=>e.n>c.eventId)}));c.eventId=this.match.eventId;}catch{c.socket.close();}}},1000/30);}
}
