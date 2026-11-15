import * as THREE from './vendor/three.module.js';
import {TEAM_COLORS,TEAM_NAMES} from './rules.js?v=12';

const NEUTRAL=0xe5f49b;
const colors={...TEAM_COLORS,neutral:NEUTRAL};
const ringGeometry=radius=>new THREE.RingGeometry(radius-.09,radius,48).rotateX(-Math.PI/2);
const shapes={zone:ringGeometry(3.25),flag:ringGeometry(1.55),tag:ringGeometry(.48)};
const vector=new THREE.Vector3();
const facing=new THREE.Vector3();
const EDGE_MARGIN=7;

const tagShape=new THREE.Shape();
tagShape.moveTo(-.16,-.22);
tagShape.lineTo(.16,-.22);
tagShape.lineTo(.22,-.16);
tagShape.lineTo(.22,.17);
tagShape.lineTo(.13,.26);
tagShape.lineTo(-.13,.26);
tagShape.lineTo(-.22,.17);
tagShape.lineTo(-.22,-.16);
tagShape.closePath();
const tagHole=new THREE.Path();
tagHole.absarc(0,.145,.049,0,Math.PI*2,true);
tagShape.holes.push(tagHole);
const tagPlate=new THREE.ExtrudeGeometry(tagShape,{depth:.045,bevelSize:.018,bevelThickness:.015,bevelSegments:1});
const tagGroove=new THREE.BoxGeometry(.29,.027,.01);
const tagDetail=new THREE.MeshBasicMaterial({color:0x23343b});
const tagColors={enemy:0xffc872,friendly:0x91dbff};
const tagMetals={
  enemy:new THREE.MeshStandardMaterial({color:tagColors.enemy,emissive:0x685026,emissiveIntensity:.45,roughness:.52}),
  friendly:new THREE.MeshStandardMaterial({color:tagColors.friendly,emissive:0x2e4d68,emissiveIntensity:.45,roughness:.52})
};
function createTag(){
  const token=new THREE.Group();
  for(const side of [-1,1]){
    const plate=new THREE.Mesh(tagPlate,tagMetals.enemy);
    plate.position.set(side*.17,side*.055,side*.075);
    plate.rotation.set(side*.12,side*.3,side*-.22);
    for(const y of [-.08,-.145]){
      const groove=new THREE.Mesh(tagGroove,tagDetail);
      groove.position.set(0,y,.059);
      plate.add(groove);
    }
    token.add(plate);
  }
  return token;
}

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
        if(item.tag)scene.remove(item.tag);
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
          const tag=marker.kind==='tag'?createTag():null;
          if(tag)scene.add(tag);
          item={ring,label,tag};
          items.set(marker.id,item);
        }
        item.marker=marker;
        const kit=marker.team===player.team?'friendly':'enemy';
        item.ring.material.color.setHex(item.tag?tagColors[kit]:colors[marker.team||'neutral']);
        item.ring.position.set(marker.x,marker.y+.08,marker.z);
        item.label.dataset.team=item.tag?kit:marker.team||'neutral';
        if(item.tag)for(const plate of item.tag.children)plate.material=tagMetals[kit];
      }
    },
    render(camera,playing,width,height,time,reducedMotion){
      const visible=enabled&&playing;
      markerLayer.hidden=!visible;
      const markers=[];
      for(const item of items.values()){
        const {ring,label,tag,marker}=item;
        const distance=Math.hypot(marker.x-localPlayer.x,marker.z-localPlayer.z);
        ring.visible=visible&&(marker.kind!=='tag'||distance<=25);
        if(tag){
          tag.visible=ring.visible;
          if(tag.visible){
            const offset=marker.x*.17+marker.z*.11;
            tag.position.set(marker.x,marker.y+.57+(reducedMotion?0:Math.sin(time*3+offset)*.09),marker.z);
            tag.rotation.y=offset+(reducedMotion?0:time*1.7);
          }
        }
        label.hidden=true;
        if(visible&&(marker.kind!=='tag'||distance<=22))markers.push({label,marker,distance});
      }
      const occupied=[];
      for(const {label,marker,distance} of markers.sort((a,b)=>a.distance-b.distance)){
        vector.set(marker.x,marker.y+(marker.kind==='tag'?.55:1.85),marker.z);
        facing.copy(vector).applyMatrix4(camera.matrixWorldInverse);
        vector.project(camera);
        const behind=facing.z>=0;
        const onScreen=!behind&&Math.abs(vector.x)<.98&&Math.abs(vector.y)<.95;
        if(marker.kind==='tag'&&!onScreen)continue;
        const x=behind?(facing.x<0?-.92:.92):Math.max(-.91,Math.min(.91,vector.x));
        const y=behind?0:Math.max(-.72,Math.min(.7,vector.y));
        const horizontal=behind||Math.abs(vector.x)>=Math.abs(vector.y);
        const direction=onScreen?'':horizontal?(x<0?'‹ ':'› '):(y>0?'↑ ':'↓ ');
        const text=`${direction}${marker.title} · ${Math.round(distance)}m`;
        const halfWidth=Math.min(width/2-EDGE_MARGIN,(text.length*6+14)/2);
        const left=Math.max(halfWidth+EDGE_MARGIN,Math.min(width-halfWidth-EDGE_MARGIN,(x*.5+.5)*width));
        const top=(-y*.5+.5)*height;
        if(occupied.some(spot=>Math.abs(spot.top-top)<20&&Math.abs(spot.left-left)<spot.halfWidth+halfWidth+4))continue;
        occupied.push({left,top,halfWidth});
        label.hidden=false;
        label.style.left=left+'px';
        label.style.top=top+'px';
        if(label.textContent!==text)label.textContent=text;
      }
    }
  };
}
