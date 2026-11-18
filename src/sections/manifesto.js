/**
 * manifesto.js — #descent (0 → 200 m). Why go down.
 *
 * Signature: the passage is read by sinking. A reading head, scrubbed by
 * scroll, travels through the words. Each word ahead of it sits dim; the
 * moment the head reaches it, it flashes photophore blue-green — like
 * Noctiluca disturbed in the dark — throws off a few sparks of living light,
 * and settles to full ink. A wake of 3–4 words glows behind the head.
 * Pure function of scroll, so it runs the same backwards.
 *
 * The gauge: a tape measure fixed to the water column, 1 m to a tick, rises
 * past an index on the left edge. While the stage is stuck, the tick at the
 * index is exactly the depth depth.js reports (same probe, same mapping).
 */
import '../styles/manifesto.css'

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const INK = [234, 246, 244]
const GLOW = [108, 248, 232] // --c-photophore
const GLOW2 = [58, 168, 255] // --c-photophore-2
const DIM = 0.2 // alpha of unreached words
const TAIL = 3.6 // words of glowing wake behind the reading head
const SVGNS = 'http://www.w3.org/2000/svg'

/* Wrap every word in a span, keeping inline elements (numbers, the last
   line) intact. Spaces stay real text nodes so the line breaks are native. */
function splitWords(p) {
  const words = []
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = child.textContent.split(/(\s+)/)
        const frag = document.createDocumentFragment()
        for (const part of parts) {
          if (!part) continue
          if (/^\s+$/.test(part)) {
            frag.appendChild(document.createTextNode(' '))
          } else {
            const s = document.createElement('span')
            s.className = 'manifesto__w'
            s.textContent = part
            frag.appendChild(s)
            words.push(s)
          }
        }
        child.replaceWith(frag)
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.classList.contains('manifesto__num')) {
          child.classList.add('manifesto__w')
          words.push(child)
        } else {
          walk(child)
        }
      }
    }
  }
  walk(p)
  return words
}

function buildTape(tape) {
  const svg = document.createElementNS(SVGNS, 'svg')
  svg.setAttribute('class', 'manifesto__ticks')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const marks = []
  let html = ''
  for (let d = 0; d <= 200; d++) {
    const kind = d % 25 === 0 ? 'major' : d % 5 === 0 ? 'mid' : 'minor'
    const len = kind === 'major' ? 16 : kind === 'mid' ? 9 : 4.5
    const y = `${(d / 200) * 100}%`
    html += `<line class="is-${kind}" x1="0" x2="${len}" y1="${y}" y2="${y}"/>`
  }
  svg.innerHTML = html
  tape.appendChild(svg)
  for (let d = 0; d <= 200; d += 25) {
    const m = document.createElement('span')
    m.className = 'manifesto__mark'
    m.style.top = `${(d / 200) * 100}%`
    m.textContent = `${d} m`
    tape.appendChild(m)
    marks.push({ d, el: m })
  }
  return marks
}

