const APP_VERSION = "1.0.1";
const STORAGE_KEY = "mi-pauta-v1";
const DEFAULT_START = "2026-08-24";
const PERIODS = [
  { key: "morning", name: "Mañana", icon: "☀️", cutoff: 12 },
  { key: "midday", name: "Mediodía", icon: "◐", cutoff: 18 },
  { key: "night", name: "Noche", icon: "☾", cutoff: 24 }
];

const STAGES = [
  { index: 0, lorTotal: 3, pregTotal: 300, lor: [1,1,1], preg: [100,100,100] },
  { index: 1, lorTotal: 2.5, pregTotal: 400, lor: null, preg: null },
  { index: 2, lorTotal: 2, pregTotal: 500, lor: null, preg: null },
  { index: 3, lorTotal: 1.5, pregTotal: 600, lor: null, preg: [200,200,200] },
  { index: 4, lorTotal: 1, pregTotal: 600, lor: null, preg: [200,200,200] },
  { index: 5, lorTotal: .5, pregTotal: 600, lor: null, preg: [200,200,200] },
  { index: 6, lorTotal: 0, pregTotal: 600, lor: [0,0,0], preg: [200,200,200] }
];

const BASE_MEDS = {
  morning: [
    { id: "omeprazole", name: "Omeprazol", detail: "20 mg · en ayunas", dose: "1" }
  ],
  midday: [],
  night: [
    { id: "plenur", name: "Plenur", detail: "400 mg", dose: "1" },
    { id: "rexer", name: "Rexer Flas", detail: "15 mg", dose: "1" }
  ]
};

function initialState() {
  return {
    version: APP_VERSION,
    startDate: DEFAULT_START,
    sertraline: "unknown",
    stageOverrides: {},
    taken: {}
  };
}

let state = loadState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...initialState(), ...(saved || {}) };
  } catch {
    return initialState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function isoDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,"0");
  const d = String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}

function parseLocalDate(iso) {
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(y, m-1, d, 12, 0, 0);
}

function daysBetween(aIso, bIso) {
  const a = parseLocalDate(aIso);
  const b = parseLocalDate(bIso);
  return Math.floor((b - a) / 86400000);
}

function addDays(iso, days) {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

function formatDate(iso, opts = {}) {
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", ...opts }).format(parseLocalDate(iso));
}

function formatWeekdayDate(iso) {
  return new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "short" }).format(parseLocalDate(iso));
}

function getPlanPosition(dateIso = isoDate()) {
  const elapsed = daysBetween(state.startDate, dateIso);
  const safeElapsed = Math.max(0, elapsed);
  const stageIndex = Math.min(6, Math.floor(safeElapsed / 5));
  const dayInStage = stageIndex === 6 ? 1 : (safeElapsed % 5) + 1;
  return { elapsed, stageIndex, dayInStage, beforeStart: elapsed < 0 };
}

function getStage(stageIndex) {
  const base = STAGES[stageIndex];
  const override = state.stageOverrides[String(stageIndex)] || {};
  return {
    ...base,
    lor: override.lor || base.lor,
    preg: override.preg || base.preg
  };
}

function isStageConfirmed(stage) {
  return Array.isArray(stage.lor) && Array.isArray(stage.preg);
}

function getCurrentPeriod() {
  const h = new Date().getHours();
  return PERIODS.find(p => h < p.cutoff)?.key || "night";
}

function sertralineForPeriod(period) {
  if (state.sertraline === "100" && period === "morning") {
    return [{ id: "sertraline", name: "Sertralina", detail: "100 mg · pauta confirmada en la app", dose: "1" }];
  }
  if (state.sertraline === "200" && (period === "morning" || period === "midday")) {
    return [{ id: "sertraline", name: "Sertralina", detail: "100 mg · pauta confirmada en la app", dose: "1" }];
  }
  return [];
}

function medsForPeriod(period, stageIndex) {
  const stage = getStage(stageIndex);
  const periodIndex = PERIODS.findIndex(p => p.key === period);
  const list = [ ...BASE_MEDS[period], ...sertralineForPeriod(period) ];
  if (Array.isArray(stage.preg)) {
    const dose = Number(stage.preg[periodIndex] || 0);
    if (dose > 0) list.push({ id: "pregabalin", name: "Pregabalina (Lyrica)", detail: "cápsulas de 100 mg", dose: `${dose} mg` });
  }
  if (Array.isArray(stage.lor)) {
    const dose = Number(stage.lor[periodIndex] || 0);
    if (dose > 0) list.push({ id: "lorazepam", name: "Lorazepam", detail: "comprimidos de 1 mg", dose: `${dose} mg` });
  }
  return list;
}

