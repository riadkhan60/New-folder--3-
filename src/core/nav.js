/**
 * core/nav — fixed top bar.
 *
 * - Anchor links: main.js scrolls (pin-aware), keeps history and moves
 *   keyboard focus; the nav closes its menu and parks focus on the target.
 *   The active section is lit as the dive passes it.
 * - Hides on the way down, returns on the way up (or when the pointer nears
 *   the top edge, or focus enters it). Only the visitor's own scrolling
 *   brings it back: a scripted scroll upwards (a form error, a hand-off)
 *   leaves it away so it never lands on what was scrolled to. Announces
 *   ctx.emit('nav', { hidden, open }) — the HUD docks in its place.
 * - Sound toggle: emits ctx.emit('sound', { on }). The preference is stored by
 *   core/audio under SOUND_KEY; the button follows audio's 'sound:state', so
 *   it only reads "on" while sound is really playing.
 * - ≤ 1099 px: a menu button opens a full-screen menu whose links are set at
 *   the pressure of their own depth. Focus-trapped, Esc closes, Lenis paused.
 * - Listens for `intro:landed` (from core/loader) to reveal its wordmark.
 * - "Reserve a dive" is a capsule of lit glass: a lamp rests low inside it;
 *   on a fine pointer the light gathers under the pointer and the bar's
 *   button leans a few pixels towards it. The menu is a depth chart: each
 *   row is tinted with the water of its own depth.
 */
import '../styles/nav.css'

export const SOUND_KEY = 'noctiluca:sound'

