/**
 * list.js — the waiting-list form.
 *
 * Nothing leaves the page: Atelier Rouage is fictional, and the form says
 * so. It checks the two required fields, puts the keyboard on the first one
 * that needs attention, and then shows what would happen next.
 */
export function initList() {
  const form = document.querySelector('[data-form]')
  const done = document.querySelector('[data-done]')
  if (!form || !done) return
  const title = done.querySelector('[data-done-title]')
  const again = done.querySelector('[data-again]')
  const name = form.elements.name
  const email = form.elements.email

  const check = (input) => {
    const value = input.value.trim()
    const ok = input === email ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) : value.length > 0
    const err = document.getElementById(input.id + '-err')
    input.setAttribute('aria-invalid', String(!ok))
    if (err) err.hidden = ok
    return ok
  }
  ;[name, email].forEach((input) => {
    input.addEventListener('blur', () => input.value && check(input))
    input.addEventListener('input', () => input.getAttribute('aria-invalid') === 'true' && check(input))
  })

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const bad = [name, email].filter((input) => !check(input))
    if (bad.length) {
      bad[0].focus()
      return
    }
    const first = name.value.trim().split(/\s+/)[0]
    title.textContent = `Thank you, ${first}.`
    form.hidden = true
    done.hidden = false
    done.focus()
  })

  again.addEventListener('click', () => {
    done.hidden = true
    form.hidden = false
    form.elements.note.value = ''
    name.focus()
  })
}
