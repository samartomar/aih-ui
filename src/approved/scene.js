const mounts = new WeakMap();
const font = '"Workbench Inter", Inter, "Segoe UI", system-ui, sans-serif';
const sourceInks = ['#c3afe4','#95b4d0','#d3b080','#b7b9ca'];
const selectedInks = ['#dbcaef','#bbd8e9','#efd0a1','#d5d0e4'];
const tau = 2 * Math.PI;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const mix = (a, b, f) => a + (b - a) * f;

function polygon(c, points) {
  c.beginPath(); c.moveTo(...points[0]);
  for (let i=1; i<points.length; i++) c.lineTo(...points[i]);
  c.closePath();
}
function line(c, a, b, color, weight=1) {
  c.beginPath(); c.moveTo(...a); c.lineTo(...b);
  c.lineWidth=weight; c.strokeStyle=color; c.stroke();
}
function circle(c,x,y,r,color) {
  c.fillStyle=color; c.beginPath(); c.arc(x,y,r,0,tau); c.fill();
}
function gradient(c, xy, colors) {
  const g=c.createLinearGradient(...xy);
  for(const [at,col] of colors) g.addColorStop(at,col);
  return g;
}
function cut(x,y,w,h,corner) {
  return [[x+corner,y],[x+w-corner,y],[x+w,y+corner],[x+w,y+h-corner],
    [x+w-corner,y+h],[x+corner,y+h],[x,y+h-corner],[x,y+corner]];
}

// Distances are measured along each trace so packets maintain their speed at a bend.
function track(points, speed, offset) {
  let length=0;
  const segments=points.slice(1).map((end,i)=>{
    const start=points[i], dx=end[0]-start[0], dy=end[1]-start[1];
    const span=Math.hypot(dx,dy); length+=span;
    return {start,dx,dy,span,end:length};
  });
  return {points,segments,length,speed,offset};
}
function position(route,distance) {
  const d=clamp(distance,0,route.length);
  const seg=route.segments.find(part=>part.end>=d)||route.segments.at(-1);
  const f=1-(seg.end-d)/seg.span;
  return [seg.start[0]+f*seg.dx, seg.start[1]+f*seg.dy];
}
const incoming=[
  track([[93,52],[150,43],[191,63],[226,58],[308,99]],42,29),
  track([[115,106],[163,98],[203,117],[254,109],[304,115]],50,12),
  track([[83,165],[156,153],[198,172],[245,165],[302,132]],45,76)
];
const outgoing=[
  track([[372,91],[424,67],[450,78],[515,66]],44,17),
  track([[395,112],[428,107],[458,121],[500,114]],53,58),
  track([[374,133],[428,157],[461,152],[509,175]],41,22)
];

