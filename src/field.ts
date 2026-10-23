// The meadow: where every blade stands, how it bends and how to find blades near a point or under the crosshair.
// Saves refer to blades by grid cell, so generation must stay deterministic. Bump SAVE_VERSION in save.ts
// whenever anything here changes the layout.

export const BLADE_COUNT = 1_000_000
/** Blades stand on a jittered grid, at most one per cell. */
export const CELL = 0.2
/** Half the side of the square map in metres. The meadow and everything you can walk on fit inside. */
export const MAP_HALF = 138
export const CELLS = Math.round((MAP_HALF * 2) / CELL)
/** Side of a render chunk in metres. */
export const CHUNK = 12
export const CHUNKS = Math.round((MAP_HALF * 2) / CHUNK)
export const CELLS_PER_CHUNK = Math.round(CHUNK / CELL)
/** Meadow radius before the edge wobble. Generation scales the edge so exactly BLADE_COUNT blades fit. */
export const MEADOW_RADIUS = 112.9
/** How far the edge frays, as a fraction of the radius. */
const EDGE_FRAY = 0.02

export const STUB_HEIGHT = 0.06
/** Height of a blade the moment it sprouts back. It grows from here to its full height. */
export const SPROUT_HEIGHT = 0.12
export const WIND_DIR = { x: 0.928, z: 0.371 }

/** Things that bend grass away from them: you, the mower deck, the robots and the cows. */
export const PUSHERS = 7
/** A pusher nobody is using sits far off the map. */
export const PARKED = 1e4

/** Rows of vertices along a near blade. Picking walks the same rows the shader draws. */
export const BLADE_SEGMENTS = 7

const SEED = 0x9a56

export type Field = {
  x: Float32Array
  z: Float32Array
  yaw: Float32Array
  height: Float32Array
  width: Float32Array
  bend: Float32Array
  tint: Float32Array
  /** Grid cell of each blade. */
  cellOf: Int32Array
  /** Blade in each grid cell, or -1. */
  cellBlade: Int32Array
  /** Blades of chunk k are [chunkStart[k], chunkStart[k + 1]). Chunks run row by row along x. */
  chunkStart: Int32Array
  /** The meadow edge is meadowEdge(angle) * edgeScale. */
  edgeScale: number
}

export type Vec2 = { x: number; z: number }

/**
 * How tall each blade is: 0 for a cut stub, 255 for full height, anything between for a blade growing back.
 * A blade counts as standing (cuttable, and still to do) whenever it's above 0.
 */
export type Growth = Uint8Array

/** Small, fast seeded PRNG. Same seed, same sequence, forever. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stateless hash to [0, 1). Each grid cell draws its own numbers, so cells don't depend on each other. */
function cellRandom(cell: number, k: number) {
  let n = (cell * 8 + k + SEED) | 0
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d)
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

/** Organic meadow outline: radius at a given angle, before edgeScale. */
export function meadowEdge(angle: number) {
  return (
    MEADOW_RADIUS *
    (1 +
      0.07 * Math.sin(3 * angle + 1.1) +
      0.05 * Math.sin(5 * angle + 2.3) +
      0.025 * Math.sin(11 * angle + 0.4) +
      0.012 * Math.sin(23 * angle + 2.9))
  )
}

/** Slow swells of taller and shorter grass across the meadow. */
function heightSwell(x: number, z: number) {
  return 0.09 * Math.sin(x * 0.11 + 0.7) * Math.sin(z * 0.13 + 1.9) + 0.06 * Math.sin(x * 0.047 - z * 0.061 + 2.4)
}

const cellX = (c: number) => ((c % CELLS) + 0.05 + 0.9 * cellRandom(c, 0)) * CELL - MAP_HALF
const cellZ = (c: number) => (Math.floor(c / CELLS) + 0.05 + 0.9 * cellRandom(c, 1)) * CELL - MAP_HALF

