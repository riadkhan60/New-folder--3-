/**
 * chapters.js — the six colour chapters, oldest to newest (= CHAPTERS).
 *
 * Each chapter is a full-bleed field poured by the dish. Its text is shown
 * only while the dish holds its own field and it is the section on screen
 * (palette field === section === its id), so type never sits on a colour it
 * wasn't set for; the bottom of every chapter is an empty tail the next pour
 * plays over. On the field sit:
 *   - the pigment's name (the section's h2), which bleeds in like ink on wet
 *     paper: blurred and spread wide, drawing in until it is sharp;
 *   - a heap of the dry pigment: a generated powder pile, rendered once per
 *     size, poured by a stream that falls from above the screen;
 *   - one signature moment from the pigment's own story:
 *       yellow ochre   hold to heat it, and it burns to red ochre
 *       bone black     the pale bone chars black from the base up
 *       Egyptian blue  see it in infrared: the field goes dark, it glows
 *       Tyrian purple  a single gram, set against a tally of thousands
 *       ultramarine    a hand-off to the grinding lab
 *       carmine        the insects counted as the heap pours
 *   - a drawdown card: the pigment mulled into gum arabic and pulled across
 *     paper with a palette knife, revealed by a knife edge scrubbed to the
 *     scroll;
 *   - the catalogue entry, the price per jar and "Add to order", which emits
 *     ctx.emit('order', { id, qty: 1 }) and reports what the shop did.
 * A thin timeline ribbon in the right margin shows where each pigment sits
 * in time; its ring follows the dish from field to field.
 *
 * Every fact, date, price and name is read from pigments.js at runtime (the
 * partial is generated from the same data for the static page).
 *
 * The pixel work for heaps and drawdowns runs in a Web Worker built from the
 * self-contained `engine` below (or, if workers are unavailable, here in
 * short time slices), so scrolling never stalls while a chapter is made.
 */
import '../styles/chapters.css'
import { Color, gradient } from 'spectral.js'

/* Per-pigment character for the renderers: grain = granulation/coarseness,
   sparkle = crystalline glints, repose = heap steepness, seed = shape,
   tilt = how the sample card lies on the field, scale = heap size. */
const TRAITS = {
  'yellow-ochre': { grain: 0.55, sparkle: 0.05, repose: 0.84, seed: 11, tilt: -0.9 },
  'bone-black': { grain: 0.45, sparkle: 0.2, repose: 0.82, seed: 67, tilt: 0.6, light: 0.84 },
  'egyptian-blue': { grain: 1, sparkle: 0.55, repose: 0.78, seed: 23, tilt: -0.7 },
  'tyrian-purple': { grain: 0.35, sparkle: 0.12, repose: 0.9, seed: 37, tilt: 0.5, scale: 0.4 },
  ultramarine: { grain: 0.9, sparkle: 0.45, repose: 0.8, seed: 41, tilt: -0.8, glint: 120 },
  carmine: { grain: 0.25, sparkle: 0.08, repose: 0.88, seed: 53, tilt: 0.7 },
}
const PAPER_HEX = '#f3f2ee'
/* the one-column layout (= the mobile block in chapters.css) */
const MOBILE_MQ = '(max-width: 767px), (max-width: 1023px) and (orientation: portrait)'

/* Dates. Deep prehistory is given in years ago; anything with a calendar
   year is counted back from now. Rounded the way the history is known. */
const NOW = new Date().getFullYear()
const agoRaw = (p) => (p.year <= -10000 ? -p.year : NOW - p.year)
function agoOf(p) {
  const a = agoRaw(p)
  const step = a >= 10000 ? 1000 : a >= 1000 ? 500 : 100
  return Math.max(step, Math.round(a / step) * step)
}
const stillMade = (p) => /to today$/i.test(p.era || '')
/* Where a pigment's `year` marks something other than its first use, the
   date says so. Carmine's is its arrival in Europe: Mixtec and Aztec dyers
   used cochineal long before (its History row says as much). */
const SINCE = { carmine: 'years in Europe' }
const whenText = (p) => SINCE[p.id] ?? 'years ago'
const agoText = (p) => (stillMade(p) ? 'years ago, and still made today' : whenText(p))
/* The ribbon: a log scale from 100,000 years ago to today. */
const A0 = 100000
const A1 = 30
const ribbonX = (a) =>
  Math.min(1, Math.max(0, (Math.log10(A0) - Math.log10(Math.max(A1, a))) / (Math.log10(A0) - Math.log10(A1))))
