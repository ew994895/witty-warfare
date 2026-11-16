import app, {ArenaRoom as RealArenaRoom, PlayerHub as RealPlayerHub} from '../server.js';

export class ArenaRoom extends RealArenaRoom {
  async startParty(){
    await super.startParty();
    if(this.env.SQUAD_TEST_SHORT_ROUND==='1'&&this.match.phase==='playing')this.match.remaining=5;
  }
}
export class PlayerHub extends RealPlayerHub {
  constructor(ctx, env) {
    super(ctx, {...env,GOOGLE_CLIENT_ID:'local-test.apps.googleusercontent.com'});
    this.verifyGoogle=async credential=>{
      const {subject,nonce}=JSON.parse(credential);
      if(!/^qa-[a-f0-9-]+$/.test(subject)||!/^[a-f0-9]{64}$/.test(nonce))throw new Error('Invalid fixture identity');
      return {subject,nonce};
    };
  }
}

// Run only as the alternate entry point for localhost integration tests.
export default {
  fetch(request,env){
    const host=new URL(request.url).hostname;
    if(host!=='localhost'&&host!=='127.0.0.1')return new Response(null,{status:404});
    return app.fetch(request,env);
  }
};