export function createField(): Field {
  const total = CELLS * CELLS
  const score = new Float32Array(total)
  for (let c = 0; c < total; c++) {
    const x = cellX(c)
    const z = cellZ(c)
    // Below 1 is inside the outline. The noise frays the edge so the meadow doesn't end in a wall.
    score[c] = Math.hypot(x, z) / meadowEdge(Math.atan2(z, x)) + (cellRandom(c, 2) - 0.5) * EDGE_FRAY * 2
  }
  // Keep the BLADE_COUNT cells that sit furthest inside.
  const edgeScale = score.slice().sort()[BLADE_COUNT - 1]

  const field: Field = {
    x: new Float32Array(BLADE_COUNT),
    z: new Float32Array(BLADE_COUNT),
    yaw: new Float32Array(BLADE_COUNT),
    height: new Float32Array(BLADE_COUNT),
    width: new Float32Array(BLADE_COUNT),
    bend: new Float32Array(BLADE_COUNT),
    tint: new Float32Array(BLADE_COUNT),
    cellOf: new Int32Array(BLADE_COUNT),
    cellBlade: new Int32Array(total).fill(-1),
    chunkStart: new Int32Array(CHUNKS * CHUNKS + 1),
    edgeScale,
  }

  const cells: number[] = []
  let n = 0
  for (let k = 0; k < CHUNKS * CHUNKS; k++) {
    field.chunkStart[k] = n
    const cx0 = (k % CHUNKS) * CELLS_PER_CHUNK
    const cz0 = Math.floor(k / CHUNKS) * CELLS_PER_CHUNK
    cells.length = 0
    for (let cz = cz0; cz < cz0 + CELLS_PER_CHUNK; cz++) {
      for (let cx = cx0; cx < cx0 + CELLS_PER_CHUNK; cx++) {
        const c = cz * CELLS + cx
        if (score[c] <= edgeScale && n + cells.length < BLADE_COUNT) cells.push(c)
      }
    }
    // Shuffle so any prefix of a chunk is an even sprinkle. Distant chunks draw only a prefix.
    const rand = mulberry32(SEED + k)
    for (let j = cells.length - 1; j > 0; j--) {
      const r = Math.floor(rand() * (j + 1))
      ;[cells[j], cells[r]] = [cells[r], cells[j]]
    }
    for (const c of cells) {
      const i = n++
      const x = cellX(c)
      const z = cellZ(c)
      field.x[i] = x
      field.z[i] = z
      field.yaw[i] = cellRandom(c, 3) * Math.PI * 2
      field.height[i] = 1.02 + cellRandom(c, 4) * 0.42 + heightSwell(x, z)
      field.width[i] = 0.05 + cellRandom(c, 5) * 0.035
      field.bend[i] = 0.06 + cellRandom(c, 6) ** 2 * 0.3
      field.tint[i] = cellRandom(c, 7)
      field.cellOf[i] = c
      field.cellBlade[c] = i
    }
  }
  field.chunkStart[CHUNKS * CHUNKS] = n
  if (n !== BLADE_COUNT) throw new Error(`Meadow has ${n} blades, expected ${BLADE_COUNT}`)
  return field
}

/** True if (x, z) lies inside the meadow outline, pulled in by `margin` metres. */
export function inMeadow(field: Field, x: number, z: number, margin = 0) {
  return Math.hypot(x, z) < meadowEdge(Math.atan2(z, x)) * field.edgeScale - margin
}

/** How tall blade i stands right now, in metres. Cut blades report their full height (the shader draws a stub). */
export function grownHeight(field: Field, growth: Growth, i: number) {
  const g = growth[i]
  const h = field.height[i]
  return g === 0 || g === 255 ? h : SPROUT_HEIGHT + (h - SPROUT_HEIGHT) * (g / 255)
}

function clampCell(v: number) {
  return Math.min(CELLS - 1, Math.max(0, v))
}

/** Grid cell column or row for a world coordinate, clamped to the map. */
export function cellCoord(v: number) {
  return clampCell(Math.floor((v + MAP_HALF) / CELL))
}

