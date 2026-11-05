import * as THREE from './lib/three.module.min.js';

/* =====================================================================
   Blacktop Lot Builder
   Take a parking lot from grass to sealed blacktop:
   excavate -> grade base -> pave -> roll -> seal coat.
   ===================================================================== */

// ---------------------------------------------------------------- constants
const CS = 0.5;                    // lot cell size (m)
const GX = 48, GZ = 28;            // lot cells (24 m x 14 m)
const LX0 = -12, LZ0 = -7, LX1 = 12, LZ1 = 7;
const NC = GX * GZ;
const TARGET_CUT = 0.127;          // 5 in
const BASE_T = 0.077;              // 3 in of stone
const ASPH_LOOSE = 0.065;          // 2.5 in loose mat
const ASPH_DONE = 0.05;            // 2 in compacted
const IN = 39.37;
const DONE_AT = 0.93;

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
function rng(seed) { // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- lot state
const cut = new Float32Array(NC);
const base = new Float32Array(NC);
const asph = new Uint8Array(NC);
const temp = new Float32Array(NC);
const passes = new Uint8Array(NC);
const compQ = new Float32Array(NC);
const seal = new Float32Array(NC);
const lastPass = new Float32Array(NC);
const stamp = new Int32Array(NC);
const rnd = new Float32Array(NC);
{
  const r = rng(7);
  for (let c = 0; c < NC; c++) rnd[c] = r();
}
function resetLot() {
  cut.fill(0); base.fill(0); asph.fill(0); temp.fill(0); passes.fill(0);
  compQ.fill(0); seal.fill(0); lastPass.fill(-99); stamp.fill(-5);
  lotDirty = true;
}
const cellIndex = (ix, iz) => iz * GX + ix;
const cellX = (ix) => LX0 + (ix + 0.5) * CS;
const cellZ = (iz) => LZ0 + (iz + 0.5) * CS;
function cellAt(x, z) {
  const ix = Math.floor((x - LX0) / CS), iz = Math.floor((z - LZ0) / CS);
  if (ix < 0 || iz < 0 || ix >= GX || iz >= GZ) return -1;
  return cellIndex(ix, iz);
}
function cellH(c) {
  let h = -cut[c] + base[c];
  if (asph[c]) h += ASPH_LOOSE - (ASPH_LOOSE - ASPH_DONE) * Math.min(passes[c], 3) / 3;
  return h + seal[c] * 0.002;
}

// ---------------------------------------------------------------- renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const isTouch = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.6 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd3e2ec, 70, 260);
const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 700);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 72 : 60;
  camera.updateProjectionMatrix();
  particles.mat.uniforms.uScale.value = h * renderer.getPixelRatio() * 0.5;
}

// ---------------------------------------------------------------- textures
function canvasTex(size, draw, srgb = true) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
const R = rng(42);
const grassTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#5b7d36'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `hsla(${80 + R() * 30},${35 + R() * 25}%,${20 + R() * 22}%,0.55)`;
    const r = 4 + R() * 14; g.beginPath(); g.arc(R() * s, R() * s, r, 0, 7); g.fill();
  }
  for (let i = 0; i < 7000; i++) {
    g.strokeStyle = `hsl(${78 + R() * 34},${35 + R() * 30}%,${22 + R() * 26}%)`;
    g.lineWidth = 1;
    const x = R() * s, y = R() * s, l = 2 + R() * 5, a = -1.6 + (R() - 0.5) * 1.2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
});
const gravelTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#8a857b'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) {
    const v = 90 + R() * 110;
    g.fillStyle = `rgb(${v},${v * 0.97},${v * 0.92})`;
    g.fillRect(R() * s, R() * s, 1 + R() * 2.5, 1 + R() * 2.5);
  }
});
const roadTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#3b3b3d'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 12000; i++) {
    const v = 40 + R() * 70;
    g.fillStyle = `rgb(${v},${v},${v + 3})`;
    g.fillRect(R() * s, R() * s, 1 + R() * 1.5, 1 + R() * 1.5);
  }
});
const detailTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 400; i++) {
    const v = 200 + R() * 55; g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.beginPath(); g.arc(R() * s, R() * s, 3 + R() * 12, 0, 7); g.fill();
  }
  for (let i = 0; i < 12000; i++) {
    const v = 160 + R() * 95; g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(R() * s, R() * s, 1 + R() * 2, 1 + R() * 2);
  }
});
const dotTex = canvasTex(64, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
}, false);

// ---------------------------------------------------------------- materials
const M = {
  yellow: new THREE.MeshStandardMaterial({ color: 0xf2b200, roughness: 0.45, metalness: 0.15 }),
  yellowDark: new THREE.MeshStandardMaterial({ color: 0xc98f00, roughness: 0.55, metalness: 0.1 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x26272a, roughness: 0.75, metalness: 0.2 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x151516, roughness: 0.95 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.8 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.15, metalness: 1.0 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x1b2a35, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.45 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf0efe9, roughness: 0.4, metalness: 0.1 }),
  red: new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.45, metalness: 0.15 }),
  black: new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.25, metalness: 0.3 }),
  dirt: new THREE.MeshStandardMaterial({ color: 0x6b4d31, roughness: 1, map: detailTex }),
  stone: new THREE.MeshStandardMaterial({ color: 0x9a968d, roughness: 1, map: gravelTex }),
  asphalt: new THREE.MeshStandardMaterial({ color: 0x252322, roughness: 0.8, map: detailTex }),
  seat: new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.9 }),
  beacon: new THREE.MeshStandardMaterial({ color: 0xff9a00, emissive: 0xff7a00, emissiveIntensity: 1.5, roughness: 0.3 }),
  headlight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3c4, emissiveIntensity: 0.8 }),
  taillight: new THREE.MeshStandardMaterial({ color: 0x8a0c0c, emissive: 0x700000, emissiveIntensity: 0.6 }),
  paint: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 }),
  paintBlue: new THREE.MeshStandardMaterial({ color: 0x1f5fbf, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 }),
  paintYellow: new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 }),
};

function box(w, h, d, mat, x, y, z, parent, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
function cyl(r, len, mat, x, y, z, axis, parent, seg = 18, rTop) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop ?? r, r, len, seg), mat);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
function wheel(r, w, x, y, z, parent, list) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const tire = cyl(r, w, M.rubber, 0, 0, 0, 'x', g, 20);
  const hub = cyl(r * 0.55, w + 0.02, M.steel, 0, 0, 0, 'x', g, 12);
  // tread blocks so spin is visible
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const b = box(w * 1.02, 0.06, r * 0.35, M.dark, 0, Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98, g, false);
    b.rotation.x = -a;
  }
  hub.castShadow = false; tire.castShadow = true;
  parent.add(g);
  list.push({ g, r });
  return g;
}
function beacon(x, y, z, parent) {
  const b = cyl(0.09, 0.16, M.beacon, x, y, z, null, parent, 10);
  b.castShadow = false;
  return b;
}

// ---------------------------------------------------------------- sky & lights
{
  const skyGeo = new THREE.SphereGeometry(600, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x4f8fd0) }, mid: { value: new THREE.Color(0xa9cbe8) }, bot: { value: new THREE.Color(0xe7eef2) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h*1.6,0.0,1.0), 0.8)) : bot; c = mix(bot, c, smoothstep(-0.02, 0.12, h)); gl_FragColor = vec4(c,1.0); }',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
}
const hemi = new THREE.HemisphereLight(0xd7ebff, 0x5b6a3c, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.position.set(-26, 42, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1536 : 2048, isTouch ? 1536 : 2048);
const sc = sun.shadow.camera;
sc.left = -34; sc.right = 34; sc.top = 30; sc.bottom = -30; sc.near = 5; sc.far = 120;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun);
scene.add(sun.target);

// ---------------------------------------------------------------- ground
{
  const S = 320;
  const shape = new THREE.Shape([new THREE.Vector2(-S, -S), new THREE.Vector2(S, -S), new THREE.Vector2(S, S), new THREE.Vector2(-S, S)]);
  const hole = new THREE.Path([new THREE.Vector2(LX0, LZ0), new THREE.Vector2(LX0, LZ1), new THREE.Vector2(LX1, LZ1), new THREE.Vector2(LX1, LZ0)]);
  shape.holes.push(hole);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  // uv from world xz
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 6, p.getZ(i) / 6);
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  ground.receiveShadow = true;
  scene.add(ground);
}
function flatStrip(x0, x1, z0, z1, mat, y, texScale) {
  const w = x1 - x0, d = z1 - z0;
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + (x0 + x1) / 2) / texScale, (p.getZ(i) + (z0 + z1) / 2) / texScale);
  const m = new THREE.Mesh(geo, mat);
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
const gravelMat = new THREE.MeshStandardMaterial({ map: gravelTex, roughness: 1, color: 0xd8d2c6, polygonOffset: true, polygonOffsetFactor: -1 });
const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1 });
flatStrip(-60, 70, -12.6, -8.0, gravelMat, 0.01, 4);   // haul road
flatStrip(-23, -12.8, -7.5, 9, gravelMat, 0.012, 4);    // west supply pad
flatStrip(12.8, 24.5, -7.5, 9, gravelMat, 0.012, 4);    // east staging pad
flatStrip(-6, 6, 7.4, 11.6, gravelMat, 0.011, 4);       // apron to road
flatStrip(-400, 400, 11.5, 18.5, roadMat, 0.015, 5);    // street
for (let x = -400; x < 400; x += 6) {
  const d = flatStrip(x, x + 3, 14.9, 15.1, M.paintYellow, 0.02, 1); d.castShadow = false;
}
flatStrip(-400, 400, 11.75, 11.88, M.paint, 0.02, 1);
flatStrip(-400, 400, 18.12, 18.25, M.paint, 0.02, 1);
// spray-painted lot outline
{
  const mat = new THREE.MeshBasicMaterial({ color: 0xff6a13 });
  const segs = [];
  for (let x = LX0; x < LX1; x += 1.2) segs.push([x, LZ0 - 0.25, Math.min(0.7, LX1 - x), 0.08], [x, LZ1 + 0.17, Math.min(0.7, LX1 - x), 0.08]);
  for (let z = LZ0; z < LZ1; z += 1.2) segs.push([LX0 - 0.25, z, 0.08, Math.min(0.7, LZ1 - z)], [LX1 + 0.17, z, 0.08, Math.min(0.7, LZ1 - z)]);
  for (const [x, z, w, d] of segs) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mat);
    m.position.set(x + w / 2, 0.02, z + d / 2);
    scene.add(m);
  }
}

// ---------------------------------------------------------------- lot terrain mesh
const NVX = GX + 1, NVZ = GZ + 1;
const vh = new Float32Array(NVX * NVZ);
const lotGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(NVX * NVZ * 3), col = new Float32Array(NVX * NVZ * 3), uv = new Float32Array(NVX * NVZ * 2);
  for (let vz = 0; vz < NVZ; vz++) for (let vx = 0; vx < NVX; vx++) {
    const i = vz * NVX + vx;
    const x = LX0 + vx * CS, z = LZ0 + vz * CS;
    pos[i * 3] = x; pos[i * 3 + 2] = z;
    uv[i * 2] = x / 3; uv[i * 2 + 1] = z / 3;
  }
  const idx = [];
  for (let vz = 0; vz < GZ; vz++) for (let vx = 0; vx < GX; vx++) {
    const a = vz * NVX + vx, b = a + 1, c = a + NVX, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  lotGeo.setIndex(idx);
  lotGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  lotGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  lotGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
const lotMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detailTex, roughness: 0.95 });
const lotMesh = new THREE.Mesh(lotGeo, lotMat);
lotMesh.receiveShadow = true;
scene.add(lotMesh);

