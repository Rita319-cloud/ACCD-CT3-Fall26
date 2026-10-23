// =====================================================
//  Moss Garden  v2  (p5.js 2.x)
//  Rule: spores wander randomly. When a spore touches moss of its own
//  species and the ground there is moist enough, it settles (DLA).
//  Look: white ground; moss marks inspired by the Saihō-ji moss fabric.
//  Usage: paste into sketch.js at editor.p5js.org and press Play.
// =====================================================


// ---------- 1. Canvas & grid ----------
const CELL = 5;            // pixel size of one cell (smaller = finer, slower)
const COLS = 120;          // cells across
const ROWS = 120;          // cells down
// canvas size = COLS × CELL by ROWS × CELL  →  currently 600 × 600
const CANVAS_BORDER = '#d6d6d6';   // light grey frame around the canvas
const W = COLS * CELL;
const H = ROWS * CELL;


// ---------- 2. Three moss species (three greens) ----------
// pref : favourite moisture (0 = driest, 1 = wettest)
// fill : strength of the soft colour wash under the marks
// mark : stroke style, taken from the fabric
const SPECIES = [
  { name: 'Deep green · flow lines', color: '#13702b', pref: 0.78, fill: 84, mark: 'line' },
  { name: 'Leaf green · dashes',     color: '#2f9b2f', pref: 0.52, fill: 76, mark: 'dash' },
  { name: 'Spring green · dots',     color: '#6cc23a', pref: 0.28, fill: 72, mark: 'dot'  },
];
const TOLERANCE = 0.14;    // how picky moss is about moisture (bigger = less picky)
const GROUND = '#ffffff';  // white ground


// ---------- 3. Moisture map source (Connect) ----------
// Default: a moisture map generated with noise.
// To drive it with a photo: upload the image to the p5 editor and put its
// file name here, e.g. 'garden.jpg'. Darker pixels = wetter (shade),
// brighter pixels = drier (sun).
const MOISTURE_IMAGE = null;


// ---------- 4. Timing ----------
const HOLD_MS = 1200;      // show the bare seeds for a moment before growth starts
const WALKER_COUNT = 1500; // spores wandering at the same time
const WALKER_LIFE = 300;   // max steps per spore before it disappears


// ---------- internal state ----------
let moisture;          // moisture per cell, 0..1
let grid;              // species index per cell, -1 = bare ground
let cellsBySpecies;    // occupied cells per species
let walkers = [];      // wandering spores
let mossLayer, moistureLayer;
let moistImg = null;
let showMoisture = false;
let paused = false;
let growStartAt = 0;
let worldSeed;
let sliders = {};
let info, pauseBtn;


// p5.js 2.x: no preload(); load assets inside an async setup()
async function setup() {
  const app = makeLayout();

  // canvas box: takes the remaining width and shrinks if space is tight
  const canvasBox = createDiv().parent(app)
    .style('flex', '0 1 ' + W + 'px')
    .style('min-width', '0')
    .style('line-height', '0');
  createCanvas(W, H).parent(canvasBox)
    .style('width', '100%')
    .style('height', 'auto')
    .style('max-width', W + 'px')
    .style('border', '1px solid ' + CANVAS_BORDER)   // light grey frame
    .style('box-sizing', 'border-box');

  panel.parent(app);   // panel goes after the canvas, so it always sits on the right
  pixelDensity(1);
  if (MOISTURE_IMAGE) {
    moistImg = await loadImage(MOISTURE_IMAGE);
    moistImg.resize(COLS, ROWS);
    moistImg.loadPixels();
  }
  makeUI();
  resetWorld(floor(random(100000)));
}


function draw() {
  if (!mossLayer) return;

  const growing = !paused && millis() >= growStartAt;

  if (growing) {
    // 1. top up the spores
    while (walkers.length < WALKER_COUNT) {
      const w = spawnWalker();
      if (!w) break;
      walkers.push(w);
    }

    // 2. move every spore a few steps (growth speed)
    const steps = sliders.speed.value();
    for (let k = 0; k < steps; k++) {
      for (let j = walkers.length - 1; j >= 0; j--) {
        if (!stepWalker(walkers[j])) {
          walkers[j] = walkers[walkers.length - 1];
          walkers.pop();
        }
      }
    }
  }

  // 3. draw: ground → (moisture) → moss
  background(GROUND);
  if (showMoisture) image(moistureLayer, 0, 0);
  image(mossLayer, 0, 0);

  if (frameCount % 10 === 0) updateInfo();
}


// =====================================================
//  World: moisture map, seeds
// =====================================================

function resetWorld(s) {
  worldSeed = s;
  randomSeed(s);
  noiseSeed(s);

  buildMoisture();

  if (mossLayer) mossLayer.remove();
  mossLayer = createGraphics(W, H);
  mossLayer.pixelDensity(1);
  mossLayer.clear();

  grid = new Int8Array(COLS * ROWS).fill(-1);
  cellsBySpecies = SPECIES.map(() => []);
  walkers = [];
  plantSeeds();

  growStartAt = millis() + HOLD_MS;   // every restart begins from bare seeds
}


