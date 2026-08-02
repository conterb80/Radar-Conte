const LIST_KEY='fanta-conte-list-v1';
const STATE_KEY='fanta-conte-profile-v1';
const META_KEY='fanta-conte-meta-v1';
const SETUP_KEY='fanta-conte-setup-v2';
const BACKUP_VERSION=2;

let players=JSON.parse(localStorage.getItem(LIST_KEY)||'null')||window.DEFAULT_PLAYERS;
let state=JSON.parse(localStorage.getItem(STATE_KEY)||'{}');
let meta=JSON.parse(localStorage.getItem(META_KEY)||'null')||{label:'Listone test 2025/26',date:''};
let setup=JSON.parse(localStorage.getItem(SETUP_KEY)||'null')||{teamName:'Fanta Conte',budget:500,slots:{P:3,D:8,C:8,A:6}};
let activeRole='TUTTI';
let activePlan='';
let activePlayer=null;

const $=s=>document.querySelector(s);
const list=$('#list');
const q=$('#q');
const dialog=$('#playerDialog');
const blank=()=>({fav:false,tier:'',maxPrice:'',notes:'',priority:'0',target:false,targetLevel:'',never:false,bought:false,isMine:false,buyPrice:'',buyOwner:''});
function profile(id){return {...blank(),...(state[id]||{})}}
function commitProfile(id,x){state[id]=x;saveState()}
function saveState(){localStorage.setItem(STATE_KEY,JSON.stringify(state))}
function saveSetup(){localStorage.setItem(SETUP_KEY,JSON.stringify(setup))}
function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
function ownerIsMine(x){return !!x.isMine || (!!x.bought && norm(x.buyOwner)===norm(setup.teamName))}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function roleLabel(r){return {P:'Portieri',D:'Difensori',C:'Centrocampisti',A:'Attaccanti'}[r]||r}
function planLabel(level){return {ASSOLUTO:'🔴 Priorità 1',PRIORITA2:'🟡 Priorità 2',PIANOB:'🔵 Piano B'}[level]||''}

function filtered(){
  const term=norm(q.value);
  const team=$('#teamFilter').value;
  const availability=$('#availabilityFilter').value;
  let rows=players.filter(p=>{
    const x=profile(p.id);
    const text=norm(`${p.n} ${p.t}`).includes(term);
    const role=activeRole==='TUTTI'||p.r===activeRole||(activeRole==='PREFERITI'&&x.fav)||(activeRole==='OBIETTIVI'&&(x.target||x.targetLevel));
    const status=availability==='ALL'||(availability==='AVAILABLE'&&!x.bought)||(availability==='BOUGHT'&&x.bought)||(availability==='MINE'&&ownerIsMine(x));
    const plan=!activePlan||x.targetLevel===activePlan;
    return text&&role&&status&&plan&&(!team||p.t===team);
  });
  const sort=$('#sortBy').value;
  rows.sort((a,b)=>{
    if(sort==='name') return a.n.localeCompare(b.n);
    if(sort==='team') return a.t.localeCompare(b.t)||a.n.localeCompare(b.n);
    if(sort==='fvm-desc') return num(b.fvm)-num(a.fvm)||num(b.qa)-num(a.qa);
    if(sort==='priority-desc') return planWeight(profile(b.id))-planWeight(profile(a.id))||num(profile(b.id).priority)-num(profile(a.id).priority)||num(b.qa)-num(a.qa);
    return num(b.qa)-num(a.qa)||num(b.fvm)-num(a.fvm);
  });
  return rows;
}

function planWeight(x){return {ASSOLUTO:30,PRIORITA2:20,PIANOB:10}[x.targetLevel]||0}

function buildTeams(){
  const select=$('#teamFilter');
  const old=select.value;
  select.innerHTML='<option value="">Tutte le squadre</option>'+[...new Set(players.map(p=>p.t).filter(Boolean))].sort().map(t=>`<option>${t}</option>`).join('');
  if([...select.options].some(o=>o.value===old)) select.value=old;
}

function auctionSnapshot(){
  const bought=players.filter(p=>profile(p.id).bought);
  const mine=players.filter(p=>ownerIsMine(profile(p.id)));
  const spent=mine.reduce((sum,p)=>sum+num(profile(p.id).buyPrice),0);
  const remaining=Math.max(0,num(setup.budget)-spent);
  return {bought,mine,spent,remaining};
}

