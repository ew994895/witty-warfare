// A single playlist packs new players into the same live matches.
// The room itself decides admission, so concurrent reconnects cannot overbook it.
export class QuickPlay {
  constructor(storage, rooms) {
    this.storage = storage;
    this.rooms = rooms;
    this.queue = Promise.resolve();
  }

  join(request) {
    const attempt = this.queue.then(() => this.assign(request));
    this.queue = attempt.catch(() => {});
    return attempt;
  }

  async assign(request) {
    this.active ??= (await this.storage.get('publicRooms')) || [];
    const candidates = this.active.slice(0, 24);
    const next = this.active.slice(candidates.length);
    const full = [];

    for (const id of candidates) {
      const response = await this.admit(request, id, '/quick-seat');
      if (response.status === 404) continue;
      if (response.status === 409) {
        full.push(id);
        continue;
      }
      if (response.status === 101) {
        await this.save([id, ...candidates.slice(candidates.indexOf(id) + 1), ...next, ...full]);
      }
      return response;
    }

    const id = crypto.randomUUID();
    await this.save([id, ...next, ...full]);
    return this.admit(request, id, '/quick-start');
  }

  async save(rooms) {
    if (rooms.length === this.active.length && rooms.every((id, i) => id === this.active[i])) return;
    await this.storage.put('publicRooms', rooms);
    this.active = rooms;
  }

  admit(request, id, path) {
    const room = this.rooms.get(this.rooms.idFromName('public:' + id));
    const url = new URL(request.url);
    url.pathname = path;
    url.searchParams.set('assignedRoom', id);
    return room.fetch(new Request(url, request));
  }
}
