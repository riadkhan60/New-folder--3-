/**
 * markup.js — assembles the R-01 as HTML and SVG, one flat layer per level
 * of the watch, stacked along Z so the page can tilt it and take it apart.
 *
 * Pure string building with no DOM: vite.config.js calls watchMarkup() and
 * writes the result into index.html, so the watch is on the page before any
 * script runs (showing 10:10:30, as every watch does in its portrait).
 *
 * Sizes are in em: the watch sets font-size to 1/100 of its width, so
 * 1 watch unit (of 1000) is 0.1em.
 */
import {
  POS,
  MESH,
  DIAL,
  CASE,
  ESC_R,
  BALANCE_R,
  AXIS_DEG,
  FORK_DEG,
  GAUGE,
  LOCK,
  LAYERS,
  BAND,
  SPRING,
  D2R,
  polar,
  trainAngles,
  handAngles,
  escapePhase,
  forkAngle,
} from './train.js'
import {
  r2,
  circle,
  gearOutline,
  wheelBody,
  escapeBody,
  balanceBody,
  spiral,
  fingers,
  dauphine,
  ticks,
  arc,
  TOE,
} from './parts.js'

const em = (u) => r2(u / 10) + 'em'
const at = (p) => `left:${em(500 + p.x)};top:${em(500 + p.y)}`

/** The static pose: ten past ten and thirty seconds. */
const POSE_T = 10 * 3600 + 10 * 60 + 30
const POSE = { ...trainAngles((POSE_T % 60) * 5), ...handAngles(POSE_T), second: 180, balance: 38, reserve: 0.58 }

/* ---- shared paint ------------------------------------------------------- */

const defs = (p) => `<svg class="watch__defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
<radialGradient id="${p}gold"><stop offset="0" stop-color="#fbeebd"/><stop offset=".5" stop-color="#dfc078"/><stop offset=".86" stop-color="#b48d45"/><stop offset="1" stop-color="#8d6b2f"/></radialGradient>
<linearGradient id="${p}goldl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c8"/><stop offset=".5" stop-color="#cfa95a"/><stop offset="1" stop-color="#7d5c22"/></linearGradient>
<radialGradient id="${p}steel"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#c3c7cc"/><stop offset="1" stop-color="#737980"/></radialGradient>
<linearGradient id="${p}steell" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fafbfb"/><stop offset=".45" stop-color="#a9aeb4"/><stop offset=".62" stop-color="#e3e5e7"/><stop offset="1" stop-color="#666b72"/></linearGradient>
<linearGradient id="${p}silver" gradientUnits="userSpaceOnUse" x1="-380" y1="-380" x2="380" y2="380"><stop offset="0" stop-color="#f3f0e8"/><stop offset=".5" stop-color="#cfcbbf"/><stop offset="1" stop-color="#aba798"/></linearGradient>
<radialGradient id="${p}blued" fx=".34" fy=".3"><stop offset="0" stop-color="#93a6ff"/><stop offset=".3" stop-color="#3550d0"/><stop offset=".72" stop-color="#172474"/><stop offset="1" stop-color="#0a1040"/></radialGradient>
<radialGradient id="${p}ruby" fx=".36" fy=".3"><stop offset="0" stop-color="#ffa6c1"/><stop offset=".38" stop-color="#d81b5c"/><stop offset="1" stop-color="#6d0828"/></radialGradient>
<radialGradient id="${p}grain" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="4.6" spreadMethod="repeat"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".11"/><stop offset="1" stop-color="#000" stop-opacity=".07"/></radialGradient>
<pattern id="${p}brush" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)"><rect width="3" height=".7" fill="#fff" opacity=".14"/><rect y="1.5" width="3" height=".5" fill="#000" opacity=".07"/></pattern>
<pattern id="${p}perl" width="17" height="17" patternUnits="userSpaceOnUse"><g fill="none" stroke-width="1.5"><circle cx="8.5" cy="8.5" r="10" stroke="#fff" stroke-opacity=".09"/><circle r="10" stroke="#000" stroke-opacity=".3"/><circle cx="17" r="10" stroke="#000" stroke-opacity=".3"/><circle cy="17" r="10" stroke="#fff" stroke-opacity=".07"/><circle cx="17" cy="17" r="10" stroke="#000" stroke-opacity=".3"/></g></pattern>
<radialGradient id="${p}ratchet"><stop offset="0" stop-color="#e9ebed"/><stop offset=".7" stop-color="#b9bdc2"/><stop offset="1" stop-color="#8b9096"/></radialGradient>
<filter id="${p}soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.4"/></filter>
<filter id="${p}softer" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>
</defs></svg>`

