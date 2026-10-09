import { ACESFilmicToneMapping, PerspectiveCamera, Vector3, WebGLRenderer } from 'three'
import { createAudio } from './audio'
import { downloadCertificate } from './certificate'
import { BLADE_COUNT, bladeLean, createField, forEachStandingNear, pickBlade, type Pick, type Ray, type Vec2 } from './field'
import { createGrass } from './grass'
import { createHud, formatMinutes } from './hud'
import { createMinimap } from './minimap'
import { createMower } from './mower'
import { createNoiseTexture } from './noise'
import { createParticles } from './particles'
import { createPlayer } from './player'
import { clearSave, decodeSave, loadSave, SAVE_KEY, SPAWN, writeSave } from './save'
import { createSign } from './sign'
import { CLIPPER, levelFor, MOWER, SHEARS, SICKLE, sickleSweep, TOOLS, type ToolId } from './tools'
import { createViewmodel } from './viewmodel'
import { createWorld } from './world'
import './style.css'

/** Frame rate cap while playing. Higher refresh rates would only burn battery. */
const MAX_FPS = 60
/** The scene behind the menu barely moves, so it gets half the frames. */
const MENU_FPS = 30
const AUTOSAVE_SECONDS = 3
/** Seconds of fireworks once the meadow is cleared. */
const SHOW_SECONDS = 32
/** Seconds to fade to night before the show, and back to day after it. */
const DUSK_SECONDS = 4
const DAWN_SECONDS = 7
const TOTAL = BLADE_COUNT.toLocaleString('en-US')

/** What a newly unlocked tool does, shown under "Level n". */
const UNLOCKED: Record<ToolId, string> = {
  clipper: '',
  shears: 'Shears. Each snip takes a handful of blades.',
  sickle: 'Sickle. Hold the mouse to keep swinging.',
  mower: 'Lawn mower. Walk and it cuts everything under it.',
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app')

const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
// Thin blades alias at low resolution, but past 1.5x the extra pixels cost far more than they show.
let pixelRatio = Math.min(window.devicePixelRatio, 1.5)
renderer.setPixelRatio(pixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = ACESFilmicToneMapping
renderer.autoClear = false
app.append(renderer.domElement)

// Restore progress before building the grass: it reads the cut blades once to set itself up.
const saved = loadSave()
const cut = saved?.cut ?? new Uint8Array(BLADE_COUNT)
let cutCount = cut.reduce((sum, c) => sum + c, 0)
let level = levelFor(cutCount)
let playSeconds = saved?.playSeconds ?? 0
let finishedAt = saved?.finishedAt ?? null
let hasSave = saved !== null

const field = createField()
const grass = createGrass(field, cut, createNoiseTexture())
const world = createWorld(renderer, grass.uniforms, field.edgeScale)
const sign = createSign(renderer.capabilities.getMaxAnisotropy())
const mower = createMower()
const particles = createParticles()
world.scene.add(...grass.standing, grass.clippings, sign.group, mower.group, ...particles.meshes)

const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1200)
const viewmodel = createViewmodel(renderer)
viewmodel.resize(camera.aspect)
const audio = createAudio()
const player = createPlayer(saved?.player ?? SPAWN)
const minimap = createMinimap(document.body, grass.bladesPerCell, grass.uncutPerCell)

let tool: ToolId = TOOLS[Math.min(saved?.tool ?? 0, level - 1)].id
let playing = false
let resetting = false
let saveWarned = false
let time = 0
let sinceSave = 0
let lookX = 0
let lookY = 0
let mouseHeld = false
let clickQueued = false
let readyAt = 0
let swingAt = -Infinity
let swingDone = 1
/** When the end-of-game show started, or null if it isn't running. */
let showAt: number | null = null
let certificateHinted = false

const minutesPlayed = () => Math.max(1, Math.round(playSeconds / 60))
const progress = () => ({ cut: cutCount, level, minutes: minutesPlayed() })

function save() {
  if (resetting || !hasSave) return
  sinceSave = 0
  const ok = writeSave({ cut, player: player.state, playSeconds, tool: TOOLS.findIndex((t) => t.id === tool), finishedAt })
  if (!ok && !saveWarned) {
    saveWarned = true
    hud.toast("This browser won't let the game save", 6)
  }
}

function equip(id: ToolId) {
  tool = id
  viewmodel.setTool(id, time)
  mower.show(id === 'mower', time)
  // Equipping can happen mid-frame, after the mower's usual update. Place it now so it never flashes at the origin.
  if (id === 'mower') {
    mower.update(player.state, time, false)
    mower.group.updateMatrixWorld()
  }
  hud.setCrosshair(id !== 'mower')
  clickQueued = false
  readyAt = time + 0.2
}

function levelUp(next: number) {
  level = next
  const unlocked = TOOLS[level - 1]
  equip(unlocked.id)
  particles.confetti(player.state.x, player.state.z, time)
  audio.levelUp()
  hud.toast(`Level ${level}`, 5, UNLOCKED[unlocked.id])
}

function finish() {
  finishedAt = Date.now()
  const minutes = formatMinutes(minutesPlayed())
  sign.showFinished(minutes)
  hud.toast('Meadow cleared', 8, `${TOTAL} blades in ${minutes}`)
  audio.fanfare()
  particles.confetti(player.state.x, player.state.z, time)

  // Fireworks ahead of wherever you're looking, once the sky has gone dark.
  showAt = time
  const ahead = { x: player.state.x - Math.sin(player.state.yaw) * 50, z: player.state.z - Math.cos(player.state.yaw) * 50 }
  const sounds = particles.fireworks(ahead, player.state, time + DUSK_SECONDS, SHOW_SECONDS)
  for (const s of sounds) audio.firework(s.at + DUSK_SECONDS, s.kind, s.distance)
  save()
}

/** Cuts blade i: the one place cutCount, levels and the finish are kept in step. */
function cutBlade(i: number, mowHeading?: Vec2) {
  grass.cut(i, mowHeading)
  cutCount++
  const next = levelFor(cutCount)
  if (next > level) levelUp(next)
  if (cutCount === BLADE_COUNT) finish()
}

const lean: Vec2 = { x: 0, z: 0 }
/** Cuts blade i and drops its top, tipped roughly along (awayX, awayZ). */
function fell(i: number, awayX: number, awayZ: number) {
  const facesAway = Math.sin(field.yaw[i]) * awayX + Math.cos(field.yaw[i]) * awayZ >= 0
  bladeLean(field.x[i], field.z[i], time, player.state, lean)
  grass.dropClipping(i, time, !facesAway, lean)
  cutBlade(i)
}

// Aiming for the clipper and shears, refreshed every frame.
const ray: Ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 }
const forward = new Vector3()
const pick: Pick = { blade: -1, s: 0 }
const shearsAt = { x: 0, z: 0, active: false }