function channel(c,route,intensity) {
  c.beginPath(); c.moveTo(...route.points[0]);
  for(const p of route.points.slice(1)) c.lineTo(...p);
  c.lineJoin='round'; c.strokeStyle='#090b10'; c.lineWidth=4.7;c.stroke();
  c.strokeStyle=`rgba(149,151,184,${.22+.28*intensity})`; c.lineWidth=1.3;c.stroke();
  c.save();c.translate(0,2.3);c.lineWidth=.65;c.strokeStyle='rgba(120,128,155,.18)';c.stroke();c.restore();
}
function packet(c,route,distance,intensity) {
  const d=((distance%route.length)+route.length)%route.length, head=position(route,d);
  const fade=Math.min(1,d/8,(route.length-d)/7);
  if(fade<=0)return;
  c.save();c.globalAlpha=fade*(.53+intensity*.4);
  for(let j=3;j>=0;j--) {
    const a=position(route,Math.max(0,d-2.1-j*3.3));
    const b=position(route,Math.max(0,d-j*3.3));
    line(c,a,b,`rgba(172,167,243,${.80-j*.16})`,1.6);
  }
  c.shadowColor='#9586ff';c.shadowBlur=5;
  circle(c,head[0],head[1],intensity>.7?1.85:1.35,'#e5dfff');
  c.restore();
}
function dossier(c,x,y,name,icon,active,size,back=false) {
  c.save();
  c.transform(1,-.145,.22,.91,x,y);
  const w=icon===3?79:91, h=30;
  const outline=[[0,2],[3,0],[w-10,0],[w,9],[w,h-3],[w-3,h],[0,h]];
  c.save();c.translate(-3,4);polygon(c,outline);c.fillStyle='#1b1e26';c.fill();
  c.strokeStyle='rgba(118,120,143,.30)';c.lineWidth=.75;c.stroke();c.restore();
  polygon(c,outline);
  c.fillStyle=gradient(c,[0,h,w,0],[[0,back?'#17191d':'#242630'],[.62,back?'#17181d':'#22232b'],[1,active?'#393745':'#292a33']]);c.fill();
  c.strokeStyle=active?'#777287':'#41434e';c.lineWidth=.82;c.stroke();
  line(c,[1,2],[w-10,1],active?'#9893a8':'#565864',.72);
  line(c,[w-10,2],[w-10,9],'#60616b',.75);line(c,[w-10,9],[w-2,9],'#60616b',.75);
  if(!back){
    c.strokeStyle=(active?selectedInks:sourceInks)[icon];c.lineWidth=1.2;
    if(icon===0){
      for(let i=0;i<2;i++){c.strokeRect(10+i*2,10-i*2,8,10);}
    } else if(icon===1){
      c.beginPath();c.moveTo(9,19);c.lineTo(9,10);c.lineTo(14,10);c.lineTo(16,12);c.lineTo(21,12);c.lineTo(21,19);c.closePath();c.stroke();
    } else if(icon===2){
      c.beginPath();c.arc(13,13,4.1,0,tau);c.stroke();line(c,[16.2,16.2],[20,20.2],c.strokeStyle,1.4);
    } else {
      c.beginPath();c.moveTo(9,16);c.lineTo(13,19);c.lineTo(20,11);c.stroke();
    }
    c.fillStyle=active?'#e3dfef':'#bec0cc';
    c.font=`530 ${size}px ${font}`;c.fillText(name,26,20, w-33);
  } else {
    c.fillStyle='#9092a5';c.font=`500 11px ${font}`;c.fillText(name,9,17);
    line(c,[9,22],[42,22],'#68697a',.9);
  }
  c.restore();
}

