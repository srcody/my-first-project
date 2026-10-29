// Ocean conditions come from just offshore of Hobe Sound Beach, since the town itself is inland of the water
const DEFAULT_PLACE = { name: "Hobe Sound", latitude: 27.0595, longitude: -80.1364, marine: { latitude: 27.06, longitude: -80.09 } };

// ---------- Illustrated icons (64x64 SVG) ----------

const sun = '<circle cx="32" cy="32" r="11" fill="#ffc24b"/><path d="M32 9v6M32 49v6M9 32h6M49 32h6M15.7 15.7l4.2 4.2M44.1 44.1l4.2 4.2M15.7 48.3l4.2-4.2M44.1 19.9l4.2-4.2" stroke="#ffc24b" stroke-width="4" stroke-linecap="round"/>';
const moon = '<path d="M40 11a21 21 0 1 0 14 31A17 17 0 0 1 40 11Z" fill="#f4e7c3"/>';
const cloud = (fill = "#fff", y = 0) => `<path transform="translate(0 ${y})" d="M18 50a11 11 0 0 1-1-22 15 15 0 0 1 28-4 12 12 0 0 1 3 26Z" fill="${fill}"/>`;
const small = (shape) => `<g transform="translate(2 -2) scale(.62)">${shape}</g>`;
const drops = (n) => [22, 32, 42].slice(0, n).map((x) => `<path d="M${x} 48l-3 8" stroke="#4fc3f7" stroke-width="3.5" stroke-linecap="round"/>`).join("");

const ICONS = {
  sun,
  moon,
  partlyDay: small(sun) + cloud("#fff", 4),
  partlyNight: small(moon) + cloud("#e4ebf2", 4),
  cloud: cloud("#eef3f7", 0),
  fog: cloud("#e4ebf2", -6) + '<path d="M14 50h36M20 57h26" stroke="#e4ebf2" stroke-width="3.5" stroke-linecap="round"/>',
  drizzle: cloud("#eef3f7", -8) + drops(2),
  rain: cloud("#dfe7ee", -8) + drops(3),
  storm: cloud("#b8c4cf", -8) + '<path d="M34 40l-9 12h7l-4 10 13-15h-7l4-7Z" fill="#ffc24b"/>',
  snow: cloud("#eef3f7", -8) + [22, 32, 42].map((x, i) => `<circle cx="${x}" cy="${50 + (i % 2) * 6}" r="3" fill="#bfe9ff"/>`).join(""),
};

// WMO weather codes -> [description, day icon, night icon, scene]
const CODES = {
  0: ["Clear", "sun", "moon", "clear"],
  1: ["Mostly Clear", "partlyDay", "partlyNight", "clear"],
  2: ["Partly Cloudy", "partlyDay", "partlyNight", "cloudy"],
  3: ["Cloudy", "cloud", "cloud", "cloudy"],
  45: ["Fog", "fog", "fog", "cloudy"],
  48: ["Fog", "fog", "fog", "cloudy"],
  51: ["Light Drizzle", "drizzle", "drizzle", "rain"],
  53: ["Drizzle", "drizzle", "drizzle", "rain"],
  55: ["Heavy Drizzle", "rain", "rain", "rain"],
  56: ["Freezing Drizzle", "drizzle", "drizzle", "rain"],
  57: ["Freezing Drizzle", "rain", "rain", "rain"],
  61: ["Light Rain", "drizzle", "drizzle", "rain"],
  63: ["Rain", "rain", "rain", "rain"],
  65: ["Heavy Rain", "rain", "rain", "rain"],
  66: ["Freezing Rain", "rain", "rain", "rain"],
  67: ["Freezing Rain", "rain", "rain", "rain"],
  71: ["Light Snow", "snow", "snow", "snow"],
  73: ["Snow", "snow", "snow", "snow"],
  75: ["Heavy Snow", "snow", "snow", "snow"],
  77: ["Snow Grains", "snow", "snow", "snow"],
  80: ["Showers", "drizzle", "drizzle", "rain"],
  81: ["Showers", "rain", "rain", "rain"],
  82: ["Heavy Showers", "rain", "rain", "rain"],
  85: ["Snow Showers", "snow", "snow", "snow"],
  86: ["Snow Showers", "snow", "snow", "snow"],
  95: ["Thunderstorm", "storm", "storm", "storm"],
  96: ["Thunderstorm", "storm", "storm", "storm"],
  99: ["Thunderstorm", "storm", "storm", "storm"],
};

