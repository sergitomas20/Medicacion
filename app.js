const APP_VERSION = '2.1.0';
const STORAGE_KEY = 'mi-pauta-lorazepam-v2';
const DB_NAME = 'mi-pauta-db';
const DB_STORE = 'state';
const DB_KEY = 'main';

const PLAN = [
  { lor: 3.0, preg: 300 },
  { lor: 2.5, preg: 400 },
  { lor: 2.0, preg: 500 },
  { lor: 1.5, preg: 600 },
  { lor: 1.0, preg: 600 },
  { lor: 0.5, preg: 600 },
  { lor: 0.0, preg: 600 }
];

// Modelo orientativo de tolerancia: dos escalas de adaptación + no linealidad.
// No es un modelo clínico validado y no debe utilizarse para calcular dosis.
const MODEL = {
  fastHalfLifeDays: 3.5,
  slowHalfLifeDays: 21,
  transformPower: 1.15,
  fastWeight: 0.42,
  slowWeight: 0.58,
  hillN: 1.45,
  hillEC50: 2.2,
  defaultBaselineMg: 6
};

let state = initialState();
let activeDoseDrug = 'lorazepam';
let toastTimer;

function initialState(){
  return {
    version: APP_VERSION,
    startedAt: null,
    startDate: null,
    baselineDailyMg: MODEL.defaultBaselineMg,
    logs: [],
    updatedAt: Date.now(),
    lastBackupAt: null
  };
}

function normalizeState(raw){
  const base = initialState();
  if(!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    version: APP_VERSION,
    logs: Array.isArray(raw.logs) ? raw.logs.filter(validLog) : [],
    baselineDailyMg: Number.isFinite(Number(raw.baselineDailyMg)) ? Math.max(0, Number(raw.baselineDailyMg)) : MODEL.defaultBaselineMg,
    updatedAt: Number(raw.updatedAt) || Date.now()
  };
}

function validLog(log){
  return log && (log.drug === 'lorazepam' || log.drug === 'pregabalin') && Number(log.amountMg) >= 0 && !Number.isNaN(new Date(log.at).getTime());
}

async function loadState(){
  let local = null;
  try{ local = JSON.parse(localStorage.getItem(STORAGE_KEY)); }catch{}
  let indexed = null;
  try{ indexed = await idbRead(); }catch{}
  const candidates = [local,indexed].filter(Boolean).map(normalizeState);
  if(candidates.length){ state = candidates.sort((a,b)=>b.updatedAt-a.updatedAt)[0]; }
  else state = initialState();
  await persistState(false);
}

async function persistState(renderAfter=true){
  state.updatedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  try{ await idbWrite(state); }catch{}
  if(renderAfter) render();
}

function openDb(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME,1);
    req.onupgradeneeded = ()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

async function idbWrite(value){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readwrite');
    tx.objectStore(DB_STORE).put(value,DB_KEY);
    tx.oncomplete=()=>{db.close();resolve();};
    tx.onerror=()=>{db.close();reject(tx.error);};
  });
}

async function idbRead(){
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readonly');
    const req=tx.objectStore(DB_STORE).get(DB_KEY);
    req.onsuccess=()=>{db.close();resolve(req.result||null);};
    req.onerror=()=>{db.close();reject(req.error);};
  });
}

