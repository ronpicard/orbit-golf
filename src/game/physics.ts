import type { Aim, BallState, Body, Bounds, Level, Outcome, Rail, ShotResult, Target, Vec2 } from './types.ts'

/** Fixed physics step. The renderer advances the simulation in whole steps so replays are exact. */
export const DT = 1 / 240
export const MIN_POWER = 0.05
export const BALL_RADIUS = 0.16

/** Constant rolling resistance, in units/s^2. This is what finally stops the ball. */
export const ROLL_DECEL = 1.6
/** Speed-proportional drag, in 1/s. Bleeds off hard shots quickly, like real felt. */
export const LINEAR_DRAG = 0.22
/** Fraction of the into-wall speed kept after a bounce. */
export const WALL_RESTITUTION = 0.78
/** Fraction of the along-wall speed kept after a bounce. */
export const WALL_GRIP = 0.97
/** A ball crossing the cup faster than this skips over it, like a real lip-out. */
export const CAPTURE_SPEED = 6.5
/** Below this speed the ball counts as stopped, provided gravity cannot restart it. */
export const REST_SPEED = 0.06
/** A shot that is somehow still moving after this long is frozen where it is. */
export const MAX_SHOT_TIME = 25

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

export function courseBounds(course: Vec2[]): Bounds {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of course) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, maxX, minY, maxY }
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** True when a point is on the fairway: inside the outer wall and outside every island. */
export function onFairway(level: Level, p: Vec2): boolean {
  if (!pointInPolygon(p, level.course)) return false
  for (const island of level.islands) if (pointInPolygon(p, island)) return false
  return true
}

interface Wall {
  ax: number
  ay: number
  bx: number
  by: number
  /** Bounding box grown by the ball radius, for a cheap early-out. */
  minX: number
  maxX: number
  minY: number
  maxY: number
}

const wallCache = new WeakMap<Level, Wall[]>()

function buildWalls(level: Level): Wall[] {
  const walls: Wall[] = []
  for (const loop of [level.course, ...level.islands]) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]
      const b = loop[(i + 1) % loop.length]
      walls.push({
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        minX: Math.min(a.x, b.x) - BALL_RADIUS,
        maxX: Math.max(a.x, b.x) + BALL_RADIUS,
        minY: Math.min(a.y, b.y) - BALL_RADIUS,
        maxY: Math.max(a.y, b.y) + BALL_RADIUS,
      })
    }
  }
  return walls
}

/** Walls are derived once per level object. Build a new level object to change the layout. */
export function levelWalls(level: Level): Wall[] {
  let walls = wallCache.get(level)
  if (!walls) {
    walls = buildWalls(level)
    wallCache.set(level, walls)
  }
  return walls
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
    // Inside a body the shot has already ended; the floor only guards the division.
    const r2 = Math.max(dx * dx + dy * dy, 1e-6)
    const k = body.mu / (r2 * Math.sqrt(r2))
    ax += dx * k
    ay += dy * k
  }
  out.x = ax
  out.y = ay
  return out
}

export function launchState(level: Level, from: Vec2, rawAim: Aim): BallState {
  const aim = clampAim(rawAim)
  const speed = aim.power * level.maxSpeed
  return {
    pos: { x: from.x, y: from.y },
    vel: { x: Math.cos(aim.angle) * speed, y: Math.sin(aim.angle) * speed },
    t: 0,
    bounces: 0,
    lastBounceSpeed: 0,
  }
}

const a0: Vec2 = { x: 0, y: 0 }
const a1: Vec2 = { x: 0, y: 0 }

function collideWalls(level: Level, s: BallState): void {
  const walls = levelWalls(level)
  for (const w of walls) {
    const px = s.pos.x
    const py = s.pos.y
    if (px < w.minX || px > w.maxX || py < w.minY || py > w.maxY) continue
    const ex = w.bx - w.ax
    const ey = w.by - w.ay
    const len2 = ex * ex + ey * ey
    const u = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - w.ax) * ex + (py - w.ay) * ey) / len2))
    const cx = w.ax + ex * u
    const cy = w.ay + ey * u
    let nx = px - cx
    let ny = py - cy
    const dist = Math.hypot(nx, ny)
    if (dist >= BALL_RADIUS) continue
    if (dist > 1e-9) {
      nx /= dist
      ny /= dist
    } else {
      // Dead centre on the wall line: push back against the direction of travel.
      const len = Math.sqrt(len2) || 1
      nx = -ey / len
      ny = ex / len
      if (nx * s.vel.x + ny * s.vel.y > 0) {
        nx = -nx
        ny = -ny
      }
    }
    // Always separate, but only reflect when the ball is actually moving into the wall.
    s.pos.x = cx + nx * BALL_RADIUS
    s.pos.y = cy + ny * BALL_RADIUS
    const vn = s.vel.x * nx + s.vel.y * ny
    if (vn < 0) {
      const tx = -ny
      const ty = nx
      const vt = s.vel.x * tx + s.vel.y * ty
      const outN = -vn * WALL_RESTITUTION
      const outT = vt * WALL_GRIP
      s.vel.x = nx * outN + tx * outT
      s.vel.y = ny * outN + ty * outT
      s.bounces++
      s.lastBounceSpeed = -vn
    }
  }
}

