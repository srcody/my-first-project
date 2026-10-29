// Pothole Patrol: fill the pothole with asphalt, then roll it flat.
(() => {
  const CELL = 6;             // size of one simulation cell in world pixels
  const FILL_TARGET = 0.97;   // share of cells that must be full before rolling
  const ROLL_TARGET = 0.97;   // share of cells that must be compacted to finish
  const BRUSH = 24;           // pour radius
  const ROLLER_SPEED = 420;   // max roller speed in px/s

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = {
    level: $('level'), time: $('time'), score: $('score'),
    shovel: $('tool-shovel'), roller: $('tool-roller'),
    bar: $('bar'), barLabel: $('bar-label'), hint: $('hint'),
    overlay: $('overlay'), ovTitle: $('ov-title'), ovText: $('ov-text'), ovBtn: $('ov-btn'),
  };

  let world = { w: 800, h: 600 };     // logical size, fixed for the duration of a level
  let view = { scale: 1, ox: 0, oy: 0 };
  let background = null;              // offscreen canvas with the road texture
  let cells = [];                     // cells inside the pothole
  let hole = null;
  let level = 1, score = 0, elapsed = 0;
  let phase = 'intro';                // intro | fill | roll | done
  let pointer = { x: 0, y: 0, down: false };
  let roller = { x: 0, y: 0, angle: 0 };
  let particles = [];
  let lastTime = performance.now();

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

  function rand(a, b) { return a + Math.random() * (b - a); }

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

  function makeHole() {
    const maxR = Math.min(world.w, world.h) * 0.4;
    const base = Math.min(38 + (level - 1) * 20, maxR);
    const stretch = Math.min(1.45, world.w / world.h);  // use wide screens
    const waves = [];
    for (let k = 2; k <= 6; k++) waves.push({ k, a: rand(0.03, 0.1) / (k * 0.5), p: rand(0, Math.PI * 2) });
    hole = { cx: world.w / 2, cy: world.h / 2, r: base, rx: base * stretch, ry: base, waves, cracks: [] };

    // cracks radiating from the rim
    for (let i = 0; i < 5 + level; i++) {
      const a = rand(0, Math.PI * 2);
      let x = hole.cx + Math.cos(a) * hole.rx * edge(a);
      let y = hole.cy + Math.sin(a) * hole.ry * edge(a);
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

    cells = [];
    for (let gy = 0; gy < world.h; gy += CELL) {
      for (let gx = 0; gx < world.w; gx += CELL) {
        const x = gx + CELL / 2, y = gy + CELL / 2;
        const dx = (x - hole.cx) / hole.rx, dy = (y - hole.cy) / hole.ry;
        const d = Math.hypot(dx, dy);
        const lim = edge(Math.atan2(dy, dx));
        if (d < lim) {
          cells.push({
            x: gx, y: gy, cx: x, cy: y,
            fill: 0, comp: 0,
            depth: d / lim,           // 0 centre, 1 rim
            dy: dy / lim,             // for rim shadow
            n: Math.random(),         // per-cell noise
          });
        }
      }
    }
  }

  // radius multiplier of the blob outline at angle a
  function edge(a) {
    let m = 1;
    for (const w of hole.waves) m += w.a * Math.sin(w.k * a + w.p);
    return m;
  }

  function startLevel() {
    world = { w: canvas.clientWidth || 800, h: canvas.clientHeight || 600 };
    resize();
    background = makeBackground();
    makeHole();
    elapsed = 0;
    particles = [];
    roller = { x: Math.max(60, hole.cx - hole.rx - 90), y: hole.cy, angle: 0 };
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
    if (p === 'fill') ui.hint.textContent = 'Hold and drag over the pothole to pour asphalt';
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

  function share(key, min) {
    let n = 0;
    for (const c of cells) if (c[key] >= min) n++;
    return cells.length ? n / cells.length : 0;
  }

  function updateFill(dt) {
    if (!pointer.down) return;
    const r2 = BRUSH * BRUSH;
    for (const c of cells) {
      const dx = c.cx - pointer.x, dy = c.cy - pointer.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) c.fill = Math.min(1, c.fill + dt * 3.2 * (1 - d2 / r2 * 0.6));
    }
    for (let i = 0; i < 3; i++) {
      particles.push({
        x: pointer.x + rand(-BRUSH, BRUSH) * 0.7,
        y: pointer.y - rand(30, 60),
        vy: rand(150, 260),
        ty: pointer.y + rand(-BRUSH, BRUSH) * 0.6,
        s: rand(2, 4.5),
        v: Math.floor(rand(40, 90)),
      });
    }
    if (share('fill', 1) >= FILL_TARGET) {
      for (const c of cells) c.fill = 1;
      pointer.down = false;  // make the player press again to drive
      setPhase('roll');
    }
  }

  function updateRoll(dt) {
    if (!pointer.down) return;
    const dx = pointer.x - roller.x, dy = pointer.y - roller.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return;
    const step = Math.min(dist, ROLLER_SPEED * dt);
    const target = Math.atan2(dy, dx);
    // turn smoothly; a roller can drive forwards or backwards
    let diff = normAngle(target - roller.angle);
    let reverse = false;
    if (Math.abs(diff) > Math.PI / 2) { diff = normAngle(diff + Math.PI); reverse = true; }
    roller.angle = normAngle(roller.angle + diff * Math.min(1, dt * 10));
    const dir = reverse ? -1 : 1;
    roller.x += Math.cos(roller.angle) * step * dir;
    roller.y += Math.sin(roller.angle) * step * dir;
    roller.x = Math.max(0, Math.min(world.w, roller.x));
    roller.y = Math.max(0, Math.min(world.h, roller.y));

    // compact cells under the front and rear drums
    const cos = Math.cos(roller.angle), sin = Math.sin(roller.angle);
    const amount = step * 0.022;
    for (const c of cells) {
      const rx = c.cx - roller.x, ry = c.cy - roller.y;
      const along = rx * cos + ry * sin;
      const across = -rx * sin + ry * cos;
      if (Math.abs(across) < 31 && (Math.abs(along - 30) < 11 || Math.abs(along + 30) < 11)) {
        c.comp = Math.min(1, c.comp + amount);
      }
    }
    if (share('comp', 1) >= ROLL_TARGET) {
      for (const c of cells) c.comp = 1;
      finishLevel();
    }
  }

  function normAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function finishLevel() {
    setPhase('done');
    const points = Math.max(100, Math.round(level * 1000 - elapsed * 15));
    score += points;
    ui.score.textContent = score;
    ui.ovTitle.textContent = `Level ${level} paved!`;
    ui.ovText.textContent = `Smooth as glass in ${elapsed.toFixed(1)}s. +${points} points. The next pothole is bigger.`;
    ui.ovBtn.textContent = 'Next level';
    setTimeout(() => ui.overlay.classList.remove('hidden'), 500);
  }

  function update(dt) {
    if (phase === 'fill' || phase === 'roll') elapsed += dt;
    if (phase === 'fill') updateFill(dt);
    if (phase === 'roll') updateRoll(dt);

    for (const p of particles) p.y += p.vy * dt;
    particles = particles.filter((p) => p.y < p.ty);

    ui.time.textContent = elapsed.toFixed(1);
    let pct = 0, label = '';
    if (phase === 'fill') { pct = share('fill', 1) / FILL_TARGET; label = 'Fill'; }
    else if (phase === 'roll') { pct = share('comp', 1) / ROLL_TARGET; label = 'Roll'; }
    else if (phase === 'done') { pct = 1; label = 'Done'; }
    pct = Math.min(1, pct);
    ui.bar.style.width = `${pct * 100}%`;
    ui.barLabel.textContent = label ? `${label} ${Math.round(pct * 100)}%` : '';
  }

  // ---------- rendering ----------

  function cellColor(c) {
    // empty hole: dirty gravel, darker under the rim
    const shade = 0.55 + 0.35 * ((c.dy + 1) / 2) + 0.1 * c.depth;
    const hr = (60 + c.n * 25) * shade, hg = (52 + c.n * 20) * shade, hb = (42 + c.n * 15) * shade;
    // fresh loose asphalt: lumpy and grey; compacted: smooth and black
    const lump = (c.n - 0.5) * 40;
    const fr = 78 + lump, fg = 76 + lump, fb = 74 + lump;
    const sm = (c.n - 0.5) * 6;
    const cr = 30 + sm, cg = 31 + sm, cb = 34 + sm;
    const ar = fr + (cr - fr) * c.comp, ag = fg + (cg - fg) * c.comp, ab = fb + (cb - fb) * c.comp;
    const f = c.fill;
    return `rgb(${hr + (ar - hr) * f | 0},${hg + (ag - hg) * f | 0},${hb + (ab - hb) * f | 0})`;
  }

  function drawRoller() {
    ctx.save();
    ctx.translate(roller.x, roller.y);
    ctx.rotate(roller.angle);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-44, -30, 92, 66);
    // drums
    for (const x of [30, -30]) {
      const grad = ctx.createLinearGradient(x - 11, 0, x + 11, 0);
      grad.addColorStop(0, '#6b6e72');
      grad.addColorStop(0.5, '#c9ccd0');
      grad.addColorStop(1, '#6b6e72');
      ctx.fillStyle = grad;
      ctx.fillRect(x - 11, -31, 22, 62);
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
    // headlight hint showing the driving direction
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

    if (hole) {
      // cracks
      ctx.strokeStyle = 'rgba(25,25,25,0.8)';
      ctx.lineWidth = 1.5;
      for (const pts of hole.cracks) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const [x, y] of pts) ctx.lineTo(x, y);
        ctx.stroke();
      }
      for (const c of cells) {
        ctx.fillStyle = cellColor(c);
        ctx.fillRect(c.x, c.y, CELL + 0.5, CELL + 0.5);
      }
    }

    for (const p of particles) {
      ctx.fillStyle = `rgb(${p.v},${p.v},${p.v})`;
      ctx.fillRect(p.x, p.y, p.s, p.s);
    }

    if (phase === 'fill' && hole) {
      // pour nozzle
      ctx.strokeStyle = pointer.down ? '#f2b705' : 'rgba(242,183,5,0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, BRUSH, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (phase === 'roll' || phase === 'done') drawRoller();

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
  world = { w: canvas.clientWidth || 800, h: canvas.clientHeight || 600 };
  resize();
  background = makeBackground();
  makeHole();
  ui.hint.style.opacity = 0;
  requestAnimationFrame(frame);
})();
