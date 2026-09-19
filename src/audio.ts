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
  /** Stadium crowd erupting in cheers and applause, about 2.8 s. */
  cheer(): void
  /** Disappointed crowd "awww", about 1.6 s. */
  groan(): void
  /** Club whoosh-then-thwack whose loudness scales with power in [0, 1]. Soft ticks under low power. */
  swing(power: number): void
  /** Wooden-rail "tock" with a neon ping on top, brighter and louder with speed (clamped 0..12). */
  bounce(speed: number): void
  /** Classic ball-in-cup rattle: a few quick decaying clicks then a low hollow thunk. */
  cupDrop(): void
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
  let lastBounceAt = -Infinity
  const BOUNCE_MIN_INTERVAL_S = 0.04
  const SWING_SOFT_THRESHOLD = 0.35

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

  function cheer(): void {
    if (!canPlay() || !ctx || !master) return
    try {
      const context = ctx
      const out = master
      const now = context.currentTime
      const duration = 2.8
      const hasPanner = typeof context.createStereoPanner === 'function'

      // Layered band-passed noise "crowd bed": fast swell, slow decay, wobbling
      // filter/gain LFOs so the layers don't sound static.
      const layerCount = 3
      for (let i = 0; i < layerCount; i++) {
        const source = context.createBufferSource()
        source.buffer = getNoiseBuffer(context)
        source.loop = true

        const filter = context.createBiquadFilter()
        filter.type = 'bandpass'
        filter.frequency.setValueAtTime(500 + Math.random() * 3000, now)
        filter.Q.value = 0.7 + Math.random() * 0.6

        const lfo = context.createOscillator()
        lfo.type = 'sine'
        lfo.frequency.value = 0.15 + Math.random() * 0.35
        const lfoGain = context.createGain()
        lfoGain.gain.value = 400 + Math.random() * 500
        lfo.connect(lfoGain)
        lfoGain.connect(filter.frequency)

        const gain = context.createGain()
        const peak = 0.16 + Math.random() * 0.06
        gain.gain.setValueAtTime(0.0001, now)
        gain.gain.exponentialRampToValueAtTime(peak, now + 0.18 + Math.random() * 0.08)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

        const gainLfo = context.createOscillator()
        gainLfo.type = 'sine'
        gainLfo.frequency.value = 0.2 + Math.random() * 0.4
        const gainLfoGain = context.createGain()
        gainLfoGain.gain.value = peak * 0.25
        gainLfo.connect(gainLfoGain)
        gainLfoGain.connect(gain.gain)

        source.connect(filter)
        filter.connect(gain)
        gain.connect(out)

        source.onended = () => {
          source.disconnect()
          filter.disconnect()
          gain.disconnect()
          lfo.disconnect()
          lfoGain.disconnect()
          gainLfo.disconnect()
          gainLfoGain.disconnect()
        }
        source.start(now)
        source.stop(now + duration)
        lfo.start(now)
        lfo.stop(now + duration)
        gainLfo.start(now)
        gainLfo.stop(now + duration)
      }

      // Pitched voice "whoo"/"yeah" blips, staggered over the first 1.5 s.
      const blipCount = 10 + Math.floor(Math.random() * 5)
      for (let i = 0; i < blipCount; i++) {
        const startAt = now + Math.random() * 1.5
        const startFreq = 300 + Math.random() * 300
        const endFreq = Math.min(900, startFreq + 250 + Math.random() * 250)
        const blipDuration = 0.18 + Math.random() * 0.12

        const osc = context.createOscillator()
        osc.type = Math.random() < 0.5 ? 'sine' : 'triangle'
        osc.frequency.setValueAtTime(startFreq, startAt)
        osc.frequency.linearRampToValueAtTime(endFreq, startAt + blipDuration)

        const formant = context.createBiquadFilter()
        formant.type = 'bandpass'
        formant.frequency.value = (startFreq + endFreq) / 2
        formant.Q.value = 4

        const gain = context.createGain()
        gain.gain.setValueAtTime(0.0001, startAt)
        gain.gain.exponentialRampToValueAtTime(0.09 + Math.random() * 0.05, startAt + 0.03)
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + blipDuration)

        osc.connect(formant)
        formant.connect(gain)

        let panner: StereoPannerNode | null = null
        if (hasPanner) {
          panner = context.createStereoPanner()
          panner.pan.value = Math.random() * 2 - 1
          gain.connect(panner)
          panner.connect(out)
        } else {
          gain.connect(out)
        }

        osc.onended = () => {
          osc.disconnect()
          formant.disconnect()
          gain.disconnect()
          panner?.disconnect()
        }
        osc.start(startAt)
        osc.stop(startAt + blipDuration + 0.05)
      }

      // Hand claps that thicken into applause then thin out.
      const clapCount = 35 + Math.floor(Math.random() * 16)
      for (let i = 0; i < clapCount; i++) {
        const t = Math.random()
        const startAt = now + t * t * (duration - 0.05)
        const clapDuration = 0.002 + Math.random() * 0.002

        const buffer = getNoiseBuffer(context)
        const maxOffset = Math.max(0, buffer.duration - clapDuration - 0.01)
        const offset = Math.random() * maxOffset

        const source = context.createBufferSource()
        source.buffer = buffer

        const filter = context.createBiquadFilter()
        filter.type = 'bandpass'
        filter.frequency.value = 1200 + Math.random() * 1300
        filter.Q.value = 1 + Math.random() * 1.5

        const gain = context.createGain()
        const peak = 0.05 + Math.random() * 0.08
        gain.gain.setValueAtTime(0.0001, startAt)
        gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.001)
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + clapDuration + 0.02)

        source.connect(filter)
        filter.connect(gain)

        let panner: StereoPannerNode | null = null
        if (hasPanner) {
          panner = context.createStereoPanner()
          panner.pan.value = Math.random() * 2 - 1
          gain.connect(panner)
          panner.connect(out)
        } else {
          gain.connect(out)
        }

        source.onended = () => {
          source.disconnect()
          filter.disconnect()
          gain.disconnect()
          panner?.disconnect()
        }
        source.start(startAt, offset)
        source.stop(startAt + clapDuration + 0.03)
      }
    } catch {
      // no-op
    }
  }

  function groan(): void {
    if (!canPlay() || !ctx || !master) return
    try {
      const context = ctx
      const out = master
      const now = context.currentTime
      const duration = 1.6
      const hasPanner = typeof context.createStereoPanner === 'function'

      const voiceCount = 8 + Math.floor(Math.random() * 3)
      for (let i = 0; i < voiceCount; i++) {
        const startFreq = 260 + Math.random() * 160
        const endFreq = Math.max(80, startFreq / (1.26 + Math.random() * 0.2))

        const osc = context.createOscillator()
        osc.type = Math.random() < 0.5 ? 'sawtooth' : 'triangle'
        osc.frequency.setValueAtTime(startFreq, now)
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration * 0.85)
        osc.detune.value = (Math.random() * 2 - 1) * 12

        const vibrato = context.createOscillator()
        vibrato.type = 'sine'
        vibrato.frequency.value = 4 + Math.random() * 2
        const vibratoGain = context.createGain()
        vibratoGain.gain.value = 6 + Math.random() * 4
        vibrato.connect(vibratoGain)
        vibratoGain.connect(osc.detune)

        const formant1 = context.createBiquadFilter()
        formant1.type = 'bandpass'
        formant1.Q.value = 3
        formant1.frequency.setValueAtTime(700, now)
        formant1.frequency.linearRampToValueAtTime(450, now + duration)

        const formant2 = context.createBiquadFilter()
        formant2.type = 'bandpass'
        formant2.Q.value = 3
        formant2.frequency.setValueAtTime(1200, now)
        formant2.frequency.linearRampToValueAtTime(800, now + duration)

        const gain = context.createGain()
        const peak = 0.05 + Math.random() * 0.03
        gain.gain.setValueAtTime(0.0001, now)
        gain.gain.exponentialRampToValueAtTime(peak, now + 0.22 + Math.random() * 0.1)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

        osc.connect(formant1)
        formant1.connect(formant2)
        formant2.connect(gain)

        let panner: StereoPannerNode | null = null
        if (hasPanner) {
          panner = context.createStereoPanner()
          panner.pan.value = (Math.random() * 2 - 1) * 0.6
          gain.connect(panner)
          panner.connect(out)
        } else {
          gain.connect(out)
        }

        osc.onended = () => {
          osc.disconnect()
          vibrato.disconnect()
          vibratoGain.disconnect()
          formant1.disconnect()
          formant2.disconnect()
          gain.disconnect()
          panner?.disconnect()
        }
        osc.start(now)
        osc.stop(now + duration + 0.05)
        vibrato.start(now)
        vibrato.stop(now + duration + 0.05)
      }

      const noiseSource = context.createBufferSource()
      noiseSource.buffer = getNoiseBuffer(context)
      noiseSource.loop = true
      const noiseFilter = context.createBiquadFilter()
      noiseFilter.type = 'bandpass'
      noiseFilter.frequency.value = 400
      noiseFilter.Q.value = 0.6
      const noiseGain = context.createGain()
      noiseGain.gain.setValueAtTime(0.0001, now)
      noiseGain.gain.exponentialRampToValueAtTime(0.03, now + 0.3)
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
      noiseSource.connect(noiseFilter)
      noiseFilter.connect(noiseGain)
      noiseGain.connect(out)
      noiseSource.onended = () => {
        noiseSource.disconnect()
        noiseFilter.disconnect()
        noiseGain.disconnect()
      }
      noiseSource.start(now)
      noiseSource.stop(now + duration)
    } catch {
      // no-op
    }
  }

  function swing(power: number): void {
    if (!canPlay() || !ctx || !master) return
    try {
      const context = ctx
      const out = master
      const p = Math.min(1, Math.max(0, power))
      const now = context.currentTime

      if (p < SWING_SOFT_THRESHOLD) {
        // A gentle putt: almost no whoosh, just a short soft tick of the putter face.
        const tickDuration = 0.05
        const tick = context.createOscillator()
        tick.type = 'sine'
        tick.frequency.setValueAtTime(900, now)
        tick.frequency.exponentialRampToValueAtTime(500, now + tickDuration)

        const tickGain = context.createGain()
        const tickPeak = 0.04 + (p / SWING_SOFT_THRESHOLD) * 0.08
        tickGain.gain.setValueAtTime(0.0001, now)
        tickGain.gain.exponentialRampToValueAtTime(tickPeak, now + 0.006)
        tickGain.gain.exponentialRampToValueAtTime(0.0001, now + tickDuration)

        tick.connect(tickGain)
        tickGain.connect(out)
        tick.onended = () => {
          tick.disconnect()
          tickGain.disconnect()
        }
        tick.start(now)
        tick.stop(now + tickDuration + 0.02)
        return
      }

      const whooshDuration = 0.12
      const whoosh = context.createBufferSource()
      whoosh.buffer = getNoiseBuffer(context)
      whoosh.loop = true
      const whooshFilter = context.createBiquadFilter()
      whooshFilter.type = 'bandpass'
      whooshFilter.Q.value = 0.8
      whooshFilter.frequency.setValueAtTime(500, now)
      whooshFilter.frequency.exponentialRampToValueAtTime(2500 + p * 1500, now + whooshDuration)
      const whooshGain = context.createGain()
      whooshGain.gain.setValueAtTime(0.0001, now)
      whooshGain.gain.exponentialRampToValueAtTime(0.12 + p * 0.1, now + whooshDuration * 0.7)
      whooshGain.gain.exponentialRampToValueAtTime(0.0001, now + whooshDuration)
      whoosh.connect(whooshFilter)
      whooshFilter.connect(whooshGain)
      whooshGain.connect(out)
      whoosh.onended = () => {
        whoosh.disconnect()
        whooshFilter.disconnect()
        whooshGain.disconnect()
      }
      whoosh.start(now)
      whoosh.stop(now + whooshDuration + 0.02)

      const hitAt = now + 0.3
      const clickDuration = 0.02
      const click = context.createBufferSource()
      click.buffer = getNoiseBuffer(context)
      const clickFilter = context.createBiquadFilter()
      clickFilter.type = 'bandpass'
      clickFilter.frequency.value = 2200
      clickFilter.Q.value = 1
      const clickGain = context.createGain()
      const clickPeak = 0.15 + p * 0.25
      clickGain.gain.setValueAtTime(0.0001, hitAt)
      clickGain.gain.exponentialRampToValueAtTime(clickPeak, hitAt + 0.002)
      clickGain.gain.exponentialRampToValueAtTime(0.0001, hitAt + clickDuration)
      click.connect(clickFilter)
      clickFilter.connect(clickGain)
      clickGain.connect(out)
      click.onended = () => {
        click.disconnect()
        clickFilter.disconnect()
        clickGain.disconnect()
      }
      click.start(hitAt, 0, clickDuration)
      click.stop(hitAt + clickDuration + 0.01)

      const thump = context.createOscillator()
      thump.type = 'sine'
      thump.frequency.setValueAtTime(180, hitAt)
      thump.frequency.exponentialRampToValueAtTime(90, hitAt + 0.1)
      const thumpGain = context.createGain()
      const thumpPeak = 0.2 + p * 0.35
      thumpGain.gain.setValueAtTime(0.0001, hitAt)
      thumpGain.gain.exponentialRampToValueAtTime(thumpPeak, hitAt + 0.008)
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, hitAt + 0.14)
      thump.connect(thumpGain)
      thumpGain.connect(out)
      thump.onended = () => {
        thump.disconnect()
        thumpGain.disconnect()
      }
      thump.start(hitAt)
      thump.stop(hitAt + 0.16)
    } catch {
      // no-op
    }
  }

  function bounce(speed: number): void {
    if (!canPlay() || !ctx || !master) return
    const context = ctx
    const now = context.currentTime
    if (now - lastBounceAt < BOUNCE_MIN_INTERVAL_S) return
    lastBounceAt = now
    try {
      const out = master
      const s = Math.min(12, Math.max(0, speed))
      const amount = s / 12

      // Wooden-rail "tock": a short filtered noise knock.
      const tockDuration = 0.05
      const tock = context.createBufferSource()
      tock.buffer = getNoiseBuffer(context)
      const tockFilter = context.createBiquadFilter()
      tockFilter.type = 'bandpass'
      tockFilter.frequency.value = 260 + amount * 220
      tockFilter.Q.value = 2.2
      const tockGain = context.createGain()
      const tockPeak = 0.1 + amount * 0.22
      tockGain.gain.setValueAtTime(0.0001, now)
      tockGain.gain.exponentialRampToValueAtTime(tockPeak, now + 0.003)
      tockGain.gain.exponentialRampToValueAtTime(0.0001, now + tockDuration)
      tock.connect(tockFilter)
      tockFilter.connect(tockGain)
      tockGain.connect(out)
      tock.onended = () => {
        tock.disconnect()
        tockFilter.disconnect()
        tockGain.disconnect()
      }
      tock.start(now)
      tock.stop(now + tockDuration + 0.02)

      // Bright neon ping layered on top, louder and higher-pitched the harder the hit.
      const pingDuration = 0.16 + amount * 0.08
      const ping = context.createOscillator()
      ping.type = 'sine'
      const pingFreq = 1400 + amount * 1400
      ping.frequency.setValueAtTime(pingFreq, now)
      ping.frequency.exponentialRampToValueAtTime(pingFreq * 0.6, now + pingDuration)
      const pingGain = context.createGain()
      const pingPeak = 0.03 + amount * 0.14
      pingGain.gain.setValueAtTime(0.0001, now)
      pingGain.gain.exponentialRampToValueAtTime(pingPeak, now + 0.004)
      pingGain.gain.exponentialRampToValueAtTime(0.0001, now + pingDuration)
      ping.connect(pingGain)
      pingGain.connect(out)
      ping.onended = () => {
        ping.disconnect()
        pingGain.disconnect()
      }
      ping.start(now)
      ping.stop(now + pingDuration + 0.02)
    } catch {
      // no-op
    }
  }

  function cupDrop(): void {
    if (!canPlay() || !ctx || !master) return
    try {
      const context = ctx
      const out = master
      const now = context.currentTime

      const clickCount = 3 + Math.round(Math.random())
      const clickSpan = 0.35
      for (let i = 0; i < clickCount; i++) {
        const startAt = now + (i / clickCount) * clickSpan * 0.7
        const clickDuration = 0.02
        const click = context.createBufferSource()
        click.buffer = getNoiseBuffer(context)
        const clickFilter = context.createBiquadFilter()
        clickFilter.type = 'bandpass'
        clickFilter.frequency.value = 2600 - i * 250
        clickFilter.Q.value = 3
        const clickGain = context.createGain()
        const clickPeak = 0.16 * Math.pow(0.7, i)
        clickGain.gain.setValueAtTime(0.0001, startAt)
        clickGain.gain.exponentialRampToValueAtTime(clickPeak, startAt + 0.002)
        clickGain.gain.exponentialRampToValueAtTime(0.0001, startAt + clickDuration)
        click.connect(clickFilter)
        clickFilter.connect(clickGain)
        clickGain.connect(out)
        click.onended = () => {
          click.disconnect()
          clickFilter.disconnect()
          clickGain.disconnect()
        }
        click.start(startAt)
        click.stop(startAt + clickDuration + 0.01)
      }

      const thunkAt = now + clickSpan
      const thunkDuration = 0.22
      const thunk = context.createOscillator()
      thunk.type = 'sine'
      thunk.frequency.setValueAtTime(160, thunkAt)
      thunk.frequency.exponentialRampToValueAtTime(70, thunkAt + thunkDuration)
      const thunkGain = context.createGain()
      thunkGain.gain.setValueAtTime(0.0001, thunkAt)
      thunkGain.gain.exponentialRampToValueAtTime(0.3, thunkAt + 0.01)
      thunkGain.gain.exponentialRampToValueAtTime(0.0001, thunkAt + thunkDuration)
      thunk.connect(thunkGain)
      thunkGain.connect(out)
      thunk.onended = () => {
        thunk.disconnect()
        thunkGain.disconnect()
      }
      thunk.start(thunkAt)
      thunk.stop(thunkAt + thunkDuration + 0.02)
    } catch {
      // no-op
    }
  }

  return { unlock, setMuted, launch, goal, crash, lost, tick, cheer, groan, swing, bounce, cupDrop }
}
