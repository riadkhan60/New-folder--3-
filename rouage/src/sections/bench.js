/**
 * bench.js — the going train on the bench.
 *
 * The same kinematics as the watch (train.js), with its own clock so the
 * visitor can bend time: slow motion to follow a single beat, time-lapse to
 * watch the mainspring run down, and a button to wind it again. When the
 * spring is empty the balance loses its swing and the train stops.
 */
import { BEATS, RESERVE_H, AMPLITUDE, SPRING, trainAngles, beatState, forkAngle, amplitudeFor } from '../watch/train.js'
import { spiral, mainspring } from '../watch/parts.js'

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const mod = (v, m) => ((v % m) + m) % m
const pad = (n) => String(n).padStart(2, '0')
const MAINSPRING = { r0: 17, r1: 97, turns: 11 }
const WIND_RATE = 9 // hours of reserve per second of winding
// degrees a second, at real speed
const SPEED = { escape: 60, fourth: 6, third: 0.8, centre: 0.1, barrel: 1 / 72 }

export function initBench(ctx) {
  const view = document.querySelector('[data-bench]')
  const board = view?.querySelector('[data-board]')
  if (!board) return
  const section = view.closest('section')
  const part = {}
  board.querySelectorAll('[data-part]').forEach((el) => (part[el.dataset.part] = el))
  const hairspring = part.spring.querySelector('path')
  const springPath = board.querySelector('[data-mainspring]')

  const out = {
    reserve: section.querySelector('[data-b-reserve]'),
    beats: section.querySelector('[data-b-beats]'),
    time: section.querySelector('[data-b-time]'),
    amp: section.querySelector('[data-b-amp]'),
    status: section.querySelector('[data-b-status]'),
    meter: section.querySelector('[data-meter]'),
  }
  const meterBar = out.meter.querySelector('i')
  const windBtn = section.querySelector('[data-wind]')
  const zoomBtn = section.querySelector('[data-zoom]')
  const soundBtn = section.querySelector('[data-sound]')

  const S = {
    visible: false,
    warp: 1,
    T: 0, // seconds the movement has run
    pv: 150, // phase of the balance, in beats
    off: 0, // how far the train is ahead of the balance's count (it runs ahead in time-lapse)
    stepK: 1, // 1 = the train moves in steps, 0 = it glides (time-lapse)
    reserve: 41.8,
    amp: AMPLITUDE,
    winding: false,
    last: 0,
    drawn: -1,
    beat: 150,
  }

  const shown = new Map()
  const turn = (el, deg) => {
    const v = Math.round(mod(deg, 360) * 100) / 100
    if (shown.get(el) === v) return
    shown.set(el, v)
    el.style.transform = `rotate(${v}deg)`
  }
  const blurShown = new Map()
  const blur = (el, speed) => {
    const b = Math.round(clamp((speed - 520) / 680) * 20) / 20
    if (blurShown.get(el) === b) return
    blurShown.set(el, b)
    el.style.setProperty('--blur', b)
  }

  /* ---- sound: a tick for each beat, made on the spot ---- */
  let audio = null
  let soundOn = false
  function tick(even) {
    if (!audio) return
    const t = audio.currentTime
    const len = Math.floor(audio.sampleRate * 0.022)
    const buf = audio.createBuffer(1, len, audio.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
    const src = audio.createBufferSource()
    src.buffer = buf
    const band = audio.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = even ? 4300 : 3300
    band.Q.value = 2.2
    const gain = audio.createGain()
    gain.gain.value = 0.5
    src.connect(band).connect(gain).connect(audio.destination)
    src.start(t)
  }
  soundBtn?.addEventListener('click', () => {
    soundOn = !soundOn
    if (soundOn && !audio) {
      try {
        audio = new (window.AudioContext || window.webkitAudioContext)()
      } catch {
        soundOn = false
      }
    }
    audio?.[soundOn ? 'resume' : 'suspend']?.()
    soundBtn.setAttribute('aria-pressed', String(soundOn))
    soundBtn.textContent = soundOn ? 'Sound on' : 'Sound off'
  })

  /* ---- the frame ---- */
  let status = ''
  let readAt = 0
  function frame(now) {
    if (!S.visible) {
      S.last = now
      return
    }
    const dt = Math.min(0.1, (now - (S.last || now)) / 1000)
    S.last = now

    if (S.winding) S.reserve = Math.min(RESERVE_H, S.reserve + dt * WIND_RATE)
    const target = S.reserve > 0 ? amplitudeFor(S.reserve) : 0
    S.amp = lerp(S.amp, target, 1 - Math.exp(-dt * (target > S.amp ? 2.2 : 3.5)))
    const running = S.amp > 14
    const rate = running ? S.warp : 0

    const dT = dt * rate
    S.T += dT
    S.reserve = Math.max(0, S.reserve - dT / 3600)

    // the balance keeps its own rate in time-lapse; the train runs ahead of it
    const fast = S.warp > 1.5
    const dpv = dt * BEATS * (running ? Math.min(S.warp, 1) : 0)
    S.pv += dpv
    S.off += dT * BEATS - dpv
    S.stepK = lerp(S.stepK, fast ? 0 : 1, 1 - Math.exp(-dt * 8))

    const b = beatState(S.pv)
    const steps = S.off + lerp(S.pv, b.steps, S.stepK)
    const A = trainAngles(steps)
    turn(part.fourth, A.fourth)
    turn(part.escape, A.escape)
    turn(part.third, A.third)
    turn(part.centre, A.centre)
    turn(part.barrel, A.barrel)
    for (const k in SPEED) blur(part[k], SPEED[k] * rate)

    const bal = S.amp * b.swing
    turn(part.balance, bal)
    turn(part.pallet, forkAngle(bal))
    hairspring.setAttribute('d', spiral(SPRING.r0, SPRING.r1, SPRING.turns, bal, 300))

    if (Math.abs(S.reserve - S.drawn) > 0.18) {
      S.drawn = S.reserve
      springPath.setAttribute('d', mainspring(MAINSPRING.r0, MAINSPRING.r1, MAINSPRING.turns, S.reserve / RESERVE_H))
    }

    if (b.n !== S.beat) {
      S.beat = b.n
      if (soundOn && running && S.warp <= 1) tick(b.n % 2 === 0)
    }

    /* readings, a few times a second */
    if (now - readAt > 110) {
      readAt = now
      out.reserve.textContent = S.reserve.toFixed(1)
      out.beats.textContent = Math.floor(S.T * BEATS).toLocaleString('en-GB')
      const t = Math.floor(S.T)
      out.time.textContent = `${Math.floor(t / 3600)} h ${pad(Math.floor(t / 60) % 60)} m ${pad(t % 60)} s`
      out.amp.textContent = Math.round(S.amp)
      meterBar.style.width = ((S.reserve / RESERVE_H) * 100).toFixed(1) + '%'
      out.meter.setAttribute('aria-valuenow', Math.round(S.reserve))

      let msg
      if (S.reserve <= 0 && !S.winding) msg = 'Stopped. The mainspring has run down. Hold the button to wind it.'
      else if (S.winding) msg = S.reserve >= RESERVE_H ? 'Fully wound: 72 hours in the spring.' : 'Winding. The spring coils tighter around its arbor.'
      else if (!running) msg = 'Starting. The balance is picking up its swing.'
      else if (S.warp < 1) msg = 'Slow motion. One beat every four seconds.'
      else if (S.warp === 1) msg = 'Running in real time.'
      else if (S.warp === 60) msg = 'Time-lapse. A minute passes every second.'
      else msg = `Time-lapse. An hour passes every second: about ${Math.max(1, Math.round(S.reserve))} s until the spring is empty.`
      if (msg !== status) {
        status = msg
        out.status.textContent = msg
      }
    }
  }
  ctx.frames.add(frame)

  /* ---- controls ---- */
  section.querySelectorAll('input[name="speed"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) S.warp = parseFloat(input.value)
    })
    if (input.checked) S.warp = parseFloat(input.value)
  })

  const hold = (on) => {
    S.winding = on
    windBtn.classList.toggle('is-held', on)
  }
  windBtn.addEventListener('pointerdown', (e) => {
    try {
      windBtn.setPointerCapture(e.pointerId)
    } catch {}
    hold(true)
  })
  ;['pointerup', 'pointercancel', 'lostpointercapture', 'blur'].forEach((type) => windBtn.addEventListener(type, () => hold(false)))
  windBtn.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      hold(true)
    }
  })
  windBtn.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') hold(false)
  })
  windBtn.addEventListener('contextmenu', (e) => e.preventDefault())

  zoomBtn?.addEventListener('click', () => {
    const on = !view.hasAttribute('data-zoomed')
    view.toggleAttribute('data-zoomed', on)
    zoomBtn.setAttribute('aria-pressed', String(on))
    zoomBtn.textContent = on ? 'Show the whole train' : 'Zoom on the escapement'
  })

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => (S.visible = e.isIntersecting), { rootMargin: '10%' }).observe(view)
  } else {
    S.visible = true
  }
}