const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

const $ = (id) => document.getElementById(id);
const describe = (code) => CODES[code] || ["Unknown", "cloud", "cloud", "clear"];
const icon = (code, isDay) => `<svg class="wx" viewBox="0 0 64 64">${ICONS[describe(code)[isDay ? 1 : 2]]}</svg>`;
const round = (n) => `${Math.round(n)}°`;
const compass = (deg) => DIRECTIONS[Math.round(deg / 45) % 8];
const rand = (max) => Math.random() * max;
const particles = (count, style) => Array.from({ length: count }, () => `<i style="${style()}"></i>`).join("");

// Open-Meteo returns local times like "2026-10-29T14:00", so read the clock straight from the string
const minutes = (time) => Number(time.slice(11, 13)) * 60 + Number(time.slice(14, 16));
function clock(mins, short = false) {
  const h = Math.floor(mins / 60) % 24;
  const m = String(mins % 60).padStart(2, "0");
  const ampm = h < 12 ? "AM" : "PM";
  return short ? `${h % 12 || 12}<small>${ampm}</small>` : `${h % 12 || 12}:${m} ${ampm}`;
}

$("stars").innerHTML = particles(80, () =>
  `left:${rand(100)}%;top:${rand(65)}%;--size:${1 + rand(2)}px;animation-delay:-${rand(4)}s`);

function setScene(scene, isDay, golden) {
  document.body.className = `${scene} ${isDay ? "day" : "night"}${golden ? " golden" : ""}`;

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

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function loadWeather(place) {
  $("place").textContent = place.name;
  $("condition").textContent = "Loading…";

  const forecast = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation,is_day",
    hourly: "temperature_2m,weather_code,is_day,precipitation_probability,uv_index",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset,uv_index_max",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto",
    forecast_days: 7,
  });

  const sea = place.marine || place;
  const marine = new URLSearchParams({
    latitude: sea.latitude,
    longitude: sea.longitude,
    current: "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,sea_surface_temperature",
    timezone: "auto",
  });

  try {
    // Ocean data is a bonus: if it fails (or the place is inland) the rest still loads
    const [weather, ocean] = await Promise.all([
      getJSON(`https://api.open-meteo.com/v1/forecast?${forecast}`),
      getJSON(`https://marine-api.open-meteo.com/v1/marine?${marine}`).catch(() => null),
    ]);
    render(weather);
    renderMarine(ocean, weather.current);
  } catch (err) {
    $("condition").textContent = "Couldn't load weather. Try again later.";
    console.error(err);
  }
}

function render({ current, hourly, daily }) {
  const now = minutes(current.time);
  const rise = minutes(daily.sunrise[0]);
  const set = minutes(daily.sunset[0]);
  const [desc, , , scene] = describe(current.weather_code);
  const golden = current.is_day && scene !== "rain" && scene !== "storm" && (now - rise < 60 || set - now < 60);
  setScene(scene, current.is_day, golden);

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
  $("wind-dir").textContent = `From the ${compass(deg)} (${Math.round(deg)}°)`;
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
      <span class="time">${i === 0 ? "Now" : clock(minutes(t), true)}</span>
      ${icon(hourly.weather_code[j], hourly.is_day[j])}
      <span class="pop">${pop >= 20 ? `${pop}%` : ""}</span>
      <span class="deg">${round(hourly.temperature_2m[j])}</span>
    </div>`;
  }).join("");

  renderSun(now, rise, set, hourly.uv_index[start], daily.uv_index_max[0]);

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
      ${icon(daily.weather_code[i], true)}
      <div class="range">
        <span class="lo">${round(lo)}</span>
        <div class="bar"><span style="left:${pct(lo)}%;right:${100 - pct(hi)}%"></span></div>
        <span>${round(hi)}</span>
      </div>
    </div>`;
  }).join("");
}

