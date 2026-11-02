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

## Lot Builder

`lot-builder/` is a small browser game: build a parking lot for work order #4108 from bare grass to a striped, inspected lot. Open `lot-builder/index.html`. On Netlify it's served at `/lot-builder/`.

You drive seven machines around a top-down job site. Cut 4–6″ and haul the spoil, proof-roll the subgrade, spread and roll the stone base, pave, and roll the hot mat before it cools (steel drum above 200°F, rubber tires above 160°F). Then cure it overnight, stake the layout, stripe 29 stalls including the blue accessible ones, set the signs and call the inspector.

- `lot-builder/index.html`: page and side panel
- `lot-builder/style.css`: styling
- `lot-builder/game.js`: simulation, rendering and controls
