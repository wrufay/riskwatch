const riskSource = new ol.source.Vector();
const riskLayer = new ol.layer.Heatmap({
  source: riskSource,
  blur: 40,
  radius: 20,
  opacity: 0.7,
  gradient: ["rgba(224,54,22,0)", "#E03616"],
  weight: (feature) => feature.get("p_norm") ?? 0,
});

const heatmapSource = new ol.source.Vector();

const heatmapLayer = new ol.layer.Heatmap({
  source: heatmapSource,
  blur: 24,
  radius: 12,
  opacity: 0.5,
  gradient: ["rgba(251,255,241,0)", "#B4C5E4", "#3D52D5"],
  weight: (feature) => feature.get("weight"),
});

const popupEl = document.getElementById("popup");
const predictPopupEl = document.getElementById("predict-popup");

const popupOverlay = new ol.Overlay({
  element: popupEl,
  positioning: "bottom-center",
  offset: [0, -12],
  stopEvent: true,
});

const predictOverlay = new ol.Overlay({
  element: predictPopupEl,
  positioning: "bottom-center",
  offset: [0, -12],
  stopEvent: true,
});

const map = new ol.Map({
  target: "map",
  layers: [
    new ol.layer.Tile({
      source: new ol.source.XYZ({
        url: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        attributions: "© CartoDB",
      }),
    }),
    heatmapLayer,
    riskLayer,
  ],
  overlays: [popupOverlay, predictOverlay],
  view: new ol.View({
    center: ol.proj.fromLonLat([-75.6972, 45.4215]),
    zoom: 12,
  }),
});

const API = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "http://localhost:8080"
  : "https://riskwatch-production.up.railway.app";

let currentCity = "";
let currentMode  = "explore";
let heatmapDebounce = null;
let explorerCoordinate = null;
let currentUnit = "m";
let popupFadeTimer = null;
let lastPredictData = null;

// ── Heatmap ───────────────────────────────────────────────────────────────────

function getConditions() {
  return {
    weather: document.getElementById("weather").value,
    road:    document.getElementById("road_surface").value,
    light:   document.getElementById("light").value,
  };
}

function getRadius() {
  return parseInt(document.getElementById("radius").value, 10);
}

function formatRadius(m) {
  if (currentUnit === "km") return (m / 1000).toFixed(1) + "km";
  if (currentUnit === "mi") return (m / 1609).toFixed(2) + "mi";
  return m + "m";
}

document.getElementById("radius").addEventListener("input", () => {
  document.getElementById("radius-label").textContent = formatRadius(getRadius());
});

function setUnit(unit) {
  currentUnit = unit;
  document.getElementById("radius-label").textContent = formatRadius(getRadius());
  ["m", "km", "mi"].forEach((u) => {
    const btn = document.getElementById("unit-" + u);
    btn.classList.toggle("bg-navy-electric", u === unit);
    btn.classList.toggle("text-ivory",        u === unit);
    btn.classList.toggle("bg-royal-azure",    u !== unit);
    btn.classList.toggle("text-powder-blue",  u !== unit);
  });
}

let conditionsPanelOpen = false;
function toggleConditionsPanel() {
  conditionsPanelOpen = !conditionsPanelOpen;
  document.getElementById("conditions-panel").classList.toggle("hidden", !conditionsPanelOpen);
  document.getElementById("btn-conditions").textContent = conditionsPanelOpen ? "conditions ▴" : "conditions ▾";
}

async function loadRiskSurface(city, conditions) {
  try {
    const res = await fetch(`${API}/risk-surface`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city, ...conditions }),
    });
    const geojson = await res.json();
    const features = new ol.format.GeoJSON().readFeatures(geojson, {
      featureProjection: "EPSG:3857",
    });

    const ps = features.map((f) => f.get("p"));
    const minP = Math.min(...ps);
    const maxP = Math.max(...ps);
    const range = maxP - minP || 1;
    features.forEach((f) => f.set("p_norm", (f.get("p") - minP) / range));

    riskSource.clear();
    riskSource.addFeatures(features);
  } catch {
    console.warn("could not load risk surface");
  }
}

