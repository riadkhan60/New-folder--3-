/**
 * main.js — boot sequence for Ground. Owned by the scaffold.
 *
 * Every core + section module exports `init(ctx)` (may be async). Modules load
 * in isolation: a crash in one never takes down the page. All CSS ships in
 * the entry stylesheet so sections are styled from the first paint.
 *
 * It also owns how the page moves when nobody is scrolling it by hand:
 *   - jumps (DESIGN.md §8): every programmatic smooth scroll (anchor and nav
 *     links, the skip link, back/forward, ctx.scrollTo without `immediate`)
 *     holds the palette on the field it left, so the dish pours only the
 *     destination instead of every field passed on the way;
 *   - the reader's place: a width or orientation change reflows the page, so
 *     a reading anchor is kept while scrolling and put back afterwards.
 */
import 'lenis/dist/lenis.css'
import './styles/base.css'
import.meta.glob('./styles/*.css', { eager: true })

import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { CustomEase } from 'gsap/CustomEase'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import Lenis from 'lenis'
import { createPalette } from './core/palette.js'
import * as pigmentData from './core/pigments.js'

gsap.registerPlugin(ScrollTrigger, SplitText, CustomEase, DrawSVGPlugin)
CustomEase.create('pour', 'M0,0 C0.3,0 0.1,1 1,1') // slow start, liquid settle
CustomEase.create('settle', 'M0,0 C0.16,1 0.3,1 1,1')

const params = new URLSearchParams(location.search)
const mq = (q) => window.matchMedia(q).matches
const reducedMotion = mq('(prefers-reduced-motion: reduce)') || params.has('reduced')
const deepLink = location.hash.length > 1 ? location.hash : null
const skipIntro =
  params.has('skipintro') || reducedMotion || !!deepLink || document.documentElement.classList.contains('skip-intro')
window.__groundBooting = true

if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
if (!location.hash) window.scrollTo(0, 0)

/* ------------------------------------------------------------ smooth scroll */
const lenis = reducedMotion
  ? null
  : new Lenis({ lerp: 0.09, wheelMultiplier: 0.95, touchMultiplier: 1.4, anchors: false, autoRaf: false })
if (lenis) {
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((t) => lenis.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
}

/* ------------------------------------------------------------ ctx */
const bus = new EventTarget()
let resolveReady
const ready = new Promise((r) => (resolveReady = r))

const ctx = {
  gsap,
  ScrollTrigger,
  SplitText,
  lenis,
  palette: null,
  pigments: pigmentData, // { PIGMENTS, BY_ID, CHAPTERS, PAPER, SOURCES, formatPrice }
  reducedMotion,
  skipIntro,
  isTouch: mq('(hover: none), (pointer: coarse)'),
  isMobile: () => window.innerWidth < 768,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
  ready,
  jumping: false, // true while a programmatic smooth scroll (a jump) runs
  emit: (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail })),
  on: (name, fn) => {
    const h = (e) => fn(e.detail)
    bus.addEventListener(name, h)
    return () => bus.removeEventListener(name, h)
  },
  /**
   * Scroll to an element, a selector or a y. Smooth unless `opts.immediate`
   * (or reduced motion); a smooth scroll is a jump (see below). Takes Lenis
   * options: duration (default 2 s), easing, offset, onComplete (called when
   * the scroll arrives, not when it is interrupted), force, immediate.
   */
  scrollTo(target, opts = {}) {
    let el = target
    if (typeof target === 'string') {
      try {
        el = document.querySelector(target)
      } catch {
        el = null
      }
      if (!el) return
    }
    const dest = el instanceof Element ? pinBox(el) : null
    if (!lenis) {
      if (dest?.scrollIntoView) dest.scrollIntoView({ behavior: 'auto' })
      else window.scrollTo(0, typeof target === 'number' ? target : 0)
      return
    }
    if (opts.immediate) {
      // one frame, not a jump: the palette follows it like any scroll
      lenis.scrollTo(dest ?? target, opts)
      endJump('immediate')
      return
    }
    smoothTo(dest ?? target, opts)
  },
}
window.__ground = ctx

