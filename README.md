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

On an iPhone or iPad, put a thumb down on the left of the screen and a stick appears under it. Push it all the way to run. Drag anywhere else to look. Hold Cut to cut, and drag it to aim while you do. Tap the hotbar to switch tools and tap Shop at the farmer's stall. Added to the home screen, the game opens full screen.

## How it plays

Every blade you cut pays one bCoin. Spend them at the farm shop next to where you start. The farmer sells tools in order, each one faster than the last:

| Tool | Price | How it cuts |
| --- | --- | --- |
| Nail clipper | free | One blade per snip |
| Scissors | 2,500 | Every blade in a small patch |
| Sickle | 12,000 | A wedge in front of you, swing after swing |
| Lawn trimmer | 45,000 | A spinning line held out where you look, while you hold the mouse |
| Lawn mower | 140,000 | Everything under the deck as you walk |
| Riding mower | 350,000 | A seat, flames on the hood and a deck nearly two metres wide, at two and a half times walking pace. Floor it and the headers spit fire |

He also sells up to three robots (8,000, 50,000 and 150,000). Each one finds grass on its own and cuts it at half your pace with whatever tool you buy it. They start with a nail clipper and climb the same ladder as you, a little cheaper.

Grass grows back while you play. A blade snipped out of tall grass is back in about nine minutes, and the edge of a mown patch creeps in a row every twenty or so. Ground with no grass next to it stays clear, so the meadow can be finished.

Two cows graze the meadow. Each eats about fifteen blades a minute, and every few minutes one of them leaves a pat. All the cut grass within two metres of it sprouts again, with a sunflower in the middle. Cows are solid, so walk or drive around them.

A day lasts seven minutes and a night three. Every night a UFO glides in and stops in the sky in front of you. Its beam turns about a hundred blades purple and tall, and each one pays 100 bCoins when cut, by any tool. That's roughly 10,000 bCoins a visit. You'll hear it coming.

Sunflowers come up now and then. Snip one with the nail clipper or scissors and the farmer pays 500 bCoins. Any other tool shreds it for nothing, robots included. A robot with clippers or scissors goes looking for them.

Clear the last blade and the sky goes dark for a fireworks show. The pause menu then offers a certificate PNG with your name and how long it took.

After three minutes without a key, click, scroll, mouse move or touch, the game pauses, and the robots stop with it. Progress saves every few seconds and when you pause or close the tab. To erase it, choose "Start over" in the pause menu and type ERASE. The game runs in one tab at a time.

## How it works

Everything you see and hear is generated in code: Three.js meshes, GLSL shaders, canvas textures and Web Audio synthesis. There are no asset files.

- `src/field.ts` places one blade per cell of a jittered 20 cm grid, keeping the cells furthest inside an organic outline. The grid doubles as the lookup for picking, for the tools' cutting areas and for regrowth. Picking runs the grass shader's wind and push math on the CPU, so the crosshair selects the blade you actually see.
- `src/grass.ts` draws the meadow in 12 m chunks with four levels of detail. Far chunks draw fewer, wider blades with fewer segments. Each blade has a growth byte, so a sprout is drawn as a short blade that grows a step a few times a second. Only the bytes and density texels that changed are uploaded.
- `src/cows.ts` walks the cows from patch to patch. They graze where they stand, step away when you get close and drop pats that call `grass.sproutAround()`.
- `src/ufo.ts` picks a time at dusk for tonight's visit. The saucer glides in, hovers over the meadow ahead of you, beams it and accelerates away. Its hum is pitched by its speed toward you. Beamed blades get a byte of their own in `src/grass.ts` that the shader reads to draw them purple and taller.
- `src/robots.ts` gives each robot a target: a sunflower if it carries clippers or scissors, then the nearest grass, then the nearest patch no other robot has claimed. Machines prefer grass ahead of them, so they mow in lines.
- `src/touch.ts` draws the stick and buttons on phones and tablets. They feed the same player input and cut flag as the keyboard and mouse, and the game skips pointer lock.
- `src/cutting.ts` holds how each tool cuts, shared by you and the robots.
- `src/shop.ts` builds the stall and the farmer, who turns to face you and talks in a speech bubble. `src/icons.ts` photographs the tool models once at startup for the hotbar and the shop.
- `src/save.ts` stores a JSON header plus one bit per blade, in grid order so mown stripes compress well. Fields added after 3.0, like the cows, are optional, so older v3 saves still open. `src/vault.ts` compresses it and seals it with AES-GCM. The key comes from a secret in the game, a random salt made on your first visit and your browser, so an edited or copied save fails to open and the game starts fresh.
- The day-night clock runs off your play time, so a reload picks up at the same hour. The sky is rendered into a cube map once at startup and fades into a moonlit, starry night. Static models are baked into one mesh per material. The frame rate is capped at 60 (30 behind menus), and the resolution drops if the machine can't keep up.

## Scripts

- `pnpm dev` starts the dev server
- `pnpm build` typechecks and builds to `dist/`
- `pnpm test` runs the field, economy and save tests
