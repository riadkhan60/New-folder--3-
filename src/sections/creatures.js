/**
 * creatures.js — #life (4,000 → 6,000 m). Lights off.
 *
 * A sticky, near-black stage: Vesper's descent log. In the dark you only see
 * what glows: the Atolla's ring, an anglerfish lure, the vampire squid's arm
 * tips, a dragonfish's red searchlight, a siphonophore's string of lights.
 * The pointer is the submersible's lamp: a cool white cone through the water,
 * marine snow streaking through it, and only inside it do the bodies appear.
 *
 * Art direction: bioluminescence photography, not illustration. Gelatinous
 * bodies are clear jelly with a fresnel rim (the edge catches the lamp, the
 * middle stays see-through); fish are matte black with a rim of light on the
 * lamp side and small, soft speculars. Long filaments (Atolla's trailing
 * tentacle, the vampire squid's two velar filaments) hang on verlet chains,
 * so they lag and swing as the animal moves.
 *
 * Rendering (one 2D canvas, DPR capped):
 *   1. beam + backscatter    — additive, from below the frame: LED white near
 *                              the lamp turning bluer with distance, soft
 *                              edges, slowly drifting shafts, a pool with a
 *                              faint halo
 *   2. bodies                — drawn into a small offscreen canvas centred on
 *                              the lamp, masked by the lamp's falloff, then
 *                              composited (cost scales with the lamp); a
 *                              cheap halation pass (shrink, threshold, add)
 *                              lets bright rims and rainbows bloom
 *   3. self-light            — the anglerfish's lure lights her own teeth;
 *                              the dragonfish's red lamp tints its jaw
 *   4. marine snow           — streaks and glints, lit only inside the beam,
 *                              plus a few out-of-focus motes near the camera
 *   5. glow                  — photophores, always visible, additive sprites
 *   6. alarm ripples         — a find sends a ring of the animal's light
 *                              through the water and the plankton answer
 *   7. leader + pips         — one full label at a time, its leader running
 *                              into the plate's hairline; found animals keep
 *                              only a small pip in their own light
 *
 * The first time the lamp rests on an animal it reacts (the Atolla spins its
 * alarm, the squid sheds glowing mucus and backs away, a wave of light runs
 * down the siphonophore), its label appears and the log counts it. When all
 * six are found the lamp dims, the six lights pulse in the order they were
 * logged and join up like a constellation, a sonar ping rolls out, and the
 * lamp flickers back on.
 *
 * Input: pointer (lagging lamp; data-cursor="lamp" on the stage), touch
 * (tap or sideways drag; while the visitor sinks, the lamp tours the six on
 * its own, one beat of the scroll each), keyboard (each animal is a real
 * <button>: focus places its label at once and brings the lamp to it), idle
 * (the lamp searches, visiting animals not yet found). Only finds the
 * visitor caused are announced to screen readers.
 *
 * Reduced motion: no sticky stage, one still frame, all labels shown.
 * Renders only while the section is on screen; pauses when the tab is hidden.
 */
import '../styles/creatures.css'

const TAU = Math.PI * 2
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const ease = (k, dt) => 1 - Math.pow(1 - k, dt * 60)
const angDiff = (a, b) => {
  let d = (a - b) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return d
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

const C = {
  cyan: [108, 248, 232],
  blue: [58, 168, 255],
  lure: [255, 176, 84],
  red: [255, 59, 47],
  ink: [234, 246, 244],
  lamp: [214, 234, 255], // Vesper's LED lamps: a cool white
}
// The order Vesper logged them on the way down (see the partial).
const LOG_ORDER = ['comb', 'squid', 'siphonophore', 'angler', 'dragon', 'atolla']

let SPR = null // sprites, shared with the body renderers

/* ------------------------------------------------------------- sprites */
function makeSprite(c, size = 64, core = 1) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')
  const h = size / 2
  const w = c.map((v) => Math.round(v + (255 - v) * 0.55))
  const grd = g.createRadialGradient(h, h, 0, h, h, h)
  grd.addColorStop(0, `rgba(255,255,255,${core})`)
  grd.addColorStop(0.06, rgba(w, 1))
  grd.addColorStop(0.15, rgba(c, 0.82))
  grd.addColorStop(0.33, rgba(c, 0.26))
  grd.addColorStop(0.6, rgba(c, 0.06))
  grd.addColorStop(1, rgba(c, 0))
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return cv
}
function makeSoft(c, size = 64) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')
  const h = size / 2
  const grd = g.createRadialGradient(h, h, 0, h, h, h)
  grd.addColorStop(0, rgba(c, 0.5))
  grd.addColorStop(0.35, rgba(c, 0.2))
  grd.addColorStop(0.7, rgba(c, 0.05))
  grd.addColorStop(1, rgba(c, 0))
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return cv
}
/* A specular highlight: the lamp reflected in wet skin or jelly. */
function makeSpec(size = 64) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')
  const h = size / 2
  const grd = g.createRadialGradient(h, h, 0, h, h, h)
  grd.addColorStop(0, 'rgba(244,250,255,1)')
  grd.addColorStop(0.22, 'rgba(226,240,255,0.6)')
  grd.addColorStop(0.55, 'rgba(210,230,255,0.14)')
  grd.addColorStop(1, 'rgba(210,230,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return cv
}
/* The lamp's cone through the water, baked once: a soft-edged volume,
   widening along its length, brightest where it meets the lit water
   (u ≈ 0.86). LED white near the lamp turns bluer with distance (water
   drinks the red first), and faint shafts fan out from the lamp where the
   water's particles catch it. Two bakes with different shafts are
   cross-faded so the light seems to move through drifting water. Drawn
   rotated and stretched from below the frame. */
const BEAM_SPOT = 0.86
function makeBeam(seed = 0) {
  const W = 320
  const H = 160
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')
  const img = g.createImageData(W, H)
  const p0 = 0.4 + seed * 2.3
  const p1 = 1.3 + seed * 4.1
  const p2 = 2.1 + seed * 1.7
  for (let j = 0; j < H; j++) {
    const v = ((j + 0.5) / H) * 2 - 1
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W
      const w = 0.035 + 0.965 * (u / BEAM_SPOT)
      const q = v / w // constant along a ray from the lamp
      const aq = Math.abs(q)
      // (the last factor keeps the texture's own edges clean past the pool,
      // where the cone is wider than the texture)
      const across = (1 - smooth(0.6, 1.06, aq)) * (0.5 + 0.5 * Math.exp(-aq * aq * 2.4)) * (1 - smooth(0.7, 0.98, Math.abs(v)))
      const along = Math.pow(smooth(0, BEAM_SPOT, u), 1.3) * (1 - smooth(BEAM_SPOT, 1, u))
      const s = 0.5 * Math.sin(q * 10 + p0) + 0.3 * Math.sin(q * 23 + p1) + 0.2 * Math.sin(q * 47 + p2)
      const shaft = 1 + 0.3 * s * smooth(0.04, 0.36, u) * (1 - smooth(0.58, BEAM_SPOT, u))
      const k = smooth(0.02, 0.98, u)
      const o = (j * W + i) * 4
      img.data[o] = Math.round(lerp(255, 150, k))
      img.data[o + 1] = Math.round(lerp(242, 216, k))
      img.data[o + 2] = Math.round(lerp(220, 255, k))
      img.data[o + 3] = Math.round(255 * clamp(across * along * shaft))
    }
  }
  g.putImageData(img, 0, 0)
  return cv
}
/* Where the cone meets the water around the animals: a flat pool with a
   soft, slightly bluer edge, inside a wide faint halo of scattered light. */
function makePool(size = 256) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')
  const h = size / 2
  const grd = g.createRadialGradient(h, h, 0, h, h, h)
  grd.addColorStop(0, 'rgba(242,248,255,0.112)')
  grd.addColorStop(0.3, 'rgba(220,238,255,0.084)')
  grd.addColorStop(0.55, 'rgba(188,226,255,0.058)')
  grd.addColorStop(0.68, 'rgba(158,212,255,0.035)')
  grd.addColorStop(0.78, 'rgba(136,204,255,0.015)')
  grd.addColorStop(0.9, 'rgba(128,198,255,0.005)')
  grd.addColorStop(1, 'rgba(128,198,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return cv
}
/* An out-of-focus mote close to the camera: a soft disc with the faint
   brighter rim of a lens's bokeh. */
function makeBokeh(size = 64) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')
  const h = size / 2
  const grd = g.createRadialGradient(h, h, 0, h, h, h)
  grd.addColorStop(0, 'rgba(190,226,255,0.16)')
  grd.addColorStop(0.6, 'rgba(196,230,255,0.22)')
  grd.addColorStop(0.83, 'rgba(226,242,255,0.5)')
  grd.addColorStop(0.9, 'rgba(206,234,255,0.16)')
  grd.addColorStop(1, 'rgba(190,226,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return cv
}
/* A ring of light: the alarm's ripple through the water. */
function makeRing(c, size = 256) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')
  const h = size / 2
  const w = c.map((v) => Math.round(v + (255 - v) * 0.5))
  const grd = g.createRadialGradient(h, h, 0, h, h, h)
  grd.addColorStop(0, rgba(c, 0))
  grd.addColorStop(0.55, rgba(c, 0))
  grd.addColorStop(0.8, rgba(c, 0.05))
  grd.addColorStop(0.9, rgba(c, 0.3))
  grd.addColorStop(0.925, rgba(w, 0.9))
  grd.addColorStop(0.95, rgba(c, 0.22))
  grd.addColorStop(1, rgba(c, 0))
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  // the comb jelly makes colour, not light: its ring is the lamp's
  // spectrum, split as its cilia split it
  if (c === C.ink && g.createConicGradient) {
    const cg = g.createConicGradient(-Math.PI / 2, h, h)
    const hues = ['#ff7a90', '#ffc75a', '#9dff86', '#7af6ea', '#5ab4ff', '#c08cff', '#ff7a90']
    hues.forEach((col, i) => cg.addColorStop(i / (hues.length - 1), col))
    g.globalCompositeOperation = 'source-atop'
    g.globalAlpha = 0.8
    g.fillStyle = cg
    g.fillRect(0, 0, size, size)
  }
  return cv
}

function dot(g, spr, x, y, r, a) {
  if (a <= 0.004) return
  g.globalAlpha = a > 1 ? 1 : a
  g.drawImage(spr, x - r, y - r, r * 2, r * 2)
}
/* Specular sprite under the current transform; multiplies the alpha. */
function spec(g, x, y, rx, ry, rot, a) {
  if (a <= 0.01) return
  const ga = g.globalAlpha
  const op = g.globalCompositeOperation
  g.save()
  g.translate(x, y)
  g.rotate(rot)
  g.globalAlpha = ga * Math.min(1, a)
  g.globalCompositeOperation = 'lighter'
  g.drawImage(SPR.spec, -rx, -ry, rx * 2, ry * 2)
  g.restore()
  g.globalAlpha = ga
  g.globalCompositeOperation = op
}

/* Tapered stroke along a flat [x0,y0,x1,y1,…] polyline, chunked so the
   translucent segments don't bead at every joint. */
function taper(g, pts, w0, w1, c, a0, a1, chunk = 5) {
  const n = pts.length / 2
  if (n < 2) return
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (let i = 0; i < n - 1; i += chunk) {
    const u = i / (n - 1)
    g.lineWidth = lerp(w0, w1, u)
    g.strokeStyle = rgba(c, lerp(a0, a1, u).toFixed(3))
    g.beginPath()
    g.moveTo(pts[2 * i], pts[2 * i + 1])
    const end = Math.min(n - 1, i + chunk)
    for (let k = i + 1; k <= end; k++) g.lineTo(pts[2 * k], pts[2 * k + 1])
    g.stroke()
  }
}

/* Fresnel rim: a body catches the lamp where the eye grazes its surface,
   so its edge glows and its middle stays clear (jelly) or dark (skin). The
   current path is stroked three times, wide and faint to thin and bright. */
function rimLight(g, style, w) {
  const ga = g.globalAlpha
  const op = g.globalCompositeOperation
  g.globalCompositeOperation = 'lighter'
  g.lineJoin = 'round'
  g.strokeStyle = style
  g.globalAlpha = ga * 0.2
  g.lineWidth = w * 3.6
  g.stroke()
  g.globalAlpha = ga
  g.lineWidth = w
  g.stroke()
  g.globalAlpha = ga
  g.globalCompositeOperation = op
}
/* A gradient across a body toward the light: bright on the lamp side. */
function dirGrad(g, lx, ly, R, c, a1, a0) {
  const grd = g.createLinearGradient(lx * R, ly * R, -lx * R, -ly * R)
  grd.addColorStop(0, rgba(c, a1))
  grd.addColorStop(0.45, rgba(c, (a0 + (a1 - a0) * 0.3).toFixed(3)))
  grd.addColorStop(1, rgba(c, a0))
  return grd
}

/* Closed smooth outline through points (midpoint quadratics). */
function smoothClosed(g, P) {
  const n = P.length
  g.beginPath()
  let mx = (P[n - 1][0] + P[0][0]) / 2
  let my = (P[n - 1][1] + P[0][1]) / 2
  g.moveTo(mx, my)
  for (let i = 0; i < n; i++) {
    const a = P[i]
    const b = P[(i + 1) % n]
    g.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
  }
  g.closePath()
}

/* A hanging filament: verlet points, anchored at one end, with a
   follow-the-leader length constraint. Positions are in the animal's local
   units; `mx, my` carries the points back by the animal's own swimming, so
   the filament stays put in the water and trails behind it. */
class Chain {
  constructor(n, seg) {
    this.n = n
    this.seg = seg
    this.p = new Float32Array(n * 2)
    this.q = new Float32Array(n * 2)
    this.ready = false
  }
  reset(x, y, dx, dy) {
    const d = Math.hypot(dx, dy) || 1
    for (let i = 0; i < this.n; i++) {
      this.p[2 * i] = this.q[2 * i] = x + (dx / d) * this.seg * i
      this.p[2 * i + 1] = this.q[2 * i + 1] = y + (dy / d) * this.seg * i
    }
    this.ready = true
  }
  step(ax, ay, mx, my, dt, t, f) {
    const { p, q, n, seg } = this
    if (!this.ready) this.reset(ax, ay, f.dx ?? 0.1, f.dy ?? 1)
    p[0] = q[0] = ax
    p[1] = q[1] = ay
    if (dt > 0) {
      const dt2 = dt * dt
      const damp = Math.pow(f.damp ?? 0.93, dt * 60)
      for (let i = 1; i < n; i++) {
        const o = 2 * i
        const x = p[o] + mx
        const y = p[o + 1] + my
        const vx = (x - q[o] - mx) * damp
        const vy = (y - q[o + 1] - my) * damp
        q[o] = x
        q[o + 1] = y
        const ph = t * f.w + i * f.k + f.ph
        p[o] = x + vx + (f.gx + f.sx * Math.sin(ph)) * dt2
        p[o + 1] = y + vy + (f.gy + f.sy * Math.cos(ph * 0.8)) * dt2
      }
    }
    for (let i = 1; i < n; i++) {
      const o = 2 * i
      const dx = p[o] - p[o - 2]
      const dy = p[o + 1] - p[o - 1]
      const d = Math.hypot(dx, dy) || 1
      p[o] = p[o - 2] + (dx / d) * seg
      p[o + 1] = p[o - 1] + (dy / d) * seg
    }
  }
}

/* ============================================================== animals */
class Animal {
  constructor(id) {
    this.id = id
    this.seed = Math.random() * 100
    this.x = this.y = 0 // current stage position (px)
    this.bx = this.by = 0 // layout position incl. scroll parallax
    this.baseY = 0
    this.s = 1 // px per local unit
    this.z = 1
    this.rot = 0
    this.radius = 80 // local units
    this.anchor = [60, -30] // leader start when the label is on the right, local units
    this.anchorL = null // … on the left (default: mirrored)
    this.ext = [60, 60] // half extents for label placement, local units
    this.side = 1
    this.fade = 1
    this.light = 0
    this.litFor = 0
    this.found = false
    this.reticle = -1
    this.lastLit = -99
    this.labelA = 0
    this.pipA = 0
    this.color = C.cyan
    this.pox = null
    this.poy = 0
  }
  layout(cfg, W, H, unit) {
    this.cfg = cfg
    this.z = cfg.z
    this.s = unit * cfg.size
    this.bx = cfg.x * W
    this.baseY = cfg.y * H
    this.side = cfg.side ?? 1
    this.fade = 0.5 + 0.5 * smooth(0.5, 1, cfg.z)
    this.pox = null
  }
  shift(dy) {
    this.by = this.baseY + dy * this.z
  }
  toScreen(lx, ly) {
    const c = Math.cos(this.rot)
    const s = Math.sin(this.rot)
    return [this.x + (lx * c - ly * s) * this.s, this.y + (lx * s + ly * c) * this.s]
  }
  begin(g) {
    g.save()
    g.translate(this.x, this.y)
    g.scale(this.s, this.s)
    g.rotate(this.rot)
  }
  near(x, y, r) {
    return Math.hypot(x - this.x, y - this.y) < r + this.radius * this.s
  }
  /** highlight offset (local units) toward the light, max `m` */
  hl(L, m) {
    const dx = (L.x - this.x) / this.s
    const dy = (L.y - this.y) / this.s
    const d = Math.hypot(dx, dy) || 1
    const k = (Math.min(1, d / (this.radius * 1.4)) * m) / d
    const c = Math.cos(-this.rot)
    const s = Math.sin(-this.rot)
    return [(dx * c - dy * s) * k, (dx * s + dy * c) * k]
  }
  /** unit vector (local) toward the light. With the lamp right on the
   *  animal, it is lit from the camera side: from below, where Vesper is. */
  ldir(L) {
    const dx = L.x - this.x
    const dy = L.y - this.y
    const d = Math.hypot(dx, dy)
    const k = Math.min(1, d / (this.radius * this.s * 1.1))
    let vx = d > 0.01 ? (dx / d) * k : 0
    let vy = (d > 0.01 ? (dy / d) * k : 0) + (1 - k) * 0.7
    const m = Math.hypot(vx, vy) || 1
    vx /= m
    vy /= m
    const c = Math.cos(-this.rot)
    const s = Math.sin(-this.rot)
    return [vx * c - vy * s, vx * s + vy * c]
  }
  /** the animal's own swimming since last frame, as a carry in local units */
  carry() {
    const ox = this.x - this.bx
    const oy = this.y - this.by
    if (this.pox === null) {
      this.pox = ox
      this.poy = oy
    }
    const dx = ox - this.pox
    const dy = oy - this.poy
    this.pox = ox
    this.poy = oy
    const c = Math.cos(-this.rot)
    const s = Math.sin(-this.rot)
    return [-(dx * c - dy * s) / this.s, -(dx * s + dy * c) / this.s]
  }
  sample(lightAt) {
    return lightAt(this.x, this.y)
  }
  center() {
    return [this.x, this.y]
  }
  /** where its own light is, for the six-of-six constellation */
  beacon() {
    return this.center()
  }
  pinAt() {
    return this.toScreen(this.anchor[0], this.anchor[1])
  }
  react() {}
  update() {}
  drawBody() {}
  drawGlow() {}
}