function treatmentMedsOnly(period, stageIndex) {
  return medsForPeriod(period, stageIndex).filter(m => m.id === "pregabalin" || m.id === "lorazepam");
}

function keyForTaken(dateIso, period) { return `${dateIso}:${period}`; }
function isTaken(dateIso, period) { return !!state.taken[keyForTaken(dateIso, period)]; }

function toggleTaken(dateIso, period, force) {
  const key = keyForTaken(dateIso, period);
  state.taken[key] = typeof force === "boolean" ? force : !state.taken[key];
  if (!state.taken[key]) delete state.taken[key];
  saveState();
  render();
}

function renderMedRows(container, meds) {
  container.innerHTML = "";
  if (!meds.length) {
    container.innerHTML = `<div class="empty-dose">No hay medicación configurada para esta toma.</div>`;
    return;
  }
  meds.forEach(m => {
    const row = document.createElement("div");
    row.className = "med-row";
    const emoji = m.id === "lorazepam" ? "◒" : m.id === "pregabalin" ? "◇" : m.id === "omeprazole" ? "○" : "•";
    row.innerHTML = `
      <div class="med-icon">${emoji}</div>
      <div class="med-copy"><strong>${m.name}</strong><span>${m.detail}</span></div>
      <div class="med-dose">${m.dose}</div>`;
    container.appendChild(row);
  });
}

function renderHero() {
  const today = isoDate();
  const pos = getPlanPosition(today);
  const stage = getStage(pos.stageIndex);
  const period = getCurrentPeriod();
  const periodMeta = PERIODS.find(p => p.key === period);
  const confirmed = isStageConfirmed(stage);

  document.getElementById("todayLabel").textContent = capitalize(formatWeekdayDate(today));
  document.getElementById("stageLabel").textContent = pos.stageIndex === 6
    ? "Fase final · Lorazepam retirado"
    : `Fase ${pos.stageIndex + 1} · Día ${pos.dayInStage} de 5`;

  const ring = document.getElementById("progressRing");
  const pct = pos.stageIndex === 6 ? 100 : (pos.dayInStage / 5) * 100;
  ring.style.setProperty("--p", `${pct}%`);
  document.getElementById("progressRingText").textContent = pos.stageIndex === 6 ? "✓" : `${pos.dayInStage}/5`;
  document.getElementById("currentDoseTitle").textContent = `Toma de ${periodMeta.name.toLowerCase()}`;
  document.getElementById("currentPeriodChip").textContent = periodMeta.name;

  const meds = medsForPeriod(period, pos.stageIndex);
  if (!confirmed) {
    document.getElementById("currentDoseSubtitle").textContent = "Tratamiento base visible; nueva distribución pendiente";
  } else {
    document.getElementById("currentDoseSubtitle").textContent = "Lo que corresponde en esta toma";
  }
  renderMedRows(document.getElementById("currentDoseList"), meds);

  const button = document.getElementById("markCurrentButton");
  const taken = isTaken(today, period);
  button.textContent = taken ? "Toma marcada como hecha ✓" : "Marcar toma como hecha";
  button.classList.toggle("done", taken);
  button.disabled = meds.length === 0;
  document.getElementById("unconfirmedCard").classList.toggle("hidden", confirmed);
}

function renderNextChange() {
  const today = isoDate();
  const pos = getPlanPosition(today);
  const details = document.getElementById("nextChangeDetails");
  details.innerHTML = "";

  if (pos.stageIndex >= 6) {
    document.getElementById("nextChangeDate").textContent = "Plan completado";
    document.getElementById("countdownBadge").textContent = "sin más bajadas";
    details.innerHTML = `<div class="change-item"><span>Lorazepam</span><strong>0 mg/día</strong><em>Retirada completada según el plan introducido.</em></div><div class="change-item"><span>Pregabalina</span><strong>600 mg/día</strong><em>Mantener según la pauta prescrita.</em></div>`;
    return;
  }

  const nextStageIndex = pos.stageIndex + 1;
  const nextDate = addDays(state.startDate, nextStageIndex * 5);
  const daysLeft = Math.max(0, daysBetween(today, nextDate));
  const nextStage = getStage(nextStageIndex);
  document.getElementById("nextChangeDate").textContent = formatDate(nextDate);
  document.getElementById("countdownBadge").textContent = daysLeft === 0 ? "hoy" : `en ${daysLeft} ${daysLeft === 1 ? "día" : "días"}`;

  const currentStage = getStage(pos.stageIndex);
  const lorDiff = nextStage.lorTotal - currentStage.lorTotal;
  const pregDiff = nextStage.pregTotal - currentStage.pregTotal;
  details.innerHTML = `
    <div class="change-item"><span>Lorazepam</span><strong>${formatSigned(lorDiff, " mg")}</strong><em>Total nuevo: ${nextStage.lorTotal} mg/día</em></div>
    <div class="change-item"><span>Pregabalina</span><strong>${pregDiff === 0 ? "Sin cambio" : formatSigned(pregDiff, " mg")}</strong><em>Total nuevo: ${nextStage.pregTotal} mg/día</em></div>`;
}

