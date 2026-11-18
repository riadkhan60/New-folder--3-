/**
 * depth.js — the single source of truth for "how deep are we?"
 *
 * Every <section data-depth-start="…" data-depth-end="…"> on the page owns a
 * slice of the water column. A probe line at the vertical centre of the
 * viewport decides the current depth: inside a section, depth interpolates
 * linearly from start → end as the section scrolls past the probe.
 *
 * Each frame it writes CSS custom properties on <html>:
 *   --bg       interpolated water colour
 *   --depth-n  0 → 1 (linear over 0 … 10,935 m)
 *   --sun      visible sunlight 1 → 0 (gone by ~1,000 m)
 *   --hadal    0 → 1 between 5,800 m and 6,400 m (red-light mode)
 * and once per layout, on every depth section:
 *   --wdth / --wght   pressure compression for display type
 *
 * API (exposed as ctx.depth):
 *   get()              → current state object (see `state` below)
 *   onChange(fn)       → fn(state) on every change; returns unsubscribe
 *   compression(m)     → { wdth, wght } for a given depth in metres
 *   zoneAt(m)          → zone object for a given depth
 *   format(m)          → "10,935"
 *   MAX                → 10935
 *   ZONES              → zone table
 *   refresh()          → re-measure sections (call after layout changes)
 *   scrollYForDepth(m) → the window.scrollY at which the HUD reads m metres
 *
 * A section may contain one element marked `data-depth-until`: the section
 * then reaches its end depth when the probe reaches that element's centre
 * (and holds it below), instead of at the bottom of the section.
 */

import { ScrollTrigger } from 'gsap/ScrollTrigger'

export const MAX_DEPTH = 10935

export const ZONES = [
  { id: 'sunlight', from: 0, to: 200, name: 'Sunlight zone', sci: 'Epipelagic' },
  { id: 'twilight', from: 200, to: 1000, name: 'Twilight zone', sci: 'Mesopelagic' },
  { id: 'midnight', from: 1000, to: 4000, name: 'Midnight zone', sci: 'Bathypelagic' },
  { id: 'abyss', from: 4000, to: 6000, name: 'The abyss', sci: 'Abyssopelagic' },
  { id: 'hadal', from: 6000, to: MAX_DEPTH, name: 'Hadal zone', sci: 'Hadalpelagic' },
]

// Water colour by depth. Perceptually tuned by eye, ending in true black.
const COLOR_STOPS = [
  [0, '#0e6f86'],
  [90, '#0b5a76'],
  [200, '#09435f'],
  [550, '#072c4c'],
  [1000, '#051b35'],
  [2200, '#030f22'],
  [4000, '#020815'],
  [6000, '#01040b'],
  [8000, '#000105'],
  [MAX_DEPTH, '#000000'],
]

// Approximate open-Pacific temperature profile (°C). Hadal water warms
// slightly from adiabatic compression.
const TEMP_STOPS = [
  [0, 27.5],
  [60, 26],
  [200, 15.5],
  [500, 8.2],
  [1000, 4.4],
  [2000, 2.3],
  [4000, 1.5],
  [6000, 1.4],
  [8000, 1.8],
  [MAX_DEPTH, 2.5],
]

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
const LIN_STOPS = COLOR_STOPS.map(([d, h]) => [d, hex(h).map(toLin)])

function sampleStops(stops, depth) {
  if (depth <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    const [d1, v1] = stops[i]
    const [d0, v0] = stops[i - 1]
    if (depth <= d1) {
      const t = (depth - d0) / (d1 - d0)
      return Array.isArray(v0) ? v0.map((c, k) => c + (v1[k] - c) * t) : v0 + (v1 - v0) * t
    }
  }
  return stops[stops.length - 1][1]
}

export function colorAt(depth) {
  const lin = sampleStops(LIN_STOPS, depth)
  const [r, g, b] = lin.map((c) => Math.round(clamp(toSrgb(c)) * 255))
  return { r, g, b, css: `rgb(${r} ${g} ${b})` }
}

export function zoneAt(depth) {
  return ZONES.find((z) => depth < z.to) || ZONES[ZONES.length - 1]
}

/** Pressure compression for display type: wide + light at the surface,
 *  narrow + heavy at the bottom. Log-scaled so the first few hundred metres
 *  already feel the squeeze. */
export function compression(depth) {
  const f = Math.log1p(depth / 40) / Math.log1p(MAX_DEPTH / 40)
  return {
    wdth: Math.round(150 - 100 * f),
    wght: Math.round(260 + 600 * f),
    f,
  }
}

export const format = (m) => Math.round(m).toLocaleString('en-US')

