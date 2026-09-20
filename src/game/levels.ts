import type { Body, BodyKind, Level, Rail, Saucer, Vec2, Wormhole } from './types.ts'
import { courseBounds } from './physics.ts'

// -- Vector helpers -----------------------------------------------------------------------------

function v(x: number, y: number): Vec2 {
  return { x, y }
}
function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}
function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}
function scale(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k }
}
function len(a: Vec2): number {
  return Math.hypot(a.x, a.y)
}
function norm(a: Vec2): Vec2 {
  const l = len(a) || 1
  return { x: a.x / l, y: a.y / l }
}
function perp(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x }
}

/** Intersection of infinite lines through (a,b) and (c,d); null when parallel. */
function lineIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const rx = b.x - a.x
  const ry = b.y - a.y
  const sx = d.x - c.x
  const sy = d.y - c.y
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < 1e-9) return null
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom
  return { x: a.x + rx * t, y: a.y + ry * t }
}

/** One dial for how hard every body bends a putt. Re-run `npm run solve -- --write` after changing it. */
export const GRAVITY_SCALE = 1.4

function body(
  id: string,
  kind: BodyKind,
  mu: number,
  radius: number,
  pos: Vec2,
  palette: [string, string],
  rail?: Rail,
): Body {
  const scaled = mu * GRAVITY_SCALE
  return rail
    ? { id, kind, mu: scaled, radius, pos, palette, rail }
    : { id, kind, mu: scaled, radius, pos, palette }
}

/** Hangs a body above the sheet: the fairway rises toward it instead of dipping. Same pull. */
function above(b: Body): Body {
  return { ...b, side: 'above' }
}

function wormhole(id: string, a: Vec2, b: Vec2, radius = 0.7): Wormhole {
  return { id, a, b, radius }
}

/** A saucer flying back and forth between two points. `period` is the full there-and-back time. */
function patrolSaucer(id: string, a: Vec2, b: Vec2, period: number, radius = 0.9): Saucer {
  return { id, radius, pos: a, patrol: { a, b, period, phase: 0 } }
}

function railSaucer(id: string, rail: Rail, radius = 0.9): Saucer {
  return {
    id,
    radius,
    pos: v(rail.center.x + rail.radius * Math.cos(rail.phase), rail.center.y + rail.radius * Math.sin(rail.phase)),
    rail,
  }
}

function rect(cx: number, cy: number, hw: number, hh: number): Vec2[] {
  return [v(cx - hw, cy - hh), v(cx + hw, cy - hh), v(cx + hw, cy + hh), v(cx - hw, cy + hh)]
}

// -- Corridor (tube) polygon builder --------------------------------------------------------------
//
// A path of centreline waypoints is inflated by a (possibly varying) half-width into a simple
// closed polygon. Offsetting each segment independently and simply concatenating the joints
// produces a flat bevel at every turn: exactly the "45-degree chamfered corner" the design calls
// for on the outside of a bend, with a small forgiving notch on the inside.

/**
 * One side of the tube (sign = +1 left, -1 right). Interior joints on the convex (outer) side of
 * a turn get a flat two-point bevel — the "45-degree chamfered corner" the design wants for bank
 * shots. Joints on the concave (inner) side are mitred to the intersection of the two offset
 * lines instead, so a tight inside corner never doubles back and self-intersects the polygon.
 */
function offsetSide(path: Vec2[], hw: number[], sign: 1 | -1): Vec2[] {
  const n = path.length
  const pts: Vec2[] = []
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      const d = norm(sub(path[1], path[0]))
      pts.push(add(path[0], scale(perp(d), sign * hw[0])))
      continue
    }
    if (i === n - 1) {
      const d = norm(sub(path[n - 1], path[n - 2]))
      pts.push(add(path[n - 1], scale(perp(d), sign * hw[n - 1])))
      continue
    }
    const d0 = norm(sub(path[i], path[i - 1]))
    const d1 = norm(sub(path[i + 1], path[i]))
    const n0 = scale(perp(d0), sign * hw[i])
    const n1 = scale(perp(d1), sign * hw[i])
    const turn = d0.x * d1.y - d0.y * d1.x
    if (Math.abs(turn) < 1e-6) {
      pts.push(add(path[i], n0))
    } else if (sign * turn < 0) {
      // Convex (outer) side of the turn: bevel.
      pts.push(add(path[i], n0), add(path[i], n1))
    } else {
      // Concave (inner) side of the turn: mitre.
      const p = lineIntersect(add(path[i - 1], n0), add(path[i], n0), add(path[i], n1), add(path[i + 1], n1))
      pts.push(p ?? add(path[i], n0))
    }
  }
  return pts
}

