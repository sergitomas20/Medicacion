// Mi Pauta · modelo PK-adaptativo de tolerancia v2.2
//
// IMPORTANTE: este índice es orientativo. No mide receptores GABA-A ni sirve
// para calcular una dosis. Su objetivo es representar mejor la tendencia de
// exposición y neuroadaptación a partir de las tomas registradas.
//
// Capa farmacocinética:
// - biodisponibilidad oral ~90 %
// - Tmax ~2 h
// - semivida de eliminación ~12 h
// - absorción de primer orden (ka derivada de Tmax y ke)
// - compartimento de efecto con t1/2 de equilibrado ~0,43 h
//
// Capa adaptativa:
// - señal de exposición CNS no lineal
// - memoria rápida (3,5 d) + lenta (21 d)
// - 42 % rápida + 58 % lenta
//
// Los parámetros PK están anclados a literatura publicada. Las constantes de
// neuroadaptación son heurísticas porque no existe un modelo humano validado
// que convierta un historial individual de lorazepam en un % real de tolerancia.

const PK_TOLERANCE_MODEL = {
  bioavailability: 0.90,
  eliminationHalfLifeHours: 12,
  absorptionRatePerHour: 1.76855,
  effectSiteHalfLifeHours: 0.43,
  integrationStepHours: 0.25,

  prehistoryDays: 90,
  baselineDosesPerDay: 3,

  driveEC50EqMg: 1.20,
  driveHillN: 1.40,

  fastHalfLifeDays: 3.5,
  slowHalfLifeDays: 21,
  fastWeight: 0.42,
  slowWeight: 0.58
};

function pkToleranceConstants(){
  return {
    ka: PK_TOLERANCE_MODEL.absorptionRatePerHour,
    ke: Math.log(2) / PK_TOLERANCE_MODEL.eliminationHalfLifeHours,
    keo: Math.log(2) / PK_TOLERANCE_MODEL.effectSiteHalfLifeHours
  };
}

function pkToleranceDecay(halfLife, elapsed){
  return Math.pow(0.5, elapsed / halfLife);
}

function pkBaselineVirtualEvents(start){
  const daily = Math.max(0, Number(state.baselineDailyMg) || 0);
  if(daily <= 0) return [];

  const doses = PK_TOLERANCE_MODEL.baselineDosesPerDay;
  const perDose = daily / doses;
  const spacingHours = 24 / doses;
  const events = [];

  for(let day = PK_TOLERANCE_MODEL.prehistoryDays; day >= 1; day--){
    const dayStart = new Date(start.getTime() - day * 86400000);
    for(let k = 0; k < doses; k++){
      events.push({
        date: new Date(dayStart.getTime() + k * spacingHours * 3600000),
        dose: perDose,
        virtual: true
      });
    }
  }
  return events;
}

function pkRealLorazepamEvents(start, now){
  return state.logs
    .filter(log => log.drug === 'lorazepam')
    .map(log => ({
      date: new Date(log.at),
      dose: Math.max(0, Number(log.amountMg) || 0),
      virtual: false
    }))
    .filter(event =>
      !Number.isNaN(event.date.getTime()) &&
      event.date >= start &&
      event.date <= now &&
      event.dose > 0
    );
}

function pkToleranceDrive(effectSiteEqMg){
  const c = Math.max(0, effectSiteEqMg);
  if(c === 0) return 0;

  const cN = Math.pow(c, PK_TOLERANCE_MODEL.driveHillN);
  const ecN = Math.pow(PK_TOLERANCE_MODEL.driveEC50EqMg, PK_TOLERANCE_MODEL.driveHillN);
  return 100 * cN / (cN + ecN);
}

