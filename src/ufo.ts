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
import type { Vec2 } from './field'

// Now and then, on a dark night, a flying saucer drifts in over the meadow, hangs there for a moment
// with its beam on and shoots off. It never touches anything; it's only there to be seen and heard.

/** Chance that a night gets a visit. */
const VISIT_CHANCE = 0.5
/** Metres along its path it starts and ends from the point nearest you. */
const PATH = 360
/** Seconds to glide in and slow to a stop, to hover, and to shoot off. */
const ARRIVE = 18
const HOVER = 4
const LEAVE = 5
const LIGHTS = 12

const hull = new MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.95, roughness: 0.22 })
// Its glowing belly and lights shine through the night haze.
const belly = new MeshBasicMaterial({ color: '#46e0b4', fog: false })
const dome = new MeshBasicMaterial({ color: '#8ff7d4', transparent: true, opacity: 0.85, fog: false })
const beamMaterial = new MeshBasicMaterial({ color: '#b6ffe6', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false })

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
  /** Point on its path nearest the viewer, and the unit direction of travel. */
  centre: Vector3
  dir: Vec2
  zapped: boolean
}

/** One UFO, reused for every visit. Call update() every frame; it decides when to come by itself. */
export function createUfo(random = Math.random) {
  const { saucer, lights, beam } = buildSaucer()
  const group = new Group()
  group.add(saucer, beam)
  group.visible = false

  let visit: Visit | null = null
  /** When the next visit is due, or null if tonight has none (or it's day). */
  let dueAt: number | null = null
  let wasNight = false
  let lastTime = 0
  let lastDistance = 0

  /** Distance along the path from the point nearest you, t seconds into the visit. */
  const along = (t: number) => {
    if (t < ARRIVE) return -PATH * (1 - t / ARRIVE) ** 2
    if (t < ARRIVE + HOVER) return 0
    return PATH * ((t - ARRIVE - HOVER) / LEAVE) ** 2
  }

  function begin(time: number, viewer: Vec2) {
    const heading = random() * Math.PI * 2
    const dir = { x: Math.cos(heading), z: Math.sin(heading) }
    // Pass to one side of you, high enough to clear the trees.
    const side = (random() < 0.5 ? -1 : 1) * (18 + random() * 30)
    const centre = new Vector3(viewer.x - dir.z * side, 38 + random() * 18, viewer.z + dir.x * side)
    visit = { start: time, centre, dir, zapped: false }
    beam.scale.set(0, centre.y, 0)
    group.visible = true
  }

  return {
    group,
    /** Sends one over right now. For the console. */
    summon(time: number, viewer: Vec2) {
      begin(time, viewer)
    },
    /**
     * Moves the saucer. `night` is whether it's dark out; `active` whether the game is running. Returns
     * where it is and how fast it's closing on `viewer` (m/s, negative when leaving), or null when gone.
     * `zap` is true on the frame it shoots off.
     */
    update(time: number, night: boolean, active: boolean, viewer: Vec2) {
      const dt = Math.max(1e-3, time - lastTime)
      lastTime = time
      if (night && !wasNight) dueAt = random() < VISIT_CHANCE ? time + 15 + random() * 110 : null
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
      const wobble = Math.sin(time * 1.3) * 0.6
      saucer.position.set(visit.centre.x + visit.dir.x * s, visit.centre.y + wobble, visit.centre.z + visit.dir.z * s)
      saucer.rotation.y += dt * (hovering ? 1.6 : 0.7)
      // Banks into the slow-down, sits level while hovering, tips forward as it leaves.
      saucer.rotation.z = t < ARRIVE ? 0.12 * (1 - t / ARRIVE) : t < ARRIVE + HOVER ? Math.sin(time * 2.1) * 0.03 : -0.18
      for (const [k, light] of lights.entries()) light.material.color.setHSL(((k + time * 6) % LIGHTS) / LIGHTS < 0.25 ? 0.1 : 0.9, 1, 0.5)

      const beamOn = Math.max(0, Math.min(1, (t - (ARRIVE - 0.5)) / 0.6, (ARRIVE + HOVER - 0.3 - t) / 0.4))
      beamMaterial.opacity = beamOn * 0.16
      beam.visible = beamOn > 0
      beam.position.set(saucer.position.x, saucer.position.y - 1, saucer.position.z)
      beam.scale.set(4 * beamOn, saucer.position.y, 4 * beamOn)

      const dx = saucer.position.x - viewer.x
      const dz = saucer.position.z - viewer.z
      const distance = Math.hypot(dx, dz, saucer.position.y - 1.7)
      const closing = t < 0.05 ? 0 : (lastDistance - distance) / dt
      lastDistance = distance
      const zap = !visit.zapped && t >= ARRIVE + HOVER
      if (zap) visit.zapped = true
      return { x: saucer.position.x, z: saucer.position.z, distance, closing, zap }
    },
  }
}

export type Ufo = ReturnType<typeof createUfo>
