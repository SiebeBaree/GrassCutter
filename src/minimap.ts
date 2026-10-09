import { MAP_HALF } from './field'
import { DENSITY_CELLS } from './grass'
import type { PlayerState } from './save'

const SIZE = 168
/** Metres from the centre to the edge of the map circle. */
const RANGE = 62
const REDRAW_SECONDS = 0.25
/** Below this many standing blades, each one gets a bright marker so the last few are easy to find. */
const MARK_BELOW = 300

/**
 * Top-down map of the meadow in the corner: standing grass, cut ground and an arrow for you.
 * North is up. Redraws a few times a second from the grass density counts.
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
  cells.width = DENSITY_CELLS
  cells.height = DENSITY_CELLS
  const cellsCtx = cells.getContext('2d')
  const image = cellsCtx?.createImageData(DENSITY_CELLS, DENSITY_CELLS)
  let drawnAt = -Infinity

  return {
    setVisible(visible: boolean) {
      canvas.hidden = !visible
    },
    update(time: number, player: PlayerState, remaining: number) {
      if (!ctx || !cellsCtx || !image || canvas.hidden || time - drawnAt < REDRAW_SECONDS) return
      drawnAt = time

      const px = image.data
      for (let d = 0; d < bladesPerCell.length; d++) {
        const o = d * 4
        if (bladesPerCell[d] === 0) {
          px[o + 3] = 0
        } else if (uncutPerCell[d] > 0) {
          const k = 0.75 + (0.25 * uncutPerCell[d]) / bladesPerCell[d]
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
      cellsCtx.putImageData(image, 0, 0)

      const scale = (SIZE * dpr) / (RANGE * 2)
      const c = (SIZE * dpr) / 2
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

      if (remaining > 0 && remaining < MARK_BELOW) {
        ctx.fillStyle = '#ffd84d'
        const cellPx = ((MAP_HALF * 2) / DENSITY_CELLS) * scale
        for (let d = 0; d < uncutPerCell.length; d++) {
          if (uncutPerCell[d] === 0) continue
          const x = c - MAP_HALF * scale + ((d % DENSITY_CELLS) + 0.5) * cellPx
          const y = c - MAP_HALF * scale + (Math.floor(d / DENSITY_CELLS) + 0.5) * cellPx
          ctx.beginPath()
          ctx.arc(x, y, 2.5 * dpr, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // You: an arrow pointing where you look.
      ctx.translate(c + player.x * scale, c + player.z * scale)
      ctx.rotate(-player.yaw)
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
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
