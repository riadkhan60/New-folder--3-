/**
 * footer.js — #footer (10,935 m).
 *
 * At the floor the wordmark sits under full pressure (Anybody wdth 50, heavy),
 * like every display line this deep. "Return to the surface" is the bookend of
 * the dive (its tittle is the sub's lamp, and the letters beside it catch its
 * light): the page's content dissolves behind a veil of water (only colour,
 * light and the counting HUD stay sharp), the wordmark decompresses (wdth
 * 50 → 150, heavy → light) as the sub leaves the floor, a stream of bubbles
 * rises past the depth ruler (glassy, lit red in the hadal zone, by
 * bioluminescence higher up, then by sunlight, which comes back first as
 * shafts from above over the last 1,500 m) while the page climbs back through every
 * layer, and the surface arrives with a wash of sunlight and one line. Focus
 * then moves to the nav wordmark so the keyboard is where the eyes are. If the
 * visitor takes over the scroll mid-ascent, everything tidies itself away.
 *
 * Reduced motion: a plain jump to the top, the line over the still veil, then
 * the focus move.
 * The bubble canvas only holds a backing store during the ascent. Emits nothing.
 */
import '../styles/footer.css'

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export function init(ctx) {
  const root = document.getElementById('footer')
  if (!root) return
  const { gsap } = ctx
  const html = document.documentElement
  const btn = root.querySelector('[data-foot-return]')
  const word = root.querySelector('.foot__word-type')
  const canvas = root.querySelector('[data-foot-bubbles]')
  const flash = root.querySelector('[data-foot-surfaced]')
  const veil = root.querySelector('[data-foot-veil]')
  const line = root.querySelector('[data-foot-surfaced-line]')
  if (!btn) return
  const LINE = 'Back at the surface, with 10,935\u00a0m of water under you.'

  // the ascent's layers sit at the top level of the page, above all of its
  // content: inside the footer, the veil's backdrop filter and the sunlight's
  // screen blend could only see the footer itself
  ;[veil, canvas, flash, line].forEach((el) => el && document.body.appendChild(el))

  // the wordmark's pressure: 0 = the floor, 1 = the surface
  const P = { k: 0 }
  const applyWord = () => {
    if (!word) return
    word.style.setProperty('--foot-wdth', `${(50 + 100 * P.k).toFixed(1)}%`)
    word.style.setProperty('--foot-wght', (800 - 520 * P.k).toFixed(0))
    word.style.setProperty('--foot-track', `${(0.012 - 0.03 * P.k).toFixed(4)}em`)
  }

  const bubbles = createBubbles(ctx, canvas)

  // where the lamp (the i's tittle) is: the letters beside it and the water
  // around it take their light from there
  const tittle = root.querySelector('.foot__tittle')
  const brand = root.querySelector('.foot__brand')
  const placeLamp = () => {
    if (!word || !tittle || !brand) return
    const w = word.getBoundingClientRect()
    const t = tittle.getBoundingClientRect()
    const b = brand.getBoundingClientRect()
    if (!w.width) return
    const x = t.left + t.width / 2
    const y = t.top + t.height / 2
    word.style.setProperty('--foot-lx', `${(x - w.left).toFixed(1)}px`)
    word.style.setProperty('--foot-ly', `${(y - w.top).toFixed(1)}px`)
    brand.style.setProperty('--foot-px', `${(x - b.left).toFixed(1)}px`)
    brand.style.setProperty('--foot-py', `${(y - b.top).toFixed(1)}px`)
  }
  // measured on every refresh (hand-over, fonts, resize), never during init
  ctx.ScrollTrigger.addEventListener('refresh', placeLamp)

  let rising = false
  let safety = 0
  const focusTop = () => {
    const top = document.querySelector('.nav__brand') || document.querySelector('#surface h1, h1')
    if (top) {
      if (!top.matches('a, button, [tabindex]')) top.setAttribute('tabindex', '-1')
      top.focus({ preventScroll: true })
    }
  }
  // the veil: the content behind it dissolves into water and light
  const veilTo = (on, duration = on ? 0.45 : 0.8) => {
    if (!veil) return
    gsap.killTweensOf(veil)
    gsap.to(veil, on
      ? { autoAlpha: 1, duration, ease: 'power2.out' }
      : { autoAlpha: 0, duration, ease: 'power2.inOut' })
  }
  // one line at the surface, also announced (the line is a status region)
  let lineT = 0
  const showLine = (delay) => {
    if (!line) return
    clearTimeout(lineT)
    gsap.killTweensOf(line)
    line.textContent = LINE
    gsap.fromTo(line, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.7, ease: 'power2.out', delay })
  }
  const hideLine = (duration = 0.9) => {
    if (!line) return
    gsap.killTweensOf(line)
    gsap.to(line, {
      autoAlpha: 0,
      duration,
      ease: 'power1.inOut',
      onComplete: () => (lineT = setTimeout(() => (line.textContent = ''), 400)),
    })
  }

  // at the surface the page stays dissolved for a moment, under the light and
  // the line, then resolves; any scroll, wheel, touch or key resolves it at once
  let settling = false
  let settleCall = null
  const settle = (fast = false) => {
    if (!settling) return
    settling = false
    settleCall?.kill()
    veilTo(false, fast ? 0.35 : 1.1)
    hideLine(fast ? 0.3 : 0.9)
  }

  const tidy = (keepVeil = false) => {
    clearTimeout(safety)
    rising = false
    btn.classList.remove('is-rising')
    html.classList.remove('foot-is-ascending')
    bubbles.stop()
    if (!keepVeil) veilTo(false)
    // back under pressure for the next time the visitor reaches the floor
    gsap.killTweensOf(P)
    P.k = 0
    applyWord()
    placeLamp()
  }
  const surfaced = () => {
    if (!rising) return
    tidy(true)
    if (flash) {
      gsap.killTweensOf(flash)
      gsap.fromTo(
        flash,
        { opacity: 0 },
        {
          keyframes: [
            { opacity: 1, duration: 0.35, ease: 'power3.out' },
            { opacity: 0, duration: 2.4, ease: 'power1.inOut' },
          ],
        },
      )
    }
    showLine(0.3)
    settling = true
    settleCall = gsap.delayedCall(2.4, () => settle())
    focusTop()
  }

  btn.addEventListener('click', () => {
    if (rising) return
    if (!ctx.lenis) {
      // reduced motion: a plain jump, then the same still moment at the top
      ctx.scrollTo(0)
      window.scrollTo(0, 0)
      if (veil) gsap.set(veil, { autoAlpha: 1 })
      showLine(0.05)
      settling = true
      settleCall?.kill()
      settleCall = gsap.delayedCall(2.8, () => settle())
      focusTop()
      return
    }
    settle(true)
    rising = true
    btn.classList.add('is-rising')
    html.classList.add('foot-is-ascending')
    veilTo(true)
    gsap.to(P, { k: 1, duration: 1.5, ease: 'power2.inOut', onUpdate: applyWord })
    bubbles.start()
    gsap.delayedCall(0.3, () => {
      if (!rising) return
      ctx.lenis.scrollTo(0, { duration: 5.4, easing: easeInOut, force: true, onComplete: surfaced })
    })
    // if the visitor takes over the scroll mid-ascent, just tidy up
    safety = setTimeout(tidy, 7600)
  })
  // a wheel or touch during the ascent hands the scroll back to the visitor;
  // after it, any input resolves the page at once
  const takeOver = () => {
    if (rising && window.scrollY > 40) tidy()
    else settle(true)
  }
  window.addEventListener('wheel', takeOver, { passive: true })
  window.addEventListener('touchstart', takeOver, { passive: true })
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Shift' && e.key !== 'Tab') settle(true)
  })
}

