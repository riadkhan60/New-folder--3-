/**
 * hero.js — #surface. The page's only <h1>, just under the surface.
 *
 * 1. Intro: the title's characters settle into focus the way things do seen
 *    through moving water — a ripple travels out from the centre, each glyph
 *    wavers, stretches and un-blurs, while the whole line breathes out to
 *    its full surface width. With the loader it starts as the flood's
 *    waterline reaches the title band (the loader's .is-exiting + 0.55 s),
 *    so the water uncovers the headline as it forms; ctx.ready is the
 *    fallback (?skipintro, or a fast-forwarded intro).
 * 2. Scroll: the hero's exit is the first, plainest demonstration of the
 *    site's one idea. The composition holds almost still for the first
 *    screen of scroll (it rises at a few percent of the scroll speed and
 *    eases into full speed), so the squeeze happens in plain view:
 *      - the lead, the fact and the cue let go first;
 *      - the title takes on the first of the pressure: it narrows and
 *        thickens to the type of the water below it (Anybody wdth/wght of
 *        ctx.depth.compression(100), the descent section's own state), its
 *        lines and letters pack tighter. power2.in, so the pressure builds.
 *        Compression only ever grows with depth: every heading further down
 *        is narrower and heavier than this one ends up;
 *      - then it rises away and dims, handing over to the manifesto.
 *    One CSS variable (--squeeze, 0 → 1) drives every axis; hero.css maps it.
 * 3. A plumb line pays out under "Scroll to descend", slowly, on a loop.
 */
import '../styles/hero.css'

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))

