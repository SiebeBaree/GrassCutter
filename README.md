# Grass Cutter

A first-person browser game. A meadow of 200,000 blades of grass, each taller than your waist. You start with a nail clipper and cut your way up to a lawn mower.

## Play

```sh
pnpm install
pnpm dev
```

| Key | Action |
| --- | --- |
| WASD or arrows | Walk |
| Shift | Run |
| Mouse | Look |
| Click or hold | Cut |
| 1 to 4 | Switch to a tool you've unlocked |
| Esc | Pause |
| M | Sound on or off |

## Levels

Cutting blades is the only way to level up. Each level unlocks a new tool, and each takes about ten minutes.

| Level | Tool | Unlocks at | How it cuts |
| --- | --- | --- | --- |
| 1 | Nail clipper | 0 | One blade per snip |
| 2 | Shears | 2,500 | Every blade in a small patch |
| 3 | Sickle | 10,000 | A wedge in front of you, swing after swing |
| 4 | Lawn mower | 35,000 | Everything under the deck as you walk |

Confetti falls on every level-up. Clear the whole meadow and the sky goes dark for a fireworks show, then the pause menu lets you download a certificate PNG with your name and the minutes it took.

Progress saves every few seconds and when you pause or close the tab. "Start over" in the pause menu erases it.

## How it works

Everything you see and hear is generated in code: Three.js meshes, GLSL shaders, canvas textures and Web Audio synthesis. There are no asset files.

- `src/field.ts` places one blade per cell of a jittered 20 cm grid, keeping the 200,000 cells furthest inside an organic outline. Blade 1,234 is the same blade on every visit. The grid doubles as the lookup for picking and for the tools' cutting areas. Picking runs the grass shader's wind and push math on the CPU, so the crosshair selects the blade you actually see.
- `src/grass.ts` draws the meadow in 12 m chunks with three levels of detail. Far chunks draw fewer, wider blades with fewer segments. A density texture darkens the soil under thick grass, brightens it as you cut and records mowing direction for the lawn stripes.
- `src/particles.ts` handles confetti, mower clippings and fireworks. Each particle's flight is a closed-form function of time, so the CPU writes a particle once and the vertex shader does the rest.
- The sky is rendered into a cube map once at startup. The frame rate is capped at 60 (30 behind the menu), and the resolution drops if the machine can't keep up.
- `src/save.ts` stores cut blades as a 25 KB bitset in localStorage. Zod validates saves on load. If the game is open in two tabs, each tab merges the other's cuts.

## Scripts

- `pnpm dev` starts the dev server
- `pnpm build` typechecks and builds to `dist/`
- `pnpm test` runs the field, tool and save tests
