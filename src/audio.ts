// Every sound is synthesised: filtered noise for wind, rustling, swooshes and bangs, oscillators for
// metal, engines, coins, robot beeps, the farmer's voice, cows, crickets, the UFO and fanfares.

const MUTE_KEY = 'grass-cutter/muted'
const VOLUME = 0.8

/** Equal-tempered note frequency, counting semitones from A4. */
const note = (semitones: number) => 440 * 2 ** (semitones / 12)

/** How each engine sounds: firing note, how bright, how loud and the pitch of the blade whirr. */
const ENGINES = {
  mower: { hz: 42, bright: 520, level: 0.11, whirr: 1100 },
  rider: { hz: 33, bright: 420, level: 0.13, whirr: 900 },
  trimmer: { hz: 118, bright: 1900, level: 0.07, whirr: 3200 },
} as const
export type EngineKind = keyof typeof ENGINES

/** Volume and stereo position for a sound made somewhere else, like a robot's snip. */
export type Placement = { volume: number; pan: number }
const HERE: Placement = { volume: 1, pan: 0 }

export function createAudio() {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let noise: AudioBuffer | null = null
  const engines = new Map<string, ReturnType<typeof createEngine>>()
  let muted = readMuted()
  /** Crickets instead of birds. */
  let night = false

  function readMuted() {
    try {
      return localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      return false
    }
  }

  /** Audio can only start after a user gesture, so the context is created on first use. */
  function ensure() {
    if (!ctx) {
      ctx = new AudioContext()
      master = ctx.createGain()
      master.gain.value = muted ? 0 : VOLUME
      master.connect(ctx.destination)
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
      const data = noise.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      startWind(ctx, master, noise)
      scheduleBird()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  }

  /** The context only when it is already running; sounds that need no gesture skip silently otherwise. */
  function running() {
    return ctx && master && ctx.state === 'running' ? { ac: ctx, out: master } : null
  }

  function startWind(ac: AudioContext, out: GainNode, buffer: AudioBuffer) {
    const src = ac.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const filter = ac.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 380
    const gain = ac.createGain()
    gain.gain.value = 0.05
    const lfo = ac.createOscillator()
    lfo.frequency.value = 0.09
    const depth = ac.createGain()
    depth.gain.value = 0.03
    lfo.connect(depth).connect(gain.gain)
    src.connect(filter).connect(gain).connect(out)
    src.start()
    lfo.start()
  }

  function scheduleBird() {
    setTimeout(
      () => {
        const live = running()
        if (live) (night ? cricket : chirp)(live.ac, live.out)
        scheduleBird()
      },
      night ? 900 + Math.random() * 2500 : 3500 + Math.random() * 9000,
    )
  }

  /** A cricket somewhere in the grass: a few bursts of fast, high clicks. */
  function cricket(ac: AudioContext, out: GainNode) {
    const pan = ac.createStereoPanner()
    pan.pan.value = Math.random() * 1.8 - 0.9
    pan.connect(out)
    const pitch = 4300 + Math.random() * 900
    const volume = 0.008 + Math.random() * 0.012
    const chirps = 2 + Math.floor(Math.random() * 4)
    for (let c = 0; c < chirps; c++) {
      for (let p = 0; p < 4; p++) ping(ac, pan, ac.currentTime + c * 0.32 + p * 0.022, pitch, volume, 0.018)
    }
  }

  function chirp(ac: AudioContext, out: GainNode) {
    const base = 2600 + Math.random() * 1400
    const notes = 2 + Math.floor(Math.random() * 3)
    const pan = ac.createStereoPanner()
    pan.pan.value = Math.random() * 1.6 - 0.8
    pan.connect(out)
    for (let n = 0; n < notes; n++) {
      const t = ac.currentTime + n * (0.11 + Math.random() * 0.05)
      const osc = ac.createOscillator()
      osc.frequency.setValueAtTime(base, t)
      osc.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), t + 0.07)
      const gain = ac.createGain()
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.025, t + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
      osc.connect(gain).connect(pan)
      osc.start(t)
      osc.stop(t + 0.1)
    }
  }

  function noiseBurst(ac: AudioContext, out: AudioNode, at: number, length: number, type: BiquadFilterType, freq: number, q: number, volume: number) {
    if (!noise) return null
    const src = ac.createBufferSource()
    src.buffer = noise
    const filter = ac.createBiquadFilter()
    filter.type = type
    filter.frequency.value = freq
    filter.Q.value = q
    const gain = ac.createGain()
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(volume, at + Math.min(0.03, length * 0.2))
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
    src.connect(filter).connect(gain).connect(out)
    src.start(at, Math.random() * 1.5)
    src.stop(at + length + 0.05)
    return filter
  }

  /** A short decaying tone. */
  function ping(ac: AudioContext, out: AudioNode, at: number, freq: number, volume: number, length: number, type: OscillatorType = 'sine') {
    const osc = ac.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    const gain = ac.createGain()
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(volume, at + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
    osc.connect(gain).connect(out)
    osc.start(at)
    osc.stop(at + length + 0.02)
  }

  /** Placed somewhere: through a panner, at a volume. */
  function placed(ac: AudioContext, out: AudioNode, at: Placement) {
    const pan = ac.createStereoPanner()
    pan.pan.value = Math.max(-1, Math.min(1, at.pan))
    const gain = ac.createGain()
    gain.gain.value = at.volume
    pan.connect(gain).connect(out)
    return pan
  }

  /** Two-stroke engine: a sawtooth through a lowpass, a rumble and a whirr that rises while cutting. */
  function createEngine(ac: AudioContext, out: GainNode, buffer: AudioBuffer, kind: EngineKind) {
    const sound = ENGINES[kind]
    const level = ac.createGain()
    level.gain.value = 0
    level.connect(out)

    const tone = ac.createOscillator()
    tone.type = 'sawtooth'
    tone.frequency.value = sound.hz
    const toneFilter = ac.createBiquadFilter()
    toneFilter.type = 'lowpass'
    toneFilter.frequency.value = sound.bright
    toneFilter.Q.value = 2
    const toneGain = ac.createGain()
    toneGain.gain.value = 0.55
    tone.connect(toneFilter).connect(toneGain).connect(level)

    // The putter: amplitude pulses at the firing rate.
    const pulse = ac.createOscillator()
    pulse.type = 'square'
    pulse.frequency.value = sound.hz / 2
    const pulseDepth = ac.createGain()
    pulseDepth.gain.value = 0.25
    pulse.connect(pulseDepth).connect(toneGain.gain)

    const rumble = ac.createBufferSource()
    rumble.buffer = buffer
    rumble.loop = true
    const rumbleFilter = ac.createBiquadFilter()
    rumbleFilter.type = 'bandpass'
    rumbleFilter.frequency.value = 160
    rumbleFilter.Q.value = 0.9
    const rumbleGain = ac.createGain()
    rumbleGain.gain.value = 0.7
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(level)

    const whirr = ac.createBufferSource()
    whirr.buffer = buffer
    whirr.loop = true
    const whirrFilter = ac.createBiquadFilter()
    whirrFilter.type = 'bandpass'
    whirrFilter.frequency.value = sound.whirr
    whirrFilter.Q.value = 1.2
    const whirrGain = ac.createGain()
    whirrGain.gain.value = 0
    whirr.connect(whirrFilter).connect(whirrGain).connect(level)

    tone.start()
    pulse.start()
    rumble.start(0, 0.3)
    whirr.start(0, 1.1)

    return {
      /** on: engine running. load: 0..1, how much grass is going through. speed: 0..1, how fast it's pushed. */
      set(on: boolean, load: number, speed: number, volume: number) {
        const t = ac.currentTime
        level.gain.setTargetAtTime(on ? sound.level * volume : 0, t, on ? 0.15 : 0.25)
        const rpm = 1 + speed * 0.12 - load * 0.08
        tone.frequency.setTargetAtTime(sound.hz * rpm, t, 0.2)
        pulse.frequency.setTargetAtTime((sound.hz / 2) * rpm, t, 0.2)
        whirrGain.gain.setTargetAtTime(load * 0.55, t, 0.08)
      },
    }
  }

  return {
    /** Call from a click or key handler so the browser lets audio start. */
    unlock() {
      ensure()
    },
    get muted() {
      return muted
    },
    toggleMute() {
      muted = !muted
      try {
        localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
      } catch {
        // Preference just won't stick.
      }
      if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : VOLUME, ctx.currentTime, 0.05)
      return muted
    },
    suspend() {
      if (ctx?.state === 'running') void ctx.suspend()
    },
    resume() {
      if (ctx?.state === 'suspended') void ctx.resume()
    },
    /** The nail clipper closing: a sharp click and a short metallic ring. */
    snip(at = HERE) {
      const ac = ensure()
      if (!master) return
      const out = placed(ac, master, at)
      const t = ac.currentTime
      noiseBurst(ac, out, t, 0.035, 'highpass', 3200, 0.7, 0.5)
      for (const [freq, vol] of [[3150, 0.05], [4720, 0.03], [6900, 0.015]] as const) {
        ping(ac, out, t, freq * (0.98 + Math.random() * 0.04), vol, 0.14)
      }
    },
    /** Scissors closing: two blades scraping past each other, then a small clack. */
    shear(at = HERE) {
      const ac = ensure()
      if (!master) return
      const out = placed(ac, master, at)
      const t = ac.currentTime
      const scrape = noiseBurst(ac, out, t, 0.08, 'bandpass', 2800, 1.4, 0.3)
      scrape?.frequency.exponentialRampToValueAtTime(6000, t + 0.07)
      noiseBurst(ac, out, t + 0.065, 0.04, 'lowpass', 1300, 0.8, 0.3)
      for (const [freq, vol] of [[2350, 0.035], [3510, 0.02]] as const) ping(ac, out, t + 0.065, freq * (0.97 + Math.random() * 0.06), vol, 0.1)
    },
    /** A sickle cutting through air. */
    swoosh(at = HERE) {
      const ac = ensure()
      if (!master) return
      const t = ac.currentTime
      const filter = noiseBurst(ac, placed(ac, master, at), t, 0.26, 'bandpass', 500, 1.1, 0.28)
      if (!filter) return
      filter.frequency.setValueAtTime(500, t)
      filter.frequency.exponentialRampToValueAtTime(2200, t + 0.1)
      filter.frequency.exponentialRampToValueAtTime(700, t + 0.25)
    },
    /** Grass brushing. delay lets a falling blade land before it sounds. */
    rustle(volume: number, length = 0.35, delay = 0) {
      const live = running()
      if (!live) return
      const pan = live.ac.createStereoPanner()
      pan.pan.value = Math.random() * 0.8 - 0.4
      pan.connect(live.out)
      noiseBurst(live.ac, pan, live.ac.currentTime + delay, length, 'bandpass', 1400 + Math.random() * 900, 0.6, volume)
    },
    /**
     * Keeps one engine in step with the game: `slot` names whose it is ('you', 'robots'), `kind` which
     * machine. Cheap to call every frame. Switching kind in a slot stops the old engine.
     */
    engine(slot: string, kind: EngineKind | null, on: boolean, load: number, speed: number, volume = 1) {
      for (const k of Object.keys(ENGINES)) {
        const key = `${slot}:${k}`
        const engine = engines.get(key)
        if (k !== kind) {
          engine?.set(false, 0, 0, 0)
          continue
        }
        if (!on && !engine) continue
        const live = running()
        if (!live || !noise || !kind) continue
        const made = engine ?? createEngine(live.ac, live.out, noise, kind)
        engines.set(key, made)
        made.set(on, load, speed, volume)
      }
    },
    /** Birds by day, crickets by night. */
    setNight(value: boolean) {
      night = value
    },
    /** A cow lowing: a buzzy tone through a vowel that opens from mmm to ooo. */
    moo(at = HERE) {
      const live = running()
      if (!live) return
      const { ac } = live
      const out = placed(ac, live.out, at)
      const t = ac.currentTime
      const length = 1.2 + Math.random() * 0.5
      const base = 105 + Math.random() * 30
      const osc = ac.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(base, t)
      osc.frequency.linearRampToValueAtTime(base * 1.18, t + 0.3)
      osc.frequency.linearRampToValueAtTime(base * 0.85, t + length)
      const vowel = ac.createBiquadFilter()
      vowel.type = 'bandpass'
      vowel.Q.value = 2.2
      vowel.frequency.setValueAtTime(320, t)
      vowel.frequency.linearRampToValueAtTime(780, t + 0.35)
      vowel.frequency.linearRampToValueAtTime(520, t + length)
      const gain = ac.createGain()
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.5, t + 0.15)
      gain.gain.setValueAtTime(0.42, t + length - 0.3)
      gain.gain.linearRampToValueAtTime(0, t + length)
      osc.connect(vowel).connect(gain).connect(out)
      osc.start(t)
      osc.stop(t + length + 0.05)
    },
    /** Something soft and heavy landing in the grass. */
    plop(at = HERE) {
      const live = running()
      if (!live) return
      const { ac } = live
      const out = placed(ac, live.out, at)
      const t = ac.currentTime
      noiseBurst(ac, out, t, 0.16, 'lowpass', 450, 1.2, 0.5)
      noiseBurst(ac, out, t + 0.13, 0.22, 'lowpass', 300, 1.5, 0.4)
      const osc = ac.createOscillator()
      osc.frequency.setValueAtTime(190, t)
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.14)
      const gain = ac.createGain()
      gain.gain.setValueAtTime(0.3, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
      osc.connect(gain).connect(out)
      osc.start(t)
      osc.stop(t + 0.2)
    },
    /**
     * The hum of a passing UFO: two warbling tones that beat against each other over a low drone.
     * Returns a handle to move it each frame (pitch 1 is at rest, Doppler bends it) and to end it.
     */
    ufo() {
      const live = running()
      if (!live) return null
      const { ac } = live
      const pan = ac.createStereoPanner()
      const level = ac.createGain()
      level.gain.value = 0
      pan.connect(level).connect(live.out)
      const filter = ac.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 1800
      filter.connect(pan)

      const voices = [
        { hz: 330, type: 'sine', gain: 0.12 },
        { hz: 333.5, type: 'sine', gain: 0.1 },
        { hz: 55, type: 'triangle', gain: 0.22 },
      ] as const
      const warble = ac.createOscillator()
      warble.frequency.value = 5.5
      const sweep = ac.createOscillator()
      sweep.frequency.value = 0.45
      const oscillators = voices.map((v) => {
        const osc = ac.createOscillator()
        osc.type = v.type
        osc.frequency.value = v.hz
        const gain = ac.createGain()
        gain.gain.value = v.gain
        osc.connect(gain).connect(filter)
        if (v.hz > 100) {
          const warbleDepth = ac.createGain()
          warbleDepth.gain.value = v.hz * 0.05
          warble.connect(warbleDepth).connect(osc.frequency)
          const sweepDepth = ac.createGain()
          sweepDepth.gain.value = v.hz * 0.25
          sweep.connect(sweepDepth).connect(osc.frequency)
        }
        return { osc, hz: v.hz }
      })
      const all = [warble, sweep, ...oscillators.map((o) => o.osc)]
      for (const o of all) o.start()

      return {
        set(at: Placement, pitch: number) {
          const t = ac.currentTime
          level.gain.setTargetAtTime(at.volume, t, 0.1)
          pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, at.pan)), t, 0.1)
          for (const o of oscillators) o.osc.frequency.setTargetAtTime(o.hz * pitch, t, 0.1)
        },
        /** A wobbling sweep down as the beam switches on. */
        beam(at: Placement) {
          const t = ac.currentTime
          const osc = ac.createOscillator()
          osc.type = 'triangle'
          osc.frequency.setValueAtTime(1400, t)
          osc.frequency.exponentialRampToValueAtTime(240, t + 1.4)
          const wobble = ac.createOscillator()
          wobble.frequency.value = 14
          const wobbleDepth = ac.createGain()
          wobbleDepth.gain.value = 60
          wobble.connect(wobbleDepth).connect(osc.frequency)
          const gain = ac.createGain()
          gain.gain.setValueAtTime(0, t)
          gain.gain.linearRampToValueAtTime(0.16 * at.volume, t + 0.08)
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.6)
          osc.connect(gain).connect(live.out)
          for (const o of [osc, wobble]) {
            o.start(t)
            o.stop(t + 1.65)
          }
        },
        /** A rising zap as it shoots off. */
        zap(at: Placement) {
          const t = ac.currentTime
          const osc = ac.createOscillator()
          osc.frequency.setValueAtTime(260, t)
          osc.frequency.exponentialRampToValueAtTime(2600, t + 0.9)
          const gain = ac.createGain()
          gain.gain.setValueAtTime(0, t)
          gain.gain.linearRampToValueAtTime(0.18 * at.volume, t + 0.05)
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 1)
          osc.connect(gain).connect(live.out)
          osc.start(t)
          osc.stop(t + 1.05)
        },
        stop() {
          const t = ac.currentTime
          level.gain.setTargetAtTime(0, t, 0.15)
          for (const o of all) o.stop(t + 1)
        },
      }
    },
    /** Coins changing hands at the stall. */
    kaching() {
      const ac = ensure()
      if (!master) return
      const t = ac.currentTime
      noiseBurst(ac, master, t, 0.06, 'highpass', 4000, 0.7, 0.25)
      ping(ac, master, t + 0.02, note(19), 0.09, 0.25, 'triangle')
      ping(ac, master, t + 0.1, note(26), 0.09, 0.6, 'triangle')
      ping(ac, master, t + 0.1, note(38), 0.025, 0.4)
      for (let i = 0; i < 5; i++) ping(ac, master, t + 0.18 + i * 0.045, note(31 + (i % 2) * 5), 0.02, 0.12)
    },
    /** A sunflower snipped clean: a bright run of notes and a coin. */
    harvest(at = HERE) {
      const live = running()
      if (!live) return
      const out = placed(live.ac, live.out, at)
      const t = live.ac.currentTime
      ;[0, 4, 7, 12, 16].forEach((semi, i) => ping(live.ac, out, t + i * 0.06, note(semi + 3), 0.08, 0.4, 'triangle'))
      ping(live.ac, out, t + 0.32, note(27), 0.06, 0.7, 'triangle')
      ping(live.ac, out, t + 0.32, note(34), 0.03, 0.5)
    },
    /** A sunflower torn up by a tool that doesn't harvest: a crunch and a sad slide. */
    ruin(at = HERE) {
      const live = running()
      if (!live) return
      const out = placed(live.ac, live.out, at)
      const t = live.ac.currentTime
      noiseBurst(live.ac, out, t, 0.25, 'bandpass', 900, 0.8, 0.35)
      const osc = live.ac.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(note(-5), t)
      osc.frequency.exponentialRampToValueAtTime(note(-17), t + 0.5)
      const gain = live.ac.createGain()
      gain.gain.setValueAtTime(0.07, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)
      osc.connect(gain).connect(out)
      osc.start(t)
      osc.stop(t + 0.6)
    },
    /** One syllable of the farmer's mumble. */
    voice() {
      const live = running()
      if (!live) return
      const { ac, out } = live
      const t = ac.currentTime
      const osc = ac.createOscillator()
      osc.type = 'square'
      osc.frequency.setValueAtTime(150 + Math.random() * 70, t)
      osc.frequency.linearRampToValueAtTime(130 + Math.random() * 40, t + 0.08)
      // A vowel-ish band, different each syllable.
      const formant = ac.createBiquadFilter()
      formant.type = 'bandpass'
      formant.frequency.value = 600 + Math.random() * 900
      formant.Q.value = 3
      const gain = ac.createGain()
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.09, t + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
      osc.connect(formant).connect(gain).connect(out)
      osc.start(t)
      osc.stop(t + 0.1)
    },
    /** Metal on stone: a tool hitting a rock. */
    clank(at = HERE) {
      const live = running()
      if (!live) return
      const { ac } = live
      const out = placed(ac, live.out, at)
      const t = ac.currentTime
      noiseBurst(ac, out, t, 0.09, 'bandpass', 2600, 1.4, 0.7)
      noiseBurst(ac, out, t, 0.25, 'lowpass', 380, 1, 0.5)
      for (const [hz, volume] of [[1480, 0.09], [2210, 0.06], [3390, 0.04]] as const) ping(ac, out, t, hz, volume, 0.45, 'triangle')
    },
    /** A robot's happy beep-boop. */
    beep(at = HERE) {
      const live = running()
      if (!live) return
      const out = placed(live.ac, live.out, at)
      const t = live.ac.currentTime
      ping(live.ac, out, t, note(19), 0.05, 0.09, 'square')
      ping(live.ac, out, t + 0.1, note(24), 0.05, 0.12, 'square')
    },
    /** A rising arpeggio and a pop, for reaching a new level. */
    levelUp() {
      const ac = ensure()
      const out = master
      if (!out) return
      const t = ac.currentTime
      noiseBurst(ac, out, t, 0.12, 'bandpass', 1800, 0.7, 0.45)
      ;[3, 7, 10, 15].forEach((semi, i) => {
        ping(ac, out, t + 0.05 + i * 0.09, note(semi), 0.11, 0.5, 'triangle')
        ping(ac, out, t + 0.05 + i * 0.09, note(semi + 12), 0.03, 0.35)
      })
      ping(ac, out, t + 0.42, note(15), 0.08, 1.1, 'triangle')
      ping(ac, out, t + 0.42, note(22), 0.06, 1.1, 'triangle')
    },
    /** The last blade: a longer fanfare. */
    fanfare() {
      const ac = ensure()
      if (!master) return
      const t = ac.currentTime
      const melody: [number, number][] = [[-2, 0], [2, 0.14], [5, 0.28], [10, 0.42], [5, 0.62], [10, 0.76]]
      for (const [semi, at] of melody) {
        ping(ac, master, t + at, note(semi), 0.1, 0.45, 'triangle')
        ping(ac, master, t + at, note(semi + 12), 0.025, 0.3)
      }
      for (const semi of [-2, 2, 5, 10]) ping(ac, master, t + 0.95, note(semi), 0.06, 2, 'triangle')
    },
    /** One firework sound `delay` seconds from now. Far ones arrive later and quieter, as sound does. */
    firework(delay: number, kind: 'launch' | 'burst' | 'crackle', distance: number) {
      const live = running()
      if (!live) return
      const { ac, out } = live
      const t = ac.currentTime + delay + (kind === 'launch' ? 0 : distance / 343)
      const volume = Math.min(1, 30 / Math.max(distance, 10))
      if (kind === 'launch') {
        const osc = ac.createOscillator()
        osc.frequency.setValueAtTime(700, t)
        osc.frequency.exponentialRampToValueAtTime(2100, t + 1.2)
        const gain = ac.createGain()
        gain.gain.setValueAtTime(0, t)
        gain.gain.linearRampToValueAtTime(0.012 * volume, t + 0.1)
        gain.gain.linearRampToValueAtTime(0, t + 1.3)
        osc.connect(gain).connect(out)
        osc.start(t)
        osc.stop(t + 1.35)
        noiseBurst(ac, out, t, 0.25, 'highpass', 2500, 0.5, 0.05 * volume)
      } else if (kind === 'burst') {
        noiseBurst(ac, out, t, 1.6, 'lowpass', 220, 0.7, 0.9 * volume)
        noiseBurst(ac, out, t, 0.18, 'lowpass', 1200, 0.5, 0.5 * volume)
      } else {
        for (let i = 0; i < 26; i++) noiseBurst(ac, out, t + Math.random() * 1.6, 0.02, 'highpass', 3000 + Math.random() * 3000, 0.7, 0.12 * volume)
      }
    },
  }
}

export type Audio = ReturnType<typeof createAudio>