const lin = (hex) => new THREE.Color(hex);
const P = {
  grass: lin(0x5a7c35), grass2: lin(0x6f8f3f), dirt: lin(0x8a6440), dirtDeep: lin(0x6a4a2e),
  stoneLow: lin(0x7c7568), stone: lin(0xa8a297), asphHot: lin(0x4a3a2e), asph: lin(0x343334),
  asphDone: lin(0x242425), sealed: lin(0x0f0f11),
};
const cellCol = new Float32Array(NC * 3);
const cellHt = new Float32Array(NC);
const tmpC = new THREE.Color();
function cellColor(c, out) {
  if (seal[c] > 0) out.copy(P.asphDone).lerp(P.sealed, seal[c]);
  else if (asph[c]) {
    const k = Math.min(passes[c], 3) / 3;
    out.copy(P.asph).lerp(P.asphDone, k).lerp(P.asphHot, temp[c] * 0.55 * (1 - k * 0.7));
  } else if (base[c] > 0.003) out.copy(P.stoneLow).lerp(P.stone, Math.min(1, base[c] / BASE_T));
  else if (cut[c] > 0.003) out.copy(P.dirt).lerp(P.dirtDeep, Math.min(1, cut[c] / TARGET_CUT));
  else out.copy(P.grass).lerp(P.grass2, rnd[c]);
  const v = 0.9 + rnd[c] * 0.2;
  out.r *= v; out.g *= v; out.b *= v;
  return out;
}
let lotDirty = true;
function rebuildLot() {
  for (let c = 0; c < NC; c++) {
    cellHt[c] = cellH(c);
    cellColor(c, tmpC);
    cellCol[c * 3] = tmpC.r; cellCol[c * 3 + 1] = tmpC.g; cellCol[c * 3 + 2] = tmpC.b;
  }
  const pos = lotGeo.attributes.position.array, col = lotGeo.attributes.color.array;
  for (let vz = 0; vz < NVZ; vz++) for (let vx = 0; vx < NVX; vx++) {
    let h = 0, r = 0, g = 0, b = 0;
    let n = 0;
    for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
      const ix = vx + dx, iz = vz + dz;
      if (ix < 0 || iz < 0 || ix >= GX || iz >= GZ) continue;
      const c = iz * GX + ix;
      h += cellHt[c]; r += cellCol[c * 3]; g += cellCol[c * 3 + 1]; b += cellCol[c * 3 + 2]; n++;
    }
    const edge = vx === 0 || vz === 0 || vx === GX || vz === GZ;
    const i = vz * NVX + vx;
    const hh = edge ? 0 : h / 4;
    vh[i] = hh;
    pos[i * 3 + 1] = hh;
    col[i * 3] = r / n; col[i * 3 + 1] = g / n; col[i * 3 + 2] = b / n;
  }
  lotGeo.attributes.position.needsUpdate = true;
  lotGeo.attributes.color.needsUpdate = true;
  lotGeo.computeVertexNormals();
  lotGeo.computeBoundingSphere();
  lotDirty = false;
}
function groundH(x, z) {
  const u = (x - LX0) / CS, w = (z - LZ0) / CS;
  if (u <= 0 || w <= 0 || u >= GX || w >= GZ) return 0;
  const i0 = Math.floor(u), j0 = Math.floor(w), fu = u - i0, fw = w - j0;
  const a = vh[j0 * NVX + i0], b = vh[j0 * NVX + i0 + 1], c = vh[(j0 + 1) * NVX + i0], d = vh[(j0 + 1) * NVX + i0 + 1];
  return lerp(lerp(a, b, fu), lerp(c, d, fu), fw);
}
const inLot = (x, z, pad = 0) => x > LX0 - pad && x < LX1 + pad && z > LZ0 - pad && z < LZ1 + pad;

// ---------------------------------------------------------------- scenery
const obstacles = []; // static: {x,z,r} circles or {x0,x1,z0,z1} boxes
{
  const r = rng(99);
  // store building north of the lot
  const bld = new THREE.Group();
  bld.position.set(0, 0, -25);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd9cdb4, roughness: 0.9 });
  box(26, 6, 10, wallMat, 0, 3, 0, bld);
  box(26.4, 0.6, 10.4, new THREE.MeshStandardMaterial({ color: 0x7a6a55, roughness: 0.8 }), 0, 6.2, 0, bld);
  for (let i = 0; i < 6; i++) box(2.8, 2.4, 0.1, M.glass, -10 + i * 4, 1.6, 5.02, bld, false);
  box(2.2, 2.6, 0.12, M.dark, 0, 1.3, 5.05, bld, false);
  const awn = box(26, 0.15, 2, M.red, 0, 3.2, 5.9, bld);
  awn.rotation.x = 0.18;
  const signTex = canvasTex(512, (g, s) => {
    g.fillStyle = '#1d3b5c'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#ffd34d'; g.font = 'bold 150px Arial Narrow, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('CORNER', s / 2, s * 0.32); g.fillText('MARKET', s / 2, s * 0.7);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.2), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 }));
  sign.position.set(0, 4.7, 5.06); bld.add(sign);
  scene.add(bld);
  obstacles.push({ x0: -13.2, x1: 13.2, z0: -30.2, z1: -19.6 });

  // trees
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 2.6, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 1 });
  const leafGeo = new THREE.IcosahedronGeometry(1.8, 0);
  const leafMats = [0x3d6b2f, 0x4a7a35, 0x557f3a, 0x35602a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }));
  let placed = 0, tries = 0;
  while (placed < 110 && tries < 3000) {
    tries++;
    const x = (r() - 0.5) * 190, z = (r() - 0.5) * 150;
    if (x > -32 && x < 32 && z > -34 && z < 13) continue;
    if (z > 9 && z < 21) continue;
    if (Math.abs(z + 10.3) < 4) continue;
    const t = new THREE.Group();
    const s = 0.8 + r() * 0.8;
    t.position.set(x, 0, z);
    t.scale.setScalar(s);
    const tr = new THREE.Mesh(trunkGeo, trunkMat); tr.position.y = 1.3; tr.castShadow = true; t.add(tr);
    const n = 2 + Math.floor(r() * 2);
    for (let k = 0; k < n; k++) {
      const lf = new THREE.Mesh(leafGeo, leafMats[Math.floor(r() * leafMats.length)]);
      lf.position.set((r() - 0.5) * 1.6, 3.2 + k * 0.9 + r() * 0.4, (r() - 0.5) * 1.6);
      lf.scale.set(1 + r() * 0.3, 0.8 + r() * 0.3, 1 + r() * 0.3);
      lf.rotation.y = r() * 6;
      lf.castShadow = true;
      t.add(lf);
    }
    scene.add(t);
    obstacles.push({ x, z, r: 0.5 * s });
    placed++;
  }
  // a hedge line along the haul road back edge
  for (let x = -40; x < 40; x += 2.2) {
    if (Math.abs(x) < 14) continue;
    const h = new THREE.Mesh(leafGeo, leafMats[1]);
    h.scale.set(0.7, 0.5, 0.6);
    h.position.set(x + r(), 0.7, -14.6 + r() * 0.4);
    h.castShadow = true;
    scene.add(h);
  }

  // distant hills
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x6f8a68, roughness: 1, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + r() * 0.3;
    const d = 230 + r() * 60;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(40 + r() * 40, 10, 6), hillMat);
    hill.scale.y = 0.25 + r() * 0.15;
    hill.position.set(Math.cos(a) * d, -4, Math.sin(a) * d);
    scene.add(hill);
  }

  // grass tufts
  const tuftGeo = new THREE.ConeGeometry(0.07, 0.38, 3);
  tuftGeo.translate(0, 0.19, 0);
  const tuftMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const N = isTouch ? 2200 : 3600;
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, N);
  const dummy = new THREE.Object3D(), cc = new THREE.Color();
  let k = 0;
  while (k < N) {
    const x = (r() - 0.5) * 120, z = (r() - 0.5) * 90;
    if (x > LX0 - 1 && x < LX1 + 1 && z > LZ0 - 1 && z < LZ1 + 1) continue;
    if (z > -13 && z < -7.8) continue;           // haul road
    if (z > 11 && z < 19) continue;              // street
    if ((x < -12.5 && x > -23.5 || x > 12.5 && x < 25) && z > -8 && z < 9.5) continue; // pads
    if (x > -6.5 && x < 6.5 && z > 7 && z < 12) continue;
    if (x > -14 && x < 14 && z > -31 && z < -19) continue;
    dummy.position.set(x, 0, z);
    dummy.rotation.set((r() - 0.5) * 0.4, r() * 6, (r() - 0.5) * 0.4);
    dummy.scale.setScalar(0.6 + r() * 1.1);
    dummy.updateMatrix();
    tufts.setMatrixAt(k, dummy.matrix);
    tufts.setColorAt(k, cc.setHSL(0.23 + r() * 0.06, 0.45 + r() * 0.2, 0.22 + r() * 0.12));
    k++;
  }
  scene.add(tufts);

  // power poles + wires along the street
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 1 });
  const tops = [];
  for (let x = -150; x <= 150; x += 30) {
    const g = new THREE.Group(); g.position.set(x, 0, 20.5);
    cyl(0.16, 9, poleMat, 0, 4.5, 0, null, g, 8);
    box(2.4, 0.15, 0.15, poleMat, 0, 8.4, 0, g);
    scene.add(g);
    tops.push(new THREE.Vector3(x - 1, 8.5, 20.5), new THREE.Vector3(x + 1, 8.5, 20.5));
  }
  const wireMat = new THREE.LineBasicMaterial({ color: 0x222222 });
  for (let side = 0; side < 2; side++) {
    const pts = [];
    for (let i = side; i + 2 < tops.length; i += 2) {
      const a = tops[i], b = tops[i + 2];
      for (let s = 0; s <= 10; s++) {
        const t = s / 10;
        pts.push(new THREE.Vector3(lerp(a.x, b.x, t), a.y - Math.sin(t * Math.PI) * 0.8, a.z));
      }
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
  }

  // cones + barrels along the street side of the lot
  const coneGeo = new THREE.ConeGeometry(0.2, 0.6, 12); coneGeo.translate(0, 0.3, 0);
  const bandGeo = new THREE.CylinderGeometry(0.115, 0.14, 0.1, 12);
  for (let x = LX0 + 0.5; x <= LX1; x += 3) {
    if (Math.abs(x) < 6.5) continue;
    const c = new THREE.Mesh(coneGeo, M.orange); c.position.set(x, 0, LZ1 + 0.9); c.castShadow = true; scene.add(c);
    const b = new THREE.Mesh(bandGeo, M.white); b.position.set(x, 0.36, LZ1 + 0.9); scene.add(b);
    obstacles.push({ x, z: LZ1 + 0.9, r: 0.25 });
  }
  const barrelGeo = new THREE.CylinderGeometry(0.33, 0.33, 1, 14);
  for (const [x, z] of [[-6.6, 10.5], [6.6, 10.5], [-24, -8.5], [25, -8.5]]) {
    const b = new THREE.Mesh(barrelGeo, M.orange); b.position.set(x, 0.5, z); b.castShadow = true; scene.add(b);
    for (const y of [0.3, 0.65]) { const w = cyl(0.335, 0.12, M.white, x, y, z, null, scene, 14); w.castShadow = false; }
    obstacles.push({ x, z, r: 0.4 });
  }
  // corner stakes with flags
  for (const [x, z] of [[LX0, LZ0], [LX1, LZ0], [LX0, LZ1], [LX1, LZ1]]) {
    const s = box(0.05, 0.9, 0.05, new THREE.MeshStandardMaterial({ color: 0xc8a06a }), x, 0.45, z, scene);
    s.castShadow = false;
    const f = box(0.02, 0.18, 0.3, new THREE.MeshStandardMaterial({ color: 0xff3d7f, side: THREE.DoubleSide }), x, 0.8, z + 0.15, scene, false);
  }
  // job sign
  const jobTex = canvasTex(512, (g, s) => {
    g.fillStyle = '#f4b400'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#151515'; g.fillRect(14, 14, s - 28, s - 28);
    g.fillStyle = '#f4b400'; g.font = 'bold 74px Arial Narrow, Arial, sans-serif'; g.textAlign = 'center';
    g.fillText('NEW PARKING', s / 2, 150); g.fillText('LOT UNDER', s / 2, 250); g.fillText('CONSTRUCTION', s / 2, 350);
    g.font = 'bold 40px Arial'; g.fillStyle = '#eee'; g.fillText('BLACKTOP LOT BUILDERS', s / 2, 440);
  });
  const js = new THREE.Group(); js.position.set(9.5, 0, 10.4);
  box(0.12, 2.2, 0.12, poleMat, -1.1, 1.1, 0, js); box(0.12, 2.2, 0.12, poleMat, 1.1, 1.1, 0, js);
  const jm = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshStandardMaterial({ map: jobTex, roughness: 0.7 }));
  jm.position.set(0, 2.3, 0.07); jm.rotation.y = Math.PI; js.add(jm);
  const jb = box(2.7, 2.7, 0.05, M.dark, 0, 2.3, 0, js);
  js.rotation.y = Math.PI;
  scene.add(js);
  obstacles.push({ x: 9.5, z: 10.4, r: 0.4 }, { x: 8.4, z: 10.4, r: 0.2 }, { x: 10.6, z: 10.4, r: 0.2 });
}

// ---------------------------------------------------------------- particles
const particles = (() => {
  const MAX = 700;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3), size = new Float32Array(MAX), alpha = new Float32Array(MAX);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { map: { value: dotTex }, uScale: { value: 400 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA;
      uniform float uScale;
      void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size*uScale/max(0.1,-mv.z); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
      void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a*vA); if(gl_FragColor.a < 0.01) discard; }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  const P = [];
  for (let i = 0; i < MAX; i++) P.push({ life: 0, max: 1, x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, s: 0.2, g: 0, r: 1, gg: 1, b: 1, grow: 0, a: 1 });
  let next = 0;
  const cc = new THREE.Color();
  return {
    mat,
    spawn(x, y, z, vx, vy, vz, life, s, color, g = -9, grow = 0, a = 1) {
      const p = P[next]; next = (next + 1) % MAX;
      p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = p.max = life; p.s = s; p.g = g; p.grow = grow; p.a = a;
      cc.set(color); p.r = cc.r; p.gg = cc.g; p.b = cc.b;
    },
    update(dt) {
      for (let i = 0; i < MAX; i++) {
        const p = P[i];
        if (p.life <= 0) { alpha[i] = 0; continue; }
        p.life -= dt;
        p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const gh = groundH(p.x, p.z);
        if (p.y < gh && p.g < 0) { p.y = gh; p.vx *= 0.5; p.vz *= 0.5; p.vy = 0; }
        p.s += p.grow * dt;
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        col[i * 3] = p.r; col[i * 3 + 1] = p.gg; col[i * 3 + 2] = p.b;
        size[i] = p.s;
        const t = p.life / p.max;
        alpha[i] = Math.min(1, t * 2.5) * p.a;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      geo.attributes.size.needsUpdate = true; geo.attributes.alpha.needsUpdate = true;
    },
  };
})();

