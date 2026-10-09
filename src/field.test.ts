import { describe, expect, it } from 'vitest'
import { BLADE_COUNT, bladeLean, CHUNKS, createField, forEachStandingNear, pickBlade, type Pick, type Ray } from './field'

const field = createField()

describe('field', () => {
  it('generates the same meadow every time', () => {
    // Saves point at blades by index. If this fingerprint changes, bump SAVE_VERSION in save.ts.
    const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0)
    expect(field.x.length).toBe(BLADE_COUNT)
    expect(field.chunkStart[CHUNKS * CHUNKS]).toBe(BLADE_COUNT)
    expect([field.x[0], field.z[0], field.height[0]].map((v) => v.toFixed(4))).toMatchSnapshot()
    expect([sum(field.x), sum(field.z), sum(field.yaw)].map((v) => v.toFixed(0))).toMatchSnapshot()
  })

  it('finds every standing blade rooted near a point', () => {
    const cut = new Uint8Array(BLADE_COUNT)
    const i = 1234
    const found: number[] = []
    forEachStandingNear(field, cut, field.x[i], field.z[i], 0.5, (j) => found.push(j))
    const brute: number[] = []
    for (let j = 0; j < BLADE_COUNT; j++) if (Math.hypot(field.x[j] - field.x[i], field.z[j] - field.z[i]) <= 0.5) brute.push(j)
    expect(found.sort()).toEqual(brute.sort())

    cut[i] = 1
    found.length = 0
    forEachStandingNear(field, cut, field.x[i], field.z[i], 0.5, (j) => found.push(j))
    expect(found).not.toContain(i)
  })

  it('picks the blade under the crosshair within reach and skips cut ones', () => {
    const away = { x: 100, z: 100 }
    const i = 42
    // The meadow is dense enough that neighbours would block the ray, so only blade i stands.
    const cut = new Uint8Array(BLADE_COUNT).fill(1)
    cut[i] = 0
    const pick: Pick = { blade: -1, s: 0 }

    // A point halfway up blade i, matching the shader's bend and wind at time 0.
    const lean = bladeLean(field.x[i], field.z[i], 0, away, { x: 0, z: 0 })
    const w = 0.25 * field.height[i]
    const px = field.x[i] + (Math.sin(field.yaw[i]) * field.bend[i] + lean.x) * w
    const pz = field.z[i] + (Math.cos(field.yaw[i]) * field.bend[i] + lean.z) * w
    const py = 0.5 * field.height[i]
    const ray: Ray = { ox: px - 0.12, oy: py, oz: pz, dx: 1, dy: 0, dz: 0 }

    expect(pickBlade(field, cut, ray, 2, 0, away, pick) && pick.blade).toBe(i)
    pickBlade(field, cut, ray, 0.08, 0, away, pick)
    expect(pick.blade).not.toBe(i)
    cut[i] = 1
    pickBlade(field, cut, ray, 2, 0, away, pick)
    expect(pick.blade).not.toBe(i)
  })
})