/** Calls visit for every standing blade whose base is within r of (x, z). */
export function forEachStandingNear(field: Field, growth: Growth, x: number, z: number, r: number, visit: (i: number) => void) {
  const r2 = r * r
  const maxX = cellCoord(x + r)
  const maxZ = cellCoord(z + r)
  for (let cz = cellCoord(z - r); cz <= maxZ; cz++) {
    for (let cx = cellCoord(x - r); cx <= maxX; cx++) {
      const i = field.cellBlade[cz * CELLS + cx]
      if (i < 0 || growth[i] === 0) continue
      const dx = field.x[i] - x
      const dz = field.z[i] - z
      if (dx * dx + dz * dz <= r2) visit(i)
    }
  }
}

/** Offsets to the eight neighbouring grid cells. */
const NEIGHBOURS = [-1 - CELLS, -CELLS, 1 - CELLS, -1, 1, CELLS - 1, CELLS, CELLS + 1]

/**
 * One try at regrowth: a random blade, and if it stands, a random neighbour of it. Returns that neighbour
 * if it's a cut blade ready to sprout, or -1. Grass only spreads from grass, so a patch you've cleared
 * completely stays clear, and an empty meadow never grows back.
 */
export function regrowthCandidate(field: Field, growth: Growth, rand: () => number) {
  const i = Math.floor(rand() * BLADE_COUNT)
  if (growth[i] === 0) return -1
  const c = field.cellOf[i] + NEIGHBOURS[Math.floor(rand() * 8)]
  if (c < 0 || c >= field.cellBlade.length) return -1
  const j = field.cellBlade[c]
  return j >= 0 && growth[j] === 0 ? j : -1
}

