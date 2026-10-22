import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, TorusGeometry, Vector3, BoxGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { bake } from './bake'
import type { Vec2 } from './field'
import { blackPlastic, engineGrey, paint, tube, tubeMetal, wheel, yellow, type Driver } from './mower'
import { RIDER } from './tools'

const lamp = new MeshStandardMaterial({ color: '#fff6d8', emissive: '#fff1c2', emissiveIntensity: 1.6, roughness: 0.3 })

/** Seated eye height. High enough to see over the meadow. */
export const RIDER_EYE = 1.86

function box(w: number, h: number, d: number, radius: number, material: MeshStandardMaterial, x: number, y: number, z: number) {
  const mesh = new Mesh(radius > 0 ? new RoundedBoxGeometry(w, h, d, 3, radius) : new BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  return mesh
}

/**
 * A riding mower in metres, facing -Z, with its origin on the ground under the driver. The deck hangs
 * between the wheels RIDER.ahead metres in front of the seat.
 */
export function createRider() {
  const frame = new Group()
  frame.add(
    // Chassis, footboard and the body over the rear axle.
    box(0.62, 0.1, 1.9, 0, tubeMetal, 0, 0.3, -0.45),
    box(0.85, 0.04, 0.6, 0, tubeMetal, 0, 0.42, -0.36),
    box(0.95, 0.28, 0.75, 0.06, paint, 0, 0.6, 0.33),
    box(0.3, 0.06, 0.82, 0.025, paint, -0.6, 0.76, 0.36),
    box(0.3, 0.06, 0.82, 0.025, paint, 0.6, 0.76, 0.36),
    // Seat on a post.
    box(0.3, 0.18, 0.3, 0, engineGrey, 0, 0.74, 0.12),
    box(0.5, 0.11, 0.46, 0.04, blackPlastic, 0, 0.87, 0.12),
    // Hood, grille, a stripe down each side and the dashboard behind the hood.
    box(0.66, 0.44, 0.92, 0.08, paint, 0, 0.62, -1.08),
    box(0.5, 0.3, 0.03, 0, blackPlastic, 0, 0.6, -1.545),
    box(0.012, 0.05, 0.78, 0, yellow, -0.333, 0.66, -1.08),
    box(0.012, 0.05, 0.78, 0, yellow, 0.333, 0.66, -1.08),
    box(0.38, 0.34, 0.22, 0.05, paint, 0, 0.72, -0.55),
    // The deck under the belly, its skirt and the chute on the right.
    box(RIDER.halfWidth * 2, 0.13, RIDER.halfLength * 2, 0.05, engineGrey, 0, 0.18, -RIDER.ahead),
    box(RIDER.halfWidth * 2 + 0.04, 0.05, RIDER.halfLength * 2 + 0.04, 0.02, blackPlastic, 0, 0.1, -RIDER.ahead),
    tube(new Vector3(0, 0.85, -0.55), new Vector3(0, 1.08, -0.4), 0.022, tubeMetal),
  )
  const backrest = box(0.48, 0.42, 0.09, 0.04, blackPlastic, 0, 1.11, 0.37)
  backrest.rotation.x = 0.2
  const chute = box(0.24, 0.1, 0.36, 0.03, blackPlastic, RIDER.halfWidth + 0.08, 0.17, -RIDER.ahead)
  chute.rotation.z = -0.22
  frame.add(backrest, chute)
  for (const side of [-1, 1]) {
    const light = new Mesh(new CylinderGeometry(0.045, 0.045, 0.02, 16), lamp)
    light.rotation.x = Math.PI / 2
    light.position.set(side * 0.2, 0.74, -1.55)
    frame.add(light)
  }

  const body = new Group()
  body.add(bake(frame))

  // The steering wheel turns about its own column.
  const steering = new Group()
  steering.position.set(0, 1.1, -0.39)
  steering.rotation.x = -0.95
  const rim = new Mesh(new TorusGeometry(0.17, 0.018, 8, 28), blackPlastic)
  const spokes = new Mesh(new BoxGeometry(0.32, 0.025, 0.012), engineGrey)
  const cap = new Mesh(new CylinderGeometry(0.04, 0.04, 0.03, 16), yellow)
  cap.rotation.x = Math.PI / 2
  const wheelSpin = new Group()
  wheelSpin.add(rim, spokes, cap)
  steering.add(wheelSpin)
  body.add(steering)

  const wheels = [
    { x: -0.6, z: 0.36, r: 0.33, w: 0.22 },
    { x: 0.6, z: 0.36, r: 0.33, w: 0.22 },
    { x: -0.43, z: -1.28, r: 0.19, w: 0.12 },
    { x: 0.43, z: -1.28, r: 0.19, w: 0.12 },
  ].map(({ x, z, r, w }) => {
    const made = wheel(r, w)
    made.group.position.set(x, r, z)
    body.add(made.group)
    return { spin: made.spin, radius: r }
  })

  const group = new Group()
  group.add(body)
  group.visible = false

  const centre = new Vector3()
  const forward: Vec2 = { x: 0, z: -1 }
  const last = new Vector3()

  return {
    group,
    /** Deck centre in world space, valid after update(). */
    centre,
    /** Unit vector the mower faces, valid after update(). */
    forward,
    show(visible: boolean) {
      group.visible = visible
    },
    /** Follows its driver. `steer` from -1 (left) to 1 turns the wheel; `running` adds engine shake. */
    update(driver: Driver, time: number, running: boolean, steer: number) {
      forward.x = -Math.sin(driver.yaw)
      forward.z = -Math.cos(driver.yaw)
      const rolled = (driver.x - last.x) * forward.x + (driver.z - last.z) * forward.z
      if (Math.abs(rolled) < 1) for (const w of wheels) w.spin.rotation.x -= rolled / w.radius
      last.set(driver.x, 0, driver.z)
      centre.set(driver.x + forward.x * RIDER.ahead, 0, driver.z + forward.z * RIDER.ahead)

      group.position.set(driver.x, 0, driver.z)
      group.rotation.y = driver.yaw
      wheelSpin.rotation.z += (steer * 1.6 - wheelSpin.rotation.z) * 0.2
      body.position.y = running ? Math.sin(time * 160) * 0.003 : 0
      body.rotation.z = running ? Math.sin(time * 117) * 0.003 : 0
    },
    /** Where clippings fly out, in world space. */
    chute(out: Vector3) {
      return out.set(RIDER.halfWidth + 0.25, 0.2, -RIDER.ahead).applyMatrix4(group.matrixWorld)
    },
  }
}

export type Rider = ReturnType<typeof createRider>