const jewel = (p, c, s = 1) =>
  `<g transform="translate(${r2(c.x)} ${r2(c.y)}) scale(${s})"><circle r="9" fill="url(#${p}goldl)" stroke="#5c4212" stroke-opacity=".6" stroke-width=".5"/><circle r="5.6" fill="url(#${p}ruby)"/><circle cx="-1.7" cy="-1.9" r="1.3" fill="#fff" opacity=".85"/><circle r="1.5" fill="#35040f"/></g>`

const screw = (p, c, r, turn, tone = 'blued') =>
  `<g transform="translate(${r2(c.x)} ${r2(c.y)}) rotate(${turn})"><circle r="${r}" fill="url(#${p}${tone})" stroke="#05081f" stroke-opacity=".7" stroke-width=".6"/><rect x="${r2(-r * 0.82)}" y="${r2(-r * 0.15)}" width="${r2(r * 1.64)}" height="${r2(r * 0.3)}" fill="#060a26" opacity=".9"/><path d="${arc(r * 0.72, 200, 290)}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="${r2(r * 0.14)}" stroke-linecap="round" transform="rotate(${-turn})"/></g>`

/** A polished bridge: shadow, dark edge, a bevel that catches the light, and a grained top. */
const bridge = (p, caps, { top = 'silver', bevel = 4.2 } = {}) => {
  const d0 = fingers(caps)
  const d1 = fingers(caps, 1.1)
  const d2 = fingers(caps, bevel)
  return (
    `<path d="${d0}" fill="#000" opacity=".5" transform="translate(3 5.5)" filter="url(#${p}soft)"/>` +
    `<path d="${d0}" fill="#1c1e22"/><path d="${d1}" fill="#6b7078"/>` +
    `<path d="${d1}" fill="#fff" opacity=".92" transform="translate(-1.5 -1.7)"/>` +
    `<path d="${d2}" fill="url(#${p}${top})"/><path d="${d2}" fill="url(#${p}brush)"/>`
  )
}

/** An absolutely placed, rotating part: a zero-size pivot with its drawing around it. */
const rot = (name, c, R, inner, { cls = '', turn = 0, attrs = '' } = {}) =>
  `<div class="rot ${cls}" data-part="${name}" style="${at(c)};transform:rotate(${r2(turn)}deg)"${attrs}>` +
  `<svg viewBox="${-R} ${-R} ${2 * R} ${2 * R}" style="left:${em(-R)};top:${em(-R)};width:${em(2 * R)};height:${em(2 * R)}" aria-hidden="true" focusable="false">${inner}</svg></div>`

const full = (inner, cls = '') =>
  `<svg class="full ${cls}" viewBox="-500 -500 1000 1000" aria-hidden="true" focusable="false">${inner}</svg>`

const layer = (name, inner, z = LAYERS[name].z, { style = '', attrs = '' } = {}) =>
  `<div class="wl wl--${name}" data-layer="${name}" data-z="${z}" style="transform:translateZ(${em(z)});${style}"${attrs}>${inner}</div>`

/* ---- wheels ------------------------------------------------------------- */

