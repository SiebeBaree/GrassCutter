// The meadow: where every blade stands, how it bends and how to find the blade under the crosshair.
// Saves refer to blades by index, so generation must stay deterministic. Bump SAVE_VERSION in save.ts
// whenever anything here changes the layout.

export const BLADE_COUNT = 5000
export const FIELD_RADIUS = 7.6
export const STUB_HEIGHT = 0.06
export const WIND_DIR = { x: 0.928, z: 0.371 }
export const PUSH_RADIUS = 0.9
export const PUSH_STRENGTH = 0.32

/** Rows of vertices along a blade. Picking walks the same rows the shader draws. */
export const BLADE_SEGMENTS = 8

const SEED = 0x9a55
const GRID_HALF = 9.5
const GRID_CELLS = 40

export type Field = {
  x: Float32Array
  z: Float32Array
  yaw: Float32Array
  height: Float32Array
  width: Float32Array
  bend: Float32Array
  tint: Float32Array
}

/** Uniform grid over the meadow in CSR layout: blades of cell c are items[start[c]..start[c + 1]). */
export type Grid = {
  half: number
  cells: number
  size: number
  start: Int32Array
  items: Int32Array
  cellOf: Int32Array
}

export type Vec2 = { x: number; z: number }

/** Small, fast seeded PRNG. Same seed, same field, forever. */
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

/** Organic meadow outline: radius at a given angle. */
export function meadowEdge(angle: number) {
  return (
    FIELD_RADIUS *
    (1 + 0.07 * Math.sin(3 * angle + 1.1) + 0.05 * Math.sin(5 * angle + 2.3) + 0.025 * Math.sin(11 * angle + 0.4))
  )
}

export function createField(): Field {
  const rand = mulberry32(SEED)
  const field: Field = {
    x: new Float32Array(BLADE_COUNT),
    z: new Float32Array(BLADE_COUNT),
    yaw: new Float32Array(BLADE_COUNT),
    height: new Float32Array(BLADE_COUNT),
    width: new Float32Array(BLADE_COUNT),
    bend: new Float32Array(BLADE_COUNT),
    tint: new Float32Array(BLADE_COUNT),
  }

  const bound = FIELD_RADIUS * 1.2
  let n = 0
  while (n < BLADE_COUNT) {
    const x = (rand() * 2 - 1) * bound
    const z = (rand() * 2 - 1) * bound
    const r = Math.hypot(x, z)
    const edge = meadowEdge(Math.atan2(z, x))
    if (r > edge) continue
    // Thin out the outer metre so the meadow fades instead of ending in a wall.
    if (r > edge - 1 && rand() > edge - r) continue

    field.x[n] = x
    field.z[n] = z
    field.yaw[n] = rand() * Math.PI * 2
    field.height[n] = 1.8 + rand() * 0.5
    field.width[n] = 0.045 + rand() * 0.035
    field.bend[n] = 0.06 + rand() * rand() * 0.3
    field.tint[n] = rand()
    n++
  }
  return field
}

export function createGrid(field: Field): Grid {
  const size = (GRID_HALF * 2) / GRID_CELLS
  const total = GRID_CELLS * GRID_CELLS
  const cellOf = new Int32Array(BLADE_COUNT)
  const counts = new Int32Array(total + 1)
  for (let i = 0; i < BLADE_COUNT; i++) {
    const cx = clampInt(Math.floor((field.x[i] + GRID_HALF) / size), GRID_CELLS)
    const cz = clampInt(Math.floor((field.z[i] + GRID_HALF) / size), GRID_CELLS)
    cellOf[i] = cz * GRID_CELLS + cx
    counts[cellOf[i] + 1]++
  }
  const start = new Int32Array(total + 1)
  for (let c = 0; c < total; c++) start[c + 1] = start[c] + counts[c + 1]
  const fill = start.slice(0, total)
  const items = new Int32Array(BLADE_COUNT)
  for (let i = 0; i < BLADE_COUNT; i++) items[fill[cellOf[i]]++] = i
  return { half: GRID_HALF, cells: GRID_CELLS, size, start, items, cellOf }
}

function clampInt(v: number, cells: number) {
  return Math.min(cells - 1, Math.max(0, v))
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
 * Horizontal lean (per unit of t² · height) from wind and from the player brushing through.
 * Mirrors bladeLean() in the grass shader so picking hits exactly what is drawn.
 */
export function bladeLean(bx: number, bz: number, time: number, player: Vec2, out: Vec2) {
  const gust = 0.55 + 0.45 * Math.sin(time * 0.55 - (bx * WIND_DIR.x + bz * WIND_DIR.z) * 0.22)
  const phase = time * 1.7 + bx * 0.37 + bz * 0.23
  const sway = Math.sin(phase) * 0.6 + Math.sin(phase * 2.3 + 1.7) * 0.25
  const wind = gust * (0.07 + 0.06 * sway)
  out.x = WIND_DIR.x * wind
  out.z = WIND_DIR.z * wind

  const dx = bx - player.x
  const dz = bz - player.z
  const dist = Math.max(Math.hypot(dx, dz), 1e-4)
  const push = (1 - smoothstep(0, PUSH_RADIUS, dist)) * PUSH_STRENGTH
  out.x += (dx / dist) * push
  out.z += (dz / dist) * push
  return out
}

export type Ray = { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }

const lean: Vec2 = { x: 0, z: 0 }
const px = new Float32Array(BLADE_SEGMENTS + 1)
const py = new Float32Array(BLADE_SEGMENTS + 1)
const pz = new Float32Array(BLADE_SEGMENTS + 1)
const PICK_TOLERANCE = 0.025

/**
 * Finds the nearest standing blade along the ray within reach, or -1.
 * Only checks grid cells near the ray, then tests the blade's bent centreline segment by segment.
 */
export function pickBlade(
  field: Field,
  grid: Grid,
  cut: Uint8Array,
  ray: Ray,
  reach: number,
  time: number,
  player: Vec2,
): number {
  // Never pick through the ground.
  let maxS = reach
  if (ray.dy < 0) maxS = Math.min(maxS, -ray.oy / ray.dy)

  const ex = ray.ox + ray.dx * maxS
  const ez = ray.oz + ray.dz * maxS
  const margin = 1.9
  const minCx = clampInt(Math.floor((Math.min(ray.ox, ex) - margin + grid.half) / grid.size), grid.cells)
  const maxCx = clampInt(Math.floor((Math.max(ray.ox, ex) + margin + grid.half) / grid.size), grid.cells)
  const minCz = clampInt(Math.floor((Math.min(ray.oz, ez) - margin + grid.half) / grid.size), grid.cells)
  const maxCz = clampInt(Math.floor((Math.max(ray.oz, ez) + margin + grid.half) / grid.size), grid.cells)

  let best = -1
  let bestS = maxS

  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const c = cz * grid.cells + cx
      for (let k = grid.start[c]; k < grid.start[c + 1]; k++) {
        const i = grid.items[k]
        if (cut[i]) continue

        const bx = field.x[i]
        const bz = field.z[i]
        const h = field.height[i]
        bladeLean(bx, bz, time, player, lean)
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
  }
  return best
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
function raySegment(ray: Ray, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
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
