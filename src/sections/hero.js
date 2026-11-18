/**
 * hero.js — #surface. The page's only <h1>, just under the surface.
 *
 * 1. Intro (after ctx.ready): the title's characters settle into focus the
 *    way things do seen through moving water — a ripple travels out from
 *    the centre, each glyph wavers, stretches and un-blurs, while the whole
 *    line breathes out to its full surface width.
 * 2. Scroll: the hero's exit is the first, plainest demonstration of the
 *    site's one idea. The composition holds almost still for the first
 *    screen of scroll (it rises at a few percent of the scroll speed and
 *    eases into full speed), so the squeeze happens in plain view:
 *      - the lead, the fact and the cue let go first;
 *      - the title is put under pressure: Anybody wdth 150 → 60,
 *        wght 250 → 800, lines packed tighter. power2.in, so the pressure
 *        visibly builds;
 *      - only once it is a dense, narrow block does it rise away and dim,
 *        handing over to the manifesto.
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
  function playIntro() {
    root.classList.remove('is-armed')
    const ease = gsap.parseEase('abyss')
    const tb = title.getBoundingClientRect()
    const cx = tb.left + tb.width / 2
    const half = Math.max(1, tb.width / 2)

    const data = chars.map((el) => {
      const r = el.getBoundingClientRect()
      const x = clamp((r.left + r.width / 2 - cx) / half, -1, 1)
      const line = r.top - tb.top > tb.height * 0.4 ? 1 : 0
      return { el, s: el.style, x, line, delay: Math.abs(x) * 0.7 + line * 0.16 }
    })

    const DUR = 2.0
    const total = DUR + 0.7 + 0.16 + 0.05
    const st = { t: 0 }

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
        const blur = inv * inv * 18
        c.s.opacity = Math.min(1, lp * 2.6).toFixed(3)
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
    gsap.to(title, { '--breath': 0, '--press': 0, duration: 2.8, ease: 'abyss' })

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
        delay: 1.0,
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

  ctx.ready.then(() => {
    // after the loader, give its wordmark a beat to clear the centre
    gsap.delayedCall(ctx.skipIntro ? 0 : 0.3, playIntro)
    gsap.delayedCall(1.9, () => {
      introDone = true
      if (plumbST.isActive && !document.hidden) plumb.play()
    })
  })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) plumb.pause()
    else if (introDone && plumbST.isActive) plumb.play()
  })
}