/* ----------------------------------------------------- Atolla wyvillei */
// The reference animal for the art direction: a clear bell with a crimson
// central disc, the coronal groove, a ring of thick pedalia, a scalloped
// margin, a crown of fine tentacles and one long trailing tentacle.
class Atolla extends Animal {
  constructor() {
    super('atolla')
    this.radius = 80
    this.anchor = [54, -12]
    this.ext = [68, 50]
    this.color = C.blue
    this.alarmT = -1
    this.next = 3.5 + Math.random() * 2
    this.n = 26
    this.tw = Array.from({ length: this.n }, () => Math.random() * TAU)
    this.tent = Array.from({ length: 22 }, () => ({
      len: 20 + Math.random() * 16,
      ph: Math.random() * TAU,
      up: Math.random() < 0.6 ? 1 : -1,
    }))
    this.trail = new Chain(38, 6.4)
    this.trailF = { gx: -24, gy: 150, sx: 120, sy: 30, w: 0.36, k: 0.12, ph: 0, dx: 0.25, dy: 1, damp: 0.9 }
  }
  react() {
    if (this.alarmT < 0 || this.alarmT > 3.2) this.alarmT = 0
    this.next = 12 + Math.random() * 6
  }
  update(t, dt) {
    this.next -= dt
    if (this.next <= 0) this.react()
    if (this.alarmT >= 0) {
      this.alarmT += dt
      if (this.alarmT > 4.8) this.alarmT = -1
    }
    const k = this.seed
    this.pulse = Math.sin(t * 0.95 + k)
    this.rot = 0.14 + 0.07 * Math.sin(t * 0.19 + k)
    this.x = this.bx + Math.sin(t * 0.11 + k) * 10 * this.s
    this.y = this.by + Math.sin(t * 0.15 + k * 2) * 12 * this.s - this.pulse * 2.2 * this.s
    const { rx, ry, rim } = this.geo()
    const th = 2.2
    const [mx, my] = this.carry()
    this.trailF.ph = k
    this.trail.step(rx * 0.97 * Math.cos(th), rim + ry * 0.97 * Math.sin(th), mx, my, dt, t, this.trailF)
  }
  geo() {
    const p = this.pulse
    return { rx: 60 * (1 + 0.05 * p), ry: 15 * (1 + 0.05 * p), top: -42 * (1 - 0.08 * p), rim: 8 }
  }
  beacon() {
    const { rim } = this.geo()
    return this.toScreen(0, rim)
  }
  tentacles(g, t, rx, ry, rim, front) {
    g.lineCap = 'round'
    g.lineWidth = 0.7
    for (let k = 0; k < 22; k++) {
      const th = (k / 22) * TAU + 0.07
      const sn = Math.sin(th)
      if (sn > 0 !== front) continue
      const T = this.tent[k]
      const c = Math.cos(th)
      const x0 = rx * 0.99 * c
      const y0 = rim + ry * 0.99 * sn
      const sw = Math.sin(t * 0.7 + T.ph) * 3
      // held out stiffly from the margin, then curling up (or down)
      const ox = c * T.len
      const oy = sn * T.len * 0.22
      const cy = T.up * T.len * (T.up > 0 ? -0.55 : 0.45)
      g.strokeStyle = front ? 'rgba(244,168,168,0.46)' : 'rgba(210,120,130,0.2)'
      g.beginPath()
      g.moveTo(x0, y0)
      g.quadraticCurveTo(x0 + ox * 0.85, y0 + oy + 2, x0 + ox + sw, y0 + oy + cy)
      g.stroke()
    }
  }
  drawBody(g, t, L) {
    const { rx, ry, top, rim } = this.geo()
    const [lx, ly] = this.ldir(L)
    const [hx, hy] = this.hl(L, 20)
    this.begin(g)
    const gy = rim - 10 // the coronal groove
    const grx = rx * 0.72
    const gry = ry * 0.72

    // the long trailing tentacle, hanging behind
    const P = this.trail.p
    taper(g, P, 2.2, 0.45, [150, 30, 46], 0.6, 0.06, 4)
    g.globalCompositeOperation = 'lighter'
    taper(g, P, 0.7, 0.2, [255, 206, 206], 0.34, 0.02, 4)
    g.globalCompositeOperation = 'source-over'

    // back of the crown, and the back of the margin seen through the bell
    this.tentacles(g, t, rx, ry, rim, false)
    g.lineWidth = 1
    g.strokeStyle = 'rgba(255,176,176,0.14)'
    g.beginPath()
    g.ellipse(0, rim, rx * 0.98, ry, 0, Math.PI, TAU)
    g.stroke()

    // the bell: clear jelly with a crimson cast, its margin scalloped into lappets
    const bell = () => {
      g.beginPath()
      g.moveTo(-rx, rim)
      g.bezierCurveTo(-rx * 1.02, rim - 28, -rx * 0.6, top, 0, top)
      g.bezierCurveTo(rx * 0.6, top, rx * 1.02, rim - 28, rx, rim)
      const N = 88
      for (let i = 1; i <= N; i++) {
        const th = (i / N) * Math.PI
        const lobe = 3.2 * Math.pow(Math.abs(Math.sin(th * 11)), 0.6)
        g.lineTo(rx * Math.cos(th), rim + (ry + lobe) * Math.sin(th))
      }
      g.closePath()
    }
    bell()
    const jf = g.createRadialGradient(0, gy - 8, 6, 0, gy - 8, rx * 1.06)
    jf.addColorStop(0, 'rgba(110,12,28,0.26)')
    jf.addColorStop(0.62, 'rgba(128,18,36,0.3)')
    jf.addColorStop(0.92, 'rgba(176,52,70,0.42)')
    jf.addColorStop(1, 'rgba(206,92,104,0.5)')
    g.fillStyle = jf
    g.fill()
    rimLight(g, dirGrad(g, lx, ly, 62, [255, 196, 200], 0.5, 0.14), 0.9)

    // the ring of pedalia between groove and margin: thick lumps of jelly
    for (let k = 0; k < 22; k++) {
      const a0 = (k / 22) * TAU + 0.07
      const a1 = ((k + 1) / 22) * TAU + 0.07
      const am = (a0 + a1) / 2
      if (Math.sin(am) < 0.04) continue
      const c0 = Math.cos(a0)
      const s0 = Math.sin(a0)
      const c1 = Math.cos(a1)
      const s1 = Math.sin(a1)
      g.beginPath()
      g.moveTo(grx * c0, gy + gry * s0)
      g.quadraticCurveTo(grx * Math.cos(am) * 1.02, gy + gry * Math.sin(am) * 1.02, grx * c1, gy + gry * s1)
      g.lineTo(rx * 0.96 * c1, rim + ry * 0.96 * s1)
      g.quadraticCurveTo(rx * 1.0 * Math.cos(am), rim + ry * 1.06 * Math.sin(am), rx * 0.96 * c0, rim + ry * 0.96 * s0)
      g.closePath()
      const facing = 0.5 + 0.5 * (Math.cos(am) * lx + Math.sin(am) * ly)
      const pg = g.createLinearGradient(grx * Math.cos(am), gy + gry * Math.sin(am), rx * Math.cos(am), rim + ry * Math.sin(am))
      pg.addColorStop(0, `rgba(190,40,58,${(0.42 + 0.24 * facing).toFixed(3)})`)
      pg.addColorStop(0.55, `rgba(140,20,40,${(0.36 + 0.12 * facing).toFixed(3)})`)
      pg.addColorStop(1, 'rgba(120,20,38,0.16)')
      g.fillStyle = pg
      g.fill()
      g.strokeStyle = 'rgba(36,0,10,0.34)'
      g.lineWidth = 0.7
      g.stroke()
      // each lump catches its own small highlight
      spec(g, lerp(grx, rx, 0.36) * Math.cos(am), lerp(gy, rim, 0.36) + lerp(gry, ry, 0.36) * Math.sin(am), 3.6, 1.6, am + Math.PI / 2, 0.16 + 0.34 * facing)
    }

    // the central disc: the stomach's deep red pigment, domed inside the groove
    g.beginPath()
    g.moveTo(-grx, gy)
    g.bezierCurveTo(-grx * 1.02, gy - 26, -grx * 0.56, top + 3, 0, top + 3)
    g.bezierCurveTo(grx * 0.56, top + 3, grx * 1.02, gy - 26, grx, gy)
    g.ellipse(0, gy, grx, gry, 0, 0, Math.PI)
    g.closePath()
    const cd = g.createRadialGradient(hx * 0.8, (top + gy) * 0.5 + hy * 0.5, 2, 0, (top + gy) * 0.5, grx * 1.15)
    cd.addColorStop(0, 'rgba(156,24,40,0.93)')
    cd.addColorStop(0.3, 'rgba(104,8,26,0.92)')
    cd.addColorStop(0.75, 'rgba(58,2,14,0.92)')
    cd.addColorStop(1, 'rgba(36,0,10,0.9)')
    g.fillStyle = cd
    g.fill()
    rimLight(g, dirGrad(g, lx, ly, 46, [255, 170, 176], 0.3, 0.05), 0.7)
    // the stomach, a darker mass deep in the disc
    const st = g.createRadialGradient(0, gy - 6, 2, 0, gy - 6, grx * 0.7)
    st.addColorStop(0, 'rgba(20,0,6,0.5)')
    st.addColorStop(1, 'rgba(20,0,6,0)')
    g.fillStyle = st
    g.beginPath()
    g.ellipse(0, gy - 6, grx * 0.7, (gy - top) * 0.55, 0, 0, TAU)
    g.fill()

    // the coronal groove: a dark crease with a lit lip below it
    g.lineCap = 'round'
    g.strokeStyle = 'rgba(26,0,8,0.62)'
    g.lineWidth = 2
    g.beginPath()
    g.ellipse(0, gy, grx, gry, 0, 0.04, Math.PI - 0.04)
    g.stroke()
    g.globalCompositeOperation = 'lighter'
    g.strokeStyle = 'rgba(255,190,190,0.2)'
    g.lineWidth = 0.7
    g.beginPath()
    g.ellipse(0, gy + 1.6, grx * 1.01, gry * 1.02, 0, 0.12, Math.PI - 0.12)
    g.stroke()
    // the lit front edge of the margin
    g.strokeStyle = 'rgba(255,206,206,0.24)'
    g.lineWidth = 0.8
    g.beginPath()
    for (let i = 0; i <= 66; i++) {
      const th = (i / 66) * Math.PI
      const lobe = 3.2 * Math.pow(Math.abs(Math.sin(th * 11)), 0.6)
      const x = rx * Math.cos(th)
      const y = rim + (ry + lobe) * Math.sin(th)
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
    g.globalCompositeOperation = 'source-over'

    // speculars: a soft window on the dome, a crisp glint at its crest
    const sx = hx * 0.9
    const sy = top * 0.62 + hy * 0.45
    spec(g, sx, sy, 13, 4.5, 0.05 * hx, 0.22)
    spec(g, sx * 0.9, sy - 1.5, 4.5, 1.5, 0.05 * hx, 0.6)

    this.tentacles(g, t, rx, ry, rim, true)
    g.restore()
  }
  drawGlow(g, t, sp) {
    const { rx, ry, rim } = this.geo()
    const at = this.alarmT
    const e = at < 0 ? 0 : smooth(0, 0.3, at) * (1 - smooth(3.3, 4.8, at))
    const phi = at < 0 ? 0 : at * 3.4 + at * at * 0.5
    this.begin(g)
    if (e > 0.01) {
      g.globalAlpha = 0.22 * e
      g.strokeStyle = 'rgb(58,168,255)'
      g.lineWidth = 5
      g.beginPath()
      g.ellipse(0, rim, rx, ry, 0, 0, TAU)
      g.stroke()
      dot(g, sp.blueSoft, 0, rim - 8, rx * 1.9, 0.5 * e)
    }
    // at rest the ring breathes with the bell's pulse
    const breath = 0.84 + 0.2 * this.pulse
    for (let k = 0; k < this.n; k++) {
      const th = (k / this.n) * TAU
      const back = Math.sin(th) < 0 ? 0.55 : 1
      const tw = (0.28 + 0.18 * Math.sin(t * 1.25 + this.tw[k])) * breath
      const d1 = angDiff(th, phi)
      const d2 = angDiff(th, phi + Math.PI)
      const wave = Math.exp(-(d1 * d1) / 0.16) + Math.exp(-(d2 * d2) / 0.16)
      const a = (tw + e * wave * 1.2) * back
      dot(g, sp.blue, rx * Math.cos(th), rim + ry * Math.sin(th), 4.6 + 6 * e * wave, a)
    }
    g.restore()
  }
}

/* ------------------------------------------ Vampyroteuthis infernalis */
class Squid extends Animal {
  constructor() {
    super('squid')
    this.radius = 104
    this.anchor = [26, -60]
    this.ext = [64, 92]
    this.color = C.cyan
    this.escT = -1
    this.esc = 0
    this.next = 30
    this.mucus = []
    // the skin is scattered with tiny photophores (local units)
    this.specks = Array.from({ length: 26 }, (_, i) => {
      const onMantle = i < 14
      const a = Math.random() * TAU
      const r = Math.sqrt(Math.random())
      return onMantle
        ? [Math.cos(a) * r * 17, -50 + Math.sin(a) * r * 34, Math.random() * TAU]
        : [Math.cos(a) * r * 26, 6 + Math.abs(Math.sin(a)) * r * 16, Math.random() * TAU]
    })
    this.arms = Array.from({ length: 8 }, () => ({ a: 0, L: 0, tx: 0, ty: 0, wx: 0, wy: 0, bx: 0, by: 0, bend: 0 }))
    this.blotch = [
      [-9, -70, 12],
      [8, -40, 14],
      [-6, -22, 10],
      [12, -76, 8],
    ]
    // the two retractile velar filaments, unique to Vampyroteuthis
    this.fil = [-1, 1].map((sx) => ({
      sx,
      c: new Chain(30, 6),
      f: { gx: sx * 26, gy: 200, sx: 70, sy: 30, w: 0.5, k: 0.2, ph: sx * 1.7, dx: sx * 0.3, dy: 1, damp: 0.92 },
    }))
  }
  react() {
    this.escT = 0
    this.next = 26 + Math.random() * 10
    // a cloud of glowing mucus from the arm tips, left in place as it backs away
    for (const arm of this.arms) {
      for (let k = 0; k < 12; k++) {
        const [sx, sy] = this.toScreen(arm.tx + (Math.random() - 0.5) * 8, arm.ty + (Math.random() - 0.5) * 8)
        const dx = arm.tx
        const dy = arm.ty - 10
        const d = Math.hypot(dx, dy) || 1
        const sp = 20 + Math.random() * 60
        this.mucus.push({
          x: (sx - this.bx) / this.s,
          y: (sy - this.by) / this.s,
          vx: (dx / d) * sp + (Math.random() - 0.5) * 34,
          vy: (dy / d) * sp + (Math.random() - 0.5) * 34,
          age: -Math.random() * 0.35,
          life: 6.5 + Math.random() * 4,
          r0: 2 + Math.random() * 3,
          c: Math.random() < 0.6 ? 0 : 1,
        })
      }
    }
    if (this.mucus.length > 220) this.mucus.splice(0, this.mucus.length - 220)
  }
  update(t, dt) {
    if (this.found) {
      this.next -= dt
      if (this.next <= 0 && this.light > 0.4) this.react()
    }
    if (this.escT >= 0) {
      this.escT += dt
      if (this.escT > 9) this.escT = -1
    }
    const et = this.escT
    this.esc = et < 0 ? 0 : smooth(0, 0.55, et) * (1 - smooth(1.4, 8.5, et))
    const k = this.seed
    this.open = (0.5 + 0.5 * Math.sin(t * 0.48 + k)) * (1 - this.esc * 0.85)
    this.fin = Math.sin(t * 1.5 + k)
    this.rot = -0.2 + 0.07 * Math.sin(t * 0.21 + k) - this.esc * 0.18
    this.x = this.bx + (Math.sin(t * 0.12 + k) * 12 + this.esc * 26) * this.s
    this.y = this.by + (Math.sin(t * 0.16 + k * 1.3) * 10 - this.esc * 40) * this.s

    const hs = 0.5 + 0.66 * this.open
    for (let i = 0; i < 8; i++) {
      const u = i / 7
      const arm = this.arms[i]
      arm.a = Math.PI / 2 + (u - 0.5) * 2 * hs
      arm.L = 86 + 7 * Math.sin(t * 0.8 + i * 1.3 + k) - this.esc * 12
      arm.bend = (0.5 - u) * 14 * (1 - this.open) + Math.sin(t * 0.9 + i * 1.1) * 3.5
      arm.bx = Math.cos(arm.a) * 13
      arm.by = 16 + Math.sin(arm.a) * 6
      const ca = Math.cos(arm.a)
      const sa = Math.sin(arm.a)
      arm.tx = ca * arm.L - sa * arm.bend
      arm.ty = 16 + sa * arm.L + ca * arm.bend
      arm.wx = ca * arm.L * 0.66 - sa * arm.bend * 0.66
      arm.wy = 16 + sa * arm.L * 0.66 + ca * arm.bend * 0.66
    }
    const [mx, my] = this.carry()
    for (const f of this.fil) f.c.step(f.sx * 11, 20, mx, my, dt, t, f.f)
    for (let i = this.mucus.length - 1; i >= 0; i--) {
      const m = this.mucus[i]
      m.age += dt
      if (m.age > m.life) {
        this.mucus.splice(i, 1)
        continue
      }
      if (m.age < 0) continue
      const d = Math.exp(-1.1 * dt)
      m.vx *= d
      m.vy = m.vy * d + 1.5 * dt
      m.x += m.vx * dt + Math.sin(t * 0.7 + i) * 0.8 * dt
      m.y += m.vy * dt
    }
  }
  beacon() {
    return this.toScreen(0, -56)
  }
  /** screen-space box of the glowing mucus, so labels can stay off it */
  cloud() {
    if (!this.mucus.length) return null
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const m of this.mucus) {
      if (m.age < 0 || m.age > m.life * 0.8) continue
      const x = this.bx + m.x * this.s
      const y = this.by + m.y * this.s
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    if (x1 < x0) return null
    const p = 26 * this.s
    return { x: x0 - p, y: y0 - p, w: x1 - x0 + p * 2, h: y1 - y0 + p * 2 }
  }
  drawBody(g, t, L) {
    const [lx, ly] = this.ldir(L)
    const [hx, hy] = this.hl(L, 22)
    this.begin(g)
    const A = this.arms
    // deep wine-red velvet that falls off to near black: the light lives
    // in the sheen and the rim, not in the skin
    const skin = (cx, cy, r) => {
      const grd = g.createRadialGradient(cx + hx, cy + hy, 2, cx, cy, r)
      grd.addColorStop(0, 'rgb(108,24,34)')
      grd.addColorStop(0.34, 'rgb(54,8,17)')
      grd.addColorStop(0.74, 'rgb(24,3,8)')
      grd.addColorStop(1, 'rgb(10,2,4)')
      return grd
    }

    // the two velar filaments, long and white, trailing behind
    g.globalCompositeOperation = 'lighter'
    for (const f of this.fil) taper(g, f.c.p, 0.9, 0.25, [255, 236, 228], 0.4, 0.03, 4)
    g.globalCompositeOperation = 'source-over'

    // fins, like ears: thin, translucent, veined
    for (const sx of [-1, 1]) {
      g.save()
      g.translate(sx * 22, -66)
      g.rotate(sx * (0.5 + 0.3 * this.fin))
      g.beginPath()
      g.moveTo(0, -6)
      g.bezierCurveTo(sx * 10, -13, sx * 30, -10, sx * 32, 0)
      g.bezierCurveTo(sx * 31, 8, sx * 12, 9, 0, 6)
      g.closePath()
      // thick at the root, thinning to a translucent edge
      const fg = g.createLinearGradient(0, 0, sx * 32, 0)
      fg.addColorStop(0, 'rgba(70,10,22,0.78)')
      fg.addColorStop(0.6, 'rgba(104,22,34,0.5)')
      fg.addColorStop(1, 'rgba(150,50,60,0.32)')
      g.fillStyle = fg
      g.fill()
      rimLight(g, 'rgba(255,170,170,0.3)', 0.6)
      g.strokeStyle = 'rgba(20,0,6,0.4)'
      g.lineWidth = 0.6
      for (let r = 0; r < 4; r++) {
        g.beginPath()
        g.moveTo(sx * 2, 0)
        g.quadraticCurveTo(sx * (8 + r * 3), -3 + r * 2, sx * (16 + r * 4.5), -7 + r * 4.6)
        g.stroke()
      }
      g.restore()
    }

    // mantle: velvety red-black skin, its sheen gathered at the silhouette
    g.beginPath()
    g.moveTo(-24, -2)
    g.bezierCurveTo(-31, -46, -15, -92, 0, -94)
    g.bezierCurveTo(15, -92, 31, -46, 24, -2)
    g.closePath()
    g.fillStyle = skin(0, -48, 66)
    g.fill()
    rimLight(g, dirGrad(g, lx, ly, 56, [255, 170, 166], 0.36, 0), 0.85)
    // velvet is never even: soft darker blotches in the skin
    for (const [bx, by, br] of this.blotch) {
      const bgr = g.createRadialGradient(bx, by, 0, bx, by, br)
      bgr.addColorStop(0, 'rgba(10,1,4,0.32)')
      bgr.addColorStop(1, 'rgba(10,1,4,0)')
      g.fillStyle = bgr
      g.fillRect(bx - br, by - br, br * 2, br * 2)
    }

    // the cloak: a web between the arms, near-black inside, thin at its edge
    const wg = g.createRadialGradient(hx * 0.5, 18 + hy * 0.5, 4, 0, 16, 84)
    wg.addColorStop(0, 'rgba(12,2,5,0.97)')
    wg.addColorStop(0.5, 'rgba(34,4,10,0.95)')
    wg.addColorStop(0.82, 'rgba(70,12,22,0.84)')
    wg.addColorStop(1, 'rgba(118,30,40,0.6)')
    g.fillStyle = wg
    g.beginPath()
    g.moveTo(22, 6)
    g.lineTo(A[0].wx, A[0].wy)
    for (let i = 0; i < 7; i++) {
      const am = (A[i].a + A[i + 1].a) / 2
      const Lm = ((A[i].L + A[i + 1].L) / 2) * (0.58 + 0.06 * this.open)
      g.quadraticCurveTo(Math.cos(am) * Lm, 16 + Math.sin(am) * Lm, A[i + 1].wx, A[i + 1].wy)
    }
    g.lineTo(-22, 6)
    g.closePath()
    g.fill()
    rimLight(g, 'rgba(255,150,150,0.26)', 0.7)

    // arms, the ribs of the cloak, with fleshy cirri; black past the web
    const pts = []
    for (let i = 0; i < 8; i++) {
      const a = A[i]
      pts.length = 0
      const nx = -Math.sin(a.a)
      const ny = Math.cos(a.a)
      for (let k = 0; k <= 12; k++) {
        const u = k / 12
        pts.push(lerp(a.bx, a.tx, u) + nx * Math.sin(u * Math.PI) * 4, lerp(a.by, a.ty, u) + ny * Math.sin(u * Math.PI) * 4)
      }
      taper(g, pts, 5.4, 2.2, [58, 10, 18], 0.9, 0.9, 12)
      taper(g, pts.slice(16), 3, 1.6, [10, 3, 5], 0.96, 0.96, 12)
      g.globalCompositeOperation = 'lighter'
      taper(g, pts.slice(0, 18), 0.6, 0.3, [255, 170, 160], 0.09, 0.03, 12)
      g.globalCompositeOperation = 'source-over'
      g.strokeStyle = 'rgba(226,186,180,0.24)'
      g.lineWidth = 0.55
      for (let k = 3; k <= 9; k++) {
        const px = pts[2 * k]
        const py = pts[2 * k + 1]
        g.beginPath()
        g.moveTo(px, py)
        g.lineTo(px - px * 0.07, py - (py - 16) * 0.07)
        g.stroke()
      }
      // the light organ at the tip, pale when unlit
      g.fillStyle = 'rgba(214,230,232,0.6)'
      g.beginPath()
      g.arc(a.tx, a.ty, 1.7, 0, TAU)
      g.fill()
    }

    // head
    g.beginPath()
    g.ellipse(0, 4, 27, 19, 0, 0, TAU)
    g.fillStyle = skin(0, 2, 32)
    g.fill()
    rimLight(g, dirGrad(g, lx, ly, 26, [255, 170, 166], 0.26, 0), 0.7)

    // eyes: proportionally the largest of any animal. Deep blue globes; the
    // cornea catches the lamp as a thin crescent, not a dot.
    const la = Math.atan2(ly, lx)
    for (const sx of [-1, 1]) {
      // set on the sides of the head, so each is seen a little edge-on
      const ex = sx * 19
      const ey = 1
      g.save()
      g.translate(ex, ey)
      g.scale(0.78, 1)
      g.fillStyle = 'rgb(8,2,4)'
      g.beginPath()
      g.arc(0, 0, 10.4, 0, TAU)
      g.fill()
      const ig = g.createRadialGradient(-sx * 1.5, 0, 0, 0, 0, 9)
      ig.addColorStop(0, 'rgb(2,4,10)')
      ig.addColorStop(0.5, 'rgb(4,10,24)')
      ig.addColorStop(0.8, 'rgb(10,30,58)')
      ig.addColorStop(0.93, 'rgb(20,52,92)')
      ig.addColorStop(1, 'rgb(8,14,26)')
      g.fillStyle = ig
      g.beginPath()
      g.arc(0, 0, 9, 0, TAU)
      g.fill()
      g.globalCompositeOperation = 'lighter'
      g.strokeStyle = 'rgba(150,200,255,0.24)'
      g.lineWidth = 0.8
      g.beginPath()
      g.arc(0, 0, 7.6, la - 0.5, la + 0.5)
      g.stroke()
      g.globalCompositeOperation = 'source-over'
      g.restore()
      spec(g, ex + Math.cos(la) * 4.4, ey + Math.sin(la) * 5.2, 2.2, 0.9, la + Math.PI / 2, 0.32)
    }

    // the two large photophores at the fin bases, under their flaps
    for (const sx of [-1, 1]) {
      g.fillStyle = 'rgba(200,214,206,0.4)'
      g.beginPath()
      g.ellipse(sx * 21, -56, 4.4, 2.8, sx * 0.4, 0, TAU)
      g.fill()
      g.strokeStyle = 'rgba(16,2,6,0.7)'
      g.lineWidth = 1.4
      g.beginPath()
      g.ellipse(sx * 21, -56.6, 4.8, 3.2, sx * 0.4, Math.PI * 1.05, Math.PI * 1.95)
      g.stroke()
    }
    g.fillStyle = 'rgba(226,214,208,0.28)'
    for (const [x, y] of this.specks) {
      g.beginPath()
      g.arc(x, y, 0.7, 0, TAU)
      g.fill()
    }
    // soft sheen of wet skin on the mantle
    spec(g, hx * 0.8, -52 + hy * 0.8, 12, 20, 0, 0.16)
    g.restore()
  }
  drawGlow(g, t, sp) {
    // mucus first: it hangs in the water where it was released
    if (this.mucus.length) {
      g.save()
      g.translate(this.bx, this.by)
      g.scale(this.s, this.s)
      for (const m of this.mucus) {
        if (m.age < 0) continue
        const u = m.age / m.life
        const a = smooth(0, 0.25, m.age) * Math.pow(1 - u, 1.3)
        const r = m.r0 + 16 * Math.pow(u, 0.5)
        dot(g, m.c ? sp.blueSoft : sp.cyanSoft, m.x, m.y, r * 2.4, a * 0.16)
        dot(g, m.c ? sp.blue : sp.cyan, m.x, m.y, 2 + m.r0 * 0.6, a * 0.7 * (0.5 + 0.5 * Math.sin(t * 2.6 + m.r0 * 9)))
      }
      g.restore()
    }
    this.begin(g)
    const k = this.seed
    for (let i = 0; i < 8; i++) {
      const a = this.arms[i]
      const p = Math.pow(0.5 + 0.5 * Math.sin(t * 1.15 - i * 0.8 + k), 3)
      dot(g, i % 2 ? sp.blue : sp.cyan, a.tx, a.ty, 7 + 5 * p + 6 * this.esc, 0.42 + 0.58 * p + this.esc)
    }
    for (const [x, y, ph] of this.specks) {
      const tw = Math.pow(0.5 + 0.5 * Math.sin(t * 0.9 + ph * 3), 6)
      dot(g, sp.cyan, x, y, 3.2, 0.06 + 0.4 * tw)
    }
    const f = 0.3 + 0.16 * Math.sin(t * 0.6 + k)
    dot(g, sp.cyanSoft, -21, -56, 22, f)
    dot(g, sp.cyanSoft, 21, -56, 22, f)
    dot(g, sp.cyan, -21, -56, 5, f * 0.9)
    dot(g, sp.cyan, 21, -56, 5, f * 0.9)
    g.restore()
  }
}

/* -------------------------------------------- Melanocetus johnsonii */
class Angler extends Animal {
  constructor() {
    super('angler')
    this.radius = 96
    this.anchor = [40, -44]
    this.anchorL = [-40, -46]
    this.ext = [92, 58]
    this.color = C.lure
    this.gapeT = -1
    // faint texture in the velvet skin (local units, inside the body)
    this.pores = Array.from({ length: 34 }, () => {
      const a = Math.random() * TAU
      const r = Math.sqrt(Math.random())
      return [-12 + Math.cos(a) * r * 44, -4 + Math.sin(a) * r * 38, 0.5 + Math.random() * 0.8]
    })
  }
  react() {
    this.gapeT = 0
  }
  update(t, dt) {
    const k = this.seed
    if (this.gapeT >= 0) {
      this.gapeT += dt
      if (this.gapeT > 3) this.gapeT = -1
    }
    const snap = this.gapeT < 0 ? 0 : smooth(0, 0.5, this.gapeT) * (1 - smooth(0.9, 2.8, this.gapeT))
    this.gape = 0.3 + 0.25 * Math.sin(t * 0.35 + k) + 0.5 * snap
    this.rot = 0.04 * Math.sin(t * 0.37 + k)
    this.x = this.bx + Math.sin(t * 0.1 + k) * 8 * this.s
    this.y = this.by + Math.sin(t * 0.55 + k) * 4 * this.s
    const sw = Math.sin(t * 0.7 + k)
    this.esca = [74 + 5 * sw, -74 + 4 * Math.sin(t * 0.9 + k)]
    this.lure = 0.78 + 0.16 * Math.sin(t * 1.2 + k) + 0.06 * Math.sin(t * 7.3 + k * 3) * Math.sin(t * 0.5)
  }
  sample(lightAt) {
    const [x, y] = this.toScreen(10, 0)
    return lightAt(x, y)
  }
  center() {
    return this.toScreen(10, -4)
  }
  beacon() {
    return this.luresAt()
  }
  drawBody(g, t, L) {
    const [lx, ly] = this.ldir(L)
    const [hx, hy] = this.hl(L, 26)
    const gp = this.gape
    this.begin(g)
    const ft = Math.sin(t * 1.4 + this.seed)

    // a fin: clear membrane over fine rays, lit at its edge
    const fin = (pathFn, rays, base) => {
      pathFn()
      g.fillStyle = 'rgba(64,52,48,0.32)'
      g.fill()
      rimLight(g, 'rgba(255,236,220,0.16)', 0.5)
      g.strokeStyle = 'rgba(176,156,144,0.34)'
      g.lineWidth = 0.55
      g.beginPath()
      for (const [x, y] of rays) {
        g.moveTo(base[0], base[1])
        g.lineTo(x, y)
      }
      g.stroke()
    }
    // caudal fin: a rounded fan
    const tailRays = []
    for (let r = -4; r <= 4; r++) tailRays.push([-100 + Math.abs(r) * 1.5, r * 6.2 + ft * 4 * (1 - Math.abs(r) / 8)])
    fin(
      () => {
        g.beginPath()
        g.moveTo(-70, -7)
        g.quadraticCurveTo(-92, -32 + ft * 3, -101, -20 + ft * 4)
        g.quadraticCurveTo(-106, ft * 4, -101, 20 + ft * 4)
        g.quadraticCurveTo(-92, 32 + ft * 3, -70, 7)
        g.closePath()
      },
      tailRays,
      [-70, 0],
    )
    // soft dorsal and anal fins, set far back
    fin(
      () => {
        g.beginPath()
        g.moveTo(-36, -50)
        g.quadraticCurveTo(-52, -64 + ft * 2, -64, -42)
        g.lineTo(-58, -30)
        g.closePath()
      },
      [
        [-44, -60],
        [-52, -60],
        [-58, -52],
        [-62, -44],
      ],
      [-46, -42],
    )
    fin(
      () => {
        g.beginPath()
        g.moveTo(-40, 40)
        g.quadraticCurveTo(-56, 50 - ft * 2, -64, 30)
        g.lineTo(-58, 22)
        g.closePath()
      },
      [
        [-46, 46],
        [-54, 44],
        [-60, 36],
      ],
      [-48, 32],
    )

    // body: a humped, globular silhouette, the lower jaw jutting past the upper
    const body = () => {
      g.beginPath()
      g.moveTo(58, -10)
      g.bezierCurveTo(52, -38, 30, -58, 2, -60)
      g.bezierCurveTo(-26, -62, -52, -42, -62, -16)
      g.quadraticCurveTo(-66, -8, -72, -7)
      g.lineTo(-72, 7)
      g.quadraticCurveTo(-64, 10, -56, 24)
      g.bezierCurveTo(-42, 48, -8, 56, 22, 50)
      g.bezierCurveTo(46, 44, 66, 30 + 8 * gp, 80, 10 + 16 * gp)
      g.lineTo(74, 7 + 14 * gp)
      g.quadraticCurveTo(46, 12 + 7 * gp, 14, 4)
      g.quadraticCurveTo(38, -2, 58, -10)
      g.closePath()
    }
    body()
    const sk = g.createRadialGradient(hx, -8 + hy, 3, 0, -4, 84)
    sk.addColorStop(0, 'rgb(64,52,48)')
    sk.addColorStop(0.3, 'rgb(30,25,24)')
    sk.addColorStop(0.7, 'rgb(12,10,10)')
    sk.addColorStop(1, 'rgb(4,4,4)')
    g.fillStyle = sk
    g.fill()
    rimLight(g, dirGrad(g, lx, ly, 70, [236, 236, 230], 0.42, 0), 0.9)
    // her own lure lights her brow and the top of her jaws: a warm pool on
    // the velvet, strongest under the esca
    const [ex0, ey0] = this.esca
    g.save()
    g.clip()
    const wl = g.createRadialGradient(ex0, ey0, 2, ex0 - 8, ey0 + 18, 112)
    wl.addColorStop(0, `rgba(255,178,92,${(0.3 * this.lure).toFixed(3)})`)
    wl.addColorStop(0.35, `rgba(255,150,70,${(0.13 * this.lure).toFixed(3)})`)
    wl.addColorStop(1, 'rgba(255,140,60,0)')
    g.globalCompositeOperation = 'lighter'
    g.fillStyle = wl
    g.fillRect(-80, -70, 170, 130)
    g.restore()

    // velvet skin: faint pores, a lateral line, a gill slit
    g.fillStyle = 'rgba(200,184,170,0.1)'
    for (const [x, y, r] of this.pores) {
      g.beginPath()
      g.arc(x, y, r, 0, TAU)
      g.fill()
    }
    g.fillStyle = 'rgba(200,176,156,0.24)'
    for (let i = 0; i < 10; i++) {
      g.beginPath()
      g.arc(14 - i * 8.2, -20 + Math.pow(i / 9, 1.6) * 18, 0.8, 0, TAU)
      g.fill()
    }
    g.strokeStyle = 'rgba(0,0,0,0.6)'
    g.lineWidth = 1.2
    g.beginPath()
    g.moveTo(-14, 6)
    g.quadraticCurveTo(-18, 16, -14, 26)
    g.stroke()

    // the mouth's dark cavity, its lips catching the lamp
    g.beginPath()
    g.moveTo(16, 5)
    g.quadraticCurveTo(40, -1, 60, -9)
    g.lineTo(64, -3)
    g.lineTo(74, 7 + 14 * gp)
    g.quadraticCurveTo(46, 12 + 7 * gp, 16, 5)
    g.closePath()
    const mg = g.createLinearGradient(16, 0, 74, 0)
    mg.addColorStop(0, 'rgb(8,2,3)')
    mg.addColorStop(1, 'rgb(40,10,12)')
    g.fillStyle = mg
    g.fill()
    g.globalCompositeOperation = 'lighter'
    g.strokeStyle = 'rgba(255,226,210,0.2)'
    g.lineWidth = 0.8
    g.beginPath()
    g.moveTo(16, 3.6)
    g.quadraticCurveTo(38, -3.4, 59, -11)
    g.moveTo(17, 6.4)
    g.quadraticCurveTo(46, 13.6 + 7 * gp, 75, 8.6 + 14 * gp)
    g.stroke()
    g.globalCompositeOperation = 'source-over'

    // fangs: long, slender, glassy, curving back toward the throat
    const fang = (x, y, len, dir, w) => {
      const tx = x - len * 0.3
      const ty = y + dir * len
      g.beginPath()
      g.moveTo(x - w, y)
      g.quadraticCurveTo(x - w * 0.4, y + dir * len * 0.62, tx, ty)
      g.quadraticCurveTo(x + w * 1.1, y + dir * len * 0.5, x + w, y)
      g.closePath()
      g.fill()
    }
    const UP = [5, 9, 6, 12, 7, 14, 9, 15, 10]
    const LO = [6, 11, 7, 14, 8, 16, 11]
    g.fillStyle = 'rgba(226,224,214,0.58)'
    for (let i = 0; i < UP.length; i++) {
      const u = 0.18 + (i / (UP.length - 1)) * 0.8
      fang(lerp(16, 60, u), lerp(5, -9, u) - Math.sin(u * Math.PI) * 2.4, UP[i], 1, 0.95)
    }
    for (let i = 0; i < LO.length; i++) {
      const u = 0.22 + (i / (LO.length - 1)) * 0.76
      fang(lerp(16, 74, u), lerp(5, 7 + 14 * gp, u) + Math.sin(u * Math.PI) * (3 + 3 * gp), LO[i], -1, 1)
    }

    // pectoral fin: a small fan of rays
    g.save()
    g.translate(-6, 14)
    g.rotate(0.3 + 0.25 * Math.sin(t * 1.9 + this.seed))
    const pr = []
    for (let r = 0; r < 6; r++) pr.push([-20 + r * 1.2, -4 + r * 2.6])
    fin(
      () => {
        g.beginPath()
        g.moveTo(0, 0)
        g.quadraticCurveTo(-16, -9, -22, 0)
        g.quadraticCurveTo(-16, 12, 0, 6)
        g.closePath()
      },
      pr,
      [0, 3],
    )
    g.restore()

    // eye: small, dark, a faint ring of reflection
    const ig = g.createRadialGradient(33, -29, 0, 33, -29, 3.6)
    ig.addColorStop(0, 'rgb(2,2,4)')
    ig.addColorStop(0.6, 'rgb(6,8,12)')
    ig.addColorStop(0.86, 'rgb(64,80,96)')
    ig.addColorStop(1, 'rgb(12,12,14)')
    g.fillStyle = ig
    g.beginPath()
    g.arc(33, -29, 3.6, 0, TAU)
    g.fill()
    spec(g, 33 + lx * 1.6, -29 + ly * 1.6, 1.4, 0.7, Math.atan2(ly, lx) + Math.PI / 2, 0.5)

    // illicium (the rod) and esca (the lure)
    const [ex, ey] = this.esca
    g.strokeStyle = 'rgb(54,44,40)'
    g.lineWidth = 2
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(26, -54)
    g.quadraticCurveTo(38, -96, ex, ey)
    g.stroke()
    g.globalCompositeOperation = 'lighter'
    g.strokeStyle = 'rgba(255,230,210,0.16)'
    g.lineWidth = 0.6
    g.stroke()
    g.globalCompositeOperation = 'source-over'
    const eg = g.createRadialGradient(ex - 1.5, ey - 2, 0.5, ex, ey, 7)
    eg.addColorStop(0, 'rgba(255,236,200,0.95)')
    eg.addColorStop(0.6, 'rgba(206,160,110,0.7)')
    eg.addColorStop(1, 'rgba(120,84,56,0.5)')
    g.fillStyle = eg
    g.beginPath()
    g.ellipse(ex, ey, 5.6, 6.6, 0.3, 0, TAU)
    g.fill()

    // the soft sheen of wet skin on the hump
    spec(g, hx * 0.9 - 4, -26 + hy * 0.9, 20, 12, -0.3, 0.12)
    g.restore()
  }
  luresAt() {
    return this.toScreen(this.esca[0], this.esca[1])
  }
  drawGlow(g, t, sp) {
    const [ex, ey] = this.esca
    const l = this.lure
    this.begin(g)
    dot(g, sp.lureSoft, ex, ey, 110, 0.32 * l)
    dot(g, sp.lure, ex, ey, 26 * (0.9 + 0.2 * l), l)
    dot(g, sp.lure, ex + 2, ey - 6, 6, 0.6 * l)
    // the lure's filaments
    g.globalAlpha = 0.35 * l
    g.strokeStyle = 'rgb(255,190,110)'
    g.lineWidth = 0.7
    for (let i = 0; i < 3; i++) {
      const a = -1.6 + i * 0.45 + Math.sin(t * 0.8 + i) * 0.12
      g.beginPath()
      g.moveTo(ex, ey - 4)
      g.quadraticCurveTo(ex + Math.cos(a) * 7, ey - 4 + Math.sin(a) * 9, ex + Math.cos(a) * 12, ey - 3 + Math.sin(a) * 13)
      g.stroke()
    }
    g.restore()
  }
}

/* ------------------------------------------------ Malacosteus niger */
class Dragon extends Animal {
  constructor() {
    super('dragon')
    this.radius = 128
    this.anchor = [100, -6]
    this.anchorL = [-84, -14]
    this.ext = [128, 30]
    this.color = C.red
    this.N = 30
    this.top = []
    this.bot = []
    this.dartT = -1
  }
  react() {
    this.dartT = 0
  }
  update(t, dt) {
    const k = this.seed
    if (this.dartT >= 0) {
      this.dartT += dt
      if (this.dartT > 6) this.dartT = -1
    }
    const dart = this.dartT < 0 ? 0 : smooth(0, 0.5, this.dartT) * (1 - smooth(1.5, 6, this.dartT))
    this.dart = dart
    this.open = 0.5 + 0.5 * Math.sin(t * 0.42 + k)
    this.rot = -0.05 + 0.04 * Math.sin(t * 0.2 + k)
    this.x = this.bx + (Math.sin(t * 0.09 + k) * 14 - dart * 34) * this.s
    this.y = this.by + Math.sin(t * 0.14 + k) * 8 * this.s
    const N = this.N
    this.top.length = this.bot.length = 0
    const sp = t * (2 + dart * 4) + k
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1)
      const x = -96 + u * 216
      const mid = 5 * Math.sin(u * 5.5 - sp) * Math.pow(u, 1.6)
      const h = 26 * (1 - 0.78 * smooth(0.14, 1, u)) * (0.45 + 0.55 * Math.sqrt(smooth(0, 0.1, u)))
      this.top.push([x, mid - h * 0.82])
      this.bot.push([x, mid + h])
    }
    this.tail = 5 * Math.sin(5.5 - sp)
    this.red = 0.75 + 0.25 * Math.sin(t * 0.8 + k)
  }
  sample(lightAt) {
    const [x, y] = this.toScreen(-30, 0)
    return lightAt(x, y)
  }
  center() {
    return this.toScreen(10, 0)
  }
  beacon() {
    return this.redAt()
  }
  drawBody(g, t, L) {
    const [lx, ly] = this.ldir(L)
    const [hx, hy] = this.hl(L, 30)
    this.begin(g)
    const tl = this.tail
    // fins: clear membranes over fine rays
    const membrane = () => {
      g.fillStyle = 'rgba(58,50,48,0.3)'
      g.fill()
      rimLight(g, 'rgba(255,236,220,0.14)', 0.5)
    }
    g.beginPath()
    g.moveTo(118, tl - 3.5)
    g.lineTo(148, tl - 18)
    g.quadraticCurveTo(137, tl, 148, tl + 18)
    g.lineTo(118, tl + 3.5)
    g.closePath()
    membrane()
    g.strokeStyle = 'rgba(176,160,150,0.3)'
    g.lineWidth = 0.5
    g.beginPath()
    for (let r = -3; r <= 3; r++) {
      if (r === 0) continue
      g.moveTo(120, tl + r * 0.8)
      g.lineTo(146 - Math.abs(r) * 0.6, tl + r * 5.6)
    }
    g.stroke()
    // dorsal and anal fins, set far back as in all dragonfishes
    const fin = (i0, i1, P, dir) => {
      g.beginPath()
      g.moveTo(P[i0][0], P[i0][1])
      g.lineTo(P[i0][0] + 10, P[i0][1] + dir * 15)
      g.lineTo(P[i1][0] + 5, P[i1][1] + dir * 7)
      g.lineTo(P[i1][0], P[i1][1])
      g.closePath()
      membrane()
      g.strokeStyle = 'rgba(176,160,150,0.28)'
      g.lineWidth = 0.5
      g.beginPath()
      for (let r = 0; r <= 4; r++) {
        const u = r / 4
        const bx = lerp(P[i0][0], P[i1][0], u)
        const by = lerp(P[i0][1], P[i1][1], u)
        g.moveTo(bx, by)
        g.lineTo(bx + lerp(10, 5, u), by + dir * lerp(15, 7, u))
      }
      g.stroke()
    }
    fin(23, 26, this.top, -1)
    fin(22, 26, this.bot, 1)
    // body: scaleless black skin with a sheen band that follows the lamp.
    // The head has no floor to its mouth: the outline runs from the snout
    // along the upper jaw to the gape corner, then back along the belly.
    const belly = this.bot.filter((p) => p[0] > -60).reverse()
    const al = 0.06 + 0.24 * this.open
    const outline = [...this.top, [122, tl], ...belly, [-58, 10], [-70, 6], [-86, 3.5], [-98, 1], [-103, -3]]
    smoothClosed(g, outline)
    const band = clamp(0.4 - ly * 0.12, 0.2, 0.6)
    const bg = g.createLinearGradient(0, -22, 0, 24)
    bg.addColorStop(0, 'rgb(6,6,7)')
    bg.addColorStop(band, 'rgb(50,46,46)')
    bg.addColorStop(Math.min(0.95, band + 0.2), 'rgb(22,20,20)')
    bg.addColorStop(1, 'rgb(5,5,6)')
    g.fillStyle = bg
    g.fill()
    rimLight(g, dirGrad(g, lx, ly, 110, [236, 240, 236], 0.4, 0.02), 0.8)
    spec(g, hx - 20, band * 46 - 22, 34, 3, 0, 0.16)
    // ventral photophores (unlit, seen as pale beads)
    g.fillStyle = 'rgba(206,200,184,0.3)'
    for (let i = 4; i < 25; i++) {
      const [x, y] = this.bot[i]
      g.beginPath()
      g.arc(x, y - 2.6, 0.95, 0, TAU)
      g.fill()
    }
    // the loose jaw: a bony frame with no floor, hinged far back
    const Hx = -62
    const Hy = 9
    const Jx = Hx - Math.cos(al) * 64
    const Jy = Hy + Math.sin(al) * 64
    g.strokeStyle = 'rgb(84,74,68)'
    g.lineWidth = 3.2
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(Hx, Hy)
    g.lineTo(Jx, Jy)
    g.stroke()
    g.globalCompositeOperation = 'lighter'
    g.strokeStyle = 'rgba(255,240,226,0.26)'
    g.lineWidth = 0.8
    g.beginPath()
    g.moveTo(Hx, Hy - 1.3)
    g.lineTo(Jx, Jy - 1.3)
    g.stroke()
    g.globalCompositeOperation = 'source-over'
    // fangs: slender needles
    g.fillStyle = 'rgba(228,224,212,0.62)'
    const needle = (x, y, dx, dy, w) => {
      g.beginPath()
      g.moveTo(x - w, y)
      g.quadraticCurveTo(x - w * 0.3 + dx * 0.4, y + dy * 0.6, x + dx, y + dy)
      g.quadraticCurveTo(x + w * 1.1, y + dy * 0.5, x + w, y)
      g.closePath()
      g.fill()
    }
    for (let i = 0; i < 5; i++) {
      const u = 0.45 + i * 0.12
      needle(lerp(Hx, Jx, u), lerp(Hy, Jy, u), -1.4, -(5 + i * 1.7), 0.9)
    }
    for (let i = 0; i < 3; i++) needle(-96 + i * 6, 2, -1.6, 7 + i * 1.4, 0.85)
    // eye: large, dark, a green-grey ring of reflection
    const ig = g.createRadialGradient(-86, -8, 0, -86, -8, 6.4)
    ig.addColorStop(0, 'rgb(2,3,4)')
    ig.addColorStop(0.6, 'rgb(8,12,12)')
    ig.addColorStop(0.86, 'rgb(34,48,44)')
    ig.addColorStop(1, 'rgb(10,12,12)')
    g.fillStyle = ig
    g.beginPath()
    g.arc(-86, -8, 6.4, 0, TAU)
    g.fill()
    const la = Math.atan2(ly, lx)
    g.globalCompositeOperation = 'lighter'
    g.strokeStyle = 'rgba(200,230,220,0.22)'
    g.lineWidth = 0.6
    g.beginPath()
    g.arc(-86, -8, 5.2, la - 0.5, la + 0.5)
    g.stroke()
    g.globalCompositeOperation = 'source-over'
    // the red suborbital photophore (glossy, dark when unlit), the small postorbital one
    const rg = g.createRadialGradient(-85, 4, 0.5, -84, 5, 6.8)
    rg.addColorStop(0, 'rgb(150,44,32)')
    rg.addColorStop(1, 'rgb(54,12,10)')
    g.fillStyle = rg
    g.beginPath()
    g.ellipse(-84, 5, 6.6, 4, -0.25, 0, TAU)
    g.fill()
    spec(g, -84 + lx * 2, 5 + ly * 1.4, 2.2, 1, -0.25, 0.4)
    g.fillStyle = 'rgb(150,176,168)'
    g.beginPath()
    g.arc(-72, -5, 2.5, 0, TAU)
    g.fill()
    // pectoral fin rays
    g.strokeStyle = 'rgba(160,140,126,0.32)'
    g.lineWidth = 0.55
    for (let r = 0; r < 5; r++) {
      g.beginPath()
      g.moveTo(-58, 14)
      g.lineTo(-40 + r * 2.6, 22 + r * 2 + Math.sin(t * 1.6 + r) * 1.5)
      g.stroke()
    }
    g.restore()
  }
  redAt() {
    return this.toScreen(-84, 5)
  }
  drawGlow(g, t, sp) {
    this.begin(g)
    const r = this.red
    // the far-red searchlight, projected ahead of it
    const ox = -86
    const oy = 5
    const a = Math.PI + 0.1 + 0.06 * Math.sin(t * 0.3 + this.seed)
    const len = 250
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const grd = g.createLinearGradient(ox, oy, ox + ux * len, oy + uy * len)
    grd.addColorStop(0, `rgba(255,40,34,${0.2 * r})`)
    grd.addColorStop(0.35, `rgba(255,40,34,${0.07 * r})`)
    grd.addColorStop(1, 'rgba(255,40,34,0)')
    g.fillStyle = grd
    g.globalAlpha = 1
    g.beginPath()
    g.moveTo(ox - uy * 3, oy + ux * 3)
    g.lineTo(ox + ux * len - uy * 70, oy + uy * len + ux * 70)
    g.lineTo(ox + ux * len + uy * 70, oy + uy * len - ux * 70)
    g.lineTo(ox + uy * 3, oy - ux * 3)
    g.closePath()
    g.fill()
    dot(g, sp.redSoft, ox, oy, 34, 0.5 * r)
    dot(g, sp.red, ox, oy, 15, 0.95 * r)
    dot(g, sp.cyanSoft, -72, -5, 10, 0.35)
    dot(g, sp.cyan, -72, -5, 5.5, 0.6 + 0.2 * Math.sin(t * 1.7 + this.seed))
    // the row of small blue photophores along the belly, a slow wave of
    // light running nose to tail
    for (let i = 4; i < 25; i += 2) {
      const [x, y] = this.bot[i]
      const w = Math.pow(0.5 + 0.5 * Math.sin(t * 1.1 - i * 0.32 + this.seed), 5)
      dot(g, sp.blue, x, y - 2.6, 3.2 + 1.6 * w, 0.18 + 0.1 * Math.sin(t * 1.3 + i) + 0.34 * w)
    }
    g.restore()
  }
}