function metalWheel(p, spec, tone = 'gold') {
  const b = wheelBody(spec)
  let s =
    `<path d="${b.d}" fill="url(#${p}${tone})" fill-rule="evenodd"/><path d="${b.d}" fill="url(#${p}grain)" fill-rule="evenodd"/>` +
    `<circle r="${r2(b.rr - 0.9)}" fill="none" stroke="#fff" stroke-opacity=".34" stroke-width=".9"/>` +
    `<circle r="${r2(b.ri + 0.5)}" fill="none" stroke="#3b2a08" stroke-opacity=".5" stroke-width=".9"/>` +
    `<circle r="${r2(b.rh)}" fill="none" stroke="#3b2a08" stroke-opacity=".4" stroke-width=".8"/>`
  if (spec.pin) {
    const g = gearOutline(spec.pin.n, spec.pin.r, { add: 0.85, ded: 1, hr: 0.34, hp: 0.27, ht: 0.14 })
    s += `<path d="${g.d}" fill="url(#${p}steel)" stroke="#16181b" stroke-opacity=".6" stroke-width=".5"/>`
  }
  return s + `<circle r="${r2(Math.max(2.4, b.rh * 0.34))}" fill="url(#${p}steel)" stroke="#000" stroke-opacity=".5" stroke-width=".4"/>`
}

function barrelDrum(p) {
  const g = gearOutline(MESH.barrel.N, MESH.barrel.R)
  return (
    `<path d="${g.d}" fill="url(#${p}gold)"/><path d="${g.d}" fill="url(#${p}grain)"/>` +
    `<circle r="${r2(g.rr - 3)}" fill="none" stroke="#3b2a08" stroke-opacity=".45" stroke-width="1"/>`
  )
}

function ratchet(p) {
  const R = 96
  const g = gearOutline(54, R, { add: 0.7, ded: 0.9, hr: 0.36, hp: 0.2, ht: 0.05 })
  return (
    `<path d="${g.d}" fill="#8f949b"/>` +
    `<circle r="${r2(g.rr - 1)}" fill="url(#${p}ratchet)"/>` +
    `<path d="${ticks(90, 20, g.rr - 4)}" stroke="#fff" stroke-opacity=".2" stroke-width="1.1"/>` +
    `<path d="${ticks(90, 20, g.rr - 4, { from: -88 })}" stroke="#000" stroke-opacity=".16" stroke-width="1.1"/>` +
    `<circle r="${r2(g.rr - 3.5)}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".9"/>` +
    `<circle r="24" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="1"/>` +
    screw(p, { x: 0, y: 0 }, 15, 24)
  )
}

function clickPawl(p) {
  // a small spring-loaded lever whose beak drops between the ratchet teeth
  const d = fingers([
    [{ x: 0, y: 0 }, 6.5, { x: -17, y: 6 }, 2.6],
    [{ x: 0, y: 0 }, 5, { x: 9, y: -15 }, 2.2],
  ])
  return `<path d="${d}" fill="url(#${p}steell)" stroke="#1c1e22" stroke-width=".7"/>` + screw(p, { x: 0, y: 0 }, 3.6, 70)
}

function escapeWheel(p) {
  const b = escapeBody(ESC_R)
  const g = gearOutline(MESH.fourth.n, MESH.fourth.r, { add: 0.85, ded: 1, hr: 0.34, hp: 0.27, ht: 0.14 })
  return (
    `<path d="${b.d}" transform="rotate(${r2(escapePhase(TOE))})" fill="url(#${p}gold)" fill-rule="evenodd" stroke="#5c4212" stroke-opacity=".5" stroke-width=".4"/>` +
    `<path d="${g.d}" fill="url(#${p}steel)" stroke="#16181b" stroke-opacity=".6" stroke-width=".4"/>` +
    `<circle r="2.2" fill="url(#${p}steel)" stroke="#000" stroke-opacity=".5" stroke-width=".4"/>`
  )
}

/**
 * The pallet fork, drawn pointing along +x (towards the balance) with its
 * pivot at the origin. Each stone is placed so that its locking face meets
 * the toe of a tooth when the fork rests on that side.
 */
