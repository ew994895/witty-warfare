// Map definitions share the same geometry with rendering, collisions and route tests.
export const MAPS = [
 {id:'switchyard',name:'Switchyard',size:'SMALL',half:18,tag:'CLOSE & QUICK',description:'Tight container lanes, low cover and a fast outer loop. Bring an SMG or shotgun.',sky:0xa4bac3,fog:0xb6c8c9,ground:0x889b9c,sun:0xffe3b5,light:3.2,preview:[23,19,27],look:[0,0,0],sight:28,botSpeed:3.5,spawns:[[-13,13],[13,-13],[-13,-13],[13,13],[0,-14],[0,14],[-14,0],[14,0],[-3,9],[3,-9]],practice:[[-13,13],[-13,1]]},
 {id:'dust-court',name:'Dust Court',size:'MEDIUM',half:29,tag:'ALL-ROUND ARENA',description:'The original courtyard. Mix central duels, jumpable cover and wide side routes.',sky:0x8faeb3,fog:0xa6bbba,ground:0xadb09a,sun:0xffe1b5,light:3.5,preview:[12,14,24],look:[-4,0,-5],sight:34,botSpeed:3.5,spawns:[[1,14],[-15,-2],[14,2],[0,-13],[-13,17],[12,-14],[-15,6],[6,17],[-7,-14],[15,-5]],practice:[[1,14],[1,-13]]},
 {id:'pine-ridge',name:'Pine Ridge',size:'LARGE',half:42,tag:'RANGE & ROUTES',description:'A mountain outpost with long lanes, raised firing pads and covered flanks. Room to build speed.',sky:0xadc7d5,fog:0xb9cfd7,ground:0x93a79a,sun:0xe5f2ff,light:2.7,preview:[34,29,39],look:[0,0,-4],sight:56,botSpeed:4.3,spawns:[[-33,30],[33,-30],[-33,-30],[33,30],[0,-33],[0,33],[-33,0],[33,0],[-16,-9],[16,9],[-9,20],[9,-20]],practice:[[-33,30],[-33,12]]}
];
export function getMap(id){return MAPS.find(m=>m.id===id)||MAPS[1];}
export function createMap(id){
 const config=getMap(id),boxes=[];
 function box(x,y,z,w,h,d,color,solid=false){const b={position:{x,y,z},size:[w,h,d],rotation:{x:0,y:0,z:0},color,solid};boxes.push(b);return b;}
 function ground(half,color){box(0,-.25,0,half*2+.8,.5,half*2+.8,color);}
 function border(half,color){for(const [x,z,w,d]of [[0,-half,half*2+1,1],[0,half,half*2+1,1],[-half,0,1,half*2],[half,0,1,half*2]])box(x,3,z,w,6,d,color,true);}
 function building(x,z,w,d,h,color){box(x,h/2,z,w,h,d,color,true);box(x,h+.14,z,w+.45,.28,d+.45,0xe5d9b5);box(x,.25,z,w+.12,.5,d+.12,0x737d6c);for(let i=-w/2+1.4;i<w/2;i+=2.7){box(x+i,2.65,z+d/2+.035,.95,1.35,.08,0x344d4b);box(x+i,3.4,z+d/2+.1,1.2,.14,.28,0xe8cca0);if(h>6)box(x+i,5.4,z+d/2+.035,.95,1.25,.08,0x344d4b)}for(let i=-d/2+1.5;i<d/2;i+=2.8)box(x+w/2+.035,2.8,z+i,.08,1.4,.9,0x344d4b);}
 function crate(x,z,s=1.3,color=0x897b4c){box(x,s/2,z,s,s,s,color,true);for(const y of [.16,s-.16])box(x,y,z,s+.03,.14,s+.03,0x4f5e46);box(x,s/2,z+s/2+.03,.16,s,.08,0xb9a273);}
 function palm(x,z,h){box(x,h/2,z,.44,h,.44,0x857357);for(let i=0;i<7;i++){const leaf=box(x,h,z,3.8,.16,.7,0x687e4c);leaf.rotation.y=i*Math.PI*2/7;leaf.rotation.z=.15;leaf.position.x+=Math.cos(leaf.rotation.y)*1.35;leaf.position.z-=Math.sin(leaf.rotation.y)*1.35;}box(x,h+.2,z,.8,.65,.8,0x758c51);}
 function pine(x,z,h,solid=false){box(x,h/2,z,.65,h,.65,0x6b7668,solid);for(let i=0;i<3;i++){const width=3.8-i*.95;const leaf=box(x,h*.48+i*1.3,z,width,1.5,width, i%2?0x426d62:0x537e6c);leaf.rotation.y=i*.35;}}
 function container(x,z,w,d,color){box(x,1.5,z,w,3,d,color,true);box(x,3.08,z,w+.1,.16,d+.1,0xb9c6b7);for(let i=-w/2+.35;i<w/2;i+=.8)box(x+i,1.5,z+d/2+.025,.07,2.8,.07,0x456b68);for(let i=-d/2+.35;i<d/2;i+=.8)box(x+w/2+.025,1.5,z+i,.07,2.8,.07,0x456b68);}
 function sign(x,y,z,text,color=0x314e48){const b=box(x,y,z,4.4,1.1,.07,color);b.label=text;}
 if(config.id==='dust-court'){
  ground(29,config.ground);box(0,.005,0,25,.03,32,0xc0b699);box(0,.025,0,2,.02,40,0xa7a791);
  building(-19,-16,13,12,9,0xb57d54);building(3,-22,15,6,8,0xd5b17a);building(21,-10,8,17,11,0x7e9b94);building(-23,10,6,18,8,0xd4b98b);building(19,20,12,9,8,0xbd9169);building(-7,24,17,5,6,0x81958a);
  box(-4,9.2,-22,3,2,2.4,0x566a60);box(-4,10.3,-22,3.4,.25,2.8,0x40594f);
  box(-7,1,-6,7,2,1.1,0xc5a473,true);box(7,1,5,7,2,1.1,0xb89563,true);box(-10,1.1,9,1.2,2.2,6,0xc6ac7e,true);box(10,1.1,-8,1.2,2.2,6,0x8a9e8f,true);
  crate(-5,9);crate(-3.1,9);crate(-4,10.9);crate(7,-8);crate(5.1,-8);crate(-14,-11,2.2);crate(12,13,2.2);
  box(0,.45,-1,3.9,.9,3.9,0x738575,true);box(0,.94,-1,4.15,.18,4.15,0xd0c9ac);box(0,1.05,-1,3.6,.12,3.6,0x64744f);palm(0,-1,6.5);palm(-15,17,7);palm(14,-17,8);
  border(29,0x8e9b85);for(let i=0;i<20;i++){const x=(i%10-5)*9,z=i<10?-43:43;box(x,4+i%4,z,6,8+i%4*2,7,i%2?0x8caaa4:0xa1b3a2);}
  for(let i=0;i<8;i++)box(-1.8,.04,-15+i*4,.15,.03,1.3,0xe0d6b8);
  box(3,3.7,-18.8,7,.18,2.1,0x658d7b);box(0,1.8,-18,.15,3.5,.15,0x3f5c50);box(6,1.8,-18,.15,3.5,.15,0x3f5c50);sign(-7,4.5,-9.97,'COURT 01');
 }else if(config.id==='switchyard'){
  ground(18,config.ground);border(18,0x657d83);
  box(0,.015,0,7,.03,34,0xaeb7a5);box(0,.02,0,34,.03,6,0x9eafa6);
  container(-6,-5,10,3,0xb96d49);container(6,5,10,3,0x3d8384);container(8,-10,3,9,0x648b9b);container(-8,10,3,9,0xc18d53);
  box(0,.45,0,3.2,.9,3.2,0x6d8485,true);box(0,.96,0,3.4,.12,3.4,0xd5c8a3);
  box(-2,1.1,6,3.5,2.2,.7,0xd6b66d,true);box(2,1.1,-6,3.5,2.2,.7,0xd6b66d,true);
  crate(-12,-7,1.2,0x728e83);crate(12,7,1.2,0x728e83);crate(-6,-2,1.25);crate(6,2,1.25);
  for(let i=0;i<7;i++){box(-2,.045,-14+i*4,.18,.025,1.5,0xeed38a);box(2,.045,-14+i*4,.18,.025,1.5,0xeed38a);}
  for(const x of [-16,16]){box(x,4,-16,.25,8,.25,0x425c64);box(x,8,-14,1,.2,4,0x425c64);box(x,7.87,-12.5,.8,.1,.8,0xf0e6bc);}
  // Gantry outside the playable floor gives the yard a recognizable silhouette.
  for(const x of [-21,21])box(x,7,-16,.9,14,.9,0xd0a755);box(0,13.6,-16,43,.8,1,0xd0a755);box(0,11.5,-16,.15,4,.15,0x344e54);
  box(0,9,-23,27,9,6,0x627e8d);box(0,13.7,-23,29,.35,7,0x405e6a);sign(0,4.3,-17.46,'SWITCH / 02');
 }else{
  ground(42,config.ground);border(42,0x798f98);
  box(0,.015,0,12,.03,82,0xc4c9b6);box(0,.02,0,82,.03,10,0xbcc6b2);
  box(-16,.025,0,6,.03,72,0xacbaa5);box(16,.025,0,6,.03,72,0xacbaa5);
  building(-23,-23,12,10,6,0x718c9c);building(23,-24,10,10,7,0x9ca9a2);building(-24,23,14,10,7,0x7d9c92);building(24,24,12,12,6,0x7a879e);
  box(0,2.8,0,11,5.6,10,0x6c838f,true);box(0,5.75,0,11.5,.3,10.5,0xc3d1ce);box(0,7,0,3.2,2.2,3.2,0x91aaa9);box(0,9,0,.15,4,.15,0x3a5965);box(0,9.5,0,3,.12,.12,0x3a5965);
  sign(0,3.4,5.05,'RIDGE / 03');
  // Jumpable firing pads are solid to bullets and player movement.
  for(const [x,z]of [[-12,-16],[12,16]]){box(x,.6,z,8,1.2,5,0x70888c,true);box(x,.25,z+3.2,4,.5,1.4,0x94a9a1,true);box(x,1.85,z-2.1,5,1.3,.55,0x879e9e,true);}
  for(const [x,z,w,d]of [[-12,8,8,1.2],[12,-8,8,1.2],[-5,-25,1.2,7],[5,25,1.2,7],[-28,7,7,1.2],[28,-7,7,1.2]])box(x,1,z,w,2,d,0x859c92,true);
  for(const [x,z]of [[-19,-6],[19,6],[-6,14],[6,-14],[-30,-12],[30,12]])crate(x,z,1.3,0x778c7c);
  for(const [x,z]of [[-36,-36],[36,-36],[-36,36],[36,36],[-35,-19],[35,19],[-20,35],[20,-35]])pine(x,z,7,true);
  for(let i=0;i<14;i++){const x=-49+i*7.5;pine(x,-49,8+i%3);pine(x,49,7+i%4);if(i%2===0){pine(-49,x,9);pine(49,x,8);}}
  for(let i=0;i<8;i++){const x=(i-4)*16;const m=box(x,10+i%3*3,-70,18,23+i%3*6,20,0x91a9b8);m.rotation.z=.12;box(x,22+i%3*3,-70,11,5,14,0xd9e3df);}
  for(let i=0;i<15;i++)box(-2.5,.045,-35+i*5,.2,.025,2,0xe5e4bc);
 }
 const solids=boxes.filter(b=>b.solid).map(b=>({x:b.position.x,z:b.position.z,w:b.size[0]/2,d:b.size[2]/2,h:b.position.y+b.size[1]/2}));
 return {...config,boxes,solids,spawns:config.spawns.map(p=>[...p]),navBounds:{minX:-config.half+.75,maxX:config.half-.75,minZ:-config.half+.75,maxZ:config.half-.75,cell:1.5}};
}
