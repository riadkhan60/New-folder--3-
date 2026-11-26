/**
 * bench-markup.js — the going train as a technical drawing.
 *
 * The same wheels, in the same places and with the same tooth counts as in
 * the watch (train.js), drawn as line work so that overlapping wheels can be
 * read. Pure string building: vite.config.js writes it into index.html.
 *
 * The board is laid out in em, 1em = 10 watch units, so the page can zoom it
 * by changing one font-size.
 */
import { POS, MESH, ESC_R, BALANCE_R, AXIS_DEG, FORK_DEG, SPRING, D2R, polar, trainAngles, forkAngle, escapePhase } from './train.js'
import { r2, circle, gearOutline, wheelBody, escapeBody, balanceBody, spiral, mainspring, TOE } from './parts.js'
import { palletShapes } from './markup.js'

export const BOARD = { x0: -340, y0: -205, w: 880, h: 540 }
/** The mainspring's coils, between the arbor and the barrel wall. */
export const MAINSPRING = { r0: 17, r1: 97, turns: 11 }

const em = (u) => r2(u / 10) + 'em'
const at = (p) => `left:${em(p.x - BOARD.x0)};top:${em(p.y - BOARD.y0)}`
const rot = (name, c, R, inner, turn = 0) =>
  `<div class="rot" data-part="${name}" style="${at(c)};transform:rotate(${r2(turn)}deg)">` +
  `<svg viewBox="${-R} ${-R} ${2 * R} ${2 * R}" style="left:${em(-R)};top:${em(-R)};width:${em(2 * R)};height:${em(2 * R)}" aria-hidden="true" focusable="false">${inner}</svg></div>`

const PIN = { add: 0.85, ded: 1, hr: 0.34, hp: 0.27, ht: 0.14 }

/** A wheel in line: crisp while it turns slowly, a soft disc once it turns too fast to follow. */
function lineWheel(spec) {
  const b = wheelBody(spec)
  let sharp = `<path class="ln ln--body" d="${b.d}" fill-rule="evenodd"/>`
  if (spec.pin) sharp += `<path class="ln ln--pin" d="${gearOutline(spec.pin.n, spec.pin.r, PIN).d}"/>`
  sharp += `<circle class="ln ln--pin" r="2.8"/>`
  const blur =
    `<circle class="bl" r="${r2((b.rt + b.ri) / 2)}" stroke-width="${r2(b.rt - b.ri)}"/>` +
    `<circle class="bl bl--thin" r="${r2(b.ri * 0.66)}"/><circle class="bl bl--thin" r="${r2(b.ri * 0.36)}"/>` +
    (spec.pin ? `<circle class="bl" r="${r2(spec.pin.r * 0.7)}" stroke-width="${r2(spec.pin.r * 0.9)}"/>` : '')
  return `<g class="sharp">${sharp}</g><g class="blur">${blur}</g>`
}

function lineBarrel() {
  const g = gearOutline(MESH.barrel.N, MESH.barrel.R)
  const M = MAINSPRING
  return (
    `<path class="ln ln--body" d="${g.d}"/><circle class="ln ln--thin" r="${r2(g.rr - 5)}"/><circle class="ln ln--thin" r="${M.r1 + 4}"/>` +
    `<path class="ln ln--spring" data-mainspring d="${mainspring(M.r0, M.r1, M.turns, 0.58)}"/>` +
    `<circle class="ln ln--pin" r="${M.r0 - 2}"/><rect class="ln ln--pin" x="-6" y="-6" width="12" height="12"/>`
  )
}

function lineEscape() {
  const b = escapeBody(ESC_R)
  const g = gearOutline(MESH.fourth.n, MESH.fourth.r, PIN)
  const sharp =
    `<path class="ln ln--body" d="${b.d}" fill-rule="evenodd" transform="rotate(${r2(escapePhase(TOE))})"/>` +
    `<path class="ln ln--pin" d="${g.d}"/><circle class="ln ln--pin" r="2"/>`
  const blur = `<circle class="bl" r="${r2(ESC_R * 0.85)}" stroke-width="${r2(ESC_R * 0.3)}"/><circle class="bl bl--thin" r="${r2(b.ri * 0.6)}"/>`
  return `<g class="sharp">${sharp}</g><g class="blur">${blur}</g>`
}

function linePallet() {
  const f = palletShapes()
  return (
    `<g transform="rotate(${AXIS_DEG + 180})"><path class="ln ln--steel" d="${f.body}${f.fork}"/>` +
    `${f.stone(f.entry)} class="ruby"/>${f.stone(f.exit)} class="ruby"/></g>`
  )
}

function lineBalance() {
  const R = BALANCE_R
  const b = balanceBody(R)
  const a = AXIS_DEG * D2R
  let weights = ''
  for (let i = 0; i < 3; i++) {
    const w = (i * 120 - 30) * D2R
    weights += `<circle class="ln ln--pin" cx="${r2(R * 0.925 * Math.cos(w))}" cy="${r2(R * 0.925 * Math.sin(w))}" r="4.4"/>`
  }
  return (
    `<path class="ln ln--body" d="${b.d}" fill-rule="evenodd"/>` +
    weights +
    `<circle class="ln ln--pin" r="13"/><circle class="ruby" cx="${r2(11.5 * Math.cos(a))}" cy="${r2(11.5 * Math.sin(a))}" r="2.4"/><circle class="ln ln--pin" r="3.2"/>`
  )
}

/* ---- labels ------------------------------------------------------------- */

