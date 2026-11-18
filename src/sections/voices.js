/**
 * voices.js — #voices (10,000 → 10,600 m). Three guests describe the bottom.
 *
 * Signature: the sub's red lamp reads the quotes to you. On desktop the stage
 * pins and shows one quote at a time. As you sink, a volumetric red beam
 * (canvas) pans across the words; each word is dark water until the beam
 * reaches it, glows hot while it is under the light, then stays lit. The
 * silt hanging in the water only shows where the beam passes through it.
 * Between quotes the lamp dims and swings back; the quotes crossfade.
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
  gsap.set(items, { autoAlpha: 0 })
  gsap.set(items[0], { autoAlpha: 1 })
  gsap.set(cites, { opacity: 0.22 })
  gsap.set(items, { '--vo-mark': 0.35 })

  const PER = 1.25 // timeline units per quote
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: stage,
      start: 'top top',
      end: () => `+=${Math.round(window.innerHeight * 3.6)}`,
      pin: true,
      scrub: 0.9,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
  })

  items.forEach((item, i) => {
    const t0 = i * PER
    if (i > 0) {
      // the lamp dims and swings back while the quotes trade places
      tl.to(lamp, { on: 0.12, duration: 0.16, ease: 'power2.in' }, t0 - 0.1)
      tl.set(lamp, { k: i }, t0 + 0.04)
      tl.to(items[i - 1], { autoAlpha: 0, duration: 0.16, ease: 'power1.in' }, t0 - 0.04)
      tl.to(item, { autoAlpha: 1, duration: 0.2, ease: 'power1.out' }, t0 + 0.08)
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
  // a last held beat on the third quote before the stage lets go
  tl.to({}, { duration: 0.3 })

  const stopCanvas = beam(ctx, { stage, canvas, texts, q, lamp })

  return () => {
    stopCanvas?.()
    root.classList.remove('is-staged')
    texts.forEach((t) => t.style.removeProperty('--b'))
  }
}

/* ================================================== the beam (canvas 2D) */
function beam(ctx, { stage, canvas, texts, q, lamp }) {
  const c2 = canvas.getContext('2d')
  if (!c2) return null
  const dpr = Math.min(ctx.dpr, 1.5)
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
    // vertical cone, apex at top centre, soft cross-section, axial falloff
    const w = 256
    const h = 512
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const g = cv.getContext('2d')
    const img = g.createImageData(w, h)
    const tan = 0.16
    for (let y = 0; y < h; y++) {
      const u = y / h
      const half = 3 + y * tan
      const ax = Math.pow(1 - u, 1.25) * (0.35 + 0.65 * Math.min(1, y / 40))
      for (let x = 0; x < w; x++) {
        const v = (x - w / 2) / half
        const a = Math.exp(-v * v * 2.4) * ax
        const i = (y * w + x) * 4
        img.data[i] = RED[0]
        img.data[i + 1] = RED[1]
        img.data[i + 2] = RED[2]
        img.data[i + 3] = Math.round(a * 255)
      }
    }
    g.putImageData(img, 0, 0)
    return cv
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
    const n = Math.round(clamp((W * H) / 4200, 120, 380))
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
      cone = makeCone()
      glow = radial(256, [
        [0, 'rgba(255,90,70,0.55)'],
        [0.35, 'rgba(255,59,47,0.18)'],
        [1, 'rgba(255,59,47,0)'],
      ])
      dot = radial(32, [
        [0, 'rgba(255,236,230,1)'],
        [0.25, 'rgba(255,120,100,0.75)'],
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
    const k = 1 - Math.exp(-dt * 7)
    cur.x = lerp(cur.x, t.x, k)
    cur.y = lerp(cur.y, t.y, k)
    cur.on = lerp(cur.on, lamp.on, 1 - Math.exp(-dt * 9))

    c2.setTransform(dpr, 0, 0, dpr, 0, 0)
    c2.globalCompositeOperation = 'source-over'
    c2.clearRect(0, 0, W, H)
    c2.globalCompositeOperation = 'lighter'

    // the lamp hangs above and to the right, out of frame
    const sx = W * 0.86
    const sy = -H * 0.62
    const dx = cur.x - sx
    const dy = cur.y - sy
    const dist = Math.hypot(dx, dy) || 1
    const ax = dx / dist
    const ay = dy / dist
    const len = dist * 1.75
    const on = cur.on

    // volumetric cone
    const s = len / cone.height
    c2.save()
    c2.translate(sx, sy)
    c2.rotate(Math.atan2(ay, ax) - Math.PI / 2)
    c2.globalAlpha = 0.34 * on
    c2.drawImage(cone, (-cone.width * s) / 2, 0, cone.width * s, len)
    c2.restore()

    // where it meets the words
    const gr = Math.min(W, H) * 0.42
    c2.globalAlpha = 0.5 * on
    c2.drawImage(glow, cur.x - gr, cur.y - gr * 0.8, gr * 2, gr * 1.6)

    // silt, visible only inside the beam (plus a faint everywhere-glimmer)
    const tan = 0.16 * s // cone half-width grows with distance (in px)
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
      const half = 3 * s + (u / s) * tan
      const f = Math.exp(-((v / half) ** 2) * 2.4) * Math.pow(clamp(1 - u / len), 0.9)
      const a = (p.big ? 0.0 : 0.035) + f * on
      if (a < 0.02) continue
      if (p.big) {
        c2.globalAlpha = clamp(a * 0.9)
        c2.drawImage(bokeh, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2)
      } else {
        const r = p.r * (2.2 + f * 1.6)
        c2.globalAlpha = clamp(a * (0.55 + p.z * 0.6))
        c2.drawImage(dot, p.x - r, p.y - r, r * 2, r * 2)
      }
    }
    c2.globalAlpha = 1
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
