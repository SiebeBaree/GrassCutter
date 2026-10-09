import type { InstancedBufferAttribute } from 'three'

/**
 * Hands out instance slots round-robin, overwriting the oldest once every slot is taken, and uploads
 * only the slots written since the last flush.
 */
export function createRing(slots: number, attributes: InstancedBufferAttribute[]) {
  let next = 0
  let used = 0
  let dirtyStart = -1
  let dirtyCount = 0

  return {
    /** Slots holding something. Draw this many instances. */
    get used() {
      return used
    },
    claim() {
      const slot = next
      next = (next + 1) % slots
      used = Math.min(slots, used + 1)
      if (dirtyStart < 0) dirtyStart = slot
      dirtyCount = Math.min(slots, dirtyCount + 1)
      return slot
    },
    flush() {
      if (dirtyStart < 0) return
      const end = dirtyStart + dirtyCount
      for (const attr of attributes) {
        const size = attr.itemSize
        attr.addUpdateRange(dirtyStart * size, (Math.min(end, slots) - dirtyStart) * size)
        if (end > slots) attr.addUpdateRange(0, (end - slots) * size)
        attr.needsUpdate = true
      }
      dirtyStart = -1
      dirtyCount = 0
    },
  }
}
