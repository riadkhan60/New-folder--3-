/**
 * shop.js — the shelf, the sets and the order slip.
 *
 * Signature: every jar is drawn on its own canvas (clear glass, a ribbed ink
 * lid, the dry pigment inside with its grain, a sloped surface and a little
 * heap). The nine jars stand on one continuous shelf (two rows on a desktop,
 * three below); as a row comes into view its plank draws itself in, the lids
 * come off, a thin stream of powder pours in from above and each jar fills,
 * the heap slumps to rest and the lid is screwed back on. Hover tilts a jar
 * towards the hand and the powder slides after it. "Add to order" lifts the
 * jar and lets a pinch of the pigment fall into the dish; placing the order
 * pours every colour in it.
 *
 * Names, formulas, sizes and prices on the shelf are re-read from
 * pigments.js at start-up, so the partial can never drift from the facts.
 *
 * Bus:
 *   listens  'order'         { id, qty }   id = a sold pigment id, or
 *                                          'set-earths' | 'set-blues' | 'set-library'
 *   emits    'order'         { id, qty: 1 } from the shop's own buttons
 *   emits    'order-change'  { count, jars, sets, total, lines: [{ id, qty, price }] }
 *   emits    'drop'          via ctx.palette.drop (pinches of pigment)
 */
import '../styles/shop.css'

/* ------------------------------------------------------------------ data */
// Jar geometry in units of the body width W. Must match --th/--lt/--lh in shop.css.
const KINDS = {
  l: { body: 1.06, neck: 0.07, lid: 0.22, neckW: 0.84, rb: 0.08, rs: 0.16, fill: 0.74, t: 0.034, tb: 0.085, ribs: true },
  m: { body: 1.04, neck: 0.07, lid: 0.22, neckW: 0.82, rb: 0.08, rs: 0.16, fill: 0.74, t: 0.036, tb: 0.085, ribs: true },
  s: { body: 1.0, neck: 0.07, lid: 0.23, neckW: 0.8, rb: 0.09, rs: 0.16, fill: 0.74, t: 0.038, tb: 0.09, ribs: true },
  xs: { body: 0.98, neck: 0.07, lid: 0.24, neckW: 0.8, rb: 0.1, rs: 0.17, fill: 0.74, t: 0.04, tb: 0.09, ribs: true },
  vial: { body: 2.3, neck: 0.14, lid: 0.5, neckW: 0.72, rb: 0.5, rs: 0.24, fill: 0.68, t: 0.07, tb: 0.12, ribs: false },
}
// relative jar widths (for the sets, seen from above)
const REL = { l: 1, m: 0.853, s: 0.72, xs: 0.613, vial: 0.36 }
// how coarse each powder looks: 1 = sparkling crystals, 0 = a fine lake
const GRAIN = {
  'yellow-ochre': 0.7,
  'red-ochre': 0.62,
  'egyptian-blue': 0.95,
  'tyrian-purple': 0.3,
  malachite: 0.85,
  ultramarine: 1,
  carmine: 0.25,
  indigo: 0.35,
  'bone-black': 0.45,
}
const SET_DEFS = {
  'set-earths': { name: 'The earths', unit: 'Three jars', price: 36, ids: ['yellow-ochre', 'red-ochre', 'bone-black'] },
  'set-blues': { name: 'The blues', unit: 'Three jars', price: 220, ids: ['egyptian-blue', 'ultramarine', 'indigo'] },
  'set-library': {
    name: 'The full library',
    unit: 'Nine jars',
    price: 2800, // cheaper than the nine jars bought separately (£2,936)
    ids: ['yellow-ochre', 'red-ochre', 'bone-black', 'indigo', 'malachite', 'egyptian-blue', 'tyrian-purple', 'ultramarine', 'carmine'],
  },
}
const KIND_OF = {
  'yellow-ochre': 'l',
  'red-ochre': 'l',
  'bone-black': 'l',
  indigo: 'm',
  malachite: 'm',
  'egyptian-blue': 'm',
  'tyrian-purple': 'vial',
  ultramarine: 'xs',
  carmine: 's',
}
const TYRIAN = ['tyrian-purple', 'set-library'] // two grams a year, shared between these
const MAX_EACH = 20

