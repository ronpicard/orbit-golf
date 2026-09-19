import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Aim, Body, Level, ProbeState, Rail } from './types.ts'
import {
  DT,
  MIN_POWER,
  LAUNCH_CLEARANCE,
  railPosition,
  clampAim,
  launchState,
  acceleration,
  step,
  checkOutcome,
  simulate,
  predictPath,
  specificEnergy,
  defaultAim,
} from './physics.ts'

const TAU = Math.PI * 2

function makeBody(overrides: Partial<Body> = {}): Body {
  return {
    id: 'home',
    kind: 'planet',
    mu: 0,
    radius: 1,
    pos: { x: 0, y: 0 },
    palette: ['#111111', '#222222'],
    ...overrides,
  }
}

function makeLevel(overrides: Partial<Level> = {}): Level {
  return {
    id: 'test-level',
    name: 'Test Level',
    hint: 'A test level',
    par: 3,
    homeId: 'home',
    bodies: [makeBody()],
    target: { pos: { x: 20, y: 0 }, radius: 1 },
    bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
    maxSpeed: 10,
    maxTime: 30,
    ...overrides,
  }
}

// ---------- railPosition ----------

test('railPosition returns the phase point at t = 0', () => {
  const rail: Rail = { center: { x: 1, y: 2 }, radius: 5, period: 4, phase: Math.PI / 3 }
  const p = railPosition(rail, 0)
  assert.ok(Math.abs(p.x - (1 + 5 * Math.cos(Math.PI / 3))) < 1e-9)
  assert.ok(Math.abs(p.y - (2 + 5 * Math.sin(Math.PI / 3))) < 1e-9)
})

test('railPosition returns to the phase point after one period', () => {
  const rail: Rail = { center: { x: 0, y: 0 }, radius: 3, period: 7, phase: 1.1 }
  const p0 = railPosition(rail, 0)
  const p1 = railPosition(rail, 7)
  assert.ok(Math.abs(p0.x - p1.x) < 1e-9)
  assert.ok(Math.abs(p0.y - p1.y) < 1e-9)
})

test('railPosition with negative period orbits clockwise', () => {
  const rail: Rail = { center: { x: 0, y: 0 }, radius: 1, period: -4, phase: 0 }
  // With a positive period, a small positive dt increases the angle (counter-clockwise);
  // with a negative period the angle decreases (clockwise).
  const pPos = railPosition({ ...rail, period: 4 }, 0.1)
  const pNeg = railPosition(rail, 0.1)
  const angPos = Math.atan2(pPos.y, pPos.x)
  const angNeg = Math.atan2(pNeg.y, pNeg.x)
  assert.ok(angPos > 0)
  assert.ok(angNeg < 0)
  assert.ok(Math.abs(angPos + angNeg) < 1e-9)
})

// ---------- clampAim ----------

test('clampAim clamps power to [MIN_POWER, 1]', () => {
  assert.equal(clampAim({ angle: 0, power: -5 }).power, MIN_POWER)
  assert.equal(clampAim({ angle: 0, power: 0 }).power, MIN_POWER)
  assert.equal(clampAim({ angle: 0, power: 2 }).power, 1)
  assert.equal(clampAim({ angle: 0, power: 0.5 }).power, 0.5)
})

test('clampAim wraps angle into [-PI, PI]', () => {
  const a1 = clampAim({ angle: 4, power: 0.5 })
  assert.ok(a1.angle >= -Math.PI && a1.angle <= Math.PI)
  assert.ok(Math.abs(a1.angle - (4 - TAU)) < 1e-9)

  const a2 = clampAim({ angle: -4, power: 0.5 })
  assert.ok(a2.angle >= -Math.PI && a2.angle <= Math.PI)
  assert.ok(Math.abs(a2.angle - (-4 + TAU)) < 1e-9)

  const a3 = clampAim({ angle: Math.PI / 2, power: 0.5 })
  assert.ok(Math.abs(a3.angle - Math.PI / 2) < 1e-9)
})

// ---------- launchState ----------