// A chamfered, obliquely viewed intake press holds an illuminated document carrier.
const ux=.94,uy=-.35,vx=.71,vy=.48;
function plane(x,y,z) { return [346+x*ux+y*vx,119+x*uy+y*vy-z]; }
function slab(c,extent,z,thickness,bevel,stops,edges) {
  const poly=cut(-extent,-extent,extent*2,extent*2,bevel).map(([x,y])=>plane(x,y,z));
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    if(b[0]>=a[0])continue;
    polygon(c,[a,b,[b[0],b[1]+thickness],[a[0],a[1]+thickness]]);
    c.fillStyle=edges[i===4||i===5?0:1];c.fill();
    line(c,[a[0],a[1]+thickness],[b[0],b[1]+thickness],edges[2],.8);
  }
  polygon(c,poly);c.fillStyle=gradient(c,[269,88,424,138],stops);c.fill();
  c.strokeStyle=edges[3];c.lineWidth=1;c.stroke();
}
function glow(c,x,y,w,h,alpha) {
  c.save();c.translate(x,y);c.scale(w,h);
  const g=c.createRadialGradient(0,0,0,0,0,1);
  g.addColorStop(0,`rgba(135,123,218,${alpha})`);g.addColorStop(.52,`rgba(108,101,172,${alpha*.4})`);g.addColorStop(1,'rgba(98,89,149,0)');
  c.fillStyle=g;c.fillRect(-1,-1,2,2);c.restore();
}
function press(c,t,pulse) {
  glow(c,344,123,101,49,.16+.05*pulse);
  slab(c,50,0,6,11,[[0,'#2c2d34'],[.54,'#35343f'],[1,'#202028']],['#1e2027','#14161b','#0c0d11','#52525d']);
  slab(c,45,6,5,7,[[0,'#45434f'],[.36,'#36353f'],[.94,'#25262e']],['#5a546b','#30303c','#15161d','#767084']);
  slab(c,41,11,6,6,[[0,'#343641'],[.42,'#4b485a'],[.80,'#363640'],[1,'#595367']],['#252530','#393746','#13151b','#84808d']);
  // Numerically projected grooves retain the same optical thickness through the turn.
  for(let i=-29;i<31;i+=5){
    line(c,plane(i,42,9.6),plane(i,42,6.7),'#8a8696',.73);
    line(c,plane(-42,i,9.4),plane(-42,i,7.1),'#696579',.66);
  }
  const floating=14.5+3.8*pulse+.55*Math.sin(t*.65);
  slab(c,32.7,floating-2.5,1.4,5,[[0,'#51495f'],[.6,'#706681'],[1,'#555160']],['#9283a7','#6d627c','#393341','#9183a2']);
  slab(c,34,floating,2.9,6,[[0,'#474455'],[.36,'#625b75'],[.66,'#504e60'],[1,'#767083']],['#9790ad','#6a647d','#393448','#a6a0b9']);
  const [x,y]=plane(0,0,floating+.4);
  c.save();c.transform(ux,uy,vx,vy,x,y);
  polygon(c,[[-22,-23],[14,-23],[23,-14],[23,23],[-22,23]]);
  c.fillStyle=gradient(c,[-22,22,22,-22],[[0,'#817894'],[.4,'#a09aaf'],[.79,'#b9b1cc'],[1,'#e5daef']]);c.fill();
  c.strokeStyle='#d1c7dd';c.lineWidth=.8;c.stroke();
  line(c,[13,-22],[13,-13],'#6c657c',1);line(c,[13,-13],[22,-13],'#6c657c',1);
  // Three inked entries terminate in one bright receiving slit.
  for(const [i,len] of [[0,21],[1,27],[2,16]]){
    line(c,[-13,-9+i*7],[-13+len,-9+i*7],i===1?'#4c455d':'#655e72',2.8);
  }
  for(const [a,b] of [[-29,-26],[27,-25],[-27,26],[27,25]]){
    circle(c,a,b,1.45,'#282830');line(c,[a-.75,b],[a+.75,b],'#a49cad',.48);
  }
  c.restore();
  c.save();c.shadowColor='#aa99ff';c.shadowBlur=4+4*pulse;
  line(c,plane(-25,36,floating-1),plane(17,36,floating-1),`rgba(215,203,255,${.73+.23*pulse})`,1.6);
  c.restore();
}
function deposit(c,x,y,lit) {
  const p=[[x-4,y],[x,y-2.2],[x+4,y],[x,y+2.2]];
  polygon(c,p);c.fillStyle=lit?'#8a819d':'#333540';c.fill();
  c.strokeStyle=lit?'#c8bedc':'#696a7b';c.lineWidth=.6;c.stroke();
}

// The labels on the passing records describe the current work without asserting its outcome.
const adminRecords = [
  ['Organization','Policy owner','CLI targets','Policy draft'],
  ['Core package','Catalog data','Scan package','Evidence release'],
  ['Catalog items','Catalog entry','Framework selection','Source evidence'],
  ['Repository','Source revision','Local checkout','Review notes'],
  ['Scan findings','SKILL.md','Source evidence','Scan report'],
  ['Policy changes','Item review','Selected frameworks','Policy draft'],
  ['Policy revision','CLI coverage','Publication review','Policy history'],
];
const memberRecords = [
  ['Organization policy','Policy revision','Approved Catalog','Team sources'],
  ['CLI targets','Client identity','Target folders','Compatibility'],
  ['Catalog items','Project files','Source revision','Instructions'],
  ['AIH Guides','Tool Setup','Project instructions','Update permission'],
  ['Scan findings','SKILL.md','Local repository','Scan report'],
  ['Core plan','Project files','Source hashes','CLI preview'],
  ['Setup files','Source selections','CLI targets','Project instructions'],
  ['Profile library','First task','Catalog selections','Profile files'],
];
const individualStart = ['Setup files','Personal Profile','CLI targets','Project instructions'];

