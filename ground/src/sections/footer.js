/**
 * footer.js — the last field is bone black.
 *
 * Signature: the wordmark is a sand bottle of the whole page. The letters are
 * sampled into thousands of grains and filled with the six chapter pigments
 * in chapter order, oldest at the bottom (CHAPTERS from pigments.js): when
 * the footer arrives each colour is poured in turn, a curtain of grains that
 * sweeps across the word and settles in a wavy stratum on the one below, so
 * the page's story ends as layers of powder. The cursor (or a finger) stirs
 * the grains aside like breath over powder, and they drift back, slowly,
 * without bounce. The real text stays in the DOM (transparent once the grains
 * are drawn), so the heading is still read, selected and found.
 *
 * The type waits for its field, as the chapters' does: it is held back (by
 * opacity only) until the dish has poured bone black, fades in after the
 * colour, and goes again when the field leaves; the sand pours once it can be
 * seen. No dish, or reduced motion: it all shows at once. Keyboard focus
 * inside shows it at once, and brings the footer into its field.
 *
 * "Back to paper" drops clear water into the black at the button, lets it
 * open across the black, then puts the page back at the top in one frame
 * (not a smooth jump through every chapter) and clears the hash; the dish
 * wipes the black off to paper (DESIGN.md §8: jumps).
 */
import '../styles/footer.css'

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const luma = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
const WHITE = [255, 255, 255]
const BLACK = [0, 0, 0]

// the pour: one stratum after another, each a curtain sweeping left to right
const BAND_T = 0.42 // seconds between strata
const SWEEP = 0.5 // seconds for a curtain to cross the word
const JIT = 0.18
const FALL = [0.5, 0.35] // fall time: base + random
const POUR_END = (n) => (n - 1) * BAND_T + SWEEP + JIT + FALL[0] + FALL[1] + 0.05
// the type fades in this long after its field arrives (footer.css, as the chapters)
const HOLD_MS = 500
// how long the clear water of "Back to paper" opens across the black before the page goes,
// and when a second drop feeds it (the hand that stirred the water on its way to the
// button would otherwise carry a single drop off before it opens)
const OPEN_MS = 800
const FEED_MS = 380
// how coarse each powder is: 1 = sparkling crystals, 0 = a fine lake
const COARSE = { 'yellow-ochre': 0.7, 'bone-black': 0.45, 'egyptian-blue': 0.95, 'tyrian-purple': 0.3, ultramarine: 1, carmine: 0.25 }

/** The grains of one pigment: masstone, a wash between masstone and tint, the
 *  tint, a few crystals that catch the light and a little dark grit. Dark
 *  pigments lean on the lighter grains so they still read on bone black. */
