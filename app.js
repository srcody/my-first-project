const DEFAULT_PLACE = { name: "Boca Raton", region: "Florida", latitude: 26.3683, longitude: -80.1289 };

// WMO weather codes -> [description, day icon, night icon, theme]
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

const $ = (id) => document.getElementById(id);
const describe = (code) => CODES[code] || ["Unknown", "🌡️", "🌡️", "clear"];
const icon = (code, isDay) => describe(code)[isDay ? 1 : 2];
const round = (n) => `${Math.round(n)}°`;

async function loadWeather(place) {
  $("place").textContent = place.name;
  $("condition").textContent = "Loading…";

  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation,is_day",
    hourly: "temperature_2m,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
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
  const [desc, , , theme] = describe(current.weather_code);
  document.body.className = current.is_day ? theme : "night";

  $("temp").textContent = round(current.temperature_2m);
  $("condition").textContent = desc;
  $("hilo").textContent = `H:${round(daily.temperature_2m_max[0])}  L:${round(daily.temperature_2m_min[0])}`;
  $("feels").textContent = round(current.apparent_temperature);
  $("humidity").textContent = `${current.relative_humidity_2m}%`;
  $("wind").textContent = `${Math.round(current.wind_speed_10m)} mph`;
  $("precip").textContent = `${current.precipitation}"`;

  // Next 24 hours starting from the current hour
  const start = hourly.time.findIndex((t) => t >= current.time.slice(0, 13));
  $("hourly").innerHTML = hourly.time.slice(start, start + 24).map((t, i) => {
    const j = start + i;
    const hour = new Date(t).toLocaleTimeString([], { hour: "numeric" });
    return `<div class="hour">
      <span>${i === 0 ? "Now" : hour}</span>
      <span class="icon">${icon(hourly.weather_code[j], hourly.is_day[j])}</span>
      <span>${round(hourly.temperature_2m[j])}</span>
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
    return `<div class="day">
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
