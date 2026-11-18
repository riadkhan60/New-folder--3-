/**
 * expedition.js — #expedition (6,000 → 8,000 m). The nine-day itinerary.
 *
 * Signature: a tether runs down the logbook. A lit signal travels down it,
 * always sitting on the centre line of the screen — the same probe depth.js
 * uses — and the tether behind it is drawn in red light (DrawSVG, scrubbed).
 * Each day lights up the moment the signal reaches it.
 *
 * On Day 6 the tether swings out to the right and back: the Hadal dive
 * profile turned on its side, time running down the page and depth running
 * across it (4 h down, up to 4 h on the floor, 4 h up). The shallow part of
 * that swing is blue-green, the deep part red, because that is where the
 * lamps change. A small readout rides beside the signal with the depth and
 * the elapsed dive time, and "10,935 m" compresses as the signal falls
 * towards it, then lights when the signal reaches the floor.
 *
 * Reduced motion: the tether is drawn, every day is lit, nothing moves.
 */
import '../styles/expedition.css'

const SVGNS = 'http://www.w3.org/2000/svg'
const MAX = 10935
const DIVE_HOURS = 12
const RED_FROM = 6000
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const fmt = (m) => Math.round(m).toLocaleString('en-US')

/* Polyline → path with rounded corners. `radii[i]` rounds point i. */
function roundedPath(pts, radii) {
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const [cx, cy] = pts[i + 1]
    const l1 = Math.hypot(ax - bx, ay - by)
    const l2 = Math.hypot(cx - bx, cy - by)
    const r = Math.min(radii[i] || 0, l1 / 2, l2 / 2)
    if (r < 0.5) {
      d += ` L${bx.toFixed(1)} ${by.toFixed(1)}`
      continue
    }
    const p1 = [bx + ((ax - bx) / l1) * r, by + ((ay - by) / l1) * r]
    const p2 = [bx + ((cx - bx) / l2) * r, by + ((cy - by) / l2) * r]
    d += ` L${p1[0].toFixed(1)} ${p1[1].toFixed(1)} Q${bx.toFixed(1)} ${by.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  const last = pts[pts.length - 1]
  return d + ` L${last[0].toFixed(1)} ${last[1].toFixed(1)}`
}

/* Sample a y-monotonic path into a lookup table: length, x and y. */
function sample(path, step = 3) {
  const total = path.getTotalLength()
  const n = Math.max(2, Math.ceil(total / step))
  const L = new Float32Array(n + 1)
  const X = new Float32Array(n + 1)
  const Y = new Float32Array(n + 1)
  let maxY = -Infinity
  for (let i = 0; i <= n; i++) {
    const l = (i / n) * total
    const p = path.getPointAtLength(l)
    L[i] = l
    X[i] = p.x
    maxY = Math.max(maxY, p.y) // force monotonic (guards float noise)
    Y[i] = maxY
  }
  return { total, L, X, Y, n }
}

/* For a y inside the sampled path, return { len, x } by binary search. */
function atY(lut, y) {
  const { L, X, Y, n } = lut
  if (y <= Y[0]) return { len: 0, x: X[0] }
  if (y >= Y[n]) return { len: L[n], x: X[n] }
  let lo = 0
  let hi = n
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (Y[mid] <= y) lo = mid
    else hi = mid
  }
  const span = Y[hi] - Y[lo]
  const t = span > 1e-4 ? (y - Y[lo]) / span : 0
  return { len: L[lo] + (L[hi] - L[lo]) * t, x: X[lo] + (X[hi] - X[lo]) * t }
}

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(SVGNS, name)
  for (const k in attrs) n.setAttribute(k, attrs[k])
  if (parent) parent.appendChild(n)
  return n
}

export function init(ctx) {
  const root = document.getElementById('expedition')
  if (!root) return
  const { gsap, ScrollTrigger } = ctx

  const log = root.querySelector('[data-exp-log]')
  const svg = root.querySelector('.exp__cable')
  const days = [...root.querySelectorAll('.exp__day')]
  const plunge = root.querySelector('[data-exp-plunge]')
  const deep = root.querySelector('[data-exp-deep]')
  const phases = [...root.querySelectorAll('[data-exp-phase]')]
  const readout = root.querySelector('.exp__readout')
  if (!log || !svg || !days.length || !plunge) return

  const reduced = ctx.reducedMotion
  if (reduced) root.classList.add('is-static')

  // Signal + readout live in the log's coordinate space.
  const signal = document.createElement('span')
  signal.className = 'exp__signal'
  signal.setAttribute('aria-hidden', 'true')
  if (!reduced) log.appendChild(signal)
  if (readout) log.appendChild(readout)
  const readD = readout?.querySelector('.exp__readout-d')
  const readT = readout?.querySelector('.exp__readout-t')

  /* ---------------------------------------------------------- sketches */
  const sketches = new Map()
  days.forEach((day) => {
    const fig = day.querySelector('.exp__sketch')
    if (!fig) return
    const draw = [...fig.querySelectorAll('.exp__sk-line, .exp__sk-contour, .exp__sk-mark, .exp__sk-port, .exp__sk-beams path')]
    const fade = [...fig.querySelectorAll('.exp__sk-faint, .exp__sk-route, .exp__sk-label')]
    if (!reduced) {
      if (draw.length) gsap.set(draw, { drawSVG: '0%' })
      if (fade.length) gsap.set(fade, { opacity: 0 })
    }
    sketches.set(day, { draw, fade, done: reduced })
  })
  function drawSketch(day) {
    const s = sketches.get(day)
    if (!s || s.done) return
    s.done = true
    if (s.draw.length) gsap.to(s.draw, { drawSVG: '100%', duration: 1.5, ease: 'power3.out', stagger: 0.045 })
    if (s.fade.length) gsap.to(s.fade, { opacity: 1, duration: 1.2, ease: 'power2.out', delay: 0.35, stagger: 0.06 })
  }

  /* ---------------------------------------------------------- geometry */
  let G = null
  let tl = null

  function measure() {
    const lr = log.getBoundingClientRect()
    const W = log.clientWidth
    const H = log.offsetHeight
    const nodes = days.map((day) => {
      const n = day.querySelector('.exp__node')
      const r = n.getBoundingClientRect()
      return { x: r.left + r.width / 2 - lr.left, y: r.top + r.height / 2 - lr.top }
    })
    const T = nodes[0].x
    const pr = plunge.getBoundingClientRect()
    const pTop = pr.top - lr.top
    const pBot = pr.bottom - lr.top
    const deepFrac = (parseFloat(getComputedStyle(plunge).getPropertyValue('--pl-deep')) || 88) / 100
    const D = pr.left - lr.left + pr.width * deepFrac
    const h = pBot - pTop
    return { W, H, T, D, pTop, pBot, h, nodes }
  }

  function build() {
    const g = measure()
    if (!g.H || !g.W) return
    const { W, H, T, D, pTop, pBot, h } = g
    const r0 = Math.min(56, h * 0.06)
    const rD = Math.min(90, h * 0.09)
    const yA1 = pTop - r0 // track A ends, plunge begins
    const yB0 = pBot + r0 // plunge ends, track B begins

    // Let the CSS place labels against the real line.
    plunge.style.setProperty('--pl-track', `${T.toFixed(1)}px`)
    plunge.style.setProperty('--pl-mid', `${((T + D) / 2).toFixed(1)}px`)

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.textContent = ''
    const defs = el('defs', {}, svg)
    const grad = el('linearGradient', { id: 'exp-plunge-grad', gradientUnits: 'userSpaceOnUse', x1: T, y1: 0, x2: D, y2: 0 }, defs)
    const f = RED_FROM / MAX
    ;[
      [0, 'var(--c-photophore)'],
      [f - 0.05, 'var(--c-photophore)'],
      [f + 0.05, 'var(--c-redlight)'],
      [1, 'var(--c-redlight)'],
    ].forEach(([o, c]) => el('stop', { offset: o, style: `stop-color:${c}` }, grad))

    const dA = `M${T} 0 L${T} ${yA1}`
    const dP = roundedPath(
      [
        [T, yA1],
        [T, pTop],
        [D, pTop + h / 3],
        [D, pTop + (2 * h) / 3],
        [T, pBot],
        [T, yB0],
      ],
      [0, r0, rD, rD, r0, 0],
    )
    const dB = `M${T} ${yB0} L${T} ${H}`

    // Faint full route, so the way ahead is always visible.
    el('path', { class: 'exp__c-base', d: `${dA} ${dP.replace(/^M[^L]+/, '')} L${T} ${H}` }, svg)

    // Depth scale above the swing: a tick per 1,000 m, depth running right.
    const ty = pTop - 18
    for (let m = 1000; m < MAX; m += 1000) {
      const x = T + ((D - T) * m) / MAX
      el('path', { class: `exp__c-tick${m === RED_FROM ? ' exp__c-tick--red' : ''}`, d: `M${x.toFixed(1)} ${ty} v${m === RED_FROM ? 10 : 5}` }, svg)
    }
    el('path', { class: 'exp__c-tick', d: `M${D.toFixed(1)} ${ty - 4} v14` }, svg)
    const label = (x, txt, cls = '', anchor = 'middle') => {
      const t = el('text', { class: `exp__c-label ${cls}`, x: x.toFixed(1), y: ty - 10, 'text-anchor': anchor }, svg)
      t.textContent = txt
    }
    label(T + 10, '0 m', '', 'start')
    label(T + ((D - T) * RED_FROM) / MAX, '6,000 m, red lamps on', 'exp__c-label--red')
    label(D, '10,935 m', '', 'end')

    const layers = ['halo', 'mid', 'core']
    const mk = (d, cls, stroke) =>
      layers.map((k) => {
        const p = el('path', { class: `exp__c-lit exp__c-lit--${k} ${cls}`, d }, svg)
        if (stroke) p.style.stroke = stroke
        return p
      })
    const segA = mk(dA, 'exp__c-track')
    const segP = mk(dP, 'exp__c-plunge', 'url(#exp-plunge-grad)')
    const segB = mk(dB, 'exp__c-track')
    const lut = sample(segP[2])

    G = { ...g, yA1, yB0, lut, segA, segP, segB, floorTop: pTop + h / 3, floorBot: pTop + (2 * h) / 3 }

    if (reduced) return
    makeTimeline()
  }

  /* --------------------------------------------------------- timeline */
  const lit = new Array(days.length).fill(false)
  let current = -1
  const phaseLit = phases.map(() => false)
  let floor = false
  let diving = false
  let shallow = false
  let lastDeepT = -1
  let readLeft = false

  function makeTimeline() {
    if (tl) {
      tl.scrollTrigger?.kill()
      tl.kill()
    }
    const { H, yA1, yB0, lut, segA, segP, segB } = G
    const pSpan = yB0 - yA1
    const plEase = (p) => atY(lut, yA1 + p * pSpan).len / lut.total

    tl = gsap.timeline({
      defaults: { ease: 'none' },
      onUpdate: () => paint(tl.time()),
      scrollTrigger: {
        trigger: log,
        start: 'top center',
        end: 'bottom center',
        scrub: 0.45,
        onToggle: (self) => log.classList.toggle('is-live', self.isActive),
      },
    })
    // Time is measured in pixels of tether: tl.time() is the signal's y.
    tl.fromTo(segA, { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: Math.max(1, yA1) }, 0)
    tl.fromTo(segP, { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: pSpan, ease: plEase }, yA1)
    tl.fromTo(segB, { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: Math.max(1, H - yB0) }, yB0)
    paint(tl.time())
  }

  function paint(y) {
    if (!G) return
    const { T, D, yA1, yB0, lut, nodes, pTop, h, floorTop, W } = G

    // the signal
    let x = T
    if (y > yA1 && y < yB0) x = atY(lut, y).x
    signal.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`

    // days
    let cur = -1
    for (let i = 0; i < nodes.length; i++) {
      const on = y >= nodes[i].y - 1
      if (on) cur = i
      if (on !== lit[i]) {
        lit[i] = on
        days[i].classList.toggle('is-lit', on)
        if (on) drawSketch(days[i])
      }
    }
    if (cur !== current) {
      if (current >= 0) days[current].classList.remove('is-current')
      if (cur >= 0) days[cur].classList.add('is-current')
      current = cur
    }

    // Day 6: phases, the floor, the compressing figure
    const pt = [pTop, floorTop, pTop + (2 * h) / 3]
    phases.forEach((p, i) => {
      const on = y >= pt[i]
      if (on !== phaseLit[i]) {
        phaseLit[i] = on
        p.classList.toggle('is-lit', on)
      }
    })
    const onFloor = y >= floorTop
    if (onFloor !== floor) {
      floor = onFloor
      plunge.classList.toggle('is-floor', onFloor)
    }
    if (deep) {
      const t = Math.round(clamp((y - (pTop - h * 0.12)) / (floorTop - (pTop - h * 0.12))) * 100) / 100
      if (t !== lastDeepT) {
        lastDeepT = t
        const e = 1 - Math.pow(1 - t, 2)
        deep.style.setProperty('--deep-wdth', (118 - 68 * e).toFixed(1))
        deep.style.setProperty('--deep-wght', Math.round(300 + 560 * e))
        deep.style.setProperty('--deep-t', t)
      }
    }

    // readout beside the signal while it is on the swing
    const inDive = y > pTop - 2 && y < G.pBot + 2
    if (inDive !== diving) {
      diving = inDive
      plunge.classList.toggle('is-diving', inDive)
      readout?.classList.toggle('is-on', inDive)
    }
    const depthM = clamp((x - T) / (D - T)) * MAX
    const isShallow = inDive && depthM < RED_FROM
    if (isShallow !== shallow) {
      shallow = isShallow
      signal.classList.toggle('is-shallow', isShallow)
    }
    if (inDive && readout) {
      // keep the readout on the open side of the line (inside the swing on phones)
      const left = x > W - 190 || (W < 560 && x > 150)
      if (left !== readLeft) {
        readLeft = left
        readout.classList.toggle('is-left', left)
      }
      readout.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      const mins = Math.round(clamp((y - pTop) / h) * DIVE_HOURS * 60)
      readD.textContent = `${fmt(depthM > MAX - 12 ? MAX : Math.round(depthM / 10) * 10)} m`
      readT.textContent = `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`
    }
  }

  /* ---------------------------------------------------------- lifecycle */
  build()

  let rT
  const rebuild = () => {
    clearTimeout(rT)
    rT = setTimeout(() => {
      build()
      if (!reduced) ScrollTrigger.refresh()
    }, 160)
  }
  let lastW = log.clientWidth
  let lastH = log.offsetHeight
  const ro = new ResizeObserver(() => {
    const w = log.clientWidth
    const hh = log.offsetHeight
    if (w === lastW && hh === lastH) return
    lastW = w
    lastH = hh
    rebuild()
  })
  ro.observe(log)
  document.fonts?.ready?.then(() => build())
}
