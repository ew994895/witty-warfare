export const onlineOrigin = () =>
  ['localhost', '127.0.0.1'].includes(location.hostname) || location.hostname.endsWith('.workers.dev')
    ? location.origin
    : 'https://witty-warfare-online.ejwit004.workers.dev';

const WELCOME_TIMEOUT = 7000;
const HEARTBEAT_INTERVAL = 3000;
const SILENCE_TIMEOUT = 9000;

export class RoomConnection {
  constructor(code, settings, callbacks) {
    this.code = code;
    this.settings = settings;
    this.callbacks = callbacks;
    this.closed = false;
    this.ready = false;
    this.tries = 0;
    this.pending = [];
    this.connect();
  }

  async connect() {
    let ticket;
    try {
      ticket = await this.callbacks.ticket?.();
    } catch (error) {
      if (!this.closed) this.retry(error.message);
      return;
    }
    if (this.closed) return;
    const path = this.settings.rankedId ? `/api/ranked/${this.settings.rankedId}/socket`
      : this.code ? `/api/rooms/${this.code}/socket`
      : this.roomId ? `/api/quick-play/${this.roomId}` : '/api/quick-play';
    const url = new URL(path, onlineOrigin());
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    for (const [key, value] of Object.entries(this.settings)) {
      if (key !== 'rankedId') url.searchParams.set(key, value);
    }
    if (ticket) url.searchParams.set('ticket', ticket);

    const socket = this.socket = new WebSocket(url);
    this.welcomeTimer = setTimeout(() => socket.close(), WELCOME_TIMEOUT);
    socket.onmessage = event => {
      if (this.closed || this.socket !== socket) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (typeof message?.type !== 'string') return;
      this.lastMessage = Date.now();
      if (message.type === 'probe') {
        this.send({type:'probeReply', n:message.n});
      } else if (message.type === 'welcome') {
        this.ready = this.joined = true;
        clearTimeout(this.welcomeTimer);
        this.roomId = message.roomId || this.roomId;
        this.tries = 0;
        this.clearInputs();
        this.callbacks.welcome(message);
      } else if (this.ready && message.type === 'snapshot') {
        this.callbacks.snapshot(message);
      } else if (this.ready && ['roomSettingsResult', 'teamPreferenceResult', 'restartResult'].includes(message.type)) {
        this.callbacks.roomUpdate?.(message);
      } else if (message.type === 'pong') {
        this.callbacks.ping?.(Math.max(0, this.lastMessage - message.at));
      }
    };
    socket.onopen = () => {
      this.lastMessage = Date.now();
      this.pingTimer = setInterval(() => {
        if (Date.now() - this.lastMessage > SILENCE_TIMEOUT) socket.close();
        else this.send({type:'ping', at:Date.now()});
      }, HEARTBEAT_INTERVAL);
    };
    socket.onclose = event => {
      if (this.socket !== socket) return;
      clearInterval(this.pingTimer);
      clearTimeout(this.welcomeTimer);
      this.ready = false;
      this.clearInputs();
      if (this.closed) return;
      if (event.code === 4004) this.fail('Ranked match cancelled. Queue again when ready.');
      else if (event.code === 4000) this.fail('This session is active in another tab.');
      else this.retry();
    };
  }

  retry(error) {
    // Preserve the assigned room through the first two reconnect attempts.
    this.tries++;
    if (this.tries > 2) this.roomId = null;
    if (this.tries > 5 || (error && !this.joined)) {
      const message = this.joined ? 'Could not reconnect. Return to the lobby and join again.'
        : this.settings.rankedId ? 'Could not connect to the Ranked match. Queue again when ready.'
        : this.code ? 'Could not join this room. Check the code, connection, or available slots.'
        : 'Public matchmaking is unavailable. Try again in a moment.';
      this.fail(error || message);
      return;
    }
    const status = this.joined ? 'Connection lost · reconnecting…' : 'Still connecting…';
    this.callbacks.status(status);
    this.retryTimer = setTimeout(() => this.connect(), Math.min(2500, this.tries * 500));
  }

  fail(message) {
    this.close();
    this.callbacks.failed(message);
  }

  send(data) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(data));
    return true;
  }

  input(frame) {
    if (!this.ready) return;
    this.pending.push(frame);
    if (this.pending.length === 4) {
      this.send({type:'inputs', frames:this.pending});
      this.clearInputs();
    }
  }

  clearInputs() {
    this.pending = [];
  }

  close() {
    this.closed = true;
    this.ready = false;
    clearInterval(this.pingTimer);
    clearTimeout(this.welcomeTimer);
    clearTimeout(this.retryTimer);
    this.clearInputs();
    this.socket?.close(1000, 'Left room');
  }
}
