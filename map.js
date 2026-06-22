const map = new ol.Map({
  target: "map",
  layers: [
    new ol.layer.Tile({
      source: new ol.source.XYZ({
        url: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        attributions: "© CartoDB",
      }),
    }),
  ],
  view: new ol.View({
    center: ol.proj.fromLonLat([-75.6972, 45.4215]),
    zoom: 12,
  }),
});

let currentCity = "";

// Clippy tutorial
const CLIPPY_MSG =
  "hi! pick a city, set your conditions, then hit analyze to see collision risk.";
const clippyEl = document.getElementById("clippy");
const clippyText = document.getElementById("clippy-text");
let typewriterTimeout = null;

function startTypewriter() {
  clearTimeout(typewriterTimeout);
  clippyText.textContent = "";
  clippyText.classList.add("typewriter");
  let i = 0;
  const type = () => {
    if (i < CLIPPY_MSG.length) {
      clippyText.textContent += CLIPPY_MSG[i++];
      typewriterTimeout = setTimeout(type, 30);
    } else {
      clippyText.classList.remove("typewriter");
      typewriterTimeout = null;
    }
  };
  type();
}

if (localStorage.getItem("riskwatch-tutorial-done")) {
  clippyEl.style.display = "none";
} else {
  startTypewriter();
}

function dismissClipy() {
  clearTimeout(typewriterTimeout);
  typewriterTimeout = null;
  clippyEl.style.display = "none";
  localStorage.setItem("riskwatch-tutorial-done", "1");
}

function toggleTutorial() {
  if (clippyEl.style.display === "none") {
    clippyEl.style.display = "flex";
    localStorage.removeItem("riskwatch-tutorial-done");
    startTypewriter();
  } else {
    dismissClipy();
  }
}

// City toggle
function setCity(city) {
  currentCity = city;
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

  onConditionChange();
}

function onConditionChange() {}

function resetConditions() {
  document.getElementById("weather").value = "clear";
  document.getElementById("road_surface").value = "dry";
  document.getElementById("light").value = "daylight";
  document.getElementById("hour").value = 12;
  document.getElementById("hour-label").textContent = "12:00";
}

async function analyze() {
  const status = document.getElementById("status");
  status.textContent = "analyzing...";

  const params = {
    city: currentCity,
    weather: document.getElementById("weather").value,
    road_surface: document.getElementById("road_surface").value,
    light: document.getElementById("light").value,
    hour: parseInt(document.getElementById("hour").value),
  };

  try {
    const res = await fetch("http://localhost:5000/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    status.textContent = `severity: ${data.severity} (${(
      data.probability * 100
    ).toFixed(1)}%)`;
  } catch {
    status.textContent = "api not connected.";
  }
}

setCity("ottawa");
