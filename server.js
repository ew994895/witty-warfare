import {Match} from './server/match.js';
import {QuickPlay} from './server/quick-play.js';
const sessionId=req=>new URL(req.url).searchParams.get('session');
const validSession=id=>/^[a-zA-Z0-9-]{20,64}$/.test(id||'');
const allowedOrigin=(req,env)=>{const origin=req.headers.get('Origin');return !origin||origin===new URL(req.url).origin||origin==='https://witty-warfare.pages.dev';};
const json=(data,status=200,origin='')=>Response.json(data,{status,headers:{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Cache-Control':'no-store'}});
export default {async fetch(req,env){const url=new URL(req.url);if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(req);const origin=req.headers.get('Origin')||'';if(!allowedOrigin(req,env))return json({error:'Origin not allowed'},403);if(req.method==='OPTIONS')return new Response(null,{headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'}});
 if(url.pathname==='/api/health')return json({ok:true,version:1},200,origin);
 if(url.pathname==='/api/rooms'&&req.method==='POST'){if(Number(req.headers.get('content-length'))>2048)return json({error:'Request too large'},413,origin);let config;try{config=await req.json();}catch{return json({error:'Invalid room settings'},400,origin);}const bytes=crypto.getRandomValues(new Uint8Array(8)),alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',code=[...bytes].map(b=>alphabet[b%32]).join('');const room=env.ROOMS.get(env.ROOMS.idFromName(code));await room.fetch(new Request('https://room/init',{method:'POST',body:JSON.stringify({mapId:config?.mapId,duration:config?.duration,difficulty:config?.difficulty})}));return json({code},201,origin);}
 if(req.headers.get('Upgrade')?.toLowerCase()==='websocket'){
   const custom=url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{8})\/socket$/);
   if(custom)return env.ROOMS.get(env.ROOMS.idFromName(custom[1])).fetch(req);
   const publicRoom=url.pathname.match(/^\/api\/quick-play\/([a-f0-9-]{36})$/);
   if(publicRoom)return env.ROOMS.get(env.ROOMS.idFromName('public:'+publicRoom[1])).fetch(req);
   if(url.pathname==='/api/quick-play'){
     if(!validSession(sessionId(req)))return json({error:'Invalid session'},400,origin);
     return env.ROOMS.get(env.ROOMS.idFromName('public-directory')).fetch(req);
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
  const id=sessionId(req);
  if(!validSession(id))return Response.json({error:'Invalid session'},{status:400});
  if(url.pathname==='/quick-start'&&!this.config){
    const config={mapId:'dust-court',duration:180,difficulty:'normal',public:true};
    await this.ctx.storage.put('config',config);
    this.config=config;
    this.match=new Match(config);
  }
  this.expireSeats(Date.now());
  const idlePublic=this.config?.public&&!this.clients.size&&!this.disconnected.size;
  if(!this.match||(idlePublic&&url.pathname!=='/quick-start')){
    return Response.json({error:'Room not found. Check the code or create a room.'},{status:404});
  }
  const a=this.match.join(id,url.searchParams.get('name'),Number(url.searchParams.get('primary')));if(!a)return Response.json({error:'This room is full'},{status:409});const pair=new WebSocketPair(),[client,socket]=Object.values(pair);socket.accept();const old=this.clients.get(id);if(old)old.socket.close(4000,'Reconnected elsewhere');const state={socket,eventId:this.match.eventId,round:this.match.round,tokens:90,tokenTime:Date.now()};this.clients.set(id,state);this.disconnected.delete(id);
 socket.addEventListener('message',event=>{if(this.clients.get(id)!==state)return;const now=Date.now();state.tokens=Math.min(90,state.tokens+(now-state.tokenTime)*.06);state.tokenTime=now;if(state.tokens<1||typeof event.data!=='string'||event.data.length>16000){socket.close(1008,'Too many messages');return;}state.tokens--;let data;try{data=JSON.parse(event.data);}catch{return;}if(!data||typeof data!=='object')return;if(data.type==='probeReply'&&data.n===state.probe){const actor=this.match.actors.find(a=>a.id===id);if(actor)actor.rtt=Math.min(.5,(Date.now()-state.probeTime)/1000);state.probe=null;}if(data.type==='inputs')this.match.inputs(id,data.frames);if(data.type==='loadout')this.match.setLoadout(id,data.primary,data.respawn===true);if(data.type==='vote')this.match.vote(id,data.mapId,data.round);if(data.type==='restart')this.match.restart(id);if(data.type==='ping')socket.send(JSON.stringify({type:'pong',at:data.at}));});
 const close=event=>{
  try{socket.close(1000,'Connection closed');}catch{}
  if(this.clients.get(id)!==state)return;
  this.clients.delete(id);
  if(this.config.public&&event.code===1000&&event.reason==='Left room'){
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
 startClock(){if(this.clock)return;this.previous=Date.now();this.accumulator=0;this.clock=setInterval(()=>{const now=Date.now();this.accumulator+=Math.min((now-this.previous)/1000,.1);this.previous=now;this.expireSeats(now);while(this.accumulator>=1/120){this.match.step();this.accumulator-=1/120;}if(this.lastRound!==this.match.round){this.lastRound=this.match.round;this.config.mapId=this.match.map.id;this.ctx.storage.put('config',this.config);}const snapshot=this.match.snapshot();for(const [id,c]of this.clients){const actor=this.match.actors.find(a=>a.id===id);try{if(c.round!==this.match.round){c.round=this.match.round;c.eventId=this.match.eventId;c.socket.send(JSON.stringify(this.welcome(id,actor?.arsenal,snapshot,c.roomId)));continue;}if(!c.probeTime||now-c.probeTime>3000){c.probe=crypto.randomUUID();c.probeTime=now;c.socket.send(JSON.stringify({type:'probe',n:c.probe}));}c.socket.send(JSON.stringify({type:'snapshot',...snapshot,arsenal:actor?.arsenal,events:this.match.events.filter(e=>e.n>c.eventId)}));c.eventId=this.match.eventId;}catch{c.socket.close();}}},1000/30);}
}
