import { BLADE_COUNT } from './field'

const fmt = new Intl.NumberFormat('en-US')
const TOTAL = fmt.format(BLADE_COUNT)

export type MenuKind = 'welcome' | 'continue' | 'paused'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

/** Crosshair, blade counter, toasts and the start/pause menu. Plain DOM over the canvas. */
export function createHud(root: HTMLElement, handlers: { onStart: () => void; onReset: () => void }) {
  const crosshair = el('div', 'crosshair')
  const counter = el('div', 'counter')
  const toast = el('div', 'toast')

  const menu = el('div', 'menu')
  const title = el('h1', 'menu-title', 'Grass Cutter')
  const detail = el('p', 'menu-detail')
  const start = el('button', 'menu-start')
  const reset = el('button', 'menu-reset', 'Start over')
  const hint = el('p', 'menu-hint', 'M toggles sound')
  menu.append(title, detail, start, reset, hint)
  root.append(crosshair, counter, toast, menu)

  let confirmingReset = false
  let toastTimer = 0

  // The whole menu starts the game, except the reset button.
  menu.addEventListener('click', (e) => {
    if (e.target === reset) return
    handlers.onStart()
  })
  reset.addEventListener('click', () => {
    if (confirmingReset) return handlers.onReset()
    confirmingReset = true
    reset.textContent = 'Click again to erase all progress'
    reset.classList.add('armed')
  })

  return {
    setCount(cut: number) {
      counter.textContent = cut === BLADE_COUNT ? `All ${TOTAL} blades cut` : `${fmt.format(cut)} / ${TOTAL}`
    },
    setTarget(active: boolean) {
      crosshair.classList.toggle('active', active)
    },
    showMenu(kind: MenuKind, cut: number) {
      confirmingReset = false
      reset.textContent = 'Start over'
      reset.classList.remove('armed')
      title.textContent = kind === 'paused' ? 'Paused' : 'Grass Cutter'
      detail.textContent = kind === 'welcome' ? '' : `${fmt.format(cut)} of ${TOTAL} blades cut`
      start.textContent = kind === 'welcome' ? 'Click to start' : 'Click to continue'
      reset.hidden = kind === 'welcome'
      menu.classList.toggle('welcome', kind === 'welcome')
      menu.hidden = false
      document.body.classList.add('in-menu')
    },
    hideMenu() {
      menu.hidden = true
      document.body.classList.remove('in-menu')
    },
    toast(message: string, seconds = 4) {
      toast.textContent = message
      toast.classList.add('visible')
      clearTimeout(toastTimer)
      toastTimer = window.setTimeout(() => toast.classList.remove('visible'), seconds * 1000)
    },
  }
}

export type Hud = ReturnType<typeof createHud>
