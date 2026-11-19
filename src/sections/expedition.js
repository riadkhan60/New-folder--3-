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
 * lamps change. The dive clock rises into view and counts the twelve hours
 * with the signal, squeezed narrower and heavier as Vesper goes deeper and
 * released again on the way up (the site's pressure compression, in one
 * figure). The big figure is time, not depth: the profile shape belongs to
 * #dives and the 10,935 m figure to the finale. A small readout rides beside
 * the signal with Vesper's depth ("on the floor" at the bottom), clear of the
 * sloping line and stepping round the phase captions so they never collide.
 * On phones, where the clock comes to rest right beside the floor, the
 * readout bows out while Vesper is on the floor.
 *
 * The section opens with the switch to red lamps. When the dive crosses
 * 6,000 m going down, Vesper's lamp head (22 LEDs) flickers white, goes dark
 * for a beat, and comes back red, LED by LED, while a wash of red light
 * blooms across the water from it. Going back up it quietly returns to white.
 *
 * Reduced motion: the tether is drawn, every day is lit, the lamps are red,
 * nothing moves.
 */
import '../styles/expedition.css'

const SVGNS = 'http://www.w3.org/2000/svg'
const MAX = 10935
const DIVE_HOURS = 12
const FLOOR = 'on the floor'
const RED_FROM = 6000
const SWITCH_AT = 6005 // the lamp moment plays as the HUD reads past 6,000 m
const LEDS = 22
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

const hit = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(SVGNS, name)
  for (const k in attrs) n.setAttribute(k, attrs[k])
  if (parent) parent.appendChild(n)
  return n
}

