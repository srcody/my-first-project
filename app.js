const DEFAULT_PLACE = { name: "Boca Raton", region: "Florida", latitude: 26.3683, longitude: -80.1289 };

// WMO weather codes -> [description, day icon, night icon, scene]
const CODES = {
  0: ["Clear", "☀️", "🌙", "clear"],
  1: ["Mostly Clear", "🌤️", "🌙", "clear"],
  2: ["Partly Cloudy", "⛅", "☁️", "cloudy"],
  3: ["Cloudy", "☁️", "☁️", "cloudy"],
  45: ["Fog", "🌫️", "🌫️", "cloudy"],
  48: ["Fog", "🌫️", "🌫️", "cloudy"],
  51: ["Light Drizzle", "🌦️", "🌧️", "rain"],
  53: ["Drizzle", "🌦️", "🌧️", "rain"],
  55: ["Heavy Drizzle", "🌧️", "🌧️", "rain"],
  56: ["Freezing Drizzle", "🌧️", "🌧️", "rain"],
  57: ["Freezing Drizzle", "🌧️", "🌧️", "rain"],
  61: ["Light Rain", "🌦️", "🌧️", "rain"],
  63: ["Rain", "🌧️", "🌧️", "rain"],
  65: ["Heavy Rain", "🌧️", "🌧️", "rain"],
  66: ["Freezing Rain", "🌧️", "🌧️", "rain"],
  67: ["Freezing Rain", "🌧️", "🌧️", "rain"],
  71: ["Light Snow", "🌨️", "🌨️", "snow"],
  73: ["Snow", "🌨️", "🌨️", "snow"],
  75: ["Heavy Snow", "❄️", "❄️", "snow"],
  77: ["Snow Grains", "🌨️", "🌨️", "snow"],
  80: ["Showers", "🌦️", "🌧️", "rain"],
  81: ["Showers", "🌧️", "🌧️", "rain"],
  82: ["Heavy Showers", "🌧️", "🌧️", "rain"],
  85: ["Snow Showers", "🌨️", "🌨️", "snow"],
  86: ["Snow Showers", "🌨️", "🌨️", "snow"],
  95: ["Thunderstorm", "⛈️", "⛈️", "storm"],
  96: ["Thunderstorm", "⛈️", "⛈️", "storm"],
  99: ["Thunderstorm", "⛈️", "⛈️", "storm"],
};

const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

const $ = (id) => document.getElementById(id);
const describe = (code) => CODES[code] || ["Unknown", "🌡️", "🌡️", "clear"];
const icon = (code, isDay) => describe(code)[isDay ? 1 : 2];
const round = (n) => `${Math.round(n)}°`;
const rand = (max) => Math.random() * max;
const particles = (count, style) => Array.from({ length: count }, () => `<i style="${style()}"></i>`).join("");

// Open-Meteo returns local times like "2026-10-29T14:00", so read the hour straight from the string
function hourLabel(time) {
  const h = Number(time.slice(11, 13));
  return `${h % 12 || 12}<small>${h < 12 ? "AM" : "PM"}</small>`;
}

$("stars").innerHTML = particles(80, () =>
  `left:${rand(100)}%;top:${rand(65)}%;--size:${1 + rand(2)}px;animation-delay:-${rand(4)}s`);

function setScene(scene, isDay) {
  document.body.className = `${scene} ${isDay ? "day" : "night"}`;

  if (scene === "rain" || scene === "storm") {
    $("precip").innerHTML = particles(scene === "storm" ? 130 : 90, () =>
      `left:${rand(100)}%;animation-duration:${0.5 + rand(0.4)}s;animation-delay:-${rand(1)}s;opacity:${0.4 + rand(0.6)}`);
  } else if (scene === "snow") {
    $("precip").innerHTML = particles(70, () =>
      `left:${rand(100)}%;--size:${3 + rand(4)}px;animation-duration:${6 + rand(6)}s;animation-delay:-${rand(12)}s`);
  } else {
    $("precip").innerHTML = "";
  }
}

async function loadWeather(place) {
  $("place").textContent = place.name;
  $("condition").textContent = "Loading…";

  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation,is_day",
    hourly: "temperature_2m,weather_code,is_day,precipitation_probability",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto",
    forecast_days: 7,
  });

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!res.ok) throw new Error(res.statusText);
    render(await res.json());
  } catch (err) {
    $("condition").textContent = "Couldn't load weather. Try again later.";
    console.error(err);
  }
}

