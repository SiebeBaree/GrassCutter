import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Shape,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { bake } from './bake'
import type { Vec2 } from './field'
import { blackPlastic, engineGrey, tube, tubeMetal, wheel, type Driver } from './mower'
import { RIDER } from './tools'

/** Seated eye height. High enough to see over the meadow. */
export const RIDER_EYE = 1.86

const gloss = new MeshStandardMaterial({ color: '#0e0f12', metalness: 0.55, roughness: 0.2 })
const chrome = new MeshStandardMaterial({ color: '#e4e8ee', metalness: 1, roughness: 0.12 })
const red = new MeshStandardMaterial({ color: '#d42a1c', metalness: 0.3, roughness: 0.35 })
const lamp = new MeshStandardMaterial({ color: '#fff6d8', emissive: '#fff1c2', emissiveIntensity: 1.6, roughness: 0.3 })
const flameOuter = new MeshBasicMaterial({ color: '#ff4d0a', transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false })
const flameInner = new MeshBasicMaterial({ color: '#ffb340', transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false })

// The hood's side profile: a wedge rising from the nose to the dashboard.
const NOSE = -1.64
const COWL = -0.62
const NOSE_TOP = 0.54
const COWL_TOP = 0.8
const HOOD_BOTTOM = 0.34
const HOOD_HALF = 0.35
const HOOD_BEVEL = 0.035

let flameDecal: MeshStandardMaterial | null = null

/** Hot-rod flames painted on a transparent canvas: solid at the left (the nose), licking off to the right. */
function paintedFlames() {
  if (flameDecal) return flameDecal
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const W = canvas.width
    const H = canvas.height
    // Each lick: centre height and how far it reaches, as shares of the canvas.
    const licks = [
      { y: 0.14, reach: 0.9 },
      { y: 0.34, reach: 0.64 },
      { y: 0.53, reach: 0.97 },
      { y: 0.72, reach: 0.58 },
      { y: 0.88, reach: 0.78 },
    ]
    ctx.beginPath()
    ctx.moveTo(0, H * 0.03)
    licks.forEach((l, k) => {
      const next = licks[k + 1]?.y ?? 1.05
      const valley = (l.y + next) / 2
      const tipX = W * l.reach
      const tipY = H * (l.y - 0.09)
      ctx.bezierCurveTo(W * l.reach * 0.4, H * (l.y - 0.13), W * l.reach * 0.82, H * (l.y - 0.02), tipX, tipY)
      ctx.bezierCurveTo(W * l.reach * 0.78, H * (l.y + 0.08), W * l.reach * 0.45, H * valley, W * (0.22 + (k % 2) * 0.08), H * Math.min(0.97, valley))
    })
    ctx.lineTo(0, H * 0.97)
    ctx.closePath()
    const fill = ctx.createLinearGradient(0, 0, W, 0)
    fill.addColorStop(0, '#fff6b0')
    fill.addColorStop(0.22, '#ffd02e')
    fill.addColorStop(0.5, '#ff8a1c')
    fill.addColorStop(0.78, '#e8361c')
    fill.addColorStop(1, '#b0170f')
    ctx.fillStyle = fill
    ctx.fill()
    ctx.lineWidth = 7
    ctx.strokeStyle = '#6e0f08'
    ctx.stroke()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  flameDecal = new MeshStandardMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.05,
    metalness: 0.3,
    roughness: 0.25,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  })
  return flameDecal
}

function box(w: number, h: number, d: number, radius: number, material: MeshStandardMaterial, x: number, y: number, z: number) {
  const mesh = new Mesh(radius > 0 ? new RoundedBoxGeometry(w, h, d, 3, radius) : new BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  return mesh
}

/** The hood: the side profile extruded across its width, with bevelled edges. */
function hood() {
  // Drawn with x running backward along the mower (x = -z), then turned into place.
  const profile = new Shape()
  profile.moveTo(-NOSE + 0.04, HOOD_BOTTOM)
  profile.lineTo(-NOSE, NOSE_TOP)
  profile.lineTo(-COWL, COWL_TOP)
  profile.lineTo(-COWL, HOOD_BOTTOM)
  profile.closePath()
  const geometry = new ExtrudeGeometry(profile, {
    depth: HOOD_HALF * 2,
    bevelEnabled: true,
    bevelThickness: HOOD_BEVEL,
    bevelSize: HOOD_BEVEL,
    bevelSegments: 3,
  })
  geometry.translate(0, 0, -HOOD_HALF)
  geometry.rotateY(Math.PI / 2)
  return new Mesh(geometry, gloss)
}

/** Flips a plane's texture left to right, for decals seen from the mirrored side. */
function mirrorU(geometry: BufferGeometry) {
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i))
  return geometry
}

