# Orbit Golf

Orbit Golf is a 3D mini-golf puzzle game that runs in the browser. Launch a probe from a home planet across a neon-green fairway floating in space, let real Newtonian gravity bend its path, and reach the flagged portal in as few launches as possible. Play the [live demo](https://ronpicard.github.io/orbit-golf/) — it works on both phones and desktops.

## How to play

- Drag in the direction you want to shoot; release to launch. Drag further for more power. The on-screen arrow runs exactly parallel to your drag, so aiming is completely intuitive.
- Fine-tune your aim with the angle and power nudge buttons, then press FIRE.
- Keyboard controls: arrow keys adjust angle and power (hold Shift for a 5x step), `Space` or `Enter` fires or aborts a flight in progress, `R` restarts the level, and `Escape` opens the menu.
- A first-visit coach mark shows new players how dragging maps to the aim arrow, and a power meter fills as you drag.
- Ghost trails from your earlier attempts stay on screen, so you can see how each try compares.
- Scores use golf names: hole in one, eagle, birdie, par, bogey.
- Progress and best scores are saved in your browser, and levels unlock in order as you complete them.
- Deep links work directly, for example `#/level/3` or `#/sandbox`.

## The course

Eighteen holes make up a front nine and a back nine, shown as a scorecard on the menu with a subtotal per nine and a running total against par. The opening holes are the hardest, so the front nine eases up before the back nine builds again.

| # | Name | Par | Idea |
| --- | --- | --- | --- |
| 1 | First Launch | 2 | Drag toward the gate and let go — a stray planet nearby will nudge a lazy shot off line. |
| 2 | Gentle Bend | 2 | Gravity bends your path, so the straight line is not always the fastest. |
| 3 | In The Way | 2 | A planet blocks the direct route, so curve your shot around it. |
| 4 | Slingshot | 2 | The target hides behind a big planet, so swing around it and let gravity fling you in. |
| 5 | Binary Threading | 3 | Two planets tug from opposite sides, so thread the gap or loop wide around both. |
| 6 | Moving Target Zone | 3 | A moon sweeps across the corridor, so time your launch to slip past it. |
| 7 | The Gap | 3 | Asteroids wall off the corridor, so use a planet's gravity to curve through the gap. |
| 8 | Event Horizon | 3 | Graze the black hole and let its immense gravity whip you to the far side. |
| 9 | Moving Gate | 3 | The target itself rides a rail around a planet, so lead your shot. |
| 10 | U-Turn | 3 | Asteroids shield the green from a direct shot, so swing past the planet and come back around. |
| 11 | Twin Sentries | 3 | Two moons circle the gate in opposite directions, so slip through when they part. |
| 12 | Dancing Binary | 4 | Two planets waltz around a shared centre, so time your run between their arcs. |
| 13 | The Ring | 3 | A ring of asteroids guards the green, so bend your path to the one gap facing away from home. |
| 14 | Twin Wells | 4 | Two black holes pinch the corridor, so split the gap between their gravity wells. |
| 15 | Orbiting Gate | 4 | The green rides a rail around a black hole, so lead the shot and mind the gravity. |
| 16 | Slalom | 4 | Planets alternate above and below the line, so weave a curve instead of a straight shot. |
| 17 | Guarded Moons | 4 | An asteroid screen blocks the middle, so arc around the planet and its two moons. |
| 18 | Grand Tour | 5 | Chain three planets, a moon, and a black hole into one final run past the asteroid screen. |

There's also a Sandbox for free experimentation: place small, medium, and large planets or black holes, erase bodies you don't want, clear trails, and try up to 10 bodies at once.

Each hole is a neon-green fairway floating in space, with glowing bumper rails marking the out-of-bounds edge, a tee box under the home planet, and a flagged portal marking the hole. A low mini-golf camera sits behind the home planet looking down the course, and gently follows the ball in flight.

## The physics

At every point in space, the probe's acceleration is the sum of the pull from every massive body: `mu * r / |r|^3`, where `mu` is a body's gravitational parameter (G times mass) and `r` is the vector from the probe to that body. This is plain Newtonian gravity — no shortcuts, no scripted paths.

The simulation advances on a fixed time step of 1/240 second using velocity-Verlet integration. Verlet is symplectic, meaning it conserves energy over long stretches of simulated time; a naive explicit-Euler integrator would slowly pump energy into every orbit, making them spiral outward until they broke free. Verlet keeps closed orbits closed, so a probe that should loop a planet forever actually does.

```text
x(t + dt) = x(t) + v(t) dt + 1/2 a(t) dt^2
v(t + dt) = v(t) + 1/2 (a(t) + a(t + dt)) dt
```

Moons and moving gates don't feel gravity themselves — they ride fixed circular rails with a set period and phase. That keeps every level deterministic: the same aim, at the same power, always produces the same flight, every time you play it.

The gravity-well grid you see under the planets isn't decoration — it's a direct visualisation of the gravitational potential well, computed live in the vertex shader from the same body positions and masses used by the physics. Its height is a smooth-clamped potential, `depth = D * (1 - exp(-raw / D))`, where `raw` is the steepened sum of each body's inverse-distance pull; the identical function runs in the vertex shader and in TypeScript, so the ball, trails, and planets all sit on the surface exactly where the grid says they should. This clamping is a visualisation only — the underlying physics stays plain planar Newtonian gravity, unaffected by how the sheet is drawn.

The aiming preview line only draws the first 1.4 seconds of flight on purpose. It's there to help you judge your initial trajectory, not to solve the level for you — the rest of the flight is up to gravity, and to you.

## Every level is proven solvable

`scripts/solve.ts` sweeps a full grid of aims for a level — 720 angles across the circle by 96 power levels, 69,120 aims in total — through the same headless `simulate` function the game itself uses to fly a shot. `npm test` asserts that every one of the 18 levels has at least one winning aim in that sweep, and that holes 3, 4, 7, 8, 10, 13, 16, 17, and 18 — the ones designed to require curving around an obstacle — cannot be won with a straight shot at the target.

Run the solver yourself:

```bash
npm run solve
```

## Tech stack

- React 19 and TypeScript
- Plain three.js, with custom GLSL shaders for planet surfaces, atmosphere, the accretion disc, and the gravity well, pooled GPU particle systems for launch, sparks, crash debris, and goal bursts, plus a bloom, vignette, chromatic aberration, and film grain post-processing pass and fat-line trails
- Vite for building and development
- Web Audio, synthesised in code — no audio files
- Node's built-in test runner
- No backend

## Project layout

```text
src/game/    physics, level definitions, and progress persistence
src/render/  the three.js engine and its API surface
src/ui/      React components for the HUD, menu, and overlays
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
| `npm run solve` | Sweep every level's aim grid and report solvability |

## Deployment

Pushes to `main` run a GitHub Actions workflow that tests, builds, and publishes `dist` to GitHub Pages. Vite is configured with `base: './'` so the built asset paths stay relative and work under the Pages subpath.

## License

MIT — see [LICENSE](LICENSE).