/** Nudge sorted positions apart so no two stops sit closer than `gap`. */
function spread(xs, gap) {
  const v = xs.slice()
  for (let it = 0; it < 40; it++) {
    for (let i = 1; i < v.length; i++) {
      const d = v[i] - v[i - 1]
      if (d < gap) {
        const push = (gap - d) / 2
        v[i - 1] = Math.max(0, v[i - 1] - push)
        v[i] = Math.min(1, v[i] + push)
      }
    }
  }
  return v
}

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
  const html = document.documentElement
  const vw = () => window.innerWidth
  const vh = () => window.innerHeight

  const compute = makeComputer()
  hydrate()
  const units = sections.map((el) => Chapter(el))
  setupFields()
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
          u?.tally?.render()
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
  // The partial is generated from pigments.js; this keeps the page true to
  // the data even if the two ever drift (and re-dates it every year).
  function hydrate() {
    for (const el of sections) {
      const p = BY_ID[el.id]
      if (!p) continue
      el.querySelectorAll('[data-k]').forEach((n) => {
        const k = n.dataset.k
        // long formulas may break between their bracketed groups on a phone
        if (k === 'formula') n.innerHTML = p.formula.replace(/\)<sub>(\d+)<\/sub>(?=\()/g, ')<sub>$1</sub><wbr>')
        else if (k === 'price') n.textContent = formatPrice(p.price) ?? ''
        else if (k === 'ago') n.textContent = agoOf(p).toLocaleString('en-GB')
        else if (k === 'ago-text') n.textContent = agoText(p)
        else if (k === 'add-label') n.textContent = `: ${p.name}, ${p.unit} jar`
        else if (p[k] != null) n.textContent = p[k]
      })
      const h2 = el.querySelector('.chapter__name')
      if (h2 && h2.textContent.replace(/\s+/g, ' ').trim() !== p.name) {
        h2.innerHTML = p.name
          .split(' ')
          .map((w, i) => `<span class="chapter__word chapter__word--${i + 1}">${w}</span>`)
          .join(' ')
      }
      const cardName = el.querySelector('.chapter__card-name')
      if (cardName) cardName.textContent = p.name
    }
  }

  /* --------------------------------------------------------- fields */
  // A chapter's text is shown only while the dish holds its own field and
  // the chapter is the section on screen (the footer's field is bone black
  // too). With no dish (html.no-dish) every section paints its own field,
  // so all show.
  function setupFields() {
    const byId = new Map(sections.map((el) => [el.id, el]))
    let shown = null
    const show = (id) => {
      if (id === shown) return
      byId.get(shown)?.classList.remove('is-field')
      byId.get(id)?.classList.add('is-field')
      shown = id
    }
    ctx.palette.onChange((st) => show(byId.has(st.section) && st.field === st.section ? st.section : null))
    root.classList.add('is-live')
    // keyboard focus into a chapter whose field isn't poured yet: bring it
    // to the middle of the screen, which pours its field and shows it. It
    // lands at once (a smooth scroll would keep running after a fast Tab has
    // moved on, and carry the next focus off screen), and only once the
    // palette has caught up with the browser's own scroll to the focus.
    root.addEventListener('focusin', (e) => {
      const t = e.target
      const sec = t.closest?.('.chapter')
      if (!sec || html.classList.contains('no-dish')) return
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (document.activeElement !== t || sec.classList.contains('is-field') || ctx.jumping) return
          const r = t.getBoundingClientRect()
          ctx.scrollTo(Math.max(0, window.scrollY + r.top - vh() * 0.4), { immediate: true })
        }),
      )
    })
  }

  /* --------------------------------------------------------- chapter */
  function Chapter(el) {
    const p = BY_ID[el.id]
    const tr = TRAITS[el.id] || TRAITS['yellow-ochre']
    const name = el.querySelector('.chapter__name')
    const words = [...el.querySelectorAll('.chapter__word')]
    const era = el.querySelector('.chapter__era')
    const heapWrap = el.querySelector('.chapter__heap')
    const cardWrap = el.querySelector('.chapter__card')
    const rtl = el.querySelector('.chapter__drawdown')?.dataset.pull === 'rtl'
    if (cardWrap) cardWrap.style.setProperty('--tilt', tr.tilt + 'deg')

    // what the heap is made of, and what it can turn into
    let look = { lut: luts(p) }
    let alt = null
    if (el.id === 'yellow-ochre' && BY_ID['red-ochre']) alt = { lut: luts(BY_ID['red-ochre']), rest: 0 }
    if (el.id === 'bone-black') {
      // the pour is bone; it chars black from the base up
      alt = { lut: look.lut, rest: 1, light: tr.light }
      look = { lut: paleBone(), light: 1 }
    }

    const self = { el, p, tr }
    self.heap = HeapView(heapWrap, p, tr, look, alt, self)
    self.card = CardView(cardWrap, p, tr, rtl)
    self.count = Counter(el, p)
    self.tally = el.querySelector('.chapter__tally') ? Tally(el.querySelector('.chapter__tally'), p) : null
    // labels that belong to the heap sit by it, wherever it stands
    const countBox = el.querySelector('.chapter__count')
    const gram = el.querySelector('.chapter__gram')
    if (countBox || gram) {
      self.place = (G) => {
        const u = G.unit
        if (countBox) {
          // beside the stream, above the heap; on one column (where the heap
          // tucks under the name) beside the peak instead
          const narrow = matchMedia(MOBILE_MQ).matches
          countBox.style.left = Math.round((G.cx + (narrow ? G.R * G.s * 0.45 : 0)) / u + 22) + 'px'
          countBox.style.top = Math.round(G.apex / u - (narrow ? -6 : Math.min(170, G.Hh / u))) + 'px'
        }
        if (gram) {
          gram.style.left = Math.round((G.cx - G.R * G.s * 1.02) / u - 10) + 'px'
          gram.style.top = Math.round((G.cy - G.Hh * G.s * COS * 0.35) / u) + 'px'
        }
      }
    }
    if (el.id === 'yellow-ochre') Heat(self)
    if (el.id === 'egyptian-blue') Infrared(self)

    if (reducedMotion) {
      // final states: the heap stands, the drawdown is pulled, the name is dry
      self.heap.t = 1
      self.heap.level = alt ? alt.rest : 0
      self.card.k = 1
      self.count?.set(1)
      if (self.tally) self.tally.t = 1
      return self
    }

    // the name starts wet: blurred, spread, not yet on the paper
    gsap.set(words, { opacity: 0, filter: 'blur(26px)', letterSpacing: '0.16em' })

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
    if (heapWrap) once(heapWrap, 'center 80%', () => self.heap.play(), () => self.heap.finish())

    // the knife pulls the drawdown as the card crosses the screen
    if (cardWrap) {
      const proxy = { k: 0 }
      gsap.to(proxy, {
        k: 1,
        ease: 'none',
        scrollTrigger: { trigger: cardWrap, start: 'top 88%', end: 'top 34%', scrub: 0.9 },
        onUpdate: () => self.card.draw(proxy.k),
      })
    }
    return self
  }

  const onScreen = (el) => () => {
    const r = el.getBoundingClientRect()
    return r.bottom > 0 && r.top < vh()
  }

  /** Pale bone, before it is charred: bone-black's own wash, lead white, paper. */
  function paleBone() {
    if (!LUTS.has('bone-pale')) {
      const T = BY_ID['bone-black']?.tint || '#8a8784'
      const LW = BY_ID['lead-white']?.hex || '#eeebe3'
      LUTS.set('bone-pale', {
        heap: ramp([
          [deepen(T, 0.18), 0],
          [deepen(T, 0.55), 0.22],
          [T, 0.42],
          [kmix(T, LW, 0.6), 0.7],
          [LW, 0.9],
          [PAPER_HEX, 1],
        ]),
        deep: deepen(T, 0.2),
      })
    }
    return { heap: LUTS.get('bone-pale').heap, deep: LUTS.get('bone-pale').deep }
  }

  /** Drop pigment into the dish at a point on a canvas (canvas px). */
  function feed(canvas, x, y, opts) {
    if (html.classList.contains('no-dish')) return
    const r = canvas.getBoundingClientRect()
    if (!r.width || r.bottom < 0 || r.top > vh()) return
    const px = r.left + (x / canvas.width) * r.width
    const py = r.top + (y / canvas.height) * r.height
    ctx.emit('drop', { x: px / vw(), y: py / vh(), ...opts })
  }

  /* --------------------------------------------------------- heap view */
  // The heap grows from the centre of its base (a cone at its angle of
  // repose is self-similar; its size grows with the cube root of the
  // volume), fed by a stream that falls from above the top of the screen.
  // An optional second heap (`alt`) is revealed from the base up: ochre
  // burning to red, bone charring to black.
  function HeapView(wrap, p, tr, look, alt, unit) {
    const canvas = wrap?.querySelector('.chapter__heap-canvas')
    const g = canvas?.getContext('2d')
    const streamCv = wrap?.querySelector('.chapter__stream')
    const sg = streamCv?.getContext('2d')
    const view = { t: 0, level: 0, ready: false, data: null, w: 0, h: 0, geo: null }
    const parts = makeParticles(tr.seed)
    const S = tr.scale ?? 1
    let raf = 0
    let charRaf = 0
    let pendingPlay = false
    let token = 0
    let scratch = null
    let fed = 0

    view.render = () => {
      if (!canvas) return
      const w = Math.round(wrap.clientWidth)
      const h = Math.round(wrap.clientHeight)
      if (!w || !h) return
      const dpr = ctx.dpr
      // rendered at up to 1.6x; the canvas shows it at full dpr
      const q = Math.min(dpr, 1.6)
      const mine = ++token
      const job = (lut, light) =>
        compute(
          'heap',
          { W: w * q, H: h * q, seed: tr.seed, repose: tr.repose, grain: tr.grain, sparkle: tr.sparkle, light, lut: lut.heap },
          onScreen(wrap),
        )
      job(look.lut, look.light ?? tr.light ?? 1)
        .then((v) => {
          if (mine !== token) return
          view.data = { ...v, canvas: composeHeap(v, look.lut.heap, look.lut.deep), lut: look.lut.heap }
          view.w = w
          view.h = h
          canvas.width = Math.round(w * dpr)
          canvas.height = Math.round(h * dpr)
          view.ready = true
          view.draw(view.t)
          unit.place?.(geo(1))
          if (pendingPlay) view.play()
          if (!alt) return
          // the second heap: same seed, same grains, another colour
          return job(alt.lut, alt.light ?? 1).then((a) => {
            if (mine !== token) return
            view.data.alt = composeHeap(a, alt.lut.heap, alt.lut.deep)
            view.data.altLut = alt.lut.heap
            view.draw(view.t)
          })
        })
        .catch((err) => console.error('[chapters] heap failed', err))
    }

    // the heap's geometry on the canvas at growth t
    function geo(t) {
      const d = view.data
      const W = canvas.width
      const k = W / d.W // engine px → device px
      const u = clamp((t - 0.06) / 0.86)
      const s = (u <= 0 ? 0 : Math.pow(u, 0.42)) * S
      const cx = d.cx * k
      const cy = d.cy * k
      return { k, s, cx, cy, R: d.R * k, Hh: d.Hh * k, apex: cy - d.Hh * k * COS * s, unit: W / view.w }
    }
    view.geo = (t = view.t) => (view.ready ? geo(t) : null)

    view.draw = (t = view.t) => {
      view.t = t
      if (!view.ready || !g) return
      const d = view.data
      const W = canvas.width
      const H = canvas.height
      const G = geo(t)
      const { s, cx, cy, R, Hh, apex, unit } = G
      g.clearRect(0, 0, W, H)
      if (s > 0) {
        const dx = cx - cx * s
        const dy = cy - cy * s
        g.drawImage(d.canvas, dx, dy, W * s, H * s)
        // the second heap, revealed from the base up
        const L = view.level
        if (d.alt && L > 0.001) {
          if (L >= 0.999) g.drawImage(d.alt, dx, dy, W * s, H * s)
          else {
            scratch ??= document.createElement('canvas')
            if (scratch.width !== W || scratch.height !== H) {
              scratch.width = W
              scratch.height = H
            }
            const m = scratch.getContext('2d')
            m.globalCompositeOperation = 'source-over'
            m.clearRect(0, 0, W, H)
            m.drawImage(d.alt, dx, dy, W * s, H * s)
            const foot = cy + R * s * SIN * 1.6
            const top = apex - Hh * s * 0.08
            const edge = (foot - top) * 0.22
            const yb = lerp(foot + edge, top - edge, L)
            const gr = m.createLinearGradient(0, yb + edge / 2, 0, yb - edge / 2)
            gr.addColorStop(0, 'rgb(0 0 0 / 1)')
            gr.addColorStop(1, 'rgb(0 0 0 / 0)')
            m.globalCompositeOperation = 'destination-in'
            m.fillStyle = gr
            m.fillRect(0, 0, W, H)
            m.globalCompositeOperation = 'source-over'
            g.drawImage(scratch, 0, 0)
          }
        }
      }
      drawStream(t, G)
      if (glints && view.light && t >= 1) drawGlints(G)
      if (t >= 1 || s <= 0) return
      // a little spray where the stream lands
      if (t < 0.9) {
        for (const q of parts.spray) {
          const f = (t / 0.07 + q.o) % 1
          const X = cx + q.dir * (4 + q.v * 26 * s) * f * unit
          const Y = apex - Math.sin(f * Math.PI) * q.h * unit + f * f * 6 * s * unit
          const sz = q.s * unit
          g.fillStyle = css(d.lut, q.c, (1 - f) * 0.85)
          g.fillRect(X - sz / 2, Y - sz / 2, sz, sz)
        }
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

    // The stream: a narrow canvas from the apex to well above the top of the
    // screen. A soft tapered core with grains around it that streak as they
    // fall and spread as they near the heap; its head arrives first and its
    // tail falls in last.
    function sizeStream(G) {
      if (!streamCv) return null
      const dpr = ctx.dpr
      const cw = 120
      const extra = Math.round(vh() * 1.15)
      const apexCss = G.apex / G.unit
      const hCss = Math.round(apexCss + extra)
      const W = Math.round(cw * dpr)
      const H = Math.round(hCss * dpr)
      if (streamCv.width !== W || streamCv.height !== H) {
        streamCv.width = W
        streamCv.height = H
        streamCv.style.width = cw + 'px'
        streamCv.style.height = hCss + 'px'
      }
      streamCv.style.left = G.cx / G.unit - cw / 2 + 'px'
      streamCv.style.top = apexCss - hCss + 'px'
      return { W, H, dpr }
    }
    function clearStream() {
      if (!streamCv || streamCv.width <= 1) return
      streamCv.width = 1
      streamCv.height = 1
      streamCv.style.height = '1px'
    }
    function drawStream(t, G) {
      if (!sg) return
      if (t <= 0 || t >= 0.97 || reducedMotion) return clearStream()
      const box = sizeStream(G)
      if (!box) return
      const { W, H, dpr } = box
      const d = view.data
      sg.clearRect(0, 0, W, H)
      const x0 = W / 2
      const bottom = H // the apex
      const head = t < 0.06 ? Math.pow(t / 0.06, 1.6) : 1
      const tail = t > 0.86 ? Math.pow(clamp((t - 0.86) / 0.1), 1.6) : 0
      const y1 = lerp(0, bottom, head)
      const y0 = lerp(0, bottom, tail)
      if (y1 - y0 < 2) return
      // core: a ribbon of powder that thins as it falls
      const w0 = 2.3 * dpr
      const w1 = 0.9 * dpr
      const steps = 24
      sg.beginPath()
      for (let i = 0; i <= steps; i++) {
        const y = lerp(y0, y1, i / steps)
        const f = y / bottom
        const wob = Math.sin(f * 9 + t * 40) * 0.5 * dpr * f
        sg.lineTo(x0 + lerp(w0, w1, f) + wob, y)
      }
      for (let i = steps; i >= 0; i--) {
        const y = lerp(y0, y1, i / steps)
        const f = y / bottom
        const wob = Math.sin(f * 9 + t * 40) * 0.5 * dpr * f
        sg.lineTo(x0 - lerp(w0, w1, f) + wob, y)
      }
      sg.closePath()
      const gr = sg.createLinearGradient(0, y0, 0, y1)
      gr.addColorStop(0, css(d.lut, 0.6, 0))
      gr.addColorStop(Math.min(0.5, 120 / Math.max(1, y1 - y0)), css(d.lut, 0.6, 0.62))
      gr.addColorStop(1, css(d.lut, 0.55, 0.5))
      sg.fillStyle = gr
      sg.fill()
      // grains, streaking
      sg.lineCap = 'round'
      for (const q of parts.stream) {
        const f = (t / 0.045 + q.o) % 1
        const y = f * bottom
        if (y < y0 || y > y1) continue
        const spreadF = Math.pow(f, 2.2)
        const x = x0 + q.x * dpr * (0.6 + spreadF * 3.4)
        const len = (6 + q.s * 9) * dpr * (0.5 + f)
        sg.strokeStyle = css(d.lut, q.c, 0.9 * clamp(y / (H * 0.08)))
        sg.lineWidth = Math.max(1, q.s * 0.8 * dpr)
        sg.beginPath()
        sg.moveTo(x, Math.max(y0, y - len))
        sg.lineTo(x, y)
        sg.stroke()
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
      fed = 0
      const step = (now) => {
        const t = clamp((now - t0) / (dur * 1000))
        view.draw(t)
        unit.count?.set(t)
        if (unit.tally) unit.tally.draw(t)
        // as the pour lands, a little of the dust settles into the water
        if (fed < 2 && t > (fed === 0 ? 0.42 : 0.8)) {
          fed++
          const G = geo(t)
          const side = fed === 1 ? -1 : 1
          feed(canvas, G.cx + side * G.R * G.s * 0.9, G.cy + G.R * G.s * SIN * 0.5, {
            id: p.id,
            amount: 0.3,
            radius: 0.05 * S + 0.02,
            vx: side * 0.05,
          })
        }
        if (t < 1) raf = requestAnimationFrame(step)
        else afterPour()
      }
      raf = requestAnimationFrame(step)
    }
    function afterPour() {
      clearStream()
      if (alt && alt.rest === 1) char()
    }
    // bone black: the bone chars from the base up
    function char() {
      cancelAnimationFrame(charRaf)
      const dur = 2.6
      const t0 = performance.now() + 250
      const from = view.level
      const step = (now) => {
        const k = clamp((now - t0) / (dur * 1000))
        view.level = lerp(from, 1, k * k * (3 - 2 * k))
        view.draw(view.t)
        if (k < 1) charRaf = requestAnimationFrame(step)
      }
      charRaf = requestAnimationFrame(step)
    }
    view.finish = () => {
      pendingPlay = false
      cancelAnimationFrame(raf)
      cancelAnimationFrame(charRaf)
      if (alt && alt.rest === 1) view.level = 1
      unit.count?.set(1)
      if (unit.tally) unit.tally.draw(1)
      clearStream()
      view.draw(1)
    }
    // Ultramarine: crystals of lazurite in the powder catch the light. Each
    // glint is a facet on the near face; it flashes when the light (the
    // pointer, or on touch the scroll) swings round to face it.
    const glints = tr.glint && !reducedMotion ? makeGlints(tr.glint, tr.seed) : null
    function drawGlints(G) {
      const L = view.light
      const { cx, cy, R, Hh, unit: un } = G
      const s = G.s
      g.save()
      g.lineCap = 'round'
      for (const q of glints) {
        const r = q.r * R * s
        const X = cx + Math.cos(q.a) * r
        const D = -Math.sin(q.a) * r
        const z = Hh * s * Math.pow(1 - q.r, 1.38)
        const Y = cy - (D * SIN + z * COS)
        const ang = Math.atan2(L.y - Y, L.x - X)
        const b = Math.pow(Math.max(0, Math.cos(ang - q.f)), 30) * q.k
        if (b < 0.04) continue
        const len = (2 + q.z * 4.5) * un * (0.6 + b * 0.6)
        g.strokeStyle = `rgb(243 242 238 / ${Math.min(1, b).toFixed(3)})`
        g.lineWidth = Math.max(1, 0.8 * un)
        g.beginPath()
        g.moveTo(X - len, Y)
        g.lineTo(X + len, Y)
        g.moveTo(X, Y - len)
        g.lineTo(X, Y + len)
        g.stroke()
        g.fillStyle = `rgb(243 242 238 / ${Math.min(1, b * 1.2).toFixed(3)})`
        g.fillRect(X - un, Y - un, 2 * un, 2 * un)
      }
      g.restore()
    }
    if (glints && canvas) {
      let pending = false
      const aim = (x, y) => {
        if (!view.ready || view.t < 1) return
        const r = canvas.getBoundingClientRect()
        if (r.bottom < 0 || r.top > vh()) return
        const k = canvas.width / r.width
        view.light = { x: (x - r.left) * k, y: (y - r.top) * k }
        if (pending) return
        pending = true
        requestAnimationFrame(() => {
          pending = false
          view.draw(view.t)
        })
      }
      if (!ctx.isTouch) {
        window.addEventListener(
          'pointermove',
          (e) => {
            if (e.pointerType === 'touch' || !unit.el.classList.contains('is-field')) return
            aim(e.clientX, e.clientY)
          },
          { passive: true },
        )
      }
      // on touch, the light swings with the scroll
      ctx.palette.onChange((st) => {
        if (!ctx.isTouch || st.field !== unit.el.id) return
        const sweep = (window.scrollY / vh()) * 1.4
        aim(vw() * (0.5 + 0.6 * Math.sin(sweep)), vh() * (0.25 + 0.2 * Math.cos(sweep * 0.7)))
      })
    }

    view.setLevel = (L) => {
      view.level = clamp(L)
      view.draw(view.t)
    }
    watchSize(wrap, () => token && view.render())
    return view
  }

  /* --------------------------------------------------------- yellow ochre */
  // Hold to heat it: the water leaves the goethite and the heap burns to red
  // ochre from the base up, while the heat lifts red into the dish.
  function Heat(unit) {
    const el = unit.el
    const btn = el.querySelector('[data-try="heat"]')
    const label = btn?.querySelector('.chapter__try-label')
    const ring = btn?.querySelector('.chapter__try-fill')
    const note = el.querySelector('[data-note]')
    const red = BY_ID['red-ochre']
    if (!btn || !red) return
    const UP = 1 / 2.4
    const DOWN = 1 / 1.1
    let level = 0
    let holding = false
    let auto = false
    let done = false
    let raf = 0
    let last = 0
    let lastFeed = 0
    let doneAtDown = false
    ring?.style.setProperty('stroke-dashoffset', '1')

    const paint = () => {
      unit.heap.setLevel(level)
      ring?.style.setProperty('stroke-dashoffset', String(1 - level))
      el.style.setProperty('--heat', level.toFixed(3))
    }
    const loop = (now) => {
      const dt = Math.max(0, Math.min(0.2, (now - last) / 1000))
      last = Math.max(last, now)
      const heating = holding || auto
      // once it has burned it stays red: only "Start again" (or leaving the
      // chapter before it is done) cools the heap back to yellow
      const hot = heating || done
      level = clamp(level + (hot ? UP : -DOWN) * dt)
      paint()
      if (heating && !html.classList.contains('no-dish') && now - lastFeed > 140) {
        lastFeed = now
        const G = unit.heap.geo()
        const cv = el.querySelector('.chapter__heap-canvas')
        if (G && cv && G.s > 0) {
          const a = Math.random() * 2 - 1
          feed(cv, G.cx + a * G.R * G.s * 1.05, G.cy + G.R * G.s * SIN * (0.2 + Math.random() * 0.6), {
            id: 'red-ochre',
            mode: 'mix',
            amount: 0.45 + level * 0.5,
            radius: 0.035 + level * 0.03,
            vx: a * 0.03,
            vy: -0.18 - level * 0.2,
          })
        }
      }
      if (heating && level >= 1 && !done) complete()
      if ((hot && level < 1) || (!hot && level > 0)) raf = requestAnimationFrame(loop)
      else raf = 0
    }
    const run = () => {
      if (raf) return
      last = performance.now()
      raf = requestAnimationFrame(loop)
    }
    function complete() {
      done = true
      holding = false
      auto = false
      btn.classList.add('is-done')
      if (label) label.textContent = 'Start again'
      if (note) note.innerHTML = `<span class="t-italic">${red.name}.</span> ${red.fact}`
      // the last of the water leaves: a breath of red over the heap
      const G = unit.heap.geo()
      const cv = el.querySelector('.chapter__heap-canvas')
      if (G && cv) {
        for (let i = 0; i < 5; i++) {
          const a = (i / 4) * 2 - 1
          feed(cv, G.cx + a * G.R * G.s * 0.9, G.apex + (G.cy - G.apex) * (0.3 + Math.abs(a) * 0.5), {
            id: 'red-ochre',
            mode: 'mix',
            amount: 0.9,
            radius: 0.06,
            vx: a * 0.06,
            vy: -0.3,
          })
        }
      }
    }
    function reset() {
      done = false
      btn.classList.remove('is-done')
      if (label) label.textContent = 'Hold to heat it'
      if (note) note.textContent = ''
      if (reducedMotion) {
        level = 0
        paint()
        return
      }
      run() // cools back to a fresh yellow heap
    }

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      doneAtDown = done
      if (done) return
      if (unit.heap.t < 1) unit.heap.finish() // no waiting for the pour
      holding = true
      btn.classList.add('is-holding')
      try {
        btn.setPointerCapture(e.pointerId)
      } catch {}
      run()
    })
    const release = () => {
      holding = false
      btn.classList.remove('is-holding')
      run()
    }
    btn.addEventListener('pointerup', release)
    btn.addEventListener('pointercancel', release)
    btn.addEventListener('lostpointercapture', release)
    btn.addEventListener('contextmenu', (e) => e.preventDefault())
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) {
        // keyboard: one press heats it all the way, or starts again
        if (done) reset()
        else {
          if (unit.heap.t < 1) unit.heap.finish()
          if (reducedMotion) {
            // no slow burn: show the result
            level = 1
            paint()
            complete()
            return
          }
          auto = true
          run()
        }
        return
      }
      if (doneAtDown && done) reset()
    })
    // leaving the chapter (or jumping away): an unfinished heat cools
    const leave = () => {
      if (!holding && !auto) return
      holding = auto = false
      btn.classList.remove('is-holding')
      run()
    }
    ctx.palette.onChange((st) => {
      if (st.field !== el.id || st.section !== el.id) leave()
    })
    ctx.on('jump', (d) => {
      if (d?.phase === 'start') leave()
    })
  }

  /* --------------------------------------------------------- Egyptian blue */
  // See it in infrared: the field goes dark, as through a camera that sees
  // only infrared, and the pigment glows.
  function Infrared(unit) {
    const el = unit.el
    const btn = el.querySelector('[data-try="infrared"]')
    const note = el.querySelector('[data-note]')
    if (!btn) return
    let on = false
    const set = (v) => {
      if (v === on) return
      on = v
      el.classList.toggle('is-ir', on)
      btn.setAttribute('aria-pressed', String(on))
      if (note) note.textContent = on ? `Through an infrared camera, ${unit.p.name} glows.` : ''
      if (on && !html.classList.contains('no-dish')) {
        // the water stirs as the light changes
        ctx.emit('stir', { x: 0.5, y: 0.55, dx: 0, dy: -0.02, strength: 1.2, radius: 0.3 })
      }
    }
    btn.addEventListener('click', () => set(!on))
    // the dark of the infrared covers the whole screen: it goes as soon as
    // the chapter does, or a jump takes the page elsewhere
    ctx.palette.onChange((st) => {
      if (on && (st.field !== el.id || st.section !== el.id)) set(false)
    })
    ctx.on('jump', (d) => {
      if (d?.phase === 'start') set(false)
    })
  }

  /* --------------------------------------------------------- carmine */
  // The insects, counted as the heap pours (the number is the fact's own).
  function Counter(el, p) {
    const box = el.querySelector('.chapter__count')
    const n = box?.querySelector('.chapter__count-n')
    const m = /([\d,]{4,})\s+dried insects/i.exec(p.fact || '')
    if (!box || !n || !m) {
      box?.remove()
      return null
    }
    const total = parseInt(m[1].replace(/,/g, ''), 10)
    let shown = -1
    const set = (t) => {
      const k = clamp((t - 0.06) / 0.86)
      const v = k >= 1 ? total : Math.round((total * (1 - Math.pow(1 - k, 2.2))) / 10) * 10
      if (v === shown) return
      shown = v
      n.textContent = v.toLocaleString('en-GB')
      box.classList.toggle('is-done', k >= 1)
      box.classList.toggle('is-on', t > 0)
    }
    set(0)
    return { set }
  }

  /* --------------------------------------------------------- Tyrian purple */
  // A single gram, set against a tally of thousands of snails: marks in fives,
  // like a ledger, that fill in as the gram pours.
  function Tally(cv, p) {
    const g = cv.getContext('2d')
    const view = { t: 0, marks: [] }
    let drawn = 0
    view.render = () => {
      const w = Math.round(cv.clientWidth)
      const h = Math.round(cv.clientHeight)
      if (!w || !h) return
      const dpr = ctx.dpr
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      const unitW = 17
      const unitH = 18
      const cols = Math.floor(w / unitW)
      const rows = Math.floor(h / unitH)
      const r = ENGINE.rng(371)
      view.marks = []
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) view.marks.push([(x * unitW + 2 + (r() - 0.5) * 1.2) * dpr, (y * unitH + 3 + (r() - 0.5) * 1.2) * dpr, r()])
      drawn = 0
      g.clearRect(0, 0, cv.width, cv.height)
      view.draw(view.t, true)
    }
    view.draw = (t, force) => {
      view.t = t
      const M = view.marks
      if (!M.length) return
      const k = clamp((t - 0.04) / 0.9)
      const upto = k >= 1 ? M.length : Math.floor(M.length * (k * k * (3 - 2 * k)))
      if (force || upto < drawn) {
        g.clearRect(0, 0, cv.width, cv.height)
        drawn = 0
      }
      if (upto <= drawn) return
      const dpr = ctx.dpr
      const ink = p.ink || PAPER_HEX
      g.strokeStyle = rgba(ink, 0.34)
      g.lineWidth = Math.max(1, 0.9 * dpr)
      g.lineCap = 'round'
      g.beginPath()
      for (let i = drawn; i < upto; i++) {
        const [x, y, j] = M[i]
        const hh = 10.5 * dpr
        for (let s = 0; s < 4; s++) {
          const sx = x + s * 2.6 * dpr + (j - 0.5) * 0.6 * dpr
          g.moveTo(sx, y + (j - 0.5) * 0.8 * dpr)
          g.lineTo(sx + 0.4 * dpr, y + hh)
        }
        g.moveTo(x - 1.4 * dpr, y + hh * 0.78)
        g.lineTo(x + 9.6 * dpr, y + hh * 0.2)
      }
      g.stroke()
      drawn = upto
    }
    watchSize(cv, () => view.render())
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
    const order = CHAPTERS.filter((id) => stops.has(id) && BY_ID[id])
    const raw = order.map((id) => ribbonX(agoRaw(BY_ID[id])))
    const sorted = order.map((id, i) => [id, raw[i]]).sort((a, b) => a[1] - b[1])
    const xs = {}
    // labels from the data
    for (const id of order) {
      const p = BY_ID[id]
      const li = stops.get(id)
      li.style.setProperty('--swatch', p.hex)
      const nm = li.querySelector('.ribbon__name')
      const wh = li.querySelector('.ribbon__when')
      if (nm) nm.textContent = p.name
      if (wh) wh.textContent = `${agoOf(p).toLocaleString('en-GB')} ${whenText(p)}`
    }
    // positions: true log-scale places, nudged apart so dots never crowd
    const layout = () => {
      const h = nav.clientHeight || vh() * 0.56
      const gap = Math.min(0.12, 30 / Math.max(120, h))
      const v = spread(
        sorted.map((s) => s[1]),
        gap,
      )
      sorted.forEach(([id], i) => {
        xs[id] = v[i]
        stops.get(id).style.setProperty('--x', v[i].toFixed(4))
      })
      last.mx = -1
    }
    let last = { on: null, mx: -1, ink: '', ink2: '', active: '' }
    layout()
    let rt = 0
    window.addEventListener('resize', () => {
      clearTimeout(rt)
      rt = setTimeout(layout, 150)
    })
    // the small labels take the field's own second ink (contrast-aware, from
    // the field styles), read once per field from a section that carries it
    const inks = new Map()
    const ink2Of = (field) => {
      if (!inks.has(field)) {
        const sec = [...document.querySelectorAll('section[data-field], footer[data-field]')].find(
          (s) => s.dataset.field === field,
        )
        inks.set(field, sec ? getComputedStyle(sec).getPropertyValue('--ink-2').trim() : '')
      }
      return inks.get(field)
    }
    const update = (st) => {
      // On in a chapter, decided by the section on screen (the footer's field
      // is bone black too); hidden while a jump runs, when the field holds
      // still and the sections fly past. The ring follows the field.
      const on = stops.has(st.section) && !ctx.jumping
      const xf = xs[st.from] ?? xs[st.to] ?? 0
      const xt = xs[st.to] ?? xs[st.from] ?? 0
      const mx = Math.round((xf + (xt - xf) * st.mix) * 10000) / 10000
      const active = on ? st.section : ''
      const ink2 = ink2Of(st.field)
      if (on !== last.on) nav.classList.toggle('is-on', on)
      if (mx !== last.mx) nav.style.setProperty('--mx', mx)
      if (st.ink !== last.ink) nav.style.setProperty('--rb-ink', st.ink)
      if (ink2 !== last.ink2) nav.style.setProperty('--rb-ink-2', ink2)
      if (active !== last.active) {
        stops.get(last.active)?.classList.remove('is-active')
        stops.get(active)?.classList.add('is-active')
        stops.get(last.active)?.querySelector('a')?.removeAttribute('aria-current')
        stops.get(active)?.querySelector('a')?.setAttribute('aria-current', 'location')
      }
      last = { on, mx, ink: st.ink, ink2, active }
    }
    ctx.palette.onChange(update)
    ctx.on('jump', () => update(ctx.palette.get()))
  }

  /* --------------------------------------------------------- orders */
  // The shop decides (it caps Tyrian purple at two jars); the button reports
  // what actually happened. The shop announces adds and limits itself.
  function setupOrders() {
    const lines = new Map()
    let heard = false
    ctx.on('order-change', (d) => {
      heard = true
      lines.clear()
      for (const l of d?.lines || []) lines.set(l.id, l.qty)
    })
    root.addEventListener('click', (e) => {
      const b = e.target.closest?.('[data-order]')
      if (!b || !root.contains(b)) return
      const id = b.dataset.order
      const p = BY_ID[id]
      if (!p) return
      const before = lines.get(id) || 0
      heard = false
      ctx.emit('order', { id, qty: 1 })
      const after = lines.get(id) || 0
      const shop = !!document.getElementById('shop')
      const ok = heard && after > before
      const label = b.querySelector('.chapter__add-label')
      let text = 'Added to order'
      if (!ok) {
        if (shop) text = id === 'tyrian-purple' ? 'Two jars at most' : 'That’s the most we can send'
        else {
          text = 'Not available'
          if (status) status.textContent = 'Ordering isn’t available right now.'
        }
      }
      b.classList.remove('is-added', 'is-refused')
      void b.offsetWidth // restart the label's settle
      b.classList.add(ok ? 'is-added' : 'is-refused')
      if (label) label.textContent = text
      clearTimeout(b._groundT)
      b._groundT = setTimeout(() => {
        b.classList.remove('is-added', 'is-refused')
        if (label) label.textContent = 'Add to order'
      }, ok ? 2400 : 4200)
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

  function makeGlints(n, seed) {
    const r = ENGINE.rng(seed * 17 + 5)
    return Array.from({ length: n }, () => ({
      r: 0.08 + Math.sqrt(r()) * 0.86, // radius on the base, 0..1
      a: (0.1 + r() * 0.8) * Math.PI, // round the near face
      f: r() * Math.PI * 2, // which way the facet faces
      k: 0.6 + r() * 0.4,
      z: r(),
    }))
  }

  function makeParticles(seed) {
    const r = ENGINE.rng(seed * 31 + 9)
    const gauss = () => (r() + r() + r() - 1.5) / 1.5
    const stream = Array.from({ length: 260 }, () => ({ o: r(), x: gauss() * 2.4, s: 0.9 + r() * 1.7, c: 0.5 + r() * 0.45 }))
    const roll = Array.from({ length: 70 }, () => ({
      t0: 0.08 + r() * 0.8,
      d: 0.08 + r() * 0.12,
      a: 0.12 * Math.PI + r() * 0.76 * Math.PI, // the near face
      reach: 0.75 + r() * 0.35,
      s: 1 + r() * 1.4,
      c: 0.4 + r() * 0.5,
    }))
    const spray = Array.from({ length: 34 }, () => ({
      o: r(),
      dir: r() < 0.5 ? -1 : 1,
      v: 0.3 + r() * 0.7,
      h: 3 + r() * 9,
      s: 0.9 + r() * 1.3,
      c: 0.45 + r() * 0.45,
    }))
    return { stream, roll, spray }
  }
}
