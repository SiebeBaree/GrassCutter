import { ACESFilmicToneMapping, PerspectiveCamera, Vector3, WebGLRenderer } from 'three'
import { createAudio, type Audio, type Placement } from './audio'
import { downloadCertificate } from './certificate'
import { createCows } from './cows'
import { createCutting, type Cutter } from './cutting'
import { buy, cheapestOffer, type Holdings, type Purchase } from './economy'
import { BLADE_COUNT, createField, PARKED, pickBlade, type Pick, type Ray } from './field'
import { createGrass } from './grass'
import { createHud, formatDuration } from './hud'
import { renderIcons } from './icons'
import { FARMER, ROBOT_DOOR, SPAWN, STALL, TRADE_DISTANCE } from './layout'
import { daylightAt } from './light'
import { createMinimap, type Minimap } from './minimap'
import { createMower } from './mower'
import { createNoiseTexture } from './noise'
import { createParticles } from './particles'
import { createPlayer } from './player'
import { createRider } from './rider'
import { createRobots } from './robots'
import { clearSave, loadSave, writeSave, type Save } from './save'
import { createShop } from './shop'
import { createSign } from './sign'
import type { Flower } from './sunflowers'
import { createSunflowers } from './sunflowers'
import { CLIPPER, MOWER, RIDER, SCISSORS, SICKLE, sickleSweep, SUNFLOWER_VALUE, TIERS, TOOLS, TRIMMER, UFO_GRASS, type Tier, type ToolId } from './tools'
import { createTrimmer } from './trimmer'
import { createUfo, type Sighting } from './ufo'
import { createViewmodel } from './viewmodel'
import { createWorld } from './world'
import './style.css'

/** Frame rate cap while playing. Higher refresh rates would only burn battery. */
const MAX_FPS = 60
/** The scene behind a menu or the shop barely moves, so it gets half the frames. */
const MENU_FPS = 30
const AUTOSAVE_SECONDS = 5
/** Seconds of fireworks once the meadow is cleared. */
const SHOW_SECONDS = 32
/** Seconds to fade to night before the show, and back to day after it. */
const DUSK_SECONDS = 4
const DAWN_SECONDS = 7
/** How you bend the grass, on foot and on the riding mower. */
const PUSH = { body: [0.9, 0.32], rider: [1.4, 0.55], deck: [1.0, 0.5] } as const

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

/**
 * One tab at a time. Two tabs would each spend the same bCoins. Resolves false if another tab
 * already holds the game; this tab then shows a notice and never saves.
 */
function claimTab() {
  if (!navigator.locks) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    navigator.locks
      .request('grass-cutter', { ifAvailable: true }, (lock) => {
        resolve(lock !== null)
        // Hold the lock for as long as this tab lives.
        return lock ? new Promise<void>(() => {}) : undefined
      })
      // Some sandboxed pages can't take locks at all. Play anyway.
      .catch(() => resolve(true))
  })
}

const ownsTab = await claimTab()
const field = createField()
// Restore progress before building the grass: it reads the blades once to set itself up.
const saved = ownsTab ? await loadSave(field.cellBlade) : null
const growth = saved?.growth ?? new Uint8Array(BLADE_COUNT).fill(255)
const holdings: Holdings = { coins: saved?.coins ?? 0, tier: saved?.tier ?? 0, robots: saved?.robots ?? [] }
let earned = saved?.earned ?? 0
let playSeconds = saved?.playSeconds ?? 0
let finishedAt = saved?.finishedAt ?? null
let hasSave = saved !== null

let minimap: Minimap | null = null
const grass = createGrass(field, growth, createNoiseTexture(), (d) => minimap?.cellChanged(d))
grass.restoreAlien(saved?.alien ?? [])
const world = createWorld(renderer, grass.uniforms, field.edgeScale)
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
const sign = createSign(maxAnisotropy)
const shop = createShop(maxAnisotropy)
const mower = createMower()
const rider = createRider()
const trimmer = createTrimmer()
const particles = createParticles()
const sunflowers = createSunflowers(field, saved ? saved.sunflowers : null)
const audio = createAudio()
const player = createPlayer(saved?.player ?? SPAWN)

let time = 0