export function palletShapes() {
  const L = 43
  const E = POS.escape
  const P = POS.pallet
  const base = AXIS_DEG + 180
  const stoneAt = (lock, rest) => {
    const w = polar(E, ESC_R - LOCK.depth, lock) // the point a toe touches
    const t = -(base + rest) * D2R
    const dx = w.x - P.x
    const dy = w.y - P.y
    return { x: dx * Math.cos(t) - dy * Math.sin(t), y: dx * Math.sin(t) + dy * Math.cos(t), turn: lock - AXIS_DEG - rest }
  }
  const entry = stoneAt(LOCK.entry, FORK_DEG)
  const exit = stoneAt(LOCK.exit, -FORK_DEG)
  const mid = (s) => {
    const a = s.turn * D2R // the stone's long axis points at the wheel's centre
    return { x: s.x + -2.4 * Math.cos(a) - 1.6 * Math.sin(a), y: s.y + -2.4 * Math.sin(a) + 1.6 * Math.cos(a) }
  }
  const body = fingers([
    [{ x: 0, y: 0 }, 4.8, { x: L - 9, y: 0 }, 2.5],
    [{ x: 0, y: 0 }, 4.4, mid(entry), 2.9],
    [{ x: 0, y: 0 }, 4.4, mid(exit), 2.9],
  ])
  const fork = `M${L - 11} -4.6L${L + 2} -7.6L${L + 2} -3.1L${L - 4.5} -2.7L${L - 4.5} 2.7L${L + 2} 3.1L${L + 2} 7.6L${L - 11} 4.6Z`
  const stone = (s) => `<rect x="-7" y="0" width="9.6" height="3.2" rx=".4" transform="translate(${r2(s.x)} ${r2(s.y)}) rotate(${r2(s.turn)})"`
  return { body, fork, stone, entry, exit }
}

function pallet(p) {
  const f = palletShapes()
  return (
    `<g transform="rotate(${AXIS_DEG + 180})"><path d="${f.body}${f.fork}" fill="url(#${p}steell)" stroke="#1c1e22" stroke-width=".6"/>` +
    `${f.stone(f.entry)} fill="url(#${p}ruby)"/>${f.stone(f.exit)} fill="url(#${p}ruby)"/>` +
    `<circle r="2.2" fill="url(#${p}ruby)"/></g>`
  )
}

function balanceWheel(p) {
  const R = BALANCE_R
  const b = balanceBody(R)
  const a = (AXIS_DEG * Math.PI) / 180
  let weights = ''
  for (let i = 0; i < 3; i++) {
    const w = ((i * 120 - 30) * Math.PI) / 180
    weights += `<circle cx="${r2(R * 0.925 * Math.cos(w))}" cy="${r2(R * 0.925 * Math.sin(w))}" r="4.4" fill="url(#${p}steel)" stroke="#3b2a08" stroke-opacity=".7" stroke-width=".6"/>`
  }
  return (
    `<path d="${b.d}" fill="url(#${p}gold)" fill-rule="evenodd"/><path d="${b.d}" fill="url(#${p}grain)" fill-rule="evenodd"/>` +
    `<circle r="${r2(R - 0.8)}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>` +
    `<circle r="${r2(b.ri + 0.5)}" fill="none" stroke="#3b2a08" stroke-opacity=".55" stroke-width=".9"/>` +
    weights +
    `<circle r="13" fill="url(#${p}steel)" stroke="#000" stroke-opacity=".4" stroke-width=".5"/>` +
    `<circle cx="${r2(11.5 * Math.cos(a))}" cy="${r2(11.5 * Math.sin(a))}" r="2.3" fill="url(#${p}ruby)"/>` +
    `<circle r="3.4" fill="#2a2d31"/>`
  )
}

/* ---- the layers --------------------------------------------------------- */

