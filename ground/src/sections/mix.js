/**
 * mix.js — the mix lab. "Paint mixes differently from light."
 *
 * Two pigments and a ratio. The true paint mix comes from spectral.js
 * (Kubelka–Munk); for contrast, the plain sRGB average a screen gives. The
 * result is a well of wet paint on an engraved porcelain dish: both colours
 * pour in from opposite rims, swirl, and converge on the spectral mix.
 * Every in-between streak is itself a Kubelka–Munk mix at that local
 * concentration, so the swirl is physically honest all the way through.
 *
 * The two pigments are chosen from a paintbox: twelve brushed chips in the
 * library's order (oldest first), each named, archive colours with the
 * library's specimen corner marks. Choosing one brushes it out again and
 * lets a drop of it run from the chip towards the well, through the dish.
 *
 * Listens: 'select-pigment' { id } → becomes the first pigment.
 * Emits:   'drop' (via ctx.palette.drop) — from the chosen chip, and both
 *          pigments at the well's rim; 'stir' — the ratio stirs the water.
 */
import '../styles/mix.css'
import * as spectralNS from 'spectral.js'
import { paintStroke, makeReveal, byAge, hexRgb, rgbCss, shade, noise1, rng, hashStr } from './library.js'

const spectral = spectralNS.Color ? spectralNS : spectralNS.default

/* ------------------------------------------------------------ words */
const LIGHT_HUES = new Set(['pink', 'coral', 'peach', 'sky blue', 'orchid', 'cream', 'golden yellow', 'lemon yellow', 'lilac'])

function hueName(h, L, C) {
  if (h >= 345 || h < 20) return L > 0.64 ? 'pink' : 'crimson'
  if (h < 45) return L > 0.7 ? 'coral' : C < 0.1 && L < 0.55 ? 'red-brown' : 'red'
  if (h < 72) return L < 0.62 ? 'brown' : L > 0.84 ? 'peach' : 'orange'
  if (h < 100) return L < 0.6 ? 'olive brown' : L > 0.8 ? 'golden yellow' : 'ochre'
  if (h < 125) return L < 0.64 ? 'olive green' : L > 0.86 ? 'lemon yellow' : 'yellow-green'
  if (h < 170) return 'green'
  if (h < 215) return 'blue-green'
  if (h < 250) return L > 0.68 ? 'sky blue' : 'blue'
  if (h < 285) return 'blue'
  if (h < 305) return L > 0.7 ? 'lilac' : 'violet'
  return L > 0.64 ? 'orchid' : L < 0.36 ? 'plum' : 'purple'
}

function words(hex) {
  const [L, C, h] = new spectral.Color(hex).OKLCh
  if (C < 0.03) {
    if (L < 0.24) return { L, C, h, hue: 'near black', adj: [], neutral: true }
    if (L > 0.9) return { L, C, h, hue: 'near white', adj: [], neutral: true }
    let hue = 'grey'
    if (C >= 0.012) {
      hue = h >= 20 && h < 110 ? 'warm grey' : h >= 110 && h < 180 ? 'green-grey' : h >= 180 && h < 290 ? 'blue-grey' : 'mauve grey'
    }
    return { L, C, h, hue, adj: L < 0.42 ? ['dark'] : L > 0.72 ? ['light'] : [], neutral: true }
  }
  const hue = hueName(h, L, C)
  const adj = []
  if (!LIGHT_HUES.has(hue) && hue !== 'plum') {
    if (L < 0.3) adj.push('very dark')
    else if (L < 0.45) adj.push('dark')
    else if (L > 0.8) adj.push('pale')
    else if (L > 0.68) adj.push('light')
  }
  if (C < 0.055) adj.push('muted')
  else if (C > 0.16) adj.push('vivid')
  return { L, C, h, hue, adj, neutral: false }
}

const article = (w) => (/^[aeio]/i.test(w) ? 'an' : 'a')
function describe(hex) {
  const w = words(hex)
  const lead = w.adj.length === 2 ? `${w.adj[0]}, ${w.adj[1]}` : w.adj.join(' ')
  const s = (lead ? lead + ' ' : '') + w.hue
  const out = `${article(s)} ${s}`
  return out[0].toUpperCase() + out.slice(1)
}
const hueDiff = (a, b) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}
function verdict(paintHex, lightHex) {
  const p = words(paintHex)
  const l = words(lightHex)
  const P = new spectral.Color(paintHex).OKLab
  const Q = new spectral.Color(lightHex).OKLab
  const dE = Math.hypot(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2])
  if (dE < 0.035) return 'Here paint and screen nearly agree.'
  if (l.neutral && !p.neutral) return `Paint makes ${article(p.hue)} ${p.hue}. The screen gives ${l.hue.endsWith('grey') ? 'grey' : l.hue}.`
  if (!p.neutral && !l.neutral && p.hue !== l.hue && hueDiff(p.h, l.h) > 30)
    return `Paint makes ${article(p.hue)} ${p.hue}. The screen makes ${article(l.hue)} ${l.hue}.`
  if (p.C > l.C + 0.035) return 'Paint keeps its colour where the average greys it.'
  if (p.L < l.L - 0.05) return 'Paint comes out darker: each pigment absorbs light the other would reflect.'
  if (p.L > l.L + 0.05) return 'Paint comes out lighter than the average.'
  if (l.C > p.C + 0.035) return 'The screen looks brighter here. Real paint is a little quieter.'
  return 'Close, but not the same colour.'
}

