import { CapsuleGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { bake } from './bake'
import type { Cutter, Cutting } from './cutting'
import type { RobotSave } from './economy'
import { CELLS, CELLS_PER_CHUNK, CHUNK, CHUNKS, forEachStandingNear, inMeadow, MAP_HALF, PARKED, type Field, type Growth, type Vec2 } from './field'
import type { Grass } from './grass'
import { onStall, pushOut, ROBOT_DOOR } from './layout'
import { createMower, wheel } from './mower'
import { createRider } from './rider'
import type { Flower, Sunflowers } from './sunflowers'
import { CLIPPER, harvests, MOWER, RIDER, ROBOT_PACE, SCISSORS, SICKLE, TOOLS, TRIMMER, type ToolId } from './tools'
import { createTrimmer } from './trimmer'
import { createHandTool, type HandTool } from './viewmodel'

// The robots: up to three helpers that find grass on their own and cut it at half your pace with
// whatever tool you bought them. Their state lives in the save (RobotSave); this module moves them
// around, picks their work and draws them.

/** Accent colour of each robot, also used for its dot on the minimap. */
export const ROBOT_COLORS = ['#ff8a3d', '#2ec4b6', '#a77bff'] as const

const shell = new MeshStandardMaterial({ color: '#e8ecf1', roughness: 0.35, metalness: 0.1 })
const joint = new MeshStandardMaterial({ color: '#3b4048', roughness: 0.5, metalness: 0.6 })
const visor = new MeshStandardMaterial({ color: '#0f1216', roughness: 0.15, metalness: 0.6 })
const eyeLight = new MeshStandardMaterial({ color: '#7ff6ff', emissive: '#59f0ff', emissiveIntensity: 1.8 })

/**
 * How each tool works in a robot's hands. Robots never tire or wander, so their speeds and swings are
 * set below half of yours to land at about half your real pace.
 */
const PACE = {
  walk: 1.4,
  /** Seconds between snips or swings. */
  clipper: CLIPPER.interval / ROBOT_PACE,
  scissors: 1.15,
  sickle: SICKLE.swing / ROBOT_PACE,
  /** A robot swings the sickle through a narrower wedge than you do. */
  sickleArc: 0.5,
  /** Metres per second through the grass. */
  trimmer: 0.6,
  mower: 1.4,
  rider: 2.2,
}
/** Seconds a robot chases one target before it gives up and looks elsewhere. */
const PATIENCE = 8
/** Clippers, scissors and robots with them go after flowers this close. */
const FLOWER_RANGE = 40
/** How far around itself a robot looks for grass before searching the whole meadow. */
const LOCAL_SEARCH = 3.5
const SPACING = 1.3
/** How the robots bend the grass: around them, or around their mower deck. */
const PUSH = { body: [0.7, 0.3], mower: [1.0, 0.5], rider: [1.4, 0.55] } as const
const HAND_SCALE: Record<ToolId, number> = { clipper: 2.2, scissors: 1.8, sickle: 1.45, trimmer: 1, mower: 1, rider: 1 }

function rounded(w: number, h: number, d: number, r: number, material: MeshStandardMaterial, x: number, y: number, z: number) {
  const mesh = new Mesh(new RoundedBoxGeometry(w, h, d, 3, r), material)
  mesh.position.set(x, y, z)
  return mesh
}

const ROBOT_SCALE = 1.2

/** A friendly wheeled robot about 1.45 m tall, facing -Z. */
export function buildRobot(color: string) {
  const accent = new MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 })
  const glow = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4 })

  const drive = new Group()
  const wheels = [-0.2, 0.2].map((x) => {
    const w = wheel(0.13, 0.08)
    w.group.position.set(x, 0.13, 0)
    drive.add(w.group)
    return w.spin
  })
  drive.add(rounded(0.34, 0.12, 0.3, 0.04, joint, 0, 0.2, 0))

  const torsoParts = new Group()
  torsoParts.add(
    rounded(0.46, 0.48, 0.34, 0.08, shell, 0, 0.53, 0),
    rounded(0.28, 0.18, 0.03, 0.012, accent, 0, 0.57, -0.17),
    rounded(0.47, 0.05, 0.35, 0.02, joint, 0, 0.32, 0),
    new Mesh(new CylinderGeometry(0.05, 0.05, 0.08, 12).translate(0, 0.8, 0), joint),
  )
  const torso = new Group()
  torso.add(bake(torsoParts))

  const head = new Group()
  head.position.y = 0.84
  const skull = new Group()
  const ears = [-1, 1].map((side) => {
    const ear = new Mesh(new CylinderGeometry(0.05, 0.05, 0.03, 16), accent)
    ear.rotation.z = Math.PI / 2
    ear.position.set(side * 0.215, 0.15, 0)
    return ear
  })
  skull.add(
    rounded(0.42, 0.3, 0.34, 0.09, shell, 0, 0.15, 0),
    rounded(0.36, 0.17, 0.04, 0.05, visor, 0, 0.15, -0.16),
    new Mesh(new CylinderGeometry(0.008, 0.008, 0.14, 8).translate(0, 0.36, 0), joint),
    ...ears,
  )
  const bulb = new Mesh(new SphereGeometry(0.028, 12, 8), glow)
  bulb.position.y = 0.44
  head.add(bake(skull), bulb)
  const eyes = new Group()
  for (const side of [-1, 1]) {
    const eye = new Mesh(new CapsuleGeometry(0.024, 0.03, 4, 10), eyeLight)
    eye.position.set(side * 0.075, 0, 0)
    eyes.add(eye)
  }
  eyes.position.set(0, 0.16, -0.183)
  head.add(eyes)
  torso.add(head)

  const arms = [-1, 1].map((side) => {
    const shoulder = new Group()
    shoulder.position.set(side * 0.28, 0.68, 0)
    const upper = new Group()
    upper.add(new Mesh(new SphereGeometry(0.06, 14, 10), accent), new Mesh(new CapsuleGeometry(0.035, 0.16, 4, 10).translate(0, -0.11, 0), shell))
    shoulder.add(bake(upper))
    const elbow = new Group()
    elbow.position.y = -0.21
    const lower = new Group()
    lower.add(
      new Mesh(new CapsuleGeometry(0.033, 0.14, 4, 10).translate(0, -0.1, 0), shell),
      new Mesh(new SphereGeometry(0.045, 12, 8).translate(0, -0.21, 0), joint),
    )
    elbow.add(bake(lower))
    const hand = new Group()
    hand.position.y = -0.23
    elbow.add(hand)
    shoulder.add(elbow)
    torso.add(shoulder)
    return { shoulder, elbow, hand }
  })

  // Tall enough to see over the grass.
  const group = new Group()
  group.add(drive, torso)
  group.scale.setScalar(ROBOT_SCALE)
  return { group, drive, torso, head, eyes, wheels, arms }
}