function aim() {
  camera.getWorldDirection(forward)
  Object.assign(ray, { ox: camera.position.x, oy: camera.position.y, oz: camera.position.z, dx: forward.x, dy: forward.y, dz: forward.z })
  pick.blade = -1
  shearsAt.active = false
  if (tool === 'clipper') {
    pickBlade(field, cut, ray, CLIPPER.reach, time, player.state, pick)
  } else if (tool === 'shears') {
    if (pickBlade(field, cut, ray, SHEARS.reach, time, player.state, pick)) {
      Object.assign(shearsAt, { x: field.x[pick.blade], z: field.z[pick.blade], active: true })
    } else if (ray.dy < 0 && -ray.oy / ray.dy <= SHEARS.reach) {
      const s = -ray.oy / ray.dy
      Object.assign(shearsAt, { x: ray.ox + ray.dx * s, z: ray.oz + ray.dz * s, active: true })
    }
  }
}

const near: number[] = []
const collect = (i: number) => near.push(i)

/** Click or hold: snips, or starts a swing. The mower needs neither. */
function useTool() {
  const { x: px, z: pz } = player.state
  if (tool === 'clipper') {
    viewmodel.use(time)
    audio.snip()
    readyAt = time + CLIPPER.interval
    if (pick.blade >= 0) {
      fell(pick.blade, field.x[pick.blade] - px, field.z[pick.blade] - pz)
      audio.rustle(0.1, 0.45, 0.8)
    }
  } else if (tool === 'shears') {
    viewmodel.use(time)
    audio.shear()
    readyAt = time + SHEARS.interval
    if (!shearsAt.active) return
    near.length = 0
    forEachStandingNear(field, cut, shearsAt.x, shearsAt.z, SHEARS.radius, collect)
    for (const i of near) fell(i, field.x[i] - px, field.z[i] - pz)
    if (near.length) audio.rustle(Math.min(0.2, 0.06 + near.length * 0.012), 0.5, 0.75)
  } else if (tool === 'sickle') {
    viewmodel.use(time)
    audio.swoosh()
    readyAt = time + SICKLE.swing
    swingAt = time
    swingDone = 1
  }
}