export function init(ctx) {
  const nav = document.querySelector('.nav')
  if (!nav) return
  const { gsap } = ctx
  const html = document.documentElement
  const bar = nav.querySelector('.nav__bar')
  const list = nav.querySelector('.nav__list')
  const links = [...nav.querySelectorAll('.nav__link')]
  const indicator = nav.querySelector('.nav__indicator')
  const soundBtn = nav.querySelector('.nav__sound')
  const soundState = nav.querySelector('.nav__sound-state')
  const menuBtn = nav.querySelector('.nav__menu-btn')
  const menuLabel = nav.querySelector('.nav__menu-label')
  const menu = nav.querySelector('.nav__menu')
  const menuLinks = [...nav.querySelectorAll('.nav__menu-link')]
  const reduced = ctx.reducedMotion
  let menuOpen = false
  let menuTl = null

  /* -------------------------------------------- character roll labels */
  nav.querySelectorAll('[data-roll]').forEach((el) => {
    const text = el.textContent.trim()
    const chars = [...text]
      .map((c, i) => {
        const ch = c === ' ' ? ' ' : c
        return `<span class="nav__ch" style="--i:${i}"><span>${ch}</span><span>${ch}</span></span>`
      })
      .join('')
    el.innerHTML = `<span class="visually-hidden">${text}</span><span class="nav__roll" aria-hidden="true">${chars}</span>`
  })

  /* --------------------------------- pressure: menu links set at depth */
  menuLinks.forEach((a) => {
    const d = parseFloat(a.dataset.depth) || 0
    const c = ctx.depth.compression(d)
    a.style.setProperty('--wdth', c.wdth)
    a.style.setProperty('--wght', c.wght)
    // a bathymetric chart: each row tinted with the water at its depth
    const water = ctx.depth.colorAt?.(d)
    if (water) a.parentElement.style.setProperty('--row-water', water.css)
  })

  /* ------------------------------------------------------- anchors */
  // main.js scrolls to every in-page anchor (pin-aware, with history and
  // keyboard focus). The nav only has to get its menu out of the way first:
  // this runs before main's handler, which sits on the document.
  nav.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]')
    if (!a || !menuOpen) return
    const id = a.getAttribute('href')
    let target = null
    try {
      target = id.length > 1 ? document.querySelector(id) : null
    } catch {}
    closeMenu({ restoreFocus: false })
    // the link just vanished with the menu: park focus on the section the
    // visitor chose, so it never falls to <body> while the water scrolls
    const focusEl = target && (target.matches('h1, h2') ? target : target.querySelector('h1, h2') || target)
    if (focusEl) {
      if (!focusEl.hasAttribute('tabindex')) focusEl.setAttribute('tabindex', '-1')
      focusEl.focus({ preventScroll: true })
    }
  })

  /* ------------------------------------------------- active section */
  const ids = new Set(links.map((l) => l.dataset.section))
  let active = null
  function setActive(id) {
    const next = ids.has(id) ? id : null
    if (next === active) return
    active = next
    for (const l of links) {
      if (l.dataset.section === active) l.setAttribute('aria-current', 'location')
      else l.removeAttribute('aria-current')
    }
    for (const a of menuLinks) {
      if (a.getAttribute('href') === `#${active}`) a.setAttribute('aria-current', 'location')
      else a.removeAttribute('aria-current')
    }
    // measured in a task after the frame (this runs mid-frame, from the
    // depth listener, where reading offsets would force a recalculation)
    clearTimeout(indT)
    indT = setTimeout(() => placeIndicator(), 0)
  }
  let indT = 0
  const tail = indicator.querySelector('.nav__indicator-tail')
  function placeIndicator(immediate = false) {
    const link = links.find((l) => l.dataset.section === active)
    if (!link || !list.offsetParent) {
      gsap.to(indicator, { opacity: 0, duration: 0.4, overwrite: 'auto' })
      return
    }
    const x = link.offsetLeft + link.offsetWidth / 2
    // the photophore swims to its new link and leaves a short wake of light
    const dx = x - (gsap.getProperty(indicator, 'x') || 0)
    if (tail && !immediate && !reduced && Math.abs(dx) > 8 && gsap.getProperty(indicator, 'opacity') > 0.5) {
      tail.dataset.side = dx > 0 ? 'left' : 'right'
      gsap.killTweensOf(tail)
      gsap
        .timeline()
        .set(tail, { width: Math.min(150, Math.abs(dx) * 0.62), scaleX: 0, opacity: 1 })
        .to(tail, { scaleX: 1, duration: 0.18, ease: 'power2.out' })
        .to(tail, { scaleX: 0, opacity: 0.3, duration: 1.05, ease: 'expo.out' })
    }
    const vars = { x, opacity: 1, duration: immediate || reduced ? 0 : 0.9, ease: 'expo.out', overwrite: 'auto' }
    gsap.to(indicator, vars)
  }
  ctx.depth.onChange((s) => setActive(s.section))
  window.addEventListener('resize', () => placeIndicator(true))
  document.fonts?.ready.then(() => placeIndicator(true))

  /* ------------------------------------- hide on down, show on up */
  let hidden = false
  const announce = () => ctx.emit('nav', { hidden, open: menuOpen })
  const setHidden = (v) => {
    if (v === hidden) return
    hidden = v
    nav.classList.toggle('is-hidden', v)
    announce()
  }
  // keyboard focus inside the bar keeps it out (tracked on focus changes,
  // so scrolling never has to ask the style engine). A link that merely
  // kept focus from a click doesn't pin the bar open.
  let focusInside = false
  const isKeyFocus = (el) => {
    try {
      return !!el?.matches(':focus-visible')
    } catch {
      return true
    }
  }
  // (focusin, which follows focusout when focus moves within the bar, sets it again)
  nav.addEventListener('focusin', (e) => (focusInside = isKeyFocus(e.target)))
  nav.addEventListener('focusout', () => (focusInside = false))

  // Is the visitor scrolling, or a script? A scroll session starts with a
  // wheel, a touch, a scroll key or a scrollbar drag and lasts while the
  // scroll events keep coming (Lenis' easing tail, touch momentum).
  let intentAt = -1e9
  let lastScrollAt = -1e9
  let userScroll = false
  const intent = () => (intentAt = performance.now())
  const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar'])
  const opts = { passive: true, capture: true }
  window.addEventListener('wheel', intent, opts)
  // a swipe, not a tap: a tap on a button that scrolls the page (a form's
  // error, a hand-off) is a script's scroll
  window.addEventListener('touchmove', intent, opts)
  window.addEventListener('keydown', (e) => {
    if (!SCROLL_KEYS.has(e.key)) return
    const t = e.target instanceof Element ? e.target : null
    if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
    // Space on a button or link presses it; it doesn't scroll
    if ((e.key === ' ' || e.key === 'Spacebar') && t?.closest('button, a[href], [role="button"]')) return
    intent()
  }, opts)
  // a press on the page's own scrollbar lands on <html>
  window.addEventListener('pointerdown', (e) => {
    if (e.target === html) intent()
  }, opts)

  let lastY = ctx.lenis ? ctx.lenis.scroll : window.scrollY
  let acc = 0
  let scrolled = null
  function onScroll(y) {
    const dy = y - lastY
    lastY = y
    const now = performance.now()
    if (now - intentAt < 260) userScroll = true
    else if (now - lastScrollAt > 180) userScroll = false
    lastScrollAt = now
    const isScrolled = y > 24
    if (isScrolled !== scrolled) {
      scrolled = isScrolled
      nav.classList.toggle('is-scrolled', isScrolled)
    }
    if (menuOpen || reduced) return
    if (y < 140) return setHidden(false)
    // a little hysteresis so tiny trackpad wobbles don't flicker the bar
    acc = Math.sign(dy) === Math.sign(acc) ? acc + dy : dy
    if (acc > 24 && !focusInside) setHidden(true)
    else if (acc < -36 && userScroll) setHidden(false)
  }
  // the scroll position comes from Lenis (no layout read mid-frame), or is
  // read once at the start of the native scroll event
  if (ctx.lenis) ctx.lenis.on('scroll', (l) => onScroll(l.scroll))
  else window.addEventListener('scroll', () => onScroll(window.scrollY), { passive: true })
  onScroll(lastY)

  if (!ctx.isTouch) {
    window.addEventListener(
      'pointermove',
      (e) => {
        if (hidden && e.clientY < 64) setHidden(false)
      },
      { passive: true },
    )
  }
  nav.addEventListener('focusin', () => setHidden(false))

  /* ------------------------------------------- the reserve lamps */
  // A light rests low inside the glass. On a fine pointer it gathers under
  // the pointer (eased, so it moves like light in water) and the bar's
  // button leans towards it; it settles back when the pointer leaves.
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
  const follow = fine && !reduced && !ctx.isTouch
  const clampN = (v, a, b) => Math.min(b, Math.max(a, v))
  nav.querySelectorAll('.nav__cta, .nav__menu-cta').forEach((btn) => {
    if (!follow) return
    const label = btn.querySelector('.nav__cta-label')
    const magnetic = btn.classList.contains('nav__cta')
    const L = { x: 50, y: 135 }
    const paint = () => {
      btn.style.setProperty('--lx', `${L.x.toFixed(1)}%`)
      btn.style.setProperty('--ly', `${L.y.toFixed(1)}%`)
    }
    const qx = gsap.quickTo(L, 'x', { duration: 0.6, ease: 'power3.out', onUpdate: paint })
    const qy = gsap.quickTo(L, 'y', { duration: 0.6, ease: 'power3.out', onUpdate: paint })
    const mx = magnetic ? gsap.quickTo(btn, 'x', { duration: 0.9, ease: 'expo.out' }) : null
    const my = magnetic ? gsap.quickTo(btn, 'y', { duration: 0.9, ease: 'expo.out' }) : null
    const lx = magnetic && label ? gsap.quickTo(label, 'x', { duration: 0.9, ease: 'expo.out' }) : null
    // the button's resting frame, measured on entry (it moves under the pointer)
    let box = null
    btn.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
      const r = btn.getBoundingClientRect()
      const tx = magnetic ? gsap.getProperty(btn, 'x') || 0 : 0
      const ty = magnetic ? gsap.getProperty(btn, 'y') || 0 : 0
      box = { left: r.left - tx, top: r.top - ty, width: r.width, height: r.height }
    })
    btn.addEventListener('pointermove', (e) => {
      if (!box) return
      const px = (e.clientX - box.left) / box.width
      const py = (e.clientY - box.top) / box.height
      qx(clampN(px, -0.1, 1.1) * 100)
      qy(clampN(py, -0.2, 1.2) * 100)
      if (magnetic) {
        const dx = (px - 0.5) * box.width
        const dy = (py - 0.5) * box.height
        mx(clampN(dx * 0.18, -7, 7))
        my(clampN(dy * 0.28, -4, 4))
        lx?.(clampN(dx * 0.06, -2.5, 2.5))
      }
    })
    btn.addEventListener('pointerleave', () => {
      box = null
      qx(50)
      qy(135)
      mx?.(0)
      my?.(0)
      lx?.(0)
    })
  })

  /* ------------------------------------------------------- sound */
  // The button shows what is actually playing. A remembered "on" stays
  // silent until the visitor's first gesture (core/audio), so the button
  // starts off and follows audio's `sound:state` once it really starts.
  // The accessible name stays "Sound"; aria-pressed carries the state.
  let soundOn = false
  const renderSound = () => {
    soundBtn.setAttribute('aria-pressed', String(soundOn))
    if (soundState) soundState.textContent = soundOn ? 'on' : 'off'
  }
  renderSound()
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn
    renderSound()
    ctx.emit('sound', { on: soundOn })
  })
  ctx.on('sound:state', (d) => {
    if (!!d?.on === soundOn) return
    soundOn = !!d?.on
    renderSound()
  })

  /* -------------------------------------------------------- menu */

  function focusables() {
    return [menuBtn, ...menu.querySelectorAll('a[href], button:not([disabled])')].filter(
      (el) => el.offsetParent !== null || el === menuBtn,
    )
  }
  function onMenuKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu()
      return
    }
    if (e.key !== 'Tab') return
    const f = focusables()
    const first = f[0]
    const last = f[f.length - 1]
    if (!f.includes(document.activeElement)) {
      e.preventDefault()
      first.focus()
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // While the menu is open everything behind it is inert, so neither Tab
  // nor a screen reader's virtual cursor can wander into the page.
  // (No aria-modal: the Close button lives in the bar, outside the panel.)
  let inerted = []
  function setBackgroundInert(v) {
    if (v) {
      const behind = [
        ...document.querySelectorAll('body > :not(header.nav, script, .cursor, .cursor__sparks)'),
        ...bar.querySelectorAll('.nav__brand, .nav__links, .nav__sound, .nav__cta'),
      ].filter((el) => !el.inert)
      behind.forEach((el) => (el.inert = true))
      inerted = behind
    } else {
      inerted.forEach((el) => (el.inert = false))
      inerted = []
    }
  }

  function openMenu() {
    if (menuOpen) return
    menuOpen = true
    setBackgroundInert(true)
    setHidden(false)
    announce()
    menu.hidden = false
    nav.classList.add('is-open')
    html.classList.add('nav-is-open')
    menuBtn.setAttribute('aria-expanded', 'true')
    menuLabel.textContent = 'Close'
    if (ctx.lenis) ctx.lenis.stop()
    else html.style.overflow = 'hidden'
    document.addEventListener('keydown', onMenuKey)

    menuTl?.kill()
    gsap.set(menu.querySelector('.nav__menu-inner'), { opacity: 1 })
    if (!reduced) {
      const names = menu.querySelectorAll('.nav__menu-name')
      const depths = menu.querySelectorAll('.nav__menu-depth')
      const rows = menu.querySelectorAll('.nav__menu-list li')
      menuTl = gsap
        .timeline({ defaults: { ease: 'expo.out' } })
        .fromTo(menu.querySelector('.nav__menu-water'), { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: 0.9, ease: 'expo.inOut' }, 0)
        .fromTo(menu.querySelector('.nav__menu-intro'), { opacity: 0 }, { opacity: 1, duration: 0.8 }, 0.35)
        // the chart's layer tints and contours come in from the top down
        .fromTo(rows, { '--rule': 0, '--tint': 0 }, { '--rule': 1, '--tint': 1, duration: 1.1, stagger: 0.06 }, 0.3)
        // the names arrive wide and light, and the pressure of their depth
        // squeezes them into shape
        .fromTo(
          names,
          { yPercent: 60, opacity: 0, fontStretch: '150%', fontWeight: 200 },
          {
            yPercent: 0,
            opacity: 1,
            fontStretch: (i, el) => `${getComputedStyle(el.parentElement).getPropertyValue('--wdth').trim()}%`,
            fontWeight: (i, el) => getComputedStyle(el.parentElement).getPropertyValue('--wght').trim(),
            duration: 1.3,
            stagger: 0.07,
            clearProps: 'fontStretch,fontWeight,transform,opacity',
          },
          0.3,
        )
        .fromTo(depths, { opacity: 0 }, { opacity: 1, duration: 0.8, stagger: 0.07 }, 0.55)
        .fromTo(menu.querySelector('.nav__menu-foot'), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 1 }, 0.7)
    }
    requestAnimationFrame(() => menuLinks[0]?.focus({ preventScroll: true }))
  }

  function closeMenu({ restoreFocus = true } = {}) {
    if (!menuOpen) return
    menuOpen = false
    announce()
    setBackgroundInert(false)
    nav.classList.remove('is-open')
    html.classList.remove('nav-is-open')
    menuBtn.setAttribute('aria-expanded', 'false')
    menuLabel.textContent = 'Menu'
    if (ctx.lenis) ctx.lenis.start()
    else html.style.overflow = ''
    document.removeEventListener('keydown', onMenuKey)
    if (restoreFocus) menuBtn.focus({ preventScroll: true })

    menuTl?.kill()
    if (reduced) {
      menu.hidden = true
      return
    }
    menuTl = gsap
      .timeline({ onComplete: () => (menu.hidden = true) })
      .to(menu.querySelector('.nav__menu-inner'), { opacity: 0, duration: 0.3, ease: 'power1.out' }, 0)
      .to(menu.querySelector('.nav__menu-water'), { clipPath: 'inset(0 0 100% 0)', duration: 0.6, ease: 'expo.inOut' }, 0.05)
      .set(menu.querySelector('.nav__menu-inner'), { opacity: 1 })
  }

  menuBtn.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()))
  window.addEventListener('resize', () => {
    if (menuOpen && window.innerWidth >= 1100) closeMenu({ restoreFocus: false })
  })

  /* -------------------------------------------------------- intro */
  if (!ctx.skipIntro) {
    nav.dataset.brand = 'waiting'
    const reveal = () => {
      if (nav.dataset.brand !== 'waiting') return
      delete nav.dataset.brand
    }
    ctx.on('intro:landed', reveal)
    // never leave the brand invisible if the loader can't fly it in
    ctx.ready.then(() => setTimeout(reveal, 2600))

    const items = [...bar.querySelectorAll('.nav__list li, .nav__actions > *')]
    gsap.set(items, { opacity: 0, y: -10 })
    ctx.ready.then(() => {
      gsap.to(items, {
        opacity: 1,
        y: 0,
        duration: 1.2,
        ease: 'expo.out',
        stagger: 0.06,
        delay: 0.35,
        clearProps: 'transform,opacity',
        onComplete: () => placeIndicator(true),
      })
    })
  }
}
