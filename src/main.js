/**
 * main.js — boot sequence. Owned by the scaffold.
 *
 * Every core + section module exports `init(ctx)` (may be async, may return a
 * cleanup fn). Modules are loaded in isolation: a crash in one never takes
 * down the rest of the page. Each module imports its own CSS.
 */
import 'lenis/dist/lenis.css'
import './styles/base.css'
// Every section's stylesheet ships in the entry CSS (a <link> in <head>), so
// sections are styled from the first paint, before their JS chunk arrives,
// and even when JavaScript never runs. Modules still import their own CSS;
// Vite de-duplicates.
import.meta.glob('./styles/*.css', { eager: true })

import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { CustomEase } from 'gsap/CustomEase'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import Lenis from 'lenis'
import { createDepth } from './core/depth.js'

gsap.registerPlugin(ScrollTrigger, SplitText, CustomEase, DrawSVGPlugin)
CustomEase.create('abyss', 'M0,0 C0.16,1 0.3,1 1,1') // long, soft settle
CustomEase.create('surge', 'M0,0 C0.7,0 0.1,1 1,1') // pressure release

const params = new URLSearchParams(location.search)
const mq = (q) => window.matchMedia(q).matches
const reducedMotion = mq('(prefers-reduced-motion: reduce)') || params.has('reduced')
// A deep link (e.g. #reserve) goes straight to its section: no intro.
const deepLink = location.hash.length > 1 ? location.hash : null
// html.skip-intro may already be set by the inline loader script or by the
// no-JS watchdog in index.html.
const skipIntro =
  params.has('skipintro') ||
  reducedMotion ||
  !!deepLink ||
  document.documentElement.classList.contains('skip-intro')
window.__noctilucaBooting = true // tells the index.html watchdog that JS is alive

if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
if (!location.hash) window.scrollTo(0, 0)

/* ------------------------------------------------------------ smooth scroll */
const lenis = reducedMotion
  ? null
  : new Lenis({
      lerp: 0.085,
      wheelMultiplier: 0.95,
      touchMultiplier: 1.4,
      anchors: false, // in-page links are handled below (pin-aware, focus, history)
      autoRaf: false,
    })
if (lenis) {
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((t) => lenis.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
}

/* ------------------------------------------------------------ event bus */
const bus = new EventTarget()

/* ------------------------------------------------------------ ready gate */
let resolveReady
const ready = new Promise((r) => (resolveReady = r))

/* ------------------------------------------------------------ shared ctx */
const ctx = {
  gsap,
  ScrollTrigger,
  SplitText,
  lenis,
  depth: null,
  reducedMotion,
  skipIntro,
  isTouch: mq('(hover: none), (pointer: coarse)'),
  isMobile: () => window.innerWidth < 768,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
  ready, // resolves when the intro hands over to the page
  emit: (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail })),
  on: (name, fn) => {
    const h = (e) => fn(e.detail)
    bus.addEventListener(name, h)
    return () => bus.removeEventListener(name, h)
  },
  scrollTo(target, opts = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target
    if (lenis) lenis.scrollTo(el ?? target, { duration: 2.4, easing: (t) => 1 - Math.pow(1 - t, 4), ...opts })
    else if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'auto' })
    else window.scrollTo(0, typeof target === 'number' ? target : 0)
  },
}
window.__noctiluca = ctx // handy for debugging in the console

/* ------------------------------------------------------------ modules */
const coreModules = import.meta.glob('./core/{ocean,nav,hud,cursor,audio,loader}.js')
const sectionModules = import.meta.glob('./sections/*.js')

const CORE_ORDER = ['ocean', 'nav', 'hud', 'cursor', 'audio']
const SECTION_ORDER = [
  'hero',
  'manifesto',
  'zones',
  'vessel',
  'creatures',
  'expedition',
  'profiles',
  'voices',
  'finale',
  'footer',
]

async function load(map, path) {
  const loader = map[path]
  if (!loader) return null
  try {
    return await loader()
  } catch (err) {
    console.error(`[noctiluca] failed to load ${path}`, err)
    return null
  }
}

async function run(name, mod) {
  if (!mod?.init) return
  try {
    await mod.init(ctx)
  } catch (err) {
    console.error(`[noctiluca] ${name}.init() failed`, err)
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
    ctx.depth?.refresh()
    goToDeepLink()
    keepDepthAcrossRefreshes()
  } catch (err) {
    console.error('[noctiluca] hand-over refresh failed', err)
  }
  resolveReady()
}