async function loadHeatmap(city, conditions = {}) {
  const params = new URLSearchParams(conditions).toString();
  const url = `${API}/points/${city}${params ? "?" + params : ""}`;

  try {
    const fadeOut = setInterval(() => {
      const op = heatmapLayer.getOpacity();
      if (op <= 0.05) {
        clearInterval(fadeOut);
        fetchAndFadeIn();
      } else {
        heatmapLayer.setOpacity(op - 0.1);
      }
    }, 20);
  } catch {
    console.warn("heatmap fade error");
  }

  async function fetchAndFadeIn() {
    try {
      const res = await fetch(url);
      const geojson = await res.json();
      const features = new ol.format.GeoJSON().readFeatures(geojson, {
        featureProjection: "EPSG:3857",
      });
      heatmapSource.clear();
      heatmapSource.addFeatures(features);

      const fadeIn = setInterval(() => {
        const op = heatmapLayer.getOpacity();
        if (op >= 0.85) {
          heatmapLayer.setOpacity(0.85);
          clearInterval(fadeIn);
        } else {
          heatmapLayer.setOpacity(op + 0.08);
        }
      }, 20);
    } catch {
      console.warn("could not load heatmap — is the backend running?");
    }
  }
}

// ── Popup ─────────────────────────────────────────────────────────────────────

function showPopup(coordinate, stats, cf) {
  popupOverlay.setPosition(coordinate);
  popupEl.classList.remove("hidden");
  popupEl.classList.remove("popup-in");
  void popupEl.offsetWidth;
  popupEl.classList.add("popup-in");

  clearTimeout(popupFadeTimer);
  popupFadeTimer = setTimeout(closePopup, 10_000);

  const total = stats.total ?? 0;
  const radiusLabel = formatRadius(stats.radius ?? getRadius());
  document.getElementById("popup-total").textContent =
    total === 0 ? "no crashes nearby" : `${total} crashes within ${radiusLabel}`;

  const sev     = stats.severity ?? {};
  const fatal   = sev["fatal"] ?? 0;
  const nonfatal = sev["non-fatal injury"] ?? 0;
  const propdmg  = sev["property damage only"] ?? 0;

  document.getElementById("bar-fatal").style.width    = "0%";
  document.getElementById("bar-nonfatal").style.width = "0%";
  document.getElementById("bar-propdmg").style.width  = "0%";

  const condEl = document.getElementById("popup-conditions");
  if (total > 0 && stats.top_weather) {
    condEl.textContent = `most common: ${stats.top_weather} · ${stats.top_road} · ${stats.top_light}`;
    condEl.classList.remove("hidden");
  } else {
    condEl.classList.add("hidden");
  }

  const cfEl = document.getElementById("popup-cf");
  if (cf && cf.field && cf.reduction > 0.01) {
    cfEl.textContent = `${cf.field} ${cf.from} ➜ ${cf.to} reduces fatal risk by ${(cf.reduction * 100).toFixed(0)}%`;
    cfEl.classList.remove("hidden");
  } else {
    cfEl.classList.add("hidden");
  }

  setTimeout(() => {
    document.getElementById("bar-fatal").style.width    = (fatal * 100).toFixed(1) + "%";
    document.getElementById("bar-nonfatal").style.width = (nonfatal * 100).toFixed(1) + "%";
    document.getElementById("bar-propdmg").style.width  = (propdmg * 100).toFixed(1) + "%";
    document.getElementById("pct-fatal").textContent    = (fatal * 100).toFixed(0) + "%";
    document.getElementById("pct-nonfatal").textContent = (nonfatal * 100).toFixed(0) + "%";
    document.getElementById("pct-propdmg").textContent  = (propdmg * 100).toFixed(0) + "%";
  }, 50);
}

function fadeOutEl(el, overlay, instant = false) {
  if (el.classList.contains("hidden")) return;
  if (instant) {
    el.classList.remove("popup-out");
    el.classList.add("hidden");
    overlay.setPosition(undefined);
    return;
  }
  el.classList.add("popup-out");
  el.addEventListener("animationend", () => {
    el.classList.remove("popup-out");
    el.classList.add("hidden");
    overlay.setPosition(undefined);
  }, { once: true });
}

function closePopup(instant = false) {
  clearTimeout(popupFadeTimer);
  fadeOutEl(popupEl, popupOverlay, instant);
}

