// Pothole Patrol: fill the pothole with asphalt, then roll it flat.
(() => {
  const CELL = 6;             // size of one simulation cell in world pixels
  const FILL_TARGET = 0.97;   // share of cells that must be full before rolling
  const ROLL_TARGET = 0.97;   // share of cells that must be compacted to finish
  const POUR_RATE = 3.2;      // fill added per second at the centre of the nozzle
  const ROLLER_MAX = 380;     // top roller speed in px/s
  const DEAD_ZONE = 14;       // roller stops when the pointer is this close
  const BEST_KEY = 'pothole-patrol-best';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = {
    level: $('level'), time: $('time'), acc: $('acc'), score: $('score'), best: $('best'),
    shovel: $('tool-shovel'), roller: $('tool-roller'),
    bar: $('bar'), barLabel: $('bar-label'), hint: $('hint'),
    overlay: $('overlay'), ovTitle: $('ov-title'), ovText: $('ov-text'),
    ovStats: $('ov-stats'), ovBtn: $('ov-btn'),
  };

  let world = { w: 800, h: 600 };     // logical size, fixed for the duration of a level
  let view = { scale: 1, ox: 0, oy: 0 };
  let background = null;              // offscreen canvas with the road texture
  let spill = null;                   // offscreen canvas with asphalt spilled on the road
  let hole = null;
  let cells = [];                     // cells inside the pothole
  let level = 1, score = 0, best = loadBest(), elapsed = 0;
  let poured = 0, used = 0, frameWaste = 0;
  let phase = 'intro';                // intro | fill | roll | done
  let pointer = { x: 0, y: 0, down: false };
  let roller = null;
  let particles = [];
  let lastTime = performance.now();

  function rand(a, b) { return a + Math.random() * (b - a); }

  function loadBest() {
    try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
  }
  function saveBest() {
    try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* storage unavailable */ }
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

  // radius multiplier of the blob outline at angle a
  function edge(a) {
    let m = 1;
    for (const w of hole.waves) m += w.a * Math.sin(w.k * a + w.p);
    return m;
  }

  function rimPoint(a) {
    const m = edge(a);
    return [hole.cx + Math.cos(a) * hole.rx * m, hole.cy + Math.sin(a) * hole.ry * m];
  }

  function makeHole() {
    const maxR = Math.min(world.w, world.h) * 0.4;
    const base = Math.min(38 + (level - 1) * 20, maxR);
    const stretch = Math.min(1.45, world.w / world.h);  // use wide screens
    const waves = [];
    for (let k = 2; k <= 6; k++) waves.push({ k, a: rand(0.03, 0.1) / (k * 0.5), p: rand(0, Math.PI * 2) });
    hole = { cx: world.w / 2, cy: world.h / 2, rx: base * stretch, ry: base, waves, cracks: [] };
    hole.brush = Math.min(34, 18 + level * 2);

    hole.path = new Path2D();
    for (let i = 0; i <= 120; i++) {
      const [x, y] = rimPoint(i / 120 * Math.PI * 2);
      if (i === 0) hole.path.moveTo(x, y); else hole.path.lineTo(x, y);
    }
    hole.path.closePath();

    // cracks radiating from the rim
    for (let i = 0; i < 5 + level; i++) {
      const a = rand(0, Math.PI * 2);
      let [x, y] = rimPoint(a);
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
    const gx0 = Math.max(0, Math.floor((hole.cx - hole.rx * 1.4) / CELL));
    const gy0 = Math.max(0, Math.floor((hole.cy - hole.ry * 1.4) / CELL));
    const gx1 = Math.min(Math.ceil(world.w / CELL), Math.ceil((hole.cx + hole.rx * 1.4) / CELL));
    const gy1 = Math.min(Math.ceil(world.h / CELL), Math.ceil((hole.cy + hole.ry * 1.4) / CELL));
    const gw = gx1 - gx0, gh = gy1 - gy0;
    const grid = new Array(gw * gh).fill(null);
    cells = [];
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const x = (gx0 + i + 0.5) * CELL, y = (gy0 + j + 0.5) * CELL;
        const dx = (x - hole.cx) / hole.rx, dy = (y - hole.cy) / hole.ry;
        const lim = edge(Math.atan2(dy, dx));
        const d = Math.hypot(dx, dy);
        if (d >= lim) continue;
        const cell = {
          idx: j * gw + i, cx: x, cy: y,
          fill: 0, comp: 0,
          depth: d / lim,           // 0 centre, 1 rim
          dy: dy / lim,             // for rim shadow
          n: Math.random(),         // per-cell noise
        };
        grid[cell.idx] = cell;
        cells.push(cell);
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

  function cellAt(x, y) {
    const i = Math.floor(x / CELL) - hole.gx0, j = Math.floor(y / CELL) - hole.gy0;
    if (i < 0 || j < 0 || i >= hole.gw || j >= hole.gh) return null;
    return hole.grid[j * hole.gw + i];
  }

  function setupWorld() {
    world = { w: canvas.clientWidth || 800, h: canvas.clientHeight || 600 };
    resize();
    background = makeBackground();
    spill = document.createElement('canvas');
    spill.width = world.w;
    spill.height = world.h;
    makeHole();
  }

  function startLevel() {
    setupWorld();
    elapsed = 0;
    poured = 0;
    used = 0;
    particles = [];
    roller = { x: Math.max(60, hole.cx - hole.rx - 90), y: hole.cy, angle: 0, speed: 0, phase: 0 };
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
    if (p === 'fill') ui.hint.textContent = 'Pour inside the hole: asphalt spilled on the road costs accuracy';
    if (p === 'roll') ui.hint.textContent = 'Drag the roller back and forth over the patch until it is smooth';
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
    canvas.setPointerCapture(e.pointerId);
    Object.assign(pointer, toWorld(e), { down: true });
  });
  canvas.addEventListener('pointermove', (e) => Object.assign(pointer, toWorld(e)));
  const release = () => { pointer.down = false; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  ui.ovBtn.addEventListener('click', () => {
    if (phase === 'done') level++;
    startLevel();
  });

  window.addEventListener('resize', resize);

  // ---------- simulation ----------

  function share(key) {
    let n = 0;
    for (const c of cells) if (c[key] >= 1) n++;
    return cells.length ? n / cells.length : 0;
  }

  function accuracy() { return poured > 0 ? used / poured : 1; }

  function updateFill(dt) {
    frameWaste = 0;
    if (!pointer.down) return;
    // Pour onto every cell-sized spot under the nozzle. Asphalt that lands inside
    // the hole counts towards accuracy; the rest spills onto the road.
    const r = hole.brush, r2 = r * r;
    const sg = spill.getContext('2d');
    let framePoured = 0, frameUsed = 0;
    for (let gy = Math.floor((pointer.y - r) / CELL); gy <= Math.floor((pointer.y + r) / CELL); gy++) {
      for (let gx = Math.floor((pointer.x - r) / CELL); gx <= Math.floor((pointer.x + r) / CELL); gx++) {
        const x = (gx + 0.5) * CELL, y = (gy + 0.5) * CELL;
        const d2 = (x - pointer.x) ** 2 + (y - pointer.y) ** 2;
        if (d2 >= r2) continue;
        const a = dt * POUR_RATE * (1 - d2 / r2 * 0.6);
        framePoured += a;
        const c = cellAt(x, y);
        if (c) {
          c.fill = Math.min(1, c.fill + a);
          frameUsed += a;
        } else if (Math.random() < a * 4) {
          const v = Math.floor(rand(55, 95));
          sg.fillStyle = `rgb(${v},${v - 2},${v - 4})`;
          sg.fillRect(x + rand(-4, 4), y + rand(-4, 4), rand(2, 5), rand(2, 5));
        }
      }
    }
    poured += framePoured;
    used += frameUsed;
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
      for (const c of cells) c.fill = 1;
      pointer.down = false;  // make the player press again to drive
      setPhase('roll');
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
    if (pointer.down) {
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

    // compact cells under the front and rear drums, softer at the drum edges
    const amount = Math.abs(step) * 0.022;
    let steaming = false;
    for (const c of cells) {
      if (c.comp >= 1) continue;
      const rx = c.cx - roller.x, ry = c.cy - roller.y;
      const along = rx * cos + ry * sin;
      if (Math.abs(along - 30) >= 11 && Math.abs(along + 30) >= 11) continue;
      const t = Math.abs(-rx * sin + ry * cos) / 31;
      if (t >= 1) continue;
      c.comp = Math.min(1, c.comp + amount * (t < 0.75 ? 1 : (1 - t) / 0.25));
      steaming = true;
    }
    if (steaming && Math.random() < 0.35) {
      const side = Math.random() < 0.5 ? 1 : -1;
      const across = rand(-28, 28);
      particles.push({
        kind: 'steam',
        x: roller.x + cos * 30 * side - sin * across,
        y: roller.y + sin * 30 * side + cos * across,
        vx: rand(-8, 8), vy: rand(-35, -20), r: rand(4, 8), life: 1,
      });
    }
    if (phase === 'roll' && share('comp') >= ROLL_TARGET) {
      for (const c of cells) c.comp = 1;
      finishLevel();
    }
  }

  function finishLevel() {
    setPhase('done');
    pointer.down = false;
    const acc = accuracy();
    const accPts = Math.round(acc * 600 * level);
    const timePts = Math.max(0, Math.round(level * 400 - elapsed * 10));
    const total = accPts + timePts;
    const stars = acc >= 0.8 ? 3 : acc >= 0.6 ? 2 : 1;
    score += total;
    const newBest = score > best;
    if (newBest) { best = score; saveBest(); }
    ui.score.textContent = score;
    ui.best.textContent = best;

    ui.ovTitle.textContent = `Level ${level} paved!`;
    ui.ovText.innerHTML =
      `<div class="stars">${'★'.repeat(stars)}<span class="off">${'★'.repeat(3 - stars)}</span></div>` +
      (newBest ? '<div class="new-best">New best score!</div>' : '') +
      'The next pothole is bigger.';
    ui.ovStats.innerHTML =
      `<span>Fill accuracy</span><b>${Math.round(acc * 100)}%</b><span class="pts">+${accPts}</span>` +
      `<span>Speed</span><b>${elapsed.toFixed(1)}s</b><span class="pts">+${timePts}</span>` +
      `<span class="total">Level total</span><b class="total"></b><span class="total pts">+${total}</span>`;
    ui.ovBtn.textContent = 'Next level';
    setTimeout(() => ui.overlay.classList.remove('hidden'), 600);
  }

  function update(dt) {
    if (phase === 'fill' || phase === 'roll') elapsed += dt;
    if (phase === 'fill') updateFill(dt);
    if (phase === 'roll' || phase === 'done') updateRoll(dt);

    for (const p of particles) {
      if (p.kind === 'chunk') p.y += p.vy * dt;
      else { p.x += p.vx * dt; p.y += p.vy * dt; p.r += dt * 10; p.life -= dt * 1.3; }
    }
    particles = particles.filter((p) => (p.kind === 'chunk' ? p.y < p.ty : p.life > 0));

    ui.time.textContent = elapsed.toFixed(1);
    ui.acc.textContent = phase === 'intro' ? '–' : `${Math.round(accuracy() * 100)}%`;
    let pct = 0, label = '';
    if (phase === 'fill') { pct = share('fill') / FILL_TARGET; label = 'Fill'; }
    else if (phase === 'roll') { pct = share('comp') / ROLL_TARGET; label = 'Roll'; }
    else if (phase === 'done') { pct = 1; label = 'Done'; }
    pct = Math.min(1, pct);
    ui.bar.style.width = `${pct * 100}%`;
    ui.barLabel.textContent = label ? `${label} ${Math.round(pct * 100)}%` : '';
  }

  // ---------- rendering ----------

  function paintHole() {
    const d = hole.data.data;
    const put = (idx, c) => {
      // empty hole: dirty gravel, darker under the rim
      const shade = 0.55 + 0.35 * ((c.dy + 1) / 2) + 0.1 * c.depth;
      const hr = (60 + c.n * 25) * shade, hg = (52 + c.n * 20) * shade, hb = (42 + c.n * 15) * shade;
      // fresh loose asphalt: lumpy and grey; compacted: smooth and black
      const lump = (c.n - 0.5) * 40, sm = (c.n - 0.5) * 6;
      const ar = 78 + lump + (30 + sm - 78 - lump) * c.comp;
      const ag = 76 + lump + (31 + sm - 76 - lump) * c.comp;
      const ab = 74 + lump + (34 + sm - 74 - lump) * c.comp;
      const o = idx * 4;
      d[o] = hr + (ar - hr) * c.fill;
      d[o + 1] = hg + (ag - hg) * c.fill;
      d[o + 2] = hb + (ab - hb) * c.fill;
      d[o + 3] = 255;
    };
    for (const c of cells) put(c.idx, c);
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

    if (hole) {
      ctx.strokeStyle = 'rgba(25,25,25,0.8)';
      ctx.lineWidth = 1.5;
      for (const pts of hole.cracks) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const [x, y] of pts) ctx.lineTo(x, y);
        ctx.stroke();
      }
      paintHole();
    }

    for (const p of particles) {
      if (p.kind !== 'chunk') continue;
      ctx.fillStyle = `rgb(${p.v},${p.v},${p.v})`;
      ctx.fillRect(p.x, p.y, p.s, p.s);
    }

    if (phase === 'fill' && hole) {
      // nozzle ring turns red when most of the pour is being wasted
      const wasting = pointer.down && frameWaste > 0.5;
      ctx.strokeStyle = wasting ? '#e5533d' : pointer.down ? '#f2b705' : 'rgba(242,183,5,0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, hole.brush, 0, Math.PI * 2);
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
  requestAnimationFrame(frame);
})();
