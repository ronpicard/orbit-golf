/** Physics lives on a 2D plane. The renderer maps (x, y) to world (x, 0, y). */
export interface Vec2 {
  x: number
  y: number
}

export type BodyKind = 'planet' | 'moon' | 'blackhole' | 'asteroid'

/** A circular rail. Bodies on rails ignore gravity so every level is deterministic. */
export interface Rail {
  center: Vec2
  radius: number
  /** Seconds per revolution. Negative values orbit clockwise. */
  period: number
  /** Angle at t = 0, in radians. */
  phase: number
}

export interface Body {
  id: string
  kind: BodyKind
  /** Gravitational parameter G*M in world units. Asteroids use 0. */
  mu: number
  /** Collision radius. For a black hole this is the event horizon. */
  radius: number
  pos: Vec2
  rail?: Rail
  /** Two CSS hex colors used by the procedural surface shader. */
  palette: [string, string]
}

export interface Target {
  pos: Vec2
  radius: number
  rail?: Rail
}

export interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface Level {
  id: string
  name: string
  /** One sentence shown under the level name. */
  hint: string
  par: number
  /** Id of the body the probe launches from. */
  homeId: string
  bodies: Body[]
  target: Target
  /** The probe is lost when it leaves these bounds. Also used to frame the camera. */
  bounds: Bounds
  /** Launch speed at power = 1. */
  maxSpeed: number
  /** Seconds before the probe runs out of power. */
  maxTime: number
}

export interface Aim {
  /** Launch direction in radians, atan2(y, x). */
  angle: number
  /** Fraction of the level's maxSpeed, clamped to [MIN_POWER, 1]. */
  power: number
}

export interface ProbeState {
  pos: Vec2
  vel: Vec2
  t: number
}

export type Outcome = 'goal' | 'crash' | 'lost' | 'timeout'

export interface SimResult {
  outcome: Outcome
  /** Id of the body hit when outcome is 'crash'. */
  crashedInto: string | null
  time: number
  /** Closest approach to the target centre over the flight. */
  closest: number
}
