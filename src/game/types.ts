/** Physics lives on a 2D plane. The renderer maps (x, y) to world (x, height, y). */
export interface Vec2 {
  x: number
  y: number
}

export type BodyKind = 'planet' | 'moon' | 'blackhole' | 'asteroid'

/** A circular rail. Bodies on rails ignore gravity so every shot is deterministic. */
export interface Rail {
  center: Vec2
  radius: number
  /** Seconds per revolution. Negative values orbit clockwise. */
  period: number
  /** Angle at t = 0, in radians. */
  phase: number
}

/** A gravitating hazard sitting on the course. Touching one ends the shot as a hazard. */
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

/** The cup. */
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

/**
 * One mini-golf hole. The fairway is the inside of `course`, a simple closed polygon whose edges
 * are solid walls. `islands` are solid wall blocks standing inside the fairway.
 */
export interface Level {
  id: string
  name: string
  /** One sentence shown under the hole name. */
  hint: string
  par: number
  /** Where the ball starts. */
  tee: Vec2
  /** Outer wall, as a closed polygon (the last vertex joins the first). At most 40 vertices. */
  course: Vec2[]
  /** Inner wall blocks, each a closed polygon. */
  islands: Vec2[][]
  bodies: Body[]
  target: Target
  /** Bounding box of `course`. Used to frame the minimap and size the sheet. */
  bounds: Bounds
  /** Launch speed at power = 1. */
  maxSpeed: number
}

export interface Aim {
  /** Launch direction in radians, atan2(y, x). */
  angle: number
  /** Fraction of the level's maxSpeed, clamped to [MIN_POWER, 1]. */
  power: number
}

export interface BallState {
  pos: Vec2
  vel: Vec2
  /** Seconds since this shot was struck. Rails restart from t = 0 on every shot. */
  t: number
  /** Number of wall bounces so far in this shot. */
  bounces: number
  /** Speed into the wall at the most recent bounce. Lets the renderer scale sound and sparks. */
  lastBounceSpeed: number
}

/**
 * How a shot ends. 'goal': dropped in the cup. 'rest': rolled to a stop, the next shot is played
 * from there. 'hazard': touched a body or left the course, the next shot is replayed from where
 * this one started.
 */
export type Outcome = 'goal' | 'rest' | 'hazard'

export interface ShotResult {
  outcome: Outcome
  /** Id of the body hit when outcome is 'hazard'; null when the ball left the course. */
  hazardId: string | null
  time: number
  /** Closest approach to the cup centre over the shot. */
  closest: number
  /** Where the ball ended up. For 'hazard' this is where it was lost, not where play resumes. */
  end: Vec2
  bounces: number
}
