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
 *  2.6 s  the waterline swallows the name: below the line it is seen
 *         through the water (a drifting refraction, a cooler light, and the
 *         caustic net the moving surface throws across the letters) and the
 *         letters let go of a breath of bubbles. Under the line, light shafts
 *         lean down into the water and glints ride the meniscus
 *  2.8 s  the wordmark rises through the water into the nav and becomes
 *         the nav brand, the refraction settling as it arrives
 *  3.0 s  hand-over: init() resolves, main.js marks the page ready
 *
 * The page's modules initialise while this plays. The release waits for
 * `pageReady` (every module's init() done): if the page is not ready at
 * T − 0.3 s the countdown holds, like a launch hold, and resumes when it is.
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
  fly: 2.8, // once the water has closed over it, the wordmark rises into the nav
  hold: 1.7, // last moment to wait for the page before the release
}

export async function init(ctx, { fontsReady, pageReady } = {}) {
  let pageIsReady = !pageReady
  pageReady?.then(() => (pageIsReady = true))
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
  const track = progress.parentElement
  const bottom = q('.loader__bottom')

  // The name seen through the water: a second copy, clipped to the region
  // below the waterline (the dry one keeps the region above it).
  const wetMark = mark.cloneNode(true)
  wetMark.classList.add('loader__mark--wet')
  mark.after(wetMark)
  const wetWord = wetMark.querySelector('.loader__word')
  const words = [word, wetWord]
  const allChars = [...chars, ...wetMark.querySelectorAll('.loader__ch')]
  const tittles = [tittle, wetMark.querySelector('.loader__tittle')]
  const refract = createRefraction(gsap, root.querySelector('#loader-refract'))

  const water = createWater(q('.loader__water'), panel, Math.min(ctx.dpr, 1.5), { dry: mark, wet: wetMark })

  let resolveHandOver
  const handedOver = new Promise((r) => (resolveHandOver = r))

  /* ------------------------------------------------------ initial state */
  gsap.set(allChars, { opacity: 0, filter: 'blur(10px)' })
  gsap.set(tittles, { scale: 0, opacity: 0 })
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
  tl.to(tittles, { scale: 1, opacity: 1, duration: 0.9, ease: 'expo.out' }, 0)
  tl.fromTo(root, { '--loader-bloom': pre }, { '--loader-bloom': 1, duration: 1.4, ease: 'power2.out' }, 0)

  // 2. the wordmark gathers outward from the i
  tl.to(
    allChars,
    {
      opacity: 1,
      filter: 'blur(0px)',
      duration: 1.0,
      ease: 'power2.out',
      // each copy gathers outward from its own i
      stagger: (i) => Math.abs((i % chars.length) - 4) * 0.05,
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

  // 4b. a hold: the release never happens before the page behind it is
  //     ready (modules initialise while the intro plays)
  let holdT = 0
  tl.call(
    () => {
      if (pageIsReady) return
      tl.pause()
      // only say so if the hold is long enough to notice
      holdT = setTimeout(() => {
        gsap.to(countLabel, { opacity: 0, duration: 0.2, onComplete: () => {
          countLabel.textContent = 'Holding'
          gsap.to(countLabel, { opacity: 1, duration: 0.4 })
        } })
      }, 400)
      pageReady.then(() => {
        clearTimeout(holdT)
        if (countLabel.textContent !== 'Release in') {
          gsap.killTweensOf(countLabel, 'opacity')
          gsap.set(countLabel, { opacity: 1 })
          countLabel.textContent = 'Release in'
        }
        tl.play()
      })
    },
    null,
    T.hold,
  )

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
        const p = clamp(clock.t / T.release)
        progress.style.transform = `scaleX(${p})`
        // a bead of light rides the tip of the line
        track.style.setProperty('--p', p.toFixed(4))
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
  tl.to(tittles, { scale: 1.35, duration: 0.18, ease: 'power2.out', yoyo: true, repeat: 1 }, 'release')

  // 7. the flood
  tl.call(() => root.classList.add('is-exiting'), null, T.flood)
  const flood = { level: 0 }
  tl.to(
    flood,
    {
      level: 1,
      duration: T.floodDur,
      ease: 'power2.inOut',
      onStart: () => {
        water.start(word.getBoundingClientRect())
        refract.start()
      },
      onUpdate: () => water.set(flood.level),
      onComplete: () => water.finish(),
    },
    T.flood,
  )
  // pressure arrives as the waterline crosses the wordmark
  tl.to(words, { '--lw': 112, '--lg': 520, '--ls': -0.012, duration: 0.6, ease: 'power2.inOut' }, T.flood + 0.02)
  // the refraction swells in as the line reaches the name, and the caustic
  // net lights across the letters
  tl.to(refract, { scale: 15, duration: 0.5, ease: 'power2.out' }, T.flood + 0.45)
  tl.to(refract, { caustic: 1, duration: 0.7, ease: 'power2.out' }, T.flood + 0.4)
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
      gsap.to([mark, wetMark], { opacity: 0, scale: 0.92, duration: 0.8, ease: 'power2.out', onComplete: finish })
      return
    }
    const a = word.getBoundingClientRect()
    const s = b.width / a.width
    const dx = b.left + b.width / 2 - (a.left + a.width / 2)
    const dy = b.top + b.height / 2 - (a.top + a.height / 2)
    const dur = 1.0 / Math.max(1, tl.timeScale() * 0.6)
    // the water calms around it on the way up, so it lands crisp: the
    // caustics fade and the cool underwater tint clears to the nav's ink
    gsap.to(refract, { scale: 0, duration: dur * 0.85, ease: 'power2.inOut', delay: dur * 0.15 })
    gsap.to(refract, { caustic: 0, duration: dur * 0.7, ease: 'power2.in' })
    gsap.to(wetWord, { color: '#eaf6f4', duration: dur * 0.9, ease: 'power2.inOut' })
    gsap.to(words, {
      x: dx,
      y: dy,
      scale: s,
      duration: dur,
      ease: 'power3.inOut',
      onComplete() {
        ctx.emit('intro:landed', {})
        gsap.to(words, { opacity: 0, duration: 0.25, ease: 'none', onComplete: finish })
      },
    })
  }

  function finish() {
    clearTimeout(holdT)
    refract.stop()
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
function createWater(canvas, panel, dpr, marks = {}) {
  const g = canvas.getContext('2d')
  let W = 0
  let H = 0
  let level = 0
  let raf = 0
  let running = false
  let t0 = 0
  const N = 40

  // The name lets go of a breath of bubbles where the waterline crosses it:
  // one small burst per column of the wave, from inside the letters.
  let wordBox = null
  const swallowed = new Uint8Array(N + 1)
  const breath = []
  function exhale(i, t) {
    const b = wordBox
    const x0 = (W * (i - 0.5)) / N
    const x1 = (W * (i + 0.5)) / N
    const n = 3 + Math.floor(Math.random() * 2)
    for (let k = 0; k < n; k++) {
      const x = Math.max(b.left, Math.min(b.right, x0 + Math.random() * (x1 - x0)))
      breath.push({
        x,
        y: b.top + b.height * (0.3 + Math.random() * 0.5),
        r: 0.9 + Math.random() ** 2 * 3.2,
        vy: 0.16 + Math.random() * 0.22, // fraction of the screen per second
        wob: Math.random() * Math.PI * 2,
        born: t + Math.random() * 0.12,
      })
    }
  }

  // light under the surface: shafts leaning down from the waterline (fanned
  // like the hero's sun rays), and glints riding the crest of the meniscus
  const SHAFTS = Array.from({ length: 7 }, (_, k) => ({
    x: (k + 0.15 + Math.random() * 0.7) / 7,
    v: (Math.random() - 0.5) * 0.012,
    w: 22 + Math.random() * 64,
    l: 0.5 + Math.random() * 0.55,
    a: 0.55 + Math.random() * 0.45,
    p: Math.random() * 6.28,
  }))
  const GLINTS = Array.from({ length: 11 }, () => ({
    x: Math.random(),
    v: (Math.random() - 0.5) * 0.06,
    f: 2.5 + Math.random() * 4.5,
    p: Math.random() * 6.28,
    len: 2.4 + Math.random() * 3.6,
  }))

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

    // 1. clip the black panel (and the dry name) to the air above the
    //    waterline, and the wet name to the water below it
    let line = ''
    for (let i = N; i >= 0; i--) line += `, ${((W * i) / N).toFixed(1)}px ${ys[i].toFixed(1)}px`
    const air = `polygon(0px -2px, ${W}px -2px${line})`
    panel.style.clipPath = air
    if (marks.dry) marks.dry.style.clipPath = air
    if (marks.wet) marks.wet.style.clipPath = `polygon(0px ${H + 2}px, ${W}px ${H + 2}px${line})`

    if (wordBox) {
      for (let i = 0; i <= N; i++) {
        const x = (W * i) / N
        if (swallowed[i] || x < wordBox.left - W / N || x > wordBox.right + W / N) continue
        if (ys[i] < wordBox.top + wordBox.height * 0.82) {
          swallowed[i] = 1
          exhale(i, t)
        }
      }
    }

    // 2. the water body just under the line: light caught in the surface
    g.clearRect(0, 0, W, H)
    const traceWave = (dy = 0) => {
      g.beginPath()
      g.moveTo(0, ys[0] + dy)
      for (let i = 1; i <= N; i++) {
        const x0 = (W * (i - 1)) / N
        const x1 = (W * i) / N
        const xm = (x0 + x1) / 2
        g.quadraticCurveTo(x0, ys[i - 1] + dy, xm, (ys[i - 1] + ys[i]) / 2 + dy)
      }
      g.lineTo(W, ys[N] + dy)
    }
    const yAt = (x) => {
      const u = clamp(x / W) * N
      const i = Math.min(N - 1, Math.floor(u))
      return ys[i] + (ys[i + 1] - ys[i]) * (u - i)
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

    // 2b. shafts of light leaning down from the surface, fanned from the
    //     middle like the sun rays the hero is about to show
    g.globalCompositeOperation = 'lighter'
    const reach = Math.max(240, H * 0.62)
    for (const sh of SHAFTS) {
      const x = (((sh.x + t * sh.v) % 1) + 1) % 1 * W
      const y0 = yAt(x) + 2
      const len = reach * sh.l
      const lean = (x / W - 0.5) * len * 0.55
      const w = sh.w * (0.82 + 0.18 * Math.sin(t * 1.6 + sh.p))
      const a = sh.a * (0.75 + 0.25 * Math.sin(t * 2.1 + sh.p * 2))
      const sg = g.createLinearGradient(0, y0, 0, y0 + len)
      sg.addColorStop(0, `rgba(217,251,255,${(0.13 * a).toFixed(3)})`)
      sg.addColorStop(0.35, `rgba(160,245,240,${(0.05 * a).toFixed(3)})`)
      sg.addColorStop(1, 'rgba(108,248,232,0)')
      g.fillStyle = sg
      g.beginPath()
      g.moveTo(x - w * 0.5, y0)
      g.lineTo(x + w * 0.5, y0)
      g.lineTo(x + w * 1.4 + lean, y0 + len)
      g.lineTo(x - w * 1.4 + lean, y0 + len)
      g.closePath()
      g.fill()
    }
    // the caustic shimmer just under the line: broken threads of light,
    // each drifting at its own pace
    g.lineWidth = 1
    for (let r = 0; r < 3; r++) {
      g.beginPath()
      for (let i = 0; i <= N; i++) {
        const x = (W * i) / N
        const y = ys[i] + 7 + r * 11 + Math.sin(x * 0.019 + t * (2.2 + r * 0.7) + r * 2.1) * (2.5 + r * 1.6)
        if (i) g.lineTo(x, y)
        else g.moveTo(x, y)
      }
      g.setLineDash([10 + r * 6, 16 + r * 9, 3 + r * 2, 22 + r * 7])
      g.lineDashOffset = -t * (38 + r * 21)
      g.strokeStyle = `rgba(190,252,246,${(0.2 - r * 0.05).toFixed(3)})`
      g.stroke()
    }
    g.setLineDash([])
    g.globalCompositeOperation = 'source-over'

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
    // … and the name's own breath, rising slower, from inside the letters
    for (const b of breath) {
      const life = t - b.born
      if (life <= 0) continue
      const y = b.y - life * b.vy * H
      const x = b.x + Math.sin(life * 6 + b.wob) * 3
      const i = Math.round((x / W) * N)
      const surfaceY = ys[clamp(i, 0, N)]
      if (y < surfaceY + 4) continue
      g.globalAlpha = clamp(life * 6) * clamp((y - surfaceY) / 40) * 0.95
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
    // the underside of the surface, a fainter second line just below
    traceWave(4.5)
    g.strokeStyle = 'rgba(217,251,255,0.2)'
    g.lineWidth = 0.8
    g.stroke()

    // 5. glints of light riding the crest
    g.globalCompositeOperation = 'lighter'
    for (const gl of GLINTS) {
      const a = Math.max(0, Math.sin(t * gl.f + gl.p)) ** 2
      if (a < 0.04) continue
      const x = (((gl.x + t * gl.v) % 1) + 1) % 1 * W
      const y = yAt(x)
      g.save()
      g.translate(x, y)
      g.scale(gl.len, 1)
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, 5)
      rg.addColorStop(0, `rgba(255,255,255,${(0.95 * a).toFixed(3)})`)
      rg.addColorStop(0.35, `rgba(200,255,250,${(0.4 * a).toFixed(3)})`)
      rg.addColorStop(1, 'rgba(108,248,232,0)')
      g.fillStyle = rg
      g.fillRect(-5, -5, 10, 10)
      g.restore()
    }
    g.globalCompositeOperation = 'source-over'

    if (running) raf = requestAnimationFrame(frame)
  }

  const onResize = () => resize()

  return {
    start(box) {
      if (running) return
      if (box && box.width) wordBox = { left: box.left, right: box.right, top: box.top, height: box.height }
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
      if (marks.dry) marks.dry.style.clipPath = 'polygon(0 0, 100% 0, 100% 0, 0 0)'
      if (marks.wet) marks.wet.style.clipPath = 'none'
    },
    destroy() {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    },
  }
}

/* ==========================================================================
   The refraction on the wet copy: an SVG displacement whose noise drifts
   sideways, like light bent by a moving surface. Driven by the GSAP ticker
   only while the name is in the water.
   ========================================================================== */
function createRefraction(gsap, filter) {
  const disp = filter?.querySelector('feDisplacementMap')
  const off = filter?.querySelector('feOffset')
  const field = filter?.querySelector('.loader__caustic-field')
  const flow = filter?.querySelector('.loader__caustic-flow')
  const net = filter?.querySelector('.loader__caustic-net')
  let t0 = 0
  let lastS = -1
  let lastC = -1
  const r = {
    scale: 0,
    caustic: 0,
    start() {
      if (!disp) return
      t0 = performance.now()
      gsap.ticker.add(tick)
    },
    stop() {
      gsap.ticker.remove(tick)
    },
  }
  function tick() {
    const t = (performance.now() - t0) / 1000
    // drift one way, with a slow swell in the vertical
    off.setAttribute('dx', (t * 120).toFixed(1))
    off.setAttribute('dy', (Math.sin(t * 2.2) * 6).toFixed(1))
    const s = Math.max(0, r.scale)
    if (Math.abs(s - lastS) > 0.05) {
      lastS = s
      disp.setAttribute('scale', s.toFixed(2))
    }
    // the caustic net: it drifts against the refraction and slowly reshapes
    // as the surface above it moves
    const c = clamp(r.caustic)
    if (net && (c > 0.005 || lastC > 0.005)) {
      flow.setAttribute('dx', (-t * 44).toFixed(1))
      flow.setAttribute('dy', (t * 16 + Math.sin(t * 1.7) * 5).toFixed(1))
      field.setAttribute(
        'baseFrequency',
        `${(0.012 + Math.sin(t * 1.3) * 0.0012).toFixed(5)} ${(0.021 + Math.cos(t * 0.9) * 0.0016).toFixed(5)}`,
      )
      if (Math.abs(c - lastC) > 0.01 || (c === 0 && lastC !== 0)) {
        lastC = c
        // alpha = c · (k − m·R): light only in the creases of the field
        net.setAttribute('values', `0 0 0 0 0.93  0 0 0 0 1  0 0 0 0 1  ${(-12 * c).toFixed(3)} 0 0 0 ${(1.6 * c).toFixed(3)}`)
      }
    }
  }
  return r
}
