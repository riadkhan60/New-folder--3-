/**
 * hero.js — #surface. The page's only <h1>, just under the surface.
 *
 * 1. Intro (after ctx.ready): the title's characters settle into focus the
 *    way things do seen through moving water — a ripple travels out from
 *    the centre, each glyph wavers, stretches and un-blurs, while the whole
 *    line breathes out to its full surface width.
 * 2. Scroll: as the visitor leaves the surface the title is put under
 *    pressure — font-stretch 150 → ~92, weight 250 → ~640 — and sinks
 *    behind the page while it dims. The site's core mechanic, first shown.
 * 3. A plumb line pays out under "Scroll to descend", slowly, on a loop.
 */
import '../styles/hero.css'

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))

export function init(ctx) {
  const root = document.getElementById('surface')
  if (!root) return
  const { gsap, SplitText } = ctx

  const title = root.querySelector('.hero__title')
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
  gsap
    .timeline({
      scrollTrigger: {
        trigger: root,
        start: 'top top',
        end: 'bottom top',
        scrub: 0.6,
        invalidateOnRefresh: true,
      },
    })
    .fromTo(
      title,
      { '--wdth': 150, '--wght': 250 },
      { '--wdth': 92, '--wght': 640, ease: 'none', duration: 1 },
      0,
    )
    .fromTo(
      title,
      { y: 0, opacity: 1 },
      { y: () => window.innerHeight * 0.26, opacity: 0.1, ease: 'power1.in', duration: 1 },
      0,
    )
    .fromTo(foot, { opacity: 1 }, { opacity: 0, ease: 'power1.in', duration: 0.45 }, 0)

  // only loop the plumb line while the hero is on screen
  const plumbST = ctx.ScrollTrigger.create({
    trigger: root,
    start: 'top bottom',
    end: 'bottom top',
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
