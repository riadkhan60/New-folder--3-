/**
 * cursor.js — a drop of water for a cursor (fine pointers only).
 *
 * A small lens: a ring with a bead's light in it that saturates whatever is
 * under it, trailing the pointer a little and stretching along its path like
 * a drop pulled across glass; a fine dot sits exactly on the pointer. It takes
 * the ink of whatever it is over (data-tone): the current field's, unless the
 * pointer is on a surface of its own — a paper drawdown card on a dark field,
 * a swatch, a flooded lab, the phone menu — whose ink it reads from the
 * nearest [data-tone], nested [data-field] or opaque background (matched to
 * the nearest pigment, else to paper or bone black by lightness), so it never
 * vanishes into what it sits on. Over links and buttons it opens up;
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
  let local = null // the tone of the surface under the pointer, if it has one
  let menuOpen = false
  const setTone = () => {
    const t = menuOpen ? 'paper' : local || field
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

  // Any CSS colour → [r, g, b, a] (0..255, a 0..1), by letting a 1px canvas
  // parse it: computed colours come back as rgb(), color(srgb …), oklab()…
  const swatchCanvas = document.createElement('canvas')
  swatchCanvas.width = swatchCanvas.height = 1
  const sc = swatchCanvas.getContext('2d', { willReadFrequently: true })
  const parsed = new Map()
  function rgbaOf(css) {
    if (!sc || !css || css === 'transparent' || css === 'rgba(0, 0, 0, 0)') return null
    if (parsed.has(css)) return parsed.get(css)
    let out = null
    try {
      sc.clearRect(0, 0, 1, 1)
      sc.fillStyle = '#010203' // a sentinel: still there means the colour didn't parse
      sc.fillStyle = css
      if (sc.fillStyle !== '#010203') {
        sc.fillRect(0, 0, 1, 1)
        const d = sc.getImageData(0, 0, 1, 1).data
        out = [d[0], d[1], d[2], d[3] / 255]
      }
    } catch {}
    if (parsed.size > 200) parsed.clear()
    parsed.set(css, out)
    return out
  }
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const TONES = ctx.pigments ? [ctx.pigments.PAPER, ...ctx.pigments.PIGMENTS].map((p) => [p.id, hexRgb(p.hex)]) : []
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  function toneOf([r, g, b]) {
    let best = 'paper'
    let bd = Infinity
    for (const [id, [R, G, B]] of TONES) {
      const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2
      if (d < bd) {
        bd = d
        best = id
      }
    }
    if (bd < 900) return best // close enough to be that pigment, or paper
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    return L > 0.3 ? 'paper' : 'bone-black'
  }
  // Walk up from the element under the pointer to its section. The first
  // element that says what it is ([data-tone], a nested [data-field]) or
  // paints a solid surface big enough to hold the lens decides the ink.
  // Buttons and links are skipped: their own fill is not the ground.
  function surfaceTone(target) {
    for (let n = target; n && n !== document.body && n !== html; n = n.parentElement) {
      const tone = n.dataset?.tone
      if (tone) return tone
      if (n.dataset?.field) {
        // a top-level section: the field (and the dish) rules
        if (!n.parentElement?.closest('[data-field]')) return null
        return n.dataset.field
      }
      if (n.matches(INTERACTIVE)) continue
      const c = rgbaOf(getComputedStyle(n).backgroundColor)
      if (!c || c[3] < 0.6) continue
      const r = n.getBoundingClientRect()
      if (r.width < 64 || r.height < 40) continue
      return toneOf(c)
    }
    return null
  }
  function resolveTone(target) {
    const t = target instanceof Element ? surfaceTone(target) : null
    if (t === local) return
    local = t
    setTone()
  }

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
    if (e.pointerType === 'touch') return
    sense(e.target)
    resolveTone(e.target)
  })
  window.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) el.classList.remove('is-on')
  })
  window.addEventListener('blur', () => el.classList.remove('is-on'))
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') el.classList.add('is-down')
  })
  // a click can change the surface under a still pointer (a card turned to
  // infrared, a flooded lab): look again once its colour has turned
  let recheck = 0
  const up = () => {
    el.classList.remove('is-down')
    clearTimeout(recheck)
    recheck = setTimeout(() => shown && resolveTone(document.elementFromPoint(mx, my)), 700)
  }
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
        const under = document.elementFromPoint(mx, my)
        sense(under)
        resolveTone(under)
      })
    },
    { passive: true },
  )
}
