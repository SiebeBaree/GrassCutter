import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three'
import { mulberry32, type Vec2 } from './field'
import { lightUniforms } from './light'
import { createRing } from './ring'

// Confetti, mower clippings and fireworks. Every particle's whole flight is known when it spawns:
// the vertex shader works out where it is from its start, velocity, drag and gravity, so the CPU
// writes each particle once and never touches it again.

const BIT_SLOTS = 4096
const SPARK_SLOTS = 8192

const motionGlsl = /* glsl */ `
  uniform float uTime;
  attribute vec3 aStart;
  attribute vec3 aVelocity;
  attribute vec4 aTiming; // start time, lifetime, drag, gravity
  attribute vec4 aLook;   // r, g, b, size
  attribute vec4 aExtra;

  // Position after t seconds with linear drag and gravity. Mirrors motion() in particles.ts.
  vec3 motion(float t) {
    float k = max(aTiming.z, 0.001);
    vec3 terminal = vec3(0.0, -aTiming.w / k, 0.0);
    return aStart + terminal * t + (aVelocity - terminal) * (1.0 - exp(-k * t)) / k;
  }

  vec3 rotateAround(vec3 v, vec3 axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
  }
`

type Motion = { x: number; y: number; z: number; vx: number; vy: number; vz: number; drag: number; gravity: number }

/** Where a particle is after t seconds. Mirrors motion() in the shaders. */
function motion(m: Motion, t: number, out: Vector3) {
  const k = Math.max(m.drag, 0.001)
  const terminal = -m.gravity / k
  const decay = (1 - Math.exp(-k * t)) / k
  return out.set(m.x + m.vx * decay, m.y + terminal * t + (m.vy - terminal) * decay, m.z + m.vz * decay)
}

function quad() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  return geometry
}

/** An instanced quad with the per-particle attributes every system here uses, fed round-robin. */
function createSystem(slots: number, material: ShaderMaterial) {
  const base = quad()
  const geometry = new InstancedBufferGeometry()
  geometry.index = base.index
  geometry.setAttribute('position', base.getAttribute('position'))
  const attr = (size: number) => {
    const a = new InstancedBufferAttribute(new Float32Array(slots * size), size)
    a.setUsage(DynamicDrawUsage)
    return a
  }
  const start = attr(3)
  const velocity = attr(3)
  const timing = attr(4)
  const look = attr(4)
  const extra = attr(4)
  geometry.setAttribute('aStart', start)
  geometry.setAttribute('aVelocity', velocity)
  geometry.setAttribute('aTiming', timing)
  geometry.setAttribute('aLook', look)
  geometry.setAttribute('aExtra', extra)
  geometry.instanceCount = 0
  const ring = createRing(slots, [start, velocity, timing, look, extra])

  const mesh = new Mesh(geometry, material)
  // Positions only exist in the shader, so the CPU can't cull.
  mesh.frustumCulled = false
  mesh.visible = false
  let aliveUntil = -Infinity

  return {
    mesh,
    spawn(m: Motion, time: number, life: number, color: Color, size: number, e0: number, e1: number, e2: number, e3: number) {
      const slot = ring.claim()
      start.setXYZ(slot, m.x, m.y, m.z)
      velocity.setXYZ(slot, m.vx, m.vy, m.vz)
      timing.setXYZW(slot, time, life, m.drag, m.gravity)
      look.setXYZW(slot, color.r, color.g, color.b, size)
      extra.setXYZW(slot, e0, e1, e2, e3)
      aliveUntil = Math.max(aliveUntil, time + life)
    },
    update(time: number) {
      ring.flush()
      geometry.instanceCount = ring.used
      mesh.visible = time < aliveUntil
    },
  }
}