/* ------------------------------------------ Lampocteis cruentiventer */
// A lobate comb jelly: a clear, laterally flattened body with a blood-red
// gut, two broad oral lobes, small auricles, and eight comb rows whose
// beating cilia split the lamp into running rainbows.
class Comb extends Animal {
  constructor() {
    super('comb')
    this.radius = 70
    this.anchor = [30, -38]
    this.ext = [50, 58]
    this.color = C.ink
    this.sparkT = 6 + Math.random() * 4
    this.spark = -1
    this.sparkRow = 0
  }
  update(t, dt) {
    const k = this.seed
    this.flap = Math.sin(t * 0.85 + k)
    this.flap2 = Math.sin(t * 0.85 + k + 0.9)
    this.spin = t * 0.07 + k
    this.rot = -0.14 + 0.12 * Math.sin(t * 0.11 + k)
    this.x = this.bx + Math.sin(t * 0.1 + k) * 10 * this.s
    this.y = this.by + Math.sin(t * 0.13 + k) * 14 * this.s
    this.sparkT -= dt
    if (this.sparkT <= 0) {
      this.spark = 0
      this.sparkT = 8 + Math.random() * 6
      this.sparkRow = Math.floor(Math.random() * 8)
    }
    if (this.spark >= 0) {
      this.spark += dt
      if (this.spark > 1.4) this.spark = -1
    }
  }
  /** half-width of the body at height y (local) */
  hw(y) {
    return y < -14 ? 27 * Math.sqrt(Math.max(0, 1 - ((y + 14) / 47) ** 2)) : 27 - ((y + 14) / 44) * 12
  }
  beacon() {
    return this.toScreen(0, -10)
  }
  drawBody(g, t, L) {
    const [lx, ly] = this.ldir(L)
    const [hx, hy] = this.hl(L, 18)
    this.begin(g)
    // an oral lobe: a broad, thin flap draping from the mouth end, with
    // the looping canals lobate comb jellies carry in their lobes
    const lobe = (sx, f) => {
      g.beginPath()
      g.moveTo(sx * 22, -10)
      g.bezierCurveTo(sx * (36 + 3 * f), 0, sx * (46 + 6 * f), 24 + 4 * f, sx * (42 + 6 * f), 46 + 3 * f)
      g.bezierCurveTo(sx * (38 + 4 * f), 62 + 2 * f, sx * 14, 66, sx * 4, 50)
      g.bezierCurveTo(sx * 0, 42, sx * 4, 34, sx * 10, 28)
      g.closePath()
    }
    const canal = (sx, f) => {
      g.beginPath()
      g.moveTo(sx * 20, -2)
      g.bezierCurveTo(sx * (34 + 3 * f), 8, sx * (40 + 5 * f), 28, sx * (36 + 5 * f), 46)
      g.bezierCurveTo(sx * (32 + 3 * f), 58, sx * 16, 60, sx * 10, 48)
      g.bezierCurveTo(sx * 6, 38, sx * 22, 34, sx * 24, 22)
      g.bezierCurveTo(sx * 26, 12, sx * 18, 10, sx * 16, 18)
      g.strokeStyle = 'rgba(255,196,220,0.15)'
      g.lineWidth = 0.6
      g.stroke()
    }
    // the far lobe first, dimmer
    lobe(-1, this.flap)
    const lf = g.createLinearGradient(0, 0, 0, 64)
    lf.addColorStop(0, 'rgba(150,60,110,0.1)')
    lf.addColorStop(1, 'rgba(150,60,110,0.03)')
    g.fillStyle = lf
    g.fill()
    rimLight(g, 'rgba(255,200,226,0.14)', 0.5)
    canal(-1, this.flap)

    // body: clear jelly
    const body = () => {
      g.beginPath()
      g.moveTo(0, -61)
      g.bezierCurveTo(16, -61, 27, -42, 27, -16)
      g.bezierCurveTo(27, 4, 21, 20, 14, 31)
      g.quadraticCurveTo(0, 36, -14, 31)
      g.bezierCurveTo(-21, 20, -27, 4, -27, -16)
      g.bezierCurveTo(-27, -42, -16, -61, 0, -61)
      g.closePath()
    }
    body()
    const bf = g.createRadialGradient(0, -14, 4, 0, -14, 52)
    bf.addColorStop(0, 'rgba(120,40,90,0.08)')
    bf.addColorStop(0.75, 'rgba(160,70,120,0.12)')
    bf.addColorStop(1, 'rgba(220,150,190,0.3)')
    g.fillStyle = bf
    g.fill()
    rimLight(g, dirGrad(g, lx, ly, 50, [255, 214, 232], 0.5, 0.18), 0.8)

    // the meridional canals under the comb rows (all eight, around the body)
    const ROWS = 8
    const pos = []
    for (let r = 0; r < ROWS; r++) {
      const ph = ((r + 0.5) / ROWS) * TAU + this.spin
      pos.push([Math.sin(ph), Math.cos(ph)])
    }
    g.strokeStyle = 'rgba(255,190,214,0.1)'
    g.lineWidth = 0.6
    for (const [u, c] of pos) {
      g.beginPath()
      for (let y = -54; y <= 24; y += 6) {
        const x = u * this.hw(y) * 0.94
        if (y === -54) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.globalAlpha *= c > 0 ? 1 : 0.5
      g.stroke()
      g.globalAlpha /= c > 0 ? 1 : 0.5
    }

    // the bloody belly: a deep red gut that hides what it has eaten
    g.beginPath()
    g.moveTo(0, -36)
    g.bezierCurveTo(9, -36, 11, -16, 10, 2)
    g.bezierCurveTo(9, 16, 5, 24, 0, 26)
    g.bezierCurveTo(-5, 24, -9, 16, -10, 2)
    g.bezierCurveTo(-11, -16, -9, -36, 0, -36)
    g.closePath()
    const sg = g.createRadialGradient(hx * 0.3, -10 + hy * 0.3, 1, 0, -6, 30)
    sg.addColorStop(0, 'rgba(190,24,52,0.94)')
    sg.addColorStop(0.5, 'rgba(120,6,32,0.92)')
    sg.addColorStop(1, 'rgba(60,0,18,0.86)')
    g.fillStyle = sg
    g.fill()
    rimLight(g, 'rgba(255,140,160,0.24)', 0.6)
    spec(g, hx * 0.3 - 2, -18 + hy * 0.3, 2.6, 7, 0.1, 0.36)
    // the statocyst at the aboral pole
    spec(g, 0, -57, 1.6, 1.6, 0, 0.7)

    // auricles: small ciliated flaps beside the mouth
    g.strokeStyle = 'rgba(255,214,232,0.34)'
    g.lineWidth = 0.7
    for (const sx of [-1, 1]) {
      for (const k of [0, 1]) {
        const w = Math.sin(t * 2.4 + k * 1.3 + sx) * 2
        g.beginPath()
        g.moveTo(sx * (11 + k * 3), 22 + k * 3)
        g.quadraticCurveTo(sx * (20 + k * 2), 22 + k * 5 + w, sx * (17 + k * 3), 32 + k * 4)
        g.stroke()
      }
    }

    // the near lobe, over the body
    lobe(1, this.flap2)
    g.fillStyle = lf
    g.fill()
    rimLight(g, dirGrad(g, lx, ly, 40, [255, 210, 230], 0.34, 0.08), 0.5)
    canal(1, this.flap2)

    // eight comb rows: the lamp's light diffracted into travelling rainbows
    g.globalCompositeOperation = 'lighter'
    g.lineCap = 'round'
    for (let r = 0; r < ROWS; r++) {
      const [u, c] = pos[r]
      const vis = c > 0 ? 0.45 + 0.55 * c : 0.22
      const lg = g.createLinearGradient(0, -52, 0, 26)
      for (let q = 0; q <= 5; q++) {
        const hue = (((r * 52 + q * 70 - t * 160) % 360) + 360) % 360
        lg.addColorStop(q / 5, `hsla(${hue.toFixed(0)},100%,64%,${(0.26 * vis).toFixed(3)})`)
      }
      g.strokeStyle = lg
      g.lineWidth = 2.2 * vis
      g.beginPath()
      for (let y = -52; y <= 26; y += 3) {
        const x = u * this.hw(y)
        if (y === -52) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
      // the comb plates flash as each metachronal wave passes
      g.lineWidth = 1.3
      for (let p = 0; p < 23; p++) {
        const y = -51 + p * 3.4
        const x = u * this.hw(y)
        const wave = Math.pow(0.5 + 0.5 * Math.sin(p * 0.7 - t * 5.6 + r * 0.8), 4)
        if (wave < 0.06) continue
        const hue = (((r * 52 + p * 18 - t * 160) % 360) + 360) % 360
        g.strokeStyle = `hsla(${hue.toFixed(0)},100%,${(68 + 20 * wave).toFixed(0)}%,${(wave * vis).toFixed(3)})`
        g.beginPath()
        g.moveTo(x - 2.2 * vis, y)
        g.lineTo(x + 2.2 * vis, y + 0.5)
        g.stroke()
      }
    }
    g.globalCompositeOperation = 'source-over'
    g.restore()
  }
  drawGlow(g, t, sp) {
    if (this.spark < 0) return
    const ph = ((this.sparkRow + 0.5) / 8) * TAU + this.spin
    const u = Math.sin(ph)
    const e = smooth(0, 0.15, this.spark) * (1 - smooth(0.3, 1.4, this.spark))
    this.begin(g)
    for (let p = 0; p < 17; p += 3) {
      const y = -48 + p * 4.4
      dot(g, sp.cyan, u * this.hw(y), y, 4, 0.22 * e)
    }
    g.restore()
  }
}

/* ---------------------------------------------------------- Praya dubia */
function catmull(P, seg) {
  const out = []
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)]
    const p1 = P[i]
    const p2 = P[i + 1]
    const p3 = P[Math.min(P.length - 1, i + 2)]
    for (let k = 0; k < seg; k++) {
      const t = k / seg
      const t2 = t * t
      const t3 = t2 * t
      const f = (j) =>
        0.5 *
        (2 * p1[j] +
          (-p0[j] + p2[j]) * t +
          (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 +
          (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)
      out.push([f(0), f(1)])
    }
  }
  out.push(P[P.length - 1])
  return out
}

class Siphonophore extends Animal {
  constructor() {
    super('siphonophore')
    this.radius = 40
    this.anchor = [0, -24]
    this.ext = [22, 22]
    this.color = C.blue
    this.pts = []
    this.waves = []
    this.next = 2.5
    this.anchorIdx = 0
    this.litIdx = 0
  }
  layout(cfg, W, H, unit) {
    super.layout(cfg, W, H, unit)
    const P = cfg.path.map(([fx, fy]) => [fx * W, fy * H])
    const line = catmull(P, 30)
    const cum = [0]
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]))
    const total = cum[cum.length - 1]
    const at = (d) => {
      let i = 1
      while (i < cum.length - 1 && cum[i] < d) i++
      const t = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])
      const a = line[i - 1]
      const b = line[i]
      const tx = b[0] - a[0]
      const ty = b[1] - a[1]
      const l = Math.hypot(tx, ty) || 1
      return { x: lerp(a[0], b[0], t), y: lerp(a[1], b[1], t), tx: tx / l, ty: ty / l }
    }
    const sp = 26 * this.s
    const n = Math.max(6, Math.min(46, Math.floor((total - 40 * this.s) / sp)))
    this.pts = []
    this.head = at(0)
    for (let i = 0; i < n; i++) {
      const p = at(40 * this.s + i * sp)
      this.pts.push({ bx: p.x, by: p.y, tx: p.tx, ty: p.ty, x: p.x, y: p.y })
    }
    this.bx = this.head.x
    this.baseY = this.head.y
  }
  shift(dy) {
    this.dy = dy * this.z
    this.by = this.baseY + this.dy
  }
  react() {
    const i = this.litIdx
    this.waves.push({ i0: i, t0: 0, dir: 1 }, { i0: i, t0: 0, dir: -1 })
  }
  update(t, dt) {
    const s = this.s
    const k = this.seed
    this.next -= dt
    if (this.next <= 0) {
      this.waves.push({ i0: -2, t0: 0, dir: 1 })
      this.next = 7 + Math.random() * 4
    }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      this.waves[i].t0 += dt
      if (this.waves[i].t0 > 7) this.waves.splice(i, 1)
    }
    const h = this.head
    const hw = 6 * s * Math.sin(-t * 0.7 + k)
    this.x = h.x - h.ty * hw
    this.y = h.y + this.dy + h.tx * hw
    this.rot = Math.atan2(h.ty, h.tx)
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i]
      const off = 8 * s * Math.sin(i * 0.42 - t * 0.7 + k)
      p.x = p.bx - p.ty * off
      p.y = p.by + this.dy + p.tx * off
    }
  }
  sample(lightAt) {
    let best = lightAt(this.x, this.y)
    let bi = 0
    for (let i = 0; i < this.pts.length; i += 2) {
      const l = lightAt(this.pts[i].x, this.pts[i].y)
      if (l > best) {
        best = l
        bi = i
      }
    }
    this.litIdx = bi
    return best
  }
  near(x, y, r) {
    if (Math.hypot(x - this.x, y - this.y) < r + 60 * this.s) return true
    for (let i = 0; i < this.pts.length; i += 3) {
      if (Math.hypot(x - this.pts[i].x, y - this.pts[i].y) < r + 70 * this.s) return true
    }
    return false
  }
  center() {
    const p = this.pts[this.anchorIdx]
    return p && this.anchorIdx > 0 ? [p.x, p.y] : [this.x, this.y]
  }
  beacon() {
    const p = this.pts[Math.floor(this.pts.length * 0.35)]
    return p ? [p.x, p.y] : [this.x, this.y]
  }
  pinAt() {
    const [x, y] = this.center()
    return [x, y - 12 * this.s]
  }
  drawBody(g, t, L) {
    const s = this.s
    const R = L.r + 80 * s
    const k = this.seed
    // stem: a fine glassy thread
    g.beginPath()
    g.moveTo(this.x, this.y)
    for (const p of this.pts) g.lineTo(p.x, p.y)
    g.strokeStyle = 'rgba(226,238,255,0.42)'
    g.lineWidth = Math.max(0.7, 0.9 * s)
    g.stroke()
    rimLight(g, 'rgba(200,226,255,0.1)', Math.max(0.6, 0.8 * s))
    // cormidia: bract, polyp, fishing tentacle with its side branches
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i]
      if (Math.abs(p.x - L.x) > R || Math.abs(p.y - L.y) > R + 60 * s) continue
      const ang = Math.atan2(p.ty, p.tx)
      const sw = Math.sin(t * 0.5 + i * 0.9 + k)
      g.strokeStyle = 'rgba(255,214,200,0.26)'
      g.lineWidth = Math.max(0.5, 0.6 * s)
      g.beginPath()
      g.moveTo(p.x, p.y + 4 * s)
      for (let q = 1; q <= 10; q++) {
        const u = q / 10
        g.lineTo(p.x + sw * 9 * s * u * u + Math.sin(u * 3 + t * 0.6 + i) * 2 * s, p.y + 4 * s + u * 70 * s)
      }
      g.stroke()
      // tentilla: tiny coiled side branches
      g.strokeStyle = 'rgba(255,190,170,0.3)'
      g.lineWidth = Math.max(0.4, 0.5 * s)
      g.beginPath()
      for (let q = 2; q <= 9; q++) {
        const u = q / 10
        const x = p.x + sw * 9 * s * u * u + Math.sin(u * 3 + t * 0.6 + i) * 2 * s
        const y = p.y + 4 * s + u * 70 * s
        g.moveTo(x, y)
        g.quadraticCurveTo(x + 4 * s, y + 1 * s, x + 3 * s, y + 4 * s)
      }
      g.stroke()
      // gastrozooid: a translucent peach polyp
      g.fillStyle = 'rgba(255,170,120,0.36)'
      g.beginPath()
      g.ellipse(p.x + 1 * s, p.y + 7 * s, 2.4 * s, 5.6 * s, 0.1 * sw, 0, TAU)
      g.fill()
      // bract: a clear shield, rim-lit
      g.save()
      g.translate(p.x, p.y)
      g.rotate(ang)
      g.beginPath()
      g.ellipse(0, -3 * s, 10 * s, 5.4 * s, 0, 0, TAU)
      g.fillStyle = 'rgba(170,214,255,0.06)'
      g.fill()
      rimLight(g, 'rgba(226,244,255,0.24)', Math.max(0.5, 0.6 * s))
      spec(g, -3 * s, -6 * s, 3.4 * s, 1.1 * s, 0, 0.3)
      g.restore()
    }
    // two glassy swimming bells at the head
    const h = this.head
    const pul = 1 + 0.06 * Math.sin(t * 1.8 + k)
    for (const side of [-1, 1]) {
      const cx = this.x - h.tx * 16 * s - h.ty * side * 11 * s
      const cy = this.y - h.ty * 16 * s + h.tx * side * 11 * s
      g.save()
      g.translate(cx, cy)
      g.rotate(this.rot)
      g.scale(s * pul, s / pul)
      g.beginPath()
      g.ellipse(0, 0, 21, 15, 0, 0, TAU)
      const bg = g.createRadialGradient(-4, -3, 1, 0, 0, 22)
      bg.addColorStop(0, 'rgba(200,230,255,0.05)')
      bg.addColorStop(0.75, 'rgba(170,214,255,0.08)')
      bg.addColorStop(1, 'rgba(200,232,255,0.22)')
      g.fillStyle = bg
      g.fill()
      rimLight(g, 'rgba(226,244,255,0.3)', 0.7)
      // the nectosac and its canals, seen through
      g.beginPath()
      g.ellipse(3, 0, 12, 8, 0, 0, TAU)
      g.strokeStyle = 'rgba(226,246,255,0.24)'
      g.lineWidth = 0.7
      g.stroke()
      g.beginPath()
      g.moveTo(-18, 0)
      g.quadraticCurveTo(-4, -2, 15, 0)
      g.stroke()
      spec(g, -6, -8, 7, 2.2, -0.15, 0.5)
      g.restore()
    }
  }
  drawGlow(g, t, sp) {
    const s = this.s
    const k = this.seed
    const n = this.pts.length
    for (let i = 0; i < n; i++) {
      const p = this.pts[i]
      let w = 0
      for (const wv of this.waves) {
        const c = wv.i0 + wv.dir * wv.t0 * 10
        const d = i - c
        w += Math.exp(-(d * d) / 5) * (1 - wv.t0 / 7)
      }
      const a = 0.3 + 0.16 * Math.sin(t * 1.1 + i * 0.7 + k) + w * 0.9
      dot(g, sp.blue, p.x, p.y + 3 * s, (4.4 + 4 * w) * s, a)
    }
    g.globalAlpha = 0.05
    g.strokeStyle = 'rgb(58,168,255)'
    g.lineWidth = 1.5 * s
    const h = this.head
    for (const side of [-1, 1]) {
      const cx = this.x - h.tx * 16 * s - h.ty * side * 11 * s
      const cy = this.y - h.ty * 16 * s + h.tx * side * 11 * s
      g.beginPath()
      g.ellipse(cx, cy, 21 * s, 15 * s, this.rot, 0, TAU)
      g.stroke()
    }
  }
}