/* --------------------------------------------------------------- bubbles */
// light by depth: the red lamps in the hadal zone, bioluminescence above it,
// sunlight in the last few hundred metres. As weights, so each light can have
// its own pre-drawn bubble
const RED = [255, 96, 80]
const BIO = [108, 248, 232]
const SUN = [217, 251, 255]
function lightWeights(d) {
  const a = smooth(5600, 6400, d) // 1 = red
  const b = smooth(300, 1200, d) // 0 = sunlight
  return [b * a, b * (1 - a), 1 - b] // red, bio, sun
}

// a bubble is a lens: nearly clear in the middle, a bright rim where the light
// skims its surface, a window of the light above caught at the top, and a
// faint second reflection low on the far side
function bubbleSprite([r, g, b]) {
  const S = 64
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const c = cv.getContext('2d')
  const R = S / 2 - 1
  const body = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, R)
  body.addColorStop(0, `rgba(${r},${g},${b},0.03)`)
  body.addColorStop(0.62, `rgba(${r},${g},${b},0.07)`)
  body.addColorStop(0.84, `rgba(${r},${g},${b},0.3)`)
  body.addColorStop(0.95, `rgba(${Math.min(255, r + 50)},${Math.min(255, g + 50)},${Math.min(255, b + 50)},0.95)`)
  body.addColorStop(1, `rgba(${r},${g},${b},0)`)
  c.fillStyle = body
  c.beginPath()
  c.arc(S / 2, S / 2, R, 0, Math.PI * 2)
  c.fill()
  // the window of light above, caught on the upper surface
  c.save()
  c.translate(S / 2 - R * 0.3, S / 2 - R * 0.42)
  c.rotate(-0.55)
  const hl = c.createRadialGradient(0, 0, 0, 0, 0, R * 0.36)
  hl.addColorStop(0, 'rgba(255,255,255,0.95)')
  hl.addColorStop(0.45, 'rgba(255,255,255,0.5)')
  hl.addColorStop(1, 'rgba(255,255,255,0)')
  c.scale(1, 0.62)
  c.fillStyle = hl
  c.beginPath()
  c.arc(0, 0, R * 0.36, 0, Math.PI * 2)
  c.fill()
  c.restore()
  // the faint return off the far side
  c.strokeStyle = `rgba(${Math.min(255, r + 30)},${Math.min(255, g + 30)},${Math.min(255, b + 30)},0.4)`
  c.lineWidth = S * 0.035
  c.lineCap = 'round'
  c.beginPath()
  c.arc(S / 2, S / 2, R * 0.72, 0.35, 1.25)
  c.stroke()
  return cv
}

