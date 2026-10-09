import { BLADE_COUNT } from './field'
import { levelRange, MAX_LEVEL, TOOLS, type ToolId } from './tools'

const fmt = new Intl.NumberFormat('en-US')
const TOTAL = fmt.format(BLADE_COUNT)
const NAME_KEY = 'grass-cutter/name'

export type MenuKind = 'welcome' | 'continue' | 'paused' | 'finished'

/** What the menu reports about your progress. */
export type Progress = { cut: number; level: number; minutes: number }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

export function formatMinutes(minutes: number) {
  return `${fmt.format(minutes)} minute${minutes === 1 ? '' : 's'}`
}

function readName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

type Handlers = {
  onStart: () => void
  onReset: () => void
  onCertificate: (name: string) => void
}

/** Crosshair, level and progress, toasts and the start/pause menu. Plain DOM over the canvas. */
export function createHud(root: HTMLElement, handlers: Handlers) {
  const crosshair = el('div', 'crosshair')

  const status = el('div', 'status')
  const statusTool = el('div', 'status-tool')
  const bar = el('div', 'status-bar')
  const fill = el('div', 'status-fill')
  bar.append(fill)
  const statusCount = el('div', 'status-count')
  status.append(statusTool, bar, statusCount)

  const toast = el('div', 'toast')
  const toastTitle = el('div', 'toast-title')
  const toastDetail = el('div', 'toast-detail')
  toast.append(toastTitle, toastDetail)

  const menu = el('div', 'menu')
  const title = el('h1', 'menu-title', 'Grass Cutter')
  const detail = el('p', 'menu-detail')
  const start = el('button', 'menu-start')

  const certificate = el('form', 'certificate')
  const nameInput = el('input', 'certificate-name')
  nameInput.placeholder = 'Your name'
  nameInput.maxLength = 40
  nameInput.value = readName()
  nameInput.autocomplete = 'name'
  const download = el('button', 'certificate-download', 'Download certificate')
  download.type = 'submit'
  certificate.append(nameInput, download)

  const reset = el('button', 'menu-reset', 'Start over')
  const hint = el('p', 'menu-hint')
  menu.append(title, detail, start, certificate, reset, hint)
  root.append(crosshair, status, toast, menu)

  let confirmingReset = false
  let toastTimer = 0
  let shownCount = -1
  let shownLevel = -1
  let shownTool: ToolId | null = null

  // The whole menu starts the game, except the reset button and the certificate form.
  menu.addEventListener('click', (e) => {
    if (e.target === reset || (e.target instanceof Node && certificate.contains(e.target))) return
    handlers.onStart()
  })
  reset.addEventListener('click', () => {
    if (confirmingReset) return handlers.onReset()
    confirmingReset = true
    reset.textContent = 'Click again to erase all progress'
    reset.classList.add('armed')
  })
  certificate.addEventListener('submit', (e) => {
    e.preventDefault()
    const name = nameInput.value.trim()
    try {
      localStorage.setItem(NAME_KEY, name)
    } catch {
      // The name just won't be remembered.
    }
    handlers.onCertificate(name)
  })
  // Typing a name shouldn't walk you around or toggle sound.
  nameInput.addEventListener('keydown', (e) => e.stopPropagation())

  return {
    /** Level, tool in hand and progress bar. Cheap to call every frame; only touches the DOM on change. */
    setProgress(cut: number, level: number, tool: ToolId) {
      if (cut === shownCount && level === shownLevel && tool === shownTool) return
      shownCount = cut
      shownLevel = level
      shownTool = tool
      statusTool.textContent = `Level ${level} · ${TOOLS.find((t) => t.id === tool)?.name}`
      const range = levelRange(level)
      const [from, to] = range ? [range.from, range.to] : [0, BLADE_COUNT]
      fill.style.transform = `scaleX(${Math.min(1, (cut - from) / (to - from))})`
      statusCount.textContent = cut === BLADE_COUNT ? `All ${TOTAL} blades cut` : `${fmt.format(cut)} / ${fmt.format(to)}`
    },
    setTarget(active: boolean) {
      crosshair.classList.toggle('active', active)
    },
    /** The mower needs no aim, so it hides the crosshair. */
    setCrosshair(visible: boolean) {
      crosshair.hidden = !visible
    },
    showMenu(kind: MenuKind, progress: Progress) {
      confirmingReset = false
      reset.textContent = 'Start over'
      reset.classList.remove('armed')
      title.textContent = { welcome: '', continue: 'Grass Cutter', paused: 'Paused', finished: 'Meadow cleared' }[kind]
      detail.textContent =
        kind === 'welcome'
          ? ''
          : kind === 'finished'
            ? `${TOTAL} blades in ${formatMinutes(progress.minutes)}`
            : `Level ${progress.level} · ${fmt.format(progress.cut)} of ${TOTAL} blades cut`
      start.textContent = kind === 'welcome' ? 'Click to start' : 'Click to continue'
      certificate.hidden = kind !== 'finished'
      reset.hidden = kind === 'welcome'
      hint.textContent = progress.level > 1 && progress.level <= MAX_LEVEL ? `1-${progress.level} switch tools · M toggles sound` : 'M toggles sound'
      menu.classList.toggle('welcome', kind === 'welcome')
      menu.hidden = false
      document.body.classList.add('in-menu')
    },
    hideMenu() {
      menu.hidden = true
      document.body.classList.remove('in-menu')
      nameInput.blur()
    },
    toast(message: string, seconds = 4, more = '') {
      toastTitle.textContent = message
      toastDetail.textContent = more
      toast.classList.add('visible')
      clearTimeout(toastTimer)
      toastTimer = window.setTimeout(() => toast.classList.remove('visible'), seconds * 1000)
    },
  }
}

export type Hud = ReturnType<typeof createHud>
