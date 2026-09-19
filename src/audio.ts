export interface GameAudio {
  /** Call from the first user gesture; creates/resumes the AudioContext. Safe to call repeatedly. */
  unlock(): void
  setMuted(muted: boolean): void
  /** Whoosh whose pitch and loudness scale with power in [0, 1]. */
  launch(power: number): void
  /** Bright rising major arpeggio chime (about 0.9 s). */
  goal(): void
  /** Low thud with a short noise burst. */
  crash(): void
  /** Soft descending two-note "lost signal" tone. */
  lost(): void
  /** Very quiet short UI tick for nudge buttons. */
  tick(): void
}

const MASTER_GAIN = 0.35
const MUTE_RAMP_SECONDS = 0.03

type AudioContextConstructor = typeof AudioContext

export function createAudio(): GameAudio {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let noiseBuffer: AudioBuffer | null = null
  let unlocked = false
  let muted = false

  function ensureContext(): boolean {
    if (ctx && master) return true
    try {
      const w = window as unknown as {
        AudioContext?: AudioContextConstructor
        webkitAudioContext?: AudioContextConstructor
      }
      const Ctor = w.AudioContext ?? w.webkitAudioContext
      if (!Ctor) return false
      const context = new Ctor()
      const gain = context.createGain()
      gain.gain.value = muted ? 0 : MASTER_GAIN
      const compressor = context.createDynamicsCompressor()
      gain.connect(compressor)
      compressor.connect(context.destination)
      ctx = context
      master = gain
      return true
    } catch {
      ctx = null
      master = null
      return false
    }
  }

  function unlock(): void {
    try {
      if (!ensureContext() || !ctx) return
      if (ctx.state === 'suspended') {
        void ctx.resume()
      }
      unlocked = true
    } catch {
      // no-op
    }
  }

  function setMuted(nextMuted: boolean): void {
    muted = nextMuted
    if (!ctx || !master) return
    try {
      const now = ctx.currentTime
      const target = muted ? 0 : MASTER_GAIN
      master.gain.cancelScheduledValues(now)
      master.gain.setValueAtTime(master.gain.value, now)
      master.gain.linearRampToValueAtTime(target, now + MUTE_RAMP_SECONDS)
    } catch {
      // no-op
    }
  }

  function canPlay(): boolean {
    return unlocked && !muted && ctx !== null && master !== null
  }

  function getNoiseBuffer(context: AudioContext): AudioBuffer {
    if (noiseBuffer) return noiseBuffer
    const length = Math.floor(context.sampleRate * 0.5)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1
    }
    noiseBuffer = buffer
    return buffer
  }

  function launch(power: number): void {
    if (!canPlay() || !ctx || !master) return
    try {
      const context = ctx
      const out = master
      const p = Math.min(1, Math.max(0, power))
      const now = context.currentTime
      const duration = 0.35 + p * 0.25

      const osc = context.createOscillator()
      osc.type = 'sine'
      const startFreq = 220 + p * 380
      const endFreq = Math.max(40, startFreq * 0.5)
      osc.frequency.setValueAtTime(startFreq, now)
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration)

      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(800 + p * 2500, now)
      filter.frequency.exponentialRampToValueAtTime(300, now + duration)

      const gain = context.createGain()
      const peak = 0.15 + p * 0.35
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

      osc.connect(filter)
      filter.connect(gain)
      gain.connect(out)

      osc.onended = () => {
        osc.disconnect()
        filter.disconnect()
        gain.disconnect()
      }
      osc.start(now)
      osc.stop(now + duration + 0.02)
    } catch {
      // no-op
    }
  }

  function goal(): void {
    if (!canPlay() || !ctx || !master) return
    try {
      const context = ctx
      const out = master
      const now = context.currentTime
      const freqs = [523.25, 659.25, 783.99, 1046.5]
      const noteDuration = 0.35
      const stagger = 0.12
      freqs.forEach((freq, i) => {
        const startAt = now + i * stagger
        const osc = context.createOscillator()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq, startAt)

        const gain = context.createGain()
        gain.gain.setValueAtTime(0.0001, startAt)
        gain.gain.exponentialRampToValueAtTime(0.28, startAt + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + noteDuration)

        osc.connect(gain)
        gain.connect(out)
        osc.onended = () => {
          osc.disconnect()
          gain.disconnect()
        }
        osc.start(startAt)
        osc.stop(startAt + noteDuration + 0.05)
      })
    } catch {
      // no-op
    }
  }

  function crash(): void {
    if (!canPlay() || !ctx || !master) return
    try {
      const context = ctx
      const out = master
      const now = context.currentTime

      const osc = context.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(140, now)
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.25)
      const oscGain = context.createGain()
      oscGain.gain.setValueAtTime(0.0001, now)
      oscGain.gain.exponentialRampToValueAtTime(0.4, now + 0.01)
      oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
      osc.connect(oscGain)
      oscGain.connect(out)
      osc.onended = () => {
        osc.disconnect()
        oscGain.disconnect()
      }
      osc.start(now)
      osc.stop(now + 0.32)

      const noiseSource = context.createBufferSource()
      noiseSource.buffer = getNoiseBuffer(context)
      const noiseFilter = context.createBiquadFilter()
      noiseFilter.type = 'lowpass'
      noiseFilter.frequency.setValueAtTime(900, now)
      const noiseGain = context.createGain()
      noiseGain.gain.setValueAtTime(0.0001, now)
      noiseGain.gain.exponentialRampToValueAtTime(0.25, now + 0.005)
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15)
      noiseSource.connect(noiseFilter)
      noiseFilter.connect(noiseGain)
      noiseGain.connect(out)
      noiseSource.onended = () => {
        noiseSource.disconnect()
        noiseFilter.disconnect()
        noiseGain.disconnect()
      }
      noiseSource.start(now)
      noiseSource.stop(now + 0.16)
    } catch {
      // no-op
    }
  }

  function lost(): void {
    if (!canPlay() || !ctx || !master) return
    try {
      const context = ctx
      const out = master
      const now = context.currentTime
      const notes = [392, 293.66]
      const noteDuration = 0.35
      notes.forEach((freq, i) => {
        const startAt = now + i * 0.28
        const osc = context.createOscillator()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, startAt)

        const gain = context.createGain()
        gain.gain.setValueAtTime(0.0001, startAt)
        gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.04)
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + noteDuration)

        osc.connect(gain)
        gain.connect(out)
        osc.onended = () => {
          osc.disconnect()
          gain.disconnect()
        }
        osc.start(startAt)
        osc.stop(startAt + noteDuration + 0.05)
      })
    } catch {
      // no-op
    }
  }

  function tick(): void {
    if (!canPlay() || !ctx || !master) return
    try {
      const context = ctx
      const out = master
      const now = context.currentTime

      const osc = context.createOscillator()
      osc.type = 'square'
      osc.frequency.setValueAtTime(1000, now)

      const gain = context.createGain()
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.005)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04)

      osc.connect(gain)
      gain.connect(out)
      osc.onended = () => {
        osc.disconnect()
        gain.disconnect()
      }
      osc.start(now)
      osc.stop(now + 0.05)
    } catch {
      // no-op
    }
  }

  return { unlock, setMuted, launch, goal, crash, lost, tick }
}
