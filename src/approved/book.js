const W=318, H=184;
const ink='#292a25', red='#d84324', mono='Plex, Consolas, monospace';
const sans='"Segoe UI", system-ui, sans-serif';
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=x=>{ x=clamp(x); return x*x*(3-2*x); };
const span=(p,start,end)=>smooth((p-start)/(end-start));
const body=[[0,9],[9,0],[W-21,0],[W,21],[W,H-7],[W-7,H],[8,H],[0,H-8]];
const p=(x,y)=>[.984*x+.22*y,-.128*x+.81*y];
const mounts=new WeakMap();

function path(c,points) {
  c.beginPath(); c.moveTo(...points[0]);
  for (let i=1;i<points.length;i++) c.lineTo(...points[i]);
  c.closePath();
}
function rule(c,x,y,u,v,color,weight=.8) {
  c.beginPath(); c.moveTo(x,y); c.lineTo(u,v); c.strokeStyle=color; c.lineWidth=weight; c.stroke();
}
function circle(c,x,y,r,fill,stroke,weight=1) {
  c.beginPath(); c.arc(x,y,r,0,Math.PI*2);
  if(fill){ c.fillStyle=fill; c.fill(); }
  if(stroke){ c.strokeStyle=stroke; c.lineWidth=weight; c.stroke(); }
}
function type(c,value,x,y,size,options={}) {
  const {weight=550,color=ink,face=sans,align='left'}=options;
  c.fillStyle=color; c.font=`${weight} ${size}px ${face}`; c.textAlign=align; c.fillText(value,x,y);
  c.textAlign='left';
}
function gradient(c,x1,y1,x2,y2,stops) {
  const g=c.createLinearGradient(x1,y1,x2,y2);
  for(const [at,col] of stops) g.addColorStop(at,col);
  return g;
}
function face(c,fn) {
  c.save(); c.transform(.984,-.128,.22,.81,0,0); fn(); c.restore();
}
function cast(c,x,y,w,h,strength) {
  c.save(); c.translate(x,y); c.rotate(-.12); c.scale(w,h);
  const g=c.createRadialGradient(0,0,0,0,0,1);
  g.addColorStop(0,`rgba(59,43,26,${strength})`);
  g.addColorStop(.65,`rgba(59,43,26,${strength*.57})`);
  g.addColorStop(1,'rgba(59,43,26,0)'); c.fillStyle=g; c.fillRect(-1,-1,2,2); c.restore();
}
function stock(c,outline,depth,fill,edge,side) {
  const q=outline.map(([x,y])=>p(x,y));
  for(let i=0;i<q.length;i++){
    const a=q[i],b=q[(i+1)%q.length];
    if(b[0]>=a[0])continue;
    path(c,[a,b,[b[0],b[1]+depth],[a[0],a[1]+depth]]);
    c.fillStyle=outline[i][1]>H*.75?edge:side; c.fill();
    rule(c,a[0],a[1]+depth,b[0],b[1]+depth,'rgba(57,46,34,.50)',.65);
  }
  face(c,()=>{path(c,outline); c.fillStyle=fill; c.fill(); c.strokeStyle='rgba(71,61,47,.62)';c.lineWidth=.7;c.stroke();});
}
function satin(c) {
  const tile=document.createElement('canvas');tile.width=tile.height=62;
  const t=tile.getContext('2d'), pixels=t.createImageData(62,62);
  let seed=341;
  for(let n=0;n<pixels.data.length;n+=4){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const light=seed>>>31?255:29;
    pixels.data[n]=pixels.data[n+1]=pixels.data[n+2]=light;
    pixels.data[n+3]=(seed>>>21)%13;
  }
  t.putImageData(pixels,0,0);return c.createPattern(tile,'repeat');
}
function fastener(c,x,y,r=4) {
  const g=gradient(c,x-r,y-r,x+r,y+r,[[0,'#f5e5ba'],[.36,'#b5aa8b'],[.48,'#f4ebd1'],[1,'#6f6654']]);
  circle(c,x,y,r,'#6c604a'); circle(c,x,y-.6,r-.7,g);
  rule(c,x-r*.5,y+r*.26,x+r*.5,y-r*.26,'#655b49',1);
}
function substrate(c,texture,material,detail) {
  const paper=gradient(c,0,H,W,0,[[0,material[0]],[.48,material[1]],[1,material[2]]]);
  stock(c,body,3.6,paper,material[3],material[4]);
  face(c,()=>{
    path(c,body);c.clip();c.fillStyle=texture;c.fillRect(0,0,W,H);
    if(detail)detail();
  });
}