export function init(ctx) {
  const root = document.getElementById('expedition')
  if (!root) return
  const { gsap } = ctx

  const log = root.querySelector('[data-exp-log]')
  const svg = root.querySelector('.exp__cable')
  const days = [...root.querySelectorAll('.exp__day')]
  const plunge = root.querySelector('[data-exp-plunge]')
  const clock = root.querySelector('[data-exp-clock]')
  const clockH = root.querySelector('[data-exp-clock-h]')
  const clockM = root.querySelector('[data-exp-clock-m]')
  const phases = [...root.querySelectorAll('[data-exp-phase]')]
  const readout = root.querySelector('.exp__readout')
  if (!log || !svg || !days.length || !plunge) return

  const reduced = ctx.reducedMotion
  if (reduced) {
    root.classList.add('is-static')
    clock?.classList.add('is-red') // the whole dive, at its deepest
  }

  // Signal + readout live in the log's coordinate space.
  const signal = document.createElement('span')
  signal.className = 'exp__signal'
  signal.setAttribute('aria-hidden', 'true')
  if (!reduced) log.appendChild(signal)
  if (readout) log.appendChild(readout)
  const readD = readout?.querySelector('.exp__readout-d')

  /* ------------------------------------------- the red-light switch */
  const lamps = root.querySelector('[data-exp-lamps]')
  const lampSvg = lamps?.querySelector('.exp__lamp-svg')
  const lampGlow = lamps?.querySelector('.exp__lamp-glow')
  const wash = root.querySelector('.exp__wash')
  const leds = []
  if (lampSvg) {
    el('circle', { class: 'exp__lamp-housing', cx: 40, cy: 40, r: 38 }, lampSvg)
    el('circle', { class: 'exp__lamp-bezel', cx: 40, cy: 40, r: 31 }, lampSvg)
    for (let i = 0; i < LEDS; i++) {
      const a = (i / LEDS) * Math.PI * 2 - Math.PI / 2
      leds.push(el('circle', { class: 'exp__led', cx: (40 + Math.cos(a) * 24.5).toFixed(2), cy: (40 + Math.sin(a) * 24.5).toFixed(2), r: 2.35 }, lampSvg))
    }
    el('circle', { class: 'exp__lamp-lens', cx: 40, cy: 40, r: 12 }, lampSvg)
  }
  let lampRed = null
  let lampTl = null
  function washFrom() {
    if (!wash || !lamps) return
    const r = lamps.querySelector('.exp__lamp').getBoundingClientRect()
    wash.style.setProperty('--wx', `${(r.left + r.width / 2).toFixed(0)}px`)
    wash.style.setProperty('--wy', `${(r.top + r.height / 2).toFixed(0)}px`)
    gsap.killTweensOf(wash)
    gsap
      .timeline()
      .fromTo(wash, { opacity: 0, scale: 0.3 }, { opacity: 1, scale: 1.3, duration: 0.8, ease: 'power2.out' })
      .to(wash, { opacity: 0, duration: 2.2, ease: 'power2.inOut' }, 0.75)
  }
  function setLamps(red, show) {
    if (!lamps || red === lampRed) return
    lampRed = red
    lampTl?.kill()
    lampTl = null
    if (!red) {
      lamps.classList.remove('is-red')
      gsap.set([...leds, lampGlow], { clearProps: 'opacity' })
      if (wash) {
        gsap.killTweensOf(wash)
        gsap.set(wash, { opacity: 0 })
      }
      return
    }
    if (!show) {
      lamps.classList.add('is-red')
      gsap.set([...leds, lampGlow], { clearProps: 'opacity' })
      return
    }
    // white lamps flicker, a dark beat, then red, LED by LED, and the wash
    lampTl = gsap
      .timeline({ defaults: { ease: 'none' } })
      .set(leds, { opacity: 1 })
      .to(leds, { opacity: 0.12, duration: 0.05 }, 0.05)
      .to(leds, { opacity: 1, duration: 0.05 }, 0.13)
      .to(leds, { opacity: 0.3, duration: 0.04 }, 0.26)
      .to(leds, { opacity: 0.9, duration: 0.05 }, 0.32)
      .to([...leds, lampGlow], { opacity: 0, duration: 0.14, ease: 'power2.in' }, 0.46)
      .add(() => lamps.classList.add('is-red'), 0.62)
      .to(leds, { opacity: 1, duration: 0.22, ease: 'power2.out', stagger: 0.024 }, 1.0)
      .to(lampGlow, { opacity: 0.55, duration: 1.1, ease: 'power2.out' }, 1.0)
      .add(washFrom, 1.0)
  }
  if (reduced) lamps?.classList.add('is-red')
  else if (ctx.depth?.onChange) {
    let lastD = null
    let lastT = 0
    ctx.depth.onChange((s) => {
      const now = performance.now()
      // descent speed in metres per second (frame rate independent)
      const speed = lastD === null ? Infinity : Math.abs(s.depth - lastD) / Math.max(0.016, (now - lastT) / 1000)
      lastD = s.depth
      lastT = now
      const red = s.depth >= SWITCH_AT
      if (red === lampRed) return
      // first reading, or a jump through 6,000 m (a nav link): just set it
      const show = lampRed === false && red && speed < 3000
      setLamps(red, show)
    })
  }

  /* ---------------------------------------------------------- sketches */
  const sketches = new Map()
  const sketchSvgs = [...root.querySelectorAll('.exp__sketch svg')]
  days.forEach((day) => {
    const fig = day.querySelector('.exp__sketch')
    if (!fig) return
    const draw = [...fig.querySelectorAll('.exp__sk-line, .exp__sk-contour, .exp__sk-mark, .exp__sk-port, .exp__sk-beams path')]
    const fade = [...fig.querySelectorAll('.exp__sk-faint, .exp__sk-route, .exp__sk-label, .exp__sk-hatch, .exp__sk-fill')]
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
    // the phase captions, so the readout can step round them
    const phaseBoxes = phases.map((p) => {
      const r = p.getBoundingClientRect()
      return { x: r.left - lr.left - 6, y: r.top - lr.top - 4, width: r.width + 12, height: r.height + 8 }
    })
    // viewBox units per screen pixel of each logbook sketch, so its labels
    // can keep a readable size however small the drawing is set
    const skUnits = sketchSvgs.map((s) => {
      const w = s.getBoundingClientRect().width
      const vb = s.viewBox?.baseVal
      return w > 0 && vb?.width ? vb.width / w : 0
    })
    return { W, H, T, D, pTop, pBot, h, nodes, phaseBoxes, skUnits }
  }

  function build() {
    const g = measure()
    if (!g.H || !g.W) return
    const { W, H, T, D, pTop, pBot, h } = g
    g.skUnits.forEach((u, i) => {
      if (u) sketchSvgs[i].style.setProperty('--sk-u', u.toFixed(3))
    })
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
      return t
    }
    const xr = T + ((D - T) * RED_FROM) / MAX
    const zero = label(T + 10, '0 m', '', 'start')
    const redL = label(xr, '6,000 m, red lamps on', 'exp__c-label--red')
    const end = label(D, '10,935 m', '', 'end')
    // Narrow screens: if the red label would touch its neighbours, stack it
    // ("red lamps on" over "6,000 m") so the scale stays readable.
    try {
      const rb = redL.getBBox()
      const eb = end.getBBox()
      const zb = zero.getBBox()
      if (rb.x + rb.width + 10 > eb.x || rb.x - 10 < zb.x + zb.width) {
        redL.textContent = ''
        el('tspan', { x: xr.toFixed(1), dy: '-1.2em' }, redL).textContent = 'red lamps on'
        el('tspan', { x: xr.toFixed(1), dy: '1.2em' }, redL).textContent = '6,000 m'
      }
    } catch {
      /* not rendered yet: the next build measures again */
    }

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

    // readout size, measured once with its widest text
    let readW = 110
    if (readout && readD) {
      const was = readD.textContent
      for (const t of ['10,930 m', FLOOR]) {
        readD.textContent = t
        readW = Math.max(readW, readout.offsetWidth || 0)
      }
      readD.textContent = was
    }

    G = { ...g, yA1, yB0, lut, segA, segP, segB, floorTop: pTop + h / 3, floorBot: pTop + (2 * h) / 3, readW }

    if (reduced) return
    makeTimeline()
  }

  /* --------------------------------------------------------- timeline */
  const lit = new Array(days.length).fill(false)
  let current = -1
  const phaseLit = phases.map(() => false)
  let floor = false
  let diving = false
  let reading = false
  let shallow = false
  let near = false
  let clockRed = false
  let lastMins = -1
  let lastWd = -1
  let readLeft = false
  let lastRead = ''

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
    const depthM = clamp((x - T) / (D - T)) * MAX
    const shownM = depthM > MAX - 12 ? MAX : Math.round(depthM / 10) * 10
    const mins = Math.round(clamp((y - pTop) / h) * DIVE_HOURS * 60)

    // the dive clock: counts the twelve hours, squeezed by Vesper's depth
    if (clock) {
      // on screen from just before the dive; it comes to rest beside the
      // floor and keeps counting as the signal climbs away from it
      const isNear = y > pTop - h * 0.3
      if (isNear !== near) {
        near = isNear
        plunge.classList.toggle('is-near', isNear)
      }
      if (mins !== lastMins) {
        lastMins = mins
        if (clockH) clockH.textContent = String(Math.floor(mins / 60))
        if (clockM) clockM.textContent = String(mins % 60).padStart(2, '0')
      }
      const wd = Math.round(shownM / 50)
      if (wd !== lastWd) {
        lastWd = wd
        const e = Math.pow(shownM / MAX, 0.8)
        clock.style.setProperty('--clk-wdth', (118 - 68 * e).toFixed(1))
        clock.style.setProperty('--clk-wght', Math.round(300 + 480 * e))
        const red = shownM >= RED_FROM
        if (red !== clockRed) {
          clockRed = red
          clock.classList.toggle('is-red', red)
        }
      }
    }

    // Vesper's depth, riding beside the signal while it is on the swing.
    // On phones the dive clock comes to rest right beside the floor, so the
    // readout bows out there and hands over to the lit "on the floor" caption.
    const narrow = W < 560
    const inDive = y > pTop - 2 && y < G.pBot + 2
    if (inDive !== diving) {
      diving = inDive
      plunge.classList.toggle('is-diving', inDive)
    }
    const readOn = inDive && !(narrow && shownM >= MAX)
    if (readOn !== reading) {
      reading = readOn
      readout?.classList.toggle('is-on', readOn)
    }
    const isShallow = inDive && depthM < RED_FROM
    if (isShallow !== shallow) {
      shallow = isShallow
      signal.classList.toggle('is-shallow', isShallow)
    }
    if (inDive && readout) {
      // keep the readout on the open side of the line (inside the swing on
      // phones), clear of the sloping line itself, and step round the phase
      // captions
      const rw = G.readW
      const top = y - 18
      const rh = 38
      const side = (l, dy = 0) => (l ? { x: x - rw, y: top + dy, width: rw - 18, height: rh } : { x: x + 18, y: top + dy, width: rw - 18, height: rh })
      const collides = (b) => G.phaseBoxes.some((p) => hit(b, p))
      // On a sloping leg the line runs on past the signal: drop the readout
      // below it where the line rises towards that side, lift it where the
      // line falls away, so the line never strikes through the text.
      const mdx = (atY(lut, y + 6).x - atY(lut, y - 6).x) / 12 // dx per dy
      const clear = (l) => {
        if (Math.abs(mdx) < 0.25) return 0 // (near) vertical: nothing to cross
        const k = 1 / mdx // dy per dx
        const need = Math.max(0, 24 - 20 * Math.abs(k))
        return k * (l ? -1 : 1) < 0 ? need : -need
      }
      let left = x > W - 190 || (narrow && x > 150)
      let dy = clear(left)
      if (collides(side(left, dy))) {
        const dy2 = clear(!left)
        const other = side(!left, dy2)
        if (!collides(other) && other.x >= 0 && other.x + other.width <= W) {
          left = !left
          dy = dy2
        } else dy += collides(side(left, dy + 44)) ? -44 : 44
      }
      if (left !== readLeft) {
        readLeft = left
        readout.classList.toggle('is-left', left)
      }
      readout.style.transform = `translate3d(${x.toFixed(1)}px, ${(y + dy).toFixed(1)}px, 0)`
      const txt = shownM >= MAX ? FLOOR : `${fmt(shownM)} m`
      if (txt !== lastRead) {
        lastRead = txt
        readD.textContent = txt
      }
    }
  }

  /* ---------------------------------------------------------- lifecycle */
  build()

  // A layout change only moves things inside the log, so rebuilding our own
  // timeline is enough: its new ScrollTrigger measures itself on creation,
  // and ScrollTrigger's own resize refresh covers everything else. (No
  // global refresh from here: one resize must not refresh the page twice.)
  let rT
  const rebuild = () => {
    clearTimeout(rT)
    rT = setTimeout(build, 160)
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