function showPredictPopup(coordinate, data, cf) {
  clearTimeout(popupFadeTimer);
  popupFadeTimer = setTimeout(closePredictPopup, 10_000);
  predictOverlay.setPosition(coordinate);
  predictPopupEl.classList.remove("hidden");
  predictPopupEl.classList.remove("popup-in");
  void predictPopupEl.offsetWidth;
  predictPopupEl.classList.add("popup-in");

  const p = data.probabilities;
  const fatal    = p["fatal"] ?? 0;
  const nonfatal = p["non-fatal injury"] ?? 0;
  const propdmg  = p["property damage only"] ?? 0;

  document.getElementById("predict-severity").textContent = data.severity;

  document.getElementById("pred-bar-fatal").style.width    = "0%";
  document.getElementById("pred-bar-nonfatal").style.width = "0%";
  document.getElementById("pred-bar-propdmg").style.width  = "0%";

  // Condition chips
  const conditionsEl = document.getElementById("predict-conditions");
  conditionsEl.innerHTML = "";
  const c = data.conditions ?? {};
  for (const val of [c.weather, c.road, c.light].filter(Boolean)) {
    conditionsEl.innerHTML += `<span class="font-mono text-[10px] bg-graphite text-powder-blue px-1.5 py-0.5 rounded-full border border-powder-blue/30">${val}</span>`;
  }

  // Road enrichment
  const roadEl = document.getElementById("predict-road-info");
  roadEl.textContent = `snapped to: ${data.highway} · ${data.speed} km/h`;
  roadEl.classList.remove("hidden");

  // Key factors
  const factorsEl = document.getElementById("predict-factors");
  if (data.factors?.length) {
    factorsEl.textContent = `top factors: ${data.factors.join(" · ")}`;
    factorsEl.classList.remove("hidden");
  } else {
    factorsEl.classList.add("hidden");
  }

  // Counterfactual
  const cfEl = document.getElementById("predict-cf");
  if (cf && cf.field && cf.reduction > 0.01) {
    cfEl.textContent = `${cf.field} ${cf.from} ➜ ${cf.to} reduces fatal risk by ${(cf.reduction * 100).toFixed(0)}%`;
    cfEl.classList.remove("hidden");
  } else {
    cfEl.classList.add("hidden");
  }

  setTimeout(() => {
    document.getElementById("pred-bar-fatal").style.width    = (fatal * 100).toFixed(1) + "%";
    document.getElementById("pred-bar-nonfatal").style.width = (nonfatal * 100).toFixed(1) + "%";
    document.getElementById("pred-bar-propdmg").style.width  = (propdmg * 100).toFixed(1) + "%";
    document.getElementById("pred-pct-fatal").textContent    = (fatal * 100).toFixed(0) + "%";
    document.getElementById("pred-pct-nonfatal").textContent = (nonfatal * 100).toFixed(0) + "%";
    document.getElementById("pred-pct-propdmg").textContent  = (propdmg * 100).toFixed(0) + "%";
  }, 50);
}

function closePredictPopup(instant = false) {
  clearTimeout(popupFadeTimer);
  fadeOutEl(predictPopupEl, predictOverlay, instant);
}

// ── Predict detail modal ──────────────────────────────────────────────────────

let lastPredictParams = null;