function gauge(c,x,y,w) {
  rule(c,x,y,x+w,y,'#827b69',.7);
  for(let i=0;i<=20;i++) rule(c,x+i*w/20,y,x+i*w/20,y-(i%5===0?6:2.8),'#777362',.67);
}
function documentIcon(c,x,y,s=1) {
  c.save(); c.translate(x,y);c.scale(s,s);
  for(let i=2;i>=0;i--){
    c.save();c.translate(-i*3.5,i*3.5);
    path(c,[[-16,-20],[7,-20],[17,-10],[17,19],[-16,19]]);
    c.fillStyle='#f5e8c9';c.fill();c.strokeStyle=ink;c.lineWidth=1.65;c.stroke();
    rule(c,7,-20,7,-10,ink);rule(c,7,-10,17,-10,ink);
    if(!i){rule(c,-9,-1,10,-1,red,2);rule(c,-9,5,10,5,ink);rule(c,-9,11,3,11,ink);}
    c.restore();
  }
  c.restore();
}
function optic(c,x,y,r,lit,printUnder) {
  c.save();c.translate(x,y);
  c.save();c.translate(2,4);circle(c,0,0,r+2,'rgba(60,48,28,.22)');c.restore();
  const metal=gradient(c,-r,-r,r,r,[[0,'#39392e'],[.12,'#b4a985'],[.32,'#f6edcf'],[.48,'#857d66'],[.73,'#484738'],[.89,'#d0c4a0'],[1,'#49483a']]);
  // Narrow turned-metal ring. The center remains an optically magnified view of the actual ink.
  c.beginPath();c.arc(0,0,r+2,0,Math.PI*2);c.arc(0,0,r-4,0,Math.PI*2,true);
  c.fillStyle=metal;c.fill();
  c.save();c.beginPath();c.arc(0,0,r-4,0,Math.PI*2);c.clip();
  c.fillStyle='#f8efdc';c.fillRect(-r,-r,2*r,2*r);
  c.scale(1.12,1.12);c.translate(-x,-y);printUnder();c.restore();
  const glass=gradient(c,-r,-r*.5,r,r*.7,[[0,'rgba(242,255,248,.52)'],[.3,'rgba(233,242,234,.10)'],[.47,'rgba(255,255,243,.05)'],[.52,'rgba(255,255,244,.45)'],[.57,'rgba(255,255,244,.15)'],[.85,'rgba(221,239,224,.08)'],[1,'rgba(164,168,133,.28)']]);
  circle(c,0,0,r-4,glass,'#686757',1);
  for(let i=0;i<34;i++){
    const a=(i/34)*2*Math.PI, outer=r+1, inner=r-(i%4===0?3.5:1.3);
    rule(c,Math.cos(a)*inner,Math.sin(a)*inner,Math.cos(a)*outer,Math.sin(a)*outer,'#69634f',.75);
  }
  c.beginPath();c.arc(0,0,r-.4,-2.75,-1.15);c.strokeStyle='#fff8dd';c.lineWidth=1.8;c.stroke();
  c.beginPath();c.arc(0,0,r+1,-.29,.21);c.strokeStyle=red;c.lineWidth=3.3;c.stroke();
  if(lit>.01){
    c.save();c.globalAlpha=lit*.80;
    for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) rule(c,dx*(r-8),dy*(r-8),dx*(r-15),dy*(r-15),red,1.3);
    c.restore();
  }
  c.restore();
}

