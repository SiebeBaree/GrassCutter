import { describe, expect, it } from 'vitest'
import { buy, cheapestOffer, priceOf, type Holdings } from './economy'
import { ROBOT_PRICES, TOOLS } from './tools'

const spawn = { x: 1, z: 2, yaw: 0 }
const fresh = (coins: number): Holdings => ({ coins, tier: 0, robots: [] })

describe('economy', () => {
  it('sells your tools one tier at a time', () => {
    const h = fresh(TOOLS[1].price + TOOLS[2].price - 1)
    expect(buy(h, { kind: 'tool' }, spawn)).toBe(true)
    expect(h.tier).toBe(1)
    // One coin short of the sickle.
    expect(buy(h, { kind: 'tool' }, spawn)).toBe(false)
    expect(h).toMatchObject({ tier: 1, coins: TOOLS[2].price - 1 })
    h.tier = 5
    expect(priceOf(h, { kind: 'tool' })).toBeNull()
  })

  it('sells three robots at most, each starting with a nail clipper', () => {
    const h = fresh(1e9)
    for (let n = 0; n < 3; n++) expect(buy(h, { kind: 'robot' }, spawn)).toBe(true)
    expect(buy(h, { kind: 'robot' }, spawn)).toBe(false)
    expect(h.robots).toEqual([0, 1, 2].map(() => ({ tier: 0, ...spawn })))
    expect(h.coins).toBe(1e9 - ROBOT_PRICES.reduce((a, b) => a + b, 0))
  })

  it('upgrades each robot on its own, at robot prices', () => {
    const h = fresh(ROBOT_PRICES[0] + TOOLS[1].robotPrice)
    buy(h, { kind: 'robot' }, spawn)
    expect(buy(h, { kind: 'robotTool', robot: 1 }, spawn)).toBe(false)
    expect(buy(h, { kind: 'robotTool', robot: 0 }, spawn)).toBe(true)
    expect(h.robots[0].tier).toBe(1)
    expect(h.coins).toBe(0)
  })

  it('points the farmer at the cheapest thing for sale', () => {
    expect(cheapestOffer(fresh(0))).toEqual({ purchase: { kind: 'tool' }, price: TOOLS[1].price })
    expect(cheapestOffer({ coins: 0, tier: 5, robots: [{ tier: 5, ...spawn }, { tier: 5, ...spawn }, { tier: 5, ...spawn }] })).toBeNull()
  })
})
