import { describe, expect, it } from 'vitest'
import { BLADE_COUNT, bladeLean, createField, createGrid, pickBlade, type Ray } from './field'

describe('field', () => {
  it('generates the same meadow every time', () => {
    // Saves point at blades by index. If this fingerprint changes, bump SAVE_VERSION in save.ts.
    const field = createField()
    const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0)
    expect(field.x.length).toBe(BLADE_COUNT)
    expect([field.x[0], field.z[0], field.height[0]].map((v) => v.toFixed(4))).toMatchSnapshot()
    expect([sum(field.x), sum(field.z), sum(field.yaw)].map((v) => v.toFixed(2))).toMatchSnapshot()
  })

  it('picks the blade under the crosshair within reach and skips cut ones', () => {
    const field = createField()
    const grid = createGrid(field)
    const cut = new Uint8Array(BLADE_COUNT)
    const away = { x: 100, z: 100 }
    const i = 42

    // A point halfway up blade i, matching the shader's bend and wind at time 0.
    const lean = bladeLean(field.x[i], field.z[i], 0, away, { x: 0, z: 0 })
    const w = 0.25 * field.height[i]
    const px = field.x[i] + (Math.sin(field.yaw[i]) * field.bend[i] + lean.x) * w
    const pz = field.z[i] + (Math.cos(field.yaw[i]) * field.bend[i] + lean.z) * w
    const py = 0.5 * field.height[i]
    const ray: Ray = { ox: px - 0.12, oy: py, oz: pz, dx: 1, dy: 0, dz: 0 }

    expect(pickBlade(field, grid, cut, ray, 2, 0, away)).toBe(i)
    expect(pickBlade(field, grid, cut, ray, 0.08, 0, away)).not.toBe(i)
    cut[i] = 1
    expect(pickBlade(field, grid, cut, ray, 2, 0, away)).not.toBe(i)
  })
})