function render({ current, hourly, daily }) {
  const [desc, , , scene] = describe(current.weather_code);
  setScene(scene, current.is_day);

  const date = new Date(`${current.time.slice(0, 10)}T12:00`);
  $("date").textContent = date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  $("temp").textContent = round(current.temperature_2m);
  $("condition").textContent = desc;
  $("hilo").textContent = `H:${round(daily.temperature_2m_max[0])}  L:${round(daily.temperature_2m_min[0])}`;

  // Feels like
  const diff = current.apparent_temperature - current.temperature_2m;
  $("feels").innerHTML = `${Math.round(current.apparent_temperature)}°<small>F</small>`;
  $("feels-note").textContent = diff > 2 ? "Warmer than actual" : diff < -2 ? "Cooler than actual" : "Similar to actual";

  // Humidity
  $("humidity").textContent = `${current.relative_humidity_2m}%`;
  $("dew").textContent = `Dew point ${round(current.dew_point_2m)}`;

  // Wind: the arrow points the way the wind is blowing toward
  const deg = current.wind_direction_10m;
  $("wind").innerHTML = `${Math.round(current.wind_speed_10m)}<small>mph</small>`;
  $("wind-dir").textContent = `From the ${DIRECTIONS[Math.round(deg / 45) % 8]} (${Math.round(deg)}°)`;
  $("arrow").style.transform = `rotate(${deg + 180}deg)`;

  // Precipitation
  $("precip-now").innerHTML = `${current.precipitation}<small>in</small>`;
  $("precip-today").textContent = `${daily.precipitation_sum[0]}" expected today`;

  // Next 24 hours starting from the current hour
  const start = hourly.time.findIndex((t) => t >= current.time.slice(0, 13));
  $("hourly").innerHTML = hourly.time.slice(start, start + 24).map((t, i) => {
    const j = start + i;
    const pop = hourly.precipitation_probability[j];
    return `<div class="hour${i === 0 ? " now" : ""}">
      <span class="time">${i === 0 ? "Now" : hourLabel(t)}</span>
      <span class="icon">${icon(hourly.weather_code[j], hourly.is_day[j])}</span>
      <span class="pop">${pop >= 20 ? `${pop}%` : ""}</span>
      <span class="deg">${round(hourly.temperature_2m[j])}</span>
    </div>`;
  }).join("");

  // Temperature bars are scaled across the whole week
  const weekLo = Math.min(...daily.temperature_2m_min);
  const weekHi = Math.max(...daily.temperature_2m_max);
  const pct = (n) => ((n - weekLo) / (weekHi - weekLo || 1)) * 100;

  $("daily").innerHTML = daily.time.map((t, i) => {
    const lo = daily.temperature_2m_min[i];
    const hi = daily.temperature_2m_max[i];
    const name = i === 0 ? "Today" : new Date(`${t}T12:00`).toLocaleDateString([], { weekday: "short" });
    return `<div class="day-row">
      <span>${name}</span>
      <span class="icon">${icon(daily.weather_code[i], true)}</span>
      <div class="range">
        <span class="lo">${round(lo)}</span>
        <div class="bar"><span style="left:${pct(lo)}%;right:${100 - pct(hi)}%"></span></div>
        <span>${round(hi)}</span>
      </div>
    </div>`;
  }).join("");
}

// City search using the Open-Meteo geocoding API
let searchTimer;
$("query").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) return ($("results").hidden = true);
  searchTimer = setTimeout(() => searchCities(q), 300);
});

async function searchCities(q) {
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5`);
    const { results = [] } = await res.json();
    const list = $("results");
    list.innerHTML = "";
    results.forEach((r) => {
      const li = document.createElement("li");
      li.innerHTML = `${r.name} <small>${[r.admin1, r.country].filter(Boolean).join(", ")}</small>`;
      li.addEventListener("click", () => selectPlace(r));
      list.appendChild(li);
    });
    list.hidden = results.length === 0;
  } catch (err) {
    console.error(err);
  }
}

function selectPlace(place) {
  $("query").value = "";
  $("results").hidden = true;
  loadWeather(place);
}

$("search").addEventListener("submit", (e) => {
  e.preventDefault();
  $("results").querySelector("li")?.click();
});

document.addEventListener("click", (e) => {
  if (!$("search").contains(e.target)) $("results").hidden = true;
});

loadWeather(DEFAULT_PLACE);
