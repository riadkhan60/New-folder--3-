/**
 * core/hud — the dive computer.
 *
 * Readout (bottom-left): zone + scientific name, a mechanical odometer for
 * depth (digits roll and carry like a real counter, and the figure itself is
 * squeezed by pressure as you descend), a band showing progress through the
 * current zone, then pressure, water temperature and sunlight.
 *
 * Ruler (right edge, ≥ 1024 px): a scale for the whole page. Ticks sit at
 * the scroll positions where depth.js reaches each depth, so the spacing
 * honestly shows where the page lingers. Zone boundaries are buttons that
 * scroll there. Rebuilt on ScrollTrigger refresh / resize / body resize.
 */
import '../styles/hud.css'

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const fmt = (n) => Math.round(n).toLocaleString('en-US')

const MARKS = [
  { d: 0, text: '0 m', tip: 'Surface' },
  { d: 200, text: '200', tip: 'Twilight zone' },
  { d: 1000, text: '1,000', tip: 'Midnight zone' },
  { d: 4000, text: '4,000', tip: 'The abyss' },
  { d: 6000, text: '6,000', tip: 'Hadal zone' },
  { d: 10935, text: '10,935', tip: 'Challenger Deep' },
]

// photophore → red observation lamps
const C_PHOTO = [108, 248, 232]
const C_RED = [255, 59, 47]

/** Sunlight as a share of what reaches the surface. */
export function formatLight(depth, light) {
  if (depth >= 1000) return { v: 'none', u: '' }
  const p = light * 100
  if (p >= 9.95) return { v: String(Math.round(p)), u: '%' }
  if (p >= 0.995) return { v: p.toFixed(1).replace(/\.0$/, ''), u: '%' }
  if (p >= 0.00995) return { v: p.toFixed(2), u: '%' }
  return { v: 'trace', u: '' }
}

