import { describe, expect, it } from 'vitest'
import { ROCKS, rockInCircle, rockInWedge, rockUnderDeck } from './rocks'

const rock = ROCKS[0]
/** Facing +x: yaw turns -z (straight ahead at yaw 0) a quarter turn. */
const east = -Math.PI / 2

describe('rocks', () => {
  it('lets tools cut right up to a rock without touching it', () => {
    expect(rockInCircle(rock.x + rock.r + 0.45, rock.z, 0.45)).toBeNull()
    expect(rockInCircle(rock.x + rock.r + 0.2, rock.z, 0.45)).toBe(rock)
  })

  it('catches a mower deck from the front and the side', () => {
    const f = { x: 1, z: 0 }
    expect(rockUnderDeck({ x: rock.x - rock.r - 0.3, z: rock.z }, f, 0.42, 0.6)).toBe(rock)
    expect(rockUnderDeck({ x: rock.x - rock.r - 0.6, z: rock.z }, f, 0.42, 0.6)).toBeNull()
    expect(rockUnderDeck({ x: rock.x, z: rock.z + rock.r + 0.45 }, f, 0.42, 0.6)).toBe(rock)
  })

  it('only counts the part of a sickle swing that reaches the rock', () => {
    const at = { x: rock.x - rock.r - 1, z: rock.z, yaw: east }
    expect(rockInWedge(at, 1.45, -0.5, 0.5)).toBe(rock)
    expect(rockInWedge(at, 1.45, 0.9, 1.2)).toBeNull()
    expect(rockInWedge(at, 0.8, -0.5, 0.5)).toBeNull()
  })
})
