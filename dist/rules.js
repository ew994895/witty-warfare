export const MAX_PLAYERS = 8;
export const GAME_RULES = {ffa:'Free-for-all',tdm:'Team Deathmatch',gun:'Gun Game',storm:'Storm Survival'};
export const GUN_ORDER = [0,3,4,5,2,1,6,7];
export const STORM_LIVES = 3;

export function gameRules(value) {
  return Object.hasOwn(GAME_RULES,value) ? value : 'ffa';
}

export function stormRadius(map, elapsed, duration) {
  const start=Math.hypot(map.half,map.half)+1;
  const progress=Math.max(0,Math.min(1,(elapsed-15)/(duration-15)));
  return start+(6-start)*progress;
}
export const TEAMS = ['blue', 'red'];
export const TEAM_NAMES = {blue: 'Blue', red: 'Red'};
export const TEAM_COLORS = {blue: 0x439dff, red: 0xff5659};
export const BOT_SKILLS = ['easy', 'normal', 'hard'];
export const DIFFICULTIES = ['practice', ...BOT_SKILLS, 'mixed'];

export function roomSettings(value = {}) {
  const rules = gameRules(value.rules);
  const capacities = rules === 'tdm' ? [2, 4, 6, 8] : [2, 3, 4, 5, 6, 7, 8];
  const maxPlayers = capacities.includes(value.maxPlayers) ? value.maxPlayers : MAX_PLAYERS;
  const teamSetup = rules === 'tdm' && value.teamSetup === 'humans-vs-bots' ? value.teamSetup : 'mixed';
  const maxBots = teamSetup === 'humans-vs-bots' ? maxPlayers / 2 : maxPlayers - 1;
  return {
    rules,
    maxPlayers,
    teamSetup,
    botCount: Number.isInteger(value.botCount) && value.botCount >= 0 ? Math.min(value.botCount, maxBots) : -1,
    difficulty: DIFFICULTIES.includes(value.difficulty) ? value.difficulty : 'normal',
    botSkills: Array.from({length: MAX_PLAYERS - 1}, (_, i) =>
      DIFFICULTIES.includes(value.botSkills?.[i]) ? value.botSkills[i] : 'default'),
    duration: [120, 180, 300].includes(value.duration) ? value.duration : 180,
    scoreLimit: rules==='gun'||rules==='storm'?0:[0, 10, 20, 30, 40, 50].includes(value.scoreLimit) ? value.scoreLimit : rules === 'tdm' ? 30 : 0,
    friendlyFire: rules === 'tdm' && value.friendlyFire === true,
    respawnTime: [1.25, 2.5, 4].includes(value.respawnTime) ? value.respawnTime : 1.25
  };
}

export function humanLimit(settings) {
  return settings.teamSetup === 'humans-vs-bots' ? settings.maxPlayers / 2 : settings.maxPlayers;
}

export function opponents(a, b) {
  return a.id !== b.id && (!a.team || a.team !== b.team);
}

export function teamWinner(scores) {
  if (scores.blue === scores.red) return null;
  return scores.blue > scores.red ? 'blue' : 'red';
}

export function spawnTeamBias(spawn, team) {
  return team === 'blue' ? spawn[1] * .3 : team === 'red' ? -spawn[1] * .3 : 0;
}
