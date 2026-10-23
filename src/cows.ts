import { ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { bake } from './bake'
import { CHUNK, CHUNKS, forEachStandingNear, inMeadow, MAP_HALF, type Field, type Growth, type Vec2 } from './field'
import type { Grass } from './grass'
import { SPAWN } from './layout'
import type { CowSave } from './save'
import type { Sunflowers } from './sunflowers'

// Two cows graze the meadow. They amble from patch to patch eating a blade every few seconds, and every
// few minutes one of them leaves a pat behind. Every cut blade around it sprouts again and a sunflower
// comes up in the middle. They're solid: you walk and drive around them.

/** Seconds per blade while grazing: fifteen a minute. */
const BITE_SECONDS = 4
/** Seconds of play between one cow's pats, at least and at most. */
const PAT_SECONDS = [180, 320] as const
/** Cut grass within this many metres of a pat sprouts again. */
const PAT_RADIUS = 2.2
/** Seconds a pat lies in the grass before it sinks away. */
const PAT_LIFE = 150
const WALK_SPEED = 0.75
const TURN_RATE = 1.1
/** Mouth and rump, metres ahead of and behind the cow's middle. You bump into a capsule BODY_HALF either side of the middle. */
const MOUTH = 1.15
const RUMP = 0.85
const BODY_RADIUS = 0.42
const BODY_HALF = 0.5
/** You get this close and a grazing cow wanders off. */
const PERSONAL_SPACE = 2.4
/** How far ahead a cow looks for its next mouthful. */
const LOOK_AROUND = 10
/** How the cows bend the grass around them. */
const PUSH = { radius: 1.1, strength: 0.42 }

const hide = new MeshStandardMaterial({ color: '#f1ede4', roughness: 0.85 })
const spots = new MeshStandardMaterial({ color: '#1d1c1f', roughness: 0.8 })
const pink = new MeshStandardMaterial({ color: '#e9a3a0', roughness: 0.7 })
const hoof = new MeshStandardMaterial({ color: '#3a2c22', roughness: 0.8 })
const horn = new MeshStandardMaterial({ color: '#efe5c8', roughness: 0.5 })
const dung = new MeshStandardMaterial({ color: '#4f3418', roughness: 0.55, metalness: 0.05 })

function box(w: number, h: number, d: number, r: number, material: MeshStandardMaterial, x: number, y: number, z: number) {
  const mesh = new Mesh(new RoundedBoxGeometry(w, h, d, 3, r), material)
  mesh.position.set(x, y, z)
  return mesh
}

function blob(rx: number, ry: number, rz: number, material: MeshStandardMaterial, x: number, y: number, z: number) {
  const mesh = new Mesh(new SphereGeometry(1, 14, 10), material)
  mesh.scale.set(rx, ry, rz)
  mesh.position.set(x, y, z)
  return mesh
}

/** A Holstein about 1.35 m at the shoulder, facing -Z, origin on the ground under its middle. */
function buildCow(seed: number) {
  const torso = new Group()
  torso.add(box(0.72, 0.68, 1.62, 0.22, hide, 0, 1.0, 0))
  // Black patches painted on the hide: flat blobs just proud of each side and the back. Each cow gets its own.
  const patches = [
    [1, 1.08, -0.3, 0.3, 0.24],
    [-1, 0.96, 0.25, 0.34, 0.22],
    [1, 0.9, 0.45, 0.2, 0.16],
    [-1, 1.14, -0.45, 0.2, 0.17],
  ]
  for (const [k, [side, y, z, rz, ry]] of patches.entries()) {
    const flip = seed && k % 2 ? -1 : 1
    torso.add(blob(0.03, ry, rz, spots, side * flip * 0.35, y, z * (seed ? -1 : 1)))
  }
  torso.add(blob(0.24, 0.03, 0.28, spots, 0.05, 1.335, seed ? -0.3 : 0.32))
  torso.add(blob(0.17, 0.1, 0.19, pink, 0, 0.66, 0.42))
  const body = bake(torso)

  const legs = [
    [-0.22, -0.56],
    [0.22, -0.56],
    [-0.22, 0.6],
    [0.22, 0.6],
  ].map(([x, z]) => {
    const hip = new Group()
    hip.position.set(x, 0.78, z)
    const parts = new Group()
    parts.add(new Mesh(new CylinderGeometry(0.1, 0.075, 0.7, 10).translate(0, -0.35, 0), hide))
    parts.add(new Mesh(new CylinderGeometry(0.078, 0.085, 0.1, 10).translate(0, -0.73, 0), hoof))
    hip.add(bake(parts))
    return hip
  })

  // The head hangs from the neck; lowering the neck brings the mouth down to the grass.
  const neck = new Group()
  neck.position.set(0, 1.18, -0.78)
  const headParts = new Group()
  headParts.add(
    box(0.36, 0.36, 0.48, 0.12, hide, 0, -0.02, -0.3),
    box(0.33, 0.24, 0.2, 0.09, pink, 0, -0.1, -0.56),
    blob(0.13, 0.12, 0.14, spots, 0.1, 0.08, -0.32),
    blob(0.035, 0.035, 0.035, spots, -0.17, 0.05, -0.4),
    blob(0.035, 0.035, 0.035, spots, 0.17, 0.05, -0.4),
  )
  for (const side of [-1, 1]) {
    const ear = box(0.2, 0.05, 0.12, 0.02, hide, side * 0.26, 0.05, -0.18)
    ear.rotation.z = side * -0.3
    const tip = new Mesh(new ConeGeometry(0.03, 0.12, 8), horn)
    tip.position.set(side * 0.13, 0.2, -0.22)
    tip.rotation.z = side * -0.5
    headParts.add(ear, tip)
  }
  const head = bake(headParts)
  neck.add(head)

  const tail = new Group()
  tail.position.set(0, 1.24, 0.82)
  const tailParts = new Group()
  tailParts.add(new Mesh(new CylinderGeometry(0.02, 0.02, 0.62, 6).translate(0, -0.31, 0), hide))
  tailParts.add(blob(0.05, 0.09, 0.05, spots, 0, -0.66, 0))
  tail.add(bake(tailParts))

  const group = new Group()
  group.add(body, neck, tail, ...legs)
  return { group, body, neck, tail, legs }
}

/** A cartoon cow pat: a swirl of three rings and a tip. */
function buildPat() {
  const parts = new Group()
  for (const [k, r] of [0.2, 0.15, 0.1].entries()) {
    const ring = new Mesh(new TorusGeometry(r, 0.06 - k * 0.01, 8, 18), dung)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.05 + k * 0.08
    parts.add(ring)
  }
  parts.add(blob(0.07, 0.07, 0.07, dung, 0, 0.27, 0))
  parts.add(blob(0.17, 0.05, 0.17, dung, 0, 0.04, 0))
  return bake(parts)
}

type Mode = 'walk' | 'graze' | 'stand'

type Cow = {
  state: CowSave
  model: ReturnType<typeof buildCow>
  mode: Mode
  target: Vec2 | null
  /** When the current mode ends on its own. */
  until: number
  nextBite: number
  /** Seconds of play until its next pat. */
  untilPat: number
  nextMoo: number
  speed: number
  stride: number
  bite: number
}

type Pat = { mesh: Group; at: number }

type Hooks = {
  /** A cow left a pat at (x, z); `sprouted` blades came back around it. */
  onPat: (x: number, z: number, sprouted: number) => void
  onMoo: (x: number, z: number) => void
}

/** Where a new herd starts: out in the meadow, in view from where you start. One cow each. */
const STARTS: CowSave[] = [
  { x: SPAWN.x - 9, z: SPAWN.z - 32, yaw: 0.6 },
  { x: SPAWN.x + 10, z: SPAWN.z - 40, yaw: -2.2 },
]

/** The cows. Pass their saved spots, or an empty list for a new herd. */
export function createCows(field: Field, growth: Growth, grass: Grass, sunflowers: Sunflowers, saved: CowSave[], hooks: Hooks, random = Math.random) {
  const group = new Group()
  const states = STARTS.map((start, k) => {
    const s = saved[k]
    return s && Number.isFinite(s.x + s.z + s.yaw) && inMeadow(field, s.x, s.z, 1) ? { ...s } : { ...start }
  })
  const cows: Cow[] = states.map((state, k) => {
    const model = buildCow(k)
    group.add(model.group)
    return { state, model, mode: 'graze', target: null, until: 0, nextBite: 0, untilPat: PAT_SECONDS[0] * (0.4 + random() * 0.6), nextMoo: 8 + random() * 30, speed: 0, stride: 0, bite: 0 }
  })

  const pats: Pat[] = []
  const patModel = buildPat()

  const forward = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) })
  const mouthOf = (c: Cow) => {
    const f = forward(c.state.yaw)
    return { x: c.state.x + f.x * MOUTH, z: c.state.z + f.z * MOUTH }
  }

  /** A standing blade within r of (x, z), or -1. */
  const standingNear = (x: number, z: number, r: number) => {
    let found = -1
    forEachStandingNear(field, growth, x, z, r, (i) => (found = i))
    return found
  }

  /** Somewhere to graze next: grass a few steps away if there is any, else the nearest patch left, else anywhere. */
  function pickTarget(c: Cow, away: Vec2 | null) {
    const { x, z } = c.state
    for (let tries = 0; tries < 30; tries++) {
      let a = random() * Math.PI * 2
      if (away) a = Math.atan2(z - away.z, x - away.x) + (random() - 0.5) * 1.6
      const d = 2.5 + random() * LOOK_AROUND
      const tx = x + Math.cos(a) * d
      const tz = z + Math.sin(a) * d
      if (!inMeadow(field, tx, tz, 2)) continue
      const i = standingNear(tx, tz, 1)
      if (i >= 0 || away) return { x: tx, z: tz }
    }
    let best: Vec2 | null = null
    let bestD = Infinity
    for (let k = 0; k < CHUNKS * CHUNKS; k++) {
      if (grass.chunkStanding[k] === 0) continue
      const cx = ((k % CHUNKS) + 0.5) * CHUNK - MAP_HALF
      const cz = (Math.floor(k / CHUNKS) + 0.5) * CHUNK - MAP_HALF
      const d = Math.hypot(cx - x, cz - z)
      if (d < bestD && inMeadow(field, cx, cz, 2)) {
        bestD = d
        best = { x: cx, z: cz }
      }
    }
    if (best) return best
    const a = random() * Math.PI * 2
    const d = random() * 60
    return { x: Math.cos(a) * d, z: Math.sin(a) * d }
  }

  function walkTo(c: Cow, time: number, to: Vec2) {
    c.mode = 'walk'
    c.target = to
    c.until = time + 40
  }

  /** Turns toward the target and plods on. Returns the distance left from the mouth. */
  function plod(c: Cow, dt: number) {
    const s = c.state
    const t = c.target
    if (!t) return 0
    const m = mouthOf(c)
    const dx = t.x - s.x
    const dz = t.z - s.z
    let err = Math.atan2(-dx, -dz) - s.yaw
    err = Math.atan2(Math.sin(err), Math.cos(err))
    s.yaw += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, err))
    const left = Math.hypot(t.x - m.x, t.z - m.z)
    const goal = WALK_SPEED * Math.max(0.15, Math.cos(err)) * Math.min(1, left / 0.8)
    c.speed += (goal - c.speed) * Math.min(1, dt * 2)
    const f = forward(s.yaw)
    s.x += f.x * c.speed * dt
    s.z += f.z * c.speed * dt
    return left
  }

  function dropPat(c: Cow, time: number) {
    const f = forward(c.state.yaw)
    const x = c.state.x - f.x * RUMP
    const z = c.state.z - f.z * RUMP
    if (!inMeadow(field, x, z, 0.5)) return
    const sprouted = grass.sproutAround(x, z, PAT_RADIUS)
    sunflowers.plantAt({ x, z })
    const mesh = patModel.clone()
    mesh.position.set(x, 0, z)
    mesh.rotation.y = random() * Math.PI * 2
    group.add(mesh)
    pats.push({ mesh, at: time })
    hooks.onPat(x, z, sprouted)
  }

  function think(c: Cow, time: number, dt: number, player: Vec2) {
    const s = c.state
    const crowded = Math.hypot(player.x - s.x, player.z - s.z) < PERSONAL_SPACE
    if (crowded && c.mode !== 'walk') walkTo(c, time, pickTarget(c, player))

    if (c.mode === 'walk') {
      const left = plod(c, dt)
      if (left < 0.4 || time > c.until) {
        c.mode = 'graze'
        c.until = time + 20 + random() * 40
        c.nextBite = time + 1
      }
    } else {
      c.speed *= Math.max(0, 1 - dt * 4)
      if (c.mode === 'graze' && time >= c.nextBite) {
        c.nextBite = time + BITE_SECONDS * (0.8 + random() * 0.4)
        const m = mouthOf(c)
        const i = standingNear(m.x, m.z, 0.7)
        if (i >= 0 && grass.cut(i)) c.bite = time
        else c.until = Math.min(c.until, time + 2)
      }
      if (time > c.until) {
        if (c.mode === 'graze' && random() < 0.25) {
          c.mode = 'stand'
          c.until = time + 5 + random() * 8
        } else walkTo(c, time, pickTarget(c, null))
      }
    }

    c.untilPat -= dt
    if (c.untilPat <= 0) {
      c.untilPat = PAT_SECONDS[0] + random() * (PAT_SECONDS[1] - PAT_SECONDS[0])
      dropPat(c, time)
    }
    if (time >= c.nextMoo) {
      c.nextMoo = time + 25 + random() * 60
      hooks.onMoo(s.x, s.z)
    }
  }

  /** Cows step apart rather than through each other, and stay in the meadow. */
  function separate() {
    for (const a of cows) {
      for (const b of cows) {
        if (a === b) continue
        const dx = a.state.x - b.state.x
        const dz = a.state.z - b.state.z
        const d = Math.hypot(dx, dz)
        if (d < 1.8 && d > 1e-4) {
          a.state.x += (dx / d) * (1.8 - d) * 0.5
          a.state.z += (dz / d) * (1.8 - d) * 0.5
        }
      }
      if (!inMeadow(field, a.state.x, a.state.z, 1)) {
        const r = Math.hypot(a.state.x, a.state.z)
        a.state.x *= 1 - 0.5 / r
        a.state.z *= 1 - 0.5 / r
      }
    }
  }

  function animate(c: Cow, time: number, dt: number) {
    const { model, state: s } = c
    model.group.position.set(s.x, 0, s.z)
    model.group.rotation.y = s.yaw
    c.stride += c.speed * dt * 4.2
    const swing = Math.sin(c.stride) * 0.38 * Math.min(1, c.speed / 0.3)
    model.legs.forEach((leg, k) => (leg.rotation.x = (k === 0 || k === 3 ? 1 : -1) * swing))
    model.body.position.y = Math.abs(Math.sin(c.stride)) * 0.02
    // Head down to the grass while grazing, chewing; up and looking about otherwise.
    const down = c.mode === 'graze' ? 1.05 : c.mode === 'walk' ? 0.25 : 0.05
    model.neck.rotation.x += (-down - model.neck.rotation.x) * Math.min(1, dt * 2.5)
    const chew = c.mode === 'graze' ? Math.sin(time * 9) * 0.03 * Math.max(0, 1 - (time - c.bite) / 1.5) : 0
    model.neck.rotation.y = c.mode === 'stand' ? Math.sin(time * 0.6 + s.x) * 0.5 : chew
    model.tail.rotation.x = 0.12 + Math.sin(time * 1.7 + s.z) * 0.08
    model.tail.rotation.z = Math.sin(time * 2.3 + s.x) * 0.25
  }

  /** Pushes a body of `radius` at p out of every cow. Returns the cow it bumped, if any. */
  function push(p: Vec2, radius: number) {
    let bumped: CowSave | null = null
    for (const { state: s } of cows) {
      const f = forward(s.yaw)
      // Nearest point on the cow's spine.
      const along = Math.max(-BODY_HALF, Math.min(BODY_HALF, (p.x - s.x) * f.x + (p.z - s.z) * f.z))
      const nx = s.x + f.x * along
      const nz = s.z + f.z * along
      const dx = p.x - nx
      const dz = p.z - nz
      const d = Math.hypot(dx, dz)
      const min = radius + BODY_RADIUS
      if (d >= min) continue
      const ux = d > 1e-4 ? dx / d : -f.z
      const uz = d > 1e-4 ? dz / d : f.x
      p.x = nx + ux * min
      p.z = nz + uz * min
      bumped = s
    }
    return bumped
  }

  return {
    group,
    /** Where the cows are, for the save. */
    get states(): readonly CowSave[] {
      return states
    },
    push,
    /** Makes cow k leave a pat right now. For the console. */
    pat(k: number, time: number) {
      const c = cows[k]
      if (c) dropPat(c, time)
    },
    /**
     * Moves the herd one frame. `active` while you're in the game; `working` until the meadow is cleared,
     * after which the cows only graze. Writes how they bend the grass into `pushers` from slot `slot` on.
     */
    update(time: number, dt: number, active: boolean, working: boolean, player: Vec2, others: readonly Vec2[], pushers: Float32Array, slot: number) {
      for (const c of cows) {
        if (active) {
          if (!working) c.untilPat = Math.max(c.untilPat, 1)
          think(c, time, dt, player)
        }
        animate(c, time, dt)
      }
      if (active) {
        separate()
        // Robots walk around cows too.
        for (const o of others) push(o, 0.5)
      }
      cows.forEach((c, k) => pushers.set([c.state.x, c.state.z, PUSH.radius, PUSH.strength], (slot + k) * 4))

      for (let k = pats.length - 1; k >= 0; k--) {
        const age = time - pats[k].at
        pats[k].mesh.position.y = -Math.max(0, age - PAT_LIFE) * 0.02
        if (age > PAT_LIFE + 15) {
          pats[k].mesh.removeFromParent()
          pats.splice(k, 1)
        }
      }
    },
  }
}

export type Cows = ReturnType<typeof createCows>