/* ------------------------------------------------------------ modules */
const coreModules = import.meta.glob('./core/{dish,nav,cursor,loader}.js')
const sectionModules = import.meta.glob('./sections/*.js')
const CORE_ORDER = ['dish', 'nav', 'cursor']
const SECTION_ORDER = ['hero', 'intro', 'chapters', 'library', 'grind', 'mix', 'shop', 'footer']

async function load(map, path) {
  const loader = map[path]
  if (!loader) return null
  try {
    return await loader()
  } catch (err) {
    console.error(`[ground] failed to load ${path}`, err)
    return null
  }
}
async function run(name, mod) {
  if (!mod?.init) return
  try {
    await mod.init(ctx)
  } catch (err) {
    console.error(`[ground] ${name}.init() failed`, err)
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let handedOver = false
function handOver() {
  if (handedOver) return
  handedOver = true
  document.documentElement.classList.remove('is-loading')
  document.documentElement.classList.add('is-ready')
  lenis?.start()
  try {
    ScrollTrigger.refresh()
    ctx.palette?.refresh()
    goToDeepLink()
    keepPlaceAcrossResizes()
  } catch (err) {
    console.error('[ground] hand-over refresh failed', err)
  }
  resolveReady()
}

async function boot() {
  ctx.palette = createPalette({ gsap, lenis, emit: ctx.emit })

  const loaderP = load(coreModules, './core/loader.js')
  const coreP = CORE_ORDER.map((n) => load(coreModules, `./core/${n}.js`))
  const sectionP = SECTION_ORDER.map((n) => load(sectionModules, `./sections/${n}.js`))

  const fontsLoaded = document.fonts?.ready ?? Promise.resolve()
  const fontsReady = Promise.race([fontsLoaded, wait(2500)])
  fontsLoaded.then(() => {
    ScrollTrigger.refresh()
    ctx.palette.refresh()
  })

  const initAll = (async () => {
    for (let i = 0; i < CORE_ORDER.length; i++) await run(CORE_ORDER[i], await coreP[i])
    for (let i = 0; i < SECTION_ORDER.length; i++) await run(SECTION_ORDER[i], await sectionP[i])
  })()
  const pageReady = Promise.race([initAll, wait(15000)])

  const loaderMod = skipIntro ? null : await loaderP
  if (!loaderMod?.init) {
    document.documentElement.classList.add('skip-intro')
    await Promise.all([pageReady, fontsReady])
    handOver()
    return
  }
  lenis?.stop()
  try {
    await loaderMod.init(ctx, { fontsReady, pageReady })
  } catch (err) {
    console.error('[ground] loader failed', err)
  }
  await pageReady
  handOver()
}

/* ------------------------------------------------------------ jumps */
// A jump is a programmatic smooth scroll. While it runs, ctx.jumping is true
// and the palette holds the field it started on, so the dish never pours the
// fields passed on the way: when the jump ends the palette recomputes once and
// the dish makes one clean pour (or one clean wipe back to paper).
// 'jump' { phase: 'start' } and { phase: 'end', reason } are always balanced;
// a jump that replaces another ends the first one (the palette stays held).
// It ends when the scroll arrives, when the visitor takes over (wheel, touch,
// pointer down outside an in-page link, scrolling keys), when something else
// stops the scroll, or at the latest its duration + 600 ms after it began.
const JUMP_EASE = (t) => 1 - Math.pow(1 - t, 4)
let jump = null // { timer, anchor }

function startJump(duration, anchor) {
  ctx.palette?.hold('jump')
  if (jump) endJump('replaced', true)
  if (place.armed) place.disarm() // a jump outranks putting the reader back
  const j = { timer: 0, anchor }
  j.timer = setTimeout(() => {
    if (jump !== j) return
    // still gliding (a hidden tab, a stalled frame): land it, then let go
    const to = lenis?.animate?.to
    if (lenis?.isScrolling === 'smooth' && typeof to === 'number') lenis.scrollTo(to, { immediate: true, force: true })
    endJump('timeout')
  }, duration * 1000 + 600)
  jump = j
  ctx.jumping = true
  ctx.emit('jump', { phase: 'start' })
  return j
}

function endJump(reason, keepHold = false) {
  if (!jump) return
  clearTimeout(jump.timer)
  jump = null
  ctx.jumping = false
  if (!keepHold) ctx.palette?.release('jump') // one change, straight to the destination
  ctx.emit('jump', { phase: 'end', reason })
  if (!keepHold) place.capture()
}

/** A smooth (Lenis) scroll as a jump. `target`: a y or an element. */
function smoothTo(target, { duration = 2, easing = JUMP_EASE, onComplete, ...rest } = {}) {
  if (!lenis) {
    const y = typeof target === 'number' ? target : target.getBoundingClientRect().top + window.scrollY
    window.scrollTo(0, y)
    onComplete?.()
    return
  }
  if ((lenis.isStopped || lenis.isLocked) && !rest.force) return // Lenis would ignore it
  // where it will land (Lenis keeps an element's scroll-margin and the page's
  // scroll-padding clear), as a reading anchor in case the page turns mid-jump
  let anchor = null
  try {
    const y =
      typeof target === 'number'
        ? target
        : target.getBoundingClientRect().top +
          window.scrollY -
          (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) -
          (parseFloat(getComputedStyle(target).scrollMarginTop) || 0)
    anchor = place.anchorAt(Math.max(0, y + (rest.offset || 0)))
  } catch {}
  const j = startJump(duration, anchor)
  lenis.scrollTo(target, {
    ...rest,
    duration,
    easing,
    onComplete: (l) => {
      if (jump !== j) return // replaced or interrupted
      endJump('complete')
      onComplete?.(l)
    },
  })
}

if (lenis) {
  // something else stopped the scroll (lenis.stop(), an immediate scroll, …)
  gsap.ticker.add(() => {
    if (!jump) return
    const a = lenis.animate
    const running = typeof a?.isRunning === 'boolean' ? a.isRunning : lenis.isScrolling === 'smooth'
    if (!running) endJump('stopped')
  })
}

// the visitor takes over
function interrupt(reason) {
  if (!jump) return
  lenis?.reset() // stop the jump's scroll where it is
  endJump(reason)
}
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar'])
const OWN_KEYS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="spinbutton"], [role="radio"], [role="listbox"], [role="menu"], [role="tablist"]'
const inPageLink = (e) => !!e.target?.closest?.('a[href^="#"]')
window.addEventListener('wheel', () => interrupt('wheel'), { capture: true, passive: true })
window.addEventListener('touchstart', (e) => inPageLink(e) || interrupt('touch'), { capture: true, passive: true })
window.addEventListener('touchmove', () => interrupt('touch'), { capture: true, passive: true })
// (a press on an in-page link is let through: its click replaces the jump)
window.addEventListener('pointerdown', (e) => inPageLink(e) || interrupt('pointer'), { capture: true, passive: true })
const PRESSABLE = 'button, summary, [role="button"], [role="checkbox"], [role="switch"], [role="option"]'
window.addEventListener('keydown', (e) => {
  if (!jump || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !SCROLL_KEYS.has(e.key)) return
  if (e.target?.closest?.(OWN_KEYS)) return // the control uses the key itself
  if ((e.key === ' ' || e.key === 'Spacebar') && e.target?.closest?.(PRESSABLE)) return // Space presses it
  interrupt('key')
})

/* ------------------------------------------------- keep the reader's place */
// A width or orientation change reflows the whole page (vh/svh sections,
// grids that change columns, type that rewraps) while scrollY stays the same,
// and ScrollTrigger's refresh puts the old number back: the reader would land
// screens away. So a reading anchor (the element at the top of the reading
// area and where it sat) is kept up to date while scrolling, and put back once
// the new layout settles. The palette is held meanwhile, so the dish doesn't
// pour whatever field the old scroll position briefly lands in. On touch
// devices height-only changes under 120 px (toolbars) and the on-screen
// keyboard are left alone.
function pageTop(el) {
  let y = 0
  for (let e = el; e; e = e.offsetParent) y += e.offsetTop
  return y // layout position: scroll-linked transforms don't move it
}
// the page's top-level field sections (as palette.js counts them), in order
function topSections() {
  return [...document.querySelectorAll('section[data-field], footer[data-field]')].filter(
    (el) => !el.parentElement?.closest('[data-field]'),
  )
}
// blocks of text a reader keeps their place by (a fixed or sticky one moves
// with the screen, not the page)
const TEXT_BLOCKS = 'h1, h2, h3, h4, h5, h6, p, li, dt, dd, blockquote, figcaption, figure, label, legend, summary, table'
const RUNNING_TEXT = new Set(['P', 'DD', 'BLOCKQUOTE']) // (a card in a grid is not read line by line)
function inFlow(el, root) {
  for (let e = el; e && e !== root; e = e.parentElement) {
    const pos = getComputedStyle(e).position
    if (pos === 'fixed' || pos === 'sticky' || pos === 'absolute') return false
  }
  return true
}
// the children that take part in the layout (through display: contents wrappers)
function* flowKids(el) {
  for (const c of el.children) {
    if (c.offsetParent !== null) yield c
    else if (c.children.length && getComputedStyle(c).display === 'contents') yield* flowKids(c)
  }
}
const place = {
  anchor: null,
  armed: false,
  on: false,
  settleT: 0,
  quietT: 0,
  capT: 0,
  capAt: 0,
  line: () => Math.min(88, window.innerHeight * 0.2), // the top of the reading area, under the nav
  /**
   * The anchor for the reading line at scroll position `sy` (current layout):
   * a long paragraph the line runs through (kept at the same point in it), or
   * else the first block of text that starts below the line, in reading
   * order and in any column (kept at the same distance from the top; the
   * tail of a block that began above the line doesn't count); failing both,
   * the deepest box the line runs through.
   */
  anchorAt(sy) {
    if (sy < 2) return { top: true }
    const line = this.line()
    const Y = sy + line
    const vh = window.innerHeight
    const scrollY = window.scrollY
    const roots = topSections()
    const i = roots.findIndex((s) => Y < pageTop(s) + s.offsetHeight)
    const scan = i < 0 ? [] : roots.slice(i, i + 2)
    const startsAbove = (el, root) => {
      const outer = el.parentElement?.closest(TEXT_BLOCKS)
      return !!outer && root.contains(outer) && outer.getBoundingClientRect().top + scrollY < Y
    }
    let reading = null
    let next = null
    for (const root of scan) {
      for (const el of root.querySelectorAll(TEXT_BLOCKS)) {
        const r = el.getBoundingClientRect()
        if (r.height < 4 || r.width < 4) continue
        const top = r.top + scrollY
        const bottom = r.bottom + scrollY
        if (bottom <= Y || top > Y + vh * 0.6) continue
        if (top < Y) {
          // mid-paragraph, with a good part of it still to read
          if (
            RUNNING_TEXT.has(el.tagName) &&
            bottom - Y >= vh * 0.25 &&
            (!reading || r.height < reading.h) &&
            inFlow(el, root)
          )
            reading = { el, h: r.height }
        } else if ((!next || top < next.top) && !startsAbove(el, root) && inFlow(el, root)) next = { el, top }
      }
      if (reading || next) break
    }
    if (reading) {
      const t = pageTop(reading.el)
      return { el: reading.el, frac: (Y - t) / reading.el.offsetHeight, at: line }
    }
    if (next) return { el: next.el, frac: 0, at: pageTop(next.el) - sy }
    return this.walkAt(sy)
  },
  /** The deepest in-flow box under the reading line, by the document's structure. */
  walkAt(sy) {
    const Y = sy + this.line()
    let el = document.body
    let elTop = 0
    let elH = el.offsetHeight
    for (let depth = 0; depth < 16; depth++) {
      let pick = null
      let pickTop = 0
      for (const c of flowKids(el)) {
        const h = c.offsetHeight
        if (!h) continue
        const t = pageTop(c)
        if (t + h <= Y) continue
        const pos = getComputedStyle(c).position
        if (pos !== 'static' && pos !== 'relative') continue // out of the flow
        pick = c
        pickTop = t
        break
      }
      if (!pick) break
      // the first thing that starts below the line: keep its top where it sits
      if (pickTop > Y) return { el: pick, frac: 0, at: pickTop - sy }
      el = pick
      elTop = pickTop
      elH = pick.offsetHeight
      if (elH < 32) break
    }
    if (el === document.body || !elH) return null
    return { el, frac: (Y - elTop) / elH, at: this.line() }
  },
  /** Where the page must scroll to put the anchor back, in the current layout. */
  yFor(a) {
    if (!a) return null
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    if (a.top) return 0
    if (!a.el.isConnected || a.el.offsetParent === null) return null
    const at = a.frac ? this.line() : Math.min(a.at, Math.max(this.line(), window.innerHeight * 0.5))
    const y = pageTop(a.el) + a.frac * a.el.offsetHeight - at
    return Math.round(Math.min(max, Math.max(0, y)))
  },
  capture() {
    if (!this.on || this.armed || jump || ScrollTrigger.isRefreshing) return
    this.capAt = performance.now()
    try {
      this.anchor = this.anchorAt(window.scrollY) ?? this.anchor
    } catch {}
  },
  // while scrolling: at most every 150 ms, and once more when it stops
  onScroll() {
    if (!this.on || this.armed || jump) return
    if (performance.now() - this.capAt > 150) this.capture()
    clearTimeout(this.capT)
    this.capT = setTimeout(() => this.capture(), 160)
  },
  restore() {
    const y = this.yFor(this.anchor)
    if (y === null) return
    if (lenis) {
      lenis.resize() // its scroll limit is still the old page's
      if (Math.abs(y - window.scrollY) >= 2) lenis.scrollTo(y, { immediate: true, force: true })
    } else if (Math.abs(y - window.scrollY) >= 2) window.scrollTo(0, y)
  },
  arm() {
    if (!this.armed) {
      this.armed = true
      ctx.palette?.hold('resize')
      clearTimeout(this.capT)
      if (jump) {
        // turned mid-jump: go where the jump was going
        const a = jump.anchor
        lenis?.reset()
        endJump('resize')
        if (a) this.anchor = a
      }
    }
    clearTimeout(this.settleT)
    clearTimeout(this.quietT)
    // ScrollTrigger refreshes 200 ms after the last resize; this is the
    // fallback for when it doesn't (touch devices ignore some resizes)
    this.settleT = setTimeout(() => this.settle(), 450)
  },
  settle() {
    if (!this.armed) return
    this.restore()
    clearTimeout(this.quietT)
    this.quietT = setTimeout(() => this.disarm(), 400) // late reflows put it back again
  },
  // The anchor stays as it was until the reader scrolls again, so turning a
  // phone there and back returns to exactly the same place.
  disarm() {
    if (!this.armed) return
    this.armed = false
    clearTimeout(this.settleT)
    clearTimeout(this.quietT)
    ctx.palette?.release('resize')
    if (this.yFor(this.anchor) === null) this.capture() // gone or hidden: start again from here
  },
}

function keepPlaceAcrossResizes() {
  if (place.on) return
  place.on = true
  let lastW = window.innerWidth
  let lastH = window.innerHeight
  place.capture()
  window.addEventListener('scroll', () => place.onScroll(), { passive: true })
  // phones and tablets show and hide their toolbars as you scroll (vh units
  // don't change with them); on a desktop any height change reflows the page
  const minDH = ctx.isTouch ? 120 : 1
  window.addEventListener('resize', () => {
    const w = window.innerWidth
    const h = window.innerHeight
    // a pinch-zoom (Safari reports it as a resize) doesn't reflow the page
    if (window.visualViewport && Math.abs(window.visualViewport.scale - 1) > 0.01) return
    if (w === lastW) {
      if (Math.abs(h - lastH) < minDH) return // toolbars
      // the on-screen keyboard: the browser brings the field into view itself
      if (document.activeElement?.matches?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
        lastH = h
        return
      }
    }
    lastW = w
    lastH = h
    place.arm()
  })
  ScrollTrigger.addEventListener('refresh', () => {
    if (place.armed) requestAnimationFrame(() => place.settle())
  })
  // sections that re-lay themselves out after the refresh (grids, canvases)
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      if (place.armed) requestAnimationFrame(() => place.settle())
    }).observe(document.body)
  }
  // the visitor scrolls on their own: their place is wherever they take it
  const takeOver = () => place.armed && place.disarm()
  window.addEventListener('wheel', takeOver, { passive: true })
  window.addEventListener('touchmove', takeOver, { passive: true })
  window.addEventListener('keydown', (e) => {
    if (SCROLL_KEYS.has(e.key) && !e.defaultPrevented && !e.target?.closest?.(OWN_KEYS)) takeOver()
  })
}

