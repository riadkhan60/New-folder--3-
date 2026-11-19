/**
 * footer.js — the last field is bone black.
 *
 * Signature: the wordmark is set in loose pigment. The letters are sampled
 * into thousands of grains; when the footer arrives they fall into the
 * letterforms from left to right and settle. The cursor (or a finger) stirs
 * them aside like breath over powder, and they drift back, slowly, without
 * bounce. The real text stays in the DOM (transparent once the grains are
 * drawn), so the heading is still read, selected and found.
 *
 * "Back to paper" drops clear water into the black at the button, then
 * scrolls back to the top.
 */
import '../styles/footer.css'

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
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

  /* ---------------------------------------------------------- back to paper */
  const back = root.querySelector('[data-back-to-paper]')
  back?.addEventListener('click', (e) => {
    const drop = back.querySelector('.footer__paper-drop') || back
    const r = drop.getBoundingClientRect()
    ctx.palette?.drop('paper', {
      x: (r.left + r.width / 2) / window.innerWidth,
      y: (r.top + r.height / 2) / window.innerHeight,
      amount: 1.6,
      radius: 0.1,
    })
    const keyboard = e.detail === 0
    const focusMain = () => document.getElementById('main')?.focus({ preventScroll: true })
    const go = () => {
      if (ctx.lenis) ctx.scrollTo(0, { onComplete: keyboard ? focusMain : undefined })
      else {
        ctx.scrollTo(0)
        if (keyboard) focusMain()
      }
    }
    if (ctx.reducedMotion) go()
    else setTimeout(go, 280)
  })

  /* ---------------------------------------------------------- the wordmark */
  const mark = root.querySelector('.footer__mark')
  const word = root.querySelector('.footer__word')
  const canvas = root.querySelector('.footer__grains')
  if (!mark || !word || !canvas) return
  const g = canvas.getContext('2d')
  if (!g) return

  const reduced = ctx.reducedMotion
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
  let running = false
  let visible = false
  let pointer = { x: -9999, y: -9999, vx: 0, vy: 0, t: 0, in: false }

  const INK = getComputedStyle(root).getPropertyValue('--ink').trim() || '#f3f1ee'
  const SPECKS = ['yellow-ochre', 'egyptian-blue', 'malachite', 'carmine', 'ultramarine', 'red-ochre', 'tyrian-purple']
    .map((id) => ctx.pigments.BY_ID[id])
    .filter(Boolean)

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
    const bk = new Uint8Array(N)
    const nInk = 4
    const alphas = [1, 0.8, 0.6, 0.38]
    for (let i = 0; i < N; i++) {
      const x = pts[i * 2]
      const y = pts[i * 2 + 1]
      hx[i] = px[i] = x
      hy[i] = py[i] = y
      sz[i] = step * (0.5 + rnd() * 0.65)
      const r = rnd()
      bk[i] = r < 0.034 ? nInk + ((rnd() * SPECKS.length) | 0) : r < 0.5 ? 0 : r < 0.76 ? 1 : r < 0.92 ? 2 : 3
      // pouring: left to right, each grain falls from above and settles
      dl[i] = (x / cw) * 1.05 + rnd() * 0.45
      du[i] = 0.9 + rnd() * 0.7
      sx0[i] = x + (rnd() - 0.5) * 40
      sy0[i] = Math.max(-y * 0.2, y - (140 + rnd() * 300) * (ch / 600))
    }
    // draw order grouped by colour
    order = new Uint32Array(N)
    buckets = []
    let k = 0
    const nb = nInk + SPECKS.length
    for (let b = 0; b < nb; b++) {
      const from = k
      for (let i = 0; i < N; i++) if (bk[i] === b) order[k++] = i
      const style =
        b < nInk ? hexA(INK, alphas[b]) : hexA(SPECKS[b - nInk].hex === '#6a1e55' ? SPECKS[b - nInk].tint : SPECKS[b - nInk].hex, 0.95)
      buckets.push({ style, from, to: k })
    }
    return true
  }

  function hexA(h, a) {
    const c = h.replace('#', '')
    const n = parseInt(c.length === 3 ? c.replace(/./g, '$&$&') : c, 16)
    return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${a})`
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
          const e = eo(u)
          const x = sx0[i] + (hx[i] - sx0[i]) * e
          const y = sy0[i] + (hy[i] - sy0[i]) * (u < 0.62 ? (u / 0.62) ** 2 * 0.92 : 0.92 + 0.08 * eo((u - 0.62) / 0.38))
          const s = sz[i] * (0.7 + 0.3 * e)
          g.globalAlpha = clamp(u * 4)
          g.fillRect(x, y, s, s)
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
      if (t > 1.05 + 0.45 + 1.6 + 0.05) {
        poured = true
      }
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
    if (!visible || !ready) {
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
    if (running || !ready || !visible) return
    running = true
    requestAnimationFrame(loop)
  }

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
    poured = false
    pourStart = performance.now()
    wake()
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
      poured = true
      draw(performance.now())
    }, 150)
  })
  ro.observe(mark)
}
