/**
 * profiles.js — #dives (8,000 → 10,000 m). The three products as dive
 * profiles on a depth chart.
 *
 * Signature: the chart is the price list. Hours since leaving the surface run
 * along the top, depth runs down to 11,000 m, with gridlines at the zone
 * boundaries. As you sink, the three profiles draw themselves (DrawSVG,
 * scrubbed): Twilight, then Abyss, then Hadal, last and deepest. The Hadal
 * line turns from blue-green to red at 6,000 m, where the lamps change.
 *
 * Each curve is a button (roving tabindex, arrow keys move between them).
 * Hover, focus or click selects it: the line glows, the others step back,
 * the water it covers fills faintly, and the panel reads it out. A small
 * submersible rides the selected profile in real time-scale, with a live
 * depth and elapsed-time readout. "Reserve a dive" emits `select-profile`
 * and scrolls to #reserve.
 *
 * Reduced motion: curves fully drawn, no sticky stage, no travelling sub.
 */
import '../styles/profiles.css'

const SVGNS = 'http://www.w3.org/2000/svg'
const Y_MAX = 11000
const X_MAX = 12
const RED_FROM = 6000
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const fmt = (m) => Math.round(m).toLocaleString('en-US')

const PROFILES = [
  {
    id: 'twilight',
    name: 'Twilight',
    depth: 1000,
    hours: 5,
    trip: '3 days',
    price: '$48,000',
    seats: 40,
    where: 'The twilight zone, where daylight runs out',
    see: 'The blue light thins and goes out. Below it, lanternfish, siphonophores and comb jellies make their own light, and the dive spends long, slow minutes among them.',
    // hours, metres: a slow descent with a pause among the lanternfish
    pts: [[0, 0], [0.75, 540], [1.15, 590], [1.7, 1000], [3.4, 1000], [5, 0]],
    r: [0, 22, 18, 26, 26, 0],
    tagAt: 1.95,
    tagAnchor: 'start',
  },
  {
    id: 'abyss',
    name: 'Abyss',
    depth: 5500,
    hours: 9,
    trip: '6 days',
    price: '$195,000',
    seats: 18,
    where: 'The abyssal plain',
    see: 'A flat floor of fine sediment, the most widespread landscape on Earth. Sea cucumbers, brittle stars and grenadier fish, and the tracks they leave in the mud.',
    pts: [[0, 0], [2, 5500], [7, 5500], [9, 0]],
    r: [0, 34, 34, 0],
    tagAt: 4.7,
  },
  {
    id: 'hadal',
    name: 'Hadal',
    depth: 10935,
    hours: 12,
    trip: '9 days',
    price: '$750,000',
    seats: 6,
    where: 'The floor of the Challenger Deep',
    see: 'Snailfish on the way down, the deepest-living fish known. On the floor, amphipods gather in the red light, and xenophyophores grow as wide as your hand from a single cell.',
    pts: [[0, 0], [4, 10935], [8, 10935], [12, 0]],
    r: [0, 40, 40, 0],
    tagAt: 6,
  },
]
const BY_ID = Object.fromEntries(PROFILES.map((p) => [p.id, p]))

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(SVGNS, name)
  for (const k in attrs) n.setAttribute(k, attrs[k])
  if (parent) parent.appendChild(n)
  return n
}

function roundedPath(pts, radii) {
  const f = (v) => v.toFixed(1)
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const [cx, cy] = pts[i + 1]
    const l1 = Math.hypot(ax - bx, ay - by)
    const l2 = Math.hypot(cx - bx, cy - by)
    const r = Math.min(radii[i] || 0, l1 / 2, l2 / 2)
    if (r < 0.5) {
      d += ` L${f(bx)} ${f(by)}`
      continue
    }
    const p1 = [bx + ((ax - bx) / l1) * r, by + ((ay - by) / l1) * r]
    const p2 = [bx + ((cx - bx) / l2) * r, by + ((cy - by) / l2) * r]
    d += ` L${f(p1[0])} ${f(p1[1])} Q${f(bx)} ${f(by)} ${f(p2[0])} ${f(p2[1])}`
  }
  const last = pts[pts.length - 1]
  return d + ` L${f(last[0])} ${f(last[1])}`
}

