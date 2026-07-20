(() => {
  'use strict';

  const LOCATION = { name: 'Borgo Viazza', lat: 44.447, lon: 12.013 };
  const API_URL = 'https://api.rainviewer.com/public/weather-maps.json';
  const REFRESH_MS = 5 * 60 * 1000;
  const PLAY_MS = 800;

  const els = {
    connectionBadge: document.getElementById('connectionBadge'),
    frameTime: document.getElementById('frameTime'),
    frameAge: document.getElementById('frameAge'),
    firstTime: document.getElementById('firstTime'),
    lastTime: document.getElementById('lastTime'),
    timeline: document.getElementById('timeline'),
    opacity: document.getElementById('opacity'),
    playBtn: document.getElementById('playBtn'),
    prevBtn: document.getElementById('prevBtn'),
    nextBtn: document.getElementById('nextBtn'),
    latestBtn: document.getElementById('latestBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    homeBtn: document.getElementById('homeBtn'),
    zoomLocalBtn: document.getElementById('zoomLocalBtn'),
    zoomRomagnaBtn: document.getElementById('zoomRomagnaBtn'),
    message: document.getElementById('message')
  };

  const map = L.map('map', {
    center: [LOCATION.lat, LOCATION.lon],
    zoom: 10,
    minZoom: 6,
    maxZoom: 13,
    zoomControl: false,
    preferCanvas: true,
    fadeAnimation: false
  });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    tileSize: 256,
    maxZoom: 19,
    updateWhenIdle: false,
    keepBuffer: 4,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  L.control.zoom({ position: 'bottomleft' }).addTo(map);

  const markerIcon = L.divIcon({
    className: '',
    html: '<div class="conte-marker"><span></span></div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  L.marker([LOCATION.lat, LOCATION.lon], { icon: markerIcon, zIndexOffset: 1000 })
    .addTo(map)
    .bindTooltip('BORGO VIAZZA', {
      permanent: true,
      direction: 'top',
      offset: [0, -13],
      opacity: 0.95,
      className: 'conte-tooltip'
    });

  L.circle([LOCATION.lat, LOCATION.lon], {
    radius: 10000,
    color: '#ffffff',
    weight: 1,
    opacity: 0.55,
    fill: false,
    dashArray: '5 7'
  }).addTo(map);

  let frames = [];
  let currentIndex = 0;
  let radarLayer = null;
  let host = 'https://tilecache.rainviewer.com';
  let playTimer = null;

  function setStatus(type, text) {
    els.connectionBadge.className = `status-pill ${type}`;
    els.connectionBadge.textContent = text;
  }

  function setMessage(text, type = 'info') {
    els.message.className = `message ${type}`;
    els.message.textContent = text;
  }

  function fmtTime(unix) {
    return new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit'
    }).format(new Date(unix * 1000));
  }

  function fmtDateTime(unix) {
    return new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Europe/Rome', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(new Date(unix * 1000));
  }

  function updateAge(unix) {
    const age = Math.max(0, Math.round((Date.now() - unix * 1000) / 60000));
    els.frameAge.textContent = `${age} min`;
  }

  function tileUrl(frame) {
    return `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
  }

  function showFrame(index) {
    if (!frames.length) return;
    currentIndex = Math.max(0, Math.min(index, frames.length - 1));
    const frame = frames[currentIndex];

    if (radarLayer) map.removeLayer(radarLayer);
    radarLayer = L.tileLayer(tileUrl(frame), {
      tileSize: 256,
      maxNativeZoom: 7,
      maxZoom: 13,
      opacity: Number(els.opacity.value) / 100,
      zIndex: 450,
      updateWhenIdle: false,
      keepBuffer: 4,
      errorTileUrl: '',
      attribution: 'Radar &copy; RainViewer'
    }).addTo(map);

    els.timeline.value = String(currentIndex);
    els.frameTime.textContent = fmtDateTime(frame.time).toUpperCase();
    updateAge(frame.time);
    els.latestBtn.classList.toggle('is-latest', currentIndex === frames.length - 1);
  }

  function stopPlayback() {
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    els.playBtn.textContent = '▶ PLAY';
    els.playBtn.setAttribute('aria-label', 'Avvia animazione');
  }

  function startPlayback() {
    if (!frames.length) return;
    if (currentIndex >= frames.length - 1) currentIndex = 0;
    els.playBtn.textContent = 'Ⅱ PAUSA';
    els.playBtn.setAttribute('aria-label', 'Metti in pausa animazione');
    playTimer = setInterval(() => {
      if (currentIndex >= frames.length - 1) showFrame(0);
      else showFrame(currentIndex + 1);
    }, PLAY_MS);
  }

  function togglePlayback() {
    if (playTimer) stopPlayback(); else startPlayback();
  }

  function goLatest() {
    stopPlayback();
    showFrame(frames.length - 1);
  }

  async function loadRadar({ quiet = false } = {}) {
    if (!quiet) {
      setStatus('loading', 'CARICAMENTO');
      setMessage('Sto scaricando gli ultimi fotogrammi radar…');
    }

    try {
      const response = await fetch(`${API_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const past = Array.isArray(data?.radar?.past) ? data.radar.past : [];
      if (!past.length) throw new Error('Nessun fotogramma disponibile');

      host = data.host || host;
      frames = past;
      els.timeline.max = String(frames.length - 1);
      els.firstTime.textContent = fmtTime(frames[0].time);
      els.lastTime.textContent = fmtTime(frames[frames.length - 1].time);
      goLatest();
      setStatus('ok', 'RADAR ONLINE');
      setMessage(`${frames.length} scansioni caricate · ultimo dato ${fmtTime(frames[frames.length - 1].time)}.`, 'success');
      setTimeout(() => map.invalidateSize(), 150);
    } catch (error) {
      console.error(error);
      setStatus('error', 'RADAR OFFLINE');
      setMessage('Non riesco a ricevere i dati radar. Controlla la connessione e premi AGGIORNA.', 'error');
    }
  }

  els.playBtn.addEventListener('click', togglePlayback);
  els.prevBtn.addEventListener('click', () => { stopPlayback(); showFrame(currentIndex - 1); });
  els.nextBtn.addEventListener('click', () => { stopPlayback(); showFrame(currentIndex + 1); });
  els.latestBtn.addEventListener('click', goLatest);
  els.refreshBtn.addEventListener('click', () => { stopPlayback(); loadRadar(); });
  els.timeline.addEventListener('input', event => { stopPlayback(); showFrame(Number(event.target.value)); });
  els.opacity.addEventListener('input', () => { if (radarLayer) radarLayer.setOpacity(Number(els.opacity.value) / 100); });
  els.homeBtn.addEventListener('click', () => map.setView([LOCATION.lat, LOCATION.lon], 10));
  els.zoomLocalBtn.addEventListener('click', () => map.setView([LOCATION.lat, LOCATION.lon], 11));
  els.zoomRomagnaBtn.addEventListener('click', () => map.setView([44.28, 11.98], 8));

  window.addEventListener('resize', () => map.invalidateSize());
  window.addEventListener('orientationchange', () => setTimeout(() => map.invalidateSize(), 300));
  window.addEventListener('online', () => loadRadar());
  window.addEventListener('offline', () => { setStatus('error', 'OFFLINE'); setMessage('Telefono senza connessione internet.', 'error'); });

  setInterval(() => loadRadar({ quiet: true }), REFRESH_MS);
  setInterval(() => { if (frames.length) updateAge(frames[currentIndex].time); }, 60000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js?v=2').catch(console.warn));
  }

  loadRadar();
})();
