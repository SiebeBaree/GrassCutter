import {
  AdditiveBlending,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three'
import { inMeadow, type Field, type Vec2 } from './field'
import type { Driver } from './mower'
import { UFO_GRASS } from './tools'

// Every night a flying saucer glides in, stops in the sky in front of you and shines its beam
// on the meadow. The grass under it turns purple and grows tall, and each of those blades pays well.
// Then it shoots off.

/** Metres along its path it starts and ends from where it hovers. */
const PATH = 320
/** Seconds to glide in and slow to a stop, to hover with the beam on, and to shoot off. */
const ARRIVE = 15
const HOVER = 14
const LEAVE = 5
/** Seconds into the hover the beam takes to reach the ground. */
const BEAM_LANDS = 1
const LIGHTS = 12

const hull = new MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.95, roughness: 0.22 })
// Its glowing belly and lights shine through the night haze.
const belly = new MeshBasicMaterial({ color: '#46e0b4', fog: false })
const dome = new MeshBasicMaterial({ color: '#8ff7d4', transparent: true, opacity: 0.85, fog: false })
const beamMaterial = new MeshBasicMaterial({ color: '#d2a8ff', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false })

function buildSaucer() {
  const saucer = new Group()
  const profile = [
    [0, -0.9],
    [2.2, -0.75],
    [4.6, -0.2],
    [5.2, 0],
    [4.6, 0.25],
    [2.6, 0.7],
    [0, 0.8],
  ].map(([r, y]) => new Vector2(r, y))
  saucer.add(new Mesh(new LatheGeometry(profile, 40), hull))
  const underside = new Mesh(new CylinderGeometry(1.6, 2.2, 0.35, 32), belly)
  underside.position.y = -0.95
  saucer.add(underside)
  const cockpit = new Mesh(new SphereGeometry(1.9, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), dome)
  cockpit.position.y = 0.65
  cockpit.scale.y = 0.75
  saucer.add(cockpit)

  const lights = Array.from({ length: LIGHTS }, (_, k) => {
    const light = new Mesh(new SphereGeometry(0.28, 10, 6), new MeshBasicMaterial({ color: '#ffd166', fog: false }))
    const a = (k / LIGHTS) * Math.PI * 2
    light.position.set(Math.cos(a) * 4.9, 0.02, Math.sin(a) * 4.9)
    saucer.add(light)
    return light
  })

  // A cone of light down to the ground while it hovers. Height is set per visit.
  const beam = new Mesh(new ConeGeometry(1, 1, 32, 1, true).translate(0, -0.5, 0), beamMaterial)
  beam.position.y = -1
  return { saucer, lights, beam }
}

type Visit = {
  start: number
  /** Where it hovers, and the unit direction it travels. */
  centre: Vector3
  dir: Vec2
  beamed: boolean
  zapped: boolean
}

/** What the UFO did this frame, for sound and for the grass under the beam. */
export type Sighting = {
  x: number
  z: number
  distance: number
  /** Metres per second it's closing on you, negative while it moves away. */
  closing: number
  /** True on the frame its beam reaches the ground. */
  beamed: boolean
  /** True on the frame it shoots off. */
  zapped: boolean
}

