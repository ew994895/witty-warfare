import {teamWinner} from '../dist/rules.js';

export function roundRecord(match, id) {
  const order = (a,b) => (match.settings.scoreLimit ? b.kills-a.kills : 0) || b.score-a.score;
  const [first,second] = [...match.actors].sort(order);
  const soloWinner = first && (!second || order(first,second) < 0) ? first : null;
  const winningTeam = teamWinner(match.teamScores);
  const players = match.humans()
    .filter(actor => actor.account && match.time - actor.joinedAt >= 15 && actor.received > actor.roundStartInput)
    .map(actor => ({
      handle: actor.account,
      won: match.settings.rules === 'tdm' ? actor.team === winningTeam : soloWinner === actor,
      kills: actor.kills,
      humanKills: actor.humanKills || 0,
      deaths: actor.deaths,
      shots: actor.shots,
      hits: actor.hits,
      headshots: actor.headshots,
      bestStreak: actor.bestStreak,
      score: actor.score
    }));
  return {id,playlist:match.public?'public':'custom',players};
}
