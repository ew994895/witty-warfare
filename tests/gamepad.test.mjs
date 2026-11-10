import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGamepadInput} from '../dist/gamepad.js';

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
  pad.buttons[7].value=.1;
  assert.equal(sample([pad]).held.has('rt'),false);
  assert.equal(sample([]),null);
  assert.equal(sample([pad]).connected,true);
  assert.equal(sample([pad]).held.has('a'),false);
});

test('ignores unmapped devices and retains the selected controller when another connects',()=>{
  const sample=createGamepadInput();
  const pad=gamepad(1);
  const other=gamepad();
  other.mapping='';
  assert.equal(sample([other]),null);
  assert.equal(sample([null,pad]).connected,true);
  other.mapping='standard';
  other.axes[0]=1;
  assert.equal(sample([other,pad]).side,0);
  assert.equal(sample([other]).side,1);
});
