/**
 * finale.js — #reserve (10,600 → 10,935 m). The floor of the Challenger Deep.
 *
 * Signature: touchdown, in two movements.
 *  1. The approach (scrubbed by scroll, from the moment the stage enters until
 *     the figure reaches the middle of the screen, where the HUD reads
 *     10,935): "10,935 m" sinks out of the dark towards its place, the floor
 *     rises into the lamps, marine snow thickens and the digits begin to feel
 *     the pressure.
 *  2. The settle (time-based, at contact): the digits land without overshoot
 *     and compress to full pressure (Anybody wdth 72 → 50, wght 560 → 820,
 *     tracking opening from -0.012em to +0.03em so pressure reads as the digits
 *     being pressed apart rather than fused), a puff of silt lifts into the red
 *     light and hangs there, and a sonar ring runs out across the sediment.
 *
 * The floor is generated: a perspective sediment plane (relief, grain, a sea
 * cucumber's track, burrows) lit by a pool of red lamp light, the trench walls
 * rising as silhouettes against the lamps' haze. It is painted once per size
 * into a static canvas; silt, marine snow, sonar rings and the life the sonar
 * finds live on a second canvas that only runs while the stage is on screen
 * and the tab is visible. Sonar rings are drawn on the sediment plane (in
 * perspective, behind the type); as a ring passes, the sediment answers and
 * three hidden contacts light up: amphipods, a xenophyophore, and the sea
 * cucumber at the end of its track. A visitor's ping is logged next to the
 * button (in room reserved for it, so the stage never reflows).
 *
 * The confirmation: the form clears, the request is written up as a line in
 * the dive log, the lamp sweeps across "Reservation request received" the way
 * it reads the guests' words in #voices, and sonar returns run out from the
 * button three times before the beacon goes out.
 *
 * Emits:   ctx.emit('sonar', { x, y, strength }) at touchdown, on a click on the
 *          stage, on "Send a sonar ping", and when a reservation is sent.
 *          ctx.emit('select-profile', { id }) when the visitor changes the
 *          profile in the form (profiles.js keeps its chart in sync).
 * Listens: ctx.on('select-profile', { id }) — preselects the profile and dives
 *          to the form: the page goes dark while the HUD counts down to the
 *          floor, then fades up on the settled floor with the field flagged
 *          and the keyboard focus on the form.
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

// pressure on the figure: c = 0 (arriving) → 1 (landed, full pressure)
const FIG = { s0: 72, s1: 50, w0: 560, w1: 820, t0: -0.012, t1: 0.03 }

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export function init(ctx) {
  const root = document.getElementById('reserve')
  if (!root) return
  const scene = createScene(ctx, root)
  const arrive = arrival(ctx, root, scene)
  sonar(ctx, root, scene)
  reservation(ctx, root, arrive)
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
  let gutter = 0 // the depth ruler and its labels on the right: floor labels stay clear
  let hi = null // sonar-revealed sediment
  let walls = null // sonar-revealed contours of the trench walls

  const rings = []
  const silt = []
  let snow = []
  let raf = 0
  let visible = false
  let last = 0
  let arrived = false
  let nextPing = 0
  let approach = 1 // 0 → 1 while the stage scrolls in (marine snow thickens)
  let onContact = null

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
  const blip = sprite(64, [
    [0, 'rgba(255,200,186,0.9)'],
    [0.3, 'rgba(255,86,66,0.35)'],
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
    const inst = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--instrument')) || 0
    gutter = inst ? inst + 56 : 0
    horizon = Hs * (mobile ? 0.7 : 0.655)
    // camera: the stage's bottom edge is 2.6 m in front of the viewport
    K = (Hs - horizon) * 2.6
    poolY = Hs * (mobile ? 0.86 : 0.82)
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
  // a sea cucumber has ploughed a track through the pool; it is still at the far end of it
  const trackX = (z) => 1.25 * Math.sin(z * 0.42 + 0.6) - 0.5 + 0.18 * Math.sin(z * 1.7)
  const trackEnd = () => (mobile ? 6.3 : 8.5)
  const BURROWS = [
    [-1.6, 4.4, 0.09],
    [1.9, 6.2, 0.07],
    [0.7, 3.6, 0.05],
    [-2.6, 7.8, 0.11],
    [2.9, 4.9, 0.06],
    [-0.3, 8.6, 0.08],
  ]

  /* The life the sonar finds. World metres: X across, z away from Vesper's
     viewport. Placed outside the lamps' pool, so only the sonar shows them. */
  let contacts = []
  function placeContacts() {
    const te = trackEnd()
    const desk = [
      { id: 'amphipods', name: 'Amphipods', X: 2.7, z: 4.1 },
      { id: 'xeno', name: 'Xenophyophore', X: -3.6, z: 7.2, left: true },
      { id: 'cucumber', name: 'Sea cucumber', X: trackX(te), z: te },
    ]
    // on a phone the labels are the log: keep them clear of one another
    const mob = [
      { id: 'amphipods', name: 'Amphipods', X: 1.0, z: 4.0 },
      { id: 'xeno', name: 'Xenophyophore', X: 2.2, z: 8.6, left: true },
      { id: 'cucumber', name: 'Sea cucumber', X: trackX(te), z: te },
    ]
    const prev = new Map(contacts.map((c) => [c.id, c]))
    contacts = (mobile ? mob : desk).map((c) => ({
      ...c,
      dist: Math.hypot(c.X, c.z),
      lit: prev.get(c.id)?.lit ?? 0,
      ph: Math.random() * 6.28,
      // amphipods are a small crowd of scavengers, each a few centimetres long
      crowd:
        c.id === 'amphipods'
          ? Array.from({ length: 9 }, (_, i) => ({
              dx: (hash(i, 3) - 0.5) * 0.7,
              dz: (hash(i, 7) - 0.5) * 0.55,
              a: hash(i, 11) * 6.28,
              ph: hash(i, 13) * 6.28,
            }))
          : null,
    }))
  }

  /* The sediment is shaded per css pixel in a time-sliced job so building it
     never blocks scrolling; relief is sampled on 2×2 blocks, grain per pixel. */
  let job = null
  function beginPaint() {
    layout()
    placeContacts()
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
    job = { top, rows, lit, glow, im1, im2, j: 0, W, te: trackEnd() }
  }

  const col = [0, 0, 0]
  function shadeRows(j0) {
    const { top, rows, im1, im2, te } = job
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
        // the track runs from under the viewport to where the animal is now
        const tk = 1 - smooth(te - 0.35, te + 0.05, z)
        for (let di = 0; di < 2; di++) {
          const i = i0 + di
          if (i >= W) break
          const X = (i + 0.5 - cx) / pxPerM
          let shade = relief
          // the track: a soft groove with lifted rims
          const td = Math.abs(X - tX)
          if (td < 0.4 && tk > 0) {
            shade *= 1 + tk * (-0.42 * Math.exp(-((td / 0.06) ** 2)) + 0.16 * Math.exp(-(((td - 0.13) / 0.045) ** 2)))
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

    // the sonar layers: the sediment, and the walls' contours
    hi = document.createElement('canvas')
    hi.width = W
    hi.height = H
    hi.getContext('2d').drawImage(glow, 0, top, W, rows)
    walls = document.createElement('canvas')
    walls.width = W
    walls.height = Math.ceil(horizon + 4)
    const h = walls.getContext('2d')
    const contour = (pts, a) => {
      h.beginPath()
      pts.forEach(([x, y], k) => (k ? h.lineTo(x, y) : h.moveTo(x, y)))
      h.strokeStyle = `rgba(255,96,74,${a})`
      h.lineWidth = 1.2
      h.stroke()
    }
    contour(farPts, 0.42)
    contour(nearPts, 0.7)
    // the echo belongs to the walls at the edges of the view, not behind the type
    const edge = h.createLinearGradient(0, 0, W, 0)
    edge.addColorStop(0, 'rgba(0,0,0,1)')
    edge.addColorStop(mobile ? 0.1 : 0.12, 'rgba(0,0,0,1)')
    edge.addColorStop(mobile ? 0.26 : 0.27, 'rgba(0,0,0,0)')
    edge.addColorStop(mobile ? 0.74 : 0.73, 'rgba(0,0,0,0)')
    edge.addColorStop(mobile ? 0.9 : 0.88, 'rgba(0,0,0,1)')
    edge.addColorStop(1, 'rgba(0,0,0,1)')
    h.globalCompositeOperation = 'destination-in'
    h.fillStyle = edge
    h.fillRect(0, 0, W, walls.height)

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

  /* --------------------------------------------- sonar on the sediment */
  const proj = (X, z) => {
    const zz = Math.max(0.3, z)
    return [cx + (X * f) / zz, horizon + K / zz]
  }
  // the floor point under a scene-space position (null above the horizon)
  const unproject = (x, y) => {
    if (y < horizon + 6) return null
    const z = K / (y - horizon)
    return { X: (x - cx) / (f / z), z }
  }
  // a circle of radius R metres on the sediment, in perspective
  function circle(g, X0, Z0, R, ccw = false) {
    const N = 96
    for (let i = 0; i <= N; i++) {
      const th = ((ccw ? N - i : i) / N) * Math.PI * 2
      const [x, y] = proj(X0 + R * Math.cos(th), Z0 + R * Math.sin(th))
      i ? g.lineTo(x, y) : g.moveTo(x, y)
    }
    g.closePath()
  }

  // origin: a floor point {X, z}, or null for the pool under Vesper's lamps
  function ring(origin = null, { strength = 1, reveal = true, dur = 5.2, user = false } = {}) {
    if (!built) return
    const o = origin || { X: 0, z: z0 }
    rings.push({
      X: o.X,
      z: o.z,
      t: 0,
      dur: reduced ? 2.2 : dur,
      maxR: 13,
      strength,
      reveal,
      user,
      seen: new Set(),
      still: reduced,
    })
    start()
  }

  /* ------------------------------------------------------------ frame */
  function drawContact(g, c, t) {
    const a = clamp(c.lit)
    const [x, y] = proj(c.X, c.z)
    const ppm = f / c.z
    const S = mobile ? 1.35 : 1.6 // drawn a little larger than life, like any sonar contact
    let bw = 10
    let bh = 8
    g.globalCompositeOperation = 'lighter'
    g.globalAlpha = a * 0.55
    const gr = Math.max(14, ppm * 0.22 * S)
    g.drawImage(blip, x - gr, y - gr * 0.6, gr * 2, gr * 1.2)
    g.globalAlpha = a
    if (c.id === 'amphipods') {
      g.strokeStyle = 'rgba(255,214,200,0.95)'
      g.lineWidth = 1.3
      g.lineCap = 'round'
      let minX = 1e9
      let maxX = -1e9
      let minY = 1e9
      let maxY = -1e9
      for (const m of c.crowd) {
        const wob = reduced ? 0 : Math.sin(t * 0.7 + m.ph) * 0.05
        const [px, py] = proj(c.X + m.dx + wob, c.z + m.dz)
        const L = Math.max(3.2, (0.045 * f * S) / (c.z + m.dz))
        const ang = m.a + (reduced ? 0 : Math.sin(t * 0.5 + m.ph) * 0.3)
        g.beginPath()
        g.arc(px, py, L * 0.6, ang, ang + 2.2)
        g.stroke()
        minX = Math.min(minX, px)
        maxX = Math.max(maxX, px)
        minY = Math.min(minY, py)
        maxY = Math.max(maxY, py)
      }
      bw = maxX - minX + 12
      bh = maxY - minY + 10
    } else if (c.id === 'xeno') {
      // a giant single cell: a fragile, lumpy test of cemented grains
      const R = Math.max(5, 0.06 * ppm * S)
      for (let i = 0; i < 9; i++) {
        const an = (i / 9) * 6.28 + 0.4
        const rr = R * (0.45 + 0.35 * hash(i, 5))
        const lx = x + Math.cos(an) * R * 0.55
        const ly = y - R * 0.35 + Math.sin(an) * R * 0.4
        g.fillStyle = 'rgba(255,120,98,0.32)'
        g.beginPath()
        g.arc(lx, ly, rr, 0, 6.28)
        g.fill()
      }
      g.strokeStyle = 'rgba(255,196,180,0.85)'
      g.lineWidth = 1
      g.beginPath()
      g.ellipse(x, y - R * 0.35, R * 1.05, R * 0.82, 0, 0, 6.28)
      g.stroke()
      g.beginPath()
      g.moveTo(x - R * 0.7, y - R * 0.5)
      g.quadraticCurveTo(x, y - R * 0.05, x + R * 0.75, y - R * 0.6)
      g.moveTo(x - R * 0.3, y - R * 1.05)
      g.quadraticCurveTo(x + R * 0.1, y - R * 0.4, x + R * 0.2, y + R * 0.2)
      g.stroke()
      bw = R * 2.6
      bh = R * 2.4
    } else {
      // a sea cucumber, translucent, lying along the end of its own track
      const L = Math.max(7, 0.13 * ppm * S)
      const Wd = Math.max(2.8, 0.045 * ppm * S)
      const [tx, ty] = proj(trackX(c.z + 0.3), c.z + 0.3)
      const ang = Math.atan2(y - ty, x - tx)
      g.save()
      g.translate(x, y - Wd * 0.4)
      g.rotate(ang)
      const body = g.createLinearGradient(0, -Wd, 0, Wd)
      body.addColorStop(0, 'rgba(255,150,128,0.8)')
      body.addColorStop(1, 'rgba(255,60,44,0.3)')
      g.fillStyle = body
      g.beginPath()
      g.ellipse(0, 0, L, Wd, 0, 0, 6.28)
      g.fill()
      g.fillStyle = 'rgba(255,214,202,0.85)'
      for (let i = 0; i < 5; i++) {
        g.beginPath()
        g.arc(-L * 0.68 + i * L * 0.34, -Wd * 0.7, 0.8, 0, 6.28)
        g.fill()
      }
      g.restore()
      bw = L * 2.4
      bh = Math.max(12, Wd * 3.4)
    }
    // the contact marker: four corners and a name
    const x0 = x - bw / 2
    const y0 = y - bh * 0.75
    const k = 5
    g.globalCompositeOperation = 'source-over'
    g.strokeStyle = `rgba(255,96,74,${(a * 0.85).toFixed(3)})`
    g.lineWidth = 1
    g.beginPath()
    for (const [px, py, sx, sy] of [
      [x0, y0, 1, 1],
      [x0 + bw, y0, -1, 1],
      [x0, y0 + bh, 1, -1],
      [x0 + bw, y0 + bh, -1, -1],
    ]) {
      g.moveTo(px + sx * k, py)
      g.lineTo(px, py)
      g.lineTo(px, py + sy * k)
    }
    g.stroke()
    g.globalAlpha = a * 0.9
    g.fillStyle = 'rgb(255 200 188)'
    g.font = `500 ${mobile ? 10 : 11}px Anybody, system-ui, sans-serif`
    g.textBaseline = 'alphabetic'
    const label = `${c.name}  ${c.dist.toFixed(1)} m`
    const tw = g.measureText(label).width
    const right = x0 + bw + 6
    const lx = (c.left && x0 - 6 - tw > 8) || right + tw > W - gutter - 8 ? x0 - 6 - tw : right
    g.fillText(label, lx, y0 + 8)
    g.globalAlpha = 1
  }

  function drawFx(dt) {
    const g = fx
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.globalCompositeOperation = 'source-over'
    g.clearRect(0, 0, W, H)
    g.globalCompositeOperation = 'lighter'
    const t = performance.now() / 1000

    // marine snow, sinking through the lamp light (thicker as the floor nears)
    const snowK = 0.3 + 0.7 * approach
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
      if (i > snow.length * (0.45 + 0.55 * approach)) continue
      const L = light(p.x, p.y)
      const a = (0.05 + L * 0.75) * snowK
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

    // sonar: rings run out across the sediment, in perspective
    for (let i = rings.length - 1; i >= 0; i--) {
      const R = rings[i]
      R.t += dt
      const k = R.t / R.dur
      if (k >= 1) {
        rings.splice(i, 1)
        continue
      }
      const e = R.still ? 0.62 : 1 - Math.pow(1 - k, 2.2)
      const rad = 0.15 + e * R.maxR
      const a = Math.pow(1 - k, 1.3) * R.strength
      g.globalCompositeOperation = 'lighter'
      g.globalAlpha = 1
      g.lineWidth = 1.2
      g.strokeStyle = `rgba(255,86,66,${(a * 0.8).toFixed(3)})`
      g.beginPath()
      circle(g, R.X, R.z, rad)
      g.stroke()
      if (!R.still && rad > 0.6) {
        g.strokeStyle = `rgba(255,86,66,${(a * 0.24).toFixed(3)})`
        g.beginPath()
        circle(g, R.X, R.z, rad * 0.9)
        g.stroke()
      }
      // the sediment answers where the ring passes
      if (R.reveal && hi) {
        const bands = [
          [0, 0.18, 0.95],
          [0.18, 0.6, 0.45],
          [0.6, 1.7, 0.16],
        ]
        for (const [w0, w1, ba] of bands) {
          const r0 = Math.max(0, rad - w1)
          const r1 = Math.max(0, rad - w0)
          if (r1 <= 0) continue
          g.save()
          g.beginPath()
          circle(g, R.X, R.z, r1)
          if (r0 > 0.02) circle(g, R.X, R.z, r0, true)
          g.clip()
          g.globalAlpha = clamp(a * ba)
          g.drawImage(hi, 0, 0, W, H)
          g.restore()
        }
        // far out, the echo comes back off the trench walls
        const wb = smooth(4.5, 7, rad) * (1 - smooth(9, 12.5, rad))
        if (walls && wb > 0.01) {
          g.globalAlpha = clamp(a * wb * 0.9)
          g.drawImage(walls, 0, 0)
        }
      }
      // contacts light up as the ring reaches them
      for (const c of contacts) {
        if (R.seen.has(c.id)) continue
        const d = Math.hypot(c.X - R.X, c.z - R.z)
        if (rad >= d) {
          R.seen.add(c.id)
          c.lit = Math.max(c.lit, R.still ? 1.6 : 1.25 * Math.min(1, R.strength))
          if (R.user) onContact?.(c, R)
        }
      }
    }

    // what the sonar found, fading back into the dark
    for (const c of contacts) {
      if (c.lit <= 0.01) continue
      drawContact(g, c, t)
      c.lit -= dt / (reduced ? 4.5 : 3.4)
    }
    g.globalCompositeOperation = 'source-over'
    g.globalAlpha = 1
  }

  function loop(now) {
    raf = 0
    const dt = Math.min(0.05, (now - (last || now)) / 1000)
    last = now
    if (arrived && !reduced && now > nextPing) {
      nextPing = now + 7500 + Math.random() * 2500
      ring(null, { strength: 0.6, dur: 6 })
    }
    drawFx(dt)
    const busy = !reduced || rings.length > 0 || contacts.some((c) => c.lit > 0.01)
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
  // where the pool under Vesper is on screen (for the global sonar event)
  const poolClient = () => {
    const s = sceneEl.getBoundingClientRect()
    return { x: s.left + cx, y: s.top + poolY }
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
    unproject,
    figureCentre,
    toScene,
    poolClient,
    onContact(fn) {
      onContact = fn
    },
    setApproach(v) {
      approach = v
    },
    touchdown(strength = 1) {
      build(true)
      spawnSilt(strength)
      ring(null, { strength: 1.15, dur: 5.6 })
      arrived = true
      approach = 1
      nextPing = performance.now() + 8000
      start()
    },
    setArrived(v) {
      arrived = v
      if (v) {
        approach = 1
        nextPing = performance.now() + 4000
        start()
      } else {
        silt.length = 0
        rings.length = 0
        contacts.forEach((c) => (c.lit = 0))
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
  const api = { landed: true, land() {} }

  if (ctx.reducedMotion) {
    root.style.setProperty('--fin-floor', 1)
    scene.build()
    scene.setArrived(false)
    return api
  }

  const split = new ctx.SplitText(digits, { type: 'chars', charsClass: 'fin__char' })
  digits.classList.add('is-split')
  const chars = split.chars
  // how far each character is from the middle (the middle lands first)
  const mid = (chars.length - 1) / 2
  const dist = chars.map((_, i) => Math.abs(i - mid) / (mid || 1))

  const P = { c: 0, floor: 0, rise: 0 }
  const apply = () => {
    const c = clamp(P.c)
    fig.style.setProperty('--fin-wdth', `${lerp(FIG.s0, FIG.s1, c).toFixed(2)}%`)
    fig.style.setProperty('--fin-wght', lerp(FIG.w0, FIG.w1, c).toFixed(0))
    fig.style.setProperty('--fin-track', `${lerp(FIG.t0, FIG.t1, c).toFixed(4)}em`)
    root.style.setProperty('--fin-floor', P.floor.toFixed(3))
    root.style.setProperty('--fin-rise', `${P.rise.toFixed(1)}px`)
  }

  /* 1. the approach, scrubbed: a = 0 when the stage's top enters the screen,
        1 when the figure's centre reaches the middle (the HUD reads 10,935) */
  let landed = false
  const approach = (a) => {
    const vh = window.innerHeight
    P.c = 0.3 * smooth(0.2, 1, a)
    P.floor = 0.03 + 0.5 * Math.pow(a, 1.3)
    P.rise = (1 - smooth(0, 1, a)) * vh * 0.1
    apply()
    // the figure sinks towards its place more slowly than the page scrolls,
    // never so far up that it ghosts through the last guest's caption (which
    // sits closer on a phone, so there it travels less)
    const narrow = ctx.isMobile()
    gsap.set(digits, { y: -(1 - smooth(0, 1, a)) * vh * (narrow ? 0.2 : 0.36) })
    chars.forEach((ch, i) => {
      const k = smooth(0, 1, (a - 0.08 - 0.22 * dist[i]) / 0.6)
      gsap.set(ch, { opacity: 0.72 * k, yPercent: lerp(narrow ? -44 : -72, -20, k) })
    })
    scene.setApproach(a)
  }
  const reset = () => {
    landed = false
    api.landed = false
    tl.pause()
    gsap.set(unit, { opacity: 0 })
    gsap.set(reveals, { opacity: 0 })
    scene.setArrived(false)
    approach(trig ? trig.progress : 0)
  }

  /* 2. the settle, time-based, from wherever the approach left the digits */
  const touchdown = () => {
    scene.touchdown(1)
    const r = digits.getBoundingClientRect()
    ctx.emit('sonar', { x: r.left + r.width / 2, y: r.top + r.height * 0.55, strength: 1 })
  }
  const tl = gsap.timeline({ paused: true })
  tl.to(digits, { y: 0, duration: 0.7, ease: 'power2.out' }, 0)
    .to(chars, { opacity: 1, duration: 0.55, ease: 'power1.out', stagger: { each: 0.03, from: 'center' } }, 0)
    // the last metre: a long, soft deceleration into contact, no overshoot
    .to(chars, { yPercent: 0, duration: 1.1, ease: 'power3.out', stagger: { each: 0.035, from: 'center' } }, 0)
    // full pressure: the figure narrows, thickens and its tracking opens
    .to(P, { c: 1, duration: 1.5, ease: 'power2.inOut', onUpdate: apply }, 0)
    .to(P, { rise: 0, duration: 0.8, ease: 'power2.out', onUpdate: apply }, 0)
    .call(touchdown, null, 0.5)
    .to(P, { floor: 1, duration: 2.2, ease: 'power2.out', onUpdate: apply }, 0.35)
    .to(unit, { opacity: 1, duration: 1, ease: 'power1.out' }, 0.8)
    .to(reveals, { opacity: 1, duration: 1.2, ease: 'power1.out', stagger: 0.15 }, 1)

  const land = (instant = false) => {
    if (landed) return
    landed = true
    api.landed = true
    scene.build(instant)
    tl.invalidate()
    if (instant) {
      // already on the floor (e.g. after the dive from the chart): no replay off-screen
      tl.progress(1, true)
      scene.setArrived(true)
    } else {
      tl.restart()
    }
  }
  api.land = land

  let trig = null
  trig = ScrollTrigger.create({
    trigger: stage,
    start: 'top bottom',
    endTrigger: fig,
    end: 'center center',
    onUpdate: (self) => {
      if (landed) return
      if (self.progress >= 0.999) land()
      else approach(self.progress)
    },
    onRefresh: (self) => {
      if (!landed) self.progress >= 0.999 ? land() : approach(self.progress)
    },
    // once the stage is fully below the screen again, the next descent lands again
    onLeaveBack: () => reset(),
  })
  reset()
  if (trig.progress >= 0.999) land(true)

  // (a keyboard visitor who reaches the ping before the reveal has run sees it
  // at once: finale.css lifts the reveals while focus is inside .fin__under)

  return api
}

/* ================================================================== sonar */
function sonar(ctx, root, scene) {
  const stage = root.querySelector('[data-fin-stage]')
  const btn = root.querySelector('[data-fin-ping]')
  const logEl = root.querySelector('[data-fin-log]')
  const listEl = root.querySelector('[data-fin-log-list]')
  const liveEl = root.querySelector('[data-fin-log-live]')
  const countEl = root.querySelector('[data-fin-log-count]')
  let pings = 0
  let found = []
  let doneT = 0
  const count = (n) => {
    if (countEl) countEl.textContent = `${n ? n : 'no'} contact${n === 1 ? '' : 's'} on the floor`
  }

  const userPing = (origin, client) => {
    pings += 1
    found = []
    if (listEl) {
      listEl.innerHTML = ''
      logEl.hidden = false
      logEl.querySelector('[data-fin-log-n]').textContent = String(pings)
      if (countEl) countEl.textContent = 'listening for echoes'
      logEl.classList.remove('is-done')
    }
    scene.ring(origin, { strength: 1.1, dur: 5.4, user: true })
    ctx.emit('sonar', { ...client, strength: 1 })
    clearTimeout(doneT)
    doneT = setTimeout(summarise, ctx.reducedMotion ? 300 : 2600)
  }
  function summarise() {
    if (!logEl) return
    logEl.classList.add('is-done')
    const n = found.length
    count(n)
    const list = found.map((c) => `${c.name.toLowerCase()} at ${c.dist.toFixed(1)} m`).join(', ')
    liveEl.textContent = n
      ? `Ping ${pings}: ${n} contact${n > 1 ? 's' : ''} on the floor: ${list}.`
      : `Ping ${pings}: no contacts on the floor.`
  }
  scene.onContact((c) => {
    if (found.some((x) => x.id === c.id)) return
    found.push(c)
    count(found.length)
    if (!listEl) return
    const li = document.createElement('li')
    li.className = 'fin__log-item'
    li.innerHTML = `<span class="fin__log-name"></span><span class="fin__log-dist"></span>`
    li.firstChild.textContent = c.name
    li.lastChild.textContent = `${c.dist.toFixed(1)} m`
    listEl.appendChild(li)
  })

  stage.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, select, textarea, label')) return
    if (String(window.getSelection?.() || '').length) return
    const p = scene.toScene(e.clientX, e.clientY)
    userPing(scene.unproject(p.x, p.y), { x: e.clientX, y: e.clientY })
  })

  btn?.addEventListener('click', () => {
    userPing(null, scene.poolClient())
  })
}

/* ============================================================ reservation */
function reservation(ctx, root, arrive) {
  const { gsap } = ctx
  const html = document.documentElement
  const book = root.querySelector('[data-fin-book]')
  const panel = root.querySelector('[data-fin-panel]')
  const form = root.querySelector('[data-fin-form]')
  const done = root.querySelector('[data-fin-done]')
  const doneTitle = root.querySelector('[data-fin-done-title]')
  const summary = root.querySelector('[data-fin-summary]')
  const stamp = (k) => root.querySelector(`[data-fin-stamp="${k}"]`)
  const pendingEl = root.querySelector('[data-fin-pending]')
  const again = root.querySelector('[data-fin-again]')
  const surface = root.querySelector('[data-fin-surface]')
  const submit = root.querySelector('[data-fin-submit]')
  const info = root.querySelector('[data-fin-info]')
  const veil = root.querySelector('[data-fin-veil]')
  const sonarSvg = root.querySelector('[data-fin-return]')
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

  // inline: judge a text field when you leave it (if you typed), then live until it
  // is right. The profile and month are judged on change and on submit only, so
  // looking through the profile picker never raises an error.
  form.addEventListener('focusout', (e) => {
    const field = e.target.closest('[data-fin-field]')
    const n = field?.dataset.finField
    if (!check[n] || n === 'month' || n === 'profile') return
    if (e.relatedTarget && field.contains(e.relatedTarget)) return
    const v = String(form.elements[n]?.value ?? '').trim()
    if (v || shown.has(n)) validate(n)
  })
  form.addEventListener('input', (e) => {
    const n = e.target.closest('[data-fin-field]')?.dataset.finField
    if (check[n] && n !== 'profile' && shown.has(n)) validate(n)
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

  /* --------------------------------------------- the dive to the floor */
  // From the depth chart to the form: the page goes dark, the HUD counts the
  // last metres down to 10,935, and the floor fades up already settled.
  let flying = false
  const yOf = (el, margin) => el.getBoundingClientRect().top + window.scrollY - margin
  function diveTo(el, margin, after) {
    arrive.land(true)
    if (!ctx.lenis || !veil) {
      window.scrollTo(0, yOf(el, margin))
      after()
      return
    }
    if (flying) return
    flying = true
    // take over from the chart's own smooth scroll
    ctx.lenis.scrollTo(window.scrollY, { immediate: true, force: true })
    html.classList.add('fin-is-diving')
    gsap.killTweensOf(veil)
    gsap.to(veil, { autoAlpha: 1, duration: 0.55, ease: 'power2.in' })
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      // the floor may have been re-measured on the way: land exactly
      ctx.lenis.scrollTo(yOf(el, margin), { immediate: true, force: true })
      html.classList.remove('fin-is-diving')
      gsap.to(veil, {
        autoAlpha: 0,
        duration: 1.2,
        delay: 0.12,
        ease: 'power2.out',
        onComplete: () => (flying = false),
      })
      after()
    }
    ctx.lenis.scrollTo(yOf(el, margin), {
      duration: 2.1,
      easing: easeInOut,
      force: true,
      lock: true,
      onComplete: finish,
    })
    setTimeout(finish, 2600)
  }

  // the depth chart chose a profile: preselect it, dive to the form, light the field
  let flagT = 0
  const flag = (el) => {
    el.classList.remove('is-flagged')
    void el.offsetWidth
    el.classList.add('is-flagged')
    clearTimeout(flagT)
    flagT = setTimeout(() => el.classList.remove('is-flagged'), 2600)
  }
  const firstOpen = () => {
    if (!form.elements.name.value.trim()) return form.elements.name
    if (!EMAIL.test(form.elements.email.value.trim())) return form.elements.email
    if (!form.querySelector('input[name="month"]:checked')) return form.querySelector('input[name="month"]')
    return submit
  }
  let pending = null
  ctx.on('select-profile', (d = {}) => {
    if (selfEmit || !PROFILES[d.id]) return
    const vh = window.innerHeight
    // after the sender's own scroll call, so this one wins
    setTimeout(() => {
      if (form.hidden) {
        // a request is already in: say what the chart chose, offer to change it
        pending = d.id
        pendingEl.textContent = `You chose the ${PROFILES[d.id].name} profile on the chart. Change the request to switch to it.`
        pendingEl.hidden = false
        diveTo(panel, vh * 0.16, () => {
          flag(again)
          again.focus({ preventScroll: true })
        })
        return
      }
      select.value = d.id
      updateInfo()
      if (shown.has('profile')) validate('profile')
      const field = fieldEl('profile')
      // on a phone, bring the flagged field itself to the upper part of the screen
      const narrow = ctx.isMobile()
      diveTo(narrow ? field : book, narrow ? vh * 0.3 : vh * 0.12, () => {
        flag(field)
        firstOpen().focus({ preventScroll: true })
      })
    }, 0)
  })

  /* --------------------------------------------------------- sending */
  let sending = false
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (sending) return
    const bad = ORDER.filter((n) => !validate(n))
    if (bad.length) {
      const first = bad[0]
      const target =
        first === 'month' ? form.querySelector('input[name="month"]') : form.elements[first]
      target.focus({ preventScroll: false })
      return
    }
    sending = true
    submit.setAttribute('aria-disabled', 'true')
    sent()
  })

  // the return: rings run out from the button across the panel, a few times, then rest
  const rings = sonarSvg ? [...sonarSvg.querySelectorAll('.fin__return-ring')] : []
  const core = sonarSvg?.querySelector('.fin__return-core')
  let ringTl = null
  let ringsOn = false
  const ringsIO = new IntersectionObserver(([e]) => {
    ringsOn = e.isIntersecting
    if (!ringTl) return
    ringsOn && !document.hidden ? ringTl.resume() : ringTl.pause()
  })
  ringsIO.observe(done)
  document.addEventListener('visibilitychange', () => {
    if (!ringTl) return
    ringsOn && !document.hidden ? ringTl.resume() : ringTl.pause()
  })
  // `beacon`: show the pulse's source (only where it sits in clear water, not
  // on top of the words)
  function playReturn(from, beacon = true) {
    if (!sonarSvg) return
    const pr = panel.getBoundingClientRect()
    const x = from.left + from.width / 2 - pr.left
    const y = from.top + from.height / 2 - pr.top
    const R = Math.hypot(Math.max(x, pr.width - x), Math.max(y, pr.height - y)) * 1.15
    sonarSvg.setAttribute('viewBox', `0 0 ${Math.round(pr.width)} ${Math.round(pr.height)}`)
    ;[...rings, core].forEach((c) => {
      c?.setAttribute('cx', x.toFixed(1))
      c?.setAttribute('cy', y.toFixed(1))
    })
    ringTl?.kill()
    gsap.killTweensOf(core)
    gsap.set(core, { opacity: beacon ? 1 : 0 })
    if (ctx.reducedMotion) {
      rings.forEach((c, i) => gsap.set(c, { attr: { r: R * (0.3 + i * 0.22) }, opacity: 0.5 - i * 0.14 }))
      return
    }
    gsap.set(rings, { attr: { r: 4 }, opacity: 0 })
    // three returns, then the beacon goes out: nothing keeps running
    ringTl = gsap.timeline({
      repeat: 2,
      repeatDelay: 1.6,
      paused: !ringsOn,
      onComplete: () => core && gsap.to(core, { opacity: 0, duration: 1.4, ease: 'power1.inOut' }),
    })
    ringTl.to(rings, {
      keyframes: [
        { attr: { r: 4 }, opacity: 0.9, duration: 0.01 },
        { attr: { r: R }, opacity: 0, duration: 3.4, ease: 'power2.out' },
      ],
      stagger: 0.55,
    })
  }

  function sent() {
    const email = form.elements.email.value.trim()
    const p = PROFILES[select.value].name
    const month = form.querySelector('input[name="month"]:checked').value
    summary.textContent = `We will write to ${email}.`
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    if (stamp('date')) stamp('date').textContent = date
    if (stamp('profile')) stamp('profile').textContent = p
    if (stamp('month')) stamp('month').textContent = month
    pending = null
    pendingEl.hidden = true

    const r = submit.getBoundingClientRect()
    ctx.emit('sonar', { x: r.left + r.width / 2, y: r.top + r.height / 2, strength: 1 })

    // on wide screens the panel keeps the form's height, so nothing below it
    // moves; on a phone it eases down to the confirmation instead of leaving a
    // screen of empty water under it
    const h0 = panel.offsetHeight
    panel.style.minHeight = `${h0}px`
    const finish = () => {
      form.hidden = true
      done.hidden = false
      sending = false
      submit.removeAttribute('aria-disabled')
      const narrow = ctx.isMobile()
      if (narrow) {
        const h1 = done.offsetHeight
        if (ctx.reducedMotion) panel.style.minHeight = ''
        else gsap.fromTo(panel, { minHeight: h0 }, { minHeight: h1, duration: 1.2, ease: 'abyss', onComplete: () => (panel.style.minHeight = '') })
      }
      playReturn(narrow ? doneTitle.getBoundingClientRect() : r, !narrow)
      // the form can be taller than the screen (always on a phone): the
      // visitor pressed the button at its foot, so bring the answer to them
      const vh = window.innerHeight
      const t = doneTitle.getBoundingClientRect()
      if (t.top < vh * 0.08 || t.top > vh * 0.6) {
        const y = t.top + window.scrollY - vh * 0.16
        if (ctx.lenis) ctx.lenis.scrollTo(y, { duration: 1.3, easing: easeInOut, force: true })
        else window.scrollTo(0, y)
      }
      doneTitle.focus({ preventScroll: true })
    }
    if (ctx.reducedMotion) {
      finish()
      return
    }
    gsap.to(form.children, {
      opacity: 0,
      filter: 'blur(6px)',
      duration: 0.55,
      ease: 'power2.in',
      stagger: 0.05,
      onComplete: () => {
        finish()
        gsap.set(form.children, { clearProps: 'opacity,filter' })
        const kids = [...done.children].filter((k) => !k.matches('[data-fin-return]'))
        gsap.fromTo(
          kids,
          { opacity: 0, filter: 'blur(8px)', y: 14 },
          { opacity: 1, filter: 'blur(0px)', y: 0, duration: 1.3, ease: 'power2.out', stagger: 0.12, delay: 0.35, clearProps: 'filter,transform' },
        )
        // the lamp finds the confirmation and reads it, like the guests' words
        gsap.fromTo(
          doneTitle,
          { '--b': '-30%' },
          { '--b': '140%', duration: 2.4, ease: 'power1.inOut', delay: 0.55 },
        )
      },
    })
  }

  again.addEventListener('click', () => {
    ringTl?.kill()
    ringTl = null
    done.hidden = true
    form.hidden = false
    panel.style.minHeight = ''
    if (pending && PROFILES[pending]) {
      select.value = pending
      updateInfo()
      selfEmit = true
      ctx.emit('select-profile', { id: pending })
      selfEmit = false
      flag(fieldEl('profile'))
    }
    pending = null
    pendingEl.hidden = true
    if (!ctx.reducedMotion) {
      gsap.fromTo(form.children, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'power1.out', stagger: 0.05 })
    }
    form.elements.name.focus()
  })

  // the next step after a request: the way back up (the footer runs the ascent)
  surface?.addEventListener('click', () => {
    document.querySelector('[data-foot-return]')?.click()
  })

  updateInfo()
}
