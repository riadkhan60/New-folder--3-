/**
 * footer.js — #footer (10,935 m).
 *
 * "Return to the surface": one smooth 5.5 s scroll to the top, so the visitor
 * watches the whole ascent — the depth counts back up, the water brightens,
 * the sun comes back. When it arrives, focus moves to the nav wordmark so the
 * keyboard is where the eyes are. Emits nothing.
 */
import '../styles/footer.css'

export function init(ctx) {
  const root = document.getElementById('footer')
  if (!root) return
  const btn = root.querySelector('[data-foot-return]')
  if (!btn) return

  let safety = 0
  const arrive = () => {
    clearTimeout(safety)
    btn.classList.remove('is-rising')
    const top = document.querySelector('.nav__brand') || document.querySelector('#surface h1, h1')
    if (top) {
      if (!top.matches('a, button, [tabindex]')) top.setAttribute('tabindex', '-1')
      top.focus({ preventScroll: true })
    }
  }

  btn.addEventListener('click', () => {
    btn.classList.add('is-rising')
    if (ctx.lenis) {
      ctx.scrollTo(0, { duration: 5.5, onComplete: arrive })
      // if the visitor takes over the scroll mid-ascent, just tidy up
      safety = setTimeout(() => btn.classList.remove('is-rising'), 6500)
    } else {
      ctx.scrollTo(0, { duration: 5.5 })
      arrive()
    }
  })
}
