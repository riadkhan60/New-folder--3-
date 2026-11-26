/**
 * watch.js — makes a drawn watch run.
 *
 * The markup comes from markup.js (written into the page at build time, at
 * 10:10:30). createWatch() finds its parts and, every frame, turns them to
 * where a real movement would have them: the hands from the local time, the
 * train from the beat count, the balance, fork and hairspring from the phase
 * of the current beat.
 *
 *   const w = createWatch(el)
 *   w.frame(now)                 call every animation frame (ms)
 *   w.start()                    sweep the hands from the pose to the time
 *   w.light(x, y)                where the light is, -1 … 1 (also tilts it)
 *   w.idle(true)                 let the light drift on its own
 *   w.pose({ rx, rz, apart, gap })  tilt it and lift its layers apart
 *   w.wind(clicks)               wind the mainspring
 *   w.lift(layer)                0 … 1, how far a layer has lifted
 */
import { BEATS, RESERVE_H, LAYERS, SPRING, GAUGE, trainAngles, beatState, forkAngle, handAngles, amplitudeFor } from './train.js'
import { spiral } from './parts.js'

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const mod = (v, m) => ((v % m) + m) % m
const smooth = (t) => t * t * (3 - 2 * t)
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

const POSE_T = 10 * 3600 + 10 * 60 + 30 // the time the markup shows
const HALF_DAY = 43200
const INTRO_MS = 2100
const TILT = 7 // degrees of tilt at the edge of the light's range
const RATCHET_STEP = 360 / 54

/** Seconds since local midnight. */
export function localSeconds(d = new Date()) {
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000
}

