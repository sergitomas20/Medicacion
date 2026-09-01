(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  if(root) root.MedCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const DAY=86400000;
  const HOUR=3600000;

  function uid(){return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;}
  function safeDate(v){const d=v instanceof Date?new Date(v):new Date(v);return Number.isNaN(d.getTime())?null:d;}
  function round2(n){return Math.round((Number(n)+Number.EPSILON)*100)/100;}
  function tzDateParts(date,timeZone){
    try{
      const p=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
      const o=Object.fromEntries(p.map(x=>[x.type,x.value]));
      return `${o.year}-${o.month}-${o.day}`;
    }catch{
      const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');
      return `${y}-${m}-${d}`;
    }
  }
  function getZone(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||null;}catch{return null;}}
  function normalizeMedicationLog(log,timeZone){
    if(!log||typeof log!=='object')return null;
    const at=safeDate(log.at); if(!at)return null;
    const drug=log.drug;
    if(drug!=='lorazepam'&&drug!=='pregabalin')return null;
    const amountMg=Number(log.amountMg); if(!Number.isFinite(amountMg)||amountMg<0)return null;
    return {
      ...log,
      id:log.id||uid(),
      type:'dose',
      drug,
      amountMg:round2(amountMg),
      at:at.toISOString(),
      note:typeof log.note==='string'?log.note:'',
      tabletCount:Number.isFinite(Number(log.tabletCount))?Number(log.tabletCount):null,
      tabletMg:Number.isFinite(Number(log.tabletMg))?Number(log.tabletMg):null,
      timeZone:log.timeZone||null,
      offsetMinutes:Number.isFinite(Number(log.offsetMinutes))?Number(log.offsetMinutes):null,
      localDate:log.localDate||tzDateParts(at,timeZone||getZone()),
      timeContext:log.timeContext||(log.timeZone?'recorded':'legacy-current-zone')
    };
  }
  function normalizeCraving(log,timeZone){
    if(!log||typeof log!=='object')return null;
    const at=safeDate(log.at); const level=Number(log.level);
    if(!at||!Number.isInteger(level)||level<1||level>4)return null;
    return {
      ...log,id:log.id||uid(),type:'craving',level,at:at.toISOString(),note:typeof log.note==='string'?log.note:'',
      timeZone:log.timeZone||null,offsetMinutes:Number.isFinite(Number(log.offsetMinutes))?Number(log.offsetMinutes):null,
      localDate:log.localDate||tzDateParts(at,timeZone||getZone()),timeContext:log.timeContext||(log.timeZone?'recorded':'legacy-current-zone')
    };
  }
  function normalizeState(raw={},opts={}){
    const timeZone=opts.timeZone||getZone();
    const medication=(Array.isArray(raw.logs)?raw.logs:[]).map(x=>normalizeMedicationLog(x,timeZone)).filter(Boolean);
    const cravings=(Array.isArray(raw.cravings)?raw.cravings:[]).map(x=>normalizeCraving(x,timeZone)).filter(Boolean);
    return {
      ...raw,
      version:'3.0.0',schemaVersion:3,logs:medication,cravings,
      tabletMg:Number.isFinite(Number(raw.tabletMg))&&Number(raw.tabletMg)>0?Number(raw.tabletMg):null,
      trackingStartedAt:raw.trackingStartedAt||raw.startedAt||null,
      updatedAt:Number(raw.updatedAt)||Date.now(),lastBackupAt:Number(raw.lastBackupAt)||null
    };
  }
  function lorazepamLogs(logs){return (logs||[]).filter(x=>x&&x.type!=='craving'&&x.drug==='lorazepam'&&Number(x.amountMg)>0&&safeDate(x.at));}
  function sortedDoses(logs){return lorazepamLogs(logs).slice().sort((a,b)=>new Date(a.at)-new Date(b.at));}
  function lastDose(logs,now=new Date()){
    const t=safeDate(now)?.getTime()??Date.now();
    return sortedDoses(logs).filter(x=>new Date(x.at).getTime()<=t).at(-1)||null;
  }
  function currentAbstinenceMs(logs,now=new Date()){
    const n=safeDate(now); const last=lastDose(logs,n); if(!n||!last)return null;
    return Math.max(0,n-new Date(last.at));
  }
  function doseIntervals(logs,now=new Date()){
    const doses=sortedDoses(logs).filter(x=>new Date(x.at)<=now); const out=[];
    for(let i=1;i<doses.length;i++) out.push({from:doses[i-1],to:doses[i],ms:new Date(doses[i].at)-new Date(doses[i-1].at)});
    return out;
  }
  function recordAbstinenceMs(logs,now=new Date()){
    const completed=doseIntervals(logs,now).map(x=>x.ms);
    const current=currentAbstinenceMs(logs,now);
    const all=current==null?completed:completed.concat(current);
    return all.length?Math.max(...all):null;
  }
  function totalMgBetween(logs,start,end){
    const s=safeDate(start)?.getTime(),e=safeDate(end)?.getTime(); if(s==null||e==null)return 0;
    return round2(lorazepamLogs(logs).reduce((sum,x)=>{const t=new Date(x.at).getTime();return t>=s&&t<=e?sum+Number(x.amountMg):sum;},0));
  }
  function totalMgWithin(logs,days,now=new Date()){
    const n=safeDate(now); if(!n)return 0; return totalMgBetween(logs,new Date(n.getTime()-days*DAY),n);
  }
  function recentDoseCount(logs,days,now=new Date()){
    const n=safeDate(now); if(!n)return 0; const s=n.getTime()-days*DAY;
    return lorazepamLogs(logs).filter(x=>{const t=new Date(x.at).getTime();return t>s&&t<=n;}).length;
  }
  function consumptionTrend(logs,days=7,now=new Date()){
    const n=safeDate(now); if(!n)return {current:0,previous:0,direction:'flat',changePct:null};
    const current=totalMgBetween(logs,new Date(n-days*DAY),n);
    const previous=totalMgBetween(logs,new Date(n-2*days*DAY),new Date(n-days*DAY-1));
    const epsilon=.01;
    let direction='flat'; if(current<previous-epsilon)direction='down'; else if(current>previous+epsilon)direction='up';
    const changePct=previous>0?Math.round(((current-previous)/previous)*100):current>0?null:0;
    return {current,previous,direction,changePct};
  }
  function estimateExposure(logs,now=new Date()){
    const n=safeDate(now)||new Date(); const abst=currentAbstinenceMs(logs,n);
    const mg7=totalMgWithin(logs,7,n),mg30=totalMgWithin(logs,30,n),count7=recentDoseCount(logs,7,n); const trend=consumptionTrend(logs,7,n);
    let points=0;
    const hours=abst==null?Infinity:abst/HOUR;
    if(hours<12)points+=4; else if(hours<36)points+=3; else if(hours<72)points+=2; else if(hours<168)points+=1;
    if(mg7>=14)points+=4; else if(mg7>=7)points+=3; else if(mg7>=3)points+=2; else if(mg7>0)points+=1;
    if(count7>=7)points+=3; else if(count7>=4)points+=2; else if(count7>=1)points+=1;
    const avg30=mg30/30; if(avg30>=2)points+=3; else if(avg30>=1)points+=2; else if(avg30>.2)points+=1;
    if(trend.direction==='up')points+=2; else if(trend.direction==='down')points-=1;
    let label='Muy baja',level=1;
    if(points>=13){label='Muy alta';level=5;} else if(points>=9){label='Alta';level=4;} else if(points>=5){label='Media';level=3;} else if(points>=2){label='Baja';level=2;}
    return {label,level,inputs:{hoursSinceLastDose:Number.isFinite(hours)?round2(hours):null,mg7,mg30,count7,trend:trend.direction},disclaimer:'Estimación orientativa de exposición reciente; no mide tolerancia clínica ni indica una dosis segura.'};
  }
  function updateEntry(entries,id,patch){return (entries||[]).map(x=>x.id===id?{...x,...patch}:x);}
  function deleteEntry(entries,id){return (entries||[]).filter(x=>x.id!==id);}
  function createDoseRecord({amountMg,tabletCount=null,tabletMg=null,at=new Date(),timeZone=getZone(),offsetMinutes=null,note=''}){
    const date=safeDate(at); const mg=Number(amountMg); if(!date||!Number.isFinite(mg)||mg<=0)throw new Error('invalid dose');
    const offset=offsetMinutes==null?-date.getTimezoneOffset():Number(offsetMinutes);
    return {id:uid(),type:'dose',drug:'lorazepam',amountMg:round2(mg),tabletCount:Number.isFinite(Number(tabletCount))?Number(tabletCount):null,tabletMg:Number.isFinite(Number(tabletMg))?Number(tabletMg):null,at:date.toISOString(),timeZone:timeZone||null,offsetMinutes:Number.isFinite(offset)?offset:null,localDate:tzDateParts(date,timeZone||getZone()),timeContext:'recorded',note:String(note||'')};
  }
  function createCravingRecord({level,at=new Date(),timeZone=getZone(),offsetMinutes=null,note=''}){
    const date=safeDate(at); const l=Number(level); if(!date||!Number.isInteger(l)||l<1||l>4)throw new Error('invalid craving');
    const offset=offsetMinutes==null?-date.getTimezoneOffset():Number(offsetMinutes);
    return {id:uid(),type:'craving',level:l,at:date.toISOString(),timeZone:timeZone||null,offsetMinutes:Number.isFinite(offset)?offset:null,localDate:tzDateParts(date,timeZone||getZone()),timeContext:'recorded',note:String(note||'')};
  }
  function dailyDoseBuckets(logs,days=14,now=new Date(),timeZone=getZone()){
    const n=safeDate(now)||new Date(); const result=[];
    for(let i=days-1;i>=0;i--){const date=new Date(n.getTime()-i*DAY);const key=tzDateParts(date,timeZone);result.push({date:key,mg:0});}
    const map=new Map(result.map(x=>[x.date,x]));
    lorazepamLogs(logs).forEach(x=>{const d=safeDate(x.at);const key=x.localDate||tzDateParts(d,timeZone);if(map.has(key))map.get(key).mg=round2(map.get(key).mg+Number(x.amountMg));});
    return result;
  }
  function cravingBuckets(cravings,days=14,now=new Date(),timeZone=getZone()){
    const n=safeDate(now)||new Date(); const result=[];
    for(let i=days-1;i>=0;i--){const date=new Date(n.getTime()-i*DAY);const key=tzDateParts(date,timeZone);result.push({date:key,level:null});}
    const map=new Map(result.map(x=>[x.date,[]]));
    (cravings||[]).forEach(x=>{const d=safeDate(x.at);if(!d)return;const key=x.localDate||tzDateParts(d,timeZone);if(map.has(key))map.get(key).push(Number(x.level));});
    result.forEach(x=>{const a=map.get(x.date);if(a?.length)x.level=round2(a.reduce((s,v)=>s+v,0)/a.length);}); return result;
  }
  return {DAY,HOUR,normalizeState,lorazepamLogs,sortedDoses,lastDose,currentAbstinenceMs,doseIntervals,recordAbstinenceMs,totalMgBetween,totalMgWithin,recentDoseCount,consumptionTrend,estimateExposure,updateEntry,deleteEntry,createDoseRecord,createCravingRecord,dailyDoseBuckets,cravingBuckets,tzDateParts};
});
