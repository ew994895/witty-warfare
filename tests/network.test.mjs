import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RoomConnection} from '../dist/network.js';

function setup(t, code = null) {
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});
  const sockets = [];
  const statuses = [];
  const welcomes = [];
  const previousSocket = globalThis.WebSocket;
  const previousLocation = globalThis.location;
  globalThis.location = {hostname:'localhost', origin:'http://localhost:8787'};
  globalThis.WebSocket = class {
    static OPEN = 1;
    readyState = 0;
    messages = [];
    constructor(url) {
      this.url = url;
      sockets.push(this);
    }
    open() {
      this.readyState = 1;
      this.onopen();
    }
    receive(message) {
      this.onmessage({data:JSON.stringify(message)});
    }
    send(message) { this.messages.push(JSON.parse(message)); }
    close(code = 1006) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.onclose?.({code});
    }
  };
  const connection = new RoomConnection(code, {session:'local-test'}, {
    welcome: message => welcomes.push(message),
    snapshot: () => {},
    status: text => statuses.push(text),
    failed: error => assert.fail(error)
  });
  t.after(() => {
    connection.close();
    globalThis.WebSocket = previousSocket;
    globalThis.location = previousLocation;
  });
  return {connection,sockets,statuses,welcomes};
}

test('game input waits for welcome and round transitions discard stale batches',async t => {
  const {connection,sockets,welcomes} = setup(t,'ROOMTEST');
  await Promise.resolve();
  const [socket] = sockets;
  socket.open();
  for(let seq=0;seq<4;seq++)connection.input({seq});
  assert.equal(socket.messages.length,0);
  socket.receive({type:'welcome'});
  assert.equal(connection.ready,true);
  connection.input({seq:4});
  socket.receive({type:'welcome'});
  for(let seq=5;seq<9;seq++)connection.input({seq});
  assert.deepEqual(socket.messages[0].frames.map(frame=>frame.seq),[5,6,7,8]);
  assert.equal(welcomes.length,2);
});

test('a silent connection retries its assigned room before returning to Quick Play',async t => {
  const {connection,sockets,statuses} = setup(t);
  await Promise.resolve();
  const [socket] = sockets;
  socket.open();
  socket.receive({type:'welcome',roomId:'test-room'});
  t.mock.timers.tick(12_000);
  assert.equal(connection.ready,false);
  assert.match(statuses[0],/reconnecting/i);
  for(const [index,delay] of [[1,500],[2,1000]]){
    t.mock.timers.tick(delay);
    await Promise.resolve();
    assert.equal(sockets[index].url.pathname,'/api/quick-play/test-room');
    sockets[index].close();
  }
  t.mock.timers.tick(1500);
  await Promise.resolve();
  assert.equal(sockets[3].url.pathname,'/api/quick-play');
});
