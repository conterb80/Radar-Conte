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
      host=data.host||host;allFrames=past;applyRange(selectedMinutes);setStatus('ok','RADAR ONLINE');els.radarUpdated.textContent=nowTime();setMessage(`${frames.length} scansioni nell’intervallo selezionato · ultimo dato ${fmtTime(allFrames[allFrames.length-1].time)}.`,'success');setTimeout(()=>map.invalidateSize(),150);
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
  if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(console.warn));
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
      trackingHint.textContent=`Spostamento stimato ${moved.toFixed(1)} km in ${Math.round(dt*60)} minuti. Ripeti i due punti se la cella cambia forma o direzione.`;
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
