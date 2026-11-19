/* =========================================================
   Core idea
   1. Each letter is a skeleton (centerline), not a font outline.
   2. For every skeleton point:
      - position = fisheye magnify around the mouse (closer = pushed further out)
      - weight   = global inflation + local inflation with Gaussian falloff from the mouse
   3. Three render layers: white extrusion -> white outline -> black fill.
      As the weight grows, white outline + black fill read as a "balloon" letter.
   4. hover eases 0 -> 1; at rest the letter is a single white line.
   ========================================================= */

// ---------- Skeleton glyphs: unit coords, ~0.6 wide, 1 tall, y down ----------
// Each letter = strokes; each stroke = points (resampled densely later)
function arc(cx, cy, rx, ry, a0, a1, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}
const P = Math.PI;
const GLYPHS = {
  A: [ [[0, 1], [0.3, 0], [0.6, 1]], [[0.1, 0.66], [0.5, 0.66]] ],
  B: [
    [[0, 1], [0, 0]],
    [[0, 0], [0.28, 0], ...arc(0.28, 0.24, 0.22, 0.24, -P / 2, P / 2), [0, 0.48]],
    [[0, 0.48], [0.3, 0.48], ...arc(0.3, 0.74, 0.26, 0.26, -P / 2, P / 2), [0, 1]]
  ],
  C: [ arc(0.33, 0.5, 0.33, 0.5, -P * 0.22, -P * 1.78, 48) ],
  D: [ [[0, 0], [0, 1]], [[0, 0], [0.22, 0], ...arc(0.22, 0.5, 0.36, 0.5, -P / 2, P / 2, 32), [0, 1]] ],
  E: [ [[0.55, 0], [0, 0], [0, 1], [0.55, 1]], [[0, 0.5], [0.45, 0.5]] ],
  F: [ [[0.55, 0], [0, 0], [0, 1]], [[0, 0.48], [0.45, 0.48]] ],
  G: [ [...arc(0.33, 0.5, 0.33, 0.5, -P * 0.22, -P * 2, 48), [0.36, 0.5]] ],
  H: [ [[0, 0], [0, 1]], [[0.58, 0], [0.58, 1]], [[0, 0.5], [0.58, 0.5]] ],
  I: [ [[0, 0], [0, 1]] ],
  J: [ [[0.45, 0], [0.45, 0.72], ...arc(0.225, 0.72, 0.225, 0.28, 0, P, 20)] ],
  K: [ [[0, 0], [0, 1]], [[0.55, 0], [0, 0.6]], [[0.2, 0.38], [0.58, 1]] ],
  L: [ [[0, 0], [0, 1], [0.5, 1]] ],
  M: [ [[0, 1], [0, 0], [0.36, 0.7], [0.72, 0], [0.72, 1]] ],
  N: [ [[0, 1], [0, 0], [0.58, 1], [0.58, 0]] ],
  O: [ arc(0.32, 0.5, 0.32, 0.5, 0, P * 2, 64) ],
  P: [ [[0, 1], [0, 0]], [[0, 0], [0.3, 0], ...arc(0.3, 0.26, 0.26, 0.26, -P / 2, P / 2), [0, 0.52]] ],
  Q: [ arc(0.32, 0.5, 0.32, 0.5, 0, P * 2, 64), [[0.4, 0.7], [0.66, 1]] ],
  R: [
    [[0, 1], [0, 0]],
    [[0, 0], [0.3, 0], ...arc(0.3, 0.25, 0.25, 0.25, -P / 2, P / 2), [0, 0.5]],
    [[0.22, 0.5], [0.58, 1]]
  ],
  S: [ [...arc(0.3, 0.25, 0.26, 0.25, -P * 0.15, -P * 1.5, 24),
        ...arc(0.3, 0.75, 0.28, 0.25, -P * 0.5, P * 0.85, 24)] ],
  T: [ [[0, 0], [0.62, 0]], [[0.31, 0], [0.31, 1]] ],
  U: [ [[0, 0], [0, 0.68], ...arc(0.29, 0.68, 0.29, 0.32, P, 0, 24), [0.58, 0]] ],
  V: [ [[0, 0], [0.32, 1], [0.64, 0]] ],
  W: [ [[0, 0], [0.2, 1], [0.43, 0.3], [0.66, 1], [0.86, 0]] ],
  X: [ [[0, 0], [0.6, 1]], [[0.6, 0], [0, 1]] ],
  Y: [ [[0, 0], [0.3, 0.5], [0.6, 0]], [[0.3, 0.5], [0.3, 1]] ],
  Z: [ [[0, 0], [0.58, 0], [0, 1], [0.58, 1]] ]
};

// ---------- Params ----------
const params = {};
const ids = ['radius', 'mag', 'base', 'local', 'depth', 'ease'];
function readParams() {
  ids.forEach(id => {
    const v = +document.getElementById(id).value;
    params[id] = v;
    document.getElementById('v_' + id).textContent = v;
  });
}
ids.forEach(id => document.getElementById(id).addEventListener('input', readParams));
readParams();
document.getElementById('toggle').onclick = () => {
  const p = document.getElementById('panel');
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
};

