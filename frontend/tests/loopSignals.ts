// Deterministic synthetic "music" for the loop tests: no randomness beyond a seeded LCG.

export function lcg(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

const SCALE = [0, 2, 4, 7, 9]

/** Eighth notes at 120 bpm (0.25 s): pentatonic pitches over three octaves, 3 harmonics, decaying. */
export function renderNotes(seed: number, seconds: number, sampleRate: number, gain = 0.3): Float32Array {
  const next = lcg(seed)
  const out = new Float32Array(Math.round(seconds * sampleRate))
  const slot = Math.round(0.25 * sampleRate)
  for (let start = 0, index = 0; start < out.length; start += slot, index++) {
    const midi = 45 + SCALE[Math.floor(next() * 5)]! + 12 * Math.floor(next() * 3)
    const hz = 440 * 2 ** ((midi - 69) / 12)
    const kick = index % 2 === 0
    for (let i = 0; i < slot && start + i < out.length; i++) {
      const t = i / sampleRate
      const env = Math.min(1, t / 0.004) * Math.exp(-t * 7)
      let v = 0
      for (let h = 1; h <= 3; h++) v += Math.sin(2 * Math.PI * hz * h * t) / h
      if (kick) v += 1.5 * Math.sin(2 * Math.PI * (60 + 80 * Math.exp(-t * 30)) * t) * Math.exp(-t * 14)
      out[start + i] = gain * env * v
    }
  }
  return out
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function fadeOut(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = x[i]! * (1 - i / x.length) ** 2
  return out
}

export function noise(seed: number, seconds: number, sampleRate: number, gain = 0.3): Float32Array {
  const next = lcg(seed)
  const out = new Float32Array(Math.round(seconds * sampleRate))
  for (let i = 0; i < out.length; i++) out[i] = gain * (next() * 2 - 1)
  return out
}

/** Intro + body x2 + fade-out (the fade continues the body). Returns the signal and the truth. */
export function introBodyFade(sampleRate: number, introSeconds = 3, bodySeconds = 20, fadeSeconds = 4) {
  const intro = renderNotes(11, introSeconds, sampleRate, 0.15)
  const body = renderNotes(22, bodySeconds, sampleRate)
  const fade = fadeOut(body.subarray(0, Math.round(fadeSeconds * sampleRate)))
  return {
    pcm: concat(intro, body, body, fade),
    introSamples: intro.length,
    bodySamples: body.length,
    fadeSamples: fade.length,
  }
}