/* =============================================================== layout */
// Positions are fractions of the stage at the middle of the pinned range.
// `travel` (stage heights) is how far the scene rises over the pinned
// range — scaled per animal by z, so nearer animals pass faster.
const LAYOUTS = {
  desktop: {
    travel: 0.5,
    unit: (W, H) => clamp(Math.min(W / 1440, H / 900), 0.62, 1.45),
    animals: {
      atolla: { x: 0.79, y: 0.3, size: 1.0, z: 0.85, side: -1 },
      siphonophore: {
        x: 0,
        y: 0,
        size: 0.85,
        z: 0.62,
        side: 1,
        path: [
          [0.585, 0.15],
          [0.645, 0.27],
          [0.615, 0.42],
          [0.655, 0.56],
          [0.77, 0.64],
          [0.875, 0.7],
        ],
      },
      angler: { x: 0.27, y: 0.52, size: 1.15, z: 0.96, side: 1 },
      squid: { x: 0.47, y: 0.47, size: 1.18, z: 1.0, side: 1 },
      dragon: { x: 0.69, y: 0.77, size: 1.08, z: 0.9, side: -1 },
      comb: { x: 0.43, y: 0.86, size: 0.9, z: 0.8, side: 1 },
    },
  },
  mobile: {
    travel: 1.55,
    unit: (W) => clamp(W / 390, 0.8, 1.6) * 0.6,
    animals: {
      atolla: { x: 0.64, y: -0.16, size: 1.0, z: 0.92, side: -1 },
      siphonophore: {
        x: 0,
        y: 0,
        size: 0.9,
        z: 0.7,
        side: 1,
        path: [
          [0.9, -0.42],
          [0.74, -0.1],
          [0.88, 0.2],
          [0.7, 0.56],
          [0.86, 0.9],
          [0.72, 1.3],
        ],
      },
      angler: { x: 0.36, y: 0.14, size: 1.1, z: 1.0, side: 1 },
      squid: { x: 0.52, y: 0.47, size: 1.15, z: 1.0, side: 1 },
      dragon: { x: 0.56, y: 0.8, size: 1.0, z: 0.95, side: -1 },
      comb: { x: 0.36, y: 1.12, size: 1.0, z: 0.92, side: 1 },
    },
  },
}

