import { describe, expect, it } from 'vitest'
import { BLADE_COUNT, createField } from './field'
import { SPAWN } from './layout'
import { decodeSave, encodeSave, type Save } from './save'
import { deriveKey, seal, unseal } from './vault'

const { cellBlade } = createField()

function sampleSave(): Save {
  const growth = new Uint8Array(BLADE_COUNT).fill(255)
  for (const i of [0, 7, 8, 99_999, BLADE_COUNT - 1]) growth[i] = 0
  // A sprout halfway up still counts as standing.
  growth[12] = 120
  return {
    growth,
    coins: 1234,
    earned: 5678,
    tier: 3,
    tool: 2,
    robots: [{ tier: 1, x: 3, z: 4, yaw: 0.5 }],
    sunflowers: [{ x: 10, z: -20 }],
    player: { x: 1.5, z: -2.25, yaw: 0.5, pitch: -0.2 },
    playSeconds: 93.5,
    finishedAt: null,
  }
}

const header = (bytes: Uint8Array) => {
  const length = new DataView(bytes.buffer).getUint32(0, true)
  return { length, json: JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length))) }
}

/** Swaps the JSON header of an encoded save, keeping the bits. */
function withHeader(bytes: Uint8Array, change: (json: Record<string, unknown>) => Record<string, unknown>) {
  const { length, json } = header(bytes)
  const next = new TextEncoder().encode(JSON.stringify(change(json)))
  const out = new Uint8Array(4 + next.length + bytes.length - 4 - length)
  new DataView(out.buffer).setUint32(0, next.length, true)
  out.set(next, 4)
  out.set(bytes.subarray(4 + length), 4 + next.length)
  return out
}

describe('save', () => {
  it('round-trips every blade, the wallet, the robots and where you were', () => {
    const save = sampleSave()
    const loaded = decodeSave(encodeSave(save, cellBlade), cellBlade)
    expect(loaded).not.toBeNull()
    const { growth, ...rest } = save
    expect(loaded).toMatchObject(rest)
    expect([...(loaded?.growth ?? [])].map(Boolean)).toEqual([...growth].map(Boolean))
  })

  it('rejects anything that is not a save for this field', () => {
    const bytes = encodeSave(sampleSave(), cellBlade)
    expect(decodeSave(new Uint8Array(3), cellBlade)).toBeNull()
    expect(decodeSave(bytes.subarray(0, bytes.length - 1), cellBlade)).toBeNull()
    expect(decodeSave(withHeader(bytes, (json) => ({ ...json, version: 2 })), cellBlade)).toBeNull()
    expect(decodeSave(withHeader(bytes, (json) => ({ ...json, coins: -5 })), cellBlade)).toBeNull()
  })

  it('keeps progress when only the position, timer or tool is broken', () => {
    const bytes = withHeader(encodeSave(sampleSave(), cellBlade), (json) => ({ ...json, player: { x: 'oops' }, playSeconds: -4, tool: 9 }))
    const loaded = decodeSave(bytes, cellBlade)
    expect(loaded?.player).toEqual(SPAWN)
    expect(loaded?.playSeconds).toBe(0)
    expect(loaded?.tool).toBe(0)
    expect(loaded?.coins).toBe(1234)
  })
})

describe('vault', () => {
  const bytes = new TextEncoder().encode('one blade at a time '.repeat(50))

  it('opens what it sealed, and compresses it', async () => {
    const key = await deriveKey('salt', 'browser')
    const text = await seal(key, bytes)
    expect(text.length).toBeLessThan(bytes.length / 4)
    expect(await unseal(key, text)).toEqual(bytes)
  })

  it('refuses edited saves and saves sealed for someone else', async () => {
    const key = await deriveKey('salt', 'browser')
    const text = await seal(key, bytes)
    const edited = text.slice(0, 30) + (text[30] === 'A' ? 'B' : 'A') + text.slice(31)
    expect(await unseal(key, edited)).toBeNull()
    expect(await unseal(await deriveKey('other salt', 'browser'), text)).toBeNull()
    expect(await unseal(await deriveKey('salt', 'other browser'), text)).toBeNull()
    expect(await unseal(key, 'not base64 at all!')).toBeNull()
  })
})