function renderTimeline() {
  const today = isoDate();
  const pos = getPlanPosition(today);
  const current = getCurrentPeriod();
  const timeline = document.getElementById("dailyTimeline");
  timeline.innerHTML = "";

  PERIODS.forEach(p => {
    const meds = medsForPeriod(p.key, pos.stageIndex);
    const treatmentCount = treatmentMedsOnly(p.key, pos.stageIndex).length;
    const item = document.createElement("div");
    item.className = `timeline-item ${current === p.key ? "current" : ""}`;
    const taken = isTaken(today, p.key);
    const description = meds.length
      ? `${meds.length} ${meds.length === 1 ? "medicamento" : "medicamentos"}${treatmentCount === 0 && !isStageConfirmed(getStage(pos.stageIndex)) ? " · pauta de cambio pendiente" : ""}`
      : "Sin tomas configuradas";
    item.innerHTML = `
      <div class="timeline-icon">${p.icon}</div>
      <div class="timeline-copy"><strong>${p.name}</strong><span>${description}</span></div>
      <button class="timeline-check ${taken ? "checked" : ""}" aria-label="${taken ? "Desmarcar" : "Marcar"} toma de ${p.name}" data-period="${p.key}">
        <svg viewBox="0 0 24 24"><path d="m9.2 16.2-4.4-4.4-1.6 1.6 6 6L21 7.6 19.4 6l-10.2 10.2Z"/></svg>
      </button>`;
    timeline.appendChild(item);
  });

  const count = PERIODS.filter(p => isTaken(today, p.key)).length;
  document.getElementById("completionText").textContent = `${count} de 3`;
}

function renderPlanProgress() {
  const pos = getPlanPosition(isoDate());
  const stage = getStage(pos.stageIndex);
  const lorProgress = Math.max(0, Math.min(100, ((3 - stage.lorTotal) / 3) * 100));
  const pregProgress = Math.max(0, Math.min(100, ((stage.pregTotal - 300) / 300) * 100));
  document.getElementById("lorazepamProgressText").textContent = `${stage.lorTotal} mg → 0 mg`;
  document.getElementById("pregabalinProgressText").textContent = `${stage.pregTotal} mg → 600 mg`;
  document.getElementById("lorazepamBar").style.width = `${lorProgress}%`;
  document.getElementById("pregabalinBar").style.width = `${pregProgress}%`;
}

function renderBaseMeds() {
  const grid = document.getElementById("baseMedicationGrid");
  const items = [
    ["Omeprazol", "20 mg", "Mañana · ayunas"],
    ["Plenur", "400 mg", "Noche"],
    ["Rexer Flas", "15 mg", "Noche"]
  ];
  if (state.sertraline !== "unknown") {
    items.push(["Sertralina", `${state.sertraline} mg/día`, state.sertraline === "200" ? "Mañana + mediodía" : "Mañana"]);
  }
  grid.innerHTML = items.map(([name,dose,when]) => `<div class="base-item"><span>${when}</span><strong>${name}<br>${dose}</strong></div>`).join("");
  const note = document.getElementById("sertralineNote");
  if (state.sertraline === "unknown") {
    note.classList.remove("confirmed");
    note.innerHTML = `<span class="note-icon">i</span><div><strong>Sertralina pendiente de confirmar</strong><p>Los documentos no coinciden entre 100 y 200 mg/día. No se incluye como toma activa hasta que confirmes la dosis.</p></div>`;
  } else {
    note.classList.add("confirmed");
    note.innerHTML = `<span class="note-icon">✓</span><div><strong>Sertralina configurada: ${state.sertraline} mg/día</strong><p>Puedes cambiarla en Ajustes si el profesional sanitario modifica la pauta.</p></div>`;
  }
}