type Model = ReturnType<typeof buildRobot>

/** What a robot is heading for: a blade, a flower, a spot to drive through on the way, or somewhere to wait. */
type Target =
  | { kind: 'blade'; i: number; x: number; z: number }
  | { kind: 'flower'; flower: Flower; x: number; z: number }
  | { kind: 'waypoint'; x: number; z: number }
  | { kind: 'rest'; x: number; z: number }

type Robot = {
  state: RobotSave
  index: number
  model: Model
  /** The tool model it's carrying, rebuilt when its tier changes. */
  kit: Kit | null
  kitTier: number
  target: Target | null
  /** When the robot last cut something or got closer to its target. */
  targetSince: number
  /** Closest it has been to its target so far. */
  closest: number
  /** Grid chunk the target is in, so robots spread out over the meadow. */
  chunk: number
  nextCut: number
  usedAt: number
  speed: number
  blinkAt: number
  trimPhase: number
}

type Kit =
  | { kind: 'hand'; tool: ToolId; hand: HandTool; holder: Group }
  | { kind: 'trimmer'; trimmer: ReturnType<typeof createTrimmer> }
  | { kind: 'mower'; mower: ReturnType<typeof createMower> }
  | { kind: 'rider'; rider: ReturnType<typeof createRider> }

type Hooks = {
  /** Pay out for blades a robot cut, `worth` bCoins in all. */
  onCut: (worth: number, by: Cutter) => void
  /** A sound the robot made at (x, z). */
  onSound: (kind: 'snip' | 'shear' | 'swoosh' | 'beep', x: number, z: number) => void
  /** Engine noise from robot machines: the nearest running one and how far it is. */
  onEngines: (kind: 'trimmer' | 'mower' | 'rider' | null, distance: number) => void
}

