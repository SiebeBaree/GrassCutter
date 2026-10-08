import {
  BufferGeometry,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SplineCurve,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { SUN_COLOR, SUN_DIR } from './light'

/** Seconds for one press and release of the lever. */
const SNIP_TIME = 0.2

type Point = readonly [number, number]

/**
 * A bent metal plate in millimetres. The side profile follows a smooth curve through `centre`;
 * seen from above it is `width` wide with ends rounded by the given radii. The top is slightly domed.
 */
function plate(centre: readonly Point[], width: number, thickness: number, roundBack: number, roundFront: number) {
  const rows = new SplineCurve(centre.map(([x, y]) => new Vector2(x, y))).getSpacedPoints(48)
  const x0 = rows[0].x
  const x1 = rows[rows.length - 1].x
  const half = (x: number) => {
    const back = x - x0 < roundBack ? Math.sqrt(1 - ((roundBack - (x - x0)) / roundBack) ** 2) : 1
    const front = x1 - x < roundFront ? Math.sqrt(1 - ((roundFront - (x1 - x)) / roundFront) ** 2) : 1
    return (width / 2) * Math.max(0.25, Math.min(back, front))
  }
  const edge = (side: number, dy: number) => rows.map((p) => new Vector3(p.x, p.y + dy, side * half(p.x)))
  const t = thickness / 2
  const topLeft = edge(-1, t)
  const topRight = edge(1, t)
  const ridge = rows.map((p) => new Vector3(p.x, p.y + t + 0.25, 0))
  const bottomLeft = edge(-1, -t)
  const bottomRight = edge(1, -t)

  const positions: number[] = []
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3) => {
    for (const v of [a, b, c, b, d, c]) positions.push(v.x, v.y, v.z)
  }
  // Each strip gets its own vertices so edges stay crisp while faces shade smoothly.
  const strip = (p: Vector3[], q: Vector3[]) => {
    for (let i = 0; i < p.length - 1; i++) quad(p[i], q[i], p[i + 1], q[i + 1])
  }
  strip(topLeft, ridge)
  strip(ridge, topRight)
  strip(bottomRight, bottomLeft)
  strip(bottomLeft, topLeft)
  strip(topRight, bottomRight)
  const n = rows.length - 1
  quad(topLeft[n], topRight[n], bottomLeft[n], bottomRight[n])
  quad(topRight[0], topLeft[0], bottomRight[0], bottomLeft[0])

  const geometry = mergeVertices(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3)))
  geometry.computeVertexNormals()
  return geometry
}

/**
 * First-person nail clipper, drawn in its own scene on top of the world so it never clips into grass.
 * Built along +x (jaws at the front), then turned to point into the screen.
 */
export function createClipper(renderer: WebGLRenderer) {
  const scene = new Scene()
  // A neutral studio reflection reads as polished steel; the blue sky made it look like plastic.
  const pmrem = new PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture
  pmrem.dispose()
  scene.environmentIntensity = 0.9
  const light = new DirectionalLight(SUN_COLOR, 3)
  light.position.copy(SUN_DIR)
  scene.add(light)

  const camera = new PerspectiveCamera(50, 1, 0.005, 2)

  const chrome = new MeshStandardMaterial({ color: '#d4d8de', metalness: 1, roughness: 0.25 })
  const brushed = new MeshStandardMaterial({ color: '#b4b9c0', metalness: 1, roughness: 0.35 })

  const lowerJaw = new Mesh(
    plate([[0, 0], [12, 0], [24, 0], [34, 0.1], [42, 0.5], [48, 1.4], [53, 2.9], [57, 4.6], [59, 5.4]], 13, 1.7, 6.5, 2),
    chrome,
  )
  const upperJaw = new Mesh(
    plate(
      [[0, 1.75], [5, 1.85], [10, 2.9], [16, 4.7], [24, 6.4], [34, 7.4], [44, 7.8], [50, 7.6], [55, 7.0], [59, 6.8]],
      13,
      1.7,
      6.5,
      2,
    ),
    chrome,
  )
  // The upper jaw hinges at the rivet at the back.
  const upperPivot = new Group()
  upperPivot.position.set(0, 1.75, 0)
  upperJaw.position.set(0, -1.75, 0)
  upperPivot.add(upperJaw)

  const lever = new Mesh(
    plate([[-11, 15.6], [-6, 15.7], [2, 14.8], [12, 13.5], [22, 12.4], [32, 11.4], [42, 10.7], [47, 10.4]], 11, 1.9, 5.5, 5.5),
    brushed,
  )
  const leverPivot = new Group()
  leverPivot.position.set(42, 10.4, 0)
  lever.position.set(-42, -10.4, 0)
  leverPivot.add(lever)

  const pin = new Mesh(new CylinderGeometry(1.4, 1.4, 11, 16), brushed)
  pin.position.set(42, 5.2, 0)
  const pinHead = new Mesh(new CylinderGeometry(2.6, 2.6, 1.2, 20), chrome)
  pinHead.position.set(42, 10.6, 0)
  const rivet = new Mesh(new CylinderGeometry(1.8, 1.8, 4.4, 16), brushed)
  rivet.position.set(3, 1, 0)

  const body = new Group()
  body.add(lowerJaw, upperPivot, leverPivot, pin, pinHead, rivet)
  body.scale.setScalar(0.0013)

  // Hold it in the lower right, jaws pointing in toward the crosshair.
  const holder = new Group()
  holder.add(body)
  // Roll about its length first, then tip the jaws up, then turn them toward the screen centre.
  body.rotation.set(-0.35, Math.PI / 2 + 1.05, 0.3, 'YZX')
  const rest = { x: 0.1, y: -0.092, z: -0.25 }
  holder.position.set(rest.x, rest.y, rest.z)
  scene.add(holder)

  let snipAt = -1
  let swayX = 0
  let swayY = 0

  return {
    scene,
    camera,
    resize(aspect: number) {
      camera.aspect = aspect
      camera.updateProjectionMatrix()
    },
    snip(time: number) {
      snipAt = time
    },
    /** bob: walking phase offset; lookX/lookY: mouse movement this frame, for a little lag. */
    update(time: number, dt: number, bob: number, lookX: number, lookY: number) {
      const p = snipAt < 0 ? 1 : Math.min(1, (time - snipAt) / SNIP_TIME)
      const press = Math.sin(Math.PI * Math.min(1, p * 1.25))
      leverPivot.rotation.z = press * 0.17
      upperPivot.rotation.z = -press * 0.035

      const follow = 1 - Math.exp(-dt * 10)
      swayX += (Math.max(-0.02, Math.min(0.02, -lookX * 0.00025)) - swayX) * follow
      swayY += (Math.max(-0.02, Math.min(0.02, lookY * 0.00025)) - swayY) * follow

      holder.position.set(
        rest.x + swayX + Math.sin(bob) * 0.004 - press * 0.012,
        rest.y + swayY - Math.abs(Math.cos(bob)) * 0.004 + press * 0.006,
        rest.z - press * 0.025,
      )
      holder.rotation.z = Math.sin(time * 0.9) * 0.01
    },
  }
}

export type Clipper = ReturnType<typeof createClipper>
