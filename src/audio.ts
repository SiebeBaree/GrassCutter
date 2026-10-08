// Every sound is synthesised: filtered noise for wind and rustling, sine partials for the metal snip.

const MUTE_KEY = 'grass-cutter/muted'

export function createAudio() {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let noise: AudioBuffer | null = null
  let muted = readMuted()

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
      master.gain.value = muted ? 0 : 0.8
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
    setTimeout(() => {
      if (ctx && master && ctx.state === 'running') chirp(ctx, master)
      scheduleBird()
    }, 3500 + Math.random() * 9000)
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
    if (!noise) return
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
      if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05)
      return muted
    },
    suspend() {
      if (ctx?.state === 'running') void ctx.suspend()
    },
    resume() {
      if (ctx?.state === 'suspended') void ctx.resume()
    },
    /** The clipper closing: a sharp click and a short metallic ring. */
    snip() {
      const ac = ensure()
      if (!master) return
      const t = ac.currentTime
      noiseBurst(ac, master, t, 0.035, 'highpass', 3200, 0.7, 0.5)
      for (const [freq, vol] of [[3150, 0.05], [4720, 0.03], [6900, 0.015]] as const) {
        const osc = ac.createOscillator()
        osc.frequency.value = freq * (0.98 + Math.random() * 0.04)
        const gain = ac.createGain()
        gain.gain.setValueAtTime(vol, t)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
        osc.connect(gain).connect(master)
        osc.start(t)
        osc.stop(t + 0.15)
      }
    },
    /** Grass brushing. delay lets a falling blade land before it sounds. */
    rustle(volume: number, length = 0.35, delay = 0) {
      if (!ctx || !master || ctx.state !== 'running') return
      const pan = ctx.createStereoPanner()
      pan.pan.value = Math.random() * 0.8 - 0.4
      pan.connect(master)
      noiseBurst(ctx, pan, ctx.currentTime + delay, length, 'bandpass', 1400 + Math.random() * 900, 0.6, volume)
    },
  }
}

export type Audio = ReturnType<typeof createAudio>
