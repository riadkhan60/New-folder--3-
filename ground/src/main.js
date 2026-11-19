/**
 * main.js — boot sequence for Ground. Owned by the scaffold.
 *
 * Every core + section module exports `init(ctx)` (may be async). Modules load
 * in isolation: a crash in one never takes down the page. All CSS ships in
 * the entry stylesheet so sections are styled from the first paint.
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
  emit: (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail })),
  on: (name, fn) => {
    const h = (e) => fn(e.detail)
    bus.addEventListener(name, h)
    return () => bus.removeEventListener(name, h)
  },
  scrollTo(target, opts = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target
    const dest = el && el.parentElement?.classList.contains('pin-spacer') ? el.parentElement : el
    if (lenis) lenis.scrollTo(dest ?? target, { duration: 2, easing: (t) => 1 - Math.pow(1 - t, 4), ...opts })
    else if (dest?.scrollIntoView) dest.scrollIntoView({ behavior: 'auto' })
    else window.scrollTo(0, typeof target === 'number' ? target : 0)
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
  const jump = () => {
    const y = pinBox(el).getBoundingClientRect().top + window.scrollY
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true })
    else window.scrollTo(0, y)
  }
  jump()
  requestAnimationFrame(jump)
  document.fonts?.ready.then(() => requestAnimationFrame(jump))
}
function scrollToY(y, { onComplete } = {}) {
  if (lenis) lenis.scrollTo(y, { duration: 2, easing: (t) => 1 - Math.pow(1 - t, 4), onComplete })
  else {
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
