# Grass Cutter

A first-person browser game. A huge meadow of waist-high grass, a nail clipper and a farmer who would love to sell you something better. Clearing it takes about three hours.

## Play

```sh
pnpm install
pnpm dev
```

| Key | Action |
| --- | --- |
| WASD or arrows | Walk, or drive the riding mower |
| Shift | Run |
| Mouse | Look |
| Click or hold | Cut |
| 1 to 6, or scroll | Switch to a tool you own |
| E | Trade with the farmer, when you're at his stall |
| Esc | Pause |
| M | Sound on or off |

## How it plays

Every blade you cut pays one bCoin. Spend them at the farm shop next to where you start. The farmer sells tools in order, each one faster than the last:

| Tool | Price | How it cuts |
| --- | --- | --- |
| Nail clipper | free | One blade per snip |
| Scissors | 2,500 | Every blade in a small patch |
| Sickle | 12,000 | A wedge in front of you, swing after swing |
| Lawn trimmer | 45,000 | A spinning line that follows your aim while you hold the mouse |
| Lawn mower | 140,000 | Everything under the deck as you walk |
| Riding mower | 350,000 | A seat and a deck nearly two metres wide, at two and a half times walking pace |

He also sells up to three robots (8,000, 50,000 and 150,000). Each one finds grass on its own and cuts it at half your pace with whatever tool you buy it. They start with a nail clipper and climb the same ladder as you, a little cheaper.

Grass grows back while you play. Cut blades next to standing grass slowly sprout again, so ragged edges creep back. Ground with no grass next to it stays clear, so the meadow can be finished.

Sunflowers come up now and then. Snip one with the nail clipper or scissors and the farmer pays 500 bCoins. Any other tool shreds it for nothing, robots included. A robot with clippers or scissors goes looking for them.

Clear the last blade and the sky goes dark for a fireworks show. The pause menu then offers a certificate PNG with your name and how long it took.

Progress saves every few seconds and when you pause or close the tab. "Start over" in the pause menu erases it. The game runs in one tab at a time.

## How it works

Everything you see and hear is generated in code: Three.js meshes, GLSL shaders, canvas textures and Web Audio synthesis. There are no asset files.

- `src/field.ts` places one blade per cell of a jittered 20 cm grid, keeping the cells furthest inside an organic outline. The grid doubles as the lookup for picking, for the tools' cutting areas and for regrowth. Picking runs the grass shader's wind and push math on the CPU, so the crosshair selects the blade you actually see.
- `src/grass.ts` draws the meadow in 12 m chunks with four levels of detail. Far chunks draw fewer, wider blades with fewer segments. Each blade has a growth byte, so a sprout is drawn as a short blade that grows a step a few times a second. Only the bytes and density texels that changed are uploaded.
- `src/robots.ts` gives each robot a target: a sunflower if it carries clippers or scissors, then the nearest grass, then the nearest patch no other robot has claimed. Machines prefer grass ahead of them, so they mow in lines.
- `src/cutting.ts` holds how each tool cuts, shared by you and the robots.
- `src/shop.ts` builds the stall and the farmer, who turns to face you and talks in a speech bubble. `src/icons.ts` photographs the tool models once at startup for the hotbar and the shop.
- `src/save.ts` stores a JSON header plus one bit per blade, in grid order so mown stripes compress well. `src/vault.ts` compresses it and seals it with AES-GCM. The key comes from a secret in the game, a random salt made on your first visit and your browser, so an edited or copied save fails to open and the game starts fresh.
- The sky is rendered into a cube map once at startup. Static models are baked into one mesh per material. The frame rate is capped at 60 (30 behind menus), and the resolution drops if the machine can't keep up.

## Scripts

- `pnpm dev` starts the dev server
- `pnpm build` typechecks and builds to `dist/`
- `pnpm test` runs the field, economy and save tests
