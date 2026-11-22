/**
 * library.js — the swatch book. Twelve pigments, oldest first, each painted
 * out by hand on canvas: a masstone stroke with a dry-brush end, and a thin
 * wash beneath. Hover drops the pigment into the dish; a click opens its
 * plate (a modal <dialog>) with every fact, "Add to order" and "Mix it".
 *
 * The paint kit at the top (rng, noise, paintStroke, paintWash, paintSwatch,
 * makeReveal) is exported for the mix lab.
 *
 * Emits:  'order' { id, qty: 1 }, 'select-pigment' { id }, 'drop' (via palette)
 */
import '../styles/library.css'

/* ================================================================ paint kit */

export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
export const rgbCss = (c, a = 1) => `rgb(${c[0] | 0} ${c[1] | 0} ${c[2] | 0} / ${a})`
export const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

/** Darken (amt < 0, towards bone black) or lighten (amt > 0, towards paper). */
export function shade(c, amt) {
  const to = amt < 0 ? [10, 9, 8] : [250, 249, 245]
  return mixRgb(c, to, Math.min(1, Math.abs(amt)))
}

export function lum(c) {
  const f = (v) => {
    v /= 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}

/** Smooth 1D value noise on [0, 1], n cells, values in [-1, 1]. */
export function noise1(rand, n) {
  const v = new Float32Array(n + 2)
  for (let i = 0; i < v.length; i++) v[i] = rand() * 2 - 1
  return (t) => {
    const x = Math.min(Math.max(t, 0), 1) * n
    const i = Math.floor(x)
    const f = x - i
    const u = f * f * (3 - 2 * f)
    return v[i] + (v[i + 1] - v[i]) * u
  }
}

/**
 * One loaded brush stroke, left to right: a rounded landing, a body with
 * bristle furrows and ridges, a dry-brush end where the paint runs out.
 */
export function paintStroke(g, o) {
  const { x0, x1, y, h, seed = 1, dry = 0.3, s = 1 } = o
  const base = hexRgb(o.color)
  const L = lum(base)
  const light = L > 0.55
  const R = rng(seed)
  const len = x1 - x0
  const top = noise1(R, 16)
  const bot = noise1(R, 16)
  const wave = noise1(R, 4)
  const fine = noise1(R, 70)
  const bodyEnd = x1 - len * dry * 0.7
  const tEnd = (bodyEnd - x0) / len

  const edgeY = (t, v) => {
    const land = Math.pow(1 - Math.min(1, t * 5), 2) * h * 0.07
    const lift = Math.pow(Math.max(0, t - 0.62) / 0.38, 2) * h * 0.1
    const yt = y - h / 2 - land + lift + top(t) * h * 0.05 + fine(t) * h * 0.012
    const yb = y + h / 2 + land - lift + bot(t) * h * 0.05 - fine(1 - t) * h * 0.012
    return yt + (yb - yt) * v + wave(t) * h * 0.045
  }

  // 1. the body of paint: a rounded landing, a convex lift where the brush leaves
  g.save()
  g.beginPath()
  const N = 64
  const cap = h * 0.16
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * tEnd
    g.lineTo(x0 + len * t, edgeY(t, 0))
  }
  for (let i = 1; i < 18; i++) {
    const v = i / 18
    g.lineTo(bodyEnd + Math.sin(Math.PI * v) * h * 0.12 + fine(0.1 + v * 0.8) * h * 0.04, edgeY(tEnd, v))
  }
  for (let i = N; i >= 0; i--) {
    const t = (i / N) * tEnd
    g.lineTo(x0 + len * t, edgeY(t, 1))
  }
  for (let i = 1; i < 18; i++) {
    const v = 1 - i / 18
    g.lineTo(x0 - Math.pow(Math.sin(Math.PI * v), 0.7) * cap + fine(0.05 + v * 0.3) * h * 0.02, edgeY(0, v))
  }
  g.closePath()
  g.fillStyle = rgbCss(base)
  g.fill()
  // pigment pools a little darker at the edge of a wet stroke
  g.lineWidth = 1.15 * s
  g.lineJoin = 'round'
  g.strokeStyle = rgbCss(shade(base, light ? -0.3 : -0.3), light ? 0.42 : 0.4)
  g.stroke()
  g.restore()

  // 2. bristles: fine furrows and ridges, then the dry-brush tail where the paint runs out
  const nb = Math.max(28, Math.round(h / (0.9 * s)))
  const gaps = noise1(R, 11)
  g.lineJoin = 'round'
  const step = 3 * s
  const dryFrom = tEnd * 0.9
  for (let i = 0; i < nb; i++) {
    const v = (i + R()) / nb
    const e = Math.abs(v * 2 - 1)
    const own = noise1(R, 5)
    const xs = x0 + R() * h * 0.04 + Math.pow(e, 3) * h * 0.22
    // where this bristle's paint runs out
    const xe = x0 + len * (dryFrom + (1 - dryFrom) * (0.25 + 0.75 * Math.pow(R(), 0.7))) - Math.pow(e, 2.2) * len * 0.08
    const kind = R()
    let tone = (R() - 0.5) * (light ? 0.035 : 0.06)
    if (kind < 0.1) tone = light ? -(0.07 + R() * 0.07) : 0.07 + R() * 0.1 // a ridge catching light
    else if (kind < 0.22) tone = -(light ? 0.08 : 0.1) - R() * 0.08 // a furrow
    const lw = (h / nb) * (0.55 + R() * 0.9)
    const alpha = (light ? 0.3 : 0.24) + R() * 0.4
    const ph = R()
    g.strokeStyle = rgbCss(shade(base, tone), alpha)
    g.lineCap = 'butt'
    g.beginPath()
    let pen = false
    for (let x = xs; x <= xe; x += step) {
      const t = (x - x0) / len
      // past the body the bristle skips in long streaks, more and more often
      const dryness = t < dryFrom ? 0 : (t - dryFrom) / (1 - dryFrom)
      const skip = dryness > 0 && gaps((t * 1.6 + ph) % 1) * 0.5 + 0.5 < dryness * 0.85
      if (skip) {
        pen = false
        continue
      }
      const yy = edgeY(t, v) + own(t) * h * 0.012
      if (!pen) {
        g.moveTo(x, yy)
        pen = true
      } else g.lineTo(x, yy)
    }
    g.lineWidth = lw
    g.stroke()
  }

  // 3. pigment grain, only on paint
  g.save()
  g.globalCompositeOperation = 'source-atop'
  const ng = Math.round((len * h) / (16 * s * s))
  for (let i = 0; i < ng; i++) {
    const x = x0 - cap + R() * (len + cap)
    const yy = y - h * 0.7 + R() * h * 1.4
    const d = (R() < 0.55 ? -1 : 1) * (0.08 + R() * 0.22)
    g.fillStyle = rgbCss(shade(base, d), 0.1 + R() * 0.2)
    const sz = (0.5 + R() * 1.2) * s
    g.fillRect(x, yy, sz, sz)
  }
  g.restore()
}