/* ------------------------------------------------------------ colour maths */
const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()
const lowerName = (n) => (/^(Egyptian|Tyrian)/.test(n) ? n : n[0].toLowerCase() + n.slice(1))
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/* ================================================================ section */
export function init(ctx) {
  const root = document.getElementById('mix')
  if (!root || !spectral?.Color) return
  const { gsap, pigments } = ctx
  const { PIGMENTS, BY_ID } = pigments
  const RM = ctx.reducedMotion
  const dpr = () => Math.min(ctx.dpr || 1, 2)
  const $ = (s) => root.querySelector(s)
  const out = (k) => root.querySelector(`[data-out="${k}"]`)

  const S = { a: 'ultramarine', b: 'yellow-ochre', r: 0.5 }

  /* -------------------------------------------------------- spectral */
  const colorCache = new Map()
  const col = (id) => {
    if (!colorCache.has(id)) colorCache.set(id, new spectral.Color(BY_ID[id].hex))
    return colorCache.get(id)
  }
  function km(a, b, r) {
    if (r <= 0.0005 || a === b) return BY_ID[a].hex.toUpperCase()
    if (r >= 0.9995) return BY_ID[b].hex.toUpperCase()
    return spectral.mix([col(a), 1 - r], [col(b), r]).toString().toUpperCase()
  }
  function avg(a, b, r) {
    const A = hexRgb(BY_ID[a].hex)
    const B = hexRgb(BY_ID[b].hex)
    return toHex(A.map((v, i) => v + (B[i] - v) * r))
  }

  // Kubelka–Munk colour at every local concentration of B, for the well
  const LUT_N = 128
  let lut = new Uint8ClampedArray((LUT_N + 1) * 3)
  let lutKey = ''
  function buildLut() {
    const key = S.a + '|' + S.b
    if (key === lutKey) return
    lutKey = key
    const next = new Uint8ClampedArray((LUT_N + 1) * 3)
    for (let k = 0; k <= LUT_N; k++) {
      const c = hexRgb(km(S.a, S.b, k / LUT_N))
      next[k * 3] = c[0]
      next[k * 3 + 1] = c[1]
      next[k * 3 + 2] = c[2]
    }
    lut = next
  }
  const lutAt = (r) => {
    const k = Math.round(Math.min(1, Math.max(0, r)) * LUT_N) * 3
    return [lut[k], lut[k + 1], lut[k + 2]]
  }

  /* -------------------------------------------------------- DOM */
  const well = $('.mix__well')
  const canvas = $('.mix__well-canvas')
  const g = canvas.getContext('2d')
  const tagA = $('.mix__tag--a')
  const tagB = $('.mix__tag--b')
  const range = $('#mix-ratio')
  const marker = $('.mix__marker')
  const stripPaint = $('.mix__strip--paint')
  const stripLight = $('.mix__strip--light')
  const chipPaint = $('.mix__res-chip--paint canvas')
  const chipLight = $('.mix__res-chip--light')
  const status = $('#mix-status')
  const presets = [...root.querySelectorAll('.mix__preset')]

  // presets: colours and names come from pigments.js
  presets.forEach((b) => {
    const A = BY_ID[b.dataset.a]
    const B = BY_ID[b.dataset.b]
    if (!A || !B) return
    b.innerHTML =
      `<span class="mix__preset-dots" aria-hidden="true"><i style="--pig:${esc(A.hex)}"></i><i style="--pig:${esc(B.hex)}"></i></span>` +
      esc(`${A.name} and ${lowerName(B.name)}`)
  })

  // the paintbox: one radio group per slot, every pigment, oldest first
  const order = byAge(PIGMENTS)
  const picks = [...root.querySelectorAll('.mix__pick')]
  const pans = [] // { id, p, slot, label, canvas, src, draw, w, h, sp }
  picks.forEach((fs) => {
    const slot = fs.dataset.slot
    const box = fs.querySelector('.mix__pans')
    box.innerHTML = order
      .map(
        (p) =>
          `<label class="mix__pan${p.sold ? '' : ' is-archive'}" style="--pig:${esc(p.hex)}">` +
          `<input class="mix__pan-input" type="radio" name="mix-${slot}" value="${esc(p.id)}">` +
          '<span class="mix__pan-paint" aria-hidden="true"><canvas class="mix__pan-canvas"></canvas></span>' +
          `<span class="mix__pan-name">${esc(p.name)}${p.sold ? '' : '<span class="visually-hidden">, archive only</span>'}</span>` +
          '</label>'
      )
      .join('')
    box.querySelectorAll('.mix__pan').forEach((label, k) => {
      const p = order[k]
      pans.push({ id: p.id, p, slot, label, canvas: label.querySelector('canvas'), src: null, draw: null, w: 0, h: 0, sp: RM ? 1 : 0 })
    })
    fs.addEventListener('change', (e) => {
      const v = e.target?.value
      if (!v || !BY_ID[v]) return
      const pan = pans.find((it) => it.slot === slot && it.id === v)
      if (pan) chosen(pan)
      set({ [slot]: v }, { pour: true, announce: true })
    })
  })

  /* -------------------------------------------------------- well geometry */
  let size = 0 // css px
  let N = 0 // field resolution
  let geo = null // per-pixel precomputed fields
  let img = null
  const field = document.createElement('canvas')
  const fg = field.getContext('2d', { willReadFrequently: false })
  const prev = document.createElement('canvas')
  const pg = prev.getContext('2d')
  let hasPrev = false
  const rimLayer = document.createElement('canvas')
  const sheenLayer = document.createElement('canvas')
  const paintLayer = document.createElement('canvas')

  // cosine table: the field needs two cosines per pixel per frame
  const COS_N = 4096
  const COS = new Float32Array(COS_N)
  for (let i = 0; i < COS_N; i++) COS[i] = Math.cos((i / COS_N) * Math.PI * 2)
  const COS_K = COS_N / (Math.PI * 2)

  // the pour comes from the upper-left (A) and lower-right (B) rims
  const ANG_A = (Math.PI * 5) / 4
  const ANG_B = Math.PI / 4

  // periodic 1D value noise on [0, 1): no seam where the angle wraps
  function noiseP(rand, n) {
    const v = new Float32Array(n)
    for (let i = 0; i < n; i++) v[i] = rand() * 2 - 1
    return (t) => {
      const x = (((t % 1) + 1) % 1) * n
      const i = Math.floor(x)
      const f = x - i
      const u = f * f * (3 - 2 * f)
      return v[i % n] + (v[(i + 1) % n] - v[i % n]) * u
    }
  }

  function buildGeo() {
    const n = N
    const R0 = rng(hashStr('mix-well'))
    const nA = noiseP(R0, 9)
    const nB = noise1(R0, 7)
    const nC = noiseP(R0, 13)
    const nD = noiseP(R0, 5)
    const len = n * n
    const rho = new Float32Array(len)
    const theta = new Float32Array(len)
    const w = new Float32Array(len)
    const nz = new Float32Array(len)
    const nz2 = new Float32Array(len)
    const dA = new Float32Array(len)
    const dB = new Float32Array(len)
    const ax = Math.cos(ANG_A)
    const ay = Math.sin(ANG_A)
    const bx = Math.cos(ANG_B)
    const by = Math.sin(ANG_B)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x
        const dx = ((x + 0.5) / n) * 2 - 1
        const dy = ((y + 0.5) / n) * 2 - 1
        const r = Math.hypot(dx, dy)
        const t = Math.atan2(dy, dx)
        rho[i] = r
        theta[i] = t
        const tt = (t + Math.PI) / (Math.PI * 2)
        const rr = Math.min(1, r)
        // smooth, seamless noise in polar coordinates
        const a = nA(tt + rr * 0.21) * 0.55 + nC(tt * 2 - rr * 0.37) * 0.45
        const b = nB(rr * 0.95) * 0.5 + nD(tt + nB(rr) * 0.1) * 0.5
        nz[i] = a
        nz2[i] = b * 0.7 + a * 0.3
        // the stir shears everywhere, most at the centre
        w[i] = (Math.pow(Math.max(0, 1 - r), 1.35) - 0.55 * rr) * (1 + 0.2 * a)
        dA[i] = Math.hypot(dx - ax, dy - ay)
        dB[i] = Math.hypot(dx - bx, dy - by)
      }
    }
    const inside = []
    for (let i = 0; i < len; i++) if (rho[i] <= 1.02) inside.push(i)
    geo = { rho, theta, w, nz, nz2, dA, dB, inside: Int32Array.from(inside) }
    img = fg.createImageData(n, n)
  }

  function layout() {
    const s = Math.round(well.clientWidth)
    if (!s || s === size) return false
    size = s
    const k = dpr()
    canvas.width = Math.round(s * k)
    canvas.height = Math.round(s * k)
    const nextN = Math.max(140, Math.min(ctx.isMobile() ? 200 : 250, Math.round(s * 0.42)))
    if (nextN !== N) {
      N = nextN
      field.width = field.height = N
      prev.width = prev.height = N
      hasPrev = false
      buildGeo()
    }
    paintLayer.width = paintLayer.height = canvas.width
    buildRim()
    buildSheen()
    return true
  }

  let inkC = null
  const ink = () => inkC || (inkC = hexRgb(getComputedStyle(root).getPropertyValue('--ink').trim() || '#151413'))

  const rrect = (c, x, y, w, h, r) => (c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h))

  // engraved porcelain: two hairline rings, hatched shadow on the rim and inside the bowl
  function buildRim() {
    const W = canvas.width
    rimLayer.width = rimLayer.height = W
    const r = rimLayer.getContext('2d')
    const k = dpr()
    const cx = W / 2
    const R = W * 0.39
    const c = ink()
    r.clearRect(0, 0, W, W)
    r.lineWidth = 1 * k
    r.strokeStyle = rgbCss(c, 0.32)
    r.beginPath()
    r.arc(cx, cx, R * 1.035, 0, Math.PI * 2)
    r.stroke()
    r.strokeStyle = rgbCss(c, 0.2)
    r.beginPath()
    r.arc(cx, cx, R * 1.16, 0, Math.PI * 2)
    r.stroke()
    // hatching on the outer rim, lower right (light from the upper left)
    r.lineWidth = 0.75 * k
    for (let a = -0.5; a < Math.PI + 0.5; a += 0.03) {
      const wgt = Math.max(0, Math.cos(a - Math.PI * 0.3))
      if (wgt < 0.12) continue
      const r0 = R * 1.05
      const r1 = R * (1.05 + 0.095 * wgt)
      r.strokeStyle = rgbCss(c, 0.12 + 0.18 * wgt)
      r.beginPath()
      r.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0)
      r.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1)
      r.stroke()
    }
    // inside the bowl: the wall nearest the light is in shade
    for (let a = Math.PI * 0.85; a < Math.PI * 1.9; a += 0.022) {
      const wgt = Math.max(0, Math.cos(a - Math.PI * 1.3))
      if (wgt < 0.35) continue
      const r1 = R * 1.0
      const r0 = R * (1 - 0.16 * wgt)
      r.strokeStyle = rgbCss(c, 0.06 + 0.12 * wgt)
      r.beginPath()
      r.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0)
      r.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1)
      r.stroke()
    }
  }

  // the light on a recessed pool of wet paint: a soft window reflection, the
  // rim's shadow on the near side, a bright meniscus on the far side
  function buildSheen() {
    const W = canvas.width
    sheenLayer.width = sheenLayer.height = W
    const s = sheenLayer.getContext('2d')
    const cx = W / 2
    const R = W * 0.39
    const FAR = W * 4 // draw shapes off-canvas and keep only their blurred shadow
    s.clearRect(0, 0, W, W)
    s.save()
    s.beginPath()
    s.arc(cx, cx, R, 0, Math.PI * 2)
    s.clip()
    // the rim's shadow falls on the paint along the upper left
    s.save()
    s.shadowColor = 'rgb(21 20 19 / 0.34)'
    s.shadowBlur = R * 0.05
    s.shadowOffsetX = FAR
    s.beginPath()
    s.arc(cx - FAR, cx, R * 1.2, 0, Math.PI * 2)
    s.arc(cx - FAR + R * 0.035, cx + R * 0.045, R * 0.995, 0, Math.PI * 2, true)
    s.fill('evenodd')
    s.restore()
    // a window, reflected in the flat surface
    s.save()
    s.shadowColor = 'rgb(255 255 252 / 0.16)'
    s.shadowBlur = R * 0.11
    s.shadowOffsetX = FAR
    s.translate(cx - FAR - R * 0.28, cx - R * 0.38)
    s.rotate(-0.18)
    s.transform(1, 0, -0.25, 1, 0, 0)
    s.fillStyle = '#fff'
    s.beginPath()
    rrect(s, -R * 0.26, -R * 0.13, R * 0.52, R * 0.26, R * 0.05)
    s.fill()
    s.restore()
    // the meniscus: paint climbs the porcelain and catches the light, lower right
    const gr = s.createLinearGradient(cx + R * 0.7, cx + R * 0.7, cx - R * 0.2, cx - R * 0.2)
    gr.addColorStop(0, 'rgb(255 255 252 / 0.42)')
    gr.addColorStop(1, 'rgb(255 255 252 / 0)')
    s.strokeStyle = gr
    s.lineWidth = Math.max(1, R * 0.012)
    s.beginPath()
    s.arc(cx, cx, R * 0.992, -0.6, Math.PI * 0.95)
    s.stroke()
    s.restore()
  }

  /* -------------------------------------------------------- well state */
  const st = { fill: 0, twist: 0, warp: 0, edge: 0.03, contrast: 1, rShow: S.r, ripple: 0 }
  let flat = false // fully mixed: one colour
  let poured = false
  let pendingPour = false
  let visible = false
  let dirty = true
  let hl = { x: 0, y: 0, tx: 0, ty: 0 }
  let pourTl = null
  let fieldStale = true
  const RESIDUE = 0.035 // settled paint keeps a trace of its streaks, as real paint does

  function computeField() {
    const { theta, w, nz, nz2, dA, dB, inside } = geo
    const d = img.data
    const r = st.rShow
    const tau = Math.cos(Math.PI * r)
    const e = Math.max(0.02, st.edge)
    const inv2e = 1 / (2 * e)
    const tw = st.twist
    const wp = st.warp
    const con = st.contrast
    const fill = st.fill
    const harm = Math.min(1, tw / 3) * 0.42
    const norm = 1 / (1 + harm)
    const filled = fill > 2.2
    for (let j = 0, m = inside.length; j < m; j++) {
      const i = inside[j]
      const o = i << 2
      const phi = theta[i] + tw * w[i] + wp * nz2[i] - ANG_B
      const v = (COS[(phi * COS_K) & 4095] + harm * COS[((3 * phi + 2.2 * nz[i]) * COS_K) & 4095]) * norm
      let s = (v - tau + e) * inv2e
      s = s < 0 ? 0 : s > 1 ? 1 : s * s * (3 - 2 * s)
      const k = (((r + (s - r) * con) * LUT_N + 0.5) | 0) * 3
      // a soft fold where two streaks meet
      const fold = 1 - 0.08 * con * (1 - Math.abs(2 * s - 1))
      d[o] = lut[k] * fold
      d[o + 1] = lut[k + 1] * fold
      d[o + 2] = lut[k + 2] * fold
      if (filled) {
        d[o + 3] = 255
        continue
      }
      // the pour: each colour spreads from its own rim
      const a = (fill - (s < 0.5 ? dA[i] : dB[i]) - 0.06 * nz[i]) * 14.3
      d[o + 3] = a <= 0 ? 0 : a >= 1 ? 255 : a * 255
    }
    fg.putImageData(img, 0, 0)
  }

  function render() {
    if (!size || !geo) return
    const W = canvas.width
    const cx = W / 2
    const R = W * 0.39
    g.clearRect(0, 0, W, W)
    g.drawImage(rimLayer, 0, 0)

    const anyPaint = flat || st.fill > 0 || hasPrev
    if (anyPaint) {
      const p = paintLayer.getContext('2d')
      p.clearRect(0, 0, W, W)
      p.save()
      p.beginPath()
      p.arc(cx, cx, R, 0, Math.PI * 2)
      p.clip()
      p.imageSmoothingEnabled = true
      p.imageSmoothingQuality = 'high'
      if (flat) {
        // settled: the field is cached, with the faintest streaks left in it
        if (fieldStale) {
          computeField()
          fieldStale = false
        }
        p.drawImage(field, cx - R, cx - R, R * 2, R * 2)
      } else {
        if (hasPrev) p.drawImage(prev, cx - R, cx - R, R * 2, R * 2)
        if (st.fill > 0) {
          computeField()
          p.drawImage(field, cx - R, cx - R, R * 2, R * 2)
        }
      }
      // light and depth sit only on the paint itself
      p.globalCompositeOperation = 'source-atop'
      const deep = shade(lutAt(st.rShow), -0.35)
      const gr = p.createRadialGradient(cx, cx, R * 0.86, cx, cx, R)
      gr.addColorStop(0, rgbCss(deep, 0))
      gr.addColorStop(1, rgbCss(deep, 0.42))
      p.fillStyle = gr
      p.fillRect(cx - R, cx - R, R * 2, R * 2)
      if (st.ripple > 0.01) {
        const k = dpr()
        for (let j = 0; j < 3; j++) {
          const t = (1 - st.ripple + j * 0.18) % 1
          p.strokeStyle = `rgb(255 255 252 / ${(0.22 * st.ripple * (1 - t)).toFixed(3)})`
          p.lineWidth = 1.4 * k
          p.beginPath()
          p.arc(cx, cx, R * (0.08 + t * 0.9), 0, Math.PI * 2)
          p.stroke()
        }
      }
      p.drawImage(sheenLayer, hl.x * R * 0.05, hl.y * R * 0.05)
      p.restore()
      g.drawImage(paintLayer, 0, 0)
    }
    drawLeaders(cx, R)
  }

  function drawLeaders(cx, R) {
    const k = dpr()
    const box = canvas.getBoundingClientRect()
    if (!box.width) return
    const sc = canvas.width / box.width
    const c = ink()
    g.strokeStyle = rgbCss(c, 0.45)
    g.fillStyle = rgbCss(c, 0.7)
    g.lineWidth = 1 * k
    const line = (tag, ang, side) => {
      const t = tag.getBoundingClientRect()
      if (!t.width) return
      // side -1: label sits up-left of the dish; +1: down-right
      const sx = side < 0 ? (t.right - box.left) * sc + 12 * k : (t.left - box.left) * sc - 12 * k
      const sy = (t.top - box.top + t.height * 0.3) * sc
      const ex = cx + Math.cos(ang) * R * 1.035
      const ey = cx + Math.sin(ang) * R * 1.035
      const elbowX = ex + (sy - ey) // a 45 degree run into the rim
      g.beginPath()
      g.moveTo(sx, sy)
      if (side < 0 ? elbowX > sx : elbowX < sx) g.lineTo(elbowX, sy)
      g.lineTo(ex, ey)
      g.stroke()
      g.beginPath()
      g.arc(ex, ey, 2.2 * k, 0, Math.PI * 2)
      g.fill()
    }
    line(tagA, ANG_A, -1)
    line(tagB, ANG_B, 1)
  }

  /* -------------------------------------------------------- pour */
  function snapshotPrev() {
    // keep what is in the well now; the new pour spreads over it
    if (!N) return
    if (flat) {
      pg.clearRect(0, 0, N, N)
      pg.drawImage(field, 0, 0)
      hasPrev = true
    } else if (st.fill > 0) {
      if (!hasPrev) pg.clearRect(0, 0, N, N)
      pg.drawImage(field, 0, 0)
      hasPrev = true
    }
  }

  function settle() {
    flat = true
    hasPrev = false
    Object.assign(st, { fill: 2.4, twist: 11, warp: 0.9, edge: 0.2, contrast: RESIDUE })
    fieldStale = true
    dirty = true
  }

  function pour() {
    pendingPour = false
    poured = true
    if (!geo) layout()
    pourTl?.kill()
    if (RM) {
      buildLut()
      st.rShow = S.r
      settle()
      return
    }
    snapshotPrev()
    buildLut()
    flat = false
    Object.assign(st, { fill: 0, twist: 0, warp: 0, edge: 0.03, contrast: 1, rShow: S.r })
    dirty = true
    pourTl = gsap
      .timeline({ onUpdate: () => (dirty = true), onComplete: settle })
      .to(st, { fill: 2.4, duration: 1.5, ease: 'power2.out' }, 0)
      .to(st, { twist: 11, duration: 3.8, ease: 'power2.inOut' }, 0.35)
      .to(st, { warp: 0.9, duration: 3.4, ease: 'sine.inOut' }, 0.2)
      .to(st, { edge: 0.2, duration: 3.1, ease: 'power2.in' }, 0.7)
      .to(st, { contrast: RESIDUE, duration: 2.1, ease: 'power2.inOut' }, 1.75)
      .call(() => (hasPrev = false), null, 1.4)
    dropNearWell()
  }

  function stir() {
    // ratio change on settled paint: more of one colour, stirred in
    if (RM || !flat) {
      st.rShow = S.r
      fieldStale = dirty = true
      return
    }
    gsap.to(st, {
      rShow: S.r,
      duration: 0.7,
      ease: 'power3.out',
      overwrite: 'auto',
      onUpdate: () => (fieldStale = dirty = true),
    })
    st.ripple = 1
    gsap.to(st, { ripple: 0, duration: 1.4, ease: 'power2.out', overwrite: 'auto', onUpdate: () => (dirty = true) })
  }

  function dropNearWell() {
    if (!visible) return
    const b = canvas.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const cx = b.left + b.width / 2
    const cy = b.top + b.height / 2
    const R = b.width * 0.39 * (ctx.isMobile() ? 1.08 : 1.25)
    const at = (ang) => ({ x: (cx + Math.cos(ang) * R) / vw, y: (cy + Math.sin(ang) * R) / vh })
    const a = at(ANG_A)
    const bb = at(ANG_B)
    const amtA = 0.3 + 0.35 * (1 - S.r)
    const amtB = 0.3 + 0.35 * S.r
    ctx.palette?.drop(S.a, { ...a, amount: amtA, radius: 0.05, vx: 0.25, vy: 0.25 })
    setTimeout(() => ctx.palette?.drop(S.b, { ...bb, amount: amtB, radius: 0.05, vx: -0.25, vy: -0.25 }), 140)
  }

  /* -------------------------------------------------------- strips + chips */
  function paintStrips() {
    const k = dpr()
    for (const [cv, paint] of [
      [stripPaint, true],
      [stripLight, false],
    ]) {
      const w = Math.round(cv.clientWidth * k)
      const h = Math.round(cv.clientHeight * k)
      if (!w || !h) continue
      cv.width = w
      cv.height = h
      const c = cv.getContext('2d')
      c.clearRect(0, 0, w, h)
      if (paint) {
        // a palette-knife drawdown: KM colour at every ratio, ragged top and bottom
        const R0 = rng(hashStr(S.a + S.b))
        const top = noise1(R0, 40)
        const bot = noise1(R0, 40)
        c.save()
        c.beginPath()
        for (let i = 0; i <= 80; i++) c.lineTo((w * i) / 80, h * 0.08 + top(i / 80) * h * 0.07)
        for (let i = 80; i >= 0; i--) c.lineTo((w * i) / 80, h * 0.92 + bot(i / 80) * h * 0.07)
        c.closePath()
        c.clip()
        for (let x = 0; x < w; x += 2) {
          c.fillStyle = rgbCss(lutAt(x / (w - 1)))
          c.fillRect(x, 0, 2, h)
        }
        // knife streaks
        for (let i = 0; i < 26; i++) {
          const y = R0() * h
          c.fillStyle = R0() < 0.5 ? 'rgb(255 255 250 / 0.07)' : 'rgb(10 9 8 / 0.07)'
          c.fillRect(0, y, w, (0.5 + R0() * 1.5) * k)
        }
        c.restore()
      } else {
        // a screen: flat, exact, one pixel per step
        const A = hexRgb(BY_ID[S.a].hex)
        const B = hexRgb(BY_ID[S.b].hex)
        for (let x = 0; x < w; x++) {
          const t = x / (w - 1)
          c.fillStyle = rgbCss(A.map((v, i) => v + (B[i] - v) * t))
          c.fillRect(x, 0, 1, h)
        }
      }
    }
  }

  /* -------------------------------------------------------- the paintbox */
  function paintPan(it) {
    const k = dpr()
    const cw = it.canvas.clientWidth
    const ch = it.canvas.clientHeight
    if (!cw || !ch) return
    const w = Math.round(cw * k)
    const h = Math.round(ch * k)
    if (it.src && w === it.w && h === it.h) return
    it.w = it.canvas.width = w
    it.h = it.canvas.height = h
    const src = document.createElement('canvas')
    src.width = w
    src.height = h
    paintStroke(src.getContext('2d'), {
      x0: w * 0.1,
      x1: w * 0.95,
      y: h * 0.5,
      h: h * 0.6,
      color: it.p.hex,
      seed: hashStr(it.id + 'pan'),
      dry: 0.34,
      s: k,
    })
    it.src = src
    it.draw = makeReveal(it.canvas, src, hashStr(it.id + 'pan'))
    it.draw(it.sp)
  }
  const paintPans = () => pans.forEach(paintPan)

  // the box is brushed out, oldest first, the first time it comes into view
  let pansShown = RM
  function showPans() {
    if (pansShown) return
    pansShown = true
    paintPans()
    const n = order.length
    pans.forEach((it) => {
      const k = order.indexOf(it.p)
      const o = { p: 0 }
      it.tw = gsap.to(o, {
        p: 1,
        duration: 0.85,
        ease: 'power2.inOut',
        delay: 0.1 + (k / n) * 0.9 + (it.slot === 'b' ? 0.12 : 0),
        onUpdate: () => {
          it.sp = o.p
          it.draw?.(o.p)
        },
      })
    })
  }

  // choosing a chip: it is brushed out again, and a drop of the pigment runs
  // from the chip towards the well, through the water behind the page
  function chosen(it) {
    if (RM) return
    if (it.draw) {
      const o = { p: 0.08 }
      it.tw?.kill()
      it.tw = gsap.to(o, {
        p: 1,
        duration: 0.7,
        ease: 'power2.out',
        onUpdate: () => {
          it.sp = o.p
          it.draw(o.p)
        },
      })
    }
    const r = it.label.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (r.bottom < 0 || r.top > vh) return
    const x = (r.left + r.width / 2) / vw
    const y = (r.top + r.height * 0.3) / vh
    const b = well.getBoundingClientRect()
    let dx = (b.left + b.width / 2) / vw - x
    let dy = (b.top + b.height / 2) / vh - y
    const m = Math.hypot(dx, dy) || 1
    dx /= m
    dy /= m
    ctx.palette?.drop(it.id, { x, y, amount: 0.42, radius: 0.035, vx: dx * 0.7, vy: dy * 0.7 })
  }

  function paintChip(hex) {
    const k = dpr()
    const w = Math.round(chipPaint.clientWidth * k)
    const h = Math.round(chipPaint.clientHeight * k)
    if (!w || !h) return
    chipPaint.width = w
    chipPaint.height = h
    const c = chipPaint.getContext('2d')
    c.clearRect(0, 0, w, h)
    paintStroke(c, { x0: w * 0.08, x1: w * 0.97, y: h * 0.5, h: h * 0.62, color: hex, seed: hashStr(hex), dry: 0.32, s: k })
  }

  /* -------------------------------------------------------- state → DOM */
  let announceT = 0
  function update({ announce = false } = {}) {
    const A = BY_ID[S.a]
    const B = BY_ID[S.b]
    const pc = Math.round(S.r * 100)
    const paintHex = km(S.a, S.b, S.r)
    const lightHex = avg(S.a, S.b, S.r)
    const paintDesc = describe(paintHex)
    const lightDesc = describe(lightHex)
    const v = verdict(paintHex, lightHex)

    root.style.setProperty('--mix-paint', paintHex)
    root.style.setProperty('--mix-light', lightHex)
    root.style.setProperty('--mix-r', S.r)
    out('paint-hex').textContent = paintHex
    out('paint-desc').textContent = paintDesc
    out('light-hex').textContent = lightHex
    out('light-desc').textContent = lightDesc
    out('verdict').textContent = v
    out('name-a').textContent = A.name
    out('name-b').textContent = B.name
    out('end-a').textContent = `All ${lowerName(A.name)}`
    out('end-b').textContent = `All ${lowerName(B.name)}`
    tagA.querySelector('.mix__tag-name').textContent = A.name
    tagB.querySelector('.mix__tag-name').textContent = B.name
    tagA.querySelector('.mix__tag-pc').textContent = `${100 - pc}%`
    tagB.querySelector('.mix__tag-pc').textContent = `${pc}%`
    chipLight.style.background = lightHex

    const ratioText =
      S.a === S.b
        ? `All ${lowerName(A.name)}`
        : pc === 50
          ? 'Half and half'
          : pc === 0
            ? `All ${lowerName(A.name)}`
            : pc === 100
              ? `All ${lowerName(B.name)}`
              : `${100 - pc}% ${lowerName(A.name)}, ${pc}% ${lowerName(B.name)}`
    out('ratio').textContent = ratioText
    range.value = String(pc)
    range.setAttribute(
      'aria-valuetext',
      pc === 50 && S.a !== S.b ? `Half ${lowerName(A.name)}, half ${lowerName(B.name)}` : ratioText
    )

    // radios
    for (const fs of picks) {
      const want = S[fs.dataset.slot]
      fs.querySelectorAll('input').forEach((inp) => (inp.checked = inp.value === want))
    }
    presets.forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.a === S.a && b.dataset.b === S.b && +b.dataset.r === pc))
    )
    paintChip(paintHex)

    if (announce && status) {
      clearTimeout(announceT)
      announceT = setTimeout(() => {
        status.textContent = `${ratioText}. Mixed as paint: ${paintDesc.toLowerCase()}. Averaged like light: ${lightDesc.toLowerCase()}. ${v}`
      }, 250)
    }
    dirty = true
  }

  function set(next, { pour: doPour = false, announce = false } = {}) {
    const pairChanged = (next.a && next.a !== S.a) || (next.b && next.b !== S.b)
    Object.assign(S, next)
    buildLut()
    paintStrips()
    update({ announce })
    if (pairChanged || doPour) {
      if (visible) pour()
      else pendingPour = true
    }
  }

  /* -------------------------------------------------------- controls */
  range.addEventListener('input', () => {
    const r = +range.value / 100
    const d = r - S.r
    S.r = r
    update()
    stir()
    stirDish(d)
  })

  // moving the ratio stirs the water around the well, as a knife would
  function stirDish(d) {
    if (RM || !visible || !d) return
    const b = canvas.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const cx = b.left + b.width / 2
    const cy = b.top + b.height / 2
    const R = b.width * 0.39 * 1.3
    const k = Math.max(-0.035, Math.min(0.035, d * 0.6))
    for (const ang of [ANG_A, ANG_B]) {
      ctx.emit('stir', {
        x: (cx + Math.cos(ang) * R) / vw,
        y: (cy + Math.sin(ang) * R) / vh,
        dx: -Math.sin(ang) * k,
        dy: Math.cos(ang) * k,
        strength: 1.4,
        radius: 0.07,
      })
    }
  }
  range.addEventListener('change', () => {
    update({ announce: true })
    if (visible) dropNearWell()
  })

  // Touch: a native range jumps to wherever a finger lands, so a swipe up the
  // page across the strips would change the ratio. Where the main pointer is
  // coarse, a pad over the strips (mix.css) takes the finger instead: a
  // sideways drag or a tap sets the ratio, a vertical swipe only scrolls the
  // page (touch-action: pan-y). Mouse and keyboard keep the input itself, and
  // the pad drives it, so its input and change events run as before.
  const pad = document.createElement('span')
  pad.className = 'mix__range-pad'
  pad.setAttribute('aria-hidden', 'true')
  // without pointer events the pad would only be in the way: leave the input
  if (window.PointerEvent) range.after(pad)
  const THUMB = 28 // the input's thumb (mix.css): its centre runs from 14 px to width - 14 px
  const SLOP = 8 // px a touch moves before it counts as a drag or a scroll
  let grab = null // { id, x0, y0, v0, on }
  let dragged = false // the last press was a drag, so its click is not a tap
  const commit = (v0) => range.value !== v0 && range.dispatchEvent(new Event('change', { bubbles: true }))
  function slideTo(clientX) {
    const b = pad.getBoundingClientRect()
    const v = Math.min(100, Math.max(0, Math.round(((clientX - b.left - THUMB / 2) / Math.max(1, b.width - THUMB)) * 100)))
    if (v === +range.value) return
    range.value = String(v)
    range.dispatchEvent(new Event('input', { bubbles: true }))
  }
  function take(e) {
    grab.on = true
    try {
      pad.setPointerCapture(e.pointerId)
    } catch {}
    // a mouse press focuses the input, as on the input itself; a finger
    // leaves focus where it is (focusing from script would show the
    // keyboard's focus ring on the knob; focusVisible: false keeps a mouse
    // press from showing it too)
    if (e.pointerType === 'mouse' && document.activeElement !== range) range.focus({ preventScroll: true, focusVisible: false })
    slideTo(e.clientX)
  }
  function letGo(e) {
    if (!grab || e.pointerId !== grab.id) return
    const g0 = grab
    grab = null
    if (!g0.on) return
    dragged = true
    commit(g0.v0)
  }
  pad.addEventListener('pointerdown', (e) => {
    if (grab || !e.isPrimary || e.button > 0) return
    dragged = false
    grab = { id: e.pointerId, x0: e.clientX, y0: e.clientY, v0: range.value, on: false }
    if (e.pointerType === 'mouse') {
      e.preventDefault() // a mouse drags at once, as on the input, and selects no text
      take(e)
    }
  })
  pad.addEventListener('pointermove', (e) => {
    if (!grab || e.pointerId !== grab.id) return
    if (grab.on) return slideTo(e.clientX)
    const dx = Math.abs(e.clientX - grab.x0)
    const dy = Math.abs(e.clientY - grab.y0)
    if (dy >= SLOP && dy >= dx) grab = null // up or down: the page scrolls, the ratio stays
    else if (dx >= SLOP) take(e)
  })
  pad.addEventListener('pointerup', letGo)
  pad.addEventListener('pointercancel', letGo)
  // a tap (browsers send no click for a swipe, or for a touch that stops a
  // fling) puts the ratio where the finger landed, as a slider does
  pad.addEventListener('click', (e) => {
    if (dragged) {
      dragged = false
      return
    }
    const v0 = range.value
    slideTo(e.clientX)
    commit(v0)
  })

  presets.forEach((b) =>
    b.addEventListener('click', () => {
      set({ a: b.dataset.a, b: b.dataset.b, r: +b.dataset.r / 100 }, { pour: true, announce: true })
    })
  )

  ctx.on('select-pigment', ({ id } = {}) => {
    if (!BY_ID[id]) return
    let b = S.b
    if (b === id) b = id === 'yellow-ochre' ? 'ultramarine' : 'yellow-ochre'
    // a ratio chosen for the old pair means nothing for the new one, and at
    // either end it would leave the handed-over pigment out: start it at half
    set({ a: id, b, r: 0.5 }, { pour: true, announce: true })
  })

  // pointer: the light on the paint shifts as you move, like tilting the dish
  well.addEventListener('pointermove', (e) => {
    if (RM) return
    const b = well.getBoundingClientRect()
    hl.tx = -((e.clientX - b.left) / b.width - 0.5) * 2
    hl.ty = -((e.clientY - b.top) / b.height - 0.5) * 2
  })
  well.addEventListener('pointerleave', () => {
    hl.tx = 0
    hl.ty = 0
  })

  /* -------------------------------------------------------- loop */
  function tick() {
    if (!visible) return
    const ex = hl.tx - hl.x
    const ey = hl.ty - hl.y
    if (Math.abs(ex) > 0.002 || Math.abs(ey) > 0.002) {
      hl.x += ex * 0.08
      hl.y += ey * 0.08
      dirty = true
    }
    if (!dirty) return
    dirty = false
    render()
  }
  gsap.ticker.add(tick)

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        visible = e.isIntersecting
        if (visible) {
          dirty = true
          if (!poured || pendingPour) {
            // let the visitor arrive before the paint goes in
            if (!RM && !poured) setTimeout(() => visible && (pendingPour || !poured) && pour(), 250)
            else pour()
          }
        }
      }
    },
    { threshold: 0.35 }
  )

  let rto = 0
  const ro = new ResizeObserver(() => {
    clearTimeout(rto)
    rto = setTimeout(() => {
      if (layout()) {
        if (!flat && !pourTl?.isActive()) hasPrev = false
        fieldStale = dirty = true
      }
      paintStrips()
      paintChip(km(S.a, S.b, S.r))
      paintPans()
      dirty = true
    }, 120)
  })
  const picksBox = $('.mix__picks')
  const pio = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        showPans()
        pio.disconnect()
      }
    },
    { threshold: 0.15 }
  )

  // heavy work waits for the page to be ready
  const start = () => {
    layout()
    buildLut()
    paintStrips()
    update()
    if (RM) {
      poured = true
      settle()
    }
    paintPans()
    io.observe(well)
    ro.observe(well)
    ro.observe(stripPaint)
    if (picksBox) {
      ro.observe(picksBox)
      pio.observe(picksBox)
    }
    dirty = true
  }
  update()
  ctx.ready.then(start)
  document.fonts?.ready.then(() => (dirty = true))
}
