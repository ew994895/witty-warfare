import assert from 'node:assert/strict';
import {test} from 'node:test';
import {STEP} from '../dist/core.js';
import {roomSettings, teamWinner} from '../dist/rules.js';
import {Match} from '../server/match.js';

function unshield(...actors) {
  for (const actor of actors) actor.shield = 0;
}

test('public TDM balances four per side, replaces bots, and cannot be reconfigured', () => {
  const match = new Match({rules: 'tdm', public: true});
  const first = match.join('first', 'First');
  const second = match.join('second', 'Second');
  assert.equal(first.team, 'blue');
  assert.equal(second.team, 'red');
  for (let i = 0; i < 6; i++) assert.ok(match.join('extra-' + i, 'Extra'));
  assert.equal(match.join('overflow', 'Extra'), null);
  assert.equal(match.actors.filter(a => a.team === 'blue').length, 4);
  assert.equal(match.actors.filter(a => a.team === 'red').length, 4);
  assert.equal(match.queueSettings(first.id, {botCount: 0}, match.round), false);
  assert.equal(match.chooseTeam(first.id, 'red', match.round), false);
  match.leave(second.id);
  assert.equal(match.actors.filter(a => a.bot && a.team === 'red').length, 1);
});

test('teammates cannot be shot by default and only enemy eliminations count toward the team win', () => {
  const match = new Match({rules: 'tdm', botCount: 0, scoreLimit: 10});
  const a = match.join('a', 'A'), b = match.join('b', 'B'), ally = match.join('ally', 'Ally');
  unshield(a, b, ally);
  assert.equal(match.damage(ally, 100, a, false), false);
  assert.equal(ally.hp, 100);
  assert.equal(match.damage(b, 100, a, true), true);
  assert.equal(a.score, 150);
  assert.deepEqual(match.teamScores, {blue: 1, red: 0});
  match.leave(a.id);
  assert.equal(match.teamScores.blue, 1);
  match.teamScores.blue = 9;
  match.respawn(b);
  unshield(b);
  assert.ok(match.damage(b, 100, ally, false));
  assert.equal(match.phase, 'results');
  assert.equal(teamWinner(match.snapshot().teamScores), 'blue');
  assert.ok(match.vote(ally.id, 'pine-ridge'));
  match.voteRemaining = STEP / 2;
  match.step();
  assert.equal(match.map.id, 'pine-ridge');
  assert.equal(match.round, 2);
  assert.deepEqual(match.teamScores, {blue: 0, red: 0});
  assert.equal(teamWinner(match.teamScores), null);
});

test('optional friendly fire causes a death without granting points or team kills', () => {
  const match = new Match({rules: 'tdm', friendlyFire: true, respawnTime: 4, botCount: 0});
  const a = match.join('a', 'A');
  match.join('b', 'B');
  const ally = match.join('ally', 'Ally');
  unshield(a, ally);
  assert.equal(match.damage(a, 100, a, false), false);
  assert.ok(match.damage(ally, 100, a, false));
  assert.equal(ally.dead, 4);
  assert.equal(ally.deaths, 1);
  assert.equal(a.kills, 0);
  assert.equal(a.score, 0);
  assert.equal(match.teamScores.blue, 0);
});

test('only the current host can queue changes and no queued cap evicts existing humans', () => {
  const match = new Match();
  const a = match.join('a', 'A'), b = match.join('b', 'B');
  const settings = {rules: 'tdm', teamSetup: 'humans-vs-bots', maxPlayers: 4, botCount: 2,
    difficulty: 'mixed', botSkills: ['hard', 'practice'], duration: 120};
  assert.equal(match.queueSettings(b.id, settings, match.round), false);
  assert.equal(match.queueSettings(a.id, settings, match.round - 1), false);
  assert.equal(match.queueSettings(a.id, {...settings, maxPlayers: 2}, match.round), false);
  assert.ok(match.queueSettings(a.id, settings, match.round));
  assert.equal(match.settings.rules, 'ffa');
  assert.equal(match.join('overflow', 'Overflow'), null);
  match.finishRound();
  match.voteRemaining = STEP / 2;
  match.step();
  assert.equal(match.round, 2);
  assert.equal(match.duration, 120);
  assert.equal(match.settings.rules, 'tdm');
  assert.equal(a.team, 'blue');
  assert.equal(b.team, 'blue');
  const bots = match.actors.filter(actor => actor.bot);
  assert.deepEqual(bots.map(bot => [bot.team, bot.skill]), [['red', 'hard'], ['red', 'practice']]);
  assert.equal(match.botInput(bots[1]).fire, undefined);
  assert.equal(match.chooseTeam(a.id, 'red', match.round), false);
});

test('zero bots stays bot-free and players can swap teams on the next round', () => {
  const match = new Match({rules: 'tdm', maxPlayers: 2, botCount: 0});
  const a = match.join('a', 'A'), b = match.join('b', 'B');
  assert.ok(match.chooseTeam(a.id, 'red', match.round));
  assert.ok(match.chooseTeam(b.id, 'blue', match.round));
  assert.equal(a.team, 'blue');
  match.beginRound('dust-court');
  assert.equal(a.team, 'red');
  assert.equal(b.team, 'blue');
  match.leave(b.id);
  assert.equal(match.actors.length, 1);
  assert.equal(match.actors[0], a);
});

test('room settings cap bot counts and choose mixed skill independently per bot', () => {
  const settings = roomSettings({rules: 'tdm', maxPlayers: 4, teamSetup: 'humans-vs-bots', botCount: 7});
  assert.equal(settings.botCount, 2);
  const picks = [.1, .8];
  const match = new Match({...settings, difficulty: 'mixed'}, () => picks.shift());
  assert.deepEqual(match.actors.map(actor => actor.skill), ['easy', 'hard']);
});
