/**
 * loader.js — the intro. One drop of ultramarine falls into clear water.
 *
 * Clean paper. A glass pipette with a rubber bulb, drawn in fine line like a
 * plate in an old catalogue, is lowered into view with a column of
 * ultramarine inside it, while the wordmark settles letter by letter like
 * sediment. The bulb is pressed: a bead swells at the tip (the meniscus in
 * the barrel sinks as it does) and hangs there, heavy, for a beat. Once the
 * page is ready the neck pinches and the drop falls. On impact a stain
 * feathers out and rings open on the water; the first ring travels to the
 * edges of the screen and the paper goes with it, so the real dish — which
 * has just received the drop (ctx.emit('drop')) — blooms through from the
 * point of impact. The bloom has a moment to itself before the page's
 * headline starts to settle; the pipette is withdrawn and the wordmark lifts
 * into the nav.
 *
 * Contract (main.js): init(ctx, { fontsReady, pageReady }) starts after
 * fontsReady, holds the release until pageReady, and resolves at the moment
 * of hand-over. A click, key, wheel or touch fast-forwards. The outro runs on
 * after resolving; CSS (html.is-ready) later hides the layer (and drains the
 * paper outright if the ripple never ran), and html.skip-intro hides it.
 */
import '../styles/loader.css'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const rnd = (a, b) => a + Math.random() * (b - a)
const f = (n) => Math.round(n * 100) / 100
const FF_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart']
// the pipette's height above its tip, bulb included, in layout units
const PIPETTE_H = 122 + 44 + 92 + 11 + 6 + 52

export async function init(ctx, { fontsReady = Promise.resolve(), pageReady = Promise.resolve() } = {}) {
  const root = document.querySelector('.loader')
  await fontsReady
  if (!root || !ctx?.gsap) return
  let intro = null
  try {
    intro = createIntro(ctx, root)
    await intro.play(pageReady)
  } catch (err) {
    console.error('[ground] loader failed', err)
    intro?.abort()
    root.classList.add('is-done')
  }
}

