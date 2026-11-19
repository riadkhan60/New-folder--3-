/**
 * voices.js — #voices (10,000 → 10,600 m). Three guests describe the bottom.
 *
 * Signature: the sub's red lamp reads to you. On desktop the stage pins: the
 * lamp finds the heading first and reads it, alone in the dark; then each
 * guest's words in turn, each somewhere else in the dark. A volumetric red
 * beam (canvas) pans across the words; each word is dark water until the beam
 * reaches it, glows hot while it is under the light, then stays lit. Once a
 * guest is read, the lamp drifts back over their words and holds them,
 * swaying a little as a hovering submersible does. The silt hanging in the
 * water only shows inside the cone; a flake turned square to the lamp glints.
 *
 * Scroll chooses who is speaking (the lamp dims and swings to the next guest
 * while the quotes crossfade: opacity only, so all three stay readable to
 * assistive tech). The reading itself takes time, not scroll: a guest's words
 * are read once, in about two seconds, from the moment you reach them, so
 * every quote is lit for nearly all of its stretch of the descent, however
 * slowly you sink. The lamp ramps up as the stage arrives and fades out as it
 * leaves, so the beam never ends on a hard edge.
 *
 * Mobile: stacked; the heading and each quote are swept once by the light as
 * they arrive, and each quote comes up in a pool of the lamp's light. Reduced motion: stacked, fully lit, no canvas.
 *
 * The beam canvas and its sprites are only built near the screen (the intro
 * never pays for them) and their memory is handed back far from it.
 *
 * DOM hooks: [data-vo-stage] [data-vo-canvas] [data-vo-title] [data-vo-item]
 * [data-vo-text] [data-vo-cite] [data-vo-tick]. Emits / listens: nothing.
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
  const title = root.querySelector('[data-vo-title]')
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
  mm.add('(min-width: 768px)', () => staged(ctx, { root, stage, title, items, texts, cites, ticks, canvas }))
  mm.add('(max-width: 767px)', () => stacked(ctx, { title, texts, cites }))
}

/* ======================================================= mobile: stacked */
function stacked(ctx, { title, texts, cites }) {
  const { gsap } = ctx
  // the heading is read first, a little quicker than the guests' words; each
  // guest's words come up in a pool of the lamp's light as they are read
  const figs = texts.map((t) => t.closest('.voices__figure'))
  ;[title, ...texts].forEach((t, i) => {
    if (!t) return
    gsap.set(t, { '--b': '-30%' })
    const cite = i ? cites[i - 1] : null
    const fig = i ? figs[i - 1] : null
    if (cite) gsap.set(cite, { opacity: 0.35 })
    if (fig) gsap.set(fig, { '--vo-pool': 0 })
    const tl = gsap
      .timeline({
        paused: true,
        scrollTrigger: { trigger: t, start: i ? 'top 78%' : 'top 84%', toggleActions: 'play none none none' },
      })
      .to(t, { '--b': '135%', duration: i ? 2.6 : 1.7, ease: 'power1.inOut' })
    if (fig) tl.to(fig, { '--vo-pool': 1, duration: 2.2, ease: 'power2.out' }, 0.2)
    if (cite) tl.to(cite, { opacity: 1, duration: 1.2, ease: 'power2.out' }, '-=1.1')
  })
  return () => gsap.set(figs, { clearProps: '--vo-pool' })
}