function dashboard(){
  const {bought,mine,spent,remaining}=auctionSnapshot();
  const available=players.length-bought.length;

  $('#countAvailable').textContent=available;
  $('#countFav').textContent=players.filter(p=>profile(p.id).fav&&!profile(p.id).bought).length;
  $('#countTarget').textContent=players.filter(p=>(profile(p.id).target||profile(p.id).targetLevel)&&!profile(p.id).bought).length;
  $('#countBought').textContent=bought.length;
  $('#budgetDisplay').textContent=setup.budget;
  $('#spentBudget').textContent=spent;
  $('#remainingBudget').textContent=remaining;
  const openSlots=['P','D','C','A'].reduce((sum,r)=>sum+Math.max(0,num(setup.slots[r])-mine.filter(p=>p.r===r).length),0);
  $('#safeBid').textContent=Math.max(0,remaining-Math.max(0,openSlots-1));

  for(const r of ['P','D','C','A']){
    const have=mine.filter(p=>p.r===r).length;
    $('#mine'+r).textContent=have;
    $('#slot'+r).textContent=setup.slots[r]??0;
    $('#mine'+r).closest('div').classList.toggle('full',have>=num(setup.slots[r]));
  }
  renderRoleAdvice(mine,remaining);
  renderAuctionLog();
  renderIntelligence();
}

function renderRoleAdvice(mine,remaining){
  const box=$('#roleAdvice');
  box.innerHTML=['P','D','C','A'].map(r=>{
    const have=mine.filter(p=>p.r===r).length;
    const total=num(setup.slots[r]);
    const left=Math.max(0,total-have);
    return `<div class="advice ${left===0?'complete':''}"><strong>${r} · ${have}/${total}</strong><span>${left===0?'Reparto completo':`${left} posti da coprire`} · Budget ${remaining}</span></div>`;
  }).join('');
}

function renderIntelligence(){
  const available=players.filter(p=>!profile(p.id).bought);
  $('#countAbsolute').textContent=available.filter(p=>profile(p.id).targetLevel==='ASSOLUTO').length;
  $('#countSecond').textContent=available.filter(p=>profile(p.id).targetLevel==='PRIORITA2').length;
  $('#countPlanB').textContent=available.filter(p=>profile(p.id).targetLevel==='PIANOB').length;
  const box=$('#roleStats');
  box.innerHTML=['P','D','C','A'].map(r=>{
    const bought=players.filter(p=>p.r===r&&profile(p.id).bought);
    const remaining=players.filter(p=>p.r===r&&!profile(p.id).bought).length;
    const avg=bought.length?(bought.reduce((s,p)=>s+num(profile(p.id).buyPrice),0)/bought.length).toFixed(1):'–';
    const targets=players.filter(p=>p.r===r&&!profile(p.id).bought&&(profile(p.id).target||profile(p.id).targetLevel)).length;
    return `<div><b>${r}</b><strong>${remaining}</strong><span>liberi</span><small>Media asta ${avg} · 🎯 ${targets}</small></div>`;
  }).join('');
  document.querySelectorAll('.plan-cards button').forEach(b=>b.classList.toggle('active',b.dataset.plan===activePlan));
}

function boughtPlayers(){
  return players.filter(p=>profile(p.id).bought).sort((a,b)=>num(profile(b.id).buyPrice)-num(profile(a.id).buyPrice)||a.n.localeCompare(b.n));
}
function renderAuctionLog(){
  const box=$('#auctionLog');
  const rows=boughtPlayers();
  box.innerHTML=rows.length?rows.map(p=>{
    const x=profile(p.id);
    return `<div class="log-row"><div><strong>${p.n}</strong><small>${p.r} · ${p.t} · ${x.buyOwner||'Senza proprietario'} · ${x.buyPrice||0} crediti</small></div><button type="button" data-undo="${p.id}">Annulla</button></div>`;
  }).join(''):'<div class="empty">Nessun acquisto registrato.</div>';
}

function verdictFor(p,x){
  if(x.bought)return {cls:'neutral',text:'NON DISPONIBILE'};
  if(x.never||x.tier==='EVITA')return {cls:'red',text:'LASCIA'};
  if(x.targetLevel==='ASSOLUTO'||num(x.priority)>=5)return {cls:'green',text:x.maxPrice!==''?`FINO A ${x.maxPrice}`:'DA PRENDERE'};
  if(x.targetLevel==='PRIORITA2'||x.target||num(x.priority)>=3)return {cls:'amber',text:x.maxPrice!==''?`SOTTO ${x.maxPrice}`:'PREZZO GIUSTO'};
  if(x.targetLevel==='PIANOB'||num(x.priority)>0)return {cls:'blue',text:x.maxPrice!==''?`MAX ${x.maxPrice}`:'PIANO B'};
  if(x.maxPrice!==''&&num(x.maxPrice)<num(p.qa))return {cls:'red',text:'POCO MARGINE'};
  return {cls:'neutral',text:'MONITORA'};
}

