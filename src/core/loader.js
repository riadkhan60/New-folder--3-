/**
 * core/loader — the one orchestrated intro.
 *
 *  0.0 s  a single plankton cell glows in the dark (the tittle of the i)
 *  0.2 s  the wordmark gathers around it; pre-dive checks tick through,
 *         a precise countdown runs to the release
 *  2.0 s  "Released from MV Lantern" — a small jolt
 *  2.1 s  the water floods in from below (a wavy, glowing waterline that
 *         unclips the black panel and reveals the hero); the wordmark is
 *         squeezed by the pressure (Anybody wdth 150 → 112, wght 200 → 520)
 *  2.9 s  hand-over: init() resolves, main.js marks the page ready
 *  3.0 s  the wordmark flies into the nav and becomes the nav brand
 *
 * Any click, key press, wheel or touch fast-forwards. Emits `intro:landed` on the bus when
 * the wordmark reaches the nav (nav.js reveals its own brand then).
 */
import '../styles/loader.css'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))

const T = {
  chars: 0.22,
  chrome: 0.3,
  check0: 0.5,
  checkStep: 0.3,
  release: 2.0,
  flood: 2.1,
  floodDur: 1.2,
  handover: 3.0,
  fly: 2.68, // the wordmark rides the flood up as the waterline reaches it
}

