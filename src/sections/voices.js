/**
 * voices.js — #voices (10,000 → 10,600 m). Three guests describe the bottom.
 *
 * Signature: the sub's red lamp reads the quotes to you. On desktop the stage
 * pins and shows one quote at a time, each somewhere else in the dark. As you
 * sink, a volumetric red beam (canvas) finds the guest and pans across the
 * words; each word is dark water until the beam reaches it, glows hot while it
 * is under the light, then stays lit. The silt hanging in the water only shows
 * inside the cone. Between quotes the lamp dims and swings to the next guest;
 * the quotes crossfade (opacity only, so all three stay readable to assistive
 * tech). The lamp ramps up as the stage arrives and fades out as it leaves, so
 * the beam never ends on a hard edge.
 *
 * Mobile: stacked, each quote is swept once by the light as it arrives.
 * Reduced motion: stacked, fully lit, no canvas.
 *
 * DOM hooks: [data-vo-stage] [data-vo-canvas] [data-vo-item] [data-vo-text]
 * [data-vo-cite] [data-vo-tick]. Emits / listens: nothing.
 */
import '../styles/voices.css'

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const RED = [255, 59, 47]
const ANG = (100 * Math.PI) / 180 // must match the CSS gradient angle

export function init(ctx) {
  const root = document.getElementById('voices')
  if (!root) return
  const { gsap } = ctx
  const stage = root.querySelector('[data-vo-stage]')
  const items = [...root.querySelectorAll('[data-vo-item]')]
  const texts = items.map((i) => i.querySelector('[data-vo-text]'))
  const cites = items.map((i) => i.querySelector('[data-vo-cite]'))
  const ticks = [...root.querySelectorAll('[data-vo-tick] i')]
  const canvas = root.querySelector('[data-vo-canvas]')

  // Reduced motion: the stacked layout, fully lit, nothing moves.
  if (ctx.reducedMotion) {
    root.classList.add('is-static')
    return
  }

  const mm = gsap.matchMedia()
  mm.add('(min-width: 768px)', () => staged(ctx, { root, stage, items, texts, cites, ticks, canvas }))
  mm.add('(max-width: 767px)', () => stacked(ctx, { texts, cites }))
}

/* ======================================================= mobile: stacked */
function stacked(ctx, { texts, cites }) {
  const { gsap } = ctx
  texts.forEach((t, i) => {
    gsap.set(t, { '--b': '-30%' })
    gsap.set(cites[i], { opacity: 0.35 })
    const tl = gsap
      .timeline({
        paused: true,
        scrollTrigger: { trigger: t, start: 'top 78%', toggleActions: 'play none none none' },
      })
      .to(t, { '--b': '135%', duration: 2.6, ease: 'power1.inOut' })
      .to(cites[i], { opacity: 1, duration: 1.2, ease: 'power2.out' }, '-=1.1')
    return tl
  })
}

