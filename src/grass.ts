import {
  BufferGeometry,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  ShaderMaterial,
  Sphere,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  type Texture,
} from 'three'
import {
  BLADE_COUNT,
  BLADE_SEGMENTS,
  CELLS,
  CELLS_PER_CHUNK,
  CHUNK,
  CHUNKS,
  grownHeight,
  MAP_HALF,
  PARKED,
  PUSHERS,
  regrowthCandidate,
  SPROUT_HEIGHT,
  STUB_HEIGHT,
  WIND_DIR,
  type Field,
  type Growth,
  type Vec2,
} from './field'
import { lightUniforms } from './light'
import { createRing } from './ring'

/** Seconds a cut blade takes to tip over and land. */
const FALL_TIME = 0.95
/** Seconds a clipping lies on the ground before it sinks away. */
const CLIPPING_LIFE = 150
/** Clippings on the ground at once. Once full, the oldest make way. */
const CLIPPING_SLOTS = 16384
/** The density texture has one texel per 2×2 grid cells. */
export const DENSITY_CELLS = CELLS / 2
/** Blades in a full density texel. */
const FULL_CELL = 4
/** Fastest the density texture re-uploads while you cut. */
const DENSITY_UPLOAD_SECONDS = 0.1
/** Seconds a sprout takes to reach full height. Growth steps a few times a second, not every frame. */
const GROW_SECONDS = 60
const GROW_TICK = 0.25
/**
 * Regrowth tries per second. Each picks a random blade and one of its neighbours, and sprouts the
 * neighbour if it was cut. A blade cut in the middle of tall grass comes back after about 17 minutes
 * on average; the edge of a mown patch creeps back slower. Cleared ground with no grass next to it never does.
 */
const REGROWTH_TRIES = 1000
/** Stubs fade out between these distances, inside the nearest detail level. Further out the ground paints the cut look. */
const STUB_FADE = [5, 8] as const

/**
 * Detail levels by distance from a chunk's nearest edge. Far chunks draw a prefix of their shuffled
 * blades, widened to cover the same ground. Thin far-off blades are the most expensive pixels in the
 * game, so past 70 m only one blade in twenty is drawn, four and a half times as wide.
 */
const LODS = [
  { segments: BLADE_SEGMENTS, upTo: 9, share: 1, widen: 1 },
  { segments: 3, upTo: 30, share: 0.75, widen: 1.15 },
  { segments: 2, upTo: 70, share: 0.3, widen: 1.8 },
  { segments: 1, upTo: Infinity, share: 0.05, widen: 4.5 },
] as const

const glslFloat = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`)

/** Shared vertex helpers. bladeLean() and bladeTaper() mirror field.ts. */
const bladeCommon = /* glsl */ `
  #define STUB ${glslFloat(STUB_HEIGHT)}
  #define SPROUT ${glslFloat(SPROUT_HEIGHT)}
  #define PUSHERS ${PUSHERS}
  const vec2 WIND_DIR = vec2(${glslFloat(WIND_DIR.x)}, ${glslFloat(WIND_DIR.z)});

  uniform float uTime;
  uniform vec4 uPushers[PUSHERS]; // x, z, radius, strength: you, the mower deck and the robots
  uniform sampler2D uDensity;
  uniform vec2 uDensityRect;
  uniform sampler2D uNoise;

  attribute vec3 aBase;  // x, z, yaw
  attribute vec4 aShape; // height, width, bend, tint

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vT;
  varying float vTint;
  varying float vPatch;
  varying float vAO;
  varying float vDry;
  varying float vShade;
  varying float vHighlight;

  float bladeTaper(float t) {
    return sqrt(clamp((1.0 - t) * 2.2, 0.0, 1.0));
  }

  vec2 pushAway(vec2 base, vec2 from, float radius, float strength) {
    vec2 d = base - from;
    float dist = max(length(d), 1e-4);
    return d / dist * (1.0 - smoothstep(0.0, radius, dist)) * strength;
  }

  vec2 bladeLean(vec2 base) {
    float gust = 0.55 + 0.45 * sin(uTime * 0.55 - dot(base, WIND_DIR) * 0.22);
    float phase = uTime * 1.7 + base.x * 0.37 + base.y * 0.23;
    float sway = sin(phase) * 0.6 + sin(phase * 2.3 + 1.7) * 0.25;
    vec2 lean = WIND_DIR * gust * (0.07 + 0.06 * sway);
    for (int p = 0; p < PUSHERS; p++) lean += pushAway(base, uPushers[p].xy, uPushers[p].z, uPushers[p].w);
    return lean;
  }

  // 0 in the open, 1 inside untouched grass. Darkens the lower blades and the soil.
  float grassDensity(vec2 p) {
    return texture2D(uDensity, (p + uDensityRect.x) * uDensityRect.y).r;
  }

  // Cloud shadows drifting across the meadow. 1 in sunlight.
  float cloudShade(vec2 p) {
    float c = texture2D(uNoise, p * 0.0035 + uTime * vec2(0.0021, 0.0008)).r;
    return mix(1.0, 0.55, smoothstep(0.52, 0.74, c));
  }

  // Large patches of yellower and deeper green.
  float meadowPatch(vec2 p) {
    return texture2D(uNoise, p * 0.006).g;
  }
