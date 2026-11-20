/**
 * hero.js — #top. The page's only <h1>, and the first colour in the dish.
 *
 * After ctx.ready the headline settles out of the water like pigment: every
 * character drifts down from a soft blur into a crisp Bodoni letter. As it
 * settles, three drops go into the dish above it, ultramarine first, then
 * yellow ochre and carmine, so the blooms open and marble into each other.
 * A slow current keeps them moving; scrolling away lifts the headline and
 * the water keeps drifting.
 *
 * The water is never left to dry out while the hero is on screen: every few
 * seconds the headline gives up one of its colour words in turn (shell,
 * insect, bone, stone). The word pales as its pigment drops into the open
 * water beside the bloom, a slow current marbles it in, and the word inks
 * up again. The plate caption keeps the record of what is in the water.
 * Pointing at a colour word (or tapping it) lets a wisp of it rise.
 *
 * After the loader, its hand-over drop of ultramarine (which lands right
 * behind the headline) is adopted as the hero's ultramarine: a current
 * carries it up into open water and clear-water drops lift it off the type.
 *
 * Emits: 'drop' (via ctx.palette.drop, incl. id 'water') and 'stir'.
 * Listens: 'drop' (to keep the caption true, and to notice the loader's
 * hand-over). Without the dish (html.no-dish) the three drops are shown
 * still in SVG; with reduced motion nothing moves.
 */
import '../styles/hero.css'

// The three drops, in the order they go in. Offsets are in units of the
// viewport's short side, from the first drop.
const DROPS = [
  { id: 'ultramarine', at: 0.15, amount: 1.1, radius: 0.098, dx: 0, dy: 0, vx: 0.004, vy: 0.03, size: 0.46 },
  { id: 'yellow-ochre', at: 1.0, amount: 0.95, radius: 0.05, dx: 0.22, dy: 0.15, vx: -0.045, vy: 0.01, size: 0.2 },
  { id: 'carmine', at: 1.8, amount: 0.95, radius: 0.046, dx: -0.21, dy: -0.05, vx: 0.04, vy: -0.012, size: 0.17 },
]

// Where the headline's own drops land, round the bloom (short-side units),
// so each one opens in fresh water at the edge of the last.
const RING = [
  [-0.14, -0.04],
  [0.12, -0.1],
  [0.13, 0.09],
  [-0.04, -0.15],
  [0.02, 0.13],
]
// how much of each goes in: the dark ones are let in more sparingly
const DRIP = { 'bone-black': 0.62, 'tyrian-purple': 0.85, carmine: 0.9, ultramarine: 0.95 }
// The dish dries on paper at about this rate (per second). Only used to
// judge which colours are still visible in the water, for the caption.
const DRY = 0.14
// pigment names that keep their capital inside a sentence
const PROPER = /^(Egyptian|Tyrian)\b/

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

