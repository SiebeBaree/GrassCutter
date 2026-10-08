import { BoxGeometry, CanvasTexture, Group, Mesh, MeshStandardMaterial, SRGBColorSpace } from 'three'
import { mulberry32 } from './field'

/** Where the sign stands: between the spawn point and the meadow, facing the player. */
export const SIGN = { x: 0, z: 10.4, halfWidth: 1.3 }

const BOARD_W = 2.6
const BOARD_H = 1.625
const BOARD_BOTTOM = 0.62
const FONT = '"Avenir Next", "Futura", "Trebuchet MS", system-ui, sans-serif'

type SignText = { title: string; lines: string[]; footer?: string }

const WELCOME: SignText = {
  title: 'Welcome, gardener',
  lines: ['Your job is to cut all the grass.', '5,000 blades. One at a time.', 'All you get is a nail clipper.'],
  footer: 'WASD walk     Mouse look     Click snip     Shift run     Esc pause',
}

/** Painted planks: base colour, grain, knots and seams. */
function drawWood(ctx: CanvasRenderingContext2D, w: number, h: number, planks: number, seed: number) {
  const rand = mulberry32(seed)
  const plankH = h / planks
  for (let p = 0; p < planks; p++) {
    const y0 = p * plankH
    const tone = 0.85 + rand() * 0.25
    ctx.fillStyle = `rgb(${Math.round(120 * tone)}, ${Math.round(78 * tone)}, ${Math.round(44 * tone)})`
    ctx.fillRect(0, y0, w, plankH)

    for (let g = 0; g < 70; g++) {
      const gy = y0 + rand() * plankH
      const amp = 2 + rand() * 6
      const freq = 0.002 + rand() * 0.006
      const phase = rand() * 10
      ctx.strokeStyle = rand() < 0.5 ? `rgba(60, 34, 14, ${0.1 + rand() * 0.25})` : `rgba(170, 120, 72, ${0.08 + rand() * 0.15})`
      ctx.lineWidth = 1 + rand() * 3.5
      ctx.beginPath()
      for (let x = 0; x <= w; x += 24) {
        const y = gy + Math.sin(x * freq + phase) * amp
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    const knots = Math.floor(rand() * 2.5)
    for (let k = 0; k < knots; k++) {
      const kx = rand() * w
      const ky = y0 + plankH * (0.3 + rand() * 0.4)
      const r = 10 + rand() * 18
      const gradient = ctx.createRadialGradient(kx, ky, 1, kx, ky, r * 2.2)
      gradient.addColorStop(0, 'rgba(45, 24, 10, 0.85)')
      gradient.addColorStop(0.4, 'rgba(70, 40, 18, 0.45)')
      gradient.addColorStop(1, 'rgba(70, 40, 18, 0)')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.ellipse(kx, ky, r * 2.6, r * 1.1, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    if (p > 0) {
      ctx.fillStyle = 'rgba(30, 16, 6, 0.75)'
      ctx.fillRect(0, y0 - 3, w, 6)
    }
  }

  const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75)
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(1, 'rgba(20, 10, 2, 0.45)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, w, h)
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number) {
  let s = size
  ctx.font = `${weight} ${s}px ${FONT}`
  while (ctx.measureText(text).width > maxWidth && s > 20) {
    s -= 4
    ctx.font = `${weight} ${s}px ${FONT}`
  }
}

function drawBoard(canvas: HTMLCanvasElement, text: SignText) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width: w, height: h } = canvas
  drawWood(ctx, w, h, 4, 0x5194)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(20, 8, 0, 0.55)'
  ctx.shadowOffsetX = 3
  ctx.shadowOffsetY = 4
  ctx.shadowBlur = 6
  ctx.fillStyle = '#f6e9c9'

  fitFont(ctx, text.title, 800, 168, w * 0.88)
  ctx.fillText(text.title, w / 2, h * 0.19)

  text.lines.forEach((line, i) => {
    fitFont(ctx, line, 600, 104, w * 0.9)
    ctx.fillText(line, w / 2, h * (0.42 + i * 0.135))
  })

  if (text.footer) {
    ctx.globalAlpha = 0.8
    fitFont(ctx, text.footer, 600, 58, w * 0.92)
    ctx.fillText(text.footer, w / 2, h * 0.88)
    ctx.globalAlpha = 1
  }
}

function woodTexture(seed: number, maxAnisotropy: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (ctx) drawWood(ctx, canvas.width, canvas.height, 1, seed)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = maxAnisotropy
  return texture
}

/** A wooden sign with a painted message. Call showFinished() to repaint it once the field is cleared. */
export function createSign(maxAnisotropy: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 1280
  drawBoard(canvas, WELCOME)
  const face = new CanvasTexture(canvas)
  face.colorSpace = SRGBColorSpace
  face.anisotropy = maxAnisotropy

  const wood = new MeshStandardMaterial({ map: woodTexture(0x11, maxAnisotropy), roughness: 0.85 })
  const painted = new MeshStandardMaterial({ map: face, roughness: 0.75 })

  const group = new Group()
  const board = new Mesh(new BoxGeometry(BOARD_W, BOARD_H, 0.07), [wood, wood, wood, wood, painted, wood])
  board.position.y = BOARD_BOTTOM + BOARD_H / 2
  group.add(board)

  const postGeometry = new BoxGeometry(0.13, 2.45, 0.13)
  for (const x of [-1, 1]) {
    const post = new Mesh(postGeometry, wood)
    post.position.set(x * (BOARD_W / 2 - 0.16), 2.45 / 2 - 0.05, -0.1)
    group.add(post)
  }
  const cap = new Mesh(new BoxGeometry(BOARD_W + 0.22, 0.09, 0.2), wood)
  cap.position.set(0, BOARD_BOTTOM + BOARD_H + 0.045, -0.02)
  group.add(cap)

  group.position.set(SIGN.x, 0, SIGN.z)

  return {
    group,
    showFinished(time: string) {
      drawBoard(canvas, {
        title: 'Job done',
        lines: ['You cut all 5,000 blades.', `It took you ${time}.`, 'The field thanks you.'],
      })
      face.needsUpdate = true
    },
  }
}
