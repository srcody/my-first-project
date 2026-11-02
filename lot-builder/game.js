// Lot Builder: build a parking lot from bare grass to an inspected, striped lot.
// The world is measured in grid cells; the lot itself is COLS x ROWS cells.
(() => {
  "use strict";

  const COLS = 10, ROWS = 7;          // lot size in cells
  const LX = 4, LY = 2;               // lot offset inside the world
  const WW = 17, WH = 11;             // world size in cells
  const PX = 52;                      // pixels per cell on the canvas
  const F = 4;                        // paint grid resolution per cell
  const AMBIENT = 78;                 // °F
  const STALL_ROWS = 2;               // stall depth in cells

  const SPEC = {
    cutMin: 4, cutMax: 6, cutTarget: 5,
    subMin: 95,
    baseMin: 2, baseMax: 3, baseCMin: 95, baseLoose: 3,
    aspLoose: 2.5, aspMinT: 1.75, aspMaxT: 2.5, aspDMin: 92,
    breakdownF: 200, finishF: 160, layTemp: 300,
    stripeMin: 0.85,
  };

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = WW * PX * DPR;
  canvas.height = WH * PX * DPR;

  // ---------- Static layout ----------
  const TRUCKS = {
    haul:    { x: 1.6, y: 3.0, label: "Haul truck", bed: "#c9a227" },
    stone:   { x: 1.6, y: 5.8, label: "Stone",      bed: "#8f9196" },
    asphalt: { x: 1.6, y: 8.6, label: "Hot mix",    bed: "#3d3836" },
  };
  const HAUL_CAP = 120;               // cell-inches of spoil per truck
  const HAUL_AWAY = 5;                // seconds a full truck is gone

  // tracked machines can pivot in place; wheeled ones need to be rolling to steer
  const MACHINE_DEFS = [
    { id: "exc",    name: "Excavator",         speed: 2.2, turn: 1.9, len: 1.6, wid: 1.2, color: "#e8a922", tracked: true, cap: 40 },
    { id: "steel",  name: "Steel drum roller", speed: 2.6, turn: 1.8, len: 1.7, wid: 1.3, color: "#e3c230" },
    { id: "spread", name: "Stone spreader",    speed: 2.0, turn: 2.0, len: 1.6, wid: 1.7, color: "#dc6c2a", tracked: true, cap: 60 },
    { id: "paver",  name: "Paver",             speed: 1.5, turn: 1.5, len: 1.8, wid: 2.0, color: "#ecc81e", tracked: true, cap: 60 },
    { id: "pneu",   name: "Pneumatic roller",  speed: 2.6, turn: 1.8, len: 1.6, wid: 1.5, color: "#e3c230" },
    { id: "stripe", name: "Line striper",      speed: 1.6, turn: 2.6, len: 0.9, wid: 0.6, color: "#e9e7e0" },
    { id: "crew",   name: "Layout crew",       speed: 3.0, turn: 5.0, len: 0.45, wid: 0.45, color: "#ff8a2a", tracked: true },
  ];
  const PARK = {
    exc:    [5.6, 0.9, 0],
    steel:  [8.3, 0.9, 0],
    pneu:   [11.0, 0.9, 0],
    spread: [15.5, 0.95, Math.PI / 2],
    paver:  [15.6, 3.6, Math.PI / 2],
    stripe: [15.6, 6.2, Math.PI / 2],
    crew:   [15.6, 8.6, Math.PI],
  };

  const STAKES = [
    [LX, LY], [LX + COLS, LY], [LX, LY + ROWS], [LX + COLS, LY + ROWS],
    [LX + COLS / 2, LY], [LX + COLS / 2, LY + ROWS],
  ];
  const SIGNS = [[LX + 0.5, LY + ROWS + 0.5], [LX + 2.5, LY + ROWS + 0.5]];

  // ---------- Stripe layout (paint grid) ----------
  // Top row: 10 stalls. Bottom row: accessible stall, hatched van aisle and
  // accessible stall in columns 0–2, then 7 regular stalls. 19 stalls total.
  const PW = COLS * F, PH = ROWS * F;
  const target = new Uint8Array(PW * PH); // 0 none, 1 white, 2 blue
  (function buildLayout() {
    const lineX = (i) => Math.min(i * F, PW - 1);
    const depth = STALL_ROWS * F;
    for (let i = 0; i <= COLS; i++) {
      for (let fy = 0; fy < depth; fy++) target[fy * PW + lineX(i)] = 1;
      for (let fy = PH - depth; fy < PH; fy++) target[fy * PW + lineX(i)] = i <= 3 ? 2 : 1;
    }
    for (let fy = PH - depth; fy < PH; fy++) {
      for (let fx = F + 1; fx < 2 * F; fx++) if ((fx + fy) % 3 === 0) target[fy * PW + fx] = 2;
    }
  })();
  const TARGET_COUNT = [0, 0, 0];
  for (const t of target) TARGET_COUNT[t]++;

  // ---------- Textures ----------
  function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
  function tile(size, paint) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    paint(c.getContext("2d"), size);
    return ctx.createPattern(c, "repeat");
  }
  const TEX = {
    grass: tile(128, (g, s) => {
      const r = rng(7);
      g.fillStyle = "#4e7a31"; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = r() < 0.5 ? "rgba(120,170,70,.35)" : "rgba(30,60,20,.3)";
        const x = r() * s, y = r() * s;
        g.fillRect(x, y, 1.5, 3 + r() * 4);
      }
    }),
    dirt: tile(128, (g, s) => {
      const r = rng(11);
      g.fillStyle = "#86663f"; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 70; i++) {
        g.fillStyle = `rgba(${r() < 0.5 ? "60,40,20" : "170,135,90"},${0.15 + r() * 0.2})`;
        g.beginPath(); g.arc(r() * s, r() * s, 2 + r() * 7, 0, 7); g.fill();
      }
      for (let i = 0; i < 300; i++) { g.fillStyle = "rgba(40,25,10,.25)"; g.fillRect(r() * s, r() * s, 1.5, 1.5); }
    }),
    stone: tile(96, (g, s) => {
      const r = rng(23);
      g.fillStyle = "#8d8c87"; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 420; i++) {
        const v = 110 + r() * 90 | 0;
        g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
        g.beginPath(); g.arc(r() * s, r() * s, 1 + r() * 2.4, 0, 7); g.fill();
      }
    }),
    asphalt: tile(96, (g, s) => {
      const r = rng(31);
      g.fillStyle = "#2a2b2f"; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 900; i++) {
        const v = 30 + r() * 45 | 0;
        g.fillStyle = `rgba(${v},${v},${v + 4},.9)`;
        g.fillRect(r() * s, r() * s, 1.2, 1.2);
      }
    }),
    gravel: tile(96, (g, s) => {
      const r = rng(5);
      g.fillStyle = "#6b6458"; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 380; i++) {
        const v = 80 + r() * 70 | 0;
        g.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
        g.beginPath(); g.arc(r() * s, r() * s, 0.8 + r() * 1.8, 0, 7); g.fill();
      }
    }),
  };

  // ---------- State ----------
  let S;

  function freshCell() {
    return {
      cut: 0,            // inches below original grade
      sub: 85,           // subgrade compaction, % Proctor
      base: 0,           // loose stone placed, inches
      baseC: 80,         // stone compaction, % Proctor
      asp: 0,            // loose asphalt placed, inches
      aspD: 82,          // asphalt density, % Gmm
      temp: AMBIENT,
      fin: 0,            // pneumatic finish (cell-distance rolled while hot)
      cold: false,       // rolled after it was too cold
    };
  }

  function reset() {
    S = {
      cells: Array.from({ length: COLS * ROWS }, freshCell),
      paint: new Uint8Array(PW * PH),
      machines: MACHINE_DEFS.map((d) => {
        const [x, y, a] = PARK[d.id];
        return { ...d, x, y, a, v: 0, w: 0, odo: 0, load: 0, tool: false, anim: 0, swing: 0, swingT: 0, bump: 0 };
      }),
      sel: 0,
      grade: true,
      color: 1,
      overlay: 0,
      haul: { load: 0, away: 0, trips: 0 },
      stakes: STAKES.map(() => false),
      signs: SIGNS.map(() => false),
      cured: false,
      night: 0,
      day: 1,
      time: 0,
      log: [],
      lastMsg: {},
      parts: [],
      floats: [],
      doneCount: 0,
    };
    say("Morning. Grass lot, bare dirt underneath. Start with the excavator (1).");
    renderMachineButtons();
    $("report").innerHTML = '<p class="muted">No inspection yet.</p>';
  }

  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const approach = (v, t, step) => (v < t ? Math.min(t, v + step) : Math.max(t, v - step));
  const cur = () => S.machines[S.sel];
  const idx = (cx, cy) => cy * COLS + cx;
  const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

  function cellAt(x, y) {
    const cx = Math.floor(x - LX), cy = Math.floor(y - LY);
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return null;
    return S.cells[idx(cx, cy)];
  }
  const baseT = (c) => c.base * (1 - 0.25 * (c.baseC - 80) / 20);
  const aspT = (c) => c.asp * 82 / c.aspD;
  const surface = (c) => -c.cut + baseT(c) + aspT(c);
  const subOK = (c) => c.cut >= SPEC.cutMin && c.cut <= SPEC.cutMax && c.sub >= SPEC.subMin;
  const baseOK = (c) => baseT(c) >= SPEC.baseMin && baseT(c) <= SPEC.baseMax && c.baseC >= SPEC.baseCMin;

  // Point `off` cells ahead and `side` cells to the right of a machine.
  function local(m, off, side = 0) {
    const ca = Math.cos(m.a), sa = Math.sin(m.a);
    return [m.x + ca * off - sa * side, m.y + sa * off + ca * side];
  }

  // Cells under a strip across the machine, `off` cells ahead of its center.
  function footprint(m, off, half) {
    const out = new Set();
    for (let s = -half; s <= half + 1e-6; s += 0.3) {
      const c = cellAt(...local(m, off, s));
      if (c) out.add(c);
    }
    return out;
  }

  function near(m, p, r = 2.6) { return Math.hypot(m.x - p.x, m.y - p.y) < r; }

  function say(text, key) {
    const now = performance.now();
    if (key) {
      if (S.lastMsg[key] && now - S.lastMsg[key] < 2500) return;
      S.lastMsg[key] = now;
    }
    S.log.unshift(text);
    S.log.length = Math.min(S.log.length, 12);
    $("log").innerHTML = S.log.map((t) => `<li>${t}</li>`).join("");
  }

  function float(x, y, text, color = "#fff") {
    S.floats.push({ x, y, text, color, life: 1.6 });
  }

  function beep(freq = 440, dur = 0.12, type = "square") {
    try {
      const ac = beep.ac || (beep.ac = new (window.AudioContext || window.webkitAudioContext)());
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = freq; o.type = type;
      g.gain.setValueAtTime(0.045, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.connect(g).connect(ac.destination);
      o.start(); o.stop(ac.currentTime + dur);
    } catch (e) { /* audio is optional */ }
  }

  // ---------- Particles ----------
  function puff(x, y, n, opt) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (opt.speed ?? 0.6) * (0.4 + Math.random());
      S.parts.push({
        x: x + (Math.random() - 0.5) * (opt.spread ?? 0.3),
        y: y + (Math.random() - 0.5) * (opt.spread ?? 0.3),
        vx: Math.cos(a) * sp + (opt.vx ?? 0), vy: Math.sin(a) * sp + (opt.vy ?? 0),
        life: opt.life ?? 0.8, max: opt.life ?? 0.8,
        size: (opt.size ?? 0.12) * (0.6 + Math.random() * 0.8),
        grow: opt.grow ?? 0.3, color: opt.color, kind: opt.kind ?? "dust",
      });
    }
    if (S.parts.length > 700) S.parts.splice(0, S.parts.length - 700);
  }

  // ---------- Input ----------
  const keys = { up: false, down: false, left: false, right: false, action: false, slow: false };
  const KEYMAP = {
    ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
    ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
    ShiftLeft: "slow", ShiftRight: "slow",
  };

  addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, textarea")) return;
    if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); return; }
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) pressAction();
      keys.action = true;
      return;
    }
    if (e.repeat) return;
    if (/^Digit[1-7]$/.test(e.code)) select(+e.code.slice(5) - 1);
    else if (e.code === "Tab") { e.preventDefault(); select((S.sel + 1) % S.machines.length); }
    else if (e.code === "KeyG") { S.grade = !S.grade; say(`Grade control ${S.grade ? "on: cuts stop at 5″, stone stops at 3″ loose" : "off: watch your depth"}.`); }
    else if (e.code === "KeyC") toggleColor();
    else if (e.code === "KeyV") { S.overlay = (S.overlay + 1) % 4; say(`Overlay: ${["off", "cut depth", "compaction", "mat temperature"][S.overlay]}.`); }
    else if (e.code === "KeyN") cure();
    else if (e.code === "KeyI") inspect();
    else if (e.code === "KeyR") {
      const now = performance.now();
      if (now - (S.restartAsk || 0) < 2500) reset();
      else { S.restartAsk = now; say("Press R again to restart the job from bare grass."); }
    }
  });
  addEventListener("keyup", (e) => {
    if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false;
    if (e.code === "Space") keys.action = false;
  });
  addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

  document.querySelectorAll(".touch button").forEach((b) => {
    const k = b.dataset.k;
    const down = (e) => {
      e.preventDefault();
      if (k === "switch") { select((S.sel + 1) % S.machines.length); return; }
      if (k === "action") pressAction();
      keys[k] = true;
    };
    const up = () => { if (k !== "switch") keys[k] = false; };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointerleave", up);
    b.addEventListener("pointercancel", up);
  });

  $("cure").addEventListener("click", cure);
  $("inspect").addEventListener("click", inspect);

  function select(i) {
    if (i === S.sel) return;
    S.machines[S.sel].v = 0; S.machines[S.sel].w = 0;
    S.sel = i;
    renderMachineButtons();
    say(`In the seat: ${cur().name}.`, "sel" + i);
    beep(300, 0.05, "triangle");
  }

  function renderMachineButtons() {
    $("machines").innerHTML = S.machines
      .map((m, i) => `<button class="${i === S.sel ? "on" : ""}" data-i="${i}">${i + 1} ${m.name}</button>`)
      .join("");
    $("machines").querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => select(+b.dataset.i)));
  }

  function toggleColor() {
    S.color = S.color === 1 ? 2 : 1;
    say(`Striper loaded with ${S.color === 1 ? "white" : "blue"} paint.`);
  }

  // Single-press actions: loading/unloading at trucks and tool toggles.
  function pressAction() {
    const m = cur();
    switch (m.id) {
      case "exc":
        if (near(m, TRUCKS.haul, 2.8) && m.load > 0) dumpSpoil(m);
        break;
      case "spread":
        if (near(m, TRUCKS.stone)) {
          if (S.cured) { say("Base is long buried. No more stone needed.", "stone"); break; }
          m.load = m.cap; beep(330); say("Spreader box full of stone.");
          puff(TRUCKS.stone.x + 0.6, TRUCKS.stone.y, 14, { color: "150,150,145", life: 0.7, speed: 0.9 });
        }
        break;
      case "paver":
        if (near(m, TRUCKS.asphalt)) {
          if (S.cured) { say("Paving is done. The plant has closed out the job.", "plant"); break; }
          m.load = m.cap; beep(330); say("Hot mix in the hopper at 300°F.");
          puff(TRUCKS.asphalt.x + 0.6, TRUCKS.asphalt.y, 18, { color: "235,235,235", kind: "steam", life: 1.4, speed: 0.3, vy: -0.4 });
        } else {
          m.tool = !m.tool; beep(m.tool ? 260 : 200, 0.08, "triangle");
          say(`Screed ${m.tool ? "down: paving behind you" : "up"}.`);
        }
        break;
      case "steel":
      case "pneu":
        beep(240, 0.3, "sawtooth"); say("Horn. Everybody look up.", "horn");
        break;
      case "stripe":
        if (!S.cured) { say("Fresh mat. Stripe after it cures overnight (N).", "nostripe"); break; }
        if (S.stakes.some((s) => !s)) { say("Layout isn't staked yet. Walk the crew (7) to the amber beacons.", "nostake"); break; }
        m.tool = !m.tool; beep(m.tool ? 500 : 380, 0.05, "triangle");
        say(`Spray ${m.tool ? "on" : "off"} (${S.color === 1 ? "white" : "blue"}).`);
        break;
      case "crew": {
        const i = SIGNS.findIndex(([x, y], k) => !S.signs[k] && Math.hypot(m.x - x, m.y - y) < 0.9);
        if (i < 0) { say("Nothing to set here. Signs go at the head of the blue stalls.", "nosign"); break; }
        if (!S.cured) { say("Wait for the lot to cure before setting signs.", "signcure"); break; }
        S.signs[i] = true; beep(520);
        float(SIGNS[i][0], SIGNS[i][1] - 0.6, `Sign ${i + 1}/2`, "#7fb0ff");
        say(`Accessible parking sign ${i + 1} of 2 set.`);
        break;
      }
    }
  }

  function dumpSpoil(m) {
    const h = S.haul, t = TRUCKS.haul;
    if (h.away > 0) { say("Haul truck is out. Next one is a few seconds away.", "away"); return; }
    const amt = Math.min(m.load, HAUL_CAP - h.load);
    m.load -= amt; h.load += amt;
    m.swing = angDiff(m.a, Math.atan2(t.y - m.y, t.x - m.x)); m.swingT = 0.7;
    beep(140, 0.25, "sawtooth");
    puff(t.x, t.y - 0.3, 22, { color: "120,90,55", speed: 0.8, life: 0.9, spread: 0.8 });
    if (h.load >= HAUL_CAP - 0.01) {
      h.load = 0; h.away = HAUL_AWAY; h.trips++;
      float(t.x, t.y - 1.6, `Truck ${h.trips} out`, "#f2a93b");
      say(`Truck ${h.trips} loaded and pulling out.`);
    } else {
      say(`Bucket dumped. Truck at ${Math.round(h.load / HAUL_CAP * 100)}%.`);
    }
  }

  // ---------- Movement & collision ----------
  function circles(m) {
    const n = m.len > m.wid * 1.2 ? 2 : 1, r = m.wid / 2 * 0.95;
    if (n === 1) return [[m.x, m.y, Math.max(m.len, m.wid) / 2 * 0.9]];
    const o = m.len / 2 - r;
    return [local(m, o).concat(r), local(m, -o).concat(r)];
  }
  function obstacles(self) {
    const out = [];
    for (const m of S.machines) if (m !== self) out.push(...circles(m));
    for (const [k, t] of Object.entries(TRUCKS)) {
      if (k === "haul" && S.haul.away > 0) continue;
      out.push([t.x, t.y - 0.7, 0.62], [t.x, t.y + 0.7, 0.62]);
    }
    return out;
  }
  function collide(m) {
    let hit = false;
    const obs = obstacles(m);
    for (let iter = 0; iter < 3; iter++) {
      for (const [cx, cy, cr] of circles(m)) {
        for (const [ox, oy, or] of obs) {
          const dx = cx - ox, dy = cy - oy, dist = Math.hypot(dx, dy), min = cr + or;
          if (dist < min && dist > 1e-6) {
            const push = (min - dist) / dist;
            m.x += dx * push; m.y += dy * push; hit = true;
          }
        }
      }
    }
    m.x = clamp(m.x, 0.4, WW - 0.4);
    m.y = clamp(m.y, 0.4, WH - 0.4);
    return hit;
  }

  function drive(m, dt) {
    const fwd = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    const steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const slow = keys.slow ? 0.35 : 1;
    const top = m.speed * slow * (fwd < 0 ? 0.6 : 1);
    const want = top * fwd;
    // ease into and out of speed; braking is quicker than accelerating
    const rate = fwd === 0 || Math.sign(want) !== Math.sign(m.v) ? 5 : 2.6;
    m.v = approach(m.v, want, rate * dt);

    // tracked machines pivot; wheeled ones steer more the faster they roll
    const grip = m.tracked ? 1 : clamp(Math.abs(m.v) / m.speed * 1.6, 0.2, 1);
    const dir = m.v < -0.05 ? -1 : 1;
    m.w = approach(m.w, steer * m.turn * grip * dir, 8 * dt);
    m.a += m.w * dt;

    const ox = m.x, oy = m.y;
    m.x += Math.cos(m.a) * m.v * dt;
    m.y += Math.sin(m.a) * m.v * dt;
    if (collide(m)) {
      if (Math.abs(m.v) > 0.8 && m.bump <= 0) { beep(90, 0.12, "triangle"); m.bump = 0.5; }
      m.v *= 0.5;
    }
    m.bump -= dt;
    const d = Math.hypot(m.x - ox, m.y - oy);
    m.odo += d * (m.v < 0 ? -1 : 1);

    // dust behind machines rolling on bare dirt or stone
    if (d > 0 && m.id !== "crew" && Math.random() < Math.abs(m.v) * dt * 6) {
      const [bx, by] = local(m, -m.len / 2, (Math.random() - 0.5) * m.wid);
      const c = cellAt(bx, by);
      if (!c || c.asp === 0) {
        const col = !c || (c.cut < 0.05 && c.base === 0) ? null : c.base > 0 ? "150,148,140" : "140,110,75";
        if (col) puff(bx, by, 1, { color: col, life: 0.8, speed: 0.15, size: 0.1, grow: 0.25 });
      }
    }
    return d;
  }

  // ---------- Simulation ----------
  function update(dt) {
    S.time += dt;
    const h = S.haul;
    if (h.away > 0) h.away = Math.max(0, h.away - dt);

    const m = cur();
    const d = drive(m, dt);

    for (const mm of S.machines) {
      if (mm.swingT > 0) mm.swingT -= dt;
      else mm.swing = approach(mm.swing, 0, 3 * dt);
      if (mm !== m) mm.anim += dt * 0.3;
    }

    // Hot mix cools everywhere, whichever machine you're in.
    if (!S.cured) {
      for (let i = 0; i < S.cells.length; i++) {
        const c = S.cells[i];
        if (c.asp <= 0) continue;
        c.temp = Math.max(AMBIENT, c.temp - 0.9 * dt);
        if (c.temp > 200 && Math.random() < dt * (c.temp - 200) / 160) {
          puff(LX + (i % COLS) + Math.random(), LY + Math.floor(i / COLS) + Math.random(), 1,
            { color: "245,245,245", kind: "steam", life: 1.2, speed: 0.04, vy: -0.3, size: 0.07, grow: 0.16 });
        }
      }
    }

    switch (m.id) {
      case "exc":
        if (keys.action && !near(m, TRUCKS.haul, 2.8)) { m.anim += dt * 7; dig(m, dt); }
        break;
      case "steel":  if (d > 0) rollSteel(m, d); break;
      case "pneu":   if (d > 0) rollPneu(m, d); break;
      case "spread": if (keys.action) spread(m, dt); break;
      case "paver":  if (m.tool && d > 0) pave(m); break;
      case "stripe": if (m.tool) spray(m); break;
      case "crew":   m.anim += d * 9; walkStakes(m); break;
    }
    if (m.id !== "crew") m.anim += Math.abs(m.v) * dt * 0.5;

    for (const p of S.parts) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - 2 * dt; p.vy *= p.kind === "steam" ? 1 : 1 - 2 * dt;
      p.size += p.grow * dt; p.life -= dt;
    }
    S.parts = S.parts.filter((p) => p.life > 0);
    for (const f of S.floats) { f.life -= dt; f.y -= dt * 0.5; }
    S.floats = S.floats.filter((f) => f.life > 0);
    if (S.night > 0) S.night = Math.max(0, S.night - dt);
  }

  function dig(m, dt) {
    if (m.load >= m.cap - 0.01) { say("Bucket full. Swing over to the haul truck and press Space.", "full"); return; }
    const rate = 5 * dt;
    let moved = 0;
    for (const c of footprint(m, 1.7, 0.45)) {
      const room = m.cap - m.load - moved;
      if (room <= 0) break;
      if (c.asp > 0) {
        if (S.cured) { say("That's cured asphalt. Not tearing that out.", "cured"); continue; }
        const r = Math.min(rate, c.asp, room); c.asp -= r; moved += r;
        if (c.asp <= 0.01) { c.asp = 0; c.aspD = 82; c.temp = AMBIENT; c.fin = 0; c.cold = false; }
      } else if (c.base > 0) {
        const r = Math.min(rate, c.base, room); c.base -= r; moved += r;
        if (c.base <= 0.01) { c.base = 0; c.baseC = 80; }
      } else {
        const limit = S.grade ? SPEC.cutTarget : 9;
        if (c.cut >= limit - 0.001) { if (S.grade) say("Grade control: cut is at 5″ here.", "gc"); continue; }
        const r = Math.min(rate, limit - c.cut, room); c.cut += r; moved += r;
        c.sub = 85; // disturbed soil loses its compaction
      }
    }
    m.load += moved;
    if (moved > 0 && Math.random() < 0.5) {
      const [bx, by] = local(m, 1.65);
      puff(bx, by, 2, { color: "130,100,62", life: 0.7, speed: 0.5, size: 0.1 });
    }
  }

  function gain(v, k, d, start, cap) {
    return v + k * d * Math.max(0, cap - v) / (cap - start);
  }

  function rollSteel(m, d) {
    for (const c of footprint(m, 0.55, 0.65)) {
      if (c.asp > 0) {
        if (S.cured) continue;
        if (c.temp >= SPEC.breakdownF) c.aspD = gain(c.aspD, 5, d, 82, 95);
        else if (c.temp >= SPEC.finishF) { c.aspD = gain(c.aspD, 1, d, 82, 95); say("Mat's under 200°F. The steel drum isn't getting much density.", "cool"); }
        else { c.cold = true; say("Rolling a cold mat. That can crack it.", "cold"); }
      } else if (c.base > 0) {
        c.baseC = gain(c.baseC, 8, d, 80, 99);
      } else if (c.cut > 0) {
        c.sub = gain(c.sub, 6, d, 85, 99);
      }
    }
  }

  function rollPneu(m, d) {
    for (const c of footprint(m, 0, 0.7)) {
      if (c.asp > 0 && !S.cured) {
        if (c.temp >= SPEC.finishF) { c.fin += d; c.aspD = gain(c.aspD, 0.6, d, 82, 95); }
        else say("Too cool for the rubber tires to knead the surface.", "pcool");
      } else if (c.base > 0) {
        c.baseC = gain(c.baseC, 2, d, 80, 99);
      }
    }
  }

  function spread(m, dt) {
    if (near(m, TRUCKS.stone) || S.cured) return;
    if (m.load <= 0.01) { say("Spreader box empty. Reload at the stone truck.", "empty"); return; }
    const cap = S.grade ? SPEC.baseLoose : 4.5;
    let laid = false;
    for (const c of footprint(m, -0.2, 0.8)) {
      if (m.load <= 0) break;
      if (c.asp > 0) continue;
      if (!subOK(c)) { say("Subgrade isn't cut to 4–6″ and rolled to 95% here. Proof-roll it first.", "subfirst"); continue; }
      if (c.base >= cap - 0.001) continue;
      const r = Math.min(3 * dt, cap - c.base, m.load);
      c.baseC = (c.baseC * c.base + 80 * r) / (c.base + r); // new loose stone mixes in
      c.base += r; m.load -= r; laid = true;
    }
    if (laid && Math.random() < 0.6) {
      const [bx, by] = local(m, -m.len / 2, (Math.random() - 0.5) * m.wid);
      puff(bx, by, 1, { color: "165,163,156", life: 0.5, speed: 0.3, size: 0.07, grow: 0.05 });
    }
  }

  function pave(m) {
    if (S.cured) return;
    for (const c of footprint(m, -1.05, 0.9)) {
      if (c.asp > 0) continue;
      if (!baseOK(c)) { say("Base isn't ready under the screed (needs 2–3″ at 95%). Skipping it.", "basefirst"); continue; }
      if (m.load < SPEC.aspLoose) { m.tool = false; say("Hopper's empty. Back up to the hot mix truck.", "hopper"); return; }
      c.asp = SPEC.aspLoose; c.aspD = 82; c.temp = SPEC.layTemp; c.fin = 0; c.cold = false;
      m.load -= SPEC.aspLoose;
    }
  }

  const nozzle = (m) => local(m, 0.55);

  function spray(m) {
    const [nx, ny] = nozzle(m);
    if (Math.random() < 0.5) puff(nx, ny, 1, { color: S.color === 1 ? "255,255,255" : "80,140,230", life: 0.35, speed: 0.25, size: 0.05, grow: 0.2 });
    const fx = Math.floor((nx - LX) * F), fy = Math.floor((ny - LY) * F);
    if (fx < 0 || fy < 0 || fx >= PW || fy >= PH) return;
    // Line assist: snap to an unpainted guide of this color within one paint cell.
    let best = -1;
    for (let dy = -1; dy <= 1 && best < 0; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = fx + dx, y = fy + dy;
        if (x < 0 || y < 0 || x >= PW || y >= PH) continue;
        const i = y * PW + x;
        if (target[i] === S.color && S.paint[i] !== S.color) { best = i; if (!dx && !dy) break; }
      }
    }
    const i = best >= 0 ? best : fy * PW + fx;
    if (best < 0 && target[i] === S.color && S.paint[i] === S.color) return;
    S.paint[i] = S.color;
  }

  function walkStakes(m) {
    STAKES.forEach(([x, y], i) => {
      if (!S.stakes[i] && Math.hypot(m.x - x, m.y - y) < 0.6) {
        S.stakes[i] = true; beep(660, 0.08); beep(990, 0.1);
        const n = S.stakes.filter(Boolean).length;
        float(x, y - 0.4, `Stake ${n}/${STAKES.length}`, "#f2a93b");
        say(n === STAKES.length ? "Layout staked. Stall lines are marked for the striper." : `Stake ${n} of ${STAKES.length} shot in.`);
      }
    });
  }

  function cure() {
    if (S.cured) { say("Already cured.", "cured2"); return; }
    if (S.cells.some((c) => c.asp === 0)) { say("Can't send everyone home yet. Part of the lot isn't paved.", "unpaved"); return; }
    S.cured = true; S.day++; S.night = 3;
    for (const c of S.cells) c.temp = AMBIENT;
    S.machines.forEach((m) => (m.tool = false));
    say(`Day ${S.day}. Mat cured overnight. Stake the layout, stripe, and set the signs.`);
  }

  // ---------- Progress & inspection ----------
  function progress() {
    const n = S.cells.length;
    const frac = (f) => S.cells.filter(f).length / n;
    let white = 0, blue = 0, over = 0;
    for (let i = 0; i < target.length; i++) {
      const p = S.paint[i];
      if (!p) continue;
      if (target[i] === p) p === 1 ? white++ : blue++;
      else if (!target[i]) over++;
    }
    return {
      cut: frac((c) => c.cut >= SPEC.cutMin && c.cut <= SPEC.cutMax),
      spoil: S.machines[0].load,
      overcut: S.cells.filter((c) => c.cut > SPEC.cutMax).length,
      sub: frac(subOK),
      base: frac(baseOK),
      paved: frac((c) => c.asp > 0),
      dense: frac((c) => c.asp > 0 && c.aspD >= SPEC.aspDMin),
      thick: frac((c) => c.asp > 0 && aspT(c) >= SPEC.aspMinT && aspT(c) <= SPEC.aspMaxT),
      fin: frac((c) => c.fin >= 0.8),
      cold: S.cells.filter((c) => c.cold).length,
      stakes: S.stakes.filter(Boolean).length / STAKES.length,
      white: white / TARGET_COUNT[1],
      blue: blue / TARGET_COUNT[2],
      over,
      signs: S.signs.filter(Boolean).length / SIGNS.length,
    };
  }

  function phaseList(p) {
    return [
      { t: "Cut 4–6″ and haul the spoil", v: p.cut, done: p.cut === 1 && p.spoil < 0.01 },
      { t: "Proof-roll subgrade to 95%", v: p.sub },
      { t: "Stone base 2–3″ at 95%", v: p.base },
      { t: "Pave 2.5″ hot mix", v: p.paved },
      { t: "Steel breakdown to 92% Gmm", v: p.dense },
      { t: "Pneumatic finish", v: p.fin },
      { t: "Cure overnight", v: S.cured ? 1 : 0 },
      { t: "Stake the layout", v: p.stakes },
      { t: "Stripe the white stalls", v: Math.min(1, p.white / SPEC.stripeMin) },
      { t: "Blue accessible stalls + van aisle", v: Math.min(1, p.blue / SPEC.stripeMin) },
      { t: "Set 2 accessible signs", v: p.signs },
    ].map((x) => ({ ...x, done: x.done ?? x.v >= 0.999 }));
  }

  function inspect() {
    const p = progress();
    const pct = (v) => `${Math.round(v * 100)}%`;
    const checks = [
      [p.cut === 1, `Cut depth 4–6″ on ${pct(p.cut)} of the lot${p.overcut ? ` (${p.overcut} cells overcut)` : ""}`],
      [p.spoil < 0.01, p.spoil < 0.01 ? "Spoil hauled off site" : "Spoil still sitting in the excavator bucket"],
      [p.sub === 1, `Subgrade at 95% Proctor on ${pct(p.sub)}`],
      [p.base === 1, `Stone base 2–3″ at 95% on ${pct(p.base)}`],
      [p.paved === 1, `Paved ${pct(p.paved)} of the lot`],
      [p.dense === 1, `Density ≥ 92% Gmm on ${pct(p.dense)}`],
      [p.thick === 1, `Surface thickness 1.75–2.5″ on ${pct(p.thick)}`],
      [p.fin === 1, `Pneumatic finish on ${pct(p.fin)}`],
      [p.cold === 0, p.cold ? `${p.cold} cells rolled cold (cracking)` : "No cold rolling"],
      [S.cured, S.cured ? "Mat cured" : "Mat not cured"],
      [p.stakes === 1, `Layout stakes ${Math.round(p.stakes * STAKES.length)}/${STAKES.length}`],
      [p.white >= SPEC.stripeMin, `White stall lines ${pct(p.white)} (need 85%)`],
      [p.blue >= SPEC.stripeMin, `Blue accessible markings ${pct(p.blue)} (need 85%)`],
      [p.over <= 40, `Overspray: ${p.over} paint spots off the lines`],
      [p.signs === 1, `Accessible signs ${Math.round(p.signs * 2)}/2`],
    ];
    const pass = checks.every(([ok]) => ok);
    $("report").innerHTML =
      `<div class="verdict ${pass ? "pass" : "fail"}">${pass ? "PASSED" : "FAILED"}</div>` +
      `<p class="muted">Day ${S.day}, ${fmtTime(S.time)} on the clock.</p>` +
      `<ul>${checks.map(([ok, txt]) => `<li class="${ok ? "ok" : "no"}">${txt}</li>`).join("")}</ul>`;
    say(pass ? "Inspector signed off. Lot is open for business!" : "Inspector left a punch list. See the report.");
    if (pass) { [660, 880, 1100].forEach((f, i) => setTimeout(() => beep(f, 0.18, "triangle"), i * 140)); float(LX + COLS / 2, LY + ROWS / 2, "PASSED", "#5cc27a"); }
    else beep(150, 0.35);
  }

  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // ---------- Rendering ----------
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function box(x, y, w, h, r, fill, stroke) {
    rr(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function shade(hex, f) { // f > 0 lighter, f < 0 darker
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f));
    return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
  }
  function heat(t, a) { return `hsla(${Math.round(clamp(t, 0, 1) * 120)}, 70%, 45%, ${a})`; }

  function drawGround() {
    ctx.fillStyle = TEX.grass; ctx.fillRect(0, 0, WW * PX, WH * PX);
    // haul road with a curb line
    ctx.fillStyle = TEX.gravel; ctx.fillRect(0, 0, 3.2 * PX, WH * PX);
    const g = ctx.createLinearGradient(3.2 * PX - 10, 0, 3.2 * PX + 6, 0);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.6, "rgba(0,0,0,.25)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(3.2 * PX - 10, 0, 16, WH * PX);
    ctx.fillStyle = "rgba(255,255,255,.18)";
    for (let y = 8; y < WH * PX; y += 26) ctx.fillRect(0.3 * PX, y, 3, 12);
  }

  function drawCell(cx, cy, c) {
    const x = (LX + cx) * PX, y = (LY + cy) * PX;
    if (c.asp > 0) {
      ctx.fillStyle = TEX.asphalt; ctx.fillRect(x, y, PX, PX);
      if (S.cured) { ctx.fillStyle = "rgba(90,92,98,.18)"; ctx.fillRect(x, y, PX, PX); }
      else {
        const hot = clamp((c.temp - AMBIENT) / (SPEC.layTemp - AMBIENT), 0, 1);
        ctx.fillStyle = `rgba(255,95,40,${0.16 * hot})`; ctx.fillRect(x, y, PX, PX);
        // fresh mat has a wet sheen until it's rolled
        const sheen = clamp((SPEC.aspDMin - c.aspD) / 10, 0, 1) * 0.12;
        if (sheen > 0) { ctx.fillStyle = `rgba(255,255,255,${sheen})`; ctx.fillRect(x, y, PX, PX); }
      }
      return;
    }
    if (c.cut > 0.05 || c.base > 0) {
      ctx.fillStyle = TEX.dirt; ctx.fillRect(x, y, PX, PX);
      ctx.fillStyle = `rgba(30,18,5,${clamp(c.cut / 6, 0, 1) * 0.3})`; ctx.fillRect(x, y, PX, PX);
      const packed = clamp((c.sub - 85) / 12, 0, 1);
      if (packed > 0) { ctx.fillStyle = `rgba(95,75,55,${packed * 0.35})`; ctx.fillRect(x, y, PX, PX); }
      if (c.cut < SPEC.cutMin) { // grass clumps still hanging on near the surface
        ctx.globalAlpha = clamp(1 - c.cut / 2, 0, 1); ctx.fillStyle = TEX.grass; ctx.fillRect(x, y, PX, PX); ctx.globalAlpha = 1;
      }
      if (c.base > 0) {
        ctx.globalAlpha = clamp(c.base / 2.2, 0.15, 1);
        ctx.fillStyle = TEX.stone; ctx.fillRect(x, y, PX, PX);
        ctx.globalAlpha = 1;
        const tight = clamp((c.baseC - 80) / 16, 0, 1);
        ctx.fillStyle = `rgba(60,60,58,${tight * 0.28})`; ctx.fillRect(x, y, PX, PX);
      }
      return;
    }
    ctx.fillStyle = TEX.grass; ctx.fillRect(x, y, PX, PX);
  }

  // Shadows along edges where the neighbor sits higher, so cuts read as depth.
  function drawEdges() {
    const h = (cx, cy) => (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS ? 0 : surface(S.cells[idx(cx, cy)]));
    for (let cy = 0; cy < ROWS; cy++) {
      for (let cx = 0; cx < COLS; cx++) {
        const me = h(cx, cy), x = (LX + cx) * PX, y = (LY + cy) * PX;
        const sides = [[0, -1], [-1, 0], [1, 0], [0, 1]];
        for (const [dx, dy] of sides) {
          const dh = h(cx + dx, cy + dy) - me;
          if (dh < 0.4) continue;
          const a = clamp(dh / 5, 0, 1) * (dy < 0 || dx < 0 ? 0.45 : 0.28), w = 4 + 8 * clamp(dh / 5, 0, 1);
          let g;
          if (dy === -1) g = ctx.createLinearGradient(0, y, 0, y + w);
          if (dy === 1) g = ctx.createLinearGradient(0, y + PX, 0, y + PX - w);
          if (dx === -1) g = ctx.createLinearGradient(x, 0, x + w, 0);
          if (dx === 1) g = ctx.createLinearGradient(x + PX, 0, x + PX - w, 0);
          g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          if (dy) ctx.fillRect(x, dy < 0 ? y : y + PX - w, PX, w);
          else ctx.fillRect(dx < 0 ? x : x + PX - w, y, w, PX);
        }
      }
    }
  }

  function overlayColor(c) {
    if (S.overlay === 1) {
      if (c.cut < 0.05) return null;
      const ok = c.cut >= SPEC.cutMin && c.cut <= SPEC.cutMax;
      return ok ? "rgba(92,194,122,.5)" : c.cut > SPEC.cutMax ? "rgba(229,96,79,.6)" : `rgba(242,169,59,${0.2 + 0.4 * c.cut / 4})`;
    }
    if (S.overlay === 2) {
      if (c.asp > 0) return heat((c.aspD - 82) / (SPEC.aspDMin - 82), 0.55);
      if (c.base > 0) return heat((c.baseC - 80) / (SPEC.baseCMin - 80), 0.55);
      if (c.cut > 0.05) return heat((c.sub - 85) / (SPEC.subMin - 85), 0.55);
      return null;
    }
    if (S.overlay === 3) {
      if (c.asp <= 0 || S.cured) return null;
      return c.temp >= SPEC.breakdownF ? "rgba(229,96,79,.5)" : c.temp >= SPEC.finishF ? "rgba(242,169,59,.5)" : "rgba(80,140,220,.5)";
    }
    return null;
  }

  function drawPaint() {
    const fp = PX / F;
    const showGuide = S.cured && S.stakes.every(Boolean);
    for (let fy = 0; fy < PH; fy++) {
      for (let fx = 0; fx < PW; fx++) {
        const i = fy * PW + fx, p = S.paint[i];
        const x = LX * PX + fx * fp, y = LY * PX + fy * fp;
        if (p) {
          ctx.fillStyle = p === 1 ? "rgba(242,240,232,.95)" : "rgba(59,123,216,.95)";
          ctx.fillRect(x + 2, y, fp - 4, fp + 0.5);
        } else if (showGuide && target[i]) {
          ctx.fillStyle = target[i] === 1 ? "rgba(255,255,255,.22)" : "rgba(90,150,240,.45)";
          ctx.fillRect(x + fp * 0.4, y + fp * 0.4, fp * 0.2, fp * 0.2);
        }
      }
    }
  }

  function drawMarkers() {
    STAKES.forEach(([x, y], i) => {
      const px = x * PX, py = y * PX;
      if (S.stakes[i]) {
        box(px - 2, py - 2, 4, 4, 1, "#f2a93b");
        ctx.fillStyle = "#ff5aa0"; ctx.fillRect(px - 1, py - 8, 2, 6);
      } else {
        const pulse = 0.5 + 0.5 * Math.sin(S.time * 4 + i);
        const g = ctx.createRadialGradient(px, py, 2, px, py, 18 + 6 * pulse);
        g.addColorStop(0, "rgba(255,190,80,.85)"); g.addColorStop(1, "rgba(255,170,60,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, 18 + 6 * pulse, 0, 7); ctx.fill();
        ctx.fillStyle = "#ffcf70"; ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.fill();
      }
    });
    SIGNS.forEach(([x, y], i) => {
      const px = x * PX, py = y * PX;
      if (S.signs[i]) {
        ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.fillRect(px - 6, py + 4, 18, 6);
        ctx.fillStyle = "#8a8f96"; ctx.fillRect(px - 1.5, py - 6, 3, 14);
        box(px - 9, py - 20, 18, 15, 2, "#2f6fd1", "#fff");
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(px, py - 15, 1.8, 0, 7); ctx.fill();
        ctx.fillRect(px - 1, py - 13, 2, 5);
      } else if (S.cured) {
        ctx.strokeStyle = `rgba(90,150,240,${0.5 + 0.3 * Math.sin(S.time * 3)})`; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
        ctx.strokeRect(px - 9, py - 9, 18, 18); ctx.setLineDash([]);
      }
    });
  }

  function haulOffset() {
    const a = S.haul.away;
    if (a <= 0) return 0;
    const out = HAUL_AWAY - a; // time since leaving
    if (out < 1.5) return -((out / 1.5) ** 2) * 5;       // accelerate away
    if (a < 1.5) return -((a / 1.5) ** 2) * 5;            // pull back in
    return -5;
  }

  function drawTruck(k, t) {
    const yo = k === "haul" ? haulOffset() : 0;
    const x = t.x * PX, y = (t.y + yo) * PX, w = 1.15 * PX, h = 2.5 * PX;
    if (y < -h) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = "rgba(0,0,0,.4)"; ctx.shadowBlur = 8; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 5;
    box(-w / 2, -h / 2, w, h, 6, "#2b2d31");
    ctx.shadowColor = "transparent";
    // wheels
    ctx.fillStyle = "#151515";
    for (const wy of [-h / 2 + 10, -h / 2 + 26, h / 2 - 22]) { ctx.fillRect(-w / 2 - 3, wy, 5, 12); ctx.fillRect(w / 2 - 2, wy, 5, 12); }
    // bed
    const bedH = h - 0.7 * PX;
    box(-w / 2 + 2, -h / 2 + 2, w - 4, bedH, 4, t.bed, shade(t.bed, -0.35));
    ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(-w / 2 + 5, -h / 2 + 5, 4, bedH - 6);
    if (k === "haul") {
      const f = S.haul.load / HAUL_CAP;
      if (f > 0) {
        ctx.fillStyle = TEX.dirt;
        rr(-w / 2 + 6, -h / 2 + 6 + (1 - f) * (bedH - 12), w - 12, f * (bedH - 12), 8); ctx.fill();
      }
    } else if (k === "asphalt") {
      ctx.fillStyle = "rgba(255,110,50,.22)"; rr(-w / 2 + 6, -h / 2 + 6, w - 12, bedH - 12, 6); ctx.fill();
    } else {
      ctx.fillStyle = TEX.stone; rr(-w / 2 + 6, -h / 2 + 6, w - 12, bedH - 12, 6); ctx.fill();
    }
    // cab
    box(-w / 2 + 2, h / 2 - 0.62 * PX, w - 4, 0.6 * PX - 2, 6, "#d7d3c8", "#9f9b90");
    box(-w / 2 + 7, h / 2 - 14, w - 14, 8, 2, "#5b88a8");
    ctx.fillStyle = "#ffe9a8"; ctx.fillRect(-w / 2 + 4, h / 2 - 4, 6, 3); ctx.fillRect(w / 2 - 10, h / 2 - 4, 6, 3);
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.font = "600 11px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(t.label, x, y - h / 2 - 6);
  }

  function treads(x, y, w, h, odo, vertical = false) {
    box(x, y, w, h, 3, "#1c1c1c");
    ctx.save(); rr(x, y, w, h, 3); ctx.clip();
    ctx.fillStyle = "#3a3a3a";
    const step = 6, off = ((odo * PX) % step + step) % step;
    for (let p = -step; p < (vertical ? h : w) + step; p += step) {
      if (vertical) ctx.fillRect(x, y + p - off, w, 2); else ctx.fillRect(x + p - off, y, 2, h);
    }
    ctx.restore();
  }
  function wheel(x, y, w, h, odo) {
    box(x, y, w, h, 2.5, "#161616");
    ctx.fillStyle = "#333";
    const off = ((odo * PX) % 5 + 5) % 5;
    ctx.save(); rr(x, y, w, h, 2.5); ctx.clip();
    for (let p = -5; p < w + 5; p += 5) ctx.fillRect(x + p - off, y, 1.5, h);
    ctx.restore();
  }
  function glass(x, y, w, h) {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#7fb4d6"); g.addColorStop(1, "#33546b");
    box(x, y, w, h, 3, g);
  }
  function silhouette(x, y, w, h, r, fill) {
    ctx.shadowColor = "rgba(0,0,0,.42)"; ctx.shadowBlur = 10; ctx.shadowOffsetX = 5; ctx.shadowOffsetY = 6;
    box(x, y, w, h, r, fill);
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  }
  function paintBody(x, y, w, h, r, col) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, shade(col, 0.22)); g.addColorStop(1, shade(col, -0.2));
    box(x, y, w, h, r, g, shade(col, -0.4));
  }

  function drawMachine(m, selected) {
    const L = m.len * PX, W = m.wid * PX;
    if (selected) {
      const pulse = 0.5 + 0.5 * Math.sin(S.time * 4);
      const r = Math.max(L, W) * 0.7 + 4;
      const g = ctx.createRadialGradient(m.x * PX, m.y * PX, r * 0.6, m.x * PX, m.y * PX, r + 6);
      g.addColorStop(0, "rgba(242,169,59,0)"); g.addColorStop(0.8, `rgba(242,169,59,${0.25 + 0.2 * pulse})`); g.addColorStop(1, "rgba(242,169,59,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(m.x * PX, m.y * PX, r + 6, 0, 7); ctx.fill();
    }
    ctx.save();
    ctx.translate(m.x * PX, m.y * PX);
    ctx.rotate(m.a);
    const vib = selected && Math.abs(m.v) < 0.05 ? Math.sin(S.time * 60) * 0.3 : 0; // idle rumble
    ctx.translate(vib, 0);

    switch (m.id) {
      case "exc": {
        silhouette(-L / 2, -W / 2, L, W, 5, "#1c1c1c");
        treads(-L / 2, -W / 2, L, 11, m.odo); treads(-L / 2, W / 2 - 11, L, 11, m.odo);
        ctx.save();
        ctx.rotate(m.swingT > 0 ? m.swing * Math.min(1, (0.7 - m.swingT) / 0.25) : m.swing);
        ctx.shadowColor = "rgba(0,0,0,.3)"; ctx.shadowBlur = 6; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 4;
        ctx.beginPath(); ctx.arc(-4, 0, W * 0.42, 0, 7); ctx.fillStyle = shade(m.color, -0.1); ctx.fill();
        ctx.shadowColor = "transparent";
        paintBody(-L / 2 + 4, -W / 2 + 9, L * 0.62, W - 18, 6, m.color);
        box(-L / 2 + 6, -W / 2 + 11, 12, W - 22, 3, "#3a3a3a"); // counterweight
        glass(L * 0.02, -W / 2 + 10, 15, 14);
        // boom and stick, reaching out and pulling back while digging
        const reach = (1.45 + 0.22 * Math.sin(m.anim)) * PX;
        ctx.lineCap = "round";
        ctx.strokeStyle = shade(m.color, -0.35); ctx.lineWidth = 10;
        ctx.beginPath(); ctx.moveTo(6, 5); ctx.lineTo(reach * 0.6, 4); ctx.lineTo(reach, 4); ctx.stroke();
        ctx.strokeStyle = m.color; ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(6, 5); ctx.lineTo(reach * 0.6, 4); ctx.lineTo(reach, 4); ctx.stroke();
        ctx.strokeStyle = "#555"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(14, 1); ctx.lineTo(reach * 0.55, 0); ctx.stroke();
        box(reach - 2, -7, 16, 22, 4, "#4b4b4b", "#2a2a2a");
        const fill = m.load / m.cap;
        if (fill > 0) { ctx.fillStyle = TEX.dirt; rr(reach + 1, 13 - 18 * fill, 10, 18 * fill, 3); ctx.fill(); }
        ctx.restore();
        break;
      }
      case "steel": {
        const drumW = 17;
        silhouette(-L / 2, -W / 2 + 5, L - drumW - 2, W - 10, 6, m.color);
        paintBody(-L / 2, -W / 2 + 5, L - drumW - 2, W - 10, 6, m.color);
        wheel(-L / 2 + 4, -W / 2 + 1, 16, 7, m.odo); wheel(-L / 2 + 4, W / 2 - 8, 16, 7, m.odo);
        glass(-L / 2 + 8, -10, 18, 20);
        box(L / 2 - drumW - 4, -W / 2 + 2, 6, W - 4, 2, shade(m.color, -0.3)); // yoke
        const g = ctx.createLinearGradient(L / 2 - drumW, 0, L / 2, 0);
        g.addColorStop(0, "#6f7377"); g.addColorStop(0.5, "#c9cdd1"); g.addColorStop(1, "#6f7377");
        box(L / 2 - drumW, -W / 2, drumW, W, 5, g);
        ctx.save(); rr(L / 2 - drumW, -W / 2, drumW, W, 5); ctx.clip();
        ctx.fillStyle = "rgba(0,0,0,.18)";
        const off = ((m.odo * PX * 0.8) % 8 + 8) % 8;
        for (let p = -8; p < drumW + 8; p += 8) ctx.fillRect(L / 2 - drumW + p - off, -W / 2, 1.5, W);
        ctx.restore();
        break;
      }
      case "pneu": {
        silhouette(-L / 2 + 4, -W / 2 + 4, L - 8, W - 8, 6, m.color);
        const tw = W / 4;
        for (let i = 0; i < 4; i++) { wheel(L / 2 - 14, -W / 2 + i * tw + 1, 14, tw - 3, m.odo); wheel(-L / 2, -W / 2 + i * tw + tw / 2, 14, tw - 3, m.odo); }
        paintBody(-L / 2 + 12, -W / 2 + 6, L - 28, W - 12, 6, m.color);
        glass(-8, -10, 18, 20);
        box(-L / 2 + 14, -W / 2 + 8, 8, W - 16, 2, "rgba(0,0,0,.25)"); // water tank cap
        break;
      }
      case "spread": {
        silhouette(-L / 2, -W / 2, L, W, 5, "#1c1c1c");
        treads(L * 0.02, -W / 2 + 4, L * 0.46, 10, m.odo); treads(L * 0.02, W / 2 - 14, L * 0.46, 10, m.odo);
        box(-L / 2, -W / 2, L * 0.5, W, 4, "#7d7e80", "#4e4f51"); // spreader box
        ctx.save(); rr(-L / 2 + 4, -W / 2 + 4, L * 0.5 - 8, W - 8, 3); ctx.clip();
        ctx.fillStyle = "#3f4042"; ctx.fillRect(-L / 2 + 4, -W / 2 + 4, L * 0.5 - 8, W - 8);
        const f = m.load / m.cap;
        if (f > 0) { ctx.fillStyle = TEX.stone; ctx.fillRect(-L / 2 + 4, -W / 2 + 4, (L * 0.5 - 8) * f, W - 8); }
        ctx.restore();
        paintBody(L * 0.02, -W / 2 + 14, L * 0.44, W - 28, 5, m.color);
        glass(L * 0.14, -8, 13, 16);
        break;
      }
      case "paver": {
        silhouette(-L / 2 + 8, -W / 2 + 4, L - 8, W - 8, 6, m.color);
        treads(-L / 2 + 12, -W / 2 + 6, L - 30, 9, m.odo); treads(-L / 2 + 12, W / 2 - 15, L - 30, 9, m.odo);
        box(L / 2 - 22, -W / 2 + 3, 22, W - 6, 4, "#2e2a28", "#111"); // hopper
        ctx.save(); rr(L / 2 - 20, -W / 2 + 5, 18, W - 10, 3); ctx.clip();
        const f = m.load / m.cap;
        if (f > 0) { ctx.fillStyle = TEX.asphalt; ctx.fillRect(L / 2 - 20, -W / 2 + 5, 18 * f, W - 10); ctx.fillStyle = "rgba(255,110,50,.25)"; ctx.fillRect(L / 2 - 20, -W / 2 + 5, 18 * f, W - 10); }
        ctx.restore();
        paintBody(-L / 2 + 14, -W / 2 + 12, L - 38, W - 24, 6, m.color);
        glass(-L / 2 + 18, -10, 16, 20);
        // screed across the back, glowing when it's down and heated
        const sg = m.tool ? `rgba(255,${120 + 30 * Math.sin(S.time * 8)},50,1)` : "#6e6e6e";
        box(-L / 2 - 2, -W / 2 - 3, 12, W + 6, 3, "#3c3c3c", "#222");
        ctx.fillStyle = sg; ctx.fillRect(-L / 2, -W / 2 - 1, 3, W + 2);
        break;
      }
      case "stripe": {
        silhouette(-L / 2 + 6, -W / 2, L - 10, W, 4, "#333");
        wheel(-L / 2 + 8, -W / 2 - 2, 10, 5, m.odo); wheel(-L / 2 + 8, W / 2 - 3, 10, 5, m.odo);
        paintBody(-L / 2 + 6, -W / 2 + 3, L - 14, W - 6, 4, m.color);
        ctx.beginPath(); ctx.arc(-2, 0, 6, 0, 7); ctx.fillStyle = S.color === 1 ? "#f6f6f2" : "#3b7bd8"; ctx.fill();
        ctx.strokeStyle = "#555"; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = "#444"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-L / 2 + 6, -W / 2 + 2); ctx.lineTo(-L / 2 - 4, -W / 2 + 2); ctx.lineTo(-L / 2 - 4, W / 2 - 2); ctx.lineTo(-L / 2 + 6, W / 2 - 2); ctx.stroke(); // handle
        box(L / 2 - 6, -2.5, 9, 5, 1.5, "#666");
        break;
      }
      case "crew": {
        const swing = Math.sin(m.anim) * 4;
        ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(3, 4, 10, 8, 0, 0, 7); ctx.fill();
        ctx.fillStyle = "#3a4a63"; ctx.fillRect(-3 + swing, -6, 6, 4); ctx.fillRect(-3 - swing, 2, 6, 4);   // legs
        ctx.fillStyle = "#ff8a2a"; ctx.beginPath(); ctx.ellipse(0, 0, 6, 10, 0, 0, 7); ctx.fill();          // vest
        ctx.fillStyle = "#e8e2a0"; ctx.fillRect(-1, -9, 2, 18);
        ctx.fillStyle = "#c58b5a"; ctx.beginPath(); ctx.arc(swing * 0.6 + 2, -10, 2.5, 0, 7); ctx.arc(-swing * 0.6 + 2, 10, 2.5, 0, 7); ctx.fill(); // hands
        ctx.fillStyle = "#f6d32b"; ctx.beginPath(); ctx.arc(1, 0, 5.5, 0, 7); ctx.fill();                   // hard hat
        ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.beginPath(); ctx.arc(-0.5, -1.5, 2, 0, 7); ctx.fill();
        break;
      }
    }
    // headlights at night
    if (S.night > 0 && m.id !== "crew") {
      const a = nightAlpha();
      const g = ctx.createRadialGradient(L / 2, 0, 4, L / 2 + 40, 0, 60);
      g.addColorStop(0, `rgba(255,240,190,${0.5 * a})`); g.addColorStop(1, "rgba(255,240,190,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(L / 2, -6); ctx.lineTo(L / 2 + 90, -40); ctx.lineTo(L / 2 + 90, 40); ctx.lineTo(L / 2, 6); ctx.fill();
    }
    ctx.restore();
  }

  function drawLabel(m) {
    const L = m.len * PX, W = m.wid * PX;
    const y = m.y * PX - Math.max(L, W) * 0.75 - 10;
    ctx.font = "600 11px system-ui, sans-serif"; ctx.textAlign = "center";
    const tw = ctx.measureText(m.name).width + 14;
    box(m.x * PX - tw / 2, y - 12, tw, 18, 9, "rgba(20,20,22,.78)");
    ctx.fillStyle = "#f2a93b"; ctx.fillText(m.name, m.x * PX, y + 1);
  }

  function drawParticles() {
    for (const p of S.parts) {
      const a = clamp(p.life / p.max, 0, 1) * (p.kind === "steam" ? 0.13 : 0.45);
      ctx.fillStyle = `rgba(${p.color},${a})`;
      ctx.beginPath(); ctx.arc(p.x * PX, p.y * PX, p.size * PX, 0, 7); ctx.fill();
    }
  }

  function drawFloats() {
    ctx.textAlign = "center";
    for (const f of S.floats) {
      ctx.globalAlpha = clamp(f.life / 0.6, 0, 1);
      ctx.font = `700 ${f.text === "PASSED" ? 34 : 13}px system-ui, sans-serif`;
      ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillText(f.text, f.x * PX + 1, f.y * PX + 1);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x * PX, f.y * PX);
    }
    ctx.globalAlpha = 1;
  }

  const nightAlpha = () => Math.sin(Math.PI * (1 - S.night / 3));

  function draw() {
    ctx.setTransform(canvas.width / (WW * PX), 0, 0, canvas.height / (WH * PX), 0, 0);
    drawGround();

    for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) drawCell(cx, cy, S.cells[idx(cx, cy)]);
    drawEdges();
    for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLS; cx++) {
      const oc = overlayColor(S.cells[idx(cx, cy)]);
      if (oc) { ctx.fillStyle = oc; ctx.fillRect((LX + cx) * PX, (LY + cy) * PX, PX, PX); }
    }
    for (let i = 0; i < S.cells.length; i++) {
      if (!S.cells[i].cold) continue;
      const x = (LX + (i % COLS)) * PX, y = (LY + Math.floor(i / COLS)) * PX;
      ctx.strokeStyle = "rgba(200,200,200,.35)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 8, y + 12); ctx.lineTo(x + 22, y + 26); ctx.lineTo(x + 36, y + 22); ctx.lineTo(x + 44, y + 38); ctx.stroke();
    }
    if (S.overlay) {
      ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = 1;
      for (let i = 1; i < COLS; i++) { ctx.beginPath(); ctx.moveTo((LX + i) * PX, LY * PX); ctx.lineTo((LX + i) * PX, (LY + ROWS) * PX); ctx.stroke(); }
      for (let i = 1; i < ROWS; i++) { ctx.beginPath(); ctx.moveTo(LX * PX, (LY + i) * PX); ctx.lineTo((LX + COLS) * PX, (LY + i) * PX); ctx.stroke(); }
    }
    if (!S.cured) {
      ctx.setLineDash([7, 6]); ctx.lineDashOffset = -S.time * 6;
      ctx.strokeStyle = "rgba(242,169,59,.65)"; ctx.lineWidth = 2;
      ctx.strokeRect(LX * PX, LY * PX, COLS * PX, ROWS * PX); ctx.setLineDash([]);
    }

    drawPaint();
    drawMarkers();
    for (const [k, t] of Object.entries(TRUCKS)) drawTruck(k, t);
    S.machines.forEach((m, i) => { if (i !== S.sel) drawMachine(m, false); });
    drawMachine(cur(), true);
    drawParticles();
    drawLabel(cur());
    drawFloats();

    // soft vignette
    const v = ctx.createRadialGradient(WW * PX / 2, WH * PX / 2, WH * PX * 0.45, WW * PX / 2, WH * PX / 2, WW * PX * 0.62);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.28)");
    ctx.fillStyle = v; ctx.fillRect(0, 0, WW * PX, WH * PX);

    if (S.night > 0) {
      const a = nightAlpha();
      ctx.fillStyle = `rgba(8,14,34,${0.78 * a})`; ctx.fillRect(0, 0, WW * PX, WH * PX);
      ctx.globalAlpha = a; ctx.fillStyle = "#e6e9f5"; ctx.font = "600 22px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Curing overnight…", WW * PX / 2, WH * PX / 2); ctx.globalAlpha = 1;
    }
  }

  // ---------- Panel ----------
  function toolCell(m) {
    const off = { exc: 1.7, steel: 0.55, pneu: 0, spread: -0.2, paver: -1.05, stripe: 0.55, crew: 0 }[m.id];
    return cellAt(...local(m, off));
  }

  function updatePanel() {
    const m = cur();
    const tags = [`<span class="tag ${S.grade ? "on" : ""}">Grade control ${S.grade ? "on" : "off"}</span>`];
    let extra = "";
    if (m.cap) {
      const label = { exc: "Bucket", spread: "Stone box", paver: "Hopper" }[m.id];
      extra = `<div class="muted">${label}: ${Math.round(m.load / m.cap * 100)}%</div><div class="bar"><i style="width:${m.load / m.cap * 100}%"></i></div>`;
    }
    if (m.id === "paver") tags.push(`<span class="tag ${m.tool ? "on" : ""}">Screed ${m.tool ? "down" : "up"}</span>`);
    if (m.id === "stripe") {
      tags.push(`<span class="tag ${m.tool ? "on" : ""}">Spray ${m.tool ? "on" : "off"}</span>`);
      tags.push(`<span class="tag">${S.color === 1 ? "White" : "Blue"} paint</span>`);
    }
    if (m.id === "exc") tags.push(`<span class="tag">Trucks hauled: ${S.haul.trips}</span>`);
    tags.push(`<span class="tag">Overlay: ${["off", "depth", "compaction", "temp"][S.overlay]}</span>`);
    tags.push(`<span class="tag">${Math.abs(m.v).toFixed(1)} cells/s</span>`);
    $("status").innerHTML = `<div class="name">${m.name}</div>${tags.join("")}${extra}`;

    const c = toolCell(m);
    const rows = [];
    if (!c) rows.push(["Ground", "Off the lot", ""]);
    else {
      const cutOK = c.cut >= SPEC.cutMin && c.cut <= SPEC.cutMax;
      rows.push(["Cut", `${c.cut.toFixed(1)}″`, c.cut > 0 ? (cutOK ? "ok" : "no") : ""]);
      if (c.cut > 0) rows.push(["Subgrade", `${c.sub.toFixed(1)}% Proctor`, c.sub >= SPEC.subMin ? "ok" : "no"]);
      if (c.base > 0) {
        rows.push(["Stone", `${baseT(c).toFixed(2)}″ (${c.base.toFixed(1)}″ loose)`, baseT(c) >= SPEC.baseMin && baseT(c) <= SPEC.baseMax ? "ok" : "no"]);
        rows.push(["Stone comp.", `${c.baseC.toFixed(1)}%`, c.baseC >= SPEC.baseCMin ? "ok" : "no"]);
      }
      if (c.asp > 0) {
        rows.push(["Asphalt", `${aspT(c).toFixed(2)}″`, aspT(c) <= SPEC.aspMaxT && aspT(c) >= SPEC.aspMinT ? "ok" : "no"]);
        rows.push(["Density", `${c.aspD.toFixed(1)}% Gmm`, c.aspD >= SPEC.aspDMin ? "ok" : "no"]);
        if (!S.cured) rows.push(["Mat temp", `${Math.round(c.temp)}°F`, c.temp >= SPEC.breakdownF ? "ok" : c.temp >= SPEC.finishF ? "" : "no"]);
        rows.push(["Finish", c.fin >= 0.8 ? "Kneaded" : "Not yet", c.fin >= 0.8 ? "ok" : ""]);
      }
    }
    $("readout").innerHTML = rows.map(([k, v, cl]) => `<dt>${k}</dt><dd class="${cl}">${v}</dd>`).join("");

    const phases = phaseList(progress());
    const curIdx = phases.findIndex((p) => !p.done);
    const done = phases.filter((p) => p.done).length;
    if (done > S.doneCount && S.time > 0.5) {
      const p = phases[(curIdx < 0 ? phases.length : curIdx) - 1];
      if (p) { say(`✓ ${p.t}.`); float(LX + COLS / 2, LY - 0.4, `✓ ${p.t}`, "#5cc27a"); beep(784, 0.12, "triangle"); }
    }
    S.doneCount = done;
    $("phases").innerHTML = phases.map((p, i) =>
      `<li class="${p.done ? "done" : i === curIdx ? "current" : ""}"><div class="t"><span>${p.t}</span><span>${Math.round(p.v * 100)}%</span></div><div class="bar"><i style="width:${p.v * 100}%"></i></div></li>`
    ).join("");

    $("hint").textContent = hintFor(phases[curIdx]);
    $("day").textContent = `Day ${S.day}`;
    $("time").textContent = fmtTime(S.time);
  }

  function hintFor(next) {
    if (!next) return "Everything looks done. Call the inspector (I).";
    const tips = {
      "Cut 4–6″ and haul the spoil": "Excavator (1): hold Space to dig in front of the bucket. When the bucket is full, drive to the haul truck and press Space.",
      "Proof-roll subgrade to 95%": "Steel roller (2): drive over the cut dirt. About 3 passes per cell gets 95%.",
      "Stone base 2–3″ at 95%": "Spreader (3): load at the stone truck, then hold Space while driving. Roll it with the steel roller (2).",
      "Pave 2.5″ hot mix": "Paver (4): load at the hot mix truck, press Space to drop the screed, and drive. Roll behind it while the mat is hot.",
      "Steel breakdown to 92% Gmm": "Steel roller (2): roll the mat while it's above 200°F. Press V for the temperature overlay.",
      "Pneumatic finish": "Pneumatic roller (5): one pass over each cell while it's above 160°F.",
      "Cure overnight": "Press N to let it cure overnight.",
      "Stake the layout": "Layout crew (7): walk to each amber beacon.",
      "Stripe the white stalls": "Striper (6): press Space to spray and follow the faint guides. Shift to crawl.",
      "Blue accessible stalls + van aisle": "Striper (6): press C for blue paint and do the bottom-left stalls and the hatched aisle.",
      "Set 2 accessible signs": "Layout crew (7): stand on a blue sign spot below the lot and press Space.",
    };
    return tips[next.t] || "";
  }

  // ---------- Loop ----------
  let last = performance.now(), panelT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    panelT -= dt;
    if (panelT <= 0) { updatePanel(); panelT = 0.1; }
    requestAnimationFrame(frame);
  }

  reset();
  updatePanel();
  requestAnimationFrame(frame);

  // Handy for debugging in the console.
  window.lotBuilder = { get state() { return S; }, SPEC, inspect, cure };
})();