/* ------------------------------------------------------------ links */
function pinBox(el) {
  const p = el.parentElement
  return p && p.classList.contains('pin-spacer') ? p : el
}
function goToDeepLink() {
  if (!deepLink) return
  let el = null
  try {
    el = document.querySelector(deepLink)
  } catch {
    return
  }
  if (!el) return
  const jumpNow = () => {
    const y = pinBox(el).getBoundingClientRect().top + window.scrollY
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true })
    else window.scrollTo(0, y)
    place.capture()
  }
  jumpNow()
  requestAnimationFrame(jumpNow)
  document.fonts?.ready.then(() => requestAnimationFrame(jumpNow))
}
function scrollToY(y, { onComplete } = {}) {
  smoothTo(y, { onComplete })
}
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const a = e.target.closest?.('a[href^="#"]')
  if (!a) return
  const hash = a.getAttribute('href')
  if (!hash || hash.length < 2) return
  let el = null
  try {
    el = document.querySelector(hash)
  } catch {
    return
  }
  if (!el) return
  e.preventDefault()
  const keyboard = e.detail === 0
  const y = Math.max(0, pinBox(el).getBoundingClientRect().top + window.scrollY)
  try {
    history.replaceState({ y: window.scrollY }, '')
    if (location.hash !== hash) history.pushState({ y }, '', hash)
  } catch {}
  scrollToY(y, {
    onComplete: keyboard
      ? () => {
          const h = el.matches('h1, h2') ? el : el.querySelector('h1, h2') || el
          if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1')
          h.focus({ preventScroll: true })
        }
      : undefined,
  })
})
window.addEventListener('popstate', (e) => {
  const y = e.state && typeof e.state.y === 'number' ? e.state.y : null
  if (y !== null) return scrollToY(y)
})
document.querySelector('.skip-link')?.addEventListener('click', (e) => {
  const main = document.getElementById('main')
  if (!main) return
  e.preventDefault()
  e.stopPropagation()
  scrollToY(main.getBoundingClientRect().top + window.scrollY, { onComplete: () => main.focus({ preventScroll: true }) })
})

boot().catch((err) => {
  console.error('[ground] boot failed', err)
  document.documentElement.classList.add('skip-intro')
  handOver()
})
