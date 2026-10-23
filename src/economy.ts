import { MAX_ROBOTS, ROBOT_PRICES, TIERS, TOOLS, type Tier } from './tools'

// What you own and what the farmer will sell you next. The robots module reads `robots` and moves
// them around in place, so this is the one copy of their state.

export type RobotSave = { tier: Tier; x: number; z: number; yaw: number }

export type Holdings = {
  coins: number
  /** Your best tool. You own every tool up to it. */
  tier: Tier
  robots: RobotSave[]
}

/** Your next tool, the next robot, or the next tool for one robot. */
export type Purchase = { kind: 'tool' } | { kind: 'robot' } | { kind: 'robotTool'; robot: number }

export function nextTier(tier: Tier): Tier | null {
  return TIERS.find((t) => t === tier + 1) ?? null
}

/** What a purchase costs, or null if it isn't for sale (already maxed out, or no such robot). */
export function priceOf(h: Holdings, p: Purchase): number | null {
  if (p.kind === 'tool') {
    const next = nextTier(h.tier)
    return next === null ? null : TOOLS[next].price
  }
  if (p.kind === 'robot') return h.robots.length < MAX_ROBOTS ? ROBOT_PRICES[h.robots.length] : null
  const robot = h.robots[p.robot]
  const next = robot ? nextTier(robot.tier) : null
  return next === null ? null : TOOLS[next].robotPrice
}

/** Spends the coins and hands over the goods. New robots start at `spawn` with a nail clipper. Returns false if you can't. */
export function buy(h: Holdings, p: Purchase, spawn: { x: number; z: number; yaw: number }) {
  const price = priceOf(h, p)
  if (price === null || price > h.coins) return false
  h.coins -= price
  if (p.kind === 'tool') h.tier = nextTier(h.tier) ?? h.tier
  else if (p.kind === 'robot') h.robots.push({ tier: 0, ...spawn })
  else {
    const robot = h.robots[p.robot]
    robot.tier = nextTier(robot.tier) ?? robot.tier
  }
  return true
}

/** The cheapest thing you could buy next, for the farmer's sales pitch. */
export function cheapestOffer(h: Holdings) {
  const all: Purchase[] = [{ kind: 'tool' }, { kind: 'robot' }, ...h.robots.map((_, robot) => ({ kind: 'robotTool' as const, robot }))]
  let best: { purchase: Purchase; price: number } | null = null
  for (const purchase of all) {
    const price = priceOf(h, purchase)
    if (price !== null && (!best || price < best.price)) best = { purchase, price }
  }
  return best
}