function recordPaper(ctx, x, y, w, h, icon, close) {
  ctx.save();ctx.translate(x,y);
  const isFile=icon===0||icon===2;
  const pts=isFile?[[0,4],[4,0],[w-15,0],[w,14],[w,h-4],[w-4,h],[0,h]]:cut(0,0,w,h,4);
  // A second paper edge appears beneath the leading leaf.
  ctx.save();ctx.translate(-3.5,4);polygon(ctx,pts);ctx.fillStyle='#15171b';ctx.fill();
  ctx.strokeStyle='#33373f';ctx.lineWidth=1.2;ctx.stroke();ctx.restore();
  polygon(ctx,pts);ctx.fillStyle=gradient(ctx,[0,h,w,0],[[0,'#23252a'],[.65,close?'#33363c':'#292c31'],[1,'#36383f']]);ctx.fill();
  ctx.strokeStyle='#545863';ctx.lineWidth=1;ctx.stroke();
  line(ctx,[5,1],[w-19,1],'#686c77',.95);
  if(isFile){line(ctx,[w-15,2],[w-15,13],'#585c67');line(ctx,[w-15,13],[w-2,13],'#585c67');}
  const cx=22,cy=h*.48;
  ctx.strokeStyle=sourceInks[icon];ctx.fillStyle=sourceInks[icon];ctx.lineWidth=1.7;
  if(icon===0){ctx.strokeRect(cx-6,cy-7,9,12);ctx.strokeRect(cx-2,cy-10,9,12);}
  else if(icon===1){ctx.beginPath();ctx.moveTo(cx-7,cy+5);ctx.lineTo(cx-7,cy-5);ctx.lineTo(cx-2,cy-5);ctx.lineTo(cx+1,cy-2);ctx.lineTo(cx+8,cy-2);ctx.lineTo(cx+8,cy+5);ctx.closePath();ctx.stroke();}
  else if(icon===2){ctx.beginPath();ctx.arc(cx-2,cy-2,5.3,0,tau);ctx.stroke();line(ctx,[cx+2,cy+2],[cx+8,cy+8],sourceInks[icon],1.8);}
  else {line(ctx,[cx-5,cy-6],[cx+6,cy-6],sourceInks[icon],1.8);line(ctx,[cx-5,cy],[cx+4,cy],sourceInks[icon],1.8);line(ctx,[cx-5,cy+6],[cx+7,cy+6],sourceInks[icon],1.8);}
  line(ctx,[46,h*.72],[87,h*.72],'#585c66',1.2);
  ctx.restore();
}

// Texture resolution sets optical depth. The motion loop only translates cached leaves.
function recordTexture(title, icon, depth) {
  const tile=document.createElement('canvas');
  const lettering=document.createElement('canvas');
  const w=350+(icon%3)*23, h=95, density=clamp(depth*1.14-.45,.43,.83);
  tile.width=Math.round(w*density);tile.height=Math.round(h*density);
  lettering.width=tile.width;lettering.height=tile.height;
  const g=tile.getContext('2d');g.scale(tile.width/w,tile.height/h);
  recordPaper(g,7,4,w-15,h-13,icon,depth>.85);
  const print=lettering.getContext('2d');
  print.scale(tile.width/w,tile.height/h);
  print.font=`510 ${depth>.85?21:17}px ${font}`;
  print.fillStyle=depth>.85?'#9b9eaa':'#858995';
  print.fillText(title,53,9+(h-13)*.51,w-83);
  return {tile,lettering,w,h};
}

