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

const popupOverlay = new ol.Overlay({
  element: popupEl,
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
  overlays: [popupOverlay],
  view: new ol.View({
    center: ol.proj.fromLonLat([-75.6972, 45.4215]),
    zoom: 12,
  }),
});

let currentCity = "";
let heatmapDebounce = null;

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

document.getElementById("radius").addEventListener("input", () => {
  document.getElementById("radius-label").textContent = getRadius() + "m";
});

async function loadRiskSurface(city, conditions) {
  try {
    const res = await fetch("http://localhost:8080/risk-surface", {
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
  const url = `http://localhost:8080/points/${city}${params ? "?" + params : ""}`;

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

  const total = stats.total ?? 0;
  document.getElementById("popup-total").textContent =
    total === 0 ? "no crashes nearby" : `${total} crashes nearby`;

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
    cfEl.textContent = `💡 ${cf.field} ${cf.from} → ${cf.to} reduces fatal risk by ${(cf.reduction * 100).toFixed(0)}%`;
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

function closePopup() {
  popupEl.classList.add("hidden");
  popupOverlay.setPosition(undefined);
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
  const status = document.getElementById("status");
  status.textContent = "analyzing...";
  status.classList.remove("status-fade");

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
    const [statsRes, cfRes] = await Promise.all([
      fetch("http://localhost:8080/local-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      }),
      fetch("http://localhost:8080/counterfactual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      }),
    ]);

    const stats = await statsRes.json();
    const cf    = await cfRes.json();

    const sev = stats.severity ?? {};
    const topSev = Object.entries(sev).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";

    void status.offsetWidth;
    status.classList.add("status-fade");
    status.textContent = `↑ ${stats.total ?? 0} crashes nearby`;

    if (coordinate) showPopup(coordinate, stats, cf);
    if (pixel)      showPulse(pixel, topSev, radius);
  } catch {
    status.textContent = "api not connected.";
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
    const status = document.getElementById("status");
    status.textContent = `outside ${currentCity} region.`;
    status.classList.remove("status-fade");
    void status.offsetWidth;
    status.classList.add("status-fade");
    return;
  }
  analyze(lat, lon, e.coordinate, e.pixel);
});

setCity("ottawa");