/**
 * One fixed step, in place: velocity-Verlet for gravity, then rolling friction, then walls.
 * Friction makes the system dissipative on purpose: this is a putting green, not an orbit.
 */
export function step(level: Level, s: BallState, dt: number = DT): void {
  acceleration(level, s.pos.x, s.pos.y, s.t, a0)
  s.pos.x += s.vel.x * dt + 0.5 * a0.x * dt * dt
  s.pos.y += s.vel.y * dt + 0.5 * a0.y * dt * dt
  s.t += dt
  acceleration(level, s.pos.x, s.pos.y, s.t, a1)
  s.vel.x += 0.5 * (a0.x + a1.x) * dt
  s.vel.y += 0.5 * (a0.y + a1.y) * dt

  const speed = Math.hypot(s.vel.x, s.vel.y)
  if (speed > 0) {
    const slowed = Math.max(0, speed - ROLL_DECEL * dt) * Math.exp(-LINEAR_DRAG * dt)
    const k = slowed / speed
    s.vel.x *= k
    s.vel.y *= k
  }
  collideWalls(level, s)
}

export interface OutcomeCheck {
  outcome: Outcome | null
  hazardId: string | null
  targetDistance: number
}

const probe: Vec2 = { x: 0, y: 0 }

export function checkOutcome(level: Level, s: BallState): OutcomeCheck {
  const tp = targetPosition(level.target, s.t)
  const targetDistance = Math.hypot(tp.x - s.pos.x, tp.y - s.pos.y)
  const speed = Math.hypot(s.vel.x, s.vel.y)
  if (targetDistance <= level.target.radius && speed <= CAPTURE_SPEED) {
    return { outcome: 'goal', hazardId: null, targetDistance }
  }
  for (const body of level.bodies) {
    const p = bodyPosition(body, s.t)
    if (Math.hypot(p.x - s.pos.x, p.y - s.pos.y) <= body.radius + BALL_RADIUS * 0.5) {
      return { outcome: 'hazard', hazardId: body.id, targetDistance }
    }
  }
  // Walls keep the ball in. This only catches a numerical escape, and treats it as out of bounds.
  const b = level.bounds
  if (s.pos.x < b.minX - 1 || s.pos.x > b.maxX + 1 || s.pos.y < b.minY - 1 || s.pos.y > b.maxY + 1) {
    return { outcome: 'hazard', hazardId: null, targetDistance }
  }
  if (s.t >= MAX_SHOT_TIME) return { outcome: 'rest', hazardId: null, targetDistance }
  if (speed < REST_SPEED) {
    // At rest only if friction can hold the ball against the local pull. Otherwise it rolls on.
    acceleration(level, s.pos.x, s.pos.y, s.t, probe)
    if (Math.hypot(probe.x, probe.y) <= ROLL_DECEL) return { outcome: 'rest', hazardId: null, targetDistance }
  }
  return { outcome: null, hazardId: null, targetDistance }
}

/** Plays one whole shot headlessly. Used by tests and the course solver, never by the render loop. */
export function simulate(level: Level, from: Vec2, aim: Aim): ShotResult {
  const s = launchState(level, from, aim)
  let closest = Infinity
  for (;;) {
    // The ball is struck with speed, so the very first check cannot report 'rest'.
    const c = checkOutcome(level, s)
    if (c.targetDistance < closest) closest = c.targetDistance
    if (c.outcome) {
      return {
        outcome: c.outcome,
        hazardId: c.hazardId,
        time: s.t,
        closest,
        end: { x: s.pos.x, y: s.pos.y },
        bounces: s.bounces,
      }
    }
    step(level, s)
  }
}

/**
 * The aiming preview: flat [x0, y0, x1, y1, ...] sampled every `stride` steps, bounces included.
 * It stops when the shot would end, so the preview never draws through a planet.
 */
export function predictPath(level: Level, from: Vec2, aim: Aim, seconds: number, stride = 4): number[] {
  const s = launchState(level, from, aim)
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

/** Aim from a point straight at the cup: the default whenever the ball comes to rest. */
export function defaultAim(level: Level, from: Vec2): Aim {
  const t = targetPosition(level.target, 0)
  return { angle: Math.atan2(t.y - from.y, t.x - from.x), power: 0.5 }
}