function ambientSurface(canvas) {
  if(!canvas)return null;
  const c=canvas.getContext('2d');
  if(!c)return null;
  let width=0,height=0,ratio=0,mask,sheets=[],lastTime=-Infinity;
  function resize() {
    const b=canvas.getBoundingClientRect();
    // An intentionally out-of-focus layer does not need a full Retina backing store.
    const r=Math.min(window.devicePixelRatio||1,1,4096/Math.max(1,b.width));
    if(b.width===width&&b.height===height&&r===ratio)return false;
    width=b.width;height=b.height;ratio=r;
    if(width>0&&height>0){
      canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
      c.setTransform(ratio,0,0,ratio,0,0);
      // Reduce contrast only where reading takes precedence. Traces remain visible behind the headline.
      mask=c.createLinearGradient(0,0,width>680?Math.min(width*.72,930):width,0);
      mask.addColorStop(0,'rgba(0,0,0,.54)');
      mask.addColorStop(.54,'rgba(0,0,0,.47)');
      mask.addColorStop(.86,'rgba(0,0,0,.15)');
      mask.addColorStop(1,'rgba(0,0,0,.05)');
    }
    lastTime=-Infinity;return true;
  }
  function imprint(titles){
    sheets=titles.map((title,i)=>{
      const depth=[.80,1.03,.92,1.12][i];
      const icon=/scan|evidence|review|hash/i.test(title)?2:/repo|clone|source|file/i.test(title)?1:
        /catalog|framework|profile|egm/i.test(title)?0:3;
      return {depth,...recordTexture(title,icon,depth)};
    });
    lastTime=-Infinity;
  }
  function paint(t,force=false) {
    if(!sheets.length||!width||!height||(!force&&Math.abs(t-lastTime)<1/24))return;
    lastTime=t;
    c.setTransform(ratio,0,0,ratio,0,0);c.clearRect(0,0,width,height);
    const mobile=width<680, scale=clamp(height/263,.84,1.16)*(mobile?.78:1);
    const stride=Math.max(405*scale,(width+545*scale)/sheets.length);
    const period=stride*sheets.length;
    const railY=x=>height*(mobile?.74:.56)-((x-width*.5)/Math.max(width,1))*height*.32;
    // One plane crosses the frame. Each record passes once before the sequence repeats.
    const y0=railY(0), y1=railY(width), band=52*scale;
    polygon(c,[[0,y0-band],[width,y1-band],[width,y1+band],[0,y0+band]]);
    c.fillStyle='rgba(39,41,47,.21)';c.fill();
    line(c,[0,y0+band],[width,y1+band],'rgba(77,79,90,.13)',.8);
    for(let i=0;i<sheets.length;i++){
      const {depth,tile,lettering,w,h}=sheets[i];
      const x=((i*stride+stride*.48+t*16)%period)-408*scale;
      const y=railY(x+w*scale*.5)-19*scale+(i%2?5:-4)*scale;
      const s=scale*depth;
      if(x+w*s<0||x-h*s*.4>width)continue;
      // Print fades in after passing the live copy column. The mobile plane carries glyphs only.
      const printOpacity=mobile?0:clamp((x+60*s-Math.min(710,width*.46))/100,0,1);
      c.save();c.translate(x,y);c.transform(1.04*s,-.13*s,-.29*s,.72*s,0,0);
      c.globalAlpha=.36+.22*(depth-.8)/.32;
      c.drawImage(tile,0,0,w,h);
      if(printOpacity){c.globalAlpha*=printOpacity;c.drawImage(lettering,0,0,w,h);}
      c.restore();
    }
    c.globalAlpha=1;c.globalCompositeOperation='destination-out';
    c.fillStyle=mask;c.fillRect(0,0,width,height);c.globalCompositeOperation='source-over';
  }
  return {imprint,resize,paint};
}