/** One UFO, reused for every visit. Call update() every frame; it decides when to come by itself. */
export function createUfo(field: Field, random = Math.random) {
  const { saucer, lights, beam } = buildSaucer()
  const group = new Group()
  group.add(saucer, beam)
  group.visible = false

  let visit: Visit | null = null
  /** When tonight's visit is due, or null once it has come (or it's day). */
  let dueAt: number | null = null
  let wasNight = false
  let lastTime = 0
  let lastDistance = 0

  /** Distance along the path from where it hovers, t seconds into the visit. */
  const along = (t: number) => {
    if (t < ARRIVE) return -PATH * (1 - t / ARRIVE) ** 2
    if (t < ARRIVE + HOVER) return 0
    return PATH * ((t - ARRIVE - HOVER) / LEAVE) ** 2
  }

  /** A spot over the meadow ahead of you, close enough to see without searching the sky. */
  function hoverSpot(viewer: Driver): Vec2 {
    for (let tries = 0; tries < 30; tries++) {
      const a = viewer.yaw + (random() - 0.5) * 1.4
      const d = 16 + random() * 18
      const x = viewer.x - Math.sin(a) * d
      const z = viewer.z - Math.cos(a) * d
      if (inMeadow(field, x, z, 3)) return { x, z }
    }
    // Out past the edge: towards the middle of the meadow.
    const d = Math.hypot(viewer.x, viewer.z) || 1
    return { x: viewer.x * (1 - Math.min(1, 25 / d)), z: viewer.z * (1 - Math.min(1, 25 / d)) }
  }

  function begin(time: number, viewer: Driver) {
    const heading = random() * Math.PI * 2
    const spot = hoverSpot(viewer)
    visit = { start: time, centre: new Vector3(spot.x, 26 + random() * 8, spot.z), dir: { x: Math.cos(heading), z: Math.sin(heading) }, beamed: false, zapped: false }
    group.visible = true
  }

  return {
    group,
    /** Sends one over right now. For the console. */
    summon(time: number, viewer: Driver) {
      begin(time, viewer)
    },
    /**
     * Moves the saucer. `night` is whether it's dark out; `active` whether the game is running. Returns
     * what it's doing, seen from `viewer`, or null while there's no UFO.
     */
    update(time: number, night: boolean, active: boolean, viewer: Driver): Sighting | null {
      const dt = Math.max(1e-3, time - lastTime)
      lastTime = time
      // Due somewhere in the first half of the night, so it's gone by dawn.
      if (night && !wasNight) dueAt = time + 10 + random() * 70
      if (!night) dueAt = null
      wasNight = night
      if (active && dueAt !== null && time >= dueAt && !visit) {
        dueAt = null
        begin(time, viewer)
      }
      if (!visit) return null

      const t = time - visit.start
      if (t > ARRIVE + HOVER + LEAVE) {
        visit = null
        group.visible = false
        return null
      }
      const s = along(t)
      const hovering = t >= ARRIVE - 1.5 && t < ARRIVE + HOVER
      const wobble = Math.sin(time * 1.3) * 0.4
      saucer.position.set(visit.centre.x + visit.dir.x * s, visit.centre.y + wobble, visit.centre.z + visit.dir.z * s)
      saucer.rotation.y += dt * (hovering ? 1.6 : 0.7)
      // Banks into the slow-down, sits level while hovering, tips forward as it leaves.
      saucer.rotation.z = t < ARRIVE ? 0.12 * (1 - t / ARRIVE) : t < ARRIVE + HOVER ? Math.sin(time * 2.1) * 0.03 : -0.18
      for (const [k, light] of lights.entries()) light.material.color.setHSL(((k + time * 6) % LIGHTS) / LIGHTS < 0.25 ? 0.1 : 0.9, 1, 0.5)

      // The beam drops to the ground, holds, and pulls back up just before it leaves.
      const down = Math.max(0, Math.min(1, (t - ARRIVE) / BEAM_LANDS))
      const up = Math.max(0, Math.min(1, (ARRIVE + HOVER - t) / 0.6))
      const reach = Math.min(down, up)
      beamMaterial.opacity = 0.22 * reach
      beam.visible = reach > 0
      const width = UFO_GRASS.radius * 1.3
      beam.position.set(saucer.position.x, saucer.position.y - 1, saucer.position.z)
      beam.scale.set(width, (saucer.position.y - 1) * reach, width)

      const dx = saucer.position.x - viewer.x
      const dz = saucer.position.z - viewer.z
      const distance = Math.hypot(dx, dz, saucer.position.y - 1.7)
      const closing = t < 0.05 ? 0 : (lastDistance - distance) / dt
      lastDistance = distance
      const beamed = !visit.beamed && down >= 1
      if (beamed) visit.beamed = true
      const zapped = !visit.zapped && t >= ARRIVE + HOVER
      if (zapped) visit.zapped = true
      return { x: saucer.position.x, z: saucer.position.z, distance, closing, beamed, zapped }
    },
  }
}

export type Ufo = ReturnType<typeof createUfo>
