/**
 * finale.js — #reserve (10,600 → 10,935 m). The floor of the Challenger Deep.
 *
 * Signature: touchdown. "10,935 m" comes down out of the dark and settles
 * under full pressure: the digits descend and decelerate into place without
 * overshoot while the type compresses (Anybody wdth 74 → 50, wght 600 → 880).
 * At contact the lamps reach the sediment, a puff of silt lifts into the red
 * light and hangs there, and a sonar ring runs out across the floor, lighting
 * the sediment's texture as it passes.
 *
 * The floor is generated: a perspective sediment plane (relief, grain, a sea
 * cucumber's track, burrows) lit by a pool of red lamp light, the trench walls
 * rising as silhouettes against the lamps' haze. It is painted once per size
 * into a static canvas; silt, marine snow and sonar rings live on a second one
 * that only runs while the stage is on screen and the tab is visible.
 *
 * Emits:   ctx.emit('sonar', { x, y, strength }) at touchdown, on a click on the
 *          stage, on "Send a sonar ping", and when a reservation is sent.
 *          ctx.emit('select-profile', { id }) when the visitor changes the
 *          profile in the form (profiles.js keeps its chart in sync).
 * Listens: ctx.on('select-profile', { id }) — preselects the profile, scrolls
 *          to the form and lights the field.
 * Hooks:   #reserve-form (the form block), [data-fin-*].
 */
import '../styles/finale.css'

const PROFILES = {
  twilight: {
    name: 'Twilight',
    info: 'A 5-hour dive to 1,000 m on a 3-day trip. $48,000 per guest, 40 seats a season.',
  },
  abyss: {
    name: 'Abyss',
    info: 'A 9-hour dive to the abyssal plain at 5,500 m on a 6-day trip. $195,000 per guest, 18 seats a season.',
  },
  hadal: {
    name: 'Hadal',
    info: 'A 12-hour dive to the floor of the Challenger Deep on a 9-day trip. $750,000 per guest, 6 seats a season.',
  },
}
const INFO_DEFAULT = 'Prices are per guest, for the whole trip.'

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export function init(ctx) {
  const root = document.getElementById('reserve')
  if (!root) return
  const scene = createScene(ctx, root)
  arrival(ctx, root, scene)
  sonar(ctx, root, scene)
  reservation(ctx, root)
}

/* =================================================================== noise */
function hash(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
function vnoise(x, y) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi)
  const b = hash(xi + 1, yi)
  const c = hash(xi, yi + 1)
  const d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
function fbm(x, y) {
  return vnoise(x, y) * 0.55 + vnoise(x * 2.03 + 17.1, y * 2.03 + 3.7) * 0.3 + vnoise(x * 4.1 + 5.3, y * 4.1 + 11.9) * 0.15
}
// colour ramp for red lamp light on pale sediment: black → deep red → hot red → warm white
const RAMP = [
  [0, [0, 0, 0]],
  [0.18, [30, 2, 1]],
  [0.42, [96, 10, 7]],
  [0.7, [184, 32, 22]],
  [0.95, [238, 82, 62]],
  [1.25, [255, 172, 152]],
]
function ramp(b, out) {
  if (b <= 0) {
    out[0] = out[1] = out[2] = 0
    return out
  }
  for (let i = 1; i < RAMP.length; i++) {
    if (b <= RAMP[i][0] || i === RAMP.length - 1) {
      const [p0, c0] = RAMP[i - 1]
      const [p1, c1] = RAMP[i]
      const t = clamp((b - p0) / (p1 - p0))
      out[0] = c0[0] + (c1[0] - c0[0]) * t
      out[1] = c0[1] + (c1[1] - c0[1]) * t
      out[2] = c0[2] + (c1[2] - c0[2]) * t
      return out
    }
  }
  return out
}
function sprite(size, stops) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  stops.forEach(([o, c]) => grd.addColorStop(o, c))
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return cv
}
// soft light cone pointing down from its apex (top centre)
function coneSprite(w, h, tan, power = 1.3) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')
  const img = g.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    const half = 2 + y * tan
    const ax = Math.pow(1 - y / h, power) * Math.min(1, y / 30)
    for (let x = 0; x < w; x++) {
      const v = (x - w / 2) / half
      const a = Math.exp(-v * v * 2.2) * ax
      const i = (y * w + x) * 4
      img.data[i] = 255
      img.data[i + 1] = 62
      img.data[i + 2] = 48
      img.data[i + 3] = Math.round(a * 255)
    }
  }
  g.putImageData(img, 0, 0)
  return cv
}

