# Orbit Golf

Orbit Golf is a 3D mini-golf puzzle game that runs in the browser. Drag to turn your alien golfer and aim, drag up for power, and putt across a neon fairway walled off in deep space, bank your ball off the rails, and let real Newtonian gravity from planets, moons, asteroids, and black holes bend the roll until it drops in the cup. The camera always sits behind the ball facing along your aim, turning with the golfer as you line up a shot. Play the [live demo](https://ronpicard.github.io/orbit-golf/) — it works on both phones and desktops.

## How to play

- Drag left or right to turn the golfer and the view, and drag up to add power; release to putt. A sideways-only drag just turns and looks around without putting.
- Fine-tune your aim with the angle and power nudge buttons, then press FIRE.
- Keyboard controls: arrow keys adjust angle and power (hold Shift for a 5x step), `Space` or `Enter` swings or aborts a flight in progress, `R` restarts the hole, and `Escape` opens the menu.
- A first-visit coach mark shows new players how dragging maps to turning and power, and a power meter fills as you drag.
- The ball banks off the walls and rolls with real friction until it stops; a short comet tail follows it while it rolls and vanishes once it settles, and you play your next stroke from wherever it lies.
- A ball crossing the cup too fast lips out instead of dropping in.
- Touching a planet, moon, asteroid, or black hole — or leaving the course — is a hazard: you replay the stroke from where it started, and the stroke still counts.
- Ten strokes is the limit per hole; if you haven't holed out by then, the hole is picked up and scored at ten.
- Scores use golf names: hole in one, eagle, birdie, par, bogey.
- Progress and best scores are saved in your browser, and holes unlock in order as you complete them.
- Deep links work directly, for example `#/level/3` or `#/sandbox`.

## The course

Eighteen holes make up a front nine and a back nine, shown as a scorecard on the menu with a subtotal per nine and a running total against par. The layouts grow more elaborate as the round goes on, gaining bends, turns, and tighter hazards.

| # | Name | Par | Idea |
| --- | --- | --- | --- |
| 1 | First Launch | 3 | A straight lane with one small planet off to the side, ready to nudge a lazy putt off line. |
| 2 | Gentle Bend | 3 | A single dogleg, with a planet on the inside of the turn to curl the putt around it. |
| 3 | Right Angle | 3 | A 90-degree corner: bank off the chamfer, or let the corner planet swing you around it. |
| 4 | Slingshot | 3 | A straight lane with a big planet parked dead centre — swing past a shoulder and let it fling you on. |
| 5 | S-Curve | 3 | Two opposite bends in a row; ride the near wall and let each bend carry you into the next. |
| 6 | Chicane | 3 | Island blocks force a weave through a wide room while a moon patrols the gap on a rail. |
| 7 | U-Turn | 4 | A hairpin corridor with a planet at the pivot to curl the shot back the way it came. |
| 8 | Event Horizon | 2 | A wide bowl room with a black hole in the middle — go wide around it and let the bowl carry you on. |
| 9 | Zigzag | 3 | A corridor with three turns in sequence, chamfered so each bank carries into the next. |
| 10 | The Funnel | 3 | The corridor pinches to a narrow neck between two small planets guarding the gate. |
| 11 | Dead End | 3 | A T-junction where the obvious branch hides a black hole; the real cup is down the other arm. |
| 12 | The Ring | 3 | A ring-shaped room around a central island, with a planet at the top and bottom to sling you around it. |
| 13 | Moving Green | 3 | A bent corridor opening into a round room where the cup itself rides a rail — lead your shot. |
| 14 | Inward Spiral | 5 | A spiral corridor with three turns, closing in on a planet that curls the final approach to the centre. |
| 15 | The Bridge | 3 | A straight lane threaded between two black holes flanking a narrow bridge down the middle. |
| 16 | Slalom | 3 | Four planets alternate above and below the line, with blocks between them forcing a weaving putt. |
| 17 | Pinball | 3 | An irregular bumper room with island blocks and two moons sweeping past on rails. |
| 18 | Grand Tour | 4 | A four-turn corridor chaining three planets, a moon, and a black hole into one final run to the cup. |

There's also a Sandbox for free experimentation: place small, medium, and large planets or black holes, erase bodies you don't want, and try up to 10 bodies at once inside a walled rectangular room.

Each hole is a walled fairway with neon bumper rails along the outside, a tee marker at the start, and a real cup with a flagstick where you putt in.

## The physics

At every point on the course, the ball's acceleration is the sum of the pull from every massive body: `mu * r / |r|^3`, where `mu` is a body's gravitational parameter (G times mass) and `r` is the vector from the ball to that body. This is plain planar Newtonian gravity — no shortcuts, no scripted paths.

The simulation advances on a fixed time step of 1/240 second. Each step runs, in order:

```text
1. velocity-Verlet integration of gravity (a symplectic step, so it doesn't
   pump or leak energy while a shot curves through open space)
2. rolling resistance (a constant deceleration) and speed-proportional
   linear drag, which together bring the ball to rest like real turf
3. wall collision: reflect off the nearest edge, keeping a fraction of the
   into-wall speed (restitution) and of the along-wall speed (grip)
```

Rolling friction and drag are what make this a putting green rather than an orbit: a ball is dissipative on purpose, so every putt eventually settles instead of circling forever. The ball only counts as resting once it is slow enough *and* the local gravity at that point is too weak to restart it — otherwise it keeps rolling downhill, exactly like a ball left on a real sloped green. A ball that crosses the cup above a capture speed lips out instead of dropping in, so a hot putt can run straight through the hole.

Moons and moving cups don't feel gravity themselves — they ride fixed circular rails with a set period and phase. Rails restart from t = 0 at the start of every stroke, so the same aim, at the same power, from the same lie, always produces the same flight: every stroke is fully deterministic and replayable.

The rubber-sheet fairway you see under the ball isn't decoration — it's a direct visualisation of the gravitational potential well, computed live in the vertex shader from the same body positions and masses used by the physics. Its height is a smooth-clamped potential, `depth = D * (1 - exp(-raw / D))`, where `raw` is the steepened sum of each body's inverse-distance pull; the identical function runs in the vertex shader and in TypeScript, so the ball, trails, and bodies all sit on the surface exactly where the grid says they should. This clamping is a visualisation only — the underlying physics stays plain planar Newtonian gravity, unaffected by how the sheet is drawn. Gravity itself is tuned strong enough that putts curve visibly, and because the ball slows as it rolls, the curve grows the longer a putt runs.

## Every hole is proven finishable

`scripts/solve.ts` runs a beam-search solver over the headless `simulate` function the game itself uses to fly a shot: from each resting position it sweeps a grid of angles and powers, keeps the most promising few results ranked by a walking-distance field over the fairway (a breadth-first search that respects walls and islands, so it never rewards a shot that merely looks close as the crow flies), and repeats stroke by stroke until it finds a line that holes out. `npm test` asserts that every one of the 18 holes has a stored winning sequence that finishes at or under par.

The winning sequences it finds are checked into `src/game/solutions.ts` and replayed exactly, shot by shot, by `npm test` — so the test suite never re-runs the search, only verifies the stored aims still hole out. Run the solver yourself:

```bash
npm run solve
```

Add `-- --write` to re-solve every hole and overwrite `src/game/solutions.ts` with fresh solutions, which you'll need after changing a level's layout or `GRAVITY_SCALE`:

```bash
npm run solve -- --write
```

## Tech stack

- React 19 and TypeScript
- Plain three.js, with custom GLSL shaders for the rubber-sheet fairway, planet surfaces, atmosphere, and the accretion disc, pooled GPU particle systems for launch, sparks, crash debris, and goal bursts, plus a bloom, vignette, chromatic aberration, and film grain post-processing pass and fat-line trails
- Vite for building and development
- Web Audio, synthesised in code — no audio files
- Node's built-in test runner
- No backend

## Project layout

```text
src/game/    physics, level definitions, the level solutions, and progress persistence
src/render/  the three.js engine and its API surface
src/ui/      React components for the HUD, menu, minimap, and overlays
src/audio.ts synthesised sound effects
scripts/     the level solver
```

## Development

Requires Node >= 22.12.

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server |
| `npm test` | Run the physics and level tests |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build locally |
| `npm run solve` | Run the beam-search solver over every hole and report the shortest line found |

## Deployment

Pushes to `main` run a GitHub Actions workflow that tests, builds, and publishes `dist` to GitHub Pages. Vite is configured with `base: './'` so the built asset paths stay relative and work under the Pages subpath.

## License

MIT — see [LICENSE](LICENSE).
