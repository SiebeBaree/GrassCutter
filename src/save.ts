import { z } from 'zod'
import type { RobotSave } from './economy'
import { BLADE_COUNT, type Growth } from './field'
import { SPAWN } from './layout'
import { MAX_ROBOTS, TIERS, type Tier } from './tools'
import { browserFingerprint, deriveKey, installSalt, seal, unseal } from './vault'

// Progress lives in localStorage, sealed by vault.ts. Inside is a small JSON header (coins, tools, robots,
// position) followed by one bit per blade. The bits run in grid order rather than blade order, so a
// mown stripe is a run of zeros and the whole thing compresses well.

/**
 * Bump when field generation changes: old bitsets would point at different blades. Fields added since
 * (like the cows in 3.1) are optional instead, so saves from earlier 3.x builds keep opening.
 */
const SAVE_VERSION = 3
const SAVE_KEY = 'grass-cutter/v3'
/**
 * A save that wouldn't open is set aside here instead of being overwritten. Changing how the browser
 * reports itself (a desktop-site toggle, a dev tools device) changes the key, and switching back
 * should bring the old save back.
 */
const ASIDE_KEY = 'grass-cutter/v3-unopened'
/** Saves from earlier versions. They don't carry over, so they're deleted on load. */
const OLD_KEYS = ['grass-cutter/save']
const MAX_SUNFLOWERS = 40
const MAX_COWS = 8
const MAX_ALIEN = 20_000
const TIER_COUNT = TIERS.length

const PlayerSchema = z.object({ x: z.number(), z: z.number(), yaw: z.number(), pitch: z.number() })
const SpotSchema = z.object({ x: z.number(), z: z.number(), yaw: z.number() })
const TierSchema = z.literal([0, 1, 2, 3, 4, 5])

const HeaderSchema = z.object({
  version: z.literal(SAVE_VERSION),
  coins: z.number().int().nonnegative(),
  tier: TierSchema,
  robots: z.array(z.object({ tier: TierSchema, x: z.number(), z: z.number(), yaw: z.number(), broken: z.boolean().optional() })).max(MAX_ROBOTS),
  // A broken position, timer or flower shouldn't cost anyone their progress.
  earned: z.number().nonnegative().catch(0),
  tool: TierSchema.catch(0),
  sunflowers: z.array(z.object({ x: z.number(), z: z.number() })).max(MAX_SUNFLOWERS).catch([]),
  player: PlayerSchema.catch(SPAWN),
  playSeconds: z.number().nonnegative().catch(0),
  /** When the last blade fell, in ms since the epoch. */
  finishedAt: z.number().nullable().catch(null),
  /** Added in 3.1. Missing from older saves, which then start a fresh herd. */
  cows: z.array(SpotSchema).max(MAX_COWS).catch([]),
  /** Added in 3.1. Purple blades a UFO left standing, by blade index. */
  alien: z.array(z.number().int().min(0).max(BLADE_COUNT - 1)).max(MAX_ALIEN).catch([]),
  /** Added in 3.2. Your tools that hit a rock and wait for the farmer, by tier. */
  broken: z.array(TierSchema).max(TIER_COUNT).catch([]),
})

export type PlayerState = z.infer<typeof PlayerSchema>
export type CowSave = z.infer<typeof SpotSchema>

export type Save = {
  /** 255 for every standing blade, 0 for every cut one. */
  growth: Growth
  coins: number
  /** Every bCoin ever made, spent or not. */
  earned: number
  tier: Tier
  /** The tool in hand. Never above `tier`. */
  tool: Tier
  robots: RobotSave[]
  sunflowers: { x: number; z: number }[]
  player: PlayerState
  playSeconds: number
  finishedAt: number | null
  cows: CowSave[]
  /** Blades a UFO turned purple that are still standing. */
  alien: number[]
  /** Your tools that hit a rock, by tier. */
  broken: Tier[]
}

const finite = (...values: number[]) => values.every(Number.isFinite)

