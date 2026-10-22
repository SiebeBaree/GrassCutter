import { describe, expect, it } from 'vitest'
import { BLADE_COUNT, bladeLean, CHUNKS, createField, forEachStandingNear, PARKED, pickBlade, PUSHERS, regrowthCandidate, type Pick, type Ray } from './field'

const field = createField()

describe('field', () => {
  it('generates the same meadow every time', () => {
    // Saves point at blades by grid cell. If this fingerprint changes, bump SAVE_VERSION in save.ts.
    const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0)
    expect(field.x.length).toBe(BLADE_COUNT)
    expect(field.chunkStart[CHUNKS * CHUNKS]).toBe(BLADE_COUNT)
    expect([field.x[0], field.z[0], field.height[0]].map((v) => v.toFixed(4))).toMatchSnapshot()
    expect([sum(field.x), sum(field.z), sum(field.yaw)].map((v) => v.toFixed(0))).toMatchSnapshot()
  })

  it('finds every standing blade rooted near a point', () => {
    const growth = new Uint8Array(BLADE_COUNT).fill(255)
    const i = 1234
    const found: number[] = []
    forEachStandingNear(field, growth, field.x[i], field.z[i], 0.5, (j) => found.push(j))
    const brute: number[] = []
    for (let j = 0; j < BLADE_COUNT; j++) if (Math.hypot(field.x[j] - field.x[i], field.z[j] - field.z[i]) <= 0.5) brute.push(j)
    expect(found.sort()).toEqual(brute.sort())

    growth[i] = 0
    found.length = 0
    forEachStandingNear(field, growth, field.x[i], field.z[i], 0.5, (j) => found.push(j))
    expect(found).not.toContain(i)
  })

  it('picks the blade under the crosshair within reach and skips cut ones', () => {
    const away = new Float32Array(PUSHERS * 4)
    for (let p = 0; p < away.length; p += 4) away.set([PARKED, PARKED, 1, 0], p)
    const i = 42
    // The meadow is dense enough that neighbours would block the ray, so only blade i stands.
    const growth = new Uint8Array(BLADE_COUNT)
    growth[i] = 255
    const pick: Pick = { blade: -1, s: 0 }

    // A point halfway up blade i, matching the shader's bend and wind at time 0.
    const lean = bladeLean(field.x[i], field.z[i], 0, away, { x: 0, z: 0 })
    const w = 0.25 * field.height[i]
    const px = field.x[i] + (Math.sin(field.yaw[i]) * field.bend[i] + lean.x) * w
    const pz = field.z[i] + (Math.cos(field.yaw[i]) * field.bend[i] + lean.z) * w
    const py = 0.5 * field.height[i]
    const ray: Ray = { ox: px - 0.12, oy: py, oz: pz, dx: 1, dy: 0, dz: 0 }

    expect(pickBlade(field, growth, ray, 2, 0, away, pick) && pick.blade).toBe(i)
    pickBlade(field, growth, ray, 0.08, 0, away, pick)
    expect(pick.blade).not.toBe(i)
    growth[i] = 0
    pickBlade(field, growth, ray, 2, 0, away, pick)
    expect(pick.blade).not.toBe(i)
  })

  it('only grows grass back next to standing grass', () => {
    const growth = new Uint8Array(BLADE_COUNT)
    // A cleared meadow stays cleared.
    for (let n = 0; n < 10_000; n++) expect(regrowthCandidate(field, growth, Math.random)).toBe(-1)
    // One blade left: each try that lands on it sprouts one of its eight neighbours.
    const i = 500_000
    growth[i] = 255
    for (let k = 0; k < 8; k++) {
      const picks = [(i + 0.5) / BLADE_COUNT, (k + 0.5) / 8]
      const j = regrowthCandidate(field, growth, () => picks.shift() ?? 0)
      expect(j).toBeGreaterThanOrEqual(0)
      expect(Math.hypot(field.x[j] - field.x[i], field.z[j] - field.z[i])).toBeLessThan(0.6)
    }
  })
})
