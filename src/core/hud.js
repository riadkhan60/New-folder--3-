/**
 * core/hud — the dive computer.
 *
 * Readout (bottom-left, on the content column): zone + scientific name, a
 * mechanical odometer for depth (digits roll and carry like a real counter,
 * and the figure itself is squeezed by pressure as you descend), a band
 * showing progress through the current zone, then pressure, water
 * temperature and sunlight.
 *
 * The readout never prints over the page. Two IntersectionObservers watch
 * the page's text and drawings against the readout's footprint:
 *  - when anything visible enters the full instrument's footprint, it
 *    folds into a slim glass chip (FLIP: the odometer flies down into it);
 *    in open water it unfolds again;
 *  - when something sits under the chip itself and the visitor stops to
 *    read, the chip tucks away, and comes back as soon as the dive resumes.
 * Short or narrow screens and touch devices always get the chip.
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

// screens that always get the slim chip instead of the full instrument
const CHIP_ONLY = '(max-width: 1023px), (max-height: 700px), (hover: none) and (pointer: coarse)'

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

  // Fixed, so its place in the DOM is invisible — but last in the tab order:
  // keyboard users reach the page before the instruments.
  const main = document.querySelector('main')
  if (main && hud.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING) {
    document.body.appendChild(hud)
  }

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
  const readout = $('.hud__readout')
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
  const band = $('.hud__band')
  const rows = $('.hud__rows')
  const bandFill = $('.hud__band-fill')
  const bandFrom = $('.hud__band-from')
  const bandTo = $('.hud__band-to')
  const zoneRow = $('.hud__zone')
  const zoneSwap = $('.hud__zone-swap')
  const zoneName = $('.hud__zone-name')
  const zoneSci = $('.hud__zone-sci')
  const unitEl = $('.hud__unit')
  const dirEl = $('.hud__dir')

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
    update(D.get(), true)
    watch()
  })

  /* ================================================ full ⇄ chip ==== */
  const chipMQ = window.matchMedia(CHIP_ONLY)
  let chipOnly = chipMQ.matches
  let compact = chipOnly
  hud.classList.toggle('is-chip-only', chipOnly)
  hud.classList.toggle('is-compact', compact)

  // FLIP: the zone line and the odometer fly between the two layouts
  const flips = [
    { el: zoneRow, ref: zoneName },
    { el: digitsEl, ref: digitsEl },
    { el: unitEl, ref: unitEl },
    { el: dirEl, ref: dirEl },
  ]
  const flipEls = flips.map((f) => f.el)

  function setCompact(v, animate = true) {
    if (v === compact) return
    compact = v
    const motion = animate && !reduced && on && !chipOnly && !document.hidden
    if (!motion) {
      gsap.killTweensOf(flipEls)
      gsap.set(flipEls, { clearProps: 'transform' })
      hud.classList.toggle('is-compact', v)
      updateTuck()
      return
    }
    const first = flips.map((f) => [f.el.getBoundingClientRect(), f.ref.getBoundingClientRect()])
    // the rows and band fade where they were, rather than blinking out
    const ghosts = v
      ? [band, rows]
          .filter((el) => el.offsetParent)
          .map((el) => {
            const r = el.getBoundingClientRect()
            const g = el.cloneNode(true)
            g.classList.add('hud__ghost')
            Object.assign(g.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px` })
            g.setAttribute('aria-hidden', 'true')
            hud.appendChild(g)
            return g
          })
      : []
    gsap.killTweensOf(flipEls)
    gsap.set(flipEls, { clearProps: 'transform' })
    hud.classList.toggle('is-compact', v)
    updateTuck()
    flips.forEach((f, i) => {
      const l = f.el.getBoundingClientRect()
      const lr = f.ref.getBoundingClientRect()
      const [fr, frr] = first[i]
      if (!l.width || !fr.width || !lr.height) return
      const s = frr.height / lr.height
      gsap.fromTo(
        f.el,
        { x: fr.left - l.left, y: fr.top - l.top, scale: s, transformOrigin: '0 0' },
        { x: 0, y: 0, scale: 1, duration: v ? 0.8 : 1.0, ease: 'expo.out', clearProps: 'transform' },
      )
    })
    if (ghosts.length) {
      gsap.to(ghosts, {
        opacity: 0,
        y: 10,
        filter: 'blur(3px)',
        duration: 0.4,
        ease: 'power2.out',
        stagger: 0.04,
        onComplete: () => ghosts.forEach((g) => g.remove()),
      })
    }
  }

  /* ----------------------------------------------- what's underneath */
  // Every block that sets a line of text, plus drawings and panels.
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION'])
  function collectTargets() {
    const roots = [main, document.getElementById('footer') || document.querySelector('body > footer')].filter(Boolean)
    const found = new Set()
    const art = new Set()
    const disp = new Map()
    const display = (el) => {
      let d = disp.get(el)
      if (d === undefined) {
        d = getComputedStyle(el).display
        disp.set(el, d)
      }
      return d
    }
    for (const root of roots) {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (/\S/.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
      })
      let n
      while ((n = tw.nextNode())) {
        let el = n.parentElement
        if (!el || SKIP.has(el.tagName)) continue
        if (el.closest('.visually-hidden, [hidden]')) continue
        // climb out of inline runs (words, split characters) to the block
        // that owns the line box
        for (let hops = 0; hops < 8 && el !== root && el.parentElement; hops++) {
          if (!display(el).startsWith('inline')) break
          el = el.parentElement
        }
        found.add(el)
      }
      root
        .querySelectorAll('svg, canvas, img, video, [data-hud-avoid], .vessel__specplate')
        .forEach((el) => {
          if (!el.parentElement?.closest('svg') && !found.has(el)) art.add(el)
        })
    }
    return { text: found, art }
  }

  const expHits = new Set()
  const chipHits = new Set()
  let expIO = null
  let chipIO = null

  // Where the readout sits in a given layout (offsets ignore transforms).
  // The other layout is measured on a hidden copy, so measuring never
  // restarts the real instrument's animations or transitions.
  function footprint(asCompact) {
    let el = readout
    let probe = null
    if (asCompact !== compact) {
      probe = document.createElement('div')
      probe.className = `hud${asCompact ? ' is-compact' : ''}${chipOnly ? ' is-chip-only' : ''}`
      probe.setAttribute('aria-hidden', 'true')
      probe.style.cssText = `${hud.style.cssText};visibility:hidden`
      el = readout.cloneNode(true)
      el.querySelectorAll('[style]').forEach((n) => n.style.removeProperty('transform'))
      probe.appendChild(el)
      document.body.appendChild(probe)
    }
    const r = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }
    probe?.remove()
    return r
  }

  // pv: breathing room above/below; ph: left/right (negative: things that
  // merely touch the edge, like the manifesto's tape, don't count)
  function rootMargin(r, pv, ph) {
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    const m = (v) => `${Math.min(0, Math.round(-v))}px`
    return [r.top - pv, vw - (r.left + r.width) - ph, vh - (r.top + r.height) - pv, r.left - ph].map(m).join(' ')
  }

  function observer(hits, r, pv, ph) {
    if (!r.width || !r.height) return null
    return new IntersectionObserver(
      (entries) => {
        const vw = window.innerWidth
        const vh = window.innerHeight
        for (const e of entries) {
          const b = e.boundingClientRect
          // full-bleed canvases and backdrops are the water, not content
          const backdrop = b.width > vw * 0.75 && b.height > vh * 0.6
          if (e.isIntersecting && !backdrop) hits.add(e.target)
          else hits.delete(e.target)
        }
        schedule()
      },
      { rootMargin: rootMargin(r, pv, ph), threshold: 0 },
    )
  }

  function watch() {
    if (!('IntersectionObserver' in window)) return
    expIO?.disconnect()
    chipIO?.disconnect()
    expHits.clear()
    chipHits.clear()
    const { text, art } = collectTargets()
    expIO = chipOnly ? null : observer(expHits, footprint(false), 14, -2)
    chipIO = observer(chipHits, footprint(true), 4, -2)
    // the full instrument steps out of the way of text and drawings alike;
    // the glass chip only gives way to text someone is reading
    for (const el of text) {
      expIO?.observe(el)
      chipIO?.observe(el)
    }
    for (const el of art) expIO?.observe(el)
  }

  if (import.meta.env?.DEV) window.__noctilucaHud = { expHits, chipHits } // QA

  const visible = (el) =>
    el.isConnected && (!el.checkVisibility || el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
  const covered = (hits) => {
    for (const el of hits) if (visible(el)) return true
    return false
  }

  let foldT = 0
  let unfoldT = 0
  let chipCovered = false
  function evaluate() {
    if (!ready) return
    if (!chipOnly) {
      if (covered(expHits)) {
        clearTimeout(unfoldT)
        unfoldT = 0
        if (!compact && !foldT) {
          foldT = setTimeout(() => {
            foldT = 0
            if (covered(expHits)) setCompact(true)
          }, 40)
        }
      } else {
        clearTimeout(foldT)
        foldT = 0
        // open water: unfold, but only once it has stayed clear for a beat
        if (compact && !unfoldT) {
          unfoldT = setTimeout(() => {
            unfoldT = 0
            if (!covered(expHits)) setCompact(false)
          }, 650)
        }
      }
    }
    chipCovered = covered(chipHits)
    updateTuck()
  }
  let evQ = 0
  function schedule() {
    if (!evQ) {
      evQ = requestAnimationFrame(() => {
        evQ = 0
        evaluate()
      })
    }
  }
  // reveals that happen without scrolling (tweens, pins settling)
  setInterval(() => {
    if (ready && !document.hidden && (expHits.size || chipHits.size || compact)) schedule()
  }, 450)

  // the chip steps aside while the visitor reads what is under it
  let idle = true
  let idleT = 0
  let tucked = false
  function updateTuck() {
    const t = compact && chipCovered && idle
    if (t !== tucked) {
      tucked = t
      hud.classList.toggle('is-tucked', t)
    }
  }
  let lastEvalAt = 0
  function activity() {
    if (idle) {
      idle = false
      updateTuck()
    }
    clearTimeout(idleT)
    idleT = setTimeout(() => {
      idle = true
      schedule()
    }, 1000)
    const now = performance.now()
    if (now - lastEvalAt > 90) {
      lastEvalAt = now
      schedule()
    }
  }

  chipMQ.addEventListener?.('change', () => {
    chipOnly = chipMQ.matches
    hud.classList.toggle('is-chip-only', chipOnly)
    if (chipOnly) setCompact(true, false)
    remeasure()
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
      `<span class="visually-hidden">Go to </span>` +
      `<span class="hud__mark-num">${m.text}<span class="visually-hidden">${m.d === 0 ? '' : ' m'},</span></span>` +
      `<span class="hud__tip">${m.tip}</span></button></li>`,
  ).join('')
  const markBtns = [...marksEl.querySelectorAll('.hud__mark')]

  function buildMap() {
    const vh = window.innerHeight
    const sy = window.scrollY
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - vh)
    // depth.js knows the exact mapping (incl. sections that reach their end
    // depth early via [data-depth-until]); fall back to the linear one
    if (typeof D.scrollYForDepth === 'function') return { yFor: (d) => D.scrollYForDepth(d), maxScroll }
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
      const crowded = y - prev < 18
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
      if (ready) watch()
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
    const bandP = clamp((s.depth - z.from) / (z.to - z.from))
    if (Math.abs(bandP - lastBand) > 0.001 || force) {
      lastBand = bandP
      bandFill.style.transform = `scaleX(${bandP.toFixed(4)})`
      bandFill.style.setProperty('--inv', bandP > 0.01 ? (1 / bandP).toFixed(3) : 1)
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
  const onScroll = () => {
    updateScroll()
    activity()
  }
  if (ctx.lenis) ctx.lenis.on('scroll', onScroll)
  else window.addEventListener('scroll', onScroll, { passive: true })
}
