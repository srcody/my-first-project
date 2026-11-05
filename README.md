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

1. **Excavate** with an excavator. Each bite goes straight to 5 in, and you dump the bucket into haul trucks.
2. **Grade base** with a skid steer and box blade. One pass spreads 3 in of stone, and you refill from the stone pile.
3. **Pave** with an asphalt paver. Lay the mat from the screed and reload at the asphalt truck.
4. **Roll** with a double-drum roller. One vibratory pass compacts each spot, and hot asphalt compacts best.
5. **Seal coat** with a sealer truck. Spray the lot and refill at the totes.

Every stage takes one pass per spot, and a step finishes on its own once 97% of the lot is done (shown as 100%). The game credits Asphalt Care Services, LLC, with links to asphaltcareservices.com for real paving work.

**Career mode:** you start a paving company with $7,000. Pick jobs from the job board. Bigger lots and jobs with more steps pay more:

| Job | Steps |
| --- | --- |
| Seal coat | Seal |
| Repave | Pave, roll |
| Repave & seal | Pave, roll, seal |
| Base & pave | Base, pave, roll |
| New lot | Dig, base, pave, roll |
| Full build | Dig, base, pave, roll, seal |

Each job needs the machine for every step. You can **buy** it, or **rent** a Mk I for the job. Rent comes out of the job's pay on the invoice. It costs about 14.4% of the machine's price, more for big lots and less for small ones, so you can take any job from day one. Bought machines can be upgraded to Mk II and Mk III, which drive faster, carry more and have wider tools. Upgrades trade in the old machine at half price. Pay drops by up to 30% for a sloppy job. Bigger and more complex jobs show up as you complete more work. Your career saves in the browser.

**Controls:** on a phone, the joystick drives (up forward, down reverse, sideways steers) and the yellow button runs the tool. **CAB / CHASE** switches between the first-person cab view and a 45° chase camera, and you can drag the view to look around. On a keyboard: WASD or arrow keys, Space for the tool, V for the view, Enter for the next stage, Esc to pause.

**Run it:** serve the repo folder (for example `python3 -m http.server`) and open `/game/`. It needs a local server because it uses ES modules. Three.js is bundled in `game/lib`, so it needs no internet.

## Global leaderboard

The office has a **Leaderboard** tab that ranks companies by total career profit. You set your company name there, and your total is posted after every job you finish. Starting a new career creates a new entry, and the old one stays on the board.

The leaderboard runs on Netlify:

- `netlify/functions/leaderboard.mjs` serves the scores at `/api/leaderboard`. It stores them in Netlify Blobs, which needs no setup.
- `netlify/lib/leaderboard-core.mjs` holds the validation and ranking logic.
- `package.json` adds the `@netlify/blobs` dependency, and Netlify installs it on deploy.

The leaderboard only works on the Netlify site. Anywhere else, the tab says it's offline and the rest of the game works normally. Scores are sent by the browser, so a determined player could fake one. The server rejects malformed and impossible values.
