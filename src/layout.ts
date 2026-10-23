import { meadowEdge, type Vec2 } from './field'
import { pushOutOfRocks } from './rocks'

// Where the fixed things stand, just off the south edge of the meadow, and how you bump into them.

/** A footprint on the ground: centre, turn about the vertical axis and half its width (local x) and depth (local z). */
export type Box = { x: number; z: number; yaw: number; halfW: number; halfD: number }

const southEdge = Math.ceil(meadowEdge(Math.PI / 2))

/** The welcome sign, facing away from the meadow toward where you start. */
export const SIGN = { x: -1.2, z: southEdge + 3.5, halfWidth: 1.3 }

/** First-time spawn: the sign ahead and a little left, the farmer's stall to the right. */
export const SPAWN = { x: 0, z: SIGN.z + 4, yaw: -0.18, pitch: -0.08 }

/** The farmer's stall. Its front (local +z) faces where you start. */
export const STALL = { x: 5.8, z: SIGN.z - 1.6, yaw: Math.atan2(SPAWN.x - 5.8, SPAWN.z - (SIGN.z - 1.6)) }

/** A point given in the stall's own frame, in world space. */
export function onStall(x: number, z: number): Vec2 {
  const c = Math.cos(STALL.yaw)
  const s = Math.sin(STALL.yaw)
  return { x: STALL.x + x * c + z * s, z: STALL.z - x * s + z * c }
}

/** Where the farmer stands, behind the counter. */
export const FARMER = onStall(0, -0.45)
/** Where new robots roll out from: behind the stall, on the meadow side. */
export const ROBOT_DOOR = onStall(1.0, -1.7)
/** How close you need to be to the farmer to trade. */
export const TRADE_DISTANCE = 3.4

const stallBox = (x: number, z: number, halfW: number, halfD: number): Box => ({ ...onStall(x, z), yaw: STALL.yaw, halfW, halfD })

export const OBSTACLES: Box[] = [
  { x: SIGN.x, z: SIGN.z, yaw: 0, halfW: SIGN.halfWidth, halfD: 0.12 },
  stallBox(0, 0, 1.75, 0.85),
  // The mowers parked beside the stall.
  stallBox(3.1, 0.1, 0.62, 1.15),
  stallBox(-2.55, 0.75, 0.42, 0.55),
]

/** Pushes a body of `radius` at p out of every obstacle and rock. */
export function pushOut(p: Vec2, radius: number) {
  for (const box of OBSTACLES) {
    const c = Math.cos(box.yaw)
    const s = Math.sin(box.yaw)
    const dx = p.x - box.x
    const dz = p.z - box.z
    // Into the box's frame, find the nearest point on it, and back out again.
    const lx = dx * c - dz * s
    const lz = dx * s + dz * c
    const nx = Math.max(-box.halfW, Math.min(box.halfW, lx))
    const nz = Math.max(-box.halfD, Math.min(box.halfD, lz))
    let ox = lx - nx
    let oz = lz - nz
    let d = Math.hypot(ox, oz)
    if (d >= radius) continue
    if (d < 1e-5) {
      // Centre inside the box: leave by the nearest side.
      const toX = box.halfW - Math.abs(lx)
      const toZ = box.halfD - Math.abs(lz)
      ox = toX < toZ ? Math.sign(lx) || 1 : 0
      oz = toX < toZ ? 0 : Math.sign(lz) || 1
      d = 1
    }
    const fx = nx + (ox / d) * radius
    const fz = nz + (oz / d) * radius
    p.x = box.x + fx * c + fz * s
    p.z = box.z - fx * s + fz * c
  }
  pushOutOfRocks(p, radius)
}
