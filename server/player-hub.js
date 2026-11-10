import {RankedLadder} from './ranked.js';
const DAY = 86_400_000;
const WINDOW = 600_000;
const HANDLE = /^[a-z0-9_]{3,16}$/;
const KEY = /^[a-f0-9]{64}$/;
const fields = 'handle, display_name AS name';

export const playerHub = env => env.PLAYERS.get(env.PLAYERS.idFromName('players'));
const reply = (value, status = 200) => Response.json(value, {status});
const fail = (error, status) => reply({error}, status);
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const secret = () => hex(crypto.getRandomValues(new Uint8Array(32)));
async function hash(value) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
const handleOf = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/^@/, '') : '';
const nameOf = value => typeof value === 'string' ? Array.from(value.toWellFormed().replace(/[\x00-\x1f\x7f<>]/g, '').trim()).slice(0,16).join('') : '';

export class PlayerHub {
  constructor(ctx) {
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        handle TEXT PRIMARY KEY, display_name TEXT NOT NULL, key_hash TEXT UNIQUE NOT NULL
      );
      CREATE TABLE IF NOT EXISTS credentials (
        hash TEXT PRIMARY KEY, handle TEXT NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL,
        parent_hash TEXT
      );
      CREATE INDEX IF NOT EXISTS credential_expiry ON credentials(expires);
      CREATE INDEX IF NOT EXISTS credential_parent ON credentials(parent_hash);
      CREATE TABLE IF NOT EXISTS auth_limits (
        subject TEXT PRIMARY KEY, bucket INTEGER NOT NULL, attempts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS auth_limit_bucket ON auth_limits(bucket);
      CREATE TABLE IF NOT EXISTS friendships (
        first TEXT NOT NULL, second TEXT NOT NULL, requester TEXT NOT NULL, accepted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (first, second)
      );
      CREATE INDEX IF NOT EXISTS friendships_second ON friendships(second);
      CREATE TABLE IF NOT EXISTS invites (
        sender TEXT NOT NULL, recipient TEXT NOT NULL, code TEXT NOT NULL, expires INTEGER NOT NULL,
        PRIMARY KEY (sender, recipient)
      );
      CREATE INDEX IF NOT EXISTS invites_recipient ON invites(recipient, expires);
      CREATE TABLE IF NOT EXISTS stats (
        handle TEXT NOT NULL, playlist TEXT NOT NULL, matches INTEGER DEFAULT 0, wins INTEGER DEFAULT 0,
        kills INTEGER DEFAULT 0, deaths INTEGER DEFAULT 0, human_kills INTEGER DEFAULT 0,
        shots INTEGER DEFAULT 0, hits INTEGER DEFAULT 0, headshots INTEGER DEFAULT 0,
        best_streak INTEGER DEFAULT 0, best_score INTEGER DEFAULT 0,
        PRIMARY KEY (handle, playlist)
      );
      CREATE INDEX IF NOT EXISTS rankings ON stats(playlist, human_kills DESC, wins DESC, handle);
      CREATE TABLE IF NOT EXISTS recorded_matches (id TEXT PRIMARY KEY);
    `);
  }

  get ranked(){return this.ladder??=new RankedLadder(this.storage);}

  one(query, ...args) { return this.sql.exec(query, ...args).toArray()[0]; }

  async issue(handle, kind, lifetime, parent = null) {
    const token = secret();
    const digest = await hash(token);
    const now = Date.now();
    this.sql.exec('DELETE FROM credentials WHERE expires <= ?', now);
    if (parent && !this.one("SELECT 1 FROM credentials WHERE hash=? AND kind='session'", parent)) return null;
    this.sql.exec('INSERT INTO credentials VALUES (?, ?, ?, ?, ?)', digest, handle, kind, now + lifetime, parent);
    return token;
  }

  async authenticate(request) {
    const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!token) return null;
    const digest = await hash(token);
    const row = this.one("SELECT handle FROM credentials WHERE hash=? AND kind='session' AND expires>?", digest, Date.now());
    return row ? {handle:row.handle, digest} : null;
  }

  async limit(request) {
    const subject = await hash(request.headers.get('X-Witty-Rate-Source') || 'local');
    const bucket = Math.floor(Date.now() / WINDOW);
    this.sql.exec('DELETE FROM auth_limits WHERE bucket < ?', bucket - 1);
    const row = this.one(`INSERT INTO auth_limits VALUES (?, ?, 1)
      ON CONFLICT(subject) DO UPDATE SET attempts=CASE WHEN bucket=excluded.bucket THEN attempts+1 ELSE 1 END,
      bucket=excluded.bucket RETURNING attempts`, subject, bucket);
    return row.attempts <= 15;
  }

  profile(handle) {
    return this.one('SELECT ' + fields + ' FROM profiles WHERE handle=?', handle);
  }

  friends(handle) {
    return this.sql.exec(`SELECT p.handle, p.display_name AS name,
        CASE WHEN f.accepted THEN 'friend' WHEN f.requester=? THEN 'sent' ELSE 'received' END AS status
      FROM friendships f JOIN profiles p ON p.handle=CASE WHEN f.first=? THEN f.second ELSE f.first END
      WHERE f.first=? OR f.second=? ORDER BY p.handle`, handle, handle, handle, handle).toArray();
  }

  changeFriend(me, body) {
    const handle = handleOf(body.handle);
    if (handle === me || !HANDLE.test(handle) || !this.profile(handle)) return fail('Enter another player’s exact @handle.', 404);
    const [first, second] = [me, handle].sort();
    const existing = this.one('SELECT requester, accepted FROM friendships WHERE first=? AND second=?', first, second);
    if (body.action === 'request') {
      if (existing) return fail('There’s already a friendship or request for this player.', 409);
      const full = [me, handle].some(player => this.one(
        'SELECT COUNT(*) AS count FROM friendships WHERE first=? OR second=?', player, player).count >= 100);
      if (full) return fail('This friend list is full.', 409);
      this.sql.exec('INSERT INTO friendships (first, second, requester) VALUES (?, ?, ?)', first, second, me);
    } else if (body.action === 'accept') {
      if (!existing || existing.accepted || existing.requester === me) return fail('That incoming request is unavailable.', 409);
      this.sql.exec('UPDATE friendships SET accepted=1 WHERE first=? AND second=?', first, second);
    } else if (body.action === 'remove') {
      this.storage.transactionSync(() => {
        this.sql.exec('DELETE FROM friendships WHERE first=? AND second=?', first, second);
        this.sql.exec('DELETE FROM invites WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)',me,handle,handle,me);
      });
    } else return fail('Unknown friend action.', 400);
    return reply({friends:this.friends(me)});
  }

  invites(handle) {
    return this.sql.exec(`SELECT i.sender AS handle, p.display_name AS name, i.code
      FROM invites i JOIN profiles p ON p.handle=i.sender
      WHERE i.recipient=? AND i.expires>? ORDER BY i.expires DESC`,handle,Date.now()).toArray();
  }

  changeInvite(me, body) {
    const handle = handleOf(body.handle);
    if(body.action==='dismiss'){
      this.sql.exec('DELETE FROM invites WHERE sender=? AND recipient=?',handle,me);
      return reply({invites:this.invites(me)});
    }
    if(typeof body.code!=='string'||!/^[A-Z2-9]{8}$/.test(body.code))return fail('Choose an invite room first.',400);
    const [first,second]=[me,handle].sort();
    if(!this.one('SELECT 1 FROM friendships WHERE first=? AND second=? AND accepted=1',first,second)) {
      return fail('Only accepted friends can receive room invites.',403);
    }
    const now=Date.now();
    this.sql.exec('DELETE FROM invites WHERE expires<=?',now);
    this.sql.exec(`INSERT INTO invites VALUES (?, ?, ?, ?) ON CONFLICT(sender, recipient)
      DO UPDATE SET code=excluded.code, expires=excluded.expires`,me,handle,body.code,now+20*60_000);
    return reply({ok:true});
  }

  record(report) {
    if (!['public','custom'].includes(report.playlist) || !Array.isArray(report.players) || report.players.length > 8) {
      return fail('Invalid match result.', 400);
    }
    this.storage.transactionSync(() => {
      const first = this.one('INSERT OR IGNORE INTO recorded_matches VALUES (?) RETURNING id', report.id);
      if (!first) return;
      for (const p of report.players) {
        if (!this.profile(p.handle)) continue;
        this.sql.exec(`INSERT INTO stats VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(handle, playlist) DO UPDATE SET
            matches=matches+1, wins=wins+excluded.wins, kills=kills+excluded.kills, deaths=deaths+excluded.deaths,
            human_kills=human_kills+excluded.human_kills, shots=shots+excluded.shots, hits=hits+excluded.hits,
            headshots=headshots+excluded.headshots, best_streak=MAX(best_streak,excluded.best_streak),
            best_score=MAX(best_score,excluded.best_score)`,
          p.handle, report.playlist, Number(p.won), p.kills, p.deaths, p.humanKills, p.shots, p.hits,
          p.headshots, p.bestStreak, p.score);
      }
    });
    return reply({ok:true});
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    const method = request.method;
    if (path.startsWith('/internal/ranked-') && method === 'POST') {
      const body=await request.json();
      if(path==='/internal/ranked-info'){
        const info=this.ranked.info(body.id,body.handle);
        return info?reply(info):fail('Ranked seat unavailable.',404);
      }
      if(path==='/internal/ranked-start')return reply({ok:this.ranked.start(body.id)});
      if(path==='/internal/ranked-void'){this.ranked.void(body.id);return reply({ok:true});}
      if(path==='/internal/ranked-record'){this.ranked.record(body);return reply({ok:true});}
    }
    if(path==='/ranked-ladder'&&method==='GET')return reply({ranks:this.ranked.ladder()});
    if (path === '/internal/record' && method === 'POST') return this.record(await request.json());
    if (path === '/internal/redeem' && method === 'POST') {
      const {ticket} = await request.json();
      if (typeof ticket !== 'string' || !KEY.test(ticket)) return fail('Play ticket expired.', 401);
      const ticketHash = await hash(ticket);
      const row = this.one("DELETE FROM credentials WHERE hash=? AND kind='ticket' AND expires>? RETURNING handle", ticketHash, Date.now());
      return row ? reply(this.profile(row.handle)) : fail('Play ticket expired.', 401);
    }
    if (path === '/rankings' && method === 'GET') {
      const ranks = this.sql.exec(`SELECT p.handle, p.display_name AS name, s.human_kills AS eliminations, s.wins, s.matches
        FROM stats s JOIN profiles p USING(handle) WHERE playlist='public' AND human_kills>0
        ORDER BY human_kills DESC, wins DESC, handle LIMIT 25`).toArray();
      return reply({ranks});
    }

    if (method === 'POST' && (path === '/create' || path === '/sign-in')) {
      if (!await this.limit(request)) return fail('Too many attempts. Try again in a few minutes.', 429);
      const body = await request.json();
      if (path === '/sign-in') {
        const key = typeof body.key === 'string' ? body.key.trim().toLowerCase() : '';
        const row = KEY.test(key) && this.one('SELECT handle FROM profiles WHERE key_hash=?', await hash(key));
        if (!row) return fail('That sign-in key didn’t match an account.', 401);
        return reply({session:await this.issue(row.handle,'session',30*DAY),profile:this.profile(row.handle)});
      }
      const handle = handleOf(body.handle), name = nameOf(body.name);
      if (!HANDLE.test(handle) || name.length < 2) return fail('Use a 3–16 character handle and a callsign of at least 2 characters.', 400);
      const key = body.key;
      if (typeof key !== 'string' || !KEY.test(key)) return fail('A valid sign-in key is required.',400);
      const keyHash = await hash(key);
      if (!this.one('INSERT OR IGNORE INTO profiles VALUES (?, ?, ?) RETURNING handle',handle,name,keyHash) &&
          !this.one('SELECT 1 FROM profiles WHERE handle=? AND key_hash=?',handle,keyHash)) {
        return fail('That handle is already taken.', 409);
      }
      return reply({session:await this.issue(handle,'session',30*DAY),profile:this.profile(handle)},201);
    }

    const session = await this.authenticate(request);
    if (!session) return fail('Sign in to use your player account.', 401);
    const {handle,digest} = session;
    if(path==='/ranked-queue'&&method==='POST')return reply(this.ranked.queue(handle,(await request.json()).action));
    if(path==='/ranked-result'&&method==='POST')return reply({result:this.ranked.result((await request.json()).id,handle)});
    if (path === '/ticket' && method === 'POST') {
      const ticket = await this.issue(handle,'ticket',90_000,digest);
      return ticket ? reply({ticket}) : fail('Sign in again.',401);
    }
    if (path === '/sign-out' && method === 'POST') {
      this.sql.exec('DELETE FROM credentials WHERE hash=? OR parent_hash=?', digest, digest);
      return reply({ok:true});
    }
    if (path === '/profile' && method === 'GET') {
      return reply({
        profile:this.profile(handle),
        ranked:this.ranked.standing(handle),
        stats:this.sql.exec('SELECT * FROM stats WHERE handle=?',handle).toArray(),
        friends:this.friends(handle),
        invites:this.invites(handle)
      });
    }
    if (path === '/profile' && method === 'PATCH') {
      const name = nameOf((await request.json()).name);
      if (name.length < 2) return fail('Enter a callsign of at least 2 characters.',400);
      this.sql.exec('UPDATE profiles SET display_name=? WHERE handle=?',name,handle);
      return reply({profile:this.profile(handle)});
    }
    if (path === '/invites' && method === 'POST') return this.changeInvite(handle,await request.json());
    if (path === '/friends' && method === 'POST') return this.changeFriend(handle,await request.json());
    return fail('Player Hub route not found.',404);
  }
}