// ---------------------------------------------------------------- sound
const Sound = {
  ctx: null, on: true,
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(ctx.destination);
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 380; filt.Q.value = 2;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    filt.connect(this.engGain); this.engGain.connect(this.master);
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth'; this.osc1.frequency.value = 45; this.osc1.connect(filt); this.osc1.start();
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square'; this.osc2.frequency.value = 22.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.5; this.osc2.connect(g2); g2.connect(filt); this.osc2.start();
    this.filt = filt;
    // noise
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
    this.hyd = ctx.createGain(); this.hyd.gain.value = 0;
    n.connect(bp); bp.connect(this.hyd); this.hyd.connect(this.master); n.start();
    this.hydF = bp;
    // reverse beeper
    this.beep = ctx.createOscillator(); this.beep.type = 'square'; this.beep.frequency.value = 1100;
    this.beepGain = ctx.createGain(); this.beepGain.gain.value = 0;
    this.beep.connect(this.beepGain); this.beepGain.connect(this.master); this.beep.start();
  },
  update(rpm, work, reversing, t) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime, k = this.on ? 1 : 0;
    this.osc1.frequency.setTargetAtTime(42 + rpm * 38 + work * 12, now, 0.15);
    this.osc2.frequency.setTargetAtTime((42 + rpm * 38 + work * 12) / 2, now, 0.15);
    this.filt.frequency.setTargetAtTime(300 + rpm * 500 + work * 300, now, 0.2);
    this.engGain.gain.setTargetAtTime(k * (0.11 + rpm * 0.07 + work * 0.04), now, 0.2);
    this.hyd.gain.setTargetAtTime(k * work * 0.05, now, 0.1);
    this.hydF.frequency.setTargetAtTime(700 + work * 900, now, 0.1);
    const beepOn = reversing && (t % 1) < 0.5;
    this.beepGain.gain.setTargetAtTime(k * (beepOn ? 0.05 : 0), now, 0.01);
  },
  burst(dur = 0.4, freq = 400, vol = 0.3) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(now); s.stop(now + dur + 0.05);
  },
  chime(notes = [523, 659, 784, 1047]) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, now = ctx.currentTime;
    notes.forEach((fq, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fq;
      const g = ctx.createGain(); const t0 = now + i * 0.11;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + 0.55);
    });
  },
  click() { this.chime([880]); },
};

// ---------------------------------------------------------------- machines
function finishMachine(g) {
  g.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; } });
  scene.add(g);
}
function decalStripe(parent, w, x, y, z, ry = 0) {
  const s = box(w, 0.08, 0.02, M.dark, x, y, z, parent, false);
  s.rotation.y = ry;
}

function buildExcavator() {
  const g = new THREE.Group();
  const wheels = [];
  for (const s of [-1, 1]) {
    box(0.62, 0.55, 3.3, M.rubber, s * 1.05, 0.36, 0, g);
    cyl(0.33, 0.6, M.rubber, s * 1.05, 0.36, 1.62, 'x', g);
    cyl(0.33, 0.6, M.rubber, s * 1.05, 0.36, -1.62, 'x', g);
    box(0.12, 0.3, 2.8, M.dark, s * 1.38, 0.38, 0, g);
    for (let i = 0; i < 5; i++) cyl(0.12, 0.14, M.steel, s * 1.42, 0.3, -1.1 + i * 0.55, 'x', g, 10);
    // track grousers
    for (let i = 0; i < 14; i++) box(0.64, 0.05, 0.08, M.dark, s * 1.05, 0.66, -1.5 + i * 0.23, g, false);
  }
  box(1.4, 0.4, 2.4, M.dark, 0, 0.72, 0, g);
  cyl(0.6, 0.25, M.dark, 0, 0.92, 0, null, g, 20);
  const house = new THREE.Group(); house.position.y = 0.98; g.add(house);
  box(2.5, 0.22, 3.1, M.dark, 0, 0.11, -0.25, house);
  box(2.5, 0.95, 1.6, M.yellow, 0, 0.7, -0.85, house);                 // engine body
  box(2.5, 0.85, 0.55, M.yellowDark, 0, 0.62, -1.88, house);           // counterweight
  box(1.4, 0.12, 1.3, M.dark, -0.45, 1.22, -0.95, house);              // engine grille
  cyl(0.06, 0.6, M.dark, -0.95, 1.5, -0.5, null, house, 8);            // exhaust
  box(0.8, 0.8, 1.15, M.yellow, -0.85, 0.62, 0.55, house);             // tank box (right front)
  for (let i = 0; i < 3; i++) box(0.05, 0.05, 1.0, M.steel, -0.47, 1.06, 0.5, house, false).position.x = -1.2 + i * 0.35;
  decalStripe(house, 2.52, 0, 0.6, -0.04);
  // cab (left front)
  const cab = new THREE.Group(); cab.position.set(0.72, 0.22, 0.5); house.add(cab);
  box(0.95, 1.5, 1.1, M.glass, 0, 0.8, 0, cab, false);
  box(1.0, 0.08, 1.18, M.yellow, 0, 1.58, -0.02, cab);
  box(0.95, 1.5, 0.12, M.yellow, 0, 0.8, -0.56, cab);
  for (const [x, z] of [[-0.46, 0.53], [0.46, 0.53], [-0.46, -0.1], [0.46, -0.1]]) box(0.06, 1.5, 0.06, M.yellow, x, 0.8, z, cab, false);
  box(0.95, 0.35, 1.1, M.yellow, 0, 0.17, 0, cab);
  const seat = box(0.45, 0.5, 0.45, M.seat, 0, 0.45, -0.25, cab, false);
  for (const s of [-1, 1]) box(0.08, 0.25, 0.08, M.dark, s * 0.32, 0.55, 0.12, cab, false);
  beacon(0.3, 1.7, -0.3, cab);
  box(0.12, 0.1, 0.05, M.headlight, -0.3, 1.45, 0.58, cab, false);
  // boom / stick / bucket
  const boomP = new THREE.Group(); boomP.position.set(-0.05, 0.75, 0.9); house.add(boomP);
  const boom = box(0.42, 0.55, 3.4, M.yellow, 0, 0, 1.7, boomP);
  cyl(0.09, 2.4, M.chrome, 0, -0.42, 1.0, 'z', boomP, 10);
  cyl(0.14, 1.4, M.yellowDark, 0, -0.42, 0.25, 'z', boomP, 10);
  cyl(0.09, 1.6, M.chrome, 0, 0.42, 2.4, 'z', boomP, 10);
  const stickP = new THREE.Group(); stickP.position.set(0, 0, 3.4); boomP.add(stickP);
  box(0.32, 0.42, 2.4, M.yellow, 0, 0, 1.2, stickP);
  cyl(0.12, 0.52, M.dark, 0, 0, 0, 'x', stickP, 12);
  cyl(0.07, 1.4, M.chrome, 0, 0.32, 1.3, 'z', stickP, 10);
  const bucketP = new THREE.Group(); bucketP.position.set(0, 0, 2.4); stickP.add(bucketP);
  cyl(0.1, 0.5, M.dark, 0, 0, 0, 'x', bucketP, 12);
  const bk = new THREE.Group(); bucketP.add(bk);
  box(0.95, 0.08, 0.85, M.yellowDark, 0, 0.35, 0.42, bk);    // back
  box(0.95, 0.65, 0.08, M.dark, 0, 0.06, 0.86, bk);          // bottom/shell end
  for (const s of [-1, 1]) box(0.06, 0.65, 0.9, M.yellowDark, s * 0.47, 0.06, 0.43, bk);
  for (let i = 0; i < 5; i++) { const t = box(0.08, 0.2, 0.1, M.steel, -0.36 + i * 0.18, -0.33, 0.86, bk, false); }
  const bucketDirt = box(0.86, 0.5, 0.75, M.dirt, 0, 0.05, 0.45, bk, false);
  bucketDirt.visible = false;

  finishMachine(g);
  return {
    type: 'excavator', name: 'Excavator', g, wheels, house, boomP, stickP, bucketP, bucketDirt,
    cab: new THREE.Vector3(0.72, 0.98 + 0.22 + 1.28, 0.62), chaseDist: 10.5,
    maxV: 2.2, revV: 1.6, accel: 2.4, turn: 0.95, spin: true, radius: 1.9, len: 3.3, wid: 2.4,
    reach: new THREE.Vector3(-0.05, 0, 4.95), dumpReach: new THREE.Vector3(-0.05, 0, 5.4),
    load: 0, cap: 100 * TARGET_CUT, loadLabel: 'BUCKET',
    pose: { a: -0.75, b: 2.0, c: 1.5 }, anim: null,
  };
}

function buildSkid() {
  const g = new THREE.Group();
  const wheels = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(0.38, 0.3, sx * 0.82, 0.38, sz * 0.66, g, wheels);
  box(1.3, 0.65, 2.1, M.yellow, 0, 0.75, -0.1, g);
  box(1.34, 0.75, 0.6, M.yellowDark, 0, 0.92, -1.0, g);
  box(1.1, 0.1, 0.5, M.dark, 0, 1.32, -1.0, g);
  decalStripe(g, 1.32, 0, 0.9, 0.97);
  const cab = new THREE.Group(); cab.position.set(0, 1.07, 0.1); g.add(cab);
  box(0.95, 1.0, 1.15, M.glass, 0, 0.5, 0, cab, false);
  box(1.06, 0.08, 1.3, M.yellow, 0, 1.03, 0, cab);
  for (const [x, z] of [[-0.5, 0.6], [0.5, 0.6], [-0.5, -0.6], [0.5, -0.6]]) box(0.07, 1.0, 0.07, M.dark, x, 0.5, z, cab, false);
  box(0.45, 0.45, 0.45, M.seat, 0, 0.2, -0.2, cab, false);
  beacon(0.38, 1.12, -0.45, cab);
  // lift arms
  const armP = new THREE.Group(); armP.position.set(0, 1.55, -0.9); g.add(armP);
  for (const s of [-1, 1]) {
    const arm = box(0.12, 0.22, 2.4, M.yellow, s * 0.73, 0, 1.15, armP);
    box(0.12, 0.5, 0.14, M.yellow, s * 0.73, -0.25, 2.3, armP);
  }
  const tool = new THREE.Group(); tool.position.set(0, 0.3, 1.45); g.add(tool);
  box(1.95, 0.55, 0.12, M.dark, 0, 0.27, 0.0, tool);         // back plate
  for (const s of [-1, 1]) box(0.08, 0.55, 0.62, M.dark, s * 0.95, 0.27, 0.28, tool);
  box(1.95, 0.06, 0.62, M.dark, 0, 0.02, 0.28, tool);
  box(1.95, 0.05, 0.08, M.steel, 0, 0.0, 0.6, tool, false);
  const fill = box(1.8, 0.4, 0.5, M.stone, 0, 0.22, 0.3, tool, false);
  finishMachine(g);
  return {
    type: 'skid', name: 'Skid steer + box blade', g, wheels, armP, tool, fill,
    cab: new THREE.Vector3(0, 1.07 + 0.82, 0.05), chaseDist: 7.5,
    maxV: 3.6, revV: 2.8, accel: 4.5, turn: 1.6, spin: true, radius: 1.35, len: 2.2, wid: 1.6,
    load: 1, cap: 1, loadCells: 260, loadLabel: 'STONE', toolOn: false, bladeY: 0.75,
  };
}

function buildPaver() {
  const g = new THREE.Group();
  const wheels = [];
  for (const s of [-1, 1]) {
    box(0.5, 0.5, 2.6, M.rubber, s * 1.1, 0.3, 0.1, g);
    cyl(0.28, 0.5, M.rubber, s * 1.1, 0.3, 1.4, 'x', g);
    cyl(0.28, 0.5, M.rubber, s * 1.1, 0.3, -1.2, 'x', g);
  }
  box(2.4, 1.05, 2.4, M.yellow, 0, 1.05, -0.2, g);
  decalStripe(g, 2.42, 0, 1.2, 1.0);
  // hopper
  box(2.6, 0.12, 1.5, M.dark, 0, 0.98, 1.75, g);
  for (const s of [-1, 1]) { const w = box(0.1, 0.65, 1.5, M.yellow, s * 1.33, 1.3, 1.75, g); w.rotation.z = s * -0.35; }
  box(2.6, 0.45, 0.1, M.yellowDark, 0, 1.15, 2.5, g);
  cyl(0.16, 2.4, M.dark, 0, 0.55, 2.55, 'x', g, 12); // push rollers
  const fill = box(2.4, 0.5, 1.35, M.asphalt, 0, 1.25, 1.75, g, false);
  // operator deck + canopy
  box(2.6, 0.12, 1.2, M.dark, 0, 1.62, -1.05, g);
  box(0.6, 0.8, 0.3, M.dark, 0.6, 2.05, -0.65, g);
  box(0.45, 0.5, 0.45, M.seat, 0.6, 1.9, -1.15, g, false);
  for (const [x, z] of [[-1.2, -0.5], [1.2, -0.5], [-1.2, -1.6], [1.2, -1.6]]) box(0.08, 1.6, 0.08, M.dark, x, 2.45, z, g, false);
  box(2.7, 0.1, 1.7, M.yellow, 0, 3.27, -1.05, g);
  beacon(-1.0, 3.4, -1.5, g);
  cyl(0.06, 1.0, M.dark, -0.8, 2.1, 0.3, null, g, 8);
  // auger + screed
  cyl(0.18, 3.0, M.dark, 0, 0.3, -1.5, 'x', g, 10);
  const screed = new THREE.Group(); screed.position.set(0, 0, -1.95); g.add(screed);
  box(3.1, 0.38, 0.65, M.steel, 0, 0.34, 0, screed);
  box(3.1, 0.12, 0.7, M.yellow, 0, 0.6, 0, screed);
  for (const s of [-1, 1]) box(0.06, 0.5, 0.8, M.yellow, s * 1.56, 0.3, 0, screed);
  finishMachine(g);
  return {
    type: 'paver', name: 'Asphalt paver', g, wheels, fill, screed,
    cab: new THREE.Vector3(0.6, 3.0, -1.05), chaseDist: 10,
    maxV: 1.7, revV: 1.2, accel: 1.8, turn: 0.75, spin: true, radius: 1.8, len: 4.4, wid: 2.8,
    load: 1, cap: 1, loadCells: 520, loadLabel: 'HOPPER', toolOn: false,
  };
}

