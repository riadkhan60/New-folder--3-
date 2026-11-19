/**
 * cursor.js — a drop of water for a cursor (fine pointers only).
 *
 * A small lens: a ring with a bead's light in it that saturates whatever is
 * under it, trailing the pointer a little and stretching along its path like
 * a drop pulled across glass; a fine dot sits exactly on the pointer. It takes
 * the current field's ink (data-tone). Over links and buttons it opens up;
 * [data-cursor] shows a word: drop | drag | view ([data-cursor-label] sets
 * any other word), and hide puts it away. Over text fields, selects, range
 * inputs and open <dialog>s it steps aside for the native cursor.
 *
 * Visual only: the dish stirs from pointer moves on its own.
 * Off for touch, coarse pointers and reduced motion. While it runs, html has
 * .has-cursor (and the native cursor is hidden elsewhere).
 */
import '../styles/cursor.css'
import { ensureTones } from './nav.js'

const WORDS = { drop: 'Drop', drag: 'Drag', view: 'View' }
const INTERACTIVE = 'a[href], button:not([disabled]), [role="button"], label[for], summary, .btn'
const NATIVE =
  'input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"]), ' +
  'textarea, select, [contenteditable=""], [contenteditable="true"], dialog[open]'

export function init(ctx) {
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
  if (!fine || ctx.isTouch || ctx.reducedMotion) return
  const { gsap } = ctx
  ensureTones(ctx.pigments)
  const html = document.documentElement

  const el = document.createElement('div')
  el.className = 'cursor'
  el.dataset.tone = 'paper'
  el.setAttribute('aria-hidden', 'true')
  el.innerHTML =
    '<div class="cursor__lens"><div class="cursor__shape"></div><span class="cursor__label"></span></div>' +
    '<div class="cursor__dot"></div>'
  document.body.appendChild(el)
  const lens = el.querySelector('.cursor__lens')
  const shape = el.querySelector('.cursor__shape')
  const label = el.querySelector('.cursor__label')
  const dot = el.querySelector('.cursor__dot')

  /* --------------------------------------------------------------- tone */
  let field = 'paper'
  let menuOpen = false
  const setTone = () => {
    const t = menuOpen ? 'paper' : field
    if (el.dataset.tone !== t) el.dataset.tone = t
  }
  ctx.palette?.onChange((st) => {
    if (st.field === field) return
    field = st.field || 'paper'
    setTone()
  })
  ctx.on('nav:menu', (d) => {
    menuOpen = !!d?.open
    setTone()
  })

  /* -------------------------------------------------------------- state */
  let mode = 'none' // none | hover | label | native
  let word = ''
  function setMode(m, w = '') {
    if (m === mode && w === word) return
    mode = m
    if (w && w !== word) label.textContent = w
    word = w
    el.classList.toggle('is-hover', m === 'hover')
    el.classList.toggle('is-label', m === 'label')
    el.classList.toggle('is-native', m === 'native')
  }
  function sense(target) {
    if (!(target instanceof Element)) return setMode('none')
    if (target.closest(NATIVE)) return setMode('native')
    const tagged = target.closest('[data-cursor], [data-cursor-label]')
    if (tagged) {
      const kind = tagged.dataset.cursor
      if (kind === 'hide') return setMode('native')
      const w = tagged.dataset.cursorLabel || WORDS[kind]
      if (w) return setMode('label', w)
    }
    if (target.closest(INTERACTIVE)) return setMode('hover')
    setMode('none')
  }

  /* ------------------------------------------------------------- motion */
  let mx = -200
  let my = -200
  let lx = -200
  let ly = -200
  let stretch = 0
  let angle = 0
  let running = false
  let shown = false

  function tick(_, deltaMs) {
    const dt = Math.min((deltaMs || 16.7) / 1000, 0.05)
    const k = 1 - Math.pow(1 - 0.26, dt * 60)
    const px = lx
    const py = ly
    lx += (mx - lx) * k
    ly += (my - ly) * k
    const dx = lx - px
    const dy = ly - py
    const v = Math.hypot(dx, dy) / Math.max(dt, 0.001)
    // a drop pulled across glass: it stretches along its path, never bounces
    const goal = Math.min(v / 2600, mode === 'label' ? 0.1 : mode === 'hover' ? 0.16 : 0.32)
    stretch += (goal - stretch) * Math.min(1, dt * 12)
    if (v > 40) angle = Math.atan2(dy, dx)
    lens.style.transform = `translate3d(${lx.toFixed(2)}px, ${ly.toFixed(2)}px, 0)`
    shape.style.transform = `rotate(${angle.toFixed(3)}rad) scale(${(1 + stretch).toFixed(3)}, ${(1 - stretch * 0.5).toFixed(3)})`
    dot.style.transform = `translate3d(${mx}px, ${my}px, 0)`
    if (Math.abs(mx - lx) < 0.05 && Math.abs(my - ly) < 0.05 && stretch < 0.002) {
      running = false
      gsap.ticker.remove(tick)
    }
  }
  function wake() {
    if (running) return
    running = true
    gsap.ticker.add(tick)
  }

  /* ------------------------------------------------------------ pointer */
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') {
        el.classList.remove('is-on')
        return
      }
      mx = e.clientX
      my = e.clientY
      if (!shown) {
        shown = true
        lx = mx
        ly = my
        html.classList.add('has-cursor')
      }
      el.classList.add('is-on')
      wake()
    },
    { passive: true },
  )
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'touch') sense(e.target)
  })
  window.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) el.classList.remove('is-on')
  })
  window.addEventListener('blur', () => el.classList.remove('is-on'))
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') el.classList.add('is-down')
  })
  const up = () => el.classList.remove('is-down')
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)

  // the page moves under a still pointer: look again at what is beneath it
  let pending = false
  window.addEventListener(
    'scroll',
    () => {
      if (pending || !shown) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        sense(document.elementFromPoint(mx, my))
      })
    },
    { passive: true },
  )
}