/** Cuts whatever the sickle passed over since last frame: a slice of the wedge in front of you. */
function sweepSickle() {
  const elapsed = time - swingAt
  if (elapsed > SICKLE.swing * SICKLE.cutShare + 0.1) return
  const sweep = sickleSweep(elapsed)
  if (sweep >= swingDone) return
  const { x: px, z: pz, yaw } = player.state
  const fx = -Math.sin(yaw)
  const fz = -Math.cos(yaw)
  const from = sweep * SICKLE.halfArc
  const to = swingDone * SICKLE.halfArc
  swingDone = sweep
  near.length = 0
  forEachStandingNear(field, cut, px, pz, SICKLE.reach, collect)
  let cutHere = 0
  for (const i of near) {
    const dx = field.x[i] - px
    const dz = field.z[i] - pz
    if (dx * dx + dz * dz < SICKLE.inner * SICKLE.inner) continue
    // Positive angles are to your right.
    const angle = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz)
    if (angle < from || angle > to) continue
    // Swept left and away.
    fell(i, dx * 0.5 + fz * 0.8, dz * 0.5 - fx * 0.8)
    cutHere++
  }
  if (cutHere) audio.rustle(Math.min(0.22, 0.05 + cutHere * 0.006), 0.4, 0.5)
}

let mowLoad = 0
const chute = new Vector3()
const mowRadius = Math.hypot(MOWER.halfWidth, MOWER.halfLength)

/** Cuts everything under the deck and sprays it out of the chute. */
function mow(dt: number) {
  const { centre, forward: f } = mower
  near.length = 0
  forEachStandingNear(field, cut, centre.x, centre.z, mowRadius, collect)
  let mowed = 0
  for (const i of near) {
    const dx = field.x[i] - centre.x
    const dz = field.z[i] - centre.z
    if (Math.abs(dx * f.x + dz * f.z) > MOWER.halfLength || Math.abs(dx * f.z - dz * f.x) > MOWER.halfWidth) continue
    cutBlade(i, f)
    mowed++
  }
  if (mowed) particles.chips(mower.chute(chute), { x: -f.z, z: f.x }, Math.min(14, 2 + mowed), time)
  mowLoad += (Math.min(1, mowed / dt / 120) - mowLoad) * Math.min(1, dt * 6)
}

function lockPointer() {
  const canvas = renderer.domElement
  // Raw mouse input where supported, plain pointer lock elsewhere. Firefox returns undefined, not a promise.
  const plain = () => Promise.resolve(canvas.requestPointerLock()).catch(() => {})
  Promise.resolve(canvas.requestPointerLock({ unadjustedMovement: true })).catch(plain)
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
  onCertificate(name) {
    downloadCertificate({ name, minutes: minutesPlayed(), blades: BLADE_COUNT, date: new Date(finishedAt ?? Date.now()) })
  },
})

const pausedMenu = () => (finishedAt !== null ? 'finished' : 'paused')
hud.setProgress(cutCount, level, tool)
hud.showMenu(!hasSave ? 'welcome' : finishedAt !== null ? 'finished' : 'continue', progress())
equip(tool)
if (finishedAt !== null) sign.showFinished(formatMinutes(minutesPlayed()))

document.addEventListener('pointerlockchange', () => {
  playing = document.pointerLockElement === renderer.domElement
  mouseHeld = false
  clickQueued = false
  if (playing) {
    hud.hideMenu()
  } else {
    player.releaseAll()
    hud.showMenu(pausedMenu(), progress())
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
  if (!playing || e.button !== 0) return
  mouseHeld = true
  clickQueued = true
})
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseHeld = false
})

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    audio.unlock()
    hud.toast(audio.toggleMute() ? 'Sound off' : 'Sound on', 1.5)
    return
  }
  const slot = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code)
  if (playing && slot >= 0) {
    const next = TOOLS[slot]
    if (slot < level) equip(next.id)
    else hud.toast(`${next.name} unlocks at ${next.unlockAt.toLocaleString('en-US')} blades`, 2.5)
    return
  }
  if (playing && player.keyDown(e.code)) e.preventDefault()
})
window.addEventListener('keyup', (e) => player.keyUp(e.code))
window.addEventListener('blur', () => {
  player.releaseAll()
  mouseHeld = false
})

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  viewmodel.resize(camera.aspect)
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
  hasSave = true
  playSeconds = Math.max(playSeconds, other.playSeconds)
  for (let i = 0; i < BLADE_COUNT; i++) if (other.cut[i] && !cut[i]) cutBlade(i)
  if (!playing) hud.showMenu(finishedAt !== null ? 'finished' : 'continue', progress())
})

/** 1 for day, 0 for night, following the end-of-game show. */
function daylight() {
  if (showAt === null) return 1
  const t = time - showAt
  const dusk = Math.min(1, t / DUSK_SECONDS)
  const dawn = Math.min(1, Math.max(0, (t - DUSK_SECONDS - SHOW_SECONDS - 2) / DAWN_SECONDS))
  const day = 1 - dusk * dusk * (3 - 2 * dusk) + dawn * dawn * (3 - 2 * dawn)
  if (dawn >= 1) showAt = null
  return day
}