function plateLayer(p) {
  const B = POS.balance
  const F = POS.fourth
  const G = GAUGE
  let gauge = `<path d="${arc(G.r + 9, G.from, G.to, G.x, G.y)}" fill="none" stroke="url(#${p}goldl)" stroke-width="1.3"/>`
  for (let i = 0; i <= 6; i++) {
    const a = G.from + ((G.to - G.from) * i) / 6
    const p0 = polar(G, G.r + 9, a)
    const p1 = polar(G, G.r + (i % 3 === 0 ? 19 : 15), a)
    gauge += `<path d="M${r2(p0.x)} ${r2(p0.y)}L${r2(p1.x)} ${r2(p1.y)}" stroke="#d9bd7c" stroke-width="${i % 3 === 0 ? 1.6 : 1}"/>`
  }
  const g0 = polar(G, G.r + 31, G.from)
  const g1 = polar(G, G.r + 31, G.to)
  gauge +=
    `<text class="engrave" x="${r2(g0.x)}" y="${r2(g0.y + 4)}" text-anchor="middle">0</text>` +
    `<text class="engrave" x="${r2(g1.x)}" y="${r2(g1.y + 4)}" text-anchor="middle">72</text>`
  const sink = (c, r) =>
    `<circle cx="${r2(c.x)}" cy="${r2(c.y)}" r="${r}" fill="#131518"/><circle cx="${r2(c.x)}" cy="${r2(c.y)}" r="${r}" fill="url(#${p}perl)"/>` +
    `<circle cx="${r2(c.x)}" cy="${r2(c.y)}" r="${r}" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="1.2"/>` +
    `<circle cx="${r2(c.x)}" cy="${r2(c.y)}" r="${r - 2.4}" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="2.4"/>`
  return layer(
    'plate',
    `<div class="plate"><i class="plate__stripes"></i><i class="plate__sheen"></i></div>` +
      full(
        sink(B, BALANCE_R + 9) +
          sink(F, 71) +
          sink(POS.barrel, 124) +
          gauge +
          `<path id="${p}rim" d="${arc(350, 211, 329)}" fill="none"/>` +
          `<text class="engrave engrave--rim"><textPath href="#${p}rim" startOffset="50%" text-anchor="middle">ATELIER ROUAGE · CALIBRE R·01 · VINGT ET UN RUBIS · BESANÇON</textPath></text>`
      ) +
      `<i class="anchor" data-anchor="plate" style="${at({ x: 250, y: -250 })}"></i>`
  )
}

function trainLayer(p) {
  const P = POS
  const shadow = (c, r) => `<circle cx="${r2(c.x + 3)}" cy="${r2(c.y + 5)}" r="${r}"/>`
  const A = POSE
  const clickAt = polar(P.barrel, 113, 24)
  return layer(
    'train',
    full(
      `<g fill="#000" opacity=".55" filter="url(#${p}soft)">${shadow(P.barrel, 120)}${shadow(P.centre, 72)}${shadow(P.third, 58)}${shadow(P.fourth, 62)}${shadow(P.escape, 34)}</g>`
    ) +
      rot('barrel', P.barrel, 126, barrelDrum(p), { turn: A.barrel }) +
      rot('ratchet', P.barrel, 100, ratchet(p)) +
      rot('click', clickAt, 24, clickPawl(p), { turn: 24 + 96 }) +
      rot('centre', P.centre, 76, metalWheel(p, { N: 64, R: 70, spokes: 5, pin: { n: MESH.barrel.n, r: MESH.barrel.r } }), { turn: A.centre }) +
      rot('third', P.third, 62, metalWheel(p, { N: 60, R: 56, spokes: 5, pin: { n: MESH.centre.n, r: MESH.centre.r } }), { turn: A.third }) +
      rot('fourth', P.fourth, 66, metalWheel(p, { N: 60, R: 60, spokes: 5, pin: { n: MESH.third.n, r: MESH.third.r } }), { turn: A.fourth }) +
      rot('escape', P.escape, 38, escapeWheel(p), { turn: A.escape }) +
      `<i class="anchor" data-anchor="train" style="${at(P.centre)}"></i>`
  )
}

const COCKS = [
  [{ x: 268, y: 128 }, 17, POS.centre, 12],
  [{ x: 236, y: 236 }, 16, POS.third, 11],
  [{ x: 118, y: 318 }, 16, POS.fourth, 11],
  [{ x: -30, y: 322 }, 14, POS.escape, 9.5],
]
const PALLET_BRIDGE = [[{ x: -104, y: 262 }, 10, POS.pallet, 7.5]]
const BALANCE_COCK = [[{ x: -228, y: 262 }, 20, POS.balance, 15.5]]

