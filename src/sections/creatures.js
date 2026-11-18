/**
 * creatures.js — #life (4,000 → 6,000 m). Lights off.
 *
 * A sticky, near-black stage. In the dark you only see what glows: the
 * Atolla's ring, an anglerfish lure, the vampire squid's arm tips, a
 * dragonfish's red searchlight, a siphonophore's string of lights. The
 * pointer is the submersible's lamp: a warm cone of light with backscatter
 * in the water, and only inside it do the animals' bodies appear.
 *
 * Rendering (one 2D canvas, DPR capped):
 *   1. beam + haze           — additive, warm white, from below the frame
 *   2. bodies                — drawn into a small offscreen canvas centred on
 *                              the lamp, tinted warm, masked by the lamp's
 *                              falloff, then composited (so cost scales with
 *                              the lamp, not the stage)
 *   3. self-light            — the anglerfish's lure lights her own teeth;
 *                              the dragonfish's red lamp tints its jaw
 *   4. marine snow           — particles lit only inside the beam
 *   5. glow                  — photophores, always visible, additive sprites
 *   6. reticle + leaders     — hairlines to the specimen labels
 *
 * The first time the lamp rests on an animal it reacts (the Atolla spins its
 * alarm, the squid sheds glowing mucus and backs away, a wave of light runs
 * down the siphonophore), its specimen label appears and the log counts it.
 *
 * Input: pointer (lagging lamp; data-cursor="lamp" on the stage), touch
 * (tap or sideways drag), keyboard (each animal is a real <button>: focus
 * glides the lamp to it), idle (the lamp searches, visiting animals not yet
 * found). Emits ctx.emit('lamp', { on }) as the stage becomes active, and a
 * soft ctx.emit('sonar', …) ping on each discovery.
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
  lamp: [255, 240, 220],
}

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
/* A soft volumetric cone, baked once: gaussian across, widening along its
   length, brightest where it meets the lit water (u ≈ 0.8). Drawn rotated
   and stretched from below the frame to the lamp every frame. */
function makeBeam() {
  const W = 256
  const H = 128
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')
  const img = g.createImageData(W, H)
  for (let j = 0; j < H; j++) {
    const v = ((j + 0.5) / H) * 2 - 1
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W
      const w = 0.05 + 0.95 * u
      const across = Math.exp(-Math.pow(v / (w * 0.6), 2))
      const along = Math.pow(smooth(0, 0.8, u), 1.4) * (1 - smooth(0.8, 1, u))
      const o = (j * W + i) * 4
      img.data[o] = 255
      img.data[o + 1] = 238
      img.data[o + 2] = 214
      img.data[o + 3] = Math.round(255 * across * along)
    }
  }
  g.putImageData(img, 0, 0)
  return cv
}

function dot(g, spr, x, y, r, a) {
  if (a <= 0.004) return
  g.globalAlpha = a > 1 ? 1 : a
  g.drawImage(spr, x - r, y - r, r * 2, r * 2)
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
    this.color = C.cyan
  }
  layout(cfg, W, H, unit) {
    this.cfg = cfg
    this.z = cfg.z
    this.s = unit * cfg.size
    this.bx = cfg.x * W
    this.baseY = cfg.y * H
    this.side = cfg.side ?? 1
    this.fade = 0.5 + 0.5 * smooth(0.5, 1, cfg.z)
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
  sample(lightAt) {
    return lightAt(this.x, this.y)
  }
  center() {
    return [this.x, this.y]
  }
  react() {}
  update() {}
  drawBody() {}
  drawGlow() {}
}

