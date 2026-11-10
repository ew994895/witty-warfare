import {MAPS} from './maps.js';

export const VOTE_SECONDS = 15;

export function nextArena(current, votes, random = Math.random) {
  const high = Math.max(...MAPS.map(map => votes[map.id] || 0));
  if (!high) {
    return MAPS[(MAPS.findIndex(map => map.id === current) + 1) % MAPS.length].id;
  }
  const leaders = MAPS.filter(map => votes[map.id] === high);
  return leaders[Math.min(leaders.length - 1, Math.floor(random() * leaders.length))].id;
}
