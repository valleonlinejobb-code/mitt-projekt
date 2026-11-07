// Korta ljud via Web Audio (inga ljudfiler, fungerar offline) och vibration.

let ctx: AudioContext | null = null
let soundOn = true
let vibrationOn = true

export function configureFeedback(opts: { sound: boolean; vibration: boolean }) {
  soundOn = opts.sound
  vibrationOn = opts.vibration
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.08) {
  if (!ctx) return
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.value = freq
  const t = ctx.currentTime + start
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(ctx.destination)
  o.start(t)
  o.stop(t + dur + 0.02)
}

const sounds = {
  tap: () => tone(660, 0, 0.06, 'triangle', 0.05),
  reveal: () => {
    tone(392, 0, 0.12)
    tone(587, 0.08, 0.18)
  },
  impostor: () => {
    tone(220, 0, 0.25, 'sawtooth', 0.05)
    tone(185, 0.18, 0.35, 'sawtooth', 0.05)
  },
  tick: () => tone(1000, 0, 0.04, 'square', 0.03),
  alarm: () => [0, 0.2, 0.4].forEach((s) => tone(880, s, 0.14, 'square', 0.06)),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.25, 'triangle', 0.07)),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, i * 0.14, 0.3, 'triangle', 0.07)),
}

const vibrations: Partial<Record<keyof typeof sounds, number | number[]>> = {
  tap: 8,
  reveal: 20,
  impostor: [40, 60, 80],
  alarm: [200, 100, 200],
  win: [30, 50, 30],
  lose: 120,
}

export function feedback(kind: keyof typeof sounds) {
  if (soundOn) {
    try {
      ctx ??= new AudioContext()
      if (ctx.state === 'suspended') void ctx.resume()
      sounds[kind]()
    } catch {
      /* ljud stöds inte */
    }
  }
  const v = vibrations[kind]
  if (vibrationOn && v !== undefined && 'vibrate' in navigator) {
    try {
      navigator.vibrate(v)
    } catch {
      /* vibration stöds inte */
    }
  }
}
