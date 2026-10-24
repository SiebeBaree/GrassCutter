import { el } from './hud'

/** Phones and tablets: no mouse to lock, so the game draws its own controls. */
export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches

const STICK_RADIUS = 56
/** Stick travel, as a share of its radius, that does nothing. Thumbs never rest dead centre. */
const DEAD_ZONE = 0.12
/** Look drags turn this many times further than the same distance with a mouse. */
const LOOK_SCALE = 2
/** Touches left of this share of the screen width grab the stick. */
const STICK_ZONE = 0.4

type Handlers = {
  /** The stick, -1 to 1 on each axis: x to the right, z forward. */
  move: (x: number, z: number) => void
  /** Look movement in mouse pixels. */
  look: (dx: number, dy: number) => void
  cut: (held: boolean) => void
  pause: () => void
}

/**
 * On-screen controls. A stick appears wherever a thumb lands on the left of the screen and a drag
 * anywhere else looks around. The cut button aims too, so you can hold it and sweep.
 */
export function createTouchControls(root: HTMLElement, handlers: Handlers) {
  const surface = el('div', 'touch')
  const base = el('div', 'stick')
  const knob = el('div', 'stick-knob')
  base.append(knob)
  base.hidden = true
  const cut = el('button', 'touch-cut', 'Cut')
  const pause = el('button', 'touch-pause', 'Pause')
  surface.append(base, cut, pause)
  root.append(surface)

  let stick: { id: number; x: number; y: number } | null = null
  let cutter: number | null = null
  /** Last position of every finger that looks around, the cut button's included. */
  const lookers = new Map<number, { x: number; y: number }>()

  function moveStick(dx: number, dy: number) {
    const len = Math.hypot(dx, dy)
    const travel = Math.min(1, len / STICK_RADIUS)
    const clamp = len > 0 ? (travel * STICK_RADIUS) / len : 0
    knob.style.transform = `translate(${dx * clamp}px, ${dy * clamp}px)`
    const strength = travel < DEAD_ZONE ? 0 : (travel - DEAD_ZONE) / (1 - DEAD_ZONE)
    handlers.move(len > 0 ? (dx / len) * strength : 0, len > 0 ? (-dy / len) * strength : 0)
  }

  function release(id: number) {
    if (stick?.id === id) {
      stick = null
      base.hidden = true
      handlers.move(0, 0)
    }
    if (cutter === id) {
      cutter = null
      cut.classList.remove('held')
      handlers.cut(false)
    }
    lookers.delete(id)
  }

  surface.addEventListener('pointerdown', (e) => {
    // No double-tap zoom, no long-press menu and no emulated mouse clicks behind the controls.
    e.preventDefault()
    if (e.target === pause) {
      handlers.pause()
      return
    }
    if (e.target === cut) {
      cutter = e.pointerId
      cut.classList.add('held')
      handlers.cut(true)
    } else if (!stick && e.clientX < window.innerWidth * STICK_ZONE) {
      stick = { id: e.pointerId, x: e.clientX, y: e.clientY }
      base.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
      base.hidden = false
      moveStick(0, 0)
      return
    }
    lookers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  })

  surface.addEventListener('pointermove', (e) => {
    if (stick?.id === e.pointerId) {
      moveStick(e.clientX - stick.x, e.clientY - stick.y)
      return
    }
    const last = lookers.get(e.pointerId)
    if (!last) return
    handlers.look((e.clientX - last.x) * LOOK_SCALE, (e.clientY - last.y) * LOOK_SCALE)
    last.x = e.clientX
    last.y = e.clientY
  })

  for (const kind of ['pointerup', 'pointercancel'] as const) surface.addEventListener(kind, (e) => release(e.pointerId))

  return {
    /** Lets go of everything, for when the game pauses under your fingers. */
    reset() {
      if (stick) release(stick.id)
      if (cutter !== null) release(cutter)
      lookers.clear()
    },
  }
}