function render(){
  const rows=filtered();
  list.innerHTML=rows.length?'':'<div class="empty">Nessun giocatore trovato con questi filtri.</div>';
  const frag=document.createDocumentFragment();
  rows.forEach(p=>{
    const x=profile(p.id);
    const diff=num(p.diff)>0?`+${p.diff}`:p.diff;
    const verdict=verdictFor(p,x);
    const card=document.createElement('article');
    card.className='card'+(x.bought?' bought':'')+(ownerIsMine(x)?' mine':'')+(x.never?' avoided':'');
    card.innerHTML=`
      <div class="role">${p.r}</div>
      <button class="open-player" type="button">
        <div class="player-head"><div class="player-name">${p.n}</div><span class="verdict ${verdict.cls}">${verdict.text}</span></div>
        <div class="meta">${p.t} · ${p.rm||p.r}</div>
        <div class="official"><span class="pill">Qt. ${p.qa}</span><span class="pill">FVM ${p.fvm}</span><span class="pill ${num(p.diff)>0?'up':num(p.diff)<0?'down':''}">${diff}</span></div>
        <div class="tags">
          ${x.targetLevel?`<span class="tag PLAN-${x.targetLevel}">${planLabel(x.targetLevel)}</span>`:''}
          ${x.tier?`<span class="tag ${x.tier}">${x.tier}</span>`:''}
          ${x.target&&!x.targetLevel?'<span class="tag TARGET">🎯 Obiettivo</span>':''}
          ${x.never?'<span class="tag EVITA">❌ Escluso</span>':''}
          ${x.maxPrice!==''?`<span class="tag">Max ${x.maxPrice}</span>`:''}
          ${num(x.priority)>0?`<span class="tag">${'★'.repeat(num(x.priority))}</span>`:''}
          ${x.notes?'<span class="tag">📝</span>':''}
          ${x.bought?`<span class="tag BOUGHT">${ownerIsMine(x)?'🟢 MIO':'✅ Preso'} · ${x.buyPrice||0} · ${x.buyOwner||'Senza nome'}</span>`:''}
        </div>
      </button>
      <button class="star ${x.fav?'on':''}" type="button" aria-label="Preferito">★</button>`;
    card.querySelector('.star').onclick=e=>{e.stopPropagation();x.fav=!x.fav;commitProfile(p.id,x);render()};
    card.querySelector('.open-player').onclick=()=>openPlayer(p);
    frag.appendChild(card);
  });
  list.appendChild(frag);
  dashboard();
  $('#seasonLabel').textContent=meta.label;
  $('#importInfo').textContent=`${players.length} giocatori caricati${meta.date?' · '+meta.date:''}`;
}

function syncQuickButtons(x){[['#quickFav','fav'],['#quickTarget','target'],['#quickNever','never']].forEach(([sel,key])=>$(sel).classList.toggle('active',!!x[key]))}
function openPlayer(p){
  activePlayer=p;const x=profile(p.id);
  $('#dialogName').textContent=p.n;$('#dialogMeta').textContent=`${p.t} · ruolo ${p.r}`;$('#dialogQa').textContent=p.qa;$('#dialogFvm').textContent=p.fvm;$('#dialogRm').textContent=p.rm||'-';
  $('#tier').value=x.tier||'';$('#targetLevel').value=x.targetLevel||'';$('#maxPrice').value=x.maxPrice??'';$('#notes').value=x.notes||'';$('#priority').value=String(x.priority||0);
  $('#bought').checked=!!x.bought;$('#isMine').checked=ownerIsMine(x);$('#buyPrice').value=x.buyPrice??'';$('#buyOwner').value=x.buyOwner||'';syncQuickButtons(x);dialog.showModal();
}
function toggleProfileFlag(key){if(!activePlayer)return;const x=profile(activePlayer.id);x[key]=!x[key];if(key==='never'&&x.never){x.target=false;x.targetLevel='';x.fav=false}commitProfile(activePlayer.id,x);syncQuickButtons(x)}
$('#quickFav').addEventListener('click',()=>toggleProfileFlag('fav'));
$('#quickTarget').addEventListener('click',()=>toggleProfileFlag('target'));
$('#quickNever').addEventListener('click',()=>toggleProfileFlag('never'));
$('#isMine').addEventListener('change',()=>{if($('#isMine').checked){$('#bought').checked=true;$('#buyOwner').value=setup.teamName||'Fanta Conte'}});
$('#bought').addEventListener('change',()=>{if(!$('#bought').checked)$('#isMine').checked=false});
$('#playerForm').addEventListener('submit',()=>{
  if(!activePlayer)return;const x=profile(activePlayer.id);
  Object.assign(x,{tier:$('#tier').value,targetLevel:$('#targetLevel').value,maxPrice:$('#maxPrice').value,notes:$('#notes').value.trim(),priority:$('#priority').value,bought:$('#bought').checked,isMine:$('#isMine').checked,buyPrice:$('#buyPrice').value,buyOwner:$('#buyOwner').value.trim()});
  if(x.targetLevel)x.target=true;if(x.isMine&&!x.buyOwner)x.buyOwner=setup.teamName;if(!x.bought){x.isMine=false;x.buyPrice='';x.buyOwner=''}commitProfile(activePlayer.id,x);render();toast('Scheda giocatore salvata');
});