function bridgesLayer(p) {
  const feet = COCKS.map((c, i) => screw(p, c[0], 7.6, [18, -40, 72, 8][i])).join('')
  const jewels = COCKS.map((c) => jewel(p, c[2], 0.92)).join('')
  return layer(
    'bridges',
    rot('pallet', POS.pallet, 50, pallet(p), { turn: forkAngle(POSE.balance) }) +
      full(
        bridge(p, PALLET_BRIDGE, { bevel: 2.6 }) +
          jewel(p, POS.pallet, 0.62) +
          screw(p, PALLET_BRIDGE[0][0], 4.6, -20) +
          bridge(p, COCKS) +
          feet +
          jewels
      ) +
      `<i class="anchor" data-anchor="bridges" style="${at({ x: 236, y: 236 })}"></i>`
  )
}

function balanceLayer(p) {
  const B = POS.balance
  return layer(
    'balance',
    full(`<circle cx="${r2(B.x + 3)}" cy="${r2(B.y + 6)}" r="${BALANCE_R}" fill="none" stroke="#000" stroke-width="15" opacity=".5" filter="url(#${p}soft)"/>`) +
      rot('balance', B, BALANCE_R + 4, balanceWheel(p), { turn: POSE.balance }) +
      rot(
        'spring',
        B,
        48,
        `<path d="${spiral(SPRING.r0, SPRING.r1, SPRING.turns, POSE.balance, 240)}" fill="none" stroke="#3a55d9" stroke-width="1.15" stroke-linecap="round"/>`
      ) +
      `<i class="anchor" data-anchor="balance" style="${at(B)}"></i>`
  )
}

function cockLayer(p) {
  const B = POS.balance
  const stud = polar(B, SPRING.r1, SPRING.turns * 360)
  return layer(
    'cock',
    full(
      bridge(p, BALANCE_COCK) +
        screw(p, BALANCE_COCK[0][0], 8.6, 33) +
        `<rect x="${r2(stud.x - 3.4)}" y="${r2(stud.y - 3.4)}" width="6.8" height="6.8" rx="1.2" fill="url(#${p}steell)" stroke="#1c1e22" stroke-width=".6"/>` +
        `<g transform="translate(${r2(B.x)} ${r2(B.y)})"><circle r="11.6" fill="url(#${p}goldl)" stroke="#5c4212" stroke-opacity=".6" stroke-width=".5"/><circle r="7" fill="url(#${p}ruby)"/><circle cx="-2.1" cy="-2.4" r="1.6" fill="#fff" opacity=".85"/><path d="M-7.6 0A7.6 7.6 0 0 1 7.6 0M-4.6 5.9L0 2.4L4.6 5.9" fill="none" stroke="#e9ebee" stroke-width="1.15" stroke-linecap="round"/></g>`
    )
  )
}

