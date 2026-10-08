import { z } from 'zod'
import { BLADE_COUNT } from './field'

// Progress lives in localStorage as JSON. Cut blades and the way each one fell are two bitsets
// (625 bytes each for 5,000 blades), so a save is under 2 KB and cheap enough to write after every snip.

/** Bump when field generation changes: old bitsets would point at different blades. */
const SAVE_VERSION = 1
export const SAVE_KEY = 'grass-cutter/save'
const CUT_BYTES = Math.ceil(BLADE_COUNT / 8)

/** First-time spawn: in front of the welcome sign, looking at it. */
export const SPAWN = { x: 0, z: 13.3, yaw: 0, pitch: -0.1 }

const PlayerSchema = z.object({ x: z.number(), z: z.number(), yaw: z.number(), pitch: z.number() })

const SaveSchema = z.object({
  version: z.literal(SAVE_VERSION),
  cut: z.base64(),
  // Which way clippings fell is cosmetic, so a broken value just means they all fell forward.
  fellBack: z.base64().catch(''),
  // A broken position or timer shouldn't cost anyone their progress.
  player: PlayerSchema.catch(SPAWN),
  playSeconds: z.number().nonnegative().catch(0),
})

export type PlayerState = z.infer<typeof PlayerSchema>

/** Per-blade state: standing, cut and fell forward, or cut and fell backward. */
export const BLADE = { standing: 0, fellForward: 1, fellBack: 2 } as const

export type Save = {
  /** One BLADE value per blade. */
  cut: Uint8Array
  player: PlayerState
  playSeconds: number
}

function encodeBits(cut: Uint8Array, test: (state: number) => boolean) {
  const bits = new Uint8Array(CUT_BYTES)
  for (let i = 0; i < BLADE_COUNT; i++) if (test(cut[i])) bits[i >> 3] |= 1 << (i & 7)
  return btoa(String.fromCharCode(...bits))
}

/** Null unless the string holds exactly one bit per blade. */
function decodeBits(base64: string) {
  const bytes = atob(base64)
  if (bytes.length !== CUT_BYTES) return null
  const bits = new Uint8Array(BLADE_COUNT)
  for (let i = 0; i < BLADE_COUNT; i++) bits[i] = (bytes.charCodeAt(i >> 3) >> (i & 7)) & 1
  return bits
}

export function encodeSave(save: Save): string {
  const finite = Object.values(save.player).every(Number.isFinite)
  return JSON.stringify({
    version: SAVE_VERSION,
    cut: encodeBits(save.cut, (state) => state !== BLADE.standing),
    fellBack: encodeBits(save.cut, (state) => state === BLADE.fellBack),
    player: finite ? save.player : SPAWN,
    playSeconds: Number.isFinite(save.playSeconds) ? save.playSeconds : 0,
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
  const back = decodeBits(parsed.data.fellBack)
  for (let i = 0; i < BLADE_COUNT; i++) if (cut[i] && back?.[i]) cut[i] = BLADE.fellBack
  return { cut, player: parsed.data.player, playSeconds: parsed.data.playSeconds }
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
