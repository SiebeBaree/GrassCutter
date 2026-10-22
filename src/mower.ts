import {
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  BoxGeometry,
  CapsuleGeometry,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { bake } from './bake'
import type { Vec2 } from './field'
import { MOWER } from './tools'

/** Whoever drives a machine: where they stand and which way they face. */
export type Driver = { x: number; z: number; yaw: number }

export const paint = new MeshStandardMaterial({ color: '#c42f1f', metalness: 0.35, roughness: 0.38 })
export const blackPlastic = new MeshStandardMaterial({ color: '#1c1d20', roughness: 0.6 })
export const engineGrey = new MeshStandardMaterial({ color: '#3a3d42', metalness: 0.6, roughness: 0.45 })
export const tubeMetal = new MeshStandardMaterial({ color: '#2a2c30', metalness: 0.8, roughness: 0.35 })
const rubber = new MeshStandardMaterial({ color: '#141414', roughness: 0.9 })
export const hubMetal = new MeshStandardMaterial({ color: '#a9adb3', metalness: 0.9, roughness: 0.3 })
export const yellow = new MeshStandardMaterial({ color: '#f2b705', roughness: 0.5 })

/** Seconds the mower takes to drop into place when you take it out. */
const DROP_TIME = 0.35

export function tube(a: Vector3, b: Vector3, radius: number, material: MeshStandardMaterial) {
  const dir = b.clone().sub(a)
  const mesh = new Mesh(new CylinderGeometry(radius, radius, dir.length(), 10), material)
  mesh.position.copy(a).add(b).multiplyScalar(0.5)
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()))
  return mesh
}

/** A tyre on a hub, with a notch so you can see it turn. `spin` rolls about local x. */
export function wheel(radius: number, width = radius * 0.48) {
  const group = new Group()
  const tire = new Mesh(new TorusGeometry(radius * 0.78, radius * 0.24, 10, 24), rubber)
  tire.rotation.y = Math.PI / 2
  // Wider tyres stretch along the axle.
  tire.scale.z = width / (radius * 0.48)
  const hub = new Mesh(new CylinderGeometry(radius * 0.6, radius * 0.6, Math.max(0.05, width * 0.6), 20), hubMetal)
  hub.rotation.z = Math.PI / 2
  const bolt = new Mesh(new BoxGeometry(Math.max(0.056, width * 0.65), radius * 0.5, 0.03), engineGrey)
  bolt.position.y = radius * 0.25
  const spin = new Group()
  spin.add(tire, hub, bolt)
  group.add(spin)
  return { group, spin }
}

/**
 * A push mower in metres, deck centred on its origin and facing -Z. It rides in front of its driver:
 * the deck sits MOWER.ahead metres ahead and the handlebar comes back to the driver's hands.
 */
