import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
  DynamicDrawUsage,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { inMeadow, MAP_HALF, raySegment, WIND_DIR, type Field, type Ray, type Vec2 } from './field'
import { SUN_DIR } from './light'

// Sunflowers: rare, tall and worth a lot if you snip them by hand. A few stand in the meadow from the
// start and a new one comes up every few minutes you play. They all face the sun.

const HEIGHT = 1.95
/** Flowers in the meadow at the start of a new game. */
const STARTING = 12
/** Most flowers standing at once. */
const MAX = 20
/** Seconds of play between new flowers. */
const SPROUT_EVERY = 150
const GROW_SECONDS = 50
/** Seconds a cut flower takes to tip over and sink away. */
const FALL_SECONDS = 1.6
const MIN_SPACING = 9

export type Flower = {
  x: number
  z: number
  /** 0 to 1, from seedling to full height. */
  grown: number
  /** When it was cut, or null while it stands. */
  cutAt: number | null
  /** Which way it tips when cut. */
  fallYaw: number
}

function part(geometry: BufferGeometry, color: string) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  g.deleteAttribute('uv')
  const c = new Color(color)
  const colors = new Float32Array(g.getAttribute('position').count * 3)
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i)
  g.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return g
}

/** One flower as a single vertex-coloured mesh, its head turned toward the sun. */
function flowerGeometry() {
  const parts: BufferGeometry[] = [part(new CylinderGeometry(0.017, 0.028, HEIGHT, 7).translate(0, HEIGHT / 2, 0), '#3d7424')]

  const leafAt = [
    [0.55, 0.3, 0.6],
    [0.95, 2.4, 0.5],
    [1.35, 4.3, 0.42],
  ]
  for (const [y, turn, size] of leafAt) {
    const leaf = new SphereGeometry(1, 8, 5)
    leaf.scale(0.17 * size * 1.6, 0.012, 0.09 * size * 1.6)
    leaf.translate(0.15 * size * 1.6, 0, 0)
    leaf.rotateZ(-0.35)
    leaf.rotateY(turn)
    leaf.translate(0, y, 0)
    parts.push(part(leaf, '#4b8a2b'))
  }

  // The head is built facing +z, then turned to the sun.
  const head: BufferGeometry[] = []
  head.push(part(new CylinderGeometry(0.2, 0.15, 0.06, 18).rotateX(Math.PI / 2).translate(0, 0, -0.03), '#47802a'))
  const disc = new SphereGeometry(0.16, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2)
  disc.rotateX(Math.PI / 2)
  disc.scale(1, 1, 0.35)
  head.push(part(disc, '#3a2210'))
  const petals = 24
  for (let p = 0; p < petals; p++) {
    const petal = new SphereGeometry(1, 6, 4)
    petal.scale(0.045, 0.11, 0.01)
    petal.translate(0, 0.24 + (p % 2) * 0.02, 0.005 - (p % 2) * 0.01)
    petal.rotateZ((p / petals) * Math.PI * 2)
    head.push(part(petal, p % 2 ? '#f2b415' : '#ffd23a'))
  }
  const headGeometry = mergeGeometries(head)
  if (!headGeometry) throw new Error('Sunflower head failed to build')
  // Turn toward the sun, nodding a little below it.
  headGeometry.rotateX(-0.25)
  headGeometry.rotateY(Math.atan2(SUN_DIR.x, SUN_DIR.z))
  headGeometry.translate(0, HEIGHT, 0)
  parts.push(headGeometry)

  const merged = mergeGeometries(parts)
  if (!merged) throw new Error('Sunflower failed to build')
  merged.computeVertexNormals()
  return merged
}

/** Sways the flowers in the same wind as the grass. */
function swayMaterial(uTime: { value: number }) {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float swayPhase = uTime * 1.3 + instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
        float sway = (sin(swayPhase) * 0.6 + sin(swayPhase * 2.3 + 1.7) * 0.25) * 0.05 * pow(max(position.y, 0.0) / ${HEIGHT.toFixed(2)}, 2.0);
        transformed.xz += vec2(${WIND_DIR.x}, ${WIND_DIR.z}) * sway;
      #endif`,
    )
  }
  return material
}

/**
 * The sunflowers. Pass the saved positions to restore them, or null to plant a fresh meadow.
 * `random` picks spots for new flowers.
 */