// one soft shaft of sunlight, brightest where it enters at the top
function shaftSprite() {
  const w = 64
  const h = 512
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const c = cv.getContext('2d')
  const img = c.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    const v = Math.pow(1 - y / h, 1.6) * Math.min(1, y / 18 + 0.35)
    for (let x = 0; x < w; x++) {
      const u = (x - w / 2) / (w / 2)
      const a = Math.exp(-u * u * 3.2) * v
      const i = (y * w + x) * 4
      img.data[i] = SUN[0]
      img.data[i + 1] = SUN[1]
      img.data[i + 2] = SUN[2]
      img.data[i + 3] = Math.round(a * 255)
    }
  }
  c.putImageData(img, 0, 0)
  return cv
}

function createBubbles(ctx, canvas) {
  const g = canvas?.getContext('2d')
  if (!g) return { start() {}, stop() {} }
  let W = 0
  let H = 0
  let raf = 0
  let on = false
  let last = 0
  let acc = 0
  const list = []
  let sprites = null
  let shaft = null
  // the shafts of returning sunlight, fanned from a point above the screen
  const SHAFTS = Array.from({ length: 7 }, (_, i) => ({
    x: (i + 0.5) / 7 + (Math.random() - 0.5) * 0.08,
    w: 0.05 + Math.random() * 0.07,
    ph: Math.random() * 6.28,
    sp: 0.4 + Math.random() * 0.5,
  }))

  const size = () => {
    W = window.innerWidth
    H = window.innerHeight
    const dpr = Math.min(ctx.dpr, 1.5)
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  const spawn = () => {
    // most of the stream rises past the depth ruler, the rest anywhere
    const edge = Math.random() < 0.6
    const x = edge ? W * (0.78 + 0.22 * Math.random()) : W * Math.random()
    const r = 1.5 + Math.pow(Math.random(), 2.2) * (ctx.isMobile() ? 6 : 10)
    list.push({
      x,
      y: H + r + Math.random() * 40,
      r,
      vy: 260 + r * 55 + Math.random() * 240,
      ph: Math.random() * 6.28,
      sw: 6 + Math.random() * 14,
    })
  }
  function frame(now) {
    raf = 0
    const dt = Math.min(0.05, (now - (last || now)) / 1000)
    last = now
    const speed = clamp(Math.abs(ctx.lenis?.velocity ?? 0) / 55, 0.35, 1.8)
    if (on) {
      acc += dt * (ctx.isMobile() ? 34 : 60) * (0.6 + speed * 0.5)
      while (acc > 1 && list.length < 220) {
        spawn()
        acc -= 1
      }
    }
    const depth = ctx.depth?.get().depth ?? 0
    const wts = lightWeights(depth)
    g.clearRect(0, 0, W, H)
    const t = now / 1000

    // the sun comes back first as light from above: shafts that strengthen
    // over the last 1,500 m and sway with the surface
    const sun = (1 - smooth(150, 1500, depth)) * (on ? 1 : 0.85)
    if (sun > 0.01) {
      g.globalCompositeOperation = 'lighter'
      const ox = W * 0.5
      const oy = -H * 0.5
      for (const sh of SHAFTS) {
        const x = W * sh.x + Math.sin(t * sh.sp + sh.ph) * W * 0.015
        const ang = Math.atan2(x - ox, -oy) * 0.9
        const len = H * 1.35
        const wd = W * sh.w * (1 + 0.25 * Math.sin(t * sh.sp * 1.3 + sh.ph))
        g.save()
        g.translate(x, 0)
        g.rotate(-ang)
        g.globalAlpha = sun * (0.1 + 0.08 * Math.sin(t * sh.sp * 0.8 + sh.ph * 2))
        g.drawImage(shaft, -wd / 2, -H * 0.05, wd, len)
        g.restore()
      }
      g.globalCompositeOperation = 'source-over'
    }

    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i]
      p.y -= p.vy * dt * (0.55 + speed * 0.6)
      if (p.y < -p.r * 2) {
        list.splice(i, 1)
        continue
      }
      const x = p.x + Math.sin(t * 3 + p.ph) * p.sw * 0.3
      // larger bubbles wobble as they rise
      const wob = p.r > 4 ? Math.sin(t * 9 + p.ph) * 0.07 : 0
      const rw = p.r * (1 + wob)
      const rh = p.r * (0.94 - wob)
      for (let k = 0; k < 3; k++) {
        if (wts[k] < 0.02) continue
        g.globalAlpha = wts[k] * 0.95
        g.drawImage(sprites[k], x - rw, p.y - rh, rw * 2, rh * 2)
      }
    }
    g.globalAlpha = 1
    if ((on || list.length) && !document.hidden) raf = requestAnimationFrame(frame)
  }
  window.addEventListener('resize', () => on && size())
  return {
    start() {
      if (ctx.reducedMotion) return
      if (!sprites) {
        sprites = [bubbleSprite(RED), bubbleSprite(BIO), bubbleSprite(SUN)]
        shaft = shaftSprite()
      }
      size()
      on = true
      canvas.classList.add('is-on')
      last = 0
      if (!raf) raf = requestAnimationFrame(frame)
    },
    stop() {
      on = false
      // the last bubbles finish rising, then the canvas rests and hands its
      // backing store back
      setTimeout(() => {
        if (on) return
        canvas.classList.remove('is-on')
        list.length = 0
        setTimeout(() => {
          if (on) return
          if (raf) cancelAnimationFrame(raf)
          raf = 0
          canvas.width = canvas.height = 0
        }, 900)
      }, 1600)
    },
  }
}