function smoothstep(e0: number, e1: number, v: number) {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Width multiplier along the blade: flat for most of it, then a pointed tip. Mirrors bladeTaper() in GLSL. */
export function bladeTaper(t: number) {
  return Math.sqrt(Math.min(1, Math.max(0, (1 - t) * 2.2)))
}

/**
 * Horizontal lean (per unit of t² · height) from wind and from everything pushing through the grass.
 * `pushers` holds x, z, radius, strength for each of the PUSHERS. Mirrors bladeLean() in the grass
 * shader so picking hits exactly what is drawn.
 */
export function bladeLean(bx: number, bz: number, time: number, pushers: Float32Array, out: Vec2) {
  const gust = 0.55 + 0.45 * Math.sin(time * 0.55 - (bx * WIND_DIR.x + bz * WIND_DIR.z) * 0.22)
  const phase = time * 1.7 + bx * 0.37 + bz * 0.23
  const sway = Math.sin(phase) * 0.6 + Math.sin(phase * 2.3 + 1.7) * 0.25
  const wind = gust * (0.07 + 0.06 * sway)
  out.x = WIND_DIR.x * wind
  out.z = WIND_DIR.z * wind

  for (let p = 0; p < PUSHERS * 4; p += 4) {
    const dx = bx - pushers[p]
    const dz = bz - pushers[p + 1]
    const dist = Math.max(Math.hypot(dx, dz), 1e-4)
    if (dist >= pushers[p + 2]) continue
    const push = (1 - smoothstep(0, pushers[p + 2], dist)) * pushers[p + 3]
    out.x += (dx / dist) * push
    out.z += (dz / dist) * push
  }
  return out
}

export type Ray = { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }

/** Where the crosshair landed: the blade and the distance along the ray. */
export type Pick = { blade: number; s: number }

const lean: Vec2 = { x: 0, z: 0 }
const px = new Float32Array(BLADE_SEGMENTS + 1)
const py = new Float32Array(BLADE_SEGMENTS + 1)
const pz = new Float32Array(BLADE_SEGMENTS + 1)
const PICK_TOLERANCE = 0.025
/** No blade tip strays further than this from its base. */
const MAX_TIP_OFFSET = 1.3

/**
 * Finds the nearest standing blade along the ray within reach. Writes it to `out` and returns true, or returns false.
 * Only checks grid cells near the ray, then tests the blade's bent centreline segment by segment.
 */
export function pickBlade(field: Field, growth: Growth, ray: Ray, reach: number, time: number, pushers: Float32Array, out: Pick) {
  // Never pick through the ground.
  let maxS = reach
  if (ray.dy < 0) maxS = Math.min(maxS, -ray.oy / ray.dy)

  const ex = ray.ox + ray.dx * maxS
  const ez = ray.oz + ray.dz * maxS
  const minCx = cellCoord(Math.min(ray.ox, ex) - MAX_TIP_OFFSET)
  const maxCx = cellCoord(Math.max(ray.ox, ex) + MAX_TIP_OFFSET)
  const minCz = cellCoord(Math.min(ray.oz, ez) - MAX_TIP_OFFSET)
  const maxCz = cellCoord(Math.max(ray.oz, ez) + MAX_TIP_OFFSET)

  let best = -1
  let bestS = maxS

  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const i = field.cellBlade[cz * CELLS + cx]
      if (i < 0 || growth[i] === 0) continue

      const bx = field.x[i]
      const bz = field.z[i]
      const h = grownHeight(field, growth, i)
      bladeLean(bx, bz, time, pushers, lean)
      const fx = Math.sin(field.yaw[i]) * field.bend[i] + lean.x
      const fz = Math.cos(field.yaw[i]) * field.bend[i] + lean.z

      // Cheap reject: the blade never strays further than its tip offset from its base.
      const reachXZ = Math.hypot(fx, fz) * h + 0.1
      if (distToSegment2D(bx, bz, ray.ox, ray.oz, ex, ez) > reachXZ) continue

      for (let r = 0; r <= BLADE_SEGMENTS; r++) {
        const t = r / BLADE_SEGMENTS
        const w = t * t * h
        px[r] = bx + fx * w
        py[r] = t * h
        pz[r] = bz + fz * w
      }

      const w = field.width[i] * 0.5
      for (let r = 0; r < BLADE_SEGMENTS; r++) {
        const s = raySegment(ray, px[r], py[r], pz[r], px[r + 1], py[r + 1], pz[r + 1])
        if (s.s < 0.05 || s.s >= bestS) continue
        const t = (r + s.u) / BLADE_SEGMENTS
        if (s.dist < w * bladeTaper(t) + PICK_TOLERANCE) {
          best = i
          bestS = s.s
        }
      }
    }
  }
  out.blade = best
  out.s = bestS
  return best >= 0
}

function distToSegment2D(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const vx = bx - ax
  const vz = bz - az
  const len2 = vx * vx + vz * vz
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / len2)) : 0
  return Math.hypot(x - (ax + vx * t), z - (az + vz * t))
}

const segResult = { s: 0, u: 0, dist: 0 }

/** Closest approach between a ray (unit direction) and segment P0→P1. s is along the ray, u along the segment. */
export function raySegment(ray: Ray, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const vx = x1 - x0
  const vy = y1 - y0
  const vz = z1 - z0
  const wx = ray.ox - x0
  const wy = ray.oy - y0
  const wz = ray.oz - z0
  const b = ray.dx * vx + ray.dy * vy + ray.dz * vz
  const c = vx * vx + vy * vy + vz * vz
  const d = ray.dx * wx + ray.dy * wy + ray.dz * wz
  const e = vx * wx + vy * wy + vz * wz
  const denom = c - b * b

  let u = denom > 1e-9 ? (e - b * d) / denom : 0
  u = Math.min(1, Math.max(0, u))
  let s = b * u - d
  if (s < 0) {
    s = 0
    u = Math.min(1, Math.max(0, e / c))
  }
  const cx = wx + ray.dx * s - vx * u
  const cy = wy + ray.dy * s - vy * u
  const cz = wz + ray.dz * s - vz * u
  segResult.s = s
  segResult.u = u
  segResult.dist = Math.sqrt(cx * cx + cy * cy + cz * cz)
  return segResult
}
