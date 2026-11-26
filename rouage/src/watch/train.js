/**
 * train.js — the geometry and kinematics of calibre R-01.
 *
 * Pure data and maths, with no DOM: the build imports it to draw the watch
 * into index.html, and the page imports it to make the watch run.
 *
 * Units: the watch is drawn in a 1000 x 1000 box with the origin at the centre
 * of the case, x to the right and y down. Angles are in degrees, clockwise
 * from the +x axis (the same sense as a CSS rotation).
 */

export const D2R = Math.PI / 180
export const polar = (p, d, deg) => ({ x: p.x + d * Math.cos(deg * D2R), y: p.y + d * Math.sin(deg * D2R) })
export const angleTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) / D2R

/** A wheel of N teeth and pitch radius R driving a pinion of n leaves. */
const mesh = (N, n, R) => {
  const m = (2 * R) / N
  return { N, n, R, m, r: (m * n) / 2, dist: R + (m * n) / 2 }
}

export const BEATS = 5 // beats a second: 18,000 vibrations an hour (2.5 Hz)
export const ESC_TEETH = 15
export const RESERVE_H = 72 // hours of running on a full wind
export const AMPLITUDE = 264 // degrees the balance swings each way at full power
export const FORK_DEG = 9 // how far the pallet fork swings each way

export const MESH = {
  barrel: mesh(72, 10, 118), // 1 turn in 7.2 h
  centre: mesh(64, 8, 70), // 1 turn an hour
  third: mesh(60, 8, 56), // 1 turn in 7.5 min
  fourth: mesh(60, 6, 60), // 1 turn a minute; carries the seconds hand
}

/* ---- where everything sits -------------------------------------------- */

export const CASE = { r: 440, opening: 392, plate: 372 }
export const DIAL = { x: 0, y: -110, r: 190 }

const balance = { x: -135, y: 185 }
const AXIS = 15 // the line balance → pallet fork → escape wheel
const pallet = polar(balance, 55, AXIS)
const escape = polar(balance, 94, AXIS)
const fourth = polar(escape, MESH.fourth.dist, -10)
const third = polar(fourth, MESH.third.dist, -35)
const centre = polar(third, MESH.centre.dist, -60)
const barrel = polar(centre, MESH.barrel.dist, -69.5)

export const POS = { barrel, centre, third, fourth, escape, pallet, balance }
export const AXIS_DEG = AXIS
export const ESC_R = 34 // tip radius of the escape wheel
export const BALANCE_R = 92
export const GAUGE = { x: -216, y: -104, r: 66, from: 138, to: 222 } // power-reserve hand

/** Height of each layer when the watch is closed (units), and its place in the take-apart order. */
export const LAYERS = {
  crystal: { z: 41, o: 5 },
  bezel: { z: 34, o: 4 },
  hands: { z: 25, o: 3 },
  dial: { z: 18, o: 2 },
  cock: { z: 14, o: 1.2 },
  balance: { z: 11, o: 1 },
  bridges: { z: 8, o: 0.42 },
  train: { z: 4, o: 0 },
  plate: { z: 0, o: -1 },
  band: { z: 0, o: -2 },
  strap: { z: -38, o: -2 },
  back: { z: -74, o: -3 },
}
export const BAND = { n: 11, from: -70, step: 10 } // the case middle is a stack of slices
export const SPRING = { r0: 8, r1: 44, turns: 7.5 } // the hairspring

/* ---- kinematics -------------------------------------------------------- */

/**
 * Phase that makes two gears mesh. Both are drawn with a tooth pointing along
 * +x at rotation 0. If gear 1 (N1 teeth) is turned by a, gear 2 (N2 teeth),
 * which sits in direction `alpha` from gear 1, must be turned by
 * -a * N1 / N2 + phase(N1, N2, alpha).
 */
const phase = (N1, N2, alpha) => alpha * (1 + N1 / N2) + 180 * (1 - 1 / N2)

const PH = {
  escape: phase(MESH.fourth.N, MESH.fourth.n, angleTo(fourth, escape)),
  fourth: phase(MESH.third.N, MESH.third.n, angleTo(third, fourth)),
  third: phase(MESH.centre.N, MESH.centre.n, angleTo(centre, third)),
  centre: phase(MESH.barrel.N, MESH.barrel.n, angleTo(barrel, centre)),
}

/** Rotation of every wheel after `steps` beats (may be fractional). */
export function trainAngles(steps) {
  const f = steps * (360 / (60 * BEATS)) // the fourth wheel: 1.2° a beat
  const e = -f * (MESH.fourth.N / MESH.fourth.n) + PH.escape
  const t = (PH.fourth - f) * (MESH.third.n / MESH.third.N)
  const c = (PH.third - t) * (MESH.centre.n / MESH.centre.N)
  const b = (PH.centre - c) * (MESH.barrel.n / MESH.barrel.N)
  return { fourth: f, escape: e, third: t, centre: c, barrel: b }
}

/* ---- the escapement ------------------------------------------------------ */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const mod = (v, m) => ((v % m) + m) % m

/** Balance swing, either side of centre, during which its pin carries the fork across. */
export const LIFT = 36.3
const FORK_K = Math.sin(FORK_DEG * D2R) / Math.sin(LIFT * D2R)

/**
 * The pallet fork follows the balance: its pin sits in the fork's notch while
 * the balance is within LIFT of centre, and the fork rests against its
 * banking the rest of the time. Degrees, clockwise.
 */
export const forkAngle = (balance) => -Math.asin(FORK_K * Math.sin(clamp(balance, -LIFT, LIFT) * D2R)) / D2R

/**
 * Where the pallet stones catch the escape wheel, as angles about the wheel:
 * the entry stone locks a tooth at `entry` on even beats, the exit stone
 * locks one two and a half teeth further round on odd beats.
 */
const TOOTH = 360 / ESC_TEETH
export const LOCK = { entry: 228, exit: 228 - 2.5 * TOOTH, depth: 0.9 }
/** Turn of the escape teeth relative to their pinion that puts a toe on the entry stone at rest. */
export const escapePhase = (toe) => mod(LOCK.entry - PH.escape + toe * TOOTH, TOOTH)

const cubicOut = (t) => 1 - (1 - t) ** 3

/**
 * The state of the escapement at phase p, counted in beats. The balance
 * crosses centre at every whole p.
 *  swing  -1 … 1, where the balance is in its swing
 *  steps  how far the train has advanced: it moves only while the fork
 *         crosses, unlocking one stone and dropping onto the other
 */
export function beatState(p) {
  const k = Math.round(p)
  const s = Math.sin(Math.PI * (p - k)) // towards +1 after the crossing
  const travel = clamp((AMPLITUDE * s + LIFT) / (2 * LIFT), 0, 1)
  const e = cubicOut(clamp((travel - 0.3) / 0.56, 0, 1))
  return { n: k, steps: k + e, swing: Math.sin(Math.PI * p) }
}

/** Hands for a time of day in seconds: degrees clockwise from 12. */
export function handAngles(t) {
  return { hour: (t / 43200) * 360, minute: (t / 3600) * 360 }
}

/** How far the balance swings for a given power reserve (hours). */
export function amplitudeFor(reserve) {
  const k = Math.max(0, Math.min(1, reserve / 6))
  return AMPLITUDE * Math.sqrt(k) * (0.82 + 0.18 * Math.min(1, reserve / RESERVE_H))
}
