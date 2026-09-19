import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_POWER,
  BALL_RADIUS,
  ROLL_DECEL,
  WALL_RESTITUTION,
  CAPTURE_SPEED,
  MAX_SHOT_TIME,
  railPosition,
  clampAim,
  courseBounds,
  pointInPolygon,
  onFairway,
  launchState,
  acceleration,
  step,
  checkOutcome,
  simulate,
  predictPath,
  defaultAim,
} from './physics.ts'
import type { Aim, BallState, Body, Level, Rail, Vec2 } from './types.ts'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RECT_COURSE: Vec2[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 40 },
  { x: 0, y: 40 },
]

function makeLevel(overrides: Partial<Level> = {}): Level {
  const course = overrides.course ?? RECT_COURSE
  return {
    id: 'test',
    name: 'Test Hole',
    hint: 'test',
    par: 3,
    tee: { x: 50, y: 20 },
    course,
    islands: [],
    bodies: [],
    target: { pos: { x: 95, y: 20 }, radius: 1 },
    bounds: courseBounds(course),
    maxSpeed: 12,
    ...overrides,
  }
}

function bodyFixture(overrides: Partial<Body> = {}): Body {
  return {
    id: 'planet-1',
    kind: 'planet',
    mu: 40,
    radius: 2,
    pos: { x: 60, y: 20 },
    palette: ['#ffffff', '#000000'],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// railPosition / clampAim
// ---------------------------------------------------------------------------

test('railPosition at t=0 sits at the phase point', () => {
  const rail: Rail = { center: { x: 3, y: 4 }, radius: 5, period: 10, phase: 0 }
  const p = railPosition(rail, 0)
  assert.ok(Math.abs(p.x - 8) < 1e-9)
  assert.ok(Math.abs(p.y - 4) < 1e-9)
})

test('railPosition returns to the same point after one full period', () => {
  const rail: Rail = { center: { x: 0, y: 0 }, radius: 7, period: 6, phase: 1.2 }
  const p0 = railPosition(rail, 0)
  const p1 = railPosition(rail, 6)
  assert.ok(Math.abs(p0.x - p1.x) < 1e-9)
  assert.ok(Math.abs(p0.y - p1.y) < 1e-9)
})

test('a negative period orbits clockwise (opposite y sign from a positive period)', () => {
  const pos: Rail = { center: { x: 0, y: 0 }, radius: 5, period: 10, phase: 0 }
  const neg: Rail = { center: { x: 0, y: 0 }, radius: 5, period: -10, phase: 0 }
  const pPos = railPosition(pos, 0.1)
  const pNeg = railPosition(neg, 0.1)
  assert.ok(pPos.y > 0)
  assert.ok(pNeg.y < 0)
})

test('clampAim clamps power into [MIN_POWER, 1]', () => {
  assert.equal(clampAim({ angle: 0, power: -5 }).power, MIN_POWER)
  assert.equal(clampAim({ angle: 0, power: 5 }).power, 1)
  assert.equal(clampAim({ angle: 0, power: 0.5 }).power, 0.5)
})

test('clampAim wraps angle into [-PI, PI]', () => {
  const a1 = clampAim({ angle: 3 * Math.PI, power: 0.5 })
  assert.ok(a1.angle >= -Math.PI && a1.angle <= Math.PI)
  assert.ok(Math.abs(a1.angle - Math.PI) < 1e-9 || Math.abs(a1.angle + Math.PI) < 1e-9)

  const a2 = clampAim({ angle: -3 * Math.PI, power: 0.5 })
  assert.ok(a2.angle >= -Math.PI && a2.angle <= Math.PI)
})

// ---------------------------------------------------------------------------
// courseBounds / pointInPolygon / onFairway
// ---------------------------------------------------------------------------

test('courseBounds computes the bounding box of a polygon', () => {
  const b = courseBounds(RECT_COURSE)
  assert.deepEqual(b, { minX: 0, maxX: 100, minY: 0, maxY: 40 })
})

test('pointInPolygon on a convex square', () => {
  const square: Vec2[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]
  assert.equal(pointInPolygon({ x: 5, y: 5 }, square), true)
  assert.equal(pointInPolygon({ x: 20, y: 5 }, square), false)
})

// L-shaped concave polygon: a 10x10 square with a 5x5 notch removed from the top-right corner.
const L_SHAPE: Vec2[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 5 },
  { x: 5, y: 5 },
  { x: 5, y: 10 },
  { x: 0, y: 10 },
]

test('pointInPolygon on a concave L-shape excludes points inside the notch', () => {
  // Inside the solid part of the L.
  assert.equal(pointInPolygon({ x: 2, y: 2 }, L_SHAPE), true)
  assert.equal(pointInPolygon({ x: 8, y: 2 }, L_SHAPE), true)
  // Inside the notch (the removed 5x5 corner) should be outside the polygon.
  assert.equal(pointInPolygon({ x: 8, y: 8 }, L_SHAPE), false)
})

test('onFairway is true inside the course and false inside an island', () => {
  const level = makeLevel({
    islands: [
      [
        { x: 40, y: 15 },
        { x: 45, y: 15 },
        { x: 45, y: 25 },
        { x: 40, y: 25 },
      ],
    ],
  })
  assert.equal(onFairway(level, { x: 10, y: 20 }), true)
  assert.equal(onFairway(level, { x: 42, y: 20 }), false)
  assert.equal(onFairway(level, { x: 200, y: 20 }), false)
})

// ---------------------------------------------------------------------------
// launchState
// ---------------------------------------------------------------------------

test('launchState starts at `from` with speed power*maxSpeed along aim, counters zeroed', () => {
  const level = makeLevel()
  const from = { x: 10, y: 10 }
  const aim: Aim = { angle: 0, power: 0.5 }
  const s = launchState(level, from, aim)
  assert.deepEqual(s.pos, { x: 10, y: 10 })
  assert.ok(Math.abs(s.vel.x - 6) < 1e-9) // 0.5 * 12
  assert.ok(Math.abs(s.vel.y - 0) < 1e-9)
  assert.equal(s.t, 0)
  assert.equal(s.bounces, 0)
  assert.equal(s.lastBounceSpeed, 0)
})

// ---------------------------------------------------------------------------
// Friction on an empty rectangle
// ---------------------------------------------------------------------------

test('a putt on an empty course always ends in rest', () => {
  const level = makeLevel({ target: { pos: { x: -1000, y: -1000 }, radius: 0.01 } })
  const result = simulate(level, { x: 50, y: 20 }, { angle: 0, power: 0.4 })
  assert.equal(result.outcome, 'rest')
})

test('a harder putt rolls farther and takes longer', () => {
  const level = makeLevel({ target: { pos: { x: -1000, y: -1000 }, radius: 0.01 } })
  const soft = simulate(level, { x: 5, y: 20 }, { angle: 0, power: 0.2 })
  const hard = simulate(level, { x: 5, y: 20 }, { angle: 0, power: 0.9 })
  assert.equal(soft.outcome, 'rest')
  assert.equal(hard.outcome, 'rest')
  assert.ok(hard.end.x - 5 > soft.end.x - 5)
  assert.ok(hard.time > soft.time)
})

test('a full-power roll distance (maxSpeed 12) lands between 18 and 24 units', () => {
  const level = makeLevel({ target: { pos: { x: -1000, y: -1000 }, radius: 0.01 } })
  const result = simulate(level, { x: 5, y: 20 }, { angle: 0, power: 1 })
  assert.equal(result.outcome, 'rest')
  const dist = result.end.x - 5
  assert.ok(dist >= 18 && dist <= 24, `distance was ${dist}`)
})

test('the ball never speeds up on a body-free course while no wall is hit', () => {
  const level = makeLevel()
  const s = launchState(level, { x: 50, y: 20 }, { angle: 0, power: 0.6 })
  let prevSpeed = Math.hypot(s.vel.x, s.vel.y)
  for (let i = 0; i < 200; i++) {
    step(level, s)
    if (s.bounces > 0) break
    const speed = Math.hypot(s.vel.x, s.vel.y)
    assert.ok(speed <= prevSpeed + 1e-9, `speed increased at step ${i}`)
    prevSpeed = speed
  }
})

test('the resting point lies on the launch line for a wall-free straight putt', () => {
  const level = makeLevel({ target: { pos: { x: -1000, y: -1000 }, radius: 0.01 } })
  const from = { x: 5, y: 20 }
  const result = simulate(level, from, { angle: 0, power: 0.5 })
  assert.equal(result.outcome, 'rest')
  assert.ok(Math.abs(result.end.y - from.y) < 1e-6)
})

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

test('a putt at a wall bounces back, stays inside the course, and increments bounces', () => {
  const level = makeLevel()
  const s = launchState(level, { x: 90, y: 20 }, { angle: 0, power: 1 })
  for (let i = 0; i < 3000; i++) {
    step(level, s)
    assert.ok(
      pointInPolygon({ x: s.pos.x - BALL_RADIUS, y: s.pos.y }, level.course) ||
        pointInPolygon(s.pos, level.course),
      `ball escaped the course at step ${i}`,
    )
    // Tolerant containment check: shrink the ball radius margin against the walls.
    assert.ok(s.pos.x >= -BALL_RADIUS - 1e-6 && s.pos.x <= 100 + BALL_RADIUS + 1e-6)
    assert.ok(s.pos.y >= -BALL_RADIUS - 1e-6 && s.pos.y <= 40 + BALL_RADIUS + 1e-6)
    const outcome = checkOutcome(level, s)
    if (outcome.outcome) break
  }
  assert.ok(s.bounces >= 1)
})

test('speed after a head-on bounce is about WALL_RESTITUTION times speed before, within 3%', () => {
  const level = makeLevel()
  const s = launchState(level, { x: 90, y: 20 }, { angle: 0, power: 1 })
  let speedBefore = 0
  let ratio: number | null = null
  for (let i = 0; i < 3000 && ratio === null; i++) {
    const preSpeed = Math.hypot(s.vel.x, s.vel.y)
    const preBounces = s.bounces
    step(level, s)
    if (s.bounces > preBounces) {
      speedBefore = preSpeed
      const speedAfter = Math.hypot(s.vel.x, s.vel.y)
      ratio = speedAfter / speedBefore
    }
  }
  assert.ok(ratio !== null, 'no bounce occurred')
  assert.ok(Math.abs((ratio as number) - WALL_RESTITUTION) / WALL_RESTITUTION < 0.03, `ratio was ${ratio}`)
})

test('a 45-degree bank off a horizontal wall flips vy and keeps the vx sign', () => {
  const level = makeLevel()
  const s = launchState(level, { x: 50, y: 35 }, { angle: Math.PI / 4, power: 1 }) // up and to the right
  let before: Vec2 | null = null
  let after: Vec2 | null = null
  for (let i = 0; i < 3000 && after === null; i++) {
    const preVel = { x: s.vel.x, y: s.vel.y }
    const preBounces = s.bounces
    step(level, s)
    if (s.bounces > preBounces) {
      before = preVel
      after = { x: s.vel.x, y: s.vel.y }
    }
  }
  assert.ok(before && after, 'no bounce occurred')
  assert.ok((before as Vec2).x > 0 && (after as Vec2).x > 0, 'vx sign should be kept (positive)')
  assert.ok((before as Vec2).y > 0 && (after as Vec2).y < 0, 'vy sign should flip')
})

test('lastBounceSpeed is positive after a bounce', () => {
  const level = makeLevel()
  const s = launchState(level, { x: 90, y: 20 }, { angle: 0, power: 1 })
  for (let i = 0; i < 3000 && s.bounces === 0; i++) step(level, s)
  assert.ok(s.bounces >= 1)
  assert.ok(s.lastBounceSpeed > 0)
})

test('a ball rolling into a concave corner does not tunnel out', () => {
  // Concave notch: an L-shaped course. Aim the ball straight into the inner corner.
  const course: Vec2[] = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 20 },
    { x: 0, y: 20 },
  ]
  const level = makeLevel({ course, target: { pos: { x: -1000, y: -1000 }, radius: 0.01 } })
  // Inner (concave) corner is at (10, 10). Aim from inside the L straight at it.
  const s = launchState(level, { x: 5, y: 5 }, { angle: Math.atan2(10 - 5, 10 - 5), power: 1 })
  for (let i = 0; i < 5000; i++) {
    step(level, s)
    assert.ok(
      pointInPolygon(s.pos, course) ||
        Math.hypot(s.pos.x - 10, s.pos.y - 10) < BALL_RADIUS + 0.5,
      `ball tunneled out at step ${i}: (${s.pos.x}, ${s.pos.y})`,
    )
    if (checkOutcome(level, s).outcome) break
  }
})

