import { bladeLean, forEachStandingNear, type Field, type Growth, type Vec2 } from './field'
import type { Grass } from './grass'
import type { Flower, Sunflowers } from './sunflowers'
import { harvests, type ToolId } from './tools'

// How each tool takes grass and sunflowers, shared by you and the robots. Every function returns how
// many blades it cut; the caller pays for them.

/** Who did the cutting: you, or robot 0, 1 or 2. */
export type Cutter = 'you' | number

type Hooks = {
  /** A flower came down. `harvested` if the tool was gentle enough to pay for it. */
  onFlower: (flower: Flower, harvested: boolean, by: Cutter) => void
}

export function createCutting(field: Field, growth: Growth, grass: Grass, sunflowers: Sunflowers, hooks: Hooks) {
  const lean: Vec2 = { x: 0, z: 0 }
  const near: number[] = []
  const collect = (i: number) => near.push(i)

  /** Cuts blade i and drops its top, tipped roughly along (awayX, awayZ). */
  function fell(i: number, awayX: number, awayZ: number, time: number) {
    const facesAway = Math.sin(field.yaw[i]) * awayX + Math.cos(field.yaw[i]) * awayZ >= 0
    bladeLean(field.x[i], field.z[i], time, grass.pushers, lean)
    grass.dropClipping(i, time, !facesAway, lean)
    return grass.cut(i) ? 1 : 0
  }

  /** Takes every standing flower in `flowers`: a harvest with the clipper or scissors, a loss with anything else. */
  function flowersDown(flowers: Flower[], tool: ToolId, from: Vec2, time: number, by: Cutter) {
    for (const f of flowers) if (sunflowers.cut(f, time, from.x, from.z)) hooks.onFlower(f, harvests(tool), by)
  }

  return {
    /** One blade, cut by someone standing at `from`. */
    snip(i: number, from: Vec2, time: number) {
      return fell(i, field.x[i] - from.x, field.z[i] - from.z, time)
    },
    /** One flower, snipped off by hand. */
    pickFlower(flower: Flower, tool: ToolId, from: Vec2, time: number, by: Cutter) {
      flowersDown([flower], tool, from, time, by)
    },
    /** Every blade rooted within r of (x, z), toppling away from `from`. Scissors and the trimmer. */
    circle(x: number, z: number, r: number, tool: ToolId, from: Vec2, time: number, by: Cutter) {
      near.length = 0
      forEachStandingNear(field, growth, x, z, r, collect)
      let cut = 0
      for (const i of near) cut += fell(i, field.x[i] - from.x, field.z[i] - from.z, time)
      flowersDown(sunflowers.near(x, z, r + 0.08), tool, from, time, by)
      return cut
    },
    /**
     * The slice of a sickle's wedge between angles `from` and `to` (radians, positive to the right of
     * where `at` faces), between `inner` and `reach` metres away.
     */
    wedge(at: Vec2 & { yaw: number }, inner: number, reach: number, from: number, to: number, time: number, by: Cutter) {
      const fx = -Math.sin(at.yaw)
      const fz = -Math.cos(at.yaw)
      const inside = (x: number, z: number) => {
        const dx = x - at.x
        const dz = z - at.z
        if (dx * dx + dz * dz < inner * inner) return false
        const angle = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz)
        return angle >= from && angle <= to
      }
      near.length = 0
      forEachStandingNear(field, growth, at.x, at.z, reach, collect)
      let cut = 0
      for (const i of near) {
        if (!inside(field.x[i], field.z[i])) continue
        const dx = field.x[i] - at.x
        const dz = field.z[i] - at.z
        // Swept left and away.
        cut += fell(i, dx * 0.5 + fz * 0.8, dz * 0.5 - fx * 0.8, time)
      }
      flowersDown(
        sunflowers.near(at.x, at.z, reach).filter((f) => inside(f.x, f.z)),
        'sickle',
        at,
        time,
        by,
      )
      return cut
    },
    /** Everything under a mower deck centred at `centre`, facing `f`. Leaves a stripe and no clippings. */
    deck(centre: Vec2, f: Vec2, halfLength: number, halfWidth: number, tool: ToolId, time: number, by: Cutter) {
      const inside = (x: number, z: number) => {
        const dx = x - centre.x
        const dz = z - centre.z
        return Math.abs(dx * f.x + dz * f.z) <= halfLength && Math.abs(dx * f.z - dz * f.x) <= halfWidth
      }
      const r = Math.hypot(halfLength, halfWidth)
      near.length = 0
      forEachStandingNear(field, growth, centre.x, centre.z, r, collect)
      let cut = 0
      for (const i of near) if (inside(field.x[i], field.z[i]) && grass.cut(i, f)) cut++
      flowersDown(
        sunflowers.near(centre.x, centre.z, r).filter((fl) => inside(fl.x, fl.z)),
        tool,
        centre,
        time,
        by,
      )
      return cut
    },
  }
}

export type Cutting = ReturnType<typeof createCutting>
