/**
 * footer.js — #footer (10,935 m).
 *
 * At the floor the wordmark sits under full pressure (Anybody wdth 50, heavy),
 * like every display line this deep. "Return to the surface" is the bookend of
 * the dive: the wordmark decompresses (wdth 50 → 150, heavy → light) as the
 * sub leaves the floor, a stream of bubbles rises past the depth ruler (lit
 * red in the hadal zone, by bioluminescence higher up, then by sunlight), the
 * page climbs back through every layer while the HUD counts up, and the
 * surface arrives with a short wash of sunlight. Focus then moves to the nav
 * wordmark so the keyboard is where the eyes are. If the visitor takes over
 * the scroll mid-ascent, everything tidies itself away.
 *
 * Reduced motion: a plain jump to the top, then the focus move. Emits nothing.
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
  if (!btn) return

  // the wordmark's pressure: 0 = the floor, 1 = the surface
  const P = { k: 0 }
  const applyWord = () => {
    if (!word) return
    word.style.setProperty('--foot-wdth', `${(50 + 100 * P.k).toFixed(1)}%`)
    word.style.setProperty('--foot-wght', (800 - 520 * P.k).toFixed(0))
    word.style.setProperty('--foot-track', `${(0.012 - 0.03 * P.k).toFixed(4)}em`)
  }

  const bubbles = createBubbles(ctx, canvas)

  let rising = false
  let safety = 0
  const focusTop = () => {
    const top = document.querySelector('.nav__brand') || document.querySelector('#surface h1, h1')
    if (top) {
      if (!top.matches('a, button, [tabindex]')) top.setAttribute('tabindex', '-1')
      top.focus({ preventScroll: true })
    }
  }
  const tidy = () => {
    clearTimeout(safety)
    rising = false
    btn.classList.remove('is-rising')
    html.classList.remove('foot-is-ascending')
    bubbles.stop()
    // back under pressure for the next time the visitor reaches the floor
    gsap.killTweensOf(P)
    P.k = 0
    applyWord()
  }
  const surfaced = () => {
    if (!rising) return
    tidy()
    if (flash) {
      gsap.fromTo(
        flash,
        { opacity: 0 },
        {
          keyframes: [
            { opacity: 1, duration: 0.5, ease: 'power2.out' },
            { opacity: 0, duration: 1.6, ease: 'power1.inOut' },
          ],
        },
      )
    }
    focusTop()
  }

  btn.addEventListener('click', () => {
    if (rising) return
    if (!ctx.lenis) {
      ctx.scrollTo(0)
      window.scrollTo(0, 0)
      focusTop()
      return
    }
    rising = true
    btn.classList.add('is-rising')
    html.classList.add('foot-is-ascending')
    gsap.to(P, { k: 1, duration: 1.5, ease: 'power2.inOut', onUpdate: applyWord })
    bubbles.start()
    gsap.delayedCall(0.3, () => {
      if (!rising) return
      ctx.lenis.scrollTo(0, { duration: 5.4, easing: easeInOut, force: true, onComplete: surfaced })
    })
    // if the visitor takes over the scroll mid-ascent, just tidy up
    safety = setTimeout(tidy, 7600)
  })
  // a wheel or touch during the ascent hands the scroll back to the visitor
  const takeOver = () => {
    if (rising && window.scrollY > 40) tidy()
  }
  window.addEventListener('wheel', takeOver, { passive: true })
  window.addEventListener('touchstart', takeOver, { passive: true })
}

/* --------------------------------------------------------------- bubbles */
// light by depth: the red lamps in the hadal zone, bioluminescence above it,
// sunlight in the last few hundred metres
const RED = [255, 96, 80]
const BIO = [108, 248, 232]
const SUN = [217, 251, 255]
function lightAt(d) {
  const a = smooth(5600, 6400, d) // 1 = red
  const b = smooth(300, 1200, d) // 0 = sunlight
  const c = BIO.map((v, i) => v + (RED[i] - v) * a)
  return c.map((v, i) => Math.round(SUN[i] + (v - SUN[i]) * b))
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
    const r = 1.5 + Math.pow(Math.random(), 2.2) * (ctx.isMobile() ? 6 : 9)
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
    const [r0, g0, b0] = lightAt(ctx.depth?.get().depth ?? 0)
    g.clearRect(0, 0, W, H)
    const t = now / 1000
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i]
      p.y -= p.vy * dt * (0.55 + speed * 0.6)
      const x = p.x + Math.sin(t * 3 + p.ph) * p.sw * 0.3
      if (p.y < -p.r * 2) {
        list.splice(i, 1)
        continue
      }
      g.globalAlpha = 0.75
      g.strokeStyle = `rgb(${r0} ${g0} ${b0})`
      g.lineWidth = p.r > 4 ? 1.2 : 0.9
      g.beginPath()
      g.ellipse(x, p.y, p.r, p.r * 0.92, 0, 0, 6.2832)
      g.stroke()
      g.globalAlpha = 0.85
      g.fillStyle = '#fff'
      g.beginPath()
      g.arc(x - p.r * 0.35, p.y - p.r * 0.38, Math.max(0.6, p.r * 0.18), 0, 6.2832)
      g.fill()
    }
    g.globalAlpha = 1
    if ((on || list.length) && !document.hidden) raf = requestAnimationFrame(frame)
  }
  window.addEventListener('resize', () => on && size())
  return {
    start() {
      if (ctx.reducedMotion) return
      size()
      on = true
      canvas.classList.add('is-on')
      last = 0
      if (!raf) raf = requestAnimationFrame(frame)
    },
    stop() {
      on = false
      // the last bubbles finish rising, then the canvas rests
      setTimeout(() => {
        if (on) return
        canvas.classList.remove('is-on')
        list.length = 0
      }, 1600)
    },
  }
}