/* ================================================================= init */
export function init(ctx) {
  const section = document.getElementById('life')
  if (!section) return
  const stage = section.querySelector('.creatures__stage')
  const canvas = section.querySelector('.creatures__canvas')
  const g = canvas?.getContext('2d')
  if (!stage || !g) return

  const { gsap } = ctx
  const reduced = ctx.reducedMotion
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches && !ctx.isTouch
  section.classList.add('is-live', reduced ? 'is-static' : 'is-float')

  // The partial's hint is for the still list (no JS, reduced motion). A
  // mouse moves the lamp; on touch it finds them on its own as the visitor
  // sinks (the tour), and a tap aims it.
  const hint = reduced ? null : fine ? 'Move the lamp to see who made them.' : 'The lamp finds them as you sink.'
  if (hint) section.querySelectorAll('[data-hint]').forEach((el) => (el.textContent = hint))

  // Sprites and the beam are baked the first time the section comes near
  // the screen, never during the intro.
  let sp = null
  let beamTex = null
  let beamTex2 = null
  function assets() {
    if (sp) return
    sp = {
      cyan: makeSprite(C.cyan),
      blue: makeSprite(C.blue),
      lure: makeSprite(C.lure),
      red: makeSprite(C.red, 64, 0.7),
      ink: makeSprite(C.ink, 64, 0.8),
      lamp: makeSprite(C.lamp, 32),
      cyanSoft: makeSoft(C.cyan),
      blueSoft: makeSoft(C.blue),
      lureSoft: makeSoft(C.lure, 128),
      redSoft: makeSoft(C.red),
      inkSoft: makeSoft(C.ink),
      lampSoft: makeSoft([255, 240, 222], 128),
      spec: makeSpec(),
      pool: makePool(),
      bokeh: makeBokeh(),
      rings: new Map(),
    }
    SPR = sp
    beamTex = makeBeam(0)
    beamTex2 = makeBeam(1)
  }
  const ringOf = (c) => {
    let r = sp.rings.get(c)
    if (!r) sp.rings.set(c, (r = makeRing(c)))
    return r
  }

  const animals = [new Siphonophore(), new Atolla(), new Comb(), new Angler(), new Dragon(), new Squid()]
  const byId = Object.fromEntries(animals.map((a) => [a.id, a]))
  const labels = new Map()
  section.querySelectorAll('.creatures__specimen').forEach((li) => {
    const a = byId[li.dataset.animal]
    if (!a) return
    labels.set(a, {
      el: li,
      btn: li.querySelector('button'),
      about: li.querySelector('.creatures__about'),
      ruleY: 11,
      side: '',
      name: li.querySelector('.creatures__common')?.textContent.trim() || a.id,
      w: 200,
      h: 80,
      x: -1e4,
      y: -1e4,
      on: false,
    })
  })
  const pips = new Map([...section.querySelectorAll('[data-pip]')].map((el) => [el.dataset.pip, el]))
  const foundEl = section.querySelector('[data-found]')
  const noteEl = section.querySelector('[data-note]')
  const countEl = section.querySelector('.creatures__count')
  const announceEl = section.querySelector('[data-announce]')
  const logEl = section.querySelector('.creatures__log')
  const litEls = [...section.querySelectorAll('.creatures__lit')]
  const intro = section.querySelector('.creatures__intro')
  const listEl = section.querySelector('.creatures__specimens')
  // the scroll position the page is drawn at (Lenis's, when it runs): reading
  // it never forces a layout, unlike getBoundingClientRect every frame
  const scrollPos = () => (ctx.lenis ? ctx.lenis.scroll : window.scrollY)

  /* ------------------------------------------------------------ state */
  let W = 0
  let H = 0
  let dpr = 1
  let mobile = false
  let L = LAYOUTS.desktop
  let unit = 1
  let t = 8.0
  let shift = 0
  let lastShift = 0
  let lastSY = scrollPos()
  let dScroll = 0 // page scroll since last frame (px): the descent speed
  let running = false
  let visible = false
  let active = false
  let foundCount = 0
  let introY = 0
  let rightInset = 24
  let topInset = 90
  let bottomInset = 24
  let leftInset = 20
  let obstacles = []
  let glowObs = []
  let logRect = null
  let introRect = null
  // cached geometry (document offsets), re-measured when layout can change
  let secTop = 0
  let secH = 1
  let stageLeft = 0
  let vh = window.innerHeight
  let near = false // within ~1.5 screens: the canvas is allocated
  let introA = '' // last written --intro-a
  let logA = '' // last written --log-a
  // touch: the lamp follows the descent from animal to animal (the tour)
  let tourOrder = []
  let tapped = false
  let lastScrollT = -1e9 // the last frame the page moved
  let lastActT = -1e9 // the last frame anything asked for full frame rate
  let glideA = null // the animal a keyboard glide is bringing into view
  let focusRaf = 0

  // pow: the lamp's own state (off, flickering on, on); on: what it gives
  // after the six-of-six dimming
  const lamp = { x: 0, y: 0, r: 220, on: 0, pow: 0, onT: -1, want: false, mode: 'idle' }
  const pointer = { cx: 0, cy: 0, t: -1e9, inside: false }
  const touch = { x: 0, y: 0, t: -1e9 }
  const idle = { target: null, last: null, hold: 0, px: 0, py: 0 }
  const finale = { t: -1, relit: false, pinged: false, pingT: 0, px: 0, py: 0 }
  let focusA = null
  let focusSince = 0

  // the lamp's pool: flat in the middle, a defined edge
  const fall = (d) => Math.pow(1 - smooth(0.4, 1, d), 1.25)
  const lightAt = (x, y) => lamp.on * fall(Math.hypot(x - lamp.x, y - lamp.y) / lamp.r)

  // offscreen buffers: lamp-sized body layer, small self-light layer
  const bodyC = document.createElement('canvas')
  const bg = bodyC.getContext('2d')
  const selfC = document.createElement('canvas')
  const sg = selfC.getContext('2d')
  // halation: the lit bodies, shrunk twice and laid back over themselves
  // additively, so rims, speculars and rainbows bloom softly in the water
  const haloA = document.createElement('canvas')
  const ha = haloA.getContext('2d')
  const haloB = document.createElement('canvas')
  const hb = haloB.getContext('2d')
  let maskGrad = null
  let maskSide = 0

  // marine snow, lit only inside the beam
  const SN = 190
  const snow = new Float32Array(SN * 4)
  // a few motes close to the camera, out of focus: only the beam finds them
  const BK = 14
  const bokeh = new Float32Array(BK * 4)
  // plankton flashes, ambient living light
  const flashes = Array.from({ length: 14 }, () => ({ x: 0, y: 0, age: 1, life: 1, r: 3, c: 0 }))
  let flashNext = 0.5
  // a find: a ripple of the animal's light, and the plankton around it answering
  const ripples = []

  function seedSnow() {
    for (let i = 0; i < SN; i++) {
      snow[i * 4] = Math.random() * W
      snow[i * 4 + 1] = Math.random() * H
      snow[i * 4 + 2] = Math.pow(Math.random(), 1.6)
      snow[i * 4 + 3] = Math.random() * TAU
    }
    for (let i = 0; i < BK; i++) {
      bokeh[i * 4] = Math.random() * W
      bokeh[i * 4 + 1] = Math.random() * H
      bokeh[i * 4 + 2] = Math.random()
      bokeh[i * 4 + 3] = Math.random() * TAU
    }
  }

  /* ----------------------------------------------------------- layout */
  // Document geometry, cached: per frame the scene is pure arithmetic on
  // the scroll position, with no layout reads.
  function measureGeo() {
    const r = section.getBoundingClientRect()
    secTop = r.top + window.scrollY
    secH = Math.max(1, r.height)
    stageLeft = stage.getBoundingClientRect().left
    vh = window.innerHeight
  }
  // where the stage's top edge is on screen: sticky in the floating scene
  function stageTop(sy = scrollPos()) {
    const top = secTop - sy
    return reduced ? top : Math.min(Math.max(top, 0), top + secH - H)
  }
  // The full-viewport canvas (and its offscreen buffers) exist only while
  // the section is near the screen, so they cost nothing during the intro
  // or anywhere else on the page.
  function alloc() {
    const w = near ? Math.round(W * dpr) : 0
    const h = near ? Math.round(H * dpr) : 0
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    if (!near) {
      bodyC.width = bodyC.height = 0
      selfC.width = selfC.height = 0
      haloA.width = haloA.height = 0
      haloB.width = haloB.height = 0
      maskGrad = null
    }
  }
  // The tour: the order the lamp visits the animals as the visitor sinks, by
  // when each one rises through the middle of the screen. Each gets an
  // equal beat of the pinned scroll.
  const TOUR_A = 0.07
  const TOUR_B = 0.9
  const aim = (a) => (a.id === 'siphonophore' ? a.beacon() : a.center())
  function planTour() {
    const yT = H * (mobile ? 0.42 : 0.45)
    tourOrder = animals
      .map((a) => {
        const p0 = a.id === 'siphonophore' ? a.pts[Math.floor(a.pts.length * 0.35)] : null
        const by = p0 ? p0.by : a.baseY
        return { a, p: 0.5 - (yT - by) / (L.travel * H * a.z) }
      })
      .sort((u, v) => u.p - v.p)
      .map((o) => o.a)
  }
  function inView(a) {
    const [x, y] = aim(a)
    const yMax = logRect && mobile ? logRect.y - 10 : H * 0.86
    return x > W * 0.04 && x < W - rightInset && y > H * 0.12 && y < yMax
  }
  function tourTarget() {
    const n = tourOrder.length
    if (!n) return null
    const i = clamp(Math.round(((progress - TOUR_A) / (TOUR_B - TOUR_A)) * (n - 1)), 0, n - 1)
    // catch up first: an earlier animal the lamp missed, still in view
    for (let j = 0; j < i; j++) {
      const a = tourOrder[j]
      if (!a.found && inView(a)) return a
    }
    if (inView(tourOrder[i])) return tourOrder[i]
    return null
  }

  function measure() {
    measureGeo()
    const r = stage.getBoundingClientRect()
    // the canvas is the scene: the whole stage, or a still frame (static)
    W = Math.max(1, Math.round(canvas.clientWidth))
    H = Math.max(1, Math.round(canvas.clientHeight))
    mobile = W < 768
    L = mobile ? LAYOUTS.mobile : LAYOUTS.desktop
    dpr = Math.min(ctx.dpr || 1, 1.5)
    alloc()
    unit = L.unit(W, H)
    for (const a of animals) {
      const cfg = { ...L.animals[a.id] }
      if (reduced && mobile) {
        // a tall, unpinned stage: spread the column out instead of travelling
        cfg.y = (cfg.y + 0.3) / 1.65
        if (cfg.path) cfg.path = cfg.path.map(([x, y]) => [x, (y + 0.3) / 1.65])
      }
      a.layout(cfg, W, H, unit)
    }
    lamp.r = mobile ? clamp(W * 0.42, 130, 220) : clamp(Math.min(W, H) * 0.27, 170, 300)
    if (reduced) lamp.r *= 1.3
    if (!lamp.x || reduced) {
      lamp.x = W * 0.5
      lamp.y = H * 0.5
    }
    // insets keep labels clear of the nav, the depth ruler and the HUD
    const cs = getComputedStyle(document.documentElement)
    const instrument = parseFloat(cs.getPropertyValue('--instrument')) || 0
    const rail = Math.min(88, Math.max(20, W * 0.05))
    leftInset = rail
    rightInset = rail + instrument + 8
    topInset = mobile ? 72 : 92
    bottomInset = mobile ? 20 : 24
    for (const lab of labels.values()) {
      lab.w = lab.el.offsetWidth
      lab.h = lab.el.offsetHeight
      lab.x = lab.y = -1e4
      // the plate's hairline rule, where the leader runs in
      lab.ruleY = lab.about ? lab.about.offsetTop + 0.5 : 11
    }
    for (const el of litEls) {
      const b = el.getBoundingClientRect()
      el._ox = b.left - r.left
      el._oy = b.top - r.top - introY
    }
    // things labels must not cover: the intro, the log, the depth HUD
    obstacles = []
    const pad = 14
    const tb = section.querySelector('.creatures__title')?.getBoundingClientRect()
    const lb = section.querySelector('.creatures__lede')?.getBoundingClientRect()
    if (tb && lb) {
      const x0 = Math.min(tb.left, lb.left) - r.left
      const y0 = Math.min(tb.top, lb.top) - r.top - introY
      const x1 = Math.max(tb.left + Math.min(tb.width, 520), lb.right) - r.left
      const y1 = Math.max(tb.bottom, lb.bottom) - r.top - introY
      introRect = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2, intro: true }
      obstacles.push(introRect)
    }
    const lg = logEl?.getBoundingClientRect()
    logRect = lg ? { x: lg.left - r.left - pad, y: lg.top - r.top - pad, w: lg.width + pad * 2, h: lg.height + pad * 2 } : null
    if (logRect) obstacles.push(logRect)
    const hud = document.querySelector('.hud__readout')?.getBoundingClientRect()
    if (hud && hud.width) obstacles.push({ x: hud.left - pad, y: hud.top - pad, w: hud.width + pad * 2, h: hud.height + pad * 2 })
    seedSnow()
    maskGrad = null
    planTour()
  }

  /* ----------------------------------------------------------- render */
  function ensureBody(R) {
    const side = Math.ceil(2 * R * dpr)
    if (bodyC.width !== side) {
      bodyC.width = bodyC.height = side
      maskGrad = null
    }
    if (!maskGrad || maskSide !== side) {
      maskSide = side
      const h = side / 2
      maskGrad = bg.createRadialGradient(h, h, 0, h, h, h)
      for (let i = 0; i <= 12; i++) {
        const d = i / 12
        maskGrad.addColorStop(d, `rgba(0,0,0,${fall(d).toFixed(3)})`)
      }
    }
    return side
  }

  function beamOrigin() {
    return [W * 0.5 + (lamp.x - W * 0.5) * 0.2, H * 1.2]
  }
  function drawBeam() {
    const on = lamp.on
    const [ox, oy] = beamOrigin()
    const dx = lamp.x - ox
    const dy = lamp.y - oy
    const d = Math.hypot(dx, dy) || 1
    g.globalCompositeOperation = 'lighter'
    // the lamp itself, just below the frame: a warm glare where it enters
    const ex = ox + (dx * (oy - H)) / Math.max(1, oy - lamp.y)
    dot(g, sp.lampSoft, clamp(ex, 0, W), H + lamp.r * 0.15, lamp.r * 1.5, on * 0.12)
    // the cone through the water, seen from the side; its shafts drift
    g.save()
    g.translate(ox, oy)
    g.rotate(Math.atan2(dy, dx))
    const half = lamp.r * 1.08
    const len = d / BEAM_SPOT
    const mix = 0.5 + 0.5 * Math.sin(t * 0.21)
    g.globalAlpha = on * 0.135 * (1 - mix)
    g.drawImage(beamTex, 0, -half, len, half * 2)
    g.globalAlpha = on * 0.135 * mix
    g.drawImage(beamTex2, 0, -half, len, half * 2)
    g.restore()
    // where the cone meets the water around the animals: backscatter, a
    // flat pool with a soft, bluer edge and a wide faint halo
    const R = lamp.r * 1.32
    g.globalAlpha = on
    g.drawImage(sp.pool, lamp.x - R, lamp.y - R, R * 2, R * 2)
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
  }

  function drawBodies() {
    const R = lamp.r
    const side = ensureBody(R)
    bg.setTransform(1, 0, 0, 1, 0, 0)
    bg.globalCompositeOperation = 'source-over'
    bg.globalAlpha = 1
    bg.clearRect(0, 0, side, side)
    bg.setTransform(dpr, 0, 0, dpr, (R - lamp.x) * dpr, (R - lamp.y) * dpr)
    let any = false
    for (const a of animals) {
      if (!a.near(lamp.x, lamp.y, R)) continue
      bg.globalAlpha = a.fade
      a.drawBody(bg, t, lamp)
      any = true
    }
    if (!any) return
    bg.setTransform(1, 0, 0, 1, 0, 0)
    bg.globalAlpha = 1
    bg.globalCompositeOperation = 'destination-in'
    bg.fillStyle = maskGrad
    bg.fillRect(0, 0, side, side)
    bg.globalCompositeOperation = 'source-over'
    g.globalAlpha = lamp.on
    g.drawImage(bodyC, lamp.x - R, lamp.y - R, R * 2, R * 2)
    halation(R, side)
    g.globalAlpha = 1
  }
  // Water scatters the light coming back off a lit body, so bright edges
  // wear a soft halo. Shrink the body layer twice (each a cheap, filtered
  // blur); multiply the small copy by itself so only the bright parts
  // (rims, speculars, rainbows) are left; lay both sizes back on, added.
  function halation(R, side) {
    const a = Math.max(8, Math.round(side / 6))
    const b = Math.max(4, Math.round(side / 16))
    if (haloA.width !== a) haloA.width = haloA.height = a
    if (haloB.width !== b) haloB.width = haloB.height = b
    ha.globalCompositeOperation = 'copy'
    ha.imageSmoothingQuality = 'medium'
    ha.drawImage(bodyC, 0, 0, a, a)
    // mostly drain its colour, so saturated pigment (a red gut, red velvet)
    // falls below the threshold and only bright light blooms; then put
    // back the layer's own coverage, which the grey wash filled in
    ha.globalCompositeOperation = 'saturation'
    ha.globalAlpha = 0.7
    ha.fillStyle = '#808080'
    ha.fillRect(0, 0, a, a)
    ha.globalAlpha = 1
    ha.globalCompositeOperation = 'destination-in'
    ha.drawImage(bodyC, 0, 0, a, a)
    // squared twice: a soft threshold, so dark skin and jelly add nothing
    ha.globalCompositeOperation = 'multiply'
    ha.drawImage(haloA, 0, 0)
    ha.drawImage(haloA, 0, 0)
    hb.globalCompositeOperation = 'copy'
    hb.imageSmoothingQuality = 'high'
    hb.drawImage(haloA, 0, 0, b, b)
    g.globalCompositeOperation = 'lighter'
    g.imageSmoothingQuality = 'high'
    g.globalAlpha = lamp.on * 0.4
    g.drawImage(haloA, lamp.x - R, lamp.y - R, R * 2, R * 2)
    g.globalAlpha = lamp.on * 0.75
    g.drawImage(haloB, lamp.x - R, lamp.y - R, R * 2, R * 2)
    g.imageSmoothingQuality = 'low'
    g.globalCompositeOperation = 'source-over'
  }

  // An animal lit by its own light: draw its body small, tint, mask, add.
  function selfLight(a, x, y, r, tint, k) {
    if (k < 0.01) return
    const side = Math.ceil(2 * r * dpr)
    if (selfC.width < side) selfC.width = selfC.height = side
    sg.setTransform(1, 0, 0, 1, 0, 0)
    sg.globalCompositeOperation = 'source-over'
    sg.globalAlpha = 1
    sg.clearRect(0, 0, side, side)
    sg.setTransform(dpr, 0, 0, dpr, (r - x) * dpr, (r - y) * dpr)
    a.drawBody(sg, t, { x, y, r })
    sg.setTransform(1, 0, 0, 1, 0, 0)
    sg.globalCompositeOperation = 'source-atop'
    sg.fillStyle = tint
    sg.fillRect(0, 0, side, side)
    sg.globalCompositeOperation = 'destination-in'
    const h = side / 2
    const m = sg.createRadialGradient(h, h, 0, h, h, h)
    m.addColorStop(0, 'rgba(0,0,0,1)')
    m.addColorStop(0.35, 'rgba(0,0,0,0.72)')
    m.addColorStop(0.7, 'rgba(0,0,0,0.24)')
    m.addColorStop(1, 'rgba(0,0,0,0)')
    sg.fillStyle = m
    sg.fillRect(0, 0, side, side)
    sg.globalCompositeOperation = 'source-over'
    g.globalCompositeOperation = 'lighter'
    g.globalAlpha = k
    g.drawImage(selfC, 0, 0, side, side, x - r, y - r, r * 2, r * 2)
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
  }

  function beamLight(x, y) {
    const [ox, oy] = beamOrigin()
    const dx = lamp.x - ox
    const dy = lamp.y - oy
    const d2 = dx * dx + dy * dy || 1
    const u = clamp(((x - ox) * dx + (y - oy) * dy) / d2)
    const px = ox + dx * u
    const py = oy + dy * u
    const w = 10 + lamp.r * 1.0 * u
    const off = Math.hypot(x - px, y - py) / w
    return lamp.on * (1 - smooth(0.78, 1, off)) * Math.pow(u, 1.6) * 0.5
  }

  // Marine snow: we are sinking, so it rises past the lamp as streaks.
  function drawSnow(dt) {
    const move = reduced ? 0 : 1
    g.globalCompositeOperation = 'lighter'
    g.lineCap = 'round'
    g.strokeStyle = 'rgb(222,238,255)'
    for (let i = 0; i < SN; i++) {
      const o = i * 4
      const z = snow[o + 2]
      const vy = (-(10 + 34 * z) * dt - dScroll * (0.22 + 0.5 * z)) * move
      const vx = Math.sin(t * 0.3 + snow[o + 3]) * 4 * dt * move
      snow[o + 1] += vy
      snow[o] += vx
      if (snow[o + 1] < -30) {
        snow[o + 1] += H + 60
        snow[o] = Math.random() * W
      } else if (snow[o + 1] > H + 30) {
        snow[o + 1] -= H + 60
        snow[o] = Math.random() * W
      }
      if (lamp.on < 0.01) continue
      const x = snow[o]
      const y = snow[o + 1]
      const l = lightAt(x, y) + beamLight(x, y)
      if (l < 0.035) continue
      const a = Math.min(1, l * (0.14 + 0.62 * z))
      // at rest a speck (the nearest ones smear a little); as the sub sinks
      // faster, a streak along its motion, as a camera sees it: a bright
      // head and a tail that fades
      const speed = dt > 0 ? Math.abs(vy) / dt : 0
      const len = reduced ? 0 : Math.min(56, speed * 0.06 * (0.3 + z))
      if (len < 2) {
        // now and then a flake turns a flat face to the lamp and glints
        const gl = reduced ? 0 : Math.pow(0.5 + 0.5 * Math.sin(t * (0.9 + z) + snow[o + 3] * 7), 40)
        dot(g, sp.lamp, x, y, (1.1 + 2.3 * z) * (1 + 0.9 * gl), Math.min(1, a * (1 + 2.6 * gl)))
        continue
      }
      const dir = vy > 0 ? -1 : 1
      const tx = x - vx * 2
      const mx = lerp(x, tx, 0.4)
      const my = y + dir * len * 0.4
      g.lineWidth = 0.6 + 1.1 * z
      g.globalAlpha = a * 0.8
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(mx, my)
      g.stroke()
      g.globalAlpha = a * 0.28
      g.beginPath()
      g.moveTo(mx, my)
      g.lineTo(tx, y + dir * len)
      g.stroke()
    }
    // motes right in front of the camera: large, soft, slow, and passing
    // faster than the snow behind them as the sub sinks (fewer and smaller
    // on a phone, where the lamp's pool is small)
    const nb = mobile ? 7 : BK
    const rk = mobile ? 0.7 : 1
    for (let i = 0; i < nb; i++) {
      const o = i * 4
      const z = bokeh[o + 2]
      const r = (9 + 26 * z * z) * rk
      bokeh[o + 1] += (-(6 + 10 * z) * dt - dScroll * (0.85 + 0.6 * z)) * move
      bokeh[o] += Math.sin(t * 0.17 + bokeh[o + 3]) * 3 * dt * move
      if (bokeh[o + 1] < -r - 10) {
        bokeh[o + 1] += H + r * 2 + 20
        bokeh[o] = Math.random() * W
      } else if (bokeh[o + 1] > H + r + 10) {
        bokeh[o + 1] -= H + r * 2 + 20
        bokeh[o] = Math.random() * W
      }
      if (lamp.on < 0.01) continue
      const x = bokeh[o]
      const y = bokeh[o + 1]
      const l = lightAt(x, y) * 0.8 + beamLight(x, y) * 1.4
      if (l < 0.03) continue
      dot(g, sp.bokeh, x, y, r, l * (0.2 - 0.08 * z))
    }
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
  }

  function drawFlashes(dt) {
    if (!reduced) {
      flashNext -= dt
      if (flashNext <= 0) {
        flashNext = 0.25 + Math.random() * 0.7
        const f = flashes.find((q) => q.age >= q.life)
        if (f) {
          f.x = Math.random() * W
          f.y = Math.random() * H
          f.age = 0
          f.life = 0.8 + Math.random() * 1.2
          f.r = 2.5 + Math.random() * 5
          f.c = Math.random() < 0.7 ? 0 : 1
        }
      }
    }
    g.globalCompositeOperation = 'lighter'
    for (const f of flashes) {
      if (f.age >= f.life) continue
      f.age += dt
      const u = f.age / f.life
      const a = Math.min(1, u * 14) * Math.pow(1 - u, 2.2) * 0.55
      dot(g, f.c ? sp.blue : sp.cyan, f.x, f.y + (shift - lastShift), f.r, a)
    }
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
  }

  // A find is a bioluminescent alarm: a ring of the animal's own light
  // rolls out through the water, and as it passes, the plankton around it
  // (Noctiluca and its kind) answer with a flash, the way they light up
  // when anything disturbs them.
  const RIP_T = 2.2
  const ripR = (r0, u) => r0 * (0.75 + 2.5 * (1 - Math.pow(1 - u, 3)))
  // k: full strength for the visitor's own finds, quieter when the lamp
  // found it on its own. Never more than two at once: beauty, not noise.
  function addRipple(a, k = 1) {
    const [cx, cy] = a.center()
    const r0 = Math.max(34, Math.min(a.ext[0], a.ext[1]) * 1.1 * a.s)
    const n = mobile ? 22 : 34
    const sparks = []
    for (let i = 0; i < n; i++) {
      const th = Math.random() * TAU
      const d = r0 * (0.95 + Math.pow(Math.random(), 0.8) * 2.25)
      // when the ring reaches it (invert ripR)
      const e = clamp((d / r0 - 0.75) / 2.5, 0, 0.999)
      sparks.push({
        dx: Math.cos(th) * d,
        dy: Math.sin(th) * d * 0.9,
        hit: (1 - Math.cbrt(1 - e)) * RIP_T + Math.random() * 0.12,
        r: 1.8 + Math.random() * 2.8,
        c: Math.random() < 0.62 ? 0 : 1,
      })
    }
    ripples.push({ a, t: 0, x: cx, y: cy, by0: a.by, r0, sparks, k })
    while (ripples.length > 2) ripples.shift()
  }
  function drawRipples(dt) {
    if (!ripples.length) return
    // the six-of-six constellation clears the water for itself
    const hush = finale.t >= 0 ? 1 - smooth(0, 0.8, finale.t) : 1
    g.globalCompositeOperation = 'lighter'
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i]
      rp.t += dt
      if (rp.t > RIP_T + 1.6) {
        ripples.splice(i, 1)
        continue
      }
      const x = rp.x
      const y = rp.y + (rp.a.by - rp.by0) // it stays in the water as the scene rises
      const ring = ringOf(rp.a.color)
      for (const [lag, k] of [
        [0, 0.36],
        [0.36, 0.16],
      ]) {
        const u = (rp.t - lag) / RIP_T
        if (u <= 0 || u >= 1) continue
        dot(g, ring, x, y, ripR(rp.r0, u), hush * rp.k * k * smooth(0, 0.06, u) * Math.pow(1 - u, 1.7))
      }
      for (const s of rp.sparks) {
        const age = rp.t - s.hit
        if (age < 0 || age > 1.5) continue
        const f = Math.min(1, age * 14) * Math.pow(1 - age / 1.5, 2.4)
        dot(g, s.c ? sp.blue : sp.cyan, x + s.dx, y + s.dy, s.r * (1 + 0.7 * f), hush * 0.85 * f * (0.5 + 0.5 * rp.k))
      }
    }
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
  }

  function drawOverlays() {
    g.globalCompositeOperation = 'source-over'
    g.lineCap = 'butt'
    for (const a of animals) {
      // found, not lit: a small pip in the animal's own light
      if (a.pipA > 0.02) {
        const [px, py] = a.pinAt()
        g.globalCompositeOperation = 'lighter'
        dot(g, a.id === 'comb' ? sp.inkSoft : a.id === 'angler' ? sp.lureSoft : a.id === 'dragon' ? sp.redSoft : a.color === C.blue ? sp.blueSoft : sp.cyanSoft, px, py, 9, 0.5 * a.pipA)
        g.globalCompositeOperation = 'source-over'
        g.globalAlpha = 0.9 * a.pipA
        g.fillStyle = rgba(a.color, 1)
        g.beginPath()
        g.arc(px, py, 1.9, 0, TAU)
        g.fill()
        g.globalAlpha = 0.4 * a.pipA
        g.strokeStyle = rgba(a.color, 1)
        g.lineWidth = 0.8
        g.beginPath()
        g.arc(px, py, 5, 0, TAU)
        g.stroke()
      }
      // leader to the open label: a filament of the animal's own light that
      // runs out from it and on into the plate's hairline rule
      const lab = labels.get(a)
      if (!lab || a.labelA < 0.02 || lab.sx === undefined) continue
      const ax = lab.sx
      const ay = lab.sy
      const cw = lab.cw || lab.w
      const side = lab.mode === 'l'
      let lx = side ? lab.x + cw + 1 : lab.x - 1
      let ly = lab.y + (lab.ruleY || 11)
      let kx = side ? lx + 16 : lx - 16
      if (lab.mode === 'db' || lab.mode === 'dt') {
        lx = kx = clamp(ax, lab.x + 10, lab.x + Math.min(cw, 240) - 10)
        ly = lab.mode === 'db' ? lab.y - 10 : lab.y + lab.h + 8
      }
      const l1 = Math.hypot(kx - ax, ly - ay)
      const l2 = Math.abs(lx - kx)
      const grow = (1 - Math.pow(1 - a.labelA, 3)) * (l1 + l2)
      const u1 = l1 > 0 ? Math.min(1, grow / l1) : 1
      const u2 = l2 > 0 ? clamp((grow - l1) / l2) : 1
      const ex = lerp(ax, kx, u1)
      const ey = lerp(ay, ly, u1)
      const lg = g.createLinearGradient(ax, ay, lx, ly)
      lg.addColorStop(0, rgba(a.color, 0.9))
      lg.addColorStop(0.55, 'rgba(234,246,244,0.62)')
      lg.addColorStop(1, rgba(a.color, 0.8))
      g.strokeStyle = lg
      g.lineCap = 'round'
      g.globalCompositeOperation = 'lighter'
      for (const [w, k] of [
        [3.4, 0.1],
        [0.9, 0.62],
      ]) {
        g.lineWidth = w
        g.globalAlpha = a.labelA * k
        g.beginPath()
        g.moveTo(ax, ay)
        g.lineTo(ex, ey)
        if (u1 >= 1 && l2 > 0) g.lineTo(lerp(kx, lx, u2), ly)
        g.stroke()
      }
      // where it leaves the animal: a small bead of its light, breathing
      const br = 0.75 + 0.25 * Math.sin(t * 1.6 + a.seed)
      dot(g, glowOf(a)[0], ax, ay, 12, a.labelA * 0.55 * br)
      g.globalCompositeOperation = 'source-over'
      g.globalAlpha = a.labelA
      g.fillStyle = rgba(a.color, 1)
      g.beginPath()
      g.arc(ax, ay, 1.9, 0, TAU)
      g.fill()
      g.globalAlpha = a.labelA * 0.5
      g.strokeStyle = rgba(a.color, 1)
      g.lineWidth = 0.7
      g.beginPath()
      g.arc(ax, ay, 4.6, 0, TAU)
      g.stroke()
      g.lineCap = 'butt'
    }
    g.globalAlpha = 1
  }

  // Six of six: the six lights pulse in the order they were logged, joined
  // like a constellation, then a sonar ping rolls out across the dark.
  const F_START = 1.0
  const F_STEP = 0.5
  const F_PING = F_START + 5 * F_STEP + 0.45
  const F_RELIT = 5.0
  const glowOf = (a) =>
    a.id === 'comb' ? [sp.inkSoft, sp.ink] : a.id === 'angler' ? [sp.lureSoft, sp.lure] : a.id === 'dragon' ? [sp.redSoft, sp.red] : a.color === C.blue ? [sp.blueSoft, sp.blue] : [sp.cyanSoft, sp.cyan]
  function drawFinale() {
    const ft = finale.t
    if (ft < 0) return
    const out = 1 - smooth(F_RELIT - 0.8, F_RELIT + 0.6, ft)
    g.globalCompositeOperation = 'lighter'
    g.lineCap = 'round'
    let prev = null
    let prevA = null
    for (let i = 0; i < LOG_ORDER.length; i++) {
      const a = byId[LOG_ORDER[i]]
      const [x, y] = a.beacon()
      const ti = F_START + i * F_STEP
      if (prev) {
        // a filament of light runs from the last light to this one, shading
        // from one animal's colour into the next
        const k = smooth(ti - F_STEP * 0.9, ti, ft)
        if (k > 0 && out > 0) {
          const hx = lerp(prev[0], x, k)
          const hy = lerp(prev[1], y, k)
          const lg = g.createLinearGradient(prev[0], prev[1], x, y)
          lg.addColorStop(0, rgba(prevA.color, 1))
          lg.addColorStop(0.5, 'rgb(200,232,255)')
          lg.addColorStop(1, rgba(a.color, 1))
          g.strokeStyle = lg
          for (const [w, al] of [
            [4.5, 0.07],
            [0.9, 0.42],
          ]) {
            g.lineWidth = w
            g.globalAlpha = al * out
            g.beginPath()
            g.moveTo(prev[0], prev[1])
            g.lineTo(hx, hy)
            g.stroke()
          }
          if (k < 0.995) dot(g, glowOf(a)[1], hx, hy, 7, 0.9 * out)
        }
      }
      const on = smooth(ti - 0.06, ti + 0.12, ft) * out
      if (on > 0) {
        const burst = ft > ti ? Math.exp(-(ft - ti) * 2.6) : 0
        const [soft, core] = glowOf(a)
        dot(g, soft, x, y, (60 + 50 * burst) * Math.max(0.7, a.s), on * (0.3 + 0.6 * burst))
        dot(g, core, x, y, 9 + 12 * burst, on * (0.6 + 0.4 * burst))
        g.globalAlpha = 0.5 * on
        g.strokeStyle = rgba(a.color, 1)
        g.lineWidth = 0.8
        g.beginPath()
        g.arc(x, y, 7 + 3 * burst, 0, TAU)
        g.stroke()
      }
      prev = [x, y]
      prevA = a
    }
    // the ping: two rings rolling out from the last light, each a soft
    // band of light with a fine bright edge
    if (finale.pinged) {
      const R = Math.hypot(W, H)
      g.strokeStyle = 'rgb(160,230,255)'
      for (const lag of [0, 0.22]) {
        const u = (ft - finale.pingT - lag) / 2.2
        if (u <= 0 || u >= 1) continue
        const r = 20 + R * (1 - Math.pow(1 - u, 2.2))
        const k = Math.pow(1 - u, 1.6)
        for (const [w, al] of [
          [10, 0.045],
          [1.1, 0.34],
        ]) {
          g.globalAlpha = al * k
          g.lineWidth = w
          g.beginPath()
          g.arc(finale.px, finale.py, r, 0, TAU)
          g.stroke()
        }
      }
    }
    g.lineCap = 'butt'
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
  }

  function render(dt) {
    if (!near) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.globalCompositeOperation = 'source-over'
    g.globalAlpha = 1
    g.clearRect(0, 0, W, H)
    if (lamp.on > 0.01) {
      drawBeam()
      drawBodies()
    }
    // living light the animals cast on themselves
    const an = byId.angler
    const [ex, ey] = an.luresAt()
    selfLight(an, ex, ey, 86 * an.s, 'rgba(255,160,64,0.7)', 0.55 * an.lure * (1 - 0.7 * lightAt(ex, ey)))
    const dr = byId.dragon
    const [rx, ry] = dr.redAt()
    selfLight(dr, rx, ry, 46 * dr.s, 'rgba(255,40,30,0.6)', 0.42 * dr.red)

    drawSnow(dt)
    g.globalCompositeOperation = 'lighter'
    for (const a of animals) a.drawGlow(g, t, sp)
    g.globalAlpha = 1
    drawFlashes(dt)
    drawRipples(dt)
    drawFinale()
    drawOverlays()
  }

  /* ------------------------------------------------------------- lamp */
  function flicker(s) {
    if (s < 0.06) return 0.7
    if (s < 0.13) return 0.06
    if (s < 0.21) return 0.55
    if (s < 0.3) return 0.12
    if (s < 0.36) return 0.9
    if (s < 0.42) return 0.4
    return Math.min(1, 0.62 + (s - 0.42) * 1.4)
  }

  function pickIdle() {
    const yMax = logRect && mobile ? logRect.y - 10 : H * 0.86
    const cand = animals.filter((a) => {
      const [x, y] = a.center()
      return x > W * 0.06 && x < W - rightInset && y > H * 0.14 && y < yMax && a !== idle.last
    })
    const unfound = cand.filter((a) => !a.found)
    const pool = unfound.length ? unfound : cand
    if (!pool.length) {
      idle.target = null
      idle.px = W * (0.3 + Math.random() * 0.4)
      idle.py = H * (0.3 + Math.random() * 0.4)
      return
    }
    pool.sort((a, b) => {
      const [ax, ay] = a.center()
      const [bx, by] = b.center()
      return Math.hypot(ax - lamp.x, ay - lamp.y) - Math.hypot(bx - lamp.x, by - lamp.y)
    })
    idle.target = unfound.length ? pool[0] : pool[Math.floor(Math.random() * pool.length)]
    idle.hold = 0
  }

  function updateLamp(dt, now) {
    // switch on / off
    if (lamp.want) {
      if (lamp.onT < 0) lamp.onT = 0
      lamp.onT += dt
      lamp.pow = reduced ? 1 : flicker(lamp.onT)
    } else {
      lamp.onT = -1
      lamp.pow = Math.max(0, lamp.pow - dt * 2.5)
    }
    // six of six: the lamp dims for the constellation, then flickers back
    let dim = 1
    if (finale.t >= 0) {
      if (finale.t < F_RELIT) dim = 1 - 0.9 * smooth(0, 0.9, finale.t)
      else if (!finale.relit) {
        finale.relit = true
        if (lamp.want) lamp.onT = 0
      }
    }
    lamp.on = lamp.pow * dim
    if (reduced) return

    let tx
    let ty
    let k
    let tour = null
    if (focusA) {
      ;[tx, ty] = focusA.center()
      k = 0.07
      lamp.mode = 'focus'
    } else if (fine && pointer.inside && now - pointer.t < 9000) {
      tx = pointer.cx - stageLeft
      ty = pointer.cy - stageTop()
      k = 0.13
      lamp.mode = 'pointer'
    } else if (now - touch.t < 7000) {
      tx = touch.x
      ty = touch.y
      k = 0.09
      lamp.mode = 'touch'
    } else if (active && now - lastScrollT < 3500 && (tour = tourTarget())) {
      // sinking with no hand on the lamp (touch, or keys): it goes from
      // animal to animal on its own, one beat of the scroll each
      ;[tx, ty] = aim(tour)
      tx += Math.sin(t * 0.5) * lamp.r * 0.08
      ty += Math.cos(t * 0.37) * lamp.r * 0.06
      k = 0.085
      lamp.mode = 'tour'
    } else {
      if (lamp.mode !== 'idle') {
        lamp.mode = 'idle'
        idle.target = null
        idle.hold = 0
        idle.last = null
      }
      if (!idle.target && idle.hold <= 0) pickIdle()
      if (idle.target) {
        ;[tx, ty] = idle.target.center()
        tx += Math.sin(t * 0.5) * lamp.r * 0.18
        ty += Math.cos(t * 0.37) * lamp.r * 0.14
      } else {
        tx = idle.px
        ty = idle.py
      }
      const d = Math.hypot(tx - lamp.x, ty - lamp.y)
      if (d < lamp.r * 0.3) idle.hold += dt
      if (idle.hold > (idle.target && !idle.target.found ? 1.6 : 3.2)) {
        idle.last = idle.target
        idle.target = null
        idle.hold = 0
        pickIdle()
      }
      // a slow, hand-held search
      tx += Math.sin(t * 1.3) * 6
      ty += Math.sin(t * 0.9 + 1) * 5
      k = 0.03
    }
    const e = ease(k, dt)
    lamp.x += (tx - lamp.x) * e
    lamp.y += (ty - lamp.y) * e
  }

  /* ----------------------------------------------------- discoveries */
  const NOTES = {
    start: 'This deep, the water is emptier. All six were logged higher up.',
    all: 'All six found. In one survey off California, about three quarters of the animals seen in open water could make light.',
    still: 'In one survey off California, about three quarters of the animals seen in open water could make light.',
    // touch, until the first tap: the hint, beside the log
    tap: 'Tap the dark to aim the lamp.',
  }
  const LAST_HINT = {
    comb: 'One more. Look for color, not light.',
    squid: 'One more. Look for glowing arm tips.',
    siphonophore: 'One more. Look for a string of blue lights.',
    angler: 'One more. Look for the warm light.',
    dragon: 'One more. Look for the red light.',
    atolla: 'One more. Look for a ring of blue.',
  }
  function noteFor() {
    if (foundCount >= 6) return NOTES.all
    if (!fine && !tapped) return NOTES.tap
    if (foundCount === 5) {
      const last = animals.find((a) => !a.found)
      return (last && LAST_HINT[last.id]) || NOTES.start
    }
    return NOTES.start
  }
  function setNote() {
    if (!noteEl || reduced) return
    const text = noteFor()
    if (noteEl.textContent !== text) noteEl.textContent = text
    noteEl.classList.toggle('is-tap', text === NOTES.tap)
  }
  // `by`: 'quiet' (still frame), 'idle' (the lamp found it on its own), or
  // 'visitor' (pointer, touch or keyboard). Only the visitor's finds are
  // announced to assistive tech.
  function setFound(a, by = 'visitor') {
    if (a.found) return
    a.found = true
    const quiet = by === 'quiet'
    a.reticle = quiet ? -1 : 0
    foundCount++
    const lab = labels.get(a)
    if (lab) lab.el.classList.add('is-found')
    pips.get(a.id)?.classList.add('is-found')
    if (foundEl) foundEl.textContent = String(foundCount)
    if (countEl) countEl.dataset.count = String(foundCount)
    setNote()
    section.dataset.found = String(foundCount)
    if (by === 'visitor' && announceEl && lab) {
      announceEl.textContent = foundCount === 6 ? `${lab.name} found. All six found.` : `${lab.name} found. ${foundCount} of 6.`
    }
    if (!quiet) {
      a.react()
      // the sixth find has its own moment (the constellation), not a ripple
      if (foundCount < 6) addRipple(a, by === 'visitor' ? 1 : 0.6)
      lastActT = performance.now() + 3000 // its reaction plays at full frame rate
      const [cx, cy] = a.center()
      ctx.emit('sonar', { x: stageLeft + cx, y: stageTop() + cy, strength: 0.28 })
      if (foundCount === 6) startFinale()
      // a phone answers a find the visitor made with a tick
      if (by === 'visitor' && !fine && navigator.userActivation?.hasBeenActive) {
        try {
          navigator.vibrate?.(8)
        } catch {}
      }
    }
  }
  function startFinale() {
    if (reduced) return
    finale.t = 0
    finale.relit = false
    finale.pinged = false
    logEl?.classList.add('is-complete')
  }
  function updateFinale(dt) {
    if (finale.t < 0) return
    finale.t += dt
    if (!finale.pinged && finale.t >= F_PING) {
      finale.pinged = true
      finale.pingT = finale.t
      ;[finale.px, finale.py] = byId[LOG_ORDER[LOG_ORDER.length - 1]].beacon()
      ctx.emit('sonar', { x: stageLeft + finale.px, y: stageTop() + finale.py, strength: 0.6 })
    }
    if (finale.t > F_RELIT + 2.4) {
      finale.t = -1
      logEl?.classList.remove('is-complete')
    }
  }

  function updateAnimals(dt, now) {
    const by = lamp.mode === 'idle' || lamp.mode === 'tour' ? 'idle' : 'visitor'
    for (const a of animals) {
      a.shift(shift)
      a.update(t, dt)
      if (a.reticle >= 0) a.reticle += dt
      a.light = a.sample(lightAt)
      if (a.light > 0.5) {
        a.litFor += dt
        if (a.litFor > 0.35 && !a.found) setFound(a, by)
      } else a.litFor = Math.max(0, a.litFor - dt * 2)
      if (a.light > 0.3) a.lastLit = now
      // keyboard: a short dwell on its button counts, even if the lamp (or
      // the scroll) is still on its way
      if (a === focusA && !a.found && now - focusSince > 400) setFound(a, 'visitor')
    }
  }

  /* ----------------------------------------------------------- labels */
  const overlap = (x, y, w, h, o) => {
    const ix = Math.min(x + w, o.x + o.w) - Math.max(x, o.x)
    const iy = Math.min(y + h, o.y + o.h) - Math.max(y, o.y)
    return ix > 0 && iy > 0 ? ix * iy : 0
  }
  function labelCost(x, y, w, h, self) {
    let c =
      Math.max(0, leftInset - x) * h +
      Math.max(0, x + w - (W - rightInset)) * h +
      Math.max(0, topInset - y) * w +
      Math.max(0, y + h - (H - bottomInset)) * w
    c *= 4
    for (const o of obstacles) {
      const oy = o.intro ? o.y + introY : o.y
      c += overlap(x, y, w, h, { x: o.x, y: oy, w: o.w, h: o.h }) * 2
    }
    // glowing clouds: text over them is hard to read
    for (const o of glowObs) c += overlap(x, y, w, h, o) * 1.6
    for (const o of placed) c += overlap(x, y, w, h, o) * 1.5
    for (const b of animals) {
      if (b === self || b.id === 'siphonophore') continue
      const [bx, by] = b.center()
      const ex = b.ext[0] * b.s
      const ey = b.ext[1] * b.s
      c += overlap(x, y, w, h, { x: bx - ex, y: by - ey, w: ex * 2, h: ey * 2 }) * 0.6
    }
    return c
  }
  function placeLabel(a, lab) {
    const [cx, cy] = a.center()
    if (mobile && !reduced) {
      // phones: the open label is a caption docked above or below the animal
      const w = lab.w
      const h = lab.h
      const top = Math.max(topInset, introRect ? introRect.y + introRect.h + introY : 0)
      const bottom = (logRect ? logRect.y : H - bottomInset) - 6
      const below = cy < (top + bottom) / 2
      lab.mode = below ? 'db' : 'dt'
      lab.cw = w
      const ey = a.ext[1] * 0.62
      ;[lab.sx, lab.sy] = a.id === 'siphonophore' ? a.center() : a.toScreen(0, below ? ey : -ey)
      return [leftInset, below ? clamp(cy + a.ext[1] * a.s + 22, top, bottom - h) : clamp(cy - a.ext[1] * a.s - 22 - h, top, bottom - h)]
    }
    const ex = a.ext[0] * a.s
    const ey = a.ext[1] * a.s
    const gap = 24
    const w = lab.w
    const h = lab.h
    lab.cw = w
    const yS = cy - Math.min(ey * 0.55, h * 0.3)
    const xC = cx + 26
    const cands = [
      { k: 'r', x: cx + ex + gap, y: yS },
      { k: 'l', x: cx - ex - gap - w, y: yS },
      { k: 'b', x: xC, y: cy + ey + gap },
      { k: 't', x: xC, y: cy - ey - gap - h },
    ]
    if (a.side < 0) cands.unshift(cands.splice(1, 1)[0])
    let best = cands[0]
    let bestC = Infinity
    cands.forEach((c, i) => {
      const cost = labelCost(c.x, c.y, w, h, a) + (lab.k && c.k !== lab.k ? w * h * 0.08 : 0) + i * 40
      if (cost < bestC) {
        bestC = cost
        best = c
      }
    })
    lab.k = best.k
    const x = clamp(best.x, leftInset, Math.max(leftInset, W - rightInset - w))
    const y = clamp(best.y, topInset, Math.max(topInset, H - bottomInset - h))
    // leader: from the animal toward the label, then a short level tick
    const ax = a.anchor[0]
    const ay = a.anchor[1]
    const [sx, sy] =
      a.id === 'siphonophore'
        ? a.center()
        : best.k === 'r'
          ? a.toScreen(ax, ay)
          : best.k === 'l'
            ? a.toScreen(a.anchorL ? a.anchorL[0] : -ax, a.anchorL ? a.anchorL[1] : ay)
            : a.toScreen(0, (best.k === 'b' ? 1 : -1) * a.ext[1] * 0.55)
    lab.sx = sx
    lab.sy = sy
    lab.mode = best.k
    // the plate's rule brightens toward the side its leader comes in from
    const sd = best.k === 'l' ? 'l' : 'r'
    if (lab.side !== sd) {
      lab.side = sd
      lab.el.dataset.side = sd
    }
    return [x, y]
  }
  function moveLabel(lab, x, y) {
    lab.x = x
    lab.y = y
    lab.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
  }
  function setOn(a, lab, on) {
    if (on === lab.on) return
    lab.on = on
    lab.el.classList.toggle('is-on', on)
    if (on && a.id === 'siphonophore') a.anchorIdx = a.litIdx
  }

  const placed = []
  function updateLabels(dt, now) {
    // reduced motion: the six are a list under the still scene
    if (reduced) {
      for (const lab of labels.values()) lab.el.classList.add('is-found', 'is-on')
      return
    }
    // glowing clouds labels should stay off
    glowObs = []
    const cl = byId.squid.cloud()
    if (cl) glowObs.push(cl)
    // one full label at a time: the most lit (or focused) found animal.
    // During the six-of-six moment only a focused label stays.
    const quiet = finale.t >= 0 && finale.t < F_RELIT + 0.4
    let best = null
    let bestL = 0.3
    for (const a of animals) {
      if (!a.found && a !== focusA) continue
      if (quiet && a !== focusA) continue
      const [, cy] = a.center()
      if (a !== focusA && (cy < 0 || cy > H)) continue
      const l = a === focusA ? 2 : a.light + (now - a.lastLit < 1800 ? 0.2 : 0)
      if (l > bestL) {
        bestL = l
        best = a
      }
    }
    placed.length = 0
    // while a label is open, any other one gets out of its way quickly
    if (listEl && listEl.classList.contains('has-on') !== !!best) listEl.classList.toggle('has-on', !!best)
    const order = best ? [best, ...animals.filter((a) => a !== best)] : animals
    for (const a of order) {
      const lab = labels.get(a)
      if (!lab) continue
      const on = a === best
      setOn(a, lab, on)
      a.labelA += ((on ? 1 : 0) - a.labelA) * ease(0.08, dt)
      const pip = a.found && !on && !quiet ? 1 : 0
      a.pipA += (pip - a.pipA) * ease(0.06, dt)
      if (a.labelA < 0.01 && !on) continue
      const [tx, ty] = placeLabel(a, lab)
      const far = lab.x < -1e3 || Math.abs(tx - lab.x) > W * 0.5
      const e = far ? 1 : ease(0.14, dt)
      const x = lab.x + (tx - lab.x) * e
      const y = lab.y + (ty - lab.y) * e
      placed.push({ x: tx - 6, y: ty - 4, w: (lab.cw || lab.w) + 12, h: lab.h + 8 })
      if (Math.abs(x - lab.x) > 0.2 || Math.abs(y - lab.y) > 0.2 || far) moveLabel(lab, x, y)
    }
  }

  /* -------------------------------------------- lit text + darkness */
  let lastLx = -1
  let lastLy = -1
  let lastOn = -1
  let lastIntro = 0
  function updateText() {
    if (
      Math.abs(lamp.x - lastLx) < 0.4 &&
      Math.abs(lamp.y - lastLy) < 0.4 &&
      Math.abs(lamp.on - lastOn) < 0.01 &&
      Math.abs(introY - lastIntro) < 0.4
    )
      return
    lastLx = lamp.x
    lastLy = lamp.y
    lastOn = lamp.on
    lastIntro = introY
    stage.style.setProperty('--lr', lamp.r.toFixed(0))
    stage.style.setProperty('--lamp', lamp.on.toFixed(3))
    for (const el of litEls) {
      el.style.setProperty('--mx', (lamp.x - el._ox).toFixed(1))
      el.style.setProperty('--my', (lamp.y - el._oy - introY).toFixed(1))
    }
  }

  let lastDark = -1
  let lastEdge = -1
  let lastEdgeB = -1
  let progress = 0
  function setActive(v) {
    if (v === active) return
    active = v
    lamp.want = v || reduced
    if (v && lamp.onT < 0 && !reduced) {
      // the lamp comes on where the visitor is pointing, or near the squid
      if (fine && pointer.inside) {
        lamp.x = pointer.cx - stageLeft
        lamp.y = pointer.cy - stageTop()
      } else if (!focusA) {
        ;[lamp.x, lamp.y] = byId.squid.center()
        lamp.x -= lamp.r * 0.25
      }
    }
    ctx.emit('lamp', { on: v })
  }
  function updateScroll() {
    // cached document geometry + the scroll position: no layout reads
    const sy = scrollPos()
    const top = secTop - sy
    const bottom = top + secH
    dScroll = clamp(sy - lastSY, -90, 90)
    lastSY = sy
    progress = clamp(-top / Math.max(1, secH - vh))
    setActive(top < vh * 0.45 && bottom > vh * 0.55)
    // darkness: the stage is the water with its lights switched off
    const enter = clamp((vh - top) / (vh * 0.85))
    const exit = clamp(bottom / (vh * 0.85))
    const dark = smooth(0, 1, enter) * smooth(0, 1, exit)
    const edge = Math.max(0, top) * 1.25
    const edgeB = Math.max(0, vh - bottom) * 1.25
    if (Math.abs(dark - lastDark) > 0.004 || Math.abs(edge - lastEdge) > 1 || Math.abs(edgeB - lastEdgeB) > 1) {
      lastDark = dark
      lastEdge = edge
      lastEdgeB = edgeB
      stage.style.setProperty('--dark', dark.toFixed(3))
      stage.style.setProperty('--edge', `${edge.toFixed(0)}px`)
      stage.style.setProperty('--edge-b', `${edgeB.toFixed(0)}px`)
    }
    if (reduced) {
      shift = 0
      return
    }
    // the log belongs to the dark: it is gone before the stage lets go
    // and the itinerary rises in under it
    const la = smooth(0.62, 0.97, bottom / vh).toFixed(2)
    if (la !== logA) {
      logA = la
      stage.style.setProperty('--log-a', la)
    }
    const p = progress
    lastShift = shift
    shift = (0.5 - p) * L.travel * H
    if (mobile) {
      const y = -p * H * 1.25
      if (Math.abs(y - introY) > 0.3) {
        introY = y
        intro.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`
      }
    } else if (introY !== 0) {
      introY = 0
      intro.style.transform = ''
    }
    // wide screens: once the animals rise into it, the intro sinks into
    // the dark too; only the lamp still finds it
    const ia = (mobile ? 1 : 1 - 0.7 * smooth(0.42, 0.8, p)).toFixed(2)
    if (ia !== introA) {
      introA = ia
      intro.style.setProperty('--intro-a', ia)
    }
  }

  /* ------------------------------------------------------------- loop */
  let lastNow = performance.now()
  let cost = 0
  function tick() {
    const now = performance.now()
    if (scrollPos() !== lastSY) lastScrollT = now
    // Nothing has moved for a while (no scroll, no pointer, no reaction or
    // flicker in progress): the slow drift that is left runs at ~30 fps.
    const calm =
      now - Math.max(lastScrollT, pointer.t, touch.t, focusSince, lastActT) > 1200 &&
      finale.t < 0 &&
      (lamp.onT < 0 || lamp.onT > 1.2)
    if (calm && now - lastNow < 30) return
    const dt = Math.min(0.05, (now - lastNow) / 1000)
    lastNow = now
    t += dt
    updateScroll()
    updateFinale(dt)
    updateLamp(dt, now)
    updateAnimals(dt, now)
    updateLabels(dt, now)
    updateText()
    render(dt)
    cost += (performance.now() - now - cost) * 0.05
  }

  function start() {
    if (running || reduced) return
    running = true
    lastNow = performance.now()
    gsap.ticker.add(tick)
  }
  function stop() {
    if (!running) return
    running = false
    gsap.ticker.remove(tick)
    setActive(false)
  }
  function sync() {
    if (visible && !document.hidden) start()
    else stop()
  }

  // A single still frame (reduced motion, or a static re-render on input)
  function still() {
    const now = performance.now()
    updateScroll()
    lamp.want = true
    lamp.pow = lamp.on = 1
    if (focusA) [lamp.x, lamp.y] = focusA.center()
    for (const a of animals) {
      a.shift(0)
      a.update(t, 0)
      a.light = a.sample(lightAt)
      if (!a.found) setFound(a, 'quiet')
    }
    if (noteEl) noteEl.textContent = NOTES.still
    updateLabels(1, now)
    updateText()
    render(0)
  }

  /* ---------------------------------------------------- visibility */
  // near (~1.5 screens away): bake the sprites and allocate the canvas;
  // far: free it again
  const nearIo = new IntersectionObserver(
    (entries) => {
      for (const e of entries) near = e.isIntersecting
      if (near) assets()
      alloc()
      if (near && reduced) still()
    },
    { rootMargin: '150% 0px' },
  )
  nearIo.observe(section)
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) visible = e.isIntersecting
      sync()
      if (visible && reduced) still()
    },
    { rootMargin: '80px 0px' },
  )
  io.observe(section)
  document.addEventListener('visibilitychange', sync)

  /* ----------------------------------------------------------- input */
  // Touch: a tap aims the lamp, a sideways drag steers it. A vertical
  // swipe is the visitor sinking, not aiming (pointerdown alone would
  // move the lamp at the start of every scroll).
  const tap = { id: -1, x: 0, y: 0, t: 0, drag: false }
  function aimAt(cx, cy) {
    touch.x = cx - stageLeft
    touch.y = cy - stageTop()
    touch.t = performance.now()
    if (reduced) {
      lamp.x = touch.x
      lamp.y = touch.y
      focusA = null
      still()
    } else if (!tapped && !fine) {
      tapped = true
      setNote()
    }
  }
  stage.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
        pointer.cx = e.clientX
        pointer.cy = e.clientY
        pointer.t = performance.now()
        pointer.inside = true
      } else if (e.pointerType === 'touch' && e.pointerId === tap.id && !reduced) {
        const dx = e.clientX - tap.x
        const dy = e.clientY - tap.y
        if (tap.drag || (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2)) {
          tap.drag = true
          aimAt(e.clientX, e.clientY)
        }
      }
    },
    { passive: true },
  )
  // scrolling with the wheel over the stage counts as attention, too
  stage.addEventListener('wheel', () => (pointer.t = performance.now()), { passive: true })
  stage.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') pointer.inside = false
  })
  stage.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch') {
        tap.id = e.pointerId
        tap.x = e.clientX
        tap.y = e.clientY
        tap.t = performance.now()
        tap.drag = false
      } else if (!fine || reduced) {
        // a mouse on a touch-first device, or the still scene: aim at once
        aimAt(e.clientX, e.clientY)
      }
    },
    { passive: true },
  )
  stage.addEventListener(
    'pointerup',
    (e) => {
      if (e.pointerId !== tap.id) return
      tap.id = -1
      if (tap.drag) return
      if (performance.now() - tap.t < 700 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 14) aimAt(e.clientX, e.clientY)
    },
    { passive: true },
  )
  stage.addEventListener('pointercancel', (e) => {
    if (e.pointerId === tap.id) tap.id = -1
  })

  // Keyboard: every animal is a real button. Focus shows its label at once,
  // beside the animal, and brings the lamp (and the scene) to it.
  // where an animal sits in the scene's own layout (its rest height)
  const restY = (a) => (a.id === 'siphonophore' && a.pts.length ? a.pts[Math.floor(a.pts.length * 0.35)].by : a.baseY)
  function stopGlide() {
    glideA = null
    const ln = ctx.lenis
    if (!ln || ln.isScrolling !== 'smooth') return
    if (typeof ln.reset === 'function') ln.reset()
    else ln.scrollTo(window.scrollY, { immediate: true, force: true })
  }
  function bringIntoView(a) {
    if (reduced) return
    measureGeo()
    // where the page really is: the browser may just have scrolled the
    // button into view on its own
    const sy = window.scrollY
    const top = secTop - sy
    const pinned = top <= 1 && top + secH >= vh - 1
    const [, y] = aim(a)
    if (pinned && y > H * 0.16 && y < H * 0.84) return
    // the progress at which this animal sits at about half height
    const p = clamp(0.5 - (H * 0.5 - restY(a)) / (L.travel * H * a.z), 0.02, 0.98)
    const target = secTop + p * Math.max(0, secH - vh)
    const ln = ctx.lenis
    if (!ln) return window.scrollTo(0, target)
    // never glide from a stale position: sync Lenis to the page first
    stopGlide()
    if (Math.abs(ln.animatedScroll - sy) > 0.5) ln.scrollTo(sy, { immediate: true, force: true })
    if (!pinned) {
      // arriving from outside the section: go straight there
      ln.scrollTo(target, { immediate: true, force: true })
      return
    }
    // within the pinned stage: glide the scene to it
    glideA = a
    ln.scrollTo(target, {
      duration: 1.4,
      easing: (k) => 1 - Math.pow(1 - k, 4),
      force: true,
      onComplete: () => {
        if (glideA === a) glideA = null
      },
    })
  }
  function showNow(a) {
    if (reduced) return
    const lab = labels.get(a)
    if (!lab) return
    // bring positions up to date even if the loop has not run yet
    updateScroll()
    for (const b of animals) {
      b.shift(shift)
      b.update(t, 0)
    }
    for (const [b, l] of labels) {
      if (b !== a && l.on) {
        setOn(b, l, false)
        b.labelA = 0
      }
    }
    setOn(a, lab, true)
    a.labelA = Math.max(a.labelA, 0.05)
    placed.length = 0
    const [x, y] = placeLabel(a, lab)
    moveLabel(lab, x, y)
  }
  for (const [a, lab] of labels) {
    lab.btn.addEventListener('focus', () => {
      focusA = a
      focusSince = performance.now()
      showNow(a)
      if (reduced) return still()
      // after the browser's own scroll-into-view (which follows the focus
      // event), so Lenis starts from where the page really is
      cancelAnimationFrame(focusRaf)
      focusRaf = requestAnimationFrame(() => {
        if (focusA === a) bringIntoView(a)
      })
    })
    lab.btn.addEventListener('blur', () => {
      if (focusA === a) focusA = null
      cancelAnimationFrame(focusRaf)
      // Tab pressed mid-glide: stop, so the browser can bring the next
      // stop into view without being dragged back here
      if (glideA === a) stopGlide()
    })
    lab.btn.addEventListener('click', () => {
      focusA = a
      showNow(a)
      if (glideA !== a) bringIntoView(a)
      if (!a.found && !reduced) setFound(a, 'visitor')
      if (reduced) still()
    })
  }

  /* ---------------------------------------------------------- resize */
  // The first measure comes with the observer's first callback, after the
  // browser's own layout: init never forces one while the intro plays.
  if (reduced) {
    lamp.want = true
    lamp.pow = lamp.on = 1
  } else setNote()
  let laidOut = false
  const ro = new ResizeObserver(() => {
    measure()
    if (reduced) still()
    else if (!laidOut) {
      // place every animal before the first frame so nothing pops
      updateScroll()
      for (const a of animals) {
        a.shift(shift)
        a.update(t, 0)
      }
    }
    laidOut = true
  })
  ro.observe(stage)
  document.fonts?.ready?.then(() => {
    measure()
    if (reduced) still()
  })
  // other sections (pins above this one) can move it: keep the cached
  // offsets true
  ctx.ScrollTrigger?.addEventListener?.('refresh', measureGeo)
  const mainEl = section.closest('main')
  if (mainEl) new ResizeObserver(() => measureGeo()).observe(mainEl)
  window.addEventListener('resize', () => (vh = window.innerHeight), { passive: true })

  // handy for QA in the console
  section.__creatures = {
    animals: byId,
    lamp,
    finale,
    found: () => foundCount,
    cost: () => cost,
    findAll: () => LOG_ORDER.forEach((id) => setFound(byId[id], 'visitor')),
  }
}
