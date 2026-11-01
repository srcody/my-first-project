// Pothole Patrol: fill the potholes with asphalt, then roll them flat.
(() => {
  const CELL = 6;             // size of one simulation cell in world pixels
  const FILL_TARGET = 0.97;   // share of cells that must be full before rolling
  const ROLL_TARGET = 0.95;   // share of cells that must be compacted to finish
  const ROLLED = 0.9;         // compaction at which a cell counts as rolled
  const POUR_RATE = 3.2;      // fill added per second at the centre of the nozzle
  const ROLLER_MAX = 380;     // top roller speed in px/s
  const DEAD_ZONE = 14;       // roller stops when the pointer is this close
  const CONE_R = 9;           // traffic cone radius
  const CUT_TOL = 10;         // how close to the dashed line the saw must be to cut it
  const CUT_TARGET = 0.97;    // share of the outline that must be cut
  const BEST_KEY = 'pothole-patrol-best';
  const MUTE_KEY = 'pothole-patrol-muted';
  const TRUCK_LANE = 112;     // top strip of road where the asphalt truck drives

  const COMPANY = {
    name: 'Asphalt Care Services LLC',
    phone: '772.775.6964',
    tel: 'tel:+17727756964',
    site: 'asphaltcareservices.com',
    estimateUrl: 'https://www.asphaltcareservices.com/contact/?utm_source=pothole-patrol&utm_medium=game&utm_campaign=free-estimate',
  };
  // global leaderboard (Supabase). The publishable key is meant to be public: the database
  // only lets it call save_score and top_scores, which validate everything.
  const LEADERBOARD = {
    url: 'https://gniefjorxzozefrycpvr.supabase.co/rest/v1/rpc/',
    key: 'sb_publishable_HeJxsaXEZOqM5lJCtwrMMw_xyngX7wc',
  };
  const NAME_KEY = 'pothole-patrol-name';
  const LIVES = 3;

  // where shared scores point; swap in the App Store / Google Play links once the app is listed
  const GAME_URL = location.protocol.startsWith('http') ? location.origin + location.pathname : 'https://www.asphaltcareservices.com/';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = {
    level: $('level'), time: $('time'), acc: $('acc'), score: $('score'), best: $('best'),
    saw: $('tool-saw'), shovel: $('tool-shovel'), roller: $('tool-roller'),
    bar: $('bar'), barLabel: $('bar-label'), meterIcon: $('meter-icon'), meterBar: $('meter-bar'),
    hint: $('hint'), mute: $('mute'), logo: $('logo'), wordmark: $('wordmark'),
    overlay: $('overlay'), ovTitle: $('ov-title'), ovText: $('ov-text'),
    ovStats: $('ov-stats'), ovBtn: $('ov-btn'), shareBtn: $('share-btn'), toast: $('toast'),
    lives: $('lives'), boardBtn: $('board-btn'), submitForm: $('submit-form'), playerName: $('player-name'),
    submitBtn: $('submit-score'), submitMsg: $('submit-msg'), board: $('board'),
    nameField: $('name-field'), startName: $('start-name'), nameMsg: $('name-msg'),
    boardOpen: $('board-open'), boardPanel: $('board-panel'), panelBoard: $('panel-board'), boardClose: $('board-close'),
  };

  function loadImage(src, onload) {
    const img = new Image();
    if (onload) img.onload = onload;
    img.src = src;
    return img;
  }
  const isReady = (img) => img.complete && img.naturalWidth > 0;
  const logoImg = loadImage('assets/logo.png', () => {
    ui.logo.src = logoImg.src;
    ui.logo.hidden = false;
    ui.wordmark.hidden = true;
  });
  const markImg = loadImage('assets/logo-mark.png');

  let world = { w: 800, h: 600 };     // logical size, fixed for the duration of a level
  let view = { scale: 1, ox: 0, oy: 0 };
  let background = null;              // offscreen canvas with the road texture
  let spill = null;                   // offscreen canvas with asphalt spilled on the road
  let holes = [];
  let cells = [];                     // cells inside all potholes
  let cones = [];
  let level = 1, score = 0, best = load(BEST_KEY, 0), elapsed = 0;
  let poured = 0, used = 0, consumed = 0, supply = 1, frameWaste = 0;
  let heatSum = 0, heatCount = 0, conesHit = 0, coolTime = 30, brush = 20;
  let sawPrev = null, sawTravel = 0, sawOnLine = 0, sawCutting = false, sawSpin = 0;
  let phase = 'intro';                // intro | cut | fill | roll | done | failed | gameover
  let pointer = { x: 0, y: 0, down: false, mouse: false };
  let roller = null;
  let truck = null;
  let lastResult = null;              // last finished level, for the share card
  let lives = LIVES;
  let runId = newRunId();             // one leaderboard entry per run, updated as it goes
  let runSaved = false;
  let savedScore = 0, savedRank = 0;  // this run's entry as last saved
  let paused = false;                 // while the leaderboard panel is open
  let particles = [];
  let lastTime = performance.now();

  function rand(a, b) { return a + Math.random() * (b - a); }

  function newRunId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3) | 8).toString(16);
    });
  }

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }

  // ---------- sound (synthesised with Web Audio, no files) ----------

  const sound = (() => {
    let ac = null, master, pourGain, engineGain, engineOsc, sawGain, sawOsc;
    let muted = load(MUTE_KEY, false);

    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.6;
      master.connect(ac.destination);

      // pouring: looped noise through a low-pass filter sounds like gravel sliding
      const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const noise = ac.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      pourGain = ac.createGain();
      pourGain.gain.value = 0;
      noise.connect(lp).connect(pourGain).connect(master);
      noise.start();

      // roller engine: low sawtooth with a rattling tremolo
      engineOsc = ac.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 40;
      const elp = ac.createBiquadFilter();
      elp.type = 'lowpass';
      elp.frequency.value = 280;
      const trem = ac.createGain();
      trem.gain.value = 0.7;
      const lfo = ac.createOscillator();
      lfo.frequency.value = 13;
      const lfoDepth = ac.createGain();
      lfoDepth.gain.value = 0.3;
      lfo.connect(lfoDepth).connect(trem.gain);
      engineGain = ac.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(elp).connect(trem).connect(engineGain).connect(master);
      engineOsc.start();
      lfo.start();

      // concrete saw: a buzzing sawtooth that drops in pitch while it bites
      sawOsc = ac.createOscillator();
      sawOsc.type = 'sawtooth';
      sawOsc.frequency.value = 190;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 0.8;
      sawGain = ac.createGain();
      sawGain.gain.value = 0;
      sawOsc.connect(bp).connect(sawGain).connect(master);
      sawOsc.start();
    }

    function tone(type, from, to, dur, vol, delay = 0) {
      if (!ac) return;
      const t = ac.currentTime + delay;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur);
    }

    return {
      init,
      get muted() { return muted; },
      toggle() {
        muted = !muted;
        save(MUTE_KEY, muted);
        if (ac) master.gain.setTargetAtTime(muted ? 0 : 0.6, ac.currentTime, 0.02);
      },
      pour(on) { if (ac) pourGain.gain.setTargetAtTime(on ? 0.35 : 0, ac.currentTime, 0.05); },
      saw(on, cutting) {
        if (!ac) return;
        sawGain.gain.setTargetAtTime(on ? 0.22 : 0, ac.currentTime, 0.04);
        sawOsc.frequency.setTargetAtTime(cutting ? 140 : 190, ac.currentTime, 0.08);
      },
      engine(on, speed) {
        if (!ac) return;
        const s = Math.min(1, Math.abs(speed) / ROLLER_MAX);
        engineGain.gain.setTargetAtTime(on ? 0.12 + s * 0.2 : 0, ac.currentTime, 0.1);
        engineOsc.frequency.setTargetAtTime(38 + s * 30, ac.currentTime, 0.1);
      },
      ding() { tone('sine', 880, 880, 0.35, 0.3); tone('sine', 1320, 1320, 0.6, 0.3, 0.15); },
      thunk() { tone('triangle', 240, 70, 0.25, 0.5); },
      fail() { tone('sawtooth', 220, 90, 0.7, 0.25); },
    };
  })();

  function updateMuteButton() {
    ui.mute.textContent = sound.muted ? '🔇' : '🔊';
    ui.mute.setAttribute('aria-label', sound.muted ? 'Unmute sound' : 'Mute sound');
  }

  // ---------- setup ----------

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    view.scale = Math.min(rect.width / world.w, rect.height / world.h);
    view.ox = (rect.width - world.w * view.scale) / 2;
    view.oy = (rect.height - world.h * view.scale) / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeBackground() {
    const c = document.createElement('canvas');
    c.width = world.w;
    c.height = world.h;
    const g = c.getContext('2d');
    g.fillStyle = '#4b4d50';
    g.fillRect(0, 0, world.w, world.h);
    // worn asphalt speckle
    for (let i = 0; i < world.w * world.h / 18; i++) {
      const v = Math.floor(rand(50, 110));
      g.fillStyle = `rgba(${v},${v},${v + 3},0.5)`;
      g.fillRect(rand(0, world.w), rand(0, world.h), rand(1, 3), rand(1, 3));
    }
    // truck lane along the top, lane markings along the bottom
    g.fillStyle = '#e8c547';
    for (let x = 20; x < world.w; x += 90) {
      g.fillRect(x, TRUCK_LANE - 6, 50, 6);
      g.fillRect(x, world.h - 25, 50, 7);
    }
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillRect(0, 4, world.w, 4);
    return c;
  }

  // radius multiplier of a hole's blob outline at angle a
  function edge(hole, a) {
    let m = 1;
    for (const w of hole.waves) m += w.a * Math.sin(w.k * a + w.p);
    return m;
  }

  function rimPoint(hole, a, extra = 0) {
    const m = edge(hole, a);
    return [hole.cx + Math.cos(a) * (hole.rx * m + extra), hole.cy + Math.sin(a) * (hole.ry * m + extra)];
  }

  // Levels 1-2 have one pothole, 3-5 two, 6+ three. The main one keeps growing.
  function holeSizes() {
    const count = level < 3 ? 1 : level < 6 ? 2 : 3;
    const maxR = Math.min(world.w, world.h) * (count === 1 ? 0.4 : 0.3);
    const main = Math.min(38 + (level - 1) * 20, maxR);
    const sizes = [main];
    for (let i = 1; i < count; i++) sizes.push(main * rand(0.5, 0.7));
    return sizes;
  }

  function placeHoles() {
    const stretch = Math.min(1.45, world.w / world.h);  // use wide screens
    const top = TRUCK_LANE + 15, bottom = world.h - 45; // keep clear of the truck lane and markings
    const sizes = holeSizes();
    for (let shrink = 1; shrink > 0.3; shrink *= 0.9) {
      const placed = [];
      for (const size of sizes) {
        const ry = size * shrink, rx = ry * stretch, reach = rx * 1.3;
        for (let tries = 0; tries < 200; tries++) {
          const cx = sizes.length === 1 ? world.w / 2 : rand(reach + 20, world.w - reach - 20);
          const cy = rand(top + ry * 1.3, bottom - ry * 1.3);
          if (cx - reach < 0 || cx + reach > world.w || cy - ry * 1.3 < top || cy + ry * 1.3 > bottom) continue;
          if (placed.some((p) => Math.abs(p.cx - cx) < p.reach + reach + 40 && Math.abs(p.cy - cy) < (p.ry + ry) * 1.3 + 40)) continue;
          placed.push({ cx, cy, rx, ry, reach });
          break;
        }
      }
      if (placed.length === sizes.length || shrink < 0.35) return placed;
    }
    return [];
  }

  function makeHole({ cx, cy, rx, ry }) {
    const waves = [];
    for (let k = 2; k <= 6; k++) waves.push({ k, a: rand(0.03, 0.1) / (k * 0.5), p: rand(0, Math.PI * 2) });
    const hole = { cx, cy, rx, ry, waves, cracks: [] };

    hole.path = new Path2D();
    for (let i = 0; i <= 120; i++) {
      const [x, y] = rimPoint(hole, i / 120 * Math.PI * 2);
      if (i === 0) hole.path.moveTo(x, y); else hole.path.lineTo(x, y);
    }
    hole.path.closePath();

    // cracks radiating from the rim
    for (let i = 0; i < 4 + Math.min(level, 6); i++) {
      const a = rand(0, Math.PI * 2);
      let [x, y] = rimPoint(hole, a);
      const pts = [[x, y]];
      let dir = a;
      for (let s = 0; s < 6; s++) {
        dir += rand(-0.6, 0.6);
        x += Math.cos(dir) * rand(8, 18);
        y += Math.sin(dir) * rand(8, 18);
        pts.push([x, y]);
      }
      hole.cracks.push(pts);
    }

    // the saw-cut outline: the hole's bounding box, squared off to the cell grid
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < 120; i++) {
      const [x, y] = rimPoint(hole, i / 120 * Math.PI * 2);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    hole.rect = {
      x0: Math.floor(Math.max(CELL, minX - 10) / CELL) * CELL,
      y0: Math.floor(Math.max(TRUCK_LANE + 6, minY - 10) / CELL) * CELL,
      x1: Math.ceil(Math.min(world.w - CELL, maxX + 10) / CELL) * CELL,
      y1: Math.ceil(Math.min(world.h - 32, maxY + 10) / CELL) * CELL,
    };
    const { x0, y0, x1, y1 } = hole.rect;
    hole.guide = [];
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = corners[k], [bx, by] = corners[(k + 1) % 4];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 6));
      for (let i = 0; i < n; i++) hole.guide.push({ x: ax + (bx - ax) * i / n, y: ay + (by - ay) * i / n, cut: false });
    }

    buildGrid(hole, cx - rx * 1.4, cy - ry * 1.4, cx + rx * 1.4, cy + ry * 1.4, (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      const lim = edge(hole, Math.atan2(dy, dx));
      const d = Math.hypot(dx, dy);
      if (d >= lim) return null;
      return { depth: d / lim, dy: dy / lim, n: Math.random(), shallow: false };
    });
    return hole;
  }

  // Build the hole's cells over a pixel box. cellFor(x, y) gives a cell's shading or null.
  function buildGrid(hole, bx0, by0, bx1, by1, cellFor) {
    // one pixel per cell in hole.img
    const gx0 = Math.max(0, Math.floor(bx0 / CELL));
    const gy0 = Math.max(0, Math.floor(by0 / CELL));
    const gx1 = Math.min(Math.ceil(world.w / CELL), Math.ceil(bx1 / CELL));
    const gy1 = Math.min(Math.ceil(world.h / CELL), Math.ceil(by1 / CELL));
    const gw = gx1 - gx0, gh = gy1 - gy0;
    const grid = new Array(gw * gh).fill(null);
    hole.cells = [];
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const x = (gx0 + i + 0.5) * CELL, y = (gy0 + j + 0.5) * CELL;
        const shading = cellFor(x, y);
        if (!shading) continue;
        // depth: 0 centre, 1 rim; dy: for rim shadow; n: per-cell noise; shallow: sawn-out edge
        const cell = { idx: j * gw + i, cx: x, cy: y, fill: 0, comp: 0, heat: 0, ...shading };
        grid[cell.idx] = cell;
        hole.cells.push(cell);
      }
    }
    // pixels just outside the rim copy a neighbouring cell so the smoothed image has no dark fringe
    const pads = [];
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        if (grid[j * gw + i]) continue;
        let near = null;
        for (let r = 1; r <= 2 && !near; r++) {
          for (let oy = -r; oy <= r && !near; oy++) {
            for (let ox = -r; ox <= r && !near; ox++) {
              const ni = i + ox, nj = j + oy;
              if (ni >= 0 && nj >= 0 && ni < gw && nj < gh) near = grid[nj * gw + ni];
            }
          }
        }
        if (near) pads.push([j * gw + i, near]);
      }
    }
    const img = document.createElement('canvas');
    img.width = gw;
    img.height = gh;
    Object.assign(hole, { gx0, gy0, gw, gh, grid, pads, img, imgCtx: img.getContext('2d') });
    hole.data = hole.imgCtx.createImageData(gw, gh);
  }

  // Once the outline is cut, the broken asphalt comes out and the hole becomes the rectangle.
  function squareOff(hole) {
    const { x0, y0, x1, y1 } = hole.rect;
    const old = { gx0: hole.gx0, gy0: hole.gy0, gw: hole.gw, gh: hole.gh, grid: hole.grid };
    const hw = (x1 - x0) / 2, hh = (y1 - y0) / 2;
    buildGrid(hole, x0, y0, x1, y1, (x, y) => {
      const i = Math.floor(x / CELL) - old.gx0, j = Math.floor(y / CELL) - old.gy0;
      const was = i >= 0 && j >= 0 && i < old.gw && j < old.gh && old.grid[j * old.gw + i];
      if (was) return { depth: was.depth, dy: was.dy, n: was.n, shallow: false };
      const dx = (x - x0 - hw) / hw, dy = (y - y0 - hh) / hh;
      return { depth: Math.max(Math.abs(dx), Math.abs(dy)), dy, n: Math.random(), shallow: true };
    });
    hole.path = new Path2D();
    hole.path.rect(x0, y0, x1 - x0, y1 - y0);
    hole.squared = true;
    for (let i = 0; i < 14; i++) {
      const g = hole.guide[Math.floor(Math.random() * hole.guide.length)];
      particles.push({ kind: 'steam', x: g.x, y: g.y, vx: rand(-15, 15), vy: rand(-30, -10), r: rand(4, 9), life: 1 });
    }
  }

  function cellAt(x, y) {
    for (const h of holes) {
      const i = Math.floor(x / CELL) - h.gx0, j = Math.floor(y / CELL) - h.gy0;
      if (i >= 0 && j >= 0 && i < h.gw && j < h.gh && h.grid[j * h.gw + i]) return h.grid[j * h.gw + i];
    }
    return null;
  }

  // Cones from level 2: placed near the holes, with room for the roller to steer between them.
  function placeCones(start) {
    cones = [];
    const count = level < 2 ? 0 : Math.min(10, level + 1);
    for (let tries = 0; cones.length < count && tries < 1500; tries++) {
      const h = holes[Math.floor(Math.random() * holes.length)];
      const [x, y] = rimPoint(h, rand(0, Math.PI * 2), rand(80, 130));
      if (x < 20 || y < TRUCK_LANE + 25 || x > world.w - 20 || y > world.h - 45) continue;
      if (holes.some((o) => {
        const dx = (x - o.cx) / o.rx, dy = (y - o.cy) / o.ry;
        return Math.hypot(dx, dy) < edge(o, Math.atan2(dy, dx)) + 70 / o.ry;
      })) continue;
      if (holes.some(({ rect: r }) => x > r.x0 - 45 && x < r.x1 + 45 && y > r.y0 - 45 && y < r.y1 + 45)) continue;
      if (cones.some((c) => Math.hypot(c.x - x, c.y - y) < 110)) continue;
      if (Math.hypot(start.x - x, start.y - y) < 140) continue;
      cones.push({ x, y, knocked: false, vx: 0, vy: 0, rot: 0, vr: 0 });
    }
  }

  function setupWorld() {
    world = { w: canvas.clientWidth || 800, h: canvas.clientHeight || 600 };
    resize();
    background = makeBackground();
    spill = document.createElement('canvas');
    spill.width = world.w;
    spill.height = world.h;
    holes = placeHoles().map(makeHole);
    cells = holes.flatMap((h) => h.cells);
    brush = Math.min(34, 18 + level * 2);
    setSupply();
    coolTime = 25 + level * 6;
    const home = Math.max(90, Math.min(world.w - 90, world.w * 0.35));
    truck = { x: home, y: TRUCK_LANE / 2 + 2, home, wheel: 0 };
  }

  // the truck carries a bit more than the holes need; the margin shrinks with level
  function setSupply() {
    supply = cells.length * Math.max(1.5, 1.9 - level * 0.04) * 1.1 * (level === 1 ? 1.15 : 1);  // extra for the first level
  }

  function startLevel() {
    setupWorld();
    elapsed = 0;
    poured = 0;
    used = 0;
    consumed = 0;
    heatSum = 0;
    heatCount = 0;
    conesHit = 0;
    sawPrev = null;
    sawTravel = 0;
    sawOnLine = 0;
    particles = [];
    truck.x = -110;  // the truck drives in at the start of each level
    // park the roller left of the leftmost hole, or on the left edge
    const first = holes.reduce((a, b) => (a.cx - a.rx < b.cx - b.rx ? a : b));
    roller = { x: Math.max(55, first.cx - first.rx * 1.3 - 70), y: first.cy, angle: 0, speed: 0, phase: 0 };
    placeCones(roller);
    setPhase('cut');
    ui.level.textContent = level;
    updateLives();
    ui.overlay.classList.add('hidden');
  }

  function setPhase(p) {
    phase = p;
    ui.saw.classList.toggle('active', p === 'cut');
    ui.saw.classList.toggle('done', p === 'fill' || p === 'roll' || p === 'done');
    ui.shovel.classList.toggle('active', p === 'fill');
    ui.shovel.classList.toggle('done', p === 'roll' || p === 'done');
    ui.roller.classList.toggle('active', p === 'roll');
    ui.roller.classList.toggle('done', p === 'done');
    ui.hint.style.opacity = p === 'cut' || p === 'fill' || p === 'roll' ? 1 : 0;
    if (p === 'cut') {
      ui.hint.textContent = holes.length > 1
        ? `Saw along the dashed lines around all ${holes.length} potholes`
        : 'Saw along the dashed lines to square off the pothole';
    }
    ui.meterIcon.textContent = p === 'roll' || p === 'done' ? '🌡️' : '🚚';
    ui.meterIcon.parentElement.title = p === 'roll' || p === 'done' ? 'Asphalt temperature' : 'Asphalt left in the truck';
    if (p === 'fill') {
      ui.hint.textContent = holes.length > 1
        ? `Fill all ${holes.length} potholes. Glowing spots need asphalt`
        : 'Pour into the glowing spots. Spills cost accuracy and truck load';
    }
    if (p === 'roll') ui.hint.textContent = 'Roll it flat while it is hot, and mind the cones';
  }

  // ---------- input ----------

  function toWorld(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - view.ox) / view.scale,
      y: (e.clientY - rect.top - view.oy) / view.scale,
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    sound.init();
    canvas.setPointerCapture(e.pointerId);
    Object.assign(pointer, toWorld(e), { down: true, mouse: e.pointerType === 'mouse' });
  });
  canvas.addEventListener('pointermove', (e) => Object.assign(pointer, toWorld(e), { mouse: e.pointerType === 'mouse' }));
  const release = () => { pointer.down = false; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  const cleanName = (v) => v.trim().replace(/\s+/g, ' ');
  const validName = (n) => /^[A-Za-z0-9 ]{2,12}$/.test(n);

  ui.ovBtn.addEventListener('click', () => {
    sound.init();
    if (phase === 'intro') {
      // the optional leaderboard name from the start screen
      const name = cleanName(ui.startName.value);
      if (name && !validName(name)) {
        ui.nameMsg.textContent = 'Use 2–12 letters, numbers or spaces, or leave it blank';
        ui.nameMsg.classList.add('error');
        ui.startName.focus();
        return;
      }
      save(NAME_KEY, name);
    }
    if (phase === 'done') level++;
    if (phase === 'intro' || phase === 'gameover') {
      runId = newRunId();
      runSaved = false;
      savedScore = 0;
      savedRank = 0;
    }
    if (phase === 'gameover') {
      level = 1;
      score = 0;
      lives = LIVES;
      ui.score.textContent = score;
    }
    startLevel();
  });

  ui.boardBtn.addEventListener('click', () => showBoard());

  // the 🏆 button pauses the game and shows the leaderboard over it
  function openBoardPanel() {
    sound.init();
    pointer.down = false;
    paused = true;
    ui.boardPanel.classList.remove('hidden');
    const name = cleanName(load(NAME_KEY, ''));
    showBoard(runSaved ? { name, score: savedScore } : null, ui.panelBoard);
    ui.boardClose.focus();
  }
  function closeBoardPanel() {
    ui.boardPanel.classList.add('hidden');
    paused = false;
    lastTime = performance.now();  // don't count the time spent looking
  }
  ui.boardOpen.addEventListener('click', openBoardPanel);
  ui.boardClose.addEventListener('click', closeBoardPanel);
  ui.boardPanel.addEventListener('click', (e) => { if (e.target === ui.boardPanel) closeBoardPanel(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ui.boardPanel.classList.contains('hidden')) closeBoardPanel();
  });
  ui.submitForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitScore();
  });

  ui.shareBtn.addEventListener('click', shareScore);

  ui.mute.addEventListener('click', () => {
    sound.init();
    sound.toggle();
    updateMuteButton();
  });

  window.addEventListener('resize', resize);

  // ---------- simulation ----------

  function share(key, min = 1) {
    let n = 0;
    for (const c of cells) if (c[key] >= min) n++;
    return cells.length ? n / cells.length : 0;
  }

  function accuracy() { return poured > 0 ? used / poured : 1; }
  function truckLeft() { return Math.max(0, 1 - consumed / supply); }

  // average temperature of the asphalt that still needs rolling
  function patchHeat() {
    let sum = 0, n = 0;
    for (const c of cells) if (c.comp < 1) { sum += c.heat; n++; }
    return n ? sum / n : 0;
  }

  // distance from a point to the nearest dashed outline
  function lineDist(x, y) {
    let best = Infinity;
    for (const { rect: r } of holes) {
      const ox = Math.max(r.x0 - x, 0, x - r.x1), oy = Math.max(r.y0 - y, 0, y - r.y1);
      const d = ox || oy ? Math.hypot(ox, oy) : Math.min(x - r.x0, r.x1 - x, y - r.y0, r.y1 - y);
      best = Math.min(best, d);
    }
    return best;
  }

  function cutShare() {
    let n = 0, cut = 0;
    for (const h of holes) for (const g of h.guide) { n++; if (g.cut) cut++; }
    return n ? cut / n : 1;
  }

  function precision() { return sawTravel > 0 ? sawOnLine / sawTravel : 1; }

  function updateCut(dt) {
    sawCutting = false;
    if (!pointer.down) { sawPrev = null; return; }
    sawSpin += dt * 40;
    const cur = { x: pointer.x, y: pointer.y };
    if (!sawPrev) { sawPrev = cur; return; }
    // walk the saw from its last spot in short steps so fast drags still cut
    const len = Math.hypot(cur.x - sawPrev.x, cur.y - sawPrev.y);
    const steps = Math.ceil(len / 4);
    const sg = spill.getContext('2d');
    for (let k = 1; k <= steps; k++) {
      const px = sawPrev.x + (cur.x - sawPrev.x) * (k - 1) / steps, py = sawPrev.y + (cur.y - sawPrev.y) * (k - 1) / steps;
      const qx = sawPrev.x + (cur.x - sawPrev.x) * k / steps, qy = sawPrev.y + (cur.y - sawPrev.y) * k / steps;
      const l = len / steps;
      sawTravel += l;
      if (lineDist(qx, qy) < CUT_TOL) {
        sawOnLine += l;
        sawCutting = true;
        for (const h of holes) {
          for (const g of h.guide) if (!g.cut && Math.abs(g.x - qx) < CUT_TOL && Math.abs(g.y - qy) < CUT_TOL) g.cut = true;
        }
      } else {
        // sawing off the line scars the road
        sg.strokeStyle = 'rgba(20,20,22,0.8)';
        sg.lineWidth = 2;
        sg.beginPath();
        sg.moveTo(px, py);
        sg.lineTo(qx, qy);
        sg.stroke();
      }
    }
    if (len > 0 && Math.random() < 0.6) {
      particles.push({ kind: 'steam', x: cur.x + rand(-6, 6), y: cur.y + rand(-6, 6), vx: rand(-30, 30), vy: rand(-30, 10), r: rand(2, 4), life: 0.7 });
    }
    sawPrev = cur;
    if (cutShare() >= CUT_TARGET) {
      for (const h of holes) {
        for (const g of h.guide) g.cut = true;
        squareOff(h);
      }
      cells = holes.flatMap((h) => h.cells);
      setSupply();
      pointer.down = false;  // make the player press again to pour
      sound.thunk();
      setPhase('fill');
    }
  }

  function updateFill(dt) {
    frameWaste = 0;
    if (!pointer.down) return;
    // Pour onto every cell-sized spot under the nozzle. Asphalt that lands inside
    // a hole counts towards accuracy; the rest spills onto the road. The truck
    // loses what fills the hole plus what spills (pouring onto a full spot is free).
    const r = brush, r2 = r * r;
    const sg = spill.getContext('2d');
    let framePoured = 0, frameUsed = 0, frameConsumed = 0;
    for (let gy = Math.floor((pointer.y - r) / CELL); gy <= Math.floor((pointer.y + r) / CELL); gy++) {
      for (let gx = Math.floor((pointer.x - r) / CELL); gx <= Math.floor((pointer.x + r) / CELL); gx++) {
        const x = (gx + 0.5) * CELL, y = (gy + 0.5) * CELL;
        const d2 = (x - pointer.x) ** 2 + (y - pointer.y) ** 2;
        if (d2 >= r2) continue;
        const a = dt * POUR_RATE * (1 - d2 / r2 * 0.6);
        framePoured += a;
        const c = cellAt(x, y);
        if (c) {
          frameConsumed += Math.min(a, 1 - c.fill);
          c.fill = Math.min(1, c.fill + a);
          c.heat = 1;  // fresh asphalt comes out of the truck hot
          frameUsed += a;
          continue;
        }
        frameConsumed += a;
        if (Math.random() < a * 4) {
          const v = Math.floor(rand(55, 95));
          sg.fillStyle = `rgb(${v},${v - 2},${v - 4})`;
          sg.fillRect(x + rand(-4, 4), y + rand(-4, 4), rand(2, 5), rand(2, 5));
        }
      }
    }
    poured += framePoured;
    used += frameUsed;
    consumed += frameConsumed;
    frameWaste = framePoured > 0 ? 1 - frameUsed / framePoured : 0;

    for (let i = 0; i < 3; i++) {
      particles.push({
        kind: 'chunk',
        x: pointer.x + rand(-r, r) * 0.7,
        y: pointer.y - rand(30, 60),
        vy: rand(150, 260),
        ty: pointer.y + rand(-r, r) * 0.6,
        s: rand(2, 4.5),
        v: Math.floor(rand(40, 90)),
      });
    }
    if (share('fill') >= FILL_TARGET) {
      for (const c of cells) if (c.fill < 1) { c.fill = 1; c.heat = 1; }
      pointer.down = false;  // make the player press again to drive
      setPhase('roll');
    } else if (consumed >= supply) {
      failLevel();
    }
  }

  function normAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function updateRoll(dt) {
    // Steer towards the pointer, easing the speed up and down instead of snapping,
    // and slow down while turning so the roller sweeps in smooth arcs.
    let targetSpeed = 0;
    if (pointer.down && phase === 'roll') {
      const dx = pointer.x - roller.x, dy = pointer.y - roller.y;
      const dist = Math.hypot(dx, dy);
      if (dist > DEAD_ZONE) {
        let diff = normAngle(Math.atan2(dy, dx) - roller.angle);
        // drive in reverse rather than turning around; keep the current gear near 90°
        const reverse = roller.speed < -5 ? Math.abs(diff) > Math.PI * 0.4 : Math.abs(diff) > Math.PI * 0.6;
        if (reverse) diff = normAngle(diff + Math.PI);
        roller.angle = normAngle(roller.angle + diff * (1 - Math.exp(-dt * 5)));
        const arrive = Math.min(1, (dist - DEAD_ZONE) / 80);
        targetSpeed = ROLLER_MAX * arrive * Math.max(0.25, Math.cos(diff)) * (reverse ? -1 : 1);
      }
    }
    roller.speed += (targetSpeed - roller.speed) * (1 - Math.exp(-dt * 4));
    if (Math.abs(roller.speed) < 1 && targetSpeed === 0) roller.speed = 0;

    const step = roller.speed * dt;
    const cos = Math.cos(roller.angle), sin = Math.sin(roller.angle);
    roller.x = Math.max(0, Math.min(world.w, roller.x + cos * step));
    roller.y = Math.max(0, Math.min(world.h, roller.y + sin * step));
    roller.phase += step;
    if (step === 0) return;

    // knock over any cone the roller drives into
    for (const c of cones) {
      if (c.knocked) continue;
      const rx = c.x - roller.x, ry = c.y - roller.y;
      if (Math.abs(rx * cos + ry * sin) < 44 + CONE_R && Math.abs(-rx * sin + ry * cos) < 34 + CONE_R) {
        const d = Math.hypot(rx, ry) || 1;
        const push = Math.max(120, Math.abs(roller.speed) * 1.2);
        Object.assign(c, { knocked: true, vx: rx / d * push, vy: ry / d * push, vr: rand(-9, 9) });
        conesHit++;
        sound.thunk();
      }
    }

    if (phase !== 'roll') return;
    // compact cells under the front and rear drums, softer at the drum edges;
    // cold asphalt barely compacts
    const amount = Math.abs(step) * 0.022;
    let steaming = 0;
    for (const c of cells) {
      if (c.comp >= 1) continue;
      const rx = c.cx - roller.x, ry = c.cy - roller.y;
      const along = rx * cos + ry * sin;
      if (Math.abs(along - 30) >= 11 && Math.abs(along + 30) >= 11) continue;
      const t = Math.abs(-rx * sin + ry * cos) / 31;
      if (t >= 1) continue;
      c.comp = Math.min(1, c.comp + amount * (t < 0.75 ? 1 : (1 - t) / 0.25) * (0.4 + 0.6 * c.heat));
      if (c.comp >= 1) { heatSum += c.heat; heatCount++; }
      steaming = Math.max(steaming, c.heat);
    }
    if (Math.random() < 0.4 * steaming) {
      const side = Math.random() < 0.5 ? 1 : -1;
      const across = rand(-28, 28);
      addSteam(roller.x + cos * 30 * side - sin * across, roller.y + sin * 30 * side + cos * across);
    }
    if (share('comp', ROLLED) >= ROLL_TARGET) {
      for (const c of cells) if (c.comp < 1) { c.comp = 1; heatSum += c.heat; heatCount++; }
      finishLevel();
    }
  }

  function addSteam(x, y) {
    particles.push({ kind: 'steam', x, y, vx: rand(-8, 8), vy: rand(-35, -20), r: rand(4, 8), life: 1 });
  }

  function updateCooling(dt) {
    if (phase !== 'fill' && phase !== 'roll') return;
    for (const c of cells) if (c.heat > 0 && c.comp < 1) c.heat = Math.max(0, c.heat - dt / coolTime);
    // a little steam drifts off hot patches
    if (cells.length && Math.random() < 0.25) {
      const c = cells[Math.floor(Math.random() * cells.length)];
      if (c.fill > 0.5 && c.comp < 1 && Math.random() < c.heat) addSteam(c.cx, c.cy);
    }
  }

  function updateCones(dt) {
    for (const c of cones) {
      if (!c.knocked) continue;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      const k = Math.exp(-dt * 3);
      c.vx *= k;
      c.vy *= k;
      c.vr *= k;
    }
  }

  function updateTruck(dt) {
    if (!truck) return;
    // drive in at the start of a level, then follow the nozzle so the hose reaches it
    const target = phase === 'fill' && pointer.down
      ? Math.max(90, Math.min(world.w - 90, pointer.x + 70))
      : truck.x < truck.home - 1 || phase === 'intro' ? truck.home : truck.x;
    const before = truck.x;
    truck.x += (target - truck.x) * (1 - Math.exp(-dt * 2.5));
    truck.wheel += truck.x - before;
  }

  function showOverlay(title, html, stats, button, shareable = false) {
    ui.nameField.hidden = true;  // only on the start screen
    ui.submitForm.hidden = true;
    ui.board.hidden = true;
    ui.boardBtn.hidden = false;
    ui.ovTitle.textContent = title;
    ui.ovText.innerHTML = html;
    ui.ovStats.innerHTML = stats;
    ui.ovBtn.textContent = button;
    ui.shareBtn.hidden = !shareable;
    setTimeout(() => ui.overlay.classList.remove('hidden'), 600);
  }

  let toastTimer = 0;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2600);
  }

  // ---------- sharing ----------

  function makeShareCard(r) {
    const c = document.createElement('canvas');
    c.width = 1080;
    c.height = 1080;
    const g = c.getContext('2d');
    g.fillStyle = '#2b2d30';
    g.fillRect(0, 0, 1080, 1080);
    for (let i = 0; i < 9000; i++) {
      const v = Math.floor(rand(40, 95));
      g.fillStyle = `rgba(${v},${v},${v},0.6)`;
      g.fillRect(rand(0, 1080), rand(0, 1080), rand(2, 5), rand(2, 5));
    }
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 1080, 230);
    g.fillStyle = '#fe130f';
    g.fillRect(0, 230, 1080, 14);
    drawLogo(g, logoImg, 80, 40, 920, 150);

    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.font = '800 96px Poppins, sans-serif';
    g.fillText('POTHOLE PATROL', 540, 395);
    g.fillStyle = '#d0d0d0';
    g.font = '600 50px "Open Sans", sans-serif';
    g.fillText(`I paved level ${r.level}!`, 540, 480);
    g.font = '120px sans-serif';
    for (let i = 0; i < 3; i++) {
      g.fillStyle = i < r.stars ? '#ffc21a' : '#555';
      g.fillText('★', 400 + i * 140, 630);
    }
    g.fillStyle = '#fe130f';
    g.font = '800 150px Poppins, sans-serif';
    g.fillText(r.score.toLocaleString(), 540, 810);
    g.fillStyle = '#fff';
    g.font = '700 42px "Open Sans", sans-serif';
    g.fillText('POINTS', 540, 870);

    g.fillStyle = '#009cde';
    g.fillRect(0, 930, 1080, 150);
    g.fillStyle = '#fff';
    g.font = '700 46px "Open Sans", sans-serif';
    g.fillText('Can you beat my score? Play free!', 540, 995);
    g.font = '600 38px "Open Sans", sans-serif';
    g.fillText(`${COMPANY.site}  ·  ${COMPANY.phone}`, 540, 1050);
    return c;
  }

  async function shareScore() {
    const r = lastResult;
    if (!r) return;
    const text = `I scored ${r.score.toLocaleString()} points and paved level ${r.level} in Pothole Patrol by ${COMPANY.name}. Can you beat it?`;
    let blob = null;
    try {
      blob = await new Promise((resolve) => makeShareCard(r).toBlob(resolve, 'image/png'));
    } catch { /* canvas unavailable; share text only */ }
    const file = blob && new File([blob], 'pothole-patrol-score.png', { type: 'image/png' });
    try {
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Pothole Patrol', text: `${text} ${GAME_URL}` });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: 'Pothole Patrol', text, url: GAME_URL });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;  // the player closed the share sheet
    }
    // no share sheet (most desktops): download the card and copy the message
    if (blob) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pothole-patrol-score.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    try {
      await navigator.clipboard.writeText(`${text} ${GAME_URL}`);
      toast(blob ? 'Score card saved and message copied' : 'Message copied');
    } catch {
      toast(blob ? 'Score card saved' : 'Sharing is not available here');
    }
  }

  function updateLives() {
    ui.lives.textContent = '❤️'.repeat(lives) + '🖤'.repeat(LIVES - lives);
    ui.lives.title = `${lives} ${lives === 1 ? 'life' : 'lives'} left`;
  }

  function failLevel() {
    pointer.down = false;
    sound.fail();
    lives--;
    updateLives();
    const why = `<p>The truck ran dry with the ${holes.length > 1 ? 'potholes' : 'pothole'} ${Math.round(share('fill') * 100)}% full.</p>`;
    if (lives > 0) {
      setPhase('failed');
      showOverlay('Out of asphalt!',
        why + `<p>${lives} ${lives === 1 ? 'life' : 'lives'} left. Keep the nozzle inside the hole so less spills onto the road.</p>`,
        '', 'Try again');
      return;
    }
    setPhase('gameover');
    showOverlay('Game over',
      why + `<p>You reached level ${level} with <b>${score.toLocaleString()}</b> points.</p>`,
      '', 'Play again');
    if (score > 0) {
      ui.submitBtn.disabled = false;
      ui.submitMsg.textContent = 'Add your score to the leaderboard';
      ui.playerName.value = load(NAME_KEY, '');
      // a name given at the start is submitted straight away
      if (validName(cleanName(ui.playerName.value))) {
        submitScore();
        return;
      }
      ui.submitForm.hidden = false;
    }
    showBoard();
  }

  // ---------- leaderboard ----------

  async function rpc(fn, body) {
    const res = await fetch(LEADERBOARD.url + fn, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: LEADERBOARD.key },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.message) || `HTTP ${res.status}`);
    return data;
  }

  function escapeHtml(t) {
    return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  async function showBoard(highlight = null, target = ui.board) {
    if (target === ui.board) {
      ui.board.hidden = false;
      ui.boardBtn.hidden = true;
    }
    target.innerHTML = '<p class="board-note">Loading top scores…</p>';
    try {
      const rows = await rpc('top_scores', { p_limit: 10 });
      const mine = runSaved && savedRank
        ? `<p class="board-note">This run: <b>#${savedRank}</b> with ${savedScore.toLocaleString()} points</p>` : '';
      target.innerHTML = '<h2>🏆 Top scores</h2>' + (rows.length
        ? '<ol>' + rows.map((r, i) =>
          `<li class="${highlight && r.name === highlight.name && r.score === highlight.score ? 'me' : ''}">` +
          `<span class="rank">${i + 1}</span><span class="who">${escapeHtml(r.name)}</span>` +
          `<span class="lvl">L${r.level}</span><b>${r.score.toLocaleString()}</b></li>`).join('') + '</ol>'
        : '<p class="board-note">No scores yet. Be the first!</p>') + mine;
    } catch {
      target.innerHTML = '<p class="board-note">Couldn\'t reach the leaderboard. Check your connection.</p>';
    }
  }

  // with a name from the start screen, every finished level updates this run's leaderboard entry
  async function saveProgress() {
    const name = cleanName(load(NAME_KEY, ''));
    if (!validName(name) || score <= 0) return;
    try {
      const [row] = await rpc('save_score', { p_name: name, p_score: score, p_level: level, p_run: runId });
      runSaved = true;
      savedScore = score;
      savedRank = row.out_rank;
      toast(`Saved to the leaderboard: #${row.out_rank}`);
    } catch (e) {
      if (/name not allowed/.test(e.message)) save(NAME_KEY, '');  // ask for another name at game over
    }
  }

  async function submitScore() {
    const name = cleanName(ui.playerName.value);
    if (!validName(name)) {
      ui.submitMsg.textContent = 'Use 2–12 letters, numbers or spaces';
      return;
    }
    ui.submitBtn.disabled = true;
    ui.submitMsg.textContent = 'Sending…';
    try {
      const [row] = await rpc('save_score', { p_name: name, p_score: score, p_level: level, p_run: runId });
      save(NAME_KEY, name);
      runSaved = true;
      savedScore = score;
      savedRank = row.out_rank;
      ui.submitForm.hidden = true;
      toast(`You're #${row.out_rank} on the leaderboard!`);
      showBoard({ name, score });
    } catch (e) {
      if (runSaved && /too many/.test(e.message)) {
        // this run's score was saved moments ago; nothing new to send
        ui.submitForm.hidden = true;
        showBoard({ name, score });
        return;
      }
      ui.submitForm.hidden = false;
      ui.submitBtn.disabled = false;
      ui.submitMsg.textContent = /name not allowed/.test(e.message) ? 'Please pick a different name'
        : /too many/.test(e.message) ? 'Too many scores sent. Try again in a minute'
          : 'Couldn\'t send your score. Check your connection and try again';
    }
  }

  function finishLevel() {
    setPhase('done');
    pointer.down = false;
    sound.ding();
    const acc = accuracy();
    const hot = heatCount ? heatSum / heatCount : 0;
    const prec = precision();
    const cutPts = Math.round(prec * 300 * level);
    const accPts = Math.round(acc * 600 * level);
    const hotPts = Math.round(hot * 400 * level);
    const timePts = Math.max(0, Math.round(level * 400 - elapsed * 8));
    const conePts = conesHit * 100;
    const total = Math.max(0, cutPts + accPts + hotPts + timePts - conePts);
    const quality = (prec + acc + hot) / 3 - conesHit * 0.1;
    const stars = quality >= 0.75 ? 3 : quality >= 0.55 ? 2 : 1;
    score += total;
    const newBest = score > best;
    if (newBest) { best = score; save(BEST_KEY, best); }
    ui.score.textContent = score;
    ui.best.textContent = best;
    lastResult = { level, score, stars };
    saveProgress();

    const row = (label, value, pts, cls = '') =>
      `<span class="${cls}">${label}</span><b class="${cls}">${value}</b><span class="pts ${cls}">${pts}</span>`;
    showOverlay(`Level ${level} paved!`,
      `<div class="stars">${'★'.repeat(stars)}<span class="off">${'★'.repeat(3 - stars)}</span></div>` +
      (newBest ? '<div class="new-best">New best score!</div>' : '') +
      '<p>The next potholes are bigger.</p>',
      row('Cut precision', `${Math.round(prec * 100)}%`, `+${cutPts}`) +
      row('Fill accuracy', `${Math.round(acc * 100)}%`, `+${accPts}`) +
      row('Rolled while hot', `${Math.round(hot * 100)}%`, `+${hotPts}`) +
      row('Speed', `${elapsed.toFixed(1)}s`, `+${timePts}`) +
      (cones.length ? row('Cones knocked', conesHit, conePts ? `−${conePts}` : '0') : '') +
      row('Level total', '', `+${total}`, 'total'),
      'Next level', true);
  }

  function update(dt) {
    if (paused) {
      sound.pour(false);
      sound.saw(false, false);
      sound.engine(false, 0);
      return;
    }
    if (phase === 'cut' || phase === 'fill' || phase === 'roll') elapsed += dt;
    if (phase === 'cut') updateCut(dt);
    if (phase === 'fill') updateFill(dt);
    if (roller && (phase === 'roll' || phase === 'done')) updateRoll(dt);
    updateTruck(dt);
    updateCooling(dt);
    updateCones(dt);

    for (const p of particles) {
      if (p.kind === 'chunk') p.y += p.vy * dt;
      else { p.x += p.vx * dt; p.y += p.vy * dt; p.r += dt * 10; p.life -= dt * 1.3; }
    }
    particles = particles.filter((p) => (p.kind === 'chunk' ? p.y < p.ty : p.life > 0));

    sound.pour(phase === 'fill' && pointer.down);
    sound.saw(phase === 'cut' && pointer.down, sawCutting);
    sound.engine(phase === 'roll' || (phase === 'done' && Math.abs(roller.speed) > 5), roller ? roller.speed : 0);

    ui.time.textContent = elapsed.toFixed(1);
    ui.acc.textContent = phase === 'intro' ? '–' : `${Math.round((phase === 'cut' ? precision() : accuracy()) * 100)}%`;
    let pct = 0, label = '';
    if (phase === 'cut') { pct = cutShare() / CUT_TARGET; label = 'Cut'; }
    else if (phase === 'fill' || phase === 'failed') { pct = share('fill') / FILL_TARGET; label = 'Fill'; }
    else if (phase === 'roll') { pct = share('comp', ROLLED) / ROLL_TARGET; label = 'Roll'; }
    else if (phase === 'done') { pct = 1; label = 'Done'; }
    pct = Math.min(1, pct);
    ui.bar.style.width = `${pct * 100}%`;
    ui.barLabel.textContent = label ? `${label} ${Math.floor(pct * 100)}%` : '';

    const meter = phase === 'cut' ? 1 : phase === 'roll' ? patchHeat() : phase === 'done' ? 0 : phase === 'intro' ? 1 : truckLeft();
    ui.meterBar.style.width = `${meter * 100}%`;
    ui.meterBar.classList.toggle('low', meter < 0.25);
    ui.meterBar.style.background = phase === 'roll' ? `hsl(${10 + (1 - meter) * 200}, 75%, 55%)` : '';
  }

  // ---------- rendering ----------

  function paintHole(hole) {
    const d = hole.data.data;
    // while filling, spots that still need asphalt glow orange and pulse
    const glow = phase === 'fill' ? 0.5 + 0.2 * Math.sin(performance.now() / 180) : 0;
    const put = (idx, c) => {
      // empty hole: dirty gravel, darker under the rim
      // the sawn-out margin is shallow, lighter base gravel
      const shade = c.shallow ? 0.8 + 0.2 * ((c.dy + 1) / 2) : 0.55 + 0.35 * ((c.dy + 1) / 2) + 0.1 * c.depth;
      const base = c.shallow ? [92, 88, 80] : [60, 52, 42];
      const hr = (base[0] + c.n * 25) * shade, hg = (base[1] + c.n * 20) * shade, hb = (base[2] + c.n * 15) * shade;
      // fresh loose asphalt: lumpy and grey with a warm tint while hot; compacted: smooth and black
      const lump = (c.n - 0.5) * 40, sm = (c.n - 0.5) * 6, warm = c.heat * (1 - c.comp) * 14;
      const ar = 78 + lump + warm + (30 + sm - 78 - lump) * c.comp;
      const ag = 76 + lump + warm * 0.3 + (31 + sm - 76 - lump) * c.comp;
      const ab = 74 + lump - warm * 0.4 + (34 + sm - 74 - lump) * c.comp;
      let r = hr + (ar - hr) * c.fill, g = hg + (ag - hg) * c.fill, b = hb + (ab - hb) * c.fill;
      if (glow && c.fill < 1) {
        const k = glow * (0.45 + 0.55 * (1 - c.fill));
        r += (255 - r) * k;
        g += (150 - g) * k;
        b += (30 - b) * k;
      }
      const o = idx * 4;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = 255;
    };
    for (const c of hole.cells) put(c.idx, c);
    for (const [idx, c] of hole.pads) put(idx, c);
    hole.imgCtx.putImageData(hole.data, 0, 0);

    ctx.save();
    ctx.clip(hole.path);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(hole.img, hole.gx0 * CELL, hole.gy0 * CELL, hole.gw * CELL, hole.gh * CELL);
    ctx.restore();
    ctx.strokeStyle = 'rgba(15,15,15,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke(hole.path);
  }

  function drawCone(c) {
    ctx.save();
    ctx.translate(c.x, c.y);
    if (c.knocked) {
      // lying on its side: base square with the cone pointing away
      ctx.rotate(c.rot);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-8, -7, 30, 16);
      ctx.fillStyle = '#e8641b';
      ctx.beginPath();
      ctx.moveTo(-4, -7);
      ctx.lineTo(24, 0);
      ctx.lineTo(-4, 7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(5, -4.5, 5, 9);
      ctx.fillStyle = '#c24d12';
      ctx.fillRect(-9, -9, 5, 18);
    } else {
      // seen from above: square base, round cone, white reflective band
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-9, -7, 20, 20);
      ctx.fillStyle = '#c24d12';
      ctx.fillRect(-10, -10, 20, 20);
      ctx.fillStyle = '#e8641b';
      ctx.beginPath();
      ctx.arc(0, 0, CONE_R - 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f4f4f4';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ff8a3d';
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawRoller() {
    const moving = Math.abs(roller.speed) > 5;
    ctx.save();
    ctx.translate(roller.x + (moving ? rand(-0.5, 0.5) : 0), roller.y + (moving ? rand(-0.5, 0.5) : 0));
    ctx.rotate(roller.angle);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-44, -30, 92, 66);
    // drums, with seams that turn as the roller moves
    for (const x of [30, -30]) {
      const grad = ctx.createLinearGradient(x - 11, 0, x + 11, 0);
      grad.addColorStop(0, '#6b6e72');
      grad.addColorStop(0.5, '#c9ccd0');
      grad.addColorStop(1, '#6b6e72');
      ctx.fillStyle = grad;
      ctx.fillRect(x - 11, -31, 22, 62);
      ctx.fillStyle = 'rgba(60,62,66,0.5)';
      for (let k = 0; k < 3; k++) {
        const off = ((roller.phase + k * 22 / 3) % 22 + 22) % 22;
        ctx.fillRect(x - 11 + off, -31, 1.5, 62);
      }
    }
    // red frame and body
    ctx.fillStyle = '#fe130f';
    ctx.fillRect(-36, -34, 72, 5);
    ctx.fillRect(-36, 29, 72, 5);
    ctx.fillRect(-19, -27, 38, 54);
    // white roof panel with the company mark, and the seat
    ctx.fillStyle = '#fff';
    ctx.fillRect(-17, -25, 19, 50);
    ctx.save();
    ctx.translate(-7.5, 0);
    ctx.rotate(Math.PI / 2);
    drawLogo(ctx, markImg, -24, -8, 48, 16);
    ctx.restore();
    ctx.fillStyle = '#1e2124';
    ctx.fillRect(5, -9, 9, 18);
    // headlights show the front
    ctx.fillStyle = '#fff7c2';
    ctx.fillRect(15, -20, 3, 6);
    ctx.fillRect(15, 14, 3, 6);
    ctx.restore();
  }

  // Draw an image scaled to fit the box, or the company name as text until it loads.
  function drawLogo(g, img, x, y, w, h) {
    if (isReady(img)) {
      const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      return;
    }
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fe130f';
    g.font = `800 ${h * 0.42}px Poppins, sans-serif`;
    g.fillText('ASPHALT CARE', x + w / 2, y + h * 0.32, w);
    g.fillStyle = '#009cde';
    g.font = `700 ${h * 0.28}px Poppins, sans-serif`;
    g.fillText('SERVICES LLC', x + w / 2, y + h * 0.76, w);
    g.restore();
  }

  function roundRect(x, y, w, h, r) {
    if (!ctx.roundRect) { ctx.fillRect(x, y, w, h); return; }  // older iOS
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }

  function drawHose() {
    // a hose from the truck's rear chute down to the nozzle
    const sx = truck.x - 76, sy = truck.y + 6;
    const mx = (sx + pointer.x) / 2, my = Math.max(sy, pointer.y) + 30;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#151618';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(mx, my, pointer.x, pointer.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#3b3f44';
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGuide(hole) {
    const { x0, y0, x1, y1 } = hole.rect;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
    // finished cuts: a dark kerf with a pale edge of fresh dust
    const g = hole.guide;
    ctx.lineCap = 'round';
    for (const [w, col] of [[5, 'rgba(210,210,205,0.5)'], [2.5, '#111']]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      for (let i = 0; i < g.length; i++) {
        const a = g[i], b = g[(i + 1) % g.length];
        if (a.cut && b.cut) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      }
      ctx.stroke();
    }
  }

  function drawSaw() {
    // a hand-held cut-off saw seen from above: red guard over a spinning blade
    ctx.save();
    ctx.translate(pointer.x, pointer.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(3, 4, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.rotate(sawSpin);
    ctx.fillStyle = '#b8bcc2';
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2, r = i % 2 ? 13 : 15;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7d8187';
    ctx.fillRect(-9, -1, 18, 2);
    ctx.restore();
    ctx.fillStyle = '#fe130f';
    ctx.beginPath();
    ctx.arc(0, 0, 16, Math.PI * 0.9, Math.PI * 2.1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2b2e33';
    ctx.fillRect(-5, -34, 10, 22);
    ctx.fillStyle = '#fe130f';
    ctx.fillRect(-8, -42, 16, 9);
    ctx.fillStyle = '#ddd';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTruck() {
    ctx.save();
    ctx.translate(truck.x, truck.y);
    // shadow and wheels
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(-76, -22, 160, 54, 6);
    ctx.fillStyle = '#111';
    for (const x of [-56, -30, 52]) {
      ctx.fillRect(x - 10, -31, 20, 7);
      ctx.fillRect(x - 10, 24, 20, 7);
    }
    ctx.fillStyle = '#555';
    for (const x of [-56, -30, 52]) {
      const off = ((truck.wheel % 6) + 6) % 6;
      ctx.fillRect(x - 10 + off, -31, 2, 7);
      ctx.fillRect(x - 10 + off, 24, 2, 7);
    }
    // red dump body with the company logo on a white panel
    ctx.fillStyle = '#c80d0a';
    roundRect(-80, -27, 116, 54, 4);
    ctx.fillStyle = '#fe130f';
    roundRect(-77, -24, 110, 48, 3);
    ctx.fillStyle = '#fff';
    roundRect(-73, -19, 102, 38, 3);
    drawLogo(ctx, logoImg, -71, -17, 98, 34);
    // rear chute
    ctx.fillStyle = '#3b3f44';
    ctx.fillRect(-86, -6, 8, 18);
    // cab
    ctx.fillStyle = '#fe130f';
    roundRect(39, -25, 42, 50, 7);
    ctx.fillStyle = '#c80d0a';
    ctx.fillRect(43, -21, 16, 42);
    ctx.fillStyle = '#20252b';
    roundRect(63, -21, 11, 42, 3);
    ctx.fillStyle = '#fe130f';
    ctx.fillRect(56, -30, 5, 5);
    ctx.fillRect(56, 25, 5, 5);
    ctx.fillStyle = '#fff7c2';
    ctx.fillRect(79, -20, 3, 7);
    ctx.fillRect(79, 13, 3, 7);
    ctx.restore();
  }

  function draw() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.fillStyle = '#1d1f22';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.scale, view.scale);

    if (background) ctx.drawImage(background, 0, 0);
    if (spill) ctx.drawImage(spill, 0, 0);

    ctx.strokeStyle = 'rgba(25,25,25,0.8)';
    ctx.lineWidth = 1.5;
    for (const hole of holes) {
      for (const pts of hole.cracks) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const [x, y] of pts) ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
    for (const hole of holes) paintHole(hole);
    if (phase === 'cut' || phase === 'intro') for (const hole of holes) drawGuide(hole);

    for (const p of particles) {
      if (p.kind !== 'chunk') continue;
      ctx.fillStyle = `rgb(${p.v},${p.v},${p.v})`;
      ctx.fillRect(p.x, p.y, p.s, p.s);
    }

    for (const c of cones) drawCone(c);

    if (truck) {
      if (phase === 'fill' && pointer.down) drawHose();
      drawTruck();
    }

    if (phase === 'fill' && (pointer.down || pointer.mouse)) {
      // nozzle ring turns red when most of the pour is missing the hole
      const wasting = pointer.down && frameWaste > 0.5;
      ctx.strokeStyle = wasting ? '#fe130f' : pointer.down ? '#ffffff' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, brush, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (phase === 'cut' && (pointer.down || pointer.mouse)) drawSaw();

    if (roller && (phase === 'roll' || phase === 'done')) drawRoller();

    for (const p of particles) {
      if (p.kind !== 'steam') continue;
      ctx.fillStyle = `rgba(235,235,235,${p.life * 0.3})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // Draw a preview level behind the start screen.
  setupWorld();
  ui.best.textContent = best;
  ui.hint.style.opacity = 0;
  updateMuteButton();
  updateLives();
  ui.startName.value = load(NAME_KEY, '');
  for (const a of document.querySelectorAll('.js-estimate')) a.href = COMPANY.estimateUrl;
  for (const a of document.querySelectorAll('.js-phone')) {
    a.href = COMPANY.tel;
    a.textContent = `📞 Call ${COMPANY.phone}`;
  }
  requestAnimationFrame(frame);
})();
