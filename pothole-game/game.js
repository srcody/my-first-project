// Pothole Patrol: fill the potholes with asphalt, then roll them flat.
(() => {
  const CELL = 6;             // size of one simulation cell in world pixels
  const FILL_TARGET = 0.97;   // share of cells that must be full before rolling
  const ROLL_TARGET = 0.97;   // share of cells that must be compacted to finish
  const ROLLED = 0.9;         // compaction at which a cell counts as rolled
  const POUR_RATE = 3.2;      // fill added per second at the centre of the nozzle
  const ROLLER_MAX = 380;     // top roller speed in px/s
  const DEAD_ZONE = 14;       // roller stops when the pointer is this close
  const CONE_R = 9;           // traffic cone radius
  const BEST_KEY = 'pothole-patrol-best';
  const MUTE_KEY = 'pothole-patrol-muted';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = {
    level: $('level'), time: $('time'), acc: $('acc'), score: $('score'), best: $('best'),
    shovel: $('tool-shovel'), roller: $('tool-roller'),
    bar: $('bar'), barLabel: $('bar-label'), meterIcon: $('meter-icon'), meterBar: $('meter-bar'),
    hint: $('hint'), mute: $('mute'),
    overlay: $('overlay'), ovTitle: $('ov-title'), ovText: $('ov-text'),
    ovStats: $('ov-stats'), ovBtn: $('ov-btn'),
  };

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
  let phase = 'intro';                // intro | fill | roll | done | failed
  let pointer = { x: 0, y: 0, down: false };
  let roller = null;
  let particles = [];
  let lastTime = performance.now();

  function rand(a, b) { return a + Math.random() * (b - a); }

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }

  // ---------- sound (synthesised with Web Audio, no files) ----------

  const sound = (() => {
    let ac = null, master, pourGain, engineGain, engineOsc;
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
    // lane markings along the top and bottom
    g.fillStyle = '#e8c547';
    for (let x = 20; x < world.w; x += 90) {
      g.fillRect(x, 18, 50, 7);
      g.fillRect(x, world.h - 25, 50, 7);
    }
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
    const top = 45, bottom = world.h - 45;            // keep clear of the lane markings
    const sizes = holeSizes();
    for (let shrink = 1; shrink > 0.3; shrink *= 0.9) {
      const placed = [];
      for (const size of sizes) {
        const ry = size * shrink, rx = ry * stretch, reach = rx * 1.3;
        for (let tries = 0; tries < 200; tries++) {
          const cx = sizes.length === 1 ? world.w / 2 : rand(reach + 20, world.w - reach - 20);
          const cy = rand(top + ry * 1.3, bottom - ry * 1.3);
          if (cx - reach < 0 || cx + reach > world.w || cy - ry * 1.3 < top || cy + ry * 1.3 > bottom) continue;
          if (placed.some((p) => Math.hypot(p.cx - cx, p.cy - cy) < p.reach + reach + 60)) continue;
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

    // grid of cells covering the hole's bounding box; one pixel per cell in hole.img
    const gx0 = Math.max(0, Math.floor((cx - rx * 1.4) / CELL));
    const gy0 = Math.max(0, Math.floor((cy - ry * 1.4) / CELL));
    const gx1 = Math.min(Math.ceil(world.w / CELL), Math.ceil((cx + rx * 1.4) / CELL));
    const gy1 = Math.min(Math.ceil(world.h / CELL), Math.ceil((cy + ry * 1.4) / CELL));
    const gw = gx1 - gx0, gh = gy1 - gy0;
    const grid = new Array(gw * gh).fill(null);
    hole.cells = [];
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const x = (gx0 + i + 0.5) * CELL, y = (gy0 + j + 0.5) * CELL;
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const lim = edge(hole, Math.atan2(dy, dx));
        const d = Math.hypot(dx, dy);
        if (d >= lim) continue;
        const cell = {
          idx: j * gw + i, cx: x, cy: y,
          fill: 0, comp: 0, heat: 0,
          depth: d / lim,           // 0 centre, 1 rim
          dy: dy / lim,             // for rim shadow
          n: Math.random(),         // per-cell noise
        };
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
    return hole;
  }

  function cellAt(x, y) {
    for (const h of holes) {
      const i = Math.floor(x / CELL) - h.gx0, j = Math.floor(y / CELL) - h.gy0;
      if (i >= 0 && j >= 0 && i < h.gw && j < h.gh && h.grid[j * h.gw + i]) return h.grid[j * h.gw + i];
    }
    return null;
  }

  // Cones from level 2: placed near the holes so the roller has to steer around them.
  function placeCones(start) {
    cones = [];
    const count = level < 2 ? 0 : Math.min(10, level + 1);
    for (let tries = 0; cones.length < count && tries < 500; tries++) {
      const h = holes[Math.floor(Math.random() * holes.length)];
      const [x, y] = rimPoint(h, rand(0, Math.PI * 2), rand(45, 85));
      if (x < 20 || y < 45 || x > world.w - 20 || y > world.h - 45) continue;
      if (holes.some((o) => {
        const dx = (x - o.cx) / o.rx, dy = (y - o.cy) / o.ry;
        return Math.hypot(dx, dy) < edge(o, Math.atan2(dy, dx)) + 30 / o.ry;
      })) continue;
      if (cones.some((c) => Math.hypot(c.x - x, c.y - y) < 50)) continue;
      if (Math.hypot(start.x - x, start.y - y) < 100) continue;
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
    // the truck carries a bit more than the holes need; the margin shrinks with level
    supply = cells.length * Math.max(1.5, 1.9 - level * 0.04);
    coolTime = 25 + level * 6;
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
    particles = [];
    // park the roller left of the leftmost hole, or on the left edge
    const first = holes.reduce((a, b) => (a.cx - a.rx < b.cx - b.rx ? a : b));
    roller = { x: Math.max(55, first.cx - first.rx * 1.3 - 70), y: first.cy, angle: 0, speed: 0, phase: 0 };
    placeCones(roller);
    setPhase('fill');
    ui.level.textContent = level;
    ui.overlay.classList.add('hidden');
  }

  function setPhase(p) {
    phase = p;
    ui.shovel.classList.toggle('active', p === 'fill');
    ui.shovel.classList.toggle('done', p === 'roll' || p === 'done');
    ui.roller.classList.toggle('active', p === 'roll');
    ui.roller.classList.toggle('done', p === 'done');
    ui.hint.style.opacity = p === 'fill' || p === 'roll' ? 1 : 0;
    ui.meterIcon.textContent = p === 'roll' || p === 'done' ? '🌡️' : '🚚';
    ui.meterIcon.parentElement.title = p === 'roll' || p === 'done' ? 'Asphalt temperature' : 'Asphalt left in the truck';
    if (p === 'fill') {
      ui.hint.textContent = holes.length > 1
        ? `Fill all ${holes.length} potholes. Spills cost accuracy and truck load`
        : 'Pour inside the hole: spills cost accuracy and truck load';
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
    Object.assign(pointer, toWorld(e), { down: true });
  });
  canvas.addEventListener('pointermove', (e) => Object.assign(pointer, toWorld(e)));
  const release = () => { pointer.down = false; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  ui.ovBtn.addEventListener('click', () => {
    sound.init();
    if (phase === 'done') level++;
    startLevel();
  });

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

  function showOverlay(title, html, stats, button) {
    ui.ovTitle.textContent = title;
    ui.ovText.innerHTML = html;
    ui.ovStats.innerHTML = stats;
    ui.ovBtn.textContent = button;
    setTimeout(() => ui.overlay.classList.remove('hidden'), 600);
  }

  function failLevel() {
    setPhase('failed');
    pointer.down = false;
    sound.fail();
    showOverlay('Out of asphalt!',
      `<p>The truck ran dry with the ${holes.length > 1 ? 'potholes' : 'pothole'} ${Math.round(share('fill') * 100)}% full. ` +
      'Keep the nozzle inside the hole so less spills onto the road.</p>',
      '', 'Try again');
  }

  function finishLevel() {
    setPhase('done');
    pointer.down = false;
    sound.ding();
    const acc = accuracy();
    const hot = heatCount ? heatSum / heatCount : 0;
    const accPts = Math.round(acc * 600 * level);
    const hotPts = Math.round(hot * 400 * level);
    const timePts = Math.max(0, Math.round(level * 400 - elapsed * 8));
    const conePts = conesHit * 100;
    const total = Math.max(0, accPts + hotPts + timePts - conePts);
    const quality = (acc + hot) / 2 - conesHit * 0.1;
    const stars = quality >= 0.75 ? 3 : quality >= 0.55 ? 2 : 1;
    score += total;
    const newBest = score > best;
    if (newBest) { best = score; save(BEST_KEY, best); }
    ui.score.textContent = score;
    ui.best.textContent = best;

    const row = (label, value, pts, cls = '') =>
      `<span class="${cls}">${label}</span><b class="${cls}">${value}</b><span class="pts ${cls}">${pts}</span>`;
    showOverlay(`Level ${level} paved!`,
      `<div class="stars">${'★'.repeat(stars)}<span class="off">${'★'.repeat(3 - stars)}</span></div>` +
      (newBest ? '<div class="new-best">New best score!</div>' : '') +
      '<p>The next potholes are bigger.</p>',
      row('Fill accuracy', `${Math.round(acc * 100)}%`, `+${accPts}`) +
      row('Rolled while hot', `${Math.round(hot * 100)}%`, `+${hotPts}`) +
      row('Speed', `${elapsed.toFixed(1)}s`, `+${timePts}`) +
      (cones.length ? row('Cones knocked', conesHit, conePts ? `−${conePts}` : '0') : '') +
      row('Level total', '', `+${total}`, 'total'),
      'Next level');
  }

  function update(dt) {
    if (phase === 'fill' || phase === 'roll') elapsed += dt;
    if (phase === 'fill') updateFill(dt);
    if (roller && (phase === 'roll' || phase === 'done')) updateRoll(dt);
    updateCooling(dt);
    updateCones(dt);

    for (const p of particles) {
      if (p.kind === 'chunk') p.y += p.vy * dt;
      else { p.x += p.vx * dt; p.y += p.vy * dt; p.r += dt * 10; p.life -= dt * 1.3; }
    }
    particles = particles.filter((p) => (p.kind === 'chunk' ? p.y < p.ty : p.life > 0));

    sound.pour(phase === 'fill' && pointer.down);
    sound.engine(phase === 'roll' || (phase === 'done' && Math.abs(roller.speed) > 5), roller ? roller.speed : 0);

    ui.time.textContent = elapsed.toFixed(1);
    ui.acc.textContent = phase === 'intro' ? '–' : `${Math.round(accuracy() * 100)}%`;
    let pct = 0, label = '';
    if (phase === 'fill' || phase === 'failed') { pct = share('fill') / FILL_TARGET; label = 'Fill'; }
    else if (phase === 'roll') { pct = share('comp', ROLLED) / ROLL_TARGET; label = 'Roll'; }
    else if (phase === 'done') { pct = 1; label = 'Done'; }
    pct = Math.min(1, pct);
    ui.bar.style.width = `${pct * 100}%`;
    ui.barLabel.textContent = label ? `${label} ${Math.floor(pct * 100)}%` : '';

    const meter = phase === 'roll' ? patchHeat() : phase === 'done' ? 0 : phase === 'intro' ? 1 : truckLeft();
    ui.meterBar.style.width = `${meter * 100}%`;
    ui.meterBar.classList.toggle('low', meter < 0.25);
    ui.meterBar.style.background = phase === 'roll' ? `hsl(${10 + (1 - meter) * 200}, 75%, 55%)` : '';
  }

  // ---------- rendering ----------

  function paintHole(hole) {
    const d = hole.data.data;
    const put = (idx, c) => {
      // empty hole: dirty gravel, darker under the rim
      const shade = 0.55 + 0.35 * ((c.dy + 1) / 2) + 0.1 * c.depth;
      const hr = (60 + c.n * 25) * shade, hg = (52 + c.n * 20) * shade, hb = (42 + c.n * 15) * shade;
      // fresh loose asphalt: lumpy and grey with a warm tint while hot; compacted: smooth and black
      const lump = (c.n - 0.5) * 40, sm = (c.n - 0.5) * 6, warm = c.heat * (1 - c.comp) * 14;
      const ar = 78 + lump + warm + (30 + sm - 78 - lump) * c.comp;
      const ag = 76 + lump + warm * 0.3 + (31 + sm - 76 - lump) * c.comp;
      const ab = 74 + lump - warm * 0.4 + (34 + sm - 74 - lump) * c.comp;
      const o = idx * 4;
      d[o] = hr + (ar - hr) * c.fill;
      d[o + 1] = hg + (ag - hg) * c.fill;
      d[o + 2] = hb + (ab - hb) * c.fill;
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
    // yellow frame and body
    ctx.fillStyle = '#f2b705';
    ctx.fillRect(-36, -34, 72, 5);
    ctx.fillRect(-36, 29, 72, 5);
    ctx.fillRect(-18, -24, 36, 48);
    // engine cover and seat
    ctx.fillStyle = '#3b3f44';
    ctx.fillRect(-16, -18, 18, 36);
    ctx.fillStyle = '#1e2124';
    ctx.fillRect(5, -9, 9, 18);
    // headlights show the front
    ctx.fillStyle = '#fff7c2';
    ctx.fillRect(15, -20, 3, 6);
    ctx.fillRect(15, 14, 3, 6);
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

    for (const p of particles) {
      if (p.kind !== 'chunk') continue;
      ctx.fillStyle = `rgb(${p.v},${p.v},${p.v})`;
      ctx.fillRect(p.x, p.y, p.s, p.s);
    }

    for (const c of cones) drawCone(c);

    if (phase === 'fill') {
      // nozzle ring turns red when most of the pour is missing the hole
      const wasting = pointer.down && frameWaste > 0.5;
      ctx.strokeStyle = wasting ? '#e5533d' : pointer.down ? '#f2b705' : 'rgba(242,183,5,0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, brush, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

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
  requestAnimationFrame(frame);
})();