function openPredictDetail() {
  const d = lastPredictData;
  if (!d) return;

  document.getElementById("pmodal-severity").textContent = d.severity;
  document.getElementById("pmodal-road").textContent     = `snapped to: ${d.highway} · ${d.speed} km/h`;

  document.getElementById("pmodal-conditions").innerHTML =
    [d.conditions.weather, d.conditions.road, d.conditions.light]
      .map(val => `<span class="font-mono text-xs bg-graphite/60 text-powder-blue px-2 py-0.5 rounded-full border border-powder-blue/30">${val}</span>`)
      .join("");

  const p = d.probabilities;
  document.getElementById("pmodal-bar-fatal").style.width    = "0%";
  document.getElementById("pmodal-bar-nonfatal").style.width = "0%";
  document.getElementById("pmodal-bar-propdmg").style.width  = "0%";
  setTimeout(() => {
    document.getElementById("pmodal-bar-fatal").style.width    = ((p["fatal"] ?? 0) * 100).toFixed(1) + "%";
    document.getElementById("pmodal-bar-nonfatal").style.width = ((p["non-fatal injury"] ?? 0) * 100).toFixed(1) + "%";
    document.getElementById("pmodal-bar-propdmg").style.width  = ((p["property damage only"] ?? 0) * 100).toFixed(1) + "%";
    document.getElementById("pmodal-pct-fatal").textContent    = ((p["fatal"] ?? 0) * 100).toFixed(0) + "%";
    document.getElementById("pmodal-pct-nonfatal").textContent = ((p["non-fatal injury"] ?? 0) * 100).toFixed(0) + "%";
    document.getElementById("pmodal-pct-propdmg").textContent  = ((p["property damage only"] ?? 0) * 100).toFixed(0) + "%";
  }, 80);

  const maxImp = Math.max(...d.factors.map(f => f.importance));
  document.getElementById("pmodal-factors").innerHTML = d.factors.map(f => {
    const pct = maxImp > 0 ? (f.importance / maxImp * 100).toFixed(1) : "0";
    return `<div class="flex items-center gap-2">
      <span class="font-mono text-sm text-powder-blue w-36 shrink-0">${f.label}</span>
      <div class="flex-1 rounded-full h-1.5 overflow-hidden" style="background:#2a2730">
        <div class="h-full bg-powder-blue rounded-full transition-all duration-700" style="width:${pct}%"></div>
      </div>
      <span class="font-mono text-sm text-powder-blue opacity-50 w-12 text-right">${(f.importance * 100).toFixed(1)}%</span>
    </div>`;
  }).join("");

  document.getElementById("pmodal-alternatives").innerHTML = d.alternatives.map(a => {
    const sign = a.delta < 0 ? "↓" : a.delta > 0 ? "↑" : "—";
    const col  = a.delta < -0.001 ? "text-royal-azure" : a.delta > 0.001 ? "text-burnt-tangerine" : "text-powder-blue opacity-40";
    return `<div class="flex items-center gap-2 py-1 border-b border-powder-blue/10">
      <span class="font-mono text-sm text-powder-blue opacity-50 w-16 shrink-0">${a.field}</span>
      <span class="font-mono text-sm text-ivory">${a.from} ➜ ${a.to}</span>
      <span class="font-mono text-sm ${col} ml-auto">${sign} ${Math.abs(a.delta * 100).toFixed(1)}%</span>
    </div>`;
  }).join("");

  openModal("predict-modal");
}

function closePredictDetail() {
  closeModal("predict-modal");
}

// ── Mode toggle ───────────────────────────────────────────────────────────────

function setMode(mode) {
  currentMode = mode;
  closePopup(true);
  closePredictPopup(true);

  const exploreBtn = document.getElementById("btn-explore");
  const predictBtn = document.getElementById("btn-predict");

  exploreBtn.classList.toggle("bg-navy-electric", mode === "explore");
  exploreBtn.classList.toggle("text-ivory",        mode === "explore");
  exploreBtn.classList.toggle("bg-royal-azure",    mode !== "explore");
  exploreBtn.classList.toggle("text-powder-blue",  mode !== "explore");

  predictBtn.classList.toggle("bg-navy-electric", mode === "predict");
  predictBtn.classList.toggle("text-ivory",        mode === "predict");
  predictBtn.classList.toggle("bg-royal-azure",    mode !== "predict");
  predictBtn.classList.toggle("text-powder-blue",  mode !== "predict");
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

function openModal(id) {
  const el = document.getElementById(id);
  el.classList.remove("hidden", "modal-out");
  el.classList.add("modal-in");
  el.addEventListener("animationend", () => el.classList.remove("modal-in"), { once: true });
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el.classList.contains("hidden")) return;
  el.classList.remove("modal-in");
  el.classList.add("modal-out");
  el.addEventListener("animationend", () => {
    el.classList.remove("modal-out");
    el.classList.add("hidden");
  }, { once: true });
}

// ── Explorer modal ────────────────────────────────────────────────────────────

const SEV_COLOR = { "fatal": "text-burnt-tangerine", "non-fatal injury": "text-royal-azure", "property damage only": "text-navy-electric" };