function renderSun(now, rise, set, uv, uvMax) {
  $("sunrise").textContent = clock(rise);
  $("sunset").textContent = clock(set);
  $("golden").textContent = clock(set - 60);

  // Place the sun along the arc between sunrise (left) and sunset (right)
  const up = now > rise && now < set;
  const f = Math.min(Math.max((now - rise) / (set - rise), 0), 1);
  const angle = Math.PI * (1 - f);
  $("sun-dot").setAttribute("cx", 150 + 130 * Math.cos(angle));
  $("sun-dot").setAttribute("cy", 104 - 86 * Math.sin(angle));
  $("sun-dot").style.opacity = up ? 1 : 0;
  $("arc-done").style.strokeDasharray = `${f * 100} 100`;
  $("arc-done").style.opacity = up ? 1 : 0;

  // UV index with sun-safety tips
  uv = up ? Math.round(uv ?? 0) : 0;
  const [level, tip] =
    uv >= 11 ? ["Extreme", "Avoid the sun 10 AM–4 PM. Sunscreen, hat and shade are a must; reapply every 2 hours."] :
    uv >= 8 ? ["Very high", "Seek shade midday and reapply sunscreen every 2 hours, or right after swimming."] :
    uv >= 6 ? ["High", "Wear SPF 30+, a hat and sunglasses. Reapply every 2 hours."] :
    uv >= 3 ? ["Moderate", "Wear sunscreen if you're out for a while. Reapply every 2 hours."] :
    ["Low", up ? "No protection needed right now." : `The sun is down. Today's peak UV was ${Math.round(uvMax)}.`];
  $("uv").textContent = uv;
  $("uv-level").textContent = level;
  $("uv-marker").style.left = `${Math.min(uv / 11, 1) * 100}%`;
  $("uv-tip").textContent = tip;
}

function renderMarine(ocean, weather) {
  const c = ocean?.current;
  // Inland places have no ocean data
  if (!c || c.wave_height == null) return ($("marine").hidden = true);
  $("marine").hidden = false;

  const units = ocean.current_units || {};
  const ft = (v, unit) => (unit === "m" ? v * 3.281 : v);
  const waves = ft(c.wave_height, units.wave_height);
  const swell = ft(c.swell_wave_height ?? 0, units.swell_wave_height);
  const water = units.sea_surface_temperature?.includes("C") ? c.sea_surface_temperature * 9 / 5 + 32 : c.sea_surface_temperature;

  $("waves").innerHTML = `${waves.toFixed(1)}<small>ft</small>`;
  $("wave-info").textContent = `${Math.round(c.wave_period)}s from ${compass(c.wave_direction)}`;
  $("water").textContent = water == null ? "--" : round(water);
  $("swell").innerHTML = `${swell.toFixed(1)}<small>ft</small>`;
  $("swell-info").textContent = c.swell_wave_period ? `${Math.round(c.swell_wave_period)}s period` : "";

  // Rough guide for small boats, based on wave height and wind speed
  const wind = weather.wind_speed_10m;
  const [cls, text] =
    waves < 2 && wind < 12 ? ["calm", "<span><b>Calm</b> · Good for boating, paddling and swimming</span>"] :
    waves < 4 && wind < 18 ? ["moderate", "<span><b>Choppy</b> · OK for bigger boats, use caution on small craft</span>"] :
    ["rough", "<span><b>Rough</b> · Small craft should stay in; watch for rip currents</span>"];
  $("boating").className = `boating ${cls}`;
  $("boating").innerHTML = text;
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
    const { results = [] } = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5`);
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
