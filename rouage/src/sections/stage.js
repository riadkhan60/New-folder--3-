/**
 * stage.js — the hero watch, and the scroll that takes it apart.
 *
 * The stage is pinned (CSS sticky) while one scrubbed timeline plays:
 *   the hero copy leaves → the watch moves to the middle and tilts back →
 *   its layers lift apart from the top down, each with a label →
 *   it turns slowly while you read → it closes and faces you again.
 * Positions depend on the viewport, so they are measured and the timeline's
 * values are functions that are read again on every refresh.
 */
import { createWatch } from '../watch/watch.js'
import { LAYERS } from '../watch/train.js'

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const smooth = (t) => t * t * (3 - 2 * t)
const pad = (n) => String(n).padStart(2, '0')
const RX = 59 // how far the watch leans back when it is apart
const SIN = Math.sin((RX * Math.PI) / 180)
const COS = Math.cos((RX * Math.PI) / 180)
const ABOVE = LAYERS.crystal.o // layers above the train …
const BELOW = -LAYERS.back.o // … and below it

export function initStage(ctx) {
  const { gsap, ScrollTrigger, SplitText, reduced } = ctx
  const stage = document.querySelector('.stage')
  if (!stage) return
  const pin = stage.querySelector('.stage__pin')
  const holder = stage.querySelector('[data-stage-watch]')
  const watchEl = holder.querySelector('.watch')
  const hero = stage.querySelector('[data-hero]')
  const hint = stage.querySelector('[data-hint]')
  const inside = stage.querySelector('[data-inside]')
  const light = stage.querySelector('.stage__light')
  const partsEl = inside.querySelector('[data-parts]')
  const labels = [...partsEl.querySelectorAll('li')]
  const linesSvg = inside.querySelector('[data-lines]')

  const reserveOut = document.querySelectorAll('[data-reserve]')
  const watch = createWatch(watchEl, {
    reduced,
    onWind(reserve) {
      reserveOut.forEach((el) => (el.textContent = Math.round(reserve)))
      hint.style.setProperty('--hint', 0)
    },
  })
  ctx.watch = watch
  ctx.frames.add(watch.frame)

  /* ---- labels and their leader lines ---- */
  const NS = 'http://www.w3.org/2000/svg'
  const items = labels.map((li) => {
    const path = document.createElementNS(NS, 'path')
    const dot = document.createElementNS(NS, 'circle')
    dot.setAttribute('r', 3)
    linesSvg.append(path, dot)
    const name = li.dataset.part
    return { li, path, dot, name, anchor: watch.anchor(name), y: 0 }
  })

  /* ---- geometry for this viewport ---- */
  const V = { x: 0, y: 0, s: 1, rx: 0, rz: 0, apart: 0, hero: 1, inside: 0 } // what the timeline animates
  let G = null
  function measure() {
    const w = pin.clientWidth
    const h = pin.clientHeight
    const size = parseFloat(getComputedStyle(watchEl).fontSize) * 100
    const wide = matchMedia('(min-width: 900px) and (min-aspect-ratio: 21/20)').matches
    const nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) * 16 || 64
    const home = wide ? { x: w * 0.7, y: h * 0.51 } : { x: w * 0.5, y: nav + size * 0.5 }

    // Apart: the stack must fit between the nav and the bottom (or the caption on a phone).
    const top = nav + (wide ? 34 : 72)
    const bottom = h - (wide ? 58 : 122)
    const room = bottom - top
    let s = Math.min(wide ? (w * 0.36) / (size * 0.9) : (w * 0.9) / (size * 0.9), 0.78)
    const disc = () => 1.06 * size * s * COS // the leaning case, seen from the page
    let gapPx = (room - disc()) / ((ABOVE + BELOW) * SIN)
    if (gapPx < 30) {
      s = Math.max(0.34, (room - 30 * (ABOVE + BELOW) * SIN) / (1.06 * size * COS))
      gapPx = Math.max(22, (room - disc()) / ((ABOVE + BELOW) * SIN))
    }
    gapPx = Math.min(gapPx, wide ? 92 : 64)
    const tall = (ABOVE + BELOW) * gapPx * SIN + disc()
    const mid = top + room / 2 + (room - tall) * 0 // centre of the whole stack
    const apartAt = { x: wide ? w * 0.5 : w * 0.5, y: mid + ((ABOVE - BELOW) / 2) * gapPx * SIN, s }
    G = {
      w,
      h,
      size,
      wide,
      nav,
      home,
      apartAt,
      gap: gapPx / ((size * s) / 1000),
      end: { x: w * 0.5, y: h * 0.52, s: wide ? 0.82 : 0.92 },
      labelX: w * 0.5 + size * s * 0.46 + (wide ? Math.max(70, w * 0.06) : 0),
    }
    if (!V._set) {
      V.x = home.x
      V.y = home.y
      V._set = true
    }
  }
  measure()

  /* ---- the timeline ---- */
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: stage,
      start: 'top top',
      end: 'bottom bottom',
      scrub: reduced ? true : 0.6,
      invalidateOnRefresh: true,
    },
  })
  ScrollTrigger.addEventListener('refreshInit', measure)
  tl.fromTo(V, { hero: 1 }, { hero: 0, duration: 0.07, immediateRender: false }, 0.025)
    .fromTo(
      V,
      { x: () => G.home.x, y: () => G.home.y, s: 1 },
      { x: () => G.apartAt.x, y: () => G.apartAt.y, s: () => G.apartAt.s, duration: 0.17, ease: 'power2.inOut', immediateRender: false },
      0.05
    )
    .fromTo(V, { rx: 0, rz: 0 }, { rx: RX, rz: -31, duration: 0.17, ease: 'power2.inOut', immediateRender: false }, 0.06)
    .fromTo(V, { inside: 0 }, { inside: 1, duration: 0.07, immediateRender: false }, 0.15)
    .fromTo(V, { apart: 0 }, { apart: 1, duration: 0.31, ease: 'power1.inOut', immediateRender: false }, 0.17)
    .to(V, { rz: -9, duration: 0.36 }, 0.45)
    .to(V, { apart: 0, duration: 0.12, ease: 'power2.inOut' }, 0.81)
    .to(V, { inside: 0, duration: 0.05 }, 0.83)
    .to(V, { rx: 0, rz: 0, x: () => G.end.x, y: () => G.end.y, s: () => G.end.s, duration: 0.12, ease: 'power2.inOut' }, 0.87)
    .set({}, {}, 1)

  /* ---- every frame: put the watch and the labels where the timeline says ---- */
  let lastKey = ''
  function apply() {
    const key = [V.x, V.y, V.s, V.rx, V.rz, V.apart, V.hero, V.inside].map((n) => n.toFixed(3)).join()
    const moving = key !== lastKey
    lastKey = key
    if (moving) {
      holder.style.transform = `translate(${V.x.toFixed(1)}px, ${V.y.toFixed(1)}px) scale(${V.s.toFixed(4)})`
      watch.pose({ rx: V.rx, rz: V.rz, apart: V.apart, gap: G.gap })
      const out = 1 - V.hero
      pin.style.setProperty('--out', out.toFixed(3))
      hero.style.visibility = V.hero < 0.01 ? 'hidden' : ''
      inside.style.visibility = V.inside > 0.01 ? 'visible' : ''
      inside.style.setProperty('--in', V.inside.toFixed(3))
      light.style.setProperty('--spot', (((V.x / G.w) * 100) | 0) + '%')
    }
    if (V.inside > 0.01 && (moving || G.wide)) place()
  }
  ctx.frames.add(apply)

  function place() {
    const pr = pin.getBoundingClientRect()
    if (!G.wide) {
      // a phone shows one caption: the layer that lifted last
      let active = -1
      items.forEach((it, i) => {
        if (watch.lift(it.name) > 0.5) active = i
      })
      items.forEach((it, i) => {
        it.li.style.transform = ''
        it.li.style.opacity = i === active ? V.inside : 0
      })
      return
    }
    // side labels: one beside each layer, kept from colliding
    let prev = -Infinity
    const minGap = Math.max(30, Math.min(56, (G.h - G.nav - 40) / items.length))
    partsEl.toggleAttribute('data-tight', minGap < 46)
    items.forEach((it) => {
      const r = it.anchor.getBoundingClientRect()
      it.ax = r.left - pr.left
      it.ay = r.top - pr.top
      it.y = Math.max(it.ay - 12, prev + minGap)
      prev = it.y
    })
    const over = prev + (minGap < 46 ? 24 : 46) - (G.h - 16)
    if (over > 0) {
      // too low: push the column up, keeping the spacing
      let next = Infinity
      for (let i = items.length - 1; i >= 0; i--) {
        items[i].y = Math.min(items[i].y, next - minGap, items[i].y - over * ((i + 1) / items.length))
        next = items[i].y
      }
    }
    items.forEach((it) => {
      const a = smooth(clamp((watch.lift(it.name) - 0.45) / 0.4)) * V.inside
      it.li.style.transform = `translate(${G.labelX.toFixed(1)}px, ${it.y.toFixed(1)}px)`
      it.li.style.opacity = a.toFixed(3)
      const ly = it.y + 11
      it.path.setAttribute('d', `M${it.ax.toFixed(1)} ${it.ay.toFixed(1)}L${(G.labelX - 46).toFixed(1)} ${ly.toFixed(1)}H${(G.labelX - 12).toFixed(1)}`)
      it.path.style.opacity = a.toFixed(3)
      it.dot.setAttribute('cx', it.ax.toFixed(1))
      it.dot.setAttribute('cy', it.ay.toFixed(1))
      it.dot.style.opacity = a.toFixed(3)
    })
  }

  /* ---- the light follows a mouse; without one it drifts ---- */
  let idleTimer = 0
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse' || reduced) return
      const r = stage.getBoundingClientRect()
      if (r.bottom < 0 || r.top > innerHeight) return
      watch.light((e.clientX - V.x) / (innerWidth * 0.5), (e.clientY - V.y) / (innerHeight * 0.5))
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => watch.idle(true), 3200)
    },
    { passive: true }
  )
  if (reduced) {
    watch.idle(false)
    watch.light(0.25, -0.2)
  }

  /* ---- live readings ---- */
  const timeOut = document.querySelectorAll('[data-localtime]')
  let lastSec = -1
  ctx.frames.add((now) => {
    const t = Math.floor(watch.time(now))
    if (t === lastSec || !watch.running()) return
    lastSec = t
    const text = `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`
    timeOut.forEach((el) => (el.textContent = text))
  })

  /* ---- arrival: the hands sweep to the time while the words land on the beat ---- */
  const root = document.documentElement
  const arrive = [...document.querySelectorAll('[data-intro]')]
  if (reduced) {
    root.classList.add('is-in')
    hint.style.setProperty('--hint', 1)
    return
  }
  const title = hero.querySelector('.hero__title')
  const nav = document.querySelector('[data-nav]')
  const rest = arrive.filter((el) => el !== title && el !== nav)
  const split = new SplitText(title, { type: 'words', wordsClass: 'word' })
  gsap.set(split.words, { opacity: 0, y: '0.35em' })
  gsap.set(title, { opacity: 1 })
  gsap.set(rest, { opacity: 0, y: 14 })
  const begin = () => {
    watch.start()
    // one word a beat: five a second, in step with the seconds hand
    gsap.to(split.words, { opacity: 1, y: 0, duration: 0.34, ease: 'power3.out', stagger: 0.2, delay: 0.25 })
    if (nav) gsap.to(nav, { opacity: 1, duration: 0.8, ease: 'power2.out', delay: 0.3 })
    gsap.to(rest, {
      opacity: 1,
      y: 0,
      duration: 0.8,
      ease: 'power3.out',
      stagger: 0.09,
      delay: 0.7,
      onComplete() {
        hint.style.setProperty('--hint', 1)
        root.classList.add('is-in')
        gsap.set(arrive, { clearProps: 'opacity,transform' })
      },
    })
  }
  const fontsIn = document.fonts?.ready ?? Promise.resolve()
  Promise.race([fontsIn, new Promise((r) => setTimeout(r, 1200))]).then(() => setTimeout(begin, 180))
}
