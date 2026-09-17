(() => {
  'use strict';

  const LOCATION={lat:44.447,lon:12.013};
  const RV='https://api.rainviewer.com/public/weather-maps.json';
  const $=id=>document.getElementById(id);

  function updateClock(){
    const now=new Date();
    $('clock').textContent=new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'}).format(now);
    $('date').textContent=new Intl.DateTimeFormat('it-IT',{timeZone:'Europe/Rome',weekday:'short',day:'2-digit',month:'short'}).format(now).toUpperCase();
  }
  updateClock();setInterval(updateClock,30000);

  const map=L.map('map',{zoomControl:true,minZoom:6,maxZoom:13}).setView([LOCATION.lat,LOCATION.lon],9);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,attribution:'© OpenStreetMap contributors'
  }).addTo(map);

  const markerIcon=L.divIcon({
    className:'',
    html:'<div class="conte-marker"></div>',
    iconSize:[18,18],iconAnchor:[9,9]
  });
  L.marker([LOCATION.lat,LOCATION.lon],{icon:markerIcon,zIndexOffset:1000})
    .addTo(map)
    .bindTooltip('BORGO VIAZZA',{permanent:true,direction:'top',offset:[0,-10],className:'conte-tooltip'});

  let host='https://tilecache.rainviewer.com',frames=[],idx=0,radarLayer=null,playing=false,timer=null;

  const fmtTime=unix=>new Intl.DateTimeFormat('it-IT',{
    timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'
  }).format(new Date(unix*1000));

  function status(text){$('radarStatus').textContent=text}

  function showFrame(n){
    if(!frames.length)return Promise.resolve(false);
    idx=Math.max(0,Math.min(frames.length-1,n));
    $('timeline').value=idx;
    const f=frames[idx];
    $('radarTime').textContent=fmtTime(f.time);

    return new Promise(resolve=>{
      const next=L.tileLayer(`${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,{
        maxZoom:18,maxNativeZoom:7,opacity:0,keepBuffer:3,updateWhenIdle:true
      }).addTo(map);
      let loaded=0,done=false;

      const finish=ok=>{
        if(done)return;done=true;
        if(ok){
          const old=radarLayer;
          radarLayer=next;next.setOpacity(.74);
          if(old)setTimeout(()=>{try{map.removeLayer(old)}catch(_){}},120);
          status(idx===frames.length-1?`Radar reale aggiornato · ${fmtTime(f.time)} · ADESSO`:`Radar reale · ${fmtTime(f.time)}`);
        }else{
          try{map.removeLayer(next)}catch(_){}
          status('Frame radar non disponibile.');
        }
        resolve(ok);
      };

      next.on('tileload',()=>loaded++);
      next.once('load',()=>finish(loaded>0));
      setTimeout(()=>finish(loaded>0),6500);
    });
  }

  function stop(){
    playing=false;
    $('play').textContent='▶ PLAY';
    if(timer){clearTimeout(timer);timer=null}
  }

  async function playLoop(){
    if(!playing)return;
    const next=idx>=frames.length-1?0:idx+1;
    await showFrame(next);
    if(playing)timer=setTimeout(playLoop,800);
  }

  $('play').addEventListener('click',()=>{
    if(playing){stop();return}
    playing=true;$('play').textContent='⏸ PAUSA';playLoop();
  });
  $('prev').addEventListener('click',()=>{stop();showFrame(idx-1)});
  $('next').addEventListener('click',()=>{stop();showFrame(idx+1)});
  $('latest').addEventListener('click',()=>{stop();showFrame(frames.length-1)});
  $('timeline').addEventListener('input',e=>{stop();showFrame(+e.target.value)});

  async function loadRadar(){
    try{
      status('Caricamento RainViewer…');
      const r=await fetch(RV,{cache:'no-store'});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const d=await r.json();
      host=d.host||host;
      const all=d.radar?.past||[];
      const cutoff=Math.floor(Date.now()/1000)-2*3600;
      frames=all.filter(f=>f.time>=cutoff);
      if(!frames.length)frames=all;
      if(!frames.length)throw new Error('nessun frame disponibile');
      idx=frames.length-1;
      $('timeline').max=frames.length-1;
      $('timeline').value=idx;
      await showFrame(idx);
    }catch(e){
      console.error(e);
      status(`Radar non disponibile: ${e.message||e}`);
    }
  }
  loadRadar();
  setInterval(loadRadar,90000);

  const lightningBase='https://map.blitzortung.org/index.php?interactive=1&NavigationControl=1&FullScreenControl=0&Cookies=0&InfoDiv=0&MenuButtonDiv=1&ScaleControl=1&LightningCheckboxChecked=1&LightningRangeValue=10&MapStyle=0&MapStyleRangeValue=0&Advertisment=0';
  const lightningViews={
    local:`${lightningBase}#8/44.447/12.013`,
    north:`${lightningBase}#6/44.8/11.2`
  };
  let lightningView='local';

  function loadLightning(view='local',force=false){
    lightningView=view;
    const base=lightningViews[view];
    $('lightningFrame').src=base+(force?`&reload=${Date.now()}`:'');
    $('openLightning').href=base;
    $('lightningLocal').classList.toggle('active',view==='local');
    $('lightningNorth').classList.toggle('active',view==='north');
  }
  $('lightningLocal').addEventListener('click',()=>loadLightning('local',true));
  $('lightningNorth').addEventListener('click',()=>loadLightning('north',true));
  $('reloadLightning').addEventListener('click',()=>loadLightning(lightningView,true));

  const EVOLUTION_WEB='https://www.meteoeradar.it/radar-meteo?center=41.76,12&zoom=5.04&layer=wr';

  // Chrome/Android intent: prova ad aprire il package dell'app ufficiale.
  // Se l'intent non viene gestito, Chrome usa il fallback web.
  const EVOLUTION_INTENT =
    'intent://www.meteoeradar.it/radar-meteo?center=41.76,12&zoom=5.04&layer=wr' +
    '#Intent;scheme=https;package=de.wetteronline.wetterapp;' +
    'S.browser_fallback_url=' + encodeURIComponent(EVOLUTION_WEB) + ';end';

  function openEvolutionApp(){
    const status=$('appLaunchStatus');
    if(status) status.textContent='Apertura app Meteo & Radar…';
    window.location.href=EVOLUTION_INTENT;

    // Se la pagina resta visibile, mostriamo soltanto il fallback manuale.
    setTimeout(()=>{
      if(document.visibilityState==='visible' && status){
        status.textContent='Se l’app non si è aperta, usa “APRI MAPPA WEB”.';
      }
    },1400);
  }

  function selectMode(mode){
    const modes=['radar','lightning','evolution'];
    for(const m of modes){
      $(`${m}Tab`).classList.toggle('active',m===mode);
      $(`${m}Panel`).hidden=m!==mode;
    }
    if(mode==='radar'){
      setTimeout(()=>map.invalidateSize(),120);
    }else{
      stop();
      if(mode==='lightning'&&!$('lightningFrame').src)loadLightning();

    }
  }

  $('radarTab').addEventListener('click',()=>selectMode('radar'));
  $('lightningTab').addEventListener('click',()=>selectMode('lightning'));
  $('evolutionTab').addEventListener('click',()=>selectMode('evolution'));
  $('openMeteoRadarApp').addEventListener('click',openEvolutionApp);
})();