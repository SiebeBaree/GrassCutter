import type { PerspectiveCamera } from 'three'
import type { PlayerState } from './save'
import { SIGN } from './sign'

const EYE_HEIGHT = 1.68
const WALK_SPEED = 2.6
const RUN_SPEED = 4.8
/** How far from the meadow's centre you can walk. The trees start just beyond. */
const WORLD_RADIUS = 64
const BODY_RADIUS = 0.35
const SENSITIVITY = 0.0022
/** Radians of bob phase per metre walked: roughly one step every 0.7 m. */
const STEP_RATE = Math.PI / 0.72

const MOVE_KEYS = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
} as const satisfies Record<string, readonly [number, number]>

type MoveKey = keyof typeof MOVE_KEYS
const isMoveKey = (code: string): code is MoveKey => code in MOVE_KEYS

/** First-person walker: WASD on a flat field, kept inside the world and out of the sign. */
export function createPlayer(start: PlayerState) {
  const state: PlayerState = { ...start }
  const held = new Set<string>()
  let vx = 0
  let vz = 0
  let bob = 0

  function collide() {
    // Stay in the world.
    const r = Math.hypot(state.x, state.z)
    if (r > WORLD_RADIUS) {
      state.x *= WORLD_RADIUS / r
      state.z *= WORLD_RADIUS / r
    }
    // Push out of the sign board (a capsule along its width).
    const cx = Math.max(SIGN.x - SIGN.halfWidth, Math.min(SIGN.x + SIGN.halfWidth, state.x))
    const dx = state.x - cx
    const dz = state.z - SIGN.z
    const d = Math.hypot(dx, dz)
    const min = BODY_RADIUS + 0.12
    if (d < min) {
      const nx = d > 1e-5 ? dx / d : 0
      const nz = d > 1e-5 ? dz / d : 1
      state.x = cx + nx * min
      state.z = SIGN.z + nz * min
    }
  }

  return {
    state,
    get bob() {
      return bob
    },
    /** Metres per second over the ground. */
    get speed() {
      return Math.hypot(vx, vz)
    },
    keyDown(code: string) {
      held.add(code)
      return isMoveKey(code)
    },
    keyUp(code: string) {
      held.delete(code)
    },
    releaseAll() {
      held.clear()
    },
    look(dx: number, dy: number) {
      // Some browsers report huge jumps right after pointer lock; ignore them.
      if (Math.abs(dx) > 300 || Math.abs(dy) > 300) return
      state.yaw = (state.yaw - dx * SENSITIVITY) % (Math.PI * 2)
      state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch - dy * SENSITIVITY))
    },
    /** Moves the player and returns how many steps were taken this frame (for footstep sounds). */
    update(dt: number) {
      let ix = 0
      let iz = 0
      for (const code of held) {
        if (!isMoveKey(code)) continue
        ix += MOVE_KEYS[code][0]
        iz += MOVE_KEYS[code][1]
      }
      const len = Math.hypot(ix, iz)
      const speed = held.has('ShiftLeft') || held.has('ShiftRight') ? RUN_SPEED : WALK_SPEED
      const sin = Math.sin(state.yaw)
      const cos = Math.cos(state.yaw)
      let tx = 0
      let tz = 0
      if (len > 0) {
        // Forward is -z at yaw 0; right is +x.
        tx = ((ix * cos - iz * sin) / len) * speed
        tz = ((-ix * sin - iz * cos) / len) * speed
      }
      const follow = 1 - Math.exp(-dt * 11)
      vx += (tx - vx) * follow
      vz += (tz - vz) * follow

      const before = Math.floor(bob / Math.PI)
      const px = state.x
      const pz = state.z
      state.x += vx * dt
      state.z += vz * dt
      collide()
      bob += Math.hypot(state.x - px, state.z - pz) * STEP_RATE
      return Math.floor(bob / Math.PI) - before
    },
    applyTo(camera: PerspectiveCamera) {
      const moving = Math.min(1, Math.hypot(vx, vz) / WALK_SPEED)
      camera.position.set(state.x, EYE_HEIGHT + Math.abs(Math.sin(bob)) * 0.035 * moving - 0.015 * moving, state.z)
      camera.rotation.set(state.pitch, state.yaw, Math.sin(bob) * 0.006 * moving, 'YXZ')
    },
  }
}

export type Player = ReturnType<typeof createPlayer>
