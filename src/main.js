/**
 * main.js — boot sequence. Owned by the scaffold.
 *
 * Every core + section module exports `init(ctx)` (may be async, may return a
 * cleanup fn). Modules are loaded in isolation: a crash in one never takes
 * down the rest of the page. Each module imports its own CSS.
 */
import 'lenis/dist/lenis.css'
import './styles/base.css'

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
const skipIntro = params.has('skipintro') || reducedMotion || !!deepLink

if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
if (!location.hash) window.scrollTo(0, 0)

/* ------------------------------------------------------------ smooth scroll */
const lenis = reducedMotion
  ? null
  : new Lenis({
      lerp: 0.085,
      wheelMultiplier: 0.95,
      touchMultiplier: 1.4,
      anchors: { offset: 0, duration: 2.4 },
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

async function boot() {
  ctx.depth = createDepth({ gsap })

  // Load everything in parallel, init in a deterministic order.
  const [core, sections, loaderMod] = await Promise.all([
    Promise.all(CORE_ORDER.map((n) => load(coreModules, `./core/${n}.js`))),
    Promise.all(SECTION_ORDER.map((n) => load(sectionModules, `./sections/${n}.js`))),
    load(coreModules, './core/loader.js'),
  ])

  for (let i = 0; i < CORE_ORDER.length; i++) await run(CORE_ORDER[i], core[i])
  for (let i = 0; i < SECTION_ORDER.length; i++) await run(SECTION_ORDER[i], sections[i])

  // Fonts change line breaks → re-measure every trigger once they land.
  const fontsReady = document.fonts?.ready ?? Promise.resolve()
  fontsReady.then(() => {
    ScrollTrigger.refresh()
    ctx.depth.refresh()
  })

  const handOver = () => {
    document.documentElement.classList.remove('is-loading')
    document.documentElement.classList.add('is-ready')
    lenis?.start()
    ScrollTrigger.refresh()
    ctx.depth.refresh()
    goToDeepLink()
    keepDepthAcrossRefreshes()
    resolveReady()
  }

  if (skipIntro || !loaderMod?.init) {
    document.documentElement.classList.add('skip-intro')
    await fontsReady
    handOver()
    return
  }

  lenis?.stop()
  try {
    // loader.init(ctx, { fontsReady }) must resolve at the moment the page
    // should take over (it may keep animating its own exit afterwards).
    await loaderMod.init(ctx, { fontsReady })
  } catch (err) {
    console.error('[noctiluca] loader failed', err)
  }
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

boot()
