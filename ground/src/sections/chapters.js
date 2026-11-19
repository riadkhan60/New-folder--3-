/**
 * chapters.js — the six colour chapters, oldest to newest.
 *
 * Each chapter is a full-bleed field poured by the dish. On top of it sit:
 *   - the pigment's name (the section's h2), which bleeds in like ink on wet
 *     paper: blurred and spread wide, drawing in until it is sharp;
 *   - a heap of the dry pigment: a generated powder pile, rendered once per
 *     size, whose grains pour from above and roll down its face;
 *   - a drawdown card: the pigment mulled into gum arabic and pulled across
 *     paper with a palette knife, rendered once per size and revealed by a
 *     knife edge scrubbed to the scroll;
 *   - the catalogue entry, the price per jar and "Add to order", which emits
 *     ctx.emit('order', { id, qty: 1 }).
 * A thin timeline ribbon in the right margin shows where each pigment sits
 * in time; its ring follows the dish from field to field.
 *
 * The pixel work for heaps and drawdowns runs in a Web Worker built from the
 * self-contained `engine` below (or, if workers are unavailable, here in
 * short time slices), so scrolling never stalls while a chapter is made.
 */
import '../styles/chapters.css'
import { Color, gradient } from 'spectral.js'

/* Per-pigment character for the renderers: grain = granulation/coarseness,
   sparkle = crystalline glints, repose = heap steepness, seed = shape,
   tilt = how the sample card lies on the field. */
const TRAITS = {
  'yellow-ochre': { grain: 0.55, sparkle: 0.05, repose: 0.84, seed: 11, tilt: -0.9 },
  'egyptian-blue': { grain: 1, sparkle: 0.55, repose: 0.78, seed: 23, tilt: 0.7 },
  'tyrian-purple': { grain: 0.35, sparkle: 0.12, repose: 0.9, seed: 37, tilt: -0.5 },
  ultramarine: { grain: 0.9, sparkle: 0.45, repose: 0.8, seed: 41, tilt: 0.9 },
  carmine: { grain: 0.25, sparkle: 0.08, repose: 0.88, seed: 53, tilt: -0.7 },
  'bone-black': { grain: 0.45, sparkle: 0.2, repose: 0.82, seed: 67, tilt: 0.6, light: 0.84 },
}
const PAPER_HEX = '#f3f2ee'

/* ======================================================================
   ENGINE — pure pixel work. Self-contained on purpose: it is stringified
   into a worker, so it may only use what it defines itself.
   ====================================================================== */