function isoDate(date=new Date()){
  const y=date.getFullYear();
  const m=String(date.getMonth()+1).padStart(2,'0');
  const d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function parseLocalDate(iso){const [y,m,d]=iso.split('-').map(Number);return new Date(y,m-1,d,12,0,0);}
function addDays(iso,n){const d=parseLocalDate(iso);d.setDate(d.getDate()+n);return isoDate(d);}
function daysBetween(a,b){return Math.floor((parseLocalDate(b)-parseLocalDate(a))/86400000);}
function formatDate(iso,options={}){return new Intl.DateTimeFormat('es-ES',{day:'numeric',month:'long',...options}).format(parseLocalDate(iso));}
function formatShort(iso){return new Intl.DateTimeFormat('es-ES',{weekday:'short',day:'numeric'}).format(parseLocalDate(iso)).replace('.','');}
function formatTodayLong(){return new Intl.DateTimeFormat('es-ES',{weekday:'long',day:'numeric',month:'long'}).format(new Date());}
function formatTime(dateIso){return new Intl.DateTimeFormat('es-ES',{hour:'2-digit',minute:'2-digit'}).format(new Date(dateIso));}
function roundSmart(n){return Math.round((Number(n)+Number.EPSILON)*100)/100;}
function mg(n){return `${Number.isInteger(Number(n))?Number(n):roundSmart(n)} mg`;}
function signed(n){const v=roundSmart(n);return `${v>0?'+':''}${v}`;}
function uid(){return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;}

function getPosition(dateIso=isoDate()){
  if(!state.startDate) return {started:false,elapsed:0,stageIndex:0,dayInStage:1};
  const elapsed=Math.max(0,daysBetween(state.startDate,dateIso));
  const stageIndex=Math.min(PLAN.length-1,Math.floor(elapsed/5));
  const dayInStage=stageIndex===PLAN.length-1?1:(elapsed%5)+1;
  return {started:true,elapsed,stageIndex,dayInStage};
}
function targetForDate(dateIso){
  if(!state.startDate || daysBetween(state.startDate,dateIso)<0) return null;
  return PLAN[getPosition(dateIso).stageIndex];
}
function logsForDate(dateIso,drug){
  return state.logs.filter(l=>isoDate(new Date(l.at))===dateIso && (!drug || l.drug===drug));
}
function totalForDate(dateIso,drug){return roundSmart(logsForDate(dateIso,drug).reduce((s,l)=>s+Number(l.amountMg||0),0));}
function logDates(drug='lorazepam'){return [...new Set(state.logs.filter(l=>l.drug===drug).map(l=>isoDate(new Date(l.at))))];}

function modelStartDate(){
  if(!state.startDate) return new Date();
  if(state.startedAt){
    const started=new Date(state.startedAt);
    if(!Number.isNaN(started.getTime()) && isoDate(started)===state.startDate) return started;
  }
  const [y,m,d]=state.startDate.split('-').map(Number);
  return new Date(y,m-1,d,0,0,0,0);
}
function decayFactor(halfLifeDays,days){return Math.pow(0.5,days/halfLifeDays);}

function toleranceScoreAt(now=new Date()){
  const baseline=Math.max(0,Number(state.baselineDailyMg)||0);
  const start=modelStartDate();
  if(now<=start){
    const eN=Math.pow(baseline,MODEL.hillN);
    const ecN=Math.pow(MODEL.hillEC50,MODEL.hillN);
    return {score:eN+ecN===0?0:100*eN/(eN+ecN),equivalent:baseline,fast:baseline,slow:baseline};
  }

  // Estados adaptativos continuos: cada toma registrada suma exposición y
  // ambos estados decaen exponencialmente con velocidades diferentes.
  let fast=baseline;
  let slow=baseline;
  let cursor=start;
  const kFast=1-decayFactor(MODEL.fastHalfLifeDays,1);
  const kSlow=1-decayFactor(MODEL.slowHalfLifeDays,1);
  const events=state.logs
    .filter(l=>l.drug==='lorazepam')
    .map(l=>({...l,date:new Date(l.at)}))
    .filter(l=>l.date>=start && l.date<=now)
    .sort((a,b)=>a.date-b.date);

  for(const event of events){
    const dt=Math.max(0,(event.date-cursor)/86400000);
    fast*=decayFactor(MODEL.fastHalfLifeDays,dt);
    slow*=decayFactor(MODEL.slowHalfLifeDays,dt);
    const dose=Math.max(0,Number(event.amountMg)||0);
    fast+=kFast*dose;
    slow+=kSlow*dose;
    cursor=event.date;
  }

  const tail=Math.max(0,(now-cursor)/86400000);
  fast*=decayFactor(MODEL.fastHalfLifeDays,tail);
  slow*=decayFactor(MODEL.slowHalfLifeDays,tail);

  const equivalent=Math.max(0,MODEL.fastWeight*fast+MODEL.slowWeight*slow);
  const eN=Math.pow(equivalent,MODEL.hillN);
  const ecN=Math.pow(MODEL.hillEC50,MODEL.hillN);
  const score=eN+ecN===0?0:100*eN/(eN+ecN);
  return {score:Math.max(0,Math.min(100,score)),equivalent,fast,slow};
}

function toleranceScoreDaysAgo(daysAgo){
  const d=new Date(); d.setDate(d.getDate()-daysAgo);
  const start=modelStartDate();
  if(d<start) return null;
  return toleranceScoreAt(d).score;
}
function toleranceBand(score){
  if(score<25)return {text:'Baja',cls:'low'};
  if(score<50)return {text:'Moderada',cls:'medium'};
  if(score<75)return {text:'Alta',cls:'high'};
  return {text:'Muy alta',cls:'very-high'};
}

function render(){
  document.getElementById('todayLabel').textContent=capitalize(formatTodayLong());
  const started=!!state.startDate;
  document.getElementById('startCard').classList.toggle('hidden',started);
  document.getElementById('activeApp').classList.toggle('hidden',!started);
  document.getElementById('bottomNav').classList.toggle('hidden',!started);
  syncSettingsInputs();
  if(!started)return;
  renderPhase();renderDrugCards();renderTolerance();renderNextChange();renderRecent();renderStats();renderPlan();renderBackupState();
}

function renderPhase(){
  const pos=getPosition(); const target=PLAN[pos.stageIndex];
  document.getElementById('phaseLabel').textContent=pos.stageIndex===PLAN.length-1?'Fase final · Lorazepam retirado':`Fase ${pos.stageIndex+1} · Día ${pos.dayInStage} de 5`;
  document.getElementById('todayTargetTitle').textContent=`${mg(target.lor)} de lorazepam`;
  document.getElementById('todayTargetSubtitle').textContent=`y ${mg(target.preg)} de pregabalina`;
  const ring=document.getElementById('dayRing'); const pct=pos.stageIndex===PLAN.length-1?100:pos.dayInStage*20;
  ring.style.setProperty('--p',`${pct}%`); document.getElementById('dayRingText').textContent=pos.stageIndex===PLAN.length-1?'✓':`${pos.dayInStage}/5`;
  if(pos.stageIndex>=PLAN.length-1){document.getElementById('nextChangeMini').textContent='plan completado';}
  else{
    const next=addDays(state.startDate,(pos.stageIndex+1)*5); const left=Math.max(0,daysBetween(isoDate(),next));
    document.getElementById('nextChangeMini').textContent=left===0?'hoy':`en ${left} ${left===1?'día':'días'}`;
  }
}

function setDelta(el,actual,target,isToday=true){
  el.className='delta-badge'; const diff=roundSmart(actual-target);
  if(actual===0 && isToday){el.classList.add('neutral');el.textContent='sin registros';return;}
  if(Math.abs(diff)<0.01){el.classList.add('good');el.textContent='en objetivo';}
  else if(diff>0){el.classList.add('over');el.textContent=`+${mg(diff)}`;}
  else{el.classList.add('under');el.textContent=`${mg(Math.abs(diff))} por debajo`;}
}
function renderDrugCards(){
  const today=isoDate(); const target=targetForDate(today); if(!target)return;
  const lor=totalForDate(today,'lorazepam'); const preg=totalForDate(today,'pregabalin');
  document.getElementById('lorTarget').textContent=`${mg(target.lor)} pautados`;
  document.getElementById('pregTarget').textContent=`${mg(target.preg)} pautados`;
  document.getElementById('lorLogged').textContent=mg(lor); document.getElementById('pregLogged').textContent=mg(preg);
  setDelta(document.getElementById('lorDelta'),lor,target.lor); setDelta(document.getElementById('pregDelta'),preg,target.preg);
  const over=lor-target.lor>0.001; document.getElementById('overTargetAlert').classList.toggle('hidden',!over);
  if(over){
    const extra=roundSmart(lor-target.lor);
    document.getElementById('overTargetTitle').textContent=`Hoy has registrado ${mg(extra)} por encima de la pauta`;
    document.getElementById('overTargetText').textContent='La app lo cuenta en estadísticas y en la tendencia de exposición. No uses el indicador de tolerancia para decidir dosis.';
  }
}

function renderTolerance(){
  const model=toleranceScoreAt(new Date()); const score=Math.round(model.score); const band=toleranceBand(score);
  document.getElementById('toleranceScore').textContent=score;
  document.getElementById('toleranceOrb').style.setProperty('--score',score);
  document.getElementById('toleranceOrb').style.setProperty('--angle',`${Math.max(0,Math.min(100,score))*2.7}deg`);
  const label=document.getElementById('toleranceLabel'); label.textContent=band.text; label.className=`tolerance-label ${band.cls}`;
  const days=state.startDate?Math.max(0,daysBetween(state.startDate,isoDate()))+1:0;
  const registered=logDates('lorazepam').filter(d=>!state.startDate||d>=state.startDate).length;
  document.getElementById('loggedDays').textContent=`${registered}/${days}`;
  const old=toleranceScoreDaysAgo(7);
  const trendEl=document.getElementById('toleranceTrend');
  if(old==null || days<2){trendEl.textContent='sin datos';}
  else{const diff=Math.round(score-old);trendEl.textContent=Math.abs(diff)<2?'estable':diff<0?`↓ ${Math.abs(diff)} pts`:`↑ ${diff} pts`;}
  const recovery=Math.max(0,100-score);
  const goalBar=document.getElementById('goalProgressBar');
  const goalText=document.getElementById('goalProgressText');
  if(goalBar) goalBar.style.width=`${recovery}%`;
  if(goalText){
    if(recovery>=95) goalText.textContent='1:1 · meta visual del modelo';
    else goalText.textContent=`${recovery}% hacia 1:1`;
  }
  let exp='El modelo está todavía muy influido por el punto de partida.';
  if(registered>=7)exp='Tus registros ya tienen un peso importante en la estimación.';
  if(registered>=21)exp='La tendencia depende sobre todo de tu historial registrado reciente.';
  document.getElementById('toleranceExplanation').textContent=exp;
}

function renderNextChange(){
  const pos=getPosition();
  if(pos.stageIndex>=PLAN.length-1){
    document.getElementById('nextChangeDate').textContent='Plan completado'; document.getElementById('countdownChip').textContent='sin más escalones';
    document.getElementById('nextLorTarget').textContent='0 mg/día';document.getElementById('nextPregTarget').textContent='600 mg/día';
    document.getElementById('nextLorDiff').textContent='retirada completada';document.getElementById('nextPregDiff').textContent='mantener según pauta';return;
  }
  const current=PLAN[pos.stageIndex],next=PLAN[pos.stageIndex+1]; const nextDate=addDays(state.startDate,(pos.stageIndex+1)*5); const left=Math.max(0,daysBetween(isoDate(),nextDate));
  document.getElementById('nextChangeDate').textContent=formatDate(nextDate);
  document.getElementById('countdownChip').textContent=left===0?'hoy':`en ${left} ${left===1?'día':'días'}`;
  document.getElementById('nextLorTarget').textContent=`${mg(next.lor)}/día`;document.getElementById('nextPregTarget').textContent=`${mg(next.preg)}/día`;
  document.getElementById('nextLorDiff').textContent=`${signed(next.lor-current.lor)} mg`;document.getElementById('nextPregDiff').textContent=next.preg===current.preg?'sin cambio':`+${next.preg-current.preg} mg`;
}

function dayStatus(dateIso,actual,target){
  const today=dateIso===isoDate(); const diff=roundSmart(actual-target);
  if(today && actual<=target)return {text:'en curso',cls:'today'};
  if(Math.abs(diff)<0.01)return {text:'en objetivo',cls:'good'};
  if(diff>0)return {text:`+${mg(diff)}`,cls:'over'};
  return {text:`−${mg(Math.abs(diff))}`,cls:'under'};
}
function renderRecent(){
  const box=document.getElementById('recentDays');box.innerHTML='';
  for(let i=0;i<4;i++){
    const d=addDays(isoDate(),-i); const t=targetForDate(d); if(!t)continue;
    const actual=totalForDate(d,'lorazepam'); const s=dayStatus(d,actual,t.lor);
    const row=document.createElement('div');row.className='recent-row';
    row.innerHTML=`<span class="date">${i===0?'Hoy':capitalize(formatShort(d))}</span><span class="summary"><strong>${mg(actual)}</strong> de ${mg(t.lor)} pautados</span><span class="recent-status ${s.cls}">${s.text}</span>`;box.appendChild(row);
  }
}

function renderStats(){
  if(!state.startDate)return;
  const rows=[];
  for(let i=13;i>=0;i--){const d=addDays(isoDate(),-i);const t=targetForDate(d);if(!t)continue;const actual=totalForDate(d,'lorazepam');rows.push({d,t:t.lor,actual,status:dayStatus(d,actual,t.lor)});}
  const complete7=rows.filter(r=>r.d!==isoDate()).slice(-7);
  const avg=complete7.length?roundSmart(complete7.reduce((s,r)=>s+r.actual,0)/complete7.length):0;
  const extras=roundSmart(complete7.reduce((s,r)=>s+Math.max(0,r.actual-r.t),0));
  const onTarget=complete7.filter(r=>Math.abs(r.actual-r.t)<.01).length;
  document.getElementById('stats7Average').textContent=complete7.length?mg(avg):'—';document.getElementById('stats7Extras').textContent=complete7.length?mg(extras):'—';document.getElementById('statsOnTarget').textContent=complete7.length?`${onTarget}/${complete7.length}`:'—';
  const chart=document.getElementById('statsChart');chart.innerHTML='';const max=Math.max(3,...rows.flatMap(r=>[r.actual,r.t]));
  rows.forEach(r=>{const col=document.createElement('div');col.className='chart-day';const realH=Math.max(2,(r.actual/max)*145),targetH=Math.max(2,(r.t/max)*145);col.innerHTML=`<div class="bar target" style="height:${targetH}px"></div><div class="bar real" style="height:${realH}px"></div><label>${parseLocalDate(r.d).getDate()}</label>`;chart.appendChild(col);});
  const list=document.getElementById('statsDayList');list.innerHTML='';[...rows].reverse().forEach(r=>{const diff=roundSmart(r.actual-r.t);const row=document.createElement('div');row.className='stats-row';const result=r.status;let detail='igual que la pauta';if(diff>0)detail=`${mg(diff)} más de lo pautado`;if(diff<0)detail=`${mg(Math.abs(diff))} menos de lo pautado`;if(r.d===isoDate())detail='día en curso';row.innerHTML=`<span class="when">${r.d===isoDate()?'Hoy':capitalize(formatShort(r.d))}</span><div class="numbers"><strong>${mg(r.actual)} / ${mg(r.t)}</strong><span>${detail}</span></div><span class="result ${result.cls}">${result.text}</span>`;list.appendChild(row);});
}

function renderPlan(){
  const list=document.getElementById('fullPlanList');list.innerHTML='';const pos=getPosition();
  PLAN.forEach((stage,i)=>{const start=state.startDate?addDays(state.startDate,i*5):null;const item=document.createElement('div');item.className=`plan-stage ${state.startDate&&i===pos.stageIndex?'current':''}`;const subtitle=i===PLAN.length-1?'fase final':start?`${formatDate(start)} · 5 días`:'5 días';item.innerHTML=`<div class="stage-number">${i+1}</div><div><strong>Lorazepam ${mg(stage.lor)}/día · Pregabalina ${mg(stage.preg)}/día</strong><span>${subtitle}</span></div>`;list.appendChild(item);});
}

function renderBackupState(){
  const btn=document.getElementById('quickBackupButton');
  if(!state.lastBackupAt){btn.textContent='Guardar copia';return;}
  const days=Math.floor((Date.now()-state.lastBackupAt)/86400000);btn.textContent=days>=7?'Copia recomendada':'Copia guardada ✓';
}

function syncSettingsInputs(){
  document.getElementById('startDateInput').value=state.startDate||isoDate();
  document.getElementById('baselineInput').value=state.baselineDailyMg;
  document.getElementById('settingsStartStatus').textContent=state.startDate?`Desde ${formatDate(state.startDate)}`:'No iniciado';
}

function openDoseSheet(drug){
  activeDoseDrug=drug;
  const isLor=drug==='lorazepam';
  document.getElementById('doseSheetTitle').textContent=isLor?'Lorazepam':'Pregabalina';
  document.getElementById('doseSheetKicker').textContent='Registrar toma ya realizada';
  const amount=document.getElementById('doseAmountInput');amount.step=isLor?'0.5':'100';amount.value=isLor?'1':'100';
  document.getElementById('doseUnitLabel').textContent='mg';document.getElementById('doseNoteInput').value='';
  document.getElementById('doseTimeInput').value=toLocalInputValue(new Date());
  const quick=document.getElementById('quickDoseRow');quick.innerHTML='';
  (isLor?[0.5,1]:[100,200]).forEach(v=>{const b=document.createElement('button');b.textContent=mg(v);b.addEventListener('click',()=>{amount.value=v;});quick.appendChild(b);});
  renderTodayLogList();document.getElementById('doseSheet').showModal();
}
function renderTodayLogList(){
  const list=document.getElementById('todayLogList');list.innerHTML='';const logs=logsForDate(isoDate(),activeDoseDrug).sort((a,b)=>new Date(b.at)-new Date(a.at));
  if(!logs.length){list.innerHTML='<div class="plan-intro">Todavía no hay registros de hoy.</div>';return;}
  logs.forEach(l=>{const item=document.createElement('div');item.className='log-item';item.innerHTML=`<div><strong>${mg(l.amountMg)} · ${formatTime(l.at)}</strong><span>${escapeHtml(l.note||'Sin nota')}</span></div><button class="log-delete" data-id="${l.id}">Borrar</button>`;list.appendChild(item);});
  list.querySelectorAll('.log-delete').forEach(b=>b.addEventListener('click',async()=>{state.logs=state.logs.filter(l=>l.id!==b.dataset.id);await persistState();renderTodayLogList();toast('Registro borrado');}));
}
async function saveDose(){
  const amount=Number(document.getElementById('doseAmountInput').value);const atRaw=document.getElementById('doseTimeInput').value;const note=document.getElementById('doseNoteInput').value.trim();
  if(!Number.isFinite(amount)||amount<=0){toast('Introduce una cantidad válida');return;}
  const at=new Date(atRaw);if(Number.isNaN(at.getTime())){toast('Introduce una fecha y hora válidas');return;}
  if(at>new Date(Date.now()+60000)){toast('No se pueden registrar tomas futuras');return;}
  state.logs.push({id:uid(),drug:activeDoseDrug,amountMg:amount,at:at.toISOString(),note});await persistState();renderTodayLogList();document.getElementById('doseAmountInput').value=activeDoseDrug==='lorazepam'?'1':'100';document.getElementById('doseNoteInput').value='';toast('Toma registrada');
}

async function startPlan(dateIso=isoDate()){
  state.startDate=dateIso;state.startedAt=new Date().toISOString();
  try{if(navigator.storage?.persist)await navigator.storage.persist();}catch{}
  await persistState();toast('Plan iniciado');
}

function toLocalInputValue(date){
  const pad=n=>String(n).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function showSheet(id){document.getElementById(id).showModal();}
function closeSheet(id){document.getElementById(id).close();}
function capitalize(s){return s?s.charAt(0).toUpperCase()+s.slice(1):s;}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2200);}