/** Volume and pan for a sound made at (x, z), heard from where you stand. */
function placement(x: number, z: number): Placement {
  const { x: px, z: pz, yaw } = player.state
  const dx = x - px
  const dz = z - pz
  const d = Math.hypot(dx, dz)
  return { volume: Math.min(1, 3 / Math.max(3, d)) ** 1.4, pan: d > 0.5 ? ((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d) * 0.8 : 0 }
}

function earn(amount: number) {
  holdings.coins += amount
  earned += amount
}

function onFlower(flower: Flower, harvested: boolean, by: Cutter) {
  const at = placement(flower.x, flower.z)
  const head = 1.9 * (0.25 + 0.75 * flower.grown)
  if (harvested) {
    earn(SUNFLOWER_VALUE)
    audio.harvest(at)
    particles.sparkle(flower.x, head, flower.z, time)
    hud.toast(`+${SUNFLOWER_VALUE} bCoins`, 3, by === 'you' ? 'Sunflower, snipped clean' : `Robot ${by + 1} picked a sunflower`)
  } else {
    audio.ruin(at)
    particles.petals(flower.x, head, flower.z, time)
    if (by === 'you') hud.toast('Sunflower ruined', 3.5, 'Only clippers and scissors harvest them')
    else if (at.volume > 0.1) hud.toast('Sunflower ruined', 3, `Robot ${by + 1} mowed it down`)
  }
}

const cutting = createCutting(field, growth, grass, sunflowers, { onFlower })
const robots = createRobots(field, growth, grass, sunflowers, cutting, holdings.robots, {
  onCut: (count) => earn(count),
  onSound(kind, x, z) {
    const at = placement(x, z)
    if (at.volume < 0.06) return
    if (kind === 'snip') audio.snip({ ...at, volume: at.volume * 0.5 })
    else if (kind === 'shear') audio.shear({ ...at, volume: at.volume * 0.5 })
    else if (kind === 'swoosh') audio.swoosh({ ...at, volume: at.volume * 0.5 })
    else audio.beep(at)
  },
  onEngines(kind, distance) {
    audio.engine('robots', kind, kind !== null, 0.5, 0.5, Math.min(1, 4 / Math.max(4, distance)) * 0.8)
  },
})
robots.tidy()
const cows = createCows(field, growth, grass, sunflowers, saved?.cows ?? [], {
  onPat(x, z) {
    const at = placement(x, z)
    audio.plop(at)
    if (at.volume > 0.05) hud.toast('A cow left a pat', 3.5, 'The grass around it grows back, with a sunflower')
  },
  onMoo(x, z) {
    const at = placement(x, z)
    if (at.volume > 0.02) audio.moo(at)
  },
})
const ufo = createUfo(field)
world.scene.add(...grass.meshes, grass.clippings, sign.group, shop.group, mower.group, rider.group, trimmer.group, sunflowers.mesh, robots.group, cows.group, ufo.group, ...particles.meshes)

const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1500)
const viewmodel = createViewmodel(renderer)
viewmodel.resize(camera.aspect)
minimap = createMinimap(document.body, grass.bladesPerCell, grass.uncutPerCell)

let tool: Tier = saved?.tool ?? 0
let playing = false
let resetting = false
let saveWarned = false
let sinceSave = 0
let lookX = 0
let lookY = 0
let mouseHeld = false
let clickQueued = false
let readyAt = 0
let swingAt = -Infinity
let swingDone = 1
let wheelSteps = 0
let shopRefreshedAt = 0
/** When the end-of-game show started, or null if it isn't running. */
let showAt: number | null = null
let certificateHinted = false
/** Seconds into the day-night cycle. Picks up from your play time, and keeps turning after the meadow is done. */
let clock = playSeconds
let mooedAt = -Infinity
let ufoHum: ReturnType<Audio['ufo']> = null

const toolId = (): ToolId => TOOLS[tool].id
const minutesPlayed = () => Math.max(1, Math.round(playSeconds / 60))
const cutShare = () => 1 - grass.standing / BLADE_COUNT
const progress = () => ({ share: cutShare(), coins: holdings.coins, minutes: minutesPlayed() })