/* =================================================================== scene */
function createScene(ctx, root) {
  const stage = root.querySelector('[data-fin-stage]')
  const sceneEl = root.querySelector('[data-fin-scene]')
  const floorC = root.querySelector('[data-fin-floor]')
  const fxC = root.querySelector('[data-fin-fx]')
  const fg = floorC.getContext('2d')
  const fx = fxC.getContext('2d')
  const reduced = ctx.reducedMotion
  let mobile = ctx.isMobile()
  let dpr = Math.min(ctx.dpr, mobile ? 1.25 : 1.5)

  // geometry (css px, scene space)
  let W = 1
  let H = 1 // scene height (stage + overhang)
  let Hs = 1 // stage height
  let horizon = 0
  let cx = 0
  let K = 1
  let f = 1
  let z0 = 5
  let poolY = 0
  let built = false
  let lastW = 0
  let hi = null // sonar-revealed sediment

  const rings = []
  const silt = []
  let snow = []
  let raf = 0
  let visible = false
  let last = 0
  let arrived = false
  let nextPing = 0

  const dot = sprite(32, [
    [0, 'rgba(255,232,224,1)'],
    [0.22, 'rgba(255,118,96,0.8)'],
    [1, 'rgba(255,59,47,0)'],
  ])
  const puff = sprite(128, [
    [0, 'rgba(255,92,72,0.5)'],
    [0.5, 'rgba(255,59,47,0.18)'],
    [1, 'rgba(255,59,47,0)'],
  ])

  /* --------------------------------------------------- the static floor */
  function layout() {
    const sr = stage.getBoundingClientRect()
    const r = sceneEl.getBoundingClientRect()
    mobile = ctx.isMobile()
    dpr = Math.min(ctx.dpr, mobile ? 1.25 : 1.5)
    W = Math.max(1, Math.round(r.width))
    H = Math.max(1, Math.round(r.height))
    Hs = Math.max(1, Math.round(sr.height))
    cx = W / 2
    horizon = Hs * (mobile ? 0.7 : 0.66)
    // camera: the stage's bottom edge is 2.6 m in front of the viewport
    K = (Hs - horizon) * 2.6
    poolY = Hs * (mobile ? 0.86 : 0.84)
    z0 = K / (poolY - horizon)
    f = Math.max(W, 900) * (mobile ? 0.13 : 0.075) * z0 // px per metre at the pool = f / z0
  }

  // the lamps are aimed a few metres ahead: a pool on the sediment, dark at the edges
  const lampAt = (X, z) => {
    const dx = X / (mobile ? 1.25 : 1.6)
    const dz = (z - z0) / 1.9
    const core = Math.exp(-(dx * dx + dz * dz) * 0.5)
    const skirt = Math.exp(-((dx * dx) / 5 + (dz * dz) / 6) * 0.5) * 0.1
    return core + skirt
  }
  const heightAt = (X, z) => fbm(X * 0.55 + 40, z * 0.55 + 9) * 0.9 + vnoise(X * 2.6, z * 2.6) * 0.12
  // a sea cucumber has ploughed a track through the pool
  const trackX = (z) => 1.25 * Math.sin(z * 0.42 + 0.6) - 0.5 + 0.18 * Math.sin(z * 1.7)
  const BURROWS = [
    [-1.6, 4.4, 0.09],
    [1.9, 6.2, 0.07],
    [0.7, 3.6, 0.05],
    [-2.6, 7.8, 0.11],
    [2.9, 4.9, 0.06],
    [-0.3, 8.6, 0.08],
  ]

  /* The sediment is shaded per css pixel in a time-sliced job so building it
     never blocks scrolling; relief is sampled on 2×2 blocks, grain per pixel. */
  let job = null
  function beginPaint() {
    layout()
    const top = Math.floor(horizon) - 1
    const rows = Math.max(2, Math.ceil(H - top))
    const lit = document.createElement('canvas')
    lit.width = W
    lit.height = rows
    const glow = document.createElement('canvas')
    glow.width = W
    glow.height = rows
    const im1 = lit.getContext('2d').createImageData(W, rows)
    const im2 = glow.getContext('2d').createImageData(W, rows)
    job = { top, rows, lit, glow, im1, im2, j: 0, W }
  }

  const col = [0, 0, 0]
  function shadeRows(j0) {
    const { top, rows, im1, im2 } = job
    const d1 = im1.data
    const d2 = im2.data
    const E = 0.05
    for (let i0 = 0; i0 < W; i0 += 2) {
      // relief for this 2×2 block
      const yb = top + j0 + 1
      const dyb = yb - horizon
      let relief = 1
      if (dyb > 0.25) {
        const zb = K / dyb
        const Xb = (i0 + 1 - cx) / (f / zb)
        const h0 = heightAt(Xb, zb)
        const slope = (heightAt(Xb, zb - E) - h0) / E // faces the camera when > 0
        const slopeX = (heightAt(Xb + E, zb) - h0) / E
        relief = 0.82 + slope * 0.9 - slopeX * 0.25
      }
      for (let dj = 0; dj < 2; dj++) {
        const j = j0 + dj
        if (j >= rows) break
        const y = top + j + 0.5
        const dy = y - horizon
        if (dy <= 0.25) continue
        const z = K / dy
        const pxPerM = f / z
        const far = smooth(0, 1, (dy - 0.5) / 26) // fades into the dark at the horizon
        const tX = trackX(z)
        for (let di = 0; di < 2; di++) {
          const i = i0 + di
          if (i >= W) break
          const X = (i + 0.5 - cx) / pxPerM
          let shade = relief
          // the track: a soft groove with lifted rims
          const td = Math.abs(X - tX)
          if (td < 0.4) {
            shade *= 1 - 0.42 * Math.exp(-((td / 0.06) ** 2)) + 0.16 * Math.exp(-(((td - 0.13) / 0.045) ** 2))
          }
          // burrows
          for (let b = 0; b < BURROWS.length; b++) {
            const bw = BURROWS[b]
            const dd = Math.hypot(X - bw[0], (z - bw[1]) * 1.1)
            if (dd < bw[2] * 3) {
              shade *= 1 - 0.75 * Math.exp(-((dd / bw[2]) ** 2) * 1.6) + 0.22 * Math.exp(-(((dd - bw[2] * 1.4) / (bw[2] * 0.5)) ** 2))
            }
          }
          // grain: fine silt per pixel + world-space clumps
          const gx = hash(i * 7 + 3, j * 13 + 1)
          const clump = vnoise(X * 7, z * 7)
          let tex = (0.74 + 0.5 * gx) * (0.82 + 0.36 * clump)
          if (gx > 0.994) tex += 0.9 // a bright grain catching the lamp
          shade = Math.max(0.2, shade) * tex

          const b1 = lampAt(X, z) * shade * (mobile ? 0.82 : 0.94) * far
          ramp(b1, col)
          const k = (j * W + i) * 4
          d1[k] = col[0]
          d1[k + 1] = col[1]
          d1[k + 2] = col[2]
          d1[k + 3] = 255

          // what a sonar ring shows: the same sediment, evenly lit, fading with range
          const b2 = (0.55 * shade * Math.exp(-Math.max(0, z - 2) * 0.05) + 0.08) * far
          d2[k] = 255
          d2[k + 1] = 70 + 120 * clamp(b2 - 0.5)
          d2[k + 2] = 52 + 100 * clamp(b2 - 0.5)
          d2[k + 3] = Math.round(clamp(b2 * 0.85) * 255)
        }
      }
    }
  }

  // run the job for up to `budget` ms (Infinity = finish now)
  function stepPaint(budget) {
    if (!job) return true
    const t0 = performance.now()
    while (job.j < job.rows) {
      shadeRows(job.j)
      job.j += 2
      if (performance.now() - t0 > budget) return false
    }
    compose()
    return true
  }
  let pumping = false
  function pump() {
    if (pumping) return
    pumping = true
    const tick = () => {
      if (!job) {
        pumping = false
        return
      }
      if (stepPaint(9)) {
        pumping = false
        return
      }
      setTimeout(tick, 0)
    }
    tick()
  }

  function compose() {
    const { top, rows, lit, glow, im1, im2 } = job
    job = null
    lit.getContext('2d').putImageData(im1, 0, 0)
    glow.getContext('2d').putImageData(im2, 0, 0)
    const pw = Math.round(W * dpr)
    const ph = Math.round(H * dpr)
    floorC.width = fxC.width = pw
    floorC.height = fxC.height = ph

    const g = fg
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.globalCompositeOperation = 'source-over'
    g.clearRect(0, 0, W, H)

    // 1. the lamps' haze in the water, behind everything
    g.globalCompositeOperation = 'lighter'
    const hy = horizon - Hs * 0.06
    const haze = g.createRadialGradient(cx, hy, 0, cx, hy, Math.max(W * 0.62, Hs * 0.8))
    haze.addColorStop(0, 'rgba(255,59,47,0.14)')
    haze.addColorStop(0.35, 'rgba(255,59,47,0.06)')
    haze.addColorStop(1, 'rgba(255,59,47,0)')
    g.fillStyle = haze
    g.fillRect(0, 0, W, H)

    // 2. the trench walls: dark silhouettes rising at both edges of the view
    g.globalCompositeOperation = 'source-over'
    const ridge = (amp, rise, seed, fill) => {
      const pts = []
      for (let x = 0; x <= W + 8; x += 6) {
        const e = Math.abs(x - cx) / (W / 2)
        const hgt = (fbm(x / (W * 0.08) + seed, seed) - 0.35) * amp + Math.pow(e, 2.4) * rise
        pts.push([x, horizon - Math.max(0, hgt)])
      }
      g.beginPath()
      g.moveTo(0, horizon + 2)
      pts.forEach(([x, y]) => g.lineTo(x, y))
      g.lineTo(W + 8, horizon + 2)
      g.closePath()
      g.fillStyle = fill
      g.fill()
      return pts
    }
    const farPts = ridge(Hs * 0.035, Hs * (mobile ? 0.14 : 0.24), 3.1, 'rgb(7 1 1)')
    const nearPts = ridge(Hs * 0.02, Hs * (mobile ? 0.08 : 0.13), 8.4, 'rgb(0 0 0)')

    // 3. the sediment
    g.drawImage(lit, 0, top, W, rows)

    // 4. light in front: the two lamp beams and their scatter
    g.globalCompositeOperation = 'lighter'
    const cone = coneSprite(200, 400, 0.24, 1.4)
    const beam = (sx, sy, tx, ty, alpha) => {
      const dx = tx - sx
      const dy = ty - sy
      const len = Math.hypot(dx, dy) * 1.12
      const s = len / cone.height
      g.save()
      g.translate(sx, sy)
      g.rotate(Math.atan2(dy, dx) - Math.PI / 2)
      g.globalAlpha = alpha
      g.drawImage(cone, (-cone.width * s) / 2, 0, cone.width * s, len)
      g.restore()
    }
    const spread = mobile ? 0.26 : 0.13
    beam(cx - W * spread, -Hs * 0.1, cx - W * 0.03, poolY, 0.13)
    beam(cx + W * spread, -Hs * 0.1, cx + W * 0.03, poolY, 0.13)
    g.globalAlpha = 1
    const py = poolY - Hs * 0.04
    const pool = g.createRadialGradient(cx, py, 0, cx, py, W * 0.4)
    pool.addColorStop(0, 'rgba(255,70,52,0.12)')
    pool.addColorStop(1, 'rgba(255,59,47,0)')
    g.fillStyle = pool
    g.fillRect(0, horizon - Hs * 0.3, W, H)
    g.globalCompositeOperation = 'source-over'

    // the sonar layer: sediment + the walls' contours
    hi = document.createElement('canvas')
    hi.width = W
    hi.height = H
    const h = hi.getContext('2d')
    h.drawImage(glow, 0, top, W, rows)
    const contour = (pts, a) => {
      h.beginPath()
      pts.forEach(([x, y], k) => (k ? h.lineTo(x, y) : h.moveTo(x, y)))
      h.strokeStyle = `rgba(255,96,74,${a})`
      h.lineWidth = 1.2
      h.stroke()
    }
    contour(farPts, 0.55)
    contour(nearPts, 0.9)

    seedSnow()
    built = true
    lastW = W
    if (!raf) drawFx(0)
    start()
  }

  /* ----------------------------------------------------- living things */
  const light = (x, y) => {
    // how much lamp light reaches a point in the water (screen-space)
    const dx = (x - cx) / (W * (mobile ? 0.42 : 0.3))
    const dy = (y - (poolY - Hs * 0.22)) / (Hs * 0.5)
    return Math.exp(-(dx * dx + dy * dy))
  }

  function seedSnow() {
    const n = reduced ? 50 : Math.round(clamp((W * Hs) / 9000, 50, 150))
    snow = Array.from({ length: n }, () => {
      const z = Math.random()
      return {
        x: Math.random() * W,
        y: Math.random() * Hs * 1.1,
        r: (0.5 + z * z * 1.8) * (mobile ? 0.7 : 1),
        vy: 2.5 + z * 7,
        ph: Math.random() * 6.28,
        z,
      }
    })
  }

  function spawnSilt(strength = 1) {
    if (reduced) return
    const n = Math.round((mobile ? 170 : 300) * strength)
    const spanX = W * (mobile ? 0.36 : 0.2)
    for (let i = 0; i < n; i++) {
      const gx = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5 // ~gaussian
      const x = cx + gx * spanX
      const lift = 1 - Math.abs(gx) * 0.55
      silt.push({
        x,
        y: poolY + (Math.random() - 0.3) * Hs * 0.07,
        vx: gx * (40 + Math.random() * 140),
        vy: -(30 + Math.random() * 170) * lift,
        r: (0.5 + Math.random() ** 2 * 2.2) * (mobile ? 0.62 : 1),
        age: -Math.random() * 0.25,
        life: 22 + Math.random() * 20,
        ph: Math.random() * 6.28,
        soft: false,
      })
    }
    const m = mobile ? 18 : 34
    for (let i = 0; i < m; i++) {
      const gx = (Math.random() + Math.random() - 1) * 1.1
      silt.push({
        x: cx + gx * spanX,
        y: poolY + Math.random() * Hs * 0.03,
        vx: gx * (30 + Math.random() * 60),
        vy: -(20 + Math.random() * 70),
        r: Hs * (0.04 + Math.random() * 0.07),
        grow: 8 + Math.random() * 14,
        age: -Math.random() * 0.2,
        life: 9 + Math.random() * 7,
        ph: Math.random() * 6.28,
        soft: true,
      })
    }
  }

  function ring(x, y, { strength = 1, reveal = true, dur = 5.2 } = {}) {
    if (!built) return
    const maxR = Math.hypot(Math.max(x, W - x), Math.max(y, H - y)) * 1.04
    rings.push({ x, y, t: 0, dur: reduced ? 1.6 : dur, maxR, strength, reveal })
    if (reduced) {
      rings[rings.length - 1].still = true
    }
    start()
  }

  /* ------------------------------------------------------------ frame */
  function drawFx(dt) {
    const g = fx
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.globalCompositeOperation = 'source-over'
    g.clearRect(0, 0, W, H)
    g.globalCompositeOperation = 'lighter'
    const t = performance.now() / 1000

    // marine snow, sinking through the lamp light
    for (let i = 0; i < snow.length; i++) {
      const p = snow[i]
      if (!reduced) {
        p.y += p.vy * dt
        p.x += Math.sin(t * 0.3 + p.ph) * 3 * dt
        if (p.y > Hs * 1.1) {
          p.y = -10
          p.x = Math.random() * W
        }
      }
      const L = light(p.x, p.y)
      const a = 0.05 + L * 0.75
      if (a < 0.03) continue
      const r = p.r * (2 + L)
      g.globalAlpha = clamp(a * (0.5 + p.z * 0.5))
      g.drawImage(dot, p.x - r, p.y - r, r * 2, r * 2)
    }

    // silt from the touchdown: lifts, spreads, slows, hangs, sinks
    for (let i = silt.length - 1; i >= 0; i--) {
      const p = silt[i]
      p.age += dt
      if (p.age < 0) continue
      if (p.age > p.life) {
        silt.splice(i, 1)
        continue
      }
      const drag = Math.exp(-dt * (p.soft ? 1.3 : 1.05))
      p.vx *= drag
      p.vy = p.vy * drag + (p.soft ? 2 : 4.5) * dt
      p.x += (p.vx + Math.sin(t * 0.5 + p.ph) * 5) * dt
      p.y += p.vy * dt
      const fade = smooth(0, 0.35, p.age) * (1 - smooth(p.life * 0.62, p.life, p.age))
      const L = 0.25 + light(p.x, p.y) * 0.95
      if (p.soft) {
        p.r += p.grow * dt
        g.globalAlpha = clamp(fade * L * 0.16)
        g.drawImage(puff, p.x - p.r, p.y - p.r * 0.7, p.r * 2, p.r * 1.4)
      } else {
        const r = p.r * 2.4
        g.globalAlpha = clamp(fade * L * 0.85)
        g.drawImage(dot, p.x - r, p.y - r, r * 2, r * 2)
      }
    }

    // sonar
    for (let i = rings.length - 1; i >= 0; i--) {
      const R = rings[i]
      R.t += dt
      const k = R.t / R.dur
      if (k >= 1) {
        rings.splice(i, 1)
        continue
      }
      const e = R.still ? 0.35 : 1 - Math.pow(1 - k, 2.6)
      const r = 12 + e * R.maxR
      const a = Math.pow(1 - k, 1.4) * R.strength
      g.globalAlpha = 1
      g.lineWidth = 1.1
      g.strokeStyle = `rgba(255,86,66,${(a * 0.75).toFixed(3)})`
      g.beginPath()
      g.arc(R.x, R.y, r, 0, Math.PI * 2)
      g.stroke()
      if (!R.still && r > 40) {
        g.strokeStyle = `rgba(255,86,66,${(a * 0.22).toFixed(3)})`
        g.beginPath()
        g.arc(R.x, R.y, r * 0.93, 0, Math.PI * 2)
        g.stroke()
      }
      // the sediment answers where the ring passes
      if (R.reveal && hi && r > horizon - R.y - 60) {
        const bands = [
          [0, 10, 0.95],
          [10, 34, 0.45],
          [34, 90, 0.16],
        ]
        for (const [w0, w1, ba] of bands) {
          const r0 = Math.max(0, r - w1)
          const r1 = Math.max(0, r - w0)
          if (r1 <= 0) continue
          g.save()
          g.beginPath()
          g.arc(R.x, R.y, r1, 0, Math.PI * 2)
          g.arc(R.x, R.y, r0, 0, Math.PI * 2, true)
          g.clip()
          g.globalAlpha = clamp(a * ba)
          g.drawImage(hi, 0, 0, W, H)
          g.restore()
        }
      }
    }
    g.globalAlpha = 1
  }

  function loop(now) {
    raf = 0
    const dt = Math.min(0.05, (now - (last || now)) / 1000)
    last = now
    if (arrived && !reduced && now > nextPing) {
      nextPing = now + 6500 + Math.random() * 2000
      const c = figureCentre()
      if (c) ring(c.x, c.y, { strength: 0.7, dur: 6 })
    }
    drawFx(dt)
    const busy = !reduced || rings.length > 0
    if (visible && !document.hidden && busy) raf = requestAnimationFrame(loop)
  }
  function start() {
    if (raf || !visible || document.hidden || !built) return
    last = 0
    raf = requestAnimationFrame(loop)
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  // figure centre in scene space
  let figureEl = null
  function figureCentre() {
    figureEl ??= root.querySelector('[data-fin-digits]')
    if (!figureEl) return null
    const a = figureEl.getBoundingClientRect()
    const s = sceneEl.getBoundingClientRect()
    return { x: a.left - s.left + a.width / 2, y: a.top - s.top + a.height * 0.55 }
  }
  const toScene = (clientX, clientY) => {
    const s = sceneEl.getBoundingClientRect()
    return { x: clientX - s.left, y: clientY - s.top }
  }

  /* ---------------------------------------------------- build lazily */
  // sync = finish the floor now (it is needed this frame)
  const build = (sync = false) => {
    if (!job && built && Math.abs(lastW - sceneEl.clientWidth) < 2) return
    if (!job) beginPaint()
    sync ? stepPaint(Infinity) : pump()
  }
  const idle = window.requestIdleCallback?.bind(window) || ((fn) => setTimeout(fn, 60))
  const io = new IntersectionObserver(
    ([e]) => {
      if (e.isIntersecting && !built) idle(() => build(), { timeout: 400 })
    },
    { rootMargin: '150% 0px' },
  )
  io.observe(stage)
  const ioVis = new IntersectionObserver(
    ([e]) => {
      visible = e.isIntersecting
      if (visible && !built) build(true)
      visible ? start() : stop()
    },
    { rootMargin: '40px 0px' },
  )
  ioVis.observe(sceneEl)
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()))
  let rT = 0
  window.addEventListener('resize', () => {
    clearTimeout(rT)
    rT = setTimeout(() => {
      if (!built) return
      // phones resize on scroll as the toolbar moves: only rebuild for real width changes
      if (Math.abs(sceneEl.clientWidth - lastW) > 2 || Math.abs(stage.clientHeight - Hs) > 120) {
        job = null
        beginPaint()
        pump()
      }
    }, 220)
  })

  return {
    build,
    start,
    ring,
    figureCentre,
    toScene,
    touchdown(strength = 1) {
      build(true)
      spawnSilt(strength)
      const c = figureCentre()
      if (c) ring(c.x, c.y, { strength: 1.15, dur: 5.6 })
      arrived = true
      nextPing = performance.now() + 7000
      start()
    },
    setArrived(v) {
      arrived = v
      if (!v) {
        silt.length = 0
        rings.length = 0
      }
    },
  }
}

