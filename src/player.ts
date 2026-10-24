import type { PerspectiveCamera } from 'three'
import { MAP_HALF } from './field'
import { pushOut } from './layout'
import { RIDER_EYE } from './rider'
import type { PlayerState } from './save'
import { MOWER, RIDER } from './tools'

const EYE_HEIGHT = 1.68
const WALK_SPEED = 2.6
const RUN_SPEED = 4.8
/** How far from the meadow's centre you can go. The trees start just beyond. */
const WORLD_RADIUS = MAP_HALF - 4
const BODY_RADIUS = 0.35
const RIDER_RADIUS = 1.0
const RIDER_SEAT_BACK = 0.22
const SENSITIVITY = 0.0022
/** Radians of bob phase per metre walked: roughly one step every 0.7 m. */
const STEP_RATE = Math.PI / 0.72
/** Push the touch stick this far and you run. */
const STICK_RUN = 0.9

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

/** On foot, behind the push mower (no sprinting past its top speed) or driving the riding mower. */
export type Gait = 'walk' | 'push' | 'ride'

/**
 * First-person mover. On foot, WASD walks relative to where you look. On the riding mower, W and S
 * drive, A and D steer, and the mouse turns it too. The touch stick does the same, in proportion.
 */
export function createPlayer(start: PlayerState) {
  const state: PlayerState = { ...start }
  const held = new Set<string>()
  const stick = { x: 0, z: 0 }
  let vx = 0
  let vz = 0
  let bob = 0
  let eye = EYE_HEIGHT
  let steer = 0
  let gait: Gait = 'walk'

  const input = () => {
    let ix = stick.x
    let iz = stick.z
    for (const code of held) {
      if (!isMoveKey(code)) continue
      ix += MOVE_KEYS[code][0]
      iz += MOVE_KEYS[code][1]
    }
    return { ix, iz }
  }

  function collide(radius: number) {
    const r = Math.hypot(state.x, state.z)
    if (r > WORLD_RADIUS) {
      state.x *= WORLD_RADIUS / r
      state.z *= WORLD_RADIUS / r
    }
    pushOut(state, radius)
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
    /** -1 to 1: how hard you're steering the riding mower. */
    get steer() {
      return steer
    },
    setGait(next: Gait) {
      gait = next
    },
    keyDown(code: string) {
      held.add(code)
      return isMoveKey(code)
    },
    keyUp(code: string) {
      held.delete(code)
    },
    /** The touch stick: -1 to 1, x to the right and z forward. */
    setStick(x: number, z: number) {
      stick.x = x
      stick.z = z
    },
    releaseAll() {
      held.clear()
      stick.x = 0
      stick.z = 0
    },
    look(dx: number, dy: number) {
      // Some browsers report huge jumps right after pointer lock; ignore them.
      if (Math.abs(dx) > 300 || Math.abs(dy) > 300) return
      state.yaw = (state.yaw - dx * SENSITIVITY) % (Math.PI * 2)
      state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch - dy * SENSITIVITY))
    },
    /** Moves the player and returns how many steps were taken this frame (for footstep sounds). */
    update(dt: number) {
      const { ix, iz } = input()
      const running = held.has('ShiftLeft') || held.has('ShiftRight') || Math.hypot(stick.x, stick.z) > STICK_RUN
      let tx = 0
      let tz = 0
      if (gait === 'ride') {
        steer += (Math.max(-1, Math.min(1, ix)) - steer) * Math.min(1, dt * 6)
        state.yaw -= steer * RIDER.turn * dt
        const throttle = Math.min(1, Math.abs(iz))
        const ahead = iz > 0 ? RIDER.speed * throttle : iz < 0 ? -RIDER.reverse * throttle : 0
        tx = -Math.sin(state.yaw) * ahead
        tz = -Math.cos(state.yaw) * ahead
      } else {
        steer = 0
        const len = Math.hypot(ix, iz)
        const speed = gait === 'push' ? (running ? MOWER.speed : WALK_SPEED) : running ? RUN_SPEED : WALK_SPEED
        if (len > 0) {
          const sin = Math.sin(state.yaw)
          const cos = Math.cos(state.yaw)
          // Forward is -z at yaw 0; right is +x.
          // Keys push full speed in any direction; the stick goes slower when barely pushed.
          const pace = (speed * Math.min(1, len)) / len
          tx = (ix * cos - iz * sin) * pace
          tz = (-ix * sin - iz * cos) * pace
        }
      }
      // A riding mower picks up speed slower than legs do.
      const follow = 1 - Math.exp(-dt * (gait === 'ride' ? 2.2 : 11))
      vx += (tx - vx) * follow
      vz += (tz - vz) * follow

      const before = Math.floor(bob / Math.PI)
      const px = state.x
      const pz = state.z
      state.x += vx * dt
      state.z += vz * dt
      collide(gait === 'ride' ? RIDER_RADIUS : BODY_RADIUS)
      const moved = Math.hypot(state.x - px, state.z - pz)
      if (gait !== 'ride') bob += moved * STEP_RATE
      eye += ((gait === 'ride' ? RIDER_EYE : EYE_HEIGHT) - eye) * Math.min(1, dt * 5)
      return gait === 'ride' ? 0 : Math.floor(bob / Math.PI) - before
    },
    applyTo(camera: PerspectiveCamera) {
      const moving = gait === 'ride' ? 0 : Math.min(1, Math.hypot(vx, vz) / WALK_SPEED)
      // On the riding mower you sit at the back of the seat, with the steering wheel and hood ahead.
      const back = gait === 'ride' ? RIDER_SEAT_BACK : 0
      camera.position.set(
        state.x + Math.sin(state.yaw) * back,
        eye + Math.abs(Math.sin(bob)) * 0.035 * moving - 0.015 * moving,
        state.z + Math.cos(state.yaw) * back,
      )
      camera.rotation.set(state.pitch, state.yaw, Math.sin(bob) * 0.006 * moving, 'YXZ')
    },
  }
}

export type Player = ReturnType<typeof createPlayer>