function engine(inWorker) {
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v)
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a))
    return t * t * (3 - 2 * t)
  }
  function rng(seed) {
    let s = seed >>> 0
    return () => {
      s = (s + 0x6d2b79f5) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  /** Seeded value noise (1D + 2D) and a small fbm, in 0..1. */
  function makeNoise(seed) {
    const r = rng(seed)
    const perm = new Uint8Array(512)
    const val = new Float32Array(256)
    for (let i = 0; i < 256; i++) {
      perm[i] = i
      val[i] = r()
    }
    for (let i = 255; i > 0; i--) {
      const j = (r() * (i + 1)) | 0
      const t = perm[i]
      perm[i] = perm[j]
      perm[j] = t
    }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i]
    const n2 = (x, y) => {
      const xi = Math.floor(x)
      const yi = Math.floor(y)
      const xf = x - xi
      const yf = y - yi
      const u = xf * xf * (3 - 2 * xf)
      const v = yf * yf * (3 - 2 * yf)
      const X = xi & 255
      const Y = yi & 255
      const a = val[perm[X + perm[Y]]]
      const b = val[perm[X + 1 + perm[Y]]]
      const c = val[perm[X + perm[Y + 1]]]
      const d = val[perm[X + 1 + perm[Y + 1]]]
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
    }
    const n1 = (x) => n2(x, 0.5)
    const fbm = (x, y, o = 3) => {
      let s = 0
      let a = 0.5
      let n = 0
      for (let i = 0; i < o; i++) {
        s += a * n2(x, y)
        n += a
        x = x * 2.03 + 17.1
        y = y * 2.03 + 5.3
        a *= 0.5
      }
      return s / n
    }
    return { n1, n2, fbm }
  }

  /* HEAP — a heap of dry pigment on a flat ground, seen from a low angle.
     The height field is a cone of powder at its angle of repose (rounded
     peak, flared foot, fine avalanche streaks, soft lumps, a slight lean),
     rendered front to back with a y-buffer (voxel spans), lit from the
     upper left with a wrapped, matte powder response and grained per pixel. */
  const PHI = 0.27 // camera elevation (rad)
  const SIN = Math.sin(PHI)
  const COS = Math.cos(PHI)

  function* heap({ W, H, seed, repose, grain: gk, sparkle, light = 1, lut }) {
    W = Math.round(W)
    H = Math.round(H)
    const N = makeNoise(seed)
    const rand = rng(seed * 7 + 3)
    const R = W * 0.37
    const cx = W * 0.45
    const cy = H * 0.925 - R * SIN
    const Hh = R * repose
    const Rm = Math.ceil(R * 1.14)
    const n = Rm * 2 + 1
    const hgt = new Float32Array(n * n)
    const grv = new Float32Array(n * n)
    const s1 = seed * 0.37
    const s2 = seed * 1.91

    // 1. height field
    for (let j = 0; j < n; j++) {
      const D = j - Rm
      for (let i = 0; i < n; i++) {
        const X = i - Rm
        const r0 = Math.sqrt(X * X + D * D)
        if (r0 > Rm) continue
        // the pour landed a little off centre: the peak leans back and left
        const lean = 1 - Math.min(1, r0 / R)
        const lx = X + R * 0.05 * lean
        const ld = D - R * 0.06 * lean
        const r = Math.sqrt(lx * lx + ld * ld)
        const ct = r > 0 ? lx / r : 1
        const st = r > 0 ? ld / r : 0
        const th = Math.atan2(ld, lx)
        const Rt =
          R *
          (1 +
            0.03 * Math.sin(3 * th + s1) +
            0.016 * Math.sin(5 * th + s2) +
            0.05 * (N.n2(ct * 1.4 + 7, st * 1.4 + 3) - 0.5))
        const u = r / Rt
        if (u >= 1) continue
        // a cone at its angle of repose: rounded peak, gently flared foot
        const u2 = clamp((Math.sqrt(u * u + 0.017) - 0.13) / (Math.sqrt(1.017) - 0.13))
        let z = Math.pow(1 - u2, 1.38)
        // fine avalanche streaks run down the slope; a few soft lumps sit on it
        const g =
          (N.n2(ct * 19 + r * 0.012, st * 19 - r * 0.009) - 0.5) * 0.6 +
          (N.n2(ct * 58 + r * 0.03, st * 58 - r * 0.02) - 0.5) * 0.4
        const lump = (N.fbm(X * 0.018 + 40, D * 0.018 + 9, 3) - 0.5) * u * (1 - u) * 4
        z += g * 0.006 * u * (1 - u) * 4 + lump * 0.036
        const k = j * n + i
        hgt[k] = Math.max(0, z) * Hh
        grv[k] = g
      }
      if ((j & 15) === 15) yield
    }

    // 2. y-buffered front-to-back spans, shaded and grained
    const px = new Uint8ClampedArray(W * H * 4)
    const Ll = Math.hypot(-0.62, -0.4, 0.68)
    const Lx = -0.62 / Ll
    const Ly = -0.4 / Ll
    const Lz = 0.68 / Ll
    const grain = 0.1 + 0.16 * gk
    for (let i = 1; i < n - 1; i++) {
      if ((i & 15) === 15) yield
      const sx = Math.round(cx + i - Rm)
      if (sx < 0 || sx >= W) continue
      let ybuf = Infinity
      for (let j = 1; j < n - 1; j++) {
        const k = j * n + i
        const z = hgt[k]
        if (z <= 0) continue
        const D = j - Rm
        const sy = cy - (D * SIN + z * COS)
        if (ybuf === Infinity) ybuf = cy - D * SIN
        if (sy >= ybuf) continue
        const dx = (hgt[k + 1] - hgt[k - 1]) * 0.5
        const dd = (hgt[k + n] - hgt[k - n]) * 0.5
        const nl = 1 / Math.sqrt(dx * dx + dd * dd + 1)
        const ndl = (-dx * Lx - dd * Ly + Lz) * nl
        const diff = clamp((ndl + 0.32) / 1.32)
        const ao = 0.6 + 0.4 * smooth(0, 0.28, z / Hh)
        const s = (0.05 + 0.8 * diff * light) * ao + grv[k] * 0.045
        const y0 = Math.max(0, Math.ceil(sy))
        const y1 = Math.min(H, Math.ceil(ybuf))
        // grain per pixel, so steep faces don't streak; the row above the
        // span gets fractional cover for a soft, powdery silhouette
        for (let y = y0 - 1; y < y1; y++) {
          if (y < 0) continue
          let v = s + (rand() - 0.5) * grain
          const q = rand()
          if (q < 0.004 + 0.012 * sparkle) v += 0.22 + 0.25 * sparkle
          else if (q > 0.988) v -= 0.22
          const li = ((clamp(v) * 255) | 0) * 3
          const o = (y * W + sx) * 4
          px[o] = lut[li]
          px[o + 1] = lut[li + 1]
          px[o + 2] = lut[li + 2]
          px[o + 3] = y < y0 ? Math.round(255 * clamp(y0 - sy)) : 255
        }
        ybuf = sy
      }
    }

    // 3. strays: a dusting of grains on the ground around the foot
    const count = Math.round(R * 2.2)
    const strays = new Float32Array(count * 5)
    for (let s = 0; s < count; s++) {
      const a = rand() * Math.PI * 2
      const rr = R * (0.98 + Math.pow(rand(), 2.2) * 0.42)
      strays[s * 5] = cx + Math.cos(a) * rr
      strays[s * 5 + 1] = cy - Math.sin(a) * rr * SIN
      strays[s * 5 + 2] = (0.6 + rand() * 1.1) * (W / 600)
      strays[s * 5 + 3] = 0.35 + rand() * 0.5
      strays[s * 5 + 4] = 0.55 + rand() * 0.45
    }
    return { px, W, H, R, cx, cy, Hh, strays }
  }

  /* DRAWDOWN — the pigment mulled into gum arabic and pulled across paper
     with a knife: the rounded edge of the dollop, a plateau of masstone, a
     long fall into a clear tint, striations from the knife, low ridges at its
     edges, chatter across the pull, granulation settling into the paper's
     tooth, and streaks that run out at their own lengths. */
  function* drawdown({ W, H, seed, grain, rtl, lut }) {
    W = Math.round(W)
    H = Math.round(H)
    const N = makeNoise(seed + 101)
    const rand = rng(seed * 13 + 5)
    const G = { u0: 0.06, u1: 0.95, c: 0.5, hw: 0.235 }
    const sc = W / 900 // texture scale: the paper keeps its tooth across sizes
    const s0 = seed * 0.71
    const paper = new Uint8ClampedArray(W * H * 4)
    const paint = new Uint8ClampedArray(W * H * 4)
    const tooth = new Float32Array(W * H)
    const T = new Float32Array(W * H)
    const A = new Float32Array(W * H)

    // paper: tooth and faint fibres
    for (let y = 0; y < H; y++) {
      if ((y & 15) === 15) yield
      for (let x = 0; x < W; x++) {
        const k = y * W + x
        const xs = x / sc
        const ys = y / sc
        const t = N.n2(xs * 0.55, ys * 0.55) * 0.6 + N.n2(xs * 1.7 + 30, ys * 1.7) * 0.4
        const f = N.n2(xs * 0.03 + 9, ys * 0.42)
        tooth[k] = t
        const l = 1 + (t - 0.5) * 0.045 + (f - 0.5) * 0.02 + (rand() - 0.5) * 0.012
        const o = k * 4
        paper[o] = 243 * l
        paper[o + 1] = 242 * l
        paper[o + 2] = 238 * l
        paper[o + 3] = 255
      }
    }

    // paint thickness and coverage
    const span = G.u1 - G.u0
    for (let y = 0; y < H; y++) {
      if ((y & 7) === 7) yield
      const v = y / H
      for (let x = 0; x < W; x++) {
        const u = (rtl ? W - 1 - x : x) / W
        const c = G.c + 0.012 * Math.sin(u * 3.3 + s0) + 0.004 * (N.n1(u * 9 + s0) - 0.5)
        const hw = G.hw * (1 + 0.025 * Math.sin(u * 5.1 + s0 * 2)) + 0.004 * (N.n1(u * 40 + 3) - 0.5)
        const dv = (v - c) / hw // -1..1 across the band
        const ad = Math.abs(dv)
        if (ad > 1.04) continue
        const start = G.u0 + 0.014 * (1 - Math.sqrt(Math.max(0, 1 - dv * dv))) + 0.0025 * (N.n1(v * 12 + s0) - 0.5)
        const s = (u - start) / span
        if (s < -0.01) continue
        const fine = N.n2(v * 150 + s0, u * 0.4)
        const mid = N.n2(v * 34 + 20, u * 0.25 + s0)
        const end = 0.92 + 0.06 * (N.n1(v * 5 + s0) - 0.5)
        const sl = s / end
        if (sl > 1.04) continue
        let t = 0.86 * Math.pow(1 - smooth(0.02, 1.0, sl), 1.15)
        const amp = 0.1 + 0.38 * smooth(0.1, 0.8, sl)
        t *= 1 + amp * ((fine - 0.5) * 1.0 + (mid - 0.5) * 1.2)
        t += 0.34 * smooth(0.055, 0, s) * (0.85 + 0.3 * N.n2(v * 9, 2))
        const edge = Math.exp(-Math.pow((1 - ad) * hw * 34, 2))
        t += 0.14 * edge * Math.pow(clamp(1 - sl), 0.8)
        t *= 1 + 0.022 * Math.sin(u * 160 + mid * 1.5) * (1 - sl * 0.6)
        const k = y * W + x
        const thin = 1 - smooth(0.15, 0.6, t)
        t *= 1 + grain * (tooth[k] - 0.5) * 1.5 * thin
        T[k] = Math.max(0, t)
        const ae = clamp((1.0 - ad) * hw * H * 0.9 + 0.5)
        const as = clamp((s + 0.004) * span * W * 0.9)
        const thr = smooth(0.7, 1.03, sl) * 1.05
        const cover = smooth(thr - 0.12, thr + 0.04, fine * 0.3 + mid * 0.7)
        A[k] = ae * as * cover
      }
    }

    // shade: knife striations catch the light; gum gives thick paint a sheen
    const Lx = -0.5
    const Ly = -0.62
    for (let y = 1; y < H - 1; y++) {
      if ((y & 15) === 15) yield
      for (let x = 1; x < W - 1; x++) {
        const k = y * W + x
        const a = A[k]
        if (a <= 0) continue
        const t = T[k]
        const dx = (T[k + 1] - T[k - 1]) * 0.5 * W * 0.004
        const dy = (T[k + W] - T[k - W]) * 0.5 * H * 0.012
        const lit = -(dx * Lx + dy * Ly) * 0.9
        const tt = t - lit * 0.18 + (rand() - 0.5) * 0.02
        const li = ((clamp(tt) * 255) | 0) * 3
        let r = lut[li]
        let g = lut[li + 1]
        let b = lut[li + 2]
        const spec = Math.pow(clamp(lit * 0.9 + 0.08), 3) * smooth(0.45, 0.95, t) * 0.55
        r += (255 - r) * spec
        g += (252 - g) * spec
        b += (246 - b) * spec
        const o = k * 4
        paint[o] = r
        paint[o + 1] = g
        paint[o + 2] = b
        paint[o + 3] = 255 * a
      }
    }
    return { paper, paint, W, H, G }
  }

  const jobs = { heap, drawdown }
  if (inWorker) {
    self.onmessage = (e) => {
      const { id, kind, args } = e.data
      try {
        const it = jobs[kind](args)
        let r = it.next()
        while (!r.done) r = it.next()
        const v = r.value
        const transfer = kind === 'heap' ? [v.px.buffer, v.strays.buffer] : [v.paper.buffer, v.paint.buffer]
        self.postMessage({ id, ok: true, v }, transfer)
      } catch (err) {
        self.postMessage({ id, ok: false, error: String(err) })
      }
    }
    return null
  }
  return { jobs, rng, SIN, COS }
}

