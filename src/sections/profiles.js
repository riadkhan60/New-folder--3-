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
 * Then, while the stage holds (on phones, the chart alone is held centred in
 * its track), a small submersible rides the chosen profile with your scroll. The water it has passed through fills in behind it in the
 * real colours of the water column (depth.js colorAt: teal → black), and the
 * animals you would meet on that line (the ones from #life, and the hadal
 * ones) light up as it reaches them.
 *
 * Choosing: hover only previews (the line and its row light up); a click,
 * Enter/Space, or the arrow keys commit. "Reserve a dive" always sends the
 * committed profile (`select-profile`) and scrolls to #reserve. Only a commit
 * is announced, through a short visually hidden status line.
 *
 * Reduced motion: curves fully drawn, water filled, no sticky stage, no sub.
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
    see: 'The blue light thins and goes out. In the dark, lanternfish, siphonophores and comb jellies make their own light, and the dive spends long, slow minutes among them.',
    // hours, metres: a slow descent with a pause among the lanternfish
    pts: [[0, 0], [0.75, 540], [1.15, 590], [1.7, 1000], [3.4, 1000], [5, 0]],
    r: [0, 22, 18, 26, 26, 0],
    tagAt: 1.95,
    tagAnchor: 'start',
    pins: [{ h: 1.45, label: 'Vampire squid' }],
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
    see: 'After two hours of descent, a floor of fine mud runs flat past the edge of the lamps. Grenadier fish cruise just above it, past the winding tracks of sea cucumbers.',
    pts: [[0, 0], [2, 5500], [7, 5500], [9, 0]],
    r: [0, 34, 34, 0],
    tagAt: 4.7,
    pins: [
      { h: 0.8, label: 'Atolla jellyfish' },
      { h: 4.4, label: 'Sea cucumbers', pos: 'above' },
    ],
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
    see: 'Snailfish, the deepest-living fish known, keep to the trench walls down to about 8,000\u00a0m. On the floor, amphipods crowd the bait under the red lamps, and xenophyophores, single cells as wide as your hand, rest on the mud.',
    pts: [[0, 0], [4, 10935], [8, 10935], [12, 0]],
    r: [0, 40, 40, 0],
    tagAt: 6.4,
    pins: [
      { h: 2.93, label: 'Snailfish' },
      { h: 4.9, label: 'Amphipods', pos: 'below' },
    ],
  },
]
const BY_ID = Object.fromEntries(PROFILES.map((p) => [p.id, p]))

// [start, end] of each piece within the scrubbed timeline (0–1)
const WINDOWS = { twilight: [0.04, 0.2], abyss: [0.14, 0.34], hadal: [0.26, 0.5] }
const RIDE = [0.53, 0.97]
const DRAW_EASE = 'power1.inOut'

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

