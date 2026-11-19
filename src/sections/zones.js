/**
 * zones.js — #zones (200 → 1,000 m). The five layers.
 *
 * The visitor is in the twilight zone the whole time (the HUD says so). The
 * five layers are shown as windows up and down the water column: each panel
 * holds a soft-edged column of *that* layer's water (depth.colorAt), with a
 * scale of its own depths, and a note saying where it is from here: above
 * you, around you, below you. The page water around the windows stays the
 * honest colour of 200–1,000 m, so nothing ever looks deeper than the HUD.
 *
 * Desktop: the section pins and the panels pass sideways. As each window
 * crosses the centre of the screen, Vesper's sonar pings (ctx 'sonar') and a
 * ring runs down through it; its depth range is squeezed live by pressure
 * (wdth/wght follow ctx.depth.compression from the layer's top to bottom).
 * Every scene is scrubbed by its own progress across the screen:
 *  - sunlight: shafts and plankton thinning tenfold every 100 m, a school
 *    of small fish turning in the light;
 *  - twilight: one night of the vertical migration in time-lapse, with the
 *    clock: the swarm rises at dusk and sinks at dawn as you scroll;
 *  - midnight: an anglerfish lit only by its own lure, which brightens as
 *    it reaches the centre;
 *  - abyss: sediment ripples, a sea cucumber's glow and its feeding trail, a
 *    tripod fish standing in the current, marine snow settling;
 *  - hadal: the trench in section, surveyed by a sonar sweep, amphipods
 *    scavenging at 10,935 m.
 * Desktop rests on whole layers: when the scroll stops inside the pin it
 * snaps on to the next layer in the direction of travel.
 * Phones: no pin; the windows sit side by side in a scroll-snap strip with a
 * depth ladder under it, and a swipe scrubs each scene. Tablets and reduced
 * motion on wide screens: the panels stack. Scenes render only while on
 * screen, and as a single still under reduced motion.
 */
import '../styles/zones.css'

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const TAU = Math.PI * 2
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

const bez = (p0, p1, p2, p3, s) => {
  const u = 1 - s
  return [
    u * u * u * p0[0] + 3 * u * u * s * p1[0] + 3 * u * s * s * p2[0] + s * s * s * p3[0],
    u * u * u * p0[1] + 3 * u * u * s * p1[1] + 3 * u * s * s * p2[1] + s * s * s * p3[1],
  ]
}

/* =================================================================== scenes
   Each scene draws in its window's CSS pixels (w × h). `f` is the band the
   window's scale covers (the layer's top to its bottom); `k` is the window's
   progress across the screen, 0 (entering) → 0.5 (centre) → 1 (leaving).  */

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
      [0, 'rgba(255,248,232,1)'],
      [0.06, 'rgba(255,222,160,0.95)'],
      [0.2, 'rgba(255,176,84,0.45)'],
      [0.5, 'rgba(255,176,84,0.09)'],
      [1, 'rgba(255,176,84,0)'],
    ],
    128,
  )
  return SPR
}

/* ------------------------------------------------------------- sunlight */
function sunlightScene() {
  let rays = []
  let motes = []
  let fish = []
  // share of the surface light at a given y: 100% at the top of the scale,
  // 10% half way, 1% at the bottom (200 m)
  const lightAt = (y, f) => Math.pow(10, -2 * clamp((y - f.y) / f.h, -0.25, 1.4))
  return {
    setup(w, h, f) {
      const r = rng(7)
      rays = Array.from({ length: 9 }, (_, i) => ({
        x: (i + 0.15 + r() * 0.7) / 9,
        top: 8 + r() * 30,
        bot: 50 + r() * 120,
        ph: r() * TAU,
        sp: 0.07 + r() * 0.1,
        a: 0.45 + r() * 0.55,
      }))
      const n = Math.round(clamp((w * h) / 1900, 80, 260))
      motes = Array.from({ length: n }, () => ({
        x: r() * w,
        u: Math.pow(r(), 1.9) * 1.12 + 0.01, // crowded near the light
        s: 0.6 + r() * 1.5,
        v: 2 + r() * 6,
        ph: r() * TAU,
        a: 0.35 + r() * 0.65,
        green: r() < 0.6,
      }))
      const m = Math.round(clamp((w * h) / 2600, 80, 170))
      fish = Array.from({ length: m }, () => ({
        a: r() * TAU,
        sp: 0.32 + r() * 0.22,
        rx: 0.45 + r() * 0.6,
        ry: 0.35 + r() * 0.6,
        wob: r() * TAU,
        len: 4.5 + r() * 4,
        ph: r() * TAU,
      }))
    },
    draw(c, t, dt, w, h, f, out, k) {
      // the underside of the surface, at 0 m: a bright, moving skin of light
      const sy = f.y
      const sky = c.createLinearGradient(0, sy - h * 0.22, 0, sy + f.h * 0.4)
      sky.addColorStop(0, 'rgba(217,251,255,0)')
      sky.addColorStop(0.55, 'rgba(217,251,255,0.2)')
      sky.addColorStop(0.62, 'rgba(217,251,255,0.12)')
      sky.addColorStop(1, 'rgba(217,251,255,0)')
      c.fillStyle = sky
      c.fillRect(0, sy - h * 0.22, w, h * 0.22 + f.h * 0.4)

      c.globalCompositeOperation = 'lighter'
      c.lineWidth = 1
      for (let j = 0; j < 3; j++) {
        c.strokeStyle = `rgba(217,251,255,${[0.42, 0.14, 0.08][j]})`
        c.beginPath()
        for (let x = -4; x <= w + 4; x += 6) {
          const y = sy + j * 4 + Math.sin(x * 0.021 + t * (0.7 + j * 0.25) + j) * (2.6 - j * 0.6) + Math.sin(x * 0.053 - t * 1.2 + j * 2) * 1.3
          if (x === -4) c.moveTo(x, y)
          else c.lineTo(x, y)
        }
        c.stroke()
      }

      // shafts of sunlight, dimming tenfold every 100 m
      const len = f.h * 1.15
      const slant = h * 0.12
      const par = (0.5 - k) * w * 0.1
      for (const ray of rays) {
        const sway = Math.sin(t * ray.sp + ray.ph) * 22
        const x0 = ray.x * w * 1.2 - w * 0.12 + sway + par
        const q = (0.55 + 0.45 * Math.sin(t * ray.sp * 2.6 + ray.ph * 2)) * ray.a
        const g = c.createLinearGradient(0, sy, 0, sy + len)
        g.addColorStop(0, `rgba(217,251,255,${(0.2 * q).toFixed(3)})`)
        g.addColorStop(0.43, `rgba(217,251,255,${(0.05 * q).toFixed(3)})`)
        g.addColorStop(1, 'rgba(217,251,255,0)')
        c.fillStyle = g
        c.beginPath()
        c.moveTo(x0 - ray.top / 2, sy)
        c.lineTo(x0 + ray.top / 2, sy)
        c.lineTo(x0 + slant + ray.bot / 2, sy + len)
        c.lineTo(x0 + slant - ray.bot / 2, sy + len)
        c.closePath()
        c.fill()
      }

      // phytoplankton: thick where the light is, almost none at 200 m
      for (const p of motes) {
        p.x += p.v * dt
        if (p.x > w + 4) p.x = -4
        const y = f.y + p.u * f.h + Math.sin(t * 0.5 + p.ph) * 4
        const L = lightAt(y, f)
        const a = p.a * clamp(0.08 + Math.pow(L, 0.42))
        if (a < 0.02) continue
        c.fillStyle = p.green ? `rgba(196,255,226,${a.toFixed(3)})` : `rgba(217,251,255,${a.toFixed(3)})`
        c.fillRect(p.x, y, p.s, p.s)
      }

      // a school of small fish, turning in the light; their flanks flash
      const R = Math.min(w * 0.3, f.h * 0.32)
      const cx = w * (0.56 + 0.05 * Math.sin(t * 0.11)) + (0.5 - k) * w * 0.22
      const cy = f.y + f.h * 0.3 + Math.sin(t * 0.17) * f.h * 0.03
      c.lineCap = 'round'
      for (const p of fish) {
        p.a += p.sp * dt
        const a = p.a
        const y0 = Math.sin(a * 2 + p.wob) * R * 0.08
        const x = cx + Math.cos(a) * R * p.rx
        const y = cy + Math.sin(a) * R * p.ry * 0.42 + y0
        const vx = -Math.sin(a) * p.rx
        const vy = Math.cos(a) * p.ry * 0.42
        const vl = Math.hypot(vx, vy) || 1
        const near = 0.75 + 0.35 * Math.sin(a) // the near side of the ball
        const flash = Math.max(0, Math.cos(a * 1 + p.ph + t * 0.3)) ** 10
        const L = lightAt(y, f)
        const al = (0.32 + 0.68 * flash) * clamp(0.45 + L) * near
        const l = p.len * near
        c.strokeStyle = `rgba(232,250,255,${clamp(al).toFixed(3)})`
        c.lineWidth = 1.3 + 0.9 * near
        c.beginPath()
        c.moveTo(x - (vx / vl) * l * 0.5, y - (vy / vl) * l * 0.5)
        c.lineTo(x + (vx / vl) * l * 0.5, y + (vy / vl) * l * 0.5)
        c.stroke()
      }
      c.lineCap = 'butt'
      c.globalCompositeOperation = 'source-over'
    },
  }
}