test('launchState starts at home radius + clearance along aim with speed power * maxSpeed', () => {
  const home = makeBody({ id: 'home', radius: 2, pos: { x: 5, y: -3 } })
  const level = makeLevel({ bodies: [home], homeId: 'home', maxSpeed: 8 })
  const aim: Aim = { angle: Math.PI / 4, power: 0.5 }
  const s = launchState(level, aim)
  const d = home.radius + LAUNCH_CLEARANCE
  const expectedX = home.pos.x + Math.cos(Math.PI / 4) * d
  const expectedY = home.pos.y + Math.sin(Math.PI / 4) * d
  assert.ok(Math.abs(s.pos.x - expectedX) < 1e-9)
  assert.ok(Math.abs(s.pos.y - expectedY) < 1e-9)
  const speed = Math.hypot(s.vel.x, s.vel.y)
  assert.ok(Math.abs(speed - 0.5 * 8) < 1e-9)
  assert.equal(s.t, 0)
})

// ---------- acceleration ----------

test('acceleration points at a single body with magnitude mu / r^2', () => {
  const body = makeBody({ id: 'planet', mu: 50, radius: 1, pos: { x: 10, y: 0 } })
  const level = makeLevel({ bodies: [body], homeId: 'planet' })
  const out = { x: 0, y: 0 }
  acceleration(level, 0, 0, 0, out)
  const r2 = 100
  const expectedMag = 50 / r2
  const mag = Math.hypot(out.x, out.y)
  assert.ok(Math.abs(mag - expectedMag) < 1e-6)
  // Direction should point toward the body, i.e. +x.
  assert.ok(out.x > 0)
  assert.ok(Math.abs(out.y) < 1e-9)
})

test('zero-mu asteroids contribute nothing to acceleration', () => {
  const planet = makeBody({ id: 'planet', mu: 50, radius: 1, pos: { x: 10, y: 0 } })
  const asteroid = makeBody({ id: 'rock', kind: 'asteroid', mu: 0, radius: 0.5, pos: { x: 0, y: 10 } })
  const levelWithout = makeLevel({ bodies: [planet], homeId: 'planet' })
  const levelWith = makeLevel({ bodies: [planet, asteroid], homeId: 'planet' })
  const outWithout = { x: 0, y: 0 }
  const outWith = { x: 0, y: 0 }
  acceleration(levelWithout, 0, 0, 0, outWithout)
  acceleration(levelWith, 0, 0, 0, outWith)
  assert.ok(Math.abs(outWithout.x - outWith.x) < 1e-12)
  assert.ok(Math.abs(outWithout.y - outWith.y) < 1e-12)
})

// ---------- energy conservation ----------

test('a circular orbit conserves specific energy and radius over 3 orbits', () => {
  const mu = 400
  const r = 10
  const central = makeBody({ id: 'star', mu, radius: 0.5, pos: { x: 0, y: 0 } })
  const level = makeLevel({ bodies: [central], homeId: 'star', bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 } })
  const speed = Math.sqrt(mu / r)
  const s: ProbeState = { pos: { x: r, y: 0 }, vel: { x: 0, y: speed }, t: 0 }
  const initialEnergy = specificEnergy(central, s)
  const period = TAU * Math.sqrt((r * r * r) / mu)
  const totalTime = period * 3
  const steps = Math.round(totalTime / DT)
  let maxEnergyDrift = 0
  let maxRadiusDrift = 0
  for (let i = 0; i < steps; i++) {
    step(level, s)
    const e = specificEnergy(central, s)
    const radius = Math.hypot(s.pos.x, s.pos.y)
    maxEnergyDrift = Math.max(maxEnergyDrift, Math.abs((e - initialEnergy) / initialEnergy))
    maxRadiusDrift = Math.max(maxRadiusDrift, Math.abs((radius - r) / r))
  }
  assert.ok(maxEnergyDrift < 0.001, `energy drift too large: ${maxEnergyDrift}`)
  assert.ok(maxRadiusDrift < 0.005, `radius drift too large: ${maxRadiusDrift}`)
})

// ---------- simulate ----------

test('simulate: a straight shot at a target with no obstacles returns goal', () => {
  const home = makeBody({ id: 'home', mu: 0, radius: 1, pos: { x: 0, y: 0 } })
  const level = makeLevel({
    bodies: [home],
    homeId: 'home',
    target: { pos: { x: 20, y: 0 }, radius: 2 },
    bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
  })
  const aim: Aim = { angle: 0, power: 1 }
  const result = simulate(level, aim)
  assert.equal(result.outcome, 'goal')
})

