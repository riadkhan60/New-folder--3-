/**
 * core/nav — fixed top bar.
 *
 * - Anchor links scroll with ctx.scrollTo (Lenis) and light the active section.
 * - Hides on the way down, returns on the way up (or when the pointer nears
 *   the top edge, or focus enters it).
 * - Sound toggle: emits ctx.emit('sound', { on }). The preference is stored by
 *   core/audio under SOUND_KEY; the button follows audio's 'sound:state', so
 *   it only reads "on" while sound is really playing.
 * - ≤ 1099 px: a menu button opens a full-screen menu whose links are set at
 *   the pressure of their own depth. Focus-trapped, Esc closes, Lenis paused.
 * - Listens for `intro:landed` (from core/loader) to reveal its wordmark.
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
    const c = ctx.depth.compression(parseFloat(a.dataset.depth) || 0)
    a.style.setProperty('--wdth', c.wdth)
    a.style.setProperty('--wght', c.wght)
  })

  /* ------------------------------------------------------- anchors */
  nav.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]')
    if (!a) return
    const id = a.getAttribute('href')
    const target = id.length > 1 ? document.querySelector(id) : null
    if (!target) return
    e.preventDefault()
    // Lenis also listens for anchor clicks (on window); its second scrollTo
    // would replace ours and drop the onComplete that moves focus.
    e.stopPropagation()
    const fromKeyboard = e.detail === 0
    const wasOpen = menuOpen
    if (menuOpen) closeMenu({ restoreFocus: false })
    // Keyboard users, and anyone leaving the menu (whose link just
    // vanished), continue from the section they chose, not from <body>.
    const moveFocus = fromKeyboard || wasOpen
    const land = () => {
      if (!moveFocus) return
      const focusEl = target.querySelector('h1, h2') || target
      if (!focusEl.hasAttribute('tabindex')) focusEl.setAttribute('tabindex', '-1')
      focusEl.focus({ preventScroll: true })
    }
    if (moveFocus && wasOpen) {
      // park focus on the target straight away, so it never falls to <body>
      // while the water scrolls
      land()
    }
    // A pinned section sits inside a .pin-spacer; once scrolled past, the
    // section itself is parked at the end of its pin. Aim for the spacer, so
    // "The layers" from below lands at the start of the pass, not its end.
    const p = target.parentElement
    const dest = p && p.classList.contains('pin-spacer') ? p : target
    if (id === '#surface') ctx.scrollTo(0, { onComplete: land })
    else ctx.scrollTo(dest, { onComplete: land })
    if (!ctx.lenis) land()
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
    placeIndicator()
  }
  function placeIndicator(immediate = false) {
    const link = links.find((l) => l.dataset.section === active)
    if (!link || !list.offsetParent) {
      gsap.to(indicator, { opacity: 0, duration: 0.4, overwrite: 'auto' })
      return
    }
    const x = link.offsetLeft + link.offsetWidth / 2
    const vars = { x, opacity: 1, duration: immediate || reduced ? 0 : 0.9, ease: 'expo.out', overwrite: 'auto' }
    gsap.to(indicator, vars)
  }
  ctx.depth.onChange((s) => setActive(s.section))
  window.addEventListener('resize', () => placeIndicator(true))
  document.fonts?.ready.then(() => placeIndicator(true))

  /* ------------------------------------- hide on down, show on up */
  let hidden = false
  const setHidden = (v) => {
    if (v === hidden) return
    hidden = v
    nav.classList.toggle('is-hidden', v)
  }
  let lastY = window.scrollY
  let acc = 0
  function onScroll() {
    const y = window.scrollY
    const dy = y - lastY
    lastY = y
    nav.classList.toggle('is-scrolled', y > 24)
    if (menuOpen || reduced) return
    if (y < 140) return setHidden(false)
    // a little hysteresis so tiny trackpad wobbles don't flicker the bar
    acc = Math.sign(dy) === Math.sign(acc) ? acc + dy : dy
    if (acc > 24 && !nav.matches(':focus-within')) setHidden(true)
    else if (acc < -36) setHidden(false)
  }
  if (ctx.lenis) ctx.lenis.on('scroll', onScroll)
  else window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

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
        .fromTo(rows, { '--rule': 0 }, { '--rule': 1, duration: 1 }, 0.3)
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