test('a ball already touching a wall and heading away from it is not reflected', () => {
  const level = makeLevel()
  // Right wall is at x = 100. Put the ball right at the touching distance, heading left (away).
  const s: BallState = {
    pos: { x: 100 - BALL_RADIUS, y: 20 },
    vel: { x: -3, y: 0 },
    t: 0,
    bounces: 0,
    lastBounceSpeed: 0,
  }
  step(level, s)
  assert.equal(s.bounces, 0)
  assert.ok(s.vel.x < 0, 'ball should keep moving away from the wall')
})

// ---------------------------------------------------------------------------
// Islands
// ---------------------------------------------------------------------------

test('a putt straight at an island bounces back and never enters it', () => {
  const island: Vec2[] = [
    { x: 55, y: 15 },
    { x: 65, y: 15 },
    { x: 65, y: 25 },
    { x: 55, y: 25 },
  ]
  const level = makeLevel({ islands: [island], target: { pos: { x: -1000, y: -1000 }, radius: 0.01 } })
  const s = launchState(level, { x: 50, y: 20 }, { angle: 0, power: 1 })
  let bounced = false
  for (let i = 0; i < 5000; i++) {
    step(level, s)
    assert.equal(pointInPolygon(s.pos, island), false, `ball entered the island at step ${i}`)
    if (s.bounces > 0) bounced = true
    if (checkOutcome(level, s).outcome) break
  }
  assert.ok(bounced)
})