function mount(canvas,ambientCanvas) {
  mounts.get(canvas)?.destroy();
  const c=canvas.getContext('2d');
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const ambient=ambientSurface(ambientCanvas);
  let width=0,height=0,dpr=0,elapsed=1.9,step=0,admin=false,roleName='';
  let scale=1,spread=0,hubOffset=0,inputs=incoming,outputs=outgoing;
  let paused=false,visible=false,ambientVisible=false,skipped=false,ended=false,frame=0,last=0;
  const diagram=canvas.parentElement;
  const adminLanes=[0,0,0,1,2,2,0], personalLanes=[0,0,0,1,2,2,1,0];
  function rebuildPrint() {
    const groups=admin?adminRecords:memberRecords;
    const titles=!admin&&!/enterprise|member/i.test(roleName)&&step===0?individualStart:groups[step%groups.length];
    ambient?.imprint(titles);
  }

  function render(force=true) {
    if(ended)return;
    const t=media.matches?1.9:elapsed;
    if(force||ambientVisible)ambient?.paint(t,force);
    if(!c||!width||!height||(!force&&(!visible||skipped)))return;
    c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,width,height);
    const s=scale;
    c.translate((width-(560+spread)*s)/2,(height-207*s)/2);c.scale(s,s);
    const focus=(admin?adminLanes:personalLanes)[step]??0;
    const size=clamp(10.5/s,13.5,17.5);
    // Distant dossiers pass through a different focal plane behind the working path.
    c.save();c.globalAlpha=.27;c.filter='blur(.75px)';
    dossier(c,137+spread*.19+Math.sin(t*.14)*10,15,'Catalog entry',0,false,size,true);
    dossier(c,220+spread*.72-Math.sin(t*.16)*8,190,'SKILL.md',0,false,size,true);c.restore();
    for(let i=0;i<3;i++){
      const k=i===focus?1:.27;
      channel(c,inputs[i],k);channel(c,outputs[i],i===1?.82:.26);
      for(const route of [inputs[i],outputs[i]]){
        const travel=t*route.speed+route.offset;
        packet(c,route,travel,k);packet(c,route,travel+route.length*.49,k*.7);
      }
    }
    const shift=(i)=>Math.sin(t*.58+i*1.8)*3.6;
    dossier(c,5+shift(0),43,'Catalog',0,focus===0,size);
    dossier(c,26+shift(1),96,'BYO',1,focus===1,size);
    dossier(c,0+shift(2),154,'Scan',2,focus===2,size);
    deposit(c,515+spread,66,false);deposit(c,509+spread,175,false);
    const lead=inputs[focus];
    const phase=((t*lead.speed+lead.offset)/lead.length+.49)%1;
    const arrival=Math.min(phase,(phase+.51)%1)*lead.length;
    c.save();c.translate(hubOffset,0);press(c,t,Math.exp(-arrival/15));c.restore();
    dossier(c,469+spread+shift(2)*.35,106,admin?'Policy':'Setup',3,true,size);
  }
  function tick(now) {
    frame=0;
    if(!canPlay())return;
    if(last)elapsed+=Math.min((now-last)/1000,.08);
    last=now;render(false);frame=requestAnimationFrame(tick);
  }
  function canPlay(){return !ended&&!document.hidden&&!paused&&!media.matches&&((c&&visible&&!skipped&&width>0&&height>0)||(ambient&&ambientVisible));}
  function sync(){
    if(!canPlay()){if(frame)cancelAnimationFrame(frame);frame=0;last=0;return;}
    if(!frame)frame=requestAnimationFrame(tick);
  }
  function resize(){
    if(ended)return;
    const box=canvas.getBoundingClientRect(), nextDpr=window.devicePixelRatio||1;
    const ambientChanged=ambient?.resize();
    if(box.width===width&&box.height===height&&dpr===nextDpr){if(ambientChanged)render();return;}
    width=box.width;height=box.height;dpr=nextDpr;
    if(width>0&&height>0){
      canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
      scale=Math.min(width/568,height/215);
      spread=Math.max(0,width/scale-568);
      hubOffset=spread*.58;
      // Extend the wires between the three anchors, keeping the labels and hub in proportion.
      const reflow=(route,start,end,from,to)=>track(route.points.map(([x,y])=>[
        x+mix(from,to,clamp((x-start)/(end-start),0,1)),y
      ]),route.speed,route.offset);
      inputs=incoming.map(route=>reflow(route,115,300,0,hubOffset));
      outputs=outgoing.map(route=>reflow(route,395,500,hubOffset,spread));
      render();
    }
    sync();
  }
  function setStep(index,role) {
    if(ended)return;
    const next=Number.isFinite(index)?Math.max(0,Math.trunc(index)):0;
    const name=typeof role==='string'?role:role?.name||role?.id||'';
    const changed=roleName!==name||step!==next;
    step=next;roleName=name;admin=/admin/i.test(name);
    if(changed)rebuildPrint();
    render();
  }
  function setPaused(value){paused=Boolean(value);sync();}
  function motionChanged(){render();sync();}
  const visibility=new IntersectionObserver(entries=>{
    for(const entry of entries){if(entry.target===canvas)visible=entry.isIntersecting;else ambientVisible=entry.isIntersecting;}
    sync();
  });
  const sizing=new ResizeObserver(resize);
  rebuildPrint();sizing.observe(canvas);visibility.observe(canvas);
  if(ambient){sizing.observe(ambientCanvas);visibility.observe(ambientCanvas);}
  resize();
  document.addEventListener('visibilitychange',sync);window.addEventListener('resize',resize);
  function renderingChanged(event){skipped=event.skipped;sync();}
  diagram?.addEventListener('contentvisibilityautostatechange',renderingChanged);
  media.addEventListener('change',motionChanged);
  document.fonts?.ready.then(()=>{if(!ended){rebuildPrint();render();}});
  function destroy(){
    ended=true;sync();visibility.disconnect();sizing.disconnect();
    document.removeEventListener('visibilitychange',sync);window.removeEventListener('resize',resize);
    diagram?.removeEventListener('contentvisibilityautostatechange',renderingChanged);
    media.removeEventListener('change',motionChanged);mounts.delete(canvas);
  }
  const handle={setStep,setPaused,destroy};mounts.set(canvas,handle);return handle;
}
export {mount};
