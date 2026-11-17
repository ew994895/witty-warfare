import {GAME_RULES} from '../dist/rules.js';

const CAPACITY=4;
const INVITE_TTL=10*60_000;
const JOIN_TTL=45_000;
const error=(message,status=409)=>({error:message,status});

export class Squads {
  constructor(storage) {
    this.storage=storage;
    this.sql=storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS squads (
        id TEXT PRIMARY KEY, leader TEXT NOT NULL, room TEXT UNIQUE,
        rules TEXT, deadline INTEGER, live INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS squad_members (
        handle TEXT PRIMARY KEY, squad TEXT NOT NULL, joined INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS squad_roster ON squad_members(squad, joined);
      CREATE TABLE IF NOT EXISTS squad_invites (
        squad TEXT NOT NULL, recipient TEXT NOT NULL, sender TEXT NOT NULL, expires INTEGER NOT NULL,
        PRIMARY KEY (squad, recipient)
      );
      CREATE INDEX IF NOT EXISTS squad_invite_recipient ON squad_invites(recipient, expires);
    `);
  }

  one(query,...values){return this.sql.exec(query,...values).toArray()[0];}

  find(handle){
    return this.one('SELECT s.* FROM squads s JOIN squad_members m ON m.squad=s.id WHERE m.handle=?',handle);
  }

  members(id){
    return this.sql.exec(`SELECT m.handle,p.display_name AS name
      FROM squad_members m JOIN profiles p USING(handle) WHERE m.squad=? ORDER BY m.joined,m.handle`,id).toArray();
  }

  clearLaunch(id){
    this.sql.exec('UPDATE squads SET room=NULL,rules=NULL,deadline=NULL,live=0 WHERE id=?',id);
  }

  expire(group,now){
    if(!group?.room||group.live||group.deadline>now)return group;
    this.clearLaunch(group.id);
    return this.one('SELECT * FROM squads WHERE id=?',group.id);
  }

  state(handle,now=Date.now()){
    const squad=this.expire(this.find(handle),now);
    const members=squad?this.members(squad.id):[];
    const invites=this.sql.exec(`SELECT i.squad,i.sender,p.display_name AS name
      FROM squad_invites i JOIN profiles p ON p.handle=i.sender JOIN squads s ON s.id=i.squad
      WHERE i.recipient=? AND i.expires>? ORDER BY i.expires DESC LIMIT 20`,handle,now).toArray();
    return {
      party:squad?{
        id:squad.id,leader:squad.leader,members,
        match:squad.room?{
          room:squad.room,rules:squad.rules,deadline:squad.deadline,live:Boolean(squad.live),size:members.length,
          canRejoin:Boolean(squad.live&&this.one('SELECT joined FROM squad_members WHERE handle=?',handle).joined<=squad.deadline-JOIN_TTL)
        }:null
      }:null,
      invites,
      sent:squad?.leader===handle?this.sql.exec(
        'SELECT recipient FROM squad_invites WHERE squad=? AND expires>? ORDER BY recipient',squad.id,now
      ).toArray().map(invite=>invite.recipient):[]
    };
  }

  create(handle,now){
    const id=crypto.randomUUID();
    this.sql.exec('INSERT INTO squads (id,leader) VALUES (?,?)',id,handle);
    this.sql.exec('INSERT INTO squad_members (handle,squad,joined) VALUES (?,?,?)',handle,id,now);
    this.sql.exec('DELETE FROM squad_invites WHERE recipient=?',handle);
    return id;
  }

  change(handle,body,now=Date.now()){
    return this.storage.transactionSync(()=>{
      this.sql.exec('DELETE FROM squad_invites WHERE expires<=?',now);
      const squad=this.expire(this.find(handle),now);
      const joining=squad?.room&&!squad.live;
      const leader=squad?.leader===handle;
      switch(body.action){
        case 'create':
          if(!squad)this.create(handle,now);
          break;
        case 'invite': {
          if((squad&&!leader)||joining)return error('The squad leader can invite friends before matchmaking.');
          const friend=typeof body.handle==='string'?body.handle:'';
          const [first,second]=[handle,friend].sort();
          if(!this.one('SELECT 1 FROM friendships WHERE first=? AND second=? AND accepted=1',first,second)){
            return error('Only accepted friends can be invited.',403);
          }
          if(squad&&this.members(squad.id).length>=CAPACITY)return error('The squad is full.');
          if(this.find(friend))return error('That friend is already in a squad.');
          const id=squad?.id??this.create(handle,now);
          const sent=this.one('SELECT COUNT(*) AS count FROM squad_invites WHERE squad=?',id).count;
          if(sent>=12&&!this.one('SELECT 1 FROM squad_invites WHERE squad=? AND recipient=?',id,friend))return error('Wait for some invites to clear before sending more.');
          this.sql.exec('INSERT OR REPLACE INTO squad_invites VALUES (?,?,?,?)',id,friend,handle,now+INVITE_TTL);
          break;
        }
        case 'accept': {
          if(squad)return error('Leave your current squad first.');
          const invite=typeof body.squad==='string'&&this.one('SELECT * FROM squad_invites WHERE squad=? AND recipient=?',body.squad,handle);
          if(!invite)return error('That squad invite has expired.');
          const target=this.expire(this.one('SELECT * FROM squads WHERE id=?',invite.squad),now);
          const [first,second]=[invite.sender,handle].sort();
          if(!target||target.leader!==invite.sender||
            !this.one('SELECT 1 FROM friendships WHERE first=? AND second=? AND accepted=1',first,second))return error('That squad invite is no longer available.');
          if(target.room&&!target.live)return error('That squad is already connecting.');
          if(this.members(target.id).length>=CAPACITY)return error('That squad is full.');
          this.sql.exec('INSERT INTO squad_members (handle,squad,joined) VALUES (?,?,?)',handle,target.id,now);
          this.sql.exec('DELETE FROM squad_invites WHERE recipient=?',handle);
          break;
        }
        case 'decline':
          if(typeof body.squad==='string')this.sql.exec('DELETE FROM squad_invites WHERE squad=? AND recipient=?',body.squad,handle);
          break;
        case 'queue': {
          if(!leader)return error('Only the squad leader can start Quick Play.',403);
          if(joining)break;
          if(!Object.hasOwn(GAME_RULES,body.rules))return error('Choose a Quick Play mode.',400);
          const members=this.members(squad.id);
          if(members.length<2)return error('Invite a friend to start Squad Quick Play.');
          this.sql.exec('UPDATE squads SET room=?,rules=?,deadline=?,live=0 WHERE id=?',crypto.randomUUID(),body.rules,now+JOIN_TTL,squad.id);
          break;
        }
        case 'cancel':
          if(joining)this.clearLaunch(squad.id);
          break;
        case 'leave': {
          if(!squad)break;
          if(joining)this.clearLaunch(squad.id);
          this.sql.exec('DELETE FROM squad_members WHERE handle=?',handle);
          const next=this.members(squad.id)[0];
          if(!next){
            this.sql.exec('DELETE FROM squad_invites WHERE squad=?',squad.id);
            this.sql.exec('DELETE FROM squads WHERE id=?',squad.id);
          }else if(leader){
            this.sql.exec('UPDATE squads SET leader=? WHERE id=?',next.handle,squad.id);
            this.sql.exec('DELETE FROM squad_invites WHERE squad=?',squad.id);
          }
          break;
        }
        default:return error('Unknown squad action.',400);
      }
      return this.state(handle,now);
    });
  }

  lookup(room,handle,now=Date.now()){
    const squad=this.expire(this.find(handle),now);
    if(!squad||squad.room!==room||squad.live)return null;
    return {rules:squad.rules,deadline:squad.deadline,seats:this.members(squad.id).map(member=>member.handle)};
  }

  start(room,now=Date.now()){
    return this.storage.transactionSync(()=>{
      const started=this.one('UPDATE squads SET live=1 WHERE room=? AND live=0 AND deadline>? RETURNING id',room,now);
      return Boolean(started||this.one('SELECT 1 FROM squads WHERE room=? AND live=1',room));
    });
  }

  stop(room){
    this.storage.transactionSync(()=>{
      const squad=this.one('SELECT id FROM squads WHERE room=?',room);
      if(squad)this.clearLaunch(squad.id);
    });
  }
}