/** A thin watercolour wash: soft body, pooled darker edge, granulation. */
export function paintWash(g, o) {
  const { x0, x1, y, h, seed = 2, s = 1 } = o
  const tint = hexRgb(o.color)
  const deep = hexRgb(o.deep)
  const R = rng(seed)
  const len = x1 - x0
  const top = noise1(R, 26)
  const bot = noise1(R, 26)
  const wave = noise1(R, 4)
  const thick = (t) => 1 - Math.pow(t, 2.4) * 0.6
  const yAt = (t, v) => {
    const c = y + wave(t) * h * 0.22
    const k = thick(t)
    return v === 0 ? c - (h / 2) * k + top(t) * h * 0.16 : c + (h / 2) * k + bot(t) * h * 0.16
  }
  g.save()
  g.beginPath()
  const N = 90
  for (let i = 0; i <= N; i++) g.lineTo(x0 + (len * i) / N, yAt(i / N, 0))
  g.quadraticCurveTo(x1 + h * 0.5, y + wave(1) * h * 0.22, x1, yAt(1, 1))
  for (let i = N; i >= 0; i--) g.lineTo(x0 + (len * i) / N, yAt(i / N, 1))
  g.quadraticCurveTo(x0 - h * 0.45, y, x0, yAt(0, 0))
  g.closePath()
  g.fillStyle = rgbCss(tint, 0.94)
  g.fill()
  g.lineWidth = 1.25 * s
  g.strokeStyle = rgbCss(mixRgb(tint, deep, 0.5), 0.55)
  g.stroke()
  g.clip()
  // pigment settles towards the lower edge of a drying wash
  for (let i = 0; i < 5; i++) {
    g.strokeStyle = rgbCss(mixRgb(tint, deep, 0.35), 0.05 + R() * 0.05)
    g.lineWidth = h * (0.18 + R() * 0.2)
    g.beginPath()
    const off = h * (0.12 + R() * 0.3)
    for (let k = 0; k <= 24; k++) g.lineTo(x0 + (len * k) / 24, yAt(k / 24, 1) - off)
    g.stroke()
  }
  const ng = Math.round((len * h) / (22 * s * s))
  for (let i = 0; i < ng; i++) {
    g.fillStyle = rgbCss(R() < 0.7 ? deep : shade(tint, 0.3), 0.05 + R() * 0.12)
    const sz = (0.5 + R() * 1.1) * s
    g.fillRect(x0 - h * 0.4 + R() * (len + h * 0.8), y - h + R() * h * 2, sz, sz)
  }
  g.restore()
}