// ---------------------------------------------------------------------------
// Cup
// ---------------------------------------------------------------------------

test('a slow putt over the cup is a goal, and closest is ~0', () => {
  const level = makeLevel({
    course: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ],
    target: { pos: { x: 12, y: 5 }, radius: 0.05 },
  })
  const result = simulate(level, { x: 5, y: 5 }, { angle: 0, power: 0.6 })
  assert.equal(result.outcome, 'goal')
  assert.ok(result.closest < 0.05, `closest was ${result.closest}`)
})

test('a putt crossing the cup faster than CAPTURE_SPEED skips over (not a goal at that moment)', () => {
  const level = makeLevel({
    course: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 10 },
      { x: 0, y: 10 },
    ],
    target: { pos: { x: 15, y: 5 }, radius: 1 },
    maxSpeed: 12,
  })
  const s = launchState(level, { x: 5, y: 5 }, { angle: 0, power: 1 })
  let sawCloseWhileFast = false
  for (let i = 0; i < 500; i++) {
    const outcome = checkOutcome(level, s)
    if (outcome.targetDistance <= level.target.radius) {
      const speed = Math.hypot(s.vel.x, s.vel.y)
      if (speed > CAPTURE_SPEED) {
        sawCloseWhileFast = true
        assert.notEqual(outcome.outcome, 'goal')
      }
    }
    if (outcome.outcome) break
    step(level, s)
  }
  assert.ok(sawCloseWhileFast, 'test setup did not reach the cup while still fast')
})