function tube(path: Vec2[], hw: number[]): Vec2[] {
  const left = offsetSide(path, hw, 1)
  const right = offsetSide(path, hw, -1)
  right.reverse()
  return [...left, ...right]
}

/** Extends a path's two end segments outward so the tube has flat caps clear of the tee/cup. */
function extendPath(path: Vec2[], startPad: number, endPad: number): Vec2[] {
  const startDir = norm(sub(path[1], path[0]))
  const endDir = norm(sub(path[path.length - 1], path[path.length - 2]))
  return [sub(path[0], scale(startDir, startPad)), ...path, add(path[path.length - 1], scale(endDir, endPad))]
}

interface CorridorOpts {
  /** Half-width at each waypoint (constant, or one entry per waypoint in `path`). */
  width: number | number[]
  startPad?: number
  endPad?: number
}

/** Builds a corridor course polygon whose first/last `path` points are the tee and the cup. */
function corridor(path: Vec2[], opts: CorridorOpts): Vec2[] {
  const hwAt: number[] = Array.isArray(opts.width) ? opts.width : path.map(() => opts.width as number)
  const startPad = opts.startPad ?? 1.8
  const endPad = opts.endPad ?? 1.8
  const ext = extendPath(path, startPad, endPad)
  const hwExt = [hwAt[0], ...hwAt, hwAt[hwAt.length - 1]]
  return tube(ext, hwExt)
}

function makeLevel(partial: Omit<Level, 'bounds'>): Level {
  return { ...partial, bounds: courseBounds(partial.course) }
}

// -- Palettes (reused candy/arcade palettes from the original 18 holes) --------------------------

const ORANGE: [string, string] = ['#fb923c', '#fde047']
const CYAN: [string, string] = ['#22d3ee', '#3b82f6']
const PINK: [string, string] = ['#f472b6', '#c026d3']
const LIME: [string, string] = ['#a3e635', '#14b8a6']
const PURPLE: [string, string] = ['#8b5cf6', '#c4b5fd']
const ROSE: [string, string] = ['#fb7185', '#fef3c7']
const YELLOW: [string, string] = ['#fde047', '#fb7185']
const MAGENTA: [string, string] = ['#c026d3', '#8b5cf6']
const MOON_A: [string, string] = ['#fef3c7', '#c4b5fd']
const MOON_B: [string, string] = ['#fde047', '#fb7185']
const HOLE_A: [string, string] = ['#c026d3', '#8b5cf6']
const HOLE_B: [string, string] = ['#3b82f6', '#22d3ee']
const HOLE_C: [string, string] = ['#f472b6', '#c026d3']

// -- Sandbox --------------------------------------------------------------------------------------

export type SandboxSize = 'small' | 'medium' | 'large' | 'blackhole'

const SANDBOX_PALETTES: [string, string][] = [ORANGE, CYAN, PINK, LIME, PURPLE, ROSE, YELLOW, MAGENTA]

export function makeSandboxBody(pos: Vec2, size: SandboxSize, index: number): Body {
  const palette = SANDBOX_PALETTES[index % SANDBOX_PALETTES.length]
  const id = `sb${index}`
  switch (size) {
    case 'small':
      return body(id, 'planet', 5, 0.6, pos, palette)
    case 'medium':
      return body(id, 'planet', 11, 0.9, pos, palette)
    case 'large':
      return body(id, 'planet', 20, 1.3, pos, palette)
    case 'blackhole':
      return body(id, 'blackhole', 34, 0.45, pos, palette)
  }
}

const SANDBOX_COURSE: Vec2[] = rect(0, 0, 15, 8)

