import {MAPS} from '../dist/maps.js';

export const RANKED_SIZE=8, PLACEMENTS=5, BASE_RATING=1000;
const QUEUE_TTL=12_000, READY_TTL=35_000, MATCH_TTL=8*60_000;

export function balancedTeams(players) {
  const sorted=[...players].sort((a,b)=>b.rating-a.rating||a.handle.localeCompare(b.handle));
  return sorted.map((player,i)=>({...player,team:i%4===0||i%4===3?'blue':'red'}));
}

export function ratingDelta(teamRating, opponentRating, result) {
  const expected=1/(1+10**((opponentRating-teamRating)/400));
  return Math.round(32*(result-expected));
}

export class RankedLadder {
  constructor(storage) {
    this.storage=storage;
    this.sql=storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS ranked_ratings (
        handle TEXT PRIMARY KEY, rating INTEGER NOT NULL, played INTEGER NOT NULL, wins INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ranked_order ON ranked_ratings(rating DESC,wins DESC,handle);
      CREATE TABLE IF NOT EXISTS ranked_queue (
        handle TEXT PRIMARY KEY, queued INTEGER NOT NULL, heartbeat INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ranked_heartbeat ON ranked_queue(heartbeat);
      CREATE TABLE IF NOT EXISTS ranked_matches (
        id TEXT PRIMARY KEY, map TEXT NOT NULL, deadline INTEGER NOT NULL, expires INTEGER NOT NULL, state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ranked_seats (
        match_id TEXT NOT NULL, handle TEXT NOT NULL, team TEXT NOT NULL, rating INTEGER NOT NULL,
        PRIMARY KEY(match_id,handle)
      );
      CREATE INDEX IF NOT EXISTS ranked_seat_handle ON ranked_seats(handle);
      CREATE TABLE IF NOT EXISTS ranked_results (
        match_id TEXT NOT NULL, handle TEXT NOT NULL, delta INTEGER NOT NULL, rating INTEGER NOT NULL, played INTEGER NOT NULL,
        PRIMARY KEY(match_id,handle)
      );
    `);
  }

  one(query,...args){return this.sql.exec(query,...args).toArray()[0];}

  standing(handle){
    const row=this.one('SELECT rating,played,wins FROM ranked_ratings WHERE handle=?',handle);
    const played=row?.played||0;
    return {played,wins:row?.wins||0,rating:played>=PLACEMENTS?row.rating:null,placements:PLACEMENTS};
  }

  ladder(){
    return this.sql.exec(`SELECT r.handle,p.display_name AS name,r.rating,r.wins,r.played
      FROM ranked_ratings r JOIN profiles p USING(handle) WHERE played>=?
      ORDER BY rating DESC,wins DESC,handle LIMIT 25`,PLACEMENTS).toArray();
  }

  queue(handle,action,now=Date.now()){
    this.sql.exec('DELETE FROM ranked_queue WHERE heartbeat<=?',now-QUEUE_TTL);
    const existing=this.one(`SELECT m.id,m.state,m.deadline FROM ranked_matches m JOIN ranked_seats s ON s.match_id=m.id
      WHERE s.handle=? AND ((m.state='ready' AND m.deadline>?) OR (m.state='playing' AND m.expires>?))`,handle,now,now);
    if(existing)return {matchId:existing.id};
    if(action==='cancel'){
      this.sql.exec('DELETE FROM ranked_queue WHERE handle=?',handle);
      return {queued:false};
    }
    this.sql.exec(`INSERT INTO ranked_queue VALUES (?,?,?)
      ON CONFLICT(handle) DO UPDATE SET heartbeat=excluded.heartbeat`,handle,now,now);
    const candidates=this.sql.exec(`SELECT q.handle,q.queued,COALESCE(r.rating,?) AS rating
      FROM ranked_queue q LEFT JOIN ranked_ratings r USING(handle) ORDER BY q.queued,q.handle LIMIT 64`,BASE_RATING).toArray();
    for(const anchor of candidates){
      const range=Math.min(850,175+Math.floor((now-anchor.queued)/30000)*100);
      const group=candidates.filter(p=>Math.abs(p.rating-anchor.rating)<=range)
        .sort((a,b)=>Math.abs(a.rating-anchor.rating)-Math.abs(b.rating-anchor.rating)||a.queued-b.queued)
        .slice(0,RANKED_SIZE);
      if(group.length!==RANKED_SIZE)continue;
      const id=crypto.randomUUID();
      const map=MAPS[Math.floor(Math.random()*MAPS.length)].id;
      this.storage.transactionSync(()=>{
        this.sql.exec("INSERT INTO ranked_matches VALUES (?,?,?,?,'ready')",id,map,now+READY_TTL,now+MATCH_TTL);
        for(const seat of balancedTeams(group)){
          this.sql.exec('INSERT INTO ranked_seats VALUES (?,?,?,?)',id,seat.handle,seat.team,seat.rating);
          this.sql.exec('DELETE FROM ranked_queue WHERE handle=?',seat.handle);
        }
      });
      if(group.some(player=>player.handle===handle))return {matchId:id};
      break;
    }
    return {queued:true,count:Math.min(candidates.length,RANKED_SIZE-1)};
  }

  info(id,handle,now=Date.now()){
    const match=this.one(`SELECT m.id,m.map,m.deadline,m.state FROM ranked_matches m JOIN ranked_seats s ON s.match_id=m.id
      WHERE m.id=? AND s.handle=? AND ((m.state='ready' AND m.deadline>?) OR (m.state='playing' AND m.expires>?))`,id,handle,now,now);
    if(!match)return null;
    const seats=this.sql.exec('SELECT handle,team FROM ranked_seats WHERE match_id=?',id).toArray();
    return {...match,seats};
  }

  start(id,now=Date.now()){
    return Boolean(this.one("UPDATE ranked_matches SET state='playing' WHERE id=? AND state='ready' AND deadline>? RETURNING id",id,now));
  }

  void(id){
    this.sql.exec("UPDATE ranked_matches SET state='void' WHERE id=? AND state IN ('ready','playing')",id);
  }

  record(report){
    this.storage.transactionSync(()=>{
      const done=this.one("UPDATE ranked_matches SET state='done' WHERE id=? AND state='playing' RETURNING id",report.id);
      if(!done)return;
      const seats=this.sql.exec('SELECT handle,team,rating FROM ranked_seats WHERE match_id=?',report.id).toArray();
      const average=team=>seats.filter(p=>p.team===team).reduce((sum,p)=>sum+p.rating,0)/4;
      const blue=average('blue'),red=average('red');
      for(const seat of seats){
        const result=report.abandoned.includes(seat.handle)?0:report.winner===null ? .5 : Number(report.winner===seat.team);
        const change=seat.team==='blue'?ratingDelta(blue,red,result):ratingDelta(red,blue,result);
        const previous=this.one('SELECT rating FROM ranked_ratings WHERE handle=?',seat.handle)?.rating??seat.rating;
        const rating=Math.max(0,previous+change);
        const row=this.one(`INSERT INTO ranked_ratings VALUES (?,?,1,?)
          ON CONFLICT(handle) DO UPDATE SET rating=excluded.rating,played=played+1,wins=wins+excluded.wins RETURNING played`,
          seat.handle,rating,Number(result===1));
        this.sql.exec('INSERT INTO ranked_results VALUES (?,?,?,?,?)',report.id,seat.handle,rating-previous,rating,row.played);
      }
    });
  }

  result(id,handle){
    const row=this.one('SELECT delta,rating,played FROM ranked_results WHERE match_id=? AND handle=?',id,handle);
    return row?{delta:row.delta,rating:row.played>=PLACEMENTS?row.rating:null,played:row.played,placements:PLACEMENTS}:null;
  }
}