// ---------------------------------------------------------------------------
// Hazards
// ---------------------------------------------------------------------------

test('a putt into a planet ends hazard with that body id', () => {
  const planet = bodyFixture({ id: 'planet-x', pos: { x: 60, y: 20 }, mu: 5, radius: 2 })
  const level = makeLevel({ bodies: [planet], target: { pos: { x: -1000, y: -1000 }, radius: 0.01 } })
  const result = simulate(level, { x: 50, y: 20 }, { angle: 0, power: 1 })
  assert.equal(result.outcome, 'hazard')
  assert.equal(result.hazardId, 'planet-x')
})

test('an asteroid (mu 0) is a hazard but adds no acceleration', () => {
  const asteroid = bodyFixture({ id: 'ast-1', kind: 'asteroid', mu: 0, pos: { x: 5, y: 5 }, radius: 1 })
  const level = makeLevel({ bodies: [asteroid] })
  const out: Vec2 = { x: 0, y: 0 }
  acceleration(level, 0, 0, 0, out)
  assert.equal(out.x, 0)
  assert.equal(out.y, 0)

  const s: BallState = { pos: { x: 3, y: 5 }, vel: { x: 1, y: 0 }, t: 0, bounces: 0, lastBounceSpeed: 0 }
  const outcome = checkOutcome(level, s)
  // Not yet within the hazard radius, so not yet a hazard.
  assert.equal(outcome.outcome, null)
  s.pos.x = 5.5
  const outcome2 = checkOutcome(level, s)
  assert.equal(outcome2.outcome, 'hazard')
  assert.equal(outcome2.hazardId, 'ast-1')
})