export async function init(ctx, { fontsReady } = {}) {
  const root = document.querySelector('.loader')
  // Fonts set the wordmark. Ask for the two faces straight away, but never
  // hold the dark for long on a slow font CDN: a soft bloom (CSS) breathes
  // while we wait, and the intro starts after 1.2 s at the latest.
  const faces = document.fonts?.load
    ? Promise.all([
        document.fonts.load('200 1em Anybody'),
        document.fonts.load('italic 400 1em Newsreader'),
      ]).catch(() => {})
    : Promise.resolve()
  await Promise.race([Promise.all([fontsReady ?? Promise.resolve(), faces]), wait(1200)])
  if (!root) return

  const { gsap } = ctx
  const q = (s) => root.querySelector(s)
  const qa = (s) => [...root.querySelectorAll(s)]

  const panel = q('.loader__panel')
  const top = q('.loader__top')
  const chars = qa('.loader__ch')
  const word = q('.loader__word')
  const mark = q('.loader__mark')
  const tittle = q('.loader__tittle')
  const checks = qa('.loader__check')
  const countWrap = q('.loader__count')
  const countVal = q('.loader__count-val')
  const countLabel = q('.loader__count-label span')
  const progress = q('.loader__progress span')
  const bottom = q('.loader__bottom')
  const water = createWater(q('.loader__water'), panel, Math.min(ctx.dpr, 1.5))

  let resolveHandOver
  const handedOver = new Promise((r) => (resolveHandOver = r))

  /* ------------------------------------------------------ initial state */
  gsap.set(chars, { opacity: 0, filter: 'blur(10px)' })
  gsap.set(tittle, { scale: 0, opacity: 0 })
  gsap.set([top, countWrap, progress.parentElement], { opacity: 0 })
  checks.forEach((li) => {
    gsap.set(li.querySelector('.loader__label'), { clipPath: 'inset(0 100% 0 0)' })
    gsap.set(li.querySelector('.loader__leader'), { scaleX: 0 })
    gsap.set(li.querySelector('.loader__value'), { opacity: 0 })
    gsap.set(li.querySelector('.loader__tick path'), { drawSVG: '0%' })
    gsap.set(li.querySelector('.loader__tick'), { opacity: 0, scale: 0.6 })
  })
  const pre = parseFloat(getComputedStyle(panel, '::before').opacity) || 0
  root.classList.add('is-running')

  /* --------------------------------------------------------- timeline */
  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

  // 1. one cell of light in the dark (the bloom picks up from wherever the
  //    CSS pre-glow had got to while the fonts loaded)
  tl.to(tittle, { scale: 1, opacity: 1, duration: 0.9, ease: 'expo.out' }, 0)
  tl.fromTo(root, { '--loader-bloom': pre }, { '--loader-bloom': 1, duration: 1.4, ease: 'power2.out' }, 0)

  // 2. the wordmark gathers outward from the i
  tl.to(
    chars,
    {
      opacity: 1,
      filter: 'blur(0px)',
      duration: 1.0,
      ease: 'power2.out',
      stagger: { each: 0.05, from: 4 },
    },
    T.chars,
  )

  // 3. chrome
  tl.to([top, countWrap, progress.parentElement], { opacity: 1, duration: 0.8, ease: 'power2.out' }, T.chrome)

  // 4. the checks
  const tick = (li, at) => {
    tl.to(li.querySelector('.loader__tick'), { opacity: 1, scale: 1, duration: 0.4, ease: 'expo.out' }, at - 0.04)
    tl.to(li.querySelector('.loader__label'), { clipPath: 'inset(0 0% 0 0)', duration: 0.42, ease: 'power2.out' }, at)
    tl.to(li.querySelector('.loader__leader'), { scaleX: 1, duration: 0.5, ease: 'power2.inOut' }, at + 0.06)
    tl.to(li.querySelector('.loader__value'), { opacity: 1, duration: 0.3, ease: 'none' }, at + 0.26)
    tl.call(() => li.classList.add('is-done'), null, at + 0.26)
    tl.to(li.querySelector('.loader__tick path'), { drawSVG: '100%', duration: 0.34, ease: 'power2.out' }, at + 0.28)
  }
  checks.slice(0, -1).forEach((li, i) => tick(li, T.check0 + i * T.checkStep))
  tick(checks[checks.length - 1], T.release - 0.26)

  // 5. the countdown is the timeline itself: it reads exactly the time left
  const clock = { t: 0 }
  tl.to(
    clock,
    {
      t: T.release,
      duration: T.release,
      ease: 'none',
      onUpdate() {
        countVal.textContent = Math.max(0, T.release - clock.t).toFixed(2)
        progress.style.transform = `scaleX(${clamp(clock.t / T.release)})`
      },
    },
    0,
  )

  // 6. release: the label flips like a mechanical counter, "Release in"
  //    up and out, "Released" up from below
  tl.addLabel('release', T.release)
  tl.call(() => (countVal.textContent = '0.00'), null, 'release')
  tl.to(countLabel, { yPercent: -110, duration: 0.18, ease: 'power2.in' }, 'release')
  tl.call(() => (countLabel.textContent = 'Released'), null, 'release+=0.18')
  tl.fromTo(
    countLabel,
    { yPercent: 110 },
    { yPercent: 0, duration: 0.55, ease: 'expo.out', immediateRender: false },
    'release+=0.18',
  )
  tl.to(bottom, { y: 5, duration: 0.07, ease: 'power1.in' }, 'release')
  tl.to(bottom, { y: 0, duration: 0.9, ease: 'expo.out' }, 'release+=0.07')
  tl.to(tittle, { scale: 1.35, duration: 0.18, ease: 'power2.out', yoyo: true, repeat: 1 }, 'release')

  // 7. the flood
  tl.call(() => root.classList.add('is-exiting'), null, T.flood)
  const flood = { level: 0 }
  tl.to(
    flood,
    {
      level: 1,
      duration: T.floodDur,
      ease: 'power2.inOut',
      onStart: () => water.start(),
      onUpdate: () => water.set(flood.level),
      onComplete: () => water.finish(),
    },
    T.flood,
  )
  // pressure arrives as the waterline crosses the wordmark
  tl.to(word, { '--lw': 112, '--lg': 520, '--ls': -0.012, duration: 0.6, ease: 'power2.inOut' }, T.flood + 0.02)
  tl.to(root, { '--loader-bloom': 0, duration: 0.6, ease: 'power1.out' }, T.flood)

  // 8. hand over to the page
  tl.call(() => resolveHandOver(), null, T.handover)

  // 9. the wordmark becomes the nav brand
  tl.call(() => flyToNav(), null, T.fly)

  if (import.meta.env?.DEV) window.__noctilucaLoader = tl // QA: seek the intro

  /* --------------------------------------------------- fast-forward */
  tl.call(() => { if (tl.timeScale() > 1.6) tl.timeScale(1.5) }, null, 'release')
  // a click, a key, or simply trying to scroll: the visitor wants in
  const FF = ['pointerdown', 'keydown', 'wheel', 'touchstart']
  const fastForward = (e) => {
    if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
    const ts = tl.time() < T.release ? 6 : 2.2
    if (tl.timeScale() < ts) tl.timeScale(ts)
  }
  FF.forEach((t) => window.addEventListener(t, fastForward, { passive: true }))

  /* --------------------------------------------------------- the flight */
  let flown = false
  function flyToNav() {
    if (flown) return
    flown = true
    FF.forEach((t) => window.removeEventListener(t, fastForward, { passive: true }))

    const target = document.querySelector('.nav__word')
    const b = target?.getBoundingClientRect()
    const visible = b && b.width > 0 && b.bottom > 0 && getComputedStyle(target).display !== 'none'
    if (!visible) {
      gsap.to(mark, { opacity: 0, scale: 0.92, duration: 0.8, ease: 'power2.out', onComplete: finish })
      return
    }
    const a = word.getBoundingClientRect()
    const s = b.width / a.width
    const dx = b.left + b.width / 2 - (a.left + a.width / 2)
    const dy = b.top + b.height / 2 - (a.top + a.height / 2)
    gsap.to(word, {
      x: dx,
      y: dy,
      scale: s,
      duration: 1.0 / Math.max(1, tl.timeScale() * 0.6),
      ease: 'power3.inOut',
      onComplete() {
        ctx.emit('intro:landed', {})
        gsap.to(word, { opacity: 0, duration: 0.25, ease: 'none', onComplete: finish })
      },
    })
  }

  function finish() {
    water.destroy()
    root.classList.add('is-done')
    root.classList.remove('is-exiting', 'is-running')
    tl.kill()
    // leave nothing behind in the a11y tree or the compositor
    requestAnimationFrame(() => root.remove())
  }

  await handedOver
}

