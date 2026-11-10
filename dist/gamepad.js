const BUTTONS = {a:0,b:1,x:2,y:3,lb:4,rb:5,lt:6,rt:7,view:8,menu:9,up:12,down:13,left:14,right:15};
const DEADZONE = .15;
const STICK_NAMES = ['moveX','moveY','lookX','lookY'];

export const CALIBRATION_STEPS = [
  ['a','A'],['b','B'],['x','X'],['y','Y'],['lb','LB'],['rb','RB'],
  ['lt','LT (left trigger)'],['rt','RT (right trigger)'],
  ['menu','Menu (three lines)'],['view','View (two squares)'],
  ['up','D-pad up'],['down','D-pad down'],['left','D-pad left'],['right','D-pad right'],
  ['moveX','left stick fully right'],['moveY','left stick fully down'],
  ['lookX','right stick fully right'],['lookY','right stick fully down']
];

export function gamepadKey(pad) {
  return JSON.stringify([pad.id,pad.mapping,pad.buttons.length,pad.axes.length]);
}

function stick(x = 0, y = 0, exponent = 1) {
  const magnitude = Math.hypot(x,y);
  if (magnitude <= DEADZONE) return [0,0];
  const scale = ((Math.min(magnitude,1) - DEADZONE) / (1 - DEADZONE)) ** exponent / magnitude;
  return [x * scale,y * scale];
}

function buttonValue(button) {
  return button?.pressed ? 1 : button?.value || 0;
}

function axisValue(pad, binding, bothDirections) {
  if (!binding) return 0;
  const delta = (pad.axes[binding.index] - binding.rest) * binding.direction;
  const positive = delta >= 0 ? binding.direction : -binding.direction;
  const range = positive > 0 ? 1 - binding.rest : 1 + binding.rest;
  return Math.max(bothDirections ? -1 : 0,Math.min(1,delta / Math.max(.1,range))) || 0;
}

function mappedValue(pad, binding) {
  if (!binding) return 0;
  if (binding.type === 'button') return buttonValue(pad.buttons[binding.index]);
  if (binding.type === 'hat') return Number(Math.abs(pad.axes[binding.index] - binding.target) < .09);
  return axisValue(pad,binding,false);
}

export function createGamepadInput() {
  let device = null;
  let mapping;
  let previous = new Set();
  let blocked = new Set();

  return function sample(pads, profiles = {}) {
    const available = Array.from(pads).filter(pad => pad?.connected);
    const pad = available.find(pad => pad.index === device?.index)
      ?? available.find(pad => profiles[gamepadKey(pad)] || pad.mapping === 'standard')
      ?? available[0];
    if (!pad) {
      device = null;
      return null;
    }

    const key = gamepadKey(pad);
    const profile = profiles[key];
    const ready = Boolean(profile || pad.mapping === 'standard');
    const connected = device?.index !== pad.index || device?.key !== key || mapping !== profile;
    if (connected) {
      device = {index:pad.index,key};
      mapping = profile;
      previous = new Set();
    }

    const held = new Set(Object.keys(BUTTONS).filter(name => {
      if (!ready) return false;
      const value = profile ? mappedValue(pad,profile[name]) : buttonValue(pad.buttons[BUTTONS[name]]);
      // A small gap between press and release keeps lightly held triggers from stuttering.
      if (name === 'lt' || name === 'rt') return value >= (previous.has(name) ? .09 : .18);
      return value >= .5;
    }));
    // The first press may only be intended to reveal a paired controller to the browser.
    if (connected) blocked = new Set(held);
    for (const name of blocked) if (!held.has(name)) blocked.delete(name);
    for (const name of blocked) held.delete(name);
    const last = previous;
    const pressed = name => held.has(name) && !last.has(name);
    previous = held;

    const axes = ready ? STICK_NAMES.map((name,index) => profile
      ? axisValue(pad,profile[name],true) : pad.axes[index]) : [];
    const [side,back] = stick(axes[0],axes[1]);
    const [lookX,lookY] = stick(axes[2],axes[3],1.7);
    return {pad,key,ready,side,forward:-back || 0,lookX,lookY,held,pressed,connected,
      active:Boolean(held.size || side || back || lookX || lookY)};
  };
}

function sameControl(a,b) {
  if (a.type === 'button' || b.type === 'button') return a.type === b.type && a.index === b.index;
  if (a.index !== b.index) return false;
  if (a.type === 'hat' && b.type === 'hat') return Math.abs(a.target - b.target) < .09;
  return true;
}

export function createGamepadCalibration(pad) {
  const rest = Array.from(pad.axes);
  const bindings = {};
  let step = 0;
  let waitingForRelease = true;

  function advance(binding) {
    bindings[CALIBRATION_STEPS[step][0]] = binding;
    step++;
    waitingForRelease = true;
  }

  return {
    get step() { return CALIBRATION_STEPS[step]; },
    get index() { return step; },
    get profile() { return step === CALIBRATION_STEPS.length ? bindings : null; },
    skip() {
      if (CALIBRATION_STEPS[step]?.[0] === 'view') advance(null);
    },
    update(pad) {
      const name = CALIBRATION_STEPS[step]?.[0];
      if (!name) return '';
      const buttons = Array.from(pad.buttons,buttonValue);
      const deltas = rest.map((value,index) => pad.axes[index] - value);
      if (waitingForRelease) {
        if (buttons.every(value => value < .15) && deltas.every(delta => Math.abs(delta) < .18)) {
          waitingForRelease = false;
        } else {
          return 'Release the control before continuing.';
        }
      }
      const isStick = STICK_NAMES.includes(name);
      const isHat = ['up','down','left','right'].includes(name);
      let binding;
      if (!isStick) {
        const index = buttons.findIndex((value,index) => value >= .5 && !(pad.mapping === 'standard' && index === 16));
        if (index >= 0) binding = {type:'button',index};
      }
      if (!binding && !buttons.some(value => value >= .5)) {
        const index = deltas.reduce((best,delta,index) =>
          Math.abs(delta) > Math.abs(deltas[best] || 0) ? index : best,-1);
        const delta = deltas[index] || 0;
        if (Math.abs(delta) >= (isStick ? .6 : .35)) {
          binding = isHat ? {type:'hat',index,target:pad.axes[index]} :
            {type:'axis',index,rest:rest[index],direction:Math.sign(delta)};
        }
      }
      if (!binding) return '';
      if (Object.values(bindings).some(other => other && sameControl(binding,other))) {
        return 'That input is already assigned. Release it and try the control shown.';
      }
      advance(binding);
      return 'Release the control before continuing.';
    }
  };
}