/* ------------------------------------------------------------- twilight */
// one night, in time-lapse: k 0 → 1 is 14:00 → 10:00 the next morning.
// cloud: 0 = the top of the scale (200 m) … 1 = the bottom (1,000 m)
const nightHours = (k) => 20 * clamp(k)
const cloudAt = (k) => {
  const s = nightHours(k)
  return 0.74 - 0.7 * (smooth(3.5, 6.8, s) - smooth(14.2, 17.6, s))
}
function twilightScene() {
  // The migration drawn the way it was discovered: as an echogram. Across
  // the window runs the clock (14:00 → 10:00), down it the depth; the swarm
  // is the pen, leaving its trace behind it as you scroll.
  const X0 = 0.12
  const X1 = 0.9
  let fish = []
  let trace = []
  let lastCloud = null
  let vel = 0
  const HOURS = [
    [18, '18:00'],
    [24, '00:00'],
    [30, '06:00'],
  ]
  return {
    setup(w, h, f) {
      const r = rng(11)
      const n = Math.round(clamp((w * f.h) / 1100, 110, 280))
      fish = Array.from({ length: n }, () => {
        const kind = r()
        return {
          fx: (r() + r() - 1) * 0.5,
          oy: (r() + r() + r() - 1.5) * 0.15,
          lag: r() * 0.05,
          ph: r() * TAU,
          s: 0.5 + r() * 0.8,
          kind: kind < 0.42 ? 'lantern' : kind < 0.93 ? 'krill' : 'squid',
          blue: r() < 0.35,
        }
      })
      const cols = Math.max(40, Math.round((w * (X1 - X0)) / 2.5))
      trace = []
      for (let i = 0; i < cols; i++) {
        const kk = i / (cols - 1)
        for (let j = 0; j < 4; j++) {
          trace.push({ kk, ox: r() * 2.5, oy: (r() + r() + r() - 1.5) * 0.12, a: 0.25 + r() * 0.75 })
        }
      }
      lastCloud = null
    },
    draw(c, t, dt, w, h, f, out, k) {
      const S = sprites()
      const s = nightHours(k)
      const day = 1 - (smooth(3, 6.5, s) - smooth(14.5, 18, s))
      const xs = (kk) => w * (X0 + (X1 - X0) * kk)
      // the last daylight from above, gone at night
      const g = c.createLinearGradient(0, 0, 0, f.y + f.h * 0.6)
      g.addColorStop(0, `rgba(58,168,255,${(0.03 + 0.14 * day).toFixed(3)})`)
      g.addColorStop(1, 'rgba(58,168,255,0)')
      c.fillStyle = g
      c.fillRect(0, 0, w, f.y + f.h * 0.6)

      // the clock along the bottom of the band
      c.font = '500 10px Anybody, system-ui, sans-serif'
      c.textAlign = 'center'
      for (const [hr, label] of HOURS) {
        const kk = (hr - 14) / 20
        const x = xs(kk)
        const past = kk <= k
        c.fillStyle = `rgba(234,246,244,${past ? 0.55 : 0.28})`
        c.fillRect(x, f.y + f.h - 5, 1, 5)
        c.fillText(label, x, f.y + f.h + 14)
      }

      // the echogram: where the swarm has been
      c.globalCompositeOperation = 'lighter'
      for (const d of trace) {
        if (d.kk > k) break
        const age = (k - d.kk) * 6
        const a = 0.55 * d.a * (0.4 + 0.6 * Math.exp(-age))
        c.fillStyle = d.a > 0.8 ? `rgba(160,255,240,${a.toFixed(3)})` : `rgba(58,168,255,${a.toFixed(3)})`
        c.fillRect(xs(d.kk) + d.ox, f.y + f.h * (cloudAt(d.kk) + d.oy), 1.6, 1.6)
      }

      const cloud = cloudAt(k)
      out.cloud = cloud
      out.hour = (14 + s) % 24
      if (lastCloud !== null) vel += ((cloud - lastCloud) / Math.max(dt, 1 / 120) - vel) * Math.min(1, dt * 6)
      lastCloud = cloud
      c.lineWidth = 1
      for (const p of fish) {
        const kk = k - p.lag
        const cy = cloudAt(kk)
        const y = f.y + f.h * (cy + p.oy * (0.8 + 0.5 * (1 - day)))
        const x = xs(clamp(kk)) + p.fx * w * 0.16 + Math.sin(t * 0.3 + p.ph) * 5
        const streak = 1.2 + Math.min(16, Math.abs(vel) * 9 * p.s)
        const dir = vel > 0 ? -1 : 1 // trail behind the direction of travel
        if (p.kind === 'krill') {
          c.fillStyle = `rgba(234,246,244,${(0.3 * p.s).toFixed(3)})`
          c.fillRect(x, y, 1.2, 1.2 + streak * 0.4)
          continue
        }
        c.strokeStyle = `rgba(234,246,244,${(0.36 * p.s).toFixed(3)})`
        c.beginPath()
        c.moveTo(x, y)
        c.lineTo(x - 2, y + dir * streak * (p.kind === 'squid' ? 1.4 : 1))
        c.stroke()
        // lanternfish carry rows of photophores
        const tw = 0.6 + 0.4 * Math.sin(t * 2.2 + p.ph * 3)
        const sz = p.kind === 'squid' ? 7 + 4 * p.s : 4 + 3.5 * p.s
        c.globalAlpha = 0.85 * tw
        c.drawImage(p.blue ? S.blue : S.glow, x - sz, y - sz, sz * 2, sz * 2)
        c.globalAlpha = 1
      }
      c.globalCompositeOperation = 'source-over'
    },
  }
}