/* ===================================================== desktop: the stage */
function staged(ctx, { root, stage, title, items, texts, cites, ticks, canvas }) {
  const { gsap, ScrollTrigger } = ctx
  root.classList.add('is-staged')

  // what the lamp reads, in order: the heading, then the three guests
  const lines = [title, ...texts]
  const q = lines.map(() => ({ p: -0.32 })) // the beam's position through each line
  // where the lamp comes to rest once a line is read: it drifts back over the
  // words and holds them, softly, instead of leaving them in the dark
  const rest = lines.map(() => ({ p: 1.32 }))
  const reading = lines.map(() => false)
  const read = lines.map(() => false)
  // k = the line the lamp is on; base = dims while it swings between guests;
  // it burns bright while it reads and eases off the words once they are read
  const lamp = {
    k: 0,
    base: 1,
    get on() {
      const k = clamp(Math.round(this.k), 0, lines.length - 1)
      return this.base * (read[k] && !reading[k] ? 0.6 : 1)
    },
    resting(k) {
      return read[k] && !reading[k]
    },
  }

  const writeB = (i) => lines[i].style.setProperty('--b', `${(q[i].p * 100).toFixed(2)}%`)
  lines.forEach((_, i) => writeB(i))
  gsap.set(items, { opacity: 0, pointerEvents: 'none', '--vo-mark': 0.35 })
  gsap.set(cites, { opacity: 0.22 })

  // the reading: time-based, once per line
  function readLine(i) {
    if (read[i] || reading[i]) return
    reading[i] = true
    const dur = i ? 2.2 : 1.5
    gsap.to(q[i], {
      p: 1.32,
      duration: dur,
      ease: 'power1.inOut',
      onUpdate: () => writeB(i),
      onComplete: () => {
        reading[i] = false
        read[i] = true
        // the lamp eases back across the words and settles on them
        gsap.fromTo(rest[i], { p: 1.32 }, { p: i ? 0.56 : 0.5, duration: 3.4, ease: 'power2.inOut' })
      },
    })
    if (i) {
      gsap.to(items[i - 1], { '--vo-mark': 1, duration: 0.7, ease: 'power1.out' })
      gsap.to(cites[i - 1], { opacity: 1, duration: 1, ease: 'power1.out', delay: dur * 0.68 })
    }
  }

  // the heading's beat: it arrives in the middle of the dark and is read
  // there, then rises into a running header as the first guest comes in
  const tt = { y: 0 }
  const applyTitle = () => (title.style.translate = `0 ${tt.y.toFixed(1)}px`)
  const centreY = () => {
    const prev = title.style.translate
    title.style.translate = ''
    const sr = stage.getBoundingClientRect()
    const r = title.getBoundingClientRect()
    title.style.translate = prev
    return Math.max(0, Math.round(sr.height * 0.42 - (r.top - sr.top + r.height / 2)))
  }

  // the heading is read as the stage arrives
  const titleST = ScrollTrigger.create({
    trigger: stage,
    start: 'top 30%',
    onEnter: () => readLine(0),
    onEnterBack: () => readLine(0),
  })
  if (titleST.progress > 0 && titleST.progress < 1) readLine(0)

  // scroll chooses the guest: the heading's beat, then one slice per quote
  const TB = 0.35
  const PER = 1
  const T = (i) => TB + i * PER
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: stage,
      start: 'top top',
      end: () => `+=${Math.round(window.innerHeight * 1.8)}`,
      pin: true,
      scrub: 0.9,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
  })
  items.forEach((item, i) => {
    const t0 = T(i)
    // the lamp dims and swings to the next guest while the quotes trade places
    tl.to(lamp, { base: 0.15, duration: 0.1, ease: 'power2.in' }, t0 - 0.08)
    tl.set(lamp, { k: i + 1 }, t0 + 0.02)
    tl.to(lamp, { base: 1, duration: 0.1, ease: 'power2.out' }, t0 + 0.04)
    if (i === 0) {
      // the heading steps back into a running header
      tl.to(title, { opacity: 0.4, duration: 0.14, ease: 'power1.inOut' }, t0 - 0.08)
    } else {
      tl.to(items[i - 1], { opacity: 0, duration: 0.1, ease: 'power1.in' }, t0 - 0.06)
      tl.set(items[i - 1], { pointerEvents: 'none' }, t0 + 0.04)
    }
    tl.set(item, { pointerEvents: 'auto' }, t0 + 0.04)
    tl.to(item, { opacity: 1, duration: 0.1, ease: 'power1.out' }, t0 + 0.02)
    if (ticks[i]) tl.to(ticks[i], { scaleX: 1, duration: PER - 0.1 }, t0)
  })
  // a short held beat on the third guest before the stage lets go
  tl.to({}, { duration: 0.05 })

  // the heading's rise follows the timeline directly (not a tween, so a
  // refresh never snaps it back to where it started)
  let Y0 = centreY()
  const rise = gsap.parseEase('power2.inOut')
  const placeTitle = () => {
    tt.y = Y0 * (1 - rise(clamp((tl.time() - (TB - 0.26)) / 0.3)))
    applyTitle()
  }
  placeTitle()

  // reaching a guest (either way) starts their reading
  let active = -1
  tl.eventCallback('onUpdate', () => {
    placeTitle()
    const t = tl.time()
    let a = 0
    for (let i = 0; i < items.length; i++) if (t >= T(i) + 0.03) a = i + 1
    if (a === active) return
    active = a
    if (a) readLine(a)
  })

  const onRefresh = () => {
    Y0 = centreY()
    placeTitle()
  }
  ScrollTrigger.addEventListener('refresh', onRefresh)
  // the beam aims at the heading wherever its rise has taken it
  const shift = (i) => (i ? 0 : tt.y)
  const stopCanvas = beam(ctx, { stage, canvas, texts: lines, q, rest, lamp, shift })

  return () => {
    stopCanvas?.()
    titleST.kill()
    ScrollTrigger.removeEventListener('refresh', onRefresh)
    title.style.translate = ''
    gsap.killTweensOf([...q, ...rest, ...items, ...cites])
    root.classList.remove('is-staged')
    lines.forEach((t) => t.style.removeProperty('--b'))
    gsap.set([title, ...items], { clearProps: 'opacity,pointerEvents' })
    gsap.set(items, { clearProps: '--vo-mark' })
    gsap.set(cites, { clearProps: 'opacity' })
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

function beam(ctx, { stage, canvas, texts, q, rest, lamp, shift = () => 0 }) {
  const c2 = canvas.getContext('2d')
  if (!c2) return null
  const dpr = Math.min(ctx.dpr, 1.5)
  const TAN = 0.13 // cone half-angle (tan)
  let W = 0
  let H = 0
  let boxes = []
  // two cones with different shafts, cross-faded so the light seems to move
  // through the water rather than sit in it
  let cones = null
  let cone = null
  let glow = null
  let dot = null
  let glint = null
  let bokeh = null
  let parts = []
  let raf = 0
  let visible = false
  let last = 0
  // smoothed beam target (px) and intensity
  const cur = { x: 0, y: 0, on: 0, ready: false }

  /* ---------------------------------------------------- sprites */
  function makeCone(seed) {
    // vertical cone, apex at top centre: defined edge, shafts, axial falloff
    const w = 320
    const h = 640
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const g = cv.getContext('2d')
    const img = g.createImageData(w, h)
    for (let y = 0; y < h; y++) {
      const u = y / h
      const half = 2.5 + y * TAN
      const ax = Math.pow(1 - u, 1.15) * (0.3 + 0.7 * Math.min(1, y / 46))
      for (let x = 0; x < w; x++) {
        const v = (x - w / 2) / half
        if (Math.abs(v) > 1.9) continue
        // shafts radiate from the apex: noise across the angle, broken up a
        // little along the length so they read as light in moving water
        const shaft =
          0.74 +
          0.3 * n1(v * 7.5 + seed) +
          0.14 * n1(v * 21 + seed * 1.7) -
          0.1 * n1(u * 3.2 + v * 2 + seed) +
          0.08 * n1(u * 9 + v * 5 + seed * 0.3)
        const a = profile(v) * shaft * ax
        const i = (y * w + x) * 4
        img.data[i] = RED[0]
        img.data[i + 1] = RED[1] + 18
        img.data[i + 2] = RED[2] + 12
        img.data[i + 3] = Math.round(clamp(a) * 255)
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
    const n = Math.round(clamp((W * H) / 3200, 160, 460))
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
        // a flat flake turns as it sinks and catches the lamp now and then
        tw: 0.4 + Math.random() * 1.1,
      }
    })
    // a few large out-of-focus particles close to the viewport
    for (let i = 0; i < 11; i++) {
      parts.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: 1.6,
        r: 18 + Math.random() * 34,
        vy: 6 + Math.random() * 6,
        ph: Math.random() * Math.PI * 2,
        sw: 0.3,
        big: true,
      })
    }
  }

  // the backing store and the sprites only exist near the screen
  let near = false
  let allocated = false
  function measure() {
    const r = stage.getBoundingClientRect()
    W = Math.max(1, Math.round(r.width))
    H = Math.max(1, Math.round(r.height))
    boxes = texts.map((t, i) => {
      const b = t.getBoundingClientRect()
      const L = b.width * Math.sin(ANG) + b.height * Math.abs(Math.cos(ANG))
      // stored where the line sits without its scroll-driven shift
      const cy = b.top - r.top + b.height / 2 - shift(i)
      return { cx: b.left - r.left + b.width / 2, cy, w: b.width, h: b.height, L }
    })
    if (!near) return
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    allocated = true
    if (!cones) {
      cones = [makeCone(4.2), makeCone(37.9)]
      cone = cones[0]
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
      // a flake turned square to the lamp: a white-hot point with a red bloom
      glint = radial(48, [
        [0, 'rgba(255,250,246,1)'],
        [0.08, 'rgba(255,214,200,0.95)'],
        [0.24, 'rgba(255,96,72,0.35)'],
        [1, 'rgba(255,59,47,0)'],
      ])
      bokeh = radial(128, [
        [0, 'rgba(255,90,70,0.22)'],
        [0.6, 'rgba(255,59,47,0.10)'],
        [0.8, 'rgba(255,110,90,0.13)'],
        [0.9, 'rgba(255,59,47,0.04)'],
        [1, 'rgba(255,59,47,0)'],
      ])
    }
    seed()
    if (!visible) draw(0)
  }

  function target(t1) {
    const k = clamp(Math.round(lamp.k), 0, boxes.length - 1)
    const b = boxes[k]
    if (!b) return { x: W / 2, y: H / 2 }
    // reading: the beam is on the words; read: it rests on them and drifts a
    // little, the way a lamp on a hovering submersible does
    const still = lamp.resting(k)
    const p = (still ? rest[k].p + 0.05 * Math.sin(t1 * 0.31 + k) : q[k].p) - 0.005
    const dy = still ? Math.sin(t1 * 0.23 + k * 2.1) * b.h * 0.07 : 0
    return { x: b.cx + ((p - 0.5) * b.L) / Math.sin(ANG), y: b.cy + shift(k) + dy }
  }

  /* ------------------------------------------------------- frame */
  function draw(dt) {
    const t1 = performance.now() / 1000
    const t = target(t1)
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

    // volumetric cone (the sprite's half-width grows by TAN per px): the
    // forward scatter around it first, then two sets of shafts trading places
    const s = len / cone.height
    const mix = 0.5 + 0.5 * Math.sin(t1 * 0.37)
    c2.save()
    c2.translate(sx, sy)
    c2.rotate(Math.atan2(ay, ax) - Math.PI / 2)
    c2.globalAlpha = 0.07 * on
    c2.drawImage(cones[1], (-cone.width * s * 2.4) / 2, 0, cone.width * s * 2.4, len)
    c2.globalAlpha = 0.4 * on * (0.35 + 0.65 * mix)
    c2.drawImage(cones[0], (-cone.width * s) / 2, 0, cone.width * s, len)
    c2.globalAlpha = 0.4 * on * (0.35 + 0.65 * (1 - mix))
    c2.drawImage(cones[1], (-cone.width * s) / 2, 0, cone.width * s, len)
    c2.restore()

    // where it meets the words
    const gr = Math.min(W, H) * 0.36
    c2.globalAlpha = 0.42 * on
    c2.drawImage(glow, cur.x - gr, cur.y - gr * 0.8, gr * 2, gr * 1.6)

    // silt: lit inside the cone (bright, a touch larger), a faint glimmer
    // outside; it turns slowly as it sinks, and a flake square to the lamp
    // flashes for a moment
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      p.y += p.vy * dt
      p.x += (Math.sin(t1 * p.sw + p.ph) * 4 + Math.sin(p.y * 0.006 + t1 * 0.13) * 3) * dt
      if (p.y > H + 40) {
        p.y = -40
        p.x = Math.random() * W
      }
      const px = p.x - sx
      const py = p.y - sy
      const u = px * ax + py * ay
      if (u <= 0) continue
      const v = px * ay - py * ax
      const half = 2.5 * s + u * TAN
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
        // the glint: only well inside the beam, and only briefly
        const flash = Math.pow(Math.max(0, Math.sin(t1 * p.tw + p.ph * 3)), 24)
        if (flash > 0.04 && f > 0.35) {
          const gr2 = (3 + p.z * 5) * (0.7 + flash * 0.6)
          c2.globalAlpha = clamp(flash * f * on * 1.1)
          c2.drawImage(glint, p.x - gr2, p.y - gr2, gr2 * 2, gr2 * 2)
        }
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
    if (!allocated) {
      near = true
      measure()
    }
    last = 0
    raf = requestAnimationFrame(loop)
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }
  // far from the screen: hand the backing store back (rebuilt on the way in)
  function release() {
    stop()
    allocated = false
    parts = []
    cur.ready = false
    canvas.width = canvas.height = 0
  }

  const nearIO = new IntersectionObserver(
    ([e]) => {
      near = e.isIntersecting
      if (near && !allocated) measure()
      else if (!near && allocated) release()
    },
    { rootMargin: '150% 0px' },
  )
  nearIO.observe(stage)
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
    release()
    nearIO.disconnect()
    io.disconnect()
    document.removeEventListener('visibilitychange', onVis)
    ctx.ScrollTrigger.removeEventListener('refresh', onRefresh)
  }
}