/** Paint a pigment's chip into a fresh offscreen canvas. */
export function paintSwatch(p, w, h, s, layout = 'chip') {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  const seed = hashStr(p.id + layout)
  if (layout === 'plate') {
    paintStroke(g, { x0: w * 0.08, x1: w * 0.96, y: h * 0.4, h: h * 0.42, color: p.hex, seed, dry: 0.26, s })
    paintWash(g, { x0: w * 0.09, x1: w * 0.8, y: h * 0.78, h: h * 0.1, color: p.tint, deep: p.hex, seed: seed + 7, s })
  } else {
    paintStroke(g, { x0: w * 0.06, x1: w * 0.97, y: h * 0.38, h: h * 0.54, color: p.hex, seed, dry: 0.3, s })
    paintWash(g, { x0: w * 0.07, x1: w * 0.84, y: h * 0.85, h: h * 0.13, color: p.tint, deep: p.hex, seed: seed + 7, s })
  }
  return c
}

/**
 * Reveal a painted canvas behind a ragged brush front.
 * Returns draw(p, q): p = stroke progress, q = wash progress (0..1).
 */
export function makeReveal(canvas, src, seed, split = 0.7) {
  const g = canvas.getContext('2d')
  const jag = noise1(rng(seed + 99), 28)
  const w = canvas.width
  const h = canvas.height
  return (p, q = p) => {
    g.clearRect(0, 0, w, h)
    if (p <= 0 && q <= 0) return
    if (p >= 1 && q >= 1) {
      g.drawImage(src, 0, 0)
      return
    }
    g.save()
    g.beginPath()
    g.moveTo(0, 0)
    const sy = Math.max(3, h / 60)
    for (let yy = 0; yy <= h + sy; yy += sy) {
      const pr = yy < h * split ? p : q
      const fx = -w * 0.16 + pr * w * 1.32 - (jag(Math.min(1, yy / h)) * 0.5 + 0.5) * w * 0.13
      g.lineTo(Math.max(0, fx), Math.min(h, yy))
    }
    g.lineTo(0, h)
    g.closePath()
    g.clip()
    g.drawImage(src, 0, 0)
    g.restore()
  }
}

