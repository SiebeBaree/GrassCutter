import { MAP_HALF, type Vec2 } from './field'
import { DENSITY_CELLS } from './grass'
import { FARMER } from './layout'
import { ROBOT_COLORS } from './robots'
import type { PlayerState } from './save'

const SIZE = 176
/** Metres from the centre to the edge of the map circle. */
const RANGE = 134
const REDRAW_SECONDS = 0.25
/** Each map pixel covers 2×2 density texels. */
const MINI = DENSITY_CELLS / 2
/** Below this many standing blades, each patch gets a bright marker so the last few are easy to find. */
const MARK_BELOW = 400

/**
 * Top-down map of the meadow in the corner: standing grass, cut ground, sunflowers, robots, the stall
 * and an arrow for you. North is up. Keeps its own image up to date blade by blade through cellChanged().
 */
export function createMinimap(root: HTMLElement, bladesPerCell: Uint8Array, uncutPerCell: Uint8Array) {
  const canvas = document.createElement('canvas')
  canvas.className = 'minimap'
  const dpr = Math.min(window.devicePixelRatio, 2)
  canvas.width = SIZE * dpr
  canvas.height = SIZE * dpr
  root.append(canvas)
  const ctx = canvas.getContext('2d')

  const cells = document.createElement('canvas')
  cells.width = MINI
  cells.height = MINI
  const cellsCtx = cells.getContext('2d')
  const image = cellsCtx?.createImageData(MINI, MINI)
  const standing = new Uint16Array(MINI * MINI)
  const total = new Uint16Array(MINI * MINI)
  let dirty = true
  let drawnAt = -Infinity

  const paint = (m: number) => {
    if (!image) return
    const px = image.data
    const o = m * 4
    if (total[m] === 0) {
      px[o + 3] = 0
    } else if (standing[m] > 0) {
      const k = 0.75 + (0.25 * standing[m]) / total[m]
      px[o] = 52 * k
      px[o + 1] = 112 * k
      px[o + 2] = 30 * k
      px[o + 3] = 255
    } else {
      px[o] = 205
      px[o + 1] = 206
      px[o + 2] = 140
      px[o + 3] = 235
    }
  }

  const miniOf = (d: number) => (Math.floor(d / DENSITY_CELLS) >> 1) * MINI + ((d % DENSITY_CELLS) >> 1)
  for (let d = 0; d < bladesPerCell.length; d++) {
    const m = miniOf(d)
    total[m] += bladesPerCell[d]
    standing[m] += uncutPerCell[d]
  }
  for (let m = 0; m < standing.length; m++) paint(m)

  /** Maps metres to canvas pixels. */
  const scale = (SIZE * dpr) / (RANGE * 2)
  const c = (SIZE * dpr) / 2
  const dot = (at: Vec2, radius: number, fill: string) => {
    if (!ctx) return
    ctx.beginPath()
    ctx.arc(c + at.x * scale, c + at.z * scale, radius * dpr, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.stroke()
  }

  return {
    /** A density texel's standing count changed. */
    cellChanged(d: number) {
      const m = miniOf(d)
      const row = Math.floor(d / DENSITY_CELLS) & ~1
      const col = (d % DENSITY_CELLS) & ~1
      const at = row * DENSITY_CELLS + col
      standing[m] = uncutPerCell[at] + uncutPerCell[at + 1] + uncutPerCell[at + DENSITY_CELLS] + uncutPerCell[at + DENSITY_CELLS + 1]
      paint(m)
      dirty = true
    },
    /** Redraws a few times a second. `flowers` is only asked for on a redraw. */
    update(time: number, player: PlayerState, remaining: number, flowers: () => readonly Vec2[], robots: readonly Vec2[]) {
      if (!ctx || !cellsCtx || !image || canvas.hidden || time - drawnAt < REDRAW_SECONDS) return
      drawnAt = time
      if (dirty) {
        cellsCtx.putImageData(image, 0, 0)
        dirty = false
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.save()
      ctx.beginPath()
      ctx.arc(c, c, c, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = 'rgba(16, 26, 12, 0.5)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(cells, c - MAP_HALF * scale, c - MAP_HALF * scale, MAP_HALF * 2 * scale, MAP_HALF * 2 * scale)

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
      ctx.lineWidth = 1.2 * dpr
      if (remaining > 0 && remaining < MARK_BELOW) {
        const cellMetres = (MAP_HALF * 2) / MINI
        for (let m = 0; m < standing.length; m++) {
          if (standing[m] === 0) continue
          dot({ x: ((m % MINI) + 0.5) * cellMetres - MAP_HALF, z: (Math.floor(m / MINI) + 0.5) * cellMetres - MAP_HALF }, 2.4, '#ffffff')
        }
      }
      for (const f of flowers()) dot(f, 2.6, '#ffd23a')
      dot(FARMER, 3.2, '#c8352b')
      robots.forEach((r, k) => dot(r, 3, ROBOT_COLORS[k]))

      // You: an arrow pointing where you look.
      ctx.translate(c + player.x * scale, c + player.z * scale)
      ctx.rotate(-player.yaw)
      ctx.fillStyle = '#ffffff'
      ctx.lineWidth = 1.5 * dpr
      ctx.beginPath()
      ctx.moveTo(0, -7 * dpr)
      ctx.lineTo(5 * dpr, 6 * dpr)
      ctx.lineTo(0, 3.5 * dpr)
      ctx.lineTo(-5 * dpr, 6 * dpr)
      ctx.closePath()
      ctx.stroke()
      ctx.fill()
      ctx.restore()
    },
  }
}

export type Minimap = ReturnType<typeof createMinimap>