export function createRobots(field: Field, growth: Growth, grass: Grass, sunflowers: Sunflowers, cutting: Cutting, robots: RobotSave[], hooks: Hooks) {
  const group = new Group()
  const list: Robot[] = []
  const hands = new Vector3()

  const toolOf = (r: Robot): ToolId => TOOLS[r.state.tier].id
  const forward = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) })

  function equip(r: Robot) {
    const { model } = r
    if (r.kit) {
      const old = r.kit
      if (old.kind === 'hand') old.holder.removeFromParent()
      else if (old.kind === 'trimmer') old.trimmer.group.removeFromParent()
      else if (old.kind === 'mower') old.mower.group.removeFromParent()
      else old.rider.group.removeFromParent()
    }
    const tool = toolOf(r)
    r.kitTier = r.state.tier
    model.drive.visible = tool !== 'rider'
    // On the riding mower it sits on the seat, its wheels tucked away.
    model.torso.position.set(0, tool === 'rider' ? 0.47 : 0, tool === 'rider' ? 0.06 : 0)
    if (tool === 'clipper' || tool === 'scissors' || tool === 'sickle') {
      const hand = createHandTool(tool)
      const holder = new Group()
      holder.add(hand.holder)
      holder.scale.setScalar(HAND_SCALE[tool])
      model.arms[1].hand.add(holder)
      r.kit = { kind: 'hand', tool, hand, holder }
    } else if (tool === 'trimmer') {
      const trimmer = createTrimmer()
      trimmer.show(true)
      group.add(trimmer.group)
      r.kit = { kind: 'trimmer', trimmer }
    } else if (tool === 'mower') {
      const mower = createMower()
      mower.show(true, -Infinity)
      group.add(mower.group)
      r.kit = { kind: 'mower', mower }
    } else {
      const rider = createRider()
      rider.show(true)
      rider.group.add(model.group)
      group.add(rider.group)
      r.kit = { kind: 'rider', rider }
    }
    if (tool !== 'rider' && model.group.parent !== group) group.add(model.group)
    r.target = null
  }

  /** Brings the 3D side in line with `robots`: new robots roll out of the stall, upgraded ones swap tools. */
  function sync() {
    while (list.length < robots.length) {
      const index = list.length
      const model = buildRobot(ROBOT_COLORS[index])
      const r: Robot = { state: robots[index], index, model, kit: null, kitTier: -1, target: null, targetSince: 0, closest: Infinity, chunk: -1, nextCut: 0, usedAt: -Infinity, speed: 0, blinkAt: 2 + index, trimPhase: index * 2 }
      group.add(model.group)
      list.push(r)
    }
    for (const r of list) if (r.kitTier !== r.state.tier) equip(r)
  }

  /** Where the robot's own cutting happens: its hand, its trimmer head or its mower deck. */
  function reachPoint(r: Robot, out: Vec2) {
    const { x, z, yaw } = r.state
    const f = forward(yaw)
    const tool = toolOf(r)
    const ahead = tool === 'mower' ? MOWER.ahead : tool === 'rider' ? RIDER.ahead : tool === 'trimmer' ? 1.0 : tool === 'sickle' ? 0.9 : 0.55
    out.x = x + f.x * ahead
    out.z = z + f.z * ahead
    return out
  }

  const claimed = (r: Robot, k: number) => list.some((o) => o !== r && o.chunk === k)
  const chunkOfCell = (c: number) => Math.floor(c / CELLS / CELLS_PER_CHUNK) * CHUNKS + Math.floor((c % CELLS) / CELLS_PER_CHUNK)

  const isMachine = (tool: ToolId) => tool === 'trimmer' || tool === 'mower' || tool === 'rider'

  /**
   * Picks the next thing to cut: a flower for hand snippers, then nearby grass, then the nearest
   * unclaimed patch. A robot that gave up on its last target (`stuck`) picks a random spot nearby instead.
   */
  function retarget(r: Robot, time: number, stuck = false) {
    const tool = toolOf(r)
    const at = reachPoint(r, { x: 0, z: 0 })
    const f = forward(r.state.yaw)
    r.targetSince = time
    r.closest = Infinity

    if (stuck) {
      for (let tries = 0; tries < 60; tries++) {
        const x = r.state.x + (Math.random() * 2 - 1) * 12
        const z = r.state.z + (Math.random() * 2 - 1) * 12
        let found = -1
        forEachStandingNear(field, growth, x, z, 1, (i) => (found = i))
        if (found >= 0 && Math.hypot(x - r.state.x, z - r.state.z) > 3) {
          r.target = { kind: 'blade', i: found, x: field.x[found], z: field.z[found] }
          return
        }
      }
    }

    if (harvests(tool) && !stuck) {
      const flower = sunflowers.nearest(r.state.x, r.state.z)
      const taken = flower && list.some((o) => o !== r && o.target?.kind === 'flower' && o.target.flower === flower)
      if (flower && !taken && Math.hypot(flower.x - r.state.x, flower.z - r.state.z) < FLOWER_RANGE) {
        r.target = { kind: 'flower', flower, x: flower.x, z: flower.z }
        return
      }
    }

    // Machines prefer grass ahead of them, so they mow in lines instead of zigzagging. Grass right
    // beside the body can't get under a deck that sits out front, so they leave it for a later pass.
    const machine = isMachine(tool)
    const turnCost = machine ? 2.5 : 0.3
    const tooClose = machine ? Math.hypot(at.x - r.state.x, at.z - r.state.z) * 0.8 : 0
    let best = -1
    let bestScore = Infinity
    forEachStandingNear(field, growth, at.x, at.z, LOCAL_SEARCH, (i) => {
      const dx = field.x[i] - at.x
      const dz = field.z[i] - at.z
      const d = Math.hypot(dx, dz)
      if (tooClose && Math.hypot(field.x[i] - r.state.x, field.z[i] - r.state.z) < tooClose) return
      const score = d + turnCost * (1 - (d > 1e-3 ? (dx * f.x + dz * f.z) / d : 1))
      if (score < bestScore) {
        bestScore = score
        best = i
      }
    })

    if (best < 0) {
      // Nothing close: head for the nearest chunk with grass that no other robot has claimed.
      let bestChunk = -1
      let bestFree = false
      let bestDistance = Infinity
      for (let k = 0; k < CHUNKS * CHUNKS; k++) {
        if (grass.chunkStanding[k] === 0) continue
        const cx = ((k % CHUNKS) + 0.5) * CHUNK - MAP_HALF
        const cz = (Math.floor(k / CHUNKS) + 0.5) * CHUNK - MAP_HALF
        const d = Math.hypot(cx - at.x, cz - at.z)
        const free = !claimed(r, k)
        if ((free && !bestFree) || (free === bestFree && d < bestDistance)) {
          bestChunk = k
          bestFree = free
          bestDistance = d
        }
      }
      if (bestChunk >= 0) {
        let bestD = Infinity
        for (let i = field.chunkStart[bestChunk]; i < field.chunkStart[bestChunk + 1]; i++) {
          if (growth[i] === 0) continue
          const d = Math.hypot(field.x[i] - at.x, field.z[i] - at.z)
          if (d < bestD) {
            bestD = d
            best = i
          }
        }
      }
    }

    if (best >= 0 && tooClose && Math.hypot(field.x[best] - r.state.x, field.z[best] - r.state.z) < tooClose) {
      // Too close to get under a deck out front, and machines don't reverse: back off along the line first.
      const dx = r.state.x - field.x[best]
      const dz = r.state.z - field.z[best]
      const d = Math.hypot(dx, dz) || 1
      r.target = { kind: 'waypoint', x: field.x[best] + (dx / d) * 2.6, z: field.z[best] + (dz / d) * 2.6 }
    } else if (best >= 0) {
      r.target = { kind: 'blade', i: best, x: field.x[best], z: field.z[best] }
      r.chunk = chunkOfCell(field.cellOf[best])
    } else {
      // Nothing left to cut: line up behind the stall.
      r.target = { kind: 'rest', ...onStall((r.index - 1) * 1.8, -2.8) }
      r.chunk = -1
    }
  }

  const stillThere = (t: Target) => (t.kind === 'blade' ? growth[t.i] > 0 : t.kind === 'flower' ? t.flower.cutAt === null : true)

  /** Turns toward (tx, tz) and drives on, slowing in tight turns. Stops `stop` metres short. Returns the distance left. */
  function steer(r: Robot, tx: number, tz: number, stop: number, top: number, turnRate: number, dt: number) {
    const s = r.state
    const dx = tx - s.x
    const dz = tz - s.z
    const d = Math.hypot(dx, dz)
    const want = Math.atan2(-dx, -dz)
    let err = want - s.yaw
    err = Math.atan2(Math.sin(err), Math.cos(err))
    s.yaw += Math.max(-turnRate * dt, Math.min(turnRate * dt, err))
    const goal = d > stop ? top * Math.max(0, Math.cos(err)) ** 2 : 0
    r.speed += (goal - r.speed) * Math.min(1, dt * 4)
    const f = forward(s.yaw)
    const step = Math.min(r.speed * dt, Math.max(0, d - stop) + 0.02)
    s.x += f.x * step
    s.z += f.z * step
    return d
  }

  function work(r: Robot, time: number, dt: number) {
    const tool = toolOf(r)
    if (!r.target || !stillThere(r.target)) retarget(r, time)
    // A resting robot looks for work again now and then: grass grows back.
    else if (time - r.targetSince > PATIENCE) retarget(r, time, r.target.kind !== 'rest')
    const t = r.target
    if (!t) return
    const s = r.state
    let cut = 0

    if (isMachine(tool)) {
      // Drive the cutting point (deck or trimmer head) over the target. Everything under it goes as it passes.
      const ahead = Math.hypot(reachPoint(r, { x: 0, z: 0 }).x - s.x, reachPoint(r, { x: 0, z: 0 }).z - s.z)
      const top = tool === 'trimmer' ? PACE.trimmer : tool === 'mower' ? PACE.mower : PACE.rider
      const passing = t.kind === 'rest' || t.kind === 'waypoint'
      steer(r, t.x, t.z, passing ? 0.3 : -ahead, top, tool === 'rider' ? 1.6 : 2.2, dt)
      const point = reachPoint(r, { x: 0, z: 0 })
      if (t.kind === 'waypoint' && Math.hypot(s.x - t.x, s.z - t.z) < 0.7) r.target = null
      if (t.kind !== 'rest') {
        if (tool === 'trimmer') {
          // Sweep the head side to side as it goes.
          r.trimPhase += dt * 2.4
          const f = forward(s.yaw)
          const side = Math.sin(r.trimPhase) * 0.55
          point.x -= f.z * side
          point.z += f.x * side
          if (r.kit?.kind === 'trimmer') r.kit.trimmer.head.set(point.x, 0, point.z)
          cut += cutting.circle(point.x, point.z, TRIMMER.radius, 'trimmer', s, time, r.index)
        } else {
          const halfLength = tool === 'mower' ? MOWER.halfLength : RIDER.halfLength
          const halfWidth = tool === 'mower' ? MOWER.halfWidth : RIDER.halfWidth
          cut += cutting.deck(point, forward(s.yaw), halfLength, halfWidth, tool, time, r.index)
        }
        if (t.kind !== 'waypoint' && Math.hypot(point.x - t.x, point.z - t.z) < 0.45) r.target = null
      }
    } else {
      // Walk up to the target, then snip or swing at half your pace.
      const stand = tool === 'sickle' ? 0.9 : 0.55
      const working = t.kind === 'blade' || t.kind === 'flower'
      const d = steer(r, t.x, t.z, working ? stand : 0.2, PACE.walk, 5, dt)
      const interval = tool === 'clipper' ? PACE.clipper : tool === 'scissors' ? PACE.scissors : PACE.sickle
      if (t.kind === 'waypoint' && d < 0.4) r.target = null
      if (working && d < stand + 0.25 && time >= r.nextCut) {
        r.nextCut = time + interval
        r.usedAt = time
        if (t.kind === 'flower') {
          cutting.pickFlower(t.flower, tool, s, time, r.index)
          r.target = null
        } else if (tool === 'clipper') {
          cut += cutting.snip(t.i, s, time)
          hooks.onSound('snip', s.x, s.z)
        } else if (tool === 'scissors') {
          cut += cutting.circle(t.x, t.z, SCISSORS.radius, 'scissors', s, time, r.index)
          hooks.onSound('shear', s.x, s.z)
        } else {
          cut += cutting.wedge(s, SICKLE.inner, SICKLE.reach, -PACE.sickleArc, PACE.sickleArc, time, r.index)
          hooks.onSound('swoosh', s.x, s.z)
        }
        if (r.target && !stillThere(r.target)) r.target = null
      }
    }
    // Patience runs out only when the robot stops cutting and stops getting closer.
    const gap = Math.hypot(t.x - s.x, t.z - s.z)
    if (gap < r.closest - 0.3) {
      r.closest = gap
      r.targetSince = time
    }
    if (cut) {
      hooks.onCut(cut, r.index)
      r.targetSince = time
    }
  }

  /** Keeps robots apart, out of your way, out of the stall and on the map. */
  function separate(player: Vec2) {
    for (const r of list) {
      const s = r.state
      const room = toolOf(r) === 'rider' ? 1.1 : 0.45
      for (const o of list) {
        if (o === r) continue
        const dx = s.x - o.state.x
        const dz = s.z - o.state.z
        const d = Math.hypot(dx, dz)
        const min = SPACING + (toolOf(o) === 'rider' ? 0.8 : 0) + (room > 1 ? 0.8 : 0)
        if (d < min && d > 1e-4) {
          s.x += (dx / d) * (min - d) * 0.5
          s.z += (dz / d) * (min - d) * 0.5
        }
      }
      const px = s.x - player.x
      const pz = s.z - player.z
      const pd = Math.hypot(px, pz)
      if (pd < room + 0.5 && pd > 1e-4) {
        s.x += (px / pd) * (room + 0.5 - pd)
        s.z += (pz / pd) * (room + 0.5 - pd)
      }
      pushOut(s, room)
      const rr = Math.hypot(s.x, s.z)
      if (rr > MAP_HALF - 4) {
        s.x *= (MAP_HALF - 4) / rr
        s.z *= (MAP_HALF - 4) / rr
      }
    }
  }

  /** Arms, eyes, wheels and the tool in hand. */
  function animate(r: Robot, time: number, dt: number, celebrating: boolean) {
    const { model, state: s } = r
    const tool = toolOf(r)
    const f = forward(s.yaw)

    // Blink every few seconds.
    if (time > r.blinkAt + 0.13) r.blinkAt = time + 2.5 + ((r.index * 1.7 + time) % 3)
    model.eyes.scale.y = time > r.blinkAt ? 0.15 : celebrating ? 0.6 : 1
    for (const w of model.wheels) w.rotation.x -= (r.speed * dt) / (0.13 * ROBOT_SCALE)
    // Look toward the work.
    const t = r.target
    let look = 0
    if (t && !celebrating) {
      const dx = t.x - s.x
      const dz = t.z - s.z
      look = Math.atan2(-dx, -dz) - s.yaw
      look = Math.max(-0.8, Math.min(0.8, Math.atan2(Math.sin(look), Math.cos(look))))
    }
    model.head.rotation.y += (look - model.head.rotation.y) * Math.min(1, dt * 5)
    model.head.rotation.x = tool === 'mower' || tool === 'rider' ? 0 : -0.25

    const [left, right] = model.arms
    const use = Math.min(1, (time - r.usedAt) / 0.35)
    const chop = Math.sin(Math.PI * use)
    if (celebrating) {
      // Arms up, a little dance.
      for (const [k, arm] of model.arms.entries()) {
        arm.shoulder.rotation.set(Math.PI * 0.95, 0, (k ? -1 : 1) * (0.35 + Math.sin(time * 6 + k) * 0.2))
        arm.elbow.rotation.x = 0.3
      }
      model.group.position.y = Math.abs(Math.sin(time * 5 + r.index)) * 0.08
      model.torso.rotation.y = Math.sin(time * 2 + r.index) * 0.5
    } else if (tool === 'mower' || tool === 'rider') {
      const reach = tool === 'mower' ? 1.32 : 1.15
      for (const arm of [left, right]) {
        arm.shoulder.rotation.set(reach, 0, 0)
        arm.elbow.rotation.x = tool === 'mower' ? 0.15 : 0.6
      }
      model.group.position.y = 0
      model.torso.rotation.y = 0
    } else {
      left.shoulder.rotation.set(0.25 + Math.sin(time * 3 + r.index) * 0.05, 0, 0.12)
      left.elbow.rotation.x = 0.3
      right.shoulder.rotation.set(tool === 'trimmer' ? 0.85 : 0.9 + chop * 0.35, 0, -0.08)
      right.elbow.rotation.x = tool === 'trimmer' ? 0.35 : 0.5 - chop * 0.3
      model.group.position.y = r.speed > 0.1 ? Math.abs(Math.sin(time * 9)) * 0.01 : 0
      model.torso.rotation.y = 0
    }

    const kit = r.kit
    if (kit?.kind === 'hand') {
      // Undo the arm's tilt so the tool points ahead of the robot, then play its own snip or swing.
      kit.holder.rotation.x = -(right.shoulder.rotation.x + right.elbow.rotation.x)
      kit.hand.holder.position.set(0, 0, 0)
      kit.hand.animate(Math.min(1, (time - r.usedAt) / ((kit.hand.actionTime / ROBOT_PACE) * 0.9)))
    } else if (kit?.kind === 'trimmer') {
      hands.set(s.x + f.x * 0.5 - f.z * 0.14, 0.75 + model.group.position.y, s.z + f.z * 0.5 + f.x * 0.14)
      const head = kit.trimmer.head
      const working = t?.kind === 'blade' && !celebrating
      if (!working) head.set(s.x + f.x * 1.0, 0, s.z + f.z * 1.0)
      kit.trimmer.update(head.x, head.z, hands, time, dt, working ? 1 : 0)
    } else if (kit?.kind === 'mower') {
      kit.mower.update(s, time, t?.kind === 'blade' && !celebrating)
    } else if (kit?.kind === 'rider') {
      kit.rider.update(s, time, t?.kind === 'blade' && !celebrating, 0)
    }
    if (kit?.kind !== 'rider') {
      model.group.position.x = s.x
      model.group.position.z = s.z
      model.group.rotation.y = s.yaw
    } else {
      model.group.position.set(0, model.group.position.y, 0)
      model.group.rotation.y = 0
    }
  }

  sync()
  let lastUpdate = 0

  return {
    group,
    /** Call after buying a robot or a robot tool. */
    sync,
    /** Positions for the minimap. */
    get positions(): readonly RobotSave[] {
      return robots
    },
    /**
     * Moves every robot one frame. `working` is false when the meadow is cleared: the robots dance.
     * Writes their pushers into the grass (slots 2 to 4).
     */
    update(time: number, dt: number, working: boolean, active: boolean, player: Vec2, listener: Vec2) {
      let engine: { kind: 'trimmer' | 'mower' | 'rider'; distance: number } | null = null
      const elapsed = time - lastUpdate
      lastUpdate = time
      for (const r of list) {
        if (active && working) work(r, time, dt)
        else {
          r.speed *= 0.9
          // Paused: hold their patience and swing timers where they were.
          r.targetSince += elapsed
          r.nextCut += elapsed
        }
        animate(r, time, dt, !working)
        const tool = toolOf(r)
        if (active && working && r.target?.kind === 'blade' && (tool === 'trimmer' || tool === 'mower' || tool === 'rider')) {
          const distance = Math.hypot(r.state.x - listener.x, r.state.z - listener.z)
          if (!engine || distance < engine.distance) engine = { kind: tool, distance }
        }
      }
      if (active && working) separate(player)
      hooks.onEngines(engine?.kind ?? null, engine?.distance ?? Infinity)

      const at = { x: 0, z: 0 }
      for (let k = 0; k < 3; k++) {
        const r = list[k]
        const p = (2 + k) * 4
        if (!r) {
          grass.pushers.set([PARKED, PARKED, 1, 0], p)
          continue
        }
        const tool = toolOf(r)
        const machine = tool === 'mower' || tool === 'rider'
        const [radius, strength] = machine ? PUSH[tool] : PUSH.body
        if (machine) reachPoint(r, at)
        grass.pushers.set([machine ? at.x : r.state.x, machine ? at.z : r.state.z, radius, strength], p)
      }
    },
    /** Puts every robot back on the meadow's edge if a save left one somewhere odd. */
    tidy() {
      for (const r of robots) {
        if (!Number.isFinite(r.x) || !Number.isFinite(r.z) || Math.hypot(r.x, r.z) > MAP_HALF) Object.assign(r, ROBOT_DOOR)
        if (!inMeadow(field, r.x, r.z, -20)) Object.assign(r, ROBOT_DOOR)
      }
    },
  }
}

export type Robots = ReturnType<typeof createRobots>