/* ==========================================================================
   The waterline. Draws a glowing meniscus and trailing bubbles on a canvas,
   and clips the black panel to the region above the wave so the real page
   (the hero, already at the surface) shows through below it.
   ========================================================================== */
function createWater(canvas, panel, dpr) {
  const g = canvas.getContext('2d')
  let W = 0
  let H = 0
  let level = 0
  let raf = 0
  let running = false
  let t0 = 0
  const N = 40

  const bubbles = Array.from({ length: 72 }, () => ({
    x: Math.random(),
    y: 0,
    r: 0.6 + Math.random() ** 2 * 3.4,
    vy: 0.55 + Math.random() * 0.4, // fraction of the screen per second
    wob: Math.random() * Math.PI * 2,
    delay: Math.random() * 0.5,
  }))

  function resize() {
    W = window.innerWidth
    H = window.innerHeight
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function wave(x, base, amp, t) {
    return (
      base +
      amp *
        (Math.sin(x * 0.0058 + t * 2.3) * 0.55 +
          Math.sin(x * 0.0131 - t * 3.1 + 1.3) * 0.3 +
          Math.sin(x * 0.029 + t * 5.4 + 0.4) * 0.15) +
      // the flood comes in at a slight tilt, like water rushing from one side
      (x / W - 0.5) * amp * 0.9
    )
  }

  function frame(now) {
    const t = (now - t0) / 1000
    const amp = 5 + 24 * Math.sin(Math.PI * clamp(level))
    const base = H + amp * 1.6 - (H + amp * 3.2) * level
    const ys = new Float32Array(N + 1)
    for (let i = 0; i <= N; i++) ys[i] = wave((W * i) / N, base, amp, t)

    // 1. clip the black panel to the air above the waterline
    let poly = `0px -2px, ${W}px -2px`
    for (let i = N; i >= 0; i--) poly += `, ${((W * i) / N).toFixed(1)}px ${ys[i].toFixed(1)}px`
    panel.style.clipPath = `polygon(${poly})`

    // 2. the water body just under the line: light caught in the surface
    g.clearRect(0, 0, W, H)
    const traceWave = () => {
      g.beginPath()
      g.moveTo(0, ys[0])
      for (let i = 1; i <= N; i++) {
        const x0 = (W * (i - 1)) / N
        const x1 = (W * i) / N
        const xm = (x0 + x1) / 2
        g.quadraticCurveTo(x0, ys[i - 1], xm, (ys[i - 1] + ys[i]) / 2)
      }
      g.lineTo(W, ys[N])
    }
    traceWave()
    g.lineTo(W, H)
    g.lineTo(0, H)
    g.closePath()
    const grad = g.createLinearGradient(0, base - amp, 0, base + Math.max(180, H * 0.32))
    grad.addColorStop(0, 'rgba(217,251,255,0.34)')
    grad.addColorStop(0.06, 'rgba(108,248,232,0.16)')
    grad.addColorStop(0.4, 'rgba(14,111,134,0.10)')
    grad.addColorStop(1, 'rgba(14,111,134,0)')
    g.fillStyle = grad
    g.fill()

    // 3. bubbles rising behind the front (only drawn under water)
    const ft = t
    g.fillStyle = 'rgba(217,251,255,0.08)'
    g.strokeStyle = 'rgba(217,251,255,0.8)'
    g.lineWidth = 0.8
    for (const b of bubbles) {
      const life = ft - b.delay
      if (life <= 0) continue
      const y = H + 20 - life * b.vy * H
      const x = b.x * W + Math.sin(life * 5 + b.wob) * 6
      const i = Math.round((x / W) * N)
      const surfaceY = ys[clamp(i, 0, N)]
      if (y < surfaceY + 6 || y > H + 10) continue
      const a = clamp((y - surfaceY) / 80) * 0.9
      g.globalAlpha = a
      g.beginPath()
      g.arc(x, y, b.r, 0, Math.PI * 2)
      g.fill()
      g.stroke()
    }
    g.globalAlpha = 1

    // 4. the meniscus: a hairline of light with a soft glow under it
    traceWave()
    g.save()
    g.shadowColor = 'rgba(108,248,232,0.9)'
    g.shadowBlur = 18
    g.strokeStyle = 'rgba(217,251,255,0.95)'
    g.lineWidth = 1.4
    g.stroke()
    g.restore()
    traceWave()
    g.strokeStyle = 'rgba(108,248,232,0.22)'
    g.lineWidth = 7
    g.stroke()

    if (running) raf = requestAnimationFrame(frame)
  }

  const onResize = () => resize()

  return {
    start() {
      if (running) return
      resize()
      window.addEventListener('resize', onResize)
      running = true
      t0 = performance.now()
      raf = requestAnimationFrame(frame)
    },
    set(v) {
      level = v
    },
    finish() {
      level = 1
      running = false
      cancelAnimationFrame(raf)
      g.clearRect(0, 0, W, H)
      panel.style.clipPath = 'polygon(0 0, 100% 0, 100% 0, 0 0)'
    },
    destroy() {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    },
  }
}
