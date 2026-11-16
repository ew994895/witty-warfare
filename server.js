import {Match} from './server/match.js';
import {QuickPlay} from './server/quick-play.js';
import {gameRules,roomSettings,teamWinner} from './dist/rules.js';
import {PLAYER_DATA_EPOCH,playerHub} from './server/player-hub.js';
import {roundRecord} from './server/round-record.js';
export {PlayerHub} from './server/player-hub.js';
const accountPaths=new Set(['sign-out','profile','ticket','friends','invites','squad','rankings','ranked-ladder','ranked-queue','ranked-result','sign-in-options','google-challenge','google-sign-in','google-enroll']);

async function accountRequest(request, env, path, origin){
  const headers=new Headers();
  const authorization=request.headers.get('Authorization');
  if(authorization)headers.set('Authorization',authorization);
  headers.set('X-Witty-Rate-Source',request.headers.get('CF-Connecting-IP')||'local');
  let body;
  if(request.method==='POST'||request.method==='PATCH'){
    const max=path==='google-sign-in'?8192:2048;
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
const rankedRequest=(env,action,body)=>playerHub(env).fetch('https://players/internal/ranked-'+action,{
  method:'POST',body:JSON.stringify(body)
});
const squadRequest=(env,action,body)=>playerHub(env).fetch('https://players/internal/squad-'+action,{
  method:'POST',body:JSON.stringify(body)
});
const quickDirectory=rules=>rules==='ffa'?'public-directory':'public-directory-'+rules;
const sessionId=req=>new URL(req.url).searchParams.get('session');
const validSession=id=>/^[a-zA-Z0-9-]{20,64}$/.test(id||'');
async function playerId(roomId, session){
  // Snapshots expose player IDs, while the guest session is a private credential.
  const input=new TextEncoder().encode(roomId+':'+session);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',input),0,16);
  return Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('');
}
const allowedOrigin=(req,env)=>{
  const origin=req.headers.get('Origin');
  return !origin||origin===new URL(req.url).origin||origin==='https://witty-warfare.pages.dev'||origin===env.WITTY_WEB_ORIGIN;
};
const json=(data,status=200,origin='')=>Response.json(data,{status,headers:{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Cache-Control':'no-store'}});
export default {async fetch(req,env){const url=new URL(req.url);if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(req);const origin=req.headers.get('Origin')||'';if(!allowedOrigin(req,env))return json({error:'Origin not allowed'},403);if(req.method==='OPTIONS')return new Response(null,{headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, PATCH, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Vary':'Origin'}});
 const accountPath=url.pathname.match(/^\/api\/account\/([a-z-]+)$/)?.[1];
 if(accountPaths.has(accountPath))return accountRequest(req,env,accountPath,origin);
 if(url.pathname==='/api/health')return json({ok:true,version:1},200,origin);
 if(url.pathname==='/api/rooms'&&req.method==='POST'){if(Number(req.headers.get('content-length'))>2048)return json({error:'Request too large'},413,origin);let config;try{config=await req.json();}catch{return json({error:'Invalid room settings'},400,origin);}const bytes=crypto.getRandomValues(new Uint8Array(8)),alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',code=[...bytes].map(b=>alphabet[b%32]).join('');const room=env.ROOMS.get(env.ROOMS.idFromName(code));await room.fetch(new Request('https://room/init',{method:'POST',body:JSON.stringify({mapId:config?.mapId,...roomSettings(config??{})})}));return json({code},201,origin);}
 if(req.headers.get('Upgrade')?.toLowerCase()==='websocket'){
   req=await withPlayerIdentity(req,env);
   if(!req)return json({error:'Play ticket expired'},401,origin);
   const ranked=url.pathname.match(/^\/api\/ranked\/([a-f0-9-]{36})\/socket$/);
   if(ranked){
     const handle=req.headers.get('X-Witty-Account');
     if(!handle)return json({error:'Sign in to play Ranked'},401,origin);
     return env.ROOMS.get(env.ROOMS.idFromName('ranked:'+ranked[1])).fetch(req);
   }
   const custom=url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{8})\/socket$/);
   if(custom)return env.ROOMS.get(env.ROOMS.idFromName(custom[1])).fetch(req);
   const publicRoom=url.pathname.match(/^\/api\/quick-play\/([a-f0-9-]{36})$/);
   if(publicRoom)return env.ROOMS.get(env.ROOMS.idFromName('public:'+publicRoom[1])).fetch(req);
   const squadRoom=url.pathname.match(/^\/api\/party-play\/([a-f0-9-]{36})$/);
   if(squadRoom){
     if(!req.headers.has('X-Witty-Account'))return json({error:'Sign in to play with a squad.'},401,origin);
     return env.ROOMS.get(env.ROOMS.idFromName('public:'+squadRoom[1])).fetch(req);
   }
   if(url.pathname==='/api/quick-play'){
     if(!validSession(sessionId(req)))return json({error:'Invalid session'},400,origin);
     const rules=gameRules(url.searchParams.get('rules'));
     return env.ROOMS.get(env.ROOMS.idFromName(quickDirectory(rules))).fetch(req);
   }
 }
 return json({error:'Room not found'},404,origin);
}};
export class ArenaRoom{
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.match=null;this.clients=new Map();this.disconnected=new Map();this.clock=null;this.previous=0;this.accumulator=0;this.config=null;this.ready=ctx.blockConcurrencyWhile(async()=>{this.config=await ctx.storage.get('config');if(this.config)this.match=new Match(this.config);});}
 async fetch(req){
  await this.ready;
  const url=new URL(req.url);
  if(url.pathname==='/quick-register'){
    const {room}=await req.json();
    this.quickPlay??=new QuickPlay(this.ctx.storage,this.env.ROOMS);
    await this.quickPlay.register(room);
    return Response.json({ok:true});
  }
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
  const squadRoom=url.pathname.startsWith('/api/party-play/')?url.pathname.split('/').at(-1):null;
  if(squadRoom){
    if(!this.config){
      const {launch}=await (await squadRequest(this.env,'room',{room:squadRoom,handle:account})).json();
      if(!launch)return Response.json({error:'Squad launch is unavailable.'},{status:404});
      if(!this.config){
        this.config={public:true,mapId:'dust-court',rules:launch.rules,partySeats:launch.seats,deadline:launch.deadline,partyRoom:squadRoom};
        this.match=new Match(this.config);
        await this.ctx.storage.put('config',this.config);
      }
    }
    if(!this.config.partySeats?.includes(account))return Response.json({error:'No squad seat was reserved for you.'},{status:403});
  }
  if(this.config?.partySeats&&this.match.phase==='staging'){
    if(!squadRoom)return Response.json({error:'Squad is still connecting.'},{status:409});
    if(this.partyCancelled||this.config.deadline<=Date.now())return Response.json({error:'Squad reservation expired.'},{status:404});
  }
  if(url.pathname.startsWith('/api/ranked/')){
    if(!account)return Response.json({error:'Sign in to play Ranked'},{status:401});
    const id=url.pathname.split('/')[3];
    const response=await rankedRequest(this.env,'info',{id,handle:account});
    if(!response.ok)return response;
    const info=await response.json();
    if(info.state==='playing'&&(!this.match||this.match.phase==='staging')){
      if(!this.rankedStarting){
        if(await this.ctx.storage.get('report:'+id))return Response.json({error:'Ranked result is being saved.'},{status:409});
        await rankedRequest(this.env,'void',{id});
        return Response.json({error:'The ranked match was interrupted.'},{status:410});
      }
    }
    if(!this.config){
      const config={ranked:true,rankedId:id,rules:'tdm',botCount:0,mapId:info.map,seats:info.seats,deadline:info.deadline};
      this.config=config;
      this.match=new Match(config);
    }
  }
  const id=await playerId(this.ctx.id.toString(),account?'account:'+account:session);
  this.expireSeats(Date.now());
  const idlePublic=this.config?.public&&!this.clients.size&&!this.disconnected.size;
  if(!this.match||(idlePublic&&url.pathname!=='/quick-start'&&!squadRoom)){
    return Response.json({error:'Room not found. Check the code or create a room.'},{status:404});
  }
  const a=this.match.join(id,name,Number(url.searchParams.get('primary')),account,Boolean(squadRoom));if(!a)return Response.json({error:'This room is full'},{status:409});const pair=new WebSocketPair(),[client,socket]=Object.values(pair);socket.accept();const old=this.clients.get(id);if(old)old.socket.close(4000,'Reconnected elsewhere');const state={socket,eventId:this.match.eventId,round:this.match.round,tokens:90,tokenTime:Date.now()};this.clients.set(id,state);this.disconnected.delete(id);
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
    if(this.config.partySeats&&this.match.phase==='staging')this.ctx.waitUntil(this.cancelParty());
  }else{
    this.disconnected.set(id,Date.now()+15000);
    this.match.disconnect(id);
  }
  if(!this.clients.size&&(!this.match.ranked||this.match.phase==='results'))this.stopClock();
 };
 socket.addEventListener('close',close);
 socket.addEventListener('error',close);
 const roomId=this.config.public?(url.pathname.startsWith('/api/')?url.pathname.split('/').at(-1):url.searchParams.get('assignedRoom')):undefined;
 state.roomId=roomId;
 socket.send(JSON.stringify(this.welcome(id,a.arsenal,this.match.snapshot(),roomId)));
 this.startClock();
 if(this.match.ranked&&this.clients.size===this.config.seats.length&&!this.rankedStarting&&this.match.phase==='staging'){
   this.rankedStarting=true;
   this.ctx.waitUntil(this.startRanked());
 }
 if(this.config.partySeats&&this.clients.size===this.config.partySeats.length&&!this.partyStarting&&this.match.phase==='staging'){
   this.partyStarting=true;
   this.ctx.waitUntil(this.startParty());
 }
 return new Response(null,{status:101,webSocket:client});
 }
 async startParty(){
  const room=this.config.partyRoom;
  try{
    const response=await squadRequest(this.env,'start',{room});
    if(!(await response.json()).ok||this.partyCancelled||this.clients.size!==this.config.partySeats.length){
      await this.cancelParty();
      return;
    }
    this.config.partyStarted=true;
    this.match.phase='playing';
    for(const actor of this.match.actors)this.match.respawn(actor);
    await this.ctx.storage.put('config',this.config);
  }catch{
    await this.cancelParty();
    return;
  }
  const directory=this.env.ROOMS.get(this.env.ROOMS.idFromName(quickDirectory(this.match.settings.rules)));
  await directory.fetch('https://room/quick-register',{method:'POST',body:JSON.stringify({room})});
 }
 async cancelParty(){
  if(this.partyCancelled||this.match.phase!=='staging')return;
  this.partyCancelled=true;
  this.stopClock();
  for(const {socket} of this.clients.values())socket.close(4005,'Squad launch cancelled');
  await squadRequest(this.env,'stop',{room:this.config.partyRoom});
 }
 async startRanked(){
  const id=this.config.rankedId;
  try{
    const response=await rankedRequest(this.env,'start',{id});
    if(!(await response.json()).ok||!this.match.startRanked()){
      await this.cancelRanked();
    }else{
      for(const actorId of this.disconnected.keys())this.match.disconnect(actorId);
    }
  }catch{
    await this.cancelRanked();
  }finally{this.rankedStarting=false;}
 }
 async cancelRanked(){
  this.stopClock();
  for(const {socket} of this.clients.values())socket.close(4004,'Ranked match cancelled');
  await rankedRequest(this.env,'void',{id:this.config.rankedId});
 }
 stopClock(){clearInterval(this.clock);this.clock=null;}
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
  const report={...roundRecord(match,match.ranked?this.config.rankedId:crypto.randomUUID()),epoch:PLAYER_DATA_EPOCH};
  if(match.ranked)Object.assign(report,{
    ranked:true,winner:teamWinner(match.teamScores),
    abandoned:match.humans().filter(actor=>actor.abandoned).map(actor=>actor.account)
  });
  if(!report.ranked&&!report.players.length)return;
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
    const result=await playerHub(this.env).fetch('https://players/internal/'+(report.ranked?'ranked-record':'record'),{
      method:'POST',body:JSON.stringify(report)
    });
    if(!result.ok)throw new Error('Could not save match result');
    await this.ctx.storage.delete(key);
  }
 }
 startClock(){if(this.clock)return;this.previous=Date.now();this.accumulator=0;this.clock=setInterval(()=>{const now=Date.now();this.accumulator+=Math.min((now-this.previous)/1000,.1);this.previous=now;
 if(this.config.partySeats&&this.match.phase==='staging'&&now>=this.config.deadline){
   this.ctx.waitUntil(this.cancelParty());
   return;
 }
 if(this.match.ranked&&this.match.phase==='staging'&&now>=this.config.deadline&&!this.rankedStarting){
   this.ctx.waitUntil(this.cancelRanked());
   return;
 }
 this.expireSeats(now);while(this.accumulator>=1/120){this.match.step();this.accumulator-=1/120;}this.recordCompletedRound();const waiting=!this.match.public&&this.match.phase==='results';
 if(this.match.ranked&&!this.clients.size&&waiting){this.stopClock();return;}
 if(!this.match.ranked&&(this.lastRound!==this.match.round||waiting!==Boolean(this.config.intermission)))this.persistConfig();
 if(waiting&&now<(this.nextResultsSnapshot??0))return;
 this.nextResultsSnapshot=waiting?now+125:0;
 const snapshot=this.match.snapshot();for(const [id,c]of this.clients){const actor=this.match.actors.find(a=>a.id===id);try{if(c.round!==this.match.round){c.round=this.match.round;c.eventId=this.match.eventId;c.socket.send(JSON.stringify(this.welcome(id,actor?.arsenal,snapshot,c.roomId)));continue;}if(!c.probeTime||now-c.probeTime>3000){c.probe=crypto.randomUUID();c.probeTime=now;c.socket.send(JSON.stringify({type:'probe',n:c.probe}));}c.socket.send(JSON.stringify({type:'snapshot',...snapshot,arsenal:actor?.arsenal,events:this.match.events.filter(e=>e.n>c.eventId)}));c.eventId=this.match.eventId;}catch{c.socket.close();}}},1000/30);}
}
