import { ACESFilmicToneMapping, Box3, DirectionalLight, PerspectiveCamera, PMREMGenerator, Scene, Sphere, Vector3, WebGLRenderer, type Object3D } from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { Icons } from './hud'
import { createMower } from './mower'
import { createRider } from './rider'
import { buildRobot, ROBOT_COLORS } from './robots'
import { createTrimmer } from './trimmer'
import { createHandTool } from './viewmodel'

const SIZE = 192

/**
 * Photographs each tool and a robot from the same models the game uses, for the hotbar and the shop.
 * Uses a small renderer of its own with a transparent background, then throws it away.
 */
export function renderIcons(): Icons {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.setClearColor(0x000000, 0)

  const scene = new Scene()
  const pmrem = new PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture
  pmrem.dispose()
  const light = new DirectionalLight('#fff4e0', 2.6)
  light.position.set(1, 2, 1.5)
  scene.add(light)
  const camera = new PerspectiveCamera(28, 1, 0.001, 100)
  const box = new Box3()
  const sphere = new Sphere()
  const dir = new Vector3()

  /** Frames `object` seen from `yaw` around and `pitch` above, and returns it as a PNG data URL. */
  function shoot(object: Object3D, yaw: number, pitch: number, fill = 1) {
    scene.add(object)
    object.updateMatrixWorld(true)
    box.setFromObject(object).getBoundingSphere(sphere)
    dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
    const distance = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * fill
    camera.position.copy(sphere.center).addScaledVector(dir, distance)
    camera.near = distance / 100
    camera.far = distance * 3
    camera.updateProjectionMatrix()
    camera.lookAt(sphere.center)
    renderer.clear()
    renderer.render(scene, camera)
    const url = canvas.toDataURL('image/png')
    scene.remove(object)
    return url
  }

  const hand = (id: 'clipper' | 'scissors' | 'sickle') => {
    const tool = createHandTool(id)
    tool.holder.position.set(0, 0, 0)
    return tool.holder
  }
  const trimmer = createTrimmer()
  trimmer.show(true)
  trimmer.update(0, 0, new Vector3(0, 1.15, 0.9), 0, 0, 0)
  const mower = createMower()
  mower.show(true, -Infinity)
  mower.update({ x: 0, z: 1.4, yaw: 0 }, 1, false)
  const rider = createRider()
  rider.show(true)
  rider.update({ x: 0, z: 0, yaw: 0 }, 0, false, 0)
  const robot = buildRobot(ROBOT_COLORS[0])

  const icons: Icons = {
    tools: [
      shoot(hand('clipper'), -0.52, 0.35, 0.85),
      shoot(hand('scissors'), 0.2, 1.2, 0.8),
      shoot(hand('sickle'), 0.1, 1.3, 0.95),
      shoot(trimmer.group, -1.9, 0.25, 0.9),
      shoot(mower.group, -2.4, 0.45, 0.85),
      shoot(rider.group, -2.3, 0.4, 0.85),
    ],
    robot: shoot(robot.group, -2.6, 0.2, 0.86),
  }
  renderer.dispose()
  renderer.forceContextLoss()
  return icons
}
