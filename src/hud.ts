import { priceOf, type Holdings, type Purchase } from './economy'
import { ROBOT_COLORS } from './robots'
import { MAX_ROBOTS, ROBOT_PRICES, TIERS, TOOLS, type Tier } from './tools'

const fmt = new Intl.NumberFormat('en-US')
const NAME_KEY = 'grass-cutter/name'

/** `away` is the pause after a few minutes without input. */
export type MenuKind = 'welcome' | 'continue' | 'paused' | 'away' | 'finished' | 'busy'

/** What the menu reports about your progress. */
export type Progress = { share: number; coins: number; minutes: number }

/** Tool icons, rendered from the 3D models, by tier; plus the robot. */
export type Icons = { tools: string[]; robot: string }

/** What you type to erase your save. */
const RESET_WORD = 'ERASE'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

/** "3 hours 4 minutes", "1 hour", "48 minutes". */
export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const part = (n: number, unit: string) => `${fmt.format(n)} ${unit}${n === 1 ? '' : 's'}`
  if (h === 0) return part(m, 'minute')
  return m === 0 ? part(h, 'hour') : `${part(h, 'hour')} ${part(m, 'minute')}`
}

/** Share of the meadow cut, as text. Never rounds up to 100% while a blade still stands. */
export function formatShare(share: number) {
  if (share >= 1) return '100%'
  const digits = share > 0.99 ? 2 : 1
  const scale = 10 ** (digits + 2)
  return `${(Math.floor(share * scale) / 10 ** digits).toFixed(digits)}%`
}

const coin = () => el('span', 'coin', 'b')

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
  onBuy: (purchase: Purchase) => void
  onLeaveShop: () => void
}

