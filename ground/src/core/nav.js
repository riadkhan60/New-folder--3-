/**
 * nav.js — the fixed bar, its tone, its comings and goings, and the phone
 * menu (a swatch book).
 *
 * Tone: the bar takes the ink of the current field. It uses data-tone, an
 * exact copy of the palette's [data-field] tokens (injected here), because
 * palette.js measures every top-level [data-field] element as a section, and
 * a fixed bar measured mid-page would hijack the field.
 *
 * Order: a quiet count of the visitor's order sits in "Order pigments" (bar
 * and phone menu) and, on phones, in a short "Order" link that appears
 * beside "Menu" once the order has something — from the shop's
 * 'order-change' { count }. It rolls like a printed counter when it changes,
 * and an addition brings a hidden bar back so the count is seen. The shop
 * announces changes itself, so the count only names the links ("Order
 * pigments, 2 items in your order"); the figures themselves are aria-hidden.
 *
 * Bus: emits 'nav:menu' { open } when the phone menu opens or closes (the
 * cursor listens, to take the menu's paper ink). Listens to 'order-change'.
 */
import '../styles/nav.css'

const LINK_SECTIONS = ['library', 'grind', 'mix', 'shop']

const rgba = (h, a) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  return `rgb(${r} ${g} ${b} / ${a})`
}

/** [data-tone="id"] → the same field tokens palette.js writes for [data-field]. */
export function ensureTones(pigments) {
  if (!pigments || document.querySelector('style[data-ground="tones"]')) return
  const rule = (p) =>
    `[data-tone="${p.id}"]{--field:${p.hex};--tint:${p.tint};--ink:${p.ink};` +
    `--ink-2:${rgba(p.ink, 0.84)};--ink-3:${rgba(p.ink, 0.68)};--line:${rgba(p.ink, 0.24)};}`
  const el = document.createElement('style')
  el.dataset.ground = 'tones'
  el.textContent = [pigments.PAPER, ...pigments.PIGMENTS].map(rule).join('\n')
  document.head.appendChild(el)
}