/* ------------------------------------------------------------------ utils */
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(lerp(v, b[i], t)))
const css = (c, a = 1) => `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`
const INK = [21, 20, 19]
const WHITE = [255, 255, 255]
const INK_HEX = '#151413'
const PAPER_HEX = '#f3f2ee'
const lum = (h) => {
  const [r, g, b] = rgbOf(h).map((v) => {
    v /= 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const x = lum(a)
  const y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
/** "Added to order": the jar's masstone rises into the button, lettered in
 *  the pigment's own ink, or else in ink or paper, whichever reads (4.5:1).
 *  Where nothing reads on the masstone (malachite's mid green), its wash
 *  rises instead, lettered in ink. Returns [fill, letters]. */
function addColours(p) {
  const pairs = [[p.hex, p.ink], [p.hex, INK_HEX], [p.hex, PAPER_HEX], [p.tint, INK_HEX]]
  return pairs.find(([f, l]) => contrast(f, l) >= 4.5) || pairs[0]
}
function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
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
// one small job per frame, so building the shelf never blocks a scroll
const nextFrame = (fn) => requestAnimationFrame(() => setTimeout(fn, 0))

/* --------------------------------------------------------- powder texture */
const texCache = new Map()
/** A grainy swatch of dry pigment, w × h device pixels. */
function powderTexture(p, w, h, seedExtra = '') {
  const key = `${p.id}|${w}|${h}|${seedExtra}`
  if (texCache.has(key)) return texCache.get(key)
  const rnd = rng(hash(key))
  const gr = GRAIN[p.id] ?? 0.6
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  g.fillStyle = p.hex
  g.fillRect(0, 0, w, h)

  // coarse mottling: clumps and drifts in the powder
  const mk = (cw, ch, amp) => {
    const m = document.createElement('canvas')
    m.width = cw
    m.height = ch
    const mg = m.getContext('2d')
    const id = mg.createImageData(cw, ch)
    for (let i = 0; i < id.data.length; i += 4) {
      const v = 128 + (rnd() - 0.5) * amp
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v
      id.data[i + 3] = 255
    }
    mg.putImageData(id, 0, 0)
    return m
  }
  g.imageSmoothingEnabled = true
  g.globalCompositeOperation = 'soft-light'
  g.globalAlpha = 0.9
  g.drawImage(mk(Math.max(2, (w / 9) | 0), Math.max(2, (h / 9) | 0), 120), 0, 0, w, h)
  g.globalAlpha = 0.8
  g.drawImage(mk(Math.max(2, (w / 3) | 0), Math.max(2, (h / 3) | 0), 110 + gr * 60), 0, 0, w, h)
  // fine grain, per pixel
  g.imageSmoothingEnabled = false
  g.globalAlpha = 0.55 + gr * 0.3
  g.drawImage(mk(w, h, 150 + gr * 105), 0, 0)
  g.globalCompositeOperation = 'source-over'
  g.globalAlpha = 1

  // specks: crystals that catch the light, and darker grit
  const base = rgbOf(p.hex)
  const tint = rgbOf(p.tint)
  const light = mixRgb(tint, WHITE, 0.25)
  const dark = mixRgb(base, INK, 0.55)
  const n = Math.round(w * h * (0.0025 + gr * 0.006))
  for (let i = 0; i < n; i++) {
    const x = rnd() * w
    const y = rnd() * h
    const s = rnd() < 0.25 ? 2 : 1
    const isLight = rnd() < 0.35 + gr * 0.3
    g.fillStyle = isLight ? css(light, 0.35 + rnd() * 0.5 * gr + 0.1) : css(dark, 0.3 + rnd() * 0.4)
    g.fillRect(x, y, s, s)
  }
  texCache.set(key, c)
  return c
}

/* ------------------------------------------------------------------ jar */
class Jar {
  constructor(li, ctx) {
    this.li = li
    this.ctx = ctx
    this.id = li.dataset.id
    this.kind = li.dataset.kind
    this.k = KINDS[this.kind]
    this.p = ctx.pigments.BY_ID[this.id]
    this.body = li.querySelector('.jar__body')
    this.canvas = li.querySelector('.jar__canvas')
    this.shadow = li.querySelector('.jar__shadow')
    this.g = this.canvas.getContext('2d')
    const r = rng(hash(this.id))
    this.rnd = r
    this.side = r() < 0.5 ? -1 : 1
    // the resting state: a slight slope and a small heap, off-centre
    this.rest = {
      slope: this.side * (0.05 + r() * 0.035),
      mx: -this.side * (0.08 + r() * 0.08),
      mh: 0.03 + r() * 0.02,
      fill: 0.97 + r() * 0.04,
    }
    this.s = { fill: 0, mound: 0, slope: 0, shift: 0, lid: 0, turn: 0, stream: 0, dust: 0, push: 0 }
    this.built = false
    this.filled = false
    this.W = 0
    this.grains = Array.from({ length: 90 }, () => ({ ph: r(), xj: r() * 2 - 1, sz: 0.8 + r() * 1.2, sp: 0.85 + r() * 0.3 }))
    this.dustPts = Array.from({ length: 110 }, () => ({ x: r() * 2 - 1, y: Math.pow(r(), 2.6), a: 0.12 + r() * 0.3, s: 0.5 + r() * 0.7 }))
  }

  measure() {
    const W = this.body.offsetWidth
    if (!W) return false
    const k = this.k
    const dpr = this.ctx.dpr
    const bodyH = k.body * W
    const neckH = k.neck * W
    const lidH = k.lid * W
    const Htot = bodyH + neckH + lidH
    const padX = 0.26 * W
    const padT = 0.98 * W
    const padB = 0.04 * W
    const cw = W + padX * 2
    const ch = Htot + padT + padB
    Object.assign(this.canvas.style, {
      left: `${-padX}px`,
      top: `${-padT}px`,
      width: `${cw}px`,
      height: `${ch}px`,
    })
    this.canvas.width = Math.round(cw * dpr)
    this.canvas.height = Math.round(ch * dpr)
    this.G = {
      W,
      hw: W / 2,
      bodyH,
      neckH,
      lidH,
      Htot,
      ox: padX + W / 2,
      oy: padT + Htot,
      padT,
      t: Math.max(1.4, k.t * W),
      tb: k.tb * W,
      nw: (k.neckW * W) / 2,
      rb: Math.min(k.rb * W, W / 2),
      rs: k.rs * W,
      dpr,
    }
    this.W = W
    this.tex = powderTexture(this.p, Math.max(8, Math.round(W * dpr)), Math.max(8, Math.round(bodyH * dpr)), this.kind)
    return true
  }

  build() {
    if (this.built) return
    if (!this.measure()) return
    this.built = true
    this.draw()
  }

  /** outline of the glass; ins = wall inset, bIns = base inset, tIns = shoulder inset */
  path(c, ins = 0, bIns = 0, tIns = 0) {
    const G = this.G
    const hw = G.hw - ins
    const nw = G.nw - ins
    const top = -G.bodyH + tIns
    const rs = Math.max(2, G.rs - tIns)
    const bottom = -bIns
    const rb = Math.min(G.rb, hw)
    c.beginPath()
    c.moveTo(-nw, -G.bodyH - G.neckH - 1)
    c.lineTo(-nw, top)
    c.quadraticCurveTo(-hw, top, -hw, top + rs)
    c.lineTo(-hw, bottom - rb)
    c.quadraticCurveTo(-hw, bottom, -hw + rb, bottom)
    c.lineTo(hw - rb, bottom)
    c.quadraticCurveTo(hw, bottom, hw, bottom - rb)
    c.lineTo(hw, top + rs)
    c.quadraticCurveTo(hw, top, nw, top)
    c.lineTo(nw, -G.bodyH - G.neckH - 1)
    c.closePath()
  }

  draw(now = performance.now()) {
    if (!this.built) return
    const c = this.g
    const G = this.G
    const s = this.s
    const p = this.p
    const W = G.W
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, this.canvas.width, this.canvas.height)
    c.setTransform(G.dpr, 0, 0, G.dpr, G.ox * G.dpr, G.oy * G.dpr)

    const base = rgbOf(p.hex)
    const tint = rgbOf(p.tint)

    /* ---- glass, back: a faint body and the far wall */
    this.path(c)
    c.fillStyle = 'rgb(21 20 19 / 0.035)'
    c.fill()

    /* ---- the powder */
    const ins = G.t
    const iw = G.hw - ins
    const yBot = -G.tb
    const fillTop = this.k.fill * G.bodyH * this.rest.fill
    const f = clamp(s.fill)
    const ys = -(G.tb + f * (fillTop - G.tb))
    const a = lerp(0, this.rest.slope, s.slope) + s.shift
    const rx = iw + 1
    const ry = iw * 0.17
    const surfY = (x) => ys + Math.tan(a) * x
    if (f > 0.004) {
      c.save()
      this.path(c, ins, G.tb, ins * 0.8)
      c.clip()

      // body of powder below the surface line
      c.save()
      c.beginPath()
      c.moveTo(-G.hw, surfY(-G.hw))
      c.lineTo(G.hw, surfY(G.hw))
      c.lineTo(G.hw, 2)
      c.lineTo(-G.hw, 2)
      c.closePath()
      c.clip()
      c.drawImage(this.tex, -G.hw, -G.bodyH, W, G.bodyH)
      // round body: darker towards the walls, a soft light band left of centre
      const sh = c.createLinearGradient(-iw, 0, iw, 0)
      sh.addColorStop(0, 'rgb(21 20 19 / 0.34)')
      sh.addColorStop(0.16, 'rgb(21 20 19 / 0.08)')
      sh.addColorStop(0.36, 'rgb(255 255 255 / 0.05)')
      sh.addColorStop(0.62, 'rgb(21 20 19 / 0)')
      sh.addColorStop(0.86, 'rgb(21 20 19 / 0.14)')
      sh.addColorStop(1, 'rgb(21 20 19 / 0.4)')
      c.fillStyle = sh
      c.fillRect(-G.hw, -G.bodyH, W, G.bodyH + 2)
      // packed at the bottom
      const sb = c.createLinearGradient(0, yBot - 0.12 * W, 0, yBot)
      sb.addColorStop(0, 'rgb(21 20 19 / 0)')
      sb.addColorStop(1, 'rgb(21 20 19 / 0.18)')
      c.fillStyle = sb
      c.fillRect(-G.hw, yBot - 0.12 * W, W, 0.12 * W + 2)
      c.restore()

      // the top surface, seen from just above: an ellipse, lit from above
      c.save()
      c.beginPath()
      c.ellipse(0, ys, rx, ry, a, 0, Math.PI * 2)
      c.clip()
      c.drawImage(this.tex, -G.hw, -G.bodyH, W, G.bodyH)
      const lit = c.createLinearGradient(0, ys - ry, 0, ys + ry)
      lit.addColorStop(0, css(mixRgb(INK, base, 0.4), 0.3)) // the far wall's shade
      lit.addColorStop(0.3, css(mixRgb(tint, WHITE, 0.3), 0.24))
      lit.addColorStop(1, css(mixRgb(tint, WHITE, 0.45), 0.34))
      c.fillStyle = lit
      c.fillRect(-G.hw, ys - ry * 2, W, ry * 4)
      c.restore()

      // the heap
      const mh = lerp(this.rest.mh, 0.15, s.mound) * W * clamp(f * 3)
      const mx = (lerp(this.rest.mx, 0, s.mound) + s.push) * iw
      const mw = lerp(0.62, 0.48, s.mound) * iw
      if (mh > 0.4) {
        const y0 = surfY(mx - mw) + ry * 0.35
        const y1 = surfY(mx + mw) + ry * 0.35
        const yp = surfY(mx) - mh + ry * 0.2
        c.save()
        c.beginPath()
        c.moveTo(mx - mw, y0)
        c.bezierCurveTo(mx - mw * 0.5, y0, mx - mw * 0.22, yp, mx, yp)
        c.bezierCurveTo(mx + mw * 0.22, yp, mx + mw * 0.5, y1, mx + mw, y1)
        c.quadraticCurveTo(mx, surfY(mx) + ry * 0.95, mx - mw, y0)
        c.closePath()
        c.clip()
        c.drawImage(this.tex, -G.hw, -G.bodyH, W, G.bodyH)
        const hl = c.createLinearGradient(mx - mw, 0, mx + mw, 0)
        hl.addColorStop(0, css(mixRgb(tint, WHITE, 0.3), 0.22))
        hl.addColorStop(0.45, css(mixRgb(tint, WHITE, 0.4), 0.3))
        hl.addColorStop(0.55, 'rgb(21 20 19 / 0.06)')
        hl.addColorStop(1, 'rgb(21 20 19 / 0.22)')
        c.fillStyle = hl
        c.fillRect(mx - mw, yp - 2, mw * 2, mh + ry * 2)
        c.restore()
      }

      // where the powder meets the front glass: pressed, a touch darker
      c.beginPath()
      c.ellipse(0, ys, rx, ry, a, 0.06, Math.PI - 0.06)
      c.strokeStyle = css(mixRgb(base, INK, 0.5), 0.22)
      c.lineWidth = 1.2
      c.stroke()

      // dust clinging to the glass above the powder
      if (s.dust > 0.01) {
        for (const d of this.dustPts) {
          const x = d.x * iw * 0.96
          const y = surfY(x) + ry * 0.6 - d.y * 0.22 * W
          c.fillStyle = css(base, d.a * s.dust)
          c.fillRect(x, y, d.s, d.s)
        }
      }
      c.restore()
    }

    /* ---- the falling stream of powder while it pours */
    if (s.stream > 0.01) {
      const top = -G.oy + 2
      const xs = 0.04 * W
      const L = ys - top
      c.save()
      c.globalAlpha = clamp(s.stream * 1.4)
      c.fillStyle = css(base, 0.5 * s.stream)
      const thread = 0.9 + 1.4 * s.stream
      c.fillRect(xs - thread / 2, top, thread, L)
      c.fillStyle = p.hex
      const t = now / 1000
      for (const gr of this.grains) {
        const u = (t * 1.9 * gr.sp + gr.ph) % 1
        const y = top + u * u * L
        const spread = 0.006 * W + 0.03 * W * u * s.stream
        const x = xs + gr.xj * spread
        c.fillRect(x, y, gr.sz, gr.sz)
      }
      // a puff where it lands
      for (let i = 0; i < 14; i++) {
        const gr = this.grains[i]
        const u = (t * 1.3 + gr.ph) % 1
        const x = xs + gr.xj * (0.05 + u * 0.18) * W
        const y = ys - 0.015 * W - Math.sin(u * Math.PI) * 0.05 * W
        c.fillStyle = css(base, (1 - u) * 0.6 * s.stream)
        c.fillRect(x, y, gr.sz, gr.sz)
      }
      c.restore()
    }

    /* ---- glass, front */
    c.save()
    this.path(c)
    c.clip()
    const eg = c.createLinearGradient(-G.hw, 0, G.hw, 0)
    const tw = G.t / W
    eg.addColorStop(0, 'rgb(21 20 19 / 0.34)')
    eg.addColorStop(tw * 0.9, 'rgb(21 20 19 / 0.12)')
    eg.addColorStop(tw * 2.6, 'rgb(21 20 19 / 0)')
    eg.addColorStop(1 - tw * 2.6, 'rgb(21 20 19 / 0)')
    eg.addColorStop(1 - tw * 0.9, 'rgb(21 20 19 / 0.16)')
    eg.addColorStop(1, 'rgb(21 20 19 / 0.4)')
    c.fillStyle = eg
    c.fillRect(-G.hw, -G.bodyH - G.neckH - 2, W, G.bodyH + G.neckH + 4)
    // the thick glass base
    c.fillStyle = 'rgb(21 20 19 / 0.06)'
    c.fillRect(-G.hw, -G.tb, W, G.tb + 1)
    c.restore()

    c.lineCap = 'round'
    // inner bottom edge, bright, and the base's darker underside
    c.beginPath()
    c.moveTo(-iw + 1, -G.tb)
    c.quadraticCurveTo(0, -G.tb + 0.06 * W, iw - 1, -G.tb)
    c.strokeStyle = 'rgb(255 255 255 / 0.65)'
    c.lineWidth = 1.1
    c.stroke()
    c.beginPath()
    c.moveTo(-iw + 2, -G.tb * 0.35)
    c.quadraticCurveTo(0, 0.02 * W, iw - 2, -G.tb * 0.35)
    c.strokeStyle = 'rgb(21 20 19 / 0.14)'
    c.lineWidth = 1
    c.stroke()
    // a glint in the base
    c.beginPath()
    c.moveTo(-0.3 * W, -G.tb * 0.45)
    c.quadraticCurveTo(-0.1 * W, -G.tb * 0.15, 0.08 * W, -G.tb * 0.3)
    c.strokeStyle = 'rgb(255 255 255 / 0.85)'
    c.lineWidth = 1.4
    c.stroke()

    // outline and the inner wall lines
    this.path(c)
    c.strokeStyle = 'rgb(21 20 19 / 0.42)'
    c.lineWidth = 1
    c.stroke()
    c.beginPath()
    c.moveTo(-iw, -G.bodyH + G.rs)
    c.lineTo(-iw, -G.tb - G.rb * 0.4)
    c.moveTo(iw, -G.bodyH + G.rs)
    c.lineTo(iw, -G.tb - G.rb * 0.4)
    c.strokeStyle = 'rgb(21 20 19 / 0.13)'
    c.lineWidth = 0.8
    c.stroke()
    // a fine bright line just inside the lit wall
    c.beginPath()
    c.moveTo(-G.hw + G.t * 0.55, -G.bodyH + G.rs * 1.1)
    c.lineTo(-G.hw + G.t * 0.55, -G.rb - 2)
    c.strokeStyle = 'rgb(255 255 255 / 0.7)'
    c.lineWidth = 1
    c.stroke()

    // the long window reflection, and a thinner one on the shade side
    const strip = (x, w, alpha, y0, y1) => {
      const gg = c.createLinearGradient(0, y0, 0, y1)
      gg.addColorStop(0, 'rgb(255 255 255 / 0)')
      gg.addColorStop(0.1, `rgb(255 255 255 / ${alpha})`)
      gg.addColorStop(0.75, `rgb(255 255 255 / ${alpha * 0.75})`)
      gg.addColorStop(1, 'rgb(255 255 255 / 0)')
      c.fillStyle = gg
      c.beginPath()
      if (c.roundRect) c.roundRect(x, y0, w, y1 - y0, w / 2)
      else c.rect(x, y0, w, y1 - y0)
      c.fill()
    }
    const vial = this.kind === 'vial'
    strip(-G.hw * (vial ? 0.56 : 0.62), W * (vial ? 0.12 : 0.055), 0.62, -G.bodyH + G.rs * 0.9, -G.tb - 0.05 * W)
    strip(G.hw * 0.66, W * (vial ? 0.05 : 0.018), 0.4, -G.bodyH + G.rs * 1.3, -G.tb - 0.12 * W)
    // the shoulder catching the light
    c.beginPath()
    c.moveTo(-G.nw + 1, -G.bodyH + 0.5)
    c.quadraticCurveTo(-G.hw + 1, -G.bodyH + 1, -G.hw + 1.2, -G.bodyH + G.rs * 0.95)
    c.strokeStyle = 'rgb(255 255 255 / 0.85)'
    c.lineWidth = 1.6
    c.stroke()

    // the neck and its thread, seen when the lid is off
    if (s.lid > 0.02) {
      const nt = -G.bodyH - G.neckH
      c.beginPath()
      c.ellipse(0, nt, G.nw, G.nw * 0.16, 0, 0, Math.PI * 2)
      c.fillStyle = 'rgb(21 20 19 / 0.05)'
      c.fill()
      c.strokeStyle = 'rgb(21 20 19 / 0.4)'
      c.lineWidth = 1
      c.stroke()
      c.beginPath()
      for (const fy of [0.35, 0.72]) {
        c.moveTo(-G.nw, nt + G.neckH * fy)
        c.quadraticCurveTo(0, nt + G.neckH * fy + G.nw * 0.08, G.nw, nt + G.neckH * fy)
      }
      c.strokeStyle = 'rgb(21 20 19 / 0.28)'
      c.lineWidth = 0.9
      c.stroke()
    }

    /* ---- the lid */
    this.drawLid(c)
  }

  drawLid(c) {
    const G = this.G
    const s = this.s
    const W = G.W
    const vial = this.kind === 'vial'
    const lw = G.nw + (vial ? 0.16 : 0.05) * W
    const lh = G.lidH
    const y1 = -G.bodyH - G.neckH + 0.015 * W // lid bottom
    const y0 = y1 - lh
    const L = s.lid
    c.save()
    c.translate(0.22 * W * L, -0.5 * W * Math.sin((L * Math.PI) / 2))
    c.translate(0, (y0 + y1) / 2)
    c.rotate(0.26 * L * this.side * -1)
    c.translate(0, -(y0 + y1) / 2)

    const r = vial ? 0.14 * W : 0.03 * W
    c.beginPath()
    if (c.roundRect) c.roundRect(-lw, y0, lw * 2, lh, vial ? [r, r, 2, 2] : r)
    else c.rect(-lw, y0, lw * 2, lh)
    c.fillStyle = '#151413'
    c.fill()
    c.save()
    c.clip()
    // cylinder light on the lid
    const lg = c.createLinearGradient(-lw, 0, lw, 0)
    lg.addColorStop(0, 'rgb(255 255 255 / 0.02)')
    lg.addColorStop(0.2, 'rgb(255 255 255 / 0.2)')
    lg.addColorStop(0.32, 'rgb(255 255 255 / 0.04)')
    lg.addColorStop(0.8, 'rgb(255 255 255 / 0)')
    lg.addColorStop(0.93, 'rgb(255 255 255 / 0.08)')
    lg.addColorStop(1, 'rgb(255 255 255 / 0)')
    c.fillStyle = lg
    c.fillRect(-lw, y0, lw * 2, lh)
    if (this.k.ribs) {
      // knurled ribs, turning as the lid is screwed down
      const step = Math.max(2.2, 0.03 * W)
      const ph = (s.turn * 7.3 * step) % step
      c.lineWidth = Math.max(0.6, step * 0.32)
      for (let x = -lw + ph; x < lw; x += step) {
        const k = 1 - Math.abs(x / lw)
        const hi = 0.04 + 0.2 * Math.max(0, 1 - Math.abs(x / lw + 0.55) / 0.35)
        c.strokeStyle = `rgb(255 255 255 / ${hi * Math.sqrt(k)})`
        c.beginPath()
        c.moveTo(x, y0 + lh * 0.2)
        c.lineTo(x, y1 - lh * 0.16)
        c.stroke()
      }
    }
    // top bevel and bottom lip
    c.fillStyle = 'rgb(255 255 255 / 0.22)'
    c.fillRect(-lw + r, y0 + 0.6, lw * 2 - r * 2, 0.9)
    c.fillStyle = 'rgb(255 255 255 / 0.07)'
    c.fillRect(-lw, y1 - lh * 0.13, lw * 2, lh * 0.13)
    c.restore()
    c.restore()
  }

  /** The signature: lid off, a stream of powder, the heap slumps, lid on. */
  pour(delay = 0) {
    if (this.filled) return
    this.filled = true
    const { gsap } = this.ctx
    const s = this.s
    const draw = () => this.draw()
    this.tl = gsap
      .timeline({ delay, onUpdate: draw, onComplete: draw })
      .to(s, { lid: 1, duration: 0.75, ease: 'power3.inOut' })
      .to(s, { stream: 1, duration: 0.3, ease: 'power1.out' }, '-=0.12')
      .to(s, { fill: 1, duration: 1.55, ease: 'power1.inOut' }, '<0.12')
      .to(s, { mound: 1, duration: 1.2, ease: 'power2.out' }, '<')
      .to(s, { stream: 0, duration: 0.4, ease: 'power1.in' }, '>-0.28')
      .to(s, { mound: 0, slope: 1, dust: 1, duration: 1.1, ease: 'settle' }, '>-0.2')
      .to(s, { lid: 0, duration: 0.85, ease: 'pour' }, '<0.15')
      .to(s, { turn: 1, duration: 0.7, ease: 'power2.out' }, '<0.25')
  }

  fillNow() {
    this.filled = true
    Object.assign(this.s, { fill: 1, mound: 0, slope: 1, dust: 1, lid: 0, stream: 0, turn: 1 })
    this.draw()
  }
}

/* ------------------------------------------------------------------ sets */
function drawSet(el, ctx) {
  const canvas = el.querySelector('.set__canvas')
  const box = el.querySelector('.set__box')
  const ids = el.dataset.ids.split(' ')
  const cols = +el.dataset.cols
  const rows = +el.dataset.rows
  const BY_ID = ctx.pigments.BY_ID
  const dpr = ctx.dpr
  const bw = box.offsetWidth
  const bh = box.offsetHeight
  if (!bw || !bh) return
  const cr = canvas.getBoundingClientRect()
  const br = box.getBoundingClientRect()
  const cw = cr.width
  const ch = cr.height
  canvas.width = Math.round(cw * dpr)
  canvas.height = Math.round(ch * dpr)
  const c = canvas.getContext('2d')
  c.setTransform(dpr, 0, 0, dpr, (br.left - cr.left) * dpr, (br.top - cr.top) * dpr)
  const rnd = rng(hash(el.dataset.set))

  // the box: a paper tray with a rim, lit from the top left
  const rim = Math.min(bw / (cols + 0.24), bh / (rows + 0.24)) * 0.12
  // shadow of the box on the page
  c.save()
  c.fillStyle = 'rgb(21 20 19 / 0.05)'
  c.filter = 'blur(6px)'
  c.fillRect(6, 9, bw, bh)
  c.restore()
  c.fillStyle = '#fbfaf7'
  c.fillRect(0, 0, bw, bh)
  c.strokeStyle = 'rgb(21 20 19 / 0.32)'
  c.lineWidth = 1
  c.strokeRect(0.5, 0.5, bw - 1, bh - 1)
  // floor
  const fx = rim
  const fy = rim
  const fw = bw - rim * 2
  const fh = bh - rim * 2
  c.fillStyle = '#efeee8'
  c.fillRect(fx, fy, fw, fh)
  c.strokeStyle = 'rgb(21 20 19 / 0.2)'
  c.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1)
  // the inner walls: in shade top and left, in light bottom and right
  const sh = Math.max(4, rim * 0.9)
  let gg = c.createLinearGradient(0, fy, 0, fy + sh)
  gg.addColorStop(0, 'rgb(21 20 19 / 0.12)')
  gg.addColorStop(1, 'rgb(21 20 19 / 0)')
  c.fillStyle = gg
  c.fillRect(fx, fy, fw, sh)
  gg = c.createLinearGradient(fx, 0, fx + sh, 0)
  gg.addColorStop(0, 'rgb(21 20 19 / 0.09)')
  gg.addColorStop(1, 'rgb(21 20 19 / 0)')
  c.fillStyle = gg
  c.fillRect(fx, fy, sh, fh)
  c.fillStyle = 'rgb(255 255 255 / 0.7)'
  c.fillRect(fx, fy + fh - 1.5, fw, 1)
  c.fillRect(fx + fw - 1.5, fy, 1, fh)

  const cellW = fw / cols
  const cellH = fh / rows
  // card dividers
  c.lineWidth = 1
  for (let i = 1; i < cols; i++) {
    const x = Math.round(fx + cellW * i) + 0.5
    c.strokeStyle = 'rgb(21 20 19 / 0.16)'
    c.beginPath()
    c.moveTo(x, fy)
    c.lineTo(x, fy + fh)
    c.stroke()
    c.strokeStyle = 'rgb(255 255 255 / 0.9)'
    c.beginPath()
    c.moveTo(x + 1, fy)
    c.lineTo(x + 1, fy + fh)
    c.stroke()
  }
  for (let j = 1; j < rows; j++) {
    const y = Math.round(fy + cellH * j) + 0.5
    c.strokeStyle = 'rgb(21 20 19 / 0.16)'
    c.beginPath()
    c.moveTo(fx, y)
    c.lineTo(fx + fw, y)
    c.stroke()
    c.strokeStyle = 'rgb(255 255 255 / 0.9)'
    c.beginPath()
    c.moveTo(fx, y + 1)
    c.lineTo(fx + fw, y + 1)
    c.stroke()
  }

  // the jars, open, seen from above
  ids.forEach((id, i) => {
    const p = BY_ID[id]
    const col = i % cols
    const row = (i / cols) | 0
    const cx = fx + cellW * (col + 0.5) + (rnd() - 0.5) * cellW * 0.03
    const cy = fy + cellH * (row + 0.5) + (rnd() - 0.5) * cellH * 0.03
    const R = Math.min(cellW, cellH) * 0.4 * Math.sqrt(REL[KIND_OF[id]] ?? 1)
    const base = rgbOf(p.hex)
    const tint = rgbOf(p.tint)
    // contact shadow, coloured by the glass and what is in it
    c.save()
    c.filter = `blur(${Math.max(2, R * 0.12)}px)`
    c.fillStyle = css(mixRgb(base, INK, 0.55), 0.3)
    c.beginPath()
    c.arc(cx + R * 0.1, cy + R * 0.14, R * 1.02, 0, Math.PI * 2)
    c.fill()
    c.restore()
    // glass rim
    c.beginPath()
    c.arc(cx, cy, R, 0, Math.PI * 2)
    c.fillStyle = 'rgb(250 250 247 / 0.9)'
    c.fill()
    c.strokeStyle = 'rgb(21 20 19 / 0.38)'
    c.lineWidth = 1
    c.stroke()
    const ri = R * 0.84
    // powder
    const ts = Math.max(16, Math.round(ri * 2 * dpr))
    const tex = powderTexture(p, ts, ts, 'top')
    c.save()
    c.beginPath()
    c.arc(cx, cy, ri, 0, Math.PI * 2)
    c.clip()
    c.drawImage(tex, cx - ri, cy - ri, ri * 2, ri * 2)
    // light on the powder from the top left, the rim's shade falling inside
    const lg = c.createRadialGradient(cx + ri * 0.18, cy + ri * 0.22, ri * 0.1, cx + ri * 0.1, cy + ri * 0.12, ri * 1.05)
    lg.addColorStop(0, css(mixRgb(tint, WHITE, 0.3), 0.22))
    lg.addColorStop(0.6, css(tint, 0.04))
    lg.addColorStop(1, 'rgb(21 20 19 / 0)')
    c.fillStyle = lg
    c.fillRect(cx - ri, cy - ri, ri * 2, ri * 2)
    c.beginPath()
    c.arc(cx, cy, ri, 0, Math.PI * 2)
    c.arc(cx + ri * 0.16, cy + ri * 0.2, ri * 1.02, 0, Math.PI * 2, true)
    c.fillStyle = 'rgb(21 20 19 / 0.32)'
    c.fill()
    c.restore()
    c.beginPath()
    c.arc(cx, cy, ri, 0, Math.PI * 2)
    c.strokeStyle = 'rgb(21 20 19 / 0.2)'
    c.lineWidth = 0.8
    c.stroke()
    // the rim catching the light
    c.beginPath()
    c.arc(cx, cy, R * 0.92, Math.PI * 1.02, Math.PI * 1.55)
    c.strokeStyle = 'rgb(255 255 255 / 0.95)'
    c.lineWidth = Math.max(1, R * 0.05)
    c.lineCap = 'round'
    c.stroke()
    c.beginPath()
    c.arc(cx, cy, R * 0.92, Math.PI * 0.1, Math.PI * 0.45)
    c.strokeStyle = 'rgb(21 20 19 / 0.12)'
    c.stroke()
  })
}

/* ------------------------------------------------------------------ init */
export function init(ctx) {
  const root = document.getElementById('shop')
  if (!root) return
  const { gsap, ScrollTrigger, reducedMotion } = ctx
  const { BY_ID, PIGMENTS, formatPrice } = ctx.pigments
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches

  /* ---------------------------------------------------------- catalogue */
  const ITEMS = {}
  for (const p of PIGMENTS) {
    if (!p.sold || p.price == null) continue
    ITEMS[p.id] = { id: p.id, name: p.name, italic: true, unit: `${p.unit} jar`, price: p.price, colours: [p], tint: p.tint, hex: p.hex }
  }
  for (const [id, s] of Object.entries(SET_DEFS)) {
    const ps = s.ids.map((i) => BY_ID[i]).filter(Boolean)
    ITEMS[id] = { id, name: s.name, italic: false, unit: s.unit, price: s.price, colours: ps, set: true, tint: '#e9e7e1', hex: '#151413' }
  }

  /* ---------------------------------------------------------- the facts
     The partial is written out for a first paint without JavaScript; the
     names, formulas, sizes and prices are set again here from pigments.js
     and SET_DEFS, so they always agree with the rest of the page. */
  const put = (el, v, html = false) => {
    if (!el || v == null) return
    if (html) {
      if (el.innerHTML !== v) el.innerHTML = v
    } else if (el.textContent !== v) el.textContent = v
  }
  root.querySelectorAll('.jar').forEach((li) => {
    const p = BY_ID[li.dataset.id]
    if (!p) return
    li.style.setProperty('--pig', p.hex)
    li.style.setProperty('--pig-tint', p.tint)
    li.style.setProperty('--pig-ink', p.ink)
    const [fill, letters] = addColours(p)
    li.style.setProperty('--add-fill', fill)
    li.style.setProperty('--add-ink', letters)
    const tall = li.dataset.kind === 'vial'
    put(li.querySelector('.jar__name'), tall ? p.name.split(' ').join('<br>') : p.name, tall)
    put(li.querySelector('.jar__formula'), p.formula, true)
    put(li.querySelector('.jar__net'), p.unit)
    put(li.querySelector('.jar__title'), p.name)
    put(li.querySelector('.jar__amount'), formatPrice(p.price))
    put(li.querySelector('.jar__unit'), `for ${p.unit}`)
    put(li.querySelector('.jar__rare'), p.rare)
    put(li.querySelector('.shop-add .visually-hidden'), `: ${p.name}, ${p.unit} jar`)
  })
  root.querySelectorAll('.set').forEach((el) => {
    const d = SET_DEFS[el.dataset.set]
    if (!d) return
    el.dataset.ids = d.ids.join(' ')
    put(el.querySelector('.set__amount'), formatPrice(d.price))
  })

  /* ---------------------------------------------------------- jars */
  const jars = [...root.querySelectorAll('.jar')].map((li) => new Jar(li, ctx))
  const byId = Object.fromEntries(jars.map((j) => [j.id, j]))
  const setEls = [...root.querySelectorAll('.set')]
  let built = false
  function buildAll() {
    if (built) return
    built = true
    const queue = [...jars, ...setEls]
    const next = () => {
      const item = queue.shift()
      if (!item) return
      if (item instanceof Jar) {
        item.build()
        if (reducedMotion) item.fillNow()
      } else drawSet(item, ctx)
      nextFrame(next)
    }
    next()
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect()
        buildAll()
      }
    },
    { rootMargin: '140% 0px 140% 0px' }
  )
  io.observe(root)

  // the shelf fills row by row as it arrives: the plank draws itself in from
  // the left, then each jar in the row is filled in turn
  const planks = jars.map((j) => j.li.querySelector('.jar__plank')).filter(Boolean)
  const rowOf = (j) => {
    const top = j.li.offsetTop
    return jars.filter((k) => Math.abs(k.li.offsetTop - top) < 4)
  }
  if (!reducedMotion) {
    gsap.set(planks, { scaleX: 0 })
    jars.forEach((j) => {
      const slot = j.li.querySelector('.jar__slot')
      const plank = j.li.querySelector('.jar__plank')
      // the plank: one line drawn across the whole row
      ScrollTrigger.create({
        trigger: slot,
        start: 'bottom 96%',
        once: true,
        onEnter: () => {
          if (!plank || plank.__drawn) return
          const row = rowOf(j)
          const segs = row.map((k) => k.li.querySelector('.jar__plank')).filter((el) => el && !el.__drawn)
          segs.forEach((el) => (el.__drawn = true))
          const n = segs.length
          const v = { t: 0 }
          gsap.to(v, {
            t: 1,
            duration: 0.5 + n * 0.22,
            ease: 'pour',
            onUpdate: () => segs.forEach((el, i) => gsap.set(el, { scaleX: clamp(v.t * n - i) })),
          })
        },
      })
      // the jar: lid off, the powder poured in, lid on
      ScrollTrigger.create({
        trigger: slot,
        start: 'bottom 86%',
        once: true,
        onEnter: () => {
          if (!j.built) j.build()
          if (!j.built) return
          const i = Math.max(0, rowOf(j).indexOf(j))
          j.pour(0.15 + i * 0.22)
        },
      })
    })
  }

  // keep canvases sharp and sized
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const t = e.target
      if (t.__jar) {
        const j = t.__jar
        if (!j.built || Math.abs(j.body.offsetWidth - j.W) < 0.5) continue
        j.measure()
        j.draw()
      } else if (t.__set && built) drawSet(t.__set, ctx)
    }
  })
  jars.forEach((j) => {
    j.body.__jar = j
    ro.observe(j.body)
  })
  setEls.forEach((el) => {
    const b = el.querySelector('.set__box')
    b.__set = el
    ro.observe(b)
  })

  /* ---------------------------------------------------------- hover tilt */
  if (fine && !reducedMotion) {
    jars.forEach((j) => {
      const rot = gsap.quickTo(j.body, 'rotation', { duration: 0.7, ease: 'power3.out' })
      const lift = gsap.quickTo(j.body, 'y', { duration: 0.7, ease: 'power3.out' })
      const shScale = gsap.quickTo(j.shadow, 'scaleX', { duration: 0.7, ease: 'power3.out' })
      const shOp = gsap.quickTo(j.shadow, 'opacity', { duration: 0.7, ease: 'power3.out' })
      const slot = j.li.querySelector('.jar__slot')
      let tween = null
      const powder = (deg) => {
        // the powder lags behind the glass, then slides downhill
        tween?.kill()
        const rad = (deg * Math.PI) / 180
        tween = gsap.to(j.s, {
          shift: -rad * 0.85,
          push: rad * 2.2,
          duration: 1.3,
          delay: 0.08,
          ease: 'settle',
          onUpdate: () => j.draw(),
        })
      }
      let last = 0
      const move = (e) => {
        if (!j.filled || j.tl?.isActive()) return
        const r = slot.getBoundingClientRect()
        const nx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1)
        const deg = nx * 6
        rot(deg)
        lift(-5 - Math.abs(nx) * 3)
        shScale(1.14)
        shOp(0.2)
        if (Math.abs(deg - last) > 0.6) {
          last = deg
          powder(deg)
        }
      }
      const leave = () => {
        rot(0)
        lift(0)
        shScale(1)
        shOp(0.32)
        last = 0
        powder(0)
      }
      slot.addEventListener('pointermove', move)
      slot.addEventListener('pointerleave', leave)
    })
  }

  /* ---------------------------------------------------------- order state */
  const order = new Map()
  const panel = root.querySelector('.order')
  const bar = panel.querySelector('.order__bar')
  const sheet = panel.querySelector('.order__sheet')
  const slipView = panel.querySelector('[data-view="slip"]')
  const doneView = panel.querySelector('[data-view="done"]')
  const linesEl = panel.querySelector('[data-order-lines]')
  const emptyEl = panel.querySelector('[data-order-empty]')
  const limitEl = panel.querySelector('[data-order-limit]')
  const totalEl = panel.querySelector('[data-order-total]')
  const barCount = panel.querySelector('[data-order-count]')
  const barTotal = panel.querySelector('[data-order-bar-total]')
  const longCount = panel.querySelector('[data-order-count-long]')
  const live = panel.querySelector('[data-order-live]')
  const title = panel.querySelector('#order-title')
  const form = panel.querySelector('.order__form')
  const formMsg = panel.querySelector('[data-order-form-msg]')
  const doneTitle = panel.querySelector('[data-order-done-title]')
  const doneEmail = panel.querySelector('[data-order-done-email]')
  const doneSum = panel.querySelector('[data-order-done-sum]')
  const again = panel.querySelector('[data-order-again]')
  const flash = document.createElement('span')
  flash.className = 'order__bar-flash'
  flash.setAttribute('aria-hidden', 'true')
  bar.prepend(flash)
  panel.classList.add('is-js')
  // phones: a slip of paper that rises out of the order bar when an add is
  // refused (the reason is also read out through the live region)
  const note = document.createElement('p')
  note.className = 'order__toast'
  note.setAttribute('aria-hidden', 'true')
  note.hidden = true
  panel.prepend(note)
  function toast(msg) {
    note.textContent = msg
    note.hidden = false
    clearTimeout(toast.t)
    gsap.killTweensOf(note)
    if (reducedMotion) gsap.set(note, { opacity: 1, yPercent: 0 })
    else gsap.fromTo(note, { opacity: 0, yPercent: 30 }, { opacity: 1, yPercent: 0, duration: 0.6, ease: 'expo.out' })
    toast.t = setTimeout(hideToast, 4200)
  }
  function hideToast() {
    clearTimeout(toast.t)
    if (note.hidden) return
    if (reducedMotion) note.hidden = true
    else gsap.to(note, { opacity: 0, duration: 0.4, ease: 'power2.out', onComplete: () => (note.hidden = true) })
  }

  const qty = (id) => order.get(id) || 0
  const tyrianUsed = () => TYRIAN.reduce((n, id) => n + qty(id), 0)
  const capFor = (id) => (TYRIAN.includes(id) ? 2 - (tyrianUsed() - qty(id)) : MAX_EACH)
  function totals() {
    let jarsN = 0
    let setsN = 0
    let total = 0
    for (const [id, n] of order) {
      const it = ITEMS[id]
      if (it.set) setsN += n
      else jarsN += n
      total += it.price * n
    }
    return { jars: jarsN, sets: setsN, total, count: jarsN + setsN }
  }
  function countText({ jars: j, sets: s }) {
    const parts = []
    if (j) parts.push(j === 1 ? '1 jar' : `${j} jars`)
    if (s) parts.push(s === 1 ? '1 set' : `${s} sets`)
    return parts.join(' and ')
  }
  const say = (msg) => {
    live.textContent = ''
    requestAnimationFrame(() => (live.textContent = msg))
  }

  const totalTween = { v: 0 }
  function setTotal(v) {
    barTotal.textContent = formatPrice(v)
    if (reducedMotion) {
      totalEl.textContent = formatPrice(v)
      return
    }
    gsap.to(totalTween, {
      v,
      duration: 0.9,
      ease: 'power3.out',
      overwrite: true,
      onUpdate: () => (totalEl.textContent = formatPrice(Math.round(totalTween.v))),
    })
  }

  function lineFor(id) {
    let li = linesEl.querySelector(`[data-line="${id}"]:not([data-leaving])`)
    if (li) return li
    const it = ITEMS[id]
    li = document.createElement('li')
    li.className = 'line'
    li.dataset.line = id
    li.style.setProperty('--pig-tint', it.set ? '#e4e2db' : it.tint)
    const what = it.set ? `${it.name} set` : it.name
    const sw = it.colours
      .slice(0, it.set ? 3 : 1)
      .map((p) => `<i style="background:${p.hex}"></i>`)
      .join('')
    li.innerHTML = `
      <span class="line__wash" aria-hidden="true"></span>
      <span class="line__swatch${it.set ? '' : ' line__swatch--one'}" aria-hidden="true">${sw}</span>
      <div class="line__main">
        <p class="line__name">${it.italic ? `<em>${it.name}</em>` : it.name}</p>
        <p class="line__unit">${it.unit}, ${formatPrice(it.price)} ${it.set ? 'a set' : 'each'}</p>
      </div>
      <div class="line__qty" role="group" aria-label="Quantity of ${what}">
        <button type="button" class="line__step" data-step="-1" aria-label="One fewer: ${what}"></button>
        <span class="line__n">1</span>
        <button type="button" class="line__step" data-step="1" aria-label="One more: ${what}"></button>
      </div>
      <div class="line__end">
        <p class="line__total"></p>
        <button type="button" class="line__remove" data-remove>Remove<span class="visually-hidden"> ${what}</span></button>
      </div>`
    linesEl.appendChild(li)
    if (!reducedMotion) {
      gsap.from(li, { height: 0, paddingTop: 0, paddingBottom: 0, duration: 0.7, ease: 'settle', clearProps: 'height,padding' })
      gsap.from(li.querySelectorAll('.line__swatch i'), { scale: 0, duration: 0.9, ease: 'expo.out', stagger: 0.08, delay: 0.1 })
    }
    return li
  }

  function render(changed = null) {
    const t = totals()
    // lines
    for (const li of [...linesEl.children]) {
      const id = li.dataset.line
      if (!li.dataset.leaving && !order.has(id)) {
        const hadFocus = li.contains(document.activeElement)
        if (reducedMotion) li.remove()
        else {
          li.dataset.leaving = '1'
          gsap.to(li, { height: 0, paddingTop: 0, paddingBottom: 0, opacity: 0, duration: 0.45, ease: 'power3.inOut', onComplete: () => li.remove() })
        }
        if (hadFocus) title.focus({ preventScroll: true })
      }
    }
    for (const [id, n] of order) {
      const it = ITEMS[id]
      const li = lineFor(id)
      li.querySelector('.line__n').textContent = n
      li.querySelector('.line__total').textContent = formatPrice(it.price * n)
      li.querySelector('[data-step="1"]').disabled = n >= capFor(id)
      if (id === changed && !reducedMotion) {
        gsap.fromTo(li.querySelector('.line__wash'), { opacity: 0.55 }, { opacity: 0, duration: 1.6, ease: 'power2.out' })
      }
    }
    emptyEl.hidden = t.count > 0
    longCount.textContent = t.count ? countText(t) : 'Nothing yet'
    barCount.textContent = t.count ? countText(t) : 'Empty'
    setTotal(t.total)
    ctx.emit('order-change', {
      ...t,
      lines: [...order].map(([id, n]) => ({ id, qty: n, price: ITEMS[id].price })),
    })
  }

  function limitNote(id) {
    limitEl.hidden = false
    limitEl.textContent = TYRIAN.includes(id)
      ? 'We get about two grams of Tyrian purple a year, so we can send two jars at most. The full library counts as one.'
      : `That’s the most we can send of one thing in a single order.`
    clearTimeout(limitNote.t)
    limitNote.t = setTimeout(() => (limitEl.hidden = true), 12000)
  }

  function setQty(id, n, { announce = true } = {}) {
    const it = ITEMS[id]
    if (!it) return false
    const cap = capFor(id)
    const want = Math.max(0, Math.round(n))
    const next = Math.min(want, cap)
    const before = qty(id)
    if (want > cap) limitNote(id)
    if (next === before) {
      if (want > cap && announce) say(limitEl.textContent)
      return false
    }
    if (next === 0) order.delete(id)
    else order.set(id, next)
    if (next < before) limitEl.hidden = true
    render(id)
    if (announce) {
      const t = totals()
      const what = next > before ? `${it.name} added.` : next === 0 ? `${it.name} removed.` : `${it.name}, now ${next}.`
      say(`${what} Your order: ${t.count ? countText(t) : 'empty'}, ${formatPrice(t.total)}.`)
    }
    return true
  }

  function add(id, n = 1) {
    if (!ITEMS[id]) return false
    if (!doneView.hidden) showSlip(false)
    const ok = setQty(id, qty(id) + n)
    if (ok) flashBar(id)
    return ok
  }

  function flashBar(id) {
    if (reducedMotion) return
    const it = ITEMS[id]
    flash.style.background = it.colours[0]?.hex || '#151413'
    gsap.fromTo(flash, { opacity: 0.95 }, { opacity: 0, duration: 1.4, ease: 'power2.out' })
  }

  // the bus: anything on the page can add to the order
  ctx.on('order', (d) => {
    if (!d || !d.id) return
    add(d.id, d.qty == null ? 1 : +d.qty || 1)
  })

  /* ---------------------------------------------------------- shop buttons */
  function pinch(id, el, amount = 0.55) {
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (r.bottom < 0 || r.top > vh) return
    ctx.palette?.drop(id, {
      x: (r.left + r.width / 2) / vw,
      y: (r.top + r.height * 0.25) / vh,
      amount,
      radius: 0.045,
      vy: -0.04,
    })
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-add]')
    if (!b || !root.contains(b)) return
    const id = b.dataset.add
    const before = qty(id)
    ctx.emit('order', { id, qty: 1 })
    const ok = qty(id) > before
    const label = b.querySelector('.shop-add__label')
    clearTimeout(b.__t)
    if (!ok) {
      // refused: say so on the button itself, and on a phone, where the slip
      // is folded away, on a note that rises out of the order bar
      b.classList.remove('is-added')
      b.classList.add('is-refused')
      if (label) label.textContent = id === 'tyrian-purple' ? 'Two jars at most' : TYRIAN.includes(id) ? 'Tyrian limit reached' : 'Twenty at most'
      b.__t = setTimeout(() => {
        b.classList.remove('is-refused')
        if (label) label.textContent = 'Add to order'
      }, 2400)
      if (mqPhone.matches && !open && !limitEl.hidden) toast(limitEl.textContent)
      return
    }
    // feedback on the button itself
    b.classList.remove('is-refused')
    b.classList.add('is-added')
    if (label) label.textContent = 'Added to order'
    b.__t = setTimeout(() => {
      b.classList.remove('is-added')
      if (label) label.textContent = 'Add to order'
    }, 1800)
    // the jar is lifted, and a pinch of it falls into the dish
    const j = byId[id]
    if (j) {
      pinch(id, j.body)
      if (!reducedMotion && j.filled) {
        gsap.timeline()
          .to(j.body, { y: -16, duration: 0.35, ease: 'power3.out' })
          .to(j.body, { y: 0, duration: 0.9, ease: 'settle' })
        gsap.fromTo(j.s, { push: j.s.push + 0.35 * j.side }, { push: 0, duration: 1.4, ease: 'settle', onUpdate: () => j.draw() })
      }
    } else if (SET_DEFS[id]) {
      const box = b.closest('.set')?.querySelector('.set__box')
      if (box) {
        const r = box.getBoundingClientRect()
        SET_DEFS[id].ids.forEach((pid, i) => {
          setTimeout(() => {
            const vw = window.innerWidth
            const vh = window.innerHeight
            if (r.bottom < 0 || r.top > vh) return
            ctx.palette?.drop(pid, {
              x: (r.left + r.width * (0.15 + 0.7 * ((i % 3) / 2))) / vw,
              y: (r.top + r.height * (SET_DEFS[id].ids.length > 3 ? 0.2 + 0.3 * ((i / 3) | 0) : 0.5)) / vh,
              amount: 0.45,
              radius: 0.032,
            })
          }, i * 90)
        })
      }
    }
  })

  /* ---------------------------------------------------------- order lines */
  linesEl.addEventListener('click', (e) => {
    const li = e.target.closest('.line')
    if (!li || li.dataset.leaving) return
    const id = li.dataset.line
    const step = e.target.closest('[data-step]')
    if (step) {
      setQty(id, qty(id) + +step.dataset.step)
      return
    }
    if (e.target.closest('[data-remove]')) setQty(id, 0)
  })

  /* ---------------------------------------------------------- the form */
  const fields = {
    name: form.elements.name,
    email: form.elements.email,
    country: form.elements.country,
  }
  const RULES = {
    name: (v) => (v.trim() ? '' : 'Please tell us your name.'),
    email: (v) => {
      const s = v.trim()
      if (!s) return 'Please enter your email address, so we can send you the payment link.'
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)
        ? ''
        : 'That email address doesn’t look complete. It should look like name@example.com.'
    },
    country: (v) => (v.trim().length >= 2 ? '' : 'Please tell us which country to send your order to.'),
  }
  const touched = new Set()
  function check(name, show = true) {
    const input = fields[name]
    const msg = RULES[name](input.value)
    const out = document.getElementById(`order-${name}-msg`)
    if (show) {
      out.textContent = msg
      input.setAttribute('aria-invalid', msg ? 'true' : 'false')
    }
    return !msg
  }
  for (const name of Object.keys(fields)) {
    const input = fields[name]
    input.addEventListener('blur', () => {
      if (input.value.trim() || touched.has(name)) {
        touched.add(name)
        check(name)
      }
    })
    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') check(name)
      if (formMsg.textContent) formMsg.textContent = ''
    })
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const names = Object.keys(fields)
    names.forEach((n) => touched.add(n))
    const ok = names.map((n) => check(n)).every(Boolean)
    const t = totals()
    if (!t.count) {
      formMsg.textContent = 'Your order is empty. Add a jar from the shelf before you place it.'
      if (ok) {
        formMsg.setAttribute('tabindex', '-1')
        formMsg.focus({ preventScroll: true })
      }
    }
    if (!ok) {
      const first = names.find((n) => fields[n].getAttribute('aria-invalid') === 'true')
      fields[first]?.focus()
      return
    }
    if (!t.count) return
    placeOrder(t)
  })

  function placeOrder(t) {
    const email = fields.email.value.trim()
    const colours = []
    for (const [id] of order) for (const p of ITEMS[id].colours) if (!colours.includes(p.id)) colours.push(p.id)
    doneEmail.textContent = email
    doneSum.textContent = `${countText(t)}, ${formatPrice(t.total)} in total.`
    order.clear()
    linesEl.textContent = ''
    form.reset()
    touched.clear()
    for (const n of Object.keys(fields)) {
      fields[n].removeAttribute('aria-invalid')
      document.getElementById(`order-${n}-msg`).textContent = ''
    }
    formMsg.textContent = ''
    limitEl.hidden = true
    render()
    barCount.textContent = 'Order placed'
    slipView.hidden = true
    doneView.hidden = false
    doneTitle.focus({ preventScroll: true })
    say(`Order placed. We’ll email a payment link to ${email} within a working day.`)
    if (!reducedMotion) {
      const stamp = doneView.querySelector('.order__stamp')
      gsap.fromTo(stamp, { scale: 1.25, opacity: 0, rotation: -20 }, { scale: 1, opacity: 1, rotation: 0, duration: 0.7, ease: 'expo.out' })
      gsap.fromTo(doneView.querySelectorAll('.order__stamp-ring'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.3, ease: 'pour', stagger: 0.12 })
      gsap.from([doneTitle, ...doneView.querySelectorAll('p, .order__again')], { opacity: 0, y: 14, duration: 1, ease: 'expo.out', stagger: 0.08, delay: 0.15 })
    }
    // every colour in the order is poured into the dish, around the slip
    const r = panel.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    colours.slice(0, 9).forEach((id, i) => {
      setTimeout(() => {
        const ang = (i / Math.max(1, colours.length)) * Math.PI * 2 + 0.4
        const cx = clamp((r.left + r.width / 2 + Math.cos(ang) * r.width * 0.62) / vw, 0.02, 0.98)
        const cy = clamp((Math.max(r.top, 0) + Math.min(r.height, vh) * 0.42 + Math.sin(ang) * 140) / vh, 0.05, 0.95)
        ctx.palette?.drop(id, { x: cx, y: cy, amount: 0.7, radius: 0.06, vx: Math.cos(ang) * 0.06, vy: Math.sin(ang) * 0.06 })
      }, 220 + i * 140)
    })
  }

  function showSlip(focus = true) {
    doneView.hidden = true
    slipView.hidden = false
    if (focus) title.focus({ preventScroll: true })
  }
  again.addEventListener('click', () => showSlip(true))

  /* ---------------------------------------------------------- phone bar */
  const mqPhone = window.matchMedia('(max-width: 767px)')
  let open = false
  // The sheet rises out of the bar, so the bar must be on the bottom of the
  // screen. Past the sets the bar has come to rest and rides up with the
  // page (it never follows into the footer): bring it back down first, in
  // one frame (not a jump: the field is paper either way).
  function seatBar() {
    const gap = window.innerHeight - bar.getBoundingClientRect().bottom
    if (gap < 2) return
    ctx.scrollTo(Math.max(0, Math.round(window.scrollY - gap)), { immediate: true, force: true })
  }
  function setOpen(v, { focus = false } = {}) {
    open = v
    if (v) hideToast()
    if (v && mqPhone.matches) seatBar()
    bar.setAttribute('aria-expanded', String(v))
    panel.classList.toggle('is-open', v)
    sheet.hidden = mqPhone.matches ? !v : false
    if (v && mqPhone.matches && !reducedMotion) {
      gsap.fromTo(sheet, { yPercent: 6, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.55, ease: 'expo.out', clearProps: 'transform,opacity' })
    }
    if (v && focus) (doneView.hidden ? title : doneTitle).focus({ preventScroll: true })
  }
  bar.addEventListener('click', () => {
    setOpen(!open, { focus: !open })
  })
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mqPhone.matches && open) {
      setOpen(false)
      bar.focus()
    }
  })
  // desktop: a slip taller than the screen scrolls with the page until its
  // foot is in view, then sticks there (no scroll box inside a scroll box)
  function fitSticky() {
    if (mqPhone.matches) {
      panel.style.top = ''
      return
    }
    const top = Math.min(104, window.innerHeight - panel.offsetHeight - 16)
    panel.style.top = `${Math.round(top)}px`
  }
  new ResizeObserver(fitSticky).observe(panel)
  window.addEventListener('resize', fitSticky, { passive: true })
  const onMq = () => {
    setOpen(false)
    fitSticky()
  }
  if (mqPhone.addEventListener) mqPhone.addEventListener('change', onMq)
  else mqPhone.addListener?.(onMq)
  setOpen(false)

  render()
}