async function openExplorer() {
  if (!explorerCoordinate) return;
  const [lon, lat] = ol.proj.toLonLat(explorerCoordinate);
  const res = await fetch(`${API}/local-records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ city: currentCity, lat, lon, radius: getRadius() }),
  });
  const data = await res.json();
  const list = document.getElementById("explorer-list");
  document.getElementById("explorer-title").textContent = `${data.total} crashes nearby`;
  list.innerHTML = data.records.map(r => {
    const col = SEV_COLOR[r.severity] ?? "text-graphite";
    const hw  = r.highway ? ` · ${r.highway}` : "";
    const spd = r.speed   ? ` · ${r.speed}km/h` : "";
    return `<div class="flex items-center gap-3 py-1.5 border-b border-powder-blue/40">
      <span class="font-sans text-sm font-semibold ${col} w-28 shrink-0">${r.severity}</span>
      <span class="font-mono text-sm text-graphite opacity-70">${r.weather} · ${r.road} · ${r.light}${hw}${spd}</span>
    </div>`;
  }).join("");
  openModal("explorer-modal");
}

function closeExplorer() {
  closeModal("explorer-modal");
}

function setPopupOpacity(val) {
  document.getElementById("popup-card").style.opacity = val / 100;
}

// ── Pulse ring ────────────────────────────────────────────────────────────────

const SEVERITY_COLOR = {
  "fatal":                "#E03616",
  "non-fatal injury":     "#B4C5E4",
  "property damage only": "#3D52D5",
};

function showPulse(pixel, severity, radiusM = 500) {
  const resolution = map.getView().getResolution();
  const diameter = Math.round(2 * radiusM / resolution);

  const ring = document.createElement("div");
  ring.className = "pulse-ring";
  ring.style.borderColor = SEVERITY_COLOR[severity] ?? "#3D52D5";
  ring.style.width  = diameter + "px";
  ring.style.height = diameter + "px";
  ring.style.left = pixel[0] + "px";
  ring.style.top  = pixel[1] + "px";
  document.getElementById("map").appendChild(ring);
  ring.addEventListener("animationend", () => ring.remove());
}

// ── Clippy tutorial ───────────────────────────────────────────────────────────

const TUTORIAL_STEPS = [
  { text: "welcome to riskwatch — a traffic collision explorer for ottawa and halifax.", target: null },
  { text: "start by selecting a city. all data and predictions are city-specific.", target: "btn-ottawa" },
  { text: "adjust weather, road surface, and lighting to reflect current conditions. both map layers respond in real time.", target: "weather" },
  { text: "the blue heatmap shows where crashes historically occurred. darker areas = higher crash density.", target: null },
  { text: "the red overlay shows where a machine learning model predicts elevated fatal risk under your selected conditions.", target: null },
  { text: "set a search radius before clicking — this controls how wide an area the stats are pulled from.", target: "radius" },
  { text: "click anywhere on the map to see a breakdown of real crashes in that area.", target: null },
];

const clippyEl   = document.getElementById("clippy");
const clippyText = document.getElementById("clippy-text");
const clippyStep = document.getElementById("clippy-step");
const clippyPrev = document.getElementById("clippy-prev");
let tutorialIdx      = 0;
let highlighted      = null;
let typewriterTimeout = null;

function setHighlight(targetId) {
  if (highlighted) highlighted.classList.remove("tutorial-highlight");
  highlighted = targetId ? document.getElementById(targetId) : null;
  if (highlighted) highlighted.classList.add("tutorial-highlight");
}

function typewrite(text) {
  clearTimeout(typewriterTimeout);
  clippyText.textContent = "";
  clippyText.classList.add("typewriter");
  let i = 0;
  const type = () => {
    if (i < text.length) {
      clippyText.textContent += text[i++];
      typewriterTimeout = setTimeout(type, 28);
    } else {
      clippyText.classList.remove("typewriter");
    }
  };
  type();
}

function renderStep(idx) {
  const step = TUTORIAL_STEPS[idx];
  typewrite(step.text);
  clippyStep.textContent = `${idx + 1}/${TUTORIAL_STEPS.length}`;
  clippyPrev.style.visibility = idx === 0 ? "hidden" : "visible";
  document.getElementById("clippy-next").textContent = idx === TUTORIAL_STEPS.length - 1 ? "done" : "next";
  setHighlight(step.target);
}

function tutorialNext() {
  if (tutorialIdx < TUTORIAL_STEPS.length - 1) {
    tutorialIdx++;
    renderStep(tutorialIdx);
  } else {
    dismissClipy();
  }
}

function tutorialPrev() {
  if (tutorialIdx > 0) {
    tutorialIdx--;
    renderStep(tutorialIdx);
  }
}

function startTutorial() {
  tutorialIdx = 0;
  clippyEl.style.display = "flex";
  clippyEl.classList.remove("tutorial-in");
  void clippyEl.offsetWidth;
  clippyEl.classList.add("tutorial-in");
  renderStep(0);
}

function dismissClipy() {
  setHighlight(null);
  clippyEl.style.display = "none";
  localStorage.setItem("riskwatch-tutorial-done", "1");
}

function toggleTutorial() {
  if (clippyEl.style.display === "none") {
    localStorage.removeItem("riskwatch-tutorial-done");
    startTutorial();
  } else {
    dismissClipy();
  }
}

if (localStorage.getItem("riskwatch-tutorial-done")) {
  clippyEl.style.display = "none";
} else {
  startTutorial();
}

// ── City toggle ───────────────────────────────────────────────────────────────

function setCity(city) {
  currentCity = city;
  closePopup();
  map.getView().animate({
    center: ol.proj.fromLonLat(
      city === "ottawa" ? [-75.6972, 45.4215] : [-63.5752, 44.6488]
    ),
    zoom: 12,
    duration: 600,
  });

  const ottawaBtn = document.getElementById("btn-ottawa");
  const halifaxBtn = document.getElementById("btn-halifax");

  ottawaBtn.classList.toggle("bg-navy-electric", city === "ottawa");
  ottawaBtn.classList.toggle("text-ivory", city === "ottawa");
  ottawaBtn.classList.toggle("bg-royal-azure", city !== "ottawa");
  ottawaBtn.classList.toggle("text-powder-blue", city !== "ottawa");

  halifaxBtn.classList.toggle("bg-navy-electric", city === "halifax");
  halifaxBtn.classList.toggle("text-ivory", city === "halifax");
  halifaxBtn.classList.toggle("bg-royal-azure", city !== "halifax");
  halifaxBtn.classList.toggle("text-powder-blue", city !== "halifax");

  const c = getConditions();
  loadHeatmap(city, c);
  loadRiskSurface(city, { weather: c.weather, road_surface: c.road, light: c.light });
}

function onConditionChange() {
  clearTimeout(heatmapDebounce);
  heatmapDebounce = setTimeout(() => {
    const c = getConditions();
    loadHeatmap(currentCity, c);
    loadRiskSurface(currentCity, { weather: c.weather, road_surface: c.road, light: c.light });
  }, 400);
}

// ── Analyze ───────────────────────────────────────────────────────────────────

async function analyze(lat, lon, coordinate, pixel) {
  const radius = getRadius();
  const params = {
    city:         currentCity,
    weather:      document.getElementById("weather").value,
    road_surface: document.getElementById("road_surface").value,
    light:        document.getElementById("light").value,
    radius,
    lat,
    lon,
  };

  try {
    if (currentMode === "explore") {
      explorerCoordinate = coordinate;
      const [statsRes, cfRes] = await Promise.all([
        fetch(`${API}/local-stats`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        }),
        fetch(`${API}/counterfactual`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        }),
      ]);
      const stats = await statsRes.json();
      const cf    = await cfRes.json();
      const sev    = stats.severity ?? {};
      const topSev = Object.entries(sev).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "property damage only";

      closePredictPopup();
      if (coordinate) showPopup(coordinate, { ...stats, radius }, cf);
      if (pixel)      showPulse(pixel, topSev, radius);

    } else {
      lastPredictParams = params;
      const res = await fetch(`${API}/predict-detail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const d = await res.json();
      lastPredictData = d;

      const bestAlt = d.alternatives?.find(a => a.delta < 0);
      const cf = bestAlt
        ? { field: bestAlt.field, from: bestAlt.from, to: bestAlt.to, reduction: -bestAlt.delta }
        : null;
      const pred = {
        severity:      d.severity,
        probabilities: d.probabilities,
        conditions:    d.conditions,
        highway:       d.highway,
        speed:         d.speed,
        factors:       d.factors.slice(0, 3).map(f => f.label),
      };

      closePopup();
      if (coordinate) showPredictPopup(coordinate, pred, cf);
      if (pixel)      showPulse(pixel, d.severity, radius);
    }
  } catch {
    console.warn("api not connected.");
  }
}

const CITY_BOUNDS = {
  ottawa:  { lat: [45.20, 45.55], lon: [-76.00, -75.25] },
  halifax: { lat: [44.55, 44.85], lon: [-63.80, -63.45] },
};

map.on("click", (e) => {
  const [lon, lat] = ol.proj.toLonLat(e.coordinate);
  const b = CITY_BOUNDS[currentCity];
  if (lat < b.lat[0] || lat > b.lat[1] || lon < b.lon[0] || lon > b.lon[1]) {
    return;
  }
  analyze(lat, lon, e.coordinate, e.pixel);
});

setCity("ottawa");
