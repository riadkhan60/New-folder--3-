/**
 * parts.js — draws the parts of a watch movement as SVG path data and markup.
 *
 * Pure string functions with no DOM, so the build can run them in Node and
 * the page never has to draw the watch before it can show it.
 *
 * Shapes are drawn around their own centre (0, 0) in watch units; gears have
 * a tooth pointing along +x.
 */

export const r2 = (v) => Math.round(v * 100) / 100
const pt = (r, a) => `${r2(r * Math.cos(a))} ${r2(r * Math.sin(a))}`
const TAU = Math.PI * 2

export const circle = (r, cx = 0, cy = 0) =>
  `M${r2(cx + r)} ${r2(cy)}A${r2(r)} ${r2(r)} 0 1 1 ${r2(cx - r)} ${r2(cy)}A${r2(r)} ${r2(r)} 0 1 1 ${r2(cx + r)} ${r2(cy)}Z`

/** Outline of a toothed wheel: N teeth on pitch radius R. */
export function gearOutline(N, R, o = {}) {
  const { add = 0.95, ded = 1.2, hr = 0.3, hp = 0.25, ht = 0.1 } = o
  const m = (2 * R) / N
  const rt = R + add * m
  const rr = R - ded * m
  const pitch = TAU / N
  let d = ''
  for (let k = 0; k < N; k++) {
    const a = k * pitch
    d +=
      (k ? 'L' : 'M') +
      pt(rr, a - hr * pitch) +
      'L' +
      pt(R, a - hp * pitch) +
      'L' +
      pt(rt, a - ht * pitch) +
      'L' +
      pt(rt, a + ht * pitch) +
      'L' +
      pt(R, a + hp * pitch) +
      'L' +
      pt(rr, a + hr * pitch)
  }
  return { d: d + 'Z', rt, rr, m }
}

/** The openings between S spokes, from hub radius rh out to rim radius ri. */
export function windows(S, rh, ri, hw1, hw2, s0 = 0) {
  let d = ''
  for (let k = 0; k < S; k++) {
    const a0 = s0 + (k * TAU) / S
    const a1 = s0 + ((k + 1) * TAU) / S
    const i0 = a0 + Math.asin(Math.min(0.95, hw1 / rh))
    const o0 = a0 + Math.asin(hw2 / ri)
    const o1 = a1 - Math.asin(hw2 / ri)
    const i1 = a1 - Math.asin(Math.min(0.95, hw1 / rh))
    d +=
      `M${pt(rh, i0)}L${pt(ri, o0)}A${r2(ri)} ${r2(ri)} 0 ${o1 - o0 > Math.PI ? 1 : 0} 1 ${pt(ri, o1)}` +
      `L${pt(rh, i1)}A${r2(rh)} ${r2(rh)} 0 ${i1 - i0 > Math.PI ? 1 : 0} 0 ${pt(rh, i0)}Z`
  }
  return d
}

/** A toothed wheel with a rim, spokes and a hub: one even-odd path. */
export function wheelBody({ N, R, spokes = 5, hub = 0.2, rim = 0.12, s0 = 0 }) {
  const g = gearOutline(N, R)
  const ri = g.rr - R * rim
  const rh = Math.max(4.5, R * hub)
  return { d: g.d + windows(spokes, rh, ri, rh * 0.4, Math.max(1.6, R * 0.04), s0), ri, rh, rr: g.rr, rt: g.rt }
}

/**
 * The escape wheel: 15 slim club teeth that lean the way the wheel turns.
 * Each tooth ends in a foot whose leading corner (the "toe", at `TOE` of a
 * pitch ahead of the tooth) is what the pallet stones lock.
 */
export const TOE = 0.46
export function escapeBody(R, { teeth = 15, dir = -1 } = {}) {
  const pitch = TAU / teeth
  const r0 = R * 0.7
  const seq = [
    [r0, -0.16],
    [R * 0.9, 0.22],
    [R * 0.975, 0.19],
    [R, TOE],
    [R * 0.905, 0.43],
    [R * 0.86, 0.33],
    [r0, 0.05],
  ]
  let d = ''
  for (let k = 0; k < teeth; k++) {
    const a = dir * k * pitch
    seq.forEach(([r, f], i) => (d += (k || i ? 'L' : 'M') + pt(r, a + dir * f * pitch)))
  }
  const ri = r0 - R * 0.1
  const rh = R * 0.2
  return { d: d + 'Z' + windows(5, rh, ri, rh * 0.36, 1.3), r0, ri, rh }
}