function buildRoller() {
  const g = new THREE.Group();
  const wheels = [], drums = [];
  for (const z of [-1.25, 1.25]) {
    const d = new THREE.Group(); d.position.set(0, 0.6, z); g.add(d);
    cyl(0.6, 1.8, M.steel, 0, 0, 0, 'x', d, 24);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const b = box(1.82, 0.03, 0.08, M.dark, 0, Math.cos(a) * 0.6, Math.sin(a) * 0.6, d, false); b.rotation.x = -a; }
    drums.push(d);
    for (const s of [-1, 1]) box(0.1, 0.9, 1.3, M.yellow, s * 0.98, 0.85, z, g);
    box(2.05, 0.12, 1.3, M.yellow, 0, 1.3, z, g);
  }
  box(1.3, 0.8, 1.1, M.yellow, 0, 1.15, 0, g);
  box(1.6, 0.55, 0.9, M.yellowDark, 0, 1.6, -0.75, g);
  box(1.3, 0.1, 0.6, M.dark, 0, 1.9, -0.75, g);
  decalStripe(g, 2.06, 0, 1.25, 1.91);
  box(1.4, 0.1, 1.3, M.dark, 0, 1.62, 0.35, g);
  box(0.45, 0.5, 0.45, M.seat, 0, 1.9, 0.25, g, false);
  box(0.6, 0.6, 0.2, M.dark, 0, 1.95, 0.85, g);
  for (const [x, z] of [[-0.75, 0.95], [0.75, 0.95], [-0.75, -0.25], [0.75, -0.25]]) box(0.07, 1.55, 0.07, M.dark, x, 2.4, z, g, false);
  box(1.75, 0.1, 1.5, M.yellow, 0, 3.2, 0.35, g);
  beacon(0, 3.33, -0.1, g);
  // water spray bars
  for (const z of [-1.95, 1.95]) cyl(0.04, 1.7, M.steel, 0, 1.15, z, 'x', g, 8);
  finishMachine(g);
  return {
    type: 'roller', name: 'Double-drum roller', g, wheels, drums,
    cab: new THREE.Vector3(0, 2.6, 0.4), chaseDist: 8,
    maxV: 2.6, revV: 2.6, accel: 3, turn: 0.85, spin: false, radius: 1.45, len: 3.6, wid: 2.0,
    load: 1, cap: 1, loadLabel: 'WATER', toolOn: false,
  };
}

function buildSealer() {
  const g = new THREE.Group();
  const wheels = [];
  for (const sx of [-1, 1]) for (const z of [1.7, -1.3]) wheel(0.42, 0.32, sx * 0.95, 0.42, z, g, wheels);
  box(1.6, 0.25, 4.6, M.dark, 0, 0.62, -0.1, g);
  // cab
  box(1.9, 0.85, 1.4, M.white, 0, 1.1, 1.85, g);
  box(1.9, 0.9, 1.3, M.white, 0, 1.95, 1.2, g);
  box(1.8, 0.62, 0.05, M.glass, 0, 2.0, 1.86, g, false);
  for (const s of [-1, 1]) box(0.05, 0.55, 1.0, M.glass, s * 0.96, 2.0, 1.2, g, false);
  box(1.92, 0.15, 1.42, M.yellow, 0, 1.25, 1.86, g);
  box(1.4, 0.35, 0.06, M.dark, 0, 0.95, 2.56, g);
  for (const s of [-1, 1]) box(0.3, 0.16, 0.05, M.headlight, s * 0.65, 1.2, 2.57, g, false);
  beacon(0.6, 2.47, 1.2, g);
  beacon(-0.6, 2.47, 1.2, g);
  // bed + tank
  box(2.0, 0.12, 3.0, M.dark, 0, 0.82, -0.85, g);
  const tank = cyl(0.72, 2.5, M.black, 0, 1.6, -0.85, 'z', g, 20);
  for (const z of [-1.8, -0.85, 0.1]) cyl(0.735, 0.08, M.steel, 0, 1.6, z, 'z', g, 20);
  box(0.3, 0.2, 0.3, M.steel, 0, 2.35, -0.85, g);
  box(0.35, 0.6, 0.35, M.dark, 0.75, 1.15, -2.0, g); // pump
  // spray bar
  box(3.3, 0.07, 0.07, M.steel, 0, 0.42, -2.65, g);
  for (const s of [-1, 1]) { const a = box(0.06, 0.06, 0.6, M.steel, s * 0.7, 0.55, -2.35, g, false); a.rotation.x = 0.3; }
  for (let i = 0; i < 9; i++) cyl(0.03, 0.1, M.dark, -1.6 + i * 0.4, 0.35, -2.65, null, g, 6);
  for (const s of [-1, 1]) box(0.25, 0.12, 0.05, M.taillight, s * 0.8, 0.7, -2.42, g, false);
  finishMachine(g);
  return {
    type: 'sealer', name: 'Sealcoat truck', g, wheels,
    cab: new THREE.Vector3(0.45, 2.25, 1.25), chaseDist: 9.5,
    maxV: 4.2, revV: 2.5, accel: 3.5, turn: 0.95, spin: false, radius: 1.6, len: 5, wid: 2.1,
    load: 1, cap: 1, loadCells: 800, loadLabel: 'SEALER', toolOn: false,
  };
}

function buildDumpTruck(cargoMat, cabMat) {
  const g = new THREE.Group();
  const wheels = [];
  for (const sx of [-1, 1]) for (const z of [2.3, -0.9, -2.15]) wheel(0.55, 0.42, sx * 1.0, 0.55, z, g, wheels);
  box(1.5, 0.35, 6.2, M.dark, 0, 0.9, 0, g);
  box(2.3, 1.55, 1.7, cabMat, 0, 1.95, 2.55, g);
  box(2.25, 0.7, 0.05, M.glass, 0, 2.35, 3.41, g, false);
  for (const s of [-1, 1]) box(0.05, 0.6, 1.0, M.glass, s * 1.16, 2.35, 2.65, g, false);
  box(2.1, 0.95, 0.65, M.dark, 0, 1.25, 3.6, g);
  for (const s of [-1, 1]) box(0.3, 0.18, 0.05, M.headlight, s * 0.8, 1.35, 3.94, g, false);
  cyl(0.07, 1.6, M.chrome, -1.0, 3.0, 1.75, null, g, 8);
  beacon(0.7, 2.82, 2.4, g);
  const bed = new THREE.Group(); bed.position.set(0, 1.15, -1.0); g.add(bed);
  box(2.45, 0.14, 4.5, M.red, 0, 0, 0, bed);
  for (const s of [-1, 1]) box(0.1, 1.1, 4.5, M.red, s * 1.2, 0.6, 0, bed);
  box(2.45, 1.4, 0.12, M.red, 0, 0.75, 2.2, bed);
  box(2.45, 1.05, 0.1, M.red, 0, 0.58, -2.22, bed);
  for (const z of [-1.4, -0.3, 0.8]) for (const s of [-1, 1]) box(0.06, 1.12, 0.12, M.dark, s * 1.27, 0.6, z, bed, false);
  for (const s of [-1, 1]) box(0.25, 0.15, 0.05, M.taillight, s * 0.9, -0.2, -2.3, bed, false);
  const cargo = box(2.25, 1.0, 4.3, cargoMat, 0, 0.55, 0, bed, false);
  finishMachine(g);
  return { g, wheels, bed, cargo };
}

// ---------------------------------------------------------------- supplies / props
const haul = (() => {
  const t = buildDumpTruck(M.dirt, M.white);
  return { ...t, x: 2, z: -10.3, h: Math.PI / 2, v: 0, state: 'parked', load: 0, cap: 5 * 100 * TARGET_CUT, wait: 0, count: 0 };
})();
const asphTruck = (() => {
  const t = buildDumpTruck(M.asphalt, M.yellow);
  t.cargo.scale.y = 0.8; t.cargo.position.y = 0.45;
  t.g.position.set(-19.2, 0, 2.5); t.g.rotation.y = -Math.PI / 2; t.bed.rotation.x = -0.35; t.bed.position.y = 1.5;
  return t;
})();
const stonePile = (() => {
  const g = new THREE.Group();
  const geo = new THREE.ConeGeometry(2.6, 1.7, 14, 3);
  const p = geo.attributes.position; const r = rng(5);
  for (let i = 0; i < p.count; i++) { if (p.getY(i) < 0.84) { p.setX(i, p.getX(i) * (0.9 + r() * 0.2)); p.setZ(i, p.getZ(i) * (0.9 + r() * 0.2)); } }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, M.stone); m.position.y = 0.8; m.castShadow = true; m.receiveShadow = true; g.add(m);
  g.position.set(-17.5, 0, -2.5);
  scene.add(g);
  return g;
})();
const tote = (() => {
  const g = new THREE.Group();
  box(1.2, 0.15, 1.2, new THREE.MeshStandardMaterial({ color: 0x6b5132 }), 0, 0.08, 0, g);
  box(1.1, 1.0, 1.1, new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.3, transparent: true, opacity: 0.9 }), 0, 0.7, 0, g);
  box(1.06, 0.8, 1.06, M.black, 0, 0.6, 0, g, false);
  for (let i = 0; i < 4; i++) { const b = box(1.16, 0.04, 0.04, M.steel, 0, 0.3 + i * 0.3, 0.57, g, false); const c = b.clone(); c.position.z = -0.57; g.add(c); }
  const g2 = g.clone(); g2.position.set(1.4, 0, 0); g.add(g2);
  g.position.set(17.2, 0, 6.8);
  scene.add(g);
  return g;
})();

// ---------------------------------------------------------------- stages
const STAGES = [
  {
    key: 'dig', name: 'EXCAVATE', title: 'Excavate the lot', build: buildExcavator,
    spawn: [15.5, -3, -Math.PI / 2],
    desc: 'Strip the grass and topsoil out of the staked lot. Grade control stops every bite at exactly 5 inches.',
    tips: [
      'Drive with the joystick. The <b>ring on the ground</b> shows where the bucket will bite.',
      'Tap <b>DIG</b>. The bucket holds about three bites.',
      'When it is full, turn until the ring is over the <b>haul truck bed</b> and tap <b>DUMP</b>.',
      'Full trucks haul off and an empty one pulls in.',
    ],
    objective: 'Dig the whole lot down to 5 in',
    done: (c) => cut[c] >= 0.11,
    fill: (c) => { cut[c] = TARGET_CUT; },
  },
  {
    key: 'grade', name: 'GRADE BASE', title: 'Spread the stone base', build: buildSkid,
    spawn: [-14.2, 5.5, Math.PI / 2],
    desc: 'Lay 3 inches of crushed stone over the dirt and level it to grade. This is what keeps the blacktop from cracking.',
    tips: [
      'Your box blade starts full. Tap <b>BLADE DOWN</b> and drive over bare dirt to spread stone.',
      'Drive into the <b>stone pile</b> on the west pad to refill the blade.',
      'Gray means at grade. Brown spots still need stone.',
    ],
    objective: 'Spread 3 in of stone base everywhere',
    done: (c) => base[c] >= 0.065,
    fill: (c) => { base[c] = BASE_T; },
  },
  {
    key: 'pave', name: 'PAVE', title: 'Lay the asphalt', build: buildPaver,
    spawn: [-15.5, -5.2, Math.PI / 2],
    desc: 'Lay a 2½-inch mat of hot asphalt across the base. The paver drops the mat out of the screed behind it.',
    tips: [
      'Tap <b>SCREED ON</b> and drive <b>forward</b> in long, straight passes.',
      'The screed is 3 m wide. Overlap passes a little so there are no gaps.',
      'When the hopper runs low, pull its front up to the back of the <b>asphalt truck</b> on the west pad.',
    ],
    objective: 'Pave the whole lot',
    done: (c) => asph[c] === 1,
    fill: (c) => { asph[c] = 1; temp[c] = Math.max(temp[c], 0.5); },
  },
  {
    key: 'roll', name: 'ROLL', title: 'Compact the mat', build: buildRoller,
    spawn: [15.5, -4.5, -Math.PI / 2],
    desc: 'Compact the fresh asphalt. Every spot needs 3 passes with vibration on, and hot asphalt compacts best.',
    tips: [
      'Tap <b>VIBE ON</b>, then roll back and forth over the mat.',
      'Each pass darkens and smooths the mat. Three passes and it is done.',
      'The mat cools over time, so roll the <b>warm brown areas</b> first for the best quality.',
    ],
    objective: 'Give every spot 3 passes',
    done: (c) => passes[c] >= 3,
    fill: (c) => { if (passes[c] < 3) { compQ[c] += (3 - passes[c]) * 0.15; passes[c] = 3; } },
  },
  {
    key: 'seal', name: 'SEAL COAT', title: 'Seal coat the lot', build: buildSealer,
    spawn: [16.5, 2.2, -Math.PI / 2],
    desc: 'Spray a coat of sealer to protect the new blacktop from sun, water and oil. This gives it that deep black finish.',
    tips: [
      'Tap <b>SPRAY ON</b>. The spray bar is at the back of the truck, 3.3 m wide.',
      'Drive in passes over the asphalt until it is all deep black.',
      'Refill at the <b>sealer totes</b> on the east pad.',
    ],
    objective: 'Seal the entire lot',
    done: (c) => seal[c] >= 0.99,
    fill: (c) => { seal[c] = 1; },
  },
];