function renderFullPlan() {
  const pos = getPlanPosition(isoDate());
  const list = document.getElementById("fullPlanList");
  list.innerHTML = "";
  STAGES.forEach((_, i) => {
    const st = getStage(i);
    const start = addDays(state.startDate, i * 5);
    const end = i === 6 ? null : addDays(start, 4);
    const confirmed = isStageConfirmed(st);
    const el = document.createElement("div");
    el.className = `plan-stage ${pos.stageIndex === i ? "active" : ""}`;
    const dateText = i === 6 ? `Desde ${formatDate(start)}` : `${formatDate(start)} – ${formatDate(end)}`;
    el.innerHTML = `
      <div class="plan-stage-head"><strong>${i === 6 ? "Fase final" : `Fase ${i+1}`}</strong><span>${dateText}</span></div>
      <div class="plan-stage-doses">
        <div class="plan-dose-box"><span>Lorazepam total</span><strong>${st.lorTotal} mg/día</strong></div>
        <div class="plan-dose-box"><span>Pregabalina total</span><strong>${st.pregTotal} mg/día</strong></div>
      </div>
      ${confirmed ? `<div class="plan-stage-doses"><div class="plan-dose-box"><span>Lorazepam M · D · N</span><strong>${formatDistribution(st.lor, "mg")}</strong></div><div class="plan-dose-box"><span>Pregabalina M · D · N</span><strong>${formatDistribution(st.preg, "mg")}</strong></div></div>` : `<span class="pending-label">Distribución por toma pendiente</span>`}`;
    list.appendChild(el);
  });
}

function renderHistory() {
  const list = document.getElementById("historyList");
  const dates = [...new Set(Object.keys(state.taken).map(k => k.split(":")[0]))].sort().reverse();
  if (!dates.length) {
    list.innerHTML = `<div class="empty-state">Cuando marques tus tomas, aquí verás un resumen sencillo por día.</div>`;
    return;
  }
  list.innerHTML = dates.slice(0,30).map(date => {
    const done = PERIODS.filter(p => isTaken(date,p.key)).map(p => p.name);
    return `<div class="history-day"><div class="history-day-head"><strong>${capitalize(formatWeekdayDate(date))}</strong><span>${done.length}/3 tomas</span></div><div class="history-pills">${PERIODS.map(p => `<span class="history-pill ${done.includes(p.name) ? "done" : ""}">${p.name}</span>`).join("")}</div></div>`;
  }).join("");
}

function renderSettings() {
  document.getElementById("startDateInput").value = state.startDate;
  document.querySelectorAll("#sertralineSelector button").forEach(btn => btn.classList.toggle("active", btn.dataset.value === state.sertraline));
  const editor = document.getElementById("futureStageEditor");
  editor.innerHTML = "";
  STAGES.slice(1).forEach((base) => {
    if (base.index === 6) return;
    const stage = getStage(base.index);
    const card = document.createElement("div");
    card.className = "stage-editor-card";
    const lorVals = stage.lor || ["","",""];
    const pregVals = stage.preg || ["","",""];
    card.innerHTML = `
      <div class="stage-editor-title"><strong>Fase ${base.index+1}</strong><span>${formatDate(addDays(state.startDate, base.index*5))} · ${base.lorTotal} mg / ${base.pregTotal} mg</span></div>
      <div class="editor-drug"><label>Lorazepam (mg): mañana · mediodía · noche</label><div class="triple-input">${tripleInputs(base.index,"lor",lorVals,.5)}</div></div>
      <div class="editor-drug"><label>Pregabalina (mg): mañana · mediodía · noche</label><div class="triple-input">${tripleInputs(base.index,"preg",pregVals,100)}</div></div>
      <p class="editor-help">La suma debe ser exactamente ${base.lorTotal} mg de lorazepam y ${base.pregTotal} mg de pregabalina.</p>
      <p class="editor-error" id="error-stage-${base.index}"></p>`;
    editor.appendChild(card);
  });
}

function tripleInputs(index, drug, vals, step) {
  return vals.map((v,i) => `<input inputmode="decimal" type="number" min="0" step="${step}" value="${v}" data-stage="${index}" data-drug="${drug}" data-pos="${i}" placeholder="—" aria-label="${drug} toma ${i+1}">`).join("");
}