export function createSunflowers(field: Field, saved: Vec2[] | null, random = Math.random) {
  const uTime = { value: 0 }
  const mesh = new InstancedMesh(flowerGeometry(), swayMaterial(uTime), MAX + 4)
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.frustumCulled = false
  mesh.count = 0

  const flowers: Flower[] = []
  let sinceSprout = 0
  let dirty = true

  /** A spot inside the meadow, clear of other flowers and of `avoid`. */
  function findSpot(avoid: Vec2 | null): Vec2 | null {
    for (let tries = 0; tries < 40; tries++) {
      const x = (random() * 2 - 1) * MAP_HALF
      const z = (random() * 2 - 1) * MAP_HALF
      if (!inMeadow(field, x, z, 3)) continue
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < 6) continue
      if (flowers.some((f) => Math.hypot(f.x - x, f.z - z) < MIN_SPACING)) continue
      return { x, z }
    }
    return null
  }

  const plant = (at: Vec2, grown: number) => {
    flowers.push({ ...at, grown, cutAt: null, fallYaw: random() * Math.PI * 2 })
    dirty = true
  }

  if (saved) for (const at of saved) plant(at, 1)
  else
    for (let n = 0; n < STARTING; n++) {
      const at = findSpot(null)
      if (at) plant(at, 1)
    }

  const matrix = new Matrix4()
  const dummy = new Object3D()
  const tip = new Quaternion()
  const axis = new Vector3()

  const standing = (f: Flower) => f.cutAt === null

  return {
    mesh,
    /** Flowers still standing. */
    get count() {
      return flowers.filter(standing).length
    },
    /** Standing flower positions, for the save and the minimap. */
    positions(): Vec2[] {
      return flowers.filter(standing).map(({ x, z }) => ({ x, z }))
    },
    /**
     * Call every frame. `growing` lets new flowers come up and young ones grow: only while you play
     * and the meadow isn't finished. `player` keeps new flowers from popping up under your nose.
     */
    update(time: number, dt: number, growing: boolean, player: Vec2) {
      uTime.value = time
      if (growing) {
        sinceSprout += dt
        if (sinceSprout >= SPROUT_EVERY) {
          sinceSprout = 0
          const at = flowers.filter(standing).length < MAX ? findSpot(player) : null
          if (at) plant(at, 0.08)
        }
        for (const f of flowers) {
          if (f.grown < 1 && standing(f)) {
            f.grown = Math.min(1, f.grown + dt / GROW_SECONDS)
            dirty = true
          }
        }
      }

      for (let k = flowers.length - 1; k >= 0; k--) {
        const f = flowers[k]
        if (f.cutAt === null) continue
        dirty = true
        if (time - f.cutAt > FALL_SECONDS) flowers.splice(k, 1)
      }
      if (!dirty) return
      dirty = false

      flowers.forEach((f, k) => {
        const s = 0.25 + 0.75 * f.grown
        dummy.position.set(f.x, 0, f.z)
        dummy.quaternion.identity()
        dummy.scale.setScalar(s)
        if (f.cutAt !== null) {
          // Tips over from the cut, then sinks into the grass.
          const p = Math.min(1, (time - f.cutAt) / FALL_SECONDS)
          axis.set(Math.cos(f.fallYaw), 0, Math.sin(f.fallYaw))
          dummy.quaternion.copy(tip.setFromAxisAngle(axis, Math.min(1, p * 1.6) ** 2 * 1.45))
          dummy.position.y = 0.05 - Math.max(0, p - 0.6) * 0.6
          dummy.scale.setScalar(s * (1 - Math.max(0, p - 0.75) * 3))
        }
        dummy.updateMatrix()
        mesh.setMatrixAt(k, matrix.copy(dummy.matrix))
      })
      mesh.count = flowers.length
      mesh.instanceMatrix.needsUpdate = true
    },
    /** A seedling at `at`, unless the meadow already has as many flowers as it holds. Returns whether it was planted. */
    plantAt(at: Vec2) {
      if (flowers.filter(standing).length >= MAX) return false
      plant(at, 0.08)
      return true
    },
    /** The standing flower whose stem or head the ray hits first within reach, and how far along the ray. */
    pick(ray: Ray, reach: number) {
      let best: Flower | null = null
      let bestS = reach
      for (const f of flowers) {
        if (!standing(f)) continue
        const s = 0.25 + 0.75 * f.grown
        const top = HEIGHT * s
        // raySegment reuses one result object, so read each answer before the next call.
        const stem = raySegment(ray, f.x, 0, f.z, f.x, top - 0.1 * s, f.z)
        let hit = stem.dist < 0.07 ? stem.s : Infinity
        const head = raySegment(ray, f.x, top - 0.08 * s, f.z, f.x, top + 0.08 * s, f.z)
        if (head.dist < 0.3 * s) hit = Math.min(hit, head.s)
        if (hit < bestS && hit > 0.05) {
          best = f
          bestS = hit
        }
      }
      return { flower: best, s: bestS }
    },
    /** Standing flowers rooted within r of (x, z). */
    near(x: number, z: number, r: number) {
      return flowers.filter((f) => standing(f) && Math.hypot(f.x - x, f.z - z) <= r)
    },
    /** Nearest standing flower to (x, z), or null. */
    nearest(x: number, z: number) {
      let best: Flower | null = null
      for (const f of flowers) {
        if (standing(f) && (!best || Math.hypot(f.x - x, f.z - z) < Math.hypot(best.x - x, best.z - z))) best = f
      }
      return best
    },
    /** Cuts flower f: it tips over away from (fromX, fromZ). Returns false if it was already down. */
    cut(f: Flower, time: number, fromX: number, fromZ: number) {
      if (f.cutAt !== null) return false
      f.cutAt = time
      // Fall away from whoever cut it: the tip axis is at right angles to that.
      f.fallYaw = Math.atan2(f.z - fromZ, f.x - fromX) - Math.PI / 2
      dirty = true
      return true
    },
  }
}

export type Sunflowers = ReturnType<typeof createSunflowers>
