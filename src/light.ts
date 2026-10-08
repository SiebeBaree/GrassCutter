import { Color, Vector3 } from 'three'

// One sun, one sky. Custom shaders read these uniforms; standard materials get a matching
// DirectionalLight plus an environment map rendered from the sky.

export const SUN_DIR = new Vector3(0.55, 0.5, 0.67).normalize()
export const SUN_INTENSITY = 2.5
export const SUN_COLOR = new Color(1.0, 0.9, 0.75)
/** Display-space haze colour. The sky fades into it at the horizon so distant things melt away. */
export const FOG_COLOR = new Color('#c4d5e3')
export const FOG_NEAR = 30
export const FOG_FAR = 210

export const lightUniforms = {
  uSunDir: { value: SUN_DIR },
  uSunColor: { value: SUN_COLOR.clone().multiplyScalar(SUN_INTENSITY) },
  uSkyColor: { value: new Color(0.3, 0.42, 0.66) },
  uGroundColor: { value: new Color(0.08, 0.09, 0.04) },
}