export function createDepth({ gsap }) {
  const root = document.documentElement
  let sections = []
  const listeners = new Set()

  const state = {
    depth: 0, // metres
    n: 0, // 0..1 linear
    pressure: 1.01, // bar (absolute)
    temperature: TEMP_STOPS[0][1], // °C
    light: 1, // fraction of surface light (physical, ~1% at 200 m)
    sun: 1, // visual sunlight 1 → 0 by ~1,000 m
    hadal: 0, // red-light mode 0..1
    zone: ZONES[0],
    color: colorAt(0),
    section: null, // id of section under the probe
    scrollProgress: 0, // 0..1 whole page
    velocity: 0, // metres per frame (signed)
  }

  function measureEl(el) {
    // ScrollTrigger pins wrap sections in a .pin-spacer — measure that instead
    const p = el.parentElement
    return p && p.classList.contains('pin-spacer') ? p : el
  }

  // Geometry is cached (absolute document offsets) and re-measured only when
  // layout can have changed: ScrollTrigger refreshes, size changes of <main>,
  // fonts. Per frame, depth is pure arithmetic on scrollY — no layout reads.
  let geo = []
  let dirty = true

  function refresh() {
    sections = [...document.querySelectorAll('[data-depth-start]')].map((el) => {
      const start = parseFloat(el.dataset.depthStart) || 0
      const end = parseFloat(el.dataset.depthEnd ?? start)
      const mid = (start + end) / 2
      const c = compression(mid)
      el.style.setProperty('--wdth', c.wdth)
      el.style.setProperty('--wght', c.wght)
      if (!el.dataset.zone) el.dataset.zone = zoneAt(mid).id
      return { el, start, end, until: el.querySelector('[data-depth-until]') }
    })
    measure()
  }

  function measure() {
    const sy = window.scrollY
    geo = sections.map((s) => {
      const r = measureEl(s.el).getBoundingClientRect()
      let span = r.height
      if (s.until) {
        const u = s.until.getBoundingClientRect()
        span = u.top + u.height / 2 - r.top
      }
      return { s, top: r.top + sy, h: r.height, span: Math.max(1, span) }
    })
    dirty = true
  }

  function computeDepth() {
    const vh = window.innerHeight
    const probe = vh * 0.5
    const maxScroll = document.documentElement.scrollHeight - vh
    const y = window.scrollY
    state.scrollProgress = maxScroll > 0 ? clamp(y / maxScroll) : 0
    if (maxScroll > 0 && y >= maxScroll - 2) {
      const lastG = geo[geo.length - 1]
      return { depth: MAX_DEPTH, id: lastG?.s.el.id ?? null }
    }
    let depth = 0
    let id = null
    for (let i = 0; i < geo.length; i++) {
      const g = geo[i]
      const top = g.top - y
      if (top + g.h <= probe) {
        depth = g.s.end
        id = g.s.el.id
        continue
      }
      if (top <= probe) {
        const t = clamp((probe - top) / g.span)
        depth = g.s.start + (g.s.end - g.s.start) * t
        id = g.s.el.id
      }
      break
    }
    return { depth, id }
  }

  function scrollYForDepth(d) {
    const vh = window.innerHeight
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh)
    if (d <= 0) return 0
    for (const g of geo) {
      const { start, end } = g.s
      if (end > start && d >= start && d <= end) {
        const y = g.top + ((d - start) / (end - start)) * g.span - vh * 0.5
        return clamp(y, 0, maxScroll)
      }
    }
    return maxScroll
  }

  let last = -1
  let lastY = -1
  let lastVh = -1
  function update(force = false) {
    const y = window.scrollY
    const vh = window.innerHeight
    if (!force && !dirty && y === lastY && vh === lastVh) {
      if (state.velocity !== 0) {
        state.velocity = 0
        for (const fn of listeners) {
          try { fn(state) } catch (e) { console.error('[depth] listener failed', e) }
        }
      }
      return
    }
    lastY = y
    lastVh = vh
    dirty = false
    const { depth, id } = computeDepth()
    if (!force && Math.abs(depth - last) < 0.05 && id === state.section) return
    state.velocity = last < 0 ? 0 : depth - last
    last = depth
    state.depth = depth
    state.section = id
    state.n = depth / MAX_DEPTH
    state.pressure = 1.013 + depth * 0.1005
    state.temperature = sampleStops(TEMP_STOPS, depth)
    state.light = Math.exp(-depth * (Math.log(100) / 200))
    state.sun = 1 - smoothstep(0, 1000, depth) ** 0.6
    state.hadal = smoothstep(5800, 6400, depth)
    state.zone = zoneAt(depth)
    state.color = colorAt(depth)

    root.style.setProperty('--bg', state.color.css)
    root.style.setProperty('--depth-n', state.n.toFixed(4))
    root.style.setProperty('--sun', state.sun.toFixed(4))
    root.style.setProperty('--hadal', state.hadal.toFixed(4))
    root.dataset.zone = state.zone.id

    for (const fn of listeners) {
      try {
        fn(state)
      } catch (e) {
        console.error('[depth] listener failed', e)
      }
    }
  }

  refresh()
  update(true)
  gsap.ticker.add(() => update())

  // Re-measure when layout can have changed (not on every resize event:
  // ScrollTrigger already refreshes on real resizes and ignores mobile
  // toolbar show/hide).
  ScrollTrigger.addEventListener('refresh', () => {
    measure()
    update(true)
  })
  let roRaf = 0
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(roRaf)
    roRaf = requestAnimationFrame(() => {
      measure()
      update(true)
    })
  })
  const mainEl = document.querySelector('main')
  if (mainEl) ro.observe(mainEl)

  return {
    MAX: MAX_DEPTH,
    ZONES,
    get: () => state,
    onChange(fn) {
      listeners.add(fn)
      fn(state)
      return () => listeners.delete(fn)
    },
    compression,
    zoneAt,
    colorAt,
    format,
    scrollYForDepth,
    refresh() {
      refresh()
      update(true)
    },
  }
}
