// Lot Builder: build a parking lot from bare grass to an inspected, striped lot.
// The world is measured in grid cells; the lot itself is COLS x ROWS cells.
(() => {
  "use strict";

  const COLS = 15, ROWS = 9;          // lot size in cells
  const LX = 4, LY = 2;               // lot offset inside the world
  const WW = 22, WH = 13;             // world size in cells
  const PX = 40;                      // pixels per cell on the canvas
  const F = 4;                        // paint grid resolution per cell
  const AMBIENT = 78;                 // °F

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

  // ---------- State ----------
  let S;

  const TRUCKS = {
    haul:    { x: 1.6, y: 3.4, label: "Haul truck",   color: "#c9a227" },
    stone:   { x: 1.6, y: 6.6, label: "Stone",        color: "#8f9196" },
    asphalt: { x: 1.6, y: 9.8, label: "Hot mix",      color: "#3a3330" },
  };
  const HAUL_CAP = 120;               // cell-inches of spoil per truck

  const MACHINE_DEFS = [
    { id: "exc",    name: "Excavator",        speed: 2.2, turn: 1.9, len: 1.6, wid: 1.2, color: "#e0a526", cap: 40 },
    { id: "steel",  name: "Steel drum roller", speed: 2.6, turn: 2.0, len: 1.6, wid: 1.4, color: "#d8c23a" },
    { id: "spread", name: "Stone spreader",   speed: 2.0, turn: 2.0, len: 1.5, wid: 1.8, color: "#d06a2c", cap: 60 },
    { id: "paver",  name: "Paver",            speed: 1.5, turn: 1.6, len: 1.8, wid: 2.0, color: "#e4c21d", cap: 60 },
    { id: "pneu",   name: "Pneumatic roller", speed: 2.6, turn: 2.0, len: 1.6, wid: 1.6, color: "#d8c23a" },
    { id: "stripe", name: "Line striper",     speed: 1.6, turn: 2.4, len: 0.9, wid: 0.6, color: "#e8e6df" },
    { id: "crew",   name: "Layout crew",      speed: 3.0, turn: 4.0, len: 0.4, wid: 0.4, color: "#ff8a2a" },
  ];
  const PARK = {
    exc:    [6.5, 0.9, 0],
    steel:  [9.5, 0.9, 0],
    pneu:   [12.5, 0.9, 0],
    spread: [15.5, 0.9, 0],
    paver:  [20.6, 4.0, Math.PI / 2],
    stripe: [20.6, 7.5, Math.PI / 2],
    crew:   [20.6, 10.5, Math.PI],
  };

  const STAKES = [
    [LX, LY], [LX + COLS, LY], [LX, LY + ROWS], [LX + COLS, LY + ROWS],
    [LX + COLS / 2, LY], [LX + COLS / 2, LY + ROWS],
  ];
  const SIGNS = [[LX + 0.5, LY + ROWS + 0.45], [LX + 2.5, LY + ROWS + 0.45]];

  // ---------- Stripe layout (paint grid) ----------
  // Top row: 15 stalls, rows 0–2. Bottom row: rows 6–8 with accessible stall,
  // van aisle and accessible stall at columns 0–2, then 12 regular stalls.
  const PW = COLS * F, PH = ROWS * F;
  const target = new Uint8Array(PW * PH); // 0 none, 1 white, 2 blue
  (function buildLayout() {
    const lineX = (i) => Math.min(i * F, PW - 1);
    for (let i = 0; i <= COLS; i++) {
      for (let fy = 0; fy < 3 * F; fy++) target[fy * PW + lineX(i)] = 1;
      for (let fy = 6 * F; fy < PH; fy++) target[fy * PW + lineX(i)] = i <= 3 ? 2 : 1;
    }
    // Hatched van aisle in column 1
    for (let fy = 6 * F; fy < PH; fy++) {
      for (let fx = F + 1; fx < 2 * F; fx++) {
        if ((fx + fy) % 3 === 0) target[fy * PW + fx] = 2;
      }
    }
  })();
  const TARGET_COUNT = [0, 0, 0];
  for (const t of target) TARGET_COUNT[t]++;

  function freshCell(i) {
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
      n: (Math.sin(i * 12.9898) * 43758.5453) % 1, // fixed noise for texture
    };
  }

  function reset() {
    S = {
      cells: Array.from({ length: COLS * ROWS }, (_, i) => freshCell(i)),
      paint: new Uint8Array(PW * PH),
      machines: MACHINE_DEFS.map((d) => {
        const [x, y, a] = PARK[d.id];
        return { ...d, x, y, a, load: 0, tool: false };
      }),
      sel: 0,
      grade: true,
      color: 1,
      overlay: 0,
      haul: { load: 0, away: 0, trips: 0 },
      stakes: STAKES.map(() => false),
      signs: SIGNS.map(() => false),
      cured: false,
      day: 1,
      time: 0,
      log: [],
      lastMsg: {},
      report: null,
    };
    say("Morning. Grass lot, bare dirt underneath. Start with the excavator (1).");
    renderMachineButtons();
    $("report").innerHTML = '<p class="muted">No inspection yet.</p>';
  }

  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const cur = () => S.machines[S.sel];
  const idx = (cx, cy) => cy * COLS + cx;

  function cellAt(x, y) {
    const cx = Math.floor(x - LX), cy = Math.floor(y - LY);
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return null;
    return S.cells[idx(cx, cy)];
  }
  const baseT = (c) => c.base * (1 - 0.25 * (c.baseC - 80) / 20);
  const aspT = (c) => c.asp * 82 / c.aspD;
  const subOK = (c) => c.cut >= SPEC.cutMin && c.cut <= SPEC.cutMax && c.sub >= SPEC.subMin;
  const baseOK = (c) => baseT(c) >= SPEC.baseMin && baseT(c) <= SPEC.baseMax && c.baseC >= SPEC.baseCMin;

  // Cells under a strip across the machine, `off` cells ahead of its center.
  function footprint(m, off, half) {
    const out = new Set();
    const ca = Math.cos(m.a), sa = Math.sin(m.a);
    for (let s = -half; s <= half + 1e-6; s += 0.35) {
      const c = cellAt(m.x + ca * off - sa * s, m.y + sa * off + ca * s);
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

  function beep(freq = 440, dur = 0.12) {
    try {
      const ac = beep.ac || (beep.ac = new (window.AudioContext || window.webkitAudioContext)());
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = freq; o.type = "square";
      g.gain.setValueAtTime(0.05, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.connect(g).connect(ac.destination);
      o.start(); o.stop(ac.currentTime + dur);
    } catch (e) { /* audio is optional */ }
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
    else if (e.code === "KeyR") { if (confirm("Restart the job from bare grass?")) reset(); }
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
    S.sel = i;
    renderMachineButtons();
    const m = cur();
    say(`In the seat: ${m.name}.`, "sel" + i);
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
        }
        break;
      case "paver":
        if (near(m, TRUCKS.asphalt)) {
          if (S.cured) { say("Paving is done. The plant has closed out the job.", "plant"); break; }
          m.load = m.cap; beep(330); say("Hot mix in the hopper at 300°F.");
        } else {
          m.tool = !m.tool; say(`Screed ${m.tool ? "down: paving behind you" : "up"}.`);
        }
        break;
      case "steel":
      case "pneu":
        beep(220, 0.25); say("Horn. Everybody look up.", "horn");
        break;
      case "stripe":
        if (!S.cured) { say("Fresh mat. Stripe after it cures overnight (N).", "nostripe"); break; }
        if (S.stakes.some((s) => !s)) { say("Layout isn't staked yet. Walk the crew (7) to the amber beacons.", "nostake"); break; }
        m.tool = !m.tool; say(`Spray ${m.tool ? "on" : "off"} (${S.color === 1 ? "white" : "blue"}).`);
        break;
      case "crew": {
        const i = SIGNS.findIndex(([x, y], k) => !S.signs[k] && Math.hypot(m.x - x, m.y - y) < 0.9);
        if (i < 0) { say("Nothing to set here. Signs go at the head of the blue stalls.", "nosign"); break; }
        if (!S.cured) { say("Wait for the lot to cure before setting signs.", "signcure"); break; }
        S.signs[i] = true; beep(520); say(`Accessible parking sign ${i + 1} of 2 set.`);
        break;
      }
    }
  }

  function dumpSpoil(m) {
    const h = S.haul;
    if (h.away > 0) { say("Haul truck is out. Next one is a few seconds away.", "away"); return; }
    const amt = Math.min(m.load, HAUL_CAP - h.load);
    m.load -= amt; h.load += amt; beep(180, 0.2);
    if (h.load >= HAUL_CAP - 0.01) {
      h.load = 0; h.away = 4; h.trips++;
      say(`Truck ${h.trips} loaded and pulling out.`);
    } else {
      say(`Bucket dumped. Truck at ${Math.round(h.load / HAUL_CAP * 100)}%.`);
    }
  }

  // ---------- Simulation ----------
  function update(dt) {
    S.time += dt;
    if (S.haul.away > 0) S.haul.away = Math.max(0, S.haul.away - dt);

    const m = cur();
    const fwd = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    const turn = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const slow = keys.slow ? 0.35 : 1;
    const v = m.speed * slow * fwd * (fwd < 0 ? 0.6 : 1);
    m.a += turn * m.turn * dt * (fwd < 0 ? -1 : 1);
    const ox = m.x, oy = m.y;
    m.x = clamp(m.x + Math.cos(m.a) * v * dt, 0.4, WW - 0.4);
    m.y = clamp(m.y + Math.sin(m.a) * v * dt, 0.4, WH - 0.4);
    const d = Math.hypot(m.x - ox, m.y - oy);

    // Hot mix cools everywhere, whichever machine you're in.
    if (!S.cured) {
      for (const c of S.cells) if (c.asp > 0) c.temp = Math.max(AMBIENT, c.temp - 0.9 * dt);
    }

    switch (m.id) {
      case "exc":    if (keys.action) dig(m, dt); break;
      case "steel":  if (d > 0) rollSteel(m, d); break;
      case "pneu":   if (d > 0) rollPneu(m, d); break;
      case "spread": if (keys.action) spread(m, dt); break;
      case "paver":  if (m.tool && d > 0) pave(m); break;
      case "stripe": if (m.tool) spray(m); break;
      case "crew":   walkStakes(m); break;
    }
  }

  function dig(m, dt) {
    if (near(m, TRUCKS.haul, 2.8)) return; // Space there means dump, not dig
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
  }

  function gain(v, k, d, start, cap) {
    return v + k * d * Math.max(0, cap - v) / (cap - start);
  }

  function rollSteel(m, d) {
    for (const c of footprint(m, 0.55, 0.75)) {
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
    for (const c of footprint(m, 0, 0.75)) {
      if (c.asp > 0 && !S.cured) {
        if (c.temp >= SPEC.finishF) { c.fin += d; c.aspD = gain(c.aspD, 0.6, d, 82, 95); }
        else say("Too cool for the rubber tires to knead the surface.", "pcool");
      } else if (c.base > 0) {
        c.baseC = gain(c.baseC, 2, d, 80, 99);
      }
    }
  }

  function spread(m, dt) {
    if (near(m, TRUCKS.stone)) return;
    if (S.cured) return;
    if (m.load <= 0.01) { say("Spreader box empty. Reload at the stone truck.", "empty"); return; }
    const cap = S.grade ? SPEC.baseLoose : 4.5;
    for (const c of footprint(m, -0.2, 0.85)) {
      if (m.load <= 0) break;
      if (c.asp > 0) continue;
      if (!subOK(c)) { say("Subgrade isn't cut to 4–6″ and rolled to 95% here. Proof-roll it first.", "subfirst"); continue; }
      if (c.base >= cap - 0.001) continue;
      const r = Math.min(3 * dt, cap - c.base, m.load);
      // New loose stone mixes with what's there
      c.baseC = (c.baseC * c.base + 80 * r) / (c.base + r);
      c.base += r; m.load -= r;
    }
  }

  function pave(m) {
    if (S.cured) return;
    for (const c of footprint(m, -1.05, 0.95)) {
      if (c.asp > 0) continue;
      if (!baseOK(c)) { say("Base isn't ready under the screed (needs 2–3″ at 95%). Skipping it.", "basefirst"); continue; }
      if (m.load < SPEC.aspLoose) { m.tool = false; say("Hopper's empty. Back up to the hot mix truck.", "hopper"); return; }
      c.asp = SPEC.aspLoose; c.aspD = 82; c.temp = SPEC.layTemp; c.fin = 0; c.cold = false;
      m.load -= SPEC.aspLoose;
    }
  }

  function nozzle(m) {
    return [m.x + Math.cos(m.a) * 0.55, m.y + Math.sin(m.a) * 0.55];
  }

  function spray(m) {
    const [nx, ny] = nozzle(m);
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
        S.stakes[i] = true; beep(660);
        const n = S.stakes.filter(Boolean).length;
        say(n === STAKES.length ? "Layout staked. Stall lines are marked for the striper." : `Stake ${n} of ${STAKES.length} shot in.`);
      }
    });
  }

  function cure() {
    if (S.cured) { say("Already cured.", "cured2"); return; }
    if (S.cells.some((c) => c.asp === 0)) { say("Can't send everyone home yet. Part of the lot isn't paved.", "unpaved"); return; }
    S.cured = true; S.day++;
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
      [p.over <= 60, `Overspray: ${p.over} paint spots off the lines`],
      [p.signs === 1, `Accessible signs ${Math.round(p.signs * 2)}/2`],
    ];
    const pass = checks.every(([ok]) => ok);
    const t = fmtTime(S.time);
    $("report").innerHTML =
      `<div class="verdict ${pass ? "pass" : "fail"}">${pass ? "PASSED" : "FAILED"}</div>` +
      `<p class="muted">Day ${S.day}, ${t} on the clock.</p>` +
      `<ul>${checks.map(([ok, txt]) => `<li class="${ok ? "ok" : "no"}">${txt}</li>`).join("")}</ul>`;
    say(pass ? "Inspector signed off. Lot is open for business!" : "Inspector left a punch list. See the report.");
    beep(pass ? 880 : 150, 0.35);
  }

  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // ---------- Rendering ----------
  const lerp = (a, b, t) => a + (b - a) * t;
  function mix(c1, c2, t) {
    const a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
    const r = Math.round(lerp(a >> 16, b >> 16, t)), g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t)), bl = Math.round(lerp(a & 255, b & 255, t));
    return `rgb(${r},${g},${bl})`;
  }
  function heat(t) { // 0 red → 1 green
    t = clamp(t, 0, 1);
    return `hsl(${Math.round(t * 120)}, 70%, 45%)`;
  }

  function cellColor(c) {
    const n = Math.abs(c.n);
    if (c.asp > 0) {
      if (S.cured) return mix("#26282c", "#2c2e33", n);
      const hot = clamp((c.temp - AMBIENT) / (SPEC.layTemp - AMBIENT), 0, 1);
      return mix("#2a2b2e", "#4a3229", hot * (0.8 + 0.2 * n));
    }
    if (c.base > 0) {
      const t = clamp(c.base / 3, 0, 1);
      return mix("#7a5e3e", mix("#a9a8a2", "#8c8b86", (c.baseC - 80) / 19), t);
    }
    if (c.cut > 0.05) {
      const dark = clamp(c.cut / 6, 0, 1);
      const packed = clamp((c.sub - 85) / 14, 0, 1);
      return mix(mix("#8a6a45", "#6a4f33", dark), "#5c4a38", packed * 0.6);
    }
    return mix("#557f35", "#62903d", n);
  }

  function overlayColor(c) {
    if (S.overlay === 1) {
      if (c.cut < 0.05) return null;
      const ok = c.cut >= SPEC.cutMin && c.cut <= SPEC.cutMax;
      return ok ? "rgba(92,194,122,.55)" : c.cut > SPEC.cutMax ? "rgba(229,96,79,.6)" : `rgba(242,169,59,${0.2 + 0.4 * c.cut / 4})`;
    }
    if (S.overlay === 2) {
      let v, lo, hi;
      if (c.asp > 0) { v = c.aspD; lo = 82; hi = SPEC.aspDMin; }
      else if (c.base > 0) { v = c.baseC; lo = 80; hi = SPEC.baseCMin; }
      else if (c.cut > 0.05) { v = c.sub; lo = 85; hi = SPEC.subMin; }
      else return null;
      return heat((v - lo) / (hi - lo)).replace("hsl", "hsla").replace(")", ", .6)");
    }
    if (S.overlay === 3) {
      if (c.asp <= 0 || S.cured) return null;
      return c.temp >= SPEC.breakdownF ? "rgba(229,96,79,.55)" : c.temp >= SPEC.finishF ? "rgba(242,169,59,.55)" : "rgba(80,140,220,.55)";
    }
    return null;
  }

  function draw() {
    ctx.save();
    ctx.scale(canvas.width / (WW * PX), canvas.height / (WH * PX));

    // Surroundings: grass verge and a gravel haul road on the left
    ctx.fillStyle = "#3e5a2c"; ctx.fillRect(0, 0, WW * PX, WH * PX);
    ctx.fillStyle = "#6c655a"; ctx.fillRect(0, 0, 3.2 * PX, WH * PX);
    ctx.fillStyle = "#7a7366";
    for (let y = 0; y < WH * PX; y += 18) ctx.fillRect(1.55 * PX, y, 3, 9);

    // Lot cells
    for (let cy = 0; cy < ROWS; cy++) {
      for (let cx = 0; cx < COLS; cx++) {
        const c = S.cells[idx(cx, cy)];
        const x = (LX + cx) * PX, y = (LY + cy) * PX;
        ctx.fillStyle = cellColor(c);
        ctx.fillRect(x, y, PX, PX);
        if (c.base > 0 && c.asp === 0) { // stone speckle
          ctx.fillStyle = "rgba(0,0,0,.18)";
          for (let k = 0; k < 6; k++) {
            const r = Math.abs(Math.sin((cx * 31 + cy * 17 + k) * 7.1));
            ctx.fillRect(x + r * 34 + 2, y + ((r * 977) % 1) * 34 + 2, 3, 3);
          }
        }
        if (c.asp === 0 && c.cut < 0.05) { // grass tufts
          ctx.fillStyle = "rgba(0,0,0,.08)";
          ctx.fillRect(x + 8 + c.n * 10, y + 12, 2, 6);
          ctx.fillRect(x + 26 - c.n * 8, y + 26, 2, 6);
        }
        if (c.cold) { ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.beginPath(); ctx.moveTo(x + 6, y + 10); ctx.lineTo(x + 20, y + 22); ctx.lineTo(x + 30, y + 18); ctx.stroke(); }
        const oc = overlayColor(c);
        if (oc) { ctx.fillStyle = oc; ctx.fillRect(x, y, PX, PX); }
      }
    }

    // Lot outline and faint grid
    ctx.strokeStyle = "rgba(0,0,0,.12)"; ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i++) { ctx.beginPath(); ctx.moveTo((LX + i) * PX, LY * PX); ctx.lineTo((LX + i) * PX, (LY + ROWS) * PX); ctx.stroke(); }
    for (let i = 1; i < ROWS; i++) { ctx.beginPath(); ctx.moveTo(LX * PX, (LY + i) * PX); ctx.lineTo((LX + COLS) * PX, (LY + i) * PX); ctx.stroke(); }
    ctx.setLineDash([6, 5]); ctx.strokeStyle = "rgba(242,169,59,.7)"; ctx.lineWidth = 2;
    ctx.strokeRect(LX * PX, LY * PX, COLS * PX, ROWS * PX); ctx.setLineDash([]);

    // Stripe guides and paint
    const fp = PX / F;
    const showGuide = S.cured && S.stakes.every(Boolean);
    for (let fy = 0; fy < PH; fy++) {
      for (let fx = 0; fx < PW; fx++) {
        const i = fy * PW + fx, p = S.paint[i];
        const x = LX * PX + fx * fp, y = LY * PX + fy * fp;
        if (p) {
          ctx.fillStyle = p === 1 ? "#f1efe6" : "#3b7bd8";
          ctx.fillRect(x, y, fp, fp);
        } else if (showGuide && target[i]) {
          ctx.fillStyle = target[i] === 1 ? "rgba(255,255,255,.18)" : "rgba(59,123,216,.35)";
          ctx.fillRect(x + fp * 0.35, y + fp * 0.35, fp * 0.3, fp * 0.3);
        }
      }
    }

    // Stakes
    STAKES.forEach(([x, y], i) => {
      if (S.stakes[i]) {
        ctx.fillStyle = "#f2a93b"; ctx.fillRect(x * PX - 2, y * PX - 2, 4, 4);
      } else {
        const pulse = 0.5 + 0.5 * Math.sin(S.time * 4 + i);
        ctx.fillStyle = `rgba(242,169,59,${0.25 + 0.35 * pulse})`;
        ctx.beginPath(); ctx.arc(x * PX, y * PX, 10 + 4 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#f2a93b"; ctx.beginPath(); ctx.arc(x * PX, y * PX, 4, 0, Math.PI * 2); ctx.fill();
      }
    });

    // Sign spots
    SIGNS.forEach(([x, y], i) => {
      const px = x * PX, py = y * PX;
      if (S.signs[i]) {
        ctx.fillStyle = "#777"; ctx.fillRect(px - 1.5, py - 4, 3, 14);
        ctx.fillStyle = "#3b7bd8"; ctx.fillRect(px - 8, py - 14, 16, 12);
        ctx.fillStyle = "#fff"; ctx.fillRect(px - 2, py - 12, 4, 8);
      } else if (S.cured) {
        ctx.strokeStyle = "rgba(59,123,216,.8)"; ctx.setLineDash([3, 3]);
        ctx.strokeRect(px - 8, py - 8, 16, 16); ctx.setLineDash([]);
      }
    });

    drawTrucks();
    S.machines.forEach((m, i) => drawMachine(m, i === S.sel));

    ctx.restore();
  }

  function drawTrucks() {
    for (const [k, t] of Object.entries(TRUCKS)) {
      if (k === "haul" && S.haul.away > 0) {
        ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
        ctx.fillText("truck en route…", t.x * PX, t.y * PX);
        continue;
      }
      const x = t.x * PX, y = t.y * PX, w = 1.2 * PX, h = 2.4 * PX;
      ctx.fillStyle = "#222"; ctx.fillRect(x - w / 2 - 3, y - h / 2 + 6, 3, 14); ctx.fillRect(x + w / 2, y - h / 2 + 6, 3, 14);
      ctx.fillRect(x - w / 2 - 3, y + h / 2 - 20, 3, 14); ctx.fillRect(x + w / 2, y + h / 2 - 20, 3, 14);
      ctx.fillStyle = "#b8b4aa"; ctx.fillRect(x - w / 2, y + h / 2 - 0.6 * PX, w, 0.6 * PX);
      ctx.fillStyle = "#5b88a8"; ctx.fillRect(x - w / 2 + 4, y + h / 2 - 10, w - 8, 6);
      ctx.fillStyle = t.color; ctx.fillRect(x - w / 2, y - h / 2, w, h - 0.65 * PX);
      if (k === "haul") {
        const f = S.haul.load / HAUL_CAP;
        ctx.fillStyle = "#6a4f33"; ctx.fillRect(x - w / 2 + 3, y - h / 2 + 3 + (1 - f) * (h - 0.65 * PX - 6), w - 6, f * (h - 0.65 * PX - 6));
      } else if (k === "asphalt") {
        ctx.fillStyle = "rgba(255,120,60,.25)"; ctx.fillRect(x - w / 2 + 3, y - h / 2 + 3, w - 6, h - 0.65 * PX - 6);
      } else {
        ctx.fillStyle = "rgba(0,0,0,.15)";
        for (let i = 0; i < 10; i++) ctx.fillRect(x - w / 2 + 4 + (i * 13) % (w - 8), y - h / 2 + 6 + i * 5, 3, 3);
      }
      ctx.fillStyle = "#fff"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(t.label, x, y - h / 2 - 4);
    }
  }

  function drawMachine(m, selected) {
    const L = m.len * PX, W = m.wid * PX;
    ctx.save();
    ctx.translate(m.x * PX, m.y * PX);
    ctx.rotate(m.a);

    if (selected) {
      ctx.strokeStyle = "rgba(242,169,59,.9)"; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(0, 0, Math.max(L, W) * 0.72, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }

    const body = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
    switch (m.id) {
      case "exc": {
        body(-L / 2, -W / 2, L, 9, "#222"); body(-L / 2, W / 2 - 9, L, 9, "#222");      // tracks
        body(-L / 2 + 6, -W / 2 + 6, L - 12, W - 12, m.color);                          // house
        body(-L / 2 + 8, -W / 2 + 8, 16, 14, "#4d6f85");                                 // cab glass
        ctx.strokeStyle = m.color; ctx.lineWidth = 7; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(4, 4); ctx.lineTo(1.5 * PX, 4); ctx.stroke();       // boom
        const fill = m.load / m.cap;
        body(1.5 * PX, -9, 14, 18, "#555");                                              // bucket
        body(1.5 * PX + 2, 9 - 16 * fill - 1, 10, 16 * fill, "#6a4f33");
        break;
      }
      case "steel":
        body(-L / 2, -W / 2 + 6, L - 18, W - 12, m.color);
        body(L / 2 - 16, -W / 2, 16, W, "#9a9a9a");                                      // drum
        body(-L / 2 + 6, -10, 18, 20, "#4d6f85");
        break;
      case "pneu":
        body(-L / 2 + 4, -W / 2 + 6, L - 8, W - 12, m.color);
        for (let i = 0; i < 4; i++) { body(L / 2 - 12, -W / 2 + i * (W / 4), 12, W / 4 - 3, "#1d1d1d"); body(-L / 2, -W / 2 + i * (W / 4) + 4, 12, W / 4 - 3, "#1d1d1d"); }
        body(-8, -10, 18, 20, "#4d6f85");
        break;
      case "spread":
        body(-L / 2, -W / 2, L * 0.5, W, "#8a8a86");                                     // stone box at rear
        body(-L / 2 + 3, -W / 2 + 3, L * 0.5 - 6, (W - 6) * (m.load / m.cap), "#b3b2ac");
        body(-L * 0.05, -W / 2 + 10, L * 0.55, W - 20, m.color);
        body(L * 0.1, -10, 16, 20, "#4d6f85");
        break;
      case "paver":
        body(L / 2 - 18, -W / 2 + 4, 18, W - 8, "#3a3330");                              // hopper
        body(L / 2 - 16, -W / 2 + 6, 14 * (m.load / m.cap), W - 12, "#5a3a2a");
        body(-L / 2 + 10, -W / 2 + 10, L - 28, W - 20, m.color);
        body(-L / 2, -W / 2 - 2, 10, W + 4, m.tool ? "#ff8a3a" : "#777");               // screed
        body(-L / 2 + 16, -10, 18, 20, "#4d6f85");
        break;
      case "stripe":
        body(-L / 2, -W / 2, L, W, m.color);
        body(L / 2 - 4, -3, 8, 6, S.color === 1 ? "#fff" : "#3b7bd8");
        if (m.tool) { ctx.fillStyle = S.color === 1 ? "rgba(255,255,255,.5)" : "rgba(59,123,216,.6)"; ctx.beginPath(); ctx.arc(0.55 * PX, 0, 5, 0, Math.PI * 2); ctx.fill(); }
        break;
      case "crew":
        ctx.fillStyle = "#ff8a2a"; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#f6d32b"; ctx.beginPath(); ctx.arc(1, 0, 4.5, 0, Math.PI * 2); ctx.fill();
        break;
    }
    ctx.restore();

    if (selected) {
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(m.name, m.x * PX, m.y * PX - Math.max(L, W) * 0.75 - 4);
    }
  }

  // ---------- Panel ----------
  function toolCell(m) {
    const off = { exc: 1.7, steel: 0.55, pneu: 0, spread: -0.2, paver: -1.05, stripe: 0.55, crew: 0 }[m.id];
    return cellAt(m.x + Math.cos(m.a) * off, m.y + Math.sin(m.a) * off);
  }

  function updatePanel() {
    const m = cur();
    const tags = [];
    tags.push(`<span class="tag ${S.grade ? "on" : ""}">Grade control ${S.grade ? "on" : "off"}</span>`);
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
    $("phases").innerHTML = phases.map((p, i) =>
      `<li class="${p.done ? "done" : i === curIdx ? "current" : ""}"><div class="t"><span>${p.t}</span><span>${Math.round(p.v * 100)}%</span></div><div class="bar"><i style="width:${p.v * 100}%"></i></div></li>`
    ).join("");

    $("hint").textContent = hintFor(m, phases[curIdx]);
    $("day").textContent = `Day ${S.day}`;
    $("time").textContent = fmtTime(S.time);
  }

  function hintFor(m, next) {
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