function shop(c, texture, cover) {
  const {pose:state, tabs, print:printUnder}=cover;
  c.save();c.translate(250+state.dx,150);c.scale(state.zoom,state.zoom);c.translate(-250,-150);
  cast(c,263,222,226,47,.18);cast(c,253,226,181,29,.24);
  c.translate(74,100);
  c.save();c.translate(-1,9);
  stock(c,[[-9,5],[1,-8],[W-13,-8],[W+9,14],[W+9,H+2],[W-3,H+10],[-3,H+10],[-9,H]],7,'#514e42','#514a3e','#35352f');
  c.restore();
  stock(c,[[-7,5],[2,-5],[W-12,-5],[W+7,15],[W+7,H],[W-2,H+7],[-3,H+7],[-7,H]],4.5,'#bdb298','#955a3e','#72634c');

  // Alternate sources are catalog index leaves, separate from the chosen Catalog skill.
  for(let i=2;i>=1;i--){
    c.save(); c.translate(-state.spread*i*8,i*1.5);c.rotate(-state.spread*i*.039);
    if(state.spread>.2){
      face(c,()=>{
        const x=i===2?42:143, w=i===2?89:52, y=-state.spread*37;
        path(c,[[x,4],[x+2,y+5],[x+7,y],[x+w-4,y],[x+w,y+4],[x+w,4]]);
        c.fillStyle=i===2?'#e2d6b7':'#e9dcc0';c.fill();
        c.strokeStyle='#9e9379';c.lineWidth=.8;c.stroke();
        type(c,tabs[2-i],x+9,y+13,9,{face:mono,color:'#565347'});
      });
    }
    substrate(c,texture,['#c6bfa7','#e1dbc6','#f2eddb','#b3a58a','#968c73'],()=>{
      type(c,tabs[2-i],26,23,10,{face:mono,color:'#605b4f'});
      rule(c,29,33,279,33,'#b6b19a');
    });c.restore();
  }
  c.translate(-state.hold*.30,-state.hold);
  c.save(); c.translate(2,5);
  face(c,()=>{path(c,body);c.fillStyle='rgba(69,49,28,.13)';c.shadowBlur=7;c.shadowColor='rgba(57,42,25,.15)';c.fill();});
  c.restore();
  const warm=['#dfcda8','#f1e6cc','#fff7e4','#cf784e','#a26741'];
  substrate(c,texture,warm,()=>{
    // The vermilion binding travels around the selected leaves as the dossier closes.
    c.save();c.globalAlpha=.78+.22*state.bound;
    const bindWidth=6+state.bound*7;
    c.fillStyle=gradient(c,0,0,bindWidth,0,[[0,'#9a361e'],[.22,'#d54a26'],[.70,'#e25630'],[1,'#ae4027']]);
    c.fillRect(2,0,bindWidth,H);
    rule(c,bindWidth+3,2,bindWidth+3,H-3,'rgba(88,53,28,.28)');
    c.restore();
    printUnder();
    fastener(c,18,13,3);fastener(c,18,H-12,3);
    optic(c,state.lensX,state.lensY,state.r,0,printUnder);
  });
  c.restore();
}

function workbenchPrint(c,page) {
  const inter='"Workbench Inter", Inter, "Segoe UI", sans-serif';
  type(c,page.role,28,29,11,{face:mono});
  if(page.index>=0) type(c,'STEP '+String(page.index+1).padStart(2,'0'),292,29,10,{face:mono,align:'right'});
  rule(c,28,39,292,39,'#938875');
  let lines, size=29;
  do {
    c.font='570 '+size+'px '+inter;
    lines=[''];
    for(const word of page.title.split(/\s+/)) {
      const line=lines.length-1, candidate=[lines[line],word].filter(Boolean).join(' ');
      if(lines[line] && c.measureText(candidate).width>187) lines.push(word);
      else lines[line]=candidate;
    }
    if(lines.length<=2 && lines.every(line=>c.measureText(line).width<=187)) break;
    size-=1;
  } while(size>11);
  lines.forEach((line,i)=>type(c,line,28,100+(i-(lines.length-1)/2)*(size+3),size,{weight:570,face:inter}));
  gauge(c,29,155,124);
  documentIcon(c,255,98,1.16);
}

