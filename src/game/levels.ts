import type { Body, BodyKind, Level, Vec2 } from './types.ts'

/** Standard playfield: a 16:9-ish rectangle with the long axis on X. */
const BOUNDS = { minX: -16, maxX: 16, minY: -9, maxY: 9 }

function body(
  id: string,
  kind: BodyKind,
  mu: number,
  radius: number,
  pos: Vec2,
  palette: [string, string],
  rail?: Body['rail'],
): Body {
  return rail ? { id, kind, mu, radius, pos, palette, rail } : { id, kind, mu, radius, pos, palette }
}

// -- Sandbox --------------------------------------------------------------

export type SandboxSize = 'small' | 'medium' | 'large' | 'blackhole'

const SANDBOX_PALETTES: [string, string][] = [
  ['#fb923c', '#fde047'],
  ['#22d3ee', '#3b82f6'],
  ['#f472b6', '#c026d3'],
  ['#a3e635', '#14b8a6'],
  ['#8b5cf6', '#c4b5fd'],
  ['#fb7185', '#fef3c7'],
  ['#fde047', '#fb7185'],
  ['#c026d3', '#8b5cf6'],
]

export function makeSandboxBody(pos: Vec2, size: SandboxSize, index: number): Body {
  const palette = SANDBOX_PALETTES[index % SANDBOX_PALETTES.length]
  const id = `sb${index}`
  switch (size) {
    case 'small':
      return body(id, 'planet', 6, 0.7, pos, palette)
    case 'medium':
      return body(id, 'planet', 16, 1.1, pos, palette)
    case 'large':
      return body(id, 'planet', 34, 1.6, pos, palette)
    case 'blackhole':
      return body(id, 'blackhole', 70, 0.55, pos, palette)
  }
}

export const SANDBOX_LEVEL: Level = {
  id: 'sandbox',
  name: 'Sandbox',
  hint: 'Place bodies and experiment freely.',
  par: 0,
  homeId: 'home',
  bodies: [body('home', 'planet', 4, 0.9, { x: -13, y: 0 }, ['#38bdf8', '#e0f2fe'])],
  target: { pos: { x: 13, y: 0 }, radius: 0.7 },
  bounds: { minX: -16, maxX: 16, minY: -9, maxY: 9 },
  maxSpeed: 10,
  maxTime: 30,
}

// -- Levels -----------------------------------------------------------------

const HOME_PALETTE: [string, string] = ['#38bdf8', '#1d4ed8']

function home(pos: Vec2 = { x: -13, y: 0 }): Body {
  return body('home', 'planet', 4, 0.9, pos, HOME_PALETTE)
}