/* ------------------------------------------------- main-thread helpers */
const ENGINE = engine(false)
const { SIN, COS } = ENGINE
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v)
const lerp = (a, b, t) => a + (b - a) * t
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const toLin = (c) => {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const toSRGB = (c) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
/** Darken a colour in linear light: keeps the hue, deepens the body. */
function deepen(hex, k) {
  const c = hexRGB(hex).map((v) => clamp(toSRGB(toLin(v) * k), 0, 255))
  return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}
const kmix = (a, b, t) => gradient(t, [new Color(a), 0], [new Color(b), 1]).toString()
/** A 256-step lookup built with Kubelka–Munk mixing between colour stops
    (sampled 33 times, then interpolated: the curve is smooth). */
function ramp(stops) {
  const cols = stops.map(([hex, at]) => [new Color(hex), at])
  const S = 32
  const key = Array.from({ length: S + 1 }, (_, i) => gradient(i / S, ...cols).sRGB)
  const lut = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    const f = (i / 255) * S
    const a = Math.min(S - 1, Math.floor(f))
    const t = f - a
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = lerp(key[a][c], key[a + 1][c], t)
  }
  return lut
}
const LUTS = new Map()
/** Dry powder: deep shadow, masstone, a lit tint. Paint: paper, tint, masstone, deep. */
function luts(p) {
  if (!LUTS.has(p.id)) {
    LUTS.set(p.id, {
      heap: ramp([
        [deepen(p.hex, 0.1), 0],
        [deepen(p.hex, 0.4), 0.22],
        [p.hex, 0.48],
        [kmix(p.hex, p.tint, 0.5), 0.7],
        [p.tint, 0.88],
        [kmix(p.tint, PAPER_HEX, 0.18), 1],
      ]),
      paint: ramp([
        [PAPER_HEX, 0],
        [p.tint, 0.3],
        [p.hex, 0.74],
        [deepen(p.hex, 0.6), 1],
      ]),
      deep: deepen(p.hex, 0.22),
    })
  }
  return LUTS.get(p.id)
}
const css = (lut, t, a = 1) => {
  const i = (clamp(t) * 255) | 0
  return `rgb(${lut[i * 3]} ${lut[i * 3 + 1]} ${lut[i * 3 + 2]} / ${a})`
}
const rgba = (hex, a) => {
  const [r, g, b] = hexRGB(hex)
  return `rgb(${r} ${g} ${b} / ${a})`
}
function surface(w, h) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}
function layer(buf, W, H) {
  const c = surface(W, H)
  c.getContext('2d').putImageData(new ImageData(buf, W, H), 0, 0)
  return c
}

