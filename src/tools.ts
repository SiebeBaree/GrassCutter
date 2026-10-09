// The four tools, in the order you earn them, and how each one cuts. Cutting blades is the only way
// to level up: your level is the number of tools unlocked so far.

export const TOOLS = [
  { id: 'clipper', name: 'Nail clipper', unlockAt: 0 },
  { id: 'shears', name: 'Shears', unlockAt: 2_500 },
  { id: 'sickle', name: 'Sickle', unlockAt: 10_000 },
  { id: 'mower', name: 'Lawn mower', unlockAt: 35_000 },
] as const

export type Tool = (typeof TOOLS)[number]
export type ToolId = Tool['id']
export const MAX_LEVEL = TOOLS.length

/** One blade per snip, the one under the crosshair. Distances are metres from your eyes, times in seconds. */
export const CLIPPER = { reach: 2.1, interval: 0.2 }
/** Every blade rooted within `radius` of the blade or ground under the crosshair. */
export const SHEARS = { reach: 2.6, radius: 0.32, interval: 0.32 }
/**
 * A wedge in front of you, swept right to left during the first `cutShare` of each swing.
 * `halfArc` is the angle either side of where you face.
 */
export const SICKLE = { inner: 0.3, reach: 1.45, halfArc: 0.95, swing: 0.56, cutShare: 0.4 }
/** Everything under the deck: a rectangle centred `ahead` metres in front of you. */
export const MOWER = { ahead: 1.4, halfWidth: 0.6, halfLength: 0.42 }

/** Level 1 to MAX_LEVEL for a number of cut blades. */
export function levelFor(cutCount: number) {
  return TOOLS.filter((tool) => cutCount >= tool.unlockAt).length
}

/** Blade counts that bracket the current level, for the progress bar. Null at the top level. */
export function levelRange(level: number) {
  if (level >= MAX_LEVEL) return null
  return { from: TOOLS[level - 1].unlockAt, to: TOOLS[level].unlockAt }
}

/**
 * Where the sickle is in its sweep, `seconds` into a swing: 1 at the right edge of the wedge, -1 at the left.
 * Holds at -1 once the cutting part is over. Shared by the cutting and the animation so they line up.
 */
export function sickleSweep(seconds: number) {
  const t = Math.min(1, Math.max(0, seconds / (SICKLE.swing * SICKLE.cutShare)))
  return 1 - 2 * t * t * (3 - 2 * t)
}