// ---------------------------------------------------------------- game state
const G = {
  state: 'loading', stage: 0, time: 0, progress: 0, reached: false,
  machine: null, parked: [], coverage: [], rollQ: 0,
  view: 'chase', lookYaw: 0, lookPitch: -0.12, orbitYaw: 0, orbitPitch: 0, lastLook: 0,
  frame: 0, finale: null, hintText: '',
};

// ---------------------------------------------------------------- input
const input = { x: 0, y: 0, jx: 0, jy: 0, keys: new Set() };
{
  const joy = $('joy'), knob = $('knob');
  let id = null;
  const R = () => joy.clientWidth / 2;
  const move = (e) => {
    const r = joy.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const max = R() * 0.72, d = Math.hypot(dx, dy);
    if (d > max) { dx *= max / d; dy *= max / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.jx = dx / max; input.jy = -dy / max;
  };
  joy.addEventListener('pointerdown', (e) => { id = e.pointerId; joy.setPointerCapture(id); move(e); e.preventDefault(); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; input.jx = input.jy = 0; knob.style.transform = ''; };
  joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);

  // drag-to-look on the canvas
  const looks = new Map();
  canvas.addEventListener('pointerdown', (e) => { looks.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    const p = looks.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    const k = 0.005;
    if (G.view === 'cab') { G.lookYaw -= dx * k; G.lookPitch = clamp(G.lookPitch - dy * k, -1.0, 0.6); }
    else { G.orbitYaw -= dx * k; G.orbitPitch = clamp(G.orbitPitch + dy * k * 0.6, -0.35, 0.45); }
    G.lastLook = performance.now();
  });
  const lend = (e) => looks.delete(e.pointerId);
  canvas.addEventListener('pointerup', lend); canvas.addEventListener('pointercancel', lend);
  canvas.addEventListener('dblclick', () => { G.lookYaw = 0; G.lookPitch = -0.12; G.orbitYaw = 0; G.orbitPitch = 0; });

  addEventListener('keydown', (e) => {
    if (e.repeat) { if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); return; }
    input.keys.add(e.code);
    if (G.state === 'play') {
      if (e.code === 'Space') { e.preventDefault(); doAction(); }
      if (e.code === 'KeyV' || e.code === 'KeyC') toggleView();
      if (e.code === 'Enter' && G.reached) nextStage();
      if (e.code === 'Escape' || e.code === 'KeyP') pause(true);
    } else if (G.state === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) pause(false);
    else if (G.state === 'card' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); $('cardGo').click(); }
  });
  addEventListener('keyup', (e) => input.keys.delete(e.code));
  addEventListener('blur', () => input.keys.clear());
}
function readInput() {
  const k = input.keys;
  let kx = 0, ky = 0;
  if (k.has('KeyW') || k.has('ArrowUp')) ky += 1;
  if (k.has('KeyS') || k.has('ArrowDown')) ky -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) kx += 1;
  if (k.has('KeyA') || k.has('ArrowLeft')) kx -= 1;
  const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
  input.x = clamp(dz(input.jx) + kx, -1, 1);
  input.y = clamp(dz(input.jy) + ky, -1, 1);
}

// ---------------------------------------------------------------- helpers
function toWorld(m, lx, lz) {
  const c = Math.cos(m.h), s = Math.sin(m.h);
  return { x: m.x + lx * c + lz * s, z: m.z - lx * s + lz * c };
}
function toLocal(m, x, z) {
  const c = Math.cos(m.h), s = Math.sin(m.h), dx = x - m.x, dz = z - m.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
function forCellsInRect(m, lx0, lx1, lz0, lz1, fn) {
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (const [a, b] of [[lx0, lz0], [lx1, lz0], [lx0, lz1], [lx1, lz1]]) {
    const w = toWorld(m, a, b);
    minx = Math.min(minx, w.x); maxx = Math.max(maxx, w.x); minz = Math.min(minz, w.z); maxz = Math.max(maxz, w.z);
  }
  const ix0 = Math.max(0, Math.floor((minx - LX0) / CS)), ix1 = Math.min(GX - 1, Math.floor((maxx - LX0) / CS));
  const iz0 = Math.max(0, Math.floor((minz - LZ0) / CS)), iz1 = Math.min(GZ - 1, Math.floor((maxz - LZ0) / CS));
  for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
    const l = toLocal(m, cellX(ix), cellZ(iz));
    if (l.x >= lx0 && l.x <= lx1 && l.z >= lz0 && l.z <= lz1) fn(cellIndex(ix, iz));
  }
}
function forCellsInCircle(x, z, r, fn) {
  const ix0 = Math.max(0, Math.floor((x - r - LX0) / CS)), ix1 = Math.min(GX - 1, Math.floor((x + r - LX0) / CS));
  const iz0 = Math.max(0, Math.floor((z - r - LZ0) / CS)), iz1 = Math.min(GZ - 1, Math.floor((z + r - LZ0) / CS));
  for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
    const d = Math.hypot(cellX(ix) - x, cellZ(iz) - z);
    if (d <= r) fn(cellIndex(ix, iz), d);
  }
}

// ---------------------------------------------------------------- UI helpers
let toastTimer = 0;
function toast(msg, kind = '', dur = 2.6) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show ' + kind;
  toastTimer = dur;
}
function setHint(text) {
  if (text === G.hintText) return;
  G.hintText = text;
  const h = $('hint');
  if (text) { h.textContent = text; h.classList.add('show'); } else h.classList.remove('show');
}
const fmtTime = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function show(id, on) { $(id).classList.toggle('hidden', !on); }

// ---------------------------------------------------------------- machine lifecycle
function spawnMachine(i) {
  const st = STAGES[i];
  const m = st.build();
  m.x = st.spawn[0]; m.z = st.spawn[1]; m.h = st.spawn[2];
  m.v = 0; m.y = 0; m.pitch = 0; m.roll = 0;
  m.g.position.set(m.x, 0, m.z);
  m.g.rotation.y = m.h;
  G.machine = m;
  G.lookYaw = 0; G.lookPitch = m.type === 'excavator' ? -0.22 : -0.15; G.orbitYaw = 0; G.orbitPitch = 0;
  snapCamera = true;
  return m;
}
const PARK = [[21.5, -5.5], [21.5, -1.2], [21.5, 3.1], [21.5, 7.4]];
function parkMachine(m) {
  const slot = PARK[G.parked.length] || [21.5, 7.4];
  m.x = slot[0]; m.z = slot[1]; m.h = -Math.PI / 2; m.v = 0;
  m.g.position.set(m.x, 0, m.z); m.g.rotation.set(0, m.h, 0);
  if (m.type === 'excavator') { setArmPose(m, { a: -0.85, b: 2.3, c: 2.4 }); m.bucketDirt.visible = false; }
  if (m.type === 'skid') m.tool.position.y = 0.3;
  G.parked.push(m);
}
function setArmPose(m, p) {
  m.pose = { ...p };
  m.boomP.rotation.x = p.a; m.stickP.rotation.x = p.b; m.bucketP.rotation.x = p.c;
}

function updateSupplies() {
  const s = STAGES[G.stage].key;
  haul.g.visible = s === 'dig';
  asphTruck.g.visible = s === 'pave';
  stonePile.visible = s === 'grade';
  tote.visible = s === 'seal' || G.stage > 4;
}
function dynamicObstacles() {
  const list = [];
  const s = STAGES[G.stage]?.key;
  if (s === 'dig' && haul.g.visible) {
    for (const lz of [2.6, 0.2, -2.4]) { const w = toWorld(haul, 0, lz); list.push({ x: w.x, z: w.z, r: 1.35 }); }
  }
  if (s === 'pave') for (const lx of [-2.5, -0.5, 1.6]) list.push({ x: -19.2 - lx, z: 2.5, r: 1.35 });
  if (s === 'grade') list.push({ x: stonePile.position.x, z: stonePile.position.z, r: 1.9 });
  if (s === 'seal') list.push({ x: 17.2, z: 6.8, r: 0.8 }, { x: 18.6, z: 6.8, r: 0.8 });
  for (const p of G.parked) list.push({ x: p.x, z: p.z, r: p.radius * 0.95 });
  return list;
}

// ---------------------------------------------------------------- physics
function driveMachine(m, dt, ax, ay, locked) {
  if (locked) { ax = 0; ay = 0; }
  const target = ay >= 0 ? ay * m.maxV : ay * m.revV;
  const a = Math.sign(target - m.v) === Math.sign(m.v) || m.v === 0 ? m.accel : m.accel * 1.8;
  m.v += clamp(target - m.v, -a * dt, a * dt);
  if (Math.abs(m.v) < 0.01 && ay === 0) m.v = 0;
  let turn;
  if (m.spin) turn = ax * m.turn * (Math.abs(m.v) > 0.2 && m.v < 0 ? -1 : 1);
  else turn = ax * m.turn * clamp(m.v / (m.maxV * 0.35), -1, 1);
  m.h -= turn * dt;
  const fx = Math.sin(m.h), fz = Math.cos(m.h);
  m.x += fx * m.v * dt; m.z += fz * m.v * dt;
  // collisions
  const obs = obstacles.concat(dynamicObstacles());
  for (const o of obs) {
    if (o.r !== undefined) {
      const dx = m.x - o.x, dz = m.z - o.z, d = Math.hypot(dx, dz), min = o.r + m.radius;
      if (d < min && d > 0.0001) { m.x = o.x + (dx / d) * min; m.z = o.z + (dz / d) * min; m.v *= 0.6; }
    } else {
      const cx = clamp(m.x, o.x0, o.x1), cz = clamp(m.z, o.z0, o.z1);
      const dx = m.x - cx, dz = m.z - cz, d = Math.hypot(dx, dz);
      if (d < m.radius) {
        if (d < 0.0001) { m.z = o.z1 + m.radius; } else { m.x = cx + (dx / d) * m.radius; m.z = cz + (dz / d) * m.radius; }
        m.v *= 0.6;
      }
    }
  }
  m.x = clamp(m.x, -55, 60); m.z = clamp(m.z, -18.5, 10.8);
  // terrain follow
  const hl = m.len * 0.4, hw = m.wid * 0.4;
  const f = toWorld(m, 0, hl), b = toWorld(m, 0, -hl), l = toWorld(m, hw, 0), r = toWorld(m, -hw, 0);
  const hf = groundH(f.x, f.z), hb = groundH(b.x, b.z), hL = groundH(l.x, l.z), hR = groundH(r.x, r.z);
  const ty = Math.max((hf + hb) / 2, (hL + hR) / 2);
  m.y = lerp(m.y, ty, Math.min(1, dt * 10));
  m.pitch = lerp(m.pitch, Math.atan2(hb - hf, hl * 2), Math.min(1, dt * 8));
  m.roll = lerp(m.roll, Math.atan2(hL - hR, hw * 2), Math.min(1, dt * 8));
  m.g.position.set(m.x, m.y, m.z);
  m.g.rotation.set(m.pitch, m.h, m.roll, 'YXZ');
  for (const w of m.wheels) w.g.rotation.x += (m.v * dt) / w.r;
  if (m.drums) for (const d of m.drums) d.rotation.x += (m.v * dt) / 0.6;
}