export function init(ctx) {
  const root = document.getElementById('descent')
  if (!root) return
  const { gsap, ScrollTrigger } = ctx

  const stage = root.querySelector('.manifesto__stage')
  const inner = root.querySelector('.manifesto__inner')
  const text = root.querySelector('[data-manifesto-text]')
  const note = root.querySelector('.manifesto__note')
  const tape = root.querySelector('.manifesto__tape')
  const canvas = root.querySelector('.manifesto__sparks')

  // Reduced motion: the passage as plain, fully lit text. No sticky, no scrub.
  if (ctx.reducedMotion || !text || !stage) {
    root.classList.add('is-static')
    return
  }

  const words = splitWords(text)
  root.classList.add('is-split')
  const N = words.length
  const marks = tape ? buildTape(tape) : []

  /* ------------------------------------------------------------ words */
  const cache = new Float32Array(N * 2).fill(-1)
  const lit = { head: -1 }
  let prevHead = -1

  function paintWords() {
    const h = lit.head
    for (let i = 0; i < N; i++) {
      const d = h - i
      let l = 0
      let f = 0
      if (d > -1 && d < 0) {
        f = 0.14 * (1 + d) * (1 + d) // a faint stir just ahead of the head
      } else if (d >= 0) {
        l = clamp(d / 0.55)
        f = d < 0.28 ? 0.14 + 0.86 * (d / 0.28) : clamp(1 - (d - 0.28) / TAIL) ** 1.7
      }
      // quantise so idle frames write nothing
      l = Math.round(l * 100) / 100
      f = Math.round(f * 100) / 100
      if (cache[i * 2] === l && cache[i * 2 + 1] === f) continue
      cache[i * 2] = l
      cache[i * 2 + 1] = f

      const s = words[i].style
      const a = DIM + (1 - DIM) * l
      const k = f * 0.92
      const r = Math.round(INK[0] + (GLOW[0] - INK[0]) * k)
      const g = Math.round(INK[1] + (GLOW[1] - INK[1]) * k)
      const b = Math.round(INK[2] + (GLOW[2] - INK[2]) * k)
      s.color = `rgb(${r} ${g} ${b} / ${(a + (1 - a) * f).toFixed(3)})`
      // light, not shadow: a hot core, a blue-green halo, a wide blue bloom
      s.textShadow =
        f > 0.02
          ? `0 0 0.05em rgb(214 255 250 / ${(0.9 * f).toFixed(3)}),` +
            ` 0 0 ${(0.14 + 0.2 * f).toFixed(3)}em rgb(${GLOW.join(' ')} / ${(0.95 * f).toFixed(3)}),` +
            ` 0 0 ${(0.55 + 0.6 * f).toFixed(3)}em rgb(${GLOW2.join(' ')} / ${(0.6 * f).toFixed(3)})`
          : 'none'
    }

    // sparks for each word the head has just reached (forward only)
    if (h > prevHead) {
      const from = Math.max(0, Math.floor(prevHead) + 1)
      const to = Math.min(N - 1, Math.floor(h))
      let n = 0
      for (let i = from; i <= to && n < 5; i++, n++) sparkWord(words[i], to - from > 3 ? 2 : 6)
    }
    prevHead = h
  }

  /* ------------------------------------------------------------ sparks */
  const c2d = canvas?.getContext('2d')
  const particles = []
  let cw = 0
  let ch = 0
  let cdpr = 1
  let running = false
  let onScreen = false

  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = 64
  {
    const g = sprite.getContext('2d')
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grd.addColorStop(0, 'rgba(240,255,252,1)')
    grd.addColorStop(0.12, 'rgba(160,255,240,0.95)')
    grd.addColorStop(0.32, 'rgba(108,248,232,0.38)')
    grd.addColorStop(0.62, 'rgba(58,168,255,0.1)')
    grd.addColorStop(1, 'rgba(58,168,255,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 64, 64)
  }
  const bloom = document.createElement('canvas')
  bloom.width = bloom.height = 64
  {
    const g = bloom.getContext('2d')
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grd.addColorStop(0, 'rgba(108,248,232,0.9)')
    grd.addColorStop(0.45, 'rgba(70,200,240,0.35)')
    grd.addColorStop(1, 'rgba(58,168,255,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 64, 64)
  }

  function sizeCanvas() {
    if (!canvas) return
    cdpr = Math.min(ctx.dpr, ctx.isMobile() ? 1.25 : 1.5)
    cw = stage.clientWidth
    ch = stage.clientHeight
    canvas.width = Math.round(cw * cdpr)
    canvas.height = Math.round(ch * cdpr)
  }

  function sparkWord(el, count) {
    if (!c2d || !onScreen || document.hidden || particles.length > 260) return
    const sr = stage.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    // one soft bloom behind the word: the disturbed water lighting up
    particles.push({
      x: r.left - sr.left + r.width / 2,
      y: r.top - sr.top + r.height * 0.55,
      vx: 0,
      vy: -3,
      age: 0,
      life: 1.5 + Math.random() * 0.6,
      size: Math.max(r.width, r.height) * 0.62,
      tw: 0,
      bloom: true,
    })
    for (let k = 0; k < count; k++) {
      particles.push({
        x: r.left - sr.left + Math.random() * r.width,
        y: r.top - sr.top + r.height * (0.2 + Math.random() * 0.7),
        vx: (Math.random() - 0.5) * 22,
        vy: -6 - Math.random() * 22,
        age: 0,
        life: 1.1 + Math.random() * 1.7,
        size: 5 + Math.random() * 11,
        tw: Math.random() * 6.28,
      })
    }
    if (!running) {
      running = true
      gsap.ticker.add(tickSparks)
    }
  }

  function tickSparks(time, deltaMs) {
    const dt = Math.min(0.05, deltaMs / 1000)
    c2d.setTransform(1, 0, 0, 1, 0, 0)
    c2d.clearRect(0, 0, canvas.width, canvas.height)
    c2d.setTransform(cdpr, 0, 0, cdpr, 0, 0)
    c2d.globalCompositeOperation = 'lighter'
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]
      p.age += dt
      const t = p.age / p.life
      if (t >= 1) {
        particles.splice(i, 1)
        continue
      }
      p.vx *= 1 - 1.4 * dt
      p.vy *= 1 - 0.9 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      const env = t < 0.1 ? t / 0.1 : (1 - (t - 0.1) / 0.9) ** 1.6
      if (p.bloom) {
        c2d.globalAlpha = clamp(env * 0.3)
        const s = p.size * (0.85 + 0.35 * t)
        c2d.drawImage(bloom, p.x - s * 1.5, p.y - s, s * 3, s * 2)
        continue
      }
      const tw = 0.7 + 0.3 * Math.sin(p.tw + time * 9)
      c2d.globalAlpha = clamp(env * tw)
      const s = p.size * (0.7 + 0.3 * env)
      c2d.drawImage(sprite, p.x - s, p.y - s, s * 2, s * 2)
    }
    c2d.globalAlpha = 1
    if (!particles.length) {
      c2d.setTransform(1, 0, 0, 1, 0, 0)
      c2d.clearRect(0, 0, canvas.width, canvas.height)
      gsap.ticker.remove(tickSparks)
      running = false
    }
  }

  /* ------------------------------------------------------------ gauge */
  let H = 0
  let SH = 0
  function measure() {
    H = root.offsetHeight
    SH = stage.offsetHeight
    if (tape) tape.style.height = `${H}px`
    sizeCanvas()
  }
  measure()

  let nearMark = null
  function paintGauge(p) {
    if (!tape) return
    const T = -p * (H - SH)
    tape.style.transform = `translate3d(0, ${T.toFixed(2)}px, 0)`
    // the tick under the index
    const dIdx = ((SH / 2 - T) / H) * 200
    let near = null
    for (const m of marks) if (Math.abs(m.d - dIdx) < 5) near = m
    if (near !== nearMark) {
      nearMark?.el.classList.remove('is-near')
      near?.el.classList.add('is-near')
      nearMark = near
    }
  }

  /* ------------------------------------------------------------ triggers */
  // The stuck range of the sticky stage → the gauge (exact, unsmoothed)
  // and a slow upward drift of the passage, as if we were sinking past it.
  const stuck = ScrollTrigger.create({
    trigger: root,
    start: 'top top',
    end: () => `bottom top+=${SH}`,
    onUpdate: (self) => paintGauge(self.progress),
    onRefresh: (self) => paintGauge(self.progress),
  })
  paintGauge(stuck.progress)

  gsap.fromTo(
    inner,
    { y: () => window.innerHeight * 0.05 },
    {
      y: () => -window.innerHeight * 0.05,
      ease: 'none',
      scrollTrigger: {
        trigger: root,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
        invalidateOnRefresh: true,
      },
    },
  )

  // The reading: from just before the stage settles to ~85% through it,
  // so the fully lit passage holds for a moment before it leaves.
  gsap.to(lit, {
    head: N + TAIL + 0.4,
    ease: 'none',
    onUpdate: paintWords,
    scrollTrigger: {
      trigger: root,
      start: 'top 32%',
      end: () => `+=${Math.round(window.innerHeight * 0.32 + (H - SH) * 0.84)}`,
      scrub: 0.65,
      invalidateOnRefresh: true,
    },
  })
  paintWords()

  // the note about the plankton comes up once the passage is lit
  if (note) {
    gsap.fromTo(
      note,
      { opacity: 0 },
      {
        opacity: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: root,
          start: () => `top+=${Math.round((H - SH) * 0.7)} top`,
          end: () => `top+=${Math.round((H - SH) * 0.92)} top`,
          scrub: 0.6,
          invalidateOnRefresh: true,
        },
      },
    )
  }

  // only spend frames on sparks while the section is on screen
  ScrollTrigger.create({
    trigger: root,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      onScreen = self.isActive
      if (!onScreen) particles.length = 0
    },
  })

  ScrollTrigger.addEventListener('refreshInit', measure)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) particles.length = 0
  })
}
