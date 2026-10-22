import {
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Scene,
  Shape,
  SplineCurve,
  TorusGeometry,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { SUN_COLOR, SUN_DIR } from './light'
import { CLIPPER, SCISSORS, SICKLE, sickleSweep, type ToolId } from './tools'

/** Seconds to lower one tool and raise the next. */
const SWAP_TIME = 0.32

type Point = readonly [number, number]

const chrome = new MeshStandardMaterial({ color: '#d4d8de', metalness: 1, roughness: 0.25 })
const brushed = new MeshStandardMaterial({ color: '#b4b9c0', metalness: 1, roughness: 0.35 })
const steel = new MeshStandardMaterial({ color: '#c3c8cf', metalness: 1, roughness: 0.3 })
const darkSteel = new MeshStandardMaterial({ color: '#5d6168', metalness: 0.9, roughness: 0.45 })
const orangeGrip = new MeshStandardMaterial({ color: '#e0561b', roughness: 0.45 })
const wood = new MeshStandardMaterial({ color: '#8a5530', roughness: 0.65 })

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

/** A flat outline in the XY plane, extruded `thickness` thick and laid down so +Y points forward (-Z) and the thickness points up. */
function flatPiece(shape: Shape, thickness: number, bevel: number) {
  const geometry = new ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 24,
  })
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/** A capsule from a to b. */
function rod(a: Vector3, b: Vector3, radius: number, material: MeshStandardMaterial) {
  const dir = b.clone().sub(a)
  const mesh = new Mesh(new CapsuleGeometry(radius, Math.max(0.001, dir.length() - radius * 2), 6, 14), material)
  mesh.position.copy(a).add(b).multiplyScalar(0.5)
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()))
  return mesh
}

/** The nail clipper, built along +x in millimetres (jaws at the front), then turned to point into the screen. */
export function createClipper() {
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
  // Roll about its length first, then tip the jaws up, then turn them toward the screen centre.
  body.rotation.set(-0.35, Math.PI / 2 + 1.05, 0.3, 'YZX')

  const holder = new Group()
  holder.add(body)
  return {
    holder,
    rest: new Vector3(0.1, -0.092, -0.25),
    actionTime: CLIPPER.interval,
    /** p runs 0 to 1 over one snip. */
    animate(p: number) {
      const press = Math.sin(Math.PI * Math.min(1, p * 1.25))
      leverPivot.rotation.z = press * 0.17
      upperPivot.rotation.z = -press * 0.035
      holder.position.x -= press * 0.012
      holder.position.y += press * 0.006
      holder.position.z -= press * 0.025
    },
  }
}

/**
 * Scissors in metres, blades pointing forward (-Z). Each half is a blade on one side of the pivot and a
 * finger loop on the other, so opening the loops opens the blades.
 */
export function createScissors() {
  const blade = new Shape()
  blade.moveTo(0.0015, -0.006)
  blade.lineTo(-0.009, -0.008)
  blade.quadraticCurveTo(-0.0135, 0.035, -0.0075, 0.075)
  blade.quadraticCurveTo(-0.0035, 0.1, 0.0004, 0.108)
  blade.lineTo(0.0015, 0.0)
  blade.closePath()
  const bladeGeometry = flatPiece(blade, 0.0018, 0.0004)
  const loopGeometry = new TorusGeometry(0.016, 0.0048, 10, 28)
  loopGeometry.rotateX(Math.PI / 2)

  const half = (loopScale: number) => {
    const group = new Group()
    group.add(new Mesh(bladeGeometry, steel))
    group.add(rod(new Vector3(0.0015, 0.001, 0.004), new Vector3(0.012, 0.001, 0.034), 0.0042, orangeGrip))
    const loop = new Mesh(loopGeometry, orangeGrip)
    loop.position.set(0.019, 0.001, 0.05)
    loop.scale.set(loopScale, 1, 1.15)
    group.add(loop)
    return group
  }

  const left = half(1)
  left.position.y = 0.0004
  // The thumb loop is rounder than the finger loop.
  const right = half(0.8)
  right.scale.x = -1
  right.position.y = -0.0028
  const screw = new Mesh(new CylinderGeometry(0.004, 0.004, 0.008, 16), chrome)
  screw.position.y = -0.0005

  const body = new Group()
  body.add(left, right, screw)
  // Blades nearly level, pointing ahead and in toward the crosshair.
  body.rotation.set(0.05, 0.45, -0.2, 'YXZ')

  const holder = new Group()
  holder.add(body)
  const open = 0.42
  return {
    holder,
    rest: new Vector3(0.075, -0.068, -0.2),
    actionTime: SCISSORS.interval,
    animate(p: number) {
      const press = Math.sin(Math.PI * Math.min(1, p * 1.4))
      const angle = open * (1 - press) * 0.5
      left.rotation.y = angle
      right.rotation.y = -angle
      holder.position.z -= press * 0.025
      holder.position.y += press * 0.004
    },
  }
}

