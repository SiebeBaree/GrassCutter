import { Group, IcosahedronGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { bake } from './bake'
import { BLADE_COUNT, CELLS, cellCoord, meadowEdge, mulberry32, type Field, type Vec2 } from './field'

// A handful of boulders hide in the meadow, most of them only just poking out of the tall grass. Cut into
// one and the tool breaks. Nothing grows under a rock, and you, the robots and the cows walk around them.

const SEED = 0x50c4
const COUNT = 14
/** Rocks keep this far apart, and this far from the farm on the south edge. */
const SPACING = 24
const FARM_CLEARANCE = 26
/**
 * How far a tool may reach into a rock's footprint before it counts as a hit. A little slack lets you cut
 * the grass right up against it.
 */
const SLACK = 0.1

/** A boulder: where it sits, its radius at the ground and how tall it stands. */
export type Rock = { x: number; z: number; r: number; height: number; yaw: number; squash: number }

/** Every rock in the meadow. Fixed, so they're in the same spots for everyone and across reloads. */
export const ROCKS: readonly Rock[] = (() => {
  const rand = mulberry32(SEED)
  const farm = { x: 0, z: meadowEdge(Math.PI / 2) }
  const rocks: Rock[] = []
  for (let tries = 0; rocks.length < COUNT && tries < 5000; tries++) {
    const a = rand() * Math.PI * 2
    const d = Math.sqrt(rand()) * (meadowEdge(a) * 0.97 - 5)
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    if (Math.hypot(x - farm.x, z - farm.z) < FARM_CLEARANCE) continue
    if (rocks.some((o) => Math.hypot(o.x - x, o.z - z) < SPACING)) continue
    rocks.push({ x, z, r: 0.55 + rand() * 0.4, height: 1.0 + rand() * 0.45, yaw: rand() * Math.PI * 2, squash: 0.8 + rand() * 0.2 })
  }
  return rocks
})()

const core = (rock: Rock) => rock.r - SLACK

/** The rock a cutting circle of `radius` at (x, z) runs into, or null. */
export function rockInCircle(x: number, z: number, radius: number) {
  return ROCKS.find((rock) => Math.hypot(rock.x - x, rock.z - z) < radius + core(rock)) ?? null
}

/** The rock under a mower deck centred at `centre` and facing `f`, or null. */
export function rockUnderDeck(centre: Vec2, f: Vec2, halfLength: number, halfWidth: number) {
  return (
    ROCKS.find((rock) => {
      const dx = rock.x - centre.x
      const dz = rock.z - centre.z
      const along = Math.max(0, Math.abs(dx * f.x + dz * f.z) - halfLength)
      const side = Math.max(0, Math.abs(dx * f.z - dz * f.x) - halfWidth)
      return Math.hypot(along, side) < core(rock)
    }) ?? null
  )
}

/** The rock in a sickle's wedge, `reach` metres deep between angles `from` and `to` (as in cutting.wedge), or null. */
export function rockInWedge(at: Vec2 & { yaw: number }, reach: number, from: number, to: number) {
  const fx = -Math.sin(at.yaw)
  const fz = -Math.cos(at.yaw)
  return (
    ROCKS.find((rock) => {
      const dx = rock.x - at.x
      const dz = rock.z - at.z
      const d = Math.hypot(dx, dz)
      const c = core(rock)
      if (d - c > reach) return false
      if (d <= c) return true
      const angle = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz)
      const half = Math.asin(c / d)
      return angle + half >= from && angle - half <= to
    }) ?? null
  )
}

/** Pushes a body of `radius` at p out of every rock. Returns the rock it bumped, if any. */
export function pushOutOfRocks(p: Vec2, radius: number) {
  let bumped: Rock | null = null
  for (const rock of ROCKS) {
    const dx = p.x - rock.x
    const dz = p.z - rock.z
    const d = Math.hypot(dx, dz) || 1e-5
    const min = rock.r + radius
    if (d >= min) continue
    p.x = rock.x + (dx / d) * min
    p.z = rock.z + (dz / d) * min
    bumped = rock
  }
  return bumped
}

/** The rock nearest (x, z). */
export function nearestRock(x: number, z: number) {
  let best = ROCKS[0]
  for (const rock of ROCKS) if (Math.hypot(rock.x - x, rock.z - z) < Math.hypot(best.x - x, best.z - z)) best = rock
  return best
}

/** Marks every blade rooted within `margin` metres of a rock's footprint. 0 marks the blades under them. */
export function bladesNearRocks(field: Field, margin: number) {
  const marked = new Uint8Array(BLADE_COUNT)
  for (const rock of ROCKS) {
    const r = rock.r + margin
    for (let cz = cellCoord(rock.z - r); cz <= cellCoord(rock.z + r); cz++) {
      for (let cx = cellCoord(rock.x - r); cx <= cellCoord(rock.x + r); cx++) {
        const i = field.cellBlade[cz * CELLS + cx]
        if (i >= 0 && Math.hypot(field.x[i] - rock.x, field.z[i] - rock.z) <= r) marked[i] = 1
      }
    }
  }
  return marked
}

/** Every rock as one baked mesh. Lumpy, flat-shaded and sunk a little into the ground. */
export function buildRocks() {
  const stone = new MeshStandardMaterial({ color: '#7d7a72', roughness: 0.95, flatShading: true })
  const root = new Group()
  const v = new Vector3()
  for (const [k, rock] of ROCKS.entries()) {
    const geometry = new IcosahedronGeometry(1, 2)
    const position = geometry.getAttribute('position')
    // Bumps follow the direction from the centre, so the faces that share a corner still meet.
    for (let n = 0; n < position.count; n++) {
      v.fromBufferAttribute(position, n)
      const bump = 1 + 0.1 * Math.sin(v.x * 3.1 + k) * Math.sin(v.y * 2.6 + k * 1.7) + 0.06 * Math.sin(v.z * 5.3 - k)
      position.setXYZ(n, v.x * bump, v.y * bump, v.z * bump)
    }
    geometry.computeVertexNormals()
    const mesh = new Mesh(geometry, stone)
    mesh.scale.set(rock.r, rock.height, rock.r * rock.squash)
    mesh.rotation.y = rock.yaw
    mesh.position.set(rock.x, -0.15 * rock.height, rock.z)
    root.add(mesh)
  }
  return bake(root)
}
