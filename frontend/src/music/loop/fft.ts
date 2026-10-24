// Small in-place radix-2 complex FFT (no dependencies). Plans are cached per size.

export interface FftPlan {
  size: number
  reverse: Uint32Array
  cos: Float64Array
  sin: Float64Array
}

const plans = new Map<number, FftPlan>()

export function fftPlan(size: number): FftPlan {
  const cached = plans.get(size)
  if (cached) return cached
  if (size < 2 || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two')
  const bits = Math.log2(size)
  const reverse = new Uint32Array(size)
  for (let i = 0; i < size; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b)
    reverse[i] = r
  }
  const cos = new Float64Array(size / 2)
  const sin = new Float64Array(size / 2)
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size)
    sin[i] = -Math.sin((2 * Math.PI * i) / size)
  }
  const plan = { size, reverse, cos, sin }
  plans.set(size, plan)
  return plan
}

/** Forward transform in place. */
export function fft(plan: FftPlan, re: Float64Array, im: Float64Array): void {
  const { size, reverse, cos, sin } = plan
  for (let i = 0; i < size; i++) {
    const j = reverse[i]!
    if (j > i) {
      const tr = re[i]!
      re[i] = re[j]!
      re[j] = tr
      const ti = im[i]!
      im[i] = im[j]!
      im[j] = ti
    }
  }
  for (let half = 1; half < size; half <<= 1) {
    const step = size / (half << 1)
    for (let start = 0; start < size; start += half << 1) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const wr = cos[w]!
        const wi = sin[w]!
        const a = start + k
        const b = a + half
        const xr = re[b]! * wr - im[b]! * wi
        const xi = re[b]! * wi + im[b]! * wr
        re[b] = re[a]! - xr
        im[b] = im[a]! - xi
        re[a] = re[a]! + xr
        im[a] = im[a]! + xi
      }
    }
  }
}
