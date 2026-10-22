import {
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { bake } from './bake'
import type { Vec2 } from './field'
import { FARMER, STALL } from './layout'
import { createMower } from './mower'
import { createRider } from './rider'
import { drawWood, woodTexture } from './sign'
import { createTrimmer } from './trimmer'
import { createHandTool } from './viewmodel'

// The farmer's stall: a market stand with the tools on show, and the farmer behind the counter who
// talks you into buying them. The stall is built in its own frame, front toward +z, then turned to
// face where you start.

const FONT = '"Avenir Next", "Futura", "Trebuchet MS", system-ui, sans-serif'
/** Characters per second as the farmer talks. */
const TALK_RATE = 32
/** Seconds a line stays up once fully said. */
const LINE_HOLD = 3.2
/** Seconds of quiet between lines. */
const LINE_GAP = 6
/** He only talks to you within this distance. */
const EARSHOT = 15

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, maxAnisotropy: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx) draw(ctx)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = maxAnisotropy
  return texture
}

function box(w: number, h: number, d: number, material: MeshStandardMaterial, x: number, y: number, z: number, radius = 0) {
  const mesh = new Mesh(radius > 0 ? new RoundedBoxGeometry(w, h, d, 2, radius) : new BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  return mesh
}

/** The stand itself plus everything on show, baked into a few draw calls. */
function buildStall(maxAnisotropy: number) {
  const wood = new MeshStandardMaterial({ map: woodTexture(0x5a11, maxAnisotropy), roughness: 0.85 })
  const darkWood = new MeshStandardMaterial({ map: woodTexture(0x77d, maxAnisotropy), roughness: 0.9, color: '#8a7766' })
  const stripes = canvasTexture(
    256,
    32,
    (ctx) => {
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#f1e4c4' : '#c8352b'
        ctx.fillRect(i * 32, 0, 32, 32)
      }
    },
    maxAnisotropy,
  )
  stripes.wrapS = RepeatWrapping
  const canvas = new MeshStandardMaterial({ map: stripes, roughness: 0.9 })
  const board = new MeshStandardMaterial({
    map: canvasTexture(
      1024,
      256,
      (ctx) => {
        drawWood(ctx, 1024, 256, 2, 0x5ab)
        ctx.fillStyle = '#f6e9c9'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(20, 8, 0, 0.55)'
        ctx.shadowOffsetY = 4
        ctx.shadowBlur = 6
        ctx.font = `800 150px ${FONT}`
        ctx.fillText('Farm Shop', 512, 136)
      },
      maxAnisotropy,
    ),
    roughness: 0.8,
  })
  const chalk = new MeshStandardMaterial({
    map: canvasTexture(
      512,
      640,
      (ctx) => {
        ctx.fillStyle = '#1f2a24'
        ctx.fillRect(0, 0, 512, 640)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'
        for (let i = 0; i < 60; i++) ctx.fillRect(Math.random() * 512, Math.random() * 640, 120, 6)
        ctx.fillStyle = '#f4f1e8'
        ctx.textAlign = 'center'
        ctx.font = `700 86px ${FONT}`
        ctx.fillText('Robots', 256, 190)
        ctx.fillText('in stock', 256, 300)
        ctx.font = `600 54px ${FONT}`
        ctx.fillStyle = '#ffd36b'
        ctx.fillText('they mow,', 256, 440)
        ctx.fillText('you relax', 256, 510)
      },
      maxAnisotropy,
    ),
    roughness: 0.95,
  })

  const stall = new Group()
  // Counter with an overhanging top, and the posts holding up the awning.
  stall.add(box(3.2, 0.98, 0.62, wood, 0, 0.49, 0.45), box(3.4, 0.06, 0.8, darkWood, 0, 1.01, 0.42))
  for (const x of [-1.6, 1.6]) {
    stall.add(box(0.1, 2.36, 0.1, darkWood, x, 1.18, 0.8), box(0.1, 2.62, 0.1, darkWood, x, 1.31, -0.78))
  }
  // A shelf at the back.
  stall.add(box(3.1, 0.05, 0.36, darkWood, 0, 1.15, -0.72))
  // Striped awning, sloping down toward the front, with a striped flap along its edge.
  const awning = box(3.7, 0.04, 2.1, canvas, 0, 2.48, 0.12)
  awning.rotation.x = 0.17
  const flap = box(3.7, 0.22, 0.02, canvas, 0, 2.2, 1.18)
  stall.add(awning, flap)
  // Name board on the roof.
  const sign = new Mesh(new BoxGeometry(2.2, 0.55, 0.05), [darkWood, darkWood, darkWood, darkWood, board, darkWood])
  sign.position.set(0, 2.95, -0.1)
  stall.add(sign, box(0.06, 0.5, 0.06, darkWood, -0.8, 2.6, -0.12), box(0.06, 0.5, 0.06, darkWood, 0.8, 2.6, -0.12))
  // Crates and a barrel out front.
  stall.add(box(0.5, 0.36, 0.42, wood, -1.15, 0.18, 1.12), box(0.42, 0.3, 0.38, darkWood, -1.08, 0.51, 1.1))
  const barrel = new Mesh(new CylinderGeometry(0.26, 0.24, 0.62, 16), darkWood)
  barrel.position.set(1.25, 0.31, 1.15)
  stall.add(barrel)
  // Chalkboard on an easel.
  const chalkboard = new Mesh(new BoxGeometry(0.62, 0.78, 0.03), [darkWood, darkWood, darkWood, darkWood, chalk, darkWood])
  chalkboard.position.set(-0.35, 0.62, 1.55)
  chalkboard.rotation.x = -0.18
  stall.add(chalkboard, box(0.04, 1.0, 0.04, darkWood, -0.35, 0.5, 1.42))

  // On show: scissors and a sickle on the counter, a trimmer leaning on it, two mowers parked beside.
  for (const [id, x, turn] of [
    ['scissors', -0.7, 0.4],
    ['sickle', 0.55, -0.5],
  ] as const) {
    const tool = createHandTool(id)
    tool.holder.scale.setScalar(1.6)
    tool.holder.position.set(x, 1.07, 0.38)
    tool.holder.rotation.set(0, turn, 0)
    stall.add(tool.holder)
  }
  const trimmer = createTrimmer()
  trimmer.show(true)
  // Leaning on the front post.
  trimmer.update(1.95, 1.25, new Vector3(1.66, 1.5, 0.92), 0, 0, 0)
  stall.add(trimmer.group)
  const mower = createMower()
  mower.show(true, -Infinity)
  mower.update({ x: -2.55, z: 0.75 - 1.4, yaw: Math.PI }, 0, false)
  stall.add(mower.group)
  const rider = createRider()
  rider.show(true)
  rider.update({ x: 3.1, z: -0.3, yaw: Math.PI + 0.25 }, 0, false, 0)
  stall.add(rider.group)

  return bake(stall)
}

