// The six tools, what they cost and how each one cuts. You and the robots buy them in this order,
// one tier at a time. Prices are tuned so a decent player clears the meadow in about three hours.

export const TOOLS = [
  { id: 'clipper', name: 'Nail clipper', price: 0, robotPrice: 0, about: 'One blade per snip.' },
  { id: 'scissors', name: 'Scissors', price: 2_500, robotPrice: 2_000, about: 'A handful of blades per snip.' },
  { id: 'sickle', name: 'Sickle', price: 12_000, robotPrice: 10_000, about: 'Hold to swing through a wedge of grass.' },
  { id: 'trimmer', name: 'Lawn trimmer', price: 45_000, robotPrice: 36_000, about: 'Hold to spin the line, then sweep it around.' },
  { id: 'mower', name: 'Lawn mower', price: 140_000, robotPrice: 110_000, about: 'Push it. Everything under the deck goes.' },
  { id: 'rider', name: 'Riding mower', price: 350_000, robotPrice: 280_000, about: 'A seat, a wide deck and a lot more speed.' },
] as const

export type Tool = (typeof TOOLS)[number]
export type ToolId = Tool['id']
/** Indices into TOOLS. Owning tier n means owning every tool up to it. */
export const TIERS = [0, 1, 2, 3, 4, 5] as const satisfies readonly number[] & { length: (typeof TOOLS)['length'] }
export type Tier = (typeof TIERS)[number]
export const TOP_TIER = TIERS[TIERS.length - 1]

/** What each robot costs, in the order you buy them. */
export const ROBOT_PRICES = [8_000, 50_000, 150_000] as const
export const MAX_ROBOTS = ROBOT_PRICES.length
/** Robots work at this share of your pace with the same tool. */
export const ROBOT_PACE = 0.5

/** bCoins for a sunflower cut with a tool that harvests it. Anything else shreds it for nothing. */
export const SUNFLOWER_VALUE = 500
export const harvests = (tool: ToolId) => tool === 'clipper' || tool === 'scissors'

/**
 * A UFO's beam turns the grass within `radius` purple and tall, about a hundred blades. Each pays `value`
 * bCoins when cut, by any tool, until it's cut once.
 */
export const UFO_GRASS = { radius: 1.15, value: 100 }

/** One blade per snip, the one under the crosshair. Distances are metres from your eyes, times in seconds. */
export const CLIPPER = { reach: 2.1, interval: 0.2 }
/** Every blade rooted within `radius` of the blade or ground under the crosshair. */
export const SCISSORS = { reach: 2.6, radius: 0.32, interval: 0.32 }
/**
 * A wedge in front of you, swept right to left during the first `cutShare` of each swing.
 * `halfArc` is the angle either side of where you face.
 */
export const SICKLE = { inner: 0.3, reach: 1.45, halfArc: 0.95, swing: 0.56, cutShare: 0.4 }
/**
 * A spinning line of `radius`, held ahead of you between `near` and `far` metres from your feet. It goes
 * wherever you go and swings after your view, its head moving sideways at up to `sweep` metres a second.
 * Looking up or down slides it out or in at `follow`.
 */
export const TRIMMER = { radius: 0.45, near: 0.85, far: 2.4, follow: 12, sweep: 2.8 }
/** Everything under the deck: a rectangle centred `ahead` metres in front of you. */
export const MOWER = { ahead: 1.4, halfWidth: 0.6, halfLength: 0.42, speed: 4 }
/** The riding mower's deck sits under its belly, a little ahead of the seat. */
export const RIDER = { ahead: 0.45, halfWidth: 0.95, halfLength: 0.47, speed: 6.5, reverse: 2.5, turn: 1.9 }

/**
 * Where the sickle is in its sweep, `seconds` into a swing: 1 at the right edge of the wedge, -1 at the left.
 * Holds at -1 once the cutting part is over. Shared by the cutting and the animation so they line up.
 */
export function sickleSweep(seconds: number) {
  const t = Math.min(1, Math.max(0, seconds / (SICKLE.swing * SICKLE.cutShare)))
  return 1 - 2 * t * t * (3 - 2 * t)
}