// Moisture map: from noise, or from a photo
function buildMoisture() {
  moisture = new Float32Array(COLS * ROWS);

  if (moistImg) {
    for (let i = 0; i < COLS * ROWS; i++) {
      const p = i * 4;
      const b = (moistImg.pixels[p] + moistImg.pixels[p + 1] + moistImg.pixels[p + 2]) / 3;
      moisture[i] = 1 - b / 255;   // dark = wet
    }
  } else {
    noiseDetail(4, 0.5);
    let mn = 1, mx = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const v = noise(x * 0.03, y * 0.03);
        moisture[y * COLS + x] = v;
        mn = min(mn, v);
        mx = max(mx, v);
      }
    }
    for (let i = 0; i < moisture.length; i++) {
      moisture[i] = (moisture[i] - mn) / (mx - mn);   // stretch to 0..1
    }
  }

  // overlay shown by "Show moisture"
  if (moistureLayer) moistureLayer.remove();
  moistureLayer = createGraphics(W, H);
  moistureLayer.pixelDensity(1);
  moistureLayer.noStroke();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      moistureLayer.fill(40, 110, 200, moisture[y * COLS + x] * 150);
      moistureLayer.rect(x * CELL, y * CELL, CELL, CELL);
    }
  }
}


// Three small starting patches per species, where it likes the moisture
function plantSeeds() {
  SPECIES.forEach((sp, s) => {
    let placed = 0, tries = 0;
    while (placed < 3 && tries < 8000) {
      tries++;
      const x = floor(random(4, COLS - 4));
      const y = floor(random(4, ROWS - 4));
      const i = y * COLS + x;
      if (grid[i] !== -1) continue;
      if (abs(moisture[i] - sp.pref) > 0.06) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) occupy(x + dx, y + dy, s);
      }
      placed++;
    }
  });
}


// =====================================================
//  Spores (agents)
// =====================================================

// release a spore near some moss of a random species
function spawnWalker() {
  const s = floor(random(SPECIES.length));
  const list = cellsBySpecies[s];
  if (list.length === 0) return null;
  const c = list[floor(random(list.length))];
  const a = random(TWO_PI);
  const r = random(3, 7);
  return {
    x: round((c % COLS) + cos(a) * r),
    y: round(floor(c / COLS) + sin(a) * r),
    s: s,
    life: 0,
  };
}


// one step for one spore; returns false when it settled or ran out of life
function stepWalker(w) {
  if (w.x < 0 || w.y < 0 || w.x >= COLS || w.y >= ROWS) return false;

  const i = w.y * COLS + w.x;

  // (1) can it settle here?
  if (grid[i] === -1) {
    let same = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = w.x + dx, ny = w.y + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        if (grid[ny * COLS + nx] === w.s) same++;
      }
    }
    if (same > 0) {
      // enough same-species neighbours → settles reliably → rounded edges
      // too few → small chance → occasional branches
      const neighborChance = same >= sliders.round.value() ? 1 : 0.03;
      const p = suitability(moisture[i], SPECIES[w.s]) * neighborChance;
      if (random() < p) {
        occupy(w.x, w.y, w.s);
        return false;
      }
    }
  }

  // (2) random step (up/down/left/right), never into existing moss
  const d = floor(random(4));
  const nx = w.x + (d === 0 ? 1 : d === 1 ? -1 : 0);
  const ny = w.y + (d === 2 ? 1 : d === 3 ? -1 : 0);
  if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && grid[ny * COLS + nx] === -1) {
    w.x = nx;
    w.y = ny;
  }

  w.life++;
  return w.life < WALKER_LIFE;
}


// how suitable this moisture is for this species (0..1)
function suitability(m, sp) {
  const d = m - sp.pref;
  return exp(-(d * d) / (2 * TOLERANCE * TOLERANCE));
}


// =====================================================
//  Settle + draw a mark
// =====================================================

function occupy(x, y, s) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return;
  const i = y * COLS + x;
  if (grid[i] !== -1) return;
  grid[i] = s;
  cellsBySpecies[s].push(i);
  drawMark(x, y, SPECIES[s]);
}


function drawMark(x, y, sp) {
  const g = mossLayer;
  const cx = x * CELL + CELL / 2;
  const cy = y * CELL + CELL / 2;
  const c = color(sp.color);

  // soft colour wash (the translucent patches on the fabric)
  c.setAlpha(sp.fill);
  g.noStroke();
  g.fill(c);
  g.circle(cx, cy, CELL * 2.2);

  // the mark itself
  c.setAlpha(240);
  if (sp.mark === 'line') {
    // flow lines: follow an invisible "current"
    const a = noise(x * 0.04 + 300, y * 0.04 + 300) * TWO_PI * 1.5;
    const len = CELL * 0.85;
    g.stroke(c);
    g.strokeWeight(1.2);
    g.line(cx - cos(a) * len, cy - sin(a) * len, cx + cos(a) * len, cy + sin(a) * len);
  } else if (sp.mark === 'dash') {
    // dashes: short vertical bricks in rows
    const jx = random(-0.6, 0.6);
    g.stroke(c);
    g.strokeWeight(2.3);
    g.strokeCap(SQUARE);
    g.line(cx + jx, cy - CELL * 0.35, cx + jx, cy + CELL * 0.35);
    g.strokeCap(ROUND);
  } else {
    // dots: slightly irregular stipple
    g.noStroke();
    g.fill(c);
    g.circle(cx + random(-1.2, 1.2), cy + random(-1.2, 1.2), random(1.8, 3.2));
  }
}


