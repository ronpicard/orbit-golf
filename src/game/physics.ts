import type { Aim, Body, Level, Outcome, ProbeState, Rail, SimResult, Target, Vec2 } from './types.ts'

/** Fixed physics step. The renderer advances the simulation in whole steps so replays are exact. */
export const DT = 1 / 240
export const MIN_POWER = 0.05
/** Gap between the home planet's surface and the probe at launch. */
export const LAUNCH_CLEARANCE = 0.12

const TAU = Math.PI * 2

export function railPosition(rail: Rail, t: number): Vec2 {
  const a = rail.phase + (TAU * t) / rail.period
  return { x: rail.center.x + rail.radius * Math.cos(a), y: rail.center.y + rail.radius * Math.sin(a) }
}

export function bodyPosition(body: Body, t: number): Vec2 {
  return body.rail ? railPosition(body.rail, t) : body.pos
}

export function targetPosition(target: Target, t: number): Vec2 {
  return target.rail ? railPosition(target.rail, t) : target.pos
}

export function clampAim(aim: Aim): Aim {
  let angle = aim.angle % TAU
  if (angle > Math.PI) angle -= TAU
  if (angle < -Math.PI) angle += TAU
  return { angle, power: Math.min(1, Math.max(MIN_POWER, aim.power)) }
}

export function homeBody(level: Level): Body {
  const home = level.bodies.find((b) => b.id === level.homeId)
  if (!home) throw new Error(`Level ${level.id} has no body with id ${level.homeId}`)
  return home
}

/** Newtonian acceleration at a point: sum of mu * r / |r|^3 over every massive body. */
export function acceleration(level: Level, x: number, y: number, t: number, out: Vec2): Vec2 {
  let ax = 0
  let ay = 0
  for (const body of level.bodies) {
    if (body.mu === 0) continue
    const p = bodyPosition(body, t)
    const dx = p.x - x
    const dy = p.y - y
    const r2 = dx * dx + dy * dy
    // Inside a body the probe has already crashed; the floor only guards the division.
    const r = Math.sqrt(Math.max(r2, 1e-6))
    const k = body.mu / (r2 * r || 1e-9)
    ax += dx * k
    ay += dy * k
  }
  out.x = ax
  out.y = ay
  return out
}

export function launchState(level: Level, rawAim: Aim): ProbeState {
  const aim = clampAim(rawAim)
  const home = homeBody(level)
  const p = bodyPosition(home, 0)
  const d = home.radius + LAUNCH_CLEARANCE
  const speed = aim.power * level.maxSpeed
  const cx = Math.cos(aim.angle)
  const cy = Math.sin(aim.angle)
  return {
    pos: { x: p.x + cx * d, y: p.y + cy * d },
    vel: { x: cx * speed, y: cy * speed },
    t: 0,
  }
}

const a0: Vec2 = { x: 0, y: 0 }
const a1: Vec2 = { x: 0, y: 0 }

/**
 * One velocity-Verlet step, in place. Verlet is symplectic: unlike explicit Euler it does not
 * pump energy into the orbit, so closed orbits stay closed instead of spiralling outward.
 */
export function step(level: Level, s: ProbeState, dt: number = DT): void {
  acceleration(level, s.pos.x, s.pos.y, s.t, a0)
  s.pos.x += s.vel.x * dt + 0.5 * a0.x * dt * dt
  s.pos.y += s.vel.y * dt + 0.5 * a0.y * dt * dt
  s.t += dt
  acceleration(level, s.pos.x, s.pos.y, s.t, a1)
  s.vel.x += 0.5 * (a0.x + a1.x) * dt
  s.vel.y += 0.5 * (a0.y + a1.y) * dt
}

export interface OutcomeCheck {
  outcome: Outcome | null
  crashedInto: string | null
  targetDistance: number
}

export function checkOutcome(level: Level, s: ProbeState): OutcomeCheck {
  const tp = targetPosition(level.target, s.t)
  const targetDistance = Math.hypot(tp.x - s.pos.x, tp.y - s.pos.y)
  if (targetDistance <= level.target.radius) return { outcome: 'goal', crashedInto: null, targetDistance }
  for (const body of level.bodies) {
    const p = bodyPosition(body, s.t)
    if (Math.hypot(p.x - s.pos.x, p.y - s.pos.y) <= body.radius) {
      return { outcome: 'crash', crashedInto: body.id, targetDistance }
    }
  }
  const b = level.bounds
  if (s.pos.x < b.minX || s.pos.x > b.maxX || s.pos.y < b.minY || s.pos.y > b.maxY) {
    return { outcome: 'lost', crashedInto: null, targetDistance }
  }
  if (s.t >= level.maxTime) return { outcome: 'timeout', crashedInto: null, targetDistance }
  return { outcome: null, crashedInto: null, targetDistance }
}

/** Flies a whole shot headlessly. Used by tests, the level solver, and nothing in the render loop. */
export function simulate(level: Level, aim: Aim): SimResult {
  const s = launchState(level, aim)
  let closest = Infinity
  for (;;) {
    const c = checkOutcome(level, s)
    if (c.targetDistance < closest) closest = c.targetDistance
    if (c.outcome) return { outcome: c.outcome, crashedInto: c.crashedInto, time: s.t, closest }
    step(level, s)
  }
}

/**
 * The short aiming preview: flat [x0, y0, x1, y1, ...] sampled every `stride` steps. It stops at
 * the first collision, exit, or goal, so the preview never draws through a planet.
 */
export function predictPath(level: Level, aim: Aim, seconds: number, stride = 4): number[] {
  const s = launchState(level, aim)
  const points = [s.pos.x, s.pos.y]
  const steps = Math.round(seconds / DT)
  for (let i = 1; i <= steps; i++) {
    step(level, s)
    const done = checkOutcome(level, s).outcome !== null
    if (i % stride === 0 || done) points.push(s.pos.x, s.pos.y)
    if (done) break
  }
  return points
}

/** Specific orbital energy relative to one body: negative means bound to it. */
export function specificEnergy(body: Body, s: ProbeState): number {
  const p = bodyPosition(body, s.t)
  const r = Math.hypot(p.x - s.pos.x, p.y - s.pos.y)
  return 0.5 * (s.vel.x * s.vel.x + s.vel.y * s.vel.y) - body.mu / r
}

/** Angle from the home planet toward the target at t = 0: the default aim for a new level. */
export function defaultAim(level: Level): Aim {
  const h = bodyPosition(homeBody(level), 0)
  const t = targetPosition(level.target, 0)
  return { angle: Math.atan2(t.y - h.y, t.x - h.x), power: 0.5 }
}
