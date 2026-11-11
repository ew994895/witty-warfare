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

const buttonBinding=index=>({type:'button',index});
const axisBinding=(index,rest=0,direction=1)=>({type:'axis',index,rest,direction});
const STANDARD_PROFILE=Object.fromEntries([
  ...Object.entries(BUTTONS).map(([name,index])=>[name,buttonBinding(index)]),
  ...STICK_NAMES.map((name,index)=>[name,axisBinding(index)])
]);

// Raw macOS HID order for Xbox Wireless Controller 045e:02fd.
// Chromium applies this same layout when the OS exposes the raw report.
const XBOX_02FD_MAC={
  a:buttonBinding(0),b:buttonBinding(1),x:buttonBinding(3),y:buttonBinding(4),
  lb:buttonBinding(6),rb:buttonBinding(7),view:buttonBinding(16),menu:buttonBinding(11),
  lt:axisBinding(3,-1),rt:axisBinding(4,-1),
  moveX:axisBinding(0),moveY:axisBinding(1),lookX:axisBinding(2),lookY:axisBinding(5),
  up:{type:'hat',index:9,target:-1},right:{type:'hat',index:9,target:-3/7},
  down:{type:'hat',index:9,target:1/7},left:{type:'hat',index:9,target:5/7}
};

export function defaultGamepadProfile(pad,platform='') {
  if (/^Mac/i.test(platform) && /0?45e.*0?2fd/i.test(pad.id) && pad.axes.length===10 && pad.buttons.length>=17) {
    return XBOX_02FD_MAC;
  }
  if (pad.mapping==='standard' && pad.axes.length===4 && pad.buttons.length>=16) return STANDARD_PROFILE;
  return null;
}

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

export function createGamepadInput(platform) {
  let device = null;
  let mapping;
  let previous = new Set();
  let blocked = new Set();
  const bipolarTriggers=new Set();

  return function sample(pads, profiles = {}) {
    const available = Array.from(pads).filter(pad => pad?.connected);
    const pad = available.find(pad => pad.index === device?.index)
      ?? available.find(pad => profiles[gamepadKey(pad)] || defaultGamepadProfile(pad,platform))
      ?? available[0];
    if (!pad) {
      device = null;
      return null;
    }

    const key = gamepadKey(pad);
    const fallback = defaultGamepadProfile(pad,platform);
    const profile = profiles[key] ?? fallback;
    const ready = Boolean(profile);
    const connected = device?.index !== pad.index || device?.key !== key || mapping !== profile;
    if (connected) {
      device = {index:pad.index,key};
      mapping = profile;
      previous = new Set();
      bipolarTriggers.clear();
    }

    const held = new Set(Object.keys(BUTTONS).filter(name => {
      if (!ready) return false;
      let binding=profile[name];
      if(profile===XBOX_02FD_MAC&&(name==='lt'||name==='rt')){
        if(pad.axes[binding.index]<-.6)bipolarTriggers.add(name);
        if(!bipolarTriggers.has(name))binding={...binding,rest:0};
      }
      const value = mappedValue(pad,binding);
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

    const axes = STICK_NAMES.map(name => axisValue(pad,profile?.[name],true));
    const [side,back] = stick(axes[0],axes[1]);
    const [lookX,lookY] = stick(axes[2],axes[3],1.7);
    return {pad,key,profile,fallback,ready,side,forward:-back || 0,lookX,lookY,held,pressed,connected,
      active:Boolean(held.size || side || back || lookX || lookY)};
  };
}

function sameControl(a,b) {
  if (a.type === 'button' || b.type === 'button') return a.type === b.type && a.index === b.index;
  if (a.index !== b.index) return false;
  if (a.type === 'hat' && b.type === 'hat') return Math.abs(a.target - b.target) < .09;
  return true;
}

export function createGamepadCalibration(pad, profile=null, only=null, platform) {
  const steps=only ? CALIBRATION_STEPS.filter(([name])=>name===only) : CALIBRATION_STEPS;
  const bindings=only ? {...profile} : {};
  const fallback=defaultGamepadProfile(pad,platform);
  const reserved=fallback===XBOX_02FD_MAC?[12,15]:fallback===STANDARD_PROFILE?[16]:[];
  let baseline;
  let step=0;
  let candidate=null;
  let confirm=false;
  let released=false;

  function advance(binding) {
    const name=steps[step][0];
    if(only&&binding){
      const conflict=Object.keys(bindings).find(action=>action!==name&&bindings[action]&&sameControl(binding,bindings[action]));
      if(conflict)bindings[conflict]=bindings[name]?.type===binding.type?bindings[name]:null;
    }
    bindings[name]=binding;
    step++;
    candidate=null;
    confirm=released=false;
    baseline=null;
  }

  function capture(name,axes,buttons) {
    const isStick=STICK_NAMES.includes(name);
    const isHat=['up','down','left','right'].includes(name);
    const isTrigger=name==='lt'||name==='rt';
    if(!isStick){
      const index=buttons.findIndex((value,index)=>value>=.5&&baseline.buttons[index]<.15&&!reserved.includes(index));
      if(index>=0)return buttonBinding(index);
    }
    if(!isStick&&!isHat&&!isTrigger)return null;
    const deltas=axes.map((value,index)=>value-baseline.axes[index]);
    const index=deltas.reduce((best,delta,index)=>Math.abs(delta)>Math.abs(deltas[best]||0)?index:best,-1);
    const delta=deltas[index]||0;
    if(Math.abs(delta)<(isStick?.6:.35))return null;
    return isHat ? {type:'hat',index,target:axes[index]} : axisBinding(index,baseline.axes[index],Math.sign(delta));
  }

  return {
    get step() { return steps[step]; },
    get index() { return step; },
    get total() { return steps.length; },
    get profile() { return step===steps.length ? bindings : null; },
    skip() {
      if(steps[step]?.[0]==='view')advance(null);
    },
    update(pad) {
      const name=steps[step]?.[0];
      if(!name)return '';
      const axes=Array.from(pad.axes);
      const buttons=Array.from(pad.buttons,buttonValue);
      if(!baseline){
        // Record the next prompt's neutral state after the last captured input is released.
        baseline={axes,buttons};
        return 'Release the controls, then follow the prompt.';
      }
      if(candidate&&!released){
        const current=candidate.type==='button' ? buttons[candidate.index] :
          Math.abs(axes[candidate.index]-baseline.axes[candidate.index]);
        if(candidate.type==='axis'&&(name==='lt'||name==='rt')){
          const value=axes[candidate.index];
          if((value-candidate.rest)*candidate.direction<-.25){
            candidate.rest=value;
            baseline.axes[candidate.index]=value;
          }else if(current>=.15)return 'Release the control.';
        }else if(current>=.15)return 'Release the control.';
        if(confirm){
          advance(candidate);
          return '';
        }
        released=true;
        return 'Press or move the same control again to confirm.';
      }
      for(const [index,value] of buttons.entries()){
        if(value<.15)baseline.buttons[index]=value;
      }
      const binding=capture(name,axes,buttons);
      if(!binding)return released?'Press or move the same control again to confirm.':'';
      if(candidate){
        if(!sameControl(candidate,binding)||(candidate.type==='axis'&&candidate.direction!==binding.direction)){
          return 'Use the same physical control again to confirm.';
        }
        confirm=true;
        released=false;
        return 'Release to save this control.';
      }
      if(!only&&Object.entries(bindings).some(([action,other])=>action!==name&&other&&sameControl(binding,other))){
        return 'That signal is already assigned. Try the physical control shown.';
      }
      candidate=binding;
      return 'Release the control.';
    }
  };
}