/* ===================================================== desktop: the stage */
function staged(ctx, { root, stage, items, texts, cites, ticks, canvas }) {
  const { gsap } = ctx
  root.classList.add('is-staged')

  // one proxy per quote (beam position through it) + the lamp itself
  const q = texts.map(() => ({ p: -0.32 }))
  const lamp = { on: 0.85, k: 0 }

  const writeB = (i) => texts[i].style.setProperty('--b', `${(q[i].p * 100).toFixed(2)}%`)
  texts.forEach((_, i) => writeB(i))
  gsap.set(items, { opacity: 0, pointerEvents: 'none' })
  gsap.set(items[0], { opacity: 1, pointerEvents: 'auto' })
  gsap.set(cites, { opacity: 0.22 })
  gsap.set(items, { '--vo-mark': 0.35 })

  const PER = 1.25 // timeline units per quote
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: stage,
      start: 'top top',
      end: () => `+=${Math.round(window.innerHeight * 2.5)}`,
      pin: true,
      scrub: 0.9,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
  })

  items.forEach((item, i) => {
    const t0 = i * PER
    if (i > 0) {
      // the lamp dims and swings to the next guest while the quotes trade places
      tl.to(lamp, { on: 0.12, duration: 0.16, ease: 'power2.in' }, t0 - 0.1)
      tl.set(lamp, { k: i }, t0 + 0.04)
      tl.to(items[i - 1], { opacity: 0, duration: 0.16, ease: 'power1.in' }, t0 - 0.04)
      tl.set(items[i - 1], { pointerEvents: 'none' }, t0 + 0.04)
      tl.set(item, { pointerEvents: 'auto' }, t0 + 0.04)
      tl.to(item, { opacity: 1, duration: 0.2, ease: 'power1.out' }, t0 + 0.08)
      tl.to(lamp, { on: 1, duration: 0.2, ease: 'power2.out' }, t0 + 0.16)
    } else {
      tl.to(lamp, { on: 1, duration: 0.14, ease: 'power1.out' }, 0)
    }
    // the sweep
    tl.to(
      q[i],
      { p: 1.32, duration: 0.74, ease: 'power1.inOut', onUpdate: () => writeB(i) },
      t0 + (i ? 0.2 : 0.04),
    )
    // read: the pilot eases the lamp off the words while you finish
    tl.to(lamp, { on: 0.42, duration: 0.18, ease: 'power1.inOut' }, t0 + (i ? 0.9 : 0.74))
    tl.to(item, { '--vo-mark': 1, duration: 0.18, ease: 'power1.out' }, t0 + (i ? 0.22 : 0.06))
    tl.to(cites[i], { opacity: 1, duration: 0.22, ease: 'power1.out' }, t0 + (i ? 0.72 : 0.58))
    if (ticks[i]) tl.to(ticks[i], { scaleX: 1, duration: PER - 0.1 }, t0)
  })
  // a short held beat on the third quote before the stage lets go
  tl.to({}, { duration: 0.08 })

  const stopCanvas = beam(ctx, { stage, canvas, texts, q, lamp })

  return () => {
    stopCanvas?.()
    root.classList.remove('is-staged')
    texts.forEach((t) => t.style.removeProperty('--b'))
    gsap.set(items, { clearProps: 'opacity,pointerEvents' })
  }
}

/* ================================================== the beam (canvas 2D) */
// 1D value noise for the streaks inside the cone
const h1 = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
const n1 = (x) => {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return h1(i) * (1 - u) + h1(i + 1) * u
}
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
// cross-section of the cone: a lit core, a defined edge with a faint rim, and
// the scatter just outside it (v = distance from the axis / half-width)
const profile = (v) => {
  const av = Math.abs(v)
  const edge = 1 - smooth(0.84, 1.0, av)
  const core = 0.52 + 0.48 * (1 - Math.min(1, av * av))
  const rim = 0.22 * Math.exp(-(((av - 0.93) / 0.07) ** 2))
  const halo = 0.1 * Math.exp(-av * av * 0.9)
  return edge * core + rim * edge + halo
}