export function createWatch(root, { reduced = false, onWind = null, reserve = 41.8 } = {}) {
  const part = {}
  root.querySelectorAll('[data-part]').forEach((el) => (part[el.dataset.part] = el))
  const layers = [...root.querySelectorAll('.wl')].map((el) => ({
    el,
    name: el.dataset.layer,
    z: +el.dataset.z,
    o: LAYERS[el.dataset.layer].o,
    lift: 0,
  }))
  const orders = Object.values(LAYERS).map((l) => l.o)
  const oMin = Math.min(...orders)
  const oSpan = Math.max(...orders) - oMin
  const tilt = root.querySelector('.watch__tilt')
  const springPath = part.spring?.querySelector('path')
  const crown = root.querySelector('[data-crown]')

  const S = {
    visible: true,
    intro: reduced ? 1 : 0, // 0 = still in its portrait pose, 1 = running on the time
    introAt: null,
    reserve,
    reserveShown: reserve,
    lx: 0,
    ly: 0,
    tx: 0,
    ty: 0,
    idle: true,
    rx: 0,
    rz: 0,
    apart: 0,
    gap: 90,
    ratchet: 0,
    ratchetShown: 0,
    kick: 0,
    crown: 0,
  }

  /* The time, as a count of seconds that never jumps: the local time when
     the page opened, carried forward by the monotonic clock. `ahead` is how
     far the hands must travel from the pose to show it. */
  let t0 = performance.now()
  let ahead = mod(localSeconds() - POSE_T, HALF_DAY)
  const clock = (now) => POSE_T + ahead + (now - t0) / 1000

  const shown = new Map()
  const turn = (el, deg) => {
    if (!el) return
    const v = Math.round(mod(deg, 360) * 100) / 100
    if (shown.get(el) === v) return
    shown.set(el, v)
    el.style.transform = `rotate(${v}deg)`
  }

  let lightKey = ''
  let layoutKey = ''
  let deep = false

  function layout() {
    const key = S.apart.toFixed(4) + '|' + S.gap.toFixed(2)
    if (key === layoutKey) return
    layoutKey = key
    for (const L of layers) {
      const rank = (L.o - oMin) / oSpan // 1 = the top of the watch, which lifts first
      L.lift = smooth(clamp((S.apart - (1 - rank) * 0.42) / 0.58))
      L.el.style.transform = `translateZ(${((L.z + L.o * S.gap * L.lift) / 10).toFixed(3)}em)`
    }
    root.style.setProperty('--apart', S.apart.toFixed(3))
    root.toggleAttribute('data-apart', S.apart > 0.02)
  }

  function frame(now) {
    if (!S.visible) return
    const g = clock(now)

    /* the hands: live, or sweeping forward from the pose */
    let T = g
    let running = true
    if (S.intro < 1) {
      if (S.introAt == null) {
        T = POSE_T
      } else {
        S.intro = clamp((now - S.introAt) / INTRO_MS)
        T = POSE_T + (g - POSE_T) * inOut(S.intro)
      }
      running = S.intro >= 1
    }

    /* the escapement: the balance swings on the real beat throughout */
    const b = beatState(g * BEATS)
    const A = trainAngles(running ? b.steps : T * BEATS)
    turn(part.fourth, A.fourth)
    turn(part.second, A.fourth)
    turn(part.escape, A.escape)
    turn(part.third, A.third)
    turn(part.centre, A.centre)
    turn(part.barrel, A.barrel)
    const h = handAngles(T)
    turn(part.hour, h.hour)
    turn(part['hour-shadow'], h.hour)
    turn(part.minute, h.minute)
    turn(part['minute-shadow'], h.minute)

    const bal = amplitudeFor(S.reserve) * b.swing
    turn(part.balance, bal)
    turn(part.pallet, forkAngle(bal))
    if (springPath) springPath.setAttribute('d', spiral(SPRING.r0, SPRING.r1, SPRING.turns, bal, 110))

    /* winding: the ratchet turns a tooth at a time and its click jumps */
    S.ratchetShown = lerp(S.ratchetShown, S.ratchet, 0.4)
    turn(part.ratchet, S.ratchetShown)
    S.kick *= 0.62
    turn(part.click, 120 - S.kick * 11)
    S.reserveShown = lerp(S.reserveShown, S.reserve, 0.12)
    turn(part.reserve, GAUGE.from + (GAUGE.to - GAUGE.from) * (S.reserveShown / RESERVE_H) + 90)

    /* light and tilt */
    if (S.idle) {
      const t = now / 1000
      S.tx = Math.sin(t * 0.31) * 0.6
      S.ty = Math.sin(t * 0.23 + 1.1) * 0.42
    }
    S.lx = lerp(S.lx, S.tx, 0.06)
    S.ly = lerp(S.ly, S.ty, 0.06)
    // the flank of the case is only drawn in full once the watch leans back
    const lean = S.rx > 2 || S.apart > 0.01
    if (lean !== deep) {
      deep = lean
      root.toggleAttribute('data-deep', deep)
    }
    const key = (S.lx * 250).toFixed(0) + '|' + (S.ly * 250).toFixed(0)
    if (key !== lightKey) {
      lightKey = key
      root.style.setProperty('--lx', S.lx.toFixed(3))
      root.style.setProperty('--ly', S.ly.toFixed(3))
    }
    const k = TILT * (1 - 0.8 * S.apart)
    tilt.style.transform = `rotateX(${(S.rx - S.ly * k).toFixed(3)}deg) rotateY(${(S.lx * k * 1.2).toFixed(3)}deg) rotateZ(${S.rz.toFixed(3)}deg)`
    layout()
  }

  function wind(clicks = 1) {
    if (S.reserve >= RESERVE_H) {
      S.kick = 0.4 // fully wound: the crown stops against the spring
      return S.reserve
    }
    S.reserve = clamp(S.reserve + clicks * 0.8, 0, RESERVE_H)
    S.ratchet += clicks * RATCHET_STEP
    S.kick = 1
    S.crown += clicks * 0.28
    root.style.setProperty('--crown-turn', S.crown.toFixed(2) + 'em')
    onWind?.(S.reserve)
    return S.reserve
  }

  /* the crown: drag it, or use the keyboard */
  if (crown) {
    let drag = null
    crown.addEventListener('pointerdown', (e) => {
      drag = { y: e.clientY, acc: 0 }
      try {
        crown.setPointerCapture(e.pointerId)
      } catch {}
      e.preventDefault()
    })
    crown.addEventListener('pointermove', (e) => {
      if (!drag) return
      drag.acc += Math.abs(e.clientY - drag.y)
      drag.y = e.clientY
      while (drag.acc >= 8) {
        drag.acc -= 8
        wind(1)
      }
    })
    const end = () => (drag = null)
    crown.addEventListener('pointerup', end)
    crown.addEventListener('pointercancel', end)
    crown.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        wind(1)
      }
    })
    crown.addEventListener('click', (e) => {
      if (e.detail === 0) return // keyboard activation is handled above
      wind(1)
    })
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => (S.visible = e.isIntersecting), { rootMargin: '20%' }).observe(root)
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return
    // re-read the wall clock after a sleep; the hands must agree with it
    t0 = performance.now()
    ahead = mod(localSeconds() - POSE_T, HALF_DAY)
  })

  layout()

  return {
    el: root,
    state: S,
    frame,
    wind,
    /** Seconds since local midnight as this watch shows them. */
    time: (now = performance.now()) => mod(clock(now), 86400),
    running: () => S.intro >= 1,
    start(now = performance.now()) {
      if (S.intro < 1 && S.introAt == null) S.introAt = now
    },
    light(x, y) {
      S.idle = false
      S.tx = clamp(x, -1, 1)
      S.ty = clamp(y, -1, 1)
    },
    idle(on = true) {
      S.idle = on
    },
    pose({ rx = S.rx, rz = S.rz, apart = S.apart, gap = S.gap } = {}) {
      S.rx = rx
      S.rz = rz
      S.apart = apart
      S.gap = gap
    },
    lift: (name) => layers.find((l) => l.name === name)?.lift ?? 0,
    anchor: (name) => root.querySelector(`[data-anchor="${name}"]`),
  }
}
