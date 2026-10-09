import { mulberry32 } from './field'

// The certificate you get for clearing the meadow: drawn on a canvas and saved as a PNG.

const WIDTH = 2000
const HEIGHT = 1414
const INK = '#24461f'
const BROWN = '#6b5634'
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
const SCRIPT = '"Snell Roundhand", "Apple Chancery", "Brush Script MT", "Segoe Script", cursive'

export type CertificateInfo = { name: string; minutes: number; blades: number; date: Date }

function fitFont(ctx: CanvasRenderingContext2D, text: string, style: string, size: number, family: string, maxWidth: number) {
  let s = size
  ctx.font = `${style} ${s}px ${family}`
  while (ctx.measureText(text).width > maxWidth && s > 24) {
    s -= 4
    ctx.font = `${style} ${s}px ${family}`
  }
}

function paper(ctx: CanvasRenderingContext2D) {
  const glow = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 200, WIDTH / 2, HEIGHT / 2, WIDTH * 0.7)
  glow.addColorStop(0, '#fbf6e8')
  glow.addColorStop(1, '#eadfc2')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  // Fibres and specks.
  const rand = mulberry32(0xce57)
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(120, 95, 50, 0.05)' : 'rgba(255, 255, 255, 0.12)'
    ctx.fillRect(rand() * WIDTH, rand() * HEIGHT, 1 + rand() * 3, 1 + rand() * 2)
  }
}

function border(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = INK
  ctx.lineWidth = 14
  ctx.strokeRect(52, 52, WIDTH - 104, HEIGHT - 104)
  ctx.lineWidth = 3
  ctx.strokeRect(82, 82, WIDTH - 164, HEIGHT - 164)
}

/** A tuft of grass blades rising from (x, y), leaning toward `lean`. */
function tuft(ctx: CanvasRenderingContext2D, x: number, y: number, lean: number, seed: number) {
  const rand = mulberry32(seed)
  const greens = ['#3f7a2a', '#5a9632', '#2d5e1f', '#76a83c']
  for (let i = 0; i < 16; i++) {
    const bx = x + (rand() - 0.5) * 110
    const h = 70 + rand() * 120
    const w = 6 + rand() * 7
    const tipX = bx + lean * (20 + rand() * 60) + (rand() - 0.5) * 50
    ctx.fillStyle = greens[Math.floor(rand() * greens.length)]
    ctx.beginPath()
    ctx.moveTo(bx - w, y)
    ctx.quadraticCurveTo(bx - w * 0.5, y - h * 0.6, tipX, y - h)
    ctx.quadraticCurveTo(bx + w * 0.5, y - h * 0.6, bx + w, y)
    ctx.closePath()
    ctx.fill()
  }
}

function seal(ctx: CanvasRenderingContext2D, x: number, y: number, blades: number) {
  // Ribbon tails behind the seal.
  ctx.fillStyle = '#2f6b2a'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(x + side * 40, y + 60)
    ctx.lineTo(x + side * 88, y + 185)
    ctx.lineTo(x + side * 58, y + 165)
    ctx.lineTo(x + side * 38, y + 198)
    ctx.lineTo(x + side * 5, y + 70)
    ctx.closePath()
    ctx.fill()
  }
  // Scalloped gold rim.
  const gold = ctx.createRadialGradient(x - 40, y - 50, 10, x, y, 140)
  gold.addColorStop(0, '#fbe7a1')
  gold.addColorStop(0.55, '#d9a93a')
  gold.addColorStop(1, '#a8761c')
  ctx.fillStyle = gold
  ctx.beginPath()
  const bumps = 28
  for (let i = 0; i <= bumps * 2; i++) {
    const a = (i / (bumps * 2)) * Math.PI * 2
    const r = i % 2 === 0 ? 132 : 118
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
  }
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(110, 70, 10, 0.6)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(x, y, 98, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = '#5a3d0c'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 40px ${SERIF}`
  ctx.fillText(blades.toLocaleString('en-US'), x, y - 10)
  ctx.font = `600 22px ${SERIF}`
  ctx.fillText('B L A D E S', x, y + 30)
}

export function drawCertificate(info: CertificateInfo) {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  paper(ctx)
  border(ctx)
  tuft(ctx, 150, HEIGHT - 96, 0.6, 0x11)
  tuft(ctx, WIDTH - 150, HEIGHT - 96, -0.6, 0x22)

  const cx = WIDTH / 2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = INK
  ctx.font = `600 32px ${SERIF}`
  ctx.fillText('G R A S S   C U T T E R', cx, 205)
  ctx.font = `400 104px ${SERIF}`
  ctx.fillText('Certificate of Completion', cx, 335)

  ctx.fillStyle = BROWN
  ctx.font = `italic 42px ${SERIF}`
  ctx.fillText('This certifies that', cx, 455)

  const name = info.name.trim() || 'A patient gardener'
  ctx.fillStyle = INK
  fitFont(ctx, name, '400', 128, SCRIPT, 1300)
  ctx.fillText(name, cx, 600)
  ctx.strokeStyle = 'rgba(36, 70, 31, 0.5)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx - 560, 640)
  ctx.lineTo(cx + 560, 640)
  ctx.stroke()

  ctx.fillStyle = BROWN
  ctx.font = `400 44px ${SERIF}`
  ctx.fillText(`cut all ${info.blades.toLocaleString('en-US')} blades of grass in the meadow in`, cx, 735)

  ctx.fillStyle = INK
  ctx.font = `700 150px ${SERIF}`
  ctx.fillText(`${info.minutes} minute${info.minutes === 1 ? '' : 's'}`, cx, 895)

  ctx.fillStyle = BROWN
  ctx.font = `italic 36px ${SERIF}`
  ctx.fillText('Started with a nail clipper. Finished with a lawn mower.', cx, 975)

  // Date on the left, signature on the right, seal between them.
  const lineY = 1180
  ctx.strokeStyle = 'rgba(36, 70, 31, 0.6)'
  for (const x of [470, WIDTH - 470]) {
    ctx.beginPath()
    ctx.moveTo(x - 230, lineY)
    ctx.lineTo(x + 230, lineY)
    ctx.stroke()
  }
  ctx.fillStyle = INK
  ctx.font = `400 42px ${SERIF}`
  ctx.fillText(info.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), 470, lineY - 22)
  ctx.font = `400 64px ${SCRIPT}`
  ctx.fillText('The Meadow', WIDTH - 470, lineY - 20)
  ctx.fillStyle = BROWN
  ctx.font = `600 24px ${SERIF}`
  ctx.fillText('D A T E', 470, lineY + 44)
  ctx.fillText('S I G N E D', WIDTH - 470, lineY + 44)

  seal(ctx, cx, 1125, info.blades)
  return canvas
}

/** Draws the certificate and hands it to the browser as a PNG download. */
export function downloadCertificate(info: CertificateInfo) {
  drawCertificate(info).toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'grass-cutter-certificate.png'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }, 'image/png')
}