const l01: Level = {
  id: 'l01',
  name: 'First Launch',
  hint: 'Drag toward the gate and let go — a stray planet nearby will nudge a lazy shot off line.',
  par: 2,
  homeId: 'home',
  bodies: [home(), body('p1', 'planet', 6, 0.8, { x: -3, y: 1.6 }, ['#fb923c', '#fde047'])],
  target: { pos: { x: 8, y: 0 }, radius: 1.2 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l02: Level = {
  id: 'l02',
  name: 'Gentle Bend',
  hint: 'Gravity bends your path, so the straight line is not always the fastest.',
  par: 2,
  homeId: 'home',
  bodies: [
    home(),
    body('p1', 'planet', 12, 1.0, { x: 0, y: 2.6 }, ['#22d3ee', '#3b82f6']),
  ],
  target: { pos: { x: 13, y: 0 }, radius: 0.75 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l03: Level = {
  id: 'l03',
  name: 'In The Way',
  hint: 'A planet blocks the direct route, so curve your shot around it.',
  par: 2,
  homeId: 'home',
  bodies: [
    home(),
    body('p1', 'planet', 18, 1.2, { x: 0, y: -0.2 }, ['#f472b6', '#c026d3']),
  ],
  target: { pos: { x: 13, y: 0 }, radius: 0.7 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l04: Level = {
  id: 'l04',
  name: 'Slingshot',
  hint: 'The target hides behind a big planet, so swing around it and let gravity fling you in.',
  par: 2,
  homeId: 'home',
  bodies: [
    home(),
    body('p1', 'planet', 32, 1.6, { x: 2, y: 0 }, ['#8b5cf6', '#c4b5fd']),
  ],
  target: { pos: { x: 9, y: 1.6 }, radius: 0.65 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l05: Level = {
  id: 'l05',
  name: 'Binary Threading',
  hint: 'Two planets tug from opposite sides, so thread the gap or loop wide around both.',
  par: 3,
  homeId: 'home',
  bodies: [
    home(),
    body('p1', 'planet', 14, 1.0, { x: -1, y: -3.2 }, ['#a3e635', '#14b8a6']),
    body('p2', 'planet', 14, 1.0, { x: 3, y: 3.2 }, ['#fb7185', '#fef3c7']),
  ],
  target: { pos: { x: 13, y: 0 }, radius: 0.65 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l06: Level = {
  id: 'l06',
  name: 'Moving Target Zone',
  hint: 'A moon sweeps across the corridor, so time your launch to slip past it.',
  par: 3,
  homeId: 'home',
  bodies: [
    home(),
    body('p1', 'planet', 10, 1.0, { x: 0, y: -4 }, ['#fb923c', '#fde047']),
    body('m1', 'moon', 2, 0.45, { x: 0, y: -8.3 }, ['#fef3c7', '#c4b5fd'], {
      center: { x: 0, y: -4 },
      radius: 4.3,
      period: 9,
      phase: -Math.PI / 2,
    }),
  ],
  target: { pos: { x: 13, y: 0 }, radius: 0.7 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l07: Level = {
  id: 'l07',
  name: 'The Gap',
  hint: 'Asteroids wall off the corridor, so use a planet’s gravity to curve through the gap.',
  par: 3,
  homeId: 'home',
  bodies: [
    home(),
    body('a1', 'asteroid', 0, 0.4, { x: 3, y: -4.5 }, ['#78716c', '#44403c']),
    body('a2', 'asteroid', 0, 0.4, { x: 3, y: -3.2 }, ['#78716c', '#44403c']),
    body('a3', 'asteroid', 0, 0.4, { x: 3, y: 3.2 }, ['#78716c', '#44403c']),
    body('a4', 'asteroid', 0, 0.4, { x: 3, y: 4.5 }, ['#78716c', '#44403c']),
    body('p1', 'planet', 16, 1.1, { x: 3, y: 1.6 }, ['#fde047', '#fb7185']),
  ],
  target: { pos: { x: 13, y: 0 }, radius: 0.7 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l08: Level = {
  id: 'l08',
  name: 'Event Horizon',
  hint: 'Graze the black hole and let its immense gravity whip you to the far side.',
  par: 3,
  homeId: 'home',
  bodies: [home(), body('bh', 'blackhole', 80, 0.55, { x: 0, y: 0 }, ['#c026d3', '#8b5cf6'])],
  target: { pos: { x: 8, y: 0 }, radius: 0.7 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l09: Level = {
  id: 'l09',
  name: 'Moving Gate',
  hint: 'The target itself rides a rail around a planet, so lead your shot.',
  par: 3,
  homeId: 'home',
  bodies: [home(), body('p1', 'planet', 20, 1.3, { x: 6, y: 0 }, ['#a3e635', '#14b8a6'])],
  target: {
    pos: { x: 9.5, y: 0 },
    radius: 0.65,
    rail: { center: { x: 6, y: 0 }, radius: 3.5, period: 11, phase: 0 },
  },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l10: Level = {
  id: 'l10',
  name: 'U-Turn',
  hint: 'Asteroids shield the green from a direct shot, so swing past the planet and come back around.',
  par: 3,
  homeId: 'home',
  bodies: [
    home(),
    body('a1', 'asteroid', 0, 0.4, { x: -10.2, y: 2.4 }, ['#78716c', '#44403c']),
    body('a2', 'asteroid', 0, 0.4, { x: -9.15, y: 3.3 }, ['#78716c', '#44403c']),
    body('a3', 'asteroid', 0, 0.4, { x: -8.1, y: 4.2 }, ['#78716c', '#44403c']),
    body('p1', 'planet', 30, 1.6, { x: 5, y: -1 }, ['#fb923c', '#fde047']),
  ],
  target: { pos: { x: -6, y: 6 }, radius: 0.75 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l11: Level = {
  id: 'l11',
  name: 'Twin Sentries',
  hint: 'Two moons circle the gate in opposite directions, so slip through when they part.',
  par: 3,
  homeId: 'home',
  bodies: [
    home(),
    body('p1', 'planet', 20, 1.2, { x: 0, y: 0 }, ['#22d3ee', '#3b82f6']),
    body('m1', 'moon', 2, 0.45, { x: 2.5, y: 0 }, ['#fef3c7', '#c4b5fd'], {
      center: { x: 0, y: 0 },
      radius: 2.5,
      period: 8,
      phase: 0,
    }),
    body('m2', 'moon', 2, 0.45, { x: -2.5, y: 0 }, ['#fde047', '#fb7185'], {
      center: { x: 0, y: 0 },
      radius: 2.5,
      period: -8,
      phase: Math.PI,
    }),
  ],
  target: { pos: { x: 13, y: 0 }, radius: 0.7 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l12: Level = {
  id: 'l12',
  name: 'Dancing Binary',
  hint: 'Two planets waltz around a shared centre, so time your run between their arcs.',
  par: 4,
  homeId: 'home',
  bodies: [
    home(),
    body('p1', 'planet', 16, 1.0, { x: 3, y: 0 }, ['#f472b6', '#c026d3'], {
      center: { x: 0, y: 0 },
      radius: 3,
      period: 10,
      phase: 0,
    }),
    body('p2', 'planet', 16, 1.0, { x: -3, y: 0 }, ['#a3e635', '#14b8a6'], {
      center: { x: 0, y: 0 },
      radius: 3,
      period: 10,
      phase: Math.PI,
    }),
  ],
  target: { pos: { x: 13, y: 0 }, radius: 0.7 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l13: Level = {
  id: 'l13',
  name: 'The Ring',
  hint: 'A ring of asteroids guards the green, so bend your path to the one gap facing away from home.',
  par: 3,
  homeId: 'home',
  bodies: [
    home(),
    body('p1', 'planet', 40, 1.3, { x: 8.5, y: 3 }, ['#8b5cf6', '#c4b5fd']),
    body('a1', 'asteroid', 0, 0.3, { x: 9.696, y: 1.723 }, ['#78716c', '#44403c']),
    body('a2', 'asteroid', 0, 0.3, { x: 9.125, y: 1.516 }, ['#78716c', '#44403c']),
    body('a3', 'asteroid', 0, 0.3, { x: 8.659, y: 1.125 }, ['#78716c', '#44403c']),
    body('a4', 'asteroid', 0, 0.3, { x: 8.356, y: 0.599 }, ['#78716c', '#44403c']),
    body('a5', 'asteroid', 0, 0.3, { x: 8.25, y: 0 }, ['#78716c', '#44403c']),
    body('a6', 'asteroid', 0, 0.3, { x: 8.356, y: -0.599 }, ['#78716c', '#44403c']),
    body('a7', 'asteroid', 0, 0.3, { x: 8.659, y: -1.125 }, ['#78716c', '#44403c']),
    body('a8', 'asteroid', 0, 0.3, { x: 9.125, y: -1.516 }, ['#78716c', '#44403c']),
  ],
  target: { pos: { x: 10, y: 0 }, radius: 0.9 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l14: Level = {
  id: 'l14',
  name: 'Twin Wells',
  hint: 'Two black holes pinch the corridor, so split the gap between their gravity wells.',
  par: 4,
  homeId: 'home',
  bodies: [
    home(),
    body('bh1', 'blackhole', 90, 0.55, { x: 0, y: -1.2 }, ['#c026d3', '#8b5cf6']),
    body('bh2', 'blackhole', 90, 0.55, { x: 0, y: 1.2 }, ['#3b82f6', '#22d3ee']),
  ],
  target: { pos: { x: 9, y: 0 }, radius: 0.55 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l15: Level = {
  id: 'l15',
  name: 'Orbiting Gate',
  hint: 'The green rides a rail around a black hole, so lead the shot and mind the gravity.',
  par: 4,
  homeId: 'home',
  bodies: [home(), body('bh', 'blackhole', 90, 0.55, { x: 9, y: 0 }, ['#f472b6', '#c026d3'])],
  target: {
    pos: { x: 14, y: 0 },
    radius: 0.55,
    rail: { center: { x: 9, y: 0 }, radius: 5, period: 14, phase: 0 },
  },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l16: Level = {
  id: 'l16',
  name: 'Slalom',
  hint: 'Planets alternate above and below the line, so weave a curve instead of a straight shot.',
  par: 4,
  homeId: 'home',
  bodies: [
    home(),
    body('p1', 'planet', 10, 1.1, { x: -8, y: 1.0 }, ['#fb923c', '#fde047']),
    body('p2', 'planet', 10, 1.1, { x: -3, y: -1.0 }, ['#22d3ee', '#3b82f6']),
    body('p3', 'planet', 10, 1.1, { x: 2, y: 1.0 }, ['#f472b6', '#c026d3']),
    body('p4', 'planet', 10, 1.1, { x: 7, y: -1.0 }, ['#a3e635', '#14b8a6']),
  ],
  target: { pos: { x: 13, y: 0 }, radius: 0.7 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l17: Level = {
  id: 'l17',
  name: 'Guarded Moons',
  hint: 'An asteroid screen blocks the middle, so arc around the planet and its two moons.',
  par: 4,
  homeId: 'home',
  bodies: [
    home(),
    body('a1', 'asteroid', 0, 0.4, { x: -4, y: -1 }, ['#78716c', '#44403c']),
    body('a2', 'asteroid', 0, 0.4, { x: -4, y: 0 }, ['#78716c', '#44403c']),
    body('a3', 'asteroid', 0, 0.4, { x: -4, y: 1 }, ['#78716c', '#44403c']),
    body('p1', 'planet', 20, 1.3, { x: 2, y: 0 }, ['#8b5cf6', '#c4b5fd']),
    body('m1', 'moon', 2, 0.45, { x: 4.2, y: 0 }, ['#fef3c7', '#c4b5fd'], {
      center: { x: 2, y: 0 },
      radius: 2.2,
      period: 7,
      phase: 0,
    }),
    body('m2', 'moon', 2, 0.5, { x: -1.2, y: 0 }, ['#fde047', '#fb7185'], {
      center: { x: 2, y: 0 },
      radius: 3.2,
      period: 11,
      phase: Math.PI,
    }),
  ],
  target: { pos: { x: 13, y: 0 }, radius: 0.7 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l18: Level = {
  id: 'l18',
  name: 'Grand Tour',
  hint: 'Chain three planets, a moon, and a black hole into one final run past the asteroid screen.',
  par: 5,
  homeId: 'home',
  bodies: [
    home(),
    body('a1', 'asteroid', 0, 0.4, { x: -4, y: 1.2 }, ['#78716c', '#44403c']),
    body('a2', 'asteroid', 0, 0.4, { x: -4, y: -1.2 }, ['#78716c', '#44403c']),
    body('p1', 'planet', 14, 1.5, { x: -9.52, y: 0.39 }, ['#fb923c', '#fde047']),
    body('p2', 'planet', 16, 1.1, { x: 0, y: -3.4 }, ['#22d3ee', '#3b82f6']),
    body('m1', 'moon', 2, 0.45, { x: 3, y: -3.4 }, ['#fef3c7', '#c4b5fd'], {
      center: { x: 0, y: -3.4 },
      radius: 3,
      period: 8,
      phase: 1.4,
    }),
    body('p3', 'planet', 22, 1.6, { x: 6, y: 2.15 }, ['#f472b6', '#c026d3']),
    body('bh', 'blackhole', 60, 0.55, { x: 10, y: -1.2 }, ['#8b5cf6', '#fb7185']),
  ],
  target: { pos: { x: 13.5, y: 3 }, radius: 0.7 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

export const LEVELS: Level[] = [
  l01,
  l02,
  l03,
  l04,
  l05,
  l06,
  l07,
  l08,
  l09,
  l10,
  l11,
  l12,
  l13,
  l14,
  l15,
  l16,
  l17,
  l18,
]