/** Header and bits as bytes. `cellBlade` from the field sets the order of the bits. */
export function encodeSave(save: Save, cellBlade: Int32Array) {
  const { x, z: pz, yaw, pitch } = save.player
  const header = new TextEncoder().encode(
    JSON.stringify({
      version: SAVE_VERSION,
      coins: Math.floor(save.coins),
      tier: save.tier,
      robots: save.robots.map((r) => (finite(r.x, r.z, r.yaw) ? r : { ...r, ...SPAWN })),
      earned: Math.floor(save.earned),
      tool: save.tool <= save.tier ? save.tool : save.tier,
      sunflowers: save.sunflowers.slice(0, MAX_SUNFLOWERS),
      player: finite(x, pz, yaw, pitch) ? save.player : SPAWN,
      playSeconds: Number.isFinite(save.playSeconds) ? save.playSeconds : 0,
      finishedAt: save.finishedAt,
      cows: save.cows.filter((c) => finite(c.x, c.z, c.yaw)).slice(0, MAX_COWS),
      alien: save.alien.filter((i) => save.growth[i] > 0).slice(0, MAX_ALIEN),
      broken: [...new Set(save.broken)].filter((t) => t <= save.tier),
    } satisfies z.input<typeof HeaderSchema>),
  )
  const bytes = new Uint8Array(4 + header.length + BLADE_COUNT / 8)
  new DataView(bytes.buffer).setUint32(0, header.length, true)
  bytes.set(header, 4)
  const bits = bytes.subarray(4 + header.length)
  let k = 0
  for (const i of cellBlade) {
    if (i < 0) continue
    if (save.growth[i]) bits[k >> 3] |= 1 << (k & 7)
    k++
  }
  return bytes
}

/** Null unless the bytes hold a save for this version of the field. */
export function decodeSave(bytes: Uint8Array, cellBlade: Int32Array): Save | null {
  if (bytes.length < 4) return null
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true)
  if (bytes.length !== 4 + headerLength + BLADE_COUNT / 8) return null
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)))
  } catch {
    return null
  }
  const parsed = HeaderSchema.safeParse(json)
  if (!parsed.success) return null

  const bits = bytes.subarray(4 + headerLength)
  const growth = new Uint8Array(BLADE_COUNT)
  let k = 0
  for (const i of cellBlade) {
    if (i < 0) continue
    growth[i] = (bits[k >> 3] >> (k & 7)) & 1 ? 255 : 0
    k++
  }
  const { version: _, tool, tier, alien, broken, ...rest } = parsed.data
  return { ...rest, growth, tier, tool: tool <= tier ? tool : tier, alien: alien.filter((i) => growth[i] > 0), broken: broken.filter((t) => t <= tier) }
}

let key: Promise<CryptoKey> | null = null
const vaultKey = () => (key ??= deriveKey(installSalt(), browserFingerprint()))

/**
 * Your save, or null if there's none that opens here (edited by hand, or from another browser). Of the
 * current save and one set aside earlier, the one with more progress wins.
 */
export async function loadSave(cellBlade: Int32Array) {
  try {
    for (const old of OLD_KEYS) localStorage.removeItem(old)
    const key = await vaultKey()
    const open = async (slot: string) => {
      const text = localStorage.getItem(slot)
      const bytes = text === null ? null : await unseal(key, text)
      return { text, save: bytes && decodeSave(bytes, cellBlade) }
    }
    const current = await open(SAVE_KEY)
    const aside = await open(ASIDE_KEY)
    if (current.text !== null && !current.save && !aside.save) localStorage.setItem(ASIDE_KEY, current.text)
    const saves = [current.save, aside.save].filter((s) => s !== null)
    return saves.sort((a, b) => b.earned - a.earned)[0] ?? null
  } catch {
    return null
  }
}

let writes = 0

/**
 * Seals and stores a snapshot of `save`, taken before this returns. Resolves false if the browser
 * refused to store it (private mode, quota, disabled storage). A write overtaken by a newer one is skipped.
 */
export async function writeSave(save: Save, cellBlade: Int32Array, stillWanted: () => boolean) {
  const bytes = encodeSave(save, cellBlade)
  const id = ++writes
  try {
    const text = await seal(await vaultKey(), bytes)
    if (id === writes && stillWanted()) localStorage.setItem(SAVE_KEY, text)
    return true
  } catch {
    return false
  }
}

export function clearSave() {
  writes++
  try {
    localStorage.removeItem(SAVE_KEY)
    localStorage.removeItem(ASIDE_KEY)
  } catch {
    // Nothing stored, nothing to clear.
  }
}