/* ------------------------------------------------------------- midnight */
const ESCA = [-128, -31]
function anglerBody(c) {
  c.beginPath()
  c.moveTo(-96, -14)
  c.bezierCurveTo(-94, -44, -66, -70, -28, -68)
  c.bezierCurveTo(8, -66, 36, -56, 52, -40)
  c.bezierCurveTo(62, -30, 70, -20, 78, -13)
  c.quadraticCurveTo(96, -30, 118, -33)
  c.quadraticCurveTo(110, -15, 112, -1)
  c.quadraticCurveTo(110, 14, 121, 30)
  c.quadraticCurveTo(96, 28, 78, 12)
  c.bezierCurveTo(66, 36, 34, 62, -6, 64)
  c.bezierCurveTo(-44, 66, -82, 48, -104, 14)
  c.bezierCurveTo(-90, 16, -64, 14, -48, 4)
  c.bezierCurveTo(-64, -4, -84, -10, -96, -14)
  c.closePath()
}
const LIP_LO = [[-104, 14], [-90, 16], [-64, 14], [-48, 4]]
const LIP_UP = [[-48, 4], [-64, -4], [-84, -10], [-96, -14]]
// a few long, glassy needles near the front of the jaws (s along the lip,
// length, lean): the only teeth near enough to the lure to catch its light
const FANGS = [
  { lip: LIP_LO, s: 0.1, len: 17, lean: 0.34 },
  { lip: LIP_LO, s: 0.34, len: 12, lean: 0.24 },
  { lip: LIP_UP, s: 0.93, len: 15, lean: -0.3 },
  { lip: LIP_UP, s: 0.7, len: 10, lean: -0.2 },
]
const LURE_R = 106 // reach of the lure's light, in fish units (~1.6x its glow)

// The anglerfish exists only where its own lure lights it, as in the
// creatures' self-light pass: the body is drawn into a small buffer around
// the lure, lit by a falloff from the esca, with a hairline rim on the edges
// that face the light and a few translucent fangs; the buffer is then masked
// by the reach of the light and added to the scene. Everything else is the
// black of the water.
let lureBuf = null
let lureG = null
function drawAngler(c, cx, cy, S, lit, pulse, t, dpr) {
  const ex = ESCA[0] + Math.sin(t * 0.9) * 3
  const ey = ESCA[1] + Math.cos(t * 0.7) * 2.4
  const on = lit * pulse
  const R = LURE_R * (0.9 + 0.1 * pulse)
  const k = S * dpr
  const side = Math.max(2, Math.ceil(2 * LURE_R * k))
  if (!lureBuf) {
    lureBuf = document.createElement('canvas')
    lureG = lureBuf.getContext('2d')
  }
  if (lureBuf.width < side || lureBuf.width > side * 1.5) lureBuf.width = lureBuf.height = side
  const g = lureG
  const B = lureBuf.width
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.globalCompositeOperation = 'source-over'
  g.globalAlpha = 1
  g.clearRect(0, 0, B, B)
  // fish units → buffer pixels, with the lure at the buffer's centre
  g.setTransform(k, 0, 0, k, B / 2 - ex * k, B / 2 - ey * k)

  // 1. the rim: the silhouette, minus itself nudged away from the light,
  //    leaves a hairline on every edge that faces the lure
  const dx = -ex
  const dy = -ey
  const dl = Math.hypot(dx, dy) || 1
  const shift = 1.15 / S // ≈ 1 px on screen
  anglerBody(g)
  g.fillStyle = 'rgba(255,232,196,0.95)'
  g.fill()
  g.save()
  g.translate((dx / dl) * shift, (dy / dl) * shift)
  g.globalCompositeOperation = 'destination-out'
  anglerBody(g)
  g.fill()
  g.restore()

  // 2. the skin, under the rim: warm where the light lands, gone beyond it
  g.globalCompositeOperation = 'destination-over'
  const skin = g.createRadialGradient(ex, ey, 0, ex, ey, R)
  skin.addColorStop(0, 'rgba(255,190,112,0.5)')
  skin.addColorStop(0.3, 'rgba(232,148,78,0.24)')
  skin.addColorStop(0.62, 'rgba(190,110,56,0.07)')
  skin.addColorStop(1, 'rgba(160,90,40,0)')
  g.fillStyle = skin
  anglerBody(g)
  g.fill()

  // 3. the fangs: glass needles, each with a lit edge toward the lure
  g.globalCompositeOperation = 'lighter'
  g.lineCap = 'round'
  for (const f of FANGS) {
    const [bx, by] = bez(...f.lip, f.s)
    const up = f.lip === LIP_LO ? -1 : 1 // lower jaw teeth point up
    const tx = bx + f.lean * f.len
    const ty = by + up * f.len
    const mx = bx + f.lean * f.len * 0.2 + 1.2
    const my = by + up * f.len * 0.55
    const near = clamp(1 - Math.hypot(bx - ex, by - ey) / R)
    g.fillStyle = `rgba(255,214,160,${(0.22 + 0.3 * near).toFixed(3)})`
    g.beginPath()
    g.moveTo(bx - 1.3, by)
    g.quadraticCurveTo(mx - 0.4, my, tx, ty)
    g.quadraticCurveTo(mx + 0.6, my, bx + 1.3, by)
    g.closePath()
    g.fill()
    g.strokeStyle = `rgba(255,246,228,${(0.35 + 0.55 * near).toFixed(3)})`
    g.lineWidth = 0.55 / S
    g.beginPath()
    g.moveTo(bx - 0.8, by)
    g.quadraticCurveTo(mx - 0.5, my, tx, ty)
    g.stroke()
  }

  // 4. the reach of the light: nothing exists beyond it
  g.globalCompositeOperation = 'destination-in'
  const m = g.createRadialGradient(ex, ey, 0, ex, ey, R)
  m.addColorStop(0, 'rgba(0,0,0,1)')
  m.addColorStop(0.38, 'rgba(0,0,0,0.86)')
  m.addColorStop(0.7, 'rgba(0,0,0,0.34)')
  m.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = m
  g.fillRect(ex - LURE_R, ey - LURE_R, LURE_R * 2, LURE_R * 2)
  g.globalCompositeOperation = 'source-over'

  // the lit fish, added to the water
  const x = cx + ex * S
  const y = cy + ey * S
  const half = B / 2 / dpr
  c.globalCompositeOperation = 'lighter'
  c.globalAlpha = clamp(on * 1.1)
  c.drawImage(lureBuf, 0, 0, B, B, x - half, y - half, half * 2, half * 2)
  c.globalAlpha = 1

  // the illicium: a hair-fine rod from the forehead, lit toward its tip
  c.save()
  c.translate(cx, cy)
  c.scale(S, S)
  const rod = c.createLinearGradient(-44, -66, ex, ey)
  rod.addColorStop(0, `rgba(255,176,84,${(0.05 * lit).toFixed(3)})`)
  rod.addColorStop(0.6, `rgba(255,190,110,${(0.3 * on).toFixed(3)})`)
  rod.addColorStop(1, `rgba(255,226,170,${(0.85 * on).toFixed(3)})`)
  c.strokeStyle = rod
  c.lineWidth = 0.9 / S
  c.beginPath()
  c.moveTo(-44, -66)
  c.bezierCurveTo(-62, -114, -120, -106, ex, ey - 3)
  c.stroke()
  c.restore()

  // the esca, in screen space
  const S2 = sprites()
  const ls = 62 * S * (0.86 + 0.14 * pulse)
  c.globalAlpha = clamp(0.45 + 0.55 * lit) * pulse
  c.drawImage(S2.lure, x - ls, y - ls, ls * 2, ls * 2)
  c.globalAlpha = 1
  c.fillStyle = `rgba(255,250,236,${(0.6 + 0.4 * pulse).toFixed(3)})`
  c.beginPath()
  c.arc(x, y, 1.8 * Math.max(1, S * 0.7), 0, TAU)
  c.fill()
  c.globalCompositeOperation = 'source-over'
  return [x, y]
}

