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
  RedFormat,
  ShaderMaterial,
  Sphere,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
} from 'three'
import {
  BLADE_COUNT,
  BLADE_SEGMENTS,
  FIELD_RADIUS,
  PUSH_RADIUS,
  PUSH_STRENGTH,
  STUB_HEIGHT,
  WIND_DIR,
  type Field,
  type Grid,
} from './field'
import { lightUniforms } from './light'

/** Seconds a cut blade takes to tip over and land. */
const FALL_TIME = 0.95
/** Uncut blades per density cell that count as "fully overgrown". */
const FULL_CELL = 6

const glslFloat = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`)

/** Shared vertex helpers. bladeLean() and bladeTaper() mirror field.ts. */
const bladeCommon = /* glsl */ `
  #define STUB ${glslFloat(STUB_HEIGHT)}
  #define PUSH_RADIUS ${glslFloat(PUSH_RADIUS)}
  #define PUSH_STRENGTH ${glslFloat(PUSH_STRENGTH)}
  const vec2 WIND_DIR = vec2(${glslFloat(WIND_DIR.x)}, ${glslFloat(WIND_DIR.z)});

  uniform float uTime;
  uniform vec2 uPlayer;
  uniform sampler2D uDensity;
  uniform vec2 uDensityRect;

  attribute vec3 aBase;  // x, z, yaw
  attribute vec4 aShape; // height, width, bend, tint

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vT;
  varying float vTint;
  varying float vAO;
  varying float vDry;
  varying float vHighlight;

  float bladeTaper(float t) {
    return sqrt(clamp((1.0 - t) * 2.2, 0.0, 1.0));
  }

  vec2 bladeLean(vec2 base) {
    float gust = 0.55 + 0.45 * sin(uTime * 0.55 - dot(base, WIND_DIR) * 0.22);
    float phase = uTime * 1.7 + base.x * 0.37 + base.y * 0.23;
    float sway = sin(phase) * 0.6 + sin(phase * 2.3 + 1.7) * 0.25;
    vec2 lean = WIND_DIR * gust * (0.07 + 0.06 * sway);
    vec2 d = base - uPlayer;
    float dist = max(length(d), 1e-4);
    lean += d / dist * (1.0 - smoothstep(0.0, PUSH_RADIUS, dist)) * PUSH_STRENGTH;
    return lean;
  }

  // 0 in the open, 1 inside untouched grass. Darkens the lower blades and the soil.
  float grassDensity(vec2 p) {
    return texture2D(uDensity, (p + uDensityRect.x) * uDensityRect.y).r;
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
  varying float vAO;
  varying float vDry;
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
    albedo = mix(albedo, albedo * vec3(1.35, 1.12, 0.55), smoothstep(0.75, 1.0, vTint));
    albedo = mix(albedo, vec3(0.36, 0.30, 0.13), vDry);

    float ndl = dot(N, uSunDir);
    float diffuse = max(ndl, 0.0);
    // Sun shining through the blade from behind.
    float through = max(-ndl, 0.0) * pow(max(dot(-V, uSunDir), 0.0), 2.0) * 0.9 + max(-ndl, 0.0) * 0.25;
    vec3 ambient = mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5);
    vec3 H = normalize(uSunDir + V);
    float spec = pow(max(dot(N, H), 0.0), 28.0) * 0.18 * (1.0 - vDry);

    vec3 color = albedo * (ambient * vAO + uSunColor * (diffuse + through * vec3(1.0, 1.15, 0.55)) * vAO);
    color += uSunColor * spec * vAO;
    color = mix(color, vec3(1.3, 1.15, 0.55), vHighlight * 0.35);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