/** Heap: shadows on the ground, then the heap, then the strays. */
function composeHeap(v, lut, deep) {
  const out = surface(v.W, v.H)
  const g = out.getContext('2d')
  const { R, cx, cy } = v
  const ellipse = (x, y, rx, ry, stops) => {
    g.save()
    g.translate(x, y)
    g.scale(1, ry / rx)
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx)
    for (const [at, a] of stops) gr.addColorStop(at, rgba(deep, a))
    g.fillStyle = gr
    g.beginPath()
    g.arc(0, 0, rx, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
  // a long soft cast shadow away from the light, then the tight contact shadow
  ellipse(cx + R * 0.22, cy - R * 0.04, R * 1.15, R * 0.42, [
    [0, 0.3],
    [0.6, 0.18],
    [1, 0],
  ])
  ellipse(cx + R * 0.04, cy + R * 0.02, R * 1.08, R * 1.08 * SIN, [
    [0, 0.5],
    [0.78, 0.4],
    [0.9, 0.18],
    [1, 0],
  ])
  g.drawImage(layer(v.px, v.W, v.H), 0, 0)
  const s = v.strays
  for (let i = 0; i < s.length; i += 5) {
    g.fillStyle = css(lut, s[i + 3], s[i + 4])
    g.fillRect(s[i], s[i + 1], s[i + 2], s[i + 2])
  }
  return out
}

/* ====================================================================== */
export function init(ctx) {
  const root = document.getElementById('chapters')
  if (!root) return
  const { gsap, ScrollTrigger, reducedMotion } = ctx
  const { CHAPTERS, BY_ID, formatPrice } = ctx.pigments
  const sections = CHAPTERS.map((id) => document.getElementById(id)).filter(Boolean)
  const status = root.querySelector('[data-chapters-status]')

  const compute = makeComputer()
  hydrate()
  const units = sections.map((el) => Chapter(el))
  setupRibbon()
  setupOrders()

  // Canvases are made after the hand-over, for chapters within reach.
  ctx.ready.then(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          io.unobserve(e.target)
          const u = units.find((c) => c.el === e.target)
          u?.heap.render()
          u?.card.render()
        }
      },
      { rootMargin: '160% 0px 160% 0px' },
    )
    units.forEach((u) => io.observe(u.el))
  })

  /* --------------------------------------------------------- compute */
  // Runs engine jobs in a worker; falls back to time-sliced work here.
  function makeComputer() {
    const pending = new Map()
    let seq = 0
    let worker = null
    const queue = []
    let pumping = false

    // fallback: short slices with a macrotask between them; a canvas that
    // is on screen and still empty gets a longer slice
    function pump() {
      if (pumping || !queue.length) return
      pumping = true
      setTimeout(() => {
        const t0 = performance.now()
        const budget = queue[0].urgent?.() ? 14 : 6
        while (queue.length && performance.now() - t0 < budget) {
          const job = queue[0]
          try {
            job.it ??= ENGINE.jobs[job.kind](job.args)
            const r = job.it.next()
            if (r.done) {
              queue.shift()
              job.resolve(r.value)
            }
          } catch (err) {
            queue.shift()
            job.reject(err)
          }
        }
        pumping = false
        pump()
      }, 0)
    }
    function local(job) {
      queue.push(job)
      pump()
    }
    function dropWorker() {
      worker?.terminate()
      worker = null
      for (const job of pending.values()) local(job)
      pending.clear()
    }

    try {
      const src = `(${engine.toString()})(true)`
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
      worker.onmessage = (e) => {
        const job = pending.get(e.data.id)
        if (!job) return
        pending.delete(e.data.id)
        if (e.data.ok) job.resolve(e.data.v)
        else local(job)
      }
      worker.onerror = (e) => {
        e.preventDefault?.()
        dropWorker()
      }
    } catch {
      worker = null
    }

    return (kind, args, urgent) =>
      new Promise((resolve, reject) => {
        const job = { kind, args, urgent, resolve, reject }
        if (!worker) return local(job)
        const id = ++seq
        pending.set(id, job)
        worker.postMessage({ id, kind, args })
      })
  }

  /* --------------------------------------------------------- hydrate */
  // The partial carries every fact as static text; keep it true to the data.
  function hydrate() {
    for (const el of sections) {
      const p = BY_ID[el.id]
      if (!p) continue
      el.querySelectorAll('[data-k]').forEach((n) => {
        const k = n.dataset.k
        if (k === 'formula') n.innerHTML = p.formula
        else if (k === 'price') n.textContent = formatPrice(p.price) ?? ''
        else if (p[k] != null) n.textContent = p[k]
      })
    }
  }

  /* --------------------------------------------------------- chapter */
  function Chapter(el) {
    const p = BY_ID[el.id]
    const tr = TRAITS[el.id] || TRAITS['yellow-ochre']
    const name = el.querySelector('.chapter__name')
    const words = [...el.querySelectorAll('.chapter__word')]
    const inner = el.querySelector('.chapter__inner')
    const era = el.querySelector('.chapter__era')
    const heapWrap = el.querySelector('.chapter__heap')
    const cardWrap = el.querySelector('.chapter__card')
    const rtl = el.querySelector('.chapter__drawdown')?.dataset.pull === 'rtl'
    if (cardWrap) cardWrap.style.setProperty('--tilt', tr.tilt + 'deg')

    const self = { el, p, heap: HeapView(heapWrap, p, tr), card: CardView(cardWrap, p, tr, rtl) }

    if (reducedMotion) {
      // final states: the heap stands, the drawdown is pulled, the name is dry
      self.heap.t = 1
      self.card.k = 1
      return self
    }

    // the name starts wet: blurred, spread, not yet on the paper
    gsap.set(words, { opacity: 0, filter: 'blur(26px)', letterSpacing: '0.16em' })

    // content arrives with its field and leaves with it, so text never sits
    // on a colour it wasn't set for
    gsap.fromTo(
      inner,
      { opacity: 0 },
      { opacity: 1, ease: 'none', scrollTrigger: { trigger: el, start: 'top 58%', end: 'top 20%', scrub: true } },
    )
    gsap.fromTo(
      inner,
      { opacity: 1 },
      {
        opacity: 0,
        ease: 'none',
        immediateRender: false,
        scrollTrigger: { trigger: el, start: 'bottom 56%', end: 'bottom 22%', scrub: true },
      },
    )

    // the era floats like set type above the field; the heap a little less
    const drift = () => ({ trigger: el, start: 'top bottom', end: 'center top', scrub: 0.6 })
    if (era) gsap.fromTo(era, { yPercent: 24 }, { yPercent: -24, ease: 'none', scrollTrigger: drift() })
    if (heapWrap) gsap.fromTo(heapWrap, { y: 50 }, { y: -40, ease: 'none', scrollTrigger: drift() })

    // the name bleeds in and the heap pours, each once, as it comes on screen
    // with its field (a trigger that was already scrolled past just settles)
    const once = (trigger, start, play, settle) => {
      let done = false
      ScrollTrigger.create({
        trigger,
        start,
        onEnter: () => {
          if (done) return
          done = true
          if (trigger.getBoundingClientRect().bottom < 0) settle()
          else play()
        },
        onEnterBack: () => {
          if (done) return
          done = true
          settle()
        },
      })
    }
    if (name) {
      once(
        name,
        'top 86%',
        () =>
          gsap.to(words, {
            opacity: 1,
            filter: 'blur(0px)',
            letterSpacing: '-0.025em',
            duration: 2.4,
            ease: 'pour',
            stagger: 0.3,
            clearProps: 'filter,letterSpacing',
          }),
        () => gsap.set(words, { clearProps: 'opacity,filter,letterSpacing' }),
      )
    }
    if (heapWrap) once(heapWrap, 'center 78%', () => self.heap.play(), () => self.heap.finish())

    // the knife pulls the drawdown as the card crosses the screen
    if (cardWrap) {
      const proxy = { k: 0 }
      gsap.to(proxy, {
        k: 1,
        ease: 'none',
        scrollTrigger: { trigger: cardWrap, start: 'top 88%', end: 'top 30%', scrub: 0.9 },
        onUpdate: () => self.card.draw(proxy.k),
      })
    }
    return self
  }

  const onScreen = (el) => () => {
    const r = el.getBoundingClientRect()
    return r.bottom > 0 && r.top < innerHeight
  }

  /* --------------------------------------------------------- heap view */
  function HeapView(wrap, p, tr) {
    const canvas = wrap?.querySelector('canvas')
    const g = canvas?.getContext('2d')
    const view = { t: 0, ready: false, data: null, w: 0, h: 0 }
    const parts = makeParticles(tr.seed)
    let raf = 0
    let pendingPlay = false
    let token = 0

    view.render = () => {
      if (!canvas) return
      const w = Math.round(wrap.clientWidth)
      const h = Math.round(wrap.clientHeight)
      if (!w || !h) return
      const dpr = ctx.dpr
      // rendered at up to 1.6x; the canvas shows it at full dpr
      const q = Math.min(dpr, 1.6)
      const mine = ++token
      const L = luts(p)
      const args = {
        W: w * q,
        H: h * q,
        seed: tr.seed,
        repose: tr.repose,
        grain: tr.grain,
        sparkle: tr.sparkle,
        light: tr.light ?? 1,
        lut: L.heap,
      }
      compute('heap', args, onScreen(wrap))
        .then((v) => {
          if (mine !== token) return
          view.data = { ...v, canvas: composeHeap(v, L.heap, L.deep), lut: L.heap }
          view.w = w
          view.h = h
          canvas.width = Math.round(w * dpr)
          canvas.height = Math.round(h * dpr)
          view.ready = true
          view.draw(view.t)
          if (pendingPlay) view.play()
        })
        .catch((err) => console.error('[chapters] heap failed', err))
    }

    view.draw = (t) => {
      view.t = t
      if (!view.ready || !g) return
      const d = view.data
      const W = canvas.width
      const H = canvas.height
      const k = W / d.W // engine px → device px
      g.clearRect(0, 0, W, H)
      // grow from the centre of the base: a cone at its angle of repose is
      // self-similar, and its size grows with the cube root of the volume
      const u = clamp((t - 0.06) / 0.86)
      const s = u <= 0 ? 0 : Math.pow(u, 0.42)
      const cx = d.cx * k
      const cy = d.cy * k
      if (s > 0) g.drawImage(d.canvas, cx - cx * s, cy - cy * s, W * s, H * s)
      if (t >= 1) return
      const R = d.R * k
      const Hh = d.Hh * k
      const apex = cy - Hh * COS * s
      const top = -H * 0.02
      const unit = W / view.w // device px per css px
      // the falling stream
      for (const q of parts.stream) {
        const cyc = t / 0.06 + q.o
        const f = cyc % 1
        const born = (Math.floor(cyc) - q.o) * 0.06
        if (born < -0.02 || born > 0.86) continue
        const y = lerp(top, apex, f * f)
        const x = cx + q.x * unit * (1.2 + f * 2.2)
        const sz = q.s * unit
        g.fillStyle = css(d.lut, q.c, clamp((y - top) / (H * 0.12)) * 0.95)
        g.fillRect(x - sz / 2, y - sz / 2, sz, sz)
      }
      // a breath of dust where the stream lands
      if (t < 0.9 && s > 0) {
        const pr = (14 + 26 * s) * unit
        const gr = g.createRadialGradient(cx, apex, 0, cx, apex, pr)
        gr.addColorStop(0, css(d.lut, 0.8, 0.28 * (1 - t)))
        gr.addColorStop(1, css(d.lut, 0.8, 0))
        g.fillStyle = gr
        g.fillRect(cx - pr, apex - pr, pr * 2, pr * 2)
      }
      // grains landing on the peak roll down the near face
      for (const q of parts.roll) {
        const tau = (t - q.t0) / q.d
        if (tau <= 0 || tau >= 1) continue
        const rr = R * s * Math.pow(tau, 1.6) * q.reach
        const X = Math.cos(q.a) * rr
        const D = -Math.sin(q.a) * rr
        const z = Hh * s * Math.pow(clamp(1 - rr / Math.max(1, R * s)), 1.3)
        const sz = q.s * unit
        g.fillStyle = css(d.lut, q.c, (1 - tau * tau) * 0.95)
        g.fillRect(cx + X - sz / 2, cy - (D * SIN + z * COS) - sz, sz, sz)
      }
    }

    view.play = () => {
      if (!view.ready) {
        pendingPlay = true
        return
      }
      pendingPlay = false
      cancelAnimationFrame(raf)
      const dur = 3.1
      const t0 = performance.now() - view.t * dur * 1000
      const step = (now) => {
        const t = clamp((now - t0) / (dur * 1000))
        view.draw(t)
        if (t < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }
    view.finish = () => {
      pendingPlay = false
      cancelAnimationFrame(raf)
      view.draw(1)
    }
    watchSize(wrap, () => token && view.render())
    return view
  }

  /* --------------------------------------------------------- card view */
  function CardView(wrap, p, tr, rtl) {
    const canvas = wrap?.querySelector('canvas')
    const g = canvas?.getContext('2d')
    const view = { k: 0, ready: false, data: null }
    let token = 0

    view.render = () => {
      if (!canvas) return
      const w = Math.round(wrap.clientWidth)
      const h = Math.round(wrap.clientHeight)
      if (!w || !h) return
      const q = Math.min(ctx.dpr, 2)
      const mine = ++token
      const L = luts(p)
      compute('drawdown', { W: w * q, H: h * q, seed: tr.seed, grain: tr.grain, rtl, lut: L.paint }, onScreen(wrap))
        .then((v) => {
          if (mine !== token) return
          view.data = { paper: layer(v.paper, v.W, v.H), paint: layer(v.paint, v.W, v.H), G: v.G, lut: L.paint }
          canvas.width = v.W
          canvas.height = v.H
          view.ready = true
          view.draw(view.k)
        })
        .catch((err) => console.error('[chapters] drawdown failed', err))
    }

    view.draw = (k) => {
      view.k = k
      if (!view.ready || !g) return
      const d = view.data
      const W = canvas.width
      const H = canvas.height
      const G = d.G
      g.clearRect(0, 0, W, H)
      g.drawImage(d.paper, 0, 0)
      if (k >= 1) {
        g.drawImage(d.paint, 0, 0)
        return
      }
      // the knife edge: a slightly slanted line moving along the pull
      const X = (x) => (rtl ? W - x : x)
      const slant = H * 0.05
      const xe = (G.u0 + 0.01 + k * (G.u1 - G.u0 + 0.02)) * W
      const lead = (y) => xe + slant * (1 - (2 * y) / H) // knife x at height y
      if (k > 0) {
        g.save()
        g.beginPath()
        g.moveTo(X(0), 0)
        g.lineTo(X(lead(0)), 0)
        g.lineTo(X(lead(H)), H)
        g.lineTo(X(0), H)
        g.closePath()
        g.clip()
        g.drawImage(d.paint, 0, 0)
        g.restore()
      }
      // the bead of paint the knife still carries, thinning as it runs out
      const bw = Math.max(2, W * 0.036 * Math.pow(1 - k, 0.65))
      const top = (G.c - G.hw * 1.03) * H
      const bot = (G.c + G.hw * 1.03) * H
      const steps = 18
      const wAt = (i) => bw * (0.5 + 0.5 * Math.sin((Math.PI * i) / steps)) * (0.88 + 0.12 * Math.sin(i * 2.3 + k * 11))
      const yAt = (i) => lerp(top, bot, i / steps)
      g.save()
      g.beginPath()
      for (let i = 0; i <= steps; i++) {
        const x = lead(yAt(i)) + wAt(i) * 0.22
        if (i === 0) g.moveTo(X(x), yAt(i))
        else g.lineTo(X(x), yAt(i))
      }
      for (let i = steps; i >= 0; i--) g.lineTo(X(lead(yAt(i)) - wAt(i) * 1.1), yAt(i))
      g.closePath()
      const mid = lead(H / 2)
      const gr = g.createLinearGradient(X(mid - bw * 1.1), 0, X(mid + bw * 0.22), 0)
      gr.addColorStop(0, css(d.lut, 0.85, 0))
      gr.addColorStop(0.3, css(d.lut, 0.9, 1))
      gr.addColorStop(0.72, css(d.lut, 1, 1))
      gr.addColorStop(1, css(d.lut, 0.95, 1))
      g.fillStyle = gr
      g.fill()
      // wet gloss along the crest
      g.strokeStyle = 'rgb(255 253 248 / 0.5)'
      g.lineWidth = Math.max(1, W / 1100)
      g.lineCap = 'round'
      g.beginPath()
      for (let i = 2; i <= steps - 2; i++) {
        const x = lead(yAt(i)) - wAt(i) * 0.38
        if (i === 2) g.moveTo(X(x), yAt(i))
        else g.lineTo(X(x), yAt(i))
      }
      g.stroke()
      // the steel edge itself: a fine line just ahead of the bead
      const yT = (G.c - G.hw - 0.04) * H
      const yB = (G.c + G.hw + 0.04) * H
      g.strokeStyle = 'rgb(21 20 19 / 0.26)'
      g.lineWidth = Math.max(1, W / 1000)
      g.beginPath()
      g.moveTo(X(lead(yT) + bw * 0.3), yT)
      g.lineTo(X(lead(yB) + bw * 0.3), yB)
      g.stroke()
      g.restore()
    }
    watchSize(wrap, () => token && view.render())
    return view
  }

  /* --------------------------------------------------------- ribbon */
  function setupRibbon() {
    const nav = root.querySelector('.chapters__ribbon')
    if (!nav) return
    const stops = new Map([...nav.querySelectorAll('[data-stop]')].map((li) => [li.dataset.stop, li]))
    const xs = Object.fromEntries([...stops].map(([id, li]) => [id, parseFloat(li.style.getPropertyValue('--x')) || 0]))
    let last = { on: null, mx: -1, ink: '', active: '' }
    ctx.palette.onChange((st) => {
      const on = stops.has(st.section)
      const xf = xs[st.from] ?? xs[st.to] ?? 0
      const xt = xs[st.to] ?? xs[st.from] ?? 0
      const mx = Math.round((xf + (xt - xf) * st.mix) * 10000) / 10000
      const active = stops.has(st.field) ? st.field : ''
      if (on !== last.on) nav.classList.toggle('is-on', on)
      if (mx !== last.mx) nav.style.setProperty('--mx', mx)
      if (st.ink !== last.ink) nav.style.setProperty('--rb-ink', st.ink)
      if (active !== last.active) {
        stops.get(last.active)?.classList.remove('is-active')
        stops.get(active)?.classList.add('is-active')
      }
      last = { on, mx, ink: st.ink, active }
    })
  }

  /* --------------------------------------------------------- orders */
  function setupOrders() {
    root.addEventListener('click', (e) => {
      const b = e.target.closest?.('[data-order]')
      if (!b || !root.contains(b)) return
      const id = b.dataset.order
      const p = BY_ID[id]
      if (!p) return
      ctx.emit('order', { id, qty: 1 })
      const label = b.querySelector('.chapter__add-label')
      b.classList.remove('is-added')
      void b.offsetWidth // restart the label's settle
      b.classList.add('is-added')
      if (label) label.textContent = 'Added to order'
      if (status) status.textContent = `${p.name}, ${p.unit} jar, added to your order.`
      clearTimeout(b._groundT)
      b._groundT = setTimeout(() => {
        b.classList.remove('is-added')
        if (label) label.textContent = 'Add to order'
      }, 2400)
    })
  }

  /* --------------------------------------------------------- utils */
  function watchSize(el, fn) {
    if (!el) return
    let w = 0
    let h = 0
    let t = 0
    const ro = new ResizeObserver(() => {
      const nw = Math.round(el.clientWidth)
      const nh = Math.round(el.clientHeight)
      if (nw === w && nh === h) return
      const first = !w
      w = nw
      h = nh
      if (first) return
      clearTimeout(t)
      t = setTimeout(fn, 240)
    })
    ro.observe(el)
  }

  function makeParticles(seed) {
    const r = ENGINE.rng(seed * 31 + 9)
    const gauss = () => (r() + r() + r() - 1.5) / 1.5
    const stream = Array.from({ length: 170 }, () => ({ o: r(), x: gauss() * 2.6, s: 1.1 + r() * 1.9, c: 0.55 + r() * 0.42 }))
    const roll = Array.from({ length: 70 }, () => ({
      t0: 0.08 + r() * 0.8,
      d: 0.08 + r() * 0.12,
      a: 0.12 * Math.PI + r() * 0.76 * Math.PI, // the near face
      reach: 0.75 + r() * 0.35,
      s: 1 + r() * 1.4,
      c: 0.4 + r() * 0.5,
    }))
    return { stream, roll }
  }
}
