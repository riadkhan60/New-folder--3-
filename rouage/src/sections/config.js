/**
 * config.js — choose the dial, the case and the strap.
 *
 * The choices are CSS custom properties on the watches (see watch.css), so
 * both the watch in this section and the one in the hero change together,
 * and the colours fade rather than jump.
 */
import { createWatch } from '../watch/watch.js'

const BLUED = { '--hand-a': '#5b74ea', '--hand-b': '#16226e' }
const RHODIUM = { '--hand-a': '#fbfbfa', '--hand-b': '#8f949b' }
const STEEL_IDX = { '--idx-a': '#fbfbfa', '--idx-b': '#8f949b' }

const DIALS = {
  saumon: { name: 'Saumon', code: 'SA', vars: { '--dial-a': '#f6c5aa', '--dial-b': '#e3a184', '--dial-c': '#bf7a5c', '--dial-ink': '#3a1c10', ...BLUED, ...STEEL_IDX } },
  glacier: { name: 'Glacier', code: 'GL', vars: { '--dial-a': '#dcedf3', '--dial-b': '#a9cad6', '--dial-c': '#7ca3b3', '--dial-ink': '#12303b', ...BLUED, ...STEEL_IDX } },
  foret: { name: 'Forêt', code: 'FO', vars: { '--dial-a': '#3e8a6a', '--dial-b': '#1f5a45', '--dial-c': '#0e3226', '--dial-ink': '#e9efe6', ...RHODIUM, ...STEEL_IDX } },
  ardoise: { name: 'Ardoise', code: 'AR', vars: { '--dial-a': '#6f757e', '--dial-b': '#444950', '--dial-c': '#24272c', '--dial-ink': '#eef0f2', ...RHODIUM, ...STEEL_IDX } },
  ivoire: { name: 'Ivoire', code: 'IV', vars: { '--dial-a': '#fdf8ec', '--dial-b': '#ece4d0', '--dial-c': '#d2c7ac', '--dial-ink': '#1b1c1e', ...BLUED, '--idx-a': '#f3dc9a', '--idx-b': '#8a6a2c' } },
}
const METALS = {
  steel: { name: 'Steel', code: 'ST', price: 24800, vars: { '--m0': '#f7f8f9', '--m1': '#aeb3b8', '--m2': '#23262a', '--m3': '#747a80' } },
  rose: { name: 'Rose gold', code: 'RG', price: 41600, vars: { '--m0': '#fff1e6', '--m1': '#e2ac8c', '--m2': '#5a3222', '--m3': '#b98062' } },
}
const STRAPS = {
  noir: { name: 'Noir', code: 'NO', vars: { '--strap': '#1c1d20' } },
  cognac: { name: 'Cognac', code: 'CO', vars: { '--strap': '#7a4424' } },
  gris: { name: 'Gris', code: 'GR', vars: { '--strap': '#63666c' } },
  marine: { name: 'Marine', code: 'MA', vars: { '--strap': '#1a2848' } },
}

export function initConfig(ctx) {
  const { reduced } = ctx
  const section = document.querySelector('.yours')
  const form = section?.querySelector('[data-config]')
  if (!form) return
  const el = section.querySelector('[data-config-watch] .watch')
  const watch = createWatch(el, { reduced })
  watch.state.intro = 1 // this one simply shows the time
  ctx.frames.add(watch.frame)

  const watches = [...document.querySelectorAll('.watch')]
  const pick = (name) => section.querySelector(`[data-pick="${name}"]`)
  const refOut = section.querySelector('[data-ref]')
  const priceOut = section.querySelector('[data-price]')
  const refField = document.getElementById('f-ref')

  function apply() {
    const data = new FormData(form)
    const dial = DIALS[data.get('dial')] || DIALS.saumon
    const metal = METALS[data.get('metal')] || METALS.steel
    const strap = STRAPS[data.get('strap')] || STRAPS.noir
    for (const w of watches) {
      for (const set of [dial.vars, metal.vars, strap.vars]) for (const k in set) w.style.setProperty(k, set[k])
    }
    pick('dial').textContent = dial.name
    pick('metal').textContent = metal.name
    pick('strap').textContent = strap.name
    refOut.textContent = `R01‑${dial.code}‑${metal.code}‑${strap.code}`
    priceOut.textContent = '€' + metal.price.toLocaleString('en-GB')
    if (refField) refField.value = `R‑01 · ${dial.name} · ${metal.name} · ${strap.name}`
  }
  form.addEventListener('change', apply)
  form.addEventListener('submit', (e) => e.preventDefault())
  apply()

  /* the light follows a mouse over this section */
  if (!reduced) {
    let idle = 0
    section.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'mouse') return
        const r = el.getBoundingClientRect()
        watch.light((e.clientX - (r.left + r.width / 2)) / (innerWidth * 0.5), (e.clientY - (r.top + r.height / 2)) / (innerHeight * 0.5))
        clearTimeout(idle)
        idle = setTimeout(() => watch.idle(true), 3200)
      },
      { passive: true }
    )
  } else {
    watch.idle(false)
    watch.light(0.25, -0.2)
  }
}