/* ================================================================ arrival */
function arrival(ctx, root, scene) {
  const { gsap, ScrollTrigger } = ctx
  const stage = root.querySelector('[data-fin-stage]')
  const fig = root.querySelector('[data-fin-figure]')
  const digits = root.querySelector('[data-fin-digits]')
  const unit = root.querySelector('.fin__unit')
  const reveals = [...root.querySelectorAll('[data-fin-reveal]')]

  if (ctx.reducedMotion) {
    root.style.setProperty('--fin-floor', 1)
    scene.build()
    scene.setArrived(false)
    return
  }

  const split = new ctx.SplitText(digits, { type: 'chars', charsClass: 'fin__char' })
  digits.classList.add('is-split')
  const chars = split.chars
  const P = { s: 74, w: 600, floor: 0.16 }
  const apply = () => {
    fig.style.setProperty('--fin-wdth', `${P.s.toFixed(2)}%`)
    fig.style.setProperty('--fin-wght', P.w.toFixed(0))
    root.style.setProperty('--fin-floor', P.floor.toFixed(3))
  }

  const reset = () => {
    P.s = 74
    P.w = 600
    P.floor = 0.16
    apply()
    gsap.set(chars, { yPercent: -62, opacity: 0 })
    gsap.set(unit, { opacity: 0 })
    gsap.set(reveals, { opacity: 0 })
    scene.setArrived(false)
  }
  reset()

  let landed = false
  const touchdown = () => {
    scene.touchdown(1)
    const r = digits.getBoundingClientRect()
    ctx.emit('sonar', { x: r.left + r.width / 2, y: r.top + r.height * 0.55, strength: 1 })
  }

  const tl = gsap.timeline({ paused: true })
  tl.to(chars, { opacity: 1, duration: 0.9, ease: 'power1.out', stagger: { each: 0.05, from: 'center' } }, 0)
    // the descent: steady, then a long, soft deceleration into contact
    .to(chars, { yPercent: 0, duration: 2.1, ease: 'power3.out', stagger: { each: 0.045, from: 'center' } }, 0)
    // full pressure: the figure narrows and thickens as it lands
    .to(P, { s: 50, w: 880, duration: 2.5, ease: 'power2.inOut', onUpdate: apply }, 0.05)
    .call(touchdown, null, 1.25)
    .to(P, { floor: 1, duration: 2.6, ease: 'power2.out', onUpdate: apply }, 1.1)
    .to(unit, { opacity: 1, duration: 1.2, ease: 'power1.out' }, 1.6)
    .to(reveals, { opacity: 1, duration: 1.4, ease: 'power1.out', stagger: 0.18 }, 1.9)

  ScrollTrigger.create({
    trigger: stage,
    start: 'top 42%',
    onEnter: () => {
      if (landed) return
      landed = true
      scene.build()
      tl.restart()
    },
  })
  // once the stage is fully out of sight above-water, the next descent lands again
  ScrollTrigger.create({
    trigger: stage,
    start: 'top bottom',
    onLeaveBack: () => {
      landed = false
      tl.pause(0)
      reset()
    },
  })
}