/** Flame decals on the hood: one over the top, one down each side, all starting at the nose. */
function flames() {
  const decal = paintedFlames()
  const group = new Group()
  const slope = Math.atan2(COWL_TOP - NOSE_TOP, COWL - NOSE)
  const length = 0.95
  // u runs from the nose back; the plane lies on the sloping top, just above the paint.
  const top = new PlaneGeometry(length, HOOD_HALF * 1.8).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2).rotateX(-slope)
  const along = 0.05 + length / 2
  const topMesh = new Mesh(top, decal)
  topMesh.position.set(0, NOSE_TOP + HOOD_BEVEL / Math.cos(slope) + Math.sin(slope) * along + 0.002, NOSE + Math.cos(slope) * along)
  group.add(topMesh)
  for (const side of [-1, 1]) {
    const plane = new PlaneGeometry(0.98, 0.26).rotateY(side * (Math.PI / 2))
    const mesh = new Mesh(side > 0 ? mirrorU(plane) : plane, decal)
    mesh.position.set(side * (HOOD_HALF + HOOD_BEVEL + 0.002), 0.47, NOSE + 0.06 + 0.49)
    group.add(mesh)
  }
  return group
}

/** A supercharger poking up through the hood: a finned chrome case with a black scoop on top. */
function blower() {
  const group = new Group()
  const y = NOSE_TOP + (COWL_TOP - NOSE_TOP) * 0.4 + HOOD_BEVEL
  const z = NOSE + (COWL - NOSE) * 0.4
  group.add(box(0.24, 0.12, 0.3, 0.02, chrome, 0, y + 0.05, z))
  for (let k = -2; k <= 2; k++) group.add(box(0.26, 0.012, 0.012, 0, chrome, 0, y + 0.08, z + k * 0.055))
  const scoop = box(0.2, 0.09, 0.22, 0.025, blackPlastic, 0, y + 0.15, z - 0.02)
  scoop.rotation.x = 0.12
  group.add(scoop, box(0.16, 0.05, 0.01, 0, engineGrey, 0, y + 0.15, z - 0.13))
  return group
}

const UP = new Vector3(0, 1, 0)

/**
 * A racing riding mower in metres, facing -Z, with its origin on the ground under the driver: gloss black
 * with flames down the hood, a blower, chrome headers either side that spit fire when you floor it, a
 * bucket seat and a rear wing. The deck hangs between the wheels RIDER.ahead metres in front of the seat.
 */