/** Lit, spinning paper and grass bits. aExtra: flutter metres, spin speed, aspect, seed. */
function bitsMaterial(uTime: { value: number }) {
  return new ShaderMaterial({
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), ...lightUniforms, uTime },
    vertexShader: /* glsl */ `
      ${motionGlsl}
      varying vec3 vColor;
      varying vec3 vNormal;
      #include <fog_pars_vertex>
      void main() {
        float age = uTime - aTiming.x;
        float life = aTiming.y;
        if (age < 0.0 || age > life) {
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
          return;
        }
        float seed = aExtra.w;
        vec3 p = motion(age);
        // Paper drifts side to side once it has slowed down.
        float flutter = aExtra.x * min(age, 1.0);
        p.x += sin(age * 3.1 + seed * 6.28) * flutter;
        p.z += cos(age * 2.7 + seed * 9.1) * flutter;
        p.y = max(p.y, 0.015);

        vec3 axis = normalize(vec3(sin(seed * 12.9), cos(seed * 7.3), sin(seed * 3.7 + 1.0)));
        float angle = age * aExtra.y + seed * 6.28;
        float shrink = 1.0 - smoothstep(life * 0.75, life, age);
        vec3 corner = vec3(position.x * aLook.w * aExtra.z, position.y * aLook.w, 0.0) * shrink;
        p += rotateAround(corner, axis, angle);
        vNormal = rotateAround(vec3(0.0, 0.0, 1.0), axis, angle);
        vColor = aLook.rgb;

        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      varying vec3 vColor;
      varying vec3 vNormal;
      #include <fog_pars_fragment>
      void main() {
        float lit = abs(dot(normalize(vNormal), uSunDir));
        vec3 color = vColor * (uSkyColor * 0.9 + uSunColor * (0.25 + 0.5 * lit));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    side: DoubleSide,
    fog: true,
  })
}

/** Glowing streaks drawn from where a spark was `trail` seconds ago to where it is. aExtra: trail, flicker, -, seed. */
function sparksMaterial(uTime: { value: number }) {
  return new ShaderMaterial({
    uniforms: { uTime },
    vertexShader: /* glsl */ `
      ${motionGlsl}
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        float age = uTime - aTiming.x;
        float life = aTiming.y;
        if (age < 0.0 || age > life) {
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
          return;
        }
        vec4 head = viewMatrix * vec4(motion(age), 1.0);
        vec4 tail = viewMatrix * vec4(motion(max(age - aExtra.x, 0.0)), 1.0);
        // Never thinner than a couple of pixels, however far away.
        float size = max(aLook.w, -head.z * 0.0035);
        vec2 dir = head.xy - tail.xy;
        float len = length(dir);
        dir = len > 1e-4 ? dir / len : vec2(0.0, 1.0);
        // Right of the direction of travel, so the quad keeps its front face toward the camera.
        vec2 side = vec2(dir.y, -dir.x);
        float along = position.y * 0.5 + 0.5;
        vec3 p = mix(tail.xyz, head.xyz, along);
        p.xy += side * position.x * size * 0.55 + dir * position.y * size;
        gl_Position = projectionMatrix * vec4(p, 1.0);

        vUv = position.xy;
        float fade = pow(1.0 - age / life, 1.6) * smoothstep(0.0, 0.08, age);
        float flicker = mix(1.0, step(0.5, fract(sin(floor(uTime * 24.0) + aExtra.w * 91.7) * 43758.5)), aExtra.y);
        vColor = aLook.rgb * fade * flicker;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        float across = 1.0 - vUv.x * vUv.x;
        float glow = across * across * mix(0.25, 1.0, vUv.y * 0.5 + 0.5);
        gl_FragColor = vec4(vColor * glow, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  })
}

const CONFETTI_COLORS = ['#ff4d6d', '#ffd166', '#06d6a0', '#1b9aaa', '#f78c6b', '#c77dff', '#ffffff'].map((c) => new Color(c))
const CHIP_COLORS = ['#3d6b1c', '#56862a', '#7a9a35', '#2f5516'].map((c) => new Color(c))
const PETAL_COLORS = ['#ffd23a', '#f2b415', '#ffe27a', '#3a2210', '#4b8a2b'].map((c) => new Color(c))
const GOLD_COLORS = ['#ffd84d', '#f5b82e', '#fff2a8'].map((c) => new Color(c))

/** HDR colours: tone mapping turns the excess into glow. */
const FIREWORK_COLORS = [
  [7, 1.2, 1.0],
  [6, 3.6, 0.9],
  [1.4, 6, 1.8],
  [1.4, 2.8, 8],
  [5, 1.4, 7],
  [6, 6, 6],
  [1.2, 6, 6.5],
].map(([r, g, b]) => new Color(r, g, b))