/** Crosshair, wallet, hotbar, toasts, the farmer's speech, the shop and the menus. Plain DOM over the canvas. */
export function createHud(root: HTMLElement, handlers: Handlers) {
  const crosshair = el('div', 'crosshair')

  const wallet = el('div', 'wallet')
  const walletAmount = el('span', 'wallet-amount', '0')
  wallet.append(coin(), walletAmount, el('span', 'wallet-unit', 'bCoins'))

  const status = el('div', 'status')
  const meter = el('div', 'meter')
  const bar = el('div', 'meter-bar')
  const fill = el('div', 'meter-fill')
  bar.append(fill)
  const share = el('div', 'meter-share')
  meter.append(bar, share)
  const hotbar = el('div', 'hotbar')
  const slots = TOOLS.map((tool, k) => {
    const slot = el('div', 'slot')
    slot.title = tool.name
    const icon = el('img', 'slot-icon')
    icon.alt = ''
    slot.append(icon, el('span', 'slot-key', String(k + 1)))
    hotbar.append(slot)
    return { slot, icon }
  })
  const toolName = el('div', 'tool-name')
  status.append(toolName, meter, hotbar)

  const prompt = el('div', 'prompt')
  const promptLabel = el('span', '')
  prompt.append(el('kbd', '', 'E'), promptLabel)
  prompt.hidden = true

  const bubble = el('div', 'bubble')
  bubble.hidden = true

  const toast = el('div', 'toast')
  const toastTitle = el('div', 'toast-title')
  const toastDetail = el('div', 'toast-detail')
  toast.append(toastTitle, toastDetail)

  // Shop.
  const shop = el('div', 'shop')
  const shopPanel = el('div', 'shop-panel')
  const shopHead = el('div', 'shop-head')
  const shopCoins = el('div', 'shop-coins')
  shopHead.append(el('h2', 'shop-title', 'Farm Shop'), shopCoins)
  const toolRows = el('div', 'shop-rows')
  const robotRows = el('div', 'shop-rows')
  const leave = el('button', 'shop-leave', 'Back to the meadow')
  shopPanel.append(shopHead, el('h3', 'shop-section', 'Tools'), toolRows, el('h3', 'shop-section', 'Robots'), robotRows, leave)
  shop.append(shopPanel)
  shop.hidden = true
  leave.addEventListener('click', () => handlers.onLeaveShop())

  // Menu.
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

  // Starting over takes typing a word, so a stray click can't wipe three hours of mowing.
  const reset = el('button', 'menu-reset', 'Start over')
  const resetForm = el('form', 'certificate')
  const resetInput = el('input', 'certificate-name')
  resetInput.placeholder = `Type ${RESET_WORD} to confirm`
  resetInput.autocomplete = 'off'
  resetInput.spellcheck = false
  const resetConfirm = el('button', 'certificate-download menu-erase', 'Erase all progress')
  resetConfirm.type = 'submit'
  resetForm.append(resetInput, resetConfirm)
  resetForm.hidden = true
  const hint = el('p', 'menu-hint', '1-6 or scroll for tools · E shop · M sound')
  menu.append(title, detail, start, certificate, reset, resetForm, hint)
  root.append(crosshair, wallet, status, prompt, bubble, toast, shop, menu)

  let menuKind: MenuKind = 'welcome'
  let toastTimer = 0
  let shownCoins = -1
  let shownShare = ''
  let shownTools = ''
  let icons: Icons | null = null
  let shopKey = ''
  /** The rows rebuild after a purchase, so a double click would land on the next thing for sale. */
  let boughtAt = -Infinity

  // The whole menu starts the game, except the reset controls and the certificate form.
  menu.addEventListener('click', (e) => {
    if (menuKind === 'busy') return
    if (e.target === reset || (e.target instanceof Node && (certificate.contains(e.target) || resetForm.contains(e.target)))) return
    handlers.onStart()
  })
  const resetTyped = () => resetInput.value.trim().toUpperCase() === RESET_WORD
  reset.addEventListener('click', () => {
    reset.hidden = true
    resetForm.hidden = false
    resetInput.focus()
  })
  resetInput.addEventListener('input', () => (resetConfirm.disabled = !resetTyped()))
  resetForm.addEventListener('submit', (e) => {
    e.preventDefault()
    if (resetTyped()) handlers.onReset()
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

  function price(amount: number) {
    const tag = el('span', 'price')
    tag.append(coin(), document.createTextNode(fmt.format(amount)))
    return tag
  }

  function row(icon: string, name: string, about: string, action: HTMLElement, color?: string) {
    const r = el('div', 'shop-row')
    const img = el('img', 'shop-icon')
    img.src = icon
    img.alt = ''
    const text = el('div', 'shop-text')
    const label = el('div', 'shop-name', name)
    if (color) {
      const dot = el('span', 'shop-dot')
      dot.style.background = color
      label.prepend(dot)
    }
    text.append(label, el('div', 'shop-about', about))
    r.append(img, text, action)
    return r
  }

  function buyButton(holdings: Holdings, purchase: Purchase, label: string) {
    const cost = priceOf(holdings, purchase)
    const button = el('button', 'shop-buy')
    if (cost === null) return button
    button.append(el('span', '', label), price(cost))
    button.disabled = cost > holdings.coins
    button.addEventListener('click', (e) => {
      if (e.detail > 1 || performance.now() - boughtAt < 400) return
      boughtAt = performance.now()
      handlers.onBuy(purchase)
    })
    return button
  }

  function renderShop(h: Holdings) {
    shopCoins.replaceChildren(coin(), document.createTextNode(fmt.format(Math.floor(h.coins))))
    // Rebuild the rows only when what you own or what you can afford changed.
    const purchases: Purchase[] = [{ kind: 'tool' }, { kind: 'robot' }, ...h.robots.map((_, robot) => ({ kind: 'robotTool' as const, robot }))]
    const key = [h.tier, h.robots.map((r) => r.tier).join(), purchases.map((p) => (priceOf(h, p) ?? Infinity) <= h.coins).join()].join('|')
    if (key === shopKey || !icons) return
    shopKey = key

    toolRows.replaceChildren(
      ...TOOLS.map((tool, k) => {
        const action =
          k <= h.tier
            ? el('span', 'shop-owned', 'Owned')
            : k === h.tier + 1
              ? buyButton(h, { kind: 'tool' }, 'Buy')
              : el('span', 'shop-later', `After the ${TOOLS[k - 1].name.toLowerCase()}`)
        return row(icons?.tools[k] ?? '', tool.name, tool.about, action)
      }),
    )

    const robots: HTMLElement[] = []
    for (let k = 0; k < MAX_ROBOTS; k++) {
      const robot = h.robots[k]
      const name = `Robot ${k + 1}`
      if (robot) {
        const next = robot.tier < 5 ? TOOLS[robot.tier + 1] : null
        const action = next ? buyButton(h, { kind: 'robotTool', robot: k }, next.name) : el('span', 'shop-owned', 'Fully kitted')
        robots.push(row(icons?.robot ?? '', name, `Cuts with the ${TOOLS[robot.tier].name.toLowerCase()}`, action, ROBOT_COLORS[k]))
      } else if (k === h.robots.length) {
        robots.push(row(icons?.robot ?? '', name, 'Cuts grass on its own at half your pace. Comes with a nail clipper.', buyButton(h, { kind: 'robot' }, 'Buy'), ROBOT_COLORS[k]))
      } else {
        const later = el('span', 'shop-later')
        later.append(price(ROBOT_PRICES[k]))
        robots.push(row(icons?.robot ?? '', name, `After robot ${k}`, later, ROBOT_COLORS[k]))
      }
    }
    robotRows.replaceChildren(...robots)
  }

  return {
    setIcons(next: Icons) {
      icons = next
      slots.forEach(({ icon }, k) => (icon.src = next.tools[k]))
      shopKey = ''
    },
    /** Wallet, meadow progress and hotbar. Cheap to call every frame; only touches the DOM on change. */
    update(coins: number, cutShare: number, tier: Tier, tool: Tier, broken: ReadonlySet<Tier>) {
      const whole = Math.floor(coins)
      if (whole !== shownCoins) {
        shownCoins = whole
        walletAmount.textContent = fmt.format(whole)
      }
      const text = formatShare(cutShare)
      if (text !== shownShare) {
        shownShare = text
        share.textContent = `${text} cut`
        fill.style.transform = `scaleX(${cutShare})`
      }
      const tools = `${tool}|${tier}|${[...broken].join()}`
      if (tools !== shownTools) {
        shownTools = tools
        toolName.textContent = broken.has(tool) ? `${TOOLS[tool].name} (broken)` : TOOLS[tool].name
        slots.forEach(({ slot }, k) => {
          slot.classList.toggle('owned', k <= tier)
          slot.classList.toggle('selected', k === tool)
          slot.classList.toggle('broken', broken.has(TIERS[k]))
        })
      }
    },
    /** Normal, aimed at grass, aimed at a sunflower. */
    setTarget(target: 'none' | 'grass' | 'flower') {
      crosshair.classList.toggle('active', target !== 'none')
      crosshair.classList.toggle('flower', target === 'flower')
    },
    /** The mowers need no aim, so they hide the crosshair. */
    setCrosshair(visible: boolean) {
      crosshair.hidden = !visible
    },
    /** What E does here, or null to hide the prompt. */
    setPrompt(label: string | null) {
      prompt.hidden = label === null
      if (label !== null && promptLabel.textContent !== label) promptLabel.textContent = label
    },
    /** The farmer's words at screen position (x, y), or hide them with null. */
    setBubble(text: string | null, x = 0, y = 0) {
      if (text === null) {
        bubble.hidden = true
        return
      }
      bubble.hidden = false
      if (bubble.textContent !== text) bubble.textContent = text
      bubble.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`
    },
    get shopOpen() {
      return !shop.hidden
    },
    openShop(holdings: Holdings) {
      shopKey = ''
      renderShop(holdings)
      shop.hidden = false
      document.body.classList.add('in-shop')
    },
    /** Refreshes the shop while it's open, as robots earn. */
    refreshShop(holdings: Holdings) {
      if (!shop.hidden) renderShop(holdings)
    },
    closeShop() {
      shop.hidden = true
      document.body.classList.remove('in-shop')
    },
    showMenu(kind: MenuKind, progress: Progress) {
      menuKind = kind
      resetForm.hidden = true
      resetInput.value = ''
      resetConfirm.disabled = true
      title.textContent = { welcome: '', continue: 'Grass Cutter', paused: 'Paused', away: 'Still there?', finished: 'Meadow cleared', busy: 'Already open' }[kind]
      detail.textContent =
        kind === 'welcome'
          ? ''
          : kind === 'busy'
            ? 'Grass Cutter is running in another tab. Close it, then reload this one.'
            : kind === 'finished'
              ? `Every blade, in ${formatDuration(progress.minutes)}`
              : kind === 'away'
                ? 'The game pauses after three minutes without input'
                : `${formatShare(progress.share)} cut · ${fmt.format(Math.floor(progress.coins))} bCoins`
      start.textContent = kind === 'welcome' ? 'Click to start' : 'Click to continue'
      start.hidden = kind === 'busy'
      certificate.hidden = kind !== 'finished'
      reset.hidden = kind === 'welcome' || kind === 'busy'
      hint.hidden = kind === 'busy'
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
