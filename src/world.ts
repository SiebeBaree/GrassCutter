import {
  BackSide,
  BufferGeometry,
  Color,
  ConeGeometry,
  CubeCamera,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  Fog,
  HalfFloatType,
  IcosahedronGeometry,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  UniformsLib,
  UniformsUtils,
  Vector3,
  WebGLCubeRenderTarget,
  type Texture,
  type Vector2,
  type WebGLRenderer,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MEADOW_RADIUS, mulberry32 } from './field'
import { FOG_COLOR, FOG_FAR, FOG_NEAR, lightUniforms, setDaylight, SUN_COLOR, SUN_DIR, SUN_INTENSITY } from './light'

const noiseGlsl = /* glsl */ `
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + 17.0;
      a *= 0.5;
    }
    return v;
  }
`

/**
 * Renders the daytime sky with clouds into a cube map once. Drawing the sky each frame is then one
 * texture lookup per pixel instead of ten octaves of noise.
 */
function bakeDaySky(renderer: WebGLRenderer) {
  const material = new ShaderMaterial({
    uniforms: { uSunDir: lightUniforms.uSunDir },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      varying vec3 vDir;
      ${noiseGlsl}
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(vec3(0.5, 0.64, 0.82), vec3(0.09, 0.25, 0.66), pow(h, 0.55));
        float s = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.8, 0.55) * (pow(s, 6.0) * 0.22 + pow(s, 80.0) * 0.7);

        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.1) * 1.1;
          float c = fbm(uv);
          c = smoothstep(0.52, 0.8, c) * smoothstep(0.02, 0.35, d.y);
          float lit = 0.85 + 0.35 * smoothstep(0.5, 0.75, fbm(uv + uSunDir.xz * 0.15));
          vec3 cloud = vec3(1.0, 0.97, 0.93) * lit * (1.1 + 0.6 * pow(s, 4.0));
          col = mix(col, cloud, c * 0.92);
        }
        col += vec3(1.0, 0.95, 0.85) * smoothstep(0.99975, 0.9999, s) * 30.0;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: BackSide,
    depthWrite: false,
  })
  const scene = new Scene()
  const sphere = new Mesh(new SphereGeometry(10, 64, 32), material)
  scene.add(sphere)
  const target = new WebGLCubeRenderTarget(512, { type: HalfFloatType, generateMipmaps: false, minFilter: LinearFilter })
  new CubeCamera(1, 100, target).update(renderer, scene)
  sphere.geometry.dispose()
  material.dispose()
  return target.texture
}