export function init(ctx) {
  const root = document.getElementById('top')
  if (!root) return
  const html = document.documentElement
  const { gsap, SplitText, pigments, reducedMotion } = ctx
  const title = root.querySelector('.hero__title')
  const lines = [...root.querySelectorAll('.hero__line')]
  const ins = [...root.querySelectorAll('[data-hero-in]')]
  const blots = [...root.querySelectorAll('.hero__blot')]
  const cueRule = root.querySelector('.hero__cue-rule')
  const caption = root.querySelector('.hero__caption')
  const capText = caption?.querySelector('.hero__caption-text') ?? null

  // colour words are set in their own pigment (pigments.js is the source)
  for (const w of root.querySelectorAll('.hero__word')) {
    const p = pigments.BY_ID[w.dataset.pigment]
    if (p) w.style.setProperty('--c', p.hex)
  }
  blots.forEach((b, i) => {
    const p = pigments.BY_ID[DROPS[i]?.id]
    if (!p) return
    b.style.setProperty('--blot', p.hex)
  })

  /* ---------------------------------------------------- the plate caption */
  // It names what is in the water, from pigments.js.
  const nameOf = (id, first) => {
    const n = pigments.BY_ID[id]?.name
    if (!n) return null
    return first || PROPER.test(n) ? n : n.charAt(0).toLowerCase() + n.slice(1)
  }
  function captionHTML(ids) {
    const names = ids
      .filter((id) => pigments.BY_ID[id])
      .map((id, i) => `<i>${nameOf(id, i === 0)}</i>`)
    if (!names.length) return ''
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
    return `${list}, dropped into clear water.`
  }
  let capHTML = captionHTML(DROPS.map((d) => d.id))
  if (capText && capHTML) capText.innerHTML = capHTML

  /* ------------------------------------------------------- where they land */
  // The open water above the headline, to the right of its short first line.
  // Returns viewport fractions (what the dish takes).
  function textBox(el) {
    const r = document.createRange()
    r.selectNodeContents(el)
    return r.getBoundingClientRect()
  }
  function spots() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const s = Math.min(vw, vh)
    const mobile = vw < 768
    const l1 = textBox(lines[0])
    const top = l1.top
    // on a phone the open water is the band between the bar and the headline
    const ux = mobile ? 0.6 : clamp((l1.right / vw + 0.86) / 2, 0.62, 0.76)
    const uy = mobile ? clamp(0.11 + (top / vh - 0.11) * 0.5, 0.2, 0.34) : clamp(top / vh - 0.07, 0.3, 0.44)
    return DROPS.map((d) => ({
      x: clamp(ux + (d.dx * s) / vw, 0.08, 0.94),
      y: clamp(uy + (d.dy * s) / vh, 0.12, 0.9),
    }))
  }
  function placeStill() {
    const sp = spots()
    const rootTop = root.getBoundingClientRect().top
    const s = Math.min(window.innerWidth, window.innerHeight)
    blots.forEach((b, i) => {
      if (!sp[i]) return
      b.style.setProperty('--bx', `${sp[i].x * 100}%`)
      b.style.setProperty('--by', `${sp[i].y * window.innerHeight - rootTop}px`)
      b.style.setProperty('--bs', `${DROPS[i].size * s}px`)
    })
  }

  placeStill()
  document.fonts?.ready.then(placeStill)
  window.addEventListener('resize', () => placeStill(), { passive: true })

  if (reducedMotion) {
    root.classList.add('is-still')
    return
  }

  /* -------------------------------------------- what is in the water now */
  // A clock that stops while the tab is hidden (so does the dish).
  let hiddenAt = 0
  let hiddenFor = 0
  const clock = () => (performance.now() - hiddenFor - (hiddenAt ? performance.now() - hiddenAt : 0)) / 1000
  const water = new Map() // id → { t, a: amount, w: amount × radius² }
  const left = (e, t) => Math.exp(-DRY * (t - e.t))
  ctx.on('drop', (d) => {
    const id = d?.id
    if (!id || !pigments.BY_ID[id]) return // clear water lifts colour; it adds none
    const t = clock()
    const a = d.amount ?? 1
    const r = d.radius ?? 0.12
    const prev = water.get(id)
    // a wisp of a colour that is already blooming doesn't replace the bloom
    if (prev && prev.w * left(prev, t) > a * r * r) return
    water.set(id, { t, a, w: a * r * r })
  })
  // pouring a field washes the paper's drops away
  ctx.palette.onChange((st) => {
    if (st.field !== 'paper' && water.size) water.clear()
  })
  function inWater() {
    const t = clock()
    return [...water]
      .map(([id, e]) => ({ id, t: e.t, a: e.a * left(e, t), w: e.w * left(e, t) }))
      .filter((e) => e.a > 0.16)
      .sort((x, y) => y.w - x.w)
      .slice(0, 3)
      .sort((x, y) => x.t - y.t)
      .map((e) => e.id)
  }
  let capTl = null
  function setCaption(ids) {
    if (!capText || !ids.length) return
    const next = captionHTML(ids)
    if (!next || next === capHTML) return
    capHTML = next
    capTl?.kill()
    capTl = gsap
      .timeline()
      .to(capText, { opacity: 0, duration: 0.45, ease: 'power1.in' })
      .add(() => {
        capText.innerHTML = next
      })
      .to(capText, { opacity: 1, duration: 1.3, ease: 'power2.out' })
  }

  /* ------------------------------------------------- settle, like pigment */
  // Characters are split per line, so the lines themselves stay free for the
  // scroll lift. The accessible text is the visually hidden copy in the h1.
  let split = null
  try {
    split = SplitText.create(lines, { type: 'chars', charsClass: 'hero__ch', aria: 'none' })
  } catch (err) {
    console.error('[hero] split failed', err)
  }
  const chars = split ? split.chars : []
  const lineOf = new Map()
  lines.forEach((l, i) => l.querySelectorAll('.hero__ch').forEach((c) => lineOf.set(c, i)))
  const rnd = gsap.utils.random

  if (chars.length) {
    gsap.set(chars, {
      opacity: 0,
      yPercent: () => rnd(-78, -26),
      xPercent: () => rnd(-22, 22),
      rotation: () => rnd(-14, 14),
      scale: () => rnd(1.05, 1.25),
      filter: () => `blur(${rnd(9, 16).toFixed(1)}px)`,
      transformOrigin: '50% 80%',
    })
  } else gsap.set(title, { opacity: 0 })
  gsap.set(ins, { opacity: 0, y: 14, filter: 'blur(6px)' })
  if (caption) gsap.set(caption, { opacity: 0 })
  if (cueRule) gsap.set(cueRule, { scaleY: 0 })

  /* ------------------------------------------------------------ the bloom */
  let current = null // a slow stir round the bloom, while it is fresh
  let bloomAt = null // where the drops went in
  const heroVisible = () => root.getBoundingClientRect().bottom > window.innerHeight * 0.4

  // A slow current round a point: keeps fresh drops marbling into each other.
  // `swell` eases it in and out (for the headline's own drops); otherwise it
  // starts at full strength and dies away.
  function swirl(c, { delay = 0, ticks = 110, k = 0.00085, swell = false } = {}) {
    current?.kill()
    const s = Math.min(window.innerWidth, window.innerHeight)
    const rx = (0.13 * s) / window.innerWidth
    const ry = (0.13 * s) / window.innerHeight
    const phase = swell ? Math.random() * Math.PI * 2 : 0
    let t = 0
    current = gsap.delayedCall(delay, function tick() {
      if (document.hidden) return (current = gsap.delayedCall(0.5, tick))
      t += 1
      const life = swell ? Math.sin((Math.PI * t) / ticks) : 1 - t / ticks
      if (t >= ticks || life <= 0) return (current = null)
      if (heroVisible()) {
        const a = phase + t * 0.23
        const kk = k * life
        ctx.emit('stir', {
          x: c.x + Math.cos(a) * rx,
          y: c.y + Math.sin(a) * ry,
          dx: -Math.sin(a) * kk * (window.innerHeight / window.innerWidth),
          dy: Math.cos(a) * kk,
          strength: 0.85,
          radius: 0.085,
        })
      }
      current = gsap.delayedCall(0.09, tick)
    })
  }

  // The loader hands over by dropping ultramarine into the middle of the
  // dish, which is right behind the headline. If that happened, it becomes
  // the hero's ultramarine: a current carries it up into the open water and
  // clean water lifts what is left off the type, as a painter would.
  let handed = null
  const offHand = ctx.on('drop', (d) => {
    if (!handed && d && d.id === 'ultramarine') handed = { x: d.x ?? 0.5, y: d.y ?? 0.5 }
  })
  function carry(from, to) {
    const h1 = title.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.hypot(dx, dy) || 1
    // where the type sits over the drop: lift colour there with clear water
    const lifts = [
      [0.42, 0.3],
      [0.6, 0.75],
      [0.3, 0.72],
      [0.66, 0.22],
    ].map(([u, v]) => ({ x: (h1.left + h1.width * u) / vw, y: (h1.top + h1.height * v) / vh }))
    for (let i = 0; i < 16; i++) {
      const t = i / 15
      gsap.delayedCall(0.05 + i * 0.07, () => {
        ctx.emit('stir', {
          x: from.x + dx * 0.35 * t,
          y: from.y + dy * 0.35 * t,
          dx: (dx / len) * 0.0017,
          dy: (dy / len) * 0.0017,
          strength: 1,
          radius: 0.13,
        })
        if (i % 4 === 1) {
          const w = lifts[(i - 1) / 4]
          if (w) ctx.palette.drop('water', { x: w.x, y: w.y, amount: 1, radius: 0.085, vx: (dx / len) * 0.06, vy: (dy / len) * 0.06 })
        }
      })
    }
    // and a last touch of clean water where the tail of it still lies
    ;[
      [1.3, 0.6, 0.5],
      [1.6, 0.52, 0.18],
    ].forEach(([at, u, v]) =>
      gsap.delayedCall(at, () =>
        ctx.palette.drop('water', {
          x: (h1.left + h1.width * u) / vw,
          y: (h1.top + h1.height * v) / vh,
          amount: 1,
          radius: 0.07,
          vx: (dx / len) * 0.04,
          vy: (dy / len) * 0.04,
        })
      )
    )
  }

  function bloom() {
    offHand()
    const r = root.getBoundingClientRect()
    if (r.bottom < window.innerHeight * 0.35) return // landed elsewhere (deep link)
    const sp = spots()
    bloomAt = sp
    if (handed) carry(handed, sp[0])
    DROPS.forEach((d, i) => {
      if (i === 0 && handed) return // the loader's drop is our ultramarine
      gsap.delayedCall(d.at, () => {
        ctx.palette.drop(d.id, {
          x: sp[i].x,
          y: sp[i].y,
          amount: d.amount,
          radius: d.radius * (window.innerWidth < 768 ? 0.72 : 1),
          vx: d.vx,
          vy: d.vy,
        })
      })
    })
    // a slow current round the ultramarine keeps the three marbling
    swirl(sp[0], { delay: 2.4 })
  }

  /* ------------------------------------- a colour word gives up its colour */
  // The word pales towards its wash, as if the colour had run out of the
  // letters into the water, then inks up again.
  function letGo(word, p, depth) {
    if (split || !word.isConnected) return // still settling out of the water
    gsap.killTweensOf(word, 'color')
    gsap
      .timeline()
      .to(word, { color: ctx.palette.mixHex(p.hex, p.tint, depth), duration: 0.6, ease: 'power2.out' })
      .to(word, { color: p.hex, duration: 2.8, ease: 'power2.inOut', clearProps: 'color' }, '+=0.6')
  }

  /* -------------------------------------- the sentence feeds the water */
  // While the hero is on screen, every few seconds the next colour word of
  // the headline drops its pigment beside the bloom. Stops off screen and in
  // a hidden tab; never runs without the live dish.
  const dishLive = () => html.classList.contains('dish-on') && !html.classList.contains('no-dish')
  let ambient = false // on once the opening has played
  let inView = true
  let dripT = null
  let turn = 1 // the stone (ultramarine) went in with the bloom: the shell is next
  let ringAt = 0
  const every = () => (ctx.isMobile() ? 9.5 : 8) + Math.random() * 1.5

  function schedule(delay) {
    dripT?.kill()
    dripT = gsap.delayedCall(delay, drip)
  }
  function rest() {
    dripT?.kill()
    dripT = null
  }
  function wake(delay = 1.4) {
    if (!ambient || !inView || document.hidden || dripT) return
    schedule(delay)
  }

  function drip() {
    dripT = null
    if (!inView || document.hidden) return
    if (!dishLive() || ctx.palette.get().field !== 'paper') return schedule(3)
    const words = [...root.querySelectorAll('.hero__word')] // SplitText's revert makes new nodes
    const word = words[turn++ % words.length]
    const p = word && pigments.BY_ID[word.dataset.pigment]
    if (!p) return schedule(every())
    const vw = window.innerWidth
    const vh = window.innerHeight
    const s = Math.min(vw, vh)
    const mobile = vw < 768
    const sp = spots()
    const c = sp[0]
    bloomAt = bloomAt || sp
    const [ox, oy] = RING[ringAt++ % RING.length]
    const k = mobile ? 0.72 : 1
    const x = clamp(c.x + (ox * k * s) / vw, 0.08, 0.94)
    const y = clamp(c.y + (oy * k * s) / vh, 0.13, 0.9)
    const len = Math.hypot(c.x - x, c.y - y) || 1
    letGo(word, p, 0.8)
    gsap.delayedCall(0.3, () => {
      if (!inView) return
      ctx.palette.drop(p.id, {
        x,
        y,
        amount: DRIP[p.id] ?? 0.9,
        radius: 0.06 * k,
        // drawn a little towards the bloom, so they marble
        vx: ((c.x - x) / len) * 0.03,
        vy: ((c.y - y) / len) * 0.03,
      })
      swirl(c, { delay: 0.5, ticks: mobile ? 36 : 50, k: 0.0006, swell: true })
      gsap.delayedCall(0.8, () => setCaption(inWater()))
    })
    schedule(every())
  }

  const io = new IntersectionObserver(
    ([e]) => {
      const v = e.isIntersecting && e.intersectionRatio >= 0.35
      if (v === inView) return
      inView = v
      if (v) {
        setCaption(inWater())
        wake()
      } else rest()
    },
    { threshold: [0, 0.35, 0.7] }
  )
  io.observe(root)

  /* ---------------------------------------------------- the opening move */
  function reveal() {
    const tl = gsap.timeline({ defaults: { overwrite: 'auto' } })
    if (chars.length) {
      tl.to(
        chars,
        {
          opacity: 1,
          yPercent: 0,
          xPercent: 0,
          rotation: 0,
          scale: 1,
          filter: 'blur(0px)',
          duration: () => rnd(1.4, 2.1),
          ease: 'settle',
          delay: (i, el) => (lineOf.get(el) ?? 0) * 0.2 + Math.pow(Math.random(), 1.4) * 0.75,
        },
        0
      )
      // colour words arrive as a pale wash and deepen into masstone
      const tinted = chars.filter((c) => c.closest('.hero__word'))
      tinted.forEach((c) => {
        const p = pigments.BY_ID[c.closest('.hero__word').dataset.pigment]
        if (p) gsap.fromTo(c, { color: p.tint }, { color: p.hex, duration: 2.6, delay: 0.5, ease: 'power2.inOut', clearProps: 'color' })
      })
    } else tl.to(title, { opacity: 1, duration: 1.2, ease: 'power2.out' }, 0)
    tl.add(() => bloom(), 0)
    tl.to(ins, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.4, ease: 'settle', stagger: 0.14 }, 1.15)
    if (cueRule) tl.to(cueRule, { scaleY: 1, duration: 1.2, ease: 'pour' }, 1.5)
    if (caption) tl.to(caption, { opacity: 1, duration: 1.6, ease: 'power2.out' }, 2.6)
    tl.add(() => {
      // crisp again: restore kerning and plain text
      if (split) {
        split.revert()
        split = null
      }
      gsap.set(ins, { clearProps: 'filter,transform' })
    })
    // once the bloom has opened, the headline starts to feed the water
    tl.add(() => {
      ambient = true
      wake(0)
    }, 7)
    return tl
  }

  /* ----------------------------------------------------- lift on scroll */
  function lift() {
    const vh = () => window.innerHeight
    // the water rises with the headline: while the hero scrolls away, the
    // blooms are nudged up the glass, so they drift off instead of hanging
    let lastStir = 0
    const drift = (self) => {
      const v = self.getVelocity() // px per second, + when scrolling down
      const now = performance.now()
      if (v < 40 || now - lastStir < 70 || !bloomAt) return
      lastStir = now
      const k = Math.min(v, 2400) / window.innerHeight / 60
      for (const p of bloomAt) {
        ctx.emit('stir', { x: p.x, y: p.y + 0.06, dx: 0, dy: -k * 0.9, strength: 1.1, radius: 0.16 })
      }
    }
    const tl = gsap.timeline({
      scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: 0.8, onUpdate: drift },
      defaults: { ease: 'none' },
    })
    tl.to(lines[0], { y: () => -vh() * 0.2 }, 0)
      .to(lines[1], { y: () => -vh() * 0.14 }, 0)
      .to(lines[2], { y: () => -vh() * 0.09 }, 0)
      .to(title, { opacity: 0, ease: 'power2.in' }, 0)
      .to([root.querySelector('.hero__foot'), caption].filter(Boolean), { y: () => -vh() * 0.06, opacity: 0, ease: 'power1.in' }, 0)
  }

  /* ------------------------------------------- touch a colour, it bleeds */
  // A fine pointer over a colour word (or a tap on one) lets a wisp of its
  // pigment rise out of the letters.
  const last = new WeakMap()
  function bleed(w) {
    const p = pigments.BY_ID[w.dataset.pigment]
    if (!p) return
    const now = performance.now()
    if (now - (last.get(w) || 0) < 1400) return
    last.set(w, now)
    const r = w.getBoundingClientRect()
    ctx.palette.drop(p.id, {
      x: (r.left + r.width * 0.5) / window.innerWidth,
      y: (r.top + r.height * 0.1) / window.innerHeight,
      amount: 0.45,
      radius: 0.032,
      vy: -0.05,
    })
    letGo(w, p, 0.5)
    // the visitor is feeding the water: the headline waits its turn
    if (dripT) schedule(every())
  }
  if (!ctx.isTouch) {
    title.addEventListener('pointerover', (e) => {
      const w = e.target.closest?.('.hero__word')
      if (w) bleed(w)
    })
  }
  title.addEventListener('click', (e) => {
    const w = e.target.closest?.('.hero__word')
    if (w) bleed(w)
  })

  ctx.ready.then(() => {
    reveal()
    lift()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = performance.now()
      current?.pause()
      rest()
    } else {
      if (hiddenAt) hiddenFor += performance.now() - hiddenAt
      hiddenAt = 0
      current?.resume()
      wake(2)
    }
  })
}
