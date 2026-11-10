import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import WebSocket from 'ws';

const origin = process.env.ROOM_TEST_ORIGIN || 'http://127.0.0.1:8787';
const sockets = [];
async function until(check, message, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await sleep(30);
  }
  throw new Error(message);
}

function join(path = '/api/quick-play', id = randomUUID()) {
  const url = new URL(path, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('session', id);
  url.searchParams.set('name', 'Quick Play QA');
  const socket = new WebSocket(url);
  sockets.push(socket);
  const client = {socket, session: id, welcomes: []};
  socket.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'welcome') {
      client.id = m.id;
      client.welcomes.push(m);
      client.last = m.snapshot;
    }
    if (m.type === 'snapshot') client.last = m;
  });
  socket.on('error', error => {client.error = error;});
  return until(() => client.welcomes.length || client.error, 'No welcome received').then(() => {
    if (client.error) throw client.error;
    return client;
  });
}

function leave(client) {
  client.socket.close(1000, 'Left room');
}

try {
  const roster = await Promise.all(Array.from({length: 9}, () => join()));
  const groups = Object.values(Object.groupBy(roster, client => client.welcomes[0].roomId));
  assert.deepEqual(groups.map(group => group.length).sort((a, b) => a - b), [1, 8]);
  const full = groups.find(group => group.length === 8);
  const [a, b, departing, ...extra] = full;
  const roomId = a.welcomes[0].roomId;
  assert.match(roomId, /^[a-f0-9-]{36}$/);
  await until(() => a.last.actors.every(actor => !actor.bot), 'Eight humans replace all bots');
  const rejoined = await join('/api/quick-play/' + roomId, departing.session);
  assert.equal(rejoined.welcomes[0].roomId, roomId);
  assert.equal(rejoined.id, departing.id);
  assert.notEqual(rejoined.id, departing.session);
  assert.equal(rejoined.last.actors.filter(actor => actor.id === departing.id).length, 1);
  leave(rejoined);
  for (const client of extra) leave(client);
  leave(groups.find(group => group.length === 1)[0]);
  await until(() => a.last.actors.filter(actor => actor.bot).length === 6, 'Bots fill vacated public seats');

  const entrant = await join();
  assert.equal(entrant.welcomes[0].roomId, roomId, 'Matchmaker prefers a live room over an empty one');
  assert.ok(entrant.last.actors.some(actor => actor.id === a.id));
  leave(entrant);
  const response = await fetch(origin + '/api/rooms', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({mapId: 'switchyard', duration: 120, difficulty: 'practice'})
  });
  assert.equal(response.status, 201);
  const {code} = await response.json();
  const custom = await join('/api/rooms/' + code + '/socket');
  assert.equal(custom.welcomes[0].roomId, undefined);
  assert.equal(custom.last.mapId, 'switchyard');
  assert.equal(custom.last.actors.filter(actor => !actor.bot).length, 1);
  leave(custom);
  console.log('PASS: concurrent Quick Play joins, overflow, reconnect, bot backfill, live-room priority, and custom room isolation');

  if (!process.env.ROOM_TEST_SKIP_ROUND) {
    await until(() => a.last.phase === 'results' && b.last.phase === 'results', 'Both clients reached map voting', 210000);
    const round = a.last.round;
    a.socket.send(JSON.stringify({type: 'loadout', primary: 4}));
    a.socket.send(JSON.stringify({type: 'vote', mapId: 'pine-ridge', round}));
    b.socket.send(JSON.stringify({type: 'vote', mapId: 'pine-ridge', round}));
    await until(() => a.last.voteCounts['pine-ridge'] === 2, 'Both votes appear in the live match');
    await until(() => a.last.round === round + 1 && b.last.round === round + 1, 'Both clients entered the next round', 22000);
    assert.equal(a.last.mapId, 'pine-ridge');
    assert.equal(b.last.mapId, 'pine-ridge');
    assert.equal(a.welcomes.at(-1).roomId, roomId);
    assert.equal(b.welcomes.at(-1).roomId, roomId);
    assert.equal(a.last.actors.find(actor => actor.id === a.id).primary, 4);
    console.log('PASS: public results, shared map voting, and next-round loadout on the same two connections');
  }
} finally {
  for (const socket of sockets) socket.close(1000, 'Left room');
}
