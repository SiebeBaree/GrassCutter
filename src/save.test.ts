import { describe, expect, it } from 'vitest'
import { BLADE_COUNT } from './field'
import { BLADE, decodeSave, encodeSave, SPAWN, type Save } from './save'

function sampleSave(): Save {
  const cut = new Uint8Array(BLADE_COUNT)
  cut[0] = BLADE.fellForward
  cut[7] = BLADE.fellBack
  cut[8] = BLADE.fellForward
  cut[BLADE_COUNT - 1] = BLADE.fellBack
  return { cut, player: { x: 1.5, z: -2.25, yaw: 0.5, pitch: -0.2 }, playSeconds: 93.5 }
}

describe('save', () => {
  it('round-trips cut blades, fall direction, position and play time', () => {
    const save = sampleSave()
    const loaded = decodeSave(encodeSave(save))
    expect(loaded).not.toBeNull()
    expect([...(loaded?.cut ?? [])]).toEqual([...save.cut])
    expect(loaded?.player).toEqual(save.player)
    expect(loaded?.playSeconds).toBe(93.5)
  })

  it('rejects anything that is not a save for this field', () => {
    expect(decodeSave('not json')).toBeNull()
    expect(decodeSave('{}')).toBeNull()
    const json = JSON.parse(encodeSave(sampleSave()))
    expect(decodeSave(JSON.stringify({ ...json, version: 2 }))).toBeNull()
    expect(decodeSave(JSON.stringify({ ...json, cut: btoa('too short') }))).toBeNull()
  })

  it('keeps progress when only the position or timer is broken', () => {
    const json = JSON.parse(encodeSave(sampleSave()))
    const loaded = decodeSave(JSON.stringify({ ...json, player: { x: 'oops' }, playSeconds: -4, fellBack: 'bad' }))
    expect(loaded?.player).toEqual(SPAWN)
    expect(loaded?.playSeconds).toBe(0)
    expect(loaded?.cut[7]).toBe(BLADE.fellForward)
  })

  it('never writes a non-finite position', () => {
    const save = sampleSave()
    save.player.x = Number.NaN
    expect(decodeSave(encodeSave(save))?.player).toEqual(SPAWN)
  })
})
