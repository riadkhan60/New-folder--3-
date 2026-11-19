/**
 * hero.js — #top. The page's only <h1>, and the first colour in the dish.
 *
 * After ctx.ready the headline settles out of the water like pigment: every
 * character drifts down from a soft blur into a crisp Bodoni letter. As it
 * settles, three drops go into the dish above it, ultramarine first, then
 * yellow ochre and carmine, so the blooms open and marble into each other.
 * A slow current keeps them moving for a while; scrolling away lifts the
 * headline and the water keeps drifting.
 *
 * After the loader, its hand-over drop of ultramarine (which lands right
 * behind the headline) is adopted as the hero's ultramarine: a current
 * carries it up into open water and clear-water drops lift it off the type.
 *
 * Emits: 'drop' (via ctx.palette.drop, incl. id 'water') and 'stir'.
 * Listens: 'drop', only until ctx.ready, to notice the loader's hand-over.
 * Without the dish (html.no-dish) the three drops are shown still in SVG.
 */
import '../styles/hero.css'

// The three drops, in the order they go in. Offsets are in units of the
// viewport's short side, from the first drop.
const DROPS = [
  { id: 'ultramarine', at: 0.15, amount: 1.1, radius: 0.098, dx: 0, dy: 0, vx: 0.004, vy: 0.03, size: 0.46 },
  { id: 'yellow-ochre', at: 1.0, amount: 0.95, radius: 0.05, dx: 0.22, dy: 0.15, vx: -0.045, vy: 0.01, size: 0.2 },
  { id: 'carmine', at: 1.8, amount: 0.95, radius: 0.046, dx: -0.21, dy: -0.05, vx: 0.04, vy: -0.012, size: 0.17 },
]

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

export function init(ctx) {
  const root = document.getElementById('top')
  if (!root) return
  const { gsap, SplitText, pigments, reducedMotion } = ctx
  const title = root.querySelector('.hero__title')
  const lines = [...root.querySelectorAll('.hero__line')]
  const ins = [...root.querySelectorAll('[data-hero-in]')]
  const blots = [...root.querySelectorAll('.hero__blot')]
  const cueRule = root.querySelector('.hero__cue-rule')
  const caption = root.querySelector('.hero__caption')

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
  let current = null // ambient stir, while the blooms are fresh
  let bloomAt = null // where the drops went in

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
    const c = sp[0]
    const s = Math.min(window.innerWidth, window.innerHeight)
    const rx = (0.13 * s) / window.innerWidth
    const ry = (0.13 * s) / window.innerHeight
    let t = 0
    current = gsap.delayedCall(2.4, function tick() {
      if (document.hidden) return (current = gsap.delayedCall(0.5, tick))
      t += 1
      const life = 1 - t / 110
      if (life <= 0) return (current = null)
      const vis = root.getBoundingClientRect().bottom > window.innerHeight * 0.4
      if (vis) {
        const a = t * 0.23
        const k = 0.00085 * life
        ctx.emit('stir', {
          x: c.x + Math.cos(a) * rx,
          y: c.y + Math.sin(a) * ry,
          dx: -Math.sin(a) * k * (window.innerHeight / window.innerWidth),
          dy: Math.cos(a) * k,
          strength: 0.85,
          radius: 0.085,
        })
      }
      current = gsap.delayedCall(0.09, tick)
    })
  }

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
  // A fine pointer over a colour word lets a wisp of its pigment rise.
  if (!ctx.isTouch) {
    const last = new WeakMap()
    title.addEventListener('pointerover', (e) => {
      const w = e.target.closest?.('.hero__word')
      if (!w) return
      const now = performance.now()
      if (now - (last.get(w) || 0) < 1400) return
      last.set(w, now)
      const r = w.getBoundingClientRect()
      ctx.palette.drop(w.dataset.pigment, {
        x: (r.left + r.width * 0.5) / window.innerWidth,
        y: (r.top + r.height * 0.1) / window.innerHeight,
        amount: 0.45,
        radius: 0.032,
        vy: -0.05,
      })
    })
  }

  ctx.ready.then(() => {
    reveal()
    lift()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) current?.pause()
    else current?.resume()
  })
}