function dialLayer(p) {
  const D = DIAL
  const F = POS.fourth
  let idx = ''
  for (let h = 0; h < 12; h++) {
    const bar = (x) =>
      `<rect x="${x + 1.2}" y="-160.4" width="6.6" height="29" fill="#000" opacity=".3"/>` +
      `<rect class="idx-a" x="${x}" y="-162" width="3.3" height="29"/><rect class="idx-b" x="${x + 3.3}" y="-162" width="3.3" height="29"/>`
    idx += `<g transform="rotate(${h * 30})">${h === 0 ? bar(-8.2) + bar(1.6) : bar(-3.3)}</g>`
  }
  const dial =
    `<div class="dial" style="left:${em(500 + D.x - D.r)};top:${em(500 + D.y - D.r)};width:${em(2 * D.r)};height:${em(2 * D.r)}">` +
    `<i class="dial__sun"></i><i class="dial__shade"></i>` +
    `<svg viewBox="${-D.r} ${-D.r} ${2 * D.r} ${2 * D.r}" aria-hidden="true" focusable="false">` +
    `<path class="dial-ink" d="${ticks(60, 173, 181, { skip: (i) => i % 5 === 0 })}" stroke-width="1"/>` +
    `<path class="dial-ink" d="${ticks(12, 168, 181)}" stroke-width="1.9"/>` +
    idx +
    `<text class="dial-logo" y="-66" text-anchor="middle">ROUAGE</text>` +
    `<text class="dial-sub" y="-50" text-anchor="middle">BESANÇON</text>` +
    `<text class="dial-sub" y="86" text-anchor="middle">R · 01</text>` +
    `<circle r="${D.r - 1.6}" fill="none" stroke="url(#${p}steell)" stroke-width="3.2"/>` +
    `<circle r="${D.r - 3.6}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1"/>` +
    `</svg></div>`
  const seconds =
    `<path d="${circle(66)}${circle(45)}" fill="#0d0f12" fill-opacity=".66" fill-rule="evenodd"/>` +
    `<circle r="66" fill="none" stroke="url(#${p}steell)" stroke-width="2.6"/><circle r="45" fill="none" stroke="url(#${p}steell)" stroke-width="1.5"/>` +
    `<path d="${ticks(60, 57, 62, { skip: (i) => i % 5 === 0 })}" stroke="#f3f3f0" stroke-opacity=".8" stroke-width=".9"/>` +
    `<path d="${ticks(12, 52, 62)}" stroke="#f3f3f0" stroke-width="1.7"/>`
  return layer(
    'dial',
    `<i class="dial-shadow" style="left:${em(500 + D.x - D.r)};top:${em(500 + D.y - D.r)};width:${em(2 * D.r)};height:${em(2 * D.r)}"></i>` +
      dial +
      `<svg class="at" viewBox="-70 -70 140 140" style="left:${em(500 + F.x - 70)};top:${em(500 + F.y - 70)};width:${em(140)};height:${em(140)}" aria-hidden="true" focusable="false">${seconds}</svg>` +
      `<i class="anchor" data-anchor="dial" style="${at({ x: D.x + 120, y: D.y - 70 })}"></i>`
  )
}

function handsLayer(p) {
  const D = DIAL
  const hour = dauphine(108, 17, 22)
  const minute = dauphine(158, 13.5, 26)
  const hand = (h) => `<path class="hand-a" d="${h.left}"/><path class="hand-b" d="${h.right}"/><path d="${h.all}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width=".5"/>`
  const shade = (h) => `<path d="${h.all}" fill="#000" opacity=".4" filter="url(#${p}soft)"/>`
  const sec = `M-1 15L-1 -48L0 -57L1 -48L1 15Z`
  const lift = (c, dx, dy) => ({ x: c.x + dx, y: c.y + dy })
  const G = GAUGE
  const reserveTurn = G.from + (G.to - G.from) * POSE.reserve - 270
  return layer(
    'hands',
    rot('reserve', G, 80, `<path d="M-1.3 12L-1.3 -${G.r - 6}L0 -${G.r}L1.3 -${G.r - 6}L1.3 12Z" fill="url(#${p}blued)"/><circle r="5" fill="url(#${p}steel)" stroke="#000" stroke-opacity=".4" stroke-width=".5"/><circle r="1.6" fill="#22252a"/>`, { turn: reserveTurn }) +
      rot('hour-shadow', lift(D, 3, 6), 170, shade(hour), { turn: POSE.hour, cls: 'rot--shadow' }) +
      rot('minute-shadow', lift(D, 4, 8), 170, shade(minute), { turn: POSE.minute, cls: 'rot--shadow' }) +
      rot('hour', D, 170, hand(hour), { turn: POSE.hour }) +
      rot('minute', D, 170, hand(minute) + `<circle r="7.4" fill="url(#${p}steel)" stroke="#000" stroke-opacity=".45" stroke-width=".5"/><circle r="2.5" fill="#24272b"/>`, { turn: POSE.minute }) +
      rot('second', POS.fourth, 62, `<path d="${sec}" class="hand-sec"/><circle cy="15" r="4.2" class="hand-sec"/><circle r="4" fill="url(#${p}steel)" stroke="#000" stroke-opacity=".45" stroke-width=".5"/><circle r="1.3" fill="#24272b"/>`, { turn: POSE.second }) +
      `<i class="anchor" data-anchor="hands" style="${at({ x: D.x + 70, y: D.y - 110 })}"></i>`
  )
}

