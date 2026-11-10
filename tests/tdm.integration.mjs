import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import WebSocket from 'ws';

const origin = process.env.ROOM_TEST_ORIGIN || 'http://127.0.0.1:8787';
const originHeader = new URL(origin).hostname.endsWith('.workers.dev') ? 'https://witty-warfare.pages.dev' : origin;
const clients = [];

async function until(check, message, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = check();
    if (result) return result;
    await sleep(35);
  }
  throw Error(message);
}

async function connect(path, name) {
  const url = new URL(path, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const id = randomUUID();
  url.searchParams.set('session', id);
  url.searchParams.set('name', name);
  const socket = new WebSocket(url, {origin: originHeader});
  const client = {
    session: id, socket, messages: [], send(data) {socket.send(JSON.stringify(data));}
  };
  clients.push(client);
  socket.on('error', error => {client.error = error;});
  socket.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'welcome') {
      client.id = m.id;
      client.welcome = m;
      client.last = m.snapshot;
    } else if (m.type === 'snapshot') {
      client.last = m;
    } else if (m.type.endsWith('Result')) {
      client.messages.push(m);
    } else if (m.type === 'probe') {
      client.send({type: 'probeReply', n: m.n});
    }
  });
  await until(() => client.welcome || client.error, 'No welcome received');
  if (client.error) throw client.error;
  return client;
}

const humans = client => client.last.actors.filter(a => !a.bot);
const bots = client => client.last.actors.filter(a => a.bot);
const close = client => client.socket.close(1000, 'Left room');

try {
  const publicFfa = await connect('/api/quick-play', 'Release FFA');
  const publicTdm = await connect('/api/quick-play?rules=tdm', 'Release TDM');
  assert.equal(publicFfa.last.rules, 'ffa');
  assert.equal(publicTdm.last.rules, 'tdm');
  assert.notEqual(publicFfa.welcome.roomId, publicTdm.welcome.roomId);
  assert.equal(publicTdm.last.actors.filter(a => a.team === 'blue').length, 4);
  assert.equal(publicTdm.last.actors.filter(a => a.team === 'red').length, 4);
  close(publicFfa);
  close(publicTdm);

  const response = await fetch(origin + '/api/rooms', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Origin: originHeader},
    body: JSON.stringify({mapId: 'switchyard', duration: 120, maxPlayers: 2, botCount: 0})
  });
  assert.equal(response.status, 201);
  const {code} = await response.json();
  const path = '/api/rooms/' + code + '/socket';
  const host = await connect(path, 'TDM QA Host');
  const guest = await connect(path, 'TDM QA Guest');
  assert.equal(guest.last.rules, 'ffa');
  assert.equal(guest.last.host, host.id);
  assert.ok(!guest.last.actors.some(actor => actor.id === host.session));
  assert.equal(humans(guest).length, 2);
  assert.equal(bots(guest).length, 0);

  const update = {
    type: 'roomSettings',
    round: 1,
    settings: {rules: 'tdm', maxPlayers: 4, teamSetup: 'humans-vs-bots', botCount: 2,
      duration: 120, difficulty: 'mixed', botSkills: ['hard', 'practice'], friendlyFire: false, respawnTime: 2.5}
  };
  guest.send(update);
  const denied = await until(() => guest.messages.shift(), 'Guest received permission response');
  assert.equal(denied.accepted, false);
  host.send(update);
  const accepted = await until(() => host.messages.shift(), 'Host received settings confirmation');
  assert.equal(accepted.accepted, true);
  await until(() => guest.last.nextSettings?.rules === 'tdm', 'Guest sees queued settings');
  assert.equal(guest.last.rules, 'ffa');
  assert.equal(bots(guest).length, 0);
  console.log('PASS: separate public TDM and FFA pools, 4v4 fill, bot-free duel, and host-only settings');

  if (!process.env.ROOM_TEST_SKIP_ROUND) {
    await until(() => host.last.phase === 'results' && guest.last.phase === 'results', 'Both players reach voting', 130000);
    host.send({type: 'vote', round: 1, mapId: 'pine-ridge'});
    guest.send({type: 'vote', round: 1, mapId: 'pine-ridge'});
    await until(() => guest.last.voteCounts['pine-ridge'] === 2, 'Both votes registered');
    await until(() => host.last.round === 2 && guest.last.round === 2, 'Both players enter the next round', 22000);
    assert.equal(guest.last.rules, 'tdm');
    assert.equal(guest.last.mapId, 'pine-ridge');
    assert.equal(guest.last.settings.respawnTime, 2.5);
    assert.deepEqual(humans(guest).map(a => a.team), ['blue', 'blue']);
    assert.deepEqual(bots(guest).map(a => [a.team, a.skill]), [['red', 'hard'], ['red', 'practice']]);
    assert.equal(guest.socket.readyState, WebSocket.OPEN);
    assert.equal(host.socket.readyState, WebSocket.OPEN);
    console.log('PASS: queued rules applied after map voting with the same room and connections');
  }
} finally {
  for (const client of clients) close(client);
}
