import { describe, expect, it } from 'vitest'
import { SICKLE, sickleSweep } from './tools'

describe('tools', () => {
  it('sweeps the sickle from right to left, then holds', () => {
    const cutting = SICKLE.swing * SICKLE.cutShare
    expect(sickleSweep(0)).toBe(1)
    expect(sickleSweep(cutting / 2)).toBeCloseTo(0)
    expect(sickleSweep(cutting)).toBe(-1)
    expect(sickleSweep(SICKLE.swing)).toBe(-1)
  })
})