/* Lookup by x (time is monotonic along a profile). */
function sampleX(path, step = 2) {
  const total = path.getTotalLength()
  const n = Math.max(2, Math.ceil(total / step))
  const X = new Float32Array(n + 1)
  const Y = new Float32Array(n + 1)
  let mx = -Infinity
  for (let i = 0; i <= n; i++) {
    const p = path.getPointAtLength((i / n) * total)
    mx = Math.max(mx, p.x)
    X[i] = mx
    Y[i] = p.y
  }
  return { X, Y, n }
}
function yAtX(lut, x) {
  const { X, Y, n } = lut
  if (x <= X[0]) return Y[0]
  if (x >= X[n]) return Y[n]
  let lo = 0
  let hi = n
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (X[mid] <= x) lo = mid
    else hi = mid
  }
  const span = X[hi] - X[lo]
  const t = span > 1e-4 ? (x - X[lo]) / span : 0
  return Y[lo] + (Y[hi] - Y[lo]) * t
}

export function init(ctx) {
  const root = document.getElementById('dives')
  if (!root) return
  const { gsap, ScrollTrigger } = ctx
  const reduced = ctx.reducedMotion

  const fig = root.querySelector('[data-pf-chart]')
  const svg = root.querySelector('.pf__svg')
  const opts = [...root.querySelectorAll('[data-pf-opt]')]
  const panel = root.querySelector('[data-pf-panel]')
  const inner = root.querySelector('[data-pf-inner]')
  const reserve = root.querySelector('[data-pf-reserve]')
  const field = (k) => root.querySelector(`[data-pf="${k}"]`)
  const F = {
    name: field('name'),
    where: field('where'),
    depth: field('depth'),
    depthText: field('depth-text'),
    dive: field('dive'),
    trip: field('trip'),
    seats: field('seats'),
    see: field('see'),
    price: field('price'),
    reserveName: field('reserve-name'),
  }
  if (!fig || !svg) return
  if (reduced) root.classList.add('is-static')

  let selected = 'hadal'
  let touched = false // the visitor has chosen something
  let G = null
  let tl = null
  let inView = false
  let drawnAll = reduced
  const drawnState = { twilight: false, abyss: false, hadal: false }

  /* --------------------------------------------------------------- panel */
  const counter = { v: BY_ID[selected].depth }
  let panelTl = null
  let countTw = null
  function fillPanel(p) {
    F.name.textContent = p.name
    F.where.textContent = p.where
    F.depthText.textContent = fmt(p.depth)
    F.dive.textContent = `${p.hours} hours`
    F.trip.textContent = p.trip
    F.seats.textContent = String(p.seats)
    F.see.textContent = p.see
    F.price.textContent = p.price
    F.reserveName.textContent = ` on the ${p.name} profile`
  }
  function renderPanel(p, animate) {
    panel.dataset.profile = p.id
    if (!animate || reduced) {
      fillPanel(p)
      counter.v = p.depth
      F.depth.textContent = fmt(p.depth)
      return
    }
    panelTl?.kill()
    countTw?.kill()
    panelTl = gsap
      .timeline()
      .to(inner, { opacity: 0, y: -6, duration: 0.16, ease: 'power2.in', onComplete: () => fillPanel(p) })
      .to(inner, { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out' })
    countTw = gsap.to(counter, {
      v: p.depth,
      duration: 1.1,
      ease: 'expo.out',
      onUpdate: () => (F.depth.textContent = fmt(Math.round(counter.v / 5) * 5)),
      onComplete: () => (F.depth.textContent = fmt(p.depth)),
    })
  }

  /* ------------------------------------------------------------ selection */
  function select(id, { animate = true, focus = false } = {}) {
    if (!BY_ID[id]) return
    const changed = id !== selected
    selected = id
    root.dataset.sel = id
    opts.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pfOpt === id)))
    if (G) {
      for (const c of Object.values(G.curves)) {
        const on = c.id === id
        c.g.classList.toggle('is-sel', on)
        c.g.setAttribute('aria-pressed', String(on))
        c.g.setAttribute('tabindex', on ? '0' : '-1')
      }
      if (focus) G.curves[id].g.focus({ preventScroll: true })
    }
    if (changed) {
      renderPanel(BY_ID[id], animate)
      restartSub()
    }
  }

  /* ---------------------------------------------------------------- chart */
  function build() {
    const W = Math.round(fig.clientWidth)
    const H = Math.round(fig.clientHeight)
    if (W < 40 || H < 40) return
    const narrow = W < 520
    const m = { t: 34, r: narrow ? 90 : 104, b: 14, l: 6 }
    svg.classList.toggle('is-narrow', narrow)
    const pw = W - m.l - m.r
    const ph = H - m.t - m.b
    const X = (h) => m.l + (h / X_MAX) * pw
    const Y = (d) => m.t + (d / Y_MAX) * ph

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.textContent = ''

    /* defs */
    const defs = el('defs', {}, svg)
    const hg = el('linearGradient', { id: 'pf-hadal-grad', gradientUnits: 'userSpaceOnUse', x1: 0, y1: Y(RED_FROM - 500), x2: 0, y2: Y(RED_FROM + 500) }, defs)
    el('stop', { offset: 0, style: 'stop-color:var(--pf-twilight)' }, hg)
    el('stop', { offset: 1, style: 'stop-color:var(--pf-hadal)' }, hg)
    for (const p of PROFILES) {
      const ag = el('linearGradient', { id: `pf-area-${p.id}`, gradientUnits: 'userSpaceOnUse', x1: 0, y1: Y(0), x2: 0, y2: Y(p.depth) }, defs)
      const deepC = p.id === 'hadal' ? 'var(--pf-hadal)' : `var(--pf-${p.id})`
      const topC = p.id === 'hadal' ? 'var(--pf-twilight)' : `var(--pf-${p.id})`
      el('stop', { offset: 0, style: `stop-color:${topC};stop-opacity:0` }, ag)
      el('stop', { offset: 1, style: `stop-color:${deepC};stop-opacity:0.16` }, ag)
    }
    const sg = el('radialGradient', { id: 'pf-sub-glow' }, defs)
    el('stop', { offset: 0, style: 'stop-color:var(--pf-sel);stop-opacity:0.55' }, sg)
    el('stop', { offset: 1, style: 'stop-color:var(--pf-sel);stop-opacity:0' }, sg)

    /* grid */
    const grid = el('g', { class: 'pf__grid', 'aria-hidden': 'true' }, svg)
    el('line', { class: 'pf__surface', x1: m.l, x2: m.l + pw, y1: Y(0), y2: Y(0) }, grid)
    for (let h = 0; h <= X_MAX; h++) {
      const x = Math.round(X(h)) + 0.5
      el('line', { class: 'pf__tick', x1: x, x2: x, y1: Y(0) - (h % 2 ? 3 : 6), y2: Y(0) }, grid)
      if (h % (narrow ? 4 : 2) === 0) {
        const t = el('text', { class: 'pf__axis', x, y: Y(0) - 12, 'text-anchor': h === 0 ? 'start' : h === X_MAX ? 'end' : 'middle' }, grid)
        t.textContent = h === X_MAX ? '12 h' : String(h)
      }
    }
    const boundaries = [200, 1000, 4000, 6000]
    for (const d of boundaries) {
      const y = Math.round(Y(d)) + 0.5
      el('line', { class: `pf__gridline${d === RED_FROM ? ' pf__gridline--red' : ''}`, x1: m.l, x2: m.l + pw, y1: y, y2: y }, grid)
      const t = el('text', { class: `pf__axis${d === RED_FROM ? ' pf__axis--red' : ''}`, x: m.l + pw + (narrow ? 8 : 12), y: y + 4 }, grid)
      t.textContent = `${fmt(d)} m`
    }
    const yFloor = Math.round(Y(10935)) + 0.5
    el('line', { class: 'pf__floorline', x1: m.l, x2: m.l + pw, y1: yFloor, y2: yFloor }, grid)
    const tf = el('text', { class: 'pf__axis pf__axis--red', x: m.l + pw + (narrow ? 8 : 12), y: yFloor + 4 }, grid)
    tf.textContent = '10,935 m'
    // zone names, centred in their bands (the 0–200 m band is too thin to label)
    const zones = [
      [200, 1000, 'Twilight zone'],
      [1000, 4000, 'Midnight zone'],
      [4000, 6000, 'The abyss'],
      [6000, 10935, 'Hadal zone'],
    ]
    for (const [a, b, name] of zones) {
      const t = el('text', { class: 'pf__zone', x: m.l + pw + (narrow ? 8 : 12), y: (Y(a) + Y(b)) / 2 + 4 }, grid)
      t.textContent = name
    }

    /* curves (DOM order sets hover priority: Twilight on top) */
    const curvesG = el('g', { class: 'pf__curves' }, svg)
    const curves = {}
    for (const p of [...PROFILES].reverse()) {
      const pts = p.pts.map(([h, d]) => [X(h), Y(d)])
      const d = roundedPath(pts, p.r)
      const g = el(
        'g',
        {
          class: 'pf__curve',
          'data-id': p.id,
          role: 'button',
          tabindex: p.id === selected ? '0' : '-1',
          'aria-pressed': String(p.id === selected),
          'aria-label': `${p.name}: ${fmt(p.depth)} metres, ${p.hours}-hour dive, ${p.trip}, ${p.price}`,
        },
        curvesG,
      )
      const area = el('path', { class: 'pf__area', d: `${d} Z`, fill: `url(#pf-area-${p.id})` }, g)
      const halo = el('path', { class: 'pf__halo', d }, g)
      const line = el('path', { class: 'pf__line', d }, g)
      if (p.id === 'hadal') {
        halo.style.stroke = 'url(#pf-hadal-grad)'
        line.style.stroke = 'url(#pf-hadal-grad)'
      }
      el('path', { class: 'pf__focus', d }, g)
      el('path', { class: 'pf__hit', d }, g)

      // name + depth beside the floor
      const fx = X(p.tagAt)
      const above = p.id === 'hadal'
      const fy = Y(p.depth) + (above ? -14 : 22)
      const tag = el('g', { class: 'pf__tag', 'aria-hidden': 'true' }, g)
      const tn = el('text', { class: 'pf__tag-name', x: fx, y: fy, 'text-anchor': p.tagAnchor || 'middle' }, tag)
      tn.textContent = p.name
      const td = el('tspan', { class: 'pf__tag-depth', dx: 8 }, tn)
      td.textContent = `${fmt(p.depth)} m`

      curves[p.id] = { id: p.id, g, line, halo, area, tag, lut: null, p }
    }

    /* the little sub */
    const sub = el('g', { class: 'pf__sub', 'aria-hidden': 'true' }, svg)
    const subG = el('g', {}, sub)
    el('circle', { class: 'pf__sub-glow', r: 26 }, subG)
    el('rect', { class: 'pf__sub-body', x: -9, y: -3.5, width: 15, height: 7, rx: 3.5 }, subG)
    el('circle', { class: 'pf__sub-body', cx: 6.5, cy: 0, r: 4.2 }, subG)
    el('circle', { class: 'pf__sub-port', cx: 8, cy: 0.4, r: 1.6 }, subG)
    el('rect', { class: 'pf__sub-body', x: -6, y: -6.5, width: 6, height: 3.5, rx: 1.2 }, subG)
    const readD = el('text', { class: 'pf__sub-read', x: 16, y: -2 }, sub)
    const readT = el('text', { class: 'pf__sub-read pf__sub-read--t', x: 16, y: 12 }, sub)

    G = { W, H, m, pw, ph, X, Y, curves, sub, subG, readD, readT }
    for (const id in drawnState) drawnState[id] = false // fresh DOM: re-apply classes
    for (const c of Object.values(curves)) c.lut = sampleX(c.line)

    /* events */
    for (const c of Object.values(curves)) {
      c.g.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse') choose(c.id)
      })
      c.g.addEventListener('click', () => {
        choose(c.id)
        ping(c)
      })
      c.g.addEventListener('focus', () => choose(c.id))
      c.g.addEventListener('keydown', (e) => {
        const order = PROFILES.map((p) => p.id)
        const i = order.indexOf(c.id)
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          choose(order[(i + 1) % order.length], { focus: true })
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          choose(order[(i + order.length - 1) % order.length], { focus: true })
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          choose(c.id)
          ping(c)
        }
      })
    }

    select(selected, { animate: false })
    makeTimeline()
    syncDim()
  }

  // While the lines are drawing, all of them burn at full strength; once the
  // last one lands (or the visitor chooses), the unselected ones step back.
  function syncDim() {
    svg.classList.toggle('has-sel', reduced || drawnAll || touched)
  }
  function choose(id, opts) {
    touched = true
    select(id, opts)
    syncDim()
  }

  function ping(c) {
    const r = c.g.getBoundingClientRect()
    ctx.emit('sonar', { x: r.left + r.width / 2, y: r.top + r.height / 2, strength: 0.35 })
  }

  /* ----------------------------------------------------------- draw on scroll */
  // [start, end] of each curve's draw within the scrubbed timeline (0–1)
  const WINDOWS = { twilight: [0.1, 0.36], abyss: [0.3, 0.6], hadal: [0.5, 0.9] }

  function setDrawn(id, on) {
    if (drawnState[id] === on) return
    drawnState[id] = on
    G.curves[id].g.classList.toggle('is-drawn', on)
  }

  function makeTimeline() {
    if (tl) {
      tl.scrollTrigger?.kill()
      tl.kill()
      tl = null
    }
    const { curves } = G
    const grid = svg.querySelector('.pf__grid')
    const tags = Object.values(curves).map((c) => c.tag)

    if (reduced) {
      for (const id in curves) setDrawn(id, true)
      return
    }

    const sticky = getComputedStyle(root.querySelector('.pf')).position === 'sticky'
    tl = gsap.timeline({
      defaults: { ease: 'none' },
      onUpdate: () => {
        const t = tl.progress()
        for (const id in WINDOWS) setDrawn(id, t >= WINDOWS[id][1] - 0.005)
        const all = t >= WINDOWS.hadal[1] - 0.005
        if (all !== drawnAll) {
          drawnAll = all
          syncDim()
          updateSub()
        }
      },
      scrollTrigger: sticky
        ? { trigger: root, start: 'top 55%', end: 'bottom bottom', scrub: 0.6 }
        : { trigger: fig, start: 'top 85%', end: 'bottom 60%', scrub: 0.6 },
    })
    tl.fromTo(grid, { opacity: 0 }, { opacity: 1, duration: 0.12 }, 0)
    for (const p of PROFILES) {
      const c = curves[p.id]
      const [a, b] = WINDOWS[p.id]
      tl.fromTo([c.line, c.halo], { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: b - a, ease: 'power1.inOut' }, a)
      tl.fromTo(c.tag, { opacity: 0 }, { opacity: 1, duration: 0.06 }, b - 0.04)
    }
    tl.to({}, { duration: 0.1 }, 0.9) // hold everything drawn for the last stretch
    gsap.set(tags, { opacity: 0 })
    tl.progress(0).progress(tl.scrollTrigger ? tl.scrollTrigger.progress : 0)
  }

  /* ------------------------------------------------------------ the sub */
  let loop = null
  const st = { t: 0 }
  function placeSub() {
    if (!G) return
    const c = G.curves[selected]
    const { X, Y, m, pw, ph, subG, sub, readD, readT } = G
    const h = st.t * c.p.hours
    const x = X(h)
    const y = yAtX(c.lut, x)
    subG.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`)
    const depth = clamp((y - m.t) / ph) * Y_MAX
    const shown = depth > c.p.depth - 15 ? c.p.depth : Math.round(depth / 10) * 10
    const mins = Math.round(h * 60)
    readD.textContent = `${fmt(shown)} m`
    readT.textContent = `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`
    const left = x > m.l + pw - 96
    const ry = y < m.t + 30 ? y + 18 : y
    for (const t of [readD, readT]) {
      t.setAttribute('text-anchor', left ? 'end' : 'start')
      t.setAttribute('x', (x + (left ? -16 : 16)).toFixed(1))
    }
    readD.setAttribute('y', (ry - 2).toFixed(1))
    readT.setAttribute('y', (ry + 12).toFixed(1))
  }
  function restartSub() {
    st.t = 0
    loop?.kill()
    loop = null
    updateSub()
  }
  function updateSub() {
    if (!G) return
    const run = !reduced && inView && drawnAll && !document.hidden
    G.sub.classList.toggle('is-on', run)
    if (run) {
      if (!loop) {
        const hours = BY_ID[selected].hours
        loop = gsap.to(st, {
          t: 1,
          duration: 3 + hours * 0.95,
          ease: 'none',
          repeat: -1,
          repeatDelay: 0.8,
          onUpdate: placeSub,
          onRepeat: () => (st.t = 0),
        })
        placeSub()
      } else loop.resume()
    } else loop?.pause()
  }

  /* -------------------------------------------------------------- wiring */
  opts.forEach((b) =>
    b.addEventListener('click', () => {
      choose(b.dataset.pfOpt)
      if (G) ping(G.curves[b.dataset.pfOpt])
    }),
  )
  opts.forEach((b) =>
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') choose(b.dataset.pfOpt)
    }),
  )

  reserve?.addEventListener('click', () => {
    ctx.emit('select-profile', { id: selected })
    ctx.scrollTo('#reserve')
  })
  // stay in sync if another module chooses a profile (e.g. the form)
  ctx.on('select-profile', (d) => {
    if (d?.id && d.id !== selected) choose(d.id, { animate: true })
  })

  const io = new IntersectionObserver(
    ([entry]) => {
      inView = entry.isIntersecting
      updateSub()
    },
    { threshold: 0.05 },
  )
  io.observe(fig)
  document.addEventListener('visibilitychange', updateSub)

  build()
  syncDim()

  let rT
  let lastW = fig.clientWidth
  let lastH = fig.clientHeight
  const ro = new ResizeObserver(() => {
    const w = fig.clientWidth
    const h = fig.clientHeight
    if (Math.abs(w - lastW) < 1 && Math.abs(h - lastH) < 1) return
    lastW = w
    lastH = h
    clearTimeout(rT)
    rT = setTimeout(() => {
      loop?.kill()
      loop = null
      build()
      updateSub()
      if (!reduced) ScrollTrigger.refresh()
    }, 160)
  })
  ro.observe(fig)
}