function snapshot(): Save {
  return {
    growth,
    coins: holdings.coins,
    earned,
    tier: holdings.tier,
    tool,
    robots: holdings.robots,
    sunflowers: sunflowers.positions(),
    player: player.state,
    playSeconds,
    finishedAt,
    cows: cows.states.map((c) => ({ ...c })),
    alien: grass.alienBlades(),
  }
}

function save() {
  if (resetting || !hasSave || !ownsTab) return
  sinceSave = 0
  void writeSave(snapshot(), field.cellBlade, () => !resetting).then((ok) => {
    if (!ok && !saveWarned) {
      saveWarned = true
      hud.toast("This browser won't let the game save", 6)
    }
  })
}

/** Puts the machines where they belong this frame, so a fresh one never flashes at the origin. */
function placeMachines(running: boolean) {
  const id = toolId()
  if (id === 'mower') mower.update(player.state, time, running)
  if (id === 'rider') rider.update(player.state, time, running, player.steer)
  mower.group.updateMatrixWorld()
  rider.group.updateMatrixWorld()
}

function equip(next: Tier) {
  tool = next
  const id = toolId()
  viewmodel.setTool(id, time)
  mower.show(id === 'mower', time)
  rider.show(id === 'rider')
  trimmer.show(id === 'trimmer')
  player.setGait(id === 'mower' ? 'push' : id === 'rider' ? 'ride' : 'walk')
  placeMachines(false)
  if (id === 'trimmer') {
    Object.assign(trim, { ahead: 1.4, spin: 0 })
    placeTrimmer(Infinity)
  }
  hud.setCrosshair(id !== 'mower' && id !== 'rider')
  clickQueued = false
  readyAt = time + 0.2
}

function finish() {
  finishedAt = Date.now()
  const duration = formatDuration(minutesPlayed())
  sign.showFinished(duration)
  hud.toast('Meadow cleared', 8, `Every blade, in ${duration}`)
  audio.fanfare()
  particles.confetti(player.state.x, player.state.z, time)

  // Fireworks ahead of wherever you're looking, once the sky has gone dark.
  showAt = time
  const ahead = { x: player.state.x - Math.sin(player.state.yaw) * 60, z: player.state.z - Math.cos(player.state.yaw) * 60 }
  const sounds = particles.fireworks(ahead, player.state, time + DUSK_SECONDS, SHOW_SECONDS)
  for (const s of sounds) audio.firework(s.at + DUSK_SECONDS, s.kind, s.distance)
  save()
}

// Aiming, refreshed every frame: the blade or flower under the crosshair and the scissors' spot.
const ray: Ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 }
const forward = new Vector3()
const pick: Pick = { blade: -1, s: 0 }
let flowerTarget: Flower | null = null
const scissorsAt = { x: 0, z: 0, active: false }
/**
 * The trimmer head on the ground: how far ahead of you it is, which way from you it points (a yaw) and how
 * fast its line spins (0 to 1).
 */
const trim = { x: 0, z: 0, ahead: 1.4, heading: 0, spin: 0 }

/**
 * Puts the trimmer head `trim.ahead` metres from you, swung up to `turn` radians toward where you look.
 * It always moves with you; only the swing is limited.
 */
function placeTrimmer(turn: number) {
  const { x, z, yaw } = player.state
  const behind = Math.atan2(Math.sin(yaw - trim.heading), Math.cos(yaw - trim.heading))
  trim.heading += Math.max(-turn, Math.min(turn, behind))
  trim.x = x - Math.sin(trim.heading) * trim.ahead
  trim.z = z - Math.cos(trim.heading) * trim.ahead
}