export function mountWorkbenchBook(canvas) {
  mounts.get(canvas)?.destroy();
  const c=canvas.getContext('2d'), texture=c && satin(c);
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const roleLabels={admin:'ENTERPRISE ADMIN',enterprise:'ENTERPRISE USER',individual:'INDIVIDUAL USER'};
  const drift=canvas.animate([
    {transform:'translateY(0) rotate(-.22deg)'},
    {transform:'translateY(-2px) rotate(.22deg)'}
  ],{duration:4500,iterations:Infinity,direction:'alternate',easing:'ease-in-out'});
  drift.pause();
  let page=null, previous=null, width=0, height=0, dpr=0;
  let frame=0, start=0, paused=false, visible=false, ended=false;
  const canMove=()=>!ended && !paused && !media.matches && visible && !document.hidden;
  function paint(t=1) {
    if(!c||!page||!width||!height||ended)return;
    c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,width,height);
    const scale=Math.min(width/460,height/258);
    c.translate((width-500*scale)/2,(height-300*scale)/2-9*scale);c.scale(scale,scale);
    const lift=Math.sin(Math.PI*t);
    const cover={
      pose:{spread:.8+.16*lift,hold:9+16*lift,bound:.78,lensX:255-6*lift,lensY:98,r:34,zoom:1,dx:0},
      tabs:page.role===roleLabels.admin?['POLICY','SCAN']:['PROFILE','TOOLS'],
      print:()=>workbenchPrint(c,t<.5&&previous?previous:page)
    };
    shop(c,texture,cover);
  }
  function finishTurn(){
    cancelAnimationFrame(frame);frame=0;start=0;previous=null;paint();
  }
  function turn(now) {
    frame=0;
    if(!canMove()){finishTurn();return;}
    if(!start)start=now;
    const t=Math.min(1,(now-start)/540);
    paint(t);
    if(t<1)frame=requestAnimationFrame(turn);
    else {previous=null;start=0;}
  }
  function syncMotion(){
    if(canMove())drift.play();
    else {drift.pause();finishTurn();}
    if(media.matches)drift.currentTime=0;
  }
  function resize(){
    // The idle transform is purely composited and does not change the drawing's dimensions.
    const w=canvas.clientWidth,h=canvas.clientHeight,ratio=window.devicePixelRatio||1;
    if(!w||!h||(w===width&&h===height&&ratio===dpr))return;
    width=w;height=h;dpr=ratio;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);paint();
  }
  function setStep(index,role,step) {
    const title=step?.title ?? (role==='admin'?'Organization policy':'CLI setup');
    const next={index,role:roleLabels[role] ?? 'WORKBENCH',title};
    if(page && page.index===index && page.role===next.role && page.title===title)return;
    previous=page;page=next;cancelAnimationFrame(frame);start=0;
    if(previous && canMove())frame=requestAnimationFrame(turn);
    else finishTurn();
  }
  const sizeObserver=new ResizeObserver(resize);
  const intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;syncMotion();});
  sizeObserver.observe(canvas);intersection.observe(canvas);resize();
  media.addEventListener('change',syncMotion);
  document.addEventListener('visibilitychange',syncMotion);
  document.fonts?.ready.then(()=>{if(!ended)paint();});
  function destroy(){
    ended=true;cancelAnimationFrame(frame);drift.cancel();
    sizeObserver.disconnect();intersection.disconnect();media.removeEventListener('change',syncMotion);
    document.removeEventListener('visibilitychange',syncMotion);mounts.delete(canvas);
  }
  const handle={setStep,setPaused(value){paused=Boolean(value);syncMotion();},destroy};
  mounts.set(canvas,handle);return handle;
}