/* ================================================================ chart data */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const NUM_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const numWord = (n) => NUM_WORDS[n] ?? String(n)
/** Natural "from …" phrasing for the filter announcement and the plate. */
const FROM = {
  earth: 'the earth',
  kiln: 'a kiln',
  shell: 'a sea snail',
  stone: 'stone',
  metal: 'metal',
  insect: 'an insect',
  plant: 'a plant',
  bone: 'bone',
}

/** Every pigment, oldest first: the order of the chart (and of the mix lab's paintbox). */
export const byAge = (PIGMENTS) => [...PIGMENTS].sort((a, b) => a.year - b.year)

/** One chip of the chart. The partial holds the same markup as a no-JS fallback. */
function chipMarkup(p, SOURCES, formatPrice) {
  const tail = p.sold
    ? `<p class="lib-chip__price t-num">${esc(`${formatPrice(p.price)} for ${p.unit}`)}</p>`
    : '<p class="lib-chip__flag">Archive only: toxic</p>'
  return (
    `<li class="lib-chip${p.sold ? '' : ' is-archive'}" data-id="${esc(p.id)}" data-source="${esc(p.source)}" style="--pig:${esc(p.hex)};--pig-tint:${esc(p.tint)}">` +
    `<p class="lib-chip__source t-caption">${esc(SOURCES[p.source] ?? p.source)}</p>` +
    '<div class="lib-chip__swatch"><canvas class="lib-chip__canvas" aria-hidden="true"></canvas></div>' +
    `<h3 class="lib-chip__name"><button type="button" class="lib-chip__btn" aria-haspopup="dialog" aria-describedby="lib-d-${esc(p.id)}"><span class="lib-chip__name-text">${esc(p.name)}</span></button></h3>` +
    `<div class="lib-chip__meta" id="lib-d-${esc(p.id)}">` +
    `<p class="lib-chip__origin">${esc(p.origin)}</p>` +
    `<p class="lib-chip__era">${esc(p.era)}</p>` +
    tail +
    '</div></li>'
  )
}

/* ================================================================ section */

