# Grass Cutter

A first-person browser game. There are 5,000 blades of grass, each about 2 m tall, and you cut them one at a time with a nail clipper.

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
| Click | Snip the highlighted blade |
| Esc | Pause |
| M | Sound on or off |

Progress saves after every snip and when you pause or close the tab. "Start over" in the pause menu erases it.

## How it works

Everything you see and hear is generated in code: Three.js meshes, GLSL shaders, canvas textures and Web Audio synthesis. There are no asset files.

- `src/field.ts` places the blades with a seeded random generator, so blade 1,234 is the same blade on every visit. It also does picking: the wind and push math from the grass shader runs on the CPU, so the crosshair selects the blade you actually see.
- `src/grass.ts` draws all blades in two instanced draw calls: standing blades and fallen clippings. A cut blade becomes a stub and its clipping tips over in the vertex shader. A small density texture darkens the soil under thick grass and brightens it as you clear it.
- `src/save.ts` stores cut blades as a bitset in localStorage, under 2 KB per save. Zod validates saves on load. A broken position falls back to the spawn point without losing cut blades. If the game is open in two tabs, each tab merges the other's cuts.

## Scripts

- `pnpm dev` starts the dev server
- `pnpm build` typechecks and builds to `dist/`
- `pnpm test` runs the save and picking tests
