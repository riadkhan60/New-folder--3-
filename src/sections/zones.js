/**
 * zones.js — #zones (200 → 1,000 m). The five layers.
 *
 * Desktop: the section pins and the five layers pass sideways under a
 * fixed playhead at the centre of the screen.
 *  - Each panel's depth range is set in Anybody at the pressure of its own
 *    layer, and is squeezed live while it crosses the playhead: wdth/wght
 *    follow ctx.depth.compression() from the layer's top to its bottom, so
 *    the numbers narrow and thicken all the way from 0 m to 10,935 m.
 *  - A tape of depth runs under all five panels (ticks get denser as each
 *    layer gets thicker) and lights up to the playhead as you travel.
 *  - Behind the panels, each layer's own water colour (depth.colorAt) is
 *    laid side by side, darkening left to right.
 *  - Every panel has a visual drawn from its subject: sunlight shafts and a
 *    light meter; the nightly migration of the twilight zone; living light
 *    in the midnight zone (and one anglerfish lure); marine snow settling
 *    on the abyssal plain; a sonar sweep surveying the trench.
 * Phones and reduced motion: no pin, the panels stack; scenes render only
 * while on screen, and as a single still under reduced motion.
 */
import '../styles/zones.css'

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const TAU = Math.PI * 2
const SVGNS = 'http://www.w3.org/2000/svg'
const fmt = (m) => Math.round(m).toLocaleString('en-US')

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function sprite(stops, size = 64) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  const h = size / 2
  const grd = g.createRadialGradient(h, h, 0, h, h, h)
  for (const [o, col] of stops) grd.addColorStop(o, col)
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return c
}

// tape ticks per layer: minor step, and the depths that get a small label
const TAPE = {
  sunlight: { step: 10, labels: [100] },
  twilight: { step: 50, labels: [500] },
  midnight: { step: 100, labels: [2000, 3000] },
  abyss: { step: 100, labels: [5000] },
  hadal: { step: 250, labels: [8000, 10000] },
}

/* =================================================================== scenes
   Each scene draws in canvas CSS pixels. `f` is the focus rect (where the
   panel's diagram lives); the scene may use the whole canvas around it.  */

const SPR = {}
function sprites() {
  if (SPR.glow) return SPR
  SPR.glow = sprite([
    [0, 'rgba(236,255,252,1)'],
    [0.14, 'rgba(150,255,240,0.9)'],
    [0.36, 'rgba(108,248,232,0.32)'],
    [0.7, 'rgba(58,168,255,0.08)'],
    [1, 'rgba(58,168,255,0)'],
  ])
  SPR.blue = sprite([
    [0, 'rgba(220,240,255,1)'],
    [0.14, 'rgba(120,190,255,0.85)'],
    [0.4, 'rgba(58,168,255,0.28)'],
    [1, 'rgba(58,168,255,0)'],
  ])
  SPR.lure = sprite(
    [
      [0, 'rgba(255,246,226,1)'],
      [0.08, 'rgba(255,214,150,0.95)'],
      [0.24, 'rgba(255,176,84,0.42)'],
      [0.55, 'rgba(255,176,84,0.08)'],
      [1, 'rgba(255,176,84,0)'],
    ],
    128,
  )
  return SPR
}

