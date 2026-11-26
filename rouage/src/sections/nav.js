/**
 * nav.js — the bar takes the colours of the section behind it, gains a
 * backdrop once the page has moved, and marks the section you are in.
 */
export function initNav(ctx) {
  const nav = document.querySelector('[data-nav]')
  if (!nav) return
  const toned = [...document.querySelectorAll('main > section[data-tone], footer[data-tone]')]
  const links = [...nav.querySelectorAll('.nav__links a')]
  const stage = document.querySelector('.stage')

  let tone = 'dark'
  let current = ''
  function update() {
    const y = nav.offsetHeight * 0.5
    let under = toned[0]
    for (const s of toned) {
      const r = s.getBoundingClientRect()
      if (r.top <= y && r.bottom > y) under = s
    }
    if (under.dataset.tone !== tone) {
      tone = under.dataset.tone
      nav.dataset.tone = tone
    }
    nav.classList.toggle('is-scrolled', window.scrollY > 24)

    // which link is "here": the stage counts as Inside once the watch starts to open
    let here = under.id || ''
    if (under === stage) {
      const r = stage.getBoundingClientRect()
      here = -r.top / (r.height - innerHeight) > 0.12 ? 'inside' : ''
    }
    if (here !== current) {
      current = here
      links.forEach((a) => {
        if (a.getAttribute('href') === '#' + here) a.setAttribute('aria-current', 'true')
        else a.removeAttribute('aria-current')
      })
    }
  }
  update()
  window.addEventListener('scroll', update, { passive: true })
  window.addEventListener('resize', update)
  ctx.lenis?.on('scroll', update)
}
