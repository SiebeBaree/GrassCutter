import { Color, Vector3 } from 'three'

// One sun, one sky. Custom shaders read these uniforms; standard materials get a matching
// DirectionalLight plus an environment map rendered from the sky. setDaylight() fades all of it to
// moonlight for the fireworks at the end.

export const SUN_DIR = new Vector3(0.55, 0.5, 0.67).normalize()
export const SUN_INTENSITY = 2.5
export const SUN_COLOR = new Color(1.0, 0.9, 0.75)
export const FOG_NEAR = 70
export const FOG_FAR = 460

const DAY = {
  sun: SUN_COLOR.clone().multiplyScalar(SUN_INTENSITY),
  sky: new Color(0.3, 0.42, 0.66),
  ground: new Color(0.08, 0.09, 0.04),
  /** Display-space haze. The sky fades into it at the horizon so distant things melt away. */
  fog: new Color('#c4d5e3'),
}

const NIGHT = {
  sun: new Color(0.16, 0.22, 0.4),
  sky: new Color(0.03, 0.045, 0.09),
  ground: new Color(0.005, 0.007, 0.012),
  fog: new Color('#0c1426'),
}

export const FOG_COLOR = DAY.fog.clone()

export const lightUniforms = {
  uSunDir: { value: SUN_DIR },
  uSunColor: { value: DAY.sun.clone() },
  uSkyColor: { value: DAY.sky.clone() },
  uGroundColor: { value: DAY.ground.clone() },
}

/** 1 is full day, 0 is night. Updates the shared uniforms and FOG_COLOR in place. */
export function setDaylight(day: number) {
  lightUniforms.uSunColor.value.lerpColors(NIGHT.sun, DAY.sun, day)
  lightUniforms.uSkyColor.value.lerpColors(NIGHT.sky, DAY.sky, day)
  lightUniforms.uGroundColor.value.lerpColors(NIGHT.ground, DAY.ground, day)
  FOG_COLOR.lerpColors(NIGHT.fog, DAY.fog, day)
}