function sunlightScene() {
  let rays = []
  let specks = []
  return {
    setup(w, h) {
      const r = rng(7)
      rays = Array.from({ length: 8 }, (_, i) => ({
        x: (i + 0.2 + r() * 0.6) / 8,
        top: 16 + r() * 50,
        bot: 70 + r() * 170,
        ph: r() * TAU,
        sp: 0.09 + r() * 0.12,
        a: 0.45 + r() * 0.55,
      }))
      const n = Math.round(clamp((w * h) / 7000, 40, 180))
      specks = Array.from({ length: n }, () => ({
        x: r() * w,
        y: Math.pow(r(), 1.4) * h,
        s: 0.6 + r() * 1.3,
        v: 2 + r() * 7,
        ph: r() * TAU,
        a: 0.3 + r() * 0.6,
      }))
    },
    draw(c, t, dt, w, h) {
      const top = c.createLinearGradient(0, 0, 0, h * 0.8)
      top.addColorStop(0, 'rgba(217,251,255,0.17)')
      top.addColorStop(0.45, 'rgba(217,251,255,0.04)')
      top.addColorStop(1, 'rgba(217,251,255,0)')
      c.fillStyle = top
      c.fillRect(0, 0, w, h * 0.8)

      c.globalCompositeOperation = 'lighter'
      const len = h * 1.02
      const slant = h * 0.16
      for (const ray of rays) {
        const sway = Math.sin(t * ray.sp + ray.ph) * 30
        const x0 = ray.x * w * 1.15 - w * 0.12 + sway
        const k = (0.5 + 0.5 * Math.sin(t * ray.sp * 2.6 + ray.ph * 2)) * ray.a
        const g = c.createLinearGradient(0, 0, 0, len)
        g.addColorStop(0, `rgba(217,251,255,${(0.16 * k).toFixed(3)})`)
        g.addColorStop(0.45, `rgba(217,251,255,${(0.045 * k).toFixed(3)})`)
        g.addColorStop(1, 'rgba(217,251,255,0)')
        c.fillStyle = g
        c.beginPath()
        c.moveTo(x0 - ray.top / 2, 0)
        c.lineTo(x0 + ray.top / 2, 0)
        c.lineTo(x0 + slant + ray.bot / 2, len)
        c.lineTo(x0 + slant - ray.bot / 2, len)
        c.closePath()
        c.fill()
      }
      for (const p of specks) {
        p.x += p.v * dt
        if (p.x > w + 4) p.x = -4
        const y = p.y + Math.sin(t * 0.55 + p.ph) * 5
        const light = Math.exp((-y / h) * 2.3)
        c.fillStyle = `rgba(217,251,255,${(p.a * (0.2 + 0.8 * light)).toFixed(3)})`
        c.fillRect(p.x, y, p.s, p.s)
      }
      c.globalCompositeOperation = 'source-over'
    },
  }
}

function twilightScene() {
  const P = 20 // seconds per day, for the diagram
  // 0 = near the top (night) … 1 = deep (day)
  const depthAt = (ph) => smooth(0.26, 0.5, ph) - smooth(0.76, 1, ph)
  let fish = []
  return {
    setup(w, h, f) {
      const r = rng(11)
      const n = Math.round(clamp((f.w * f.h) / 900, 90, 280))
      fish = Array.from({ length: n }, () => ({
        fx: r(),
        oy: (r() + r() + r() - 1.5) * 0.2,
        lag: r() * 0.08,
        ph: r() * TAU,
        s: 0.5 + r() * 0.8,
        glow: r() < 0.4,
        blue: r() < 0.3,
      }))
    },
    draw(c, t, dt, w, h, f, out) {
      const S = sprites()
      // the last of the daylight: faint blue from above
      const g = c.createLinearGradient(0, 0, 0, h * 0.6)
      g.addColorStop(0, 'rgba(58,168,255,0.07)')
      g.addColorStop(1, 'rgba(58,168,255,0)')
      c.fillStyle = g
      c.fillRect(0, 0, w, h * 0.6)

      const top = f.y + f.h * 0.1
      const bot = f.y + f.h * 0.9
      const base = (t / P + 0.7) % 1 // arrive at dusk, as the cloud starts to rise
      out.cloud = 0.1 + 0.8 * depthAt(base)
      const x0 = f.x + f.w * 0.16
      const xw = f.w * 0.8
      c.globalCompositeOperation = 'lighter'
      c.lineWidth = 1
      for (const p of fish) {
        const ph = (base - p.lag + 1) % 1
        const cy = depthAt(ph)
        const v = depthAt((ph + 0.004) % 1) - cy
        const y = top + (bot - top) * (cy + p.oy)
        const x = x0 + p.fx * xw + Math.sin(t * 0.35 + p.ph) * 7
        const streak = 1.5 + Math.min(14, Math.abs(v) * 1400)
        c.strokeStyle = `rgba(234,246,244,${(0.3 * p.s).toFixed(3)})`
        c.beginPath()
        c.moveTo(x, y)
        c.lineTo(x - 2.5, y - Math.sign(v || 1) * streak)
        c.stroke()
        if (p.glow) {
          const tw = 0.6 + 0.4 * Math.sin(t * 2.2 + p.ph * 3)
          const s = 5 + 4 * p.s
          c.globalAlpha = 0.85 * tw
          c.drawImage(p.blue ? S.blue : S.glow, x - s, y - s, s * 2, s * 2)
          c.globalAlpha = 1
        }
      }
      c.globalCompositeOperation = 'source-over'
    },
  }
}

