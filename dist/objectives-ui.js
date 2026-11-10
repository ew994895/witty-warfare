import * as THREE from './vendor/three.module.js';
import {TEAM_COLORS,TEAM_NAMES} from './rules.js?v=12';

const NEUTRAL=0xe5f49b;
const colors={...TEAM_COLORS,neutral:NEUTRAL};
const ringGeometry=radius=>new THREE.RingGeometry(radius-.09,radius,48).rotateX(-Math.PI/2);
const shapes={zone:ringGeometry(3.25),flag:ringGeometry(1.55),tag:ringGeometry(.48)};
const vector=new THREE.Vector3();
const facing=new THREE.Vector3();

function presentation(rules,data,player){
  if(rules==='hardpoint'){
    const zone=data.zones[0];
    const control=zone.contested?'CONTESTED':zone.controlling?TEAM_NAMES[zone.controlling].toUpperCase()+' HOLDING':'OPEN';
    return `HILL ${zone.label} · ${control} · MOVES IN ${Math.ceil(data.movesIn)}s`;
  }
  if(rules==='domination'){
    return data.zones.map(zone=>{
      if(zone.contested)return zone.label+' CONTESTED';
      if(zone.progress>0)return `${zone.label} ${TEAM_NAMES[zone.controlling]} ${Math.round(zone.progress*100)}%`;
      return `${zone.label} ${TEAM_NAMES[zone.owner]||'Neutral'}`;
    }).join(' · ');
  }
  if(rules==='ctf'){
    const own=data.flags.find(flag=>flag.team===player.team);
    const enemy=data.flags.find(flag=>flag.team!==player.team);
    if(enemy?.carrier===player.id)return own?.home?'FLAG TAKEN · RETURN TO BASE':'FLAG TAKEN · YOUR FLAG MUST RETURN';
    const status=flag=>flag?.home?'HOME':flag?.carrier?'TAKEN':`DROPPED ${Math.ceil(flag?.returnsIn||0)}s`;
    return `YOUR FLAG ${status(own)} · ENEMY FLAG ${status(enemy)}`;
  }
  return 'COLLECT ENEMY TAGS · DENY FRIENDLY TAGS';
}

function markers(rules,data,player){
  if(data.zones)return data.zones.map(zone=>({...zone,kind:'zone',
    title:rules==='hardpoint'?'HILL '+zone.label:zone.label,
    team:rules==='hardpoint'?zone.controlling:zone.owner}));
  if(data.flags){
    const list=data.flags.map(flag=>({...flag,kind:'flag',
      title:flag.carrier===player.id?'FLAG CARRIED':TEAM_NAMES[flag.team].toUpperCase()+' FLAG'}));
    const own=data.flags.find(flag=>flag.team===player.team);
    if(own&&!own.home)list.push({...own.base,id:'home-base',team:own.team,kind:'flag',title:'YOUR BASE'});
    return list;
  }
  return (data.tags||[]).map(tag=>({...tag,kind:'tag',title:tag.team===player.team?'DENY':'CONFIRM'}));
}

export function createObjectiveDisplay(scene,markerLayer,summary){
  const items=new Map();
  let localPlayer;
  let enabled=false;
  return {
    sync(rules,data,player){
      localPlayer=player;
      enabled=Boolean(data);
      summary.hidden=!enabled;
      if(data){
        const label=presentation(rules,data,player);
        if(summary.textContent!==label)summary.textContent=label;
      }
      const next=data?markers(rules,data,player):[];
      const ids=new Set(next.map(item=>item.id));
      for(const [id,item] of items){
        if(ids.has(id))continue;
        scene.remove(item.ring);
        item.ring.material.dispose();
        item.label.remove();
        items.delete(id);
      }
      for(const marker of next){
        let item=items.get(marker.id);
        if(!item){
          const ring=new THREE.Mesh(shapes[marker.kind],new THREE.MeshBasicMaterial({
            transparent:true,opacity:.9,depthWrite:false,side:THREE.DoubleSide
          }));
          const label=document.createElement('span');
          label.className='objective-marker';
          scene.add(ring);
          markerLayer.append(label);
          item={ring,label};
          items.set(marker.id,item);
        }
        item.marker=marker;
        item.ring.material.color.setHex(colors[marker.team||'neutral']);
        item.ring.position.set(marker.x,marker.y+.08,marker.z);
        item.label.dataset.team=marker.team||'neutral';
      }
    },
    render(camera,playing){
      const visible=enabled&&playing;
      markerLayer.hidden=!visible;
      for(const {ring,label,marker} of items.values()){
        const distance=Math.hypot(marker.x-localPlayer.x,marker.z-localPlayer.z);
        ring.visible=visible&&(marker.kind!=='tag'||distance<=25);
        label.hidden=true;
        if(!visible||(marker.kind==='tag'&&distance>22))continue;
        vector.set(marker.x,marker.y+(marker.kind==='tag'?.55:1.85),marker.z);
        facing.copy(vector).applyMatrix4(camera.matrixWorldInverse);
        vector.project(camera);
        const behind=facing.z>=0;
        const onScreen=!behind&&Math.abs(vector.x)<.98&&Math.abs(vector.y)<.95;
        if(marker.kind==='tag'&&!onScreen)continue;
        const x=behind?(facing.x<0?-.92:.92):Math.max(-.91,Math.min(.91,vector.x));
        const y=behind?0:Math.max(-.72,Math.min(.7,vector.y));
        label.hidden=false;
        label.style.left=(x*.5+.5)*innerWidth+'px';
        label.style.top=(-y*.5+.5)*innerHeight+'px';
        const horizontal=behind||Math.abs(vector.x)>=Math.abs(vector.y);
        const direction=onScreen?'':horizontal?(x<0?'‹ ':'› '):(y>0?'↑ ':'↓ ');
        const text=`${direction}${marker.title} · ${Math.round(distance)}m`;
        if(label.textContent!==text)label.textContent=text;
      }
    }
  };
}