// ---------- State ----------
let strokes = [];            // resampled skeleton (canvas coords)
let letterBox = {};          // letter center and size
let hover = 0;               // 0 = thin line, 1 = fully inflated
let fx = 0, fy = 0;          // smoothed mouse position (deformation center)
let currentLetter = 'R';

function buildLetter(ch) {
  const g = GLYPHS[ch] || GLYPHS.R;
  // Bounding box of the glyph, so every letter is optically centered
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  g.forEach(s => s.forEach(p => {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }));
  const H = Math.min(height * 0.36, width * 0.4);
  const cx = width / 2, cy = height / 2;
  const ox = cx - (minX + maxX) / 2 * H, oy = cy - (minY + maxY) / 2 * H;
  letterBox = { cx, cy, H };
  const step = 3; // sample spacing (px); smaller = smoother
  strokes = g.map(s => {
    const out = [];
    for (let i = 0; i < s.length - 1; i++) {
      const ax = ox + s[i][0] * H, ay = oy + s[i][1] * H;
      const bx = ox + s[i + 1][0] * H, by = oy + s[i + 1][1] * H;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let k = 0; k < n; k++) out.push({ x: ax + (bx - ax) * k / n, y: ay + (by - ay) * k / n });
    }
    const last = s[s.length - 1];
    out.push({ x: ox + last[0] * H, y: oy + last[1] * H });
    return out;
  });
}

function setup() {
  createCanvas(viewW(), viewH());
  pixelDensity(Math.min(2, window.devicePixelRatio));
  strokeCap(ROUND); strokeJoin(ROUND);
  buildLetter(currentLetter);
  fx = width / 2; fy = height / 2;
  const inp = document.getElementById('letter');
  inp.addEventListener('input', () => {
    const c = inp.value.toUpperCase();
    if (GLYPHS[c]) { currentLetter = c; buildLetter(c); }
  });
}

// Visible viewport size (read directly, so it also works inside preview panes/iframes)
function viewW() { return document.documentElement.clientWidth || window.innerWidth; }
function viewH() { return document.documentElement.clientHeight || window.innerHeight; }

function windowResized() {
  resizeCanvas(viewW(), viewH());
  buildLetter(currentLetter);
}

// nearest distance from mouse to skeleton -> is the mouse over the letter?
function distToLetter(mx, my) {
  let best = Infinity;
  for (const s of strokes) for (const p of s) {
    const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// deform one point: returns new position and its radius
function deform(p) {
  const R = params.radius * (letterBox.H / 300);
  const dx = p.x - fx, dy = p.y - fy;
  const d2 = dx * dx + dy * dy;
  const f = Math.exp(-d2 / (2 * R * R)) * hover;   // Gaussian falloff: 1 at the mouse
  const mag = params.mag / 100 * 1.6;
  const s = letterBox.H / 300;
  return {
    x: p.x + dx * mag * f,          // fisheye: push away from mouse -> local magnification
    y: p.y + dy * mag * f,
    r: (params.base * hover + params.local * f) * s  // weight (black fill radius)
  };
}

function draw() {
  // Keep the canvas matched to the visible area even if no resize event fired
  if (width !== viewW() || height !== viewH()) windowResized();
  background(0);

  // 1) hover detection + easing
  const onLetter = distToLetter(mouseX, mouseY) < letterBox.H * (0.2 + 0.3 * hover);
  hover += ((onLetter ? 1 : 0) - hover) * 0.08;

  // 2) deformation center eases toward the mouse (slight lag = jelly feel)
  const e = params.ease / 100;
  fx += (mouseX - fx) * e;
  fy += (mouseY - fy) * e;

  // 3) compute the deformed skeleton
  const def = strokes.map(s => s.map(deform));

  // extrusion direction: from mouse toward letter center, biased downward
  let ex = letterBox.cx - fx, ey = letterBox.cy - fy;
  const el = Math.hypot(ex, ey) || 1;
  ex = ex / el * 0.6; ey = ey / el * 0.6 + 0.8;
  const depth = params.depth * hover * (letterBox.H / 300);
  const outline = 3.6 + 1.1 * hover;   // white outline width (3.6 at rest = 7.2px line)

  // 4) render: extrusion (white) -> front outline (white) -> fill (black)
  const layers = Math.ceil(depth / 2);
  stroke(255);
  for (let k = layers; k >= 1; k--) {
    const t = k / layers;
    drawSkeleton(def, outline, ex * depth * t, ey * depth * t);
  }
  drawSkeleton(def, outline, 0, 0);
  stroke(0);
  drawSkeleton(def, 0, 0, 0);
}

// draw the skeleton as round-capped segments with per-segment weight
function drawSkeleton(def, extra, ox, oy) {
  for (const s of def) {
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i], b = s[i + 1];
      const w = (a.r + b.r) + extra * 2;   // diameter
      if (w <= 0.01) continue;
      strokeWeight(w);
      line(a.x + ox, a.y + oy, b.x + ox, b.y + oy);
    }
  }
}

// touch support
function touchMoved() { return false; }