function midnightScene() {
  let flashes = []
  let snow = []
  let ambient = []
  let next = 0
  let nextChain = 1.2
  let r = rng(23)
  return {
    setup(w, h, f) {
      r = rng(23)
      flashes = []
      next = 0
      nextChain = 1.2
      const n = Math.round(clamp((w * h) / 22000, 20, 70))
      snow = Array.from({ length: n }, () => ({ x: r() * w, y: r() * h, v: 4 + r() * 7, s: 0.6 + r(), a: 0.08 + r() * 0.14 }))
      // distant animals glowing steadily, far off in the dark
      const m = Math.round(clamp((w * h) / 9000, 40, 120))
      ambient = Array.from({ length: m }, () => {
        const inFocus = r() < 0.7
        return {
          x: inFocus ? f.x + r() * f.w : w * (0.25 + r() * 0.75),
          y: inFocus ? f.y + r() * f.h : h * (0.06 + r() * 0.86),
          s: 2 + r() * 4,
          a: 0.12 + r() * 0.3,
          ph: r() * TAU,
          sp: 0.3 + r() * 0.9,
          blue: r() < 0.45,
        }
      })
    },
    draw(c, t, dt, w, h, f) {
      const S = sprites()
      c.globalCompositeOperation = 'lighter'
      for (const q of ambient) {
        c.globalAlpha = q.a * (0.55 + 0.45 * Math.sin(t * q.sp + q.ph))
        c.drawImage(q.blue ? S.blue : S.glow, q.x - q.s, q.y - q.s, q.s * 2, q.s * 2)
      }
      c.globalAlpha = 1
      if (next < t - 1) next = t // re-entry after a pause: don't replay the backlog
      while (t > next) {
        next += 0.1 + r() * 0.32
        const wide = r() < 0.25 // a few lights well outside the diagram
        flashes.push({
          x: wide ? w * (0.3 + r() * 0.7) : f.x + r() * f.w,
          y: wide ? h * (0.08 + r() * 0.8) : f.y + r() * f.h,
          s: wide ? 5 + r() * 9 : 7 + r() * 22,
          t0: next,
          dur: 0.6 + r() * 2.2,
          blue: r() < 0.38,
        })
      }
      if (t > nextChain) {
        // a siphonophore: a chain of lights firing one after another
        nextChain = t + 2.6 + r() * 2.8
        const n = 8 + Math.floor(r() * 7)
        let x = f.x + f.w * (0.1 + r() * 0.6)
        let y = f.y + f.h * (0.1 + r() * 0.75)
        let a = r() * TAU
        const bend = (r() - 0.5) * 0.5
        for (let i = 0; i < n; i++) {
          flashes.push({ x, y, s: 4 + r() * 3, t0: t + i * 0.075, dur: 1.4, blue: false })
          a += bend
          x += Math.cos(a) * 13
          y += Math.sin(a) * 13
        }
      }
      c.globalCompositeOperation = 'lighter'
      for (let i = flashes.length - 1; i >= 0; i--) {
        const q = flashes[i]
        const age = t - q.t0
        if (age < 0) continue
        if (age > q.dur) {
          flashes.splice(i, 1)
          continue
        }
        const env = age < 0.1 ? age / 0.1 : (1 - (age - 0.1) / (q.dur - 0.1)) ** 2
        c.globalAlpha = env
        c.drawImage(q.blue ? S.blue : S.glow, q.x - q.s, q.y - q.s, q.s * 2, q.s * 2)
      }
      c.globalAlpha = 1

      // the anglerfish: only its lure is visible
      const lx = f.x + f.w * 0.6 + Math.sin(t * 0.31) * 6
      const ly = f.y + f.h * 0.52 + Math.sin(t * 0.73) * 7
      const pulse = 0.72 + 0.28 * Math.sin(t * 1.1) * Math.sin(t * 0.37 + 1)
      c.globalCompositeOperation = 'source-over'
      c.strokeStyle = 'rgba(255,176,84,0.16)'
      c.lineWidth = 1
      c.beginPath()
      c.moveTo(lx, ly + 2)
      c.quadraticCurveTo(lx - 44, ly - 8, lx - 58, ly + 54)
      c.stroke()
      c.globalCompositeOperation = 'lighter'
      const ls = 70 * (0.85 + 0.15 * pulse)
      c.globalAlpha = 0.8 * pulse
      c.drawImage(S.lure, lx - ls, ly - ls, ls * 2, ls * 2)
      c.globalAlpha = 1

      for (const p of snow) {
        p.y += p.v * dt
        if (p.y > h) p.y = -2
        c.fillStyle = `rgba(234,246,244,${p.a})`
        c.fillRect(p.x, p.y, p.s, p.s)
      }
      c.globalCompositeOperation = 'source-over'
    },
  }
}

