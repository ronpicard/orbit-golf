# Changelog

All notable changes to Orbit Golf are documented in this file, following the [Keep a Changelog](https://keepachangelog.com/) format.

## [2.0.1] - 2026-09-19

### Fixed

- The alien golfer now stands beside the ball in a side-on stance and swings the club through it along the target line. Before, it stood on top of the ball and chopped at the turf in front of it.
- The aim arrow, predicted path, and power colour are visible again while aiming. The fairway had been drawn over them.
- Gentle putts now get a gentle swing.

## [2.0.0] - 2026-09-19

### Added

- Real mini-golf rules: walled courses, a ball that banks off the walls and rolls to a stop under real friction, and a cup that lips out a putt crossing it too fast.
- 18 rebuilt holes with walled layouts that gain bends and turns as the round goes on: a straight lane, a dogleg, a right angle, an S-curve, a chicane with island blocks, a U-turn, a bowl with a black hole, a zigzag, a funnel, a dead end, a ring around a central island, a moving cup, an inward spiral, a bridge between twin black holes, a slalom, a pinball room, and a grand tour.
- A 3D green alien golfer who addresses the ball, swings, watches the putt, celebrates or slumps, and jetpack-hops to wherever the ball stops, with a camera that glides in behind it facing the hole.
- A top-down minimap showing the whole course, the ball, and the aim.
- A living backdrop: flying saucers, satellites, a space station, a tumbling asteroid field, astronauts, a ringed gas giant, comets, shooting stars, and floating stands of alien spectators who cheer and groan.
- Synthesised crowd cheer and groan sounds alongside the club swing, wall bounce, and ball-in-cup sounds.
- A beam-search multi-shot solver (`scripts/solve.ts`) that proves every hole finishable within par, with its solutions checked in and replayed by the test suite.

### Changed

- Touching a planet, moon, asteroid, or black hole, or leaving the course, is now a hazard: the stroke replays from where it started and still counts, instead of ending the attempt outright.
- Ten strokes is now the limit per hole.
- Gravity is stronger, so putts curve visibly, and because the ball slows as it rolls, the curve grows the longer a putt runs.
- The rubber-sheet fairway now follows each hole's own walled outline, with neon bumper walls and a real cup with a flagstick, instead of a generic gravity-well grid.
- This is a breaking rules change from 1.x's launch-a-probe format, hence the major version bump; best scores saved from 1.x refer to the old holes and don't carry over to the new ones.

## [1.1.0] - 2026-09-19

### Added

- Eight new holes, bringing the course to 18 with a front nine and back nine, a scorecard menu, subtotals per nine, and a running total against par.
- A mini-golf camera: low and behind the home planet, looking down the course, gently following the ball in flight.
- A neon-green fairway with glowing bumper rails at the out-of-bounds edge, a tee box under the home planet, and a flagged portal marking the hole.
- Comet trail and particle effects for launch, sparks, crash debris, and the goal burst.
- Ringed planets with clouds and atmosphere, cratered moons, a Doppler-shaded accretion disc with a lensed halo, and a richer sky.
- Bloom, vignette, chromatic aberration, and film grain post-processing.
- A first-visit coach mark and a power meter.

### Changed

- Aiming is reversed and more intuitive: drag in the direction you want to shoot, drag further for more power, and release to launch. The on-screen arrow now runs exactly parallel to your drag. There is no more pull-back slingshot.
- The opening holes are harder.
- The ball now rolls on the curved gravity sheet and planets sit in their own funnels, so every arc reads in 3D.
- Candy arcade colours throughout.

## [1.0.0] - 2026-09-19

### Added

- A 3D gravity-slingshot puzzle game with real Newtonian physics.
- 10 hand-crafted levels, each teaching a new gravity trick, from a first straight shot to a grand tour past three planets, a moon, and a black hole.
- A Sandbox mode for free experimentation with planets and black holes.
- Touch, mouse, and keyboard controls, including drag-to-launch and arrow-key aim nudging.
- Ghost trails of earlier attempts and a short aiming preview.
- Golf-style scoring (hole in one, eagle, birdie, par, bogey), with progress and best scores saved in the browser and levels that unlock in order.
- A live gravity-well visualisation rendered under the planets.
- Synthesised sound effects with a mute toggle.
- Deep links to individual levels and the Sandbox.