/* ================================================================== sonar */
function sonar(ctx, root, scene) {
  const stage = root.querySelector('[data-fin-stage]')
  const btn = root.querySelector('[data-fin-ping]')

  stage.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, select, textarea, label')) return
    if (String(window.getSelection?.() || '').length) return
    const p = scene.toScene(e.clientX, e.clientY)
    scene.ring(p.x, p.y, { strength: 1, dur: 5 })
    ctx.emit('sonar', { x: e.clientX, y: e.clientY, strength: 1 })
  })

  btn?.addEventListener('click', () => {
    const c = scene.figureCentre()
    if (c) scene.ring(c.x, c.y, { strength: 1.1, dur: 5.4 })
    const d = root.querySelector('[data-fin-digits]').getBoundingClientRect()
    ctx.emit('sonar', { x: d.left + d.width / 2, y: d.top + d.height * 0.55, strength: 1 })
  })
}

/* ============================================================ reservation */
function reservation(ctx, root) {
  const { gsap } = ctx
  const book = root.querySelector('[data-fin-book]')
  const panel = root.querySelector('[data-fin-panel]')
  const form = root.querySelector('[data-fin-form]')
  const done = root.querySelector('[data-fin-done]')
  const doneTitle = root.querySelector('[data-fin-done-title]')
  const summary = root.querySelector('[data-fin-summary]')
  const again = root.querySelector('[data-fin-again]')
  const submit = root.querySelector('[data-fin-submit]')
  const info = root.querySelector('[data-fin-info]')
  const select = form.elements.profile
  const fieldEl = (n) => form.querySelector(`[data-fin-field="${n}"]`)
  const ORDER = ['name', 'email', 'profile', 'month']
  const shown = new Set()

  const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/
  const check = {
    name: () => (form.elements.name.value.trim() ? '' : 'Enter your name so we know who is coming.'),
    email: () => {
      const v = form.elements.email.value.trim()
      if (!v) return 'Enter an email address so we can reply.'
      if (!EMAIL.test(v)) return 'That email address looks incomplete. Check the part after the @.'
      return ''
    },
    profile: () => (PROFILES[select.value] ? '' : 'Choose one of the three dive profiles.'),
    month: () => (form.querySelector('input[name="month"]:checked') ? '' : 'Choose a month between November and April.'),
  }
  const controls = (n) =>
    n === 'month' ? [...form.querySelectorAll('input[name="month"]')] : [form.elements[n]]

  function show(n, msg) {
    const el = fieldEl(n)
    const err = el.querySelector('[data-fin-error]')
    if (err.textContent !== msg) err.textContent = msg
    el.classList.toggle('is-invalid', !!msg)
    controls(n).forEach((c) => (msg ? c.setAttribute('aria-invalid', 'true') : c.removeAttribute('aria-invalid')))
    msg ? shown.add(n) : shown.delete(n)
  }
  const validate = (n) => {
    const msg = check[n]()
    show(n, msg)
    return !msg
  }

  // inline: judge a field when you leave it (if you typed), then live until it is right
  form.addEventListener('focusout', (e) => {
    const n = e.target.closest('[data-fin-field]')?.dataset.finField
    if (!check[n] || n === 'month') return
    const v = e.target.value?.trim?.() ?? ''
    if (v || shown.has(n)) validate(n)
  })
  form.addEventListener('input', (e) => {
    const n = e.target.closest('[data-fin-field]')?.dataset.finField
    if (check[n] && shown.has(n)) validate(n)
  })

  function updateInfo() {
    info.textContent = PROFILES[select.value]?.info ?? INFO_DEFAULT
  }

  let selfEmit = false
  select.addEventListener('change', () => {
    updateInfo()
    if (shown.has('profile')) validate('profile')
    if (PROFILES[select.value]) {
      selfEmit = true
      ctx.emit('select-profile', { id: select.value })
      selfEmit = false
    }
  })
  form.addEventListener('change', (e) => {
    if (e.target.name === 'month' && shown.has('month')) validate('month')
  })

  // the depth chart chose a profile: preselect it, take the visitor to the form, light it
  let flagT = 0
  const flag = () => {
    const el = fieldEl('profile')
    el.classList.remove('is-flagged')
    void el.offsetWidth
    el.classList.add('is-flagged')
    clearTimeout(flagT)
    flagT = setTimeout(() => el.classList.remove('is-flagged'), 2600)
  }
  ctx.on('select-profile', (d = {}) => {
    if (selfEmit || !PROFILES[d.id]) return
    select.value = d.id
    updateInfo()
    if (shown.has('profile')) validate('profile')
    if (form.hidden) return
    // after the sender's own scroll call, so this one wins
    setTimeout(() => {
      let fired = false
      const once = () => {
        if (fired) return
        fired = true
        flag()
      }
      // (#reserve-form carries a scroll-margin-top, which Lenis honours)
      ctx.scrollTo(book, { duration: 3, onComplete: once })
      setTimeout(once, ctx.lenis ? 3300 : 60)
    }, 0)
  })

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const bad = ORDER.filter((n) => !validate(n))
    if (bad.length) {
      const first = bad[0]
      const target =
        first === 'month' ? form.querySelector('input[name="month"]') : form.elements[first]
      target.focus({ preventScroll: false })
      return
    }
    sent()
  })

  function sent() {
    const email = form.elements.email.value.trim()
    const p = PROFILES[select.value].name
    const month = form.querySelector('input[name="month"]:checked').value
    summary.textContent = `We will write to ${email} about the ${p} profile in ${month}.`

    const r = submit.getBoundingClientRect()
    ctx.emit('sonar', { x: r.left + r.width / 2, y: r.top + r.height / 2, strength: 1 })

    const rings = [...done.querySelectorAll('.fin__done-ring')]
    if (ctx.reducedMotion) {
      form.hidden = true
      done.hidden = false
      rings.forEach((c, i) => gsap.set(c, { attr: { r: 20 + i * 16 }, opacity: 0.6 - i * 0.18 }))
      doneTitle.focus({ preventScroll: true })
      return
    }

    const h0 = panel.offsetHeight
    panel.style.height = `${h0}px`
    panel.style.overflow = 'hidden'
    gsap.to(form.children, {
      opacity: 0,
      filter: 'blur(6px)',
      duration: 0.55,
      ease: 'power2.in',
      stagger: 0.05,
      onComplete: () => {
        form.hidden = true
        gsap.set(form.children, { clearProps: 'opacity,filter' })
        done.hidden = false
        const h1 = done.offsetHeight
        const kids = [...done.children].filter((k) => !k.classList.contains('fin__done-mark'))
        gsap.fromTo(
          panel,
          { height: h0 },
          {
            height: h1,
            duration: 1.1,
            ease: 'abyss',
            onComplete: () => {
              panel.style.height = ''
              panel.style.overflow = ''
            },
          },
        )
        // a return on the sonar: the contact rings, then the words
        gsap.set(rings, { attr: { r: 6 }, opacity: 0 })
        gsap.to(rings, {
          keyframes: [
            { attr: { r: 6 }, opacity: 0.95, duration: 0.01 },
            { attr: { r: 58 }, opacity: 0, duration: 3.2, ease: 'power2.out' },
          ],
          stagger: { each: 1.05, repeat: -1 },
        })
        gsap.fromTo(
          kids,
          { opacity: 0, filter: 'blur(8px)' },
          { opacity: 1, filter: 'blur(0px)', duration: 1.3, ease: 'power2.out', stagger: 0.14, delay: 0.2, clearProps: 'filter' },
        )
        doneTitle.focus({ preventScroll: true })
      },
    })
  }

  again.addEventListener('click', () => {
    gsap.killTweensOf(done.querySelectorAll('.fin__done-ring'))
    done.hidden = true
    form.hidden = false
    if (!ctx.reducedMotion) {
      gsap.fromTo(form.children, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'power1.out', stagger: 0.05 })
    }
    form.elements.name.focus()
  })

  updateInfo()
}