// Frame pacing: render no more than MAX_FPS (MENU_FPS behind the menu), and lower the resolution
// if the machine can't keep up.
let last = performance.now()
let measuredFrames = 0
let measuredMs = 0
let wasPlaying = false

renderer.setAnimationLoop((now) => {
  const frameMs = 1000 / (playing ? MAX_FPS : MENU_FPS)
  // Skip a display refresh only when it comes well before the next frame is due. Measuring from the
  // last frame drawn, with slack for vsync jitter, keeps 60 Hz screens at every refresh and 120 Hz at every other.
  const elapsed = now - last
  if (elapsed < frameMs * 0.65) return
  last = now
  // The clock follows real time so the fireworks stay in step with their sounds; movement takes smaller steps.
  const seconds = Math.min(0.25, elapsed / 1000)
  const dt = Math.min(0.05, seconds)
  time += seconds

  if (playing !== wasPlaying) {
    wasPlaying = playing
    measuredFrames = 0
    measuredMs = 0
  } else if (playing) {
    measuredFrames++
    measuredMs += elapsed
    if (measuredFrames === 120) {
      // Below about 45 fps on average: fewer pixels.
      if (measuredMs > 120 * frameMs * 1.35 && pixelRatio > 1) {
        pixelRatio = Math.max(1, pixelRatio - 0.25)
        renderer.setPixelRatio(pixelRatio)
      }
      measuredFrames = 0
      measuredMs = 0
    }
  }

  if (playing) {
    if (cutCount < BLADE_COUNT) playSeconds += seconds
    const steps = player.update(dt)
    const density = grass.densityAt(player.state.x, player.state.z)
    if (steps > 0 && density > 0.15) audio.rustle(0.05 + density * 0.07, 0.3)
    sinceSave += dt
    if (sinceSave > AUTOSAVE_SECONDS) save()
  }
  player.applyTo(camera)
  camera.updateMatrixWorld()

  // Nothing left to mow once the meadow is clear, so the engine stays quiet for the fireworks.
  const mowing = playing && tool === 'mower' && cutCount < BLADE_COUNT
  if (tool === 'mower') {
    mower.update(player.state, time, mowing)
    mower.group.updateMatrixWorld()
    if (mowing) mow(dt)
  }
  audio.mower(mowing, mowLoad, Math.min(1, player.speed / 4.8))

  if (playing) {
    aim()
    if ((clickQueued || mouseHeld) && time >= readyAt) {
      clickQueued = false
      useTool()
    }
    if (tool === 'sickle') sweepSickle()
  } else {
    pick.blade = -1
    shearsAt.active = false
  }
  if (pick.blade >= 0 && tool === 'clipper') grass.setHighlight(field.x[pick.blade], field.z[pick.blade], 0.001)
  else if (shearsAt.active) grass.setHighlight(shearsAt.x, shearsAt.z, SHEARS.radius)
  else grass.setHighlight(0, 0, -1)
  hud.setTarget(pick.blade >= 0 || shearsAt.active)
  hud.setProgress(cutCount, level, tool)

  if (showAt !== null) {
    const day = daylight()
    world.setDaylight(day)
    viewmodel.setDaylight(day)
  }
  if (finishedAt !== null && !certificateHinted && showAt !== null && time - showAt > DUSK_SECONDS + SHOW_SECONDS) {
    certificateHinted = true
    if (playing) hud.toast('Press Esc for your certificate', 6)
  }

  grass.update(time, camera.position, player.state, tool === 'mower' ? mower.centre : null)
  particles.update(time)
  minimap.update(time, player.state, BLADE_COUNT - cutCount)
  viewmodel.update(time, dt, player.bob, lookX, lookY)
  lookX = 0
  lookY = 0

  renderer.clear()
  renderer.render(world.scene, camera)
  if (tool !== 'mower') {
    renderer.clearDepth()
    renderer.render(viewmodel.scene, viewmodel.camera)
  }
})

// Handles for poking at the game from the console during development.
if (import.meta.env.DEV) {
  const setPlaying = (value: boolean) => {
    playing = value
    if (value) hud.hideMenu()
  }
  /** Cuts the next n standing blades, as if you had. Handy for testing level-ups and the finish. */
  const cutMany = (n: number) => {
    for (let i = 0; i < BLADE_COUNT && n > 0; i++) {
      if (cut[i]) continue
      cutBlade(i)
      n--
    }
  }
  Object.assign(window, {
    game: {
      field,
      player,
      particles,
      world,
      audio,
      cut,
      camera,
      renderer,
      save,
      setPlaying,
      cutMany,
      equip,
      useTool,
      get time() {
        return time
      },
      get tool() {
        return tool
      },
      get level() {
        return level
      },
      get cutCount() {
        return cutCount
      },
      get target() {
        return pick.blade
      },
    },
  })
}