test('simulate: aimed straight at a planet in the way returns crash with that body id', () => {
  const home = makeBody({ id: 'home', mu: 0, radius: 1, pos: { x: 0, y: 0 } })
  const blocker = makeBody({ id: 'blocker', mu: 0, radius: 1.5, pos: { x: 8, y: 0 } })
  const level = makeLevel({
    bodies: [home, blocker],
    homeId: 'home',
    target: { pos: { x: 20, y: 0 }, radius: 1 },
    bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
  })
  const aim: Aim = { angle: 0, power: 1 }
  const result = simulate(level, aim)
  assert.equal(result.outcome, 'crash')
  assert.equal(result.crashedInto, 'blocker')
})

test('simulate: aimed away from everything returns lost', () => {
  const home = makeBody({ id: 'home', mu: 0, radius: 1, pos: { x: 0, y: 0 } })
  const level = makeLevel({
    bodies: [home],
    homeId: 'home',
    target: { pos: { x: 20, y: 0 }, radius: 1 },
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  })
  const aim: Aim = { angle: Math.PI, power: 1 }
  const result = simulate(level, aim)
  assert.equal(result.outcome, 'lost')
})

test('simulate: a low power probe falls back onto the home planet returns crash into home', () => {
  const home = makeBody({ id: 'home', mu: 2000, radius: 1, pos: { x: 0, y: 0 } })
  const level = makeLevel({
    bodies: [home],
    homeId: 'home',
    target: { pos: { x: 50, y: 50 }, radius: 1 },
    bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 },
    maxSpeed: 10,
    maxTime: 60,
  })
  const aim: Aim = { angle: 0, power: MIN_POWER }
  const result = simulate(level, aim)
  assert.equal(result.outcome, 'crash')
  assert.equal(result.crashedInto, 'home')
})

test('simulate: a bound orbit that never ends returns timeout at maxTime', () => {
  const mu = 400
  const r = 10
  const central = makeBody({ id: 'star', mu, radius: 0.2, pos: { x: 0, y: 0 } })
  // Home sits on the orbit circle; aiming tangentially (perpendicular to the radius vector)
  // launches the probe into a roughly circular orbit around the star.
  const home = makeBody({ id: 'home', mu: 0, radius: 0.3, pos: { x: r, y: 0 } })
  const speed = Math.sqrt(mu / r)
  const level = makeLevel({
    bodies: [central, home],
    homeId: 'home',
    target: { pos: { x: 1000, y: 1000 }, radius: 1 },
    bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 },
    maxSpeed: speed,
    maxTime: 0.5,
  })
  // Aim perpendicular to the home->star radius so the launch velocity is tangential.
  const aim: Aim = { angle: Math.PI / 2, power: 1 }
  const result = simulate(level, aim)
  assert.equal(result.outcome, 'timeout')
  // simulate only checks the outcome between whole steps, so time lands at maxTime plus at
  // most one DT of overshoot rather than exactly at maxTime.
  assert.ok(result.time >= level.maxTime)
  assert.ok(result.time < level.maxTime + DT + 1e-9)
})

test('simulate is deterministic for the same aim', () => {
  const home = makeBody({ id: 'home', mu: 50, radius: 1, pos: { x: 0, y: 0 } })
  const blocker = makeBody({ id: 'blocker', mu: 10, radius: 1, pos: { x: 15, y: 5 } })
  const level = makeLevel({
    bodies: [home, blocker],
    homeId: 'home',
    target: { pos: { x: 20, y: 0 }, radius: 1 },
    bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
  })
  const aim: Aim = { angle: 0.3, power: 0.7 }
  const r1 = simulate(level, aim)
  const r2 = simulate(level, aim)
  assert.equal(r1.time, r2.time)
  assert.equal(r1.closest, r2.closest)
  assert.equal(r1.outcome, r2.outcome)
  assert.equal(r1.crashedInto, r2.crashedInto)
})

// ---------- predictPath ----------

test('predictPath returns an even-length array starting at the launch point', () => {
  const home = makeBody({ id: 'home', mu: 0, radius: 1, pos: { x: 0, y: 0 } })
  const level = makeLevel({
    bodies: [home],
    homeId: 'home',
    target: { pos: { x: 1000, y: 1000 }, radius: 1 },
    bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 },
  })
  const aim: Aim = { angle: 0.2, power: 0.5 }
  const s0 = launchState(level, aim)
  const path = predictPath(level, aim, 2)
  assert.equal(path.length % 2, 0)
  assert.ok(Math.abs(path[0] - s0.pos.x) < 1e-9)
  assert.ok(Math.abs(path[1] - s0.pos.y) < 1e-9)
})