function beam(ctx, { stage, canvas, texts, q, lamp }) {
  const c2 = canvas.getContext('2d')
  if (!c2) return null
  const dpr = Math.min(ctx.dpr, 1.5)
  const TAN = 0.13 // cone half-angle (tan)
  let W = 0
  let H = 0
  let boxes = []
  let cone = null
  let glow = null
  let dot = null
  let bokeh = null
  let parts = []
  let raf = 0
  let visible = false
  let last = 0
  // smoothed beam target (px) and intensity
  const cur = { x: 0, y: 0, on: 0, ready: false }

  /* ---------------------------------------------------- sprites */
  function makeCone() {
    // vertical cone, apex at top centre: defined edge, streaks, axial falloff
    const w = 320
    const h = 640
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const g = cv.getContext('2d')
    const img = g.createImageData(w, h)
    const tanPx = TAN // the edge reaches ~55% of the sprite width at the far end
    for (let y = 0; y < h; y++) {
      const u = y / h
      const half = 2.5 + y * tanPx
      const ax = Math.pow(1 - u, 1.15) * (0.3 + 0.7 * Math.min(1, y / 46))
      for (let x = 0; x < w; x++) {
        const v = (x - w / 2) / half
        if (Math.abs(v) > 1.9) continue
        // streaks radiate from the apex: noise across the angle, not the length
        const streak = 0.8 + 0.22 * n1(v * 7.5 + 4.2) + 0.1 * n1(v * 21 + 1.3) - 0.08 * n1(u * 3 + v * 2)
        const a = profile(v) * streak * ax
        const i = (y * w + x) * 4
        img.data[i] = RED[0]
        img.data[i + 1] = RED[1] + 18
        img.data[i + 2] = RED[2] + 12
        img.data[i + 3] = Math.round(clamp(a) * 255)
      }
    }
    g.putImageData(img, 0, 0)
    cone = cv
    cone.tan = tanPx
  }
  function radial(size, stops) {
    const cv = document.createElement('canvas')
    cv.width = cv.height = size
    const g = cv.getContext('2d')
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    stops.forEach(([o, c]) => grd.addColorStop(o, c))
    g.fillStyle = grd
    g.fillRect(0, 0, size, size)
    return cv
  }

  function seed() {
    const n = Math.round(clamp((W * H) / 3600, 140, 420))
    parts = Array.from({ length: n }, () => {
      const z = Math.random()
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        z,
        r: 0.5 + z * z * 2.1,
        vy: 3 + z * 9 + Math.random() * 4, // silt sinks, slowly
        ph: Math.random() * Math.PI * 2,
        sw: 0.15 + Math.random() * 0.5,
      }
    })
    // a few large out-of-focus particles close to the viewport
    for (let i = 0; i < 9; i++) {
      parts.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: 1.6,
        r: 18 + Math.random() * 30,
        vy: 6 + Math.random() * 6,
        ph: Math.random() * Math.PI * 2,
        sw: 0.3,
        big: true,
      })
    }
  }

  function measure() {
    const r = stage.getBoundingClientRect()
    W = Math.max(1, Math.round(r.width))
    H = Math.max(1, Math.round(r.height))
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    boxes = texts.map((t) => {
      const b = t.getBoundingClientRect()
      const L = b.width * Math.sin(ANG) + b.height * Math.abs(Math.cos(ANG))
      return { cx: b.left - r.left + b.width / 2, cy: b.top - r.top + b.height / 2, w: b.width, h: b.height, L }
    })
    if (!cone) {
      makeCone()
      glow = radial(256, [
        [0, 'rgba(255,90,70,0.5)'],
        [0.35, 'rgba(255,59,47,0.16)'],
        [1, 'rgba(255,59,47,0)'],
      ])
      dot = radial(32, [
        [0, 'rgba(255,240,234,1)'],
        [0.22, 'rgba(255,128,106,0.8)'],
        [1, 'rgba(255,59,47,0)'],
      ])
      bokeh = radial(128, [
        [0, 'rgba(255,90,70,0.22)'],
        [0.6, 'rgba(255,59,47,0.10)'],
        [0.85, 'rgba(255,59,47,0.04)'],
        [1, 'rgba(255,59,47,0)'],
      ])
    }
    seed()
    if (!visible) draw(0)
  }

  function target() {
    const k = clamp(Math.round(lamp.k), 0, boxes.length - 1)
    const b = boxes[k]
    if (!b) return { x: W / 2, y: H / 2 }
    const p = q[k].p - 0.005
    return { x: b.cx + ((p - 0.5) * b.L) / Math.sin(ANG), y: b.cy }
  }

  /* ------------------------------------------------------- frame */
  function draw(dt) {
    const t = target()
    if (!cur.ready) {
      cur.x = t.x
      cur.y = t.y
      cur.on = lamp.on
      cur.ready = true
    }
    const k = 1 - Math.exp(-dt * 5.5)
    cur.x = lerp(cur.x, t.x, k)
    cur.y = lerp(cur.y, t.y, k)
    cur.on = lerp(cur.on, lamp.on, 1 - Math.exp(-dt * 9))

    // hand-overs: the lamp comes up as the stage arrives and goes out as it
    // leaves, and the haze fades towards whichever edge is inside the screen
    const top = stage.getBoundingClientRect().top
    const enter = clamp(1 - top / H)
    const exit = clamp(-top / H)
    const gain = smooth(0.12, 0.95, enter) * (1 - smooth(0.02, 0.8, exit))

    c2.setTransform(dpr, 0, 0, dpr, 0, 0)
    c2.globalCompositeOperation = 'source-over'
    c2.clearRect(0, 0, W, H)
    if (gain <= 0.002) return
    c2.globalCompositeOperation = 'lighter'

    // the lamp hangs above and to the right, out of frame
    const sx = W * 0.86
    const sy = -H * 0.62
    const dx = cur.x - sx
    const dy = cur.y - sy
    const dist = Math.hypot(dx, dy) || 1
    const ax = dx / dist
    const ay = dy / dist
    const len = dist * 1.7
    const on = cur.on * gain

    // volumetric cone (the sprite's half-width grows by cone.tan per px)
    const s = len / cone.height
    c2.save()
    c2.translate(sx, sy)
    c2.rotate(Math.atan2(ay, ax) - Math.PI / 2)
    c2.globalAlpha = 0.4 * on
    c2.drawImage(cone, (-cone.width * s) / 2, 0, cone.width * s, len)
    c2.restore()

    // where it meets the words
    const gr = Math.min(W, H) * 0.36
    c2.globalAlpha = 0.42 * on
    c2.drawImage(glow, cur.x - gr, cur.y - gr * 0.8, gr * 2, gr * 1.6)

    // silt: lit inside the cone (bright, a touch larger), a faint glimmer outside
    const t1 = performance.now() / 1000
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      p.y += p.vy * dt
      p.x += Math.sin(t1 * p.sw + p.ph) * 4 * dt
      if (p.y > H + 40) {
        p.y = -40
        p.x = Math.random() * W
      }
      const px = p.x - sx
      const py = p.y - sy
      const u = px * ax + py * ay
      if (u <= 0) continue
      const v = px * ay - py * ax
      const half = 2.5 * s + u * cone.tan
      const f = profile(v / half) * Math.pow(clamp(1 - u / len), 0.8)
      const a = (p.big ? 0 : 0.03 * gain) + f * on
      if (a < 0.02) continue
      if (p.big) {
        c2.globalAlpha = clamp(a * 0.8)
        c2.drawImage(bokeh, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2)
      } else {
        const r = p.r * (2 + f * 1.8)
        c2.globalAlpha = clamp(a * (0.6 + p.z * 0.6))
        c2.drawImage(dot, p.x - r, p.y - r, r * 2, r * 2)
      }
    }
    c2.globalAlpha = 1

    // soften the stage's own edges while they are inside the screen
    const ft = top > 0 ? H * 0.5 * Math.pow(1 - enter, 0.75) : 0
    const fb = top < 0 ? H * 0.55 * Math.pow(exit, 0.65) : 0
    if (ft > 1 || fb > 1) {
      const a0 = clamp(ft / H, 0, 0.98)
      const b0 = clamp(1 - fb / H, a0 + 0.01, 1)
      const grd = c2.createLinearGradient(0, 0, 0, H)
      grd.addColorStop(0, 'rgba(0,0,0,0)')
      grd.addColorStop(a0, 'rgba(0,0,0,1)')
      grd.addColorStop(b0, 'rgba(0,0,0,1)')
      grd.addColorStop(1, 'rgba(0,0,0,0)')
      c2.globalCompositeOperation = 'destination-in'
      c2.fillStyle = grd
      c2.fillRect(0, 0, W, H)
      c2.globalCompositeOperation = 'source-over'
    }
  }

  function loop(now) {
    raf = 0
    const dt = Math.min(0.05, (now - (last || now)) / 1000)
    last = now
    draw(dt)
    if (visible && !document.hidden) raf = requestAnimationFrame(loop)
  }
  function start() {
    if (raf || !visible || document.hidden) return
    last = 0
    raf = requestAnimationFrame(loop)
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  const io = new IntersectionObserver(
    ([e]) => {
      visible = e.isIntersecting
      visible ? start() : stop()
    },
    { rootMargin: '80px 0px' },
  )
  io.observe(stage)
  const onVis = () => (document.hidden ? stop() : start())
  document.addEventListener('visibilitychange', onVis)
  const onRefresh = () => measure()
  ctx.ScrollTrigger.addEventListener('refresh', onRefresh)
  measure()

  return () => {
    stop()
    io.disconnect()
    document.removeEventListener('visibilitychange', onVis)
    ctx.ScrollTrigger.removeEventListener('refresh', onRefresh)
  }
}
