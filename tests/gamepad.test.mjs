import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CALIBRATION_STEPS,createGamepadCalibration,createGamepadInput,gamepadKey} from '../dist/gamepad.js';

function gamepad(index=0){
  return {index,connected:true,mapping:'standard',axes:[0,0,0,0],
    buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
}

test('Xbox sticks keep analog movement and filter small drift on both sticks',()=>{
  const sample=createGamepadInput();
  const pad=gamepad();
  pad.axes=[.07,-.08,.03,-.11];
  let input=sample([pad]);
  assert.deepEqual([input.side,input.forward,input.lookX,input.lookY],[0,0,0,0]);
  assert.equal(input.active,false);
  pad.axes=[0,-.5,.5,0];
  input=sample([pad]);
  assert.ok(input.forward>.4&&input.forward<.5);
  assert.ok(input.lookX>0&&input.lookX<input.forward);
  pad.axes=[1,-1,1,-1];
  input=sample([pad]);
  assert.ok(Math.abs(Math.hypot(input.side,input.forward)-1)<1e-9);
  assert.ok(Math.abs(Math.hypot(input.lookX,input.lookY)-1)<1e-9);
});

test('activation and reconnection suppress held buttons until released, then report each new press once',()=>{
  const sample=createGamepadInput();
  const pad=gamepad();
  pad.buttons[0].pressed=true;
  assert.equal(sample([pad]).held.has('a'),false);
  assert.equal(sample([pad]).pressed('a'),false);
  pad.buttons[0].pressed=false;
  sample([pad]);
  pad.buttons[0].pressed=true;
  assert.equal(sample([pad]).pressed('a'),true);
  assert.equal(sample([pad]).pressed('a'),false);
  pad.buttons[7].value=.45;
  assert.equal(sample([pad]).pressed('rt'),true);
  assert.equal(sample([pad]).held.has('rt'),true);
  pad.buttons[7].value=.07;
  assert.equal(sample([pad]).held.has('rt'),false);
  assert.equal(sample([]),null);
  assert.equal(sample([pad]).connected,true);
  assert.equal(sample([pad]).held.has('a'),false);
});

test('prefers standard layouts on first connection and keeps unknown layouts inactive until calibrated',()=>{
  const sample=createGamepadInput();
  const pad=gamepad(1);
  const other=gamepad();
  other.mapping='';
  other.axes[0]=1;
  assert.equal(sample([other,pad]).pad.index,1);
  assert.equal(sample([other]).ready,false);
  assert.equal(sample([other]).side,0);
  assert.equal(sample([other]).active,false);
});

test('all standard Xbox controls map to the intended actions and Guide is unbound',()=>{
  const sample=createGamepadInput();
  const pad=gamepad();
  const standard=['a','b','x','y','lb','rb','lt','rt','view','menu',null,null,'up','down','left','right',null];
  sample([pad]);
  for(const [index,name] of standard.entries()){
    pad.buttons[index].pressed=true;
    assert.deepEqual([...sample([pad]).held],name?[name]:[]);
    pad.buttons[index].pressed=false;
    sample([pad]);
  }
});

test('a trigger crossing the release band can make a new press without chatter',()=>{
  const sample=createGamepadInput();
  const pad=gamepad();
  sample([pad]);
  const trigger=pad.buttons[7];
  for(const [value,held,pressed] of [[.2,true,true],[.13,true,false],[.07,false,false],[.13,false,false],[.2,true,true]]){
    trigger.value=value;
    const input=sample([pad]);
    assert.equal(input.held.has('rt'),held);
    assert.equal(input.pressed('rt'),pressed);
  }
});

test('calibration fixes a mislabeled layout with swapped buttons, axis triggers and an inverted stick',()=>{
  const pad=gamepad();
  pad.id='Xbox Bluetooth fixture';
  pad.axes=[0,0,-1,0,0,-1,0,0,0,3.285];
  const rest=[...pad.axes];
  const controls={
    a:1,b:0,x:2,y:3,lb:4,rb:5,menu:7,view:6,
    lt:[2,1],rt:[5,1],up:[9,-1],down:[9,.143],left:[9,.714],right:[9,-.429],
    moveX:[0,1],moveY:[1,1],lookX:[3,1],lookY:[4,-1]
  };
  function hold(name){
    const control=controls[name];
    if(Array.isArray(control))pad.axes[control[0]]=control[1];
    else pad.buttons[control].pressed=true;
  }
  function release(){
    pad.axes=[...rest];
    for(const button of pad.buttons)button.pressed=false;
  }
  const wizard=createGamepadCalibration(pad);
  wizard.update(pad);
  for(const [name] of CALIBRATION_STEPS){
    if(name==='b'){
      hold('a');
      assert.match(wizard.update(pad),/already assigned/);
      release();
      wizard.update(pad);
    }
    for(let press=0;press<2;press++){
      hold(name);
      wizard.update(pad);
      assert.equal(wizard.step[0],name);
      release();
      wizard.update(pad);
    }
    wizard.update(pad);
  }
  assert.ok(wizard.profile);
  const sample=createGamepadInput();
  const profiles={[gamepadKey(pad)]:wizard.profile};
  sample([pad],profiles);
  for(const [name] of CALIBRATION_STEPS.slice(0,14)){
    hold(name);
    assert.deepEqual([...sample([pad],profiles).held],[name]);
    release();
    sample([pad],profiles);
  }
  pad.buttons[10].pressed=true; // Guide on this raw layout, reported outside the learned bindings.
  assert.equal(sample([pad],profiles).active,false);
  hold('lt');
  hold('rt');
  hold('lookY');
  const input=sample([pad],profiles);
  assert.deepEqual([...input.held],['lt','rt']);
  assert.equal(input.lookX,0);
  assert.equal(input.lookY,1);
});

test('View can be skipped when it is reserved by the operating system',()=>{
  const pad=gamepad();
  const wizard=createGamepadCalibration(pad);
  wizard.update(pad);
  for(const index of [0,1,2,3,4,5,6,7,9]){
    for(let press=0;press<2;press++){
      pad.buttons[index].pressed=true;
      wizard.update(pad);
      pad.buttons[index].pressed=false;
      wizard.update(pad);
    }
    wizard.update(pad);
  }
  assert.equal(wizard.step[0],'view');
  wizard.skip();
  assert.equal(wizard.step[0],'up');
});


test('macOS raw Xbox 045e:02fd matches the hardware layout, including analog triggers and no Guide action',()=>{
  const sample=createGamepadInput('MacIntel');
  const pad=gamepad();
  pad.id='Xbox Wireless Controller (Vendor: 045e Product: 02fd)';
  pad.axes=[0,0,0,0,0,0,0,0,0,3.285];
  assert.equal(sample([pad]).active,false);
  for(const [index,name] of [[0,'a'],[1,'b'],[3,'x'],[4,'y'],[6,'lb'],[7,'rb'],[11,'menu'],[12,null],[15,null],[16,'view']]){
    pad.buttons[index].pressed=true;
    assert.deepEqual([...sample([pad]).held],name?[name]:[]);
    pad.buttons[index].pressed=false;
    sample([pad]);
  }
  pad.axes[3]=pad.axes[4]=-1;
  assert.equal(sample([pad]).active,false);
  pad.axes[3]=.2;
  pad.axes[4]=.6;
  pad.axes[5]=.8;
  const input=sample([pad]);
  assert.deepEqual([...input.held],['lt','rt']);
  assert.equal(input.lookX,0);
  assert.ok(input.lookY>.6);
  for(const [value,action] of [[-1,'up'],[-3/7,'right'],[1/7,'down'],[5/7,'left']]){
    pad.axes[9]=value;
    assert.ok(sample([pad]).held.has(action));
  }
  pad.axes=[0,0,0,0];
  assert.equal(sample([pad]).active,false);
  pad.buttons[6].pressed=true;
  assert.deepEqual([...sample([pad]).held],['lt']);
});

test('a single remap confirms twice, swaps an occupied button, and leaves other settings intact',()=>{
  const pad=gamepad();
  const sample=createGamepadInput();
  const profile=sample([pad]).profile;
  const wizard=createGamepadCalibration(pad,profile,'a');
  wizard.update(pad);
  const press=index=>{
    pad.buttons[index].pressed=true;
    const hint=wizard.update(pad);
    pad.buttons[index].pressed=false;
    wizard.update(pad);
    return hint;
  };
  press(16);
  assert.equal(wizard.profile,null);
  press(1);
  assert.match(press(2),/same physical/);
  assert.equal(wizard.profile,null);
  press(1);
  assert.equal(wizard.profile.a.index,1);
  assert.equal(wizard.profile.b.index,0);
  assert.equal(wizard.profile.x.index,2);
});

test('trigger calibration handles an axis that reports its true neutral only after the first squeeze',()=>{
  const pad=gamepad();
  pad.axes.push(0);
  const wizard=createGamepadCalibration(pad,{},'lt');
  wizard.update(pad);
  for(let press=0;press<2;press++){
    pad.axes[4]=1;
    wizard.update(pad);
    pad.axes[4]=-1;
    wizard.update(pad);
  }
  assert.deepEqual(wizard.profile.lt,{type:'axis',index:4,rest:-1,direction:1});
});