function createIntro(ctx, root) {
  const { gsap } = ctx
  const pigment = ctx.pigments?.BY_ID?.ultramarine
  const $ = (s) => root.querySelector(s)
  const $$ = (s) => [...root.querySelectorAll(s)]
  const svg = $('.loader__svg')
  const el = {
    paper: $('.loader__paper'),
    pip: $('.loader__pipette'),
    glass: $$('.loader__glass'),
    wall: $$('.loader__wall'),
    glint: $('.loader__glint'),
    ticks: $('.loader__ticks'),
    liquid: $('.loader__liquid'),
    shine: $('.loader__shine'),
    meniscus: $('.loader__meniscus'),
    teat: $('.loader__teat'),
    bulb: $('.loader__bulb'),
    bulbShape: $('.loader__bulb-shape'),
    hatch: $('.loader__hatch'),
    skirt: $('.loader__skirt'),
    lip: $('.loader__lip'),
    tipclip: $('.loader__tipclip'),
    bead: $('.loader__bead'),
    beadGlint: $('.loader__bead-glint'),
    leader: $('.loader__leader'),
    fall: $('.loader__fall'),
    drop: $('.loader__drop'),
    dropGlint: $('.loader__drop-glint'),
    stain: $('.loader__stain'),
    rings: $$('.loader__ring'),
    label: $('.loader__label'),
    labelName: $('.loader__label-name'),
    labelNote: $('.loader__label-note'),
    mark: $('.loader__mark'),
  }

  // the specimen label is set from the pigment data
  if (pigment) {
    root.style.setProperty('--loader-pigment', pigment.hex)
    el.labelName.textContent = pigment.name
    const parts = (pigment.origin || '').split(',').map((s) => s.trim())
    const region = parts.length > 1 ? parts[parts.length - 2] : parts[0]
    el.labelNote.textContent = region ? `${pigment.material}, ${region}` : pigment.material
  }

  const letters = [...el.mark.children]
  const G = {} // geometry, in CSS px of the current viewport
  const S = {
    h: 0, // how far the bead hangs below the tip
    waist: 1, // neck width, as a fraction of the tip
    men: 0, // how far the meniscus has sunk
    drop: { on: false, y: 0, sx: 1, sy: 1, o: 1 },
    stain: { r: 0, o: 0 },
    rings: el.rings.map(() => ({ r: 0, o: 0 })),
    open: -1, // the ripple that takes the paper with it (radius, px; < 0 = not yet)
  }

  /* ------------------------------------------------------------- layout */
  function side(s, k) {
    const { v } = G
    const x = (r) => f(G.cx + s * r)
    const b = G.rb - k
    const c = G.rc - k
    const t = G.rt - k
    const end = k ? G.tipY - 0.7 * v : G.tipY
    const top = G.barTop + (k ? 4 * v : 0)
    let d =
      `M${x(b)},${f(top)} V${f(G.shTop)} ` +
      `C${x(b)},${f(G.shTop + 24 * v)} ${x(c)},${f(G.capTop - 20 * v)} ${x(c)},${f(G.capTop)} ` +
      `L${x(t)},${f(end)}`
    if (!k) d += ` H${x(t - G.wall)}` // the end face of the glass wall
    return d
  }

  // the rubber teat: a skirt over the top of the glass, a neck, a bulb
  function teat() {
    const { cx, v, rb, barTop } = G
    const X = (s, r) => f(cx + s * r)
    const rs = rb + 2 * v
    const skB = barTop + 9 * v
    const skT = barTop - 11 * v
    const rn = rb - 0.5 * v
    const nY = skT - 6 * v
    const bw = rb + 6.5 * v
    const top = nY - 52 * v
    G.skT = skT
    el.bulbShape.setAttribute(
      'd',
      `M${X(-1, rn)},${f(skT + 2 * v)} V${f(nY)} ` +
        `C${X(-1, rn)},${f(nY - 9 * v)} ${X(-1, bw)},${f(nY - 12 * v)} ${X(-1, bw)},${f(nY - 28 * v)} ` +
        `C${X(-1, bw)},${f(top + 9 * v)} ${X(-1, bw * 0.62)},${f(top)} ${f(cx)},${f(top)} ` +
        `C${X(1, bw * 0.62)},${f(top)} ${X(1, bw)},${f(top + 9 * v)} ${X(1, bw)},${f(nY - 28 * v)} ` +
        `C${X(1, bw)},${f(nY - 12 * v)} ${X(1, rn)},${f(nY - 9 * v)} ${X(1, rn)},${f(nY)} ` +
        `V${f(skT + 2 * v)} Z`,
    )
    el.skirt.setAttribute(
      'd',
      `M${X(-1, rs)},${f(skB)} V${f(skT + 1.6 * v)} Q${X(-1, rs)},${f(skT)} ${X(-1, rs - 1.6 * v)},${f(skT)} ` +
        `H${X(1, rs - 1.6 * v)} Q${X(1, rs)},${f(skT)} ${X(1, rs)},${f(skT + 1.6 * v)} V${f(skB)} Z`,
    )
    el.lip.setAttribute('d', `M${X(-1, rs)},${f(skB - 2.6 * v)} H${X(1, rs)}`)
    // an engraver's hatching on the shadow side of the bulb
    let h = ''
    for (let i = 0; i < 6; i++) {
      const y = nY - 13 * v - i * 6.2 * v
      const w = bw * (i === 0 || i === 5 ? 0.78 : 0.92)
      h += `M${X(1, bw * 0.46)},${f(y + 1.4 * v)} Q${X(1, w * 0.8)},${f(y - 0.6 * v)} ${X(1, w)},${f(y + 1.2 * v)} `
    }
    el.hatch.setAttribute('d', h.trim())
  }

  function layout() {
    const W = window.innerWidth
    const H = window.innerHeight
    const u = clamp(Math.min(W, H) / 900, 0.62, 1.25)
    const mobile = W < 768
    Object.assign(G, { W, H, u, mobile, cx: W / 2 })
    G.tipY = Math.round(H * (mobile ? 0.34 : 0.4))
    G.impactY = Math.round(H * (mobile ? 0.48 : 0.555))
    // the whole pipette, bulb and all, stands in frame above its tip
    const room = G.tipY - Math.max(H * 0.06, 28)
    const v = u * clamp(room / (PIPETTE_H * u), 0.5, 1)
    G.v = v
    G.rt = 3.4 * v // outer half-width at the tip
    G.rc = 4.7 * v // ... at the top of the capillary
    G.rb = 16 * v // ... of the barrel
    G.wall = 1.5 * v
    G.capTop = G.tipY - 122 * v
    G.shTop = G.capTop - 44 * v
    G.barTop = G.shTop - 92 * v
    G.mY = G.shTop - 34 * v
    G.R = 8.5 * v // the drop
    G.w0 = G.rt - 0.15 * v
    G.hF = 2 * G.R + 6 * v // how far a full drop hangs
    G.lift = G.tipY + 40 * v
    // the first ring carries the paper away: it must clear every corner
    const far = Math.hypot(Math.max(G.cx, W - G.cx), Math.max(G.impactY, H - G.impactY))
    G.feather = clamp(Math.min(W, H) * 0.16, 70, 170)
    G.reach = far + G.feather + 12

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    el.tipclip.setAttribute('x', '0')
    el.tipclip.setAttribute('y', String(f(G.tipY - 0.35)))
    el.tipclip.setAttribute('width', String(W))
    el.tipclip.setAttribute('height', String(H))

    el.glass[0].setAttribute('d', side(-1, 0))
    el.glass[1].setAttribute('d', side(1, 0))
    el.wall[0].setAttribute('d', side(-1, G.wall))
    el.wall[1].setAttribute('d', side(1, G.wall))
    teat()

    // a glint down the empty glass above the liquid
    const gx = f(G.cx - G.rb + 4.2 * v)
    el.glint.setAttribute('d', `M${gx},${f(G.barTop + 14 * v)} V${f(G.mY - 9 * v)}`)

    // printed graduations on the barrel
    let ticks = ''
    for (let i = 0; i < 8; i++) {
      const y = G.shTop - 9 * v - i * 11 * v
      if (y < G.barTop + 16 * v) break
      const len = i % 2 ? 0.34 : 0.62
      ticks += `M${f(G.cx + G.rb * 0.12)},${f(y)} H${f(G.cx + G.rb * (0.12 + len))} `
    }
    el.ticks.setAttribute('d', ticks.trim())

    // the specimen label, its first line centred on a short leader
    const ly = G.tipY + G.hF * 0.6
    el.leader.setAttribute('d', `M${f(G.cx + G.R + 8 * v)},${f(ly)} H${f(G.cx + 40 * v)}`)
    const nameH = el.labelName.offsetHeight || 20
    gsap.set(el.label, { x: G.cx + 47 * v, y: ly - nameH / 2 })

    // the wordmark, centred in the lower part of the screen
    const mw = el.mark.offsetWidth
    const mh = el.mark.offsetHeight
    G.markTop = Math.min(H * (mobile ? 0.62 : 0.655), H - mh - H * 0.07)
    gsap.set(el.mark, { x: -mw / 2, y: G.markTop })

    el.paper.style.setProperty('--ox', `${f(G.cx)}px`)
    el.paper.style.setProperty('--oy', `${f(G.impactY)}px`)
    el.paper.style.setProperty('--f', `${f(G.feather)}px`)

    renderLiquid()
    render()
  }

  /* ----------------------------------------------------------- drawing */
  function renderLiquid() {
    const { cx, v } = G
    const bi = G.rb - G.wall
    const ci = G.rc - G.wall
    const ti = G.rt - G.wall
    const m = G.mY + S.men
    const X = (s, r) => f(cx + s * r)
    const top = `V${f(m - 2.4 * v)} Q${f(cx)},${f(m + 3.4 * v)} ${X(1, bi)},${f(m - 2.4 * v)}`
    el.liquid.setAttribute(
      'd',
      `M${X(-1, ti)},${f(G.tipY + 0.5)} L${X(-1, ci)},${f(G.capTop)} ` +
        `C${X(-1, ci)},${f(G.capTop - 20 * v)} ${X(-1, bi)},${f(G.shTop + 24 * v)} ${X(-1, bi)},${f(G.shTop)} ` +
        `${top} V${f(G.shTop)} ` +
        `C${X(1, bi)},${f(G.shTop + 24 * v)} ${X(1, ci)},${f(G.capTop - 20 * v)} ${X(1, ci)},${f(G.capTop)} ` +
        `L${X(1, ti)},${f(G.tipY + 0.5)} Z`,
    )
    el.meniscus.setAttribute('d', `M${X(-1, bi)},${f(m - 2.4 * v)} Q${f(cx)},${f(m + 3.4 * v)} ${X(1, bi)},${f(m - 2.4 * v)}`)
    el.shine.setAttribute(
      'd',
      `M${X(-1, bi * 0.52)},${f(m + 5 * v)} V${f(G.shTop + 3 * v)} ` +
        `M${X(-1, ci * 0.32)},${f(G.capTop + 7 * v)} L${X(-1, ti * 0.3)},${f(G.tipY - 9 * v)}`,
    )
  }

  function renderBead() {
    const { cx, tipY, w0 } = G
    const h = S.h
    if (h < 0.05) {
      el.bead.setAttribute('d', '')
      el.beadGlint.setAttribute('rx', '0')
      return
    }
    if (h <= w0) {
      // a cap, wetting the rim of the tip
      const r = (w0 * w0 + h * h) / (2 * h)
      el.bead.setAttribute('d', `M${f(cx - w0)},${f(tipY)} A${f(r)},${f(r)} 0 0 0 ${f(cx + w0)},${f(tipY)} Z`)
      el.beadGlint.setAttribute('rx', '0')
      G.beadCy = tipY + h - r
      G.beadR = r
      return
    }
    // a pendant drop: a sphere on a neck that thins as it grows
    const t = clamp((h - w0) / (G.hF - w0), 0, 1.2)
    const r = lerp(w0, G.R, Math.pow(Math.min(t, 1), 0.7))
    const cy = tipY + h - r
    const n = cy - tipY
    const wst = w0 * S.waist
    el.bead.setAttribute(
      'd',
      `M${f(cx - w0)},${f(tipY)} C${f(cx - wst)},${f(tipY + n * 0.5)} ${f(cx - r)},${f(cy - r * 0.9)} ${f(cx - r)},${f(cy)} ` +
        `A${f(r)},${f(r)} 0 0 0 ${f(cx + r)},${f(cy)} ` +
        `C${f(cx + r)},${f(cy - r * 0.9)} ${f(cx + wst)},${f(tipY + n * 0.5)} ${f(cx + w0)},${f(tipY)} Z`,
    )
    const g = el.beadGlint
    const k = Math.min(t, 1)
    g.setAttribute('cx', f(cx - r * 0.36))
    g.setAttribute('cy', f(cy - r * 0.28))
    g.setAttribute('rx', f(r * 0.2 * k))
    g.setAttribute('ry', f(r * 0.3 * k))
    G.beadCy = cy
    G.beadR = r
  }

  let opened = -2
  function render() {
    renderBead()
    const d = S.drop
    if (d.on) {
      const rx = G.R * d.sx
      const ry = G.R * d.sy
      el.drop.setAttribute('cx', f(G.cx))
      el.drop.setAttribute('cy', f(d.y))
      el.drop.setAttribute('rx', f(rx))
      el.drop.setAttribute('ry', f(ry))
      el.dropGlint.setAttribute('cx', f(G.cx - rx * 0.36))
      el.dropGlint.setAttribute('cy', f(d.y - ry * 0.3))
      el.dropGlint.setAttribute('rx', f(rx * 0.2))
      el.dropGlint.setAttribute('ry', f(ry * 0.28))
      el.fall.style.opacity = d.o
    }
    el.stain.setAttribute('cx', f(G.cx))
    el.stain.setAttribute('cy', f(G.impactY))
    el.stain.setAttribute('r', f(Math.max(0, S.stain.r)))
    el.stain.style.opacity = S.stain.o
    S.rings.forEach((r, i) => {
      const c = el.rings[i]
      c.setAttribute('cx', f(G.cx))
      c.setAttribute('cy', f(G.impactY))
      c.setAttribute('r', f(Math.max(0, r.r)))
      c.style.strokeOpacity = r.o
    })
    // the paper goes with the first ring: clear inside it, feathered to the ring
    if (S.open >= 0) S.open = Math.max(0, S.rings[0].r)
    if (S.open >= 0 && Math.abs(S.open - opened) > 0.5) {
      opened = S.open
      el.paper.style.setProperty('--r', `${f(S.open)}px`)
    }
  }

  /* ----------------------------------------------------------- timelines */
  layout()
  gsap.ticker.add(render)
  root.classList.add('is-set')

  let fast = false
  const live = new Set()
  const track = (tl) => {
    live.add(tl)
    if (fast) tl.timeScale(3)
    return tl
  }
  const ff = () => {
    if (fast) return
    fast = true
    live.forEach((tl) => tl.timeScale(3))
  }
  FF_EVENTS.forEach((t) => window.addEventListener(t, ff, { passive: true }))
  // a phone's toolbars resize the viewport's height: only a new width (a
  // turned phone, a resized window) is worth hurrying for
  let lastW = window.innerWidth
  const onResize = () => {
    layout()
    if (Math.abs(window.innerWidth - lastW) > 40) ff()
    lastW = window.innerWidth
  }
  window.addEventListener('resize', onResize)

  // 1. the pipette is lowered into view; the bulb is pressed and a bead swells
  const press = { s: 0 }
  const squeeze = () => {
    const s = press.s
    gsap.set(el.bulb, { scaleX: 1 + s * 0.55, scaleY: 1 - s, svgOrigin: `${f(G.cx)} ${f(G.skT)}` })
  }
  const lower = track(gsap.timeline())
  lower
    .fromTo(el.pip, { y: -G.lift }, { y: 0, duration: 1.2, ease: 'power3.out' }, 0)
    .fromTo(el.glass, { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: 1.05, ease: 'power2.inOut' }, 0.05)
    .fromTo(el.teat, { opacity: 0 }, { opacity: 1, duration: 0.55, ease: 'power1.out' }, 0)
    .fromTo([el.liquid, el.shine, el.meniscus], { opacity: 0 }, { opacity: 1, duration: 0.7, ease: 'power1.inOut' }, 0.25)
    .fromTo([...el.wall, el.glint, el.ticks], { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power1.out' }, 0.45)
    .to(press, { s: 0.07, duration: 0.85, ease: 'power1.inOut', onUpdate: squeeze }, 0.72)
    .to(S, { h: G.hF, men: 3.5 * G.v, duration: 0.82, ease: 'power1.inOut', onUpdate: renderLiquid }, 0.75)
    .fromTo(el.leader, { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: 0.55, ease: 'power2.out' }, 0.95)
    .fromTo(el.label.children, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.08 }, 1.0)
    // ...and hangs there, heavy, for a beat
    .to(S, { h: G.hF + 1.4 * G.v, duration: 0.34, ease: 'sine.inOut' }, 1.57)

  // 2. meanwhile the wordmark settles, letter by letter, like sediment
  const settle = track(gsap.timeline())
  const order = letters.map((_, i) => i).sort(() => Math.random() - 0.5)
  order.forEach((i, k) => {
    settle.fromTo(
      letters[i],
      { yPercent: -rnd(46, 66), xPercent: rnd(-7, 7), rotation: rnd(-8, 8), opacity: 0, filter: 'blur(9px)' },
      {
        yPercent: 0,
        xPercent: 0,
        rotation: 0,
        opacity: 1,
        filter: 'blur(0px)',
        duration: rnd(1.2, 1.38),
        ease: 'settle',
        transformOrigin: '50% 85%',
        clearProps: 'filter',
      },
      0.38 + k * 0.09 + rnd(0, 0.05),
    )
  })

  const done = (tl) => new Promise((r) => tl.eventCallback('onComplete', r))

  async function play(pageReady) {
    // hold the drop until the page is ready behind the paper; if that takes
    // a while, the bead breathes on the tip instead of freezing
    let waiting = null
    let pageIn = false
    pageReady.then(() => (pageIn = true))
    await done(lower)
    if (!pageIn) {
      waiting = gsap.to(S, { h: G.hF + 2.4 * G.v, duration: 0.9, ease: 'sine.inOut', yoyo: true, repeat: -1 })
    }
    await pageReady
    waiting?.kill()
    return new Promise((resolve) => {
      const release = track(gsap.timeline())
      const R = G.R
      // a last press of the bulb; the neck lengthens and pinches...
      release.to(press, { s: 0.1, duration: 0.2, ease: 'power2.in', onUpdate: squeeze }, 0)
      release.to(S, { h: G.hF + 7 * G.v, waist: 0.18, duration: 0.22, ease: 'power2.in' }, 0)
      // ...and lets go
      release.add(() => {
        S.drop.on = true
        S.drop.y = G.beadCy
        S.drop.o = 1
        S.h = G.w0 * 0.95
        S.waist = 1
      })
      release.addLabel('fall')
      release.to(press, { s: 0, duration: 0.9, ease: 'settle', onUpdate: squeeze }, 'fall')
      release.fromTo(S.drop, { sx: 0.84, sy: 1.22 }, { sx: 0.93, sy: 1.12, duration: 0.42, ease: 'power1.out' }, 'fall')
      release.to(S.drop, { y: G.impactY, duration: 0.42, ease: 'power2.in' }, 'fall')
      release.to(S, { h: G.w0 * 0.42, duration: 0.6, ease: 'settle' }, 'fall')
      release.to(S, { men: 2.4 * G.v, duration: 0.6, ease: 'settle', onUpdate: renderLiquid }, 'fall')
      // the label has said its piece
      release.to([el.label, el.leader], { opacity: 0, duration: 0.45, ease: 'power1.out' }, 'fall+=0.12')
      // impact: the drop flattens into the water, a stain feathers out,
      // rings open, and the first of them takes the paper with it
      release.addLabel('impact', 'fall+=0.42')
      release.to(S.drop, { sx: 2.4, sy: 0.3, o: 0, duration: 0.26, ease: 'power2.out' }, 'impact')
      const later = { immediateRender: false }
      release.fromTo(
        S.stain,
        { r: R * 0.9, o: 1 },
        { r: 36 * G.v, o: 0, duration: 1.25, ease: 'power2.out', ...later },
        'impact',
      )
      release.add(() => {
        S.open = 0
        root.classList.add('is-opening')
      }, 'impact')
      const wave = S.rings[0]
      release.fromTo(wave, { r: R * 1.3 }, { r: G.reach, duration: 2.1, ease: 'power2.out', ...later }, 'impact')
      release.fromTo(wave, { o: 0.62 }, { o: 0, duration: 1.7, ease: 'sine.in', ...later }, 'impact')
      const reach = [196, 126]
      S.rings.slice(1).forEach((r, i) => {
        const at = `impact+=${(0.16 + i * 0.17).toFixed(2)}`
        release.fromTo(r, { r: R * 1.3 }, { r: reach[i] * G.v, duration: 1.6 + i * 0.25, ease: 'power2.out', ...later }, at)
        release.fromTo(r, { o: 0.5 - i * 0.12 }, { o: 0, duration: 1.4 + i * 0.25, ease: 'power1.in', ...later }, at)
      })
      // the real dish receives the drop under the opening paper
      release.add(() => {
        try {
          ctx.emit('drop', { id: 'ultramarine', x: 0.5, y: G.impactY / G.H, amount: 1.4, radius: 0.12 })
        } catch (err) {
          console.error('[ground] loader drop failed', err)
        }
      }, 'impact+=0.02')
      // the pipette is withdrawn
      release.to(el.pip, { y: -G.lift, duration: 0.8, ease: 'power2.in' }, 'impact+=0.12')
      release.to(el.pip, { opacity: 0, duration: 0.35, ease: 'power1.in' }, 'impact+=0.55')
      // the hand-over, once the bloom has had a moment to itself
      release.add(() => {
        const outro = handOver()
        resolve()
        Promise.all([done(release), done(outro)]).then(finish)
      }, 'impact+=0.42')
    })
  }

  /* ------------------------------------------------------- the hand-over */
  const navMark = document.querySelector('.nav__mark')

  function handOver() {
    FF_EVENTS.forEach((t) => window.removeEventListener(t, ff))
    window.removeEventListener('resize', onResize)
    if (navMark) navMark.style.opacity = '0'
    const out = gsap.timeline()
    flight(out)
    return out
  }

  // the wordmark lifts out of the water and becomes the nav's wordmark
  function flight(out) {
    const target = navMark?.querySelector('.nav__mark-text')
    const tr = target?.getBoundingClientRect()
    const visible = tr && tr.width > 0 && tr.bottom > 0 && tr.top < window.innerHeight
    if (!visible) {
      out.to(el.mark, { opacity: 0, y: '-=24', duration: 0.7, ease: 'power2.in' }, 0.25)
      return
    }
    // re-set as one run of text so it kerns exactly like the nav's
    const before = el.mark.getBoundingClientRect()
    el.mark.textContent = 'Ground'
    const now = el.mark.getBoundingClientRect()
    gsap.set(el.mark, { x: `+=${before.left + before.width / 2 - (now.left + now.width / 2)}` })
    const mr = el.mark.getBoundingClientRect()
    const fsA = parseFloat(getComputedStyle(el.mark).fontSize) || 1
    const fsB = parseFloat(getComputedStyle(target).fontSize) || 1
    const x0 = gsap.getProperty(el.mark, 'x')
    const y0 = gsap.getProperty(el.mark, 'y')
    const dx = tr.left - mr.left
    const dy = tr.top + tr.height / 2 - (mr.top + mr.height / 2)
    const opsz = (v) => `"opsz" ${Math.round(clamp(v, 6, 96))}`
    const T = 0.12
    const D = 1.15
    out.fromTo(
      el.mark,
      { fontVariationSettings: opsz(fsA) },
      { x: x0 + dx, y: y0 + dy, scale: fsB / fsA, fontVariationSettings: opsz(fsB), duration: D, ease: 'expo.inOut' },
      T,
    )
    out.add(() => {
      if (!navMark) return
      navMark.style.transition = 'none'
      navMark.style.opacity = '1'
    }, T + D)
    out.to(el.mark, { opacity: 0, duration: 0.3, ease: 'power1.out' }, T + D)
    out.add(() => {
      if (!navMark) return
      navMark.style.transition = ''
      navMark.style.opacity = ''
    }, T + D + 0.35)
  }

  function finish() {
    gsap.ticker.remove(render)
    root.classList.add('is-done')
    live.forEach((tl) => tl.kill())
    live.clear()
  }

  function abort() {
    FF_EVENTS.forEach((t) => window.removeEventListener(t, ff))
    window.removeEventListener('resize', onResize)
    gsap.ticker.remove(render)
    live.forEach((tl) => tl.kill())
    root.classList.remove('is-opening')
    if (navMark) {
      navMark.style.transition = ''
      navMark.style.opacity = ''
    }
  }

  return { play, abort }
}