export function init(ctx) {
  const root = document.getElementById('surface')
  if (!root) return
  const { gsap, SplitText } = ctx

  const title = root.querySelector('.hero__title')
  const stage = root.querySelector('.hero__stage')
  const foot = root.querySelector('.hero__foot')
  const reveals = [...root.querySelectorAll('[data-hero-reveal]')]
  const cord = root.querySelector('.hero__plumb-cord')
  const bob = root.querySelector('.hero__plumb-bob')

  // Reduced motion: final, static state. No split, no scrub, no loop.
  if (ctx.reducedMotion || !title) {
    root.classList.add('is-static')
    return
  }

  root.classList.add('is-armed')
  let introDone = false

  // the squeeze ends at the type of the water the title sinks into
  const sq = ctx.depth?.compression?.(100)
  if (sq) {
    title.style.setProperty('--sq-wdth', sq.wdth)
    title.style.setProperty('--sq-wght', sq.wght)
  }

  /* ------------------------------------------------------------ split */
  let split = null
  try {
    split = new SplitText(title, {
      type: 'words,chars',
      wordsClass: 'hero__word',
      charsClass: 'hero__char',
    })
  } catch (err) {
    console.warn('[hero] SplitText failed', err)
  }
  const chars = split?.chars ?? []

  // Pre-intro state (the loader covers the page meanwhile).
  gsap.set(chars, { opacity: 0 })
  gsap.set(reveals, { opacity: 0 })
  gsap.set(title, { '--breath': -34, '--press': -40 })

  /* --------------------------------------------------- plumb line loop */
  const L = 96
  const plumb = gsap.timeline({ repeat: -1, repeatDelay: 0.6, paused: true })
  if (cord && bob) {
    plumb
      .set(cord, { drawSVG: '0% 0%', opacity: 1 })
      .set(bob, { y: 0, opacity: 0 })
      .to(bob, { opacity: 1, duration: 0.5, ease: 'power1.out' }, 0)
      .to(bob, { y: L, duration: 3.2, ease: 'power2.inOut' }, 0)
      .to(cord, { drawSVG: '0% 100%', duration: 3.2, ease: 'power2.inOut' }, 0)
      .to([bob, cord], { opacity: 0, duration: 0.8, ease: 'power1.in' }, 3.0)
  }

  /* ----------------------------------------------------------- intro */
  let played = false
  // ghost: started by the flood, while the loader's wordmark still sits on
  // the title band. The title forms as a soft, faint shape in the water and
  // only pulls into focus as the wordmark lifts away toward the nav.
  function playIntro(ghost = false) {
    if (played) return
    played = true
    root.classList.remove('is-armed')
    const ease = gsap.parseEase('abyss')
    const tb = title.getBoundingClientRect()
    const cx = tb.left + tb.width / 2
    const half = Math.max(1, tb.width / 2)

    const data = chars.map((el) => {
      const r = el.getBoundingClientRect()
      const x = clamp((r.left + r.width / 2 - cx) / half, -1, 1)
      const line = r.top - tb.top > tb.height * 0.4 ? 1 : 0
      return { el, s: el.style, x, line, delay: Math.abs(x) * 0.45 + line * 0.12 }
    })

    // legible ~0.4 s after it starts at the centre, ~0.9 s at the ends;
    // the ripple's last wavering settles over the long tail
    const DUR = 1.7
    const total = DUR + 0.45 + 0.12 + 0.05
    const st = { t: 0 }
    const g = ghost ? { op: 0.36, blur: 9 } : { op: 1, blur: 0 }
    if (ghost) gsap.to(g, { op: 1, blur: 0, duration: 0.5, ease: 'power2.inOut', delay: GHOST_FOCUS })

    const draw = () => {
      for (const c of data) {
        const lp = clamp((st.t - c.delay) / DUR)
        const e = ease(lp)
        const inv = 1 - e
        // a travelling ripple that dies out as each glyph settles
        const ph = c.x * 7.5 - st.t * 6.2 + c.line * 1.4
        const y = inv * (0.3 + 0.13 * Math.sin(ph))
        const x = inv * 0.05 * Math.sin(ph * 1.3 + 0.8)
        const sk = inv * 7 * Math.cos(ph)
        const sy = 1 + inv * 0.5
        const blur = inv * inv * 18 + g.blur
        c.s.opacity = (Math.min(1, lp * 3.2) * g.op).toFixed(3)
        c.s.transform = `translate3d(${x.toFixed(4)}em, ${y.toFixed(4)}em, 0) skewX(${sk.toFixed(2)}deg) scaleY(${sy.toFixed(4)})`
        c.s.filter = blur > 0.1 ? `blur(${blur.toFixed(2)}px)` : 'none'
      }
    }
    const done = () => {
      for (const c of data) {
        c.s.transform = ''
        c.s.filter = ''
        c.s.opacity = ''
      }
    }

    if (data.length) {
      draw()
      gsap.to(st, { t: total, duration: total, ease: 'none', onUpdate: draw, onComplete: done })
    }
    // the line exhales to its full surface width as the light floods in
    gsap.to(title, { '--breath': 0, '--press': 0, duration: 2.6, ease: 'abyss' })

    gsap.delayedCall(1.9, () => {
      introDone = true
      if (plumbST.isActive && !document.hidden) plumb.play()
    })

    // the rest comes into focus, as if through water
    gsap.fromTo(
      reveals,
      { opacity: 0, filter: 'blur(10px)' },
      {
        opacity: 1,
        filter: 'blur(0px)',
        duration: 1.6,
        ease: 'abyss',
        stagger: 0.16,
        delay: 0.8,
        clearProps: 'filter',
      },
    )
  }

  /* ---------------------------------------------- scroll: under pressure */
  const vh = () => window.innerHeight

  // 1. The hold. Exact (scrub: true) so the title never swims against the
  //    scroll. sine.out with an amplitude of 0.6 × the range means the block
  //    starts out rising at ~6% of the scroll speed and eases, without a
  //    seam, into moving with the page by the end of the first screen.
  const HOLD = 0.95 // screens
  if (stage && foot) {
    gsap.fromTo(
      [stage, foot],
      { y: 0 },
      {
        y: () => vh() * HOLD * 0.6,
        ease: 'sine.out',
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end: () => `+=${Math.round(vh() * HOLD)}`,
          scrub: true,
          invalidateOnRefresh: true,
        },
      },
    )
  }

  // 2. The squeeze and 3. the release, over one screen of scroll.
  gsap
    .timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: root,
        start: 'top top',
        end: () => `+=${Math.round(vh())}`,
        scrub: 0.5,
        invalidateOnRefresh: true,
      },
    })
    // the small things let go first (autoAlpha: the cue leaves the tab order)
    .fromTo(foot, { autoAlpha: 1, yPercent: 0 }, { autoAlpha: 0, yPercent: -12, ease: 'power1.in', duration: 0.26 }, 0)
    // the pressure builds, and keeps building
    .fromTo(title, { '--squeeze': 0 }, { '--squeeze': 1, ease: 'power2.in', duration: 0.62 }, 0)
    // a dense, narrow block now: it rises away into the water
    .fromTo(title, { opacity: 1 }, { opacity: 0.12, ease: 'power1.in', duration: 0.4 }, 0.6)

  // only loop the plumb line while it can be seen
  const plumbST = ctx.ScrollTrigger.create({
    trigger: root,
    start: 'top bottom',
    end: () => `top+=${Math.round(vh() * 0.26)} top`,
    onToggle: (self) => {
      if (self.isActive && introDone) plumb.play()
      else plumb.pause()
    },
  })

  // With the loader: start as the flood's waterline reaches the title band
  // (it crosses the screen in 1.2 s; at 0.55 s it is under the first line),
  // while the loader's wordmark lifts away toward the nav.
  const FLOOD_TO_TITLE = 0.55
  // …and focus as the wordmark (it flies at flood + 0.7 s) clears the band
  const GHOST_FOCUS = 0.45
  let offFlood = null
  let floodObs = null
  const onFlood = () => {
    offFlood?.()
    floodObs?.disconnect()
    offFlood = floodObs = null
    if (!played) gsap.delayedCall(FLOOD_TO_TITLE, playIntro, [true])
  }
  const loaderEl = ctx.skipIntro ? null : document.querySelector('.loader')
  if (loaderEl) {
    offFlood = ctx.on('intro:flood', onFlood)
    if (loaderEl.classList.contains('is-exiting')) onFlood()
    else if (typeof MutationObserver !== 'undefined') {
      floodObs = new MutationObserver(() => {
        if (loaderEl.classList.contains('is-exiting')) onFlood()
      })
      floodObs.observe(loaderEl, { attributes: true, attributeFilter: ['class'] })
    }
  }
  // ?skipintro, no loader, or an intro fast-forwarded past the flood
  ctx.ready.then(() => {
    offFlood?.()
    floodObs?.disconnect()
    playIntro(false)
  })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) plumb.pause()
    else if (introDone && plumbST.isActive) plumb.play()
  })
}