function aim() {
  camera.getWorldDirection(forward)
  Object.assign(ray, { ox: camera.position.x, oy: camera.position.y, oz: camera.position.z, dx: forward.x, dy: forward.y, dz: forward.z })
  pick.blade = -1
  flowerTarget = null
  scissorsAt.active = false
  const id = toolId()
  if (id !== 'clipper' && id !== 'scissors') return
  const reach = id === 'clipper' ? CLIPPER.reach : SCISSORS.reach
  const flower = sunflowers.pick(ray, reach)
  pickBlade(field, growth, ray, reach, time, grass.pushers, pick, grass.alien)
  if (flower.flower && (pick.blade < 0 || flower.s < pick.s)) {
    flowerTarget = flower.flower
    pick.blade = -1
    return
  }
  if (id !== 'scissors') return
  if (pick.blade >= 0) {
    Object.assign(scissorsAt, { x: field.x[pick.blade], z: field.z[pick.blade], active: true })
  } else if (ray.dy < 0 && -ray.oy / ray.dy <= SCISSORS.reach) {
    const s = -ray.oy / ray.dy
    Object.assign(scissorsAt, { x: ray.ox + ray.dx * s, z: ray.oz + ray.dz * s, active: true })
  }
}

/** Click or hold: snips, or starts a swing. The trimmer and mowers work on their own. */
function useTool() {
  const id = toolId()
  const me = player.state
  if (id === 'clipper') {
    viewmodel.use(time)
    audio.snip()
    readyAt = time + CLIPPER.interval
    if (flowerTarget) cutting.pickFlower(flowerTarget, 'clipper', me, time, 'you')
    else if (pick.blade >= 0) {
      earn(cutting.snip(pick.blade, me, time))
      audio.rustle(0.1, 0.45, 0.8)
    }
  } else if (id === 'scissors') {
    viewmodel.use(time)
    audio.shear()
    readyAt = time + SCISSORS.interval
    if (flowerTarget) cutting.pickFlower(flowerTarget, 'scissors', me, time, 'you')
    else if (scissorsAt.active) {
      const cut = cutting.circle(scissorsAt.x, scissorsAt.z, SCISSORS.radius, 'scissors', me, time, 'you')
      earn(cut)
      if (cut) audio.rustle(Math.min(0.2, 0.06 + cut * 0.012), 0.5, 0.75)
    }
  } else if (id === 'sickle') {
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
  const cut = cutting.wedge(player.state, SICKLE.inner, SICKLE.reach, sweep * SICKLE.halfArc, swingDone * SICKLE.halfArc, time, 'you')
  swingDone = sweep
  earn(cut)
  if (cut) audio.rustle(Math.min(0.22, 0.05 + cut * 0.006), 0.4, 0.5)
}

let mowLoad = 0
const chute = new Vector3()
const hands = new Vector3()

/** The machines do their own cutting: the trimmer's head, or whatever passes under a mower deck. */
function runMachines(dt: number) {
  const id = toolId()
  const me = player.state
  let cut = 0
  if (id === 'trimmer') {
    // The head aims for where the crosshair meets the ground, within reach of the handle. Walking carries
    // it with you; turning swings it after your view no faster than TRIMMER.sweep.
    const want = ray.dy < 0 ? Math.hypot(ray.dx, ray.dz) * (-ray.oy / ray.dy) : TRIMMER.far
    trim.ahead += (Math.max(TRIMMER.near, Math.min(TRIMMER.far, want)) - trim.ahead) * Math.min(1, dt * TRIMMER.follow)
    placeTrimmer((TRIMMER.sweep * dt) / trim.ahead)
    trim.spin = Math.max(0, Math.min(1, trim.spin + (mouseHeld ? dt * 6 : -dt * 2)))
    if (trim.spin > 0.6) {
      cut = cutting.circle(trim.x, trim.z, TRIMMER.radius, 'trimmer', me, time, 'you')
      if (cut) particles.chips(chute.set(trim.x, 0.15, trim.z), { x: trim.x - me.x, z: trim.z - me.z }, Math.min(8, 1 + cut), time)
    }
  } else if (id === 'mower') {
    cut = cutting.deck(mower.centre, mower.forward, MOWER.halfLength, MOWER.halfWidth, 'mower', time, 'you')
    const f = mower.forward
    if (cut) particles.chips(mower.chute(chute), { x: -f.z, z: f.x }, Math.min(14, 2 + cut), time)
  } else if (id === 'rider') {
    cut = cutting.deck(rider.centre, rider.forward, RIDER.halfLength, RIDER.halfWidth, 'rider', time, 'you')
    const f = rider.forward
    if (cut) particles.chips(rider.chute(chute), { x: -f.z, z: f.x }, Math.min(18, 3 + cut / 2), time)
  }
  earn(cut)
  mowLoad += (Math.min(1, cut / dt / (id === 'rider' ? 260 : 120)) - mowLoad) * Math.min(1, dt * 6)
}

function lockPointer() {
  const canvas = renderer.domElement
  // Raw mouse input where supported, plain pointer lock elsewhere. Firefox returns undefined, not a promise.
  const plain = () => Promise.resolve(canvas.requestPointerLock()).catch(() => {})
  Promise.resolve(canvas.requestPointerLock({ unadjustedMovement: true })).catch(plain)
}

// What the farmer says. He greets you, then pitches whatever's cheapest, with the odd aside.
const GREETINGS = ['Howdy! Come take a look.', 'Back again? Come on over.', "Morning! Clippers won't get you far."]
const THANKS = ['Pleasure doing business.', 'Treat it well.', 'Good choice. Mind the sunflowers.']
let lastLine = ''

function offerName(purchase: Purchase) {
  if (purchase.kind === 'tool') return `the ${TOOLS[holdings.tier + 1].name.toLowerCase()}`
  if (purchase.kind === 'robot') return 'a robot'
  const robot = holdings.robots[purchase.robot]
  return `a ${TOOLS[robot.tier + 1].name.toLowerCase()} for robot ${purchase.robot + 1}`
}

function pitch(first: boolean) {
  const pick = (lines: string[]) => {
    const fresh = lines.filter((l) => l !== lastLine)
    lastLine = fresh[Math.floor(Math.random() * fresh.length)] ?? lines[0]
    return lastLine
  }
  if (first) return pick(GREETINGS)
  const offer = cheapestOffer(holdings)
  if (!offer) return pick(["I'm sold out. Go finish that meadow.", 'Nothing left to sell you. Nice work.'])
  const name = offerName(offer.purchase)
  const lines = [
    offer.price <= holdings.coins ? `You can afford ${name}. Say the word.` : `${name[0].toUpperCase()}${name.slice(1)}, ${offer.price.toLocaleString('en-US')} bCoins. You're getting there.`,
    `I pay ${SUNFLOWER_VALUE} for every sunflower cut by hand. Mowed ones are no use to me.`,
  ]
  if (holdings.robots.length < 3) lines.push('A robot cuts while you cut. Never takes a break.')
  if (toolId() === 'clipper') lines.push('Nail clippers? Brave.')
  if (toolId() === 'rider') lines.push('Nice ride.')
  return pick(lines)
}

const nearFarmer = () => Math.hypot(player.state.x - FARMER.x, player.state.z - FARMER.z) < TRADE_DISTANCE + (toolId() === 'rider' ? 1 : 0)

function openShop() {
  mouseHeld = false
  hud.openShop(holdings)
  hud.setPrompt(false)
  shop.say(holdings.coins < (cheapestOffer(holdings)?.price ?? 0) ? 'Just looking? No charge for that.' : 'What can I get you?', time)
  document.exitPointerLock()
}

function closeShop(relock: boolean) {
  hud.closeShop()
  save()
  if (relock) lockPointer()
  else hud.showMenu(pausedMenu(), progress())
}

const hud = createHud(document.body, {
  onStart() {
    if (!ownsTab) return
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
    downloadCertificate({ name, duration: formatDuration(minutesPlayed()), robots: holdings.robots.length, date: new Date(finishedAt ?? Date.now()) })
  },
  onBuy(purchase) {
    if (!buy(holdings, purchase, { ...ROBOT_DOOR, yaw: 0 })) {
      shop.say("You're a little short. Keep cutting.", time)
      return
    }
    audio.kaching()
    if (purchase.kind === 'tool') {
      equip(holdings.tier)
      shop.say(THANKS[Math.floor(Math.random() * THANKS.length)], time)
      if (holdings.tier >= 4) particles.confetti(STALL.x, STALL.z, time)
    } else {
      robots.sync()
      const n = purchase.kind === 'robot' ? holdings.robots.length : purchase.robot + 1
      shop.say(purchase.kind === 'robot' ? `Robot ${n} is ready. It finds work on its own.` : `Robot ${n} will put that to good use.`, time)
      audio.beep(placement(ROBOT_DOOR.x, ROBOT_DOOR.z))
      if (purchase.kind === 'robot') particles.confetti(ROBOT_DOOR.x, ROBOT_DOOR.z, time)
    }
    hud.refreshShop(holdings)
    save()
  },
  onLeaveShop() {
    closeShop(true)
  },
})
hud.setIcons(renderIcons())

const pausedMenu = () => (finishedAt !== null ? 'finished' : 'paused')
hud.update(holdings.coins, cutShare(), holdings.tier, tool)
hud.showMenu(!ownsTab ? 'busy' : !hasSave ? 'welcome' : finishedAt !== null ? 'finished' : 'continue', progress())
equip(tool)
if (finishedAt !== null) sign.showFinished(formatDuration(minutesPlayed()))
document.querySelector('#loading')?.remove()

document.addEventListener('pointerlockchange', () => {
  playing = document.pointerLockElement === renderer.domElement
  mouseHeld = false
  clickQueued = false
  if (playing) {
    hud.hideMenu()
    if (hud.shopOpen) hud.closeShop()
  } else {
    player.releaseAll()
    if (!hud.shopOpen) hud.showMenu(pausedMenu(), progress())
    save()
  }
})
// Pointer lock can be refused, for instance right after leaving it. Fall back to the menu.
document.addEventListener('pointerlockerror', () => {
  if (!playing && !hud.shopOpen) hud.showMenu(pausedMenu(), progress())
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

// The scroll wheel steps through the tools you own.
document.addEventListener(
  'wheel',
  (e) => {
    if (!playing) return
    wheelSteps += e.deltaY
    if (Math.abs(wheelSteps) < 40) return
    const step = Math.sign(wheelSteps)
    wheelSteps = 0
    const owned = holdings.tier + 1
    const next = (((tool + step) % owned) + owned) % owned
    equip(TIERS[next])
  },
  { passive: true },
)

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    audio.unlock()
    hud.toast(audio.toggleMute() ? 'Sound off' : 'Sound on', 1.5)
    return
  }
  // Holding E would flip the shop open and shut at key-repeat speed.
  if (e.code === 'KeyE' && e.repeat) return
  if (hud.shopOpen) {
    // E goes straight back to the meadow. Esc can't take the pointer back, so it pauses instead.
    if (e.code === 'KeyE') closeShop(true)
    else if (e.code === 'Escape') closeShop(false)
    return
  }
  if (playing && e.code === 'KeyE' && nearFarmer()) {
    openShop()
    return
  }
  const slot = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(e.code)
  if (playing && slot >= 0) {
    if (slot <= holdings.tier) equip(TIERS[slot])
    else hud.toast(`${TOOLS[slot].name}: ${TOOLS[slot].price.toLocaleString('en-US')} bCoins`, 2.5, 'For sale at the farm shop')
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

/** 1 for day, 0 for night, following the end-of-game show. */
function showDaylight() {
  if (showAt === null) return 1
  const t = time - showAt
  const dusk = Math.min(1, t / DUSK_SECONDS)
  const dawn = Math.min(1, Math.max(0, (t - DUSK_SECONDS - SHOW_SECONDS - 2) / DAWN_SECONDS))
  const day = 1 - dusk * dusk * (3 - 2 * dusk) + dawn * dawn * (3 - 2 * dawn)
  if (dawn >= 1) showAt = null
  return day
}

const bubbleAt = new Vector3()

/** Cows are solid. Pushes you, or the mower you're behind or on, out of them; a bumped cow complains. */
function bumpCows() {
  const id = toolId()
  const me = player.state
  const [ahead, radius] = id === 'rider' ? [0.55, 1.05] : id === 'mower' ? [0.9, 0.7] : [0, 0.35]
  const fx = -Math.sin(me.yaw)
  const fz = -Math.cos(me.yaw)
  const body = { x: me.x + fx * ahead, z: me.z + fz * ahead }
  const bumped = cows.push(body, radius)
  if (!bumped) return
  me.x = body.x - fx * ahead
  me.z = body.z - fz * ahead
  if (time - mooedAt > 6) {
    mooedAt = time
    audio.moo(placement(bumped.x, bumped.z))
  }
}

/**
 * Keeps the UFO's hum where the UFO is, pitched up as it comes closer and down as it goes, and turns the
 * grass under its beam purple.
 */
function followUfo(seen: Sighting | null) {
  if (!seen) {
    ufoHum?.stop()
    ufoHum = null
    return
  }
  ufoHum ??= audio.ufo()
  // Much louder than anything on the ground, so it carries from far off.
  const at = { volume: Math.min(1, 45 / seen.distance) ** 1.3, pan: placement(seen.x, seen.z).pan }
  ufoHum?.set(at, 343 / (343 - Math.max(-150, Math.min(150, seen.closing))))
  if (seen.beamed) {
    ufoHum?.beam(at)
    grass.beam(seen.x, seen.z, UFO_GRASS.radius)
  }
  if (seen.zapped) {
    ufoHum?.zap(at)
    hud.toast('The UFO left purple grass behind', 5, `${UFO_GRASS.value} bCoins a blade, cut any way you like`)
  }
}

/** Where you and your tool bend the grass: pusher slots 0 and 1. Robots and cows fill the rest. */
function setPushers() {
  const p = grass.pushers
  const id = toolId()
  const me = player.state
  const [radius, strength] = id === 'rider' ? PUSH.rider : PUSH.body
  const body = id === 'rider' ? rider.centre : me
  p.set([body.x, body.z, radius, strength], 0)
  if (id === 'mower') p.set([mower.centre.x, mower.centre.z, PUSH.deck[0], PUSH.deck[1]], 4)
  else if (id === 'trimmer' && trim.spin > 0.3) p.set([trim.x, trim.z, TRIMMER.radius + 0.3, 0.4 * trim.spin], 4)
  else p.set([PARKED, PARKED, 1, 0], 4)
}

// Frame pacing: render no more than MAX_FPS (MENU_FPS behind the menu), and lower the resolution
// if the machine can't keep up.
let last = performance.now()
/** Milliseconds of main-thread work per frame, smoothed. Read from the console in development. */
let workMs = 0
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
  const workStart = performance.now()

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

  // The meadow lives while you're in the game: playing, or browsing the shop. Not behind the pause menu.
  const active = ownsTab && (playing || hud.shopOpen)
  const growing = active && finishedAt === null
  if (growing) playSeconds += seconds
  if (active) clock += seconds
  if (playing) {
    const steps = player.update(dt)
    bumpCows()
    const density = grass.densityAt(player.state.x, player.state.z)
    if (steps > 0 && density > 0.15) audio.rustle(0.05 + density * 0.07, 0.3)
  }
  // Robots keep earning while the shop is open, so that counts too.
  if (active) {
    sinceSave += seconds
    if (sinceSave > AUTOSAVE_SECONDS) save()
  }
  player.applyTo(camera)
  camera.updateMatrixWorld()

  // Nothing left to mow once the meadow is clear, so the engines stay quiet for the fireworks.
  const id = toolId()
  const working = playing && finishedAt === null
  placeMachines(working && (id === 'mower' || id === 'rider'))
  if (playing) aim()
  if (working) runMachines(dt)
  if (id === 'trimmer') {
    const { x, z, yaw } = player.state
    hands.set(x - Math.sin(yaw) * 0.32 + Math.cos(yaw) * 0.24, 0.98, z - Math.cos(yaw) * 0.32 - Math.sin(yaw) * 0.24)
    if (!working) trim.spin = Math.max(0, trim.spin - dt * 2)
    placeTrimmer(working ? 0 : Infinity)
    trimmer.update(trim.x, trim.z, hands, time, dt, trim.spin)
  }
  const engine = id === 'mower' || id === 'rider' || id === 'trimmer' ? id : null
  const engineOn = working && (id === 'trimmer' ? trim.spin > 0.05 : engine !== null)
  audio.engine('you', engine, engineOn, mowLoad, id === 'trimmer' ? trim.spin : Math.min(1, player.speed / 5))

  if (playing) {
    if ((clickQueued || mouseHeld) && time >= readyAt) {
      clickQueued = false
      useTool()
    }
    if (id === 'sickle') sweepSickle()
  } else {
    pick.blade = -1
    flowerTarget = null
    scissorsAt.active = false
  }
  if (pick.blade >= 0 && id === 'clipper') grass.setHighlight(field.x[pick.blade], field.z[pick.blade], 0.001)
  else if (scissorsAt.active) grass.setHighlight(scissorsAt.x, scissorsAt.z, SCISSORS.radius)
  else grass.setHighlight(0, 0, -1)
  hud.setTarget(flowerTarget ? 'flower' : pick.blade >= 0 || scissorsAt.active ? 'grass' : 'none')

  setPushers()
  robots.update(time, dt, finishedAt === null, active, player.state, player.state)
  cows.update(time, dt, active, finishedAt === null, player.state, holdings.robots, grass.pushers, 5)
  if (growing) grass.regrow(seconds)
  sunflowers.update(time, dt, growing, player.state)

  // The farmer talks while you're near, in a bubble over his hat.
  const speech = shop.update(time, player.state, active, pitch)
  if (speech) {
    bubbleAt.copy(shop.bubbleAnchor()).project(camera)
    const visible = bubbleAt.z < 1 && Math.abs(bubbleAt.x) < 1.1 && Math.abs(bubbleAt.y) < 1.1
    hud.setBubble(visible ? speech.shown || '…' : null, ((bubbleAt.x + 1) / 2) * window.innerWidth, ((1 - bubbleAt.y) / 2) * window.innerHeight)
    if (speech.blip && visible) audio.voice()
  } else {
    hud.setBubble(null)
  }
  hud.setPrompt(playing && nearFarmer())

  const day = Math.min(daylightAt(clock), showDaylight())
  world.setDaylight(day)
  viewmodel.setDaylight(day)
  audio.setNight(day < 0.5)
  followUfo(ufo.update(time, day < 0.5, active, player.state))
  if (finishedAt === null && grass.standing === 0) finish()
  if (finishedAt !== null && !certificateHinted && showAt !== null && time - showAt > DUSK_SECONDS + SHOW_SECONDS) {
    certificateHinted = true
    if (playing) hud.toast('Press Esc for your certificate', 6)
  }

  grass.update(time, camera.position)
  particles.update(time)
  minimap?.update(time, player.state, grass.standing, sunflowers.positions, robots.positions)
  viewmodel.update(time, dt, player.bob, lookX, lookY)
  lookX = 0
  lookY = 0
  hud.update(holdings.coins, cutShare(), holdings.tier, tool)
  if (hud.shopOpen && time - shopRefreshedAt > 0.25) {
    shopRefreshedAt = time
    hud.refreshShop(holdings)
  }

  renderer.clear()
  renderer.render(world.scene, camera)
  if (id === 'clipper' || id === 'scissors' || id === 'sickle') {
    renderer.clearDepth()
    renderer.render(viewmodel.scene, viewmodel.camera)
  }
  workMs += (performance.now() - workStart - workMs) * 0.05
})

// Handles for poking at the game from the console during development.
if (import.meta.env.DEV) {
  /** Cuts the next n standing blades, as if you had. Handy for testing the finish. */
  const cutMany = (n: number) => {
    for (let i = 0; i < BLADE_COUNT && n > 0; i++) {
      if (!growth[i]) continue
      grass.cut(i)
      n--
    }
  }
  Object.assign(window, {
    game: {
      field,
      grass,
      player,
      particles,
      world,
      audio,
      robots,
      sunflowers,
      holdings,
      camera,
      renderer,
      save,
      cutMany,
      equip,
      cows,
      /** Makes cow k leave a pat right now. */
      pat(k = 0) {
        cows.pat(k, time)
      },
      /** Sends a UFO over right now. */
      ufo() {
        ufo.summon(time, player.state)
      },
      /** Jumps the day-night cycle to `seconds`: 0 is morning, 420 is dusk. */
      setClock(seconds: number) {
        clock = seconds
      },
      setPlaying(value: boolean) {
        playing = value
        if (value) hud.hideMenu()
      },
      addCoins(n: number) {
        earn(n)
      },
      get time() {
        return time
      },
      get workMs() {
        return workMs
      },
      get tool() {
        return tool
      },
    },
  })
}