function midnightScene() {
  let flashes = []
  let snow = []
  let ambient = []
  let next = 0
  let nextChain = 1.6
  let r = rng(23)
  return {
    setup(w, h, f) {
      r = rng(23)
      flashes = []
      next = 0
      nextChain = 1.6
      const n = Math.round(clamp((w * h) / 9000, 24, 80))
      snow = Array.from({ length: n }, () => ({ x: r() * w, y: r() * h, v: 4 + r() * 7, s: 0.6 + r(), a: 0.1 + r() * 0.16 }))
      // distant animals glowing steadily, far off in the dark
      const m = Math.round(clamp((w * h) / 6000, 30, 110))
      ambient = Array.from({ length: m }, () => ({
        x: r() * w,
        y: h * (0.06 + r() * 0.86),
        s: 1.6 + r() * 3.4,
        a: 0.1 + r() * 0.3,
        ph: r() * TAU,
        sp: 0.3 + r() * 0.9,
        blue: r() < 0.5,
      }))
    },
    draw(c, t, dt, w, h, f, out, k) {
      const S = sprites()
      c.globalCompositeOperation = 'lighter'
      for (const q of ambient) {
        c.globalAlpha = q.a * (0.55 + 0.45 * Math.sin(t * q.sp + q.ph))
        c.drawImage(q.blue ? S.blue : S.glow, q.x - q.s, q.y - q.s, q.s * 2, q.s * 2)
      }
      c.globalAlpha = 1
      if (next < t - 1) next = t // re-entry after a pause: don't replay the backlog
      while (t > next) {
        next += 0.18 + r() * 0.5
        flashes.push({ x: r() * w, y: h * (0.08 + r() * 0.82), s: 5 + r() * 14, t0: next, dur: 0.6 + r() * 2.2, blue: r() < 0.4 })
      }
      if (t > nextChain) {
        // a siphonophore: a chain of lights firing one after another
        nextChain = t + 3.2 + r() * 3
        const n = 9 + Math.floor(r() * 7)
        let x = w * (0.1 + r() * 0.35)
        let y = h * (0.12 + r() * 0.2)
        let a = r() * 0.8 - 0.1
        const bend = (r() - 0.5) * 0.4
        for (let i = 0; i < n; i++) {
          flashes.push({ x, y, s: 4 + r() * 3, t0: t + i * 0.075, dur: 1.4, blue: false })
          a += bend
          x += Math.cos(a) * 12
          y += Math.sin(a) * 12
        }
      }
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
      c.globalCompositeOperation = 'source-over'

      // the anglerfish: the lure comes up as it reaches the centre
      const lit = out.still ? 1 : 0.18 + 0.82 * smooth(0.18, 0.46, k)
      const pulse = 0.8 + 0.2 * Math.sin(t * 1.3) * (0.7 + 0.3 * Math.sin(t * 0.37 + 1))
      // only the lure and the face it lights are ever seen: centre that pair
      // in the window (on narrow windows the lure keeps clear of the scale)
      const narrow = w < 600
      const S0 = Math.min(w / (narrow ? 300 : 262), f.h / 172, 2.8)
      const cx = Math.max(w * 0.5 + 66 * S0, 128 * S0 + (narrow ? 104 : 92)) + (0.5 - k) * w * 0.08 + Math.sin(t * 0.21) * 4
      const cy = f.y + f.h * 0.56 + Math.sin(t * 0.33) * 5
      const [lx, ly] = drawAngler(c, cx, cy, S0, lit, pulse, t, out.dpr || 1)

      // marine snow, warmed where the lure lights it
      const R2 = (150 * S0) ** 2
      c.globalCompositeOperation = 'lighter'
      for (const p of snow) {
        p.y += p.v * dt
        if (p.y > h) p.y = -2
        const near = Math.exp(-((p.x - lx) ** 2 + (p.y - ly) ** 2) / R2) * lit * pulse
        c.fillStyle =
          near > 0.05
            ? `rgba(255,${Math.round(246 - 50 * near)},${Math.round(244 - 120 * near)},${(p.a + 0.6 * near).toFixed(3)})`
            : `rgba(234,246,244,${p.a})`
        c.fillRect(p.x, p.y, p.s, p.s)
      }
      c.globalCompositeOperation = 'source-over'
    },
  }
}

/* ---------------------------------------------------------------- abyss */
// Bathypterois, drawn the way Vesper is: a specimen in hairline ink. A
// fusiform body perched on two long pelvic rays and the lower ray of its
// tail, pectoral rays held up and forward into the current. Units: the
// sediment under it is y = 0, the fish faces left; the body is ~80 long.
function tripodBody(c) {
  c.beginPath()
  c.moveTo(-41, -58.6)
  c.bezierCurveTo(-36, -64.2, -16, -67.6, 2, -66.4)
  c.bezierCurveTo(16, -65.4, 27, -62.4, 35, -60.6)
  c.lineTo(36.5, -59.4)
  c.lineTo(35, -57.6)
  c.bezierCurveTo(26, -56.4, 10, -55.2, -6, -55)
  c.bezierCurveTo(-22, -54.8, -35, -55.6, -41, -58.6)
  c.closePath()
}
function drawTripod(c, x, y, s, a, label) {
  c.save()
  c.translate(x, y)
  c.scale(s, s)
  const px = 1 / s // one screen pixel, in fish units
  c.lineCap = 'round'
  c.lineJoin = 'round'
  const ink = (al) => `rgba(234,246,244,${(al * a).toFixed(3)})`

  // the stilts: two pelvic rays and the tail's lower ray, down to the mud
  c.strokeStyle = ink(0.6)
  c.lineWidth = 0.75 * px
  c.beginPath()
  c.moveTo(-10, -55.3)
  c.bezierCurveTo(-13, -38, -20, -16, -27, 1.4)
  c.moveTo(-7, -55.1)
  c.bezierCurveTo(-8, -36, -11, -16, -13, -0.4)
  c.moveTo(35.5, -58.2)
  c.bezierCurveTo(42, -44, 52, -20, 60, 0)
  c.stroke()
  // where each ray rests, a dimple in the sediment
  c.strokeStyle = ink(0.3)
  c.lineWidth = 0.6 * px
  c.beginPath()
  for (const [fx, fy] of [[-27, 1.4], [-13, -0.4], [60, 0]]) {
    c.moveTo(fx - 3.2, fy + 0.4)
    c.quadraticCurveTo(fx, fy + 1.3, fx + 3.2, fy + 0.4)
  }
  c.stroke()

  // pectoral rays, a fan of feelers held up over the head
  c.strokeStyle = ink(0.42)
  c.lineWidth = 0.6 * px
  c.beginPath()
  for (const [ex, ey, qx, qy] of [[-74, -92, -38, -84], [-70, -101, -36, -88], [-63, -108, -33, -91], [-77, -84, -40, -79]]) {
    c.moveTo(-23, -61)
    c.quadraticCurveTo(qx, qy, ex, ey)
  }
  // dorsal fin and the upper lobe of the tail, as fine rays
  c.moveTo(-7, -66.6)
  c.lineTo(-2, -76)
  c.moveTo(-3, -66.8)
  c.lineTo(3, -75)
  c.moveTo(1, -66.6)
  c.lineTo(7, -72.5)
  c.moveTo(36, -60)
  c.lineTo(46, -68)
  c.moveTo(36.4, -59.6)
  c.lineTo(45, -64)
  c.stroke()

  // the body: occludes the plain behind it, outlined in one hairline
  tripodBody(c)
  c.fillStyle = 'rgba(2,7,16,0.92)'
  c.fill()
  c.strokeStyle = ink(0.62)
  c.lineWidth = 0.75 * px
  c.stroke()
  // gill cover, lateral line, the small eye
  c.strokeStyle = ink(0.36)
  c.lineWidth = 0.55 * px
  c.beginPath()
  c.moveTo(-25, -64.6)
  c.quadraticCurveTo(-21, -60.4, -25.4, -55.6)
  c.moveTo(-21, -60.8)
  c.bezierCurveTo(-2, -60.6, 18, -60.2, 34, -59.3)
  c.moveTo(-32.4, -61)
  c.arc(-33.6, -61, 1.2, 0, TAU)
  c.stroke()
  c.restore()

  // a hairline dimension over the body, in screen pixels
  if (label) {
    const X0 = x - 41 * s
    const X1 = x + 46 * s
    const Y = y - 116 * s
    c.strokeStyle = ink(0.34)
    c.lineWidth = 0.75
    c.setLineDash([2, 3])
    c.beginPath()
    c.moveTo(X0, y - 64 * s)
    c.lineTo(X0, Y - 4)
    c.moveTo(X1, y - 70 * s)
    c.lineTo(X1, Y - 4)
    c.stroke()
    c.setLineDash([])
    c.strokeStyle = ink(0.5)
    c.beginPath()
    c.moveTo(X0, Y)
    c.lineTo(X1, Y)
    c.moveTo(X0 + 3.5, Y - 2.5)
    c.lineTo(X0, Y)
    c.lineTo(X0 + 3.5, Y + 2.5)
    c.moveTo(X1 - 3.5, Y - 2.5)
    c.lineTo(X1, Y)
    c.lineTo(X1 - 3.5, Y + 2.5)
    c.stroke()
    c.font = '500 10px Anybody, system-ui, sans-serif'
    c.textAlign = 'center'
    c.textBaseline = 'alphabetic'
    c.fillStyle = ink(0.7)
    c.fillText('about 30 cm', (X0 + X1) / 2, Y - 5)
    // the note sits left of the front stilts, if it clears the scale
    c.font = 'italic 12px Newsreader, Georgia, serif'
    const note = 'stands on its fins'
    const nx = x - 34 * s
    if (nx - c.measureText(note).width > 44) {
      c.textAlign = 'right'
      c.fillStyle = ink(0.55)
      c.fillText(note, nx, y + 3)
    }
  }
}

