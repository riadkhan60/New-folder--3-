/**
 * core/cursor — fine pointers only (skipped on touch and reduced motion).
 *
 * A precise dot, a thin ring that lags behind it, and the signature: moving
 * through the water disturbs plankton, which flash. Fast movements leave a
 * wake of tiny bioluminescent sparks (pooled particles on a 2D canvas with
 * additive 'lighter' compositing). Sparks are faint in sunlit water and grow
 * brighter as the sun fades (1 - state.sun); blue-green, turning red-tinted
 * with --hadal. The loop only runs while something is moving or glowing.
 *
 * Cursor contract (DESIGN.md): nearest [data-cursor] ancestor →
 *   hide | lamp | drag | view. Links and buttons enlarge the ring.
 */
import '../styles/cursor.css'

const MAX = 240 // particle pool
const STRIDE = 9 // x, y, vx, vy, age, life, size, delay, hue
const LINKS = 'a[href], button, [role="button"], label[for], select, summary, input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"]'
const TEXT = 'input:not([type="checkbox"], [type="radio"], [type="range"], [type="submit"], [type="button"]), textarea, [contenteditable="true"]'

const C_GREEN = [108, 248, 232]
const C_BLUE = [58, 168, 255]
const C_RED = [255, 59, 47]

export function init(ctx) {
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
  if (ctx.isTouch || ctx.reducedMotion || !fine) return

  const html = document.documentElement
  html.classList.add('has-cursor')

  /* ------------------------------------------------------------- DOM */
  const root = document.createElement('div')
  root.className = 'cursor'
  root.setAttribute('aria-hidden', 'true')
  root.innerHTML =
    '<div class="cursor__ring"><div class="cursor__ring-inner"></div><span class="cursor__label"></span></div>' +
    '<div class="cursor__dot"><div class="cursor__dot-inner"></div></div>'
  const canvas = document.createElement('canvas')
  canvas.className = 'cursor__sparks'
  canvas.setAttribute('aria-hidden', 'true')
  document.body.append(canvas, root)

  const ring = root.querySelector('.cursor__ring')
  const dot = root.querySelector('.cursor__dot')
  const label = root.querySelector('.cursor__label')
  const g = canvas.getContext('2d')
  const dpr = Math.min(ctx.dpr, 1.5)

  /* ---------------------------------------------------------- sprites */
  // two soft glow sprites (green + blue), re-tinted towards red with --hadal
  const SPR = 48
  const sprites = [document.createElement('canvas'), document.createElement('canvas')]
  let spriteHadal = -1
  function paintSprites(h) {
    spriteHadal = h
    ;[C_GREEN, C_BLUE].forEach((base, k) => {
      const c = base.map((v, i) => Math.round(v + (C_RED[i] - v) * h))
      const s = sprites[k]
      s.width = s.height = SPR
      const sg = s.getContext('2d')
      const grd = sg.createRadialGradient(SPR / 2, SPR / 2, 0, SPR / 2, SPR / 2, SPR / 2)
      grd.addColorStop(0, 'rgba(244,255,253,1)')
      grd.addColorStop(0.1, `rgba(${c[0]},${c[1]},${c[2]},0.95)`)
      grd.addColorStop(0.32, `rgba(${c[0]},${c[1]},${c[2]},0.28)`)
      grd.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`)
      sg.fillStyle = grd
      sg.fillRect(0, 0, SPR, SPR)
    })
  }
  paintSprites(0)

  /* -------------------------------------------------------------- state */
  const P = new Float32Array(MAX * STRIDE)
  let alive = 0 // number of live particles (packed at the front)
  let W = 0
  let H = 0
  const mouse = { x: -100, y: -100, px: -100, py: -100, t: 0 }
  const ringPos = { x: -100, y: -100 }
  let visible = false
  let mode = 'default'
  let running = false
  let last = 0
  let intensity = 0.2
  let hadal = 0
  let lastSpawnT = 0
  let hidden = document.hidden

  function resize() {
    W = window.innerWidth
    H = window.innerHeight
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize()
  window.addEventListener('resize', resize)

  ctx.depth.onChange((s) => {
    // plankton flashes are invisible in sunlight and vivid in the dark
    intensity = 0.16 + 0.84 * (1 - s.sun)
    hadal = s.hadal
    if (Math.abs(hadal - spriteHadal) > 0.04) paintSprites(hadal)
    if (Math.abs(hadal - (root._h ?? -1)) > 0.01) {
      root._h = hadal
      const c = C_GREEN.map((v, i) => Math.round(v + (C_RED[i] - v) * hadal))
      root.style.setProperty('--cur-accent', `rgb(${c[0]} ${c[1]} ${c[2]})`)
    }
  })

  /* --------------------------------------------------------- particles */
  function spawn(x, y, vx, vy, life, size, delay) {
    let i
    if (alive < MAX) i = alive++
    else i = Math.floor(Math.random() * MAX) // recycle a random old one
    const o = i * STRIDE
    P[o] = x
    P[o + 1] = y
    P[o + 2] = vx
    P[o + 3] = vy
    P[o + 4] = 0
    P[o + 5] = life
    P[o + 6] = size
    P[o + 7] = delay
    P[o + 8] = Math.random() < 0.72 ? 0 : 1
  }

  function wake(x0, y0, x1, y1, dt) {
    const dx = x1 - x0
    const dy = y1 - y0
    const dist = Math.hypot(dx, dy)
    const speed = dist / Math.max(dt, 1) // px per ms
    if (speed < 0.35 || dist < 2) return
    const n = Math.min(10, Math.floor(dist * 0.06 * Math.min(2.2, speed)))
    const nx = -dy / dist
    const ny = dx / dist
    for (let k = 0; k < n; k++) {
      const t = Math.random()
      const side = (Math.random() - 0.5) * 2
      const spread = 6 + Math.random() * 26 * Math.min(1.6, speed * 0.6)
      const x = x0 + dx * t + nx * side * spread
      const y = y0 + dy * t + ny * side * spread
      // a little of the pointer's momentum, mostly pushed outwards from the path
      const push = 0.012 + Math.random() * 0.03
      spawn(
        x,
        y,
        dx * push * 0.35 + nx * side * 0.25,
        dy * push * 0.35 + ny * side * 0.25,
        0.7 + Math.random() * 1.1,
        0.6 + Math.random() ** 2 * 1.8,
        Math.random() * 0.22 + (1 - t) * 0.06,
      )
    }
  }

  function burst(x, y) {
    const n = 22
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.3
      const r = 4 + Math.random() * 10
      const sp = 0.6 + Math.random() * 1.4
      spawn(x + Math.cos(a) * r, y + Math.sin(a) * r, Math.cos(a) * sp, Math.sin(a) * sp, 0.9 + Math.random() * 0.9, 0.7 + Math.random() * 1.3, Math.random() * 0.12)
    }
    kick()
  }

  /* --------------------------------------------------------------- loop */
  function kick() {
    if (running || hidden) return
    running = true
    last = performance.now()
    requestAnimationFrame(frame)
  }

  function frame(now) {
    if (hidden) {
      running = false
      return
    }
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now

    // dot: exact; ring: lags with a frame-rate independent ease
    dot.style.transform = `translate3d(${mouse.x}px, ${mouse.y}px, 0)`
    const k = 1 - Math.pow(1 - 0.2, dt * 60)
    ringPos.x += (mouse.x - ringPos.x) * k
    ringPos.y += (mouse.y - ringPos.y) * k
    ring.style.transform = `translate3d(${ringPos.x.toFixed(2)}px, ${ringPos.y.toFixed(2)}px, 0)`
    const settled = Math.abs(mouse.x - ringPos.x) < 0.1 && Math.abs(mouse.y - ringPos.y) < 0.1

    // sparks
    g.clearRect(0, 0, W, H)
    if (alive) {
      g.globalCompositeOperation = 'lighter'
      const damp = Math.pow(0.9, dt * 60)
      for (let i = 0; i < alive; i++) {
        const o = i * STRIDE
        P[o + 4] += dt
        const age = P[o + 4] - P[o + 7]
        const life = P[o + 5]
        if (age >= life) {
          // swap-remove: move the last live particle into this slot
          alive--
          if (i !== alive) P.copyWithin(o, alive * STRIDE, alive * STRIDE + STRIDE)
          i--
          continue
        }
        if (age < 0) continue
        P[o] += P[o + 2] * dt * 60
        P[o + 1] += P[o + 3] * dt * 60
        P[o + 2] *= damp
        P[o + 3] = P[o + 3] * damp - 0.004 * dt * 60 // a hint of drift upwards
        const t = age / life
        // a bioluminescent flash: near-instant rise, slow exponential fade
        const b = Math.min(1, t * 16) * Math.pow(1 - t, 2.2)
        const a = b * intensity
        if (a < 0.01) continue
        const s = P[o + 6] * (5 + 3 * (1 - t))
        g.globalAlpha = a
        g.drawImage(sprites[P[o + 8]], P[o] - s, P[o + 1] - s, s * 2, s * 2)
      }
      g.globalAlpha = 1
      g.globalCompositeOperation = 'source-over'
    }

    if (alive || !settled) requestAnimationFrame(frame)
    else running = false
  }

  /* ------------------------------------------------------------ modes */
  let modeEl = null
  function resolveMode(target) {
    if (!(target instanceof Element)) return 'default'
    const tagged = target.closest('[data-cursor]')
    const tag = tagged?.dataset.cursor
    if (tag === 'hide') return 'hide'
    if (target.closest(TEXT)) return 'text'
    if (tag === 'drag' || tag === 'view') return tag
    if (target.closest(LINKS)) return 'link'
    if (tag === 'lamp') return 'lamp'
    return 'default'
  }
  function setMode(m) {
    if (m === mode) return
    mode = m
    root.dataset.mode = m
    if (m === 'drag') label.textContent = 'Drag'
    else if (m === 'view') label.textContent = 'View'
  }

  /* ----------------------------------------------------------- events */
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
      const now = performance.now()
      const dt = now - mouse.t
      mouse.px = mouse.x
      mouse.py = mouse.y
      mouse.x = e.clientX
      mouse.y = e.clientY
      mouse.t = now
      if (!visible) {
        visible = true
        root.classList.add('is-visible')
        ringPos.x = mouse.x
        ringPos.y = mouse.y
      } else if (mode !== 'hide' && dt < 80 && now - lastSpawnT > 8) {
        lastSpawnT = now
        wake(mouse.px, mouse.py, mouse.x, mouse.y, dt)
      }
      if (e.target !== modeEl) {
        modeEl = e.target
        setMode(resolveMode(e.target))
      }
      kick()
    },
    { passive: true },
  )

  // the element under a still pointer can change as the page scrolls
  const recheck = () => {
    if (!visible) return
    const el = document.elementFromPoint(mouse.x, mouse.y)
    if (el && el !== modeEl) {
      modeEl = el
      setMode(resolveMode(el))
    }
  }
  let rq = 0
  const onScroll = () => {
    if (rq) return
    rq = requestAnimationFrame(() => {
      rq = 0
      recheck()
    })
  }
  if (ctx.lenis) ctx.lenis.on('scroll', onScroll)
  else window.addEventListener('scroll', onScroll, { passive: true })

  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
    root.classList.add('is-down')
    if (mode !== 'hide' && mode !== 'text') burst(e.clientX, e.clientY)
  })
  window.addEventListener('pointerup', () => root.classList.remove('is-down'))

  document.documentElement.addEventListener('pointerleave', () => {
    visible = false
    root.classList.remove('is-visible')
  })
  window.addEventListener('blur', () => {
    visible = false
    root.classList.remove('is-visible')
  })

  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden
    if (hidden) {
      running = false
      alive = 0
      g.clearRect(0, 0, W, H)
    }
  })
}