/* ----------------------------------------------------- Atolla wyvillei */
class Atolla extends Animal {
  constructor() {
    super('atolla')
    this.radius = 78
    this.anchor = [52, -14]
    this.ext = [66, 46]
    this.color = C.blue
    this.alarmT = -1
    this.next = 3.5 + Math.random() * 2
    this.n = 26
    this.tw = Array.from({ length: this.n }, () => Math.random() * TAU)
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
  }
  geo() {
    const p = this.pulse
    return { rx: 60 * (1 + 0.05 * p), ry: 15 * (1 + 0.05 * p), top: -44 * (1 - 0.08 * p), rim: 8 }
  }
  drawBody(g, t, L) {
    const { rx, ry, top, rim } = this.geo()
    const [hx, hy] = this.hl(L, 24)
    this.begin(g)

    // the single long tentacle Atolla trails (hypertrophied)
    const pts = []
    let x = rx * Math.cos(2.25)
    let y = rim + ry * Math.sin(2.25)
    for (let i = 0; i < 52; i++) {
      pts.push(x, y)
      const a = 1.62 + 0.62 * Math.sin(i * 0.08 - t * 0.33 + this.seed) + i * 0.016
      x += Math.cos(a) * 6
      y += Math.sin(a) * 6
    }
    taper(g, pts, 3.4, 0.5, [226, 92, 98], 0.8, 0.06)

    // the fringe of short tentacles
    g.lineCap = 'round'
    for (let k = 0; k < 24; k++) {
      const th = (k / 24) * TAU + 0.13
      const front = Math.sin(th) > 0
      const sx = rx * Math.cos(th)
      const sy = rim + ry * Math.sin(th)
      const len = 18 + 7 * Math.sin(k * 1.7 + 0.4)
      const sw = Math.sin(t * 0.8 + k * 0.9 + this.seed) * 3
      g.strokeStyle = front ? 'rgba(232,112,116,0.55)' : 'rgba(200,80,90,0.28)'
      g.lineWidth = 1.1
      g.beginPath()
      g.moveTo(sx, sy)
      g.quadraticCurveTo(sx + Math.cos(th) * 12, sy + len * 0.45, sx + Math.cos(th) * 8 + sw, sy + len)
      g.stroke()
    }

    // bell
    g.beginPath()
    g.moveTo(-rx, rim)
    g.bezierCurveTo(-rx * 1.05, rim - 34, -rx * 0.56, top, 0, top)
    g.bezierCurveTo(rx * 0.56, top, rx * 1.05, rim - 34, rx, rim)
    const N = 66
    for (let i = 1; i <= N; i++) {
      const th = (i / N) * Math.PI
      const lobe = 3.4 * Math.abs(Math.sin(th * 11))
      g.lineTo(rx * Math.cos(th), rim + (ry + lobe) * Math.sin(th))
    }
    g.closePath()
    const grd = g.createRadialGradient(hx, top * 0.42 + hy, 3, 0, top * 0.2, 84)
    grd.addColorStop(0, 'rgba(226,82,88,0.97)')
    grd.addColorStop(0.32, 'rgba(162,28,44,0.95)')
    grd.addColorStop(0.72, 'rgba(96,8,26,0.93)')
    grd.addColorStop(1, 'rgba(46,2,12,0.9)')
    g.fillStyle = grd
    g.fill()
    g.strokeStyle = 'rgba(255,150,150,0.22)'
    g.lineWidth = 1.4
    g.stroke()

    // the back of the rim, seen through the bell
    g.strokeStyle = 'rgba(255,150,150,0.16)'
    g.lineWidth = 1.2
    g.beginPath()
    g.ellipse(0, rim, rx * 0.98, ry, 0, Math.PI, TAU)
    g.stroke()

    // stomach, deep red-violet, seen through the bell
    g.globalCompositeOperation = 'multiply'
    const sg = g.createRadialGradient(0, top * 0.4, 2, 0, top * 0.4, 30)
    sg.addColorStop(0, 'rgba(70,10,40,0.95)')
    sg.addColorStop(0.7, 'rgba(110,30,60,0.7)')
    sg.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = sg
    g.beginPath()
    g.ellipse(0, top * 0.4, 30, 15, 0, 0, TAU)
    g.fill()
    g.globalCompositeOperation = 'source-over'

    // coronal groove and the radial pedalia of the margin
    g.strokeStyle = 'rgba(36,0,10,0.55)'
    g.lineWidth = 2.4
    g.beginPath()
    g.ellipse(0, rim - 15, rx * 0.86, ry * 0.86, 0, 0.05, Math.PI - 0.05)
    g.stroke()
    g.strokeStyle = 'rgba(255,170,170,0.12)'
    g.lineWidth = 1
    g.beginPath()
    g.ellipse(0, rim - 12.5, rx * 0.87, ry * 0.86, 0, 0.1, Math.PI - 0.1)
    g.stroke()
    g.strokeStyle = 'rgba(40,0,12,0.32)'
    g.lineWidth = 1.1
    for (let k = 0; k < 22; k++) {
      const th = ((k + 0.5) / 22) * TAU
      if (Math.sin(th) < 0.08) continue
      const c = Math.cos(th)
      const s = Math.sin(th)
      g.beginPath()
      g.moveTo(rx * 0.86 * c, rim - 15 + ry * 0.86 * s)
      g.lineTo(rx * 0.99 * c, rim + ry * s)
      g.stroke()
    }

    // lamp highlight: soft sheen + a specular arc on the dome
    g.globalCompositeOperation = 'lighter'
    const hg = g.createRadialGradient(hx * 0.8, top * 0.55 + hy * 0.5, 0, hx * 0.8, top * 0.55 + hy * 0.5, 38)
    hg.addColorStop(0, 'rgba(255,226,214,0.22)')
    hg.addColorStop(1, 'rgba(255,226,214,0)')
    g.fillStyle = hg
    g.fillRect(-rx, top, rx * 2, rim - top + ry)
    g.strokeStyle = 'rgba(255,238,230,0.36)'
    g.lineWidth = 1.5
    g.beginPath()
    g.ellipse(0, rim - 4, rx * 0.9, (rim - top) * 0.94, 0, Math.PI * 1.14, Math.PI * 1.42)
    g.stroke()
    g.globalCompositeOperation = 'source-over'
    g.restore()
  }
  drawGlow(g, t, sp) {
    const { rx, ry, rim } = this.geo()
    const at = this.alarmT
    const e = at < 0 ? 0 : smooth(0, 0.3, at) * (1 - smooth(3.3, 4.8, at))
    const phi = at < 0 ? 0 : at * 3.4 + at * at * 0.5
    this.begin(g)
    if (e > 0.01) {
      g.globalAlpha = 0.24 * e
      g.strokeStyle = 'rgb(58,168,255)'
      g.lineWidth = 6
      g.beginPath()
      g.ellipse(0, rim, rx, ry, 0, 0, TAU)
      g.stroke()
      dot(g, sp.blueSoft, 0, rim - 8, rx * 1.9, 0.5 * e)
    }
    for (let k = 0; k < this.n; k++) {
      const th = (k / this.n) * TAU
      const back = Math.sin(th) < 0 ? 0.55 : 1
      const tw = 0.3 + 0.18 * Math.sin(t * 1.25 + this.tw[k])
      const d1 = angDiff(th, phi)
      const d2 = angDiff(th, phi + Math.PI)
      const wave = Math.exp(-(d1 * d1) / 0.16) + Math.exp(-(d2 * d2) / 0.16)
      const a = (tw + e * wave * 1.2) * back
      dot(g, sp.blue, rx * Math.cos(th), rim + ry * Math.sin(th), 5.4 + 6 * e * wave, a)
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
      arm.wx = ca * arm.L * 0.8 - sa * arm.bend * 0.8
      arm.wy = 16 + sa * arm.L * 0.8 + ca * arm.bend * 0.8
    }
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
  drawBody(g, t, L) {
    const [hx, hy] = this.hl(L, 22)
    this.begin(g)
    const wine = (cx, cy, r) => {
      const grd = g.createRadialGradient(cx + hx, cy + hy, 2, cx, cy, r)
      grd.addColorStop(0, 'rgb(150,48,56)')
      grd.addColorStop(0.4, 'rgb(88,16,28)')
      grd.addColorStop(1, 'rgb(26,3,9)')
      return grd
    }
    // fins, like ears, on the mantle
    for (const sx of [-1, 1]) {
      g.save()
      g.translate(sx * 25, -62)
      g.rotate(sx * (0.55 + 0.32 * this.fin))
      g.fillStyle = 'rgba(122,34,44,0.92)'
      g.beginPath()
      g.ellipse(sx * 12, 0, 17, 8.5, 0, 0, TAU)
      g.fill()
      g.strokeStyle = 'rgba(255,170,160,0.18)'
      g.lineWidth = 1
      g.stroke()
      g.restore()
    }
    // mantle
    g.fillStyle = wine(0, -48, 70)
    g.beginPath()
    g.moveTo(-25, -4)
    g.bezierCurveTo(-32, -46, -15, -92, 0, -94)
    g.bezierCurveTo(15, -92, 32, -46, 25, -4)
    g.closePath()
    g.fill()
    g.strokeStyle = 'rgba(255,206,196,0.2)'
    g.lineWidth = 1.1
    g.stroke()
    // the web of the cloak
    const A = this.arms
    const wg = g.createRadialGradient(hx * 0.6, 20 + hy * 0.6, 4, 0, 16, 96)
    wg.addColorStop(0, 'rgb(18,3,8)')
    wg.addColorStop(0.4, 'rgb(52,8,18)')
    wg.addColorStop(0.78, 'rgb(104,24,36)')
    wg.addColorStop(1, 'rgb(60,8,20)')
    g.fillStyle = wg
    g.beginPath()
    g.moveTo(22, 6)
    g.lineTo(A[0].wx, A[0].wy)
    for (let i = 0; i < 7; i++) {
      const am = (A[i].a + A[i + 1].a) / 2
      const Lm = ((A[i].L + A[i + 1].L) / 2) * (0.6 + 0.08 * this.open)
      g.quadraticCurveTo(Math.cos(am) * Lm, 16 + Math.sin(am) * Lm, A[i + 1].wx, A[i + 1].wy)
    }
    g.lineTo(-22, 6)
    g.closePath()
    g.fill()
    g.strokeStyle = 'rgba(255,160,160,0.16)'
    g.lineWidth = 1
    g.stroke()
    // arms, with their fleshy cirri
    const pts = []
    for (let i = 0; i < 8; i++) {
      const a = A[i]
      pts.length = 0
      const nx = -Math.sin(a.a)
      const ny = Math.cos(a.a)
      for (let k = 0; k <= 10; k++) {
        const u = k / 10
        const bx = lerp(a.bx, a.tx, u) + nx * Math.sin(u * Math.PI) * 4
        const by = lerp(a.by, a.ty, u) + ny * Math.sin(u * Math.PI) * 4
        pts.push(bx, by)
      }
      taper(g, pts, 7, 2.2, [124, 32, 44], 0.96, 0.96, 10)
      g.strokeStyle = 'rgba(232,180,176,0.42)'
      g.lineWidth = 0.9
      for (let k = 3; k <= 8; k++) {
        const px = pts[2 * k]
        const py = pts[2 * k + 1]
        const ix = -px * 0.06
        const iy = -(py - 16) * 0.06
        g.beginPath()
        g.moveTo(px, py)
        g.lineTo(px + ix, py + iy)
        g.stroke()
      }
      g.fillStyle = 'rgba(240,222,212,0.9)'
      g.beginPath()
      g.arc(a.tx, a.ty, 2.3, 0, TAU)
      g.fill()
    }
    // head
    g.fillStyle = wine(0, 2, 34)
    g.beginPath()
    g.ellipse(0, 4, 27, 19, 0, 0, TAU)
    g.fill()
    // eyes: proportionally the largest of any animal
    for (const sx of [-1, 1]) {
      const ex = sx * 16.5
      const ey = 1
      g.fillStyle = 'rgb(16,5,9)'
      g.beginPath()
      g.ellipse(ex, ey, 9.6, 9, 0, 0, TAU)
      g.fill()
      const ig = g.createRadialGradient(ex + hx * 0.08, ey + hy * 0.08, 0.5, ex, ey, 7.4)
      ig.addColorStop(0, 'rgb(104,170,214)')
      ig.addColorStop(0.45, 'rgb(30,78,138)')
      ig.addColorStop(1, 'rgb(8,16,32)')
      g.fillStyle = ig
      g.beginPath()
      g.arc(ex, ey, 7.4, 0, TAU)
      g.fill()
      g.fillStyle = 'rgb(3,6,12)'
      g.beginPath()
      g.ellipse(ex, ey, 4.6, 3.2, 0, 0, TAU)
      g.fill()
      g.fillStyle = 'rgba(255,250,240,0.8)'
      g.beginPath()
      g.arc(ex - 2.8 + hx * 0.06, ey - 3.2 + hy * 0.06, 1.3, 0, TAU)
      g.fill()
    }
    g.fillStyle = 'rgba(240,226,220,0.5)'
    for (const [x, y] of this.specks) {
      g.beginPath()
      g.arc(x, y, 0.9, 0, TAU)
      g.fill()
    }
    // sheen
    g.globalCompositeOperation = 'lighter'
    const sh = g.createRadialGradient(hx, -40 + hy, 0, hx, -40 + hy, 36)
    sh.addColorStop(0, 'rgba(255,214,200,0.16)')
    sh.addColorStop(1, 'rgba(255,214,200,0)')
    g.fillStyle = sh
    g.fillRect(-40, -96, 80, 90)
    g.globalCompositeOperation = 'source-over'
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
    dot(g, sp.cyanSoft, -24, -56, 22, f)
    dot(g, sp.cyanSoft, 24, -56, 22, f)
    dot(g, sp.cyan, -22, -57, 5, f * 0.9)
    dot(g, sp.cyan, 22, -57, 5, f * 0.9)
    g.restore()
  }
}

/* -------------------------------------------- Melanocetus johnsonii */
class Angler extends Animal {
  constructor() {
    super('angler')
    this.radius = 96
    this.anchor = [40, -40]
    this.anchorL = [-40, -42]
    this.ext = [92, 56]
    this.color = C.lure
    this.gapeT = -1
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
    this.esca = [72 + 5 * sw, -68 + 4 * Math.sin(t * 0.9 + k)]
    this.lure =
      0.78 + 0.16 * Math.sin(t * 1.2 + k) + 0.06 * Math.sin(t * 7.3 + k * 3) * Math.sin(t * 0.5)
  }
  sample(lightAt) {
    const [x, y] = this.toScreen(10, 0)
    return lightAt(x, y)
  }
  center() {
    return this.toScreen(10, -4)
  }
  drawBody(g, t, L) {
    const [hx, hy] = this.hl(L, 26)
    const gp = this.gape
    this.begin(g)
    const ft = Math.sin(t * 1.4 + this.seed)

    // caudal fin
    g.fillStyle = 'rgba(42,32,30,0.85)'
    g.beginPath()
    g.moveTo(-62, -8)
    g.quadraticCurveTo(-82, -26 + ft * 3, -98, -22 + ft * 4)
    g.quadraticCurveTo(-92, 0 + ft * 2, -98, 22 + ft * 4)
    g.quadraticCurveTo(-82, 24 + ft * 3, -62, 8)
    g.closePath()
    g.fill()
    g.strokeStyle = 'rgba(150,126,110,0.3)'
    g.lineWidth = 0.8
    for (let r = -3; r <= 3; r++) {
      g.beginPath()
      g.moveTo(-64, r * 2.4)
      g.lineTo(-95, r * 7 + ft * 4)
      g.stroke()
    }
    // dorsal fin
    g.fillStyle = 'rgba(46,36,32,0.85)'
    g.beginPath()
    g.moveTo(-36, -46)
    g.quadraticCurveTo(-50, -56 + ft * 2, -58, -40)
    g.lineTo(-50, -34)
    g.closePath()
    g.fill()

    // body
    g.beginPath()
    g.moveTo(60, -8)
    g.bezierCurveTo(48, -42, 14, -60, -18, -52)
    g.bezierCurveTo(-44, -46, -60, -28, -64, -10)
    g.lineTo(-66, 8)
    g.bezierCurveTo(-58, 32, -24, 52, 14, 50)
    g.bezierCurveTo(44, 48, 66, 32 + 8 * gp, 77, 12 + 15 * gp)
    g.lineTo(71, 10 + 13 * gp)
    g.quadraticCurveTo(44, 12 + 6 * gp, 16, 6)
    g.quadraticCurveTo(40, 0, 60, -8)
    g.closePath()
    const sk = g.createRadialGradient(hx, -8 + hy, 3, 0, -2, 78)
    sk.addColorStop(0, 'rgb(104,86,78)')
    sk.addColorStop(0.32, 'rgb(52,42,40)')
    sk.addColorStop(0.72, 'rgb(22,17,17)')
    sk.addColorStop(1, 'rgb(8,6,6)')
    g.fillStyle = sk
    g.fill()
    g.strokeStyle = 'rgba(255,226,206,0.26)'
    g.lineWidth = 1.3
    g.stroke()

    // the mouth's dark cavity
    g.fillStyle = 'rgb(18,6,8)'
    g.beginPath()
    g.moveTo(16, 6)
    g.quadraticCurveTo(40, 0, 60, -8)
    g.lineTo(64, -2)
    g.lineTo(71, 10 + 13 * gp)
    g.quadraticCurveTo(44, 12 + 6 * gp, 16, 6)
    g.closePath()
    g.fill()

    // needle teeth, glassy
    g.fillStyle = 'rgba(248,242,230,0.96)'
    const tooth = (x, y, dx, dy, w) => {
      g.beginPath()
      g.moveTo(x - w, y)
      g.lineTo(x + dx, y + dy)
      g.lineTo(x + w, y)
      g.closePath()
      g.fill()
    }
    for (let i = 0; i < 8; i++) {
      const u = 0.22 + (i / 7) * 0.76
      const x = lerp(16, 60, u)
      const y = lerp(6, -8, u) + Math.sin(u * Math.PI) * -3
      const len = 4 + 10 * Math.pow(u, 1.4)
      tooth(x, y, -1.5, len, 1.1)
    }
    for (let i = 0; i < 7; i++) {
      const u = 0.25 + (i / 6) * 0.72
      const x = lerp(16, 71, u)
      const y = lerp(6, 10 + 13 * gp, u) + Math.sin(u * Math.PI) * (3 + 3 * gp)
      const len = 4 + 9 * Math.pow(u, 1.3)
      tooth(x, y, -1, -len, 1.1)
    }

    // pectoral fin
    g.save()
    g.translate(-6, 12)
    g.rotate(0.3 + 0.25 * Math.sin(t * 1.9 + this.seed))
    g.fillStyle = 'rgba(70,56,50,0.7)'
    g.beginPath()
    g.moveTo(0, 0)
    g.quadraticCurveTo(-14, -6, -20, 4)
    g.quadraticCurveTo(-12, 12, 0, 6)
    g.closePath()
    g.fill()
    g.restore()

    // eye
    g.fillStyle = 'rgb(8,8,12)'
    g.beginPath()
    g.arc(32, -26, 3.4, 0, TAU)
    g.fill()
    g.fillStyle = 'rgba(190,224,255,0.65)'
    g.beginPath()
    g.arc(31.2, -27, 1, 0, TAU)
    g.fill()

    // lateral line
    g.fillStyle = 'rgba(190,160,140,0.22)'
    for (let i = 0; i < 9; i++) {
      const x = 14 - i * 8.5
      const y = -18 + Math.pow(i / 8, 1.6) * 16
      g.beginPath()
      g.arc(x, y, 0.9, 0, TAU)
      g.fill()
    }

    // illicium (the rod) and esca (the lure)
    const [ex, ey] = this.esca
    g.strokeStyle = 'rgb(70,54,46)'
    g.lineWidth = 2.4
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(24, -50)
    g.quadraticCurveTo(36, -90, ex, ey)
    g.stroke()
    g.fillStyle = 'rgb(214,186,146)'
    g.beginPath()
    g.ellipse(ex, ey, 5.5, 6.5, 0.3, 0, TAU)
    g.fill()

    // sheen
    g.globalCompositeOperation = 'lighter'
    const sh = g.createRadialGradient(hx * 0.9, -14 + hy * 0.9, 0, hx * 0.9, -14 + hy * 0.9, 30)
    sh.addColorStop(0, 'rgba(255,224,200,0.14)')
    sh.addColorStop(1, 'rgba(255,224,200,0)')
    g.fillStyle = sh
    g.fillRect(-70, -60, 150, 115)
    g.globalCompositeOperation = 'source-over'
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
  drawBody(g, t, L) {
    const [hx, hy] = this.hl(L, 30)
    this.begin(g)
    const tl = this.tail
    // caudal fin, forked
    g.fillStyle = 'rgba(40,32,30,0.85)'
    g.beginPath()
    g.moveTo(118, tl - 3.5)
    g.lineTo(146, tl - 17)
    g.quadraticCurveTo(136, tl, 146, tl + 17)
    g.lineTo(118, tl + 3.5)
    g.closePath()
    g.fill()
    // dorsal and anal fins, set far back as in all dragonfishes
    const fin = (i0, i1, P, dir) => {
      g.beginPath()
      g.moveTo(P[i0][0], P[i0][1])
      g.lineTo(P[i0][0] + 10, P[i0][1] + dir * 14)
      g.lineTo(P[i1][0] + 4, P[i1][1] + dir * 6)
      g.lineTo(P[i1][0], P[i1][1])
      g.closePath()
      g.fill()
    }
    g.fillStyle = 'rgba(46,38,34,0.8)'
    fin(23, 26, this.top, -1)
    fin(22, 26, this.bot, 1)
    // body
    // the head has no floor to its mouth: the outline runs from the snout
    // along the upper jaw to the gape corner, then back along the belly
    const belly = this.bot.filter((p) => p[0] > -60).reverse()
    const al = 0.06 + 0.24 * this.open
    const outline = [...this.top, [122, tl], ...belly, [-58, 10], [-70, 6], [-86, 3.5], [-98, 1], [-103, -3]]
    smoothClosed(g, outline)
    const bg = g.createLinearGradient(0, -22, 0, 24)
    bg.addColorStop(0, 'rgb(18,15,15)')
    bg.addColorStop(0.36, 'rgb(76,64,56)')
    bg.addColorStop(0.5, 'rgb(46,38,34)')
    bg.addColorStop(1, 'rgb(10,9,9)')
    g.fillStyle = bg
    g.fill()
    g.strokeStyle = 'rgba(255,230,210,0.24)'
    g.lineWidth = 1.2
    g.stroke()
    // ventral photophores (unlit, seen as pale beads)
    g.fillStyle = 'rgba(210,200,180,0.35)'
    for (let i = 4; i < 25; i++) {
      const [x, y] = this.bot[i]
      g.beginPath()
      g.arc(x, y - 2.6, 1.05, 0, TAU)
      g.fill()
    }
    // the loose jaw: a bony frame with no floor, hinged far back
    const Hx = -62
    const Hy = 9
    const Jx = Hx - Math.cos(al) * 64
    const Jy = Hy + Math.sin(al) * 64
    g.strokeStyle = 'rgb(112,96,86)'
    g.lineWidth = 3.6
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(Hx, Hy)
    g.lineTo(Jx, Jy)
    g.stroke()
    g.strokeStyle = 'rgba(255,236,220,0.3)'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(Hx, Hy - 1.4)
    g.lineTo(Jx, Jy - 1.4)
    g.stroke()
    g.fillStyle = 'rgba(236,228,212,0.9)'
    for (let i = 0; i < 5; i++) {
      const u = 0.45 + i * 0.12
      const x = lerp(Hx, Jx, u)
      const y = lerp(Hy, Jy, u)
      const len = 5 + i * 1.6
      g.beginPath()
      g.moveTo(x - 1, y)
      g.lineTo(x - 2, y - len)
      g.lineTo(x + 1.2, y)
      g.closePath()
      g.fill()
    }
    for (let i = 0; i < 3; i++) {
      const x = -96 + i * 6
      g.beginPath()
      g.moveTo(x - 1, 2)
      g.lineTo(x - 2.4, 2 + 7 + i)
      g.lineTo(x + 1.2, 2)
      g.closePath()
      g.fill()
    }
    // eye
    g.fillStyle = 'rgb(12,12,14)'
    g.beginPath()
    g.arc(-86, -8, 6.4, 0, TAU)
    g.fill()
    g.strokeStyle = 'rgba(196,206,196,0.55)'
    g.lineWidth = 1.1
    g.stroke()
    g.fillStyle = 'rgba(255,255,255,0.75)'
    g.beginPath()
    g.arc(-88, -10, 1.3, 0, TAU)
    g.fill()
    // the red suborbital photophore (brown when not lit), the small postorbital one
    g.fillStyle = 'rgb(104,42,30)'
    g.beginPath()
    g.ellipse(-84, 5, 6.6, 4, -0.25, 0, TAU)
    g.fill()
    g.fillStyle = 'rgb(176,196,186)'
    g.beginPath()
    g.arc(-72, -5, 2.6, 0, TAU)
    g.fill()
    // pectoral fin rays
    g.strokeStyle = 'rgba(160,140,126,0.35)'
    g.lineWidth = 0.7
    for (let r = 0; r < 4; r++) {
      g.beginPath()
      g.moveTo(-58, 14)
      g.lineTo(-40 + r * 3, 22 + r * 2 + Math.sin(t * 1.6 + r) * 1.5)
      g.stroke()
    }
    // sheen
    g.globalCompositeOperation = 'lighter'
    const sh = g.createRadialGradient(hx, hy - 4, 0, hx, hy - 4, 40)
    sh.addColorStop(0, 'rgba(255,226,200,0.14)')
    sh.addColorStop(1, 'rgba(255,226,200,0)')
    g.fillStyle = sh
    g.fillRect(-100, -30, 230, 60)
    g.globalCompositeOperation = 'source-over'
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
    dot(g, sp.cyan, -72, -5, 9, 0.75 + 0.2 * Math.sin(t * 1.7 + this.seed))
    for (let i = 4; i < 25; i += 2) {
      const [x, y] = this.bot[i]
      dot(g, sp.blue, x, y - 2.6, 3.4, 0.22 + 0.14 * Math.sin(t * 1.3 + i))
    }
    g.restore()
  }
}

/* ------------------------------------------ Lampocteis cruentiventer */
class Comb extends Animal {
  constructor() {
    super('comb')
    this.radius = 70
    this.anchor = [30, -36]
    this.ext = [48, 56]
    this.color = [234, 246, 244]
    this.sparkT = 6 + Math.random() * 4
    this.spark = -1
  }
  update(t, dt) {
    const k = this.seed
    this.flap = Math.sin(t * 0.85 + k)
    this.rot = -0.12 + 0.12 * Math.sin(t * 0.11 + k)
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
  hw(y) {
    return y < -10 ? 34 * Math.sqrt(Math.max(0, 1 - ((y + 10) / 47) ** 2)) : 34 + (y + 10) * 0.28
  }
  drawBody(g, t, L) {
    const [hx, hy] = this.hl(L, 20)
    const f = this.flap
    this.begin(g)
    const body = () => {
      g.beginPath()
      g.moveTo(0, -57)
      g.bezierCurveTo(22, -57, 35, -34, 35, -10)
      g.bezierCurveTo(35, 8, 44 + f * 3, 20, 47 + f * 4, 38)
      g.bezierCurveTo(48, 54, 28, 60, 15, 47)
      g.quadraticCurveTo(7, 37, 0, 35)
      g.quadraticCurveTo(-7, 37, -15, 47)
      g.bezierCurveTo(-28, 60, -48, 54, -47 - f * 4, 38)
      g.bezierCurveTo(-44 - f * 3, 20, -35, 8, -35, -10)
      g.bezierCurveTo(-35, -34, -22, -57, 0, -57)
      g.closePath()
    }
    body()
    const grd = g.createRadialGradient(hx, -12 + hy, 2, 0, -4, 70)
    grd.addColorStop(0, 'rgba(196,72,116,0.55)')
    grd.addColorStop(0.5, 'rgba(122,24,70,0.46)')
    grd.addColorStop(1, 'rgba(70,8,44,0.4)')
    g.fillStyle = grd
    g.fill()
    g.strokeStyle = 'rgba(255,196,220,0.34)'
    g.lineWidth = 1.2
    g.stroke()
    // oral lobes' inner folds
    g.strokeStyle = 'rgba(255,170,200,0.16)'
    g.lineWidth = 1
    for (const sx of [-1, 1]) {
      g.beginPath()
      g.moveTo(sx * 10, 30)
      g.bezierCurveTo(sx * 30, 26, sx * (40 + f * 3), 38, sx * 30, 50)
      g.stroke()
    }
    // the bloody belly
    const sg = g.createRadialGradient(-2, -12, 1, 0, -6, 26)
    sg.addColorStop(0, 'rgba(150,10,30,0.95)')
    sg.addColorStop(0.7, 'rgba(96,0,20,0.92)')
    sg.addColorStop(1, 'rgba(60,0,14,0.0)')
    g.fillStyle = sg
    g.beginPath()
    g.ellipse(0, -6, 11, 25, 0, 0, TAU)
    g.fill()
    g.strokeStyle = 'rgba(160,50,70,0.5)'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(0, 18)
    g.lineTo(0, 34)
    g.stroke()
    // eight comb rows: the lamp's light diffracted into travelling rainbows
    const rows = [-0.93, -0.7, -0.42, -0.14, 0.14, 0.42, 0.7, 0.93]
    g.globalCompositeOperation = 'lighter'
    g.lineCap = 'round'
    for (let r = 0; r < rows.length; r++) {
      const u = rows[r]
      const fade = 1 - Math.abs(u) * 0.45
      // the band: a spectrum sliding down the row
      const lg = g.createLinearGradient(0, -50, 0, 26)
      for (let q = 0; q <= 5; q++) {
        const hue = (((r * 52 + q * 70 - t * 160) % 360) + 360) % 360
        lg.addColorStop(q / 5, `hsla(${hue.toFixed(0)},100%,62%,${(0.34 * fade).toFixed(3)})`)
      }
      g.strokeStyle = lg
      g.lineWidth = 3 * fade
      g.beginPath()
      for (let y = -50; y <= 26; y += 3) {
        const x = u * this.hw(y)
        if (y === -50) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
      // the comb plates flash as each metachronal wave passes
      for (let p = 0; p < 22; p++) {
        const y = -49 + p * 3.4
        const x = u * this.hw(y)
        const wave = Math.pow(0.5 + 0.5 * Math.sin(p * 0.7 - t * 5.6 + r * 0.8), 4)
        if (wave < 0.06) continue
        const hue = (((r * 52 + p * 18 - t * 160) % 360) + 360) % 360
        g.strokeStyle = `hsla(${hue.toFixed(0)},100%,${(66 + 20 * wave).toFixed(0)}%,${(wave * fade).toFixed(3)})`
        g.lineWidth = 1.6
        g.beginPath()
        g.moveTo(x - 2.6 * fade, y)
        g.lineTo(x + 2.6 * fade, y + 0.5)
        g.stroke()
      }
    }
    g.globalCompositeOperation = 'source-over'
    g.restore()
  }
  drawGlow(g, t, sp) {
    if (this.spark < 0) return
    const rows = [-0.93, -0.7, -0.42, -0.14, 0.14, 0.42, 0.7, 0.93]
    const u = rows[this.sparkRow]
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
  labelPoint() {
    const [x, y] = this.center()
    return [x, y - 18 * this.s]
  }
  drawBody(g, t, L) {
    const s = this.s
    const R = L.r + 80 * s
    const k = this.seed
    // stem
    g.strokeStyle = 'rgba(226,238,255,0.5)'
    g.lineWidth = Math.max(0.8, 1.1 * s)
    g.beginPath()
    g.moveTo(this.x, this.y)
    for (const p of this.pts) g.lineTo(p.x, p.y)
    g.stroke()
    // cormidia: bract, polyp, fishing tentacle
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i]
      if (Math.abs(p.x - L.x) > R || Math.abs(p.y - L.y) > R + 60 * s) continue
      const ang = Math.atan2(p.ty, p.tx)
      // tentacle with tentilla
      const sw = Math.sin(t * 0.5 + i * 0.9 + k)
      g.strokeStyle = 'rgba(255,196,176,0.3)'
      g.lineWidth = Math.max(0.6, 0.7 * s)
      g.beginPath()
      g.moveTo(p.x, p.y + 4 * s)
      let tx = p.x
      let ty = p.y + 4 * s
      for (let q = 1; q <= 8; q++) {
        const u = q / 8
        tx = p.x + sw * 9 * s * u * u + Math.sin(u * 3 + t * 0.6 + i) * 2 * s
        ty = p.y + 4 * s + u * 64 * s
        g.lineTo(tx, ty)
      }
      g.stroke()
      g.fillStyle = 'rgba(255,168,140,0.5)'
      for (let q = 2; q <= 8; q += 2) {
        const u = q / 8
        const x = p.x + sw * 9 * s * u * u + Math.sin(u * 3 + t * 0.6 + i) * 2 * s
        const y = p.y + 4 * s + u * 64 * s
        g.beginPath()
        g.arc(x + 2 * s, y, 1.3 * s, 0, TAU)
        g.fill()
      }
      // gastrozooid
      g.fillStyle = 'rgba(255,150,96,0.62)'
      g.beginPath()
      g.ellipse(p.x + 1 * s, p.y + 7 * s, 2.6 * s, 6 * s, 0.1 * sw, 0, TAU)
      g.fill()
      // bract
      g.save()
      g.translate(p.x, p.y)
      g.rotate(ang)
      g.fillStyle = 'rgba(190,226,255,0.16)'
      g.strokeStyle = 'rgba(226,244,255,0.5)'
      g.lineWidth = Math.max(0.6, 0.8 * s)
      g.beginPath()
      g.ellipse(0, -3 * s, 10 * s, 5.5 * s, 0, 0, TAU)
      g.fill()
      g.stroke()
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
      const bg = g.createRadialGradient(-4, -3, 1, 0, 0, 22)
      bg.addColorStop(0, 'rgba(220,240,255,0.26)')
      bg.addColorStop(0.7, 'rgba(160,210,255,0.1)')
      bg.addColorStop(1, 'rgba(160,210,255,0.05)')
      g.fillStyle = bg
      g.strokeStyle = 'rgba(232,246,255,0.62)'
      g.lineWidth = 1
      g.beginPath()
      g.ellipse(0, 0, 21, 15, 0, 0, TAU)
      g.fill()
      g.stroke()
      g.strokeStyle = 'rgba(232,246,255,0.26)'
      g.beginPath()
      g.ellipse(3, 0, 12, 8, 0, 0, TAU)
      g.stroke()
      g.beginPath()
      g.moveTo(-18, 0)
      g.lineTo(15, 0)
      g.stroke()
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

  const hint = reduced ? 'Here are six of the animals that make it.' : fine ? null : 'Tap the dark to see who made it.'
  if (hint) section.querySelectorAll('[data-hint]').forEach((el) => (el.textContent = hint))

  const sp = {
    cyan: makeSprite(C.cyan),
    blue: makeSprite(C.blue),
    lure: makeSprite(C.lure),
    red: makeSprite(C.red, 64, 0.7),
    lamp: makeSprite(C.lamp, 32),
    cyanSoft: makeSoft(C.cyan),
    blueSoft: makeSoft(C.blue),
    lureSoft: makeSoft(C.lure, 128),
    redSoft: makeSoft(C.red),
  }
  const beamTex = makeBeam()

  const animals = [new Siphonophore(), new Atolla(), new Comb(), new Angler(), new Dragon(), new Squid()]
  const byId = Object.fromEntries(animals.map((a) => [a.id, a]))
  const labels = new Map()
  section.querySelectorAll('.creatures__specimen').forEach((li) => {
    const a = byId[li.dataset.animal]
    if (a) labels.set(a, { el: li, btn: li.querySelector('button'), w: 200, h: 80, x: -1e4, y: -1e4, on: false, found: false })
  })
  const pips = new Map([...section.querySelectorAll('[data-pip]')].map((el) => [el.dataset.pip, el]))
  const foundEl = section.querySelector('[data-found]')
  const noteEl = section.querySelector('[data-note]')
  const countEl = section.querySelector('.creatures__count')
  const litEls = [...section.querySelectorAll('.creatures__lit')]
  const intro = section.querySelector('.creatures__intro')

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
  let logRect = null
  let introRect = null

  const lamp = { x: 0, y: 0, r: 220, on: 0, onT: -1, want: false, mode: 'idle' }
  const pointer = { cx: 0, cy: 0, t: -1e9, inside: false }
  const touch = { x: 0, y: 0, t: -1e9 }
  const idle = { target: null, last: null, hold: 0, px: 0, py: 0 }
  let focusA = null

  const lightAt = (x, y) => {
    const d = Math.hypot(x - lamp.x, y - lamp.y) / lamp.r
    return lamp.on * (1 - smooth(0.18, 1, d))
  }

  // offscreen buffers: lamp-sized body layer, small self-light layer
  const bodyC = document.createElement('canvas')
  const bg = bodyC.getContext('2d')
  const selfC = document.createElement('canvas')
  const sg = selfC.getContext('2d')
  let maskGrad = null
  let maskSide = 0

  // marine snow, lit only inside the beam
  const SN = 150
  const snow = new Float32Array(SN * 4)
  // plankton flashes, ambient living light
  const flashes = Array.from({ length: 14 }, () => ({ x: 0, y: 0, age: 1, life: 1, r: 3, c: 0 }))
  let flashNext = 0.5

  function seedSnow() {
    for (let i = 0; i < SN; i++) {
      snow[i * 4] = Math.random() * W
      snow[i * 4 + 1] = Math.random() * H
      snow[i * 4 + 2] = 0.25 + Math.random() * 0.75
      snow[i * 4 + 3] = Math.random() * TAU
    }
  }

  /* ----------------------------------------------------------- layout */
  function measure() {
    const r = stage.getBoundingClientRect()
    // the canvas is the scene: the whole stage, or a still frame (static)
    W = Math.max(1, Math.round(canvas.clientWidth))
    H = Math.max(1, Math.round(canvas.clientHeight))
    mobile = W < 768
    L = mobile ? LAYOUTS.mobile : LAYOUTS.desktop
    dpr = Math.min(ctx.dpr || 1, mobile ? 1.5 : 1.5)
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
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
      const nm = lab.el.querySelector('.creatures__common')
      lab.nw = nm ? nm.offsetWidth : lab.w
      lab.nh = nm ? nm.offsetHeight : 22
      lab.x = lab.y = -1e4
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
    const lg = section.querySelector('.creatures__log')?.getBoundingClientRect()
    logRect = lg ? { x: lg.left - r.left - pad, y: lg.top - r.top - pad, w: lg.width + pad * 2, h: lg.height + pad * 2 } : null
    if (logRect) obstacles.push(logRect)
    const hud = document.querySelector('.hud__readout')?.getBoundingClientRect()
    if (hud && hud.width) obstacles.push({ x: hud.left - pad, y: hud.top - pad, w: hud.width + pad * 2, h: hud.height + pad * 2 })
    seedSnow()
    maskGrad = null
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
      for (let i = 0; i <= 10; i++) {
        const d = i / 10
        maskGrad.addColorStop(d, `rgba(0,0,0,${(1 - smooth(0.18, 1, d)).toFixed(3)})`)
      }
    }
    return side
  }

  function beamOrigin() {
    return [W * 0.5 + (lamp.x - W * 0.5) * 0.2, H * 1.18]
  }
  function drawBeam() {
    const on = lamp.on
    const [ox, oy] = beamOrigin()
    const dx = lamp.x - ox
    const dy = lamp.y - oy
    const d = Math.hypot(dx, dy) || 1
    g.globalCompositeOperation = 'lighter'
    // the cone through the water, seen from the side
    g.save()
    g.translate(ox, oy)
    g.rotate(Math.atan2(dy, dx))
    const half = lamp.r * 1.55
    g.globalAlpha = on * 0.2
    g.drawImage(beamTex, 0, -half, d / 0.8, half * 2)
    g.restore()
    // the pool of lit water around the spot: backscatter
    const R = lamp.r * 1.35
    const hz = g.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, R)
    hz.addColorStop(0, 'rgba(255,236,210,0.16)')
    hz.addColorStop(0.3, 'rgba(255,236,210,0.09)')
    hz.addColorStop(0.6, 'rgba(255,236,210,0.03)')
    hz.addColorStop(1, 'rgba(255,236,210,0)')
    g.fillStyle = hz
    g.globalAlpha = on
    g.fillRect(lamp.x - R, lamp.y - R, R * 2, R * 2)
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
    bg.globalCompositeOperation = 'source-atop'
    bg.fillStyle = 'rgba(255,204,160,0.1)'
    bg.fillRect(0, 0, side, side)
    bg.globalCompositeOperation = 'destination-in'
    bg.fillStyle = maskGrad
    bg.fillRect(0, 0, side, side)
    bg.globalCompositeOperation = 'source-over'
    g.globalAlpha = lamp.on
    g.drawImage(bodyC, lamp.x - R, lamp.y - R, R * 2, R * 2)
    g.globalAlpha = 1
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
    const w = 14 + lamp.r * 0.92 * u
    const off = Math.hypot(x - px, y - py) / w
    return lamp.on * (1 - smooth(0.2, 1, off)) * u * u * 0.6
  }

  function drawSnow(dt, dShift) {
    g.globalCompositeOperation = 'lighter'
    for (let i = 0; i < SN; i++) {
      const o = i * 4
      const z = snow[o + 2]
      // we are sinking, so the snow appears to rise past us
      snow[o + 1] += (-(5 + 12 * z) * dt + dShift * z) * (reduced ? 0 : 1)
      snow[o] += Math.sin(t * 0.3 + snow[o + 3]) * 3 * dt
      if (snow[o + 1] < -10) {
        snow[o + 1] += H + 20
        snow[o] = Math.random() * W
      } else if (snow[o + 1] > H + 10) {
        snow[o + 1] -= H + 20
        snow[o] = Math.random() * W
      }
      const x = snow[o]
      const y = snow[o + 1]
      if (lamp.on < 0.01) continue
      const l = lightAt(x, y) + beamLight(x, y)
      if (l < 0.02) continue
      dot(g, sp.lamp, x, y, 1.6 + 3.2 * z, l * (0.18 + 0.62 * z))
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

  function drawOverlays() {
    g.globalCompositeOperation = 'source-over'
    g.lineCap = 'butt'
    for (const a of animals) {
      // acquisition reticle when an animal is found
      // found: a thin ring of the animal's own light closes in and fades
      if (a.reticle >= 0 && a.reticle < 1.4) {
        const u = a.reticle / 1.4
        const e = 1 - Math.pow(1 - Math.min(1, u * 1.4), 3)
        const [cx, cy] = a.center()
        const base = Math.max(30, Math.min(a.ext[0], a.ext[1]) * 1.15 * a.s)
        const r = base * (1.6 - 0.45 * e)
        g.globalAlpha = Math.sin(Math.min(1, u * 1.2) * Math.PI) * 0.4
        g.strokeStyle = rgba(a.color, 1)
        g.lineWidth = 0.8
        g.beginPath()
        g.arc(cx, cy, r, 0, TAU)
        g.stroke()
      }
      // leader line to the specimen label
      const lab = labels.get(a)
      if (!lab || a.labelA < 0.02 || lab.sx === undefined) continue
      const ax = lab.sx
      const ay = lab.sy
      const cw = lab.cw || lab.w
      let lx = lab.x - 8
      let ly = lab.y + 11
      let kx = lx - 14
      if (lab.mode === 'l') {
        lx = lab.x + cw + 8
        kx = lx + 14
      } else if (lab.mode === 'db' || lab.mode === 'dt') {
        lx = kx = clamp(ax, lab.x + 10, lab.x + Math.min(cw, 240) - 10)
        ly = lab.mode === 'db' ? lab.y - 10 : lab.y + lab.h + 8
      }
      g.globalAlpha = a.labelA * 0.42
      g.strokeStyle = 'rgba(234,246,244,0.9)'
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(ax, ay)
      g.lineTo(kx, ly)
      g.lineTo(lx, ly)
      g.stroke()
      g.globalAlpha = a.labelA
      g.fillStyle = rgba(a.color, 1)
      g.beginPath()
      g.arc(ax, ay, 2, 0, TAU)
      g.fill()
    }
    g.globalAlpha = 1
  }

  function render(dt) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.globalCompositeOperation = 'source-over'
    g.globalAlpha = 1
    g.clearRect(0, 0, W, H)
    const dShift = shift - lastShift
    if (lamp.on > 0.01) {
      drawBeam()
      drawBodies()
    }
    // living light the animals cast on themselves
    const an = byId.angler
    const [ex, ey] = an.luresAt()
    selfLight(an, ex, ey, 118 * an.s, 'rgba(255,168,76,0.62)', 0.72 * an.lure * (1 - 0.6 * lightAt(ex, ey)))
    const dr = byId.dragon
    const [rx, ry] = dr.redAt()
    selfLight(dr, rx, ry, 46 * dr.s, 'rgba(255,40,30,0.6)', 0.42 * dr.red)

    drawSnow(dt, dShift)
    g.globalCompositeOperation = 'lighter'
    for (const a of animals) a.drawGlow(g, t, sp)
    g.globalAlpha = 1
    drawFlashes(dt)
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
      lamp.on = reduced ? 1 : flicker(lamp.onT)
    } else {
      lamp.onT = -1
      lamp.on = Math.max(0, lamp.on - dt * 2.5)
    }
    if (reduced) return

    const rect = stage.getBoundingClientRect()
    let tx
    let ty
    let k
    if (focusA) {
      ;[tx, ty] = focusA.center()
      k = 0.07
      lamp.mode = 'focus'
    } else if (fine && pointer.inside && now - pointer.t < 9000) {
      tx = pointer.cx - rect.left
      ty = pointer.cy - rect.top
      k = 0.13
      lamp.mode = 'pointer'
    } else if (now - touch.t < 7000) {
      tx = touch.x
      ty = touch.y
      k = 0.09
      lamp.mode = 'touch'
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
    start: 'Vesper passes all six on the way down, between 200 and 4,000 m.',
    one: 'One more. Look for color, not light.',
    all: 'All six found. In one survey off California, about three quarters of the animals seen in open water could make light.',
    still:
      'Vesper passes all six on the way down, between 200 and 4,000\u00a0m. In one survey off California, about three quarters of the animals seen in open water could make light.',
  }
  function setFound(a, quiet = false) {
    if (a.found) return
    a.found = true
    a.reticle = quiet ? -1 : 0
    foundCount++
    const lab = labels.get(a)
    if (lab) lab.el.classList.add('is-found')
    pips.get(a.id)?.classList.add('is-found')
    if (foundEl) foundEl.textContent = String(foundCount)
    if (countEl) countEl.dataset.count = String(foundCount)
    if (noteEl) noteEl.textContent = foundCount === 6 ? NOTES.all : foundCount === 5 ? NOTES.one : NOTES.start
    section.dataset.found = String(foundCount)
    if (!quiet) {
      a.react()
      const r = stage.getBoundingClientRect()
      const [cx, cy] = a.center()
      ctx.emit('sonar', { x: r.left + cx, y: r.top + cy, strength: 0.28 })
    }
  }

  function updateAnimals(dt, now) {
    for (const a of animals) {
      a.shift(shift)
      a.update(t, dt)
      if (a.reticle >= 0) a.reticle += dt
      a.light = a.sample(lightAt)
      if (a.light > 0.5) {
        a.litFor += dt
        if (a.litFor > 0.35 && !a.found) setFound(a)
      } else a.litFor = Math.max(0, a.litFor - dt * 2)
      if (a.light > 0.3) a.lastLit = now
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
    const gap = mobile ? 14 : 24
    const w = lab.on ? lab.w : lab.nw
    const h = lab.on ? lab.h : lab.nh
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
    return [x, y]
  }

  const placed = []
  function updateLabels(dt, now) {
    // reduced motion: the six are a list under the still scene
    if (reduced) {
      for (const lab of labels.values()) lab.el.classList.add('is-found', 'is-on')
      return
    }
    // one full label at a time: the most lit (or focused) found animal
    let best = null
    let bestL = 0.3
    for (const a of animals) {
      if (!a.found && a !== focusA) continue
      const [, cy] = a.center()
      if (a !== focusA && (cy < 0 || cy > H)) continue
      const l = a === focusA ? 2 : a.light + (now - a.lastLit < 1800 ? 0.2 : 0)
      if (l > bestL) {
        bestL = l
        best = a
      }
    }
    placed.length = 0
    const order = best ? [best, ...animals.filter((a) => a !== best)] : animals
    for (const a of order) {
      const lab = labels.get(a)
      if (!lab) continue
      const on = reduced || a === best
      if (on !== lab.on) {
        lab.on = on
        lab.el.classList.toggle('is-on', on)
        if (on && a.id === 'siphonophore') a.anchorIdx = a.litIdx
      }
      const target = on ? 1 : a.found && !mobile ? 0.32 : 0
      a.labelA += (target - a.labelA) * ease(0.08, dt)
      if (a.labelA < 0.01 && !on) continue
      const [tx, ty] = placeLabel(a, lab)
      const far = lab.x < -1e3 || Math.abs(tx - lab.x) > W * 0.5
      const e = far || reduced ? 1 : ease(0.14, dt)
      const x = lab.x + (tx - lab.x) * e
      const y = lab.y + (ty - lab.y) * e
      placed.push({ x: tx - 6, y: ty - 4, w: (lab.cw || lab.w) + 12, h: (lab.on ? lab.h : lab.nh) + 8 })
      if (Math.abs(x - lab.x) > 0.2 || Math.abs(y - lab.y) > 0.2 || far) {
        lab.x = x
        lab.y = y
        lab.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      }
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
      const r = stage.getBoundingClientRect()
      if (fine && pointer.inside) {
        lamp.x = pointer.cx - r.left
        lamp.y = pointer.cy - r.top
      } else {
        ;[lamp.x, lamp.y] = byId.squid.center()
        lamp.x -= lamp.r * 0.25
      }
    }
    ctx.emit('lamp', { on: v })
  }
  function updateScroll() {
    const r = section.getBoundingClientRect()
    const vh = window.innerHeight
    // read live geometry every frame: robust to other sections changing
    // the page height after their own triggers were measured
    progress = clamp(-r.top / Math.max(1, r.height - vh))
    setActive(r.top < vh * 0.45 && r.bottom > vh * 0.55)
    // darkness: the stage is the water with its lights switched off
    const enter = clamp((vh - r.top) / (vh * 0.85))
    const exit = clamp(r.bottom / (vh * 0.85))
    const dark = smooth(0, 1, enter) * smooth(0, 1, exit)
    const edge = Math.max(0, r.top) * 1.25
    const edgeB = Math.max(0, vh - r.bottom) * 1.25
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
  }

  /* ------------------------------------------------------------- loop */
  let lastNow = performance.now()
  let cost = 0
  function tick() {
    const now = performance.now()
    const dt = Math.min(0.05, (now - lastNow) / 1000)
    lastNow = now
    t += dt
    updateScroll()
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
    lamp.on = 1
    if (focusA) [lamp.x, lamp.y] = focusA.center()
    for (const a of animals) {
      a.shift(0)
      a.update(t, 0)
      a.light = a.sample(lightAt)
      if (!a.found) setFound(a, true)
    }
    if (noteEl) noteEl.textContent = NOTES.still
    updateLabels(1, now)
    updateText()
    render(0)
  }

  /* ---------------------------------------------------- visibility */
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
  stage.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
        pointer.cx = e.clientX
        pointer.cy = e.clientY
        pointer.t = performance.now()
        pointer.inside = true
      } else if (e.pointerType === 'touch') {
        const r = stage.getBoundingClientRect()
        touch.x = e.clientX - r.left
        touch.y = e.clientY - r.top
        touch.t = performance.now()
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
      const r = stage.getBoundingClientRect()
      if (e.pointerType === 'touch' || !fine) {
        touch.x = e.clientX - r.left
        touch.y = e.clientY - r.top
        touch.t = performance.now()
      }
      if (reduced) {
        lamp.x = e.clientX - r.left
        lamp.y = e.clientY - r.top
        focusA = null
        still()
      }
    },
    { passive: true },
  )

  // Keyboard: every animal is a real button. Focus glides the lamp to it.
  function bringIntoView(a) {
    if (reduced) return
    const r = section.getBoundingClientRect()
    const vh = window.innerHeight
    const [, y] = a.center()
    const pinned = r.top <= 1 && r.bottom >= vh - 1
    if (pinned && y > H * 0.16 && y < H * 0.84) return
    // the progress at which this animal sits at about half height
    const p = clamp(0.5 - (H * 0.5 - a.baseY) / (L.travel * H * a.z), 0.02, 0.98)
    const top = r.top + window.scrollY
    ctx.scrollTo(top + p * Math.max(0, r.height - vh), { duration: 1.4 })
  }
  for (const [a, lab] of labels) {
    lab.btn.addEventListener('focus', () => {
      focusA = a
      bringIntoView(a)
      if (reduced) still()
    })
    lab.btn.addEventListener('blur', () => {
      if (focusA === a) focusA = null
    })
    lab.btn.addEventListener('click', () => {
      focusA = a
      bringIntoView(a)
      if (reduced) still()
    })
  }

  /* ---------------------------------------------------------- resize */
  measure()
  if (reduced) {
    lamp.want = true
    lamp.on = 1
    still()
  } else {
    // place every animal before the first frame so nothing pops
    updateScroll()
    for (const a of animals) {
      a.shift(shift)
      a.update(t, 0)
    }
  }
  const ro = new ResizeObserver(() => {
    measure()
    if (reduced) still()
  })
  ro.observe(stage)
  document.fonts?.ready?.then(() => {
    measure()
    if (reduced) still()
  })

  // handy for QA in the console
  section.__creatures = { animals: byId, lamp, found: () => foundCount, cost: () => cost }
}
