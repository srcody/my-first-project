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

`pothole-game/` holds a small browser game. Hold and drag to pour asphalt into the potholes, then drag the roller over the patches until they're smooth. Open `pothole-game/index.html` in a browser to play (works with mouse or touch).

- Potholes get bigger every level; from level 3 there are two, and from level 6 three.
- Fill accuracy: asphalt spilled on the road lowers your score and empties the truck. Run out before the holes are full and you redo the level.
- Asphalt cools after it's poured. Hot asphalt flattens faster and earns a bonus.
- Traffic cones appear from level 2; each one the roller knocks over costs points.
- Sound effects are generated in the browser (mute button next to the title). Your best score is saved in the browser.
