/**
 * finish.js — four finishing samples that turn in the light.
 *
 * Each sample reads --mx / --my (0 … 1): where the light is. A mouse sets
 * it; with no mouse (or none nearby) the light drifts slowly on its own.
 * Also gives the footer wordmark the same sheen.
 */
const lerp = (a, b, t) => a + (b - a) * t

export function initFinish(ctx) {
  const { reduced } = ctx
  const section = document.querySelector('.finish')
  if (!section) return

  /* perlage: rows of overlapping circles, each laid over the one before */
  const perlage = section.querySelector('[data-perlage]')
  if (perlage) {
    const step = 13.4
    let html = ''
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        html += `<i style="left:${(col * step - (row % 2) * step * 0.5 - 6).toFixed(1)}%;top:${(row * step * 0.9 - 6).toFixed(1)}%"></i>`
      }
    }
    perlage.innerHTML = html
  }

  const bevel = section.querySelector('[data-bevel]')
  const samples = [...section.querySelectorAll('[data-sample]')].map((li, i) => ({
    view: li.querySelector('.sample__view'),
    x: 0.5,
    y: 0.5,
    tx: 0.5,
    ty: 0.5,
    hover: false,
    phase: i * 1.7,
    key: '',
  }))

  samples.forEach((s) => {
    const move = (e) => {
      const r = s.view.getBoundingClientRect()
      s.tx = (e.clientX - r.left) / r.width
      s.ty = (e.clientY - r.top) / r.height
      s.hover = true
    }
    s.view.addEventListener('pointermove', move, { passive: true })
    s.view.addEventListener('pointerdown', move, { passive: true })
    s.view.addEventListener('pointerleave', () => (s.hover = false))
  })

  let visible = false
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: '10%' }).observe(section)
  } else {
    visible = true
  }

  const foot = document.querySelector('.foot__mark')
  let shine = 0
  let shineTo = 0
  if (foot) {
    window.addEventListener('pointermove', (e) => (shineTo = (e.clientX / innerWidth) * 2 - 1), { passive: true })
  }

  ctx.frames.add((now) => {
    if (foot) {
      if (!reduced && Math.abs(shineTo - shine) < 0.002) shineTo = Math.sin(now / 2600) * 0.9
      shine = lerp(shine, shineTo, 0.05)
      foot.style.setProperty('--shine', shine.toFixed(3))
    }
    if (!visible) return
    const t = now / 1000
    for (const s of samples) {
      if (!s.hover && !reduced) {
        s.tx = 0.5 + Math.sin(t * 0.5 + s.phase) * 0.42
        s.ty = 0.5 + Math.cos(t * 0.37 + s.phase) * 0.3
      }
      s.x = lerp(s.x, s.tx, 0.08)
      s.y = lerp(s.y, s.ty, 0.08)
      const key = s.x.toFixed(3) + s.y.toFixed(3)
      if (key === s.key) continue
      s.key = key
      s.view.style.setProperty('--mx', s.x.toFixed(3))
      s.view.style.setProperty('--my', s.y.toFixed(3))
      if (bevel && s.view.contains(bevel.ownerSVGElement)) {
        // slide the bright band along the polished bevel
        const d = (s.x - 0.5) * 150 + (s.y - 0.5) * 60
        bevel.setAttribute('gradientTransform', `translate(${d.toFixed(1)} ${d.toFixed(1)})`)
      }
    }
  })
}