/** A plain wheel with no teeth (the balance): rim, spokes, hub. */
export function balanceBody(R, { spokes = 3, rimW = 0.15, hub = 0.13 } = {}) {
  const ri = R * (1 - rimW)
  const rh = R * hub
  return { d: circle(R) + windows(spokes, rh, ri, rh * 0.5, R * 0.035, -Math.PI / 2), ri, rh }
}

/**
 * A hairspring: `turns` coils from radius r0 to r1. `twist` (degrees) turns
 * the inner end with the balance while the outer end stays pinned.
 */
export function spiral(r0, r1, turns, twist = 0, n = 150) {
  const tw = (twist * Math.PI) / 180
  let d = ''
  for (let i = 0; i <= n; i++) {
    const s = i / n
    const a = s * turns * TAU + tw * (1 - s)
    const r = r0 + (r1 - r0) * s
    d += (i ? 'L' : 'M') + pt(r, a)
  }
  return d
}

/** A mainspring in its barrel: coils sit near the arbor when wound, near the wall when run down. */
export function mainspring(r0, r1, turns, wound, n = 260) {
  const g = 0.45 + 1.75 * wound // > 1 crowds the coils inwards
  let d = ''
  for (let i = 0; i <= n; i++) {
    const s = i / n
    const r = r0 + (r1 - r0) * Math.pow(s, g)
    d += (i ? 'L' : 'M') + pt(r, s * turns * TAU)
  }
  return d
}

/** The outline of two circles joined by their outer tangents: a finger. */
export function capsule(a, ra, b, rb) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const d = Math.hypot(dx, dy)
  if (d <= Math.abs(ra - rb) + 1e-6) return ra >= rb ? circle(ra, a.x, a.y) : circle(rb, b.x, b.y)
  const th = Math.atan2(dy, dx)
  const be = Math.acos((ra - rb) / d)
  const P = (c, r, ang) => `${r2(c.x + r * Math.cos(ang))} ${r2(c.y + r * Math.sin(ang))}`
  return (
    `M${P(a, ra, th + be)}A${r2(ra)} ${r2(ra)} 0 ${TAU - 2 * be > Math.PI ? 1 : 0} 1 ${P(a, ra, th - be)}` +
    `L${P(b, rb, th - be)}A${r2(rb)} ${r2(rb)} 0 ${2 * be > Math.PI ? 1 : 0} 1 ${P(b, rb, th + be)}Z`
  )
}

/** Several fingers as one shape, optionally shrunk inwards by `inset`. */
export const fingers = (caps, inset = 0) =>
  caps.map(([a, ra, b, rb]) => capsule(a, Math.max(0.6, ra - inset), b, Math.max(0.6, rb - inset))).join('')

/** The two facets of a dauphine hand pointing up (towards -y). */
export function dauphine(len, w, tail) {
  return {
    left: `M0 ${-len}L${-w / 2} 0L0 ${tail}Z`,
    right: `M0 ${-len}L${w / 2} 0L0 ${tail}Z`,
    all: `M0 ${-len}L${w / 2} 0L0 ${tail}L${-w / 2} 0Z`,
  }
}

/** Tick marks on a circle: `n` of them between radii a and b, every `major`th longer. */
export function ticks(n, a, b, { major = 0, a2 = a, skip = () => false, from = -90 } = {}) {
  let d = ''
  for (let i = 0; i < n; i++) {
    if (skip(i)) continue
    const ang = ((from + (i * 360) / n) * Math.PI) / 180
    const inner = major && i % major === 0 ? a2 : a
    d += `M${pt(inner, ang)}L${pt(b, ang)}`
  }
  return d
}

/** An arc as path data, clockwise from angle a0 to a1 (degrees). */
export function arc(r, a0, a1, cx = 0, cy = 0) {
  const A = (a0 * Math.PI) / 180
  const B = (a1 * Math.PI) / 180
  const p = (ang) => `${r2(cx + r * Math.cos(ang))} ${r2(cy + r * Math.sin(ang))}`
  return `M${p(A)}A${r2(r)} ${r2(r)} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${p(B)}`
}