// ---------------------------------------------------------------- excavator
const POSE = {
  rest: { a: -0.62, b: 2.15, c: 1.6 },
  reach: { a: -0.52, b: 1.45, c: 0.35 },
  dig: { a: -0.42, b: 1.57, c: 0.65 },
  curl: { a: -0.5, b: 1.75, c: 2.1 },
  carry: { a: -0.6, b: 2.25, c: 2.3 },
  dumpUp: { a: -0.98, b: 1.35, c: 2.0 },
  dumpOpen: { a: -0.98, b: 1.35, c: 0.25 },
};
const DIG_SEQ = [['reach', 0.35], ['dig', 0.3, 'bite'], ['curl', 0.3], ['carry', 0.35]];
const DUMP_SEQ = [['dumpUp', 0.45], ['dumpOpen', 0.35, 'dump'], ['carry', 0.25], ['rest', 0.35]];
function excavatorAnim(m, dt) {
  const a = m.anim;
  if (!a) {
    const idle = m.load > 0 ? POSE.carry : POSE.rest;
    const k = Math.min(1, dt * 4);
    setArmPose(m, { a: lerp(m.pose.a, idle.a, k), b: lerp(m.pose.b, idle.b, k), c: lerp(m.pose.c, idle.c, k) });
    return;
  }
  a.t += dt;
  const [key, dur, ev] = a.seq[a.i];
  const t = ease(Math.min(1, a.t / dur));
  const to = POSE[key];
  setArmPose(m, { a: lerp(a.from.a, to.a, t), b: lerp(a.from.b, to.b, t), c: lerp(a.from.c, to.c, t) });
  if (a.t >= dur) {
    if (ev === 'bite') doBite(m);
    if (ev === 'dump') doDump(m);
    a.i++; a.t = 0; a.from = { ...m.pose };
    if (a.i >= a.seq.length) m.anim = null;
  }
}
function reachWorld(m, dump = false) {
  const r = dump ? m.dumpReach : m.reach;
  return toWorld(m, r.x, r.z);
}
function overTruckBed(m) {
  if (haul.state !== 'parked') return false;
  const p = reachWorld(m, true);
  const l = toLocal(haul, p.x, p.z);
  return Math.abs(l.x) < 1.7 && l.z > -3.6 && l.z < 1.6;
}
function nearTruckBed(m) {
  const p = reachWorld(m, true);
  const l = toLocal(haul, p.x, p.z);
  return Math.abs(l.x) < 3.5 && l.z > -5 && l.z < 3;
}
function doBite(m) {
  const p = reachWorld(m);
  let removed = 0;
  const room = m.cap - m.load;
  forCellsInCircle(p.x, p.z, 1.75, (c, d) => {
    const target = d < 1.35 ? TARGET_CUT : TARGET_CUT * 0.6;
    if (cut[c] < target) { removed += target - cut[c]; cut[c] = target; }
  });
  m.load = Math.min(m.cap, m.load + removed);
  if (removed > 0) {
    lotDirty = true;
    Sound.burst(0.5, 500, 0.35);
    for (let i = 0; i < 26; i++) particles.spawn(p.x + (Math.random() - 0.5) * 2, 0.1, p.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.5, 1 + Math.random() * 2, (Math.random() - 0.5) * 1.5, 0.8 + Math.random() * 0.6, 0.12 + Math.random() * 0.1, 0x6b4d31);
    for (let i = 0; i < 10; i++) particles.spawn(p.x + (Math.random() - 0.5) * 2.5, 0.4, p.z + (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6, 2 + Math.random(), 0.7, 0xb9a07e, 0, 1.2, 0.35);
  } else toast('Already at grade here. Move to fresh ground.', 'warn');
}
function doDump(m) {
  const amt = m.load;
  m.load = 0;
  haul.load = Math.min(haul.cap, haul.load + amt);
  Sound.burst(0.9, 300, 0.4);
  const p = toWorld(haul, 0, -1.0);
  for (let i = 0; i < 40; i++) particles.spawn(p.x + (Math.random() - 0.5) * 1.5, 3 + Math.random(), p.z + (Math.random() - 0.5) * 1.5, (Math.random() - 0.5), -1 - Math.random(), (Math.random() - 0.5), 0.6 + Math.random() * 0.5, 0.15, 0x6b4d31);
  for (let i = 0; i < 12; i++) particles.spawn(p.x + (Math.random() - 0.5) * 2, 2.6, p.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 0.8, 0.5, (Math.random() - 0.5) * 0.8, 2.2, 0.9, 0xc2ab88, 0, 1.0, 0.3);
  if (haul.load >= haul.cap - 0.01) {
    haul.state = 'leaving'; haul.count++;
    toast(`Truck #${haul.count} loaded. Hauling off, next truck is coming.`, 'good', 3);
    Sound.chime([392, 523]);
  }
}
function updateHaul(dt) {
  if (!haul.g.visible) return;
  if (haul.state === 'leaving') {
    haul.v = Math.min(9, haul.v + dt * 2.5);
    haul.x += haul.v * dt;
    if (haul.x > 60) { haul.state = 'arriving'; haul.x = -60; haul.load = 0; haul.v = 9; }
  } else if (haul.state === 'arriving') {
    const d = 2 - haul.x;
    haul.v = clamp(d * 0.6, 0.6, 9);
    haul.x += haul.v * dt;
    if (haul.x >= 2) { haul.x = 2; haul.v = 0; haul.state = 'parked'; toast('Empty haul truck in position.', '', 2); }
  }
  haul.g.position.set(haul.x, 0, haul.z);
  haul.g.rotation.y = haul.h;
  const f = haul.load / haul.cap;
  haul.cargo.visible = f > 0.01;
  haul.cargo.scale.y = Math.max(0.05, f);
  haul.cargo.position.y = 0.05 + 0.5 * f;
  for (const w of haul.wheels) w.g.rotation.x += (haul.v * dt) / w.r;
  if (haul.state !== 'parked' && Math.random() < 0.4) {
    const p = toWorld(haul, 0, -3.2);
    particles.spawn(p.x, 0.3, p.z, (Math.random() - 0.5) * 0.5, 0.3, (Math.random() - 0.5) * 0.5, 1.6, 0.9, 0xcfc1a5, 0, 1.4, 0.3);
  }
}

// ---------------------------------------------------------------- per-machine work
function workMachine(m, dt, now) {
  const moving = Math.abs(m.v) > 0.12;
  if (m.type === 'excavator') {
    excavatorAnim(m, dt);
    m.bucketDirt.visible = m.load > 0.01;
    m.bucketDirt.scale.y = Math.max(0.1, m.load / m.cap);
    return m.anim ? 1 : 0;
  }
  if (m.type === 'skid') {
    const ty = m.toolOn ? 0.05 : 0.45;
    m.bladeY = lerp(m.bladeY, ty, Math.min(1, dt * 6));
    m.tool.position.y = m.bladeY;
    m.armP.rotation.x = (0.45 - m.bladeY) * 0.35;
    m.fill.visible = m.load > 0.01;
    m.fill.scale.y = Math.max(0.1, m.load);
    // refill at pile
    const bp = toWorld(m, 0, 1.75);
    const dp = Math.hypot(bp.x - stonePile.position.x, bp.z - stonePile.position.z);
    if (dp < 3.0 && m.load < 1) {
      m.load = Math.min(1, m.load + dt * 0.45);
      if (Math.random() < 0.5) particles.spawn(bp.x, 0.6, bp.z, (Math.random() - 0.5), 0.8, (Math.random() - 0.5), 1.2, 0.5, 0xbab3a6, 0, 0.8, 0.35);
      if (m.load >= 1) { toast('Blade full of stone.', 'good', 1.6); Sound.click(); }
    }
    if (m.toolOn && moving && m.load > 0) {
      let used = 0;
      forCellsInRect(m, -0.95, 0.95, 1.1, 1.8, (c) => {
        if (base[c] < BASE_T && m.load * m.loadCells - used > 0) {
          const need = (BASE_T - base[c]) / BASE_T;
          const u = Math.min(need, m.load * m.loadCells - used);
          base[c] += u * BASE_T; used += u;
        }
      });
      if (used > 0) {
        m.load = Math.max(0, m.load - used / m.loadCells);
        lotDirty = true;
        if (Math.random() < 0.6) { const p = toWorld(m, (Math.random() - 0.5) * 1.8, 1.9); particles.spawn(p.x, 0.15, p.z, (Math.random() - 0.5) * 0.4, 0.5, (Math.random() - 0.5) * 0.4, 1.5, 0.7, 0xc8c0b0, 0, 1.0, 0.35); }
        if (m.load <= 0) { toast('Out of stone. Refill at the stone pile.', 'warn'); }
      }
    }
    return (m.toolOn ? 0.6 : 0) + (dp < 3 ? 0.5 : 0);
  }
  if (m.type === 'paver') {
    m.fill.visible = m.load > 0.01;
    m.fill.scale.y = Math.max(0.1, m.load);
    m.fill.position.y = 1.0 + 0.25 * m.load;
    // refill from truck
    const hp = toWorld(m, 0, 2.7);
    const rear = { x: -19.2 + 3.3, z: 2.5 };
    const dTruck = Math.hypot(hp.x - rear.x, hp.z - rear.z);
    if (dTruck < 2.6 && m.load < 1) {
      m.load = Math.min(1, m.load + dt * 0.35);
      if (Math.random() < 0.6) particles.spawn(hp.x + (Math.random() - 0.5) * 2, 1.8, hp.z, 0, 0.6, 0, 1.6, 0.8, 0xe8e8e8, 0, 1.3, 0.25);
      if (m.load >= 1) { toast('Hopper full.', 'good', 1.6); Sound.click(); }
    }
    if (m.toolOn && m.load > 0) {
      if (m.v > 0.1) {
        let used = 0;
        forCellsInRect(m, -1.55, 1.55, -2.3, -1.65, (c) => {
          if (!asph[c] && used < m.load * m.loadCells) { asph[c] = 1; temp[c] = 1; passes[c] = 0; used++; }
        });
        if (used) { m.load = Math.max(0, m.load - used / m.loadCells); lotDirty = true; if (m.load <= 0) toast('Hopper empty. Load up at the asphalt truck.', 'warn'); }
      }
      if (Math.random() < 0.5) { const p = toWorld(m, (Math.random() - 0.5) * 3, -2.1); particles.spawn(p.x, 0.4, p.z, 0, 0.5, 0, 2, 0.6, 0xeeeeee, 0, 1.0, 0.18); }
    }
    return m.toolOn ? 0.7 : 0;
  }
  if (m.type === 'roller') {
    const f = G.frame;
    forCellsInRect(m, -0.9, 0.9, -1.85, 1.85, (c) => {
      const entered = stamp[c] < f - 1;
      stamp[c] = f;
      if (entered && m.toolOn && moving && asph[c] && passes[c] < 3 && now - lastPass[c] > 0.9) {
        passes[c]++; lastPass[c] = now;
        compQ[c] += (0.35 + 0.65 * temp[c]) / 3;
        lotDirty = true;
      }
    });
    if (m.toolOn) {
      m.g.position.y += Math.sin(now * 90) * 0.008;
      if (Math.random() < 0.3) { const p = toWorld(m, (Math.random() - 0.5) * 1.8, 1.95 * (m.v >= 0 ? 1 : -1)); particles.spawn(p.x, 1.1, p.z, 0, -1, 0, 0.5, 0.08, 0xcfe3ff, -6); }
    }
    return m.toolOn ? 0.8 : 0;
  }
  if (m.type === 'sealer') {
    const dTote = Math.hypot(m.x - 17.9, m.z - 6.8);
    if (dTote < 3.6 && m.load < 1) {
      m.load = Math.min(1, m.load + dt * 0.4);
      if (m.load >= 1) { toast('Tank full of sealer.', 'good', 1.6); Sound.click(); }
    }
    if (m.toolOn && m.load > 0) {
      if (moving) {
        let used = 0;
        forCellsInRect(m, -1.65, 1.65, -3.1, -2.4, (c) => {
          if (asph[c] && seal[c] < 1 && used < m.load * m.loadCells) { used += 1 - seal[c]; seal[c] = 1; }
        });
        if (used) { m.load = Math.max(0, m.load - used / m.loadCells); lotDirty = true; if (m.load <= 0) toast('Tank empty. Refill at the sealer totes.', 'warn'); }
      }
      for (let i = 0; i < 3; i++) { const p = toWorld(m, (Math.random() - 0.5) * 3.2, -2.65); particles.spawn(p.x, 0.32, p.z, (Math.random() - 0.5) * 0.3, -0.4, (Math.random() - 0.5) * 0.3, 0.35, 0.1, 0x111111, -4); }
    }
    return m.toolOn ? 0.6 : 0;
  }
  return 0;
}

// ---------------------------------------------------------------- actions
function doAction() {
  if (G.state !== 'play') return;
  const m = G.machine;
  Sound.init();
  if (m.type === 'excavator') {
    if (m.anim) return;
    if (m.load > 0.01 && overTruckBed(m)) {
      m.anim = { seq: DUMP_SEQ, i: 0, t: 0, from: { ...m.pose } };
      return;
    }
    if (m.load > 0.01 && nearTruckBed(m) && haul.state !== 'parked') { toast('Wait for the next truck to pull in.', 'warn'); return; }
    if (m.load >= m.cap - 0.01) { toast('Bucket full. Swing it over the truck bed.', 'warn'); return; }
    const p = reachWorld(m);
    if (!inLot(p.x, p.z, 0.4)) { toast('Dig inside the orange lot lines.', 'warn'); return; }
    m.v = 0;
    m.anim = { seq: DIG_SEQ, i: 0, t: 0, from: { ...m.pose } };
    return;
  }
  m.toolOn = !m.toolOn;
  Sound.click();
  if (m.type === 'paver' && m.toolOn && m.load <= 0) toast('Hopper is empty.', 'warn');
  if (m.type === 'sealer' && m.toolOn && m.load <= 0) toast('Tank is empty.', 'warn');
  if (m.type === 'skid' && m.toolOn && m.load <= 0) toast('Blade is empty. Load stone at the pile.', 'warn');
}
function actionLabel(m) {
  switch (m.type) {
    case 'excavator':
      if (m.anim) return [m.anim.seq === DUMP_SEQ ? 'DUMP' : 'DIG', 'WORKING', true];
      if (m.load > 0.01 && overTruckBed(m)) return ['DUMP', 'OVER TRUCK', false];
      return ['DIG', m.load >= m.cap - 0.01 ? 'BUCKET FULL' : 'GRADE CTL 5"', m.load >= m.cap - 0.01];
    case 'skid': return [m.toolOn ? 'BLADE UP' : 'BLADE DOWN', m.toolOn ? 'SPREADING' : 'RAISED', false, m.toolOn];
    case 'paver': return [m.toolOn ? 'SCREED OFF' : 'SCREED ON', m.toolOn ? 'PAVING' : 'STOPPED', false, m.toolOn];
    case 'roller': return [m.toolOn ? 'VIBE OFF' : 'VIBE ON', m.toolOn ? 'VIBRATING' : 'STATIC', false, m.toolOn];
    case 'sealer': return [m.toolOn ? 'SPRAY OFF' : 'SPRAY ON', m.toolOn ? 'SPRAYING' : 'BAR OFF', false, m.toolOn];
  }
  return ['GO', '', false];
}
function toggleView() {
  G.view = G.view === 'cab' ? 'chase' : 'cab';
  G.lookYaw = 0; G.orbitYaw = 0; G.orbitPitch = 0;
  G.lookPitch = G.machine?.type === 'excavator' ? -0.22 : -0.15;
  snapCamera = true;
  $('viewTag').textContent = G.view === 'cab' ? 'CAB VIEW' : 'CHASE VIEW';
  Sound.click();
}

// ---------------------------------------------------------------- tool marker
const markerMat = new THREE.LineBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.95, depthTest: true });
const MARK_N = 40;
const markerGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(MARK_N * 3), 3));
const marker = new THREE.LineLoop(markerGeo, markerMat);
marker.frustumCulled = false;
scene.add(marker);
function updateMarker(m) {
  const arr = markerGeo.attributes.position.array;
  let pts = [];
  if (m.type === 'excavator') {
    const over = m.load > 0.01 && overTruckBed(m);
    const p = reachWorld(m, over);
    const r = over ? 0.9 : 1.6;
    for (let i = 0; i < MARK_N; i++) { const a = (i / MARK_N) * Math.PI * 2; pts.push([p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, over ? 2.85 : null]); }
    markerMat.color.set(over ? 0x5fd38a : m.load >= m.cap - 0.01 ? 0xff8a5c : 0xffd34d);
  } else {
    const rect = { skid: [-0.95, 0.95, 1.1, 1.8], paver: [-1.55, 1.55, -2.3, -1.65], roller: [-0.9, 0.9, -1.85, 1.85], sealer: [-1.65, 1.65, -3.1, -2.4] }[m.type];
    const [x0, x1, z0, z1] = rect;
    const per = MARK_N / 4;
    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for (let s = 0; s < 4; s++) {
      const [ax, az] = corners[s], [bx, bz] = corners[(s + 1) % 4];
      for (let i = 0; i < per; i++) { const t = i / per; const w = toWorld(m, lerp(ax, bx, t), lerp(az, bz, t)); pts.push([w.x, w.z, null]); }
    }
    markerMat.color.set(m.toolOn ? 0x5fd38a : 0xffd34d);
  }
  for (let i = 0; i < MARK_N; i++) {
    const [x, z, y] = pts[i];
    arr[i * 3] = x; arr[i * 3 + 1] = y ?? groundH(x, z) + 0.04; arr[i * 3 + 2] = z;
  }
  markerGeo.attributes.position.needsUpdate = true;
  marker.visible = true;
}

