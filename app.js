(() => {
  'use strict';
  if (typeof L === 'undefined') {
    document.body.innerHTML = '<main class="app-shell"><section class="message error">Impossibile caricare il motore cartografico. Controlla la connessione e ricarica la pagina.</section></main>';
    return;
  }

  const LOCATION = { name: 'Borgo Viazza', lat: 44.447, lon: 12.013 };
  const API_URL = 'https://api.rainviewer.com/public/weather-maps.json';
  const REFRESH_MS = 90 * 1000;
  const UI_STATE_KEY = 'radarConteP15State';
  const EVENT_LOG_KEY = 'radarConteP13EventLog';
  let playMs = 800;
  let selectedMinutes = 120;

  const $ = id => document.getElementById(id);
  const els = {
    connectionBadge:$('connectionBadge'), frameTime:$('frameTime'), frameAge:$('frameAge'), firstTime:$('firstTime'), lastTime:$('lastTime'),
    rangeLabel:$('rangeLabel'), timeline:$('timeline'), opacity:$('opacity'), playBtn:$('playBtn'), prevBtn:$('prevBtn'), nextBtn:$('nextBtn'),
    latestBtn:$('latestBtn'), refreshBtn:$('refreshBtn'), homeBtn:$('homeBtn'), zoomLocalBtn:$('zoomLocalBtn'), zoomRomagnaBtn:$('zoomRomagnaBtn'),
    message:$('message'), installBtn:$('installBtn'), installHelp:$('installHelp'), rangeControls:$('rangeControls'), speedControls:$('speedControls'),
    stormModeBtn:$('stormModeBtn'), fullscreenBtn:$('fullscreenBtn'), radarUpdated:$('radarUpdated'), lightningUpdated:$('lightningUpdated'), forecastUpdated:$('forecastUpdated')
  };

  const map = L.map('map', { center:[LOCATION.lat,LOCATION.lon], zoom:10, minZoom:6, maxZoom:13, zoomControl:false, preferCanvas:true, fadeAnimation:false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { tileSize:256, maxZoom:19, updateWhenIdle:false, keepBuffer:4, attribution:'&copy; OpenStreetMap contributors' }).addTo(map);
  L.control.zoom({position:'bottomleft'}).addTo(map);
  const markerIcon=L.divIcon({className:'',html:'<div class="conte-marker"><span></span></div>',iconSize:[24,24],iconAnchor:[12,12]});
  L.marker([LOCATION.lat,LOCATION.lon],{icon:markerIcon,zIndexOffset:1000}).addTo(map).bindTooltip('BORGO VIAZZA',{permanent:true,direction:'top',offset:[0,-13],opacity:.95,className:'conte-tooltip'});
  L.circle([LOCATION.lat,LOCATION.lon],{radius:10000,color:'#fff',weight:1,opacity:.55,fill:false,dashArray:'5 7'}).addTo(map);

  let allFrames=[], frames=[], currentIndex=0, radarLayer=null, host='https://tilecache.rainviewer.com', playTimer=null, deferredInstallPrompt=null;
  let trackingActive=false, trackPoints=[], trackMarkers=[], trackLine=null, hailFocus=false;
  const setStatus=(type,text)=>{els.connectionBadge.className=`status-pill ${type}`;els.connectionBadge.textContent=text;};
  const setMessage=(text,type='info')=>{els.message.className=`message ${type}`;els.message.textContent=text;};
  const fmtTime=unix=>new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'}).format(new Date(unix*1000));
  const fmtDateTime=unix=>new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(unix*1000));
  const nowTime=()=>new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'}).format(new Date());
  const saveState=patch=>{try{const old=JSON.parse(localStorage.getItem(UI_STATE_KEY)||'{}');localStorage.setItem(UI_STATE_KEY,JSON.stringify({...old,...patch}));}catch(_){}};
  const readState=()=>{try{return JSON.parse(localStorage.getItem(UI_STATE_KEY)||'{}')}catch(_){return {}}};
  const updateAge=unix=>{els.frameAge.textContent=`${Math.max(0,Math.round((Date.now()-unix*1000)/60000))} min`;};
  const tileUrl=frame=>`${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png?rc15=${frame.time}`;


  // P13: analisi automatica con timeline persistente dell’evento.
  // Il motore di rilevamento P12 resta invariato; P13 memorizza le letture
  // significative e ricostruisce le fasi: quiete, osservazione, attenzione, impatto, allontanamento.
  // Analizza una matrice di tile RainViewer, individua aree radar connesse e confronta
  // due scansioni. Le stime vengono mostrate solo con controlli minimi di coerenza.
  const autoEls={
    run:$('runAutoAnalysisBtn'), level:$('autoLevel'), summary:$('autoSummary'), rain:$('autoRain'),
    cell:$('autoCell'), move:$('autoMove'), speed:$('autoSpeed'), trend:$('autoTrend'), eta:$('autoEta'), confidence:$('autoConfidence')
  };
  const liveEls={state:$('liveState'),rain:$('liveRain'),target:$('liveTarget'),confidence:$('liveConfidence')};
  function syncLiveSummary(){
    if(!liveEls.state)return;
    liveEls.state.textContent=autoEls.level.textContent||'--';
    liveEls.rain.textContent=autoEls.rain.textContent||'--';
    liveEls.target.textContent=autoEls.cell.textContent||'--';
    liveEls.confidence.textContent=autoEls.confidence.textContent||'--';
    const txt=(autoEls.level.textContent||'').toLowerCase();
    liveEls.state.className=txt.includes('vicino')||txt.includes('intensa')?'danger':txt.includes('avvicin')?'warn':txt.includes('concluso')?'ok':'';
  }
  let autoAnalysisLayer=null;
  const eventEls={list:$('eventLogList'),phase:$('eventPhase'),clear:$('clearEventLogBtn')};
  let eventLog=[];
  function readEventLog(){try{const value=JSON.parse(localStorage.getItem(EVENT_LOG_KEY)||'[]');return Array.isArray(value)?value:[]}catch(_){return []}}
  function saveEventLog(){try{localStorage.setItem(EVENT_LOG_KEY,JSON.stringify(eventLog.slice(0,18)))}catch(_){}}
  function phaseFromSnapshot(s){
    const d=Number.parseFloat(s.distance);
    if(s.rain==='INTENSA'||(Number.isFinite(d)&&d<=7))return 'IMPATTO';
    if(s.trend==='AVVICINAMENTO'&&Number.isFinite(d)&&d<=30)return 'ATTENZIONE';
    if(s.trend==='AVVICINAMENTO'||(Number.isFinite(d)&&d<=55))return 'OSSERVAZIONE';
    if(s.trend==='ALLONTANAMENTO')return 'ALLONTANAMENTO';
    return 'QUIETE';
  }
  function renderEventLog(){
    if(!eventEls.list)return;
    const latest=eventLog[0],phase=latest?.phase||'QUIETE';
    eventEls.phase.textContent=`FASE: ${phase}`;eventEls.phase.className=`event-phase ${phase.toLowerCase()}`;
    if(!eventLog.length){eventEls.list.innerHTML='<p class="event-log-empty">Nessuna lettura registrata.</p>';return;}
    eventEls.list.innerHTML=eventLog.map(e=>`<article class="event-entry"><time>${e.clock}</time><div><strong>${e.phase}</strong><span>${e.level}</span><small>${e.distance!=='--'?`${e.distance} · `:''}${e.trend}${e.eta!=='--'?` · ETA ${e.eta}`:''}</small></div><b>${e.confidence}</b></article>`).join('');
  }
  function recordAutoEvent(frameTime){
    if(!frameTime)return;
    const snapshot={frameTime,clock:fmtTime(frameTime),level:autoEls.level.textContent||'--',rain:autoEls.rain.textContent||'--',distance:autoEls.cell.textContent||'--',trend:autoEls.trend.textContent||'--',eta:autoEls.eta.textContent||'--',confidence:autoEls.confidence.textContent||'--'};
    snapshot.phase=phaseFromSnapshot(snapshot);
    const sameFrame=eventLog.findIndex(e=>e.frameTime===frameTime);
    if(sameFrame>=0)eventLog.splice(sameFrame,1);
    const previous=eventLog[0];
    const meaningful=!previous||previous.phase!==snapshot.phase||previous.level!==snapshot.level||previous.distance!==snapshot.distance||previous.trend!==snapshot.trend||previous.eta!==snapshot.eta;
    if(meaningful||sameFrame>=0){eventLog.unshift(snapshot);eventLog=eventLog.slice(0,18);saveEventLog();renderEventLog();}
  }
  eventLog=readEventLog();renderEventLog();
  eventEls.clear?.addEventListener('click',()=>{eventLog=[];saveEventLog();renderEventLog();});
  const ANALYSIS_ZOOM=7, TILE_SIZE=256, TILE_RADIUS=1, SAMPLE_STEP=4;
  const mercatorPoint=(lat,lon,z)=>{
    const n=2**z;
    return {x:(lon+180)/360*n*TILE_SIZE,y:(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n*TILE_SIZE};
  };
  const pixelToLatLon=(x,y,z)=>{
    const world=TILE_SIZE*(2**z), lon=x/world*360-180;
    const n=Math.PI-2*Math.PI*y/world, lat=180/Math.PI*Math.atan(Math.sinh(n));
    return {lat,lon};
  };
  const loadTileImage=url=>new Promise((resolve,reject)=>{const img=new Image();img.crossOrigin='anonymous';img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Tile radar non leggibile'));img.src=url;});
  function radarPixelScore(r,g,b,a){
    if(a<35)return 0;
    const max=Math.max(r,g,b),min=Math.min(r,g,b),sat=max-min;
    if(max<55 || sat<22)return 0;
    let score=1;
    if(g>110&&b>90)score=1.4;
    if(r>145&&g>105)score=2.2;
    if(r>175&&g<175)score=3.2;
    if(r>175&&b>120)score=4.0;
    return score;
  }
  async function analyseFrame(frame){
    const home=mercatorPoint(LOCATION.lat,LOCATION.lon,ANALYSIS_ZOOM);
    const homeTx=Math.floor(home.x/TILE_SIZE),homeTy=Math.floor(home.y/TILE_SIZE);
    const side=(TILE_RADIUS*2+1)*TILE_SIZE;
    const canvas=document.createElement('canvas');canvas.width=side;canvas.height=side;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const jobs=[];
    for(let oy=-TILE_RADIUS;oy<=TILE_RADIUS;oy++)for(let ox=-TILE_RADIUS;ox<=TILE_RADIUS;ox++){
      const tx=homeTx+ox,ty=homeTy+oy,url=`${host}${frame.path}/256/${ANALYSIS_ZOOM}/${tx}/${ty}/2/1_1.png`;
      jobs.push(loadTileImage(url).then(img=>ctx.drawImage(img,(ox+TILE_RADIUS)*TILE_SIZE,(oy+TILE_RADIUS)*TILE_SIZE)));
    }
    await Promise.all(jobs);
    const data=ctx.getImageData(0,0,side,side).data;
    const gw=Math.ceil(side/SAMPLE_STEP),gh=Math.ceil(side/SAMPLE_STEP),grid=new Float32Array(gw*gh);
    for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){
      const px=Math.min(side-1,gx*SAMPLE_STEP+2),py=Math.min(side-1,gy*SAMPLE_STEP+2),i=(py*side+px)*4;
      grid[gy*gw+gx]=radarPixelScore(data[i],data[i+1],data[i+2],data[i+3]);
    }
    const seen=new Uint8Array(grid.length),components=[];
    const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
    for(let sy=0;sy<gh;sy++)for(let sx=0;sx<gw;sx++){
      const si=sy*gw+sx;if(seen[si]||grid[si]<=0)continue;
      const stack=[si];seen[si]=1;let count=0,sumW=0,sumX=0,sumY=0,maxScore=0,strong=0;
      while(stack.length){const q=stack.pop(),x=q%gw,y=Math.floor(q/gw),s=grid[q];count++;sumW+=s;sumX+=x*s;sumY+=y*s;maxScore=Math.max(maxScore,s);if(s>=3)strong++;
        for(const [dx,dy] of dirs){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=gw||ny>=gh)continue;const ni=ny*gw+nx;if(!seen[ni]&&grid[ni]>0){seen[ni]=1;stack.push(ni);}}
      }
      if(count<4)continue;
      const localX=(sumX/sumW)*SAMPLE_STEP,localY=(sumY/sumW)*SAMPLE_STEP;
      const worldX=(homeTx-TILE_RADIUS)*TILE_SIZE+localX,worldY=(homeTy-TILE_RADIUS)*TILE_SIZE+localY;
      const ll=pixelToLatLon(worldX,worldY,ANALYSIS_ZOOM);
      const dist=distanceKm({lat:LOCATION.lat,lng:LOCATION.lon},{lat:ll.lat,lng:ll.lon});
      components.push({...ll,dist,count,strong,maxScore,energy:sumW});
    }
    components.sort((a,b)=>a.dist-b.dist);
    const homeLocalX=home.x-(homeTx-TILE_RADIUS)*TILE_SIZE,homeLocalY=home.y-(homeTy-TILE_RADIUS)*TILE_SIZE;
    let localHits=0,localStrong=0;
    for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){
      const km=Math.hypot(gx*SAMPLE_STEP-homeLocalX,gy*SAMPLE_STEP-homeLocalY)*0.85;
      if(km<=7&&grid[gy*gw+gx]>0){localHits++;if(grid[gy*gw+gx]>=3)localStrong++;}
    }
    return {components,localHits,localStrong,time:frame.time};
  }
  function chooseTrackedPair(prev,latest){
    if(!latest.components.length)return null;
    const candidates=latest.components.filter(c=>c.dist<=95);
    if(!candidates.length)return null;
    let bestPair=null,bestScore=Infinity;
    for(const c of candidates){
      let previous=null,matchScore=999,approachBonus=0;
      for(const p of prev.components){
        const separation=distanceKm({lat:p.lat,lng:p.lon},{lat:c.lat,lng:c.lon});
        const sizePenalty=Math.abs(Math.log((c.energy+1)/(p.energy+1)))*10;
        const score=separation+sizePenalty;
        if(score<matchScore){matchScore=score;previous=p;}
      }
      if(previous && matchScore<=70){
        const delta=c.dist-previous.dist;
        if(delta<0)approachBonus=Math.min(22,Math.abs(delta)*3);
      }else previous=null;
      // Priorità operativa: vicinanza a Borgo Viazza, continuità e struttura significativa.
      const strengthBonus=Math.min(18,Math.log2(c.energy+1)*2.3)+Math.min(8,c.strong*.35);
      const continuityPenalty=previous?Math.min(24,matchScore*.35):24;
      const operationalScore=c.dist+continuityPenalty-strengthBonus-approachBonus;
      if(operationalScore<bestScore){bestScore=operationalScore;bestPair={latest:c,previous,matchScore,operationalScore};}
    }
    return bestPair;
  }
  function clearAutoLayer(){if(autoAnalysisLayer){map.removeLayer(autoAnalysisLayer);autoAnalysisLayer=null;}}
  function drawAutoCell(cell,heading=null){
    clearAutoLayer();
    const layers=[L.circleMarker([cell.lat,cell.lon],{radius:12,color:'#ffd45b',weight:3,fillColor:'#ff7a45',fillOpacity:.25}),L.polyline([[LOCATION.lat,LOCATION.lon],[cell.lat,cell.lon]],{color:'#ffd45b',weight:2,dashArray:'6 7',opacity:.8})];
    if(Number.isFinite(heading)){
      const length=Math.min(35,Math.max(12,cell.dist*.45)),dest=destinationPoint(cell.lat,cell.lon,heading,length);
      layers.push(L.polyline([[cell.lat,cell.lon],[dest.lat,dest.lon]],{color:'#ff9f43',weight:4,opacity:.9}));
    }
    autoAnalysisLayer=L.layerGroup(layers).addTo(map);
  }
  function destinationPoint(lat,lon,bearing,km){
    const R=6371,d=km/R,br=toRad(bearing),p1=toRad(lat),l1=toRad(lon);
    const p2=Math.asin(Math.sin(p1)*Math.cos(d)+Math.cos(p1)*Math.sin(d)*Math.cos(br));
    const l2=l1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(p1),Math.cos(d)-Math.sin(p1)*Math.sin(p2));
    return {lat:toDeg(p2),lon:toDeg(l2)};
  }
  async function runAutomaticAnalysis(){
    if(!allFrames.length){autoEls.level.textContent='DATI NON DISPONIBILI';autoEls.summary.textContent='Attendo i fotogrammi radar.';return;}
    autoEls.level.textContent='ANALISI IN CORSO';autoEls.summary.textContent='Ricerca automatica dei nuclei radar attorno a Borgo Viazza…';
    ['rain','cell','move','speed','trend','eta','confidence'].forEach(k=>autoEls[k].textContent='…');
    try{
      const latest=allFrames.at(-1),prev=allFrames[Math.max(0,allFrames.length-3)];
      const [a,b]=await Promise.all([analyseFrame(prev),analyseFrame(latest)]),pair=chooseTrackedPair(a,b);
      const rain=b.localStrong>=2?'INTENSA':b.localHits>=4?'IN CORSO':b.localHits>0?'DEBOLE / MARGINALE':'NON RILEVATA';
      autoEls.rain.textContent=rain;
      if(!pair){clearAutoLayer();autoEls.level.textContent='NESSUN NUCLEO RILEVATO';autoEls.cell.textContent='--';autoEls.move.textContent='--';autoEls.speed.textContent='--';autoEls.trend.textContent='STABILE';autoEls.eta.textContent='--';autoEls.confidence.textContent='LIMITATA';autoEls.summary.textContent=`Precipitazione locale: ${rain.toLowerCase()}. Nessun nucleo radar organizzato è stato riconosciuto nell’area analizzata.`;syncLiveSummary();recordAutoEvent(latest.time);return;}
      const c=pair.latest;autoEls.cell.textContent=`${c.dist.toFixed(1)} km`;
      let heading=null,speed=null,trend='INCERTA',eta='--',confidence='BASSA',state='NUCLEO RILEVATO';
      if(pair.previous){
        const dt=(b.time-a.time)/3600,moved=distanceKm({lat:pair.previous.lat,lng:pair.previous.lon},{lat:c.lat,lng:c.lon});
        heading=bearingDeg({lat:pair.previous.lat,lng:pair.previous.lon},{lat:c.lat,lng:c.lon});speed=dt>0?moved/dt:null;
        const prevDist=pair.previous.dist,delta=c.dist-prevDist,toward=bearingDeg({lat:c.lat,lng:c.lon},{lat:LOCATION.lat,lng:LOCATION.lon}),deviation=angleDiff(heading,toward);
        if(Math.abs(delta)<2)trend='LATERALE / STABILE';else trend=delta<0?'AVVICINAMENTO':'ALLONTANAMENTO';
        if(speed>=5&&speed<=140&&trend==='AVVICINAMENTO'&&deviation<=38)eta=`~${Math.max(1,Math.round(c.dist/speed*60))} min`;
        confidence=(c.count>=12&&pair.previous.count>=8&&pair.matchScore<45&&speed<=140)?'MEDIA':'BASSA';
        if(c.count>=25&&pair.previous.count>=18&&pair.matchScore<25&&speed>=5&&speed<=110)confidence='BUONA';
        autoEls.move.textContent=`${compass(heading)} · ${Math.round(heading)}°`;
        autoEls.speed.textContent=speed>=3&&speed<=180?`${Math.round(speed)} km/h`:'INCERTA';
      }else{autoEls.move.textContent='NON CALCOLABILE';autoEls.speed.textContent='--';}
      if(confidence==='BASSA'){
        trend='NON DETERMINABILE';eta='--';
      }
      if(rain==='NON RILEVATA' && c.dist>70 && trend!=='AVVICINAMENTO'){
        state='EVENTO LOCALE CONCLUSO';trend='NESSUN NUCLEO RILEVANTE';eta='--';
      }
      autoEls.trend.textContent=trend;autoEls.eta.textContent=eta;autoEls.confidence.textContent=confidence;
      if(state!=='EVENTO LOCALE CONCLUSO'){
        if(rain==='INTENSA')state='PRECIPITAZIONE INTENSA';else if(rain==='IN CORSO')state='PRECIPITAZIONE SULLA ZONA';else if(c.dist<=10)state='NUCLEO MOLTO VICINO';else if(c.dist<=25)state='NUCLEO VICINO';else if(confidence!=='BASSA'&&trend==='AVVICINAMENTO')state='NUCLEO IN AVVICINAMENTO';else if(confidence!=='BASSA'&&trend==='ALLONTANAMENTO')state='NUCLEO IN ALLONTANAMENTO';else state='BERSAGLIO IN VERIFICA';
      }
      autoEls.level.textContent=state;drawAutoCell(c,heading);
      const etaText=eta==='--'?'ETA non disponibile: traiettoria o velocità non abbastanza coerenti.':`Possibile arrivo del centro stimato in ${eta}.`;
      autoEls.summary.textContent=`${state}. Centro radar stimato a ${c.dist.toFixed(1)} km; tendenza ${trend.toLowerCase()}. ${etaText} Affidabilità ${confidence.toLowerCase()}.`;
      syncLiveSummary();recordAutoEvent(latest.time);
    }catch(err){console.warn('Analisi automatica non disponibile',err);clearAutoLayer();autoEls.level.textContent='LETTURA NON DISPONIBILE';autoEls.summary.textContent='Il radar resta utilizzabile, ma il browser non consente l’analisi automatica delle tile. Nessuna stima è stata prodotta.';['rain','cell','move','speed','trend','eta'].forEach(k=>autoEls[k].textContent='--');autoEls.confidence.textContent='NESSUNA';syncLiveSummary();}
  }
  autoEls.run?.addEventListener('click',runAutomaticAnalysis);

  function applyRange(minutes){
    selectedMinutes=minutes;
    saveState({minutes});
    stopPlayback();
    if(!allFrames.length) return;
    const latest=allFrames[allFrames.length-1].time;
    frames=allFrames.filter(f=>f.time>=latest-minutes*60);
    if(!frames.length) frames=[allFrames[allFrames.length-1]];
    els.timeline.max=String(frames.length-1);
    els.firstTime.textContent=fmtTime(frames[0].time); els.lastTime.textContent=fmtTime(frames[frames.length-1].time);
    els.rangeLabel.textContent=minutes===30?'ULTIMI 30 MIN':minutes===60?'ULTIMA ORA':'ULTIME 2 ORE';
    [...els.rangeControls.querySelectorAll('button')].forEach(b=>b.classList.toggle('active',Number(b.dataset.minutes)===minutes));
    showFrame(frames.length-1);
  }

  function showFrame(index){
    if(!frames.length)return;
    currentIndex=Math.max(0,Math.min(index,frames.length-1)); const frame=frames[currentIndex];
    if(radarLayer)map.removeLayer(radarLayer);
    radarLayer=L.tileLayer(tileUrl(frame),{tileSize:256,maxNativeZoom:7,maxZoom:13,opacity:Number(els.opacity.value)/100,zIndex:450,updateWhenIdle:false,keepBuffer:4,errorTileUrl:'',attribution:'Radar &copy; RainViewer'}).addTo(map);
    els.timeline.value=String(currentIndex); els.frameTime.textContent=fmtDateTime(frame.time).toUpperCase(); updateAge(frame.time);
    els.latestBtn.classList.toggle('is-latest',currentIndex===frames.length-1);
  }
  function stopPlayback(){if(playTimer)clearInterval(playTimer);playTimer=null;els.playBtn.textContent='▶ PLAY';els.playBtn.setAttribute('aria-label','Avvia animazione');}
  function startPlayback(){if(!frames.length)return;if(currentIndex>=frames.length-1)currentIndex=0;els.playBtn.textContent='Ⅱ PAUSA';els.playBtn.setAttribute('aria-label','Metti in pausa animazione');playTimer=setInterval(()=>showFrame(currentIndex>=frames.length-1?0:currentIndex+1),playMs);}
  const togglePlayback=()=>playTimer?stopPlayback():startPlayback();
  const goLatest=()=>{stopPlayback();showFrame(frames.length-1);};

  async function loadRadar({quiet=false}={}){
    if(!quiet){setStatus('loading','CARICAMENTO');setMessage('Sto scaricando gli ultimi fotogrammi radar…');}
    try{
      const response=await fetch(`${API_URL}?t=${Date.now()}`,{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const data=await response.json();const past=Array.isArray(data?.radar?.past)?data.radar.past:[];if(!past.length)throw new Error('Nessun fotogramma disponibile');
      const previousLatest=allFrames.at(-1)?.time||0;host=data.host||host;allFrames=past;applyRange(selectedMinutes);setStatus('ok','LIVE · AUTO');els.radarUpdated.textContent=nowTime();const newest=allFrames.at(-1)?.time||0;setMessage(`${newest>previousLatest?'Nuova scansione acquisita':'Controllo automatico completato'} · ultimo dato ${fmtTime(newest)} · prossimo controllo entro 90 s.`,'success');setTimeout(()=>map.invalidateSize(),150);setTimeout(runAutomaticAnalysis,500);
    }catch(error){console.error(error);setStatus('error','RADAR OFFLINE');setMessage('Non riesco a ricevere i dati radar. Controlla la connessione e premi AGGIORNA.','error');}
  }

  els.playBtn.addEventListener('click',togglePlayback); els.prevBtn.addEventListener('click',()=>{stopPlayback();showFrame(currentIndex-1);});
  els.nextBtn.addEventListener('click',()=>{stopPlayback();showFrame(currentIndex+1);}); els.latestBtn.addEventListener('click',goLatest);
  els.refreshBtn.addEventListener('click',()=>{stopPlayback();loadRadar();}); els.timeline.addEventListener('input',e=>{stopPlayback();showFrame(Number(e.target.value));});
  els.opacity.addEventListener('input',()=>radarLayer&&radarLayer.setOpacity(Number(els.opacity.value)/100)); els.homeBtn.addEventListener('click',()=>map.setView([LOCATION.lat,LOCATION.lon],10));
  els.zoomLocalBtn.addEventListener('click',()=>map.setView([LOCATION.lat,LOCATION.lon],11)); els.zoomRomagnaBtn.addEventListener('click',()=>map.setView([44.28,11.98],8));
  els.rangeControls.addEventListener('click',e=>{const b=e.target.closest('button[data-minutes]');if(b)applyRange(Number(b.dataset.minutes));});
  els.speedControls.addEventListener('click',e=>{const b=e.target.closest('button[data-speed]');if(!b)return;playMs=Number(b.dataset.speed);saveState({speed:playMs});[...els.speedControls.querySelectorAll('button')].forEach(x=>x.classList.toggle('active',x===b));if(playTimer){stopPlayback();startPlayback();}});

  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;els.installBtn.hidden=false;});
  els.installBtn.addEventListener('click',async()=>{
    if(deferredInstallPrompt){deferredInstallPrompt.prompt();const choice=await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;els.installBtn.hidden=true;els.installHelp.hidden=false;els.installHelp.textContent=choice.outcome==='accepted'?'Installazione avviata. Radar Conte comparirà tra le app.':'Installazione annullata: puoi riprovare dal menu di Chrome.';}
    else{els.installHelp.hidden=false;els.installHelp.textContent='Apri il menu ⋮ di Chrome e scegli “Installa app”. Se compare solo “Aggiungi a schermata Home”, ricarica una volta la P15 e attendi qualche secondo.';}
  });
  window.addEventListener('appinstalled',()=>{els.installBtn.hidden=true;els.installHelp.hidden=false;els.installHelp.textContent='Radar Conte è installato correttamente.';});

  window.addEventListener('resize',()=>map.invalidateSize()); window.addEventListener('orientationchange',()=>setTimeout(()=>map.invalidateSize(),300));
  window.addEventListener('online',()=>loadRadar()); window.addEventListener('offline',()=>{setStatus('error','OFFLINE');setMessage('Telefono senza connessione internet.','error');});
  setInterval(()=>loadRadar({quiet:true}),REFRESH_MS); setInterval(()=>{if(frames.length)updateAge(frames[currentIndex].time);},60000);
  if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(console.warn));
  loadRadar();


  // P5: monitor fulmini ufficialmente incorporabile secondo la documentazione LightningMaps.org.
  const radarModeBtn = document.getElementById('radarModeBtn');
  const lightningModeBtn = document.getElementById('lightningModeBtn');
  const radarPanel = document.getElementById('radarPanel');
  const lightningPanel = document.getElementById('lightningPanel');
  const lightningFrame = document.getElementById('lightningFrame');
  const reloadLightningBtn = document.getElementById('reloadLightningBtn');
  const lightningLocalBtn = document.getElementById('lightningLocalBtn');
  const lightningNorthBtn = document.getElementById('lightningNorthBtn');
  const openLightningLink = document.getElementById('openLightningLink');

  const lightningBase = 'https://map.blitzortung.org/index.php?interactive=1&NavigationControl=1&FullScreenControl=0&Cookies=0&InfoDiv=0&MenuButtonDiv=1&ScaleControl=1&LightningCheckboxChecked=1&LightningRangeValue=10&MapStyle=0&MapStyleRangeValue=0&Advertisment=0';
  const lightningViews = {
    local: `${lightningBase}#8/44.447/12.013`,
    north: `${lightningBase}#6/44.8/11.2`
  };
  let currentLightningView = 'local';

  function loadLightning(view='local', force=false){
    currentLightningView = view;
    const url = lightningViews[view] + (force ? `&reload=${Date.now()}` : '');
    lightningFrame.src = url;
    els.lightningUpdated.textContent = nowTime();
    openLightningLink.href = lightningViews[view];
    lightningLocalBtn.classList.toggle('active', view === 'local');
    lightningNorthBtn.classList.toggle('active', view === 'north');
  }

  reloadLightningBtn.addEventListener('click',()=>loadLightning(currentLightningView,true));
  lightningLocalBtn.addEventListener('click',()=>loadLightning('local',true));
  lightningNorthBtn.addEventListener('click',()=>loadLightning('north',true));

  // P6: monitor di evoluzione ufficiale ARPAE fino a +3 ore.
  const forecastModeBtn = document.getElementById('forecastModeBtn');
  const forecastPanel = document.getElementById('forecastPanel');
  const forecastFrame = document.getElementById('forecastFrame');
  const reloadForecastBtn = document.getElementById('reloadForecastBtn');
  const forecastReloadBottomBtn = document.getElementById('forecastReloadBottomBtn');
  const openForecastLink = document.getElementById('openForecastLink');
  const forecastUrl = 'https://apps.arpae.it/widgets/meteo-radar-nowcasting/';

  function loadForecast(force=false){
    forecastFrame.src = forecastUrl + (force ? `?reload=${Date.now()}` : '');
    els.forecastUpdated.textContent = nowTime();
    openForecastLink.href = forecastUrl;
  }

  function setOperationalMode(mode,{scroll=true}={}){
    saveState({mode});
    radarPanel.hidden=false;lightningPanel.hidden=false;forecastPanel.hidden=false;
    radarModeBtn.classList.toggle('active',mode==='radar');
    lightningModeBtn.classList.toggle('active',mode==='lightning');
    forecastModeBtn.classList.toggle('active',mode==='forecast');
    if(!lightningFrame.src)loadLightning(currentLightningView);
    if(!forecastFrame.src)loadForecast();
    const target=mode==='lightning'?lightningPanel:mode==='forecast'?forecastPanel:radarPanel;
    if(scroll)target.scrollIntoView({behavior:'smooth',block:'start'});
    setTimeout(()=>map.invalidateSize(),120);
  }

  radarModeBtn.addEventListener('click',()=>setOperationalMode('radar'));
  lightningModeBtn.addEventListener('click',()=>setOperationalMode('lightning'));
  forecastModeBtn.addEventListener('click',()=>setOperationalMode('forecast'));
  reloadForecastBtn.addEventListener('click',()=>loadForecast(true));
  forecastReloadBottomBtn.addEventListener('click',()=>loadForecast(true));

  // P7: modalità temporale, memoria operativa e schermo intero.
  let stormMode = false;
  function setStormMode(active){
    stormMode = active;
    document.body.classList.toggle('storm-active', active);
    els.stormModeBtn.classList.toggle('active', active);
    els.stormModeBtn.textContent = active ? '✓ TEMPORALE ATTIVO' : '⚠ MODALITÀ TEMPORALE';
    saveState({stormMode:active});
    if(active){
      setOperationalMode('radar');
      map.setView([LOCATION.lat,LOCATION.lon],11);
      applyRange(30);
      playMs=450;
      [...els.speedControls.querySelectorAll('button')].forEach(x=>x.classList.toggle('active',Number(x.dataset.speed)===450));
      saveState({speed:450,minutes:30});
      if(!playTimer) startPlayback();
      setMessage('Modalità Temporale attiva: radar locale, ultimi 30 minuti, animazione veloce e aggiornamento automatico ogni 90 secondi.','success');
    }else{
      stopPlayback();
      setMessage('Modalità Temporale disattivata. Controlli manuali ripristinati.','info');
    }
  }
  els.stormModeBtn.addEventListener('click',()=>setStormMode(!stormMode));

  els.fullscreenBtn.addEventListener('click',async()=>{
    try{
      if(!document.fullscreenElement){await document.documentElement.requestFullscreen();els.fullscreenBtn.textContent='↙ ESCI SCHERMO INTERO';}
      else{await document.exitFullscreen();}
    }catch(_){setMessage('Lo schermo intero non è disponibile in questa modalità del browser.','error');}
  });
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)els.fullscreenBtn.textContent='⛶ SCHERMO INTERO';setTimeout(()=>map.invalidateSize(),150);});

  // Aggiorna anche il monitor attivo, non soltanto il radar.
  setInterval(()=>{
    loadLightning(currentLightningView,true);
    loadForecast(true);
  },REFRESH_MS);


  // P9: pannello analisi richiudibile per mantenere la mappa al centro.
  const analysisToggleBtn=$('analysisToggleBtn'), analysisDrawer=$('analysisDrawer');
  analysisToggleBtn.addEventListener('click',()=>{
    const open=analysisDrawer.hidden;
    analysisDrawer.hidden=!open;
    analysisToggleBtn.setAttribute('aria-expanded',String(open));
    analysisToggleBtn.querySelector('span').textContent=open?'CHIUDI':'APRI';
    setTimeout(()=>map.invalidateSize(),80);
  });

  // P9: analisi guidata opzionale e focus nuclei intensi.
  const trackingBtn=$('trackingBtn'), hailFocusBtn=$('hailFocusBtn'), clearTrackingBtn=$('clearTrackingBtn');
  const trackingHint=$('trackingHint'), trackState=$('trackState'), trackDistance=$('trackDistance'), trackSpeed=$('trackSpeed'), trackDirection=$('trackDirection'), trackEta=$('trackEta');

  const toRad=d=>d*Math.PI/180, toDeg=r=>r*180/Math.PI;
  function distanceKm(a,b){
    const R=6371, dLat=toRad(b.lat-a.lat), dLon=toRad(b.lng-a.lng);
    const q=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(q));
  }
  function bearingDeg(a,b){
    const p1=toRad(a.lat),p2=toRad(b.lat),dl=toRad(b.lng-a.lng);
    return (toDeg(Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)))+360)%360;
  }
  function compass(d){return ['N','NE','E','SE','S','SO','O','NO'][Math.round(d/45)%8];}
  function angleDiff(a,b){return Math.abs(((a-b+540)%360)-180);}
  function clearTracking(){
    trackPoints=[]; trackMarkers.forEach(m=>map.removeLayer(m)); trackMarkers=[];
    if(trackLine){map.removeLayer(trackLine);trackLine=null;}
    trackState.textContent='IN ATTESA';trackDistance.textContent='-- km';trackSpeed.textContent='-- km/h';trackDirection.textContent='--';trackEta.textContent='--';
    trackingHint.textContent='Scegli un fotogramma precedente, attiva TRACKING e tocca il centro della cella; poi passa a un fotogramma più recente e tocca nuovamente la stessa cella.';
  }
  function setTrackingActive(active){
    trackingActive=active;trackingBtn.classList.toggle('active',active);trackingBtn.textContent=active?'✓ TOCCA LA CELLA':'🎯 TRACKING CELLA';
    if(active){stopPlayback();trackingHint.textContent=trackPoints.length?'Ora seleziona la stessa cella in un fotogramma più recente.':'Tocca il centro della cella nel fotogramma attuale.';}
  }
  trackingBtn.addEventListener('click',()=>setTrackingActive(!trackingActive));
  clearTrackingBtn.addEventListener('click',()=>{setTrackingActive(false);clearTracking();});
  hailFocusBtn.addEventListener('click',()=>{hailFocus=!hailFocus;document.body.classList.toggle('hail-focus',hailFocus);hailFocusBtn.classList.toggle('active',hailFocus);hailFocusBtn.textContent=hailFocus?'✓ FOCUS NUCLEI':'🔴 FOCUS NUCLEI';saveState({hailFocus});});

  map.on('click',e=>{
    if(!trackingActive || !frames.length)return;
    const frame=frames[currentIndex];
    if(trackPoints.length===1 && frame.time<=trackPoints[0].time){
      trackingHint.textContent='Il secondo punto deve essere scelto su un fotogramma più recente.';return;
    }
    const point={lat:e.latlng.lat,lng:e.latlng.lng,time:frame.time};
    trackPoints.push(point);
    const cls=trackPoints.length===1?'track-point-a':'track-point-b';
    const label=trackPoints.length===1?'A':'B';
    const icon=L.divIcon({className:'',html:`<div class="${cls}"></div>`,iconSize:[22,22],iconAnchor:[11,11]});
    trackMarkers.push(L.marker([point.lat,point.lng],{icon,zIndexOffset:1200}).addTo(map).bindTooltip(`${label} · ${fmtTime(point.time)}`,{permanent:true,direction:'top',offset:[0,-12]}));
    if(trackPoints.length===1){
      trackState.textContent='PUNTO A';trackingHint.textContent='Vai avanti nella timeline o premi ULTIMO, quindi tocca la stessa cella nella nuova posizione.';
    }else{
      const [a,b]=trackPoints, dt=(b.time-a.time)/3600, moved=distanceKm(a,b), speed=dt>0?moved/dt:0, heading=bearingDeg(a,b);
      const home={lat:LOCATION.lat,lng:LOCATION.lon}, distHome=distanceKm(b,home), toward=bearingDeg(b,home), deviation=angleDiff(heading,toward);
      trackLine=L.polyline([[a.lat,a.lng],[b.lat,b.lng]],{color:'#ffb44f',weight:4,dashArray:'8 7'}).addTo(map);
      trackDistance.textContent=`${distHome.toFixed(1)} km`;trackSpeed.textContent=speed?`${Math.round(speed)} km/h`:'--';trackDirection.textContent=`${compass(heading)} ${Math.round(heading)}°`;
      if(speed<3){trackState.textContent='STAZIONARIA';trackEta.textContent='--';}
      else if(deviation<=35){trackState.textContent='AVVICINAMENTO';trackEta.textContent=`~${Math.max(1,Math.round(distHome/speed*60))} min`;}
      else if(deviation>=145){trackState.textContent='ALLONTANAMENTO';trackEta.textContent='NON DIRETTA';}
      else{trackState.textContent='LATERALE';trackEta.textContent='TRAIETTORIA INCERTA';}
      trackingHint.textContent=`Spostamento stimato ${moved.toFixed(1)} km in ${Math.round(dt*60)} minuti. Ripeti i due punti se la cella cambia forma o direzione.`; autoEls.level.textContent=trackState.textContent; autoEls.cell.textContent=`${distHome.toFixed(1)} km`; autoEls.move.textContent=`${compass(heading)} ${Math.round(heading)}°`; autoEls.confidence.textContent='GUIDATA'; autoEls.summary.textContent=`Tracking guidato: cella a ${distHome.toFixed(1)} km, movimento ${trackState.textContent.toLowerCase()}. ETA mostrata solo quando la traiettoria è compatibile con Borgo Viazza.`;
      setTrackingActive(false);
    }
  });

  // Ripristina l'ultima configurazione usata.
  const saved=readState();
  if(saved.hailFocus){hailFocus=true;document.body.classList.add('hail-focus');hailFocusBtn.classList.add('active');hailFocusBtn.textContent='✓ FOCUS NUCLEI';}
  if([30,60,120].includes(Number(saved.minutes))) selectedMinutes=Number(saved.minutes);
  if([450,800,1200].includes(Number(saved.speed))){
    playMs=Number(saved.speed);
    [...els.speedControls.querySelectorAll('button')].forEach(x=>x.classList.toggle('active',Number(x.dataset.speed)===playMs));
  }
  const initialMode=['radar','lightning','forecast'].includes(saved.mode)?saved.mode:'radar';
  setOperationalMode(initialMode,{scroll:false});
  if(saved.stormMode) setTimeout(()=>setStormMode(true),700);

})();