function saveSettingsFromUi() {
  const start = document.getElementById("startDateInput").value;
  if (!start) return showToast("Selecciona una fecha de inicio");

  const newOverrides = { ...state.stageOverrides };
  let hasError = false;

  for (let stageIndex = 1; stageIndex <= 5; stageIndex++) {
    const base = STAGES[stageIndex];
    const lorInputs = [...document.querySelectorAll(`input[data-stage="${stageIndex}"][data-drug="lor"]`)];
    const pregInputs = [...document.querySelectorAll(`input[data-stage="${stageIndex}"][data-drug="preg"]`)];
    const lorRaw = lorInputs.map(i => i.value.trim());
    const pregRaw = pregInputs.map(i => i.value.trim());
    const blank = [...lorRaw, ...pregRaw].every(v => v === "");
    const errorEl = document.getElementById(`error-stage-${stageIndex}`);
    errorEl.textContent = "";

    if (blank) {
      delete newOverrides[String(stageIndex)];
      continue;
    }
    if ([...lorRaw, ...pregRaw].some(v => v === "")) {
      errorEl.textContent = "Completa las seis casillas o déjalas todas vacías.";
      hasError = true; continue;
    }
    const lor = lorRaw.map(Number);
    const preg = pregRaw.map(Number);
    const lorSum = round(lor.reduce((a,b)=>a+b,0), 2);
    const pregSum = round(preg.reduce((a,b)=>a+b,0), 2);
    const validLorSteps = lor.every(v => v >= 0 && Math.abs((v*2) - Math.round(v*2)) < .001);
    const validPregSteps = preg.every(v => v >= 0 && v % 100 === 0);
    if (lorSum !== base.lorTotal || pregSum !== base.pregTotal || !validLorSteps || !validPregSteps) {
      errorEl.textContent = `Revisa la suma y los formatos: lorazepam en pasos de 0,5 mg y pregabalina en pasos de 100 mg.`;
      hasError = true; continue;
    }
    newOverrides[String(stageIndex)] = { lor, preg };
  }
  if (hasError) return showToast("Hay una fase que necesita revisión");

  state.startDate = start;
  state.stageOverrides = newOverrides;
  saveState();
  closeSheet("settingsSheet");
  render();
  showToast("Ajustes guardados");
}

function render() {
  renderHero();
  renderNextChange();
  renderTimeline();
  renderPlanProgress();
  renderBaseMeds();
  renderFullPlan();
  renderHistory();
  renderSettings();
}

function openSheet(id) {
  const el = document.getElementById(id);
  if (!el.open) el.showModal();
}
function closeSheet(id) {
  const el = document.getElementById(id);
  if (el.open) el.close();
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1900);
}

function formatSigned(n, unit="") {
  if (n === 0) return `0${unit}`;
  return `${n > 0 ? "+" : ""}${String(n).replace(".",",")}${unit}`;
}
function formatDistribution(arr, unit) {
  return arr.map(v => `${String(v).replace(".",",")} ${unit}`).join(" · ");
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function round(n, places) { const p = 10 ** places; return Math.round((n + Number.EPSILON) * p) / p; }

function bindEvents() {
  document.getElementById("markCurrentButton").addEventListener("click", () => toggleTaken(isoDate(), getCurrentPeriod()));
  document.getElementById("dailyTimeline").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-period]");
    if (btn) toggleTaken(isoDate(), btn.dataset.period);
  });
  document.getElementById("openPlanButton").addEventListener("click", () => openSheet("planSheet"));
  document.getElementById("openPlanFromWarning").addEventListener("click", () => openSheet("settingsSheet"));
  document.getElementById("settingsButton").addEventListener("click", () => openSheet("settingsSheet"));
  document.querySelector('[data-action="plan"]').addEventListener("click", () => openSheet("planSheet"));
  document.querySelector('[data-action="history"]').addEventListener("click", () => { renderHistory(); openSheet("historySheet"); });
  document.querySelectorAll("[data-close]").forEach(btn => btn.addEventListener("click", () => closeSheet(btn.dataset.close)));
  ["planSheet","historySheet","settingsSheet"].forEach(id => {
    document.getElementById(id).addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeSheet(id);
    });
  });
  document.getElementById("sertralineSelector").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn) return;
    state.sertraline = btn.dataset.value;
    document.querySelectorAll("#sertralineSelector button").forEach(b => b.classList.toggle("active", b === btn));
  });
  document.getElementById("saveSettingsButton").addEventListener("click", saveSettingsFromUi);
  document.getElementById("clearHistoryButton").addEventListener("click", () => {
    if (confirm("¿Borrar todas las marcas de tomas realizadas?")) {
      state.taken = {}; saveState(); render(); showToast("Seguimiento borrado");
    }
  });
  document.getElementById("resetAppButton").addEventListener("click", () => {
    if (confirm("Esto restablecerá fecha, pauta configurada y seguimiento. ¿Continuar?")) {
      state = initialState(); saveState(); closeSheet("settingsSheet"); render(); showToast("App restablecida");
    }
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

bindEvents();
render();
setInterval(() => renderHero(), 60_000);