/* Lookup by x (time is monotonic along a profile), sampled at equal steps
   of length so a length along the line is just an index. */
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
  return { X, Y, n, total }
}
// length along the line at time-x
function sAtX(lut, x) {
  const { X, n, total } = lut
  if (x <= X[0]) return 0
  if (x >= X[n]) return total
  let lo = 0
  let hi = n
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (X[mid] <= x) lo = mid
    else hi = mid
  }
  const span = X[hi] - X[lo]
  return ((lo + (span > 1e-4 ? (x - X[lo]) / span : 0)) / n) * total
}
// point at a length along the line
function atS(lut, s) {
  const { X, Y, n, total } = lut
  const f = clamp(s / total) * n
  const i = Math.min(n - 1, Math.floor(f))
  const t = f - i
  return { x: X[i] + (X[i + 1] - X[i]) * t, y: Y[i] + (Y[i + 1] - Y[i]) * t }
}
// a lit segment [s - len, s] of a path, as a dash
function dashTo(path, s, len, total) {
  path.style.strokeDasharray = `${len.toFixed(1)} ${(total + len + 10).toFixed(1)}`
  path.style.strokeDashoffset = (len - s).toFixed(1)
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

const hit = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

export function init(ctx) {
  const root = document.getElementById('dives')
  if (!root) return
  const { gsap } = ctx
  const reduced = ctx.reducedMotion

  const fig = root.querySelector('[data-pf-chart]')
  const track = root.querySelector('[data-pf-track]')
  const svg = root.querySelector('.pf__svg')
  const list = root.querySelector('[data-pf-list]')
  const opts = [...root.querySelectorAll('[data-pf-opt]')]
  const panel = root.querySelector('[data-pf-panel]')
  const inner = root.querySelector('[data-pf-inner]')
  const reserve = root.querySelector('[data-pf-reserve]')
  const status = root.querySelector('[data-pf-status]')
  const hint = root.querySelector('[data-pf-hint]')
  const hintText = root.querySelector('[data-pf-hint-text]')
  const hintHome = hint?.parentElement
  const field = (k) => root.querySelector(`[data-pf="${k}"]`)
  const F = {
    name: field('name'),
    where: field('where'),
    depth: field('depth'),
    dive: field('dive'),
    trip: field('trip'),
    seats: field('seats'),
    see: field('see'),
    price: field('price'),
    reserveName: field('reserve-name'),
  }
  if (!fig || !svg) return
  if (reduced) root.classList.add('is-static')
  if (hintText && ctx.isTouch) hintText.textContent = 'Tap a line to read it out'

  let selected = 'hadal' // the committed choice: the only one Reserve sends
  let peek = null // what the pointer is hovering (a preview, never sent)
  let touched = false // the visitor has committed a choice
  let G = null
  let tl = null
  let drawnAll = reduced
  let ride = reduced ? 1 : 0
  const drawnState = { twilight: false, abyss: false, hadal: false }
  const colorAt = ctx.depth?.colorAt

  /* --------------------------------------------------------------- panel */
  let panelTl = null
  function fillPanel(p) {
    F.name.textContent = p.name
    F.where.textContent = p.where
    F.depth.textContent = `${fmt(p.depth)} m`
    F.dive.textContent = `${p.hours} hours`
    F.trip.textContent = p.trip
    F.seats.textContent = String(p.seats)
    F.see.textContent = p.see
    F.price.textContent = p.price
    F.reserveName.textContent = ` on the ${p.name} profile`
  }
  // The price arrives under pressure: set wide and light, it is squeezed
  // narrow and heavy, like every headline at this depth (font axes only).
  let squeezeTw = null
  function squeeze(delay = 0) {
    if (reduced || !F.price) return
    squeezeTw?.kill()
    squeezeTw = gsap.fromTo(F.price, { '--pf-sq': 1 }, { '--pf-sq': 0, duration: 1.5, delay, ease: 'expo.out' })
  }
  function renderPanel(p, animate) {
    panel.dataset.profile = p.id
    if (!animate || reduced) {
      fillPanel(p)
      return
    }
    panelTl?.kill()
    panelTl = gsap
      .timeline()
      .to(inner, { opacity: 0, y: -6, duration: 0.16, ease: 'power2.in', onComplete: () => fillPanel(p) })
      .add(() => squeeze())
      .to(inner, { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out' })
  }

  /* ------------------------------------------------------------ selection */
  function select(id, { animate = true, focus = false, announce = false } = {}) {
    if (!BY_ID[id]) return
    const changed = id !== selected
    const from = changed && G ? subXY() : null
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
      if (from && animate && !reduced) glideFrom(from)
      else placeSub()
      if (animate && G) sweep(G.curves[id])
    }
    if (announce && status) {
      const p = BY_ID[id]
      status.textContent = `${p.name} selected: ${fmt(p.depth)} metres, ${p.hours}-hour dive, ${p.price} per guest.`
    }
  }

  // commit a choice (click, Enter/Space, arrow keys, or the form)
  function choose(id, o = {}) {
    touched = true
    select(id, { announce: true, ...o })
    syncDim()
  }

  // hover preview: light the line and its row, change nothing else
  function setPeek(id) {
    if (id === peek) return
    peek = id
    opts.forEach((b) => b.classList.toggle('is-peek', b.dataset.pfOpt === id))
    if (G) for (const c of Object.values(G.curves)) c.g.classList.toggle('is-peek', c.id === id)
    svg.classList.toggle('has-peek', !!id)
  }

  /* ---------------------------------------------------------------- chart */
  function build() {
    const W = Math.round(fig.clientWidth)
    const H = Math.round(fig.clientHeight)
    if (W < 40 || H < 40) return
    const narrow = W < 520
    const m = { t: 34, r: narrow ? 90 : 104, b: 30, l: 6 }
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
    // the hot filament down the centre of the Hadal line
    const hh = el('linearGradient', { id: 'pf-hadal-hot', gradientUnits: 'userSpaceOnUse', x1: 0, y1: Y(RED_FROM - 500), x2: 0, y2: Y(RED_FROM + 500) }, defs)
    el('stop', { offset: 0, style: 'stop-color:var(--pf-hot-twilight)' }, hh)
    el('stop', { offset: 1, style: 'stop-color:var(--pf-hot-hadal)' }, hh)
    // soft points of light (the drawing tip, the lamp): one per light colour
    for (const [id, c] of [['twilight', '--pf-twilight'], ['abyss', '--pf-abyss'], ['red', '--pf-hadal']]) {
      const rg = el('radialGradient', { id: `pf-glow-${id}` }, defs)
      el('stop', { offset: 0, style: `stop-color:var(${c});stop-opacity:0.75` }, rg)
      el('stop', { offset: 0.35, style: `stop-color:var(${c});stop-opacity:0.22` }, rg)
      el('stop', { offset: 1, style: `stop-color:var(${c});stop-opacity:0` }, rg)
    }
    // Vesper's lamp beam: white above 6,000 m, red below
    for (const [id, c] of [['white', 'var(--c-ink)'], ['red', 'var(--pf-hadal)']]) {
      const bg = el('linearGradient', { id: `pf-beam-${id}`, x1: 0, y1: 0, x2: 1, y2: 0.7 }, defs)
      el('stop', { offset: 0, style: `stop-color:${c};stop-opacity:0.55` }, bg)
      el('stop', { offset: 1, style: `stop-color:${c};stop-opacity:0` }, bg)
    }
    // the water column itself, in the colours depth.js paints the page with
    const wg = el('linearGradient', { id: 'pf-water', gradientUnits: 'userSpaceOnUse', x1: 0, y1: Y(0), x2: 0, y2: Y(Y_MAX) }, defs)
    for (const d of [0, 90, 200, 550, 1000, 2200, 4000, 6000, 8000, 10935]) {
      const c = colorAt ? colorAt(d).css : 'rgb(4 20 44)'
      el('stop', { offset: (d / Y_MAX).toFixed(4), style: `stop-color:${c};stop-opacity:${d < 1000 ? 0.92 : 0.85}` }, wg)
    }
    // a thin wash of lamp light on top of the water, so the deep end of a
    // filled profile still reads against a black page
    const lg = el('linearGradient', { id: 'pf-lamp', gradientUnits: 'userSpaceOnUse', x1: 0, y1: Y(0), x2: 0, y2: Y(Y_MAX) }, defs)
    el('stop', { offset: 0, style: 'stop-color:var(--pf-sel);stop-opacity:0' }, lg)
    el('stop', { offset: 1, style: 'stop-color:var(--pf-sel);stop-opacity:0.2' }, lg)
    // The water fills in behind the sub, its leading edge soft like light
    // falling off in water (a luminance mask with a gradient edge).
    const fade = el('linearGradient', { id: 'pf-ride-fade', gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: 1, y2: 0 }, defs)
    el('stop', { offset: 0, 'stop-color': '#fff' }, fade)
    el('stop', { offset: 1, 'stop-color': '#000' }, fade)
    const mask = el('mask', { id: 'pf-ride-mask', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H }, defs)
    const clipRect = el('rect', { x: 0, y: 0, width: reduced ? W : 0, height: H, fill: reduced ? '#fff' : 'url(#pf-ride-fade)' }, mask)
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
          'aria-label': `${p.name}: ${fmt(p.depth)} metres, ${p.hours}-hour dive, ${parseInt(p.trip)}-day trip, ${p.price} per guest`,
        },
        curvesG,
      )
      const area = el('g', { class: 'pf__area', mask: 'url(#pf-ride-mask)' }, g)
      el('path', { d: `${d} Z`, fill: 'url(#pf-water)' }, area)
      el('path', { d: `${d} Z`, fill: 'url(#pf-lamp)' }, area)
      // Luminous line: a wide bloom, the halo, the line, a hot filament.
      const bloom = el('path', { class: 'pf__bloom', d }, g)
      const halo = el('path', { class: 'pf__halo', d }, g)
      const line = el('path', { class: 'pf__line', d }, g)
      const fil = el('path', { class: 'pf__fil', d }, g)
      // the wake of light behind the sub, and the sweep that runs along a
      // line when it is chosen (dashes, placed by placeSub / sweep)
      const wake = ['wide', 'mid', 'core'].map((k) => el('path', { class: `pf__wake pf__wake--${k}`, d }, g))
      const sweepP = ['wide', 'core'].map((k) => el('path', { class: `pf__sweep pf__sweep--${k}`, d }, g))
      if (p.id === 'hadal') {
        for (const q of [bloom, halo, line, wake[0], wake[1], sweepP[0]]) q.style.stroke = 'url(#pf-hadal-grad)'
        for (const q of [fil, wake[2], sweepP[1]]) q.style.stroke = 'url(#pf-hadal-hot)'
      }
      el('path', { class: 'pf__focus', d }, g)
      el('path', { class: 'pf__hit', d }, g)
      // the point of light that draws the line as you sink
      const tip = el('g', { class: 'pf__tip', 'aria-hidden': 'true' }, g)
      el('circle', { class: 'pf__tip-glow', r: 18 }, tip)
      el('circle', { class: 'pf__tip-core', r: 2.1 }, tip)

      // name + depth beside the floor
      const fx = X(p.tagAt)
      const above = p.id === 'hadal'
      const fy = Y(p.depth) + (above ? -14 : 22)
      const tag = el('g', { class: 'pf__tag', 'aria-hidden': 'true' }, g)
      const tn = el('text', { class: 'pf__tag-name', x: fx, y: fy, 'text-anchor': p.tagAnchor || 'middle' }, tag)
      tn.textContent = p.name
      const td = el('tspan', { class: 'pf__tag-depth', dx: 8 }, tn)
      td.textContent = `${fmt(p.depth)} m`

      curves[p.id] = { id: p.id, g, line, halo, bloom, fil, wake, sweepP, tip, area, tag, tn, lut: null, p, pins: [] }
    }
    for (const c of Object.values(curves)) {
      c.lut = sampleX(c.line)
      if (reduced) continue
      // the sweep and the wake are dashes: nothing shows until they are placed
      for (const q of [...c.sweepP, ...c.wake]) dashTo(q, 0, 0, c.lut.total)
    }

    /* what you meet along each line (shown for the chosen one) */
    for (const c of Object.values(curves)) {
      const pg = el('g', { class: 'pf__pins', 'aria-hidden': 'true' }, c.g)
      for (const pin of c.p.pins || []) {
        const x = X(pin.h)
        const y = yAtX(c.lut, x)
        const g = el('g', { class: 'pf__pin' }, pg)
        el('circle', { class: 'pf__pin-dot', cx: x.toFixed(1), cy: y.toFixed(1), r: 3 }, g)
        const pos = pin.pos || 'right'
        const t = el(
          'text',
          {
            class: 'pf__pin-label',
            x: (pos === 'right' ? x + 9 : x).toFixed(1),
            y: (pos === 'above' ? y - 10 : pos === 'below' ? y + 18 : y + 4).toFixed(1),
            'text-anchor': pos === 'right' ? 'start' : 'middle',
          },
          g,
        )
        t.textContent = pin.label
        c.pins.push({ h: pin.h, g, t, box: null, passed: null, hidden: false })
      }
    }

    /* the little sub, and the edge of the water behind it */
    const scan = el('line', { class: 'pf__scan', 'aria-hidden': 'true', x1: 0, x2: 0, y1: Y(0), y2: Y(Y_MAX) }, svg)
    const sub = el('g', { class: 'pf__sub', 'aria-hidden': 'true' }, svg)
    const subG = el('g', {}, sub)
    el('circle', { class: 'pf__sub-glow', r: 30 }, subG)
    // Vesper side on, nose to the right (time runs right): her lamps throw
    // a cone of light ahead and down, white above 6,000 m and red below
    el('path', { class: 'pf__sub-beam', d: 'M8.5 2.6 L46 10 Q47 25 34 38 Z' }, subG)
    el('path', { class: 'pf__sub-fin', d: 'M-9.5 -1.4 L-14.5 -5 Q-15.3 0 -14.5 5 L-9.5 1.4 Z' }, subG)
    el('path', { class: 'pf__sub-body', d: 'M-10 0 C-10 -3.6 -7.4 -5 -3 -5 L3.5 -5 C8.4 -5 10.6 -2.6 10.6 0.2 C10.6 3.2 8 4.8 3.2 4.8 L-3 4.8 C-7.4 4.8 -10 3.6 -10 0 Z' }, subG)
    el('rect', { class: 'pf__sub-body', x: -5.2, y: -8, width: 6.2, height: 3.6, rx: 1.4 }, subG)
    el('circle', { class: 'pf__sub-port', cx: 6.4, cy: 0.2, r: 1.7 }, subG)
    el('circle', { class: 'pf__sub-lamp', cx: 8.6, cy: 2.8, r: 1.05 }, subG)
    const readD = el('text', { class: 'pf__sub-read', x: 18, y: -2 }, sub)
    const readT = el('text', { class: 'pf__sub-read pf__sub-read--t', x: 18, y: 12 }, sub)

    G = { W, H, m, pw, ph, X, Y, curves, sub, subG, scan, readD, readT, clipRect, fade }
    for (const id in drawnState) drawnState[id] = false // fresh DOM: re-apply classes

    // label boxes for collision checks (measured once per build)
    for (const c of Object.values(curves)) {
      c.tagBox = safeBox(c.tn)
      c.tagHidden = false
      for (const pin of c.pins) pin.box = safeBox(pin.t)
    }

    /* events */
    for (const c of Object.values(curves)) {
      c.g.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse') setPeek(c.id)
      })
      c.g.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse' && peek === c.id) setPeek(null)
      })
      c.g.addEventListener('click', () => {
        choose(c.id)
        ping(c)
      })
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
    setPeek(peek)
    makeTimeline()
    syncDim()
    placeSub()
  }

  function safeBox(t) {
    try {
      const b = t.getBBox()
      return { x: b.x - 3, y: b.y - 2, width: b.width + 6, height: b.height + 4 }
    } catch {
      return null
    }
  }

  // While the lines are drawing, all of them burn at full strength; once the
  // last one lands (or the visitor chooses), the unselected ones step back.
  function syncDim() {
    svg.classList.toggle('has-sel', reduced || drawnAll || touched)
    hint?.classList.toggle('is-on', drawnAll && !touched)
  }

  function ping(c) {
    const r = c.g.getBoundingClientRect()
    ctx.emit('sonar', { x: r.left + r.width / 2, y: r.top + r.height / 2, strength: 0.35 })
  }

  // a chosen line answers with a run of light from the surface to the end
  function sweep(c) {
    if (reduced || !c?.lut || !drawnState[c.id]) return
    const total = c.lut.total
    const o = { s: 0 }
    gsap.killTweensOf(c.sweepP)
    gsap.fromTo(c.sweepP, { opacity: 1 }, { opacity: 0, duration: 0.5, delay: 1.05, ease: 'power2.in' })
    c.sweepTw?.kill()
    c.sweepTw = gsap.to(o, {
      s: total + 40,
      duration: 1.5,
      ease: 'power2.inOut',
      onUpdate: () => {
        dashTo(c.sweepP[0], o.s, 120, total)
        dashTo(c.sweepP[1], o.s, 46, total)
      },
    })
  }

  /* ----------------------------------------------------------- draw on scroll */
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

    // Desktop: the whole stage is sticky inside a tall section. Phones: the
    // chart alone is held centred in its track while the sub rides, then
    // scrolls on before the list and the price. Otherwise: the figure.
    const stage = getComputedStyle(root.querySelector('.pf')).position === 'sticky'
    const held = !stage && !!track && getComputedStyle(fig).position === 'sticky'
    // while the chart is held, the "choose a line" hint hangs under it
    // (the header has long scrolled away by the time the lines are drawn)
    if (hint && hintHome) {
      const home = held ? fig : hintHome
      if (hint.parentElement !== home) home.appendChild(hint)
    }
    tl = gsap.timeline({
      defaults: { ease: 'none' },
      onUpdate: () => {
        const t = tl.progress()
        for (const id in WINDOWS) setDrawn(id, t >= WINDOWS[id][1] - 0.005)
        drawTips(t)
        const all = t >= WINDOWS.hadal[1] - 0.005
        if (all !== drawnAll) {
          drawnAll = all
          syncDim()
        }
        ride = clamp((t - RIDE[0]) / (RIDE[1] - RIDE[0]))
        placeSub()
      },
      scrollTrigger: stage
        ? { trigger: root, start: 'top 55%', end: 'bottom bottom', scrub: 0.6 }
        : held
          ? { trigger: track, start: 'top 85%', end: 'bottom bottom', scrub: 0.6 }
          : {
              trigger: fig,
              start: 'top 82%',
              // when the chart is short enough, finish the ride before its
              // top leaves the screen, so the whole ride is seen
              end: () => (fig.offsetHeight <= window.innerHeight * 0.56 ? 'top 10%' : 'bottom 22%'),
              invalidateOnRefresh: true,
              scrub: 0.6,
            },
    })
    tl.fromTo(grid, { opacity: 0 }, { opacity: 1, duration: 0.08 }, 0)
    for (const p of PROFILES) {
      const c = curves[p.id]
      const [a, b] = WINDOWS[p.id]
      tl.fromTo([c.bloom, c.halo, c.line, c.fil], { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: b - a, ease: DRAW_EASE }, a)
      tl.fromTo(c.tag, { opacity: 0 }, { opacity: 1, duration: 0.04 }, b - 0.03)
    }
    tl.to({}, { duration: 0.03 }, 0.97) // the stage holds for the ride
    gsap.set(tags, { opacity: 0 })
    tl.progress(0).progress(tl.scrollTrigger ? tl.scrollTrigger.progress : 0)
  }

  // the point of light at the end of each line while it draws
  const drawEase = gsap.parseEase(DRAW_EASE)
  function drawTips(t) {
    if (!G) return
    for (const id in WINDOWS) {
      const c = G.curves[id]
      const [a, b] = WINDOWS[id]
      const k = (t - a) / (b - a)
      const on = k > 0.004 && k < 0.996
      if (on !== c.tipOn) {
        c.tipOn = on
        c.tip.classList.toggle('is-on', on)
      }
      if (!on) continue
      const pt = atS(c.lut, drawEase(k) * c.lut.total)
      c.tip.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`)
      const red = (pt.y - G.m.t) / G.ph * Y_MAX >= RED_FROM
      if (red !== c.tipRed) {
        c.tipRed = red
        c.tip.classList.toggle('is-red', red)
      }
    }
  }

  /* ------------------------------------------------------------ the sub */
  // The sub rides the committed profile with the scroll. Switching profiles
  // glides it across from where it was.
  const glide = { k: 0, x: 0, y: 0 }
  let glideTw = null
  function subXY() {
    const c = G.curves[selected]
    const x = G.X(ride * c.p.hours)
    return { x, y: yAtX(c.lut, x) }
  }
  function glideFrom(from) {
    glideTw?.kill()
    glide.k = 1
    glide.x = from.x
    glide.y = from.y
    glideTw = gsap.to(glide, { k: 0, duration: 0.9, ease: 'expo.out', onUpdate: placeSub })
    placeSub()
  }

  function placeSub() {
    if (!G) return
    const c = G.curves[selected]
    const { X, m, pw, ph, subG, sub, scan, readD, readT, clipRect, fade, curves } = G
    const on = !reduced && drawnAll
    if (on !== G.subOn) {
      G.subOn = on
      sub.classList.toggle('is-on', on)
    }
    const scanOn = on && ride > 0.003 && ride < 0.997
    if (scanOn !== G.scanOn) {
      G.scanOn = scanOn
      scan.classList.toggle('is-on', scanOn)
    }

    // the water fills in behind the sub (all of it when there is no sub)
    const h = ride * c.p.hours
    let x = X(h)
    let y = yAtX(c.lut, x)
    if (!reduced) {
      // a soft leading edge, closing up as the ride ends
      const soft = 64 * (1 - Math.pow(ride, 6))
      clipRect.setAttribute('width', Math.max(0, x + 1).toFixed(1))
      fade.setAttribute('x1', (x - soft).toFixed(1))
      fade.setAttribute('x2', (x + 1).toFixed(1))
    }
    if (scanOn) {
      scan.setAttribute('x1', x.toFixed(1))
      scan.setAttribute('x2', x.toFixed(1))
      scan.setAttribute('y2', G.Y(c.p.depth).toFixed(1))
    }

    // animals along the chosen line light up as the sub reaches them
    for (const cc of Object.values(curves)) {
      for (const pin of cc.pins) {
        const passed = reduced || (cc === c && ride > 0 && h >= pin.h - 0.02)
        if (passed !== pin.passed) {
          pin.passed = passed
          pin.g.classList.toggle('is-passed', passed)
        }
      }
    }
    // the wake of light the sub leaves along the line behind it
    const waking = on && glide.k < 0.02 && ride > 0.004 && ride < 0.996
    if (waking !== G.waking) {
      G.waking = waking
      svg.classList.toggle('has-wake', waking)
    }
    if (waking) {
      const sNow = sAtX(c.lut, x)
      const total = c.lut.total
      dashTo(c.wake[0], sNow, 150, total)
      dashTo(c.wake[1], sNow, 80, total)
      dashTo(c.wake[2], sNow, 34, total)
    }
    if (!on) {
      setHidden(c, null)
      return
    }

    if (glide.k > 0) {
      x = x + (glide.x - x) * glide.k
      y = y + (glide.y - y) * glide.k
    }
    subG.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`)
    const depth = clamp((y - m.t) / ph) * Y_MAX
    // below 6,000 m Vesper's lamps are red
    const red = depth >= RED_FROM
    if (red !== G.subRed) {
      G.subRed = red
      sub.classList.toggle('is-red', red)
    }
    const shown = depth > c.p.depth - 15 ? c.p.depth : Math.round(depth / 10) * 10
    const mins = Math.round(h * 60)
    readD.textContent = `${fmt(shown)} m`
    readT.textContent = `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`

    // readout sits above the sub (below it near the surface), on the open side
    const left = x > m.l + pw - 92
    const below = y < m.t + 34
    const rx = x + (left ? -18 : 18)
    const y1 = below ? y + 22 : y - 22
    for (const t of [readD, readT]) {
      t.setAttribute('text-anchor', left ? 'end' : 'start')
      t.setAttribute('x', rx.toFixed(1))
    }
    readD.setAttribute('y', y1.toFixed(1))
    readT.setAttribute('y', (y1 + 13).toFixed(1))
    const box = { x: left ? rx - 74 : rx, y: y1 - 11, width: 74, height: 28 }
    setHidden(c, box)
  }

  // a label under the moving readout steps back while it passes
  function setHidden(c, box) {
    for (const cc of Object.values(G.curves)) {
      const tagOff = !!box && !!cc.tagBox && hit(box, cc.tagBox)
      if (tagOff !== cc.tagHidden) {
        cc.tagHidden = tagOff
        cc.tag.classList.toggle('is-under', tagOff)
      }
      for (const pin of cc.pins) {
        const off = !!box && cc === c && !!pin.box && hit(box, pin.box)
        if (off !== pin.hidden) {
          pin.hidden = off
          pin.g.classList.toggle('is-under', off)
        }
      }
    }
  }

  /* -------------------------------------------------------------- wiring */
  opts.forEach((b) => {
    const id = b.dataset.pfOpt
    b.addEventListener('click', () => {
      choose(id)
      if (G) ping(G.curves[id])
    })
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') setPeek(id)
    })
    b.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && peek === id) setPeek(null)
    })
  })
  list?.addEventListener('pointerleave', () => setPeek(null))
  svg.addEventListener('pointerleave', () => setPeek(null))

  reserve?.addEventListener('click', () => {
    setPeek(null)
    ctx.emit('select-profile', { id: selected })
    ctx.scrollTo('#reserve')
  })
  // stay in sync if another module chooses a profile (e.g. the form)
  ctx.on('select-profile', (d) => {
    if (d?.id && d.id !== selected) choose(d.id, { animate: true })
  })

  build()
  syncDim()

  // A new chart size only changes what is drawn inside the figure: rebuilding
  // our own timeline is enough (its new ScrollTrigger measures itself), and
  // ScrollTrigger's own resize refresh covers the rest of the page. No global
  // refresh from here: one resize must not refresh the whole page twice.
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
    rT = setTimeout(build, 160)
  })
  ro.observe(fig)
  document.fonts?.ready?.then(() => {
    // label boxes depend on the webfont's metrics
    if (!G) return
    for (const c of Object.values(G.curves)) {
      c.tagBox = safeBox(c.tn)
      for (const pin of c.pins) pin.box = safeBox(pin.t)
    }
  })
}
