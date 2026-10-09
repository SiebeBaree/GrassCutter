import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping } from 'three'
import { mulberry32 } from './field'

const SIZE = 256
const OCTAVES = 4

/**
 * Tileable fractal value noise, one pattern per channel, each coarser than the next: R starts at
 * 4 lattice cells across, G at 8, B at 16, A at 32. Shaders sample it instead of computing noise per pixel.
 */
export function createNoiseTexture() {
  const data = new Uint8Array(SIZE * SIZE * 4)
  for (let channel = 0; channel < 4; channel++) fbm(data, channel, 4 << channel, 0x5eed + channel)
  const texture = new DataTexture(data, SIZE, SIZE)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

function fbm(out: Uint8Array, channel: number, period: number, seed: number) {
  const rand = mulberry32(seed)
  const sum = new Float32Array(SIZE * SIZE)
  let amplitude = 1
  let total = 0
  for (let o = 0; o < OCTAVES; o++, period *= 2, amplitude *= 0.5) {
    const lattice = Float32Array.from({ length: period * period }, rand)
    const cell = SIZE / period
    for (let y = 0; y < SIZE; y++) {
      const fy = y / cell
      const y0 = Math.floor(fy)
      const ty = smooth(fy - y0)
      const r0 = (y0 % period) * period
      const r1 = ((y0 + 1) % period) * period
      for (let x = 0; x < SIZE; x++) {
        const fx = x / cell
        const x0 = Math.floor(fx)
        const tx = smooth(fx - x0)
        const c0 = x0 % period
        const c1 = (x0 + 1) % period
        const top = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * tx
        const bottom = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * tx
        sum[y * SIZE + x] += (top + (bottom - top) * ty) * amplitude
      }
    }
    total += amplitude
  }
  // Octaves pile up around the middle; stretch the result back over the full range.
  for (let i = 0; i < sum.length; i++) {
    const v = (sum[i] / total - 0.5) * 1.8 + 0.5
    out[i * 4 + channel] = Math.round(Math.min(1, Math.max(0, v)) * 255)
  }
}

function smooth(t: number) {
  return t * t * (3 - 2 * t)
}