// =====================================================
//  Controls
// =====================================================

// Layout: canvas on the left, control panel on the right.
// If the HTML page has <div id="moss-garden"></div>, everything goes inside it;
// otherwise (e.g. in the p5 editor) it is added to the page body.
let panel;

function makeLayout() {
  const app = createDiv()
    .style('display', 'flex')
    .style('flex-wrap', 'nowrap')        // never drop the panel below the canvas
    .style('align-items', 'flex-start')
    .style('gap', '28px')
    .style('font-family', 'Helvetica, Arial, sans-serif')
    .style('font-size', '13px')
    .style('color', '#1f2f22');
  const host = select('#moss-garden');
  if (host) app.parent(host);

  panel = createDiv()
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('gap', '22px')
    .style('flex', '0 0 260px')          // fixed-width panel
    .style('width', '260px');
  return app;
}


function makeUI() {
  // --- legend: the three moss species ---
  const legend = section('Moss species');
  const notes = ['wettest', 'medium', 'drier'];
  SPECIES.forEach((sp, s) => {
    const row = createDiv().parent(legend)
      .style('display', 'flex').style('align-items', 'center').style('gap', '10px');
    createDiv().parent(row)
      .style('width', '14px').style('height', '14px')
      .style('background', sp.color).style('flex', 'none');
    createSpan(sp.name + ' <span style="color:#7a877c">· ' + notes[s] + '</span>').parent(row);
  });

  // --- sliders: label | slider | value, aligned in one grid ---
  const ctrl = section('Parameters');
  const grid = createDiv().parent(ctrl)
    .style('display', 'grid')
    .style('grid-template-columns', '90px 1fr 24px')
    .style('align-items', 'center')
    .style('gap', '12px 10px');
  sliders.round = gridSlider(grid, 'Roundness', 1, 5, 3, 1);
  sliders.speed = gridSlider(grid, 'Speed', 1, 20, 3, 1);
  createDiv('Roundness: how many same-species neighbours a spore needs to settle. Low = branching, high = rounded.')
    .parent(ctrl).style('color', '#7a877c').style('font-size', '12px').style('line-height', '1.5');

  // --- buttons: stacked, with breathing room ---
  const actions = section('Actions');
  const btns = createDiv().parent(actions)
    .style('display', 'grid')
    .style('grid-template-columns', '1fr 1fr')
    .style('gap', '10px');
  pauseBtn = styledButton(btns, 'Pause', () => {
    paused = !paused;
    pauseBtn.html(paused ? 'Play' : 'Pause');
  });
  styledButton(btns, 'Restart', () => resetWorld(worldSeed));
  styledButton(btns, 'New map', () => resetWorld(floor(random(100000))));
  styledButton(btns, 'Moisture', () => (showMoisture = !showMoisture));
  styledButton(btns, 'Save image', () => saveCanvas('moss_' + frameCount, 'png'));

  // --- coverage readout ---
  const cov = section('Coverage');
  info = createDiv().parent(cov).style('line-height', '1.8').style('font-variant-numeric', 'tabular-nums');
}


function section(title) {
  const box = createDiv().parent(panel)
    .style('display', 'flex').style('flex-direction', 'column').style('gap', '10px');
  createDiv(title).parent(box)
    .style('font-size', '11px').style('letter-spacing', '0.08em')
    .style('text-transform', 'uppercase').style('color', '#7a877c');
  return box;
}


function gridSlider(grid, label, mn, mx, val, step) {
  createDiv(label).parent(grid);
  const s = createSlider(mn, mx, val, step).parent(grid)
    .style('width', '100%').style('accent-color', '#13702b');
  const v = createDiv(String(val)).parent(grid)
    .style('text-align', 'right').style('color', '#13702b').style('font-weight', 'bold');
  s.input(() => v.html(s.value()));
  return s;
}


function styledButton(parent, label, onClick) {
  const b = createButton(label).parent(parent)
    .style('padding', '8px 10px')
    .style('font', 'inherit')
    .style('border', '1px solid #13702b')
    .style('background', '#ffffff')
    .style('color', '#13702b')
    .style('border-radius', '3px')
    .style('cursor', 'pointer');
  b.mouseOver(() => b.style('background', '#eaf5e6'));
  b.mouseOut(() => b.style('background', '#ffffff'));
  b.mousePressed(onClick);
  return b;
}


function updateInfo() {
  const total = COLS * ROWS;
  info.html(SPECIES.map((sp, s) =>
    '<span style="display:inline-block;width:10px;height:10px;margin-right:8px;background:' + sp.color + '"></span>' +
    sp.name + ' — ' + ((cellsBySpecies[s].length / total) * 100).toFixed(1) + '%'
  ).join('<br>'));
}