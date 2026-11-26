/**
 * main.js — boot.
 *
 * The page is complete without this file (the watch is drawn into the HTML
 * at build time). Scripts make it run: one clock ticks everything that
 * moves, Lenis smooths the scroll, and each section starts on its own so
 * that a failure in one never takes the others down.
 */
import './styles/base.css'
import './styles/watch.css'
import './styles/sections.css'

import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import Lenis from 'lenis'

import { initStage } from './sections/stage.js'
import { initBench } from './sections/bench.js'
import { initFinish } from './sections/finish.js'
import { initConfig } from './sections/config.js'
import { initList } from './sections/list.js'
import { initNav } from './sections/nav.js'

gsap.registerPlugin(ScrollTrigger, SplitText)

const params = new URLSearchParams(location.search)
const reduced = params.has('reduced') || matchMedia('(prefers-reduced-motion: reduce)').matches

const ctx = {
  gsap,
  ScrollTrigger,
  SplitText,
  reduced,
  lenis: null,
  /** Functions called every animation frame with performance.now(). */
  frames: new Set(),
  /** The hero watch, once the stage has made it run. */
  watch: null,
  scrollTo,
}

/* ---- smooth scroll ---- */
if (!reduced) {
  const lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 0.95 })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((t) => lenis.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
  ctx.lenis = lenis
}

/* ---- one clock ---- */
gsap.ticker.add(() => {
  const now = performance.now()
  for (const f of ctx.frames) {
    try {
      f(now)
    } catch (e) {
      ctx.frames.delete(f)
      console.error('[rouage] a frame handler failed and was stopped', e)
    }
  }
})

/** Scroll to an element or a y position; resolves when the page is there. */
function scrollTo(target, { immediate = false } = {}) {
  const y =
    typeof target === 'number'
      ? target
      : target.id === 'top'
        ? 0
        : target.getBoundingClientRect().top + window.scrollY
  return new Promise((resolve) => {
    if (ctx.lenis && !immediate) {
      ctx.lenis.scrollTo(y, { duration: 1.5, easing: (t) => 1 - (1 - t) ** 4, onComplete: resolve, force: true })
    } else {
      window.scrollTo({ top: y, behavior: 'auto' })
      ctx.lenis?.scrollTo(y, { immediate: true, force: true })
      resolve()
    }
  })
}

/* ---- in-page links: glide, then hand keyboard focus to where they lead ---- */
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="#"]')
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const id = a.getAttribute('href').slice(1)
  const target = id ? document.getElementById(id) : null
  if (!target) return
  e.preventDefault()
  const keyboard = e.detail === 0
  scrollTo(target).then(() => {
    try {
      history.replaceState(null, '', '#' + id)
    } catch {}
    if (!keyboard) return
    const focusable = id === 'main' ? target : target.querySelector('h1, h2') || target
    if (!focusable.hasAttribute('tabindex')) focusable.setAttribute('tabindex', '-1')
    focusable.focus({ preventScroll: true })
  })
})

/* ---- sections ---- */
const start = (name, fn) => {
  try {
    fn(ctx)
  } catch (e) {
    console.error(`[rouage] ${name} failed to start`, e)
  }
}
start('stage', initStage)
start('bench', initBench)
start('finish', initFinish)
start('config', initConfig)
start('list', initList)
start('nav', initNav)

/* ---- headings arrive word by word as they scroll into view ---- */
if (!reduced) {
  document.querySelectorAll('.h2').forEach((el) => {
    const split = new SplitText(el, { type: 'words', wordsClass: 'word' })
    gsap.set(split.words, { opacity: 0, y: '0.4em' })
    ScrollTrigger.create({
      trigger: el,
      start: 'top 86%',
      once: true,
      onEnter: () => gsap.to(split.words, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: 0.07 }),
    })
  })
  gsap.utils.toArray('.lede, .eyebrow:not([data-intro]), .samples > li, .spec > div, .opts, .yours__sum, .form .field, .bench__panel > *').forEach((el) => {
    if (el.closest('.hero, .inside')) return
    gsap.set(el, { opacity: 0, y: 18 })
    ScrollTrigger.create({
      trigger: el,
      start: 'top 92%',
      once: true,
      onEnter: () => gsap.to(el, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', clearProps: 'transform' }),
    })
  })
}

/* Fonts change the height of things: measure again once they are in. */
document.fonts?.ready.then(() => ScrollTrigger.refresh())
window.addEventListener('load', () => ScrollTrigger.refresh())

window.__rouage = ctx