export function createRider() {
  const frame = new Group()
  frame.add(
    // Chassis and footboard.
    box(0.62, 0.1, 1.9, 0, tubeMetal, 0, 0.3, -0.45),
    box(0.85, 0.04, 0.6, 0, tubeMetal, 0, 0.42, -0.36),
    // The body over the rear axle, its fenders with a red pinstripe.
    box(0.95, 0.28, 0.78, 0.07, gloss, 0, 0.6, 0.33),
    box(0.32, 0.07, 0.86, 0.03, gloss, -0.6, 0.77, 0.36),
    box(0.32, 0.07, 0.86, 0.03, gloss, 0.6, 0.77, 0.36),
    box(0.012, 0.03, 0.8, 0, red, -0.765, 0.77, 0.36),
    box(0.012, 0.03, 0.8, 0, red, 0.765, 0.77, 0.36),
    // Bucket seat on a post, red bolsters either side.
    box(0.3, 0.18, 0.3, 0, engineGrey, 0, 0.74, 0.12),
    box(0.5, 0.1, 0.46, 0.04, blackPlastic, 0, 0.87, 0.12),
    box(0.07, 0.12, 0.42, 0.03, red, -0.27, 0.93, 0.12),
    box(0.07, 0.12, 0.42, 0.03, red, 0.27, 0.93, 0.12),
    hood(),
    flames(),
    blower(),
    // Chrome grille and bumper, and the dashboard behind the hood.
    box(0.46, 0.16, 0.03, 0.01, chrome, 0, 0.44, NOSE - 0.07),
    box(0.82, 0.05, 0.06, 0.02, chrome, 0, 0.34, NOSE - 0.12),
    box(0.38, 0.32, 0.22, 0.05, gloss, 0, 0.73, -0.55),
    // The deck under the belly, its skirt and the chute on the right.
    box(RIDER.halfWidth * 2, 0.13, RIDER.halfLength * 2, 0.05, engineGrey, 0, 0.18, -RIDER.ahead),
    box(RIDER.halfWidth * 2 + 0.04, 0.05, RIDER.halfLength * 2 + 0.04, 0.02, blackPlastic, 0, 0.1, -RIDER.ahead),
    tube(new Vector3(0, 0.85, -0.55), new Vector3(0, 1.08, -0.4), 0.022, chrome),
  )
  const backrest = box(0.5, 0.5, 0.09, 0.04, blackPlastic, 0, 1.14, 0.37)
  backrest.rotation.x = 0.2
  const chute = box(0.24, 0.1, 0.36, 0.03, blackPlastic, RIDER.halfWidth + 0.08, 0.17, -RIDER.ahead)
  chute.rotation.z = -0.22
  frame.add(backrest, chute)
  for (const side of [-1, 1]) {
    const light = new Mesh(new CylinderGeometry(0.045, 0.045, 0.02, 16), lamp)
    light.rotation.x = Math.PI / 2
    light.position.set(side * 0.29, 0.46, NOSE - 0.08)
    const bolster = box(0.07, 0.4, 0.1, 0.03, red, side * 0.27, 1.12, 0.38)
    bolster.rotation.x = 0.2
    frame.add(light, bolster)
    // Rear wing: struts up from the body, a red blade across and black end plates.
    frame.add(tube(new Vector3(side * 0.38, 0.72, 0.62), new Vector3(side * 0.38, 1.12, 0.72), 0.018, chrome))
    frame.add(box(0.025, 0.2, 0.36, 0.01, gloss, side * 0.6, 1.14, 0.74))
  }
  const wing = box(1.18, 0.035, 0.3, 0.012, red, 0, 1.15, 0.74)
  wing.rotation.x = -0.12
  frame.add(wing)

  // Three headers each side, angled up, out and back. Flames come out of their open ends.
  const exhausts: { at: Vector3; dir: Vector3 }[] = []
  for (const side of [-1, 1]) {
    for (const [k, z] of [-1.28, -1.12, -0.96].entries()) {
      const from = new Vector3(side * (HOOD_HALF + HOOD_BEVEL), 0.46 + k * 0.025, z)
      const dir = new Vector3(side * 0.62, 0.62, 0.48).normalize()
      const end = from.clone().addScaledVector(dir, 0.2)
      frame.add(tube(from, end, 0.026, chrome))
      const lip = new Mesh(new TorusGeometry(0.028, 0.008, 6, 14), chrome)
      lip.position.copy(end)
      lip.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), dir)
      frame.add(lip)
      exhausts.push({ at: end, dir })
    }
  }

  const body = new Group()
  body.add(bake(frame))

  // Each flame is two cones, base at the pipe, stretched along it by how hard you're driving.
  const flameCone = new ConeGeometry(0.055, 1, 10, 1, true).translate(0, 0.5, 0)
  const flameCore = new ConeGeometry(0.03, 0.55, 8, 1, true).translate(0, 0.275, 0)
  const fire = exhausts.map(({ at, dir }) => {
    const flame = new Group()
    flame.position.copy(at)
    flame.quaternion.copy(new Quaternion().setFromUnitVectors(UP, dir))
    flame.add(new Mesh(flameCone, flameOuter), new Mesh(flameCore, flameInner))
    flame.visible = false
    body.add(flame)
    return flame
  })

  // The steering wheel turns about its own column.
  const steering = new Group()
  steering.position.set(0, 1.1, -0.39)
  steering.rotation.x = -0.95
  const rim = new Mesh(new TorusGeometry(0.17, 0.018, 8, 28), blackPlastic)
  const spokes = new Mesh(new BoxGeometry(0.32, 0.025, 0.012), chrome)
  const cap = new Mesh(new CylinderGeometry(0.04, 0.04, 0.03, 16), red)
  cap.rotation.x = Math.PI / 2
  const wheelSpin = new Group()
  wheelSpin.add(rim, spokes, cap)
  steering.add(wheelSpin)
  body.add(steering)

  // Fat slicks at the back.
  const wheels = [
    { x: -0.62, z: 0.36, r: 0.35, w: 0.3 },
    { x: 0.62, z: 0.36, r: 0.35, w: 0.3 },
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
  let lastTime = 0
  let speed = 0
  let flare = 0

  return {
    group,
    /** Deck centre in world space, valid after update(). */
    centre,
    /** Unit vector the mower faces, valid after update(). */
    forward,
    show(visible: boolean) {
      group.visible = visible
    },
    /**
     * Follows its driver. `steer` from -1 (left) to 1 turns the wheel; `running` adds engine shake and
     * lets the headers spit fire at speed, most of all as you speed up.
     */
    update(driver: Driver, time: number, running: boolean, steer: number) {
      forward.x = -Math.sin(driver.yaw)
      forward.z = -Math.cos(driver.yaw)
      const rolled = (driver.x - last.x) * forward.x + (driver.z - last.z) * forward.z
      if (Math.abs(rolled) < 1) for (const w of wheels) w.spin.rotation.x -= rolled / w.radius
      last.set(driver.x, 0, driver.z)
      centre.set(driver.x + forward.x * RIDER.ahead, 0, driver.z + forward.z * RIDER.ahead)

      const dt = time - lastTime
      lastTime = time
      if (dt > 0 && dt < 0.25 && Math.abs(rolled) < 1) {
        const now = rolled / dt
        const speedingUp = Math.max(0, now - speed) / dt
        speed += (now - speed) * Math.min(1, dt * 8)
        const want = running ? Math.min(1, Math.max(0, speed / RIDER.speed - 0.45) * 1.2 + speedingUp * 0.12) : 0
        flare += (want - flare) * Math.min(1, dt * (want > flare ? 14 : 5))
      }
      for (const flame of fire) {
        flame.visible = flare > 0.04
        if (flame.visible) flame.scale.set(0.7 + flare * 0.4, (0.08 + flare * 0.26) * (0.6 + Math.random() * 0.8), 0.7 + flare * 0.4)
      }

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
