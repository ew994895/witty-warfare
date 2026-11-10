import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLobbyAudio} from '../dist/lobby-audio.js';

test('preview gunfire waits for audio activation and has a separate spatial, muteable output',()=>{
  const destination={};
  const bus={gain:{value:1},connect(target){assert.equal(target,destination);}};
  const context={
    state:'suspended',currentTime:0,destination,createGain:()=>bus,
    createStereoPanner:()=>({pan:{value:0},connect(target){assert.equal(target,bus);},disconnect(){this.disconnected=true;}})
  };
  const lobby=createLobbyAudio();
  const listener={x:0,y:10,z:0};
  const right=[1,0,0];
  const heard=[];
  const fire=(index,volume,output)=>{
    const record={index,volume,output};
    heard.push(record);
    return {addEventListener(event,callback){assert.equal(event,'ended');record.end=callback;}};
  };
  const play=x=>lobby.play(context,{x,y:0,z:0},listener,right,fire);
  play(10);
  assert.equal(heard.length,0);
  context.state='running';
  play(10);
  play(-10);
  assert.equal(heard.length,1);
  assert.ok(heard[0].output.pan.value>0);
  assert.ok(heard[0].volume<.17);
  heard[0].end();
  assert.equal(heard[0].output.disconnected,true);
  lobby.mute();
  assert.equal(bus.gain.value,0);
  context.currentTime=.25;
  play(-40);
  assert.equal(bus.gain.value,1);
  assert.ok(heard[1].output.pan.value<0);
  assert.ok(heard[1].volume<heard[0].volume);
});