const skin = new MeshStandardMaterial({ color: '#e2a982', roughness: 0.7 })
const denim = new MeshStandardMaterial({ color: '#3f5f8a', roughness: 0.85 })
const shirt = new MeshStandardMaterial({ color: '#b8352b', roughness: 0.8 })
const straw = new MeshStandardMaterial({ color: '#dcb65e', roughness: 0.9 })
const brown = new MeshStandardMaterial({ color: '#5a3a22', roughness: 0.9 })
const ink = new MeshStandardMaterial({ color: '#1d1a17', roughness: 0.4 })

const capsule = (r: number, length: number, material: MeshStandardMaterial, x: number, y: number, z: number) => {
  const mesh = new Mesh(new CapsuleGeometry(r, length, 4, 12), material)
  mesh.position.set(x, y, z)
  return mesh
}
const sphere = (r: number, material: MeshStandardMaterial, x: number, y: number, z: number) => {
  const mesh = new Mesh(new SphereGeometry(r, 16, 12), material)
  mesh.position.set(x, y, z)
  return mesh
}

/** A farmer in overalls and a straw hat, about 1.8 m tall, facing +z. */
function buildFarmer() {
  const bodyParts = new Group()
  bodyParts.add(
    capsule(0.085, 0.62, denim, -0.11, 0.42, 0),
    capsule(0.085, 0.62, denim, 0.11, 0.42, 0),
    box(0.16, 0.1, 0.27, brown, -0.11, 0.05, 0.04, 0.03),
    box(0.16, 0.1, 0.27, brown, 0.11, 0.05, 0.04, 0.03),
    box(0.44, 0.26, 0.28, denim, 0, 0.88, 0, 0.08),
    box(0.46, 0.5, 0.29, shirt, 0, 1.18, 0, 0.12),
    box(0.3, 0.3, 0.03, denim, 0, 1.08, 0.14, 0.02),
    box(0.05, 0.36, 0.02, denim, -0.11, 1.28, 0.145),
    box(0.05, 0.36, 0.02, denim, 0.11, 1.28, 0.145),
    sphere(0.018, straw, -0.11, 1.2, 0.16),
    sphere(0.018, straw, 0.11, 1.2, 0.16),
    new Mesh(new CylinderGeometry(0.06, 0.07, 0.1, 12).translate(0, 1.46, 0), skin),
  )
  const body = new Group()
  body.add(bake(bodyParts))

  const head = new Group()
  head.position.y = 1.5
  const headParts = new Group()
  headParts.add(
    sphere(0.13, skin, 0, 0.13, 0),
    sphere(0.035, skin, 0, 0.12, 0.13),
    sphere(0.03, skin, -0.13, 0.13, 0),
    sphere(0.03, skin, 0.13, 0.13, 0),
    sphere(0.016, ink, -0.048, 0.165, 0.115),
    sphere(0.016, ink, 0.048, 0.165, 0.115),
    box(0.05, 0.012, 0.02, brown, -0.05, 0.2, 0.118),
    box(0.05, 0.012, 0.02, brown, 0.05, 0.2, 0.118),
  )
  const mustache = capsule(0.022, 0.1, brown, 0, 0.085, 0.122)
  mustache.rotation.z = Math.PI / 2
  const brim = new Mesh(new CylinderGeometry(0.31, 0.3, 0.02, 28), straw)
  brim.position.y = 0.25
  const crown = new Mesh(new CylinderGeometry(0.14, 0.16, 0.14, 24), straw)
  crown.position.y = 0.33
  const band = new Mesh(new CylinderGeometry(0.162, 0.162, 0.035, 24), shirt)
  band.position.y = 0.285
  headParts.add(mustache, brim, crown, band)
  head.add(bake(headParts))
  head.rotation.x = 0.04

  const arms = [-1, 1].map((side) => {
    const shoulder = new Group()
    shoulder.position.set(side * 0.27, 1.36, 0)
    const parts = new Group()
    parts.add(capsule(0.065, 0.24, shirt, 0, -0.15, 0), capsule(0.055, 0.2, skin, 0, -0.4, 0), sphere(0.06, skin, 0, -0.56, 0))
    shoulder.add(bake(parts))
    shoulder.rotation.z = side * 0.12
    return shoulder
  })

  const group = new Group()
  group.add(body, head, ...arms)
  return { group, head, arms, body }
}