q.addEventListener('input',render);$('#teamFilter').addEventListener('change',render);$('#sortBy').addEventListener('change',render);$('#availabilityFilter').addEventListener('change',render);
$('#roleTabs').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;activeRole=b.dataset.role;document.querySelectorAll('#roleTabs button').forEach(x=>x.classList.toggle('active',x===b));render()});
$('.plan-cards').addEventListener('click',e=>{const b=e.target.closest('button[data-plan]');if(!b)return;activePlan=activePlan===b.dataset.plan?'':b.dataset.plan;activeRole='OBIETTIVI';document.querySelectorAll('#roleTabs button').forEach(x=>x.classList.toggle('active',x.dataset.role==='OBIETTIVI'));$('#availabilityFilter').value='AVAILABLE';render()});
$('#showAllPlayers').addEventListener('click',()=>{activePlan='';activeRole='TUTTI';q.value='';$('#availabilityFilter').value='AVAILABLE';document.querySelectorAll('#roleTabs button').forEach(x=>x.classList.toggle('active',x.dataset.role==='TUTTI'));render()});

$('#toggleSetup').addEventListener('click',()=>{$('#setupPanel').hidden=!$('#setupPanel').hidden});
function loadSetupForm(){ $('#myTeamName').value=setup.teamName;$('#totalBudget').value=setup.budget;for(const r of ['P','D','C','A'])$('#slots'+r).value=setup.slots[r] }
$('#saveSetup').addEventListener('click',()=>{setup={teamName:$('#myTeamName').value.trim()||'Fanta Conte',budget:Math.max(1,num($('#totalBudget').value)||500),slots:{P:num($('#slotsP').value),D:num($('#slotsD').value),C:num($('#slotsC').value),A:num($('#slotsA').value)}};saveSetup();$('#setupPanel').hidden=true;render();toast('Impostazioni asta salvate')});

$('#fileInput').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{toast('Importazione in corso…');const imported=await FantaExcel.read(file);if(imported.length<50)throw new Error('Il file contiene troppo pochi giocatori');players=imported;localStorage.setItem(LIST_KEY,JSON.stringify(players));meta={label:file.name.replace(/\.(xlsx|xls|csv)$/i,''),date:new Date().toLocaleDateString('it-IT')};localStorage.setItem(META_KEY,JSON.stringify(meta));buildTeams();render();toast(`Importati ${players.length} giocatori`)}catch(err){console.error(err);toast('Errore: '+err.message,5000)}e.target.value=''});
function toast(msg,time=2600){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(window._toast);window._toast=setTimeout(()=>t.hidden=true,time)}
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(console.error));
loadSetupForm();buildTeams();render();