function abyssScene() {
  let snow = []
  const ROWS = 20
  const elev = (X, z) => Math.sin(X * 0.0042 + z * 0.9) * 16 + Math.sin(X * 0.011 - z * 1.7) * 7 + Math.sin(X * 0.026 + z * 3.1) * 2.5
  let geo = null
  return {
    setup(w, h, f) {
      const r = rng(31)
      const horizon = f.y + f.h * 0.42
      const ground = h * 0.99
      geo = { horizon, ground, vpx: f.x + f.w * 0.55 }
      const n = Math.round(clamp((w * h) / 6000, 50, 220))
      snow = Array.from({ length: n }, () => ({
        x: r() * w,
        y: r() * h,
        z: 1 + r() * 9,
        v: 7 + r() * 16,
        s: 0.6 + r() * 1.4,
        ph: r() * TAU,
        a: 0.25 + r() * 0.5,
        land: 0,
      }))
    },
    draw(c, t, dt, w, h, f) {
      const { horizon, ground, vpx } = geo
      const yAt = (x, z) => horizon + (ground - horizon) / z - elev((x - vpx) * z, z) / z
      const fadeX = (x) => smooth(f.x - f.w * 0.55, f.x + f.w * 0.15, x)
      const sweep = 1 + ((t * 0.16) % 1) * 13 // a sonar ping travelling out
      c.lineWidth = 1
      // contour rows, near → far
      for (let k = 0; k < ROWS; k++) {
        const z = 1 + k * 0.62
        const hl = Math.exp(-((z - sweep) ** 2) * 2.2)
        const a = 0.34 / z ** 0.8
        c.beginPath()
        for (let x = -10; x <= w + 10; x += 12) {
          const y = yAt(x, z)
          if (x === -10) c.moveTo(x, y)
          else c.lineTo(x, y)
        }
        const grd = c.createLinearGradient(0, 0, w, 0)
        const col = hl > 0.05 ? `108,248,232` : `234,246,244`
        const alpha = hl > 0.05 ? a * 0.5 + hl * 0.55 : a
        grd.addColorStop(0, `rgba(${col},0)`)
        grd.addColorStop(clamp((f.x - f.w * 0.35) / w), `rgba(${col},0)`)
        grd.addColorStop(clamp((f.x + f.w * 0.1) / w), `rgba(${col},${alpha.toFixed(3)})`)
        grd.addColorStop(1, `rgba(${col},${(alpha * 0.8).toFixed(3)})`)
        c.strokeStyle = grd
        c.stroke()
      }
      // a few lines running away from us
      c.strokeStyle = 'rgba(234,246,244,0.07)'
      for (let j = -8; j <= 8; j++) {
        const X = j * 120
        c.beginPath()
        for (let k = 0; k <= 24; k++) {
          const z = 1 + k * 0.5
          const x = vpx + X / z
          const y = yAt(x, z)
          if (k === 0) c.moveTo(x, y)
          else c.lineTo(x, y)
        }
        c.stroke()
      }
      // marine snow, settling onto the plain
      for (const p of snow) {
        const floor = yAt(p.x, p.z)
        if (p.land > 0) {
          p.land += dt
          if (p.land > 1.6) {
            p.land = 0
            p.y = -4
            p.x = Math.random() * w
          }
        } else {
          p.y += p.v * dt
          p.x += Math.sin(t * 0.6 + p.ph) * 4 * dt
          if (p.y >= floor) {
            p.y = floor
            p.land = 0.001
          }
        }
        const fade = p.land > 0 ? 1 - p.land / 1.6 : 1
        c.fillStyle = `rgba(234,246,244,${(p.a * fade * fadeX(p.x) ** 0.5).toFixed(3)})`
        c.fillRect(p.x, p.y, p.s, p.s)
      }
    },
  }
}

function hadalScene() {
  let snow = []
  return {
    setup(w, h) {
      const r = rng(41)
      const n = Math.round(clamp((w * h) / 26000, 14, 50))
      snow = Array.from({ length: n }, () => ({ x: r() * w, y: r() * h, v: 3 + r() * 6, s: 0.6 + r(), a: 0.08 + r() * 0.16 }))
    },
    draw(c, t, dt, w, h, f, out) {
      const S = sprites()
      c.globalCompositeOperation = 'lighter'
      for (const p of snow) {
        p.y += p.v * dt
        if (p.y > h) p.y = -2
        c.fillStyle = `rgba(234,246,244,${p.a})`
        c.fillRect(p.x, p.y, p.s, p.s)
      }
      // a glow on the deepest point, once the survey has found it
      if (out.deep > 0) {
        const x = f.x + f.w * TRENCH_DEEP.x
        const y = f.y + f.h * TRENCH_DEEP.y
        const s = 46 + 8 * Math.sin(t * 1.3)
        c.globalAlpha = 0.5 * out.deep
        c.drawImage(S.glow, x - s, y - s, s * 2, s * 2)
        c.globalAlpha = 1
      }
      c.globalCompositeOperation = 'source-over'
    },
  }
}

