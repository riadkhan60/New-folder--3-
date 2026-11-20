/**
 * intro.js — #intro. Where colour comes from: a specimen drawer of eight
 * sources, each engraved in fine line.
 *
 * Signature motion: as the drawer comes into view each specimen is engraved
 * in front of you, outline first, then the detail, then the hatching line by
 * line (DrawSVG). Pointing at a specimen (or focusing it) hand-colours the
 * engraving with its pigment and drops that pigment into the dish right
 * there; a click or tap drops more.
 *
 * Facts (names, materials, archive only) are read from pigments.js.
 *
 * Emits: 'drop' (via ctx.palette.drop). Listens to nothing.
 */
import '../styles/intro.css'

export function init(ctx) {
  const root = document.getElementById('intro')
  if (!root) return
  const { gsap, ScrollTrigger, pigments, reducedMotion } = ctx
  const specs = [...root.querySelectorAll('.spec')]

  // Colours and facts come from pigments.js. The partial carries the same
  // words for a first paint (and keeps its italics where they still match);
  // anything that has changed in pigments.js is rewritten here.
  const norm = (s) => s.replace(/\s+/g, ' ').trim()
  for (const el of specs) {
    const p = pigments.BY_ID[el.dataset.pigment]
    if (!p) continue
    el.style.setProperty('--pig', p.hex)
    el.style.setProperty('--pig-tint', p.tint)

    const src = el.querySelector('.spec__source')
    const srcName = pigments.SOURCES[el.dataset.source]
    if (src && srcName && src.firstChild?.nodeType === 3 && norm(src.firstChild.data) !== srcName) src.firstChild.data = srcName

    const name = el.querySelector('.spec__pigment')
    if (name && norm(name.textContent) !== p.name) name.textContent = p.name

    const mat = el.querySelector('.spec__material')
    if (mat && p.material) {
      const material = `${p.material.replace(/\.$/, '')}.`
      const archive = p.sold ? '' : 'Toxic, so archive only.'
      if (norm(mat.textContent) !== norm(`${material} ${archive}`)) {
        mat.textContent = archive ? `${material} ` : material
        if (archive) {
          const note = document.createElement('span')
          note.className = 'spec__archive'
          note.textContent = archive
          mat.append(note)
        }
      }
    }
  }

  /* ------------------------------------------------- colour goes in */
  const last = new WeakMap()
  const timers = new WeakMap()
  function drop(el, strong) {
    const now = performance.now()
    if (!strong && now - (last.get(el) || 0) < 900) return
    last.set(el, now)
    const plate = el.querySelector('.spec__svg') || el
    const r = plate.getBoundingClientRect()
    const x = (r.left + r.width * 0.5) / window.innerWidth
    const y = (r.top + r.height * 0.55) / window.innerHeight
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    ctx.palette.drop(el.dataset.pigment, {
      x,
      y,
      amount: strong ? 1 : 0.6,
      radius: strong ? 0.085 : 0.06,
      vy: strong ? 0.03 : 0.008,
    })
  }
  function wet(el, strong = false) {
    clearTimeout(timers.get(el))
    el.classList.add('is-wet')
    drop(el, strong)
  }
  function dry(el, after = 0) {
    clearTimeout(timers.get(el))
    timers.set(
      el,
      setTimeout(() => el.classList.remove('is-wet'), after)
    )
  }

  for (const el of specs) {
    const btn = el.querySelector('.spec__btn')
    if (!btn) continue
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') wet(el)
    })
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch' && document.activeElement !== btn) dry(el, 500)
    })
    btn.addEventListener('focus', () => {
      if (btn.matches(':focus-visible')) wet(el)
    })
    btn.addEventListener('blur', () => {
      if (!el.matches(':hover')) dry(el, 300)
    })
    btn.addEventListener('click', () => {
      // a tap leaves this one coloured and lets the others dry
      if (ctx.isTouch) for (const o of specs) if (o !== el) dry(o)
      wet(el, true)
      if (ctx.isTouch) dry(el, 4200)
    })
  }

  if (reducedMotion) return

  /* ------------------------------------------------- engraved in front of you */
  const parts = specs.map((el) => ({
    el,
    outline: el.querySelector('.spec__outline'),
    detail: el.querySelector('.spec__detail'),
    hatch: el.querySelector('.spec__hatch'),
    words: el.querySelectorAll('.spec__source, .spec__label, .spec__material'),
  }))
  const lines = parts.flatMap((p) => [p.outline, p.detail, p.hatch]).filter(Boolean)
  gsap.set(lines, { drawSVG: '0%' })
  gsap.set(
    parts.flatMap((p) => [...p.words]),
    { opacity: 0 }
  )

  function engrave(p, delay) {
    const tl = gsap.timeline({
      delay,
      onComplete() {
        // the drawing is finished: let the browser stroke it plainly again
        for (const path of [p.outline, p.detail, p.hatch]) {
          if (!path) continue
          path.style.strokeDasharray = ''
          path.style.strokeDashoffset = ''
        }
      },
    })
    tl.to(p.words, { opacity: 1, duration: 1.1, stagger: 0.12, ease: 'power2.out' }, 0)
    if (p.outline) tl.to(p.outline, { drawSVG: '100%', duration: 1.6, ease: 'settle' }, 0.05)
    if (p.detail) tl.to(p.detail, { drawSVG: '100%', duration: 1.5, ease: 'power2.inOut' }, 0.45)
    if (p.hatch) tl.to(p.hatch, { drawSVG: '100%', duration: 2.3, ease: 'power1.inOut' }, 0.7)
    return tl
  }

  ScrollTrigger.batch(
    parts.map((p) => p.el),
    {
      start: 'top 88%',
      once: true,
      onEnter(batch) {
        batch.forEach((el, i) => {
          const p = parts.find((q) => q.el === el)
          if (p) engrave(p, i * 0.14)
        })
      },
    }
  )
}