export function init(ctx) {
  const root = document.querySelector('.nav')
  if (!root) return
  const { gsap } = ctx
  ensureTones(ctx.pigments)

  const html = document.documentElement
  const links = [...root.querySelectorAll('.nav__link')]
  const list = root.querySelector('.nav__list')
  const drop = root.querySelector('.nav__drop')
  const mark = root.querySelector('.nav__mark')
  const toggle = root.querySelector('.nav__toggle')
  const toggleLabel = root.querySelector('.nav__toggle-label')
  const menu = root.querySelector('#nav-menu')
  const swatches = menu ? [...menu.querySelectorAll('.swatch')] : []
  const chips = menu ? [...menu.querySelectorAll('.swatch__chip')] : []
  const foot = menu?.querySelector('.nav__menu-foot')
  const chapters = ctx.pigments?.CHAPTERS ?? []
  const desktop = window.matchMedia('(min-width: 900px)')

  // paint the chips, and name them, from the pigment data
  for (const s of swatches) {
    const p = ctx.pigments?.BY_ID?.[s.dataset.pigment]
    if (!p) continue
    s.style.setProperty('--c', p.hex)
    s.style.setProperty('--t', p.tint)
    const name = s.querySelector('.swatch__pigment')
    if (name) name.textContent = p.name
  }

  /* --------------------------------------------------------------- tone */
  let tone = 'paper'
  let open = false
  let active = null
  let dropOn = false
  const setTone = (t) => {
    if (root.dataset.tone !== t) root.dataset.tone = t
  }
  const linkFor = (id) => (chapters.includes(id) ? 'colours' : LINK_SECTIONS.includes(id) ? id : null)

  /* ------------------------------------------ the drop under the current link */
  // measured from boxes, not offsetLeft: during the entrance each <li> is
  // transformed, which would make it the link's offsetParent
  const linksBox = root.querySelector('.nav__links')
  function dropX(link) {
    const r = link.getBoundingClientRect()
    return r.left + r.width / 2 - (linksBox?.getBoundingClientRect().left ?? 0)
  }
  function markActive(animate) {
    for (const l of links) {
      if (l.dataset.nav === active) l.setAttribute('aria-current', 'true')
      else l.removeAttribute('aria-current')
    }
    if (!drop) return
    const link = links.find((l) => l.dataset.nav === active)
    const still = !animate || ctx.reducedMotion || !desktop.matches
    gsap.killTweensOf(drop)
    if (!link) {
      dropOn = false
      if (still) gsap.set(drop, { scaleX: 0, scaleY: 0 })
      else gsap.to(drop, { scaleX: 0, scaleY: 0, duration: 0.5, ease: 'power2.out' })
      return
    }
    const x = dropX(link)
    if (still) {
      gsap.set(drop, { x, y: 0, scaleX: 1, scaleY: 1 })
    } else if (!dropOn) {
      gsap.set(drop, { x, y: -6 })
      gsap.to(drop, { y: 0, scaleX: 1, scaleY: 1, duration: 0.8, ease: 'expo.out' })
    } else {
      // a drop of ink sliding along: it stretches as it travels, then rounds up
      gsap.to(drop, { x, y: 0, duration: 0.85, ease: 'expo.inOut' })
      gsap
        .timeline()
        .to(drop, { scaleX: 2.6, scaleY: 0.7, duration: 0.36, ease: 'power2.in' })
        .to(drop, { scaleX: 1, scaleY: 1, duration: 0.6, ease: 'expo.out' })
    }
    dropOn = true
  }
  const replace = () => markActive(false)

  // subscribe only now: onChange calls back at once, and on a deep link the
  // first call already has a section to mark
  ctx.palette?.onChange((st) => {
    tone = st.field || 'paper'
    if (!open) setTone(tone)
    const a = linkFor(st.section)
    if (a !== active) {
      active = a
      markActive(true)
    }
  })
  document.fonts?.ready.then(replace)
  ctx.ready?.then(replace)
  if (list && 'ResizeObserver' in window) new ResizeObserver(replace).observe(list)

  /* ------------------------------------------------- hide down, show up */
  let lastY = window.scrollY
  let acc = 0
  let hidden = false
  let scrolled = null
  let nearTop = false
  const setHidden = (h) => {
    if (h === hidden) return
    hidden = h
    root.classList.toggle('is-hidden', h)
  }
  // Only the visitor's own scrolling hides the bar. Jumps (deep links,
  // history) and layout refreshes nudge the scroll too, and must not.
  let inputAt = -1e9
  const SCROLL_KEYS = new Set(['ArrowDown', 'PageDown', 'End', ' ', 'Spacebar'])
  const input = () => (inputAt = performance.now())
  window.addEventListener('wheel', input, { passive: true })
  window.addEventListener('touchmove', input, { passive: true })
  window.addEventListener('keydown', (e) => SCROLL_KEYS.has(e.key) && input(), { passive: true })
  function onScroll() {
    const y = window.scrollY
    const dy = y - lastY
    lastY = y
    const s = y > 24
    if (s !== scrolled) {
      scrolled = s
      root.classList.toggle('is-scrolled', s)
    }
    if (open || !html.classList.contains('is-ready')) return
    if (dy && Math.sign(dy) !== Math.sign(acc)) acc = 0
    acc += dy
    const user = performance.now() - inputAt < 900
    if (y < 160 || nearTop || acc < -10 || Math.abs(dy) > window.innerHeight) setHidden(false)
    else if (acc > 14 && user) setHidden(true)
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
  // a pointer at the top edge always brings the bar back
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return
      const n = e.clientY < 84
      if (n === nearTop) return
      nearTop = n
      if (n) setHidden(false)
    },
    { passive: true },
  )
  root.addEventListener('focusin', () => setHidden(false))

  /* ------------------------------------------------------ the order count */
  const counts = [...root.querySelectorAll('.nav__count')]
  let count = 0
  function rollTo(box, n, dir) {
    const roll = box.querySelector('.nav__count-roll')
    const cur = roll?.querySelector('.nav__count-n:not(.is-leaving)')
    if (!roll || !cur) return
    if (!dir || ctx.reducedMotion) {
      roll.querySelectorAll('.is-leaving').forEach((e) => e.remove())
      cur.textContent = n
      return
    }
    // a printed counter: the old figure rolls away, the new one rolls in
    const next = cur.cloneNode(false)
    next.textContent = n
    roll.appendChild(next)
    cur.classList.add('is-leaving')
    gsap.fromTo(next, { yPercent: 110 * dir }, { yPercent: 0, duration: 0.75, ease: 'expo.out' })
    gsap.to(cur, { yPercent: -110 * dir, duration: 0.6, ease: 'expo.out', onComplete: () => cur.remove() })
  }
  function setCount(n) {
    n = Math.max(0, Math.round(+n || 0))
    if (n === count) return
    const was = count
    count = n
    for (const box of counts) {
      const link = box.closest('a')
      if (link) {
        const word = link.firstElementChild?.textContent.trim() || 'Order'
        if (n) link.setAttribute('aria-label', `${word}, ${n} ${n === 1 ? 'item' : 'items'} in your order`)
        else link.removeAttribute('aria-label')
      }
      gsap.killTweensOf(box)
      if (!n) {
        box.hidden = true
        gsap.set(box, { clearProps: 'all' })
        rollTo(box, 0, 0)
        continue
      }
      if (!was) {
        rollTo(box, n, 0)
        box.hidden = false
        if (!ctx.reducedMotion && box.offsetParent !== null) {
          // the count opens up beside the word, in place of the gap
          const gap = parseFloat(getComputedStyle(box.parentElement).columnGap) || 0
          gsap.fromTo(
            box,
            { width: 0, marginLeft: -gap, opacity: 0 },
            { width: 'auto', marginLeft: 0, opacity: 1, duration: 0.9, ease: 'expo.out', clearProps: 'all' },
          )
        }
      } else rollTo(box, n, n > was ? 1 : -1)
    }
    const phone = root.querySelector('.nav__order')
    root.classList.toggle('has-order', n > 0)
    if (!was && phone && !ctx.reducedMotion && phone.offsetParent !== null) {
      gsap.fromTo(phone, { opacity: 0, x: 10 }, { opacity: 1, x: 0, duration: 0.9, ease: 'expo.out', clearProps: 'all' })
    }
    // something went into the order: bring the bar back so the count is seen
    if (n > was && html.classList.contains('is-ready')) setHidden(false)
  }
  ctx.on('order-change', (d) => setCount(d?.count))

  /* ---------------------------------------------- the swatch-book menu */
  if (!toggle || !menu) return
  let menuTl = null
  const focusables = () =>
    [mark, toggle, ...menu.querySelectorAll('a[href], button:not([disabled])')].filter(
      (el) => el && el.offsetParent !== null,
    )

  function origin() {
    const r = toggle.getBoundingClientRect()
    const ox = r.left + r.width / 2
    const oy = r.top + r.height / 2
    const R = Math.hypot(Math.max(ox, window.innerWidth - ox), Math.max(oy, window.innerHeight - oy)) + 20
    return { ox, oy, R }
  }

  function openMenu() {
    if (open) return
    open = true
    menuTl?.kill()
    root.classList.add('is-open')
    setTone('paper')
    setHidden(false)
    toggle.setAttribute('aria-expanded', 'true')
    if (toggleLabel) toggleLabel.textContent = 'Close'
    menu.hidden = false
    menu.classList.remove('is-closing')
    menu.scrollTop = 0
    ctx.lenis?.stop()
    html.classList.add('nav-open')
    ctx.emit('nav:menu', { open: true })

    if (ctx.reducedMotion) {
      gsap.set(menu, { clipPath: 'none' })
      gsap.set([...swatches, ...chips, foot], { clearProps: 'all' })
    } else {
      // paper spreads out from the button like a drop opening in water,
      // then the swatch book fans open page by page
      const { ox, oy, R } = origin()
      menuTl = gsap
        .timeline()
        .fromTo(
          menu,
          { clipPath: `circle(0px at ${ox}px ${oy}px)` },
          { clipPath: `circle(${R}px at ${ox}px ${oy}px)`, duration: 0.95, ease: 'pour' },
          0,
        )
        .fromTo(
          swatches,
          { opacity: 0, y: 30, rotation: -5 },
          { opacity: 1, y: 0, rotation: 0, duration: 1.1, ease: 'expo.out', stagger: 0.06 },
          0.16,
        )
        .fromTo(
          chips,
          { clipPath: 'inset(0% 100% 0% 0%)' },
          { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.9, ease: 'power3.out', stagger: 0.06 },
          0.3,
        )
        .fromTo(foot, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out' }, 0.46)
    }
    const first = menu.querySelector('a[href]')
    requestAnimationFrame(() => first?.focus({ preventScroll: true }))
  }

  function closeMenu(returnFocus = true) {
    if (!open) return
    open = false
    menuTl?.kill()
    root.classList.remove('is-open')
    setTone(tone)
    toggle.setAttribute('aria-expanded', 'false')
    if (toggleLabel) toggleLabel.textContent = 'Menu'
    ctx.lenis?.start()
    html.classList.remove('nav-open')
    ctx.emit('nav:menu', { open: false })
    const done = () => {
      if (open) return
      menu.hidden = true
      menu.classList.remove('is-closing')
      gsap.set(menu, { clearProps: 'clipPath' })
    }
    if (ctx.reducedMotion || menu.hidden) done()
    else {
      menu.classList.add('is-closing')
      const { ox, oy, R } = origin()
      menuTl = gsap
        .timeline({ onComplete: done })
        .fromTo(
          menu,
          { clipPath: `circle(${R}px at ${ox}px ${oy}px)` },
          { clipPath: `circle(0px at ${ox}px ${oy}px)`, duration: 0.7, ease: 'power3.inOut' },
        )
    }
    if (returnFocus) toggle.focus({ preventScroll: true })
  }

  toggle.addEventListener('click', () => (open ? closeMenu(true) : openMenu()))
  // a link in the menu: close first (and restart Lenis) so main.js can scroll
  menu.addEventListener('click', (e) => {
    if (e.target.closest?.('a[href]')) closeMenu(false)
  })
  mark?.addEventListener('click', () => closeMenu(false))

  document.addEventListener('keydown', (e) => {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu(true)
      return
    }
    if (e.key !== 'Tab') return
    const f = focusables()
    if (!f.length) return
    const i = f.indexOf(document.activeElement)
    if (e.shiftKey && i <= 0) {
      e.preventDefault()
      f[f.length - 1].focus()
    } else if (!e.shiftKey && (i === -1 || i === f.length - 1)) {
      e.preventDefault()
      f[0].focus()
    }
  })
  desktop.addEventListener?.('change', (e) => {
    if (e.matches) closeMenu(false)
    replace()
  })
}
