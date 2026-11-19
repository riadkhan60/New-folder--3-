/**
 * palette.js — which colour field are we in?
 *
 * Every section carries data-field="<pigment id>" (or "paper"). A probe line
 * at the vertical centre of the viewport decides the current field. While a
 * section boundary crosses the band around the probe, `mix` runs 0 → 1 from
 * the previous field into the next.
 *
 * At boot it injects one <style> with, for every pigment and paper:
 *   [data-field="id"] { --field; --tint; --ink; --ink-2; --ink-3; --line }
 * so any element inside a section gets legible text colours for free, with
 * no per-frame style writes. The body background is set to the blended field
 * colour (the fallback when the fluid dish can't run).
 *
 * API (ctx.palette):
 *   get()            → state (see below)
 *   onChange(fn)     → fn(state) whenever field/mix changes; returns unsubscribe
 *   pigment(id)      → pigment data (or PAPER)
 *   refresh()        → re-measure sections
 *   drop(id, opts)   → ask the dish to drop a pigment: ctx.emit('drop', {...})
 */
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { PIGMENTS, BY_ID, PAPER } from './pigments.js'

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const lerp = (a, b, t) => a + (b - a) * t
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const smooth = (t) => t * t * (3 - 2 * t)

export const pigment = (id) => BY_ID[id] || PAPER

export function mixHex(a, b, t) {
  const A = hex(a)
  const B = hex(b)
  return toHex(A.map((v, i) => lerp(v, B[i], t)))
}

function rgba(h, a) {
  const [r, g, b] = hex(h)
  return `rgb(${r} ${g} ${b} / ${a})`
}

function injectFieldStyles() {
  const rule = (p) =>
    `[data-field="${p.id}"]{--field:${p.hex};--tint:${p.tint};--ink:${p.ink};` +
    `--ink-2:${rgba(p.ink, 0.76)};--ink-3:${rgba(p.ink, 0.54)};--line:${rgba(p.ink, 0.2)};}`
  const css = [PAPER, ...PIGMENTS].map(rule).join('\n')
  const el = document.createElement('style')
  el.dataset.ground = 'fields'
  el.textContent = css
  document.head.appendChild(el)
}

export function createPalette({ gsap, lenis = null, emit }) {
  injectFieldStyles()
  const listeners = new Set()
  let geo = []
  let docH = 0
  const BAND = 0.32 // transition band, as a fraction of viewport height

  const state = {
    field: 'paper', // id of the field under the probe
    from: 'paper', // field we are leaving (during a transition)
    to: 'paper', // field we are entering
    mix: 1, // 0 = fully `from`, 1 = fully `to`
    color: PAPER.hex, // blended field colour
    ink: PAPER.ink,
    section: null, // id of section under the probe
    progress: 0, // 0..1 whole page
    velocity: 0, // px per frame (signed, smoothed)
  }

  function measure() {
    docH = document.documentElement.scrollHeight
    const sy = window.scrollY
    // Only page sections define fields; fixed UI (nav, cursor, dialogs) may
    // borrow [data-field] for its colours without becoming a section.
    geo = [...document.querySelectorAll('section[data-field], footer[data-field]')]
      .filter((el) => !el.parentElement?.closest('[data-field]')) // top-level fields only
      .map((el) => {
        const p = el.parentElement
        const box = p && p.classList.contains('pin-spacer') ? p : el
        const r = box.getBoundingClientRect()
        return { el, id: el.dataset.field, top: r.top + sy, h: r.height }
      })
  }

  const scrollTop = () => (lenis ? lenis.scroll : window.scrollY)
  let lastY = -1
  let lastVh = -1
  let dirty = true
  let vel = 0

  function update(force = false) {
    const y = scrollTop()
    const vh = window.innerHeight
    vel = lerp(vel, lastY < 0 ? 0 : y - lastY, 0.25)
    if (!force && !dirty && y === lastY && vh === lastVh) {
      if (Math.abs(state.velocity) > 0.01) {
        state.velocity = vel = lerp(vel, 0, 0.3)
        notify()
      }
      return
    }
    lastY = y
    lastVh = vh
    dirty = false
    const probe = y + vh * 0.5
    let i = geo.findIndex((g) => probe < g.top + g.h)
    if (i < 0) i = geo.length - 1
    const cur = geo[i]
    let from = cur?.id ?? 'paper'
    let to = from
    let mix = 1
    if (cur) {
      // entering band: the first BAND*vh of a section blends from the previous one
      const into = probe - cur.top
      const band = vh * BAND
      if (i > 0 && into < band) {
        from = geo[i - 1].id
        mix = smooth(clamp(into / band))
      }
    }
    const a = pigment(from)
    const b = pigment(to)
    state.from = from
    state.to = to
    state.mix = mix
    state.field = mix >= 0.5 ? to : from
    state.section = cur?.el.id ?? null
    state.color = from === to ? b.hex : mixHex(a.hex, b.hex, mix)
    state.ink = mix >= 0.5 ? b.ink : a.ink
    state.progress = docH > vh ? clamp(y / (docH - vh)) : 0
    state.velocity = vel
    document.body.style.backgroundColor = state.color
    notify()
  }

  function notify() {
    for (const fn of listeners) {
      try {
        fn(state)
      } catch (e) {
        console.error('[palette] listener failed', e)
      }
    }
  }

  measure()
  update(true)
  gsap.ticker.add(() => update())
  ScrollTrigger.addEventListener('refresh', () => {
    measure()
    dirty = true
  })
  const ro = new ResizeObserver(() => {
    measure()
    dirty = true
  })
  const main = document.querySelector('main')
  if (main) ro.observe(main)

  return {
    get: () => state,
    onChange(fn) {
      listeners.add(fn)
      fn(state)
      return () => listeners.delete(fn)
    },
    pigment,
    mixHex,
    refresh() {
      measure()
      update(true)
    },
    drop(id, opts = {}) {
      emit('drop', { id, ...opts })
    },
  }
}
