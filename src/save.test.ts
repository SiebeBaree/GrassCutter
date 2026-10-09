import { describe, expect, it } from 'vitest'
import { BLADE_COUNT } from './field'
import { decodeSave, encodeSave, SPAWN, type Save } from './save'

function sampleSave(): Save {
  const cut = new Uint8Array(BLADE_COUNT)
  for (const i of [0, 7, 8, 99_999, BLADE_COUNT - 1]) cut[i] = 1
  return { cut, player: { x: 1.5, z: -2.25, yaw: 0.5, pitch: -0.2 }, playSeconds: 93.5, tool: 2, finishedAt: null }
}

describe('save', () => {
  it('round-trips cut blades, position, play time, tool and finish time', () => {
    const save = { ...sampleSave(), finishedAt: 1_760_000_000_000 }
    const loaded = decodeSave(encodeSave(save))
    expect(loaded).not.toBeNull()
    expect([...(loaded?.cut ?? [])]).toEqual([...save.cut])
    expect(loaded?.player).toEqual(save.player)
    expect(loaded?.playSeconds).toBe(93.5)
    expect(loaded?.tool).toBe(2)
    expect(loaded?.finishedAt).toBe(1_760_000_000_000)
  })

  it('rejects anything that is not a save for this field', () => {
    expect(decodeSave('not json')).toBeNull()
    expect(decodeSave('{}')).toBeNull()
    const json = JSON.parse(encodeSave(sampleSave()))
    expect(decodeSave(JSON.stringify({ ...json, version: 1 }))).toBeNull()
    expect(decodeSave(JSON.stringify({ ...json, cut: btoa('too short') }))).toBeNull()
  })

  it('keeps progress when only the position, timer or tool is broken', () => {
    const json = JSON.parse(encodeSave(sampleSave()))
    const loaded = decodeSave(JSON.stringify({ ...json, player: { x: 'oops' }, playSeconds: -4, tool: 9 }))
    expect(loaded?.player).toEqual(SPAWN)
    expect(loaded?.playSeconds).toBe(0)
    expect(loaded?.tool).toBe(0)
    expect(loaded?.cut[7]).toBe(1)
  })

  it('never writes a non-finite position', () => {
    const save = sampleSave()
    save.player.x = Number.NaN
    expect(decodeSave(encodeSave(save))?.player).toEqual(SPAWN)
  })
})
