export function createLobbyAudio() {
  let bus;
  let nextShot = 0;
  return {
    play(context, source, listener, right, fire) {
      if (context?.state !== 'running' || context.currentTime < nextShot) return;
      const x = source.x - listener.x;
      const z = source.z - listener.z;
      const distance = Math.hypot(x, source.y - listener.y, z);
      const volume = .17 / (1 + (distance / 18) ** 1.3);

      if (!bus) {
        bus = context.createGain();
        bus.connect(context.destination);
      }
      bus.gain.value = 1;
      const panner = context.createStereoPanner?.();
      if (panner) {
        panner.pan.value = .75 * (x * right[0] + z * right[2]) / Math.max(1, Math.hypot(x, z));
        panner.connect(bus);
      }
      const shot = fire(0, volume, panner || bus);
      if (shot) {
        nextShot = context.currentTime + .18;
        if (panner) shot.addEventListener('ended', () => panner.disconnect(), {once: true});
      } else {
        panner?.disconnect();
      }
    },
    mute() {
      if (bus && bus.gain.value !== 0) bus.gain.value = 0;
    }
  };
}