async function boot() {
  ctx.depth = createDepth({ gsap, lenis })

  // Start every download at once. The intro only needs its own small chunk
  // and the fonts; three.js and the sections load behind it.
  const loaderP = load(coreModules, './core/loader.js')
  const coreP = CORE_ORDER.map((n) => load(coreModules, `./core/${n}.js`))
  const sectionP = SECTION_ORDER.map((n) => load(sectionModules, `./sections/${n}.js`))

  // Fonts change line breaks: re-measure once they land, but never wait on
  // the font CDN for more than a moment.
  const fontsLoaded = document.fonts?.ready ?? Promise.resolve()
  const fontsReady = Promise.race([fontsLoaded, wait(2500)])
  fontsLoaded.then(() => {
    ScrollTrigger.refresh()
    ctx.depth.refresh()
  })

  // Init in a deterministic order as modules arrive, while the intro plays.
  const initAll = (async () => {
    for (let i = 0; i < CORE_ORDER.length; i++) await run(CORE_ORDER[i], await coreP[i])
    for (let i = 0; i < SECTION_ORDER.length; i++) await run(SECTION_ORDER[i], await sectionP[i])
  })()
  // A module that never settles must not hold the page hostage.
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
    // The loader resolves at the moment the page should take over (it may
    // keep animating its own exit). It holds its release until pageReady.
    await loaderMod.init(ctx, { fontsReady, pageReady })
  } catch (err) {
    console.error('[noctiluca] loader failed', err)
  }
  await pageReady
  handOver()
}

/* ------------------------------------------------------------ deep links */
// The browser jumps to a #hash before pins add their spacers, so it lands in
// the wrong place. Re-aim once the page is laid out (and again after fonts).
function deepLinkTarget() {
  if (!deepLink) return null
  let el = null
  try {
    el = document.querySelector(deepLink)
  } catch {
    return null
  }
  if (!el) return null
  const p = el.parentElement
  return p && p.classList.contains('pin-spacer') ? p : el
}
function goToDeepLink() {
  const el = deepLinkTarget()
  if (!el) return
  const jump = () => {
    const y = el.getBoundingClientRect().top + window.scrollY
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true })
    else window.scrollTo(0, y)
  }
  jump()
  requestAnimationFrame(jump)
  document.fonts?.ready.then(() => requestAnimationFrame(jump))
}

/* ------------------------------------------- keep depth across layout changes */
// When a resize changes pinned/stacked layouts, pixel scroll positions move.
// Keep the visitor at the same depth instead of the same pixel offset.
let depthWatchOn = false
function keepDepthAcrossRefreshes() {
  if (depthWatchOn) return
  depthWatchOn = true
  let saved = 0
  let armed = false // a real resize is in progress: hold the pre-resize depth
  let lastW = window.innerWidth
  let disarmT = 0
  const jump = (y) => {
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true })
    else window.scrollTo(0, y)
  }
  // The resize event fires before depth.js re-measures, so its state still
  // holds the depth the visitor was actually looking at.
  window.addEventListener('resize', () => {
    const widthChanged = window.innerWidth !== lastW
    lastW = window.innerWidth
    if (ScrollTrigger.isTouch && !widthChanged) return // mobile toolbar show/hide
    if (!armed) saved = ctx.depth.get().depth
    armed = true
    clearTimeout(disarmT)
    disarmT = setTimeout(() => (armed = false), 2500)
  })
  ScrollTrigger.addEventListener('refreshInit', () => {
    if (!armed) saved = ctx.depth.get().depth
  })
  ScrollTrigger.addEventListener('refresh', () => {
    const target = saved
    // let sections finish their own refresh work, then re-aim
    requestAnimationFrame(() => {
      armed = false
      if (!(target > 1) || target >= ctx.depth.MAX - 1) return
      ctx.depth.refresh()
      const y = ctx.depth.scrollYForDepth(target)
      if (Math.abs(y - window.scrollY) >= 4) jump(y)
    })
  })
}

/* ------------------------------------------------------------ in-page links */
// One handler for every a[href^="#"]: smooth-scroll (pin-aware), keep a real
// history entry, and move keyboard focus to the target section's heading.
function pinBox(el) {
  const p = el.parentElement
  return p && p.classList.contains('pin-spacer') ? p : el
}
function focusSection(el) {
  const h = el.matches('h1, h2') ? el : el.querySelector('h1, h2') || el
  if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1')
  h.focus({ preventScroll: true })
}
function scrollToY(y, { smooth = true, onComplete } = {}) {
  if (lenis) {
    lenis.scrollTo(y, smooth
      ? { duration: 2.4, easing: (t) => 1 - Math.pow(1 - t, 4), onComplete }
      : { immediate: true, force: true, onComplete })
  } else {
    window.scrollTo(0, y)
    onComplete?.()
  }
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
  scrollToY(y, { onComplete: keyboard ? () => focusSection(el) : undefined })
})
window.addEventListener('popstate', (e) => {
  const y = e.state && typeof e.state.y === 'number' ? e.state.y : null
  if (y !== null) return scrollToY(y)
  if (location.hash.length > 1) {
    try {
      const el = document.querySelector(location.hash)
      if (el) scrollToY(pinBox(el).getBoundingClientRect().top + window.scrollY)
    } catch {}
  }
})

/* ------------------------------------------------------------ skip link */
document.querySelector('.skip-link')?.addEventListener('click', (e) => {
  const main = document.getElementById('main')
  if (!main) return
  e.preventDefault()
  e.stopPropagation()
  const y = main.getBoundingClientRect().top + window.scrollY
  if (lenis) lenis.scrollTo(y, { immediate: true, force: true })
  else window.scrollTo(0, y)
  main.focus({ preventScroll: true })
})

boot().catch((err) => {
  console.error('[noctiluca] boot failed', err)
  document.documentElement.classList.add('skip-intro')
  handOver()
})
