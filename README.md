# Tidecast

A coastal weather app for South Florida, powered by the free [Open-Meteo](https://open-meteo.com/) API (no API key needed). It opens to Hobe Sound, Florida, and you can search for any city.

- Current conditions, a 24-hour forecast and a 7-day forecast
- Beach & boating: wave height, water temperature, swell and a boating rating (hidden for inland cities)
- Sun & UV: sunrise, sunset, golden hour and the UV index with sunscreen tips
- Animated backgrounds that follow the weather and time of day, including a golden-hour sunset sky and ocean waves

## Files

- `index.html`: page structure
- `style.css`: styling and background animations
- `app.js`: fetches and renders the weather, ocean and sun data

## Run locally

Open `index.html` in a browser.

## Deploy to Netlify

There is no build step. Drag this folder into Netlify, or connect the repo with the build command left blank and the publish directory set to the repository root.

## Pothole Patrol (mini game)

`pothole-game/` holds a small browser game. Hold and drag to pour asphalt into the pothole, then drag the roller over the patch until it's smooth. The pothole gets bigger every level. Each level scores fill accuracy (how much asphalt landed in the hole rather than on the road) plus a speed bonus, and earns up to three stars. Your best score is saved in the browser. Open `pothole-game/index.html` in a browser to play (works with mouse or touch).