export function init(ctx) {
  const hud = document.querySelector('.hud')
  if (!hud) return
  const { gsap, depth: D } = ctx
  const reduced = ctx.reducedMotion
  const $ = (s) => hud.querySelector(s)

  /* ------------------------------------------------------- odometer */
  const digitsEl = $('.hud__digits')
  const COLS = 5
  const cols = []
  let comma = null
  digitsEl.innerHTML = ''
  const strip = Array.from({ length: 11 }, (_, i) => `<span>${i % 10}</span>`).join('')
  for (let i = COLS - 1; i >= 0; i--) {
    const col = document.createElement('span')
    col.className = `hud__col hud__col--${i}`
    col.innerHTML = `<span class="hud__strip">${strip}</span>`
    digitsEl.appendChild(col)
    cols[i] = { el: col, strip: col.firstChild, pos: -1, lead: null }
    if (i === 3) {
      comma = document.createElement('span')
      comma.className = 'hud__comma'
      comma.textContent = ','
      digitsEl.appendChild(comma)
    }
  }
  let commaLead = null

  // A detent, like the Geneva drive in a mechanical counter: each wheel
  // holds on its digit, then snaps through to the next one.
  const detent = (f) => {
    const t = clamp((f - 0.22) / 0.56)
    return t * t * (3 - 2 * t)
  }
  function renderOdometer(v) {
    const val = Math.max(0, v)
    const whole = Math.floor(val)
    const fd = detent(val - whole)
    for (let i = 0; i < COLS; i++) {
      const p = 10 ** i
      // a wheel only turns while every wheel below it is passing 9 → 0
      const pos = (Math.floor(whole / p) % 10) + (whole % p === p - 1 ? fd : 0)
      const c = cols[i]
      if (Math.abs(pos - c.pos) > 0.0015) {
        c.pos = pos
        c.strip.style.transform = `translate3d(0, ${(-pos * 1.06).toFixed(4)}em, 0)`
      }
      const lead = i > 0 && val < p - 0.5
      if (lead !== c.lead) {
        c.lead = lead
        c.el.classList.toggle('is-lead', lead)
      }
    }
    const cl = val < 999.5
    if (cl !== commaLead) {
      commaLead = cl
      comma.classList.toggle('is-lead', cl)
    }
  }

  // follow the depth while it moves; when the water is still, settle the
  // wheels on the nearest whole metre
  const odo = { v: 0 }
  let settleT = 0
  let settleTw = null
  function setOdometer(v) {
    settleTw?.kill()
    odo.v = reduced ? Math.round(v) : v
    renderOdometer(odo.v)
    clearTimeout(settleT)
    if (reduced) return
    settleT = setTimeout(() => {
      settleTw = gsap.to(odo, { v: Math.round(v), duration: 0.6, ease: 'power3.out', onUpdate: () => renderOdometer(odo.v) })
    }, 140)
  }

  /* --------------------------------------------------------- fields */
  const depthText = $('.hud__depth-text')
  const fields = {
    pressure: $('[data-hud="pressure"]'),
    temperature: $('[data-hud="temperature"]'),
    light: $('[data-hud="light"]'),
    lightUnit: $('[data-hud="light-unit"]'),
  }
  const setText = (el, v) => {
    if (el && el.textContent !== v) el.textContent = v
  }
  const bandFill = $('.hud__band-fill')
  const bandFrom = $('.hud__band-from')
  const bandTo = $('.hud__band-to')
  const zoneSwap = $('.hud__zone-swap')
  const zoneName = $('.hud__zone-name')
  const zoneSci = $('.hud__zone-sci')

  /* ------------------------------------------------------ zone swap */
  let zoneId = null
  let zoneTl = null
  let pendingZone = null
  function applyZone(z) {
    zoneName.textContent = z.name
    zoneSci.textContent = z.sci
    bandFrom.textContent = fmt(z.from)
    bandTo.textContent = fmt(z.to)
  }
  function swapZone(z) {
    pendingZone = z
    if (reduced || !hud.classList.contains('is-on')) {
      zoneTl?.kill()
      gsap.set(zoneSwap, { clearProps: 'all' })
      applyZone(z)
      return
    }
    zoneTl?.kill()
    zoneTl = gsap
      .timeline()
      .to(zoneSwap, { yPercent: -120, opacity: 0, filter: 'blur(3px)', duration: 0.32, ease: 'power2.in' })
      .call(() => applyZone(pendingZone))
      .fromTo(
        zoneSwap,
        { yPercent: 120, opacity: 0, filter: 'blur(3px)' },
        { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.9, ease: 'expo.out' },
      )
      .fromTo(
        $('.hud__live'),
        { scale: 2.6 },
        { scale: 1, duration: 1.2, ease: 'expo.out' },
        '<',
      )
  }

  /* --------------------------------------------------- visibility */
  let ready = false
  let on = false
  ctx.ready.then(() => {
    ready = true
    hud.classList.add('is-ready')
    measure()
    update(D.get())
  })

  /* ------------------------------------------------------- the ruler */
  const ruler = $('.hud__ruler')
  const svg = $('.hud__scale')
  const marksEl = $('.hud__marks')
  const needle = $('.hud__needle')
  const fill = $('.hud__fill')
  let rulerH = 0
  let map = null // { yFor(d), maxScroll }

  marksEl.innerHTML = MARKS.map(
    (m, i) =>
      `<li><button class="hud__mark" type="button" data-i="${i}">` +
      `<span class="hud__mark-num">${m.text}<span class="visually-hidden">${m.d === 0 ? '' : ' m'},</span></span>` +
      `<span class="hud__tip">${m.tip}</span></button></li>`,
  ).join('')
  const markBtns = [...marksEl.querySelectorAll('.hud__mark')]

  function buildMap() {
    const vh = window.innerHeight
    const sy = window.scrollY
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - vh)
    const sections = [...document.querySelectorAll('[data-depth-start]')].map((el) => {
      const p = el.parentElement
      const box = p && p.classList.contains('pin-spacer') ? p : el
      const r = box.getBoundingClientRect()
      const start = parseFloat(el.dataset.depthStart) || 0
      const end = parseFloat(el.dataset.depthEnd ?? start)
      return { top: r.top + sy, h: r.height, start, end }
    })
    const yFor = (d) => {
      if (d <= 0) return 0
      for (const s of sections) {
        if (s.end > s.start && d >= s.start && d <= s.end) {
          return clamp(s.top + ((d - s.start) / (s.end - s.start)) * s.h - vh / 2, 0, maxScroll)
        }
      }
      return maxScroll
    }
    return { yFor, maxScroll }
  }

  function measure() {
    map = buildMap()
    if (getComputedStyle(ruler).display === 'none') return
    rulerH = ruler.clientHeight
    if (!rulerH) return
    const W = ruler.clientWidth
    const X = W - 8 // baseline x (right edge of the ticks)
    const py = (d) => (map.yFor(d) / map.maxScroll) * rulerH
    const lines = []
    const zoneDs = new Set(MARKS.map((m) => m.d))
    let last = -99
    for (let d = 100; d < D.MAX; d += 100) {
      if (zoneDs.has(d)) continue
      const y = py(d)
      const major = d % 1000 === 0
      if (y - last < (major ? 2.5 : 3.5)) continue
      last = y
      const len = major ? 8 : 4
      const yy = Math.round(y) + 0.5
      lines.push(`<line class="${major ? 't-major' : 't-minor'}" x1="${X - len}" x2="${X}" y1="${yy}" y2="${yy}"/>`)
    }
    for (const m of MARKS) {
      const yy = Math.round(py(m.d)) + 0.5
      lines.push(`<line class="t-zone" x1="${X - 15}" x2="${X + 4}" y1="${yy}" y2="${yy}"/>`)
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${rulerH}`)
    svg.innerHTML = lines.join('')

    let prev = -99
    markBtns.forEach((b, i) => {
      const y = py(MARKS[i].d)
      b.style.top = `${y.toFixed(1)}px`
      const crowded = y - prev < 16
      b.classList.toggle('is-crowded', crowded && i < MARKS.length - 1)
      if (!crowded) prev = y
    })
  }

  marksEl.addEventListener('click', (e) => {
    const b = e.target.closest('.hud__mark')
    if (!b) return
    const m = MARKS[+b.dataset.i]
    const y = buildMap().yFor(m.d)
    ctx.scrollTo(y, { duration: Math.min(3.2, 1.2 + Math.abs(y - window.scrollY) / 6000) })
  })

  let mT
  const remeasure = () => {
    clearTimeout(mT)
    mT = setTimeout(() => {
      measure()
      update(D.get(), true)
    }, 180)
  }
  ctx.ScrollTrigger.addEventListener('refresh', remeasure)
  window.addEventListener('resize', remeasure)
  if ('ResizeObserver' in window) new ResizeObserver(remeasure).observe(document.body)
  document.fonts?.ready.then(remeasure)

  /* --------------------------------------------------------- update */
  let lastHadal = -1
  let lastF = -1
  let lastBand = -1
  let lastProgress = -1
  let lastMark = -1
  let fast = false
  let fastT = 0
  let a11yT = 0

  function updateScroll(force = false) {
    const s = D.get()
    // visibility: quiet in the hero, on once the descent begins
    const nextOn = ready && (s.depth > 0.5 || window.scrollY > window.innerHeight * 0.3)
    if (nextOn !== on) {
      on = nextOn
      hud.classList.toggle('is-on', on)
    }
    // ruler needle (scroll-driven: depth is constant in the hero and footer)
    if (rulerH && map) {
      const p = clamp(window.scrollY / map.maxScroll)
      if (Math.abs(p - lastProgress) > 0.0002 || force) {
        lastProgress = p
        needle.style.transform = `translate3d(0, ${(p * rulerH).toFixed(1)}px, 0)`
        fill.style.transform = `scaleY(${p.toFixed(4)})`
      }
    }
  }

  function update(s, force = false) {
    updateScroll(force)
    setOdometer(s.depth)

    // the figure itself is squeezed by pressure (a softer range than headlines)
    const f = D.compression(s.depth).f
    if (Math.abs(f - lastF) > 0.004 || force) {
      lastF = f
      hud.style.setProperty('--hud-wdth', (128 - 66 * f).toFixed(1))
      hud.style.setProperty('--hud-wght', Math.round(250 + 330 * f))
    }

    // accent follows the light that exists at this depth
    if (Math.abs(s.hadal - lastHadal) > 0.004 || force) {
      lastHadal = s.hadal
      const c = C_PHOTO.map((v, i) => Math.round(v + (C_RED[i] - v) * s.hadal))
      hud.style.setProperty('--hud-accent', `rgb(${c[0]} ${c[1]} ${c[2]})`)
    }

    if (s.zone.id !== zoneId) {
      const first = zoneId === null
      zoneId = s.zone.id
      if (first) applyZone(s.zone)
      else swapZone(s.zone)
    }

    const z = s.zone
    const band = clamp((s.depth - z.from) / (z.to - z.from))
    if (Math.abs(band - lastBand) > 0.001 || force) {
      lastBand = band
      bandFill.style.transform = `scaleX(${band.toFixed(4)})`
      bandFill.style.setProperty('--inv', band > 0.01 ? (1 / band).toFixed(3) : 1)
    }

    setText(fields.pressure, s.pressure < 99.95 ? s.pressure.toFixed(1) : fmt(s.pressure))
    setText(fields.temperature, s.temperature.toFixed(1))
    const L = formatLight(s.depth, s.light)
    setText(fields.light, L.v)
    setText(fields.lightUnit, L.u)

    const isFast = !reduced && Math.abs(s.velocity) > 14
    if (isFast !== fast) {
      fast = isFast
      hud.classList.toggle('is-fast', fast)
    }
    // direction of travel, like a dive computer's ascent/descent arrow
    const dir = s.velocity > 0.25 ? 'down' : s.velocity < -0.25 ? 'up' : null
    if (dir && dir !== hud.dataset.dir) hud.dataset.dir = dir

    // depth.js stops reporting once the water is still: settle the blur
    // and let the arrow fade
    clearTimeout(fastT)
    fastT = setTimeout(() => {
      fast = false
      hud.classList.remove('is-fast')
      delete hud.dataset.dir
    }, fast ? 140 : 420)

    if (rulerH && map) {
      let mi = 0
      for (let i = 0; i < MARKS.length; i++) if (s.depth >= MARKS[i].d - 0.5) mi = i
      if (mi !== lastMark) {
        if (lastMark >= 0) markBtns[lastMark].classList.remove('is-current')
        markBtns[mi].classList.add('is-current')
        lastMark = mi
      }
    }

    // screen-reader text, without chattering every frame
    const now = performance.now()
    if (now - a11yT > 600 || force) {
      a11yT = now
      setText(depthText, fmt(s.depth))
    }
  }

  // at the floor the footer's small print owns the bottom-left corner:
  // the readout surfaces out of its way
  const footer = document.getElementById('footer') || document.querySelector('body > footer')
  if (footer && 'IntersectionObserver' in window) {
    new IntersectionObserver(
      ([e]) => hud.classList.toggle('is-docked', e.isIntersecting),
      { rootMargin: '0px 0px -24px 0px' },
    ).observe(footer)
  }

  measure()
  D.onChange((s) => update(s))
  if (ctx.lenis) ctx.lenis.on('scroll', () => updateScroll())
  else window.addEventListener('scroll', () => updateScroll(), { passive: true })
}
