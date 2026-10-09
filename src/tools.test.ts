import { describe, expect, it } from 'vitest'
import { levelFor, levelRange, MAX_LEVEL, SICKLE, sickleSweep } from './tools'

describe('tools', () => {
  it('levels up at each unlock threshold', () => {
    expect(levelFor(0)).toBe(1)
    expect(levelFor(2_499)).toBe(1)
    expect(levelFor(2_500)).toBe(2)
    expect(levelFor(10_000)).toBe(3)
    expect(levelFor(1e9)).toBe(MAX_LEVEL)
    expect(levelRange(1)).toEqual({ from: 0, to: 2_500 })
    expect(levelRange(MAX_LEVEL)).toBeNull()
  })

  it('sweeps the sickle from right to left, then holds', () => {
    const cutting = SICKLE.swing * SICKLE.cutShare
    expect(sickleSweep(0)).toBe(1)
    expect(sickleSweep(cutting / 2)).toBeCloseTo(0)
    expect(sickleSweep(cutting)).toBe(-1)
    expect(sickleSweep(SICKLE.swing)).toBe(-1)
  })
})