test('a moon on a rail is only a hazard when it is actually there at that time', () => {
  const rail: Rail = { center: { x: 60, y: 20 }, radius: 10, period: 20, phase: 0 }
  const moon = bodyFixture({ id: 'moon-1', kind: 'moon', mu: 0, radius: 2, pos: { x: 0, y: 0 }, rail })
  const level = makeLevel({ bodies: [moon] })
  // At t=0 the moon sits at (70, 20) (center + radius on the phase=0 direction).
  const sAt = { pos: { x: 70, y: 20 }, vel: { x: 0, y: 0 }, t: 0, bounces: 0, lastBounceSpeed: 0 }
  assert.equal(checkOutcome(level, sAt).outcome, 'hazard')
  // At the same spatial point but a different time, the moon has moved away.
  const sAway = { pos: { x: 70, y: 20 }, vel: { x: 0, y: 0 }, t: 5, bounces: 0, lastBounceSpeed: 0 }
  assert.notEqual(checkOutcome(level, sAway).outcome, 'hazard')
})

// ---------------------------------------------------------------------------
// Gravity bends the putt
// ---------------------------------------------------------------------------

test('gravity from a nearby planet displaces the resting point toward it', () => {
  const from = { x: 5, y: 20 }
  const aim: Aim = { angle: 0, power: 0.5 }
  const withoutPlanet = makeLevel({ target: { pos: { x: -1000, y: -1000 }, radius: 0.01 } })
  const planet = bodyFixture({ id: 'p1', pos: { x: 20, y: 26 }, mu: 8, radius: 1 })
  const withPlanet = makeLevel({
    bodies: [planet],
    target: { pos: { x: -1000, y: -1000 }, radius: 0.01 },
  })

  const r1 = simulate(withoutPlanet, from, aim)
  const r2 = simulate(withPlanet, from, aim)
  assert.equal(r1.outcome, 'rest')
  // Displacement toward the planet means a higher y (planet is above the line at y=20).
  assert.ok(r2.end.y > r1.end.y, `expected displacement toward the planet: ${r2.end.y} vs ${r1.end.y}`)
})

test('a stationary ball near a heavy body (|accel| > ROLL_DECEL) is not at rest and ends hazard', () => {
  const heavy = bodyFixture({ id: 'heavy', mu: 50, radius: 1, pos: { x: 10, y: 10 } })
  const level = makeLevel({ bodies: [heavy], target: { pos: { x: -1000, y: -1000 }, radius: 0.01 } })
  const probe: Vec2 = { x: 0, y: 0 }
  acceleration(level, 11.5, 10, 0, probe)
  assert.ok(Math.hypot(probe.x, probe.y) > ROLL_DECEL, 'fixture check: acceleration should exceed ROLL_DECEL')

  const s: BallState = { pos: { x: 11.5, y: 10 }, vel: { x: 0, y: 0 }, t: 0, bounces: 0, lastBounceSpeed: 0 }
  const immediate = checkOutcome(level, s)
  assert.notEqual(immediate.outcome, 'rest')

  // Roll it forward until it actually reaches the body.
  let outcome = immediate
  for (let i = 0; i < 2000 && !outcome.outcome; i++) {
    step(level, s)
    outcome = checkOutcome(level, s)
  }
  assert.equal(outcome.outcome, 'hazard')
  assert.equal(outcome.hazardId, 'heavy')
})

