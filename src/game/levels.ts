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
  ['#f6a35a', '#c9622b'],
  ['#6fc3f7', '#2e6fb8'],
  ['#e2745a', '#8f2f24'],
  ['#7fd99a', '#2f8f5a'],
  ['#b98af0', '#5b3d99'],
  ['#f2d16b', '#c98c2e'],
  ['#7ea8ff', '#3450a8'],
  ['#f08fb0', '#a13a63'],
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
  bodies: [body('home', 'planet', 4, 0.9, { x: -13, y: 0 }, ['#8fb8ff', '#3c5fa8'])],
  target: { pos: { x: 13, y: 0 }, radius: 0.7 },
  bounds: { minX: -16, maxX: 16, minY: -9, maxY: 9 },
  maxSpeed: 10,
  maxTime: 30,
}

// -- Levels -----------------------------------------------------------------

const HOME_PALETTE: [string, string] = ['#8fb8ff', '#3c5fa8']

function home(pos: Vec2 = { x: -13, y: 0 }): Body {
  return body('home', 'planet', 4, 0.9, pos, HOME_PALETTE)
}

const l01: Level = {
  id: 'l01',
  name: 'First Launch',
  hint: 'Drag anywhere to pull back, aim at the green gate, and release to launch.',
  par: 1,
  homeId: 'home',
  bodies: [home({ x: -9, y: 0 })],
  target: { pos: { x: 8, y: 0 }, radius: 1.5 },
  bounds: { minX: -13, maxX: 13, minY: -7.3, maxY: 7.3 },
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
    body('p1', 'planet', 12, 1.0, { x: 0, y: 2.6 }, ['#f2d16b', '#c98c2e']),
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
    body('p1', 'planet', 18, 1.2, { x: 0, y: -0.2 }, ['#e2745a', '#8f2f24']),
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
    body('p1', 'planet', 32, 1.6, { x: 2, y: 0 }, ['#b98af0', '#5b3d99']),
  ],
  target: { pos: { x: 9, y: 1.6 }, radius: 0.65 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l05: Level = {
  id: 'l05',
  name: 'Binary Threading',
  hint: 'Two planets pull opposite ways, so thread the gap or loop wide around both.',
  par: 3,
  homeId: 'home',
  bodies: [
    home(),
    body('p1', 'planet', 14, 1.0, { x: -1, y: -3.2 }, ['#7fd99a', '#2f8f5a']),
    body('p2', 'planet', 14, 1.0, { x: 3, y: 3.2 }, ['#7ea8ff', '#3450a8']),
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
    body('p1', 'planet', 10, 1.0, { x: 0, y: -4 }, ['#f6a35a', '#c9622b']),
    body('m1', 'moon', 2, 0.45, { x: 0, y: -8.3 }, ['#cfd8e6', '#8b96a8'], {
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
  hint: 'Asteroids wall off the corridor, so use a planet’s pull to curve through the gap.',
  par: 3,
  homeId: 'home',
  bodies: [
    home(),
    body('a1', 'asteroid', 0, 0.4, { x: 3, y: -4.5 }, ['#9a9a9a', '#5a5a5a']),
    body('a2', 'asteroid', 0, 0.4, { x: 3, y: -3.2 }, ['#9a9a9a', '#5a5a5a']),
    body('a3', 'asteroid', 0, 0.4, { x: 3, y: 3.2 }, ['#9a9a9a', '#5a5a5a']),
    body('a4', 'asteroid', 0, 0.4, { x: 3, y: 4.5 }, ['#9a9a9a', '#5a5a5a']),
    body('p1', 'planet', 16, 1.1, { x: 3, y: 1.6 }, ['#f2d16b', '#c98c2e']),
  ],
  target: { pos: { x: 13, y: 0 }, radius: 0.7 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

const l08: Level = {
  id: 'l08',
  name: 'Event Horizon',
  hint: 'Graze the black hole and let its immense pull whip you to the far side.',
  par: 3,
  homeId: 'home',
  bodies: [home(), body('bh', 'blackhole', 80, 0.55, { x: 0, y: 0 }, ['#c9a6ff', '#2a1a4a'])],
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
  bodies: [home(), body('p1', 'planet', 20, 1.3, { x: 6, y: 0 }, ['#7fd99a', '#2f8f5a'])],
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
  name: 'Grand Tour',
  hint: 'Chain three planets, a moon, and a black hole into one final run.',
  par: 4,
  homeId: 'home',
  bodies: [
    home(),
    body('p1', 'planet', 14, 1.5, { x: -9.52, y: 0.39 }, ['#f6a35a', '#c9622b']),
    body('p2', 'planet', 16, 1.1, { x: 0, y: -3.4 }, ['#7ea8ff', '#3450a8']),
    body('m1', 'moon', 2, 0.45, { x: 3, y: -3.4 }, ['#cfd8e6', '#8b96a8'], {
      center: { x: 0, y: -3.4 },
      radius: 3,
      period: 8,
      phase: 1.4,
    }),
    body('p3', 'planet', 22, 1.6, { x: 6, y: 2.15 }, ['#e2745a', '#8f2f24']),
    body('bh', 'blackhole', 60, 0.55, { x: 10, y: -1.2 }, ['#c9a6ff', '#2a1a4a']),
  ],
  target: { pos: { x: 13.5, y: 3 }, radius: 0.7 },
  bounds: BOUNDS,
  maxSpeed: 10,
  maxTime: 30,
}

export const LEVELS: Level[] = [l01, l02, l03, l04, l05, l06, l07, l08, l09, l10]