/** The visible sky: the baked day sky, faded into a starry night by uDaylight. */
function createSky(daySky: Texture) {
  const material = new ShaderMaterial({
    uniforms: {
      uDaySky: { value: daySky },
      uDaylight: { value: 1 },
      uFogColor: { value: new Color() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform samplerCube uDaySky;
      uniform float uDaylight;
      uniform vec3 uFogColor;
      varying vec3 vDir;

      float hash3(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      void main() {
        vec3 d = normalize(vDir);
        vec3 col = textureCube(uDaySky, d).rgb;
        if (uDaylight < 1.0) {
          float h = max(d.y, 0.0);
          vec3 night = mix(vec3(0.03, 0.04, 0.09), vec3(0.004, 0.007, 0.02), pow(h, 0.5));
          // Stars: one candidate per cell of a grid on the sky, most of them dark.
          vec3 cell = floor(d * 220.0);
          float star = hash3(cell);
          vec3 offset = d * 220.0 - cell - 0.5;
          float twinkle = 0.7 + 0.3 * hash3(cell + 7.0);
          night += vec3(0.9, 0.95, 1.0) * smoothstep(0.985, 1.0, star) * smoothstep(0.3, 0.0, length(offset)) * twinkle * 2.5 * smoothstep(0.0, 0.25, d.y);
          col = mix(night, col, uDaylight);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, 1.0 - smoothstep(-0.02, 0.2, d.y));
      }
    `,
    side: BackSide,
    depthWrite: false,
  })
  const sky = new Mesh(new SphereGeometry(500, 48, 24), material)
  sky.frustumCulled = false
  sky.renderOrder = -1
  return sky
}

type GroundUniforms = {
  uDensity: { value: Texture }
  uDensityRect: { value: Vector2 }
  uNoise: { value: Texture }
  uTime: { value: number }
}

function createGround(shared: GroundUniforms, edgeScale: number) {
  const geometry = new PlaneGeometry(1000, 1000, 250, 250)
  geometry.rotateX(-Math.PI / 2)
  const material = new ShaderMaterial({
    uniforms: { ...UniformsUtils.clone(UniformsLib.fog), ...lightUniforms, ...shared },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      #include <fog_pars_vertex>
      // Flat play area, rolling hills from 90 m out.
      float hillHeight(vec2 p) {
        float r = length(p);
        float a = atan(p.y, p.x);
        float n = 0.55 + 0.25 * sin(a * 3.0 + 0.7) + 0.15 * sin(a * 7.0 + 2.1) + 0.08 * sin(a * 13.0 + 4.2);
        return smoothstep(90.0, 230.0, r) * n * 42.0;
      }
      void main() {
        vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
        p.y += hillHeight(p.xz);
        vWorldPos = p;
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      uniform sampler2D uDensity;
      uniform vec2 uDensityRect;
      uniform sampler2D uNoise;
      uniform float uTime;
      varying vec3 vWorldPos;
      #include <fog_pars_fragment>

      float meadowEdge(float a) {
        return ${(MEADOW_RADIUS * edgeScale).toFixed(3)} * (1.0 + 0.07 * sin(3.0 * a + 1.1) + 0.05 * sin(5.0 * a + 2.3) + 0.025 * sin(11.0 * a + 0.4) + 0.012 * sin(23.0 * a + 2.9));
      }

      void main() {
        vec2 p = vWorldPos.xz;
        vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
        if (N.y < 0.0) N = -N;
        float dist = length(cameraPosition - vWorldPos);
        float detailFade = 1.0 - smoothstep(8.0, 60.0, dist);

        float large = texture2D(uNoise, p * 0.004).g;
        float medium = texture2D(uNoise, p * 0.05).b;
        float fine = texture2D(uNoise, p * 0.45).a;
        float detail = medium * 0.6 + fine * 0.4;

        // Short lawn around the meadow.
        vec3 albedo = mix(vec3(0.05, 0.12, 0.02), vec3(0.12, 0.2, 0.035), large);
        albedo *= 1.0 + (detail - 0.5) * 0.5 * detailFade;
        float dirt = smoothstep(0.66, 0.78, texture2D(uNoise, p * 0.012 + 0.37).b);
        albedo = mix(albedo, vec3(0.13, 0.09, 0.05) * (0.85 + 0.3 * detail), dirt * 0.5);

        // Inside the meadow: dark soil under standing grass, fresh-cut stubble where it's gone.
        vec4 dens = texture2D(uDensity, (p + uDensityRect.x) * uDensityRect.y);
        float density = dens.r;
        float meadow = 1.0 - smoothstep(-0.8, 0.8, length(p) - meadowEdge(atan(p.y, p.x)));
        vec3 soil = vec3(0.075, 0.058, 0.032) * (0.8 + 0.4 * detail);
        // Far away the grass is drawn sparser, so the ground beneath takes on its colour.
        soil = mix(soil, vec3(0.06, 0.12, 0.022), smoothstep(20.0, 45.0, dist));
        vec3 stubble = mix(vec3(0.11, 0.19, 0.04), vec3(0.21, 0.25, 0.075), fine * 0.5 + medium * 0.3 + large * 0.4);
        // Fine grain of short grass up close.
        float grain = texture2D(uNoise, p * 2.3).a * 0.6 + texture2D(uNoise, p * 5.1).b * 0.4;
        stubble *= 1.0 + (grain - 0.5) * 0.45 * detailFade;
        // Mowing stripes: grass laid down away from you looks lighter.
        vec2 mowed = dens.gb * 2.0 - 1.0;
        float mowedLength = length(mowed);
        if (mowedLength > 0.2) {
          vec2 toView = normalize(p - cameraPosition.xz);
          stubble *= 1.0 + 0.22 * dot(mowed / mowedLength, toView);
        }
        albedo = mix(albedo, mix(stubble, soil, density), meadow);

        float shade = mix(1.0, 0.18, density);
        float clouds = mix(1.0, 0.55, smoothstep(0.52, 0.74, texture2D(uNoise, p * 0.0035 + uTime * vec2(0.0021, 0.0008)).r));
        float diffuse = max(dot(N, uSunDir), 0.0);
        vec3 color = albedo * (uSkyColor * mix(1.0, 0.45, density) + uSunColor * diffuse * shade * clouds);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    fog: true,
  })
  const ground = new Mesh(geometry, material)
  ground.matrixAutoUpdate = false
  return ground
}

/** Ring of low-poly trees and a few rocks around the meadow. */
function createScenery() {
  const rand = mulberry32(0x7ee5)
  const pines: Matrix4[] = []
  const broadleaves: Matrix4[] = []
  const trunks: Matrix4[] = []
  const q = new Quaternion()
  const up = new Vector3(0, 1, 0)

  for (let i = 0; i < 230; i++) {
    const angle = rand() * Math.PI * 2
    const r = 70 + rand() * rand() * 70
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    const scale = 0.9 + rand() * 0.9
    q.setFromAxisAngle(up, rand() * Math.PI * 2)
    const trunkHeight = (rand() < 0.55 ? 2.0 : 3.0) * scale
    const isPine = rand() < 0.55
    trunks.push(new Matrix4().compose(new Vector3(x, 0, z), q, new Vector3(scale, trunkHeight, scale)))
    const crown = new Matrix4().compose(new Vector3(x, trunkHeight * 0.85, z), q, new Vector3(scale, scale, scale))
    ;(isPine ? pines : broadleaves).push(crown)
  }

  const pineGeometry = mergeGeometries([
    new ConeGeometry(2.2, 3.6, 7).translate(0, 1.8, 0),
    new ConeGeometry(1.75, 3.2, 7).translate(0, 3.7, 0),
    new ConeGeometry(1.2, 2.8, 7).translate(0, 5.5, 0),
  ])
  const broadleafGeometry = new IcosahedronGeometry(2.6, 1)
  displace(broadleafGeometry, 0.45, 0x51)
  broadleafGeometry.translate(0, 2.2, 0)
  const trunkGeometry = new CylinderGeometry(0.16, 0.24, 1, 6).translate(0, 0.5, 0)

  const meshes = [
    instanced(pineGeometry, new MeshStandardMaterial({ color: '#2f5a2c', flatShading: true, roughness: 0.9 }), pines, rand, 0.15),
    instanced(broadleafGeometry, new MeshStandardMaterial({ color: '#4a7a2a', flatShading: true, roughness: 0.85 }), broadleaves, rand, 0.2),
    instanced(trunkGeometry, new MeshStandardMaterial({ color: '#5a4030', flatShading: true, roughness: 1 }), trunks, rand, 0.1),
  ]

  const rocks: Matrix4[] = []
  for (let i = 0; i < 40; i++) {
    const angle = rand() * Math.PI * 2
    const r = 63 + rand() * 14
    const s = 0.25 + rand() * rand() * 1.1
    q.setFromAxisAngle(new Vector3(rand(), rand(), rand()).normalize(), rand() * Math.PI)
    rocks.push(new Matrix4().compose(new Vector3(Math.cos(angle) * r, s * 0.25, Math.sin(angle) * r), q, new Vector3(s * 1.3, s * 0.7, s)))
  }
  const rockGeometry = new DodecahedronGeometry(1, 1)
  displace(rockGeometry, 0.25, 0x77)
  meshes.push(instanced(rockGeometry, new MeshStandardMaterial({ color: '#8d8a82', flatShading: true, roughness: 0.95 }), rocks, rand, 0.15))
  return meshes
}

/** Pushes vertices in or out by a hash of their position, so shared corners move together. */
function displace(geometry: BufferGeometry, amount: number, seed: number) {
  const pos = geometry.getAttribute('position')
  const v = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719 + seed) * 43758.5453
    v.multiplyScalar(1 + (h - Math.floor(h) - 0.5) * amount)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geometry.computeVertexNormals()
}

function instanced(geometry: BufferGeometry, material: MeshStandardMaterial, matrices: Matrix4[], rand: () => number, variance: number) {
  const mesh = new InstancedMesh(geometry, material, matrices.length)
  const color = new Color()
  matrices.forEach((m, i) => {
    mesh.setMatrixAt(i, m)
    const k = 1 - variance + rand() * variance * 2
    mesh.setColorAt(i, color.setRGB(k, k, k * (0.9 + rand() * 0.2)))
  })
  mesh.computeBoundingSphere()
  mesh.matrixAutoUpdate = false
  return mesh
}

/** Sky, ground, scenery and lights. Returns the scene plus a way to fade between day and night. */
export function createWorld(renderer: WebGLRenderer, grassUniforms: GroundUniforms, edgeScale: number) {
  const scene = new Scene()
  const fog = new Fog(FOG_COLOR.clone(), FOG_NEAR, FOG_FAR)
  scene.fog = fog

  const daySky = bakeDaySky(renderer)
  const sky = createSky(daySky)
  scene.add(sky)

  // Image-based lighting for the standard materials, from the same sky.
  const pmrem = new PMREMGenerator(renderer)
  scene.environment = pmrem.fromCubemap(daySky).texture
  pmrem.dispose()

  const sun = new DirectionalLight(SUN_COLOR, SUN_INTENSITY * Math.PI * 0.75)
  sun.position.copy(SUN_DIR).multiplyScalar(50)
  scene.add(sun)

  scene.add(createGround(grassUniforms, edgeScale))
  for (const mesh of createScenery()) scene.add(mesh)

  const moon = new Color(0.45, 0.55, 0.9)
  const skyUniforms = sky.material.uniforms
  const setDay = (day: number) => {
    setDaylight(day)
    fog.color.copy(FOG_COLOR)
    FOG_COLOR.getRGB(skyUniforms.uFogColor.value, SRGBColorSpace)
    skyUniforms.uDaylight.value = day
    sun.color.lerpColors(moon, SUN_COLOR, day)
    sun.intensity = SUN_INTENSITY * Math.PI * 0.75 * (0.08 + 0.92 * day)
    scene.environmentIntensity = 0.04 + 0.51 * day
  }
  setDay(1)

  return {
    scene,
    /** 1 is full day, 0 is night. */
    setDaylight: setDay,
  }
}
