import { z } from 'zod'
import { BLADE_COUNT } from './field'
import { SIGN } from './sign'
import { TOOLS } from './tools'

// Progress lives in localStorage as JSON. Cut blades are a bitset (25 KB for 200,000 blades), so a save
// is small enough to write every few seconds while you play.

/** Bump when field generation changes: old bitsets would point at different blades. */
const SAVE_VERSION = 2
export const SAVE_KEY = 'grass-cutter/save'
const CUT_BYTES = Math.ceil(BLADE_COUNT / 8)

/** First-time spawn: in front of the welcome sign, looking at it and the meadow behind it. */
export const SPAWN = { x: 0, z: SIGN.z + 2.9, yaw: 0, pitch: -0.1 }

const PlayerSchema = z.object({ x: z.number(), z: z.number(), yaw: z.number(), pitch: z.number() })

const SaveSchema = z.object({
  version: z.literal(SAVE_VERSION),
  cut: z.base64(),
  // A broken position, timer or tool shouldn't cost anyone their progress.
  player: PlayerSchema.catch(SPAWN),
  playSeconds: z.number().nonnegative().catch(0),
  tool: z
    .number()
    .int()
    .min(0)
    .max(TOOLS.length - 1)
    .catch(0),
  /** When the last blade fell, in ms since the epoch. */
  finishedAt: z.number().nullable().catch(null),
})

export type PlayerState = z.infer<typeof PlayerSchema>

export type Save = {
  /** 1 for every cut blade. */
  cut: Uint8Array
  player: PlayerState
  playSeconds: number
  /** Index into TOOLS of the tool in hand. */
  tool: number
  finishedAt: number | null
}

function encodeBits(cut: Uint8Array) {
  const bits = new Uint8Array(CUT_BYTES)
  for (let i = 0; i < BLADE_COUNT; i++) if (cut[i]) bits[i >> 3] |= 1 << (i & 7)
  // In slices: spreading 25 KB of arguments at once can overflow the call stack.
  let binary = ''
  for (let i = 0; i < bits.length; i += 8192) binary += String.fromCharCode(...bits.subarray(i, i + 8192))
  return btoa(binary)
}

/** Null unless the string holds exactly one bit per blade. */
function decodeBits(base64: string) {
  const bytes = atob(base64)
  if (bytes.length !== CUT_BYTES) return null
  const cut = new Uint8Array(BLADE_COUNT)
  for (let i = 0; i < BLADE_COUNT; i++) cut[i] = (bytes.charCodeAt(i >> 3) >> (i & 7)) & 1
  return cut
}

export function encodeSave(save: Save): string {
  const finite = Object.values(save.player).every(Number.isFinite)
  return JSON.stringify({
    version: SAVE_VERSION,
    cut: encodeBits(save.cut),
    player: finite ? save.player : SPAWN,
    playSeconds: Number.isFinite(save.playSeconds) ? save.playSeconds : 0,
    tool: save.tool,
    finishedAt: save.finishedAt,
  } satisfies z.input<typeof SaveSchema>)
}

/** Returns null for anything that isn't a valid save for this version of the field. */
export function decodeSave(raw: string): Save | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = SaveSchema.safeParse(json)
  if (!parsed.success) return null

  const cut = decodeBits(parsed.data.cut)
  if (!cut) return null
  const { player, playSeconds, tool, finishedAt } = parsed.data
  return { cut, player, playSeconds, tool, finishedAt }
}

export function loadSave(): Save | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    return raw === null ? null : decodeSave(raw)
  } catch {
    return null
  }
}

/** Returns false if the browser refused to store it (private mode, quota, disabled storage). */
export function writeSave(save: Save): boolean {
  try {
    localStorage.setItem(SAVE_KEY, encodeSave(save))
    return true
  } catch {
    return false
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    // Nothing stored, nothing to clear.
  }
}
