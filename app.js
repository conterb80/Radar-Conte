(() => {
  'use strict';
  if (typeof L === 'undefined') {
    document.body.innerHTML = '<main class="app-shell"><section class="message error">Impossibile caricare il motore cartografico. Controlla la connessione e ricarica la pagina.</section></main>';
    return;
  }

  const LOCATION = { name: 'Borgo Viazza', lat: 44.447, lon: 12.013 };
  const API_URL = 'https://api.rainviewer.com/public/weather-maps.json';
  const REFRESH_MS = 3 * 60 * 1000;
  const UI_STATE_KEY = 'radarConteP8State';
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
  const tileUrl=frame=>`${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;


  // P11.1.1: prima lettura automatica prudente dei pixel radar attorno a Borgo Viazza.
  // Non inventa ETA o fulmini: se le tile non sono leggibili via CORS restituisce "non disponibile".
  const autoEls={
    run:$('runAutoAnalysisBtn'), level:$('autoLevel'), summary:$('autoSummary'), rain:$('autoRain'),
    cell:$('autoCell'), move:$('autoMove'), confidence:$('autoConfidence')
  };
  const mercatorTile=(lat,lon,z)=>{
    const n=2**z, x=(lon+180)/360*n, y=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n;
    return {tx:Math.floor(x),ty:Math.floor(y),px:Math.floor((x-Math.floor(x))*256),py:Math.floor((y-Math.floor(y))*256)};
  };
  const loadTileImage=url=>new Promise((resolve,reject)=>{const img=new Image();img.crossOrigin='anonymous';img.onload=()=>resolve(img);img.onerror=reject;img.src=url;});
  async function sampleFrame(frame){
    const z=7,{tx,ty,px,py}=mercatorTile(LOCATION.lat,LOCATION.lon,z);
    const url=`${host}${frame.path}/256/${z}/${tx}/${ty}/2/1_1.png`;
    const img=await loadTileImage(url);const c=document.createElement('canvas');c.width=256;c.height=256;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
    const d=ctx.getImageData(0,0,256,256).data;let active=0,strong=0,sumX=0,sumY=0,weight=0,near=0;
    const radius=56;
    for(let yy=Math.max(0,py-radius);yy<Math.min(256,py+radius);yy+=2){for(let xx=Math.max(0,px-radius);xx<Math.min(256,px+radius);xx+=2){
      const i=(yy*256+xx)*4,a=d[i+3];if(a<30)continue;const r=d[i],g=d[i+1],b=d[i+2];
      const max=Math.max(r,g,b),min=Math.min(r,g,b),sat=max-min;
      if(sat<18 && max<90)continue;
      const w=1+sat/80+(r>180&&g<130?2:0)+(r>190&&b>150?2:0);
      active++;if((r>170&&g<180)||(r>175&&b>130))strong++;sumX+=xx*w;sumY+=yy*w;weight+=w;
      if(Math.hypot(xx-px,yy-py)<10)near++;
    }}
    return {active,strong,near,cx:weight?sumX/weight:px,cy:weight?sumY/weight:py,px,py};
  }
  function directionFromDelta(dx,dy){if(Math.hypot(dx,dy)<2)return 'STAZIONARIO/INCERTO';const a=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;return compass(a);}
  async function runAutomaticAnalysis(){
    if(!allFrames.length){autoEls.level.textContent='DATI NON DISPONIBILI';autoEls.summary.textContent='Attendo i fotogrammi radar.';return;}
    autoEls.level.textContent='ANALISI IN CORSO';autoEls.summary.textContent='Campionamento degli ultimi fotogrammi radar attorno a Borgo Viazza…';
    try{
      const latest=allFrames.at(-1), prev=allFrames[Math.max(0,allFrames.length-3)];
      const [a,b]=await Promise.all([sampleFrame(prev),sampleFrame(latest)]);
      const rain=b.near>=3?'IN CORSO':b.active>35?'NELLE VICINANZE':'NON RILEVATA';
      const intensity=b.strong>18?'NUCLEO FORTE':b.active>70?'NUCLEO MODERATO':b.active>20?'ECO DEBOLE':'NESSUN NUCLEO';
      const move=directionFromDelta(b.cx-a.cx,b.cy-a.cy);
      const confidence=b.active>40&&a.active>20?'MEDIA':b.active>15?'BASSA':'LIMITATA';
      autoEls.rain.textContent=rain;autoEls.cell.textContent=intensity;autoEls.move.textContent=move;autoEls.confidence.textContent=confidence;
      autoEls.level.textContent=rain==='IN CORSO'?'ATTENZIONE LOCALE':intensity.includes('FORTE')?'NUCLEO VICINO':'SITUAZIONE OSSERVATA';
      autoEls.summary.textContent=`Radar: ${rain.toLowerCase()}. ${intensity.toLowerCase()} nell’area campionata. Movimento pixel stimato verso ${move}. Nessuna ETA viene mostrata in questa fase.`;
    }catch(err){console.warn('Analisi automatica non disponibile',err);autoEls.level.textContent='LETTURA NON DISPONIBILE';autoEls.summary.textContent='Il radar funziona, ma il browser non consente di leggere direttamente i pixel della mappa. Nessuna conclusione automatica è stata prodotta.';autoEls.rain.textContent='--';autoEls.cell.textContent='--';autoEls.move.textContent='--';autoEls.confidence.textContent='NESSUNA';}
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
      host=data.host||host;allFrames=past;applyRange(selectedMinutes);setStatus('ok','RADAR ONLINE');els.radarUpdated.textContent=nowTime();setMessage(`${frames.length} scansioni nell’intervallo selezionato · ultimo dato ${fmtTime(allFrames[allFrames.length-1].time)}.`,'success');setTimeout(()=>map.invalidateSize(),150);setTimeout(runAutomaticAnalysis,500);
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
    else{els.installHelp.hidden=false;els.installHelp.textContent='Apri il menu ⋮ di Chrome e scegli “Installa app”. Se compare solo “Aggiungi a schermata Home”, ricarica una volta la P8 e attendi qualche secondo.';}
  });
  window.addEventListener('appinstalled',()=>{els.installBtn.hidden=true;els.installHelp.hidden=false;els.installHelp.textContent='Radar Conte è installato correttamente.';});

  window.addEventListener('resize',()=>map.invalidateSize()); window.addEventListener('orientationchange',()=>setTimeout(()=>map.invalidateSize(),300));
  window.addEventListener('online',()=>loadRadar()); window.addEventListener('offline',()=>{setStatus('error','OFFLINE');setMessage('Telefono senza connessione internet.','error');});
  setInterval(()=>loadRadar({quiet:true}),REFRESH_MS); setInterval(()=>{if(frames.length)updateAge(frames[currentIndex].time);},60000);
  if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/Radar-Conte/service-worker.js', { scope: '/Radar-Conte/' }).catch(console.warn));
  loadRadar();


  // P11.1.1.1: mappa fulmini controllata dall'app. Il marker usa vere coordinate geografiche
  // e resta agganciato a Borgo Viazza durante spostamenti e zoom.
  const radarModeBtn = document.getElementById('radarModeBtn');
  const lightningModeBtn = document.getElementById('lightningModeBtn');
  const radarPanel = document.getElementById('radarPanel');
  const lightningPanel = document.getElementById('lightningPanel');
  const lightningFrame = document.getElementById('lightningFrame');
  const lightningViewport = document.getElementById('lightningViewport');
  const lightningGestureLayer = document.getElementById('lightningGestureLayer');
  const lightningHomeMarker = document.getElementById('lightningHomeMarker');
  const lightningZoomIn = document.getElementById('lightningZoomIn');
  const lightningZoomOut = document.getElementById('lightningZoomOut');
  const lightningRecenter = document.getElementById('lightningRecenter');
  const reloadLightningBtn = document.getElementById('reloadLightningBtn');
  const lightningLocalBtn = document.getElementById('lightningLocalBtn');
  const lightningNorthBtn = document.getElementById('lightningNorthBtn');
  const openLightningLink = document.getElementById('openLightningLink');

  const lightningBase = 'https://map.blitzortung.org/index.php?interactive=0&NavigationControl=0&FullScreenControl=0&Cookies=0&InfoDiv=0&MenuButtonDiv=0&ScaleControl=1&LightningCheckboxChecked=1&LightningRangeValue=10&MapStyle=0&MapStyleRangeValue=0&Advertisment=0';
  const lightningPresets = {
    local: { zoom: 8, lat: LOCATION.lat, lon: LOCATION.lon },
    north: { zoom: 6, lat: 44.8, lon: 11.2 }
  };
  let currentLightningView = 'local';
  let lightningCamera = { ...lightningPresets.local };
  let dragStart = null;
  let dragDelta = { x: 0, y: 0 };

  const clamp = (value,min,max)=>Math.max(min,Math.min(max,value));
  function mercatorPoint(lat,lon,zoom){
    const scale=256*Math.pow(2,zoom);
    const safeLat=clamp(lat,-85.05112878,85.05112878);
    const sin=Math.sin(safeLat*Math.PI/180);
    return {x:(lon+180)/360*scale,y:(0.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*scale,scale};
  }
  function mercatorLatLon(x,y,zoom){
    const scale=256*Math.pow(2,zoom);
    const lon=x/scale*360-180;
    const n=Math.PI-2*Math.PI*y/scale;
    const lat=180/Math.PI*Math.atan(Math.sinh(n));
    return {lat:clamp(lat,-85.05112878,85.05112878),lon:((lon+540)%360)-180};
  }
  function lightningUrl(camera=lightningCamera, force=false){
    const cacheBust=force?`&reload=${Date.now()}`:'';
    return `${lightningBase}${cacheBust}#${camera.zoom}/${camera.lat.toFixed(5)}/${camera.lon.toFixed(5)}`;
  }
  function updateLightningMarker(extraX=0,extraY=0){
    if(!lightningViewport || !lightningHomeMarker) return;
    const rect=lightningViewport.getBoundingClientRect();
    const center=mercatorPoint(lightningCamera.lat,lightningCamera.lon,lightningCamera.zoom);
    const home=mercatorPoint(LOCATION.lat,LOCATION.lon,lightningCamera.zoom);
    let dx=home.x-center.x;
    const world=center.scale;
    if(dx>world/2) dx-=world;
    if(dx<-world/2) dx+=world;
    const x=rect.width/2+dx+extraX;
    const y=rect.height/2+(home.y-center.y)+extraY;
    lightningHomeMarker.style.left=`${x}px`;
    lightningHomeMarker.style.top=`${y}px`;
    const visible=x>-55&&x<rect.width+55&&y>-55&&y<rect.height+70;
    lightningHomeMarker.style.display=visible?'flex':'none';
  }
  function loadLightning(view=currentLightningView, force=false, cameraOverride=null){
    currentLightningView=view;
    if(cameraOverride) lightningCamera={...cameraOverride};
    else if(view in lightningPresets) lightningCamera={...lightningPresets[view]};
    lightningViewport.classList.add('is-loading');
    lightningFrame.style.transform='translate3d(0,0,0)';
    lightningFrame.src=lightningUrl(lightningCamera,force);
    openLightningLink.href=lightningUrl(lightningCamera,false).replace('interactive=0','interactive=1').replace('NavigationControl=0','NavigationControl=1').replace('MenuButtonDiv=0','MenuButtonDiv=1');
    els.lightningUpdated.textContent=nowTime();
    lightningLocalBtn.classList.toggle('active',view==='local');
    lightningNorthBtn.classList.toggle('active',view==='north');
    requestAnimationFrame(()=>updateLightningMarker());
  }
  lightningFrame.addEventListener('load',()=>{lightningViewport.classList.remove('is-loading');updateLightningMarker();});
  reloadLightningBtn.addEventListener('click',()=>loadLightning(currentLightningView,true,lightningCamera));
  lightningLocalBtn.addEventListener('click',()=>loadLightning('local',true));
  lightningNorthBtn.addEventListener('click',()=>loadLightning('north',true));
  lightningRecenter.addEventListener('click',()=>loadLightning('local',true));
  lightningZoomIn.addEventListener('click',()=>{lightningCamera.zoom=clamp(lightningCamera.zoom+1,4,11);loadLightning(currentLightningView,true,lightningCamera);});
  lightningZoomOut.addEventListener('click',()=>{lightningCamera.zoom=clamp(lightningCamera.zoom-1,4,11);loadLightning(currentLightningView,true,lightningCamera);});

  lightningGestureLayer.addEventListener('pointerdown',(event)=>{
    dragStart={x:event.clientX,y:event.clientY,center:mercatorPoint(lightningCamera.lat,lightningCamera.lon,lightningCamera.zoom)};
    dragDelta={x:0,y:0};
    lightningGestureLayer.classList.add('dragging');
    lightningGestureLayer.setPointerCapture(event.pointerId);
  });
  lightningGestureLayer.addEventListener('pointermove',(event)=>{
    if(!dragStart) return;
    dragDelta={x:event.clientX-dragStart.x,y:event.clientY-dragStart.y};
    lightningFrame.style.transform=`translate3d(${dragDelta.x}px,${dragDelta.y}px,0)`;
    updateLightningMarker(dragDelta.x,dragDelta.y);
  });
  function finishLightningDrag(event){
    if(!dragStart) return;
    const moved=Math.hypot(dragDelta.x,dragDelta.y);
    lightningGestureLayer.classList.remove('dragging');
    try{lightningGestureLayer.releasePointerCapture(event.pointerId);}catch(_){ }
    if(moved>4){
      const next=mercatorLatLon(dragStart.center.x-dragDelta.x,dragStart.center.y-dragDelta.y,lightningCamera.zoom);
      lightningCamera={...lightningCamera,...next};
      currentLightningView='custom';
      lightningLocalBtn.classList.remove('active');
      lightningNorthBtn.classList.remove('active');
      loadLightning('custom',true,lightningCamera);
    }else{
      lightningFrame.style.transform='translate3d(0,0,0)';
      updateLightningMarker();
    }
    dragStart=null;dragDelta={x:0,y:0};
  }
  lightningGestureLayer.addEventListener('pointerup',finishLightningDrag);
  lightningGestureLayer.addEventListener('pointercancel',finishLightningDrag);
  window.addEventListener('resize',()=>updateLightningMarker());

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

  function setOperationalMode(mode){
    saveState({mode});
    const radar = mode === 'radar';
    const lightning = mode === 'lightning';
    const forecast = mode === 'forecast';
    radarPanel.hidden = !radar;
    lightningPanel.hidden = !lightning;
    forecastPanel.hidden = !forecast;
    radarModeBtn.classList.toggle('active', radar);
    lightningModeBtn.classList.toggle('active', lightning);
    forecastModeBtn.classList.toggle('active', forecast);
    if(!radar) stopPlayback();
    if(radar){
      setMessage(`${frames.length || 0} scansioni nell’intervallo selezionato.`, 'success');
      setTimeout(()=>map.invalidateSize(),100);
    } else if(lightning){
      if(!lightningFrame.src) loadLightning(currentLightningView);
      setMessage('Monitor fulmini live attivo. I dati sono forniti da Blitzortung.org.', 'success');
    } else {
      if(!forecastFrame.src) loadForecast();
      setMessage('Evoluzione ARPAE attiva: osservato e previsione fino a +3 ore.', 'success');
    }
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
      setMessage('Modalità Temporale attiva: radar locale, ultimi 30 minuti, animazione veloce e aggiornamento automatico ogni 3 minuti.','success');
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
    const state=readState();
    if(state.mode==='lightning') loadLightning(currentLightningView,true);
    if(state.mode==='forecast') loadForecast(true);
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
  setOperationalMode(initialMode);
  if(saved.stormMode) setTimeout(()=>setStormMode(true),700);

})();