export type FireworkSound = { at: number; kind: 'launch' | 'burst' | 'crackle'; distance: number }

export function createParticles() {
  const uTime = { value: 0 }
  const bits = createSystem(BIT_SLOTS, bitsMaterial(uTime))
  const sparks = createSystem(SPARK_SLOTS, sparksMaterial(uTime))
  const rand = mulberry32(0xf1e5)
  const color = new Color()
  const m: Motion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, drag: 0, gravity: 0 }
  const set = (x: number, y: number, z: number, vx: number, vy: number, vz: number, drag: number, gravity: number) =>
    Object.assign(m, { x, y, z, vx, vy, vz, drag, gravity })
  const at = new Vector3()

  /** Random unit vector, written to `at`. */
  const randomDir = () => {
    const u = rand() * 2 - 1
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(1 - u * u)
    return at.set(r * Math.cos(a), u, r * Math.sin(a))
  }

  function burst(time: number, x: number, y: number, z: number, kind: number) {
    const hue = FIREWORK_COLORS[Math.floor(rand() * FIREWORK_COLORS.length)]
    const second = FIREWORK_COLORS[Math.floor(rand() * FIREWORK_COLORS.length)]
    if (kind === 0) {
      // Peony: a sphere of sparks in one or two colours.
      for (let i = 0; i < 170; i++) {
        const d = randomDir()
        const speed = 18 + rand() * 4
        set(x, y, z, d.x * speed, d.y * speed, d.z * speed, 1.6, 3)
        sparks.spawn(m, time, 2 + rand() * 0.6, i % 3 === 0 ? second : hue, 0.2, 0.18, 0, 0, rand())
      }
    } else if (kind === 1) {
      // Ring, tipped at a random angle, around a small core.
      const tilt = 0.3 + rand() * 0.8
      const turn = rand() * Math.PI * 2
      for (let i = 0; i < 110; i++) {
        const a = (i / 110) * Math.PI * 2
        const rx = Math.cos(a)
        const ry = Math.sin(a) * Math.cos(tilt)
        const rz = Math.sin(a) * Math.sin(tilt)
        const vx = rx * Math.cos(turn) - rz * Math.sin(turn)
        const vz = rx * Math.sin(turn) + rz * Math.cos(turn)
        set(x, y, z, vx * 20, ry * 20, vz * 20, 1.6, 2.5)
        sparks.spawn(m, time, 2.1, hue, 0.2, 0.16, 0, 0, rand())
      }
      for (let i = 0; i < 50; i++) {
        const d = randomDir()
        set(x, y, z, d.x * 7, d.y * 7, d.z * 7, 1.5, 2)
        sparks.spawn(m, time, 1.6, second, 0.17, 0.1, 0, 0, rand())
      }
    } else if (kind === 2) {
      // Willow: slow gold that hangs and droops.
      color.setRGB(5, 2.8, 0.8)
      for (let i = 0; i < 150; i++) {
        const d = randomDir()
        const speed = 13 + rand() * 3
        set(x, y, z, d.x * speed, d.y * speed + 3, d.z * speed, 1.1, 4.5)
        sparks.spawn(m, time, 3.2 + rand() * 0.8, color, 0.17, 0.6, 0.35, 0, rand())
      }
    } else {
      // Strobe: white sparks that flicker as they fall.
      color.setRGB(6, 6, 6)
      for (let i = 0; i < 130; i++) {
        const d = randomDir()
        const speed = 11 + rand() * 9
        set(x, y, z, d.x * speed, d.y * speed, d.z * speed, 1.4, 3)
        sparks.spawn(m, time, 2.2 + rand() * 0.8, color, 0.18, 0.08, 1, 0, rand())
      }
    }
  }

  return {
    meshes: [bits.mesh, sparks.mesh],
    /** A burst of confetti above (x, z), raining down around it. */
    confetti(x: number, z: number, time: number) {
      for (let i = 0; i < 420; i++) {
        const a = rand() * Math.PI * 2
        const out = 5 + rand() * 14
        set(x, 3.4 + rand() * 0.4, z, Math.cos(a) * out, 6 + rand() * 12, Math.sin(a) * out, 5.5, 9.8)
        const c = CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)]
        bits.spawn(m, time + rand() * 0.08, 5.5 + rand() * 2, c, 0.032, 0.35 + rand() * 0.25, 4 + rand() * 8, 1.6, rand())
      }
    },
    /** Shredded grass flying out of the mower chute, sideways along `out`. */
    chips(origin: Vector3, out: Vec2, count: number, time: number) {
      for (let i = 0; i < count; i++) {
        const speed = 2.5 + rand() * 3
        const spread = (rand() - 0.5) * 1.2
        set(
          origin.x,
          origin.y,
          origin.z,
          (out.x + -out.z * spread) * speed,
          1 + rand() * 2.2,
          (out.z + out.x * spread) * speed,
          1.8,
          9.8,
        )
        const c = CHIP_COLORS[Math.floor(rand() * CHIP_COLORS.length)]
        bits.spawn(m, time, 0.9 + rand() * 0.6, c, 0.014 + rand() * 0.012, 0, 10 + rand() * 20, 0.5 + rand() * 1.5, rand())
      }
    },
    /** A sunflower torn apart: petals and bits of stem flung out from its head. */
    petals(x: number, y: number, z: number, time: number) {
      for (let i = 0; i < 70; i++) {
        const d = randomDir()
        const speed = 1.5 + rand() * 3
        set(x, y, z, d.x * speed, Math.abs(d.y) * speed + 1, d.z * speed, 2.5, 6)
        const c = PETAL_COLORS[Math.floor(rand() * PETAL_COLORS.length)]
        bits.spawn(m, time, 1.6 + rand() * 1.2, c, 0.03 + rand() * 0.02, 0.25, 6 + rand() * 10, 0.6, rand())
      }
    },
    /** Gold flecks bursting up from a sunflower snipped clean. */
    sparkle(x: number, y: number, z: number, time: number) {
      for (let i = 0; i < 60; i++) {
        const a = rand() * Math.PI * 2
        const out = 0.8 + rand() * 2
        set(x, y, z, Math.cos(a) * out, 2.5 + rand() * 3, Math.sin(a) * out, 3, 5)
        const c = GOLD_COLORS[Math.floor(rand() * GOLD_COLORS.length)]
        bits.spawn(m, time + rand() * 0.1, 1.4 + rand(), c, 0.02, 0.15, 8 + rand() * 8, 1, rand())
      }
    },
    /**
     * A fireworks show around `centre`, about `seconds` long, starting at `time`. Returns when and where
     * each launch and burst happens so the audio can be scheduled to match.
     */
    fireworks(centre: Vec2, viewer: Vec2, time: number, seconds: number) {
      const sounds: FireworkSound[] = []
      const rockets = Math.round(seconds * 0.85)
      const rocket = new Color(4, 2.4, 1.2)
      for (let r = 0; r < rockets; r++) {
        // Steady at first, then a dense finale.
        const finale = r >= rockets - 7
        const launchAt = time + (finale ? seconds - 3 + rand() * 1.6 : (r / (rockets - 7)) * (seconds - 4) + rand() * 0.6)
        const x = centre.x + (rand() - 0.5) * 60
        const z = centre.z + (rand() - 0.5) * 30
        set(x, 0, z, (rand() - 0.5) * 3, 28 + rand() * 7, (rand() - 0.5) * 3, 0.25, 9.8)
        const fuse = 1.4 + rand() * 0.4
        sparks.spawn(m, launchAt, fuse, rocket, 0.12, 0.3, 0.3, 0, rand())
        const top = motion(m, fuse, at)
        const distance = Math.hypot(top.x - viewer.x, top.z - viewer.z)
        sounds.push({ at: launchAt - time, kind: 'launch', distance })
        const kind = Math.floor(rand() * 4)
        burst(launchAt + fuse, top.x, top.y, top.z, kind)
        sounds.push({ at: launchAt + fuse - time, kind: 'burst', distance })
        if (kind >= 2) sounds.push({ at: launchAt + fuse + 0.5 - time, kind: 'crackle', distance })
      }
      return sounds
    },
    update(time: number) {
      uTime.value = time
      bits.update(time)
      sparks.update(time)
    },
  }
}

export type Particles = ReturnType<typeof createParticles>