// Sobrescribe el estimador sencillo de app.js por un modelo que integra cada
// toma en el tiempo. La interfaz sigue consumiendo exactamente el mismo score.
function toleranceScoreAt(now = new Date()){
  const start = modelStartDate();
  const end = now instanceof Date ? now : new Date(now);

  if(Number.isNaN(end.getTime())){
    return { score: 0, fast: 0, slow: 0, plasmaEq: 0, effectSiteEq: 0, drive: 0 };
  }

  // La media previa configurada no se trata como un simple número inicial:
  // se reconstruyen 90 días virtuales repartidos en 3 tomas/día para generar
  // acumulación farmacocinética y una memoria lenta aproximadamente estable.
  const preStart = new Date(start.getTime() - PK_TOLERANCE_MODEL.prehistoryDays * 86400000);
  const events = [
    ...pkBaselineVirtualEvents(start),
    ...pkRealLorazepamEvents(start, end)
  ]
    .filter(event => event.date >= preStart && event.date <= end)
    .sort((a, b) => a.date - b.date);

  const { ka, ke, keo } = pkToleranceConstants();

  let gut = 0;        // fracción oral todavía pendiente de absorber
  let plasma = 0;     // exposición sistémica relativa (mg-equivalentes)
  let effectSite = 0; // exposición relativa en compartimento de efecto CNS
  let fast = 0;
  let slow = 0;

  let cursor = new Date(preStart);
  let eventIndex = 0;
  const maxStepMs = PK_TOLERANCE_MODEL.integrationStepHours * 3600000;

  while(cursor < end){
    while(eventIndex < events.length && events[eventIndex].date <= cursor){
      gut += events[eventIndex].dose * PK_TOLERANCE_MODEL.bioavailability;
      eventIndex++;
    }

    let nextMs = Math.min(cursor.getTime() + maxStepMs, end.getTime());

    if(eventIndex < events.length){
      const eventMs = events[eventIndex].date.getTime();
      if(eventMs > cursor.getTime() && eventMs < nextMs){
        nextMs = eventMs;
      }
    }

    const dtHours = Math.max(0, (nextMs - cursor.getTime()) / 3600000);
    if(dtHours <= 0){
      cursor = new Date(nextMs + 1);
      continue;
    }

    // Modelo oral de un compartimento con absorción y eliminación de primer orden.
    // La actualización de gut/plasma es analítica para cada intervalo.
    const gut0 = gut;
    const plasma0 = plasma;
    const eKa = Math.exp(-ka * dtHours);
    const eKe = Math.exp(-ke * dtHours);

    gut = gut0 * eKa;
    plasma = plasma0 * eKe + gut0 * ka / (ka - ke) * (eKe - eKa);

    // El efecto CNS no sigue instantáneamente al plasma. Se suaviza mediante un
    // compartimento de efecto; con pasos de 15 min usamos el plasma medio.
    const plasmaMean = (plasma0 + plasma) / 2;
    const effectAlpha = 1 - Math.exp(-keo * dtHours);
    effectSite += (plasmaMean - effectSite) * effectAlpha;

    // La neuroadaptación no recibe los mg brutos: recibe la exposición CNS
    // transformada de forma sigmoide. Esto hace relevante el horario real.
    const drive = pkToleranceDrive(effectSite);
    const dtDays = dtHours / 24;
    const fastAlpha = 1 - pkToleranceDecay(PK_TOLERANCE_MODEL.fastHalfLifeDays, dtDays);
    const slowAlpha = 1 - pkToleranceDecay(PK_TOLERANCE_MODEL.slowHalfLifeDays, dtDays);

    fast += (drive - fast) * fastAlpha;
    slow += (drive - slow) * slowAlpha;

    cursor = new Date(nextMs);
  }

  const score = Math.max(
    0,
    Math.min(
      100,
      PK_TOLERANCE_MODEL.fastWeight * fast +
      PK_TOLERANCE_MODEL.slowWeight * slow
    )
  );

  return {
    score,
    fast,
    slow,
    plasmaEq: Math.max(0, plasma),
    effectSiteEq: Math.max(0, effectSite),
    drive: pkToleranceDrive(effectSite)
  };
}