export function createMower() {
  const body = new Group()
  const frame = new Group()
  // The deck covers the cutting width with a little to spare.
  const half = MOWER.halfWidth + 0.03

  const deck = new Mesh(new RoundedBoxGeometry(half * 2, 0.15, 0.94, 4, 0.06), paint)
  deck.position.y = 0.13
  const dome = new Mesh(new SphereGeometry(0.4, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), paint)
  dome.scale.set(half * 1.9, 0.22, 0.95)
  dome.position.y = 0.2
  const skirt = new Mesh(new RoundedBoxGeometry(half * 2 + 0.04, 0.06, 0.98, 2, 0.025), blackPlastic)
  skirt.position.y = 0.07

  const engine = new Mesh(new CylinderGeometry(0.15, 0.17, 0.17, 24), engineGrey)
  engine.position.set(0, 0.36, 0.05)
  const cover = new Mesh(
    new LatheGeometry(
      [
        [0, 0.09],
        [0.12, 0.085],
        [0.17, 0.06],
        [0.19, 0.02],
        [0.19, 0],
      ].map(([r, y]) => new Vector2(r, y)),
      28,
    ),
    blackPlastic,
  )
  cover.position.set(0, 0.44, 0.05)
  const fuelCap = new Mesh(new CylinderGeometry(0.035, 0.035, 0.03, 16), yellow)
  fuelCap.position.set(0.08, 0.545, 0.0)
  const filter = new Mesh(new RoundedBoxGeometry(0.16, 0.09, 0.1, 3, 0.02), blackPlastic)
  filter.position.set(-0.09, 0.42, -0.14)
  const cordHandle = new Mesh(new CapsuleGeometry(0.012, 0.07, 4, 10), blackPlastic)
  cordHandle.rotation.z = Math.PI / 2
  cordHandle.position.set(0.12, 0.47, 0.2)

  // Grass shoots out of the chute on the right.
  const chute = new Mesh(new RoundedBoxGeometry(0.22, 0.1, 0.3, 3, 0.03), blackPlastic)
  chute.position.set(half + 0.07, 0.13, 0.02)
  chute.rotation.z = -0.25

  frame.add(deck, dome, skirt, engine, cover, fuelCap, filter, cordHandle, chute)

  const wheels = [
    { x: -half, z: -0.36, r: 0.11 },
    { x: half, z: -0.36, r: 0.11 },
    { x: -half, z: 0.36, r: 0.13 },
    { x: half, z: 0.36, r: 0.13 },
  ].map(({ x, z, r }) => {
    const w = wheel(r)
    w.group.position.set(x + Math.sign(x) * 0.01, r, z)
    body.add(w.group)
    return { spin: w.spin, radius: r }
  })

  // Handlebar: two tubes from the back of the deck up to the grip, half a metre in front of the driver.
  const grip = MOWER.ahead - 0.5
  for (const side of [-1, 1]) {
    frame.add(tube(new Vector3(side * 0.36, 0.2, 0.42), new Vector3(side * 0.3, 0.88, grip), 0.014, tubeMetal))
  }
  frame.add(tube(new Vector3(-0.31, 0.89, grip), new Vector3(0.31, 0.89, grip), 0.016, tubeMetal))
  const foam = new Mesh(new CapsuleGeometry(0.022, 0.42, 4, 12), blackPlastic)
  foam.rotation.z = Math.PI / 2
  foam.position.set(0, 0.89, grip)
  frame.add(foam)
  // The safety bail, held against the handle while mowing.
  frame.add(tube(new Vector3(-0.27, 0.86, grip - 0.06), new Vector3(0.27, 0.86, grip - 0.06), 0.008, hubMetal))
  for (const side of [-1, 1]) {
    frame.add(tube(new Vector3(side * 0.27, 0.86, grip - 0.06), new Vector3(side * 0.29, 0.82, grip - 0.16), 0.008, hubMetal))
  }
  body.add(bake(frame))

  const group = new Group()
  group.add(body)
  group.visible = false

  const centre = new Vector3()
  const forward: Vec2 = { x: 0, z: -1 }
  let shownAt = -Infinity

  return {
    group,
    /** Deck centre in world space, valid after update(). */
    centre,
    /** Unit vector the mower faces, valid after update(). */
    forward,
    show(visible: boolean, time: number) {
      if (visible && !group.visible) shownAt = time
      group.visible = visible
    },
    /** Follows its driver. `running` adds engine shake. */
    update(driver: Driver, time: number, running: boolean) {
      forward.x = -Math.sin(driver.yaw)
      forward.z = -Math.cos(driver.yaw)
      const x = driver.x + forward.x * MOWER.ahead
      const z = driver.z + forward.z * MOWER.ahead
      // Roll the wheels by how far the deck moved along its facing.
      const rolled = (x - centre.x) * forward.x + (z - centre.z) * forward.z
      if (Math.abs(rolled) < 1) for (const w of wheels) w.spin.rotation.x -= rolled / w.radius
      centre.set(x, 0, z)

      const drop = Math.min(1, (time - shownAt) / DROP_TIME)
      group.position.set(x, (1 - drop) ** 2 * 0.5, z)
      group.rotation.y = driver.yaw
      body.position.y = running ? Math.sin(time * 190) * 0.0025 : 0
      body.rotation.z = running ? Math.sin(time * 133) * 0.004 : 0
    },
    /** Where clippings fly out, in world space. */
    chute(out: Vector3) {
      return out.set(MOWER.halfWidth + 0.15, 0.16, 0.02).applyMatrix4(group.matrixWorld)
    },
  }
}

export type Mower = ReturnType<typeof createMower>