test('predictPath stops early when the path hits a body', () => {
  const home = makeBody({ id: 'home', mu: 0, radius: 1, pos: { x: 0, y: 0 } })
  const blocker = makeBody({ id: 'blocker', mu: 0, radius: 1.5, pos: { x: 8, y: 0 } })
  const level = makeLevel({
    bodies: [home, blocker],
    homeId: 'home',
    target: { pos: { x: 1000, y: 1000 }, radius: 1 },
    bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 },
  })
  const aim: Aim = { angle: 0, power: 1 }
  const pathHit = predictPath(level, aim, 10, 4)
  const pathFull = predictPath(makeLevel({
    bodies: [home],
    homeId: 'home',
    target: { pos: { x: 1000, y: 1000 }, radius: 1 },
    bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 },
  }), aim, 10, 4)
  assert.ok(pathHit.length < pathFull.length)
  assert.equal(pathHit.length % 2, 0)
})

// ---------- defaultAim ----------

test('defaultAim points from home to target', () => {
  const home = makeBody({ id: 'home', mu: 0, radius: 1, pos: { x: 3, y: 4 } })
  const level = makeLevel({
    bodies: [home],
    homeId: 'home',
    target: { pos: { x: 13, y: 4 }, radius: 1 },
  })
  const aim = defaultAim(level)
  assert.ok(Math.abs(aim.angle - 0) < 1e-9)

  const home2 = makeBody({ id: 'home', mu: 0, radius: 1, pos: { x: 0, y: 0 } })
  const level2 = makeLevel({
    bodies: [home2],
    homeId: 'home',
    target: { pos: { x: 0, y: 10 }, radius: 1 },
  })
  const aim2 = defaultAim(level2)
  assert.ok(Math.abs(aim2.angle - Math.PI / 2) < 1e-9)
})

// ---------- checkOutcome with a moving body on a rail ----------

test('checkOutcome reports a crash when the probe sits where the moon is at that t', () => {
  const home = makeBody({ id: 'home', mu: 0, radius: 1, pos: { x: 0, y: 0 } })
  const rail: Rail = { center: { x: 0, y: 0 }, radius: 10, period: 20, phase: 0 }
  const moon = makeBody({ id: 'moon', mu: 0, radius: 1, pos: { x: 10, y: 0 }, rail })
  const level = makeLevel({
    bodies: [home, moon],
    homeId: 'home',
    target: { pos: { x: 1000, y: 1000 }, radius: 1 },
    bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 },
  })

  const t0 = 5
  const moonPosAtT0 = railPosition(rail, t0)
  const probeAtMoon: ProbeState = { pos: { x: moonPosAtT0.x, y: moonPosAtT0.y }, vel: { x: 0, y: 0 }, t: t0 }
  const hit = checkOutcome(level, probeAtMoon)
  assert.equal(hit.outcome, 'crash')
  assert.equal(hit.crashedInto, 'moon')
})

test('checkOutcome does not crash into the moon when t differs and the moon has moved away', () => {
  const home = makeBody({ id: 'home', mu: 0, radius: 1, pos: { x: 0, y: 0 } })
  const rail: Rail = { center: { x: 0, y: 0 }, radius: 10, period: 20, phase: 0 }
  const moon = makeBody({ id: 'moon', mu: 0, radius: 1, pos: { x: 10, y: 0 }, rail })
  const level = makeLevel({
    bodies: [home, moon],
    homeId: 'home',
    target: { pos: { x: 1000, y: 1000 }, radius: 1 },
    bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 },
  })

  const t0 = 5
  const moonPosAtT0 = railPosition(rail, t0)
  // Same position as the moon at t0, but a different t (moon is now at quarter-period away).
  const probeElsewhere: ProbeState = { pos: { x: moonPosAtT0.x, y: moonPosAtT0.y }, vel: { x: 0, y: 0 }, t: t0 + 5 }
  const result = checkOutcome(level, probeElsewhere)
  assert.notEqual(result.crashedInto, 'moon')
})