// A deep-sea cucumber: a translucent body that is brightest at its edges
// (a fresnel rim), its gut showing through, on a row of tube feet.
function cucumberBody(c) {
  c.beginPath()
  c.moveTo(24, -4)
  c.bezierCurveTo(25, -12, 16, -15.5, 6, -15)
  c.bezierCurveTo(-4, -16.5, -16, -15, -21, -10)
  c.bezierCurveTo(-25, -6, -23, -1.5, -17, -1.5)
  c.bezierCurveTo(-6, -0.5, 10, -0.5, 18, -1)
  c.bezierCurveTo(22, -1.3, 24, -2, 24, -4)
  c.closePath()
}
function drawCucumber(c, x, y, s, glow) {
  c.save()
  c.translate(x, y)
  c.scale(s, s)
  const px = 1 / s
  c.lineCap = 'round'
  c.lineJoin = 'round'
  // tube feet and papillae: glassy strands, their tips catching the light
  c.strokeStyle = `rgba(160,255,240,${(0.22 + 0.16 * glow).toFixed(3)})`
  c.lineWidth = 0.7 * px
  c.beginPath()
  for (let i = 0; i < 7; i++) {
    const fx = -17 + i * 5.8
    c.moveTo(fx, -2.2)
    c.lineTo(fx - 0.8, 1.4)
  }
  c.moveTo(-11, -13.6)
  c.quadraticCurveTo(-15, -21, -13.4, -27)
  c.moveTo(-5, -15.6)
  c.quadraticCurveTo(-6.4, -24, -2.6, -29.5)
  c.moveTo(3, -15.4)
  c.quadraticCurveTo(3.6, -20, 6.5, -22.5)
  c.moveTo(-21.5, -6)
  c.quadraticCurveTo(-25, -6, -27, -3.4)
  c.moveTo(-21, -3.6)
  c.quadraticCurveTo(-24, -2, -25.6, 0)
  c.stroke()
  c.fillStyle = `rgba(220,255,250,${(0.4 + 0.4 * glow).toFixed(3)})`
  for (const [tx, ty] of [[-13.4, -27], [-2.6, -29.5], [6.5, -22.5], [-27, -3.4], [-25.6, 0]]) {
    c.beginPath()
    c.arc(tx, ty, 0.75 * px, 0, TAU)
    c.fill()
  }

  // the body: almost clear inside…
  cucumberBody(c)
  c.fillStyle = `rgba(108,248,232,${(0.03 + 0.03 * glow).toFixed(3)})`
  c.fill()
  // …its gut, a loop of swallowed sediment seen through the skin…
  c.strokeStyle = `rgba(234,246,244,${(0.16 + 0.08 * glow).toFixed(3)})`
  c.lineWidth = 1.3 * px
  c.beginPath()
  c.moveTo(-17, -7)
  c.bezierCurveTo(-9, -11.5, -2, -3.5, 5, -8)
  c.bezierCurveTo(11, -12, 16, -6.5, 20, -6.4)
  c.stroke()
  // …and lit at the edges, where the light passes through the most skin
  c.save()
  cucumberBody(c)
  c.clip()
  for (const [lw, al] of [[7, 0.06], [4.2, 0.1], [2.2, 0.18], [1.1, 0.3]]) {
    c.strokeStyle = `rgba(150,255,238,${(al * (0.7 + 0.5 * glow)).toFixed(3)})`
    c.lineWidth = lw * px
    cucumberBody(c)
    c.stroke()
  }
  c.restore()
  cucumberBody(c)
  c.strokeStyle = `rgba(214,255,250,${(0.5 + 0.3 * glow).toFixed(3)})`
  c.lineWidth = 0.8 * px
  c.stroke()
  c.restore()
}

