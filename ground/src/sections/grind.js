/**
 * grind.js — the grinding lab (#grind).
 *
 * A top-down ground-glass slab holding a heap of crushed lapis lazuli:
 * lazurite (blue), calcite (white) and pyrite (gold). The visitor drags a
 * glass muller over it; every pass breaks the grains down. Thousands of
 * grains are simulated in canvas 2D: they shrink with work, get dragged and
 * ploughed by the muller, and leave a paste ring along its path.
 *
 * Colour physics: coarse ultramarine is the deepest, most saturated blue;
 * ground finer it scatters more light and turns paler and greyer. Readouts
 * (particle size, colour ruler, two drawdowns) follow the geometric mean
 * size of the lazurite grains. Reaching the sweet spot drops ultramarine
 * into the dish.
 *
 * Bus: emits `drop` (via ctx.palette.drop) once per heap at the sweet spot,
 * and `stir` while the muller moves. Listens to nothing.
 */
import '../styles/grind.css'

/* ================================================================ maths */
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v)
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (t) => t * t * (3 - 2 * t)
const ramp = (x, a, b) => smooth(clamp((x - a) / (b - a)))
const TAU = Math.PI * 2

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function gauss(r) {
  let u = 0
  while (!u) u = r()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r())
}

/* =============================================================== colour */
const PAPER = '#f3f2ee'
const INK = '#151413'
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function hexToLab(h) {
  const n = parseInt(h.slice(1), 16)
  const r = toLin((n >> 16) / 255)
  const g = toLin(((n >> 8) & 255) / 255)
  const b = toLin((n & 255) / 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
function labToHex(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return '#' + rgb.map((c) => Math.round(clamp(toSrgb(clamp(c)), 0, 1) * 255).toString(16).padStart(2, '0')).join('')
}
const lch = (h) => {
  const [L, a, b] = hexToLab(h)
  return [L, Math.hypot(a, b), Math.atan2(b, a)]
}
const lchHex = (L, C, H) => labToHex(L, C * Math.cos(H), C * Math.sin(H))
const mixLab = (x, y, t) => {
  const A = hexToLab(x)
  const B = hexToLab(y)
  return labToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t))
}
const rgba = (h, a) => {
  const n = parseInt(h.slice(1), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}

/* ========================================================= the size model */
const D_START = 120 // µm, geometric mean of the crushed heap
const D_END = 5 // the finest the readout goes
const SWEET_HI = 34 // µm: smooth enough to brush out, still deep
const SWEET_LO = 18 // µm: finer than this and the blue pales
const S_FLOOR = 3.6 // per-grain floor (µm)
const LOG_SPAN = Math.log(D_START / D_END)
const scalePos = (d) => clamp(Math.log(D_START / d) / LOG_SPAN)
const HARD = [1, 1.55, 0.62] // lazurite (Mohs 5–5.5), calcite (3, softer), pyrite (6–6.5, harder)
const K_GRIND = 0.5 // grinding rate per slab-width of muller travel
const STEPS = [120, 80, 52, 34, 26, 18, 12, 8, 5] // reduced-motion steps

function stageOf(d) {
  if (d > 60) return 'coarse'
  if (d > SWEET_HI) return 'near'
  if (d >= SWEET_LO) return 'sweet'
  if (d > 6) return 'pale'
  return 'finest'
}
const MINI = { coarse: '', near: '', sweet: 'Stop here', pale: 'Getting pale', finest: 'Too pale' }
const STATUS = {
  coarse: 'Still grit, too coarse to paint. Grind it in circles.',
  near: 'Nearly a powder. Keep going.',
  sweet: 'Stop here: the deepest blue.',
  pale: 'Getting pale. Ground this fine, ultramarine turns paler and greyer.',
  finest: 'As fine as it goes, and as pale. Start again for a deeper blue.',
}

/* ================================================================ canvas */
function makeCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/* ============================================================== the lab */
export function init(ctx) {
  const root = document.getElementById('grind')
  if (!root) return
  const { gsap } = ctx
  const P = ctx.pigments.BY_ID
  const reduced = !!ctx.reducedMotion

  const $ = (s) => root.querySelector(s)
  const slabEl = $('.grind__slab')
  const canvas = $('.grind__canvas')
  const hintSvg = $('.grind__hint')
  const hintArc = $('.grind__hint-arc')
  const hintHead = $('.grind__hint-head')
  const hintLabel = $('.grind__hint-label')
  const numEl = $('[data-grind-num]')
  const miniNum = $('[data-grind-mini]')
  const miniNote = $('.grind__mini-note')
  const miniChip = $('.grind__mini-chip')
  const ruler = $('.grind__ruler')
  const barCanvas = $('.grind__bar')
  const marker = $('.grind__marker')
  const sweetEl = $('.grind__sweet')
  const statusEl = $('#grind-status')
  const holdBtn = $('.grind__hold')
  const stepBtn = $('.grind__step')
  const resetBtn = $('.grind__reset')
  const strokeEls = [...root.querySelectorAll('.grind__stroke')]
  const chipEls = [...root.querySelectorAll('.grind__chip')]
  if (!slabEl || !canvas) return
  const g = canvas.getContext('2d')
  if (!g) return

  if (reduced) {
    root.classList.add('is-reduced')
    holdBtn.hidden = true
    stepBtn.hidden = false
  }

  /* ---------------------------------------------------------- palette */
  const U = P.ultramarine.hex
  const [uL, uC, uH] = lch(U)
  const BT = P['bone-black'].tint
  const YT = P['yellow-ochre'].tint
  const YH = P['yellow-ochre'].hex
  const MT = P.malachite.tint
  const MH = P.malachite.hex
  const LW = P['lead-white'].tint
  const STONE = mixLab(BT, PAPER, 0.3)
  const GLASS = mixLab(PAPER, MT, 0.07)
  const GLASS_EDGE = mixLab(MH, INK, 0.45)
  const SHADOW = mixLab(INK, MH, 0.3)

  // colour of the washed blue and the raw ground stone, per µm
  const washedExact = (d) => {
    const t = Math.pow(ramp(d, 22, 4), 0.9)
    return lchHex(lerp(uL, 0.71, t), lerp(uC, 0.04, t), uH + 0.12 * t)
  }
  const WASHED = []
  const GROUND = []
  const PASTE = []
  for (let d = 0; d <= 140; d++) {
    const w = washedExact(d)
    WASHED[d] = w
    GROUND[d] = mixLab(w, STONE, 0.5)
    PASTE[d] = mixLab(mixLab(GROUND[d], w, 0.12), INK, 0.06) // wet paste reads a little deeper than dry powder
  }
  const at = (lut, d) => lut[clamp(Math.round(d), 0, 140)]
  const washedAt = (d) => at(WASHED, d)
  const groundAt = (d) => at(GROUND, d)
  const pasteAt = (d) => at(PASTE, d)
  const gritOf = (d) => ramp(d, 34, 110) // 0 = smooth paint, 1 = gravel

  // grain colours (sprites + fine powder)
  const yH = lch(YT)[2]
  const LAZ_LEVELS = [0, 0.3, 0.62]
  const FINE_LAZ_D = [40, 27, 19, 13, 8, 5]
  const FINE_LAZ = FINE_LAZ_D.map((d) => mixLab(washedAt(d), PAPER, 0.06))
  const FINE_CAL = mixLab(LW, BT, 0.12)
  const FINE_PYR = mixLab(mixLab(INK, YH, 0.32), PAPER, 0.12) // pyrite powder is near black
  const FINE_ALPHA = [0.95, 0.85, 0.7, 0.55, 0.42, 0.32, 0.5, 0.6]

  /* ---------------------------------------------------------- state */
  const st = {
    built: false,
    cw: 0,
    ch: 0,
    dpr: 1,
    x0: 0,
    y0: 0,
    S: 1, // slab width in css px = 1 unit
    A: 1, // slab height in units
    R: 0.1, // muller radius in units
    scale: 1,
    visible: false,
    poured: false,
    pouring: false,
    pourT: 0,
    pourStart: 0,
    fade: 1,
    interacted: false,
    grabbing: false,
    grabOff: { x: 0, y: 0 },
    hold: false,
    holdUntil: 0,
    keys: new Set(),
    keyHold: false,
    lift: reduced ? 0 : 1,
    mullerAlpha: reduced ? 1 : 0,
    scripted: false,
    M: { x: 0.75, y: 0.5 },
    T: { x: 0.75, y: 0.5 },
    V: { x: 0, y: 0 },
    tilt: { x: 0, y: 0 },
    heap: { x: 0.4, y: 0.5, r: 0.15 },
    orbit: { th: 0, cx: 0.4, cy: 0.5, rho: 0.12, t: 0 },
    d: D_START,
    shown: D_START,
    shownInt: D_START,
    stage: 'coarse',
    sweetDone: false,
    resetting: false,
    frame: 0,
    stirAcc: 0,
    swatchD: -1,
  }

  let N = 0
  let dustBedPending = false
  let px, py, ps, pr, pt, pv, pd, tx, ty, sx, sy, delay
  let chunkList = null
  const bucketPaths = new Array(8)

  /* ---------------------------------------------------------- layers */
  let slabLayer = null
  let paste = null
  let pg = null
  let stampMask = null
  let stamp = null
  let stampD = -1
  let atlas = null
  const CELL = 40
  const SPR_R = 17
  const VARIANTS = 12

  const X = (u) => st.x0 + u * st.S
  const Y = (v) => st.y0 + v * st.S

  /* ---------------------------------------------------------- sprites */
  function buildAtlas() {
    const rows = LAZ_LEVELS.length + 2
    atlas = makeCanvas(CELL * VARIANTS, CELL * rows)
    const a = atlas.getContext('2d')
    const r = rng(7)
    const light = -2.36 // top-left
    LAZ_LEVELS.forEach((t, row) => {
      for (let v = 0; v < VARIANTS; v++) {
        const L = lerp(0.29 + r() * 0.13, 0.64, t)
        const C = lerp(0.1 + r() * 0.05, 0.065, t)
        drawGrain(a, v, row, 0, { L, C, H: uH + (r() - 0.5) * 0.08 }, r, light)
      }
    })
    for (let v = 0; v < VARIANTS; v++) drawGrain(a, v, LAZ_LEVELS.length, 1, { L: 0.9, C: 0.008, H: yH }, r, light)
    for (let v = 0; v < VARIANTS; v++) drawGrain(a, v, LAZ_LEVELS.length + 1, 2, { L: 0.74, C: 0.07, H: yH }, r, light)
  }

  function drawGrain(a, col, row, type, base, r, light) {
    const cx = col * CELL + CELL / 2
    const cy = row * CELL + CELL / 2
    const cubic = type === 2
    const n = cubic ? 4 + (r() < 0.35 ? 1 : 0) : 5 + Math.floor(r() * 4)
    const rot = r() * TAU
    const ex = cubic ? 0.9 + r() * 0.2 : 0.72 + r() * 0.56
    const pts = []
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * TAU + (r() - 0.5) * (cubic ? 0.2 : 0.9) * (TAU / n)
      const rr = SPR_R * (cubic ? 0.9 + r() * 0.1 : 0.6 + r() * 0.4)
      const lx = Math.cos(ang) * rr * ex
      const ly = (Math.sin(ang) * rr) / ex
      pts.push([cx + lx * Math.cos(rot) - ly * Math.sin(rot), cy + lx * Math.sin(rot) + ly * Math.cos(rot)])
    }
    const ax = cx + (r() - 0.5) * SPR_R * 0.55
    const ay = cy + (r() - 0.5) * SPR_R * 0.55
    const shade = (k) => {
      const amp = type === 2 ? 0.24 : type === 1 ? 0.06 : 0.12
      const L = clamp(base.L + k * amp, 0.05, 0.98)
      const C = base.C * (1 - 0.18 * Math.abs(k)) * (type === 2 && k > 0.5 ? 0.6 : 1)
      return lchHex(L, C, base.H)
    }
    const path = () => {
      a.beginPath()
      pts.forEach(([x, y], i) => (i ? a.lineTo(x, y) : a.moveTo(x, y)))
      a.closePath()
    }
    a.save()
    a.globalAlpha = type === 1 ? 0.94 : 1
    path()
    a.fillStyle = shade(0)
    a.fill()
    // facets: a low pyramid, lit from the top left
    for (let k = 0; k < n; k++) {
      const p1 = pts[k]
      const p2 = pts[(k + 1) % n]
      const mx = (p1[0] + p2[0]) / 2 - ax
      const my = (p1[1] + p2[1]) / 2 - ay
      const lit = Math.cos(Math.atan2(my, mx) - light) * 0.95 + (r() - 0.5) * 0.45
      a.beginPath()
      a.moveTo(ax, ay)
      a.lineTo(p1[0], p1[1])
      a.lineTo(p2[0], p2[1])
      a.closePath()
      a.fillStyle = shade(clamp(lit, -1, 1))
      a.fill()
    }
    // inclusions: lapis is mottled with calcite and pyrite
    if (type === 0 && r() < 0.6) {
      a.save()
      path()
      a.clip()
      // a vein of calcite across some grains
      if (r() < 0.35) {
        const va = r() * Math.PI
        a.beginPath()
        a.moveTo(cx - Math.cos(va) * SPR_R, cy - Math.sin(va) * SPR_R)
        a.quadraticCurveTo(cx + (r() - 0.5) * 8, cy + (r() - 0.5) * 8, cx + Math.cos(va) * SPR_R, cy + Math.sin(va) * SPR_R)
        a.lineWidth = 1.5 + r() * 3.5
        a.strokeStyle = rgba(mixLab(LW, BT, 0.15), 0.75)
        a.stroke()
      }
      const specks = 1 + Math.floor(r() * 4)
      for (let k = 0; k < specks; k++) {
        const gold = r() < 0.45
        a.fillStyle = gold ? lchHex(0.8, 0.085, yH) : rgba(LW, 0.8)
        a.beginPath()
        a.arc(cx + (r() - 0.5) * SPR_R * 1.3, cy + (r() - 0.5) * SPR_R * 1.3, 0.7 + r() * (gold ? 1.2 : 2.2), 0, TAU)
        a.fill()
      }
      a.restore()
    }
    // edge and one hard highlight
    path()
    a.lineWidth = 0.9
    a.strokeStyle = rgba(shade(-1), type === 1 ? 0.5 : 0.6)
    a.stroke()
    let best = 0
    let bestLit = -2
    for (let k = 0; k < n; k++) {
      const p1 = pts[k]
      const p2 = pts[(k + 1) % n]
      const lit = Math.cos(Math.atan2((p1[1] + p2[1]) / 2 - cy, (p1[0] + p2[0]) / 2 - cx) - light)
      if (lit > bestLit) {
        bestLit = lit
        best = k
      }
    }
    const h1 = pts[best]
    const h2 = pts[(best + 1) % n]
    a.beginPath()
    a.moveTo(lerp(h1[0], ax, 0.08), lerp(h1[1], ay, 0.08))
    a.lineTo(lerp(h2[0], ax, 0.08), lerp(h2[1], ay, 0.08))
    a.lineWidth = type === 2 ? 1.6 : 1.1
    a.strokeStyle = rgba(LW, type === 2 ? 0.95 : type === 1 ? 0.6 : 0.3)
    a.stroke()
    a.restore()
  }

  /* ---------------------------------------------------------- slab */
  function noiseTile(size, seed) {
    const c = makeCanvas(size, size)
    const x = c.getContext('2d')
    const img = x.createImageData(size, size)
    const r = rng(seed)
    const lw = parseInt(LW.slice(1), 16)
    for (let i = 0; i < size * size; i++) {
      const v = r()
      const o = i * 4
      if (v < 0.42) {
        img.data[o] = 21
        img.data[o + 1] = 20
        img.data[o + 2] = 19
        img.data[o + 3] = Math.floor(r() * 16)
      } else {
        img.data[o] = lw >> 16
        img.data[o + 1] = (lw >> 8) & 255
        img.data[o + 2] = lw & 255
        img.data[o + 3] = Math.floor(r() * r() * 70)
      }
    }
    x.putImageData(img, 0, 0)
    return c
  }

  function buildSlab() {
    const { cw, ch, dpr, x0, y0, S } = st
    const sw = S
    const sh = st.A * S
    slabLayer = makeCanvas(cw * dpr, ch * dpr)
    const s = slabLayer.getContext('2d')
    s.setTransform(dpr, 0, 0, dpr, 0, 0)
    const rad = Math.min(18, S * 0.02)
    const r = rng(11)

    // glass casts a pale, green-tinged shadow, darkest just outside its edges
    s.save()
    const pad = Math.max(8, st.pad || 20)
    s.shadowColor = rgba(SHADOW, 0.12)
    s.shadowBlur = pad * 0.5 * dpr
    s.shadowOffsetX = 10000 * dpr
    s.shadowOffsetY = pad * 0.24 * dpr
    roundRect(s, x0 - 10000, y0, sw, sh, rad)
    s.fillStyle = '#000'
    s.fill()
    s.shadowColor = rgba(SHADOW, 0.2)
    s.shadowBlur = 5 * dpr
    s.shadowOffsetY = 2.5 * dpr
    s.fill()
    s.restore()
    s.save()
    s.globalCompositeOperation = 'destination-out'
    roundRect(s, x0, y0, sw, sh, rad)
    s.fill()
    s.restore()

    // the glass body: translucent, faintly green, frosted on top
    s.save()
    roundRect(s, x0, y0, sw, sh, rad)
    s.clip()
    s.fillStyle = rgba(GLASS, 0.8)
    s.fillRect(x0, y0, sw, sh)
    const tile = noiseTile(Math.round(160 * Math.min(dpr, 2)), 3)
    const pat = s.createPattern(tile, 'repeat')
    if (pat) {
      s.save()
      s.setTransform(1, 0, 0, 1, 0, 0)
      s.fillStyle = pat
      s.fillRect(x0 * dpr, y0 * dpr, sw * dpr, sh * dpr)
      s.restore()
    }
    // years of circular scratches from the muller
    for (let k = 0; k < 120; k++) {
      const cx = x0 + sw * (0.25 + r() * 0.5)
      const cy = y0 + sh * (0.25 + r() * 0.5)
      const rr = S * (0.04 + r() * 0.32)
      const a0 = r() * TAU
      s.beginPath()
      s.arc(cx, cy, rr, a0, a0 + 0.15 + r() * 1.3)
      s.lineWidth = 0.5 + r() * 0.6
      s.strokeStyle = r() < 0.7 ? rgba(LW, 0.12 + r() * 0.22) : rgba(INK, 0.025 + r() * 0.03)
      s.stroke()
    }
    // a broad reflection of the window, across the glass
    s.save()
    s.translate(x0 + sw * 0.62, y0 + sh * 0.3)
    s.rotate(-0.55)
    const band = s.createLinearGradient(0, -sh * 0.25, 0, sh * 0.25)
    band.addColorStop(0, rgba(LW, 0))
    band.addColorStop(0.42, rgba(LW, 0.16))
    band.addColorStop(0.5, rgba(LW, 0.22))
    band.addColorStop(0.62, rgba(LW, 0.06))
    band.addColorStop(1, rgba(LW, 0))
    s.fillStyle = band
    s.fillRect(-sw, -sh * 0.25, sw * 2, sh * 0.5)
    s.restore()
    // the polished edge: green where the glass is thick, a bright line inside
    roundRect(s, x0 + 4, y0 + 4, sw - 8, sh - 8, Math.max(2, rad - 4))
    s.lineWidth = 8
    s.strokeStyle = rgba(MT, 0.2)
    s.stroke()
    s.beginPath()
    s.moveTo(x0 + rad, y0 + sh - 5)
    s.lineTo(x0 + sw - 5, y0 + sh - 5)
    s.lineTo(x0 + sw - 5, y0 + rad)
    s.lineWidth = 8
    s.strokeStyle = rgba(GLASS_EDGE, 0.06)
    s.stroke()
    roundRect(s, x0 + 9, y0 + 9, sw - 18, sh - 18, Math.max(2, rad - 8))
    s.lineWidth = 1
    s.strokeStyle = rgba(LW, 0.75)
    s.stroke()
    s.restore()

    // outer edge: dark below and right, light above and left
    roundRect(s, x0 + 0.5, y0 + 0.5, sw - 1, sh - 1, rad)
    s.lineWidth = 1
    s.strokeStyle = rgba(GLASS_EDGE, 0.42)
    s.stroke()
    s.beginPath()
    s.moveTo(x0 + 1.5, y0 + sh - rad)
    s.lineTo(x0 + 1.5, y0 + rad)
    s.arcTo(x0 + 1.5, y0 + 1.5, x0 + rad, y0 + 1.5, rad - 1)
    s.lineTo(x0 + sw - rad, y0 + 1.5)
    s.lineWidth = 1.2
    s.strokeStyle = rgba(LW, 0.95)
    s.stroke()
  }

  /* ---------------------------------------------------------- paste */
  function buildPaste(keep) {
    const old = keep && paste ? paste : null
    paste = makeCanvas(st.cw * st.dpr, st.ch * st.dpr)
    pg = paste.getContext('2d')
    if (old) pg.drawImage(old, 0, 0, paste.width, paste.height)
  }

  function buildStampMask() {
    const r = st.R * st.S * st.dpr
    const size = Math.ceil(r * 2.1)
    stampMask = makeCanvas(size, size)
    const m = stampMask.getContext('2d')
    const c = size / 2
    // streaks along the direction of travel: the mullering marks
    const rr = rng(5)
    m.fillStyle = 'rgba(0,0,0,0.42)'
    m.fillRect(0, 0, size, size)
    for (let y = 0; y < size; y += 1 + rr() * 2.2) {
      m.fillStyle = `rgba(0,0,0,${0.25 + rr() * 0.75})`
      m.fillRect(0, y, size, 0.6 + rr() * 1.6)
    }
    m.globalCompositeOperation = 'destination-in'
    const grad = m.createRadialGradient(c, c, 0, c, c, r)
    grad.addColorStop(0, 'rgba(0,0,0,0.22)')
    grad.addColorStop(0.5, 'rgba(0,0,0,0.42)')
    grad.addColorStop(0.84, 'rgba(0,0,0,1)')
    grad.addColorStop(0.95, 'rgba(0,0,0,0.55)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    m.fillStyle = grad
    m.fillRect(0, 0, size, size)
    stamp = makeCanvas(size, size)
    stampD = -1
  }

  function tintStamp(d) {
    const k = Math.round(d)
    if (k === stampD || !stamp) return
    stampD = k
    const s = stamp.getContext('2d')
    s.globalCompositeOperation = 'source-over'
    s.clearRect(0, 0, stamp.width, stamp.height)
    s.drawImage(stampMask, 0, 0)
    s.globalCompositeOperation = 'source-in'
    s.fillStyle = pasteAt(d)
    s.fillRect(0, 0, stamp.width, stamp.height)
  }

  function depositPaste(u, v, ang, alpha) {
    if (!pg || alpha <= 0.002) return
    const dpr = st.dpr
    pg.save()
    pg.globalAlpha = Math.min(1, alpha)
    pg.translate(X(u) * dpr, Y(v) * dpr)
    pg.rotate(ang)
    pg.drawImage(stamp, -stamp.width / 2, -stamp.height / 2)
    pg.restore()
  }

  /* ---------------------------------------------------------- grains */
  function makeHeap(seed) {
    const mobile = st.S < 620
    N = mobile ? 2600 : (navigator.hardwareConcurrency || 8) <= 4 ? 3600 : 5200
    px = new Float32Array(N)
    py = new Float32Array(N)
    ps = new Float32Array(N)
    pr = new Float32Array(N)
    chunkList = new Int32Array(N)
    pt = new Uint8Array(N)
    pv = new Uint8Array(N)
    pd = new Float32Array(N)
    tx = new Float32Array(N)
    ty = new Float32Array(N)
    sx = new Float32Array(N)
    sy = new Float32Array(N)
    delay = new Float32Array(N)
    const r = rng(seed)
    const hx = mobile ? 0.42 : 0.4
    const hy = st.A * (mobile ? 0.56 : 0.5)
    const hr = mobile ? 0.18 : 0.14
    st.heap = { x: hx, y: hy, r: hr }
    const ph1 = r() * TAU
    const ph2 = r() * TAU
    // sizes first, sorted so the big chunks are drawn on top
    const sizes = []
    for (let i = 0; i < N; i++) sizes.push(clamp(D_START * Math.exp(0.55 * gauss(r)), 28, 420))
    sizes.sort((a, b) => a - b)
    let lnSum = 0
    let lazN = 0
    for (let i = 0; i < N; i++) {
      const s = sizes[i]
      const k = r()
      const type = k < 0.76 ? 0 : k < 0.94 ? 1 : 2
      const a = r() * TAU
      const lobes = 1 + 0.14 * Math.sin(3 * a + ph1) + 0.08 * Math.sin(5 * a + ph2)
      // poured grains segregate: the big ones roll to the foot of the heap
      const far = r() < 0.02 ? 0.95 + r() * 0.3 : Math.pow(r(), 0.8)
      const rr = hr * lobes * far * (0.9 + 0.16 * clamp(s / 260))
      tx[i] = hx + Math.cos(a) * rr
      ty[i] = hy + Math.sin(a) * rr
      ps[i] = type === 2 ? s * 0.55 : type === 1 ? s * 0.85 : s
      pt[i] = type
      pv[i] = Math.floor(r() * VARIANTS)
      pd[i] = 0.28 + r() * 0.5 + (s < 40 ? 0.15 : 0)
      sx[i] = hx + gauss(r) * 0.012
      sy[i] = hy + gauss(r) * 0.012
      delay[i] = 0.05 + (Math.hypot(tx[i] - hx, ty[i] - hy) / hr) * 0.55 + r() * 0.28
      if (type === 0) {
        lnSum += Math.log(s)
        lazN++
      }
    }
    // normalise so the heap starts at exactly D_START
    const f = D_START / Math.exp(lnSum / Math.max(1, lazN))
    for (let i = 0; i < N; i++) ps[i] *= f
    radiiAll()
    px.set(tx)
    py.set(ty)
    st.d = st.shown = D_START
    st.sweetDone = false
  }

  // a bed of fines under the poured grains, and their dust
  function dustBed() {
    if (!pg) return
    const r = rng(99 + N)
    const { x: hx, y: hy, r: hr } = st.heap
    pg.save()
    pg.setTransform(st.dpr, 0, 0, st.dpr, 0, 0)
    for (let k = 0; k < 320; k++) {
      const a = r() * TAU
      const rr = hr * Math.pow(r(), 0.8) * 0.92
      const x = X(hx + Math.cos(a) * rr)
      const y = Y(hy + Math.sin(a) * rr)
      const rad = (3 + r() * 11) * st.scale
      const col = r() < 0.82 ? groundAt(70) : LW
      const gr = pg.createRadialGradient(x, y, 0, x, y, rad)
      gr.addColorStop(0, rgba(col, 0.2))
      gr.addColorStop(1, rgba(col, 0))
      pg.fillStyle = gr
      pg.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }
    for (let k = 0; k < 2600; k++) {
      const a = r() * TAU
      const rr = hr * Math.pow(r(), 0.6) * 1.08
      const t = r()
      pg.fillStyle = t < 0.74 ? FINE_LAZ[Math.floor(r() * 2)] : t < 0.93 ? FINE_CAL : FINE_PYR
      pg.globalAlpha = 0.45 + r() * 0.55
      const z = (0.6 + r() * 1.1) * st.scale
      pg.fillRect(X(hx + Math.cos(a) * rr), Y(hy + Math.sin(a) * rr), z, z)
    }
    pg.restore()
  }

  // the heap is a mound: lit on its upper left, shaded and casting a shadow lower right
  function drawHeapShade() {
    const h = ramp(st.d, 70, 118) * st.fade * (st.pouring ? clamp((st.pourT - 0.3) / 1.2) : 1)
    if (h < 0.01) return
    const hx = X(st.heap.x)
    const hy = Y(st.heap.y)
    const hr = st.heap.r * st.S
    const sx0 = hx + hr * 0.3
    const sy0 = hy + hr * 0.36
    const sh = g.createRadialGradient(sx0, sy0, 0, sx0, sy0, hr * 1.22)
    sh.addColorStop(0, rgba(SHADOW, 0))
    sh.addColorStop(0.45, rgba(SHADOW, 0.1 * h))
    sh.addColorStop(0.75, rgba(SHADOW, 0.13 * h))
    sh.addColorStop(1, rgba(SHADOW, 0))
    g.fillStyle = sh
    g.fillRect(sx0 - hr * 1.3, sy0 - hr * 1.3, hr * 2.6, hr * 2.6)
    const lx = hx - hr * 0.3
    const ly = hy - hr * 0.34
    const li = g.createRadialGradient(lx, ly, 0, lx, ly, hr * 0.85)
    li.addColorStop(0, rgba(LW, 0.2 * h))
    li.addColorStop(1, rgba(LW, 0))
    g.fillStyle = li
    g.fillRect(lx - hr, ly - hr, hr * 2, hr * 2)
  }

  function measure() {
    let ln = 0
    let n = 0
    for (let i = 0; i < N; i++) {
      if (pt[i] !== 0) continue
      ln += Math.log(ps[i])
      n++
    }
    st.d = n ? Math.exp(ln / n) : D_START
  }

  function heapStats() {
    let cx = 0
    let cy = 0
    let n = 0
    for (let i = 0; i < N; i += 3) {
      cx += px[i]
      cy += py[i]
      n++
    }
    cx /= n
    cy /= n
    let sd = 0
    for (let i = 0; i < N; i += 3) sd += Math.hypot(px[i] - cx, py[i] - cy)
    return { x: cx, y: cy, spread: sd / n }
  }

  const radiusPx = (s) => Math.max(0.42, (0.36 + 0.05 * Math.pow(s, 0.86)) * st.scale)
  function radiiAll() {
    if (!pr) return
    for (let i = 0; i < N; i++) pr[i] = radiusPx(ps[i])
  }

  /* ---------------------------------------------------------- physics */
  function grindSub(x0, y0, x1, y1) {
    const dx = x1 - x0
    const dy = y1 - y0
    const dist = Math.hypot(dx, dy)
    if (dist < 1e-7) return
    const R = st.R
    const Ro2 = (R * 1.12) * (R * 1.12)
    const ux = dx / dist
    const uy = dy / dist
    const k = K_GRIND * dist
    const lo = 0.012
    const hiX = 1 - lo
    const hiY = st.A - lo
    let fine = 0
    for (let i = 0; i < N; i++) {
      const rx = px[i] - x1
      const ry = py[i] - y1
      const d2 = rx * rx + ry * ry
      if (d2 > Ro2) continue
      const d = Math.sqrt(d2) + 1e-6
      const q = d / R
      let x = px[i]
      let y = py[i]
      // the muller is heavy: it rides over grains and crushes them rather
      // than pushing them aside; the paste it carries smears them along
      const w = q < 1 ? 1 - 0.45 * q * q : 0.55 * (1.12 - q) / 0.12
      const s = ps[i]
      const ns = S_FLOOR + (s - S_FLOOR) * Math.exp(-k * w * HARD[pt[i]])
      ps[i] = ns
      pr[i] = radiusPx(ns)
      const drag = pd[i] * (q < 1 ? 1 : w)
      x += dx * drag
      y += dy * drag
      if (q < 1 && ns < 48) fine++
      // a slight pull under the glass at the leading edge
      if (q > 0.8) {
        const dot = (ux * rx + uy * ry) / d
        if (dot > 0) {
          const pull = dist * dot * 0.25
          x -= (rx / d) * pull
          y -= (ry / d) * pull
        }
      }
      x += (Math.random() - 0.5) * dist * 0.3
      y += (Math.random() - 0.5) * dist * 0.3
      px[i] = x < lo ? lo : x > hiX ? hiX : x
      py[i] = y < lo ? lo : y > hiY ? hiY : y
    }
    // the paste ring
    const amount = clamp(fine / (N * 0.03))
    if (amount > 0) depositPaste(x1, y1, Math.atan2(dy, dx), 0.085 * amount * clamp(dist / (R * 0.12)))
  }

  function grind(x0, y0, x1, y1) {
    const dist = Math.hypot(x1 - x0, y1 - y0)
    if (dist < 1e-6) return false
    tintStamp(st.d)
    const steps = Math.max(1, Math.ceil(dist / (st.R * 0.22)))
    for (let k = 1; k <= steps; k++) {
      grindSub(lerp(x0, x1, (k - 1) / steps), lerp(y0, y1, (k - 1) / steps), lerp(x0, x1, k / steps), lerp(y0, y1, k / steps))
    }
    measure()
    return true
  }

  /* ---------------------------------------------------------- muller */
  function clampMuller(p) {
    const m = st.R * 0.9
    p.x = clamp(p.x, m, 1 - m)
    p.y = clamp(p.y, m, st.A - m)
    return p
  }

  function restPos() {
    const mobile = st.S < 620
    return clampMuller({ x: mobile ? 0.78 : 0.76, y: st.A * (mobile ? 0.24 : 0.44) })
  }

  function autoTarget(dt) {
    const o = st.orbit
    o.t += dt
    if (st.frame % 20 === 0) {
      const h = heapStats()
      o.cx = lerp(o.cx, h.x, 0.5)
      o.cy = lerp(o.cy, h.y, 0.5)
      o.rho = lerp(o.rho, clamp(h.spread * 0.85, 0.05, 0.24), 0.4)
    }
    o.th += dt * TAU * 1.05
    const wob = o.rho * 0.35
    st.T.x = o.cx + Math.cos(o.th) * o.rho + Math.cos(o.t * 0.7) * wob
    st.T.y = o.cy + Math.sin(o.th) * o.rho + Math.sin(o.t * 0.9) * wob
    clampMuller(st.T)
  }

  function startOrbit() {
    const h = heapStats()
    const o = st.orbit
    o.cx = h.x
    o.cy = h.y
    o.rho = clamp(h.spread * 0.85, 0.05, 0.24)
    o.th = Math.atan2(st.M.y - h.y, st.M.x - h.x)
    o.t = 0
  }

  /* ---------------------------------------------------------- render */
  function render() {
    if (!st.built) return
    const { dpr } = st
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, canvas.width, canvas.height)
    g.drawImage(slabLayer, 0, 0)
    g.globalAlpha = st.fade
    g.drawImage(paste, 0, 0)
    g.globalAlpha = 1
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (st.poured || st.pouring) {
      drawGrains()
      drawHeapShade()
    }
    drawMuller()
  }

  function drawGrains(fx = 0, fy = 0, fr = 0) {
    const dpr = st.dpr
    const fr2 = fr * fr
    const S = st.S
    const x0 = st.x0
    const y0 = st.y0
    const pouring = st.pouring
    const T = st.pourT
    const fade = st.fade
    const fineR = 1.6 / dpr
    for (let b = 0; b < 8; b++) bucketPaths[b] = new Path2D()
    let nChunks = 0
    // pass 1: powder as tiny squares, batched by colour; chunks are queued
    for (let i = 0; i < N; i++) {
      const r = pr[i]
      if (r >= fineR) {
        chunkList[nChunks++] = i
        continue
      }
      let x = px[i]
      let y = py[i]
      let rr = r
      if (pouring) {
        const e = clamp((T - delay[i]) / 0.6)
        if (e <= 0) continue
        const k = 1 - Math.pow(1 - e, 3)
        x = lerp(sx[i], tx[i], k)
        y = lerp(sy[i], ty[i], k)
        rr = r * (1 + (1 - k) * 1.4)
      }
      if (fr) {
        const ddx = x0 + x * S - fx
        const ddy = y0 + y * S - fy
        if (ddx * ddx + ddy * ddy > fr2) continue
      }
      const s = ps[i]
      const t = pt[i]
      const b = t === 0 ? (s > 32 ? 0 : s > 22 ? 1 : s > 15 ? 2 : s > 10 ? 3 : s > 6.5 ? 4 : 5) : t === 1 ? 6 : 7
      bucketPaths[b].rect(x0 + x * S - rr, y0 + y * S - rr, rr * 2, rr * 2)
    }
    for (let b = 0; b < 8; b++) {
      g.fillStyle = b < 6 ? FINE_LAZ[b] : b === 6 ? FINE_CAL : FINE_PYR
      g.globalAlpha = FINE_ALPHA[b] * fade
      g.fill(bucketPaths[b])
    }
    g.globalAlpha = fade
    // pass 2: chunks, as faceted sprites (index order = small to large)
    const half = CELL / 2 / SPR_R
    for (let n = 0; n < nChunks; n++) {
      const i = chunkList[n]
      const s = ps[i]
      let x = px[i]
      let y = py[i]
      let rr = pr[i]
      if (pouring) {
        const e = clamp((T - delay[i]) / 0.6)
        if (e <= 0) continue
        const k = 1 - Math.pow(1 - e, 3)
        x = lerp(sx[i], tx[i], k)
        y = lerp(sy[i], ty[i], k)
        rr *= 1 + (1 - k) * 1.4
        g.globalAlpha = Math.min(1, e * 3) * fade
      }
      if (fr) {
        const ddx = x0 + x * S - fx
        const ddy = y0 + y * S - fy
        if (ddx * ddx + ddy * ddy > fr2 + rr * rr * 4) continue
      }
      const type = pt[i]
      const row = type === 0 ? (s > 44 ? 0 : s > 24 ? 1 : 2) : LAZ_LEVELS.length + type - 1
      const q = rr * half
      g.drawImage(atlas, pv[i] * CELL, row * CELL, CELL, CELL, x0 + x * S - q, y0 + y * S - q, q * 2, q * 2)
    }
    g.globalAlpha = 1
  }

  function drawScene(cx, cy, rad) {
    const d = st.dpr
    const x0 = Math.max(0, cx - rad)
    const y0 = Math.max(0, cy - rad)
    const x1 = Math.min(st.cw, cx + rad)
    const y1 = Math.min(st.ch, cy + rad)
    if (x1 <= x0 || y1 <= y0) return
    const w = x1 - x0
    const h = y1 - y0
    g.drawImage(slabLayer, x0 * d, y0 * d, w * d, h * d, x0, y0, w, h)
    g.globalAlpha = st.fade
    g.drawImage(paste, x0 * d, y0 * d, w * d, h * d, x0, y0, w, h)
    g.globalAlpha = 1
    if (st.poured || st.pouring) drawGrains(cx, cy, rad)
  }

  function drawMuller() {
    const lift = st.lift
    const r = st.R * st.S * (1 + lift * 0.14)
    const cx = X(st.M.x)
    const cy = Y(st.M.y)
    const al = st.mullerAlpha
    if (al <= 0.001) return
    const tlx = clamp(st.tilt.x, -1, 1) * r * 0.07
    const tly = clamp(st.tilt.y, -1, 1) * r * 0.07

    g.save()
    g.globalAlpha = al
    // contact shadow, green-tinged; widens when the muller is lifted
    const so = r * (0.05 + lift * 0.5)
    const sh = g.createRadialGradient(cx + so * 0.6, cy + so, r * 0.86, cx + so * 0.6, cy + so, r * (1.2 + lift * 0.5))
    sh.addColorStop(0, rgba(SHADOW, 0.22 * (1 - lift * 0.6)))
    sh.addColorStop(0.35, rgba(SHADOW, 0.09 * (1 - lift * 0.6)))
    sh.addColorStop(1, rgba(SHADOW, 0))
    g.fillStyle = sh
    g.beginPath()
    g.arc(cx + so * 0.6, cy + so, r * (1.2 + lift * 0.5), 0, TAU)
    g.fill()
    // caustic: light gathered by the glass, thrown onto the slab
    g.save()
    g.beginPath()
    g.rect(cx - r * 2, cy - r * 2, r * 4, r * 4)
    g.arc(cx, cy, r, 0, TAU, true)
    g.clip('evenodd')
    const ca = g.createRadialGradient(cx + r * 0.28, cy + r * 0.36, r * 0.7, cx + r * 0.28, cy + r * 0.36, r * 1.12)
    ca.addColorStop(0, rgba(LW, 0))
    ca.addColorStop(0.7, rgba(LW, 0.5))
    ca.addColorStop(1, rgba(LW, 0))
    g.fillStyle = ca
    g.beginPath()
    g.arc(cx + r * 0.28, cy + r * 0.36, r * 1.12, 0, TAU)
    g.fill()
    g.restore()

    // the base: everything below, softened by the ground glass and magnified
    g.save()
    g.beginPath()
    g.arc(cx, cy, r, 0, TAU)
    g.clip()
    const mag = 1.1
    const solid = al > 0.98 // while it fades in, the glass alone is enough
    if (solid) {
      g.save()
      g.translate(cx, cy)
      g.scale(mag, mag)
      g.translate(-cx, -cy)
      drawScene(cx, cy, r / mag + 2)
      g.restore()
    }
    // the ground-glass base softens what it presses on
    g.fillStyle = rgba(LW, 0.16)
    g.fillRect(cx - r, cy - r, r * 2, r * 2)
    // glass body: clear at the heart, green and dark where it is thick
    const body = g.createRadialGradient(cx - tlx, cy - tly, 0, cx, cy, r)
    body.addColorStop(0, rgba(LW, 0.14))
    body.addColorStop(0.5, rgba(MT, 0.08))
    body.addColorStop(0.78, rgba(MT, 0.22))
    body.addColorStop(0.92, rgba(GLASS_EDGE, 0.36))
    body.addColorStop(1, rgba(GLASS_EDGE, 0.78))
    g.fillStyle = body
    g.fillRect(cx - r, cy - r, r * 2, r * 2)
    // the flare of the handle: a ring of refraction
    const fx = cx - tlx * 0.5
    const fy = cy - tly * 0.5
    const fl = g.createRadialGradient(fx, fy, r * 0.5, fx, fy, r * 0.72)
    fl.addColorStop(0, rgba(GLASS_EDGE, 0))
    fl.addColorStop(0.45, rgba(GLASS_EDGE, 0.14))
    fl.addColorStop(0.7, rgba(LW, 0.16))
    fl.addColorStop(1, rgba(LW, 0))
    g.fillStyle = fl
    g.beginPath()
    g.arc(fx, fy, r * 0.72, 0, TAU)
    g.fill()
    g.beginPath()
    g.arc(fx, fy, r * 0.655, Math.PI * 0.95, Math.PI * 1.72)
    g.lineWidth = r * 0.03
    g.lineCap = 'round'
    g.strokeStyle = rgba(LW, 0.6)
    g.stroke()
    g.beginPath()
    g.arc(fx, fy, r * 0.62, Math.PI * 0.05, Math.PI * 0.6)
    g.lineWidth = r * 0.04
    g.strokeStyle = rgba(GLASS_EDGE, 0.16)
    g.stroke()
    // the knob, seen end on: a rod lens that flips what is below
    const kx = cx - tlx
    const ky = cy - tly
    const kr = r * 0.36
    g.save()
    g.beginPath()
    g.arc(kx, ky, kr, 0, TAU)
    g.clip()
    if (solid) {
      g.save()
      g.translate(kx, ky)
      g.scale(-1.7, -1.7)
      g.translate(-kx, -ky)
      drawScene(kx, ky, kr / 1.7 + 2)
      g.restore()
    }
    g.fillStyle = rgba(LW, 0.1)
    g.fillRect(kx - kr, ky - kr, kr * 2, kr * 2)
    const kn = g.createRadialGradient(kx - kr * 0.3, ky - kr * 0.3, 0, kx, ky, kr)
    kn.addColorStop(0, rgba(LW, 0.42))
    kn.addColorStop(0.6, rgba(LW, 0.06))
    kn.addColorStop(0.86, rgba(MT, 0.2))
    kn.addColorStop(1, rgba(GLASS_EDGE, 0.55))
    g.fillStyle = kn
    g.fillRect(kx - kr, ky - kr, kr * 2, kr * 2)
    g.restore()
    g.restore()

    // rim
    g.beginPath()
    g.arc(cx, cy, r - 0.5, 0, TAU)
    g.lineWidth = 1
    g.strokeStyle = rgba(GLASS_EDGE, 0.55)
    g.stroke()
    // highlights: window light on the dome, a hard glint, the rim
    const hx = cx - r * 0.38 - tlx * 1.6
    const hy = cy - r * 0.42 - tly * 1.6
    g.save()
    g.translate(hx, hy)
    g.rotate(-0.7)
    g.scale(1, 0.48)
    const hl = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.5)
    hl.addColorStop(0, rgba(LW, 0.62))
    hl.addColorStop(0.55, rgba(LW, 0.22))
    hl.addColorStop(1, rgba(LW, 0))
    g.fillStyle = hl
    g.beginPath()
    g.arc(0, 0, r * 0.5, 0, TAU)
    g.fill()
    g.restore()
    g.beginPath()
    g.ellipse(hx - r * 0.06, hy - r * 0.04, r * 0.085, r * 0.045, -0.7, 0, TAU)
    g.fillStyle = rgba(LW, 0.95)
    g.fill()
    g.beginPath()
    g.arc(cx, cy, r * 0.93, Math.PI * 1.08, Math.PI * 1.58)
    g.lineWidth = r * 0.03
    g.lineCap = 'round'
    g.strokeStyle = rgba(LW, 0.8)
    g.stroke()
    g.beginPath()
    g.arc(cx, cy, r * 0.9, Math.PI * 0.1, Math.PI * 0.42)
    g.lineWidth = r * 0.02
    g.strokeStyle = rgba(LW, 0.35)
    g.stroke()
    g.beginPath()
    g.arc(kx, ky, kr * 0.8, Math.PI * 1.1, Math.PI * 1.5)
    g.lineWidth = r * 0.022
    g.strokeStyle = rgba(LW, 0.85)
    g.stroke()
    g.restore()
  }

  /* ---------------------------------------------------------- drawdowns */
  function strokeShape(w, h, seed, opts = {}) {
    // a palette-knife drawdown: a thick masstone film on the left, drawn
    // thinner to the right so the paper shows through, ending ragged
    const { dpr } = st
    const c = makeCanvas(w * dpr, h * dpr)
    const m = c.getContext('2d')
    m.scale(dpr, dpr)
    const r = rng(seed)
    const xs = 1
    const xe = w * (opts.end ?? 0.985)
    const top = h * 0.1
    const bot = h * 0.9
    const wav = (t, k) => Math.sin(t * (4 + k) + seed * (1.3 + k)) * 0.5 + Math.sin(t * (11 + k) + seed) * 0.22
    const n = 48
    m.beginPath()
    for (let k = 0; k <= n; k++) {
      const t = k / n
      const rag = t > 0.84 ? r() * h * 0.1 * ((t - 0.84) / 0.16) : 0
      m.lineTo(lerp(xs, xe, t), top + wav(t, 0) * h * 0.04 + rag)
    }
    for (let k = 1; k < 7; k++) m.lineTo(xe - r() * w * 0.04, lerp(top, bot, k / 7))
    for (let k = n; k >= 0; k--) {
      const t = k / n
      const rag = t > 0.84 ? r() * h * 0.1 * ((t - 0.84) / 0.16) : 0
      m.lineTo(lerp(xs, xe, t), bot + wav(t, 1) * h * 0.04 - rag)
    }
    m.closePath()
    const film = m.createLinearGradient(xs, 0, xe, 0)
    film.addColorStop(0, 'rgba(0,0,0,1)')
    film.addColorStop(0.38, 'rgba(0,0,0,0.98)')
    film.addColorStop(0.7, 'rgba(0,0,0,0.74)')
    film.addColorStop(1, 'rgba(0,0,0,0.4)')
    m.fillStyle = film
    m.fill()
    // knife streaks: lanes where the film was pulled thin
    m.globalCompositeOperation = 'destination-out'
    for (let k = 0; k < 44; k++) {
      const y = lerp(top, bot, r())
      const x1 = w * (0.12 + r() * 0.62)
      m.globalAlpha = 0.04 + r() * 0.12
      m.fillRect(x1, y, w - x1, 0.6 + r() * 1.5)
    }
    m.globalAlpha = 1
    m.globalCompositeOperation = 'source-over'
    return c
  }

  function paintStroke(target, mask, colour, grit, seed, withStone) {
    const x = target.getContext('2d')
    const W = target.width
    const H = target.height
    const dpr = st.dpr
    x.setTransform(1, 0, 0, 1, 0, 0)
    x.globalCompositeOperation = 'source-over'
    x.globalAlpha = 1
    x.clearRect(0, 0, W, H)
    x.drawImage(mask, 0, 0)
    x.globalCompositeOperation = 'source-in'
    x.fillStyle = colour
    x.fillRect(0, 0, W, H)
    x.globalCompositeOperation = 'source-atop'
    // the ridge where the knife set down
    const ridge = x.createLinearGradient(0, 0, 10 * dpr, 0)
    ridge.addColorStop(0, rgba(INK, 0.22))
    ridge.addColorStop(1, rgba(INK, 0))
    x.fillStyle = ridge
    x.fillRect(0, 0, 10 * dpr, H)
    // the surface of the film: faint lighter and darker drag lines
    const r = rng(seed)
    for (let k = 0; k < 40; k++) {
      const y = r() * H
      const x1 = r() * W * 0.3
      x.fillStyle = r() < 0.55 ? rgba(LW, 0.04 + r() * 0.08) : rgba(INK, 0.03 + r() * 0.06)
      x.fillRect(x1, y, W - x1, (0.5 + r() * 1.2) * dpr)
    }
    // grit: lumps that will not brush out, each dragging a scratch behind it
    if (grit > 0.01) {
      const n = Math.round(grit * (withStone ? 300 : 190))
      for (let k = 0; k < n; k++) {
        const gx = r() * W * 0.9
        const gy = H * (0.14 + r() * 0.72)
        const kind = r()
        const sz = (0.6 + r() * 1.7 * (0.4 + grit)) * dpr
        if (r() < 0.25) {
          x.globalCompositeOperation = 'destination-out'
          x.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.25})`
          x.fillRect(gx, gy - sz * 0.3, (6 + r() * 30) * dpr * grit, Math.max(0.6 * dpr, sz * 0.6))
        }
        x.globalCompositeOperation = 'source-atop'
        if (withStone && kind < 0.3) x.fillStyle = rgba(LW, 0.92)
        else if (withStone && kind < 0.4) x.fillStyle = lchHex(0.78, 0.09, yH)
        else x.fillStyle = kind < 0.75 ? lchHex(0.27, 0.12, uH) : lchHex(0.47, 0.14, uH)
        x.beginPath()
        x.arc(gx, gy, sz, 0, TAU)
        x.fill()
      }
    }
    x.globalCompositeOperation = 'source-over'
  }

  let strokeMasks = []
  let chipMasks = []
  function sizeCanvasToBox(c) {
    const b = c.getBoundingClientRect()
    const w = Math.max(10, Math.round(b.width))
    const h = Math.max(10, Math.round(b.height))
    c.width = Math.round(w * st.dpr)
    c.height = Math.round(h * st.dpr)
    return { w, h }
  }
  function buildStrokes() {
    strokeMasks = strokeEls.map((c, i) => {
      const { w, h } = sizeCanvasToBox(c)
      return strokeShape(w, h, 3 + i * 17)
    })
    chipMasks = chipEls.map((c, i) => {
      const { w, h } = sizeCanvasToBox(c)
      return strokeShape(w, h, 41 + i * 9, { end: 0.86 })
    })
    st.swatchD = -1
    paintSwatches(true)
    const grades = [U, lchHex(0.56, 0.115, uH + 0.04), lchHex(0.72, 0.03, uH + 0.14)]
    chipEls.forEach((c, i) => paintStroke(c, chipMasks[i], grades[i], 0, 90 + i, false))
  }
  function paintSwatches(force) {
    const k = Math.round(st.shown)
    if (!force && k === st.swatchD) return
    st.swatchD = k
    const grit = gritOf(st.shown)
    strokeEls.forEach((c, i) => {
      const stone = c.dataset.stroke === 'ground'
      paintStroke(c, strokeMasks[i], stone ? groundAt(st.shown) : washedAt(st.shown), grit, 20 + i, stone)
    })
  }

  /* ---------------------------------------------------------- ruler */
  let rulerW = 0
  function buildRuler() {
    const b = barCanvas.getBoundingClientRect()
    rulerW = ruler.getBoundingClientRect().width
    const w = Math.max(10, Math.round(b.width))
    const h = Math.max(4, Math.round(b.height))
    barCanvas.width = w * st.dpr
    barCanvas.height = h * st.dpr
    const x = barCanvas.getContext('2d')
    x.scale(st.dpr, st.dpr)
    for (let i = 0; i < w; i++) {
      const p = i / (w - 1)
      const d = D_START * Math.exp(-p * LOG_SPAN)
      x.fillStyle = washedExact(d)
      x.fillRect(i, 0, 1.5, h)
    }
    // grit across the coarse end
    const r = rng(77)
    for (let i = 0; i < w * 1.4; i++) {
      const p = Math.pow(r(), 1.6)
      const d = D_START * Math.exp(-p * LOG_SPAN)
      if (r() > gritOf(d)) continue
      const k = r()
      x.fillStyle = k < 0.3 ? rgba(LW, 0.9) : k < 0.42 ? lchHex(0.78, 0.09, yH) : lchHex(0.28, 0.12, uH)
      x.fillRect(p * w, r() * h, 1 + r() * 1.3, 1 + r() * 1.3)
    }
    sweetEl.style.setProperty('--a', scalePos(SWEET_HI))
    sweetEl.style.setProperty('--b', scalePos(SWEET_LO))
    root.querySelectorAll('.grind__ticks li').forEach((li) => li.style.setProperty('--p', scalePos(+li.dataset.d)))
    placeMarker()
  }
  function placeMarker() {
    if (marker && rulerW) marker.style.transform = `translate3d(${scalePos(st.shown) * rulerW}px,0,0)`
  }

  /* ---------------------------------------------------------- hint */
  function placeHint() {
    if (!hintSvg) return
    hintSvg.setAttribute('viewBox', `0 0 ${st.cw} ${st.ch}`)
    const cx = X(st.heap.x)
    const cy = Y(st.heap.y)
    const rr = st.heap.r * st.S * 1.5
    const gap = TAU * 0.2
    const a0 = -Math.PI / 2 + gap / 2
    const a1 = a0 + TAU - gap
    const p = (a) => `${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`
    hintArc.setAttribute('d', `M ${p(a0)} A ${rr.toFixed(1)} ${rr.toFixed(1)} 0 1 1 ${p(a1)}`)
    const ex = cx + Math.cos(a1) * rr
    const ey = cy + Math.sin(a1) * rr
    const tA = a1 + Math.PI / 2
    const hl = 9
    const l1 = `${(ex - Math.cos(tA - 0.5) * hl).toFixed(1)} ${(ey - Math.sin(tA - 0.5) * hl).toFixed(1)}`
    const l2 = `${(ex - Math.cos(tA + 0.5) * hl).toFixed(1)} ${(ey - Math.sin(tA + 0.5) * hl).toFixed(1)}`
    hintHead.setAttribute('d', `M ${l1} L ${ex.toFixed(1)} ${ey.toFixed(1)} L ${l2}`)
    // the words sit in the opening of the circle, or under it if they do not fit
    const lw = hintLabel.offsetWidth || 200
    const chord = 2 * rr * Math.sin(gap / 2)
    let lx = cx
    let ly = cy - rr
    let place = 'gap'
    if (lw > chord * 1.15 || ly - 24 < st.y0) {
      ly = cy + rr + 14
      place = 'below'
    }
    hintLabel.dataset.place = place
    hintLabel.style.left = `${Math.round(lx - st.x0)}px`
    hintLabel.style.top = `${Math.round(ly - st.y0)}px`
  }
  let hintShown = false
  function showHint() {
    if (st.interacted || hintShown) return
    hintShown = true
    root.classList.add('has-hint')
    if (reduced) return
    gsap.fromTo(hintArc, { drawSVG: '0% 0%', opacity: 1 }, { drawSVG: '0% 100%', duration: 1.5, ease: 'pour' })
    gsap.fromTo(hintHead, { opacity: 0 }, { opacity: 1, duration: 0.4, delay: 1.3 })
    gsap.fromTo(hintLabel, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 1, delay: 0.5, ease: 'power3.out' })
  }
  function hideHint() {
    if (!root.classList.contains('has-hint')) return
    root.classList.remove('has-hint')
    if (!reduced) gsap.to([hintArc, hintHead, hintLabel], { opacity: 0, duration: 0.5, ease: 'power3.out', overwrite: true })
  }

  /* ---------------------------------------------------------- readouts */
  function setStage(stage) {
    if (stage === st.stage) return
    st.stage = stage
    root.dataset.stage = stage
    statusEl.textContent = STATUS[stage]
    if (miniNote) miniNote.textContent = MINI[stage]
    if (stage === 'sweet' && !st.sweetDone) {
      st.sweetDone = true
      dropBlue()
    }
  }
  function updateReadouts(dt) {
    const target = st.d
    st.shown = dt > 0 ? lerp(st.shown, target, 1 - Math.exp(-dt * 7)) : target
    if (Math.abs(st.shown - target) < 0.05) st.shown = target
    const k = Math.max(D_END, Math.round(st.shown))
    if (k !== st.shownInt) {
      st.shownInt = k
      numEl.textContent = String(k)
      if (miniNum) miniNum.textContent = String(k)
      if (miniChip) miniChip.style.backgroundColor = washedAt(k)
    }
    placeMarker()
    paintSwatches(false)
    setStage(stageOf(Math.max(D_END, st.shown)))
    return st.shown !== target
  }

  function dropBlue() {
    const b = canvas.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const mx = (b.left + X(st.M.x)) / vw
    const my = (b.top + Y(st.M.y)) / vh
    ctx.palette?.drop('ultramarine', {
      x: clamp(mx),
      y: clamp(my),
      amount: 1.5,
      radius: 0.17,
      vx: clamp(st.V.x * 0.15, -0.3, 0.3),
      vy: clamp(st.V.y * 0.15, -0.3, 0.3),
    })
    root.classList.remove('is-hit')
    void root.offsetWidth
    root.classList.add('is-hit')
  }

  /* ---------------------------------------------------------- loop */
  let raf = 0
  let last = 0
  function wake() {
    if (raf || !st.built || !st.visible || document.hidden) return
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }
  function frame(now) {
    raf = 0
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
    last = now
    st.frame++
    let busy = false

    if (st.pouring) {
      st.pourT = (now - st.pourStart) / 1000
      busy = true
      if (dustBedPending && st.pourT > 0.35) {
        dustBedPending = false
        dustBed()
      }
      if (st.pourT > 1.75) {
        st.pouring = false
        st.poured = true
      }
    }

    // where does the muller want to be?
    const holding = st.hold || st.keyHold || performance.now() < st.holdUntil
    if (!st.scripted) {
      if (holding && st.poured) autoTarget(dt)
      if (st.keys.size) {
        let vx = 0
        let vy = 0
        if (st.keys.has('ArrowLeft')) vx--
        if (st.keys.has('ArrowRight')) vx++
        if (st.keys.has('ArrowUp')) vy--
        if (st.keys.has('ArrowDown')) vy++
        const l = Math.hypot(vx, vy) || 1
        st.T.x += (vx / l) * 0.6 * dt
        st.T.y += (vy / l) * 0.6 * dt
        clampMuller(st.T)
      }
    }
    const ox = st.M.x
    const oy = st.M.y
    if (!st.scripted) {
      const k = 1 - Math.exp(-dt * (holding ? 22 : 16))
      st.M.x += (st.T.x - st.M.x) * k
      st.M.y += (st.T.y - st.M.y) * k
      clampMuller(st.M)
    }
    const mdx = st.M.x - ox
    const mdy = st.M.y - oy
    const moved = Math.hypot(mdx, mdy)
    const inv = dt > 0 ? 1 / dt : 0
    st.V.x = lerp(st.V.x, mdx * inv, 0.3)
    st.V.y = lerp(st.V.y, mdy * inv, 0.3)
    st.tilt.x = lerp(st.tilt.x, st.V.x * 0.9, 0.2)
    st.tilt.y = lerp(st.tilt.y, st.V.y * 0.9, 0.2)
    if (Math.abs(st.tilt.x) + Math.abs(st.tilt.y) > 0.002) busy = true

    if (moved > 1e-6) {
      busy = true
      if (st.poured && !st.scripted && st.lift < 0.05) grind(ox, oy, st.M.x, st.M.y)
      if (!st.grabbing) stir(mdx, mdy, moved * inv)
    }
    if (st.grabbing || holding || st.keys.size || st.scripted) busy = true
    if (Math.hypot(st.T.x - st.M.x, st.T.y - st.M.y) > 1e-4) busy = true
    if (updateReadouts(dt)) busy = true

    render()
    if (busy && st.visible && !document.hidden) raf = requestAnimationFrame(frame)
  }

  function stir(dx, dy, speed) {
    st.stirAcc++
    if (st.stirAcc % 3) return
    const b = canvas.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    ctx.emit('stir', {
      x: clamp((b.left + X(st.M.x)) / vw),
      y: clamp((b.top + Y(st.M.y)) / vh),
      dx: (dx * st.S * 3) / vw,
      dy: (dy * st.S * 3) / vh,
      strength: clamp(speed * 0.3, 0, 0.4),
      radius: clamp((st.R * st.S * 0.9) / Math.min(vw, vh), 0.03, 0.2),
    })
  }

  /* ---------------------------------------------------------- setup */
  function layout() {
    const cb = canvas.getBoundingClientRect()
    const sb = slabEl.getBoundingClientRect()
    const cw = Math.round(cb.width)
    const ch = Math.round(cb.height)
    if (cw < 40 || ch < 40 || sb.width < 40) return false
    const dpr = Math.min(ctx.dpr || 1, 2)
    const sizeChanged = cw !== st.cw || ch !== st.ch || dpr !== st.dpr
    if (!sizeChanged && st.built) return true
    const prevA = st.A
    st.cw = cw
    st.ch = ch
    st.dpr = dpr
    canvas.width = Math.round(cw * dpr)
    canvas.height = Math.round(ch * dpr)
    st.x0 = sb.left - cb.left
    st.y0 = sb.top - cb.top
    st.pad = st.x0
    st.S = sb.width
    st.A = sb.height / sb.width
    st.R = st.S < 620 ? 0.15 : 0.11
    st.scale = Math.pow(st.S / 760, 0.62)
    radiiAll()
    buildSlab()
    buildPaste(st.built && Math.abs(prevA - st.A) < 0.02)
    buildStampMask()
    if (!atlas) buildAtlas()
    if (!N) {
      makeHeap(2011)
      dustBedPending = true
      const rp = restPos()
      st.M.x = st.T.x = rp.x
      st.M.y = st.T.y = rp.y
    } else {
      for (let i = 0; i < N; i++) py[i] = Math.min(py[i], st.A - 0.012)
      clampMuller(st.M)
      clampMuller(st.T)
    }
    placeHint()
    buildRuler()
    buildStrokes()
    st.built = true
    return true
  }

  function pour() {
    if (st.poured || st.pouring) return
    if (reduced) {
      if (dustBedPending) {
        dustBedPending = false
        dustBed()
      }
      st.poured = true
      st.mullerAlpha = 1
      st.lift = 0
      render()
      showHint()
      return
    }
    st.pouring = true
    st.pourT = 0
    st.pourStart = performance.now()
    st.scripted = true
    st.mullerAlpha = 0
    st.lift = 1
    const rp = restPos()
    st.M.x = st.T.x = rp.x
    st.M.y = st.T.y = rp.y
    const m = { a: 0, l: 1 }
    gsap.to(m, {
      a: 1,
      l: 0,
      duration: 1.3,
      delay: 1.05,
      ease: 'settle',
      onUpdate() {
        st.mullerAlpha = Math.min(1, m.a * 1.6)
        st.lift = m.l
        wake()
      },
      onComplete() {
        st.scripted = false
        st.lift = 0
        showHint()
        wake()
      },
    })
    // the drawdowns are brushed on as the heap lands
    gsap.fromTo(
      strokeEls,
      { clipPath: 'inset(0 100% 0 0)' },
      { clipPath: 'inset(0 0% 0 0)', duration: 1.4, ease: 'pour', stagger: 0.18, delay: 0.5, clearProps: 'clipPath' },
    )
    wake()
  }

  function reset() {
    if (!st.built || st.resetting) return
    st.resetting = true
    st.interacted = true
    const wipe = { f: 1 }
    const again = () => {
      pg.clearRect(0, 0, paste.width, paste.height)
      makeHeap(2011 + Math.floor(Math.random() * 9999))
      dustBedPending = true
      st.fade = 1
      st.poured = false
      st.pouring = false
      st.stage = ''
      setStage('coarse')
      st.shownInt = -1
      st.swatchD = -1
      updateReadouts(0)
      statusEl.textContent = 'A fresh heap of lapis. ' + STATUS.coarse
      stepBtn.removeAttribute('aria-disabled')
      st.resetting = false
      pourAgain()
    }
    if (reduced) return again()
    gsap.to(wipe, {
      f: 0,
      duration: 0.5,
      ease: 'power2.in',
      onUpdate() {
        st.fade = wipe.f
        render()
      },
      onComplete: again,
    })
  }
  function pourAgain() {
    if (reduced) {
      if (dustBedPending) {
        dustBedPending = false
        dustBed()
      }
      st.poured = true
      const rp = restPos()
      st.M.x = st.T.x = rp.x
      st.M.y = st.T.y = rp.y
      render()
      return
    }
    st.pouring = true
    st.pourT = 0
    st.pourStart = performance.now()
    const rp = restPos()
    st.T.x = rp.x
    st.T.y = rp.y
    wake()
  }

  // reduced motion: one deterministic step of grinding at a time
  function step() {
    if (!st.built || !st.poured) return
    st.interacted = true
    hideHint()
    const cur = st.d
    const target = STEPS.find((s) => s < cur - 0.5)
    if (target == null) {
      stepBtn.setAttribute('aria-disabled', 'true')
      return
    }
    startOrbit()
    const dt = 1 / 60
    for (let f = 0; f < 70; f++) {
      st.frame++
      autoTarget(dt)
      const ox = st.M.x
      const oy = st.M.y
      st.M.x = lerp(st.M.x, st.T.x, 0.3)
      st.M.y = lerp(st.M.y, st.T.y, 0.3)
      grind(ox, oy, st.M.x, st.M.y)
      if (st.d <= target) break
    }
    // land exactly on the step: scale the touched part of every grain
    if (Math.abs(st.d - target) > 0.3) {
      let lo = 0
      let hi = 4
      const base = Float32Array.from(ps)
      for (let it = 0; it < 28; it++) {
        const f = (lo + hi) / 2
        let ln = 0
        let n = 0
        for (let i = 0; i < N; i++) {
          if (pt[i] !== 0) continue
          ln += Math.log(S_FLOOR + (base[i] - S_FLOOR) * f)
          n++
        }
        if (Math.exp(ln / n) > target) hi = f
        else lo = f
      }
      const f = (lo + hi) / 2
      for (let i = 0; i < N; i++) ps[i] = S_FLOOR + (base[i] - S_FLOOR) * Math.pow(f, HARD[pt[i]])
      radiiAll()
      measure()
    }
    st.d = target
    updateReadouts(0)
    if (target <= D_END) stepBtn.setAttribute('aria-disabled', 'true')
    render()
  }

  /* ---------------------------------------------------------- input */
  function toUnits(e) {
    const b = canvas.getBoundingClientRect()
    return { x: (e.clientX - b.left - st.x0) / st.S, y: (e.clientY - b.top - st.y0) / st.S }
  }
  function firstTouch() {
    if (!st.interacted) {
      st.interacted = true
      hideHint()
    }
  }
  slabEl.addEventListener('pointerdown', (e) => {
    if (!st.built || !st.poured || st.scripted) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    try {
      slabEl.setPointerCapture(e.pointerId)
    } catch {}
    const p = toUnits(e)
    const dd = Math.hypot(p.x - st.M.x, p.y - st.M.y)
    st.grabOff = dd < st.R * 1.2 ? { x: st.M.x - p.x, y: st.M.y - p.y } : { x: 0, y: 0 }
    st.T.x = p.x + st.grabOff.x
    st.T.y = p.y + st.grabOff.y
    clampMuller(st.T)
    st.grabbing = true
    root.classList.add('is-grabbing')
    firstTouch()
    wake()
  })
  slabEl.addEventListener('pointermove', (e) => {
    if (!st.grabbing) return
    const p = toUnits(e)
    st.T.x = p.x + st.grabOff.x
    st.T.y = p.y + st.grabOff.y
    clampMuller(st.T)
    wake()
  })
  const release = () => {
    if (!st.grabbing) return
    st.grabbing = false
    root.classList.remove('is-grabbing')
    wake()
  }
  slabEl.addEventListener('pointerup', release)
  slabEl.addEventListener('pointercancel', release)
  slabEl.addEventListener('lostpointercapture', release)

  const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
  slabEl.addEventListener('keydown', (e) => {
    if (!st.built || !st.poured) return
    if (ARROWS.includes(e.key)) {
      e.preventDefault()
      st.keys.add(e.key)
      firstTouch()
      wake()
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      if (!st.keyHold) {
        st.keyHold = true
        startOrbit()
        firstTouch()
        wake()
      }
    }
  })
  slabEl.addEventListener('keyup', (e) => {
    if (ARROWS.includes(e.key)) st.keys.delete(e.key)
    if (e.key === ' ' || e.key === 'Enter') st.keyHold = false
  })
  slabEl.addEventListener('blur', () => {
    st.keys.clear()
    st.keyHold = false
  })

  // the hold-to-grind button
  let lastHoldAt = 0
  const holdOn = () => {
    if (!st.built || !st.poured) return
    if (!st.hold) {
      st.hold = true
      startOrbit()
      holdBtn.classList.add('is-active')
      firstTouch()
      wake()
    }
  }
  const holdOff = () => {
    if (!st.hold) return
    st.hold = false
    lastHoldAt = performance.now()
    holdBtn.classList.remove('is-active')
  }
  holdBtn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    try {
      holdBtn.setPointerCapture(e.pointerId)
    } catch {}
    holdOn()
  })
  holdBtn.addEventListener('pointerup', holdOff)
  holdBtn.addEventListener('pointercancel', holdOff)
  holdBtn.addEventListener('lostpointercapture', holdOff)
  holdBtn.addEventListener('contextmenu', (e) => e.preventDefault())
  holdBtn.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      if (!e.repeat) holdOn()
    }
  })
  holdBtn.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') holdOff()
  })
  holdBtn.addEventListener('blur', holdOff)
  // assistive tech that sends a bare click: grind for a moment
  holdBtn.addEventListener('click', () => {
    if (st.hold || performance.now() - lastHoldAt < 500 || !st.poured) return
    startOrbit()
    st.holdUntil = performance.now() + 1600
    firstTouch()
    wake()
  })
  resetBtn.addEventListener('click', reset)
  stepBtn.addEventListener('click', step)

  /* ---------------------------------------------------------- life */
  function ensureBuilt() {
    if (st.built) return true
    try {
      return layout()
    } catch (err) {
      console.error('[grind] setup failed', err)
      return false
    }
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        st.visible = e.isIntersecting
        if (st.visible && ensureBuilt()) {
          if (!st.poured && !st.pouring && e.intersectionRatio >= 0.3) pour()
          render()
          wake()
        }
      }
    },
    { threshold: [0, 0.3, 0.6] },
  )
  // prepare a little before the slab arrives, so nothing is built on first sight
  const near = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        near.disconnect()
        ctx.ready.then(() => requestAnimationFrame(() => ensureBuilt() && render()))
      }
    },
    { rootMargin: '900px 0px' },
  )
  near.observe(slabEl)
  ctx.ready.then(() => io.observe(slabEl))

  let resizeRaf = 0
  const ro = new ResizeObserver(() => {
    if (!st.built) return
    cancelAnimationFrame(resizeRaf)
    resizeRaf = requestAnimationFrame(() => {
      const b = canvas.getBoundingClientRect()
      if (Math.round(b.width) === st.cw && Math.round(b.height) === st.ch) {
        buildRuler()
        buildStrokes()
        return
      }
      layout()
      render()
    })
  })
  ro.observe(slabEl)
  ro.observe(ruler)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      st.hold = false
      st.keyHold = false
      st.keys.clear()
    } else wake()
  })

  /* ---------------------------------------------------------- title */
  if (!reduced && ctx.SplitText) {
    const title = $('.grind__title')
    ctx.SplitText.create(title, {
      type: 'lines',
      mask: 'lines',
      autoSplit: true,
      onSplit(self) {
        return gsap.from(self.lines, {
          yPercent: 108,
          duration: 1.3,
          ease: 'expo.out',
          stagger: 0.09,
          scrollTrigger: { trigger: title, start: 'top 82%', once: true },
        })
      },
    })
  }
  root.dataset.stage = 'coarse'
}
