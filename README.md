# Orbit Golf

Orbit Golf is a 3D gravity-slingshot puzzle game that runs in the browser. Launch a probe from a home planet, let real Newtonian gravity bend its path, and reach the gate in as few launches as possible. Play the [live demo](https://ronpicard.github.io/orbit-golf/) — it works on both phones and desktops.

## How to play

- Drag anywhere to pull back like a slingshot; release to launch. The probe fires in the direction opposite your drag, just like a real slingshot.
- Fine-tune your aim with the angle and power nudge buttons, then press FIRE.
- Keyboard controls: arrow keys adjust angle and power (hold Shift for a 5x step), `Space` or `Enter` fires or aborts a flight in progress, `R` restarts the level, and `Escape` opens the menu.
- Ghost trails from your earlier attempts stay on screen, so you can see how each try compares.
- Scores use golf names: hole in one, eagle, birdie, par, bogey.
- Progress and best scores are saved in your browser, and levels unlock in order as you complete them.
- Deep links work directly, for example `#/level/3` or `#/sandbox`.

## Levels

| # | Name | Par | Idea |
| --- | --- | --- | --- |
| 1 | First Launch | 1 | Drag to pull back, aim at the gate, and release to launch. |
| 2 | Gentle Bend | 2 | Gravity bends your path, so the straight line is not always fastest. |
| 3 | In The Way | 2 | A planet blocks the direct route, so curve your shot around it. |
| 4 | Slingshot | 2 | The target hides behind a big planet, so swing around it and let gravity fling you in. |
| 5 | Binary Threading | 3 | Two planets pull opposite ways, so thread the gap or loop wide around both. |
| 6 | Moving Target Zone | 3 | A moon sweeps across the corridor, so time your launch to slip past it. |
| 7 | The Gap | 3 | Asteroids wall off the corridor, so use a planet's pull to curve through the gap. |
| 8 | Event Horizon | 3 | Graze the black hole and let its immense pull whip you to the far side. |
| 9 | Moving Gate | 3 | The target itself rides a rail around a planet, so lead your shot. |
| 10 | Grand Tour | 4 | Chain three planets, a moon, and a black hole into one final run. |

There's also a Sandbox for free experimentation: place small, medium, and large planets or black holes, erase bodies you don't want, clear trails, and try up to 10 bodies at once.

## The physics

At every point in space, the probe's acceleration is the sum of the pull from every massive body: `mu * r / |r|^3`, where `mu` is a body's gravitational parameter (G times mass) and `r` is the vector from the probe to that body. This is plain Newtonian gravity — no shortcuts, no scripted paths.

The simulation advances on a fixed time step of 1/240 second using velocity-Verlet integration. Verlet is symplectic, meaning it conserves energy over long stretches of simulated time; a naive explicit-Euler integrator would slowly pump energy into every orbit, making them spiral outward until they broke free. Verlet keeps closed orbits closed, so a probe that should loop a planet forever actually does.

```text
x(t + dt) = x(t) + v(t) dt + 1/2 a(t) dt^2
v(t + dt) = v(t) + 1/2 (a(t) + a(t + dt)) dt
```

Moons and moving gates don't feel gravity themselves — they ride fixed circular rails with a set period and phase. That keeps every level deterministic: the same aim, at the same power, always produces the same flight, every time you play it.

The rubber-sheet grid you see under the planets isn't decoration — it's a direct visualisation of the gravitational potential well, computed live in the vertex shader from the same body positions and masses used by the physics.

The aiming preview line only draws the first 1.4 seconds of flight on purpose. It's there to help you judge your initial trajectory, not to solve the level for you — the rest of the flight is up to gravity, and to you.

## Every level is proven solvable

`scripts/solve.ts` sweeps a full grid of aims for a level — 720 angles across the circle by 96 power levels, 69,120 aims in total — through the same headless `simulate` function the game itself uses to fly a shot. `npm test` asserts that every level has at least one winning aim in that sweep, and that levels designed to require curving around an obstacle ("blocked" levels) cannot be won with a straight shot at the target.

Run the solver yourself:

```bash
npm run solve
```

## Tech stack

- React 19 and TypeScript
- Plain three.js, with custom GLSL shaders for planet surfaces, atmosphere, the accretion disc, and the gravity well, plus bloom post-processing and fat-line trails
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