export function init(ctx) {
  const root = document.getElementById('library')
  if (!root) return
  const { gsap, ScrollTrigger, SplitText, pigments } = ctx
  const RM = ctx.reducedMotion
  const { PIGMENTS, BY_ID, SOURCES, formatPrice } = pigments
  const dpr = () => Math.min(ctx.dpr || 1, 2)

  const plate = root.querySelector('.library__plate')
  const list = root.querySelector('.library__chips')
  const status = root.querySelector('#library-status')
  const filters = [...root.querySelectorAll('.lib-filter')]

  // pigments.js is the single source of truth: the chart is rebuilt from it
  // (oldest first, by `year`), so a corrected fact or date reaches the page
  // without touching the partial.
  const chart = byAge(PIGMENTS)
  if (list && chart.length) list.innerHTML = chart.map((p) => chipMarkup(p, SOURCES, formatPrice)).join('')
  const sold = PIGMENTS.filter((p) => p.sold).length
  const tally = { all: PIGMENTS.length, sold, archive: PIGMENTS.length - sold }
  root.querySelectorAll('[data-count]').forEach((el) => {
    const w = numWord(tally[el.dataset.count] ?? 0)
    el.textContent = el.hasAttribute('data-cap') ? w[0].toUpperCase() + w.slice(1) : w
  })
  const counts = {}
  for (const p of PIGMENTS) counts[p.source] = (counts[p.source] || 0) + 1
  filters.forEach((b) => {
    const src = b.dataset.source
    if (src === 'all') {
      b.firstChild.textContent = `All ${numWord(PIGMENTS.length)}`
      return
    }
    const n = b.querySelector('.lib-filter__n')
    if (n) n.textContent = String(counts[src] || 0)
    b.hidden = !counts[src]
  })

  const items = [...root.querySelectorAll('.lib-chip')]
    .map((li, i) => {
      const id = li.dataset.id
      const p = BY_ID[id]
      if (!p) return null
      li.style.setProperty('--i', i)
      return {
        i,
        id,
        p,
        li,
        btn: li.querySelector('.lib-chip__btn'),
        swatch: li.querySelector('.lib-chip__swatch'),
        canvas: li.querySelector('.lib-chip__canvas'),
        src: null,
        draw: null,
        w: 0,
        h: 0,
        sp: RM ? 1 : 0, // stroke shown
        sq: RM ? 1 : 0, // wash shown
        lastDrop: 0,
      }
    })
    .filter(Boolean)
  if (!items.length) return
  const byId = Object.fromEntries(items.map((it) => [it.id, it]))

  /* ---------------------------------------------------------- painting */
  function paintChip(it) {
    const cw = it.swatch.clientWidth
    const ch = it.swatch.clientHeight
    if (!cw || !ch) return
    const s = dpr()
    const w = Math.round(cw * s)
    const h = Math.round(ch * s)
    if (it.src && w === it.w && h === it.h) return
    it.w = w
    it.h = h
    it.canvas.width = w
    it.canvas.height = h
    it.src = paintSwatch(it.p, w, h, s)
    it.draw = makeReveal(it.canvas, it.src, hashStr(it.id))
    it.draw(it.sp, it.sq)
  }

  let painted = false
  function paintAll(sync = false) {
    if (painted && !sync) return
    painted = true
    if (sync) {
      items.forEach(paintChip)
      return
    }
    // one chip per frame, so the main thread never stalls
    let k = 0
    const next = () => {
      if (k >= items.length) return
      paintChip(items[k++])
      requestAnimationFrame(next)
    }
    next()
  }

  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        paintAll()
        io.disconnect()
      }
    },
    { rootMargin: '120% 0px 120% 0px' }
  )
  ctx.ready.then(() => io.observe(plate))

  let rto = 0
  const ro = new ResizeObserver(() => {
    if (!painted) return
    clearTimeout(rto)
    rto = setTimeout(() => items.forEach(paintChip), 180)
  })
  ro.observe(list)

  /* ---------------------------------------------------------- arrival */
  // The field hands over from the last chapter while this section's top is
  // still low in the viewport, so the heading waits for the paper: once the
  // dish has turned to paper, the title soaks in, letter by letter, like ink.
  const head = root.querySelector('.library__head')
  const title = root.querySelector('.library__title')
  if (!RM && head && title && ctx.palette?.onChange) {
    root.classList.add('is-held')
    let done = false
    let off = null
    const release = (animate) => {
      done = true
      off?.()
      root.classList.remove('is-held')
      if (!animate) return
      try {
        const st = SplitText.create(title, { type: 'chars,words' })
        gsap.from(st.chars, {
          opacity: 0,
          filter: 'blur(10px)',
          duration: 1.4,
          ease: 'settle',
          stagger: 0.05,
          onComplete: () => st.revert(),
        })
      } catch {
        /* the title simply shows */
      }
    }
    const check = (s) => {
      if (done || s.field !== root.dataset.field) return
      const t = title.getBoundingClientRect()
      if (t.bottom < 0) release(false)
      else if (t.top < window.innerHeight * 0.92) release(true)
    }
    off = ctx.palette.onChange(check)
    if (done) off()
  }

  /* ---------------------------------------------------------- entrance */
  // The printer rules the plate; then each colour is brushed on, oldest first.
  if (!RM) {
    root.classList.add('is-armed')
    ScrollTrigger.create({
      trigger: plate,
      start: 'top 82%',
      once: true,
      onEnter: () => {
        items.forEach(paintChip)
        painted = true
        plate.classList.add('is-ruled')
        const tl = gsap.timeline({ delay: 0.15 })
        items.forEach((it, i) => {
          const o = { p: 0, q: 0 }
          const at = 0.35 + i * 0.085
          const upd = () => {
            it.sp = o.p
            it.sq = o.q
            it.draw?.(o.p, o.q)
          }
          tl.to(o, { p: 1, duration: 1.05, ease: 'power2.inOut', onUpdate: upd }, at)
          tl.to(o, { q: 1, duration: 0.95, ease: 'power2.inOut', onUpdate: upd }, at + 0.32)
          tl.call(() => it.li.classList.add('is-in'), null, at + 0.2)
        })
      },
    })
  } else {
    plate.classList.add('is-ruled')
    items.forEach((it) => it.li.classList.add('is-in'))
  }

  /* ---------------------------------------------------------- drops */
  function dropAt(it, amount = 0.5, radius = 0.05, force = false) {
    const now = performance.now()
    if (!force && now - it.lastDrop < 650) return
    it.lastDrop = now
    const r = it.swatch.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (r.bottom < 0 || r.top > vh) return
    ctx.palette?.drop(it.id, {
      x: (r.left + r.width * 0.45) / vw,
      y: (r.top + r.height * 0.42) / vh,
      amount,
      radius,
    })
  }

  items.forEach((it) => {
    it.li.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && !it.li.inert) dropAt(it)
    })
    it.btn.addEventListener('focus', () => dropAt(it))
    it.btn.addEventListener('click', () => openPlate(it.id))
  })

  /* ---------------------------------------------------------- filter */
  const list12 = (names) =>
    names.length <= 1 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]

  function setFilter(src) {
    filters.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.source === src)))
    const on = []
    items.forEach((it) => {
      const yes = src === 'all' || it.p.source === src
      it.li.classList.toggle('is-out', !yes)
      it.li.inert = !yes
      if (yes) on.push(it)
    })
    if (status) {
      status.textContent =
        src === 'all'
          ? `Showing all ${numWord(items.length)} colours.`
          : `Showing ${on.length === 1 ? 'one colour' : numWord(on.length) + ' colours'} from ${FROM[src] || SOURCES[src].toLowerCase()}: ${list12(on.map((it) => it.p.name))}.`
    }
    if (src !== 'all') on.forEach((it, k) => setTimeout(() => dropAt(it, 0.4, 0.045, true), 80 + k * 110))
  }
  filters.forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.source)))

  /* ---------------------------------------------------------- the plate (dialog) */
  const dlg = root.querySelector('.lib-plate')
  if (!dlg || typeof dlg.showModal !== 'function') return
  const sheet = dlg.querySelector('.lib-plate__sheet')
  const art = dlg.querySelector('.lib-plate__art')
  const artCanvas = dlg.querySelector('.lib-plate__canvas')
  const nameEl = dlg.querySelector('.lib-plate__name')
  const sourceEl = dlg.querySelector('.lib-plate__source')
  const factEl = dlg.querySelector('.lib-plate__fact')
  const countEl = dlg.querySelector('.lib-plate__count')
  const orderBtn = dlg.querySelector('[data-act="order"]')
  const mixBtn = dlg.querySelector('[data-act="mix"]')
  const said = dlg.querySelector('.lib-plate__said')
  const prevBtn = dlg.querySelector('[data-act="prev"]')
  const nextBtn = dlg.querySelector('[data-act="next"]')
  const field = (k) => dlg.querySelector(`[data-f="${k}"]`)
  const animated = [sourceEl, factEl, dlg.querySelector('.lib-plate__facts'), dlg.querySelector('.lib-plate__actions')]

  let cur = -1
  let split = null
  let artTween = null
  let saidT = 0

  const sourceLine = (p) =>
    ({
      earth: 'From the earth',
      kiln: 'Made in a kiln',
      shell: 'From a sea snail',
      stone: 'From stone',
      metal: 'Made from metal',
      insect: 'From an insect',
      plant: 'From a plant',
      bone: 'From bone',
    })[p.source] || SOURCES[p.source]

  function fill(i) {
    const it = items[i]
    const p = it.p
    cur = i
    dlg.style.setProperty('--pig', p.hex)
    dlg.style.setProperty('--pig-tint', p.tint)
    if (split) {
      split.revert()
      split = null
    }
    nameEl.textContent = p.name
    sourceEl.textContent = sourceLine(p)
    factEl.textContent = p.fact
    field('material').textContent = p.material
    field('origin').textContent = p.origin
    field('chemistry').textContent = p.chemistry
    field('formula').innerHTML = p.formula // trusted markup from pigments.js (<sub>, <i>)
    field('era').textContent = p.era
    field('price').textContent = p.sold
      ? `${formatPrice(p.price)} for ${p.unit}${p.rare ? `. ${p.rare}` : ''}`
      : 'Archive only: toxic. We keep it for its history, and do not sell it.'
    dlg.classList.toggle('is-archive', !p.sold)
    // an archive colour has no "Add to order": if that button had focus (the
    // arrows step onto an archive plate), focus moves on to "Mix it", which
    // takes its place, instead of dropping to the page behind the plate
    const orderHadFocus = document.activeElement === orderBtn
    orderBtn.hidden = !p.sold
    if (orderHadFocus && orderBtn.hidden) mixBtn.focus()
    said.textContent = ''
    countEl.textContent = `${i + 1} of ${items.length}, oldest first`
    const prev = items[i - 1]
    const next = items[i + 1]
    prevBtn.hidden = !prev
    nextBtn.hidden = !next
    if (prev) prevBtn.querySelector('.lib-plate__step-name').textContent = prev.p.name
    if (next) nextBtn.querySelector('.lib-plate__step-name').textContent = next.p.name
  }

  function paintArt(animate) {
    const it = items[cur]
    const cw = art.clientWidth
    const ch = art.clientHeight
    if (!cw || !ch) return
    const s = dpr()
    artCanvas.width = Math.round(cw * s)
    artCanvas.height = Math.round(ch * s)
    const src = paintSwatch(it.p, artCanvas.width, artCanvas.height, s, 'plate')
    const draw = makeReveal(artCanvas, src, hashStr(it.id + 'plate'), 0.62)
    artTween?.kill()
    if (!animate || RM) {
      draw(1, 1)
      return
    }
    const o = { p: 0, q: 0 }
    draw(0, 0)
    artTween = gsap
      .timeline({ delay: 0.18 })
      .to(o, { p: 1, duration: 1.25, ease: 'power2.inOut', onUpdate: () => draw(o.p, o.q) }, 0)
      .to(o, { q: 1, duration: 1.1, ease: 'power2.inOut', onUpdate: () => draw(o.p, o.q) }, 0.4)
  }

  function animateText() {
    if (RM) return
    try {
      split = SplitText.create(nameEl, { type: 'chars', mask: 'chars' })
      gsap.from(split.chars, { yPercent: 105, duration: 1, ease: 'settle', stagger: 0.022, delay: 0.12 })
    } catch {
      split = null
    }
    gsap.fromTo(
      animated,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.9, ease: 'settle', stagger: 0.06, delay: 0.22, clearProps: 'transform' }
    )
  }

  function bloom(id) {
    ctx.palette?.drop(id, { x: 0.5, y: 0.5, amount: 0.9, radius: 0.16 })
  }

  let opener = null
  let handoff = false // "Mix it": focus moves on to the mix lab, not back to the chip
  function openPlate(id) {
    const i = items.findIndex((it) => it.id === id)
    if (i < 0) return
    fill(i)
    if (!dlg.open) {
      opener = items[i].btn
      dlg.classList.remove('is-closing')
      dlg.showModal()
      ctx.lenis?.stop()
      document.documentElement.classList.add('lib-plate-lock')
      sheet.scrollTop = 0
      if (!RM) {
        gsap.fromTo(
          sheet,
          { opacity: 0, y: 48, clipPath: 'inset(0% 0% 100% 0%)' },
          { opacity: 1, y: 0, clipPath: 'inset(0% 0% 0% 0%)', duration: 1.05, ease: 'settle', clearProps: 'clipPath,transform' }
        )
      }
    }
    requestAnimationFrame(() => paintArt(true))
    animateText()
    bloom(id)
  }

  function step(d) {
    const i = cur + d
    if (i < 0 || i >= items.length) return
    const go = () => {
      const btn = d < 0 ? prevBtn : nextBtn
      const other = d < 0 ? nextBtn : prevBtn
      const hadFocus = document.activeElement === btn
      fill(i)
      paintArt(true)
      animateText()
      bloom(items[i].id)
      // reaching the first or last colour hides that button: keep focus in the plate
      if (btn.hidden && hadFocus && !other.hidden) other.focus()
    }
    if (RM) return go()
    gsap.to([nameEl, ...animated], { opacity: 0, duration: 0.22, ease: 'power2.in', onComplete: () => {
      gsap.set([nameEl, ...animated], { opacity: 1 })
      go()
    } })
  }

  function finishClose() {
    if (dlg.open) dlg.close()
  }

  function closePlate({ instant = false } = {}) {
    if (!dlg.open) return
    if (instant || RM) return finishClose()
    dlg.classList.add('is-closing')
    gsap.to(sheet, { opacity: 0, y: 28, duration: 0.38, ease: 'power2.in', onComplete: finishClose })
  }

  dlg.addEventListener('close', () => {
    dlg.classList.remove('is-closing')
    gsap.set(sheet, { clearProps: 'opacity,transform,clipPath' })
    if (split) {
      split.revert()
      split = null
    }
    artTween?.kill()
    document.documentElement.classList.remove('lib-plate-lock')
    ctx.lenis?.start()
    if (handoff) {
      handoff = false
      return
    }
    // return focus to the colour now on the plate (it may differ from the
    // opener). After stepping through the plates that chip can be off-screen:
    // bring it into view first, so keyboard focus never lands out of sight.
    let back = items[cur]?.btn || opener
    if (!back || back.closest('[inert]')) back = opener
    if (!back) return
    const chip = back.closest('.lib-chip') || back
    const r = chip.getBoundingClientRect()
    const vh = window.innerHeight
    const navH = Math.max(0, document.querySelector('.nav')?.getBoundingClientRect().bottom ?? 80) // the fixed nav
    if (r.top < navH || r.bottom > vh) {
      const y = Math.max(0, r.top + window.scrollY - Math.max(navH + 16, (vh - r.height) * 0.4))
      if (ctx.lenis) ctx.lenis.scrollTo(y, { immediate: true, force: true })
      else window.scrollTo(0, y)
    }
    back.focus({ preventScroll: true })
  })
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault()
    closePlate()
  })
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) closePlate()
  })
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (e.target.closest?.('input, textarea, select')) return
      e.preventDefault()
      step(e.key === 'ArrowLeft' ? -1 : 1)
    }
  })

  dlg.querySelector('[data-act="close"]').addEventListener('click', () => closePlate())
  prevBtn.addEventListener('click', () => step(-1))
  nextBtn.addEventListener('click', () => step(1))
  orderBtn.addEventListener('click', () => {
    const p = items[cur]?.p
    if (!p?.sold) return
    ctx.emit('order', { id: p.id, qty: 1 })
    said.textContent = `${p.name} is in your order.`
    clearTimeout(saidT)
    saidT = setTimeout(() => (said.textContent = ''), 4000)
    ctx.palette?.drop(p.id, { x: 0.62, y: 0.7, amount: 0.6, radius: 0.08 })
  })
  mixBtn.addEventListener('click', () => {
    const p = items[cur]?.p
    if (!p) return
    ctx.emit('select-pigment', { id: p.id })
    handoff = true
    closePlate({ instant: true })
    const title = document.getElementById('mix-title')
    const focusLab = () => {
      if (!title) return
      if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1')
      title.focus({ preventScroll: true })
    }
    requestAnimationFrame(() => {
      if (ctx.lenis) ctx.scrollTo('#mix', { onComplete: focusLab })
      else {
        ctx.scrollTo('#mix')
        focusLab()
      }
    })
  })

  let artRo = 0
  window.addEventListener('resize', () => {
    if (!dlg.open) return
    clearTimeout(artRo)
    artRo = setTimeout(() => paintArt(false), 160)
  })

  // other modules may open a plate: ctx.emit('open-pigment', { id })
  ctx.on('open-pigment', ({ id } = {}) => byId[id] && openPlate(id))
}