export type Speech = { text: string; shown: string; blip: boolean }

/**
 * The stall and the farmer. `pitch` writes his next line when he has something to say to you.
 * update() returns what he's saying right now, for the speech bubble.
 */
export function createShop(maxAnisotropy: number) {
  const group = new Group()
  group.add(buildStall(maxAnisotropy))
  const farmer = buildFarmer()
  farmer.group.position.set(0, 0, -0.45)
  group.add(farmer.group)
  group.position.set(STALL.x, 0, STALL.z)
  group.rotation.y = STALL.yaw

  let line: { text: string; at: number } | null = null
  let quietUntil = 2
  let waveAt = -Infinity
  let inEarshot = false
  let lastShown = 0
  const headWorld = new Vector3()

  return {
    group,
    /** Has him say `text` right away, over whatever he was saying. */
    say(text: string, time: number) {
      line = { text, at: time }
      lastShown = 0
      quietUntil = time + text.length / TALK_RATE + LINE_HOLD + LINE_GAP
    },
    /** World position just above his hat, for the speech bubble. */
    bubbleAnchor() {
      return farmer.head.localToWorld(headWorld.set(0, 0.5, 0))
    },
    /**
     * Turns him toward you, waves when you arrive and keeps him talking while you're near and in the
     * game (`listening`). `pitch` is asked for a new line whenever he's ready to speak.
     */
    update(time: number, player: Vec2, listening: boolean, pitch: (first: boolean) => string): Speech | null {
      const dx = player.x - FARMER.x
      const dz = player.z - FARMER.z
      const distance = Math.hypot(dx, dz)
      const inRange = distance < EARSHOT
      const near = listening && inRange
      if (near && !inEarshot) {
        waveAt = time
        if (time >= quietUntil - LINE_GAP) this.say(pitch(true), time)
      }
      inEarshot = near
      if (near && time >= quietUntil) this.say(pitch(false), time)

      // Look at you, turning the head first and the body a little.
      const look = inRange ? Math.atan2(dx, dz) - STALL.yaw : 0
      const turn = Math.max(-1.1, Math.min(1.1, Math.atan2(Math.sin(look), Math.cos(look))))
      farmer.head.rotation.y += (turn * 0.7 - farmer.head.rotation.y) * 0.08
      farmer.group.rotation.y += (turn * 0.3 - farmer.group.rotation.y) * 0.05
      farmer.body.scale.y = 1 + Math.sin(time * 1.6) * 0.008
      // A wave as you walk up.
      const wave = time - waveAt
      const [left, right] = farmer.arms
      if (wave < 2.2) {
        right.rotation.z = Math.min(1, wave * 4) * 2.6 * (wave > 1.8 ? (2.2 - wave) / 0.4 : 1)
        right.rotation.x = Math.sin(wave * 14) * 0.25
      } else {
        right.rotation.z += (0.12 - right.rotation.z) * 0.1
        right.rotation.x = 0
      }
      left.rotation.x = Math.sin(time * 1.1) * 0.04

      if (!line) return null
      const age = time - line.at
      const count = Math.min(line.text.length, Math.floor(age * TALK_RATE))
      if (!near || age > line.text.length / TALK_RATE + LINE_HOLD) {
        line = null
        return null
      }
      // Nod along while talking.
      farmer.head.rotation.x = 0.04 + (count < line.text.length ? Math.sin(time * 18) * 0.03 : 0)
      const shown = line.text.slice(0, count)
      // A voice blip every few letters.
      const blip = count < line.text.length && Math.floor(count / 3) !== Math.floor(lastShown / 3)
      lastShown = count
      return { text: line.text, shown, blip }
    },
  }
}

export type Shop = ReturnType<typeof createShop>