export const SANDBOX_LEVEL: Level = makeLevel({
  id: 'sandbox',
  name: 'Sandbox',
  hint: 'Place bodies and experiment freely.',
  par: 0,
  tee: v(-13, 0),
  course: SANDBOX_COURSE,
  islands: [],
  bodies: [],
  target: { pos: v(13, 0), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 1: straight lane, one small planet beside the line --------------------------------------

const l01 = makeLevel({
  id: 'l01',
  name: 'First Launch',
  hint: 'Turn to face the flag and let it fly — a lone planet nearby will nudge a lazy putt off line.',
  par: 3,
  tee: v(-14, 0),
  course: corridor([v(-14, 0), v(14, 0)], { width: 2.8 }),
  islands: [],
  bodies: [body('p1', 'planet', 6, 0.7, v(-2, 1.5), ORANGE)],
  target: { pos: v(14, 0), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 2: gentle dogleg (one 45-degree bend) with a planet on the inside -----------------------

const l02 = makeLevel({
  id: 'l02',
  name: 'Gentle Bend',
  hint: 'Aim at the far corner and let the inside planet curl your putt round the bend.',
  par: 3,
  tee: v(-14, -3),
  course: corridor([v(-14, -3), v(-1, -3), v(9, 7)], { width: 3 }),
  islands: [],
  bodies: [above(body('p1', 'planet', 9, 0.8, v(-4, -1.5), CYAN))],
  target: { pos: v(9, 7), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 3: L-shape, 90-degree turn --------------------------------------------------------------

const l03 = makeLevel({
  id: 'l03',
  name: 'Right Angle',
  hint: 'Aim at the corner and bank off the chamfer, or let the planet swing you round it.',
  par: 3,
  tee: v(-14, -4),
  course: corridor([v(-14, -4), v(2, -4), v(2, 8)], { width: 2.8 }),
  islands: [],
  bodies: [body('p1', 'planet', 11, 0.9, v(-3, -2.7), PINK)],
  target: { pos: v(2, 8), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 4: straight lane, big planet dead centre (slingshot) -------------------------------------

const l04 = makeLevel({
  id: 'l04',
  name: 'Slingshot',
  hint: 'Aim past either shoulder of the planet and let its gravity fling you on toward the cup.',
  par: 3,
  tee: v(-14, 0),
  course: corridor([v(-14, 0), v(14, 0)], { width: 3.4 }),
  islands: [],
  bodies: [body('p1', 'planet', 20, 1.3, v(0, 0), PURPLE)],
  target: { pos: v(14, 0), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 5: S-curve (two opposite bends), a saucer sweeping across the middle ---------------------

const l05 = makeLevel({
  id: 'l05',
  name: 'S-Curve',
  hint: 'Watch the saucer sweep the middle lane and putt through when its beam swings clear.',
  par: 3,
  tee: v(-14, -5),
  course: corridor([v(-14, -5), v(-5, -5), v(5, 5), v(14, 5)], { width: 2.2 }),
  islands: [],
  bodies: [],
  saucers: [patrolSaucer('ufo', v(-1.3, 1.3), v(1.3, -1.3), 6)],
  target: { pos: v(14, 5), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 6: wide room, chicane islands, patrolling moon --------------------------------------------

const l06 = makeLevel({
  id: 'l06',
  name: 'Chicane',
  hint: 'Aim through the gap between the blocks and time your run past the patrolling moon.',
  par: 3,
  tee: v(-14, 0),
  course: corridor([v(-14, 0), v(14, 0)], { width: 4.6 }),
  islands: [rect(-3.5, 2.6, 1.2, 1.5), rect(3.5, -2.6, 1.2, 1.5)],
  bodies: [
    body('m1', 'moon', 2, 0.4, v(1.5, 0), MOON_A, {
      center: v(0, 0),
      radius: 1.5,
      period: 9,
      phase: 0,
    }),
  ],
  target: { pos: v(14, 0), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 7: U-turn, planet at the pivot ------------------------------------------------------------

const l07 = makeLevel({
  id: 'l07',
  name: 'U-Turn',
  hint: 'Putt out along the far lane and let the pivot planet curl you back toward home.',
  par: 4,
  tee: v(-14, 3),
  course: corridor([v(-14, 3), v(6, 3), v(6, -3), v(-14, -3)], { width: 1.9 }),
  islands: [],
  bodies: [above(body('p1', 'planet', 14, 0.8, v(6, 0), LIME))],
  target: { pos: v(-14, -3), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 8: black hole in a wide bowl room, cup beyond ----------------------------------------------

const l08 = makeLevel({
  id: 'l08',
  name: 'Event Horizon',
  hint: 'Aim wide around the black hole and let the bowl carry you on toward the cup.',
  par: 2,
  tee: v(-9.5, 0),
  course: rect(0, 0, 11, 8),
  islands: [],
  bodies: [body('bh', 'blackhole', 32, 0.5, v(0, 0), HOLE_A)],
  target: { pos: v(9.5, 0), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 9: two sealed rooms joined only by a wormhole ---------------------------------------------

const l09 = makeLevel({
  id: 'l09',
  name: 'Wormhole',
  hint: 'The wall seals the cup off. Putt into the violet wormhole and come out the other side.',
  par: 3,
  tee: v(-13, -1),
  course: rect(0, 0, 16, 6),
  // The dividing wall stops a hair short of the outer walls: far too tight for the ball, so the
  // two rooms are sealed from each other.
  islands: [rect(0, 0, 0.6, 5.98)],
  bodies: [body('p1', 'planet', 9, 0.8, v(8, 2.5), ROSE)],
  wormholes: [wormhole('w1', v(-4, 2.5), v(4, -3))],
  target: { pos: v(13, 1), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 10: funnel, two small planets guarding the neck --------------------------------------------

const l10 = makeLevel({
  id: 'l10',
  name: 'The Funnel',
  hint: 'Aim straight through the narrow gate between the two small planets.',
  par: 3,
  tee: v(-14, 0),
  course: corridor([v(-14, 0), v(0, 0), v(14, 0)], { width: [4, 1.8, 3.2] }),
  islands: [],
  bodies: [
    above(body('p1', 'planet', 5, 0.55, v(-1.4, 0.8), ORANGE)),
    body('p2', 'planet', 5, 0.55, v(1.4, -0.8), CYAN),
  ],
  target: { pos: v(14, 0), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 11: T-junction, obvious branch is a dead end with a black hole -----------------------------

const T_COURSE: Vec2[] = [
  v(-16, 2),
  v(-4, 2),
  v(-4, 9),
  v(0, 9),
  v(0, -9),
  v(-4, -9),
  v(-4, -2),
  v(-16, -2),
]

const l11 = makeLevel({
  id: 'l11',
  name: 'Dead End',
  hint: 'Turn down the south branch toward the cup and leave the black hole to the north alone.',
  par: 3,
  tee: v(-14, 0),
  course: T_COURSE,
  islands: [],
  bodies: [body('bh', 'blackhole', 30, 0.45, v(-2, 7), HOLE_B)],
  target: { pos: v(-2, -7), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 12: ring/donut, planets pull you around ------------------------------------------------

const l12 = makeLevel({
  id: 'l12',
  name: 'The Ring',
  hint: 'Go over the top or under the bottom, and keep clear of the saucer circling the ring.',
  par: 3,
  tee: v(-9, 0),
  course: rect(0, 0, 12, 9),
  islands: [rect(0, 0, 6, 4)],
  bodies: [
    above(body('p1', 'planet', 12, 1.0, v(0, 6.5), LIME)),
    body('p2', 'planet', 12, 1.0, v(0, -6.5), PINK),
  ],
  saucers: [railSaucer('ufo', { center: v(0, 0), radius: 7.6, period: 22, phase: 0 }, 1)],
  target: { pos: v(9, 0), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 13: cup on a rail in a round room, at the end of a bent corridor ----------------------------

const l13 = makeLevel({
  id: 'l13',
  name: 'Moving Green',
  hint: 'Play into the bend and lead the moving cup as it circles the far room.',
  par: 3,
  tee: v(-16, -3),
  course: corridor([v(-16, -3), v(-2, -3), v(6, 5)], { width: [2.1, 2.1, 4.6], endPad: 3 }),
  islands: [],
  bodies: [],
  target: {
    pos: v(6, 7.2),
    radius: 0.6,
    rail: { center: v(6, 5), radius: 2.2, period: 12, phase: Math.PI / 2 },
  },
  maxSpeed: 15,
})

// -- Hole 14: spiral inward, three turns, planet curling the final approach --------------------------

const l14 = makeLevel({
  id: 'l14',
  name: 'Inward Spiral',
  hint: 'Work around each arm of the spiral, slip past the saucer, and let the last planet curl you in.',
  par: 5,
  tee: v(-15, -8),
  course: corridor([v(-15, -8), v(13, -8), v(13, 6), v(-9, 6), v(-9, -2)], { width: 2 }),
  islands: [],
  bodies: [body('p1', 'planet', 10, 0.8, v(-9, 2.5), MAGENTA)],
  saucers: [patrolSaucer('ufo', v(13, -4), v(13, 3), 10, 0.8)],
  target: { pos: v(-9, -2), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 15: twin black holes flanking a narrow bridge -----------------------------------------------

const l15 = makeLevel({
  id: 'l15',
  name: 'The Bridge',
  hint: 'Aim straight down the centre line and thread the gap between the two black holes.',
  par: 3,
  tee: v(-14, 0),
  course: corridor([v(-14, 0), v(14, 0)], { width: 3.8 }),
  islands: [],
  bodies: [
    body('bh1', 'blackhole', 16, 0.45, v(0, 2.2), HOLE_A),
    above(body('bh2', 'blackhole', 16, 0.45, v(0, -2.2), HOLE_B)),
  ],
  target: { pos: v(14, 0), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 16: slalom, alternating planets and islands ---------------------------------------------

const l16 = makeLevel({
  id: 'l16',
  name: 'Slalom',
  hint: 'Pick a weaving line through the alternating planets and the blocks between them.',
  par: 3,
  tee: v(-16, 0),
  course: corridor([v(-16, 0), v(16, 0)], { width: 4 }),
  islands: [rect(-6.5, -2.6, 1, 0.9), rect(7.5, 2.6, 1, 0.9)],
  bodies: [
    body('p1', 'planet', 7.5, 0.9, v(-10, 1.6), ORANGE),
    above(body('p2', 'planet', 7.5, 0.9, v(-2, -1.6), CYAN)),
    body('p3', 'planet', 7.5, 0.9, v(3.5, 1.6), PINK),
    above(body('p4', 'planet', 7.5, 0.9, v(11, -1.6), LIME)),
  ],
  target: { pos: v(16, 0), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 17: pinball room, irregular walls, island bumpers, moons on rails --------------------------

const PINBALL_COURSE: Vec2[] = [
  v(-14, -6),
  v(-4, -9),
  v(8, -8),
  v(14, -2),
  v(12, 6),
  v(2, 9),
  v(-8, 7),
  v(-14, 2),
]

const l17 = makeLevel({
  id: 'l17',
  name: 'Pinball',
  hint: 'Aim between the bumpers and slip past the moons on your way to the cup.',
  par: 3,
  tee: v(-11, -3),
  course: PINBALL_COURSE,
  islands: [rect(-3, -1.5, 0.7, 0.7), rect(3.5, 2, 0.7, 0.7), rect(-6, 3.5, 0.7, 0.7)],
  bodies: [
    body('m1', 'moon', 2, 0.4, v(2, -2), MOON_A, { center: v(-2, -2), radius: 4, period: 8, phase: 0 }),
    above(
      body('m2', 'moon', 2, 0.4, v(8.5, 1), MOON_B, {
        center: v(4, 1),
        radius: 4.5,
        period: -11,
        phase: Math.PI,
      }),
    ),
  ],
  target: { pos: v(9, 3), radius: 0.6 },
  maxSpeed: 15,
})

// -- Hole 18: grand tour, four turns, a planet at each bend, moon, black hole near the approach --------

const l18 = makeLevel({
  id: 'l18',
  name: 'Grand Tour',
  hint: 'Play through each bend in turn, or gamble on the wormhole in the first corner to skip one.',
  par: 4,
  tee: v(-16, -8),
  course: corridor([v(-16, -8), v(-4, -8), v(-4, -2), v(6, -2), v(6, 4), v(16, 4)], { width: 2.4 }),
  islands: [rect(-10, -8, 0.7, 0.7)],
  bodies: [
    body('p1', 'planet', 4.5, 0.8, v(-4, -5.5), ORANGE),
    above(body('p2', 'planet', 4.5, 0.8, v(1, -3.0), CYAN)),
    body('p3', 'planet', 4.5, 0.8, v(6, 1.5), PINK),
    body('m1', 'moon', 2, 0.4, v(12.8, 4), MOON_A, { center: v(11, 4), radius: 1.8, period: 10, phase: 0 }),
    body('bh', 'blackhole', 9, 0.45, v(13, 3), HOLE_C),
  ],
  wormholes: [wormhole('w1', v(-2.5, -7.4), v(-2, -1.3))],
  target: { pos: v(16, 4), radius: 0.6 },
  maxSpeed: 15,
})

export const LEVELS: Level[] = [l01, l02, l03, l04, l05, l06, l07, l08, l09, l10, l11, l12, l13, l14, l15, l16, l17, l18]