const CUC_X = 64 // the sea cucumber's place on the plain (it crawls left)
function abyssScene() {
  let snow = []
  let geo = null
  let trail = []
  let dashes = []
  let lights = []
  const ROWS = 22
  const elev = (X, z) =>
    Math.sin(X * 0.031 + z * 1.3) * 2.6 + Math.sin(X * 0.0072 - z * 0.7) * 7 + Math.sin(X * 0.083 + z * 2.9) * 0.9
  return {
    setup(w, h, f) {
      const r = rng(31)
      const horizon = f.y + f.h * 0.42
      const near = h * 0.97
      geo = { horizon, near, vpx: w * 0.5 }
      const n = Math.round(clamp((w * h) / 2600, 70, 240))
      snow = Array.from({ length: n }, () => ({
        x: r() * w,
        y: r() * h,
        z: 1 + r() * 8,
        v: 6 + r() * 12,
        s: 0.6 + r() * 1.3,
        ph: r() * TAU,
        a: 0.25 + r() * 0.5,
        land: 0,
      }))
      lights = Array.from({ length: 9 }, () => ({
        x: r() * w,
        y: f.y + r() * f.h * 0.38,
        s: 2 + r() * 3.5,
        a: 0.15 + r() * 0.35,
        ph: r() * TAU,
        sp: 0.2 + r() * 0.6,
        blue: r() < 0.6,
      }))
      // ripple crests are broken, never ruled lines
      dashes = Array.from({ length: ROWS }, () => {
        const d = []
        for (let i = 0; i < 8; i++) d.push(18 + r() * 90, 6 + r() * 40)
        return d
      })
      // the sea cucumber's feeding trail, behind it on the floor
      trail = Array.from({ length: 70 }, (_, i) => ({
        X: CUC_X + 30 + i * 5 + Math.sin(i * 0.31) * 6,
        z: 1.75 + i * 0.03 + Math.sin(i * 0.17) * 0.12,
      }))
    },
    draw(c, t, dt, w, h, f, out, k) {
      const S = sprites()
      const { horizon, near, vpx } = geo
      const pan = (k - 0.5) * 260 // the camera drifts across the plain
      const yAt = (x, z) => horizon + (near - horizon) / z - elev((x - vpx) * z + pan, z) / z
      const sx = (X, z) => vpx + (X - pan) / z
      const glow = 0.72 + 0.28 * Math.sin(t * 0.9) * Math.sin(t * 0.31 + 2)

      // where the living light is: the sea cucumber
      const cucX = CUC_X
      const cucZ = 1.7
      const gx = sx(cucX, cucZ)
      const gy = yAt(gx, cucZ)
      const rad = Math.max(w, h) * 0.5

      c.globalCompositeOperation = 'lighter'
      for (const q of lights) {
        c.globalAlpha = q.a * (0.5 + 0.5 * Math.sin(t * q.sp + q.ph))
        const x = q.x - pan * 0.15
        c.drawImage(q.blue ? S.blue : S.glow, x - q.s, q.y - q.s, q.s * 2, q.s * 2)
      }
      c.globalAlpha = 1
      c.globalCompositeOperation = 'source-over'

      // sediment ripples, near → far; lit only near the glow
      c.lineWidth = 1
      const lightG = c.createRadialGradient(gx, gy, 0, gx, gy, rad)
      lightG.addColorStop(0, `rgba(108,248,232,${(0.5 * glow).toFixed(3)})`)
      lightG.addColorStop(0.3, `rgba(108,248,232,${(0.12 * glow).toFixed(3)})`)
      lightG.addColorStop(1, 'rgba(108,248,232,0)')
      for (let i = 0; i < ROWS; i++) {
        const z = 1 + i * 0.5
        c.setLineDash(dashes[i].map((v) => v / z ** 0.6))
        c.lineDashOffset = -pan / z
        c.beginPath()
        for (let x = -12; x <= w + 12; x += 9) {
          const y = yAt(x, z)
          if (x === -12) c.moveTo(x, y)
          else c.lineTo(x, y)
        }
        c.strokeStyle = `rgba(234,246,244,${(0.03 + 0.12 / z ** 1.1).toFixed(3)})`
        c.stroke()
        c.strokeStyle = lightG
        c.stroke()
      }
      c.setLineDash([])

      // the feeding trail: a meander of faint pellets
      c.fillStyle = 'rgba(234,246,244,0.16)'
      for (const p of trail) {
        const x = sx(p.X, p.z)
        if (x < -4 || x > w + 4) continue
        const y = yAt(x, p.z)
        c.fillRect(x, y - 0.5, 1.4 / p.z + 0.6, 1)
      }

      // a brittle star, close by
      {
        const z = 1.22
        const x = sx(-150, z)
        const y = yAt(x, z) - 1
        c.strokeStyle = 'rgba(234,246,244,0.32)'
        c.lineWidth = 1
        c.beginPath()
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU + 0.4 + Math.sin(t * 0.4 + i) * 0.05
          const L = 26 / z
          c.moveTo(x, y)
          c.quadraticCurveTo(x + Math.cos(a) * L * 0.6, y + Math.sin(a) * L * 0.6 * 0.35, x + Math.cos(a + 0.5) * L, y + Math.sin(a + 0.5) * L * 0.35)
        }
        c.stroke()
        c.fillStyle = 'rgba(234,246,244,0.4)'
        c.beginPath()
        c.ellipse(x, y, 3.2 / z, 1.4 / z, 0, 0, TAU)
        c.fill()
      }

      // a tripod fish, a little further off, with its size noted
      {
        const z = 1.95
        const x = sx(-150, z)
        const ts = (1.7 / z) * Math.min(1.6, w / 400)
        drawTripod(c, x, yAt(x, z), ts, 1, w > 420)
      }

      // the sea cucumber and its glow
      c.globalCompositeOperation = 'lighter'
      const gs = ((80 + 18 * glow) / cucZ) * Math.min(1.5, w / 460)
      c.globalAlpha = 0.32 * glow
      c.drawImage(S.glow, gx - gs, gy - 8 - gs * 0.55, gs * 2, gs * 1.1)
      c.globalAlpha = 1
      c.globalCompositeOperation = 'source-over'
      drawCucumber(c, gx, gy, (1.25 / cucZ) * Math.min(1.7, w / 380), glow)

      // marine snow, settling onto the plain
      for (const p of snow) {
        const floor = yAt(p.x, p.z)
        if (p.land > 0) {
          p.land += dt
          if (p.land > 1.8) {
            p.land = 0
            p.y = -4
            p.x = Math.random() * w
          }
        } else {
          p.y += (p.v / Math.sqrt(p.z)) * dt
          p.x += Math.sin(t * 0.6 + p.ph) * 3 * dt
          if (p.y >= floor) {
            p.y = floor
            p.land = 0.001
          }
        }
        const fade = p.land > 0 ? 1 - p.land / 1.8 : 1
        const lightUp = Math.exp(-((p.x - gx) ** 2 + (p.y - gy) ** 2) / (rad * rad * 0.12)) * glow
        c.fillStyle = `rgba(${Math.round(234 - 120 * lightUp)},${Math.round(246 + 2 * lightUp)},${Math.round(244 - 10 * lightUp)},${(p.a * fade * (0.55 + 0.45 / p.z) + 0.4 * lightUp).toFixed(3)})`
        c.fillRect(p.x, p.y, p.s, p.s)
      }
    },
  }
}

