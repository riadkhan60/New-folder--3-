/**
 * core/audio — fully generative Web Audio. No files. Off by default.
 *
 *   ocean rumble   looped brown noise → low-pass whose cutoff falls with depth
 *   surface wash   band-passed noise with a slow swell, fades with the sun
 *   drone pad      detuned saw/triangle/sine voices through a breathing
 *                  low-pass; the whole chord sinks a fifth on the way down
 *   sonar          below 1,000 m a ping (sine, 1.1–1.4 kHz) every 9–15 s into
 *                  a filtered feedback delay; also on ctx.on('sonar')
 *
 * Starts on ctx.on('sound', { on }) (emitted by the nav toggle inside a click,
 * so the AudioContext is created inside a user gesture). The choice is kept in
 * localStorage; a remembered "on" waits for the visitor's first gesture.
 * Emits ctx.emit('sound:state', { on }) whenever it really starts or stops.
 * Suspends when off or when the tab is hidden.
 */
import '../styles/audio.css'

const KEY = 'noctiluca:sound' // shared with core/nav
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))

export function init(ctx) {
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return

  let ac = null
  let nodes = null
  let on = false
  let sonarT = 0
  let suspendT = 0
  let lastApply = 0

  const readPref = () => {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  }
  const writePref = (v) => {
    try {
      localStorage.setItem(KEY, v ? '1' : '0')
    } catch {}
  }

  /* ---------------------------------------------------------- buffers */
  function loopNoise(seconds, brown) {
    const sr = ac.sampleRate
    const len = Math.floor(sr * seconds)
    const X = Math.floor(sr * 0.25) // crossfade so the loop has no seam
    const buf = ac.createBuffer(2, len, sr)
    for (let ch = 0; ch < 2; ch++) {
      const gen = new Float32Array(len + X)
      let last = 0
      for (let i = 0; i < gen.length; i++) {
        const w = Math.random() * 2 - 1
        if (brown) {
          last = (last + 0.02 * w) / 1.02
          gen[i] = last * 3.2
        } else gen[i] = w * 0.5
      }
      const out = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) {
        if (i < X) {
          const t = i / X
          out[i] = gen[i] * t + gen[len + i] * (1 - t)
        } else out[i] = gen[i]
      }
    }
    return buf
  }

  function impulse(seconds, decay) {
    const sr = ac.sampleRate
    const len = Math.floor(sr * seconds)
    const buf = ac.createBuffer(2, len, sr)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
    return buf
  }

  /* ------------------------------------------------------------ graph */
  function build() {
    const now = ac.currentTime
    const n = {}

    n.master = ac.createGain()
    n.master.gain.value = 0
    const comp = ac.createDynamicsCompressor()
    comp.threshold.value = -20
    comp.knee.value = 18
    comp.ratio.value = 3
    comp.attack.value = 0.04
    comp.release.value = 0.5
    n.master.connect(comp).connect(ac.destination)

    // a long, dark space for everything to sit in
    const verb = ac.createConvolver()
    verb.buffer = impulse(4.2, 2.8)
    const verbOut = ac.createGain()
    verbOut.gain.value = 0.5
    verb.connect(verbOut).connect(n.master)

    const lfo = (freq, depth, target, type = 'sine') => {
      const o = ac.createOscillator()
      o.type = type
      o.frequency.value = freq
      const gn = ac.createGain()
      gn.gain.value = depth
      o.connect(gn).connect(target)
      o.start(now)
      return o
    }

    // ocean rumble
    const rumble = ac.createBufferSource()
    rumble.buffer = loopNoise(6, true)
    rumble.loop = true
    n.rumbleLP = ac.createBiquadFilter()
    n.rumbleLP.type = 'lowpass'
    n.rumbleLP.frequency.value = 900
    n.rumbleLP.Q.value = 0.4
    n.rumbleGain = ac.createGain()
    n.rumbleGain.gain.value = 0.5
    rumble.connect(n.rumbleLP).connect(n.rumbleGain).connect(n.master)
    lfo(0.055, 0.16, n.rumbleGain.gain) // the swell
    rumble.start(now)

    // surface wash (only near the top)
    const wash = ac.createBufferSource()
    wash.buffer = loopNoise(5, false)
    wash.loop = true
    const washBP = ac.createBiquadFilter()
    washBP.type = 'bandpass'
    washBP.frequency.value = 1100
    washBP.Q.value = 0.45
    const washSwell = ac.createGain()
    washSwell.gain.value = 0.5
    lfo(0.083, 0.5, washSwell.gain)
    lfo(0.031, 380, washBP.frequency)
    n.washGain = ac.createGain()
    n.washGain.gain.value = 0
    wash.connect(washBP).connect(washSwell).connect(n.washGain)
    n.washGain.connect(n.master)
    n.washGain.connect(verb)
    wash.start(now)

    // drone pad
    n.droneLP = ac.createBiquadFilter()
    n.droneLP.type = 'lowpass'
    n.droneLP.frequency.value = 600
    n.droneLP.Q.value = 1.4
    lfo(0.043, 110, n.droneLP.frequency)
    n.droneGain = ac.createGain()
    n.droneGain.gain.value = 0.1
    const droneSend = ac.createGain()
    droneSend.gain.value = 0.7
    n.droneLP.connect(n.droneGain).connect(n.master)
    n.droneGain.connect(droneSend).connect(verb)
    n.voices = []
    const VOICES = [
      [1, 'sawtooth', 0.42],
      [1.5, 'triangle', 0.34],
      [2, 'sine', 0.3],
      [3, 'sine', 0.1],
    ]
    for (const [ratio, type, level] of VOICES) {
      for (const det of [-7, 6]) {
        const o = ac.createOscillator()
        o.type = type
        o.detune.value = det
        lfo(0.05 + Math.random() * 0.07, 4, o.detune)
        const gn = ac.createGain()
        gn.gain.value = level
        o.connect(gn).connect(n.droneLP)
        o.start(now)
        n.voices.push({ o, ratio })
      }
    }

    // sonar bus: dry + filtered feedback delay + reverb send
    n.pingIn = ac.createGain()
    const dry = ac.createGain()
    dry.gain.value = 0.85
    const delay = ac.createDelay(2)
    delay.delayTime.value = 0.43
    const fbLP = ac.createBiquadFilter()
    fbLP.type = 'lowpass'
    fbLP.frequency.value = 2300
    const fb = ac.createGain()
    fb.gain.value = 0.44
    const wet = ac.createGain()
    wet.gain.value = 0.55
    const pingSend = ac.createGain()
    pingSend.gain.value = 0.8
    n.pingIn.connect(dry).connect(n.master)
    n.pingIn.connect(delay)
    delay.connect(fbLP).connect(fb).connect(delay)
    fbLP.connect(wet).connect(n.master)
    n.pingIn.connect(pingSend).connect(verb)

    return n
  }

  /* -------------------------------------------------- depth → sound */
  function apply(s, immediate = false) {
    if (!nodes) return
    const t = ac.currentTime
    const tc = immediate ? 0.05 : 0.9
    const d = s.depth
    const nrm = s.n ?? d / ctx.depth.MAX
    nodes.rumbleLP.frequency.setTargetAtTime(110 + 920 * Math.exp(-d / 1700), t, tc)
    nodes.rumbleGain.gain.setTargetAtTime(0.42 + 0.22 * nrm, t, tc)
    nodes.washGain.gain.setTargetAtTime(0.07 * s.sun, t, tc)
    nodes.droneLP.frequency.setTargetAtTime(150 + 560 * Math.exp(-d / 2400), t, tc)
    nodes.droneGain.gain.setTargetAtTime(0.085 + 0.06 * nrm, t, tc)
    // the chord sinks a fifth between the surface and the bottom
    const f0 = 55 * Math.pow(2, (-7 / 12) * nrm)
    for (const v of nodes.voices) v.o.frequency.setTargetAtTime(f0 * v.ratio, t, immediate ? 0.05 : 1.6)
  }

  ctx.depth.onChange((s) => {
    if (!on || !nodes) return
    const now = performance.now()
    if (now - lastApply < 120) return
    lastApply = now
    apply(s)
  })

  /* ------------------------------------------------------------ sonar */
  function ping(strength = 1) {
    if (!nodes || !on || ac.state !== 'running') return
    const t = ac.currentTime + 0.02
    const f = 1100 + Math.random() * 300
    const amp = 0.14 * clamp(strength, 0.2, 1.4)
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(f, t)
    o.frequency.exponentialRampToValueAtTime(f * 0.988, t + 1.5)
    const env = ac.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(amp, t + 0.006)
    env.gain.exponentialRampToValueAtTime(amp * 0.35, t + 0.16)
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.7)
    let out = env
    if (ac.createStereoPanner) {
      const p = ac.createStereoPanner()
      p.pan.value = (Math.random() - 0.5) * 0.9
      env.connect(p)
      out = p
    }
    o.connect(env)
    out.connect(nodes.pingIn)
    o.start(t)
    o.stop(t + 1.8)
    o.onended = () => {
      o.disconnect()
      out.disconnect()
    }
  }

  function scheduleSonar() {
    clearTimeout(sonarT)
    sonarT = setTimeout(() => {
      if (!on) return
      if (!document.hidden && ctx.depth.get().depth > 1000) ping(0.75 + Math.random() * 0.3)
      scheduleSonar()
    }, 9000 + Math.random() * 6000)
  }

  ctx.on('sonar', (d) => ping(d?.strength ?? 1))

  /* --------------------------------------------------------- on / off */
  function start() {
    try {
      if (!ac) {
        ac = new AC({ latencyHint: 'playback' })
        nodes = build()
      }
    } catch (err) {
      console.warn('[noctiluca] audio unavailable', err)
      return
    }
    clearTimeout(suspendT)
    ac.resume?.()
    apply(ctx.depth.get(), true)
    const t = ac.currentTime
    const g = nodes.master.gain
    g.cancelScheduledValues(t)
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(0.9, t + 2.4)
    scheduleSonar()
  }

  function stop() {
    clearTimeout(sonarT)
    if (!ac || !nodes) return
    const t = ac.currentTime
    const g = nodes.master.gain
    g.cancelScheduledValues(t)
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(0, t + 0.9)
    clearTimeout(suspendT)
    suspendT = setTimeout(() => {
      if (!on) ac.suspend?.()
    }, 1100)
  }

  function setOn(v, save) {
    on = !!v
    if (save) writePref(on)
    if (on) start()
    else stop()
    // tell the nav what is really happening (it renders the toggle from this)
    ctx.emit('sound:state', { on: on && !!ac })
  }

  ctx.on('sound', (d) => setOn(d?.on, true))

  // a remembered "on" never autoplays: it waits for the first real gesture.
  // A gesture on the sound toggle itself is left to the toggle (otherwise
  // this would start the sound and the click would switch it straight off).
  if (readPref()) {
    const gesture = (e) => {
      if (e.target instanceof Element && e.target.closest('.nav__sound')) return
      if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return
      window.removeEventListener('pointerdown', gesture, true)
      window.removeEventListener('keydown', gesture, true)
      if (!on && readPref()) setOn(true, false)
    }
    window.addEventListener('pointerdown', gesture, true)
    window.addEventListener('keydown', gesture, true)
  }

  document.addEventListener('visibilitychange', () => {
    if (!ac) return
    if (document.hidden) {
      clearTimeout(sonarT)
      ac.suspend?.()
    } else if (on) {
      ac.resume?.()
      scheduleSonar()
    }
  })
}