// ---------------------------------------------------------------- camera
let snapCamera = true;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function updateCamera(dt, now) {
  const m = G.machine;
  if (G.state === 'title' || G.state === 'loading') {
    const t = now * 0.00006;
    camera.position.set(Math.sin(t) * 34, 16, Math.cos(t) * 30);
    camera.lookAt(0, 0, 0);
    return;
  }
  if (G.state === 'finale' || G.state === 'results') {
    const t = (G.finale?.t ?? 0) * 0.12 + 0.6;
    const tp = new THREE.Vector3(Math.sin(t) * 26, 17, Math.cos(t) * 22);
    camera.position.lerp(tp, Math.min(1, dt * 1.5));
    camera.lookAt(0, 0, 0);
    return;
  }
  if (!m) return;
  if (G.view === 'cab') {
    // drift look back to straight ahead while driving
    if (Math.abs(m.v) > 0.3 && now - G.lastLook > 2500) { G.lookYaw *= 1 - Math.min(1, dt * 1.5); }
    m.g.updateMatrixWorld();
    const p = m.cab.clone().applyMatrix4(m.g.matrixWorld);
    const yaw = m.h + G.lookYaw, pitch = G.lookPitch;
    camera.position.copy(p);
    camera.lookAt(p.x + Math.sin(yaw) * Math.cos(pitch), p.y + Math.sin(pitch), p.z + Math.cos(yaw) * Math.cos(pitch));
    snapCamera = false;
    return;
  }
  // chase: behind and above at ~45 degrees
  const yaw = m.h + G.orbitYaw;
  const d = m.chaseDist;
  const el = Math.PI / 4 + G.orbitPitch;
  const tx = m.x - Math.sin(yaw) * Math.cos(el) * d, tz = m.z - Math.cos(yaw) * Math.cos(el) * d, ty = m.y + Math.sin(el) * d + 0.5;
  const look = new THREE.Vector3(m.x + Math.sin(m.h) * 1.2, m.y + 0.8, m.z + Math.cos(m.h) * 1.2);
  if (snapCamera) { camPos.set(tx, ty, tz); camLook.copy(look); snapCamera = false; }
  const k = 1 - Math.exp(-dt * 5);
  camPos.lerp(new THREE.Vector3(tx, ty, tz), k);
  camLook.lerp(look, 1 - Math.exp(-dt * 8));
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

// ---------------------------------------------------------------- minimap
const mm = $('minimap');
const mctx = mm.getContext('2d');
const lotImg = document.createElement('canvas'); lotImg.width = GX; lotImg.height = GZ;
const lctx = lotImg.getContext('2d');
const lotData = lctx.createImageData(GX, GZ);
const MAPX0 = -26, MAPX1 = 26, MAPZ0 = -15, MAPZ1 = 14;
function drawMinimap() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = mm.clientWidth, H = mm.clientHeight;
  if (mm.width !== W * dpr) { mm.width = W * dpr; mm.height = H * dpr; }
  const ctx = mctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sx = W / (MAPX1 - MAPX0), sz = H / (MAPZ1 - MAPZ0);
  const X = (x) => (x - MAPX0) * sx, Z = (z) => (z - MAPZ0) * sz;
  ctx.fillStyle = '#4c6a2f'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#9b9488';
  ctx.fillRect(X(-60), Z(-12.6), X(70) - X(-60), Z(-8) - Z(-12.6));
  ctx.fillRect(X(-23), Z(-7.5), X(-12.8) - X(-23), Z(9) - Z(-7.5));
  ctx.fillRect(X(12.8), Z(-7.5), X(24.5) - X(12.8), Z(9) - Z(-7.5));
  ctx.fillStyle = '#3a3a3c'; ctx.fillRect(0, Z(11.5), W, Z(18.5) - Z(11.5));
  ctx.fillStyle = '#cdbf9f'; ctx.fillRect(X(-13), Z(-30), X(13) - X(-13), Z(-19.6) - Z(-30));
  // lot cells
  const d = lotData.data;
  for (let c = 0; c < NC; c++) {
    tmpC.setRGB(cellCol[c * 3], cellCol[c * 3 + 1], cellCol[c * 3 + 2]);
    tmpC.convertLinearToSRGB();
    d[c * 4] = tmpC.r * 255; d[c * 4 + 1] = tmpC.g * 255; d[c * 4 + 2] = tmpC.b * 255; d[c * 4 + 3] = 255;
    if (!STAGES[G.stage] || G.state !== 'play') continue;
    if (!STAGES[G.stage].done(c)) { /* keep */ } else if (G.stage < 4) { d[c * 4] = d[c * 4] * 0.8 + 40; d[c * 4 + 1] = d[c * 4 + 1] * 0.8 + 50; d[c * 4 + 2] *= 0.8; }
  }
  lctx.putImageData(lotData, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(lotImg, X(LX0), Z(LZ0), X(LX1) - X(LX0), Z(LZ1) - Z(LZ0));
  ctx.strokeStyle = '#ff6a13'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
  ctx.strokeRect(X(LX0), Z(LZ0), X(LX1) - X(LX0), Z(LZ1) - Z(LZ0));
  ctx.setLineDash([]);
  // supplies
  const s = STAGES[G.stage]?.key;
  const drawRot = (x, z, h, w, l, color) => {
    ctx.save(); ctx.translate(X(x), Z(z)); ctx.rotate(-h); ctx.fillStyle = color; ctx.fillRect(-w * sx / 2, -l * sz / 2, w * sx, l * sz); ctx.restore();
  };
  if (s === 'dig' && haul.g.visible) drawRot(haul.x, haul.z, haul.h, 2.4, 6.6, '#e9e6de');
  if (s === 'pave') drawRot(-19.2, 2.5, -Math.PI / 2, 2.4, 6.6, '#f4b400');
  if (s === 'grade') { ctx.fillStyle = '#c9c3b6'; ctx.beginPath(); ctx.arc(X(stonePile.position.x), Z(stonePile.position.z), 2.6 * sx, 0, 7); ctx.fill(); }
  if (s === 'seal') { ctx.fillStyle = '#111'; ctx.fillRect(X(16.6), Z(6.2), 2.6 * sx, 1.2 * sz); }
  for (const p of G.parked) drawRot(p.x, p.z, p.h, p.wid, p.len, '#a88300');
  // player
  const m = G.machine;
  if (m) {
    ctx.save(); ctx.translate(X(m.x), Z(m.z)); ctx.rotate(Math.PI - m.h);
    if (G.view === 'cab') {
      ctx.fillStyle = 'rgba(255,211,77,0.25)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 26, -Math.PI / 2 - 0.55 - G.lookYaw, -Math.PI / 2 + 0.55 - G.lookYaw); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------- HUD
const ui = {
  stageChip: $('stageChip'), stageName: $('stageName'), clock: $('clock'), objective: $('objective'),
  fill: $('progressFill'), pct: $('progressPct'), speed: $('gSpeed'), head: $('gHead'),
  loadLabel: $('gLoadLabel'), loadFill: $('gLoadFill'), readLabel: $('gReadLabel'), read: $('gRead'),
  action: $('actionBtn'), actionLabel: $('actionLabel'), actionSub: $('actionSub'), next: $('nextBtn'),
};
function compass(h) {
  const deg = ((Math.atan2(Math.sin(h), -Math.cos(h)) * 180) / Math.PI + 360) % 360;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return `${dirs[Math.round(deg / 45) % 8]} ${Math.round(deg)}°`;
}
function cellUnder(m) {
  if (m.type === 'excavator') { const p = reachWorld(m); return cellAt(p.x, p.z); }
  const lz = { skid: 1.45, paver: -2.0, roller: 0, sealer: -2.75 }[m.type];
  const p = toWorld(m, 0, lz);
  return cellAt(p.x, p.z);
}
function updateHUD() {
  const m = G.machine;
  const st = STAGES[G.stage];
  ui.stageChip.textContent = `STEP ${G.stage + 1}/5`;
  ui.stageName.textContent = st.name;
  ui.clock.textContent = fmtTime(G.time);
  const pct = Math.floor(G.progress * 100);
  ui.fill.style.width = `${pct}%`;
  ui.fill.classList.toggle('done', G.progress >= DONE_AT);
  ui.pct.textContent = `${pct}%  ·  goal ${Math.round(DONE_AT * 100)}%`;
  ui.objective.textContent = st.objective;
  ui.speed.textContent = `${(Math.abs(m.v) * 2.237).toFixed(1)} mph`;
  ui.head.textContent = compass(m.h);
  ui.loadLabel.textContent = `${m.loadLabel} ${Math.round((m.load / m.cap) * 100)}%`;
  const lf = m.load / m.cap;
  ui.loadFill.style.width = `${Math.round(lf * 100)}%`;
  ui.loadFill.classList.toggle('low', m.type !== 'excavator' && lf < 0.2);
  // under-tool reading
  const c = cellUnder(m);
  let read = 'Off the lot';
  if (c >= 0) {
    if (m.type === 'excavator') read = `Cut ${(cut[c] * IN).toFixed(1)} of 5.0 in`;
    else if (m.type === 'skid') read = base[c] >= 0.065 ? 'Base at grade' : `Base ${(base[c] * IN).toFixed(1)} of 3.0 in`;
    else if (m.type === 'paver') read = asph[c] ? 'Mat down · 2.5 in loose' : 'Bare base';
    else if (m.type === 'roller') read = asph[c] ? `Passes ${passes[c]}/3 · ${Math.round(140 + temp[c] * 160)}°F` : 'No asphalt';
    else if (m.type === 'sealer') read = seal[c] > 0.5 ? 'Sealed' : asph[c] ? 'Needs sealer' : 'No asphalt';
  }
  ui.readLabel.textContent = m.type === 'excavator' ? 'UNDER BUCKET' : 'UNDER TOOL';
  ui.read.textContent = read;
  const [label, sub, disabled, on] = actionLabel(m);
  ui.actionLabel.textContent = label;
  ui.actionSub.textContent = sub;
  ui.action.classList.toggle('disabled', !!disabled);
  ui.action.classList.toggle('on', !!on);
  ui.next.classList.toggle('hidden', !G.reached);
  ui.next.textContent = G.stage === 4 ? 'FINISH JOB ▶' : 'NEXT STAGE ▶';
  // contextual hint
  let hint = '';
  if (m.type === 'excavator') {
    if (m.load >= m.cap - 0.01 && !overTruckBed(m)) hint = haul.state === 'parked' ? 'Bucket full. Turn until the ring is over the haul truck bed, then tap DUMP.' : 'Bucket full. The next haul truck is pulling in.';
    else if (m.load > 0.01 && overTruckBed(m)) hint = 'Over the truck bed. Tap DUMP.';
  } else if (m.type === 'skid' && m.load <= 0.01) hint = 'Blade empty. Drive into the stone pile on the west pad to refill.';
  else if (m.type === 'paver' && m.load <= 0.01) hint = 'Hopper empty. Pull the front of the paver up to the back of the asphalt truck.';
  else if (m.type === 'sealer' && m.load <= 0.01) hint = 'Tank empty. Park next to the sealer totes on the east pad.';
  else if (m.type === 'roller' && !m.toolOn) hint = 'Turn vibration on. Passes only count with vibration.';
  else if (m.type === 'paver' && m.toolOn && m.v < -0.1) hint = 'Pavers only lay mat while driving forward.';
  setHint(hint);
}

// ---------------------------------------------------------------- progress
function computeProgress() {
  const st = STAGES[G.stage];
  let n = 0;
  for (let c = 0; c < NC; c++) if (st.done(c)) n++;
  return n / NC;
}
function coolMat(dt) {
  for (let c = 0; c < NC; c++) if (asph[c] && temp[c] > 0.08) temp[c] = Math.max(0.08, temp[c] - dt / 420);
}

// ---------------------------------------------------------------- stage flow
function showCard(i) {
  const st = STAGES[i];
  $('cardStep').textContent = `STEP ${i + 1} OF 5`;
  $('cardTitle').textContent = st.title;
  $('cardMachine').textContent = G.machine.name.toUpperCase();
  $('cardDesc').textContent = st.desc;
  $('cardTips').innerHTML = st.tips.map((t) => `<li>${t}</li>`).join('');
  G.state = 'card';
  show('card', true);
  show('hud', true);
}
function beginStage(i) {
  G.stage = i;
  G.reached = false;
  G.progress = 0;
  spawnMachine(i);
  updateSupplies();
  if (i === 0) { haul.x = 2; haul.state = 'parked'; haul.load = 0; haul.v = 0; haul.count = 0; }
  showCard(i);
}
function nextStage() {
  if (!G.reached) return;
  const st = STAGES[G.stage];
  G.coverage[G.stage] = G.progress;
  if (st.key === 'roll') {
    let q = 0, n = 0;
    for (let c = 0; c < NC; c++) { q += Math.min(1, compQ[c]); n++; }
    G.rollQ = q / n;
  }
  for (let c = 0; c < NC; c++) if (!st.done(c)) st.fill(c);
  lotDirty = true;
  const m = G.machine;
  m.toolOn = false;
  if (m.anim) m.anim = null;
  parkMachine(m);
  G.machine = null;
  Sound.chime();
  if (G.stage >= 4) startFinale();
  else beginStage(G.stage + 1);
}

// ---------------------------------------------------------------- finale: stripes + cars
const finaleGroup = new THREE.Group();
scene.add(finaleGroup);
function buildCar(color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.5 });
  box(1.8, 0.6, 4.2, paint, 0, 0.55, 0, g);
  box(1.6, 0.55, 2.2, paint, 0, 1.12, -0.2, g);
  box(1.62, 0.45, 2.0, M.glass, 0, 1.12, -0.2, g, false);
  for (const sx of [-1, 1]) for (const z of [1.35, -1.35]) cyl(0.33, 0.24, M.rubber, sx * 0.85, 0.33, z, 'x', g, 14);
  for (const s of [-1, 1]) box(0.3, 0.12, 0.04, M.headlight, s * 0.6, 0.65, 2.11, g, false);
  return g;
}
function startFinale() {
  G.state = 'finale';
  show('hud', false);
  marker.visible = false;
  setHint('');
  finaleGroup.clear();
  const items = [];
  const y = ASPH_DONE + 0.004;
  // stall lines: north and south rows
  for (const [z0, z1] of [[LZ0 + 0.3, LZ0 + 5.6], [LZ1 - 5.6, LZ1 - 0.3]]) {
    for (let k = 0; k <= 8; k++) {
      const x = -10.8 + k * 2.7;
      const mat = k <= 1 && z0 < 0 ? M.paintBlue : M.paint;
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.12, z1 - z0).rotateX(-Math.PI / 2), mat);
      l.position.set(x, y, (z0 + z1) / 2);
      items.push(l);
    }
  }
  // handicap stall fill hint
  const hc = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2), M.paintBlue);
  hc.position.set(-9.45, y, LZ0 + 3.4); items.push(hc);
  // aisle arrows
  for (const [x, dir] of [[-5, 1], [5, -1]]) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.15, -1); shape.lineTo(0.15, -1); shape.lineTo(0.15, 0.3); shape.lineTo(0.45, 0.3); shape.lineTo(0, 1); shape.lineTo(-0.45, 0.3); shape.lineTo(-0.15, 0.3); shape.closePath();
    const a = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), M.paint);
    a.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    a.position.set(x, y, 0);
    items.push(a);
  }
  for (const it of items) { it.visible = false; finaleGroup.add(it); }
  const cars = [];
  const colors = [0xc62828, 0x1565c0, 0xeeeeee, 0x2e7d32, 0x37474f, 0xf9a825];
  const slots = [[-6.75, -1], [-1.35, -1], [4.05, -1], [-4.05, 1], [1.35, 1], [9.45, 1]];
  slots.forEach(([x, side], i) => {
    const car = buildCar(colors[i % colors.length]);
    const zStall = side < 0 ? LZ0 + 3.0 : LZ1 - 3.0;
    car.userData = { x, zStall, side, delay: 3.2 + i * 0.6 };
    car.rotation.y = side < 0 ? Math.PI : 0;
    car.visible = false;
    car.position.set(x, ASPH_DONE, 0);
    finaleGroup.add(car);
    cars.push(car);
  });
  G.finale = { t: 0, items, cars, shown: 0 };
  toast('Lot sealed! The striping crew is laying out the stalls.', 'good', 3.5);
}
function updateFinale(dt) {
  const F = G.finale;
  F.t += dt;
  const n = Math.min(F.items.length, Math.floor(F.t / 0.12));
  for (let i = F.shown; i < n; i++) F.items[i].visible = true;
  F.shown = n;
  for (const car of F.cars) {
    const u = car.userData;
    const t = F.t - u.delay;
    if (t < 0) continue;
    car.visible = true;
    // drive from aisle into stall
    const k = ease(Math.min(1, t / 1.6));
    car.position.z = lerp(0, u.zStall, k);
    car.position.x = u.x + Math.sin(k * Math.PI) * 0.4;
  }
  if (F.t > 8.5 && G.state === 'finale') showResults();
}
function showResults() {
  G.state = 'results';
  const cov = G.coverage;
  const rows = [
    ['Excavation', cov[0] ?? 0], ['Stone base', cov[1] ?? 0], ['Paving', cov[2] ?? 0], ['Compaction', G.rollQ || 0], ['Seal coat', cov[4] ?? 0],
  ];
  const quality = rows.reduce((s, r) => s + Math.min(1, r[1]), 0) / rows.length;
  const score = Math.round(quality * 100);
  const stars = score >= 92 ? 3 : score >= 80 ? 2 : 1;
  $('stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('');
  $('resultGrid').innerHTML = rows.map(([n, v]) => `<div class="res-row"><span>${n}</span><div class="rbar"><div style="width:${Math.round(Math.min(1, v) * 100)}%"></div></div><b>${Math.round(Math.min(1, v) * 100)}%</b></div>`).join('') +
    `<div class="res-row"><span><b style="font-family:inherit;text-align:left">Job time</b></span><span></span><b>${fmtTime(G.time)}</b></div>`;
  const contract = 18500;
  const qBonus = Math.round(Math.max(0, quality - 0.8) * 5 * 4000 / 50) * 50;
  const tBonus = Math.round(Math.max(0, 1 - G.time / 1500) * 3000 / 50) * 50;
  const total = contract + qBonus + tBonus;
  const money = (v) => `$${v.toLocaleString()}`;
  $('invoice').innerHTML = `<div class="line"><span>INVOICE · Corner Market lot</span><span>#${1000 + Math.floor(Math.random() * 9000)}</span></div>
    <div class="line"><span>Contract (24 × 14 m lot)</span><span>${money(contract)}</span></div>
    <div class="line"><span>Quality bonus (${score}%)</span><span>${money(qBonus)}</span></div>
    <div class="line"><span>Schedule bonus</span><span>${money(tBonus)}</span></div>
    <div class="line total"><span>TOTAL PAID</span><span>${money(total)}</span></div>`;
  const best = JSON.parse(localStorage.getItem('blacktop-best') || 'null');
  if (!best || total > best.total) localStorage.setItem('blacktop-best', JSON.stringify({ total, time: G.time, score }));
  show('results', true);
  Sound.chime([523, 659, 784, 1047, 1319]);
}

// ---------------------------------------------------------------- reset / start
function resetJob() {
  resetLot();
  for (const p of G.parked) scene.remove(p.g);
  G.parked = [];
  if (G.machine) scene.remove(G.machine.g);
  G.machine = null;
  finaleGroup.clear();
  G.finale = null;
  G.time = 0; G.coverage = []; G.rollQ = 0;
  haul.x = 2; haul.state = 'parked'; haul.load = 0; haul.count = 0;
}
function startJob() {
  resetJob();
  show('title', false); show('results', false); show('pause', false);
  beginStage(0);
}
function pause(on) {
  if (on && G.state === 'play') { G.state = 'paused'; show('pause', true); }
  else if (!on && G.state === 'paused') { G.state = 'play'; show('pause', false); }
}
function bestLine() {
  const best = JSON.parse(localStorage.getItem('blacktop-best') || 'null');
  $('bestLine').textContent = best ? `Best job: $${best.total.toLocaleString()} paid · ${best.score}% quality · ${fmtTime(best.time)}` : '';
}

$('startBtn').addEventListener('click', () => { Sound.init(); startJob(); });
$('cardGo').addEventListener('click', () => { Sound.init(); show('card', false); G.state = 'play'; snapCamera = true; });
$('menuBtn').addEventListener('click', () => pause(true));
$('resumeBtn').addEventListener('click', () => pause(false));
$('restartBtn').addEventListener('click', () => { show('pause', false); startJob(); });
$('againBtn').addEventListener('click', () => { show('results', false); startJob(); });
$('soundBtn').addEventListener('click', () => { Sound.on = !Sound.on; $('soundBtn').textContent = `SOUND: ${Sound.on ? 'ON' : 'OFF'}`; });
$('fsBtn').addEventListener('click', () => {
  const el = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
});
$('viewBtn').addEventListener('click', toggleView);
$('nextBtn').addEventListener('click', nextStage);
$('actionBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); doAction(); });

// ---------------------------------------------------------------- main loop
let last = performance.now(), hudT = 0, progT = 0, mapT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  G.frame++;
  const secs = now / 1000;
  readInput();

  if (G.state === 'play') {
    G.time += dt;
    const m = G.machine;
    const locked = m.type === 'excavator' && !!m.anim;
    driveMachine(m, dt, input.x, input.y, locked);
    const work = workMachine(m, dt, secs);
    updateHaul(dt);
    updateMarker(m);
    progT += dt;
    if (progT > 0.25) {
      if (G.stage >= 2) coolMat(progT);
      if (G.stage === 2 || G.stage === 3) lotDirty = true;
      progT = 0;
      G.progress = computeProgress();
      if (!G.reached && G.progress >= DONE_AT) {
        G.reached = true;
        Sound.chime();
        toast(G.stage === 4 ? 'Seal coat done! Tap FINISH JOB, or touch up the last spots.' : 'Stage goal reached! Tap NEXT STAGE, or keep going for 100%.', 'good', 3.5);
      }
      if (G.progress >= 0.999 && G.reached) { /* perfect */ }
    }
    hudT += dt;
    if (hudT > 0.1) { updateHUD(); hudT = 0; }
    Sound.update(Math.abs(m.v) / m.maxV, work, m.v < -0.15, secs);
  } else {
    if (G.state === 'card' || G.state === 'paused') Sound.update(0, 0, false, secs);
    else Sound.update(0, 0, false, secs);
    marker.visible = G.state === 'card' && !!G.machine;
    if (G.state === 'card' && G.machine) updateMarker(G.machine);
    if (G.state === 'card' && G.machine) updateHaul(0);
  }
  if (G.state === 'finale' || G.state === 'results') { if (G.finale) updateFinale(dt); }

  // beacons spin/pulse
  M.beacon.emissiveIntensity = 0.6 + Math.max(0, Math.sin(secs * 9)) * 2.2;

  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').classList.remove('show'); }
  if (lotDirty) rebuildLot();
  // lot gets a bit glossier as it's sealed
  lotMat.roughness = G.stage >= 4 || G.state === 'finale' || G.state === 'results' ? 0.7 : 0.95;
  particles.update(dt);
  updateCamera(dt, now);
  mapT += dt;
  if (mapT > 0.15 && (G.state === 'play' || G.state === 'card')) { drawMinimap(); mapT = 0; }
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- boot
addEventListener('resize', resize);
resize();
resetLot();
rebuildLot();
updateSupplies();
haul.g.position.set(haul.x, 0, haul.z); haul.g.rotation.y = haul.h;
G.state = 'title';
bestLine();
$('loading').classList.add('hidden');
requestAnimationFrame(frame);

// debug hook for automated testing
window.__game = { G, STAGES, cut, base, asph, passes, seal, nextStage, doAction, toggleView, input, haul };