const SCENES = {
  sunlight: sunlightScene,
  twilight: twilightScene,
  midnight: midnightScene,
  abyss: abyssScene,
  hadal: hadalScene,
}

/* =================================================================== trench
   A cross-section of the Mariana Trench at the Challenger Deep, west on the
   left: the steeper, rougher Mariana side, then the floor, then the gentler
   wall of the Pacific plate sinking beneath it. Coordinates 0…1000.      */
const yOfDepth = (d) => 60 + ((d - 6000) / 4935) * 880
const TRENCH = [
  [0, 5880], [55, 6020], [110, 6260], [160, 6610], [205, 7010], [248, 7470], [286, 7930],
  [318, 8336], [350, 8820], [384, 9360], [414, 9900], [440, 10380], [462, 10760], [480, 10935],
  [500, 10905], [522, 10740], [560, 10280], [612, 9640], [668, 8900], [724, 8160], [784, 7420],
  [842, 6760], [896, 6260], [948, 5990], [1000, 5900],
]
const TRENCH_DEEP = { x: 0.48, y: yOfDepth(10935) / 1000 }
const TRENCH_FISH = { x: 0.318, y: yOfDepth(8336) / 1000 }

function buildTrench(focus, svg) {
  const r = rng(53)
  // roughen the wall a little between the surveyed points
  const pts = []
  for (let i = 0; i < TRENCH.length - 1; i++) {
    const [x0, d0] = TRENCH[i]
    const [x1, d1] = TRENCH[i + 1]
    pts.push([x0, yOfDepth(d0)])
    for (let k = 1; k < 4; k++) {
      const u = k / 4
      const rough = i < 13 ? 9 : 5 // the Mariana side is rougher
      pts.push([x0 + (x1 - x0) * u, yOfDepth(d0 + (d1 - d0) * u) + (r() - 0.5) * rough])
    }
  }
  const [lx, ld] = TRENCH[TRENCH.length - 1]
  pts.push([lx, yOfDepth(ld)])
  // Catmull-Rom → cubic Bézier
  let d = `M${pts[0][0]},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1].toFixed(1)}`
  }
  const deepY = yOfDepth(10935)
  let grid = ''
  for (const g of [7000, 8000, 9000, 10000]) {
    const y = yOfDepth(g).toFixed(1)
    grid += `<line class="tr-grid" x1="0" x2="1000" y1="${y}" y2="${y}"/>`
  }
  svg.setAttribute('viewBox', '0 0 1000 1000')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.innerHTML =
    `<defs><linearGradient id="zones-rock" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="rgb(234,246,244)" stop-opacity="0.07"/>` +
    `<stop offset="0.7" stop-color="rgb(234,246,244)" stop-opacity="0.015"/>` +
    `<stop offset="1" stop-color="rgb(234,246,244)" stop-opacity="0"/></linearGradient></defs>` +
    grid +
    `<path class="tr-rock" d="${d} L1000,1000 L0,1000 Z"/>` +
    `<line class="tr-deep" x1="${TRENCH_DEEP.x * 1000}" x2="1000" y1="${deepY}" y2="${deepY}"/>` +
    `<path class="tr-line" d="${d}"/>`

  const html = []
  html.push('<div class="zones__axis">')
  for (const g of [7000, 8000, 9000, 10000, 10935]) {
    html.push(
      `<span class="zones__axis-tick${g === 10935 ? ' is-deep' : ''}" style="--y:${(yOfDepth(g) / 10).toFixed(2)}%">${fmt(g)} m</span>`,
    )
  }
  html.push('</div>')
  html.push(
    `<span class="zones__pin" style="--x:${TRENCH_FISH.x * 100}%;--y:${TRENCH_FISH.y * 100}%" data-x="${TRENCH_FISH.x}">` +
      `<span class="zones__pin-label">Deepest fish seen <b>8,336 m</b></span></span>`,
  )
  html.push(
    `<span class="zones__pin zones__pin--deep" style="--x:${TRENCH_DEEP.x * 100}%;--y:${TRENCH_DEEP.y * 100}%" data-x="${TRENCH_DEEP.x}">` +
      `<span class="zones__pin-label">Challenger Deep <b>10,935 m</b></span></span>`,
  )
  html.push('<span class="zones__scan"></span>')
  focus.insertAdjacentHTML('beforeend', html.join(''))
  return [...focus.querySelectorAll('.zones__pin')].map((el) => ({ el, x: parseFloat(el.dataset.x) }))
}