const TAGS = [
  { key: 'barrel', to: polar(POS.barrel, 122, -52), at: { x: 268, y: -182 }, name: 'Barrel', data: '72 teeth · 1 turn in 7.2 h' },
  { key: 'centre', to: polar(POS.centre, 73, -8), at: { x: 318, y: 62 }, name: 'Centre wheel', data: '64 teeth · 1 turn an hour' },
  { key: 'third', to: polar(POS.third, 59, 22), at: { x: 318, y: 168 }, name: 'Third wheel', data: '60 teeth · 1 turn in 7½ min' },
  { key: 'fourth', to: polar(POS.fourth, 63, 62), at: { x: 190, y: 286 }, name: 'Fourth wheel', data: '60 teeth · 1 turn a minute' },
  { key: 'escape', to: polar(POS.escape, 35, 100), at: { x: -58, y: 296 }, name: 'Escape wheel', data: '15 teeth · half a tooth a beat' },
  { key: 'pallet', to: { x: POS.pallet.x - 2, y: POS.pallet.y - 7 }, at: { x: -332, y: 28 }, name: 'Pallet fork', data: 'two ruby stones', side: 'right' },
  { key: 'balance', to: polar(POS.balance, 92, 138), at: { x: -332, y: 296 }, name: 'Balance', data: '2.5 Hz · five beats a second', side: 'right' },
]

export function benchMarkup() {
  const B = BOARD
  const P = POS
  const A = trainAngles(150)
  const vb = `${B.x0} ${B.y0} ${B.w} ${B.h}`

  let grid = ''
  for (let x = Math.ceil(B.x0 / 50) * 50; x < B.x0 + B.w; x += 50) grid += `M${x} ${B.y0}V${B.y0 + B.h}`
  for (let y = Math.ceil(B.y0 / 50) * 50; y < B.y0 + B.h; y += 50) grid += `M${B.x0} ${y}H${B.x0 + B.w}`

  const order = [P.barrel, P.centre, P.third, P.fourth, P.escape, P.pallet, P.balance]
  const centres = order.map((c, i) => (i ? 'L' : 'M') + r2(c.x) + ' ' + r2(c.y)).join('')
  const pitch = [
    [P.barrel, MESH.barrel.R],
    [P.centre, MESH.centre.R],
    [P.third, MESH.third.R],
    [P.fourth, MESH.fourth.R],
  ]
    .map(([c, r]) => circle(r, c.x, c.y))
    .join('')

  // banking pins: where the fork comes to rest on either side
  const base = AXIS_DEG + 180
  const bank = [1, -1]
    .map((s) => {
      const a = (base + s * FORK_DEG) * D2R
      const n = a + (s * Math.PI) / 2
      const c = { x: P.pallet.x + 27 * Math.cos(a) + 5.4 * Math.cos(n), y: P.pallet.y + 27 * Math.sin(a) + 5.4 * Math.sin(n) }
      return `<circle class="ln ln--pin" cx="${r2(c.x)}" cy="${r2(c.y)}" r="1.9"/>`
    })
    .join('')
  const stud = polar(P.balance, SPRING.r1, SPRING.turns * 360)
  const pivots = order.map((c) => `<circle class="ruby" cx="${r2(c.x)}" cy="${r2(c.y)}" r="1.5"/>`).join('')
  const leaders = TAGS.map((t) => {
    const end = { x: t.at.x + (t.side === 'right' ? 62 : -6), y: t.at.y + 6 }
    return `<path class="lead" data-lead="${t.key}" d="M${r2(t.to.x)} ${r2(t.to.y)}L${r2(end.x)} ${r2(end.y)}"/><circle class="lead-dot" data-lead="${t.key}" cx="${r2(t.to.x)}" cy="${r2(t.to.y)}" r="2"/>`
  }).join('')
  const tags = TAGS.map(
    (t) => `<div class="tag-at" style="${at(t.at)}"><p class="tag" data-tag="${t.key}"><b>${t.name}</b><small>${t.data}</small></p></div>`
  ).join('')

  return (
    `<div class="board" data-board style="--bw:${B.w / 10};--bh:${B.h / 10}">` +
    `<svg class="board__under" viewBox="${vb}" aria-hidden="true" focusable="false">` +
    `<path class="grid" d="${grid}"/><path class="dash" d="${pitch}"/><path class="dash dash--axis" d="${centres}"/></svg>` +
    rot('barrel', P.barrel, 126, lineBarrel(), A.barrel) +
    rot('centre', P.centre, 76, lineWheel({ N: 64, R: 70, spokes: 5, pin: { n: MESH.barrel.n, r: MESH.barrel.r } }), A.centre) +
    rot('third', P.third, 62, lineWheel({ N: 60, R: 56, spokes: 5, pin: { n: MESH.centre.n, r: MESH.centre.r } }), A.third) +
    rot('fourth', P.fourth, 66, lineWheel({ N: 60, R: 60, spokes: 5, pin: { n: MESH.third.n, r: MESH.third.r } }), A.fourth) +
    rot('escape', P.escape, 38, lineEscape(), A.escape) +
    rot('pallet', P.pallet, 50, linePallet(), forkAngle(38)) +
    rot('balance', P.balance, BALANCE_R + 4, lineBalance(), 38) +
    rot('spring', P.balance, 48, `<path class="ln ln--spring" d="${spiral(SPRING.r0, SPRING.r1, SPRING.turns, 38, 240)}"/>`) +
    `<svg class="board__over" viewBox="${vb}" aria-hidden="true" focusable="false">` +
    bank +
    `<rect class="ln ln--pin" x="${r2(stud.x - 3.2)}" y="${r2(stud.y - 3.2)}" width="6.4" height="6.4"/>` +
    pivots +
    leaders +
    `</svg>` +
    tags +
    `</div>`
  )
}
