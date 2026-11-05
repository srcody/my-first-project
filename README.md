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

---

# Blacktop Lot Builder (game)

A 3D job site simulator in `game/`. You take a parking lot from grass to sealed blacktop and drive every machine yourself:

1. **Excavate** with an excavator. Dig 5 in (grade control) and dump the bucket into haul trucks.
2. **Grade base** with a skid steer and box blade. Spread 3 in of stone and refill from the stone pile.
3. **Pave** with an asphalt paver. Lay the mat from the screed and reload at the asphalt truck.
4. **Roll** with a double-drum roller. Each spot needs 3 vibratory passes, and hot asphalt compacts best.
5. **Seal coat** with a sealer truck. Spray the lot and refill at the totes.

At the end a crew stripes the stalls, cars pull in, and you get a quality score and an invoice.

**Controls:** on a phone, the joystick drives (up forward, down reverse, sideways steers) and the yellow button runs the tool. **CAB / CHASE** switches between the first-person cab view and a 45° chase camera, and you can drag the view to look around. On a keyboard: WASD or arrow keys, Space for the tool, V for the view, Enter for the next stage, Esc to pause.

**Run it:** serve the repo folder (for example `python3 -m http.server`) and open `/game/`. It needs a local server because it uses ES modules. Three.js is bundled in `game/lib`, so it needs no internet.