/* ---------------------------------------------------------------- hadal */
function hadalScene() {
  let snow = []
  let pods = []
  return {
    setup(w, h) {
      const r = rng(41)
      const n = Math.round(clamp((w * h) / 12000, 16, 60))
      snow = Array.from({ length: n }, () => ({ x: r() * w, y: r() * h, v: 3 + r() * 6, s: 0.6 + r(), a: 0.08 + r() * 0.16 }))
      pods = Array.from({ length: 30 }, () => ({
        x: (r() - 0.5) * 50,
        y: (r() - 0.8) * 16,
        vx: (r() - 0.5) * 20,
        vy: (r() - 0.5) * 10,
        ph: r() * TAU,
      }))
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
        const s = 44 + 8 * Math.sin(t * 1.3)
        c.globalAlpha = 0.45 * out.deep
        c.drawImage(S.glow, x - s, y - s, s * 2, s * 2)
        c.globalAlpha = 1
        // amphipods scavenging on the bottom
        c.lineWidth = 1
        c.lineCap = 'round'
        for (const p of pods) {
          p.vx += (-p.x * 0.9 + (Math.random() - 0.5) * 160) * dt
          p.vy += (-(p.y + 4) * 2.2 + (Math.random() - 0.5) * 90) * dt
          p.vx *= 1 - 1.6 * dt
          p.vy *= 1 - 2.2 * dt
          p.x += p.vx * dt
          p.y = Math.min(2, p.y + p.vy * dt)
          const a = Math.atan2(p.vy, p.vx)
          const px = x + p.x
          const py = y + p.y - 2
          c.strokeStyle = `rgba(234,246,244,${(0.75 * out.deep * (0.7 + 0.3 * Math.sin(t * 5 + p.ph))).toFixed(3)})`
          c.beginPath()
          c.arc(px, py, 1.9, a + 0.8, a + 0.8 + 2.4)
          c.stroke()
        }
        c.lineCap = 'butt'
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
    `<stop offset="0" stop-color="rgb(234,246,244)" stop-opacity="0.08"/>` +
    `<stop offset="0.7" stop-color="rgb(234,246,244)" stop-opacity="0.02"/>` +
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
      `<span class="zones__pin-label">No fish seen below <b>8,336 m</b></span></span>`,
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
  const reduced = ctx.reducedMotion

  const track = root.querySelector('.zones__track')
  const list = root.querySelector('.zones__list')
  const ladder = root.querySelector('.zones__ladder')
  if (reduced) root.classList.add('is-static')

  /* ------------------------------------------------------------ panels */
  const panels = [...root.querySelectorAll('.zones__panel')].map((el, i) => {
    const z = ZONES.find((zz) => zz.id === el.dataset.layer) || ZONES[i]
    const c = ctx.depth.compression((z.from + z.to) / 2)
    el.style.setProperty('--wdth', c.wdth)
    el.style.setProperty('--wght', c.wght)
    // the window holds this layer's own water, top to bottom of its range
    const top = ctx.depth.colorAt(z.id === 'sunlight' ? 10 : z.from)
    const bot = ctx.depth.colorAt(z.to)
    el.style.setProperty('--water-top', top.css)
    el.style.setProperty('--water-bottom', bot.css)
    const canvas = el.querySelector('.zones__canvas')
    return {
      el,
      z,
      range: el.querySelector('.zones__range'),
      frame: el.querySelector('.zones__frame'),
      canvas,
      c2d: canvas?.getContext('2d') ?? null,
      focus: el.querySelector('.zones__focus'),
      scale: el.querySelector('.zones__scale'),
      cloud: el.querySelector('.zones__cloud'),
      clock: el.querySelector('.zones__clock'),
      clockText: '',
      scene: SCENES[z.id]?.() ?? null,
      out: { cloud: 0.74, hour: 14, deep: 0, still: false },
      f: { x: 0, y: 0, w: 1, h: 1 },
      w: 0,
      h: 0,
      dpr: 1,
      sized: false,
      visible: false,
      t: 0,
      k: 0.5,
      side: 0,
      pingT: -10,
      left: 0,
      width: 0,
      frameOff: 0,
      frameW: 1,
      focusOff: 0,
      focusW: 1,
      segLen: 1,
      rw: -1,
    }
  })
  const hadal = panels.find((p) => p.z.id === 'hadal')
  const pins = hadal?.focus ? buildTrench(hadal.focus, hadal.focus.querySelector('.zones__trench')) : []

  /* ------------------------------------------------------------ layout */
  let horizontal = false
  let strip = false // phones: a sideways swipe strip of windows
  let half = window.innerWidth / 2
  let dist = 0
  // Scroll spent per pixel of sideways travel while pinned: the band moves a
  // third faster than the page would, so five layers take ~4.7 screens.
  const PACE = 0.75
  const pinLen = () => Math.round(dist * PACE)
  // Resting places, as progress through the pin: the intro, then each layer
  // with its panel's left edge on the screen's (copy and window in the clear
  // band between the rail and the ruler).
  let stops = [0, 1]

  function layout() {
    horizontal = root.classList.contains('is-horizontal')
    half = window.innerWidth / 2
    dist = Math.max(0, track.scrollWidth - window.innerWidth)
    for (const p of panels) {
      p.left = list.offsetLeft + p.el.offsetLeft
      p.width = p.el.offsetWidth
      if (p.frame) {
        const fr = p.frame.getBoundingClientRect()
        const pr = p.el.getBoundingClientRect()
        p.frameOff = fr.left - pr.left
        p.frameW = Math.max(1, fr.width)
        if (p.focus) {
          const qr = p.focus.getBoundingClientRect()
          p.focusOff = qr.left - pr.left
          p.focusW = Math.max(1, qr.width)
        }
      }
    }
    // pressure squeezes each range from the moment its panel reaches the
    // centre of the screen until the next one does (the last: until the end)
    panels.forEach((p, i) => {
      p.segLen = i === panels.length - 1 ? Math.max(40, dist + half - p.left) : p.width
    })
    if (dist > 0) {
      const raw = [0, ...panels.map((p) => clamp(p.left / dist)), 1].sort((a, b) => a - b)
      stops = raw.filter((v, i) => i === 0 || v - raw[i - 1] > 0.02)
    }
  }

  // Where to come to rest when the scroll stops inside the pin: carry on to
  // the next layer in the direction of travel, unless the visitor only
  // nudged a little way off the one they were on.
  function snapStop(v, self) {
    let i = 1
    while (i < stops.length - 1 && stops[i] < v) i++
    const a = stops[i - 1]
    const b = stops[i]
    if (v <= a) return a
    if (v >= b) return b
    const frac = (v - a) / (b - a)
    if (self?.direction < 0) return frac > 0.82 ? b : a
    return frac < 0.18 ? a : b
  }

  /* --------------------------------------------------- sonar, progress */
  function ping(p, cx, cy) {
    if (reduced) return
    p.pingT = p.t
    ctx.emit('sonar', { x: cx, y: cy, strength: 0.35 })
  }
  // k: 0 as the window enters, 0.5 at the centre, 1 as it leaves.
  // A ping each time a window's centre crosses the centre of the screen.
  function progress(p, k, cx, cy) {
    p.k = k
    const side = k < 0.5 ? -1 : 1
    if (p.side && side !== p.side && p.visible) ping(p, cx, cy)
    p.side = side
  }

  /* ------------------------------------------------------------ render */
  function render() {
    if (!horizontal) return
    const x = gsap.getProperty(track, 'x')
    const ph = half - x
    const vw = window.innerWidth
    const vh = window.innerHeight
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i]
      const t = (ph - p.left) / p.segLen
      const l = p.left + p.frameOff + x
      progress(p, clamp((vw - l) / (vw + p.frameW)), l + p.frameW / 2, vh * 0.45)
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
    }
  }

  /* ------------------------------------------------------------ scenes */
  const scan = { v: reduced ? 1 : 0 }
  let lastScan = scan.v
  function paintScan() {
    if (!hadal?.focus) return
    const v = scan.v
    // the sweep finds the Challenger Deep: Vesper's sonar answers
    if (!reduced && lastScan < TRENCH_DEEP.x && v >= TRENCH_DEEP.x) {
      const r = hadal.focus.getBoundingClientRect()
      ctx.emit('sonar', { x: r.left + r.width * TRENCH_DEEP.x, y: r.top + r.height * TRENCH_DEEP.y, strength: 0.5 })
      hadal.pingT = hadal.t
    }
    lastScan = v
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
    p.out.dpr = p.dpr
    p.w = w
    p.h = h
    p.canvas.width = Math.round(w * p.dpr)
    p.canvas.height = Math.round(h * p.dpr)
    // the band the scale covers: the layer's top to its bottom
    const band = p.focus || p.scale
    if (band && band.offsetHeight) {
      p.f = { x: p.focus ? band.offsetLeft : 0, y: band.offsetTop, w: p.focus ? band.offsetWidth : w, h: band.offsetHeight }
    } else {
      p.f = { x: 0, y: h * 0.12, w, h: h * 0.68 }
    }
    p.scene?.setup(w, h, p.f)
    p.sized = true
    return true
  }

  function drawPing(p) {
    const age = p.t - p.pingT
    if (age < 0 || age > 2.4) return
    const c = p.c2d
    const e = age / 2.4
    c.globalCompositeOperation = 'lighter'
    c.lineWidth = 1.2
    for (let j = 0; j < 2; j++) {
      const a = e - j * 0.08
      if (a <= 0) continue
      const r = a * p.h * 1.05
      c.strokeStyle = `rgba(108,248,232,${(0.5 * (1 - a) ** 1.6 * (j ? 0.45 : 1)).toFixed(3)})`
      c.beginPath()
      c.ellipse(p.w * 0.5, p.h * 0.02, r * 1.25, r, 0, Math.PI * 0.08, Math.PI * 0.92)
      c.stroke()
    }
    c.globalCompositeOperation = 'source-over'
  }

  function frame(p, dt) {
    const c = p.c2d
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, p.canvas.width, p.canvas.height)
    c.setTransform(p.dpr, 0, 0, p.dpr, 0, 0)
    p.scene.draw(c, p.t, dt, p.w, p.h, p.f, p.out, p.k)
    drawPing(p)
    if (p.z.id === 'twilight') paintTwilight(p)
  }

  function paintTwilight(p) {
    p.cloud?.style.setProperty('--cloud', p.out.cloud.toFixed(4))
    if (p.clock) {
      const q = Math.floor((p.out.hour * 60) / 15) * 15 // quarter hours
      const txt = `${String(Math.floor(q / 60) % 24).padStart(2, '0')}:${String(q % 60).padStart(2, '0')}`
      if (txt !== p.clockText) {
        p.clockText = txt
        p.clock.textContent = txt
      }
    }
  }

  // Reduced motion: one still per scene, at the middle of its story.
  function still(p) {
    if (!p.sized && !sizeScene(p)) return
    p.t = 0
    p.k = 0.5
    p.out.still = true
    for (let n = 0; n < 150; n++) {
      p.t += 1 / 30
      frame(p, 1 / 30)
    }
  }

  let ticking = false
  const rects = []
  function loop(time, deltaMs) {
    if (document.hidden) return
    const dt = Math.min(0.05, deltaMs / 1000)
    // stacked: each window's progress comes from its place on the screen,
    // top to bottom; in the phone strip, from its place across the screen,
    // so a swipe scrubs it like the pinned pass does (read every rect first,
    // then draw)
    if (!horizontal) {
      const vh = window.innerHeight
      const vw = window.innerWidth
      rects.length = 0
      for (const p of panels) rects.push(p.visible && p.frame ? p.frame.getBoundingClientRect() : null)
      panels.forEach((p, i) => {
        const r = rects[i]
        if (!r) return
        const k = strip ? (vw - r.left) / (vw + r.width) : (vh - r.top) / (vh + r.height)
        progress(p, clamp(k), r.left + r.width / 2, r.top + r.height / 2)
      })
    }
    for (const p of panels) {
      if (!p.visible || !p.scene) continue
      if (!p.sized && !sizeScene(p)) continue
      p.t += dt
      frame(p, dt)
    }
  }
  function updateLoop() {
    const any = panels.some((p) => p.visible)
    if (any && !ticking && !reduced) {
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
          if (!p.visible) p.side = 0 // no ping for the first crossing seen
          if (p.visible && reduced) still(p)
          if (!p.visible && p.sized && !reduced) {
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
        if (p.visible) (reduced ? still(p) : sizeScene(p))
      }
    })
    for (const p of panels) if (p.canvas) ro.observe(p.canvas)
  }

  /* ------------------------------------------------------- phone strip */
  // Phones: the windows sit side by side in a scroll-snap strip (CSS). Here:
  // keyboard access, the depth ladder, and the trench survey, which plays
  // when the hadal card arrives (a response to the swipe, so time-based).
  function setupStrip() {
    root.classList.remove('is-horizontal')
    strip = true
    layout()
    list.setAttribute('tabindex', '0')
    list.setAttribute('aria-labelledby', 'zones-title')
    // sideways trackpad gestures scroll the strip, not the page
    list.setAttribute('data-lenis-prevent-horizontal', '')
    const steps = ladder ? [...ladder.querySelectorAll('.zones__step')] : []
    if (ladder) ladder.hidden = false

    let active = -1
    let raf = 0
    const offset = (i) => panels[i].el.offsetLeft - panels[0].el.offsetLeft
    function sync() {
      raf = 0
      const step = offset(1) || 1
      const pos = clamp(list.scrollLeft / step, 0, panels.length - 1)
      ladder?.style.setProperty('--pos', pos.toFixed(3))
      const i = Math.round(pos)
      if (i !== active) {
        active = i
        steps.forEach((b, j) => b.setAttribute('aria-current', j === i ? 'true' : 'false'))
      }
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(sync)
    }
    const onStep = (e) => {
      const b = e.target.closest('.zones__step')
      if (!b) return
      const i = clamp(+b.dataset.step || 0, 0, panels.length - 1)
      list.scrollTo({ left: offset(i), behavior: reduced ? 'auto' : 'smooth' })
    }
    list.addEventListener('scroll', onScroll, { passive: true })
    ladder?.addEventListener('click', onStep)
    sync()

    let sweepIO = null
    let sweep = null
    if (!reduced && hadal && 'IntersectionObserver' in window) {
      scan.v = 0
      paintScan()
      sweepIO = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.intersectionRatio >= 0.6) {
              if (!sweep && scan.v < 1) {
                sweep = gsap.to(scan, { v: 1, duration: 2.6, ease: 'none', delay: 0.15, onUpdate: paintScan })
              }
            } else if (!e.isIntersecting) {
              // gone from the strip: ready to survey again next time
              sweep?.kill()
              sweep = null
              scan.v = 0
              paintScan()
            }
          }
        },
        { root: list, threshold: [0, 0.6] },
      )
      sweepIO.observe(hadal.el)
    }

    return () => {
      strip = false
      list.removeEventListener('scroll', onScroll)
      ladder?.removeEventListener('click', onStep)
      cancelAnimationFrame(raf)
      sweepIO?.disconnect()
      sweep?.kill()
      list.removeAttribute('tabindex')
      list.removeAttribute('aria-labelledby')
      list.removeAttribute('data-lenis-prevent-horizontal')
      if (ladder) ladder.hidden = true
      list.scrollLeft = 0
      if (!reduced) {
        scan.v = 0
        paintScan()
      }
    }
  }

  /* ------------------------------------------------------- the journey */
  const mm = gsap.matchMedia()
  mm.add(
    {
      wide: '(min-width: 900px) and (min-height: 600px) and (min-aspect-ratio: 1/1)',
      phone: '(max-width: 767px)',
      reduce: '(prefers-reduced-motion: reduce)',
      // always true: matchMedia only calls back when some condition matches
      any: '(min-width: 0px)',
    },
    (m) => {
      const { wide, phone, reduce } = m.conditions
      if (phone) return setupStrip()
      if (!wide || reduce || reduced) {
        root.classList.remove('is-horizontal')
        layout()
        if (!reduced && hadal) {
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
        end: () => `+=${pinLen()}`,
        pin: true,
        scrub: 0.9,
        animation: tween,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        // stop on whole layers, never on two half panels
        snap: {
          snapTo: snapStop,
          duration: { min: 0.5, max: 1 },
          delay: 0.14,
          ease: 'power3.out',
          inertia: false,
        },
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
        end: () => `+=${pinLen() + window.innerHeight * 2}`,
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

      // the hadal panel's left edge, on screen, at the end of the pin…
      const sweepTo = () => hadal.left - dist + 2
      // …and where it is when the beam starts: the trench's left edge 140 px
      // inside the visible band (which ends where the last panel ends)
      const sweepFrom = () => {
        const visibleRight = sweepTo() + hadal.width
        const from = visibleRight - 140 - hadal.focusOff
        return Math.max(from, sweepTo() + 160)
      }
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
              // Like a ship's sonar mapping the floor as it moves: the beam
              // holds still, just inside the visible band, and the trench
              // slides under it, finishing as the pin ends.
              start: () => `left ${Math.round(sweepFrom())}px`,
              end: () => `left ${Math.round(sweepTo())}px`,
              scrub: 0.6,
              invalidateOnRefresh: true,
            },
          },
        )
      }
      render()

      return () => {
        root.classList.remove('is-horizontal', 'is-settled')
        root.style.removeProperty('--tf')
        gsap.set(track, { clearProps: 'transform' })
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