/** A sickle in metres: wooden handle toward you (+Z), crescent blade ahead curving to the left. */
export function createSickle() {
  // Outer and inner arcs of the crescent meet at the point.
  const blade = new Shape()
  blade.moveTo(0.006, -0.004)
  blade.absarc(-0.082, 0.07, 0.112, -0.67, 2.95, false)
  blade.absarc(-0.075, 0.062, 0.088, 2.88, -0.55, true)
  blade.closePath()
  const bladeGeometry = flatPiece(blade, 0.0018, 0.0006)

  const handle = new LatheGeometry(
    [
      [0, 0],
      [0.012, 0.001],
      [0.0155, 0.012],
      [0.0165, 0.05],
      [0.015, 0.1],
      [0.0125, 0.125],
      [0, 0.127],
    ].map(([r, y]) => new Vector2(r, y)),
    20,
  )
  handle.rotateX(Math.PI / 2)
  const handleMesh = new Mesh(handle, wood)
  handleMesh.position.z = 0.012
  const ferrule = new Mesh(new CylinderGeometry(0.0135, 0.0135, 0.016, 20), darkSteel)
  ferrule.rotation.x = Math.PI / 2
  ferrule.position.z = 0.008
  const tang = rod(new Vector3(0.004, 0.0009, 0.004), new Vector3(0.006, 0.0009, -0.012), 0.004, darkSteel)

  const sickle = new Group()
  sickle.add(new Mesh(bladeGeometry, steel), handleMesh, ferrule, tang)
  // The hand holds the far end of the handle; the swing pivots there.
  sickle.position.z = -0.135
  const grip = new Group()
  grip.add(sickle)

  const holder = new Group()
  holder.add(grip)
  return {
    holder,
    rest: new Vector3(0.14, -0.15, -0.26),
    actionTime: SICKLE.swing,
    animate(p: number) {
      const seconds = p * SICKLE.swing
      const cutEnd = SICKLE.swing * SICKLE.cutShare
      const cutting = seconds < cutEnd
      // 0 at rest on the right, 1 at the end of the cut on the left, then back.
      const back = Math.min(1, (seconds - cutEnd) / (SICKLE.swing - cutEnd))
      const across = cutting ? (1 - sickleSweep(seconds)) / 2 : 1 - back * back * (3 - 2 * back)
      const lift = cutting ? 0 : Math.sin(across * Math.PI)
      grip.rotation.set(0.1 + lift * 0.3, -0.35 + across * 1.25, -0.4, 'YXZ')
      holder.position.x -= across * 0.09
      holder.position.y += lift * 0.03 - (cutting ? Math.sin(across * Math.PI) * 0.02 : 0)
    },
  }
}

export type HandTool = ReturnType<typeof createClipper>
export type HandToolId = 'clipper' | 'scissors' | 'sickle'

/** Builds one of the tools you hold in your hand. Robots get their own copies. */
export const createHandTool = (id: HandToolId): HandTool =>
  id === 'clipper' ? createClipper() : id === 'scissors' ? createScissors() : createSickle()

/**
 * The tool in your hand, drawn in its own scene on top of the world so it never clips into grass.
 * The trimmer and the mowers live in the world instead, so with one of those out this scene is empty.
 */
export function createViewmodel(renderer: WebGLRenderer) {
  const scene = new Scene()
  // A neutral studio reflection reads as polished steel; the blue sky made it look like plastic.
  const pmrem = new PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture
  pmrem.dispose()
  const light = new DirectionalLight(SUN_COLOR, 3)
  light.position.copy(SUN_DIR)
  scene.add(light)

  const camera = new PerspectiveCamera(50, 1, 0.005, 2)

  const hands: Partial<Record<ToolId, HandTool>> = {
    clipper: createClipper(),
    scissors: createScissors(),
    sickle: createSickle(),
  }
  for (const tool of Object.values(hands)) scene.add(tool.holder)

  let current: ToolId = 'clipper'
  let shown: ToolId = 'clipper'
  let swappedAt = -Infinity
  let actionAt = -Infinity
  let swayX = 0
  let swayY = 0

  const showOnly = (id: ToolId) => {
    for (const [key, tool] of Object.entries(hands)) tool.holder.visible = key === id
  }
  showOnly(current)

  return {
    scene,
    camera,
    resize(aspect: number) {
      camera.aspect = aspect
      camera.updateProjectionMatrix()
    },
    /** Lowers the tool in hand and raises `id`. Pass a time in the past to switch without the animation. */
    setTool(id: ToolId, time: number) {
      if (id === current) return
      current = id
      swappedAt = time
    },
    /** Plays the snip or swing of the tool in hand. */
    use(time: number) {
      actionAt = time
    },
    setDaylight(day: number) {
      light.intensity = 3 * (0.12 + 0.88 * day)
      scene.environmentIntensity = 0.1 + 0.8 * day
    },
    /** bob: walking phase; lookX/lookY: mouse movement this frame, for a little lag. */
    update(time: number, dt: number, bob: number, lookX: number, lookY: number) {
      // Lower the old tool for the first half of a swap, raise the new one for the second.
      const swap = Math.min(1, (time - swappedAt) / SWAP_TIME)
      if (swap >= 0.5 && shown !== current) {
        shown = current
        showOnly(shown)
        actionAt = -Infinity
      }
      const lowered = Math.sin(Math.min(1, swap) * Math.PI)

      const follow = 1 - Math.exp(-dt * 10)
      swayX += (Math.max(-0.02, Math.min(0.02, -lookX * 0.00025)) - swayX) * follow
      swayY += (Math.max(-0.02, Math.min(0.02, lookY * 0.00025)) - swayY) * follow

      const tool = hands[shown]
      if (!tool) return
      tool.holder.position.set(
        tool.rest.x + swayX + Math.sin(bob) * 0.004,
        tool.rest.y + swayY - Math.abs(Math.cos(bob)) * 0.004 - lowered * 0.2,
        tool.rest.z,
      )
      tool.holder.rotation.z = Math.sin(time * 0.9) * 0.01
      tool.animate(Math.min(1, (time - actionAt) / tool.actionTime))
    },
  }
}

export type Viewmodel = ReturnType<typeof createViewmodel>