const standingVertex = /* glsl */ `
  ${bladeCommon}
  attribute float aCut; // 1 standing, 0 cut down to a stub
  uniform int uHighlight;

  #include <fog_pars_vertex>

  void main() {
    float h = aShape.x;
    // A cut blade collapses every row above the stub onto the cut line: a flat-topped stub.
    float t = min(position.y, mix(STUB / h, 1.0, aCut));
    vec2 base = aBase.xy;
    float yaw = aBase.z;
    vec2 fwd = vec2(sin(yaw), cos(yaw));
    vec3 right = vec3(cos(yaw), 0.0, -sin(yaw));

    vec2 k = (fwd * aShape.z + bladeLean(base)) * aCut;
    float w = t * t * h;
    vec3 center = vec3(base.x + k.x * w, t * h, base.y + k.y * w);
    float halfWidth = 0.5 * aShape.y * bladeTaper(t);
    vec3 p = center + right * position.x * halfWidth;

    vec3 tangent = vec3(2.0 * k.x * t * h, h, 2.0 * k.y * t * h);
    vNormal = normalize(normalize(cross(right, tangent)) + right * position.x * 0.45);

    float density = grassDensity(base);
    vAO = mix(mix(0.85, 0.2, density), 1.0, smoothstep(0.0, 1.7, p.y));
    // Fresh cuts show the paler inside of the stem rather than the dark root.
    vT = aCut > 0.5 ? t : 0.45;
    vTint = aShape.w;
    vDry = 0.0;
    vHighlight = gl_InstanceID == uHighlight ? 1.0 : 0.0;
    vWorldPos = p;

    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const clippingVertex = /* glsl */ `
  ${bladeCommon}
  #define FALL_TIME ${glslFloat(FALL_TIME)}
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

    float p = clamp((uTime - aFall.x) / FALL_TIME, 0.0, 1.0);
    float fall = p * p;
    // Topples forward like a pole, then settles with a small bounce.
    float angle = fall * 1.565 - sin(clamp((p - 0.82) / 0.18, 0.0, 1.0) * 3.14159) * 0.05;
    // The wind lean it had when cut fades out; its curve flips so the tip rests curled up off the ground.
    vec3 k = fwd * mix(aShape.z, -0.05, fall) + vec3(aFall.z, 0.0, aFall.w) * (1.0 - fall);

    float w = t * t * len;
    float halfWidth = 0.5 * aShape.y * bladeTaper(t);
    vec3 local = vec3(0.0, t * len, 0.0) + k * w + right * position.x * halfWidth;
    vec3 tangent = vec3(0.0, len, 0.0) + k * 2.0 * t * len;
    vec3 normal = normalize(normalize(cross(right, tangent)) + right * position.x * 0.45);

    vec3 base = vec3(aBase.x, mix(STUB, aFall.y, fall), aBase.y);
    vec3 p3 = base + rotateAround(local, right, angle);
    vNormal = rotateAround(normal, right, angle);

    float standingAO = mix(0.2, 1.0, smoothstep(0.0, 1.7, t * len));
    vAO = mix(standingAO, 0.8, fall);
    vT = t;
    vTint = aShape.w;
    vDry = smoothstep(4.0, 90.0, uTime - aFall.x) * 0.85;
    vHighlight = 0.0;
    vWorldPos = p3;

    vec4 mvPosition = viewMatrix * vec4(p3, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

/** One blade as a strip: two vertices per row, a single vertex at the tip. x is the side (-1, 0, 1), y the height fraction. */
function createBladeGeometry() {
  const positions: number[] = []
  for (let r = 0; r < BLADE_SEGMENTS; r++) {
    const t = r / BLADE_SEGMENTS
    positions.push(-1, t, 0, 1, t, 0)
  }
  positions.push(0, 1, 0)
  const index: number[] = []
  for (let r = 0; r < BLADE_SEGMENTS - 1; r++) {
    const a = r * 2
    index.push(a, a + 1, a + 3, a, a + 3, a + 2)
  }
  const last = (BLADE_SEGMENTS - 1) * 2
  index.push(last, last + 1, last + 2)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(index)
  return geometry
}

/**
 * Standing blades, falling and fallen clippings, plus the density texture that lets
 * the soil and blade bases brighten as the meadow thins out.
 */
export function createGrass(field: Field, grid: Grid) {
  const blade = createBladeGeometry()
  const bounds = new Sphere(new Vector3(0, 1, 0), FIELD_RADIUS * 1.25 + 2.5)

  // Density texture: uncut blades per grid cell, normalised.
  const cellCount = grid.cells * grid.cells
  const uncutPerCell = new Uint16Array(cellCount)
  for (let i = 0; i < BLADE_COUNT; i++) uncutPerCell[grid.cellOf[i]]++
  const densityData = new Uint8Array(cellCount)
  const writeDensity = (c: number) => {
    densityData[c] = Math.round(Math.min(1, uncutPerCell[c] / FULL_CELL) * 255)
  }
  for (let c = 0; c < cellCount; c++) writeDensity(c)
  const density = new DataTexture(densityData, grid.cells, grid.cells, RedFormat)
  density.magFilter = LinearFilter
  density.minFilter = LinearFilter
  density.needsUpdate = true

  const shared = {
    uTime: { value: 0 },
    uPlayer: { value: new Vector2() },
    uDensity: { value: density },
    uDensityRect: { value: new Vector2(grid.half, 1 / (grid.half * 2)) },
  }
  const uniforms = { ...UniformsUtils.clone(UniformsLib.fog), ...lightUniforms, ...shared }

  // Standing blades.
  const base = new Float32Array(BLADE_COUNT * 3)
  const shape = new Float32Array(BLADE_COUNT * 4)
  for (let i = 0; i < BLADE_COUNT; i++) {
    base.set([field.x[i], field.z[i], field.yaw[i]], i * 3)
    shape.set([field.height[i], field.width[i], field.bend[i], field.tint[i]], i * 4)
  }
  const cutAttr = new InstancedBufferAttribute(new Float32Array(BLADE_COUNT).fill(1), 1)
  cutAttr.setUsage(DynamicDrawUsage)

  const standingGeometry = new InstancedBufferGeometry()
  standingGeometry.index = blade.index
  standingGeometry.setAttribute('position', blade.getAttribute('position'))
  standingGeometry.setAttribute('aBase', new InstancedBufferAttribute(base, 3))
  standingGeometry.setAttribute('aShape', new InstancedBufferAttribute(shape, 4))
  standingGeometry.setAttribute('aCut', cutAttr)
  standingGeometry.instanceCount = BLADE_COUNT
  standingGeometry.boundingSphere = bounds

  const highlight = { value: -1 }
  const standing = new Mesh(
    standingGeometry,
    new ShaderMaterial({
      uniforms: { ...uniforms, uHighlight: highlight },
      vertexShader: standingVertex,
      fragmentShader: bladeFragment,
      side: DoubleSide,
      fog: true,
    }),
  )

  // Clippings: filled in the order blades get cut.
  const clipBase = new InstancedBufferAttribute(new Float32Array(BLADE_COUNT * 3), 3)
  const clipShape = new InstancedBufferAttribute(new Float32Array(BLADE_COUNT * 4), 4)
  const clipFall = new InstancedBufferAttribute(new Float32Array(BLADE_COUNT * 4), 4)
  for (const attr of [clipBase, clipShape, clipFall]) attr.setUsage(DynamicDrawUsage)

  const clippingGeometry = new InstancedBufferGeometry()
  clippingGeometry.index = blade.index
  clippingGeometry.setAttribute('position', blade.getAttribute('position'))
  clippingGeometry.setAttribute('aBase', clipBase)
  clippingGeometry.setAttribute('aShape', clipShape)
  clippingGeometry.setAttribute('aFall', clipFall)
  clippingGeometry.instanceCount = 0
  clippingGeometry.boundingSphere = new Sphere(new Vector3(0, 0.5, 0), FIELD_RADIUS * 1.25 + 3)

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

  const touch = (attr: InstancedBufferAttribute, slot: number) => {
    attr.addUpdateRange(slot * attr.itemSize, attr.itemSize)
    attr.needsUpdate = true
  }

  return {
    standing,
    clippings,
    /** Density texture and its mapping, shared with the ground shader. */
    density: { texture: density, rect: shared.uDensityRect },
    update(time: number, playerX: number, playerZ: number) {
      shared.uTime.value = time
      shared.uPlayer.value.set(playerX, playerZ)
    },
    /** 0..1: how overgrown the spot is. Used for footstep rustle. */
    densityAt(x: number, z: number) {
      const cx = Math.floor((x + grid.half) / grid.size)
      const cz = Math.floor((z + grid.half) / grid.size)
      if (cx < 0 || cz < 0 || cx >= grid.cells || cz >= grid.cells) return 0
      return densityData[cz * grid.cells + cx] / 255
    },
    setHighlight(index: number) {
      highlight.value = index
    },
    /**
     * Cuts blade i down to a stub and drops a clipping in its place.
     * startTime < uTime - FALL_TIME places it already lying down (used when loading a save).
     * Clippings fall flat along the blade's facing; `backward` tips it the other way.
     */
    cut(i: number, startTime: number, backward: boolean, leanX = 0, leanZ = 0) {
      cutAttr.setX(i, 0)
      touch(cutAttr, i)

      const slot = clippingGeometry.instanceCount++
      // Turning a blade half a circle and flipping its bend gives the same shape, facing the other way.
      const flip = backward ? -1 : 1
      clipBase.setXYZ(slot, field.x[i], field.z[i], field.yaw[i] + (backward ? Math.PI : 0))
      clipShape.setXYZW(slot, field.height[i], field.width[i], field.bend[i] * flip, field.tint[i])
      // Rest a few millimetres apart so overlapping clippings don't flicker.
      clipFall.setXYZW(slot, startTime, 0.012 + ((i * 7919) % 97) / 97 / 40, leanX, leanZ)
      touch(clipBase, slot)
      touch(clipShape, slot)
      touch(clipFall, slot)

      const c = grid.cellOf[i]
      uncutPerCell[c]--
      writeDensity(c)
      density.needsUpdate = true
    },
  }
}

export type Grass = ReturnType<typeof createGrass>