function bezelLayer(p) {
  const C = CASE
  const mid = (C.plate + C.opening) / 2
  return layer(
    'bezel',
    full(
      `<circle r="${mid}" fill="none" stroke="#17191c" stroke-width="${C.opening - C.plate + 1}"/>` +
        `<circle r="${C.plate + 0.8}" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1.1"/>` +
        `<path d="${ticks(60, C.plate + 6, C.opening - 6)}" stroke="#fff" stroke-opacity=".28" stroke-width="1"/>`
    ) +
      `<div class="bezel"><i class="bezel__shine"></i></div>` +
      full(
        `<circle r="${C.opening + 0.8}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.3"/>` +
          `<circle r="${C.opening + 14}" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="1"/>` +
          `<circle r="${C.r - 0.8}" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="1.4"/>`
      ) +
      `<i class="anchor" data-anchor="bezel" style="${at({ x: 300, y: -290 })}"></i>`
  )
}

function bandLayers() {
  let s = ''
  for (let k = 0; k < BAND.n; k++) {
    const z = BAND.from + k * BAND.step
    const h = Math.abs(z + 20) // height above the crown's axis
    const crown = h < 52 ? `<i class="crown" style="--ch:${r2(Math.sqrt(52 * 52 - h * h) / 5)}em"></i>` : ''
    const slope = Math.max(0, (z - -10) / 40) // lugs fall away towards their tips
    s += layer(
      'band',
      `<i class="lug lug--tl"></i><i class="lug lug--tr"></i><i class="lug lug--bl"></i><i class="lug lug--br"></i>${crown}<i class="band__ring"></i>` +
        (k === BAND.n - 1 ? `<i class="anchor" data-anchor="band" style="${at({ x: 330, y: 300 })}"></i>` : ''),
      z,
      { style: `--k:${r2(k / (BAND.n - 1))};--slope:${r2(slope)}`, attrs: ` data-k="${k}"` }
    )
  }
  return s
}

/**
 * The whole watch.
 *  id    prefix for gradient ids, unique on the page
 *  lite  leave out the parts only seen when the watch is taken apart
 */
export function watchMarkup({ id = 'w', lite = false } = {}) {
  const p = id + '-'
  const band = lite
    ? layer('band', `<i class="lug lug--tl"></i><i class="lug lug--tr"></i><i class="lug lug--bl"></i><i class="lug lug--br"></i><i class="crown" style="--ch:10.4em"></i><i class="band__ring"></i>`, 30, { style: '--k:1;--slope:1', attrs: ' data-k="10"' })
    : bandLayers()
  return (
    `<div class="watch" data-watch="${id}">${defs(p)}<i class="watch__shadow"></i>` +
    `<div class="watch__tilt"><div class="watch__stack">` +
    layer('strap', `<i class="strap strap--top"></i><i class="strap strap--bottom"></i>`) +
    (lite ? '' : layer('back', `<i class="caseback"></i><i class="anchor" data-anchor="back" style="${at({ x: 310, y: 300 })}"></i>`)) +
    band +
    plateLayer(p) +
    trainLayer(p) +
    bridgesLayer(p) +
    balanceLayer(p) +
    cockLayer(p) +
    dialLayer(p) +
    handsLayer(p) +
    bezelLayer(p) +
    layer('crystal', `<div class="crystal"><i class="crystal__glare"></i><i class="crystal__glare crystal__glare--2"></i></div><i class="anchor" data-anchor="crystal" style="${at({ x: 240, y: -240 })}"></i>`) +
    `<button class="crown-hit" type="button" data-crown aria-label="Wind the watch"></button>` +
    `</div></div></div>`
  )
}