async function exportBackup(){
  const payload={app:'Mi Pauta',version:APP_VERSION,exportedAt:new Date().toISOString(),state};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const file=new File([blob],`mi-pauta-backup-${isoDate()}.json`,{type:'application/json'});
  try{
    if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Copia de seguridad Mi Pauta'});}
    else{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    state.lastBackupAt=Date.now();await persistState();toast('Copia preparada');
  }catch(err){if(err?.name!=='AbortError')toast('No se pudo crear la copia');}
}
async function importBackup(file){
  try{const text=await file.text();const parsed=JSON.parse(text);const incoming=normalizeState(parsed.state||parsed);if(!confirm('Esto sustituirá los datos actuales de la app. ¿Continuar?'))return;state=incoming;await persistState();toast('Copia restaurada');}
  catch{toast('La copia no es válida');}
}

function bindEvents(){
  document.getElementById('startTodayButton').addEventListener('click',()=>startPlan(isoDate()));
  document.getElementById('startOtherDayButton').addEventListener('click',()=>showSheet('settingsSheet'));
  document.getElementById('settingsButton').addEventListener('click',()=>showSheet('settingsSheet'));
  document.getElementById('logLorazepamButton').addEventListener('click',()=>openDoseSheet('lorazepam'));
  document.getElementById('logPregabalinButton').addEventListener('click',()=>openDoseSheet('pregabalin'));
  document.getElementById('saveDoseButton').addEventListener('click',saveDose);
  document.getElementById('openStatsButton').addEventListener('click',()=>{renderStats();showSheet('statsSheet');});
  document.getElementById('navStats').addEventListener('click',()=>{renderStats();showSheet('statsSheet');});
  document.getElementById('navPlan').addEventListener('click',()=>{renderPlan();showSheet('planSheet');});
  document.getElementById('toleranceInfoButton').addEventListener('click',()=>showSheet('toleranceInfoSheet'));
  document.getElementById('quickBackupButton').addEventListener('click',exportBackup);
  document.getElementById('exportButton').addEventListener('click',exportBackup);
  document.getElementById('importButton').addEventListener('click',()=>document.getElementById('importFileInput').click());
  document.getElementById('importFileInput').addEventListener('change',e=>{if(e.target.files?.[0])importBackup(e.target.files[0]);e.target.value='';});
  document.getElementById('applyStartDateButton').addEventListener('click',async()=>{const value=document.getElementById('startDateInput').value;if(!value)return toast('Elige una fecha');if(state.startDate&&state.logs.length&&!confirm('Cambiar la fecha de inicio recalcula las fases. ¿Continuar?'))return;state.startDate=value;state.startedAt=state.startedAt||new Date().toISOString();await persistState();toast('Fecha de inicio actualizada');});
  document.getElementById('saveBaselineButton').addEventListener('click',async()=>{const v=Number(document.getElementById('baselineInput').value);if(!Number.isFinite(v)||v<0)return toast('Valor no válido');state.baselineDailyMg=v;await persistState();toast('Estimación inicial actualizada');});
  document.getElementById('resetButton').addEventListener('click',async()=>{if(!confirm('Se borrarán todos los registros y el inicio del plan. ¿Seguro?'))return;state=initialState();await persistState();toast('Datos borrados');});
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeSheet(b.dataset.close)));
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close();}));
}

async function boot(){
  await loadState();bindEvents();render();
  if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js?v=2.1.0').catch(()=>{});}
}
boot();