`

const bladeFragment = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vT;
  varying float vTint;
  varying float vPatch;
  varying float vAO;
  varying float vDry;
  varying float vShade;
  varying float vHighlight;

  #include <fog_pars_fragment>

  void main() {
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 N = normalize(vNormal);
    N = faceforward(N, -V, N);

    vec3 root = vec3(0.025, 0.06, 0.01);
    vec3 mid = vec3(0.06, 0.19, 0.022);
    vec3 tip = vec3(0.22, 0.33, 0.06);
    vec3 albedo = mix(root, mid, smoothstep(0.0, 0.4, vT));
    albedo = mix(albedo, tip, smoothstep(0.45, 1.0, vT));
    albedo *= mix(0.8, 1.15, vTint);
    // Meadow patches: some stretches sun-bleached, some lush.
    albedo = mix(albedo, albedo * vec3(1.3, 1.1, 0.5), smoothstep(0.55, 0.85, vPatch) * 0.8);
    albedo = mix(albedo, albedo * vec3(0.75, 1.0, 0.9), smoothstep(0.45, 0.15, vPatch) * 0.7);
    albedo = mix(albedo, albedo * vec3(1.35, 1.12, 0.55), smoothstep(0.75, 1.0, vTint));
    albedo = mix(albedo, vec3(0.36, 0.30, 0.13), vDry);

    float ndl = dot(N, uSunDir);
    float diffuse = max(ndl, 0.0);
    // Sun shining through the blade from behind.
    float through = max(-ndl, 0.0) * pow(max(dot(-V, uSunDir), 0.0), 2.0) * 0.9 + max(-ndl, 0.0) * 0.25;
    vec3 ambient = mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5);
    vec3 H = normalize(uSunDir + V);
    float spec = pow(max(dot(N, H), 0.0), 28.0) * 0.18 * (1.0 - vDry);

    vec3 sun = uSunColor * vShade * vAO;
    vec3 color = albedo * (ambient * vAO + sun * (diffuse + through * vec3(1.0, 1.15, 0.55)));
    color += sun * spec;
    color = mix(color, vec3(1.3, 1.15, 0.55), vHighlight * 0.35);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

const standingVertex = /* glsl */ `
  ${bladeCommon}
  attribute float aGrowth; // 0 cut down to a stub, 1 full height, between: growing back
  uniform float uWiden;
  uniform vec3 uHighlight; // x, z, radius: blades rooted inside glow

  #include <fog_pars_vertex>

  void main() {
    float standing = step(0.001, aGrowth);
    // A sprout is the whole blade, shorter. Mirrors grownHeight() in field.ts.
    float h = mix(aShape.x, mix(SPROUT, aShape.x, aGrowth), standing);
    // A cut blade collapses every row above the stub onto the cut line: a flat-topped stub.
    float t = min(position.y, mix(STUB / h, 1.0, standing));
    vec2 base = aBase.xy;
    float yaw = aBase.z;
    vec2 fwd = vec2(sin(yaw), cos(yaw));
    vec3 right = vec3(cos(yaw), 0.0, -sin(yaw));

    vec2 k = (fwd * aShape.z + bladeLean(base)) * standing;
    float w = t * t * h;
    vec3 center = vec3(base.x + k.x * w, t * h, base.y + k.y * w);
    float stub = 0.6 * (1.0 - smoothstep(${glslFloat(STUB_FADE[0])}, ${glslFloat(STUB_FADE[1])}, distance(base, cameraPosition.xz)));
    float halfWidth = 0.5 * aShape.y * uWiden * bladeTaper(t) * mix(stub, 1.0, standing);
    vec3 p = center + right * position.x * halfWidth;

    vec3 tangent = vec3(2.0 * k.x * t * h, h, 2.0 * k.y * t * h);
    vNormal = normalize(normalize(cross(right, tangent)) + right * position.x * 0.45);

    float density = grassDensity(base);
    vAO = mix(mix(0.85, 0.2, density), 1.0, smoothstep(0.0, 1.3, p.y));
    // Stubs show the paler inside of the stem rather than the dark root.
    vT = standing > 0.5 ? t : 0.6;
    vTint = aShape.w;
    vPatch = meadowPatch(base);
    vDry = 0.0;
    vShade = cloudShade(base);
    vHighlight = distance(base, uHighlight.xy) < uHighlight.z ? standing : 0.0;
    vWorldPos = p;

    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const clippingVertex = /* glsl */ `
  ${bladeCommon}
  #define FALL_TIME ${glslFloat(FALL_TIME)}
  #define LIFE ${glslFloat(CLIPPING_LIFE)}
  attribute vec4 aFall; // start time, rest height, lean x, lean z at the moment of the cut

  #include <fog_pars_vertex>

  vec3 rotateAround(vec3 v, vec3 axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
  }

  void main() {
    float len = aShape.x - STUB;
    float t = position.y;
    float yaw = aBase.z;
    vec3 fwd = vec3(sin(yaw), 0.0, cos(yaw));
    vec3 right = vec3(cos(yaw), 0.0, -sin(yaw));

    float age = uTime - aFall.x;
    float p = clamp(age / FALL_TIME, 0.0, 1.0);
    float fall = p * p;
    // Topples forward like a pole, then settles with a small bounce.
    float angle = fall * 1.565 - sin(clamp((p - 0.82) / 0.18, 0.0, 1.0) * 3.14159) * 0.05;
    // The wind lean it had when cut fades out; its curve flips so the tip rests curled up off the ground.
    vec3 k = fwd * mix(aShape.z, -0.05, fall) + vec3(aFall.z, 0.0, aFall.w) * (1.0 - fall);
    // Old clippings shrivel into the soil.
    float sink = smoothstep(LIFE, LIFE + 20.0, age);

    float w = t * t * len;
    float halfWidth = 0.5 * aShape.y * bladeTaper(t) * (1.0 - sink);
    vec3 local = vec3(0.0, t * len, 0.0) + k * w + right * position.x * halfWidth;
    vec3 tangent = vec3(0.0, len, 0.0) + k * 2.0 * t * len;
    vec3 normal = normalize(normalize(cross(right, tangent)) + right * position.x * 0.45);

    vec3 base = vec3(aBase.x, mix(STUB, aFall.y, fall) - sink * 0.04, aBase.y);
    vec3 p3 = base + rotateAround(local, right, angle);
    vNormal = rotateAround(normal, right, angle);

    float standingAO = mix(0.2, 1.0, smoothstep(0.0, 1.3, t * len));
    vAO = mix(standingAO, 0.8, fall);
    vT = t;
    vTint = aShape.w;
    vPatch = meadowPatch(aBase.xy);
    vDry = smoothstep(4.0, 90.0, age) * 0.85;
    vShade = cloudShade(aBase.xy);
    vHighlight = 0.0;
    vWorldPos = p3;

    vec4 mvPosition = viewMatrix * vec4(p3, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

/** One blade as a strip: two vertices per row, a single vertex at the tip. x is the side (-1, 0, 1), y the height fraction. */
function createBladeGeometry(segments: number) {
  const positions: number[] = []
  for (let r = 0; r < segments; r++) {
    const t = r / segments
    positions.push(-1, t, 0, 1, t, 0)
  }
  positions.push(0, 1, 0)
  const index: number[] = []
  for (let r = 0; r < segments - 1; r++) {
    const a = r * 2
    index.push(a, a + 1, a + 3, a, a + 3, a + 2)
  }
  const last = (segments - 1) * 2
  index.push(last, last + 1, last + 2)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(index)
  return geometry
}

type Chunk = {
  k: number
  start: number
  minX: number
  minZ: number
  growthAttr: InstancedBufferAttribute
  /** One mesh per detail level. At most one is visible. */
  lods: Mesh[]
  /** Blades changed since the GPU last got this chunk's growth bytes. */
  dirtyFrom: number
  dirtyTo: number
}

/**
 * Standing blades in chunks with distance-based detail, regrowth, falling and fallen clippings, and the
 * density texture that lets the soil brighten and show mowing stripes as the meadow thins out.
 * This module owns writes to `growth`. `onDensity` hears about every density texel whose count changes.
 */
export function createGrass(field: Field, growth: Growth, noise: Texture, onDensity: (d: number) => void) {
  // Density texture. R: uncut share of the texel. G, B: direction the mower last crossed it, 0.5 for never.
  const bladesPerCell = new Uint8Array(DENSITY_CELLS * DENSITY_CELLS)
  const uncutPerCell = new Uint8Array(DENSITY_CELLS * DENSITY_CELLS)
  const densityCellOf = (i: number) => {
    const c = field.cellOf[i]
    return (Math.floor(c / CELLS) >> 1) * DENSITY_CELLS + ((c % CELLS) >> 1)
  }
  let standingTotal = 0
  for (let i = 0; i < BLADE_COUNT; i++) {
    const d = densityCellOf(i)
    bladesPerCell[d]++
    if (growth[i]) {
      uncutPerCell[d]++
      standingTotal++
    }
  }
  const densityData = new Uint8Array(DENSITY_CELLS * DENSITY_CELLS * 4)
  for (let d = 0; d < uncutPerCell.length; d++) {
    const o = d * 4
    densityData[o] = Math.round(Math.min(1, uncutPerCell[d] / FULL_CELL) * 255)
    densityData[o + 1] = 128
    densityData[o + 2] = 128
    densityData[o + 3] = 255
  }
  const density = new DataTexture(densityData, DENSITY_CELLS, DENSITY_CELLS)
  density.magFilter = LinearFilter
  density.minFilter = LinearFilter
  density.needsUpdate = true
  // Rows of the texture written since the last upload, and the span of each, so uploads send only those.
  const rowFrom = new Int32Array(DENSITY_CELLS).fill(DENSITY_CELLS)
  const rowTo = new Int32Array(DENSITY_CELLS).fill(-1)
  const dirtyRows: number[] = []
  let densityUploadedAt = -Infinity

  const setDensity = (d: number) => {
    densityData[d * 4] = Math.round(Math.min(1, uncutPerCell[d] / FULL_CELL) * 255)
    const row = Math.floor(d / DENSITY_CELLS)
    const col = d % DENSITY_CELLS
    if (rowTo[row] < 0) dirtyRows.push(row)
    rowFrom[row] = Math.min(rowFrom[row], col)
    rowTo[row] = Math.max(rowTo[row], col)
    onDensity(d)
  }

  // Standing blades per chunk, for the robots looking for work.
  const chunkStanding = new Int32Array(CHUNKS * CHUNKS)
  // Sprouts still growing, and a flag per blade so none is listed twice.
  const growing: number[] = []
  const isGrowing = new Uint8Array(BLADE_COUNT)
  let growCarry = 0
  let grownAt = 0
  let regrowthBudget = 0

  const pushers = new Float32Array(PUSHERS * 4)
  for (let p = 0; p < PUSHERS * 4; p += 4) pushers.set([PARKED, PARKED, 1, 0], p)
  const shared = {
    uTime: { value: 0 },
    uPushers: { value: pushers },
    uDensity: { value: density },
    uDensityRect: { value: new Vector2(MAP_HALF, 1 / (MAP_HALF * 2)) },
    uNoise: { value: noise },
  }
  const highlight = { value: new Vector3(0, 0, -1) }
  const uniforms = { ...UniformsUtils.clone(UniformsLib.fog), ...lightUniforms, ...shared }

  const lodGeometries = LODS.map((lod) => createBladeGeometry(lod.segments))
  const lodMaterials = LODS.map(
    (lod) =>
      new ShaderMaterial({
        uniforms: { ...uniforms, uHighlight: highlight, uWiden: { value: lod.widen } },
        vertexShader: standingVertex,
        fragmentShader: bladeFragment,
        side: DoubleSide,
        fog: true,
      }),
  )

  // Standing blades, one set of meshes per chunk. Empty chunks get none.
  const chunks: Chunk[] = []
  const chunkAt: (Chunk | undefined)[] = []
  const meshes: Mesh[] = []
  for (let k = 0; k < CHUNKS * CHUNKS; k++) {
    const start = field.chunkStart[k]
    const n = field.chunkStart[k + 1] - start
    if (n === 0) continue

    const base = new Float32Array(n * 3)
    const shape = new Float32Array(n * 4)
    for (let j = 0; j < n; j++) {
      const i = start + j
      base[j * 3] = field.x[i]
      base[j * 3 + 1] = field.z[i]
      base[j * 3 + 2] = field.yaw[i]
      shape[j * 4] = field.height[i]
      shape[j * 4 + 1] = field.width[i]
      shape[j * 4 + 2] = field.bend[i]
      shape[j * 4 + 3] = field.tint[i]
      if (growth[i]) chunkStanding[k]++
    }
    const baseAttr = new InstancedBufferAttribute(base, 3)
    const shapeAttr = new InstancedBufferAttribute(shape, 4)
    // A view into `growth`, read as 0..1: writes there land on the GPU at the next flush.
    const growthAttr = new InstancedBufferAttribute(growth.subarray(start, start + n), 1, true)
    growthAttr.setUsage(DynamicDrawUsage)

    const minX = (k % CHUNKS) * CHUNK - MAP_HALF
    const minZ = Math.floor(k / CHUNKS) * CHUNK - MAP_HALF
    const bounds = new Sphere(new Vector3(minX + CHUNK / 2, 0.8, minZ + CHUNK / 2), CHUNK * Math.SQRT1_2 + 1.6)

    const lods = LODS.map((lod, l) => {
      const geometry = new InstancedBufferGeometry()
      geometry.index = lodGeometries[l].index
      geometry.setAttribute('position', lodGeometries[l].getAttribute('position'))
      geometry.setAttribute('aBase', baseAttr)
      geometry.setAttribute('aShape', shapeAttr)
      geometry.setAttribute('aGrowth', growthAttr)
      geometry.instanceCount = Math.ceil(n * lod.share)
      geometry.boundingSphere = bounds
      const mesh = new Mesh(geometry, lodMaterials[l])
      mesh.matrixAutoUpdate = false
      mesh.visible = false
      return mesh
    })
    const chunk: Chunk = { k, start, minX, minZ, growthAttr, lods, dirtyFrom: Infinity, dirtyTo: -1 }
    // A chunk out of view uploads nothing, so its changes pile up as one range until it's drawn again.
    growthAttr.onUpload(() => {
      chunk.dirtyFrom = Infinity
      chunk.dirtyTo = -1
    })
    chunks.push(chunk)
    chunkAt[k] = chunk
    meshes.push(...lods)
  }
  const chunkOf = (i: number) => {
    const c = field.cellOf[i]
    const k = Math.floor(c / CELLS / CELLS_PER_CHUNK) * CHUNKS + Math.floor((c % CELLS) / CELLS_PER_CHUNK)
    const chunk = chunkAt[k]
    if (!chunk) throw new Error(`Blade ${i} has no chunk`)
    return chunk
  }
  const touch = (i: number) => {
    const chunk = chunkOf(i)
    const local = i - chunk.start
    chunk.dirtyFrom = Math.min(chunk.dirtyFrom, local)
    chunk.dirtyTo = Math.max(chunk.dirtyTo, local)
    return chunk
  }

  /** Brings cut blade i back as a sprout. */
  const sprout = (i: number) => {
    growth[i] = 1
    standingTotal++
    chunkStanding[touch(i).k]++
    const d = densityCellOf(i)
    uncutPerCell[d]++
    setDensity(d)
    if (!isGrowing[i]) {
      isGrowing[i] = 1
      growing.push(i)
    }
  }

  /** Raises every sprout a step. Ones that were cut meanwhile, or reached full height, leave the list. */
  const grow = (seconds: number) => {
    growCarry += (255 * seconds) / GROW_SECONDS
    const step = Math.floor(growCarry)
    growCarry -= step
    if (step === 0) return
    let kept = 0
    for (const i of growing) {
      if (growth[i] === 0) {
        isGrowing[i] = 0
        continue
      }
      growth[i] = Math.min(255, growth[i] + step)
      touch(i)
      if (growth[i] === 255) isGrowing[i] = 0
      else growing[kept++] = i
    }
    growing.length = kept
  }

  // Clippings: a ring of falling and fallen blades.
  const clipGeometryBase = createBladeGeometry(5)
  const clipBase = new InstancedBufferAttribute(new Float32Array(CLIPPING_SLOTS * 3), 3)
  const clipShape = new InstancedBufferAttribute(new Float32Array(CLIPPING_SLOTS * 4), 4)
  const clipFall = new InstancedBufferAttribute(new Float32Array(CLIPPING_SLOTS * 4), 4)
  for (const attr of [clipBase, clipShape, clipFall]) attr.setUsage(DynamicDrawUsage)
  const clipRing = createRing(CLIPPING_SLOTS, [clipBase, clipShape, clipFall])

  const clippingGeometry = new InstancedBufferGeometry()
  clippingGeometry.index = clipGeometryBase.index
  clippingGeometry.setAttribute('position', clipGeometryBase.getAttribute('position'))
  clippingGeometry.setAttribute('aBase', clipBase)
  clippingGeometry.setAttribute('aShape', clipShape)
  clippingGeometry.setAttribute('aFall', clipFall)
  clippingGeometry.instanceCount = 0
  clippingGeometry.boundingSphere = new Sphere(new Vector3(0, 0.5, 0), MAP_HALF * Math.SQRT2 + 3)

  const clippings = new Mesh(
    clippingGeometry,
    new ShaderMaterial({
      uniforms,
      vertexShader: clippingVertex,
      fragmentShader: bladeFragment,
      side: DoubleSide,
      fog: true,
    }),
  )
  clippings.matrixAutoUpdate = false
  clippings.visible = false
  let lastDrop = -Infinity

  return {
    /** Every chunk's detail levels. Add them all to the scene; update() shows the right one. */
    meshes,
    clippings,
    /** Uniforms the ground shader shares: density texture, its mapping, noise and time. */
    uniforms: shared,
    /** Blades per density texel, row by row from -MAP_HALF, and how many still stand. Read by the minimap. */
    bladesPerCell,
    uncutPerCell,
    /** Standing blades in each chunk, row by row along x. */
    chunkStanding,
    /** x, z, radius, strength for each of the PUSHERS. Write before update(). */
    pushers,
    /** Blades still standing, sprouts included. */
    get standing() {
      return standingTotal
    },
    /** Call once per frame before rendering. */
    update(time: number, camera: Vec2) {
      shared.uTime.value = time
      if (time - grownAt >= GROW_TICK) {
        grow(Math.min(1, time - grownAt))
        grownAt = time
      }

      for (const chunk of chunks) {
        const dx = Math.max(chunk.minX - camera.x, 0, camera.x - chunk.minX - CHUNK)
        const dz = Math.max(chunk.minZ - camera.z, 0, camera.z - chunk.minZ - CHUNK)
        const d = Math.hypot(dx, dz)
        let lod = 0
        while (d >= LODS[lod].upTo) lod++
        // Far detail levels hide stubs, so a fully cut chunk has nothing to draw there.
        if (chunkStanding[chunk.k] === 0 && lod > 0) lod = -1
        for (let l = 0; l < chunk.lods.length; l++) chunk.lods[l].visible = l === lod

        if (chunk.dirtyTo >= chunk.dirtyFrom) {
          chunk.growthAttr.clearUpdateRanges()
          chunk.growthAttr.addUpdateRange(chunk.dirtyFrom, chunk.dirtyTo - chunk.dirtyFrom + 1)
          chunk.growthAttr.needsUpdate = true
        }
      }

      if (dirtyRows.length && time - densityUploadedAt > DENSITY_UPLOAD_SECONDS) {
        for (const row of dirtyRows) {
          density.addUpdateRange((row * DENSITY_CELLS + rowFrom[row]) * 4, (rowTo[row] - rowFrom[row] + 1) * 4)
          rowFrom[row] = DENSITY_CELLS
          rowTo[row] = -1
        }
        dirtyRows.length = 0
        density.needsUpdate = true
        densityUploadedAt = time
      }

      clipRing.flush()
      clippingGeometry.instanceCount = clipRing.used
      clippings.visible = time - lastDrop < CLIPPING_LIFE + FALL_TIME + 20
    },
    /** 0..1: how overgrown the spot is. Used for footstep rustle. */
    densityAt(x: number, z: number) {
      const cx = Math.floor(((x + MAP_HALF) / (MAP_HALF * 2)) * DENSITY_CELLS)
      const cz = Math.floor(((z + MAP_HALF) / (MAP_HALF * 2)) * DENSITY_CELLS)
      if (cx < 0 || cz < 0 || cx >= DENSITY_CELLS || cz >= DENSITY_CELLS) return 0
      return densityData[(cz * DENSITY_CELLS + cx) * 4] / 255
    },
    /** Blades rooted within radius of (x, z) glow. A negative radius turns the glow off. */
    setHighlight(x: number, z: number, radius: number) {
      highlight.value.set(x, z, radius)
    },
    /** Cuts blade i down to a stub. Pass the mower's heading to stripe the ground it crossed. Returns false if it was already cut. */
    cut(i: number, mowHeading?: Vec2) {
      if (growth[i] === 0) return false
      growth[i] = 0
      standingTotal--
      chunkStanding[touch(i).k]--

      const d = densityCellOf(i)
      uncutPerCell[d]--
      if (mowHeading) {
        densityData[d * 4 + 1] = Math.round(127.5 + mowHeading.x * 127)
        densityData[d * 4 + 2] = Math.round(127.5 + mowHeading.z * 127)
      }
      setDensity(d)
      return true
    },
    /** Lets the meadow grow back for `seconds`: grass creeps into cut ground next to it. */
    regrow(seconds: number) {
      regrowthBudget += seconds * REGROWTH_TRIES
      for (; regrowthBudget >= 1; regrowthBudget--) {
        const i = regrowthCandidate(field, growth, Math.random)
        if (i >= 0) sprout(i)
      }
    },
    /**
     * Drops the top of blade i as a clipping that tips over from startTime. Call before cut(), while
     * the blade still has its height. Clippings fall along the blade's facing; `backward` tips it the other way.
     */
    dropClipping(i: number, startTime: number, backward: boolean, lean: Vec2) {
      const slot = clipRing.claim()
      // Turning a blade half a circle and flipping its bend gives the same shape, facing the other way.
      const flip = backward ? -1 : 1
      clipBase.setXYZ(slot, field.x[i], field.z[i], field.yaw[i] + (backward ? Math.PI : 0))
      clipShape.setXYZW(slot, grownHeight(field, growth, i), field.width[i], field.bend[i] * flip, field.tint[i])
      // Rest a few millimetres apart so overlapping clippings don't flicker.
      clipFall.setXYZW(slot, startTime, 0.012 + ((i * 7919) % 97) / 97 / 40, lean.x, lean.z)
      lastDrop = startTime
    },
  }
}

export type Grass = ReturnType<typeof createGrass>