/* ===================================================================== init */
export function init(ctx) {
  const root = document.getElementById('zones')
  if (!root) return
  const { gsap, ScrollTrigger } = ctx
  const ZONES = ctx.depth.ZONES
  const compress = (d) => ctx.depth.compression(d).f // 0 … 1, unrounded

  const track = root.querySelector('.zones__track')
  const list = root.querySelector('.zones__list')
  const tint = root.querySelector('.zones__tint')
  const rail = root.querySelector('.zones__rail')
  const strip = root.querySelector('.zones__strip')
  const fill = root.querySelector('.zones__fill')
  if (ctx.reducedMotion) root.classList.add('is-static')

  /* ------------------------------------------------------------ panels */
  const panels = [...root.querySelectorAll('.zones__panel')].map((el, i) => {
    const z = ZONES.find((zz) => zz.id === el.dataset.layer) || ZONES[i]
    const c = ctx.depth.compression((z.from + z.to) / 2)
    el.style.setProperty('--wdth', c.wdth)
    el.style.setProperty('--wght', c.wght)
    const canvas = el.querySelector('.zones__canvas')
    return {
      el,
      z,
      range: el.querySelector('.zones__range'),
      canvas,
      c2d: canvas?.getContext('2d') ?? null,
      focus: el.querySelector('.zones__focus'),
      scene: SCENES[z.id]?.() ?? null,
      out: { cloud: 0.5, deep: 0 },
      f: { x: 0, y: 0, w: 1, h: 1 },
      w: 0,
      h: 0,
      dpr: 1,
      sized: false,
      visible: false,
      t: 0,
      left: 0,
      width: 0,
      top: 0,
      height: 0,
      segStart: 0,
      segLen: 1,
      seg: null,
      rw: -1,
      active: false,
    }
  })
  const hadal = panels.find((p) => p.z.id === 'hadal')
  const pins = hadal?.focus ? buildTrench(hadal.focus, hadal.focus.querySelector('.zones__trench')) : []

  /* ------------------------------------------------------------- tape */
  for (const p of panels) {
    if (!strip) break
    const { from, to, id, name } = p.z
    const spec = TAPE[id] || { step: (to - from) / 10, labels: [] }
    const seg = document.createElement('div')
    seg.className = 'zones__seg'
    const pct = (d) => `${(((d - from) / (to - from)) * 100).toFixed(3)}%`
    let lines = ''
    for (let d = from; d < to - 1e-6; d += spec.step) {
      const labelled = spec.labels.includes(d)
      const cls = d === from ? 'is-edge' : labelled ? 'is-mid' : 'is-minor'
      const len = d === from ? 12 : labelled ? 8 : 4
      lines += `<line class="${cls}" x1="${pct(d)}" x2="${pct(d)}" y1="0" y2="${len}"/>`
    }
    if (p === panels[panels.length - 1]) lines += `<line class="is-edge" x1="100%" x2="100%" y1="-6" y2="12"/>`
    let labels = `<span class="zones__seg-depth" style="left:0">${fmt(from)} m</span>`
    for (const d of spec.labels) labels += `<span class="zones__seg-depth is-minor" style="left:${pct(d)}">${fmt(d)}</span>`
    if (p === panels[panels.length - 1]) {
      seg.classList.add('is-end')
      labels += `<span class="zones__seg-depth is-last" style="left:100%">${fmt(to)} m</span>`
    }
    seg.innerHTML = `<span class="zones__seg-name">${name}</span><svg aria-hidden="true" focusable="false">${lines}</svg>${labels}`
    strip.appendChild(seg)
    p.seg = seg
  }

  /* ------------------------------------------------------------ layout */
  let horizontal = false
  let half = window.innerWidth / 2
  let dist = 0

  function layout() {
    horizontal = root.classList.contains('is-horizontal')
    half = (rail?.clientWidth || window.innerWidth) / 2
    dist = Math.max(0, track.scrollWidth - window.innerWidth)
    for (const p of panels) {
      p.left = list.offsetLeft + p.el.offsetLeft
      p.width = p.el.offsetWidth
      p.top = list.offsetTop + p.el.offsetTop
      p.height = p.el.offsetHeight
    }
    // the tape: each layer spans its panel, the last ends where the playhead
    // stops (the centre of the final screen)
    const tapeEnd = dist + half
    panels.forEach((p, i) => {
      p.segStart = p.left
      p.segLen = i === panels.length - 1 ? Math.max(40, tapeEnd - p.left) : p.width
      if (p.seg) {
        p.seg.style.left = `${p.segStart}px`
        p.seg.style.width = `${p.segLen}px`
      }
    })
    paintTint()
  }

  function paintTint() {
    if (!tint || !panels.length) return
    const stops = []
    const pos = (p, k) => (horizontal ? p.left + p.width * k : p.top + p.height * k)
    const first = panels[0]
    const col = (p) => {
      const { r, g, b } = ctx.depth.colorAt(p.z.id === 'sunlight' ? 70 : (p.z.from + p.z.to) / 2)
      return `rgb(${r} ${g} ${b} / 0.94)`
    }
    stops.push(`rgb(0 0 0 / 0) 0px`, `rgb(0 0 0 / 0) ${Math.round(pos(first, -0.12))}px`)
    // the sunlight panel brightens from the left like a window, then each
    // layer's colour sits under its own panel
    for (const p of panels) stops.push(`${col(p)} ${Math.round(pos(p, 0.45))}px`)
    const dir = horizontal ? '90deg' : '180deg'
    root.style.setProperty('--zones-tint', `linear-gradient(${dir}, ${stops.join(', ')})`)
  }

  /* ------------------------------------------------------------ render */
  function render() {
    if (!horizontal) return
    const x = gsap.getProperty(track, 'x')
    const ph = half - x
    if (strip) strip.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`
    if (fill) {
      const w = clamp(ph - panels[0].segStart, 0, half)
      fill.style.transform = `scaleX(${(w / half).toFixed(4)})`
    }
    const vw = window.innerWidth
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i]
      const t = (ph - p.segStart) / p.segLen
      const onScreen = p.left + x < vw && p.left + p.width + x > 0
      if (onScreen && p.range) {
        // pressure follows the playhead through this layer's own depths
        const f = compress(p.z.from + (p.z.to - p.z.from) * clamp(t))
        const wdth = Math.round((150 - 100 * f) * 4) / 4
        if (wdth !== p.rw) {
          p.rw = wdth
          p.range.style.setProperty('--rw', wdth)
          p.range.style.setProperty('--rg', Math.round(260 + 600 * f))
        }
      }
      const active = (t >= 0 && t < 1) || (i === panels.length - 1 && t >= 1)
      if (active !== p.active) {
        p.active = active
        p.el.classList.toggle('is-active', active)
        p.seg?.classList.toggle('is-active', active)
      }
    }
  }

  /* ------------------------------------------------------------ scenes */
  const scan = { v: ctx.reducedMotion ? 1 : 0 }
  function paintScan() {
    if (!hadal?.focus) return
    const v = scan.v
    hadal.focus.style.setProperty('--scan', v.toFixed(4))
    hadal.focus.style.setProperty('--scan-on', v > 0.001 && v < 0.999 ? 1 : 0)
    for (const pin of pins) pin.el.style.setProperty('--on', v >= pin.x ? 1 : 0)
    hadal.out.deep = smooth(TRENCH_DEEP.x, TRENCH_DEEP.x + 0.15, v)
  }
  paintScan()

  function sizeScene(p) {
    if (!p.canvas || !p.c2d) return false
    const w = p.canvas.clientWidth
    const h = p.canvas.clientHeight
    if (!w || !h) return false
    p.dpr = Math.min(ctx.dpr, ctx.isMobile() ? 1.5 : 1.25)
    p.w = w
    p.h = h
    p.canvas.width = Math.round(w * p.dpr)
    p.canvas.height = Math.round(h * p.dpr)
    if (p.focus) {
      p.f = { x: p.focus.offsetLeft, y: p.focus.offsetTop, w: p.focus.offsetWidth || w, h: p.focus.offsetHeight || h }
    } else {
      p.f = { x: 0, y: 0, w, h }
    }
    p.scene?.setup(w, h, p.f)
    p.sized = true
    return true
  }

  function frame(p, dt) {
    const c = p.c2d
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, p.canvas.width, p.canvas.height)
    c.setTransform(p.dpr, 0, 0, p.dpr, 0, 0)
    p.scene.draw(c, p.t, dt, p.w, p.h, p.f, p.out)
    if (p.z.id === 'twilight' && p.focus) p.focus.style.setProperty('--cloud', p.out.cloud.toFixed(4))
  }

  // Reduced motion: one still per scene, a few seconds into its life.
  function still(p) {
    if (!p.sized && !sizeScene(p)) return
    p.t = 0
    for (let k = 0; k < 150; k++) {
      p.t += 1 / 30
      frame(p, 1 / 30)
    }
  }

  let ticking = false
  function loop(time, deltaMs) {
    if (document.hidden) return
    const dt = Math.min(0.05, deltaMs / 1000)
    for (const p of panels) {
      if (!p.visible || !p.scene) continue
      if (!p.sized && !sizeScene(p)) continue
      p.t += dt
      frame(p, dt)
    }
  }
  function updateLoop() {
    const any = panels.some((p) => p.visible)
    if (any && !ticking && !ctx.reducedMotion) {
      gsap.ticker.add(loop)
      ticking = true
    } else if (!any && ticking) {
      gsap.ticker.remove(loop)
      ticking = false
    }
  }

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const p = panels.find((q) => q.canvas === e.target)
          if (!p) continue
          p.visible = e.isIntersecting
          if (p.visible && ctx.reducedMotion) still(p)
          if (!p.visible && p.sized && !ctx.reducedMotion) {
            // free the backing store while off screen
            p.canvas.width = p.canvas.height = 0
            p.sized = false
          }
        }
        updateLoop()
      },
      { rootMargin: '10% 10% 10% 10%' },
    )
    for (const p of panels) if (p.canvas) io.observe(p.canvas)
  }
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => {
      for (const p of panels) {
        if (!p.sized) continue
        p.sized = false
        if (p.visible) (ctx.reducedMotion ? still(p) : sizeScene(p))
      }
    })
    for (const p of panels) if (p.canvas) ro.observe(p.canvas)
  }

  /* ------------------------------------------------------- the journey */
  const mm = gsap.matchMedia()
  mm.add(
    {
      wide: '(min-width: 900px) and (min-height: 600px) and (min-aspect-ratio: 1/1)',
      reduce: '(prefers-reduced-motion: reduce)',
      // always true: matchMedia only calls back when some condition matches
      any: '(min-width: 0px)',
    },
    (m) => {
      const { wide, reduce } = m.conditions
      if (!wide || reduce || ctx.reducedMotion) {
        root.classList.remove('is-horizontal')
        layout()
        if (!ctx.reducedMotion && hadal) {
          // stacked: the sonar sweep surveys the trench as it scrolls into view
          gsap.fromTo(
            scan,
            { v: 0 },
            {
              v: 1,
              ease: 'none',
              onUpdate: paintScan,
              scrollTrigger: { trigger: hadal.focus, start: 'top 85%', end: 'bottom 45%', scrub: 0.6 },
            },
          )
        }
        return
      }

      root.classList.add('is-horizontal')
      layout()
      const tween = gsap.to(track, {
        x: () => -dist,
        ease: 'none',
        onUpdate: render,
      })
      ScrollTrigger.create({
        trigger: root,
        start: 'top top',
        end: () => `+=${dist}`,
        pin: true,
        scrub: 0.9,
        animation: tween,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onRefreshInit: layout,
        onRefresh: () => {
          layout()
          render()
        },
      })
      // The band of layers rises out of the water above and sinks into the
      // water below: its soft top/bottom edges close up while it is pinned.
      // (Spans the whole pin: enter + travel + exit.)
      let tfLast = -1
      ScrollTrigger.create({
        trigger: root,
        start: 'top bottom',
        end: () => `+=${dist + window.innerHeight * 2}`,
        onUpdate: () => {
          const r = root.getBoundingClientRect()
          const vh = window.innerHeight
          const off = r.top > 0 ? r.top : Math.max(0, vh - r.bottom)
          const tf = Math.round(clamp(off / vh) ** 0.7 * 300) / 10
          if (tf !== tfLast) {
            tfLast = tf
            root.style.setProperty('--tf', `${tf}%`)
            root.classList.toggle('is-settled', tf === 0)
          }
        },
      })

      if (hadal) {
        gsap.fromTo(
          scan,
          { v: 0 },
          {
            v: 1,
            ease: 'none',
            onUpdate: paintScan,
            scrollTrigger: {
              trigger: hadal.el,
              containerAnimation: tween,
              start: 'left 82%',
              end: 'left 24%',
              scrub: 0.6,
            },
          },
        )
      }
      render()

      return () => {
        root.classList.remove('is-horizontal', 'is-settled')
        root.style.removeProperty('--tf')
        gsap.set(track, { clearProps: 'transform' })
        if (strip) strip.style.transform = ''
        for (const p of panels) {
          p.range?.style.removeProperty('--rw')
          p.range?.style.removeProperty('--rg')
          p.rw = -1
        }
        horizontal = false
      }
    },
  )

  ScrollTrigger.addEventListener('refresh', () => {
    layout()
    render()
  })

}
