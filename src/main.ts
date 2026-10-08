import { ACESFilmicToneMapping, PerspectiveCamera, Vector3, WebGLRenderer } from 'three'
import { createAudio } from './audio'
import { createClipper } from './clipper'
import { BLADE_COUNT, bladeLean, createField, createGrid, pickBlade, type Ray, type Vec2 } from './field'
import { createGrass } from './grass'
import { createHud } from './hud'
import { createPlayer } from './player'
import { BLADE, clearSave, decodeSave, loadSave, SAVE_KEY, SPAWN, writeSave } from './save'
import { createSign } from './sign'
import { createWorld } from './world'
import './style.css'

/** How far the clipper reaches from your eyes, in metres. */
const REACH = 2.1
const AUTOSAVE_SECONDS = 2

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app')

const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = ACESFilmicToneMapping
renderer.autoClear = false
app.append(renderer.domElement)

const field = createField()
const grid = createGrid(field)
const grass = createGrass(field, grid)
const world = createWorld(renderer, grass.density)
const sign = createSign(renderer.capabilities.getMaxAnisotropy())
world.scene.add(grass.standing, grass.clippings, sign.group)

const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1200)
const clipper = createClipper(renderer)
clipper.resize(camera.aspect)
const audio = createAudio()

// Restore progress. Clippings from earlier sessions start out lying on the ground.
const saved = loadSave()
const cut = new Uint8Array(BLADE_COUNT)
let cutCount = 0
let hasSave = saved !== null
let playSeconds = saved?.playSeconds ?? 0
if (saved) {
  for (let i = 0; i < BLADE_COUNT; i++) {
    if (!saved.cut[i]) continue
    cut[i] = saved.cut[i]
    grass.cut(i, -1e5, cut[i] === BLADE.fellBack)
    cutCount++
  }
}
const player = createPlayer(saved?.player ?? SPAWN)

let playing = false
let resetting = false
let saveWarned = false
let target = -1
let time = 0
let sinceSave = 0
let lookX = 0
let lookY = 0

function save() {
  if (resetting || !hasSave) return
  sinceSave = 0
  const ok = writeSave({ cut, player: player.state, playSeconds })
  if (!ok && !saveWarned) {
    saveWarned = true
    hud.toast("This browser won't let the game save", 6)
  }
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function finish() {
  const duration = formatDuration(playSeconds)
  sign.showFinished(duration)
  hud.toast(`All 5,000 blades cut in ${duration}`, 8)
}

function applyCut(i: number, state: number, startTime: number, lean: Vec2) {
  cut[i] = state
  cutCount++
  grass.cut(i, startTime, state === BLADE.fellBack, lean.x, lean.z)
  hud.setCount(cutCount)
  if (cutCount === BLADE_COUNT) finish()
}

const lean: Vec2 = { x: 0, z: 0 }
function snip() {
  clipper.snip(time)
  audio.snip()
  if (target < 0) return
  const i = target
  bladeLean(field.x[i], field.z[i], time, player.state, lean)
  // Tip it away from the player so you can watch it fall.
  const facesAway = Math.sin(field.yaw[i]) * (field.x[i] - player.state.x) + Math.cos(field.yaw[i]) * (field.z[i] - player.state.z) >= 0
  applyCut(i, facesAway ? BLADE.fellForward : BLADE.fellBack, time, lean)
  audio.rustle(0.1, 0.45, 0.8)
  target = -1
  save()
}

function lockPointer() {
  const canvas = renderer.domElement
  // Raw mouse input where supported, plain pointer lock elsewhere.
  canvas.requestPointerLock({ unadjustedMovement: true }).catch(() => canvas.requestPointerLock().catch(() => {}))
}

const hud = createHud(document.body, {
  onStart() {
    audio.unlock()
    if (!hasSave) {
      // The welcome sign only greets players without a save, so starting once creates one.
      hasSave = true
      save()
    }
    lockPointer()
  },
  onReset() {
    resetting = true
    clearSave()
    location.reload()
  },
})
hud.setCount(cutCount)
hud.showMenu(hasSave ? 'continue' : 'welcome', cutCount)
if (cutCount === BLADE_COUNT) sign.showFinished(formatDuration(playSeconds))

document.addEventListener('pointerlockchange', () => {
  playing = document.pointerLockElement === renderer.domElement
  if (playing) {
    hud.hideMenu()
  } else {
    player.releaseAll()
    hud.showMenu('paused', cutCount)
    save()
  }
})

document.addEventListener('mousemove', (e) => {
  if (!playing) return
  player.look(e.movementX, e.movementY)
  lookX += e.movementX
  lookY += e.movementY
})

document.addEventListener('mousedown', (e) => {
  if (playing && e.button === 0) snip()
})

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    audio.unlock()
    hud.toast(audio.toggleMute() ? 'Sound off' : 'Sound on', 1.5)
    return
  }
  if (playing && player.keyDown(e.code)) e.preventDefault()
})
window.addEventListener('keyup', (e) => player.keyUp(e.code))
window.addEventListener('blur', () => player.releaseAll())

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  clipper.resize(camera.aspect)
})

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    save()
    audio.suspend()
  } else {
    audio.resume()
  }
})
window.addEventListener('pagehide', save)

// Another tab saved: adopt its cuts so neither tab overwrites the other's progress.
window.addEventListener('storage', (e) => {
  if (e.key !== null && e.key !== SAVE_KEY) return
  if (e.newValue === null) {
    resetting = true
    location.reload()
    return
  }
  const other = decodeSave(e.newValue)
  if (!other) return
  const still: Vec2 = { x: 0, z: 0 }
  for (let i = 0; i < BLADE_COUNT; i++) if (other.cut[i] && !cut[i]) applyCut(i, other.cut[i], -1e5, still)
  playSeconds = Math.max(playSeconds, other.playSeconds)
})

const ray: Ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 }
const forward = new Vector3()
let last = performance.now()

renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  time += dt

  if (playing) {
    playSeconds += dt
    const steps = player.update(dt)
    const density = grass.densityAt(player.state.x, player.state.z)
    if (steps > 0 && density > 0.15) audio.rustle(0.05 + density * 0.07, 0.3)
    sinceSave += dt
    if (sinceSave > AUTOSAVE_SECONDS) save()
  }
  player.applyTo(camera)
  camera.updateMatrixWorld()
  grass.update(time, player.state.x, player.state.z)
  world.update(time)

  target = -1
  if (playing) {
    camera.getWorldDirection(forward)
    ray.ox = camera.position.x
    ray.oy = camera.position.y
    ray.oz = camera.position.z
    ray.dx = forward.x
    ray.dy = forward.y
    ray.dz = forward.z
    target = pickBlade(field, grid, cut, ray, REACH, time, player.state)
  }
  grass.setHighlight(target)
  hud.setTarget(target >= 0)

  clipper.update(time, dt, player.bob, lookX, lookY)
  lookX = 0
  lookY = 0

  renderer.clear()
  renderer.render(world.scene, camera)
  renderer.clearDepth()
  renderer.render(clipper.scene, clipper.camera)
})

// Handles for poking at the game from the console during development.
if (import.meta.env.DEV) {
  const setPlaying = (value: boolean) => {
    playing = value
    if (value) hud.hideMenu()
  }
  Object.assign(window, { game: { field, player, cut, snip, save, setPlaying, get target() { return target } } })
}
