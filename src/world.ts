import {
  BackSide,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  Fog,
  IcosahedronGeometry,
  InstancedMesh,
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
  type DataTexture,
  type Vector2,
  type WebGLRenderer,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { FIELD_RADIUS, mulberry32 } from './field'
import { FOG_COLOR, FOG_FAR, FOG_NEAR, lightUniforms, SUN_COLOR, SUN_DIR, SUN_INTENSITY } from './light'

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

function createSky() {
  const fog = { r: 0, g: 0, b: 0 }
  FOG_COLOR.getRGB(fog, SRGBColorSpace)
  const material = new ShaderMaterial({
    uniforms: {
      uSunDir: lightUniforms.uSunDir,
      uFogColor: { value: new Color(fog.r, fog.g, fog.b) },
      uTime: { value: 0 },
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
      uniform vec3 uSunDir;
      uniform vec3 uFogColor;
      uniform float uTime;
      varying vec3 vDir;
      ${noiseGlsl}
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(vec3(0.5, 0.64, 0.82), vec3(0.09, 0.25, 0.66), pow(h, 0.55));
        float s = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.8, 0.55) * (pow(s, 6.0) * 0.22 + pow(s, 80.0) * 0.7);

        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.1) * 1.1 + vec2(uTime * 0.006, uTime * 0.002);
          float c = fbm(uv);
          c = smoothstep(0.52, 0.8, c) * smoothstep(0.02, 0.35, d.y);
          float lit = 0.85 + 0.35 * smoothstep(0.5, 0.75, fbm(uv + uSunDir.xz * 0.15));
          vec3 cloud = vec3(1.0, 0.97, 0.93) * lit * (1.1 + 0.6 * pow(s, 4.0));
          col = mix(col, cloud, c * 0.92);
        }
        col += vec3(1.0, 0.95, 0.85) * smoothstep(0.99975, 0.9999, s) * 30.0;

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

function createGround(density: { texture: DataTexture; rect: { value: Vector2 } }) {
  const geometry = new PlaneGeometry(700, 700, 220, 220)
  geometry.rotateX(-Math.PI / 2)
  const material = new ShaderMaterial({
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.fog),
      ...lightUniforms,
      uDensity: { value: density.texture },
      uDensityRect: density.rect,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      #include <fog_pars_vertex>
      // Flat play area, rolling hills from 70 m out.
      float hillHeight(vec2 p) {
        float r = length(p);
        float a = atan(p.y, p.x);
        float n = 0.55 + 0.25 * sin(a * 3.0 + 0.7) + 0.15 * sin(a * 7.0 + 2.1) + 0.08 * sin(a * 13.0 + 4.2);
        return smoothstep(70.0, 170.0, r) * n * 34.0;
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
      varying vec3 vWorldPos;
      #include <fog_pars_fragment>
      ${noiseGlsl}

      float meadowEdge(float a) {
        return ${FIELD_RADIUS.toFixed(2)} * (1.0 + 0.07 * sin(3.0 * a + 1.1) + 0.05 * sin(5.0 * a + 2.3) + 0.025 * sin(11.0 * a + 0.4));
      }

      void main() {
        vec2 p = vWorldPos.xz;
        vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
        if (N.y < 0.0) N = -N;
        float dist = length(cameraPosition - vWorldPos);
        float detailFade = 1.0 - smoothstep(8.0, 45.0, dist);

        float large = fbm(p * 0.07);
        float detail = noise(p * 2.7) * 0.6 + noise(p * 11.0) * 0.4;
        vec3 albedo = mix(vec3(0.05, 0.12, 0.02), vec3(0.12, 0.2, 0.035), large);
        albedo *= 1.0 + (detail - 0.5) * 0.45 * detailFade;
        float dirt = smoothstep(0.6, 0.72, fbm(p * 0.18 + 7.0));
        albedo = mix(albedo, vec3(0.13, 0.09, 0.05) * (0.85 + 0.3 * detail), dirt * 0.55);

        // Inside the meadow: soil and straw-coloured stubble where the grass grew.
        float r = length(p);
        float meadow = 1.0 - smoothstep(-0.6, 0.6, r - meadowEdge(atan(p.y, p.x)));
        vec3 stubble = mix(vec3(0.11, 0.09, 0.045), vec3(0.2, 0.19, 0.07), noise(p * 6.0) * 0.7 + large * 0.3);
        albedo = mix(albedo, stubble, meadow * 0.8);

        // Shade under standing grass. Brightens as blades get cut.
        float density = texture2D(uDensity, (p + uDensityRect.x) * uDensityRect.y).r;
        float shade = mix(1.0, 0.18, density);

        float diffuse = max(dot(N, uSunDir), 0.0);
        vec3 color = albedo * (uSkyColor * mix(1.0, 0.45, density) + uSunColor * diffuse * shade);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    fog: true,
  })
  return new Mesh(geometry, material)
}

/** Ring of low-poly trees and a few rocks around the play area. */
function createScenery() {
  const rand = mulberry32(0x7ee5)
  const pines: Matrix4[] = []
  const broadleaves: Matrix4[] = []
  const trunks: Matrix4[] = []
  const q = new Quaternion()
  const up = new Vector3(0, 1, 0)

  for (let i = 0; i < 110; i++) {
    const angle = rand() * Math.PI * 2
    const r = 33 + rand() * 32
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    const scale = 0.8 + rand() * 0.6
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
  for (let i = 0; i < 26; i++) {
    const angle = rand() * Math.PI * 2
    const r = 13 + rand() * 16
    const s = 0.2 + rand() * rand() * 0.9
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
  return mesh
}

/** Sky, ground, scenery and lights. Returns the scene plus a per-frame update. */
export function createWorld(renderer: WebGLRenderer, density: { texture: DataTexture; rect: { value: Vector2 } }) {
  const scene = new Scene()
  scene.fog = new Fog(FOG_COLOR, FOG_NEAR, FOG_FAR)

  const sky = createSky()
  scene.add(sky)

  // Bake the sky into an environment map for image-based lighting and the clipper's chrome.
  const skyScene = new Scene()
  skyScene.add(createSky())
  const pmrem = new PMREMGenerator(renderer)
  const environment = pmrem.fromScene(skyScene, 0.02, 0.1, 1000).texture
  pmrem.dispose()
  scene.environment = environment
  scene.environmentIntensity = 0.55

  const sun = new DirectionalLight(SUN_COLOR, SUN_INTENSITY * Math.PI * 0.75)
  sun.position.copy(SUN_DIR).multiplyScalar(50)
  scene.add(sun)

  scene.add(createGround(density))
  for (const mesh of createScenery()) scene.add(mesh)

  const skyTime = sky.material.uniforms.uTime
  return {
    scene,
    update(time: number) {
      skyTime.value = time
    },
  }
}
