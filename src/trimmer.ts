import { CircleGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3, BoxGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { bake } from './bake'
import { blackPlastic, engineGrey } from './mower'
import { TRIMMER } from './tools'

const orange = new MeshStandardMaterial({ color: '#ef6c1a', roughness: 0.45 })
const shaftMetal = new MeshStandardMaterial({ color: '#2b2e33', metalness: 0.7, roughness: 0.35 })
const line = new MeshStandardMaterial({ color: '#d9ff3d', roughness: 0.6 })
/** The blur of the line at full speed. Drawn instead of the line itself while spinning. */
const blur = new MeshBasicMaterial({ color: '#e8ff8a', transparent: true, opacity: 0.22, depthWrite: false })

const UP = new Vector3(0, 1, 0)

/**
 * A string trimmer in metres: a cutting head on the ground, a shaft up to the hands and the engine
 * behind them. Head and hands are placed each frame, so the same model serves you and the robots.
 */
export function createTrimmer() {
  const head = new Group()
  const housing = new Group()
  const guard = new Mesh(new CylinderGeometry(TRIMMER.radius * 0.45, TRIMMER.radius * 0.45, 0.012, 24, 1, false, 0, Math.PI), orange)
  guard.position.y = 0.13
  const spool = new Mesh(new CylinderGeometry(0.05, 0.055, 0.07, 18), engineGrey)
  spool.position.y = 0.09
  const motor = new Mesh(new CylinderGeometry(0.045, 0.05, 0.06, 18), orange)
  motor.position.y = 0.16
  housing.add(guard, spool, motor)
  head.add(bake(housing))
  // The guard sits between the line and the operator, so it turns with the shaft.
  const guardTurn = head.children[0]

  const spinner = new Group()
  spinner.position.y = 0.065
  const strands = new Group()
  for (const angle of [0, Math.PI / 2]) {
    const strand = new Mesh(new BoxGeometry(TRIMMER.radius * 1.9, 0.004, 0.004), line)
    strand.rotation.y = angle
    strands.add(strand)
  }
  const disc = new Mesh(new CircleGeometry(TRIMMER.radius, 32), blur)
  disc.rotation.x = -Math.PI / 2
  spinner.add(strands, disc)
  head.add(spinner)

  // A unit-long shaft, stretched between head and hands every frame.
  const shaft = new Mesh(new CylinderGeometry(0.014, 0.014, 1, 10).translate(0, 0.5, 0), shaftMetal)

  // Engine and handle at the top end, built along +y from the hands.
  const top = new Group()
  const engineParts = new Group()
  const tank = new Mesh(new RoundedBoxGeometry(0.15, 0.18, 0.13, 3, 0.03), orange)
  tank.position.y = 0.26
  const cover = new Mesh(new RoundedBoxGeometry(0.12, 0.08, 0.15, 3, 0.025), blackPlastic)
  cover.position.y = 0.36
  const grip = new Mesh(new CylinderGeometry(0.02, 0.02, 0.32, 10), blackPlastic)
  grip.rotation.z = Math.PI / 2
  grip.position.y = 0
  const stem = new Mesh(new CylinderGeometry(0.012, 0.012, 0.12, 8), shaftMetal)
  stem.position.y = 0.06
  engineParts.add(tank, cover, grip, stem)
  top.add(bake(engineParts))

  const group = new Group()
  group.add(head, shaft, top)
  group.visible = false
  const dir = new Vector3()
  const q = new Quaternion()
  let spin = 0

  return {
    group,
    /** Where the head is, on the ground. */
    head: head.position,
    show(visible: boolean) {
      group.visible = visible
    },
    /** Places the head at (headX, headZ) and the handle at `hands`. `speed` 0..1 is how fast the line spins. */
    update(headX: number, headZ: number, hands: Vector3, time: number, dt: number, speed: number) {
      head.position.set(headX, 0, headZ)
      const from = dir.set(headX, 0.16, headZ)
      const along = hands.clone().sub(from)
      const length = along.length()
      shaft.position.copy(from)
      shaft.quaternion.copy(q.setFromUnitVectors(UP, along.divideScalar(length)))
      shaft.scale.set(1, length, 1)
      top.position.copy(hands)
      top.quaternion.copy(shaft.quaternion)
      // The guard's open side faces away from the hands.
      guardTurn.rotation.y = Math.atan2(along.x, along.z) - Math.PI / 2

      spin += speed * dt * 70
      spinner.rotation.y = spin
      disc.visible = speed > 0.5
      strands.visible = !disc.visible
      head.position.y = Math.sin(time * 37) * 0.004 * speed
    },
  }
}

export type Trimmer = ReturnType<typeof createTrimmer>
