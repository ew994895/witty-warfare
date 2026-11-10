const BUTTONS = {a:0,b:1,x:2,y:3,lb:4,rb:5,lt:6,rt:7,view:8,menu:9,up:12,down:13,left:14,right:15};
const DEADZONE = .15;

function stick(x = 0, y = 0, exponent = 1) {
  const magnitude = Math.hypot(x,y);
  if (magnitude <= DEADZONE) return [0,0];
  const scale = ((Math.min(magnitude,1) - DEADZONE) / (1 - DEADZONE)) ** exponent / magnitude;
  return [x * scale,y * scale];
}

export function createGamepadInput() {
  let index = null;
  let previous = new Set();
  let blocked = new Set();
  return function sample(pads) {
    const supported = Array.from(pads).filter(pad => pad?.connected && pad.mapping === 'standard');
    const pad = supported.find(pad => pad.index === index) ?? supported[0];
    if (!pad) {
      index = null;
      return null;
    }

    const held = new Set(Object.keys(BUTTONS).filter(name => {
      const button = pad.buttons[BUTTONS[name]];
      return button?.pressed || button?.value >= .2;
    }));
    const connected = index !== pad.index;
    if (connected) {
      index = pad.index;
      // Browsers can reveal the controller on its first button press.
      blocked = new Set(held);
      previous = new Set();
    }
    for (const name of blocked) if (!held.has(name)) blocked.delete(name);
    for (const name of blocked) held.delete(name);
    const last = previous;
    const pressed = name => held.has(name) && !last.has(name);
    previous = held;
    const [side,back] = stick(pad.axes[0],pad.axes[1]);
    const [lookX,lookY] = stick(pad.axes[2],pad.axes[3],1.7);

    return {side,forward:-back || 0,lookX,lookY,held,pressed,connected,
      active: Boolean(held.size || side || back || lookX || lookY)};
  };
}