function tonesOf(p) {
  const hex = rgbOf(p.hex)
  const tint = rgbOf(p.tint)
  const dark = luma(hex) < 0.06
  const tones = [
    [hex, dark ? 0.3 : 0.5],
    [mixRgb(hex, tint, 0.45), dark ? 0.34 : 0.24],
    [tint, dark ? 0.24 : 0.12],
    [mixRgb(tint, WHITE, 0.45), dark ? 0.07 : 0.06],
    [mixRgb(hex, BLACK, 0.3), dark ? 0.05 : 0.08],
  ]
  return tones.map(([c, w]) => ({ style: `rgb(${c[0]} ${c[1]} ${c[2]})`, w }))
}
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function init(ctx) {
  const root = document.getElementById('footer')
  if (!root) return
  const html = document.documentElement
  const reduced = ctx.reducedMotion
  const noDish = () => html.classList.contains('no-dish')

  /* ---------------------------------------------------------- back to paper */
  // Clear water at the button; once it has opened across the black, the page
  // is at the top in one frame (ctx.scrollTo immediate: not a jump, so the
  // palette turns once, bone black to paper, and the dish wipes once) and the
  // hash is cleared, so a reload stays on paper. Back returns to the footer.
  const back = root.querySelector('[data-back-to-paper]')
  let going = 0
  const dropAt = () => {
    const r = (back.querySelector('.footer__paper-drop') || back).getBoundingClientRect()
    return { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight }
  }
  back?.addEventListener('click', (e) => {
    if (going) return
    const keyboard = e.detail === 0
    ctx.palette?.drop('paper', { ...dropAt(), amount: 2, radius: 0.12 })
    const go = () => {
      going = 0
      try {
        history.replaceState({ ...(history.state || {}), y: window.scrollY }, '') // where Back returns
      } catch {}
      ctx.scrollTo(0, { immediate: true })
      try {
        history.pushState({ y: 0 }, '', location.pathname + location.search)
      } catch {}
      if (keyboard) document.getElementById('main')?.focus({ preventScroll: true })
    }
    // no water to open (reduced motion, no dish): straight back
    if (reduced || noDish()) return go()
    going = setTimeout(go, OPEN_MS)
    setTimeout(() => going && ctx.palette?.drop('paper', { ...dropAt(), amount: 2, radius: 0.1 }), FEED_MS)
  })

  /* ------------------------------------------------ the type waits for its field */
  // As the chapters do: everything in the footer is held back by opacity
  // (footer.css; still read, found and reachable) until the palette's field
  // is bone black with the footer as the section, fades in HOLD_MS after it,
  // and goes again when the field leaves. Without a dish the footer paints
  // its own field (html.no-dish, which reduced motion implies), so it shows
  // at once. Keyboard focus inside shows it at once.
  const FIELD = root.dataset.field || 'bone-black'
  const live = !!ctx.palette && !reduced
  let inField = false
  let shownAt = -1e9 // when the type last started to show (fading in from here)
  let wasShown = null
  const onShow = new Set() // fn(shown): the wordmark's pour follows
  const isShown = () => !live || inField || noDish() || root.classList.contains('is-focus')
  function shownChanged(delay) {
    const s = isShown()
    if (s === wasShown) return
    wasShown = s
    if (s) shownAt = performance.now() + delay
    for (const fn of onShow) fn(s)
  }
  if (live) {
    root.classList.add('is-live')
    ctx.palette.onChange((st) => {
      const f = st.section === root.id && st.field === FIELD
      if (f === inField) return
      inField = f
      root.classList.toggle('is-field', f)
      // focus only shows it early: once the field has gone, the type follows
      // the field again, even if the focus stayed behind in the footer
      if (!f) root.classList.remove('is-focus')
      shownChanged(HOLD_MS)
    })
    const keyboardFocus = (el) => {
      try {
        return el.matches(':focus-visible')
      } catch {
        return true
      }
    }
    root.addEventListener('focusin', (e) => {
      const t = e.target
      if (!t || !keyboardFocus(t)) return
      root.classList.add('is-focus')
      shownChanged(0)
      // and bring the footer into its field, so the type it shows sits on
      // bone black: the focus a little above the middle of the screen, in one
      // frame (as the chapters do), once the browser's own scroll has settled
      if (inField || noDish()) return
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (document.activeElement !== t || inField || ctx.jumping) return
          const r = t.getBoundingClientRect()
          ctx.scrollTo(Math.max(0, window.scrollY + r.top - window.innerHeight * 0.4), { immediate: true })
        }),
      )
    })
    root.addEventListener('focusout', (e) => {
      if (!root.classList.contains('is-focus') || (e.relatedTarget && root.contains(e.relatedTarget))) return
      root.classList.remove('is-focus')
      shownChanged(0)
    })
  }

  /* ---------------------------------------------------------- the wordmark */
  const mark = root.querySelector('.footer__mark')
  const word = root.querySelector('.footer__word')
  const canvas = root.querySelector('.footer__grains')
  if (!mark || !word || !canvas) return
  const g = canvas.getContext('2d')
  if (!g) return

  const probe = document.createElement('span')
  probe.className = 'footer__probe'
  probe.setAttribute('aria-hidden', 'true')
  word.appendChild(probe)

  // grains
  let N = 0
  let hx, hy, px, py, vx, vy, sz, dl, du, sy0, sx0, order
  let buckets = [] // [{ style, from, to }]
  let cw = 0
  let ch = 0
  let dpr = 1
  let ready = false
  let poured = reduced
  let pourStart = 0
  let pending = false // sampled, and waiting to pour until the footer's type can be seen
  let running = false
  let visible = false
  let pointer = { x: -9999, y: -9999, vx: 0, vy: 0, t: 0, in: false }

  // the strata, bottom to top: the six chapter colours, oldest first
  const { BY_ID, CHAPTERS, PAPER } = ctx.pigments
  const STRATA = (CHAPTERS || []).map((id) => BY_ID[id]).filter(Boolean)
  if (!STRATA.length) STRATA.push(BY_ID['bone-black'] || PAPER)
  const TONES = STRATA.map(tonesOf)
  const B = STRATA.length

  function sample() {
    const cr = canvas.getBoundingClientRect()
    const wr = word.getBoundingClientRect()
    const pr = probe.getBoundingClientRect()
    cw = cr.width
    ch = cr.height
    if (!cw || !ch || !wr.width) return false
    dpr = Math.min(ctx.dpr, 2)
    canvas.width = Math.round(cw * dpr)
    canvas.height = Math.round(ch * dpr)

    const cs = getComputedStyle(mark)
    const fs = parseFloat(cs.fontSize)
    const ls = parseFloat(cs.letterSpacing) || 0
    const off = document.createElement('canvas')
    off.width = Math.ceil(cw)
    off.height = Math.ceil(ch)
    const o = off.getContext('2d', { willReadFrequently: true })
    o.font = `${cs.fontStyle} ${cs.fontWeight} ${fs}px ${cs.fontFamily}`
    if ('letterSpacing' in o) o.letterSpacing = `${ls}px`
    o.textBaseline = 'alphabetic'
    o.fillStyle = '#fff'
    const x0 = wr.left - cr.left
    const base = pr.top - cr.top
    o.fillText('Ground', x0, base)
    const img = o.getImageData(0, 0, off.width, off.height).data

    const rnd = rng(1729)
    const step = clamp(cw / 720, 1.25, 2.1)
    const pts = []
    for (let y = 0; y < off.height; y += step) {
      for (let x = 0; x < off.width; x += step) {
        const sx = x + (rnd() - 0.5) * step
        const syy = y + (rnd() - 0.5) * step
        const ix = Math.round(sx)
        const iy = Math.round(syy)
        if (ix < 0 || iy < 0 || ix >= off.width || iy >= off.height) continue
        const a = img[(iy * off.width + ix) * 4 + 3]
        if (a < 24) continue
        if (rnd() > a / 255 + 0.05) continue
        pts.push(sx, syy)
      }
    }
    N = pts.length / 2
    if (!N) return false
    hx = new Float32Array(N)
    hy = new Float32Array(N)
    px = new Float32Array(N)
    py = new Float32Array(N)
    vx = new Float32Array(N)
    vy = new Float32Array(N)
    sz = new Float32Array(N)
    dl = new Float32Array(N)
    du = new Float32Array(N)
    sx0 = new Float32Array(N)
    sy0 = new Float32Array(N)

    // stratum boundaries: equal shares of the grains (so each colour gets
    // the same weight, though the tall letters reach higher), each boundary
    // a slow wave with a ripple on it, like sand settling in a bottle
    const ys = new Float32Array(N)
    let minY = Infinity
    for (let i = 0; i < N; i++) {
      ys[i] = pts[i * 2 + 1]
      if (ys[i] < minY) minY = ys[i]
    }
    ys.sort()
    const q = [ys[N - 1]]
    for (let k = 1; k < B; k++) q.push(ys[Math.min(N - 1, Math.floor(N * (1 - k / B)))])
    q.push(ys[0])
    const bounds = []
    for (let k = 1; k < B; k++) {
      const room = Math.min(q[k - 1] - q[k], q[k] - q[k + 1])
      bounds.push({
        y: q[k],
        a: room * 0.46,
        w1: (Math.PI * 2) / (cw * (0.24 + rnd() * 0.16)),
        p1: rnd() * Math.PI * 2,
        w2: (Math.PI * 2) / (cw * (0.09 + rnd() * 0.05)),
        p2: rnd() * Math.PI * 2,
        tilt: (rnd() - 0.5) * room * 0.5,
      })
    }
    const bandAt = (x, y) => {
      let b = 0
      for (let k = 0; k < bounds.length; k++) {
        const o = bounds[k]
        const by = o.y + o.a * (0.66 * Math.sin(x * o.w1 + o.p1) + 0.34 * Math.sin(x * o.w2 + o.p2)) + o.tilt * (x / cw - 0.5)
        if (y < by) b = k + 1
      }
      return b
    }

    const bk = new Uint8Array(N)
    const top0 = Math.max(0, minY - ch * 0.05)
    const coarse = STRATA.map((p) => COARSE[p.id] ?? 0.6)
    for (let i = 0; i < N; i++) {
      const x = pts[i * 2]
      const y = pts[i * 2 + 1]
      hx[i] = px[i] = x
      hy[i] = py[i] = y
      const band = bandAt(x, y)
      sz[i] = step * (0.42 + rnd() * 0.55 + coarse[band] * 0.3)
      // pick a tone within the stratum
      const tones = TONES[band]
      let r = rnd()
      let t = 0
      while (t < tones.length - 1 && r > tones[t].w) r -= tones[t++].w
      bk[i] = band * 5 + t
      // the pour: stratum by stratum, each a curtain sweeping left to right;
      // every grain falls almost straight down from above the word
      dl[i] = band * BAND_T + (x / cw) * SWEEP + rnd() * JIT
      du[i] = FALL[0] + rnd() * FALL[1]
      sx0[i] = x + (rnd() - 0.5) * 6
      sy0[i] = top0 - rnd() * ch * 0.08
    }
    // draw order grouped by colour
    order = new Uint32Array(N)
    buckets = []
    let k = 0
    for (let b = 0; b < B * 5; b++) {
      const from = k
      for (let i = 0; i < N; i++) if (bk[i] === b) order[k++] = i
      if (k > from) buckets.push({ style: TONES[(b / 5) | 0][b % 5].style, from, to: k })
    }
    return true
  }

  const eo = (u) => 1 - Math.pow(1 - u, 3)
  function draw(now) {
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, canvas.width, canvas.height)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    const t = (now - pourStart) / 1000
    for (const b of buckets) {
      g.fillStyle = b.style
      if (!poured) {
        for (let k = b.from; k < b.to; k++) {
          const i = order[k]
          const u = clamp((t - dl[i]) / du[i])
          if (u <= 0) continue
          const s = sz[i]
          if (u < 0.86) {
            // falling, gathering speed: drawn as a short streak
            const f = u / 0.86
            const x = sx0[i] + (hx[i] - sx0[i]) * eo(f)
            const y = sy0[i] + (hy[i] - sy0[i]) * f * f
            g.globalAlpha = 0.5 + 0.4 * clamp(f * 3)
            g.fillRect(x, y - s * 2.6 * f, s * 0.8, s * (1 + 2.6 * f))
          } else {
            g.globalAlpha = 1
            g.fillRect(hx[i], hy[i], s, s)
          }
        }
        g.globalAlpha = 1
      } else {
        for (let k = b.from; k < b.to; k++) {
          const i = order[k]
          g.fillRect(px[i], py[i], sz[i], sz[i])
        }
      }
    }
  }

  function step(now) {
    if (!poured) {
      const t = (now - pourStart) / 1000
      if (t > POUR_END(B)) poured = true
      draw(now)
      return true
    }
    // stirring: grains near the pointer are pushed aside, then drift home
    const R = Math.max(60, cw * 0.055)
    const R2 = R * R
    const pin = pointer.in && now - pointer.t < 120
    let moving = false
    for (let i = 0; i < N; i++) {
      let x = px[i]
      let y = py[i]
      if (pin) {
        const dx = x - pointer.x
        const dy = y - pointer.y
        const d2 = dx * dx + dy * dy
        if (d2 < R2 && d2 > 0.01) {
          const d = Math.sqrt(d2)
          const f = (1 - d / R) ** 2
          vx[i] += (dx / d) * f * 2.4 + pointer.vx * f * 0.09
          vy[i] += (dy / d) * f * 2.4 + pointer.vy * f * 0.09
        }
      }
      vx[i] *= 0.84
      vy[i] *= 0.84
      x += vx[i]
      y += vy[i]
      x += (hx[i] - x) * 0.028
      y += (hy[i] - y) * 0.028
      px[i] = x
      py[i] = y
      if (!moving && (Math.abs(x - hx[i]) > 0.25 || Math.abs(y - hy[i]) > 0.25)) moving = true
    }
    draw(now)
    return moving || pin
  }

  function loop(now) {
    if (!visible || !ready || pending) {
      running = false
      return
    }
    const more = step(now)
    if (more) requestAnimationFrame(loop)
    else {
      // snap home exactly, draw the rest state, and sleep
      for (let i = 0; i < N; i++) {
        px[i] = hx[i]
        py[i] = hy[i]
        vx[i] = vy[i] = 0
      }
      draw(now)
      running = false
    }
  }
  function wake() {
    if (running || !ready || !visible || pending) return
    running = true
    requestAnimationFrame(loop)
  }

  // The sand pours when it can be seen: with the type, as it fades in after
  // the field (or at once). If the field leaves before the pour is done, the
  // bottle is emptied and pours again on the way back.
  function clear() {
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, canvas.width, canvas.height)
  }
  function pour() {
    pending = false
    poured = false
    pourStart = Math.max(performance.now(), shownAt)
    wake()
  }
  function hold() {
    pending = true
    poured = false
    clear()
  }
  onShow.add((shown) => {
    if (!ready || reduced) return
    if (shown && pending) pour()
    else if (!shown && !poured) hold()
  })

  let started = false
  async function setup() {
    try {
      const cs = getComputedStyle(mark)
      await Promise.race([
        document.fonts?.load(`${cs.fontStyle} ${cs.fontWeight} 100px ${cs.fontFamily}`, 'Ground') ?? Promise.resolve(),
        new Promise((r) => setTimeout(r, 3000)),
      ])
    } catch {}
    if (!sample()) return
    ready = true
    mark.classList.add('is-powder')
    if (reduced) {
      poured = true
      draw(performance.now())
      return
    }
    if (isShown()) pour()
    else hold()
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        visible = e.isIntersecting
        if (visible && !started) {
          started = true
          setup()
        } else if (visible) wake()
      }
    },
    { threshold: 0.2 }
  )
  io.observe(mark)

  // pointer: fine pointers hover, fingers drag
  if (!reduced) {
    root.addEventListener(
      'pointermove',
      (e) => {
        if (!ready) return
        const r = canvas.getBoundingClientRect()
        const x = e.clientX - r.left
        const y = e.clientY - r.top
        const now = performance.now()
        const inside = x > -80 && y > -80 && x < r.width + 80 && y < r.height + 80
        if (pointer.in && inside) {
          pointer.vx = x - pointer.x
          pointer.vy = y - pointer.y
        } else {
          pointer.vx = pointer.vy = 0
        }
        pointer.x = x
        pointer.y = y
        pointer.t = now
        pointer.in = inside
        if (inside && poured) wake()
      },
      { passive: true }
    )
    root.addEventListener('pointerleave', () => (pointer.in = false))
  }

  // re-sample when the wordmark changes size
  let lastW = 0
  const ro = new ResizeObserver(() => {
    const w = mark.offsetWidth
    if (!ready || Math.abs(w - lastW) < 1) {
      lastW = w
      return
    }
    lastW = w
    clearTimeout(ro.t)
    ro.t = setTimeout(() => {
      if (!sample()) return
      if (pending) return clear() // still waiting to pour
      poured = true
      draw(performance.now())
    }, 150)
  })
  ro.observe(mark)
}