$('#toggleLog').addEventListener('click',()=>{const box=$('#auctionLog');box.hidden=!box.hidden;if(!box.hidden)renderAuctionLog()});
$('#auctionLog').addEventListener('click',e=>{const id=e.target?.dataset?.undo;if(!id)return;const x=profile(id);x.bought=false;x.isMine=false;x.buyPrice='';x.buyOwner='';commitProfile(id,x);render();toast('Acquisto annullato')});
$('#exportBackup').addEventListener('click',()=>{const payload={version:BACKUP_VERSION,createdAt:new Date().toISOString(),players,state,meta,setup};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`Fanta-Conte-backup-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(a.href);toast('Backup creato')});
$('#backupInput').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const data=JSON.parse(await file.text());if(!data||!Array.isArray(data.players)||typeof data.state!=='object')throw new Error('Backup non valido');players=data.players;state=data.state||{};meta=data.meta||meta;setup=data.setup||setup;localStorage.setItem(LIST_KEY,JSON.stringify(players));localStorage.setItem(STATE_KEY,JSON.stringify(state));localStorage.setItem(META_KEY,JSON.stringify(meta));saveSetup();loadSetupForm();buildTeams();render();toast('Backup ripristinato')}catch(err){toast('Errore nel backup: '+err.message,5000)}e.target.value=''});

// RC13 · modalità Preparazione/Asta e stato navigazione
(()=>{
  const links=[...document.querySelectorAll('.bottom-nav a[href^="#"]')];
  const sections=links.map(a=>document.querySelector(a.getAttribute('href'))).filter(Boolean);
  const setActive=id=>links.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+id));
  links.forEach(a=>a.addEventListener('click',()=>setActive(a.getAttribute('href').slice(1))));
  if('IntersectionObserver'in window){
    const observer=new IntersectionObserver(entries=>{
      const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
      if(visible)setActive(visible.target.id);
    },{rootMargin:'-25% 0px -58% 0px',threshold:[.05,.2,.5]});
    sections.forEach(s=>observer.observe(s));
  }
  setActive('listone');
})();


// RC13 · listone protagonista e pannelli operativi a comparsa
(()=>{
  const MODE_KEY='fanta-conte-view-mode-v1';
  const prepButton=document.getElementById('prepMode');
  const auctionButton=document.getElementById('auctionMode');
  const launchers=[...document.querySelectorAll('.panel-launchers [data-panel]')];
  const panels=new Map(launchers.map(button=>[button.dataset.panel,document.getElementById(button.dataset.panel)]));
  let mode=localStorage.getItem(MODE_KEY)==='auction'?'auction':'prep';

  const isOpen=panel=>panel && !panel.classList.contains('panel-collapsed');
  const syncLauncher=button=>{
    const open=isOpen(panels.get(button.dataset.panel));
    button.classList.toggle('open',open);
    button.setAttribute('aria-expanded',String(open));
    const arrow=button.querySelector('b');
    if(arrow)arrow.textContent=open?'⌃':'⌄';
  };
  const setPanel=(id,open,{scroll=false}={})=>{
    const panel=panels.get(id);
    if(!panel)return;
    panel.classList.toggle('panel-collapsed',!open);
    panel.setAttribute('aria-hidden',String(!open));
    const button=launchers.find(x=>x.dataset.panel===id);
    if(button)syncLauncher(button);
    if(open&&scroll)setTimeout(()=>panel.scrollIntoView({behavior:'smooth',block:'start'}),80);
  };
  const applyMode=(next,{save=true}={})=>{
    mode=next;
    document.body.dataset.viewMode=mode;
    prepButton.classList.toggle('active',mode==='prep');
    auctionButton.classList.toggle('active',mode==='auction');
    prepButton.setAttribute('aria-pressed',String(mode==='prep'));
    auctionButton.setAttribute('aria-pressed',String(mode==='auction'));
    if(mode==='prep'){
      ['asta','obiettivi','livePanel','strumenti'].forEach(id=>setPanel(id,false));
    }else{
      ['asta','obiettivi','livePanel'].forEach(id=>setPanel(id,true));
      setPanel('strumenti',false);
    }
    if(save)localStorage.setItem(MODE_KEY,mode);
  };

  launchers.forEach(button=>button.addEventListener('click',()=>{
    const id=button.dataset.panel;
    setPanel(id,!isOpen(panels.get(id)),{scroll:!isOpen(panels.get(id))});
  }));
  prepButton.addEventListener('click',()=>{applyMode('prep');document.getElementById('listone')?.scrollIntoView({behavior:'smooth',block:'start'})});
  auctionButton.addEventListener('click',()=>{applyMode('auction');document.getElementById('asta')?.scrollIntoView({behavior:'smooth',block:'start'})});

  // La navigazione inferiore apre il pannello necessario prima dello scorrimento.
  document.querySelectorAll('.bottom-nav a[href^="#"]').forEach(link=>link.addEventListener('click',event=>{
    const id=link.getAttribute('href').slice(1);
    if(panels.has(id)){
      event.preventDefault();
      setPanel(id,true);
      setTimeout(()=>panels.get(id).scrollIntoView({behavior:'smooth',block:'start'}),60);
    }
  }));

  applyMode(mode,{save:false});
})();