test('a stationary ball far from any body (|accel| <= ROLL_DECEL) reports rest immediately', () => {
  const heavy = bodyFixture({ id: 'heavy', mu: 50, radius: 1, pos: { x: 10, y: 10 } })
  const level = makeLevel({ bodies: [heavy], target: { pos: { x: -1000, y: -1000 }, radius: 0.01 } })
  const probe: Vec2 = { x: 0, y: 0 }
  acceleration(level, 80, 20, 0, probe)
  assert.ok(Math.hypot(probe.x, probe.y) <= ROLL_DECEL, 'fixture check: acceleration should be small far away')

  const s: BallState = { pos: { x: 80, y: 20 }, vel: { x: 0, y: 0 }, t: 0, bounces: 0, lastBounceSpeed: 0 }
  const outcome = checkOutcome(level, s)
  assert.equal(outcome.outcome, 'rest')
})

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('the same shot simulated twice gives identical time, end, and bounces', () => {
  const planet = bodyFixture({ id: 'p1', pos: { x: 60, y: 22 }, mu: 6, radius: 1.5 })
  const level = makeLevel({ bodies: [planet] })
  const from = { x: 10, y: 15 }
  const aim: Aim = { angle: 0.2, power: 0.8 }
  const r1 = simulate(level, from, aim)
  const r2 = simulate(level, from, aim)
  assert.equal(r1.time, r2.time)
  assert.deepEqual(r1.end, r2.end)
  assert.equal(r1.bounces, r2.bounces)
  assert.equal(r1.outcome, r2.outcome)
})

// ---------------------------------------------------------------------------
// predictPath
// ---------------------------------------------------------------------------

test('predictPath returns an even-length array starting at `from`', () => {
  const level = makeLevel({ target: { pos: { x: -1000, y: -1000 }, radius: 0.01 } })
  const from = { x: 50, y: 20 }
  const path = predictPath(level, from, { angle: 0, power: 0.3 }, 1)
  assert.equal(path.length % 2, 0)
  assert.equal(path[0], from.x)
  assert.equal(path[1], from.y)
})

test('predictPath includes a direction change after a bounce', () => {
  const level = makeLevel({ target: { pos: { x: -1000, y: -1000 }, radius: 0.01 } })
  const from = { x: 90, y: 20 }
  const path = predictPath(level, from, { angle: 0, power: 1 }, 2, 1)
  // Find the max x reached, then confirm it decreases afterward (i.e. the ball reverses direction).
  let maxX = -Infinity
  let maxIdx = -1
  for (let i = 0; i < path.length; i += 2) {
    if (path[i] > maxX) {
      maxX = path[i]
      maxIdx = i
    }
  }
  assert.ok(maxIdx >= 0 && maxIdx + 2 < path.length, 'no point after the peak to compare')
  assert.ok(path[maxIdx + 2] < maxX, 'expected the path to move back after bouncing')
})

test('predictPath stops early at a hazard', () => {
  const planet = bodyFixture({ id: 'p1', pos: { x: 60, y: 20 }, mu: 5, radius: 2 })
  const level = makeLevel({ bodies: [planet], target: { pos: { x: -1000, y: -1000 }, radius: 0.01 } })
  const from = { x: 50, y: 20 }
  const path = predictPath(level, from, { angle: 0, power: 1 }, 5)
  const lastX = path[path.length - 2]
  const lastY = path[path.length - 1]
  assert.ok(Math.hypot(lastX - planet.pos.x, lastY - planet.pos.y) <= planet.radius + BALL_RADIUS * 0.5 + 1e-6)
})

// ---------------------------------------------------------------------------
// defaultAim
// ---------------------------------------------------------------------------

test('defaultAim points from the given point at the cup with power 0.5', () => {
  const level = makeLevel({ target: { pos: { x: 10, y: 30 }, radius: 1 } })
  const from = { x: 10, y: 10 }
  const aim = defaultAim(level, from)
  assert.ok(Math.abs(aim.angle - Math.PI / 2) < 1e-9)
  assert.equal(aim.power, 0.5)
})

// ---------------------------------------------------------------------------
// MAX_SHOT_TIME
// ---------------------------------------------------------------------------

test('MAX_SHOT_TIME forces rest even while still moving', () => {
  const level = makeLevel()
  const s: BallState = {
    pos: { x: 50, y: 20 },
    vel: { x: 3, y: 0 },
    t: MAX_SHOT_TIME,
    bounces: 0,
    lastBounceSpeed: 0,
  }
  const outcome = checkOutcome(level, s)
  assert.equal(outcome.outcome, 'rest')
})
