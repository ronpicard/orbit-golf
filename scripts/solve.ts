import { pathToFileURL } from 'node:url'
import { simulate, onFairway, bodyPosition } from '../src/game/physics.ts'
import { LEVELS } from '../src/game/levels.ts'
import type { Aim, Level, Vec2 } from '../src/game/types.ts'

const TAU = Math.PI * 2

export interface Shot {
  from: Vec2
  aim: Aim
}

export interface SolveOptions {
  angles?: number
  powers?: number
  minPower?: number
  maxPower?: number
  beamWidth?: number
  maxStrokes?: number
  gridCell?: number
}

const DEFAULTS: Required<SolveOptions> = {
  angles: 120,
  powers: 12,
  minPower: 0.15,
  maxPower: 1.0,
  beamWidth: 10,
  maxStrokes: 7,
  gridCell: 0.75,
}

/** Breadth-first walking-distance field over a grid of fairway cells, in grid steps. */
function buildDistanceField(level: Level, cell: number): { dist: Map<string, number>; cell: number } {
  const key = (x: number, y: number) => `${Math.round(x / cell)},${Math.round(y / cell)}`
  const inBody = (p: Vec2): boolean => {
    for (const b of level.bodies) {
      const bp = bodyPosition(b, 0)
      if (Math.hypot(bp.x - p.x, bp.y - p.y) <= b.radius) return true
    }
    return false
  }
  const isOpen = (p: Vec2): boolean => onFairway(level, p) && !inBody(p)

  const goalKey = key(level.target.pos.x, level.target.pos.y)
  const dist = new Map<string, number>()
  const queue: Vec2[] = []
  // Snap the cup onto the nearest open cell so the field has a valid source.
  let startCell = level.target.pos
  if (!isOpen(startCell)) {
    let best: Vec2 | null = null
    let bestD = Infinity
    const b = level.bounds
    for (let x = b.minX; x <= b.maxX; x += cell) {
      for (let y = b.minY; y <= b.maxY; y += cell) {
        const p = { x, y }
        if (!isOpen(p)) continue
        const d = Math.hypot(p.x - level.target.pos.x, p.y - level.target.pos.y)
        if (d < bestD) {
          bestD = d
          best = p
        }
      }
    }
    if (best) startCell = best
  }
  const startKey = key(startCell.x, startCell.y)
  dist.set(startKey, 0)
  queue.push(startCell)
  let head = 0
  while (head < queue.length) {
    const p = queue[head++]
    const d = dist.get(key(p.x, p.y))!
    for (const [dx, dy] of [
      [cell, 0],
      [-cell, 0],
      [0, cell],
      [0, -cell],
    ]) {
      const np = { x: p.x + dx, y: p.y + dy }
      const k = key(np.x, np.y)
      if (dist.has(k)) continue
      if (!isOpen(np)) continue
      dist.set(k, d + 1)
      queue.push(np)
    }
    // A wormhole mouth is one step from its twin, so the field sees the shortcut.
    for (const w of level.wormholes ?? []) {
      for (const [from, to] of [
        [w.a, w.b],
        [w.b, w.a],
      ]) {
        if (Math.hypot(from.x - p.x, from.y - p.y) > w.radius) continue
        const k = key(to.x, to.y)
        if (dist.has(k)) continue
        dist.set(k, d + 1)
        queue.push({ x: Math.round(to.x / cell) * cell, y: Math.round(to.y / cell) * cell })
      }
    }
  }
  void goalKey
  return { dist, cell }
}

function walkingDistance(field: { dist: Map<string, number>; cell: number }, level: Level, p: Vec2): number {
  const { dist, cell } = field
  const key = (x: number, y: number) => `${Math.round(x / cell)},${Math.round(y / cell)}`
  const k0 = key(p.x, p.y)
  const d0 = dist.get(k0)
  if (d0 !== undefined) return d0
  // Ball at rest may sit in a cell that rounds to a wall/body cell; search nearby cells.
  let best = Infinity
  for (let r = 1; r <= 4; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const k = key(p.x + dx * cell, p.y + dy * cell)
        const d = dist.get(k)
        if (d !== undefined) best = Math.min(best, d)
      }
    }
    if (best !== Infinity) return best
  }
  return Math.hypot(p.x - level.target.pos.x, p.y - level.target.pos.y) / cell + 1000
}

interface Candidate {
  pos: Vec2
  strokes: number
  shots: Shot[]
}

export interface SolveStats {
  simulations: number
}

export function solveCourse(
  level: Level,
  opts: SolveOptions = {},
): { strokes: number; shots: Shot[]; simulations: number } | null {
  const o = { ...DEFAULTS, ...opts }
  const field = buildDistanceField(level, 0.5)
  let simulations = 0

  const visitedCells = new Map<string, number>()
  const cellKey = (p: Vec2) => `${Math.round(p.x / o.gridCell)},${Math.round(p.y / o.gridCell)}`

  let beam: Candidate[] = [{ pos: level.tee, strokes: 0, shots: [] }]
  visitedCells.set(cellKey(level.tee), 0)

  for (let stroke = 1; stroke <= o.maxStrokes; stroke++) {
    const next: Candidate[] = []
    for (const cand of beam) {
      for (let ai = 0; ai < o.angles; ai++) {
        const angle = -Math.PI + (ai / o.angles) * TAU
        for (let pi = 0; pi < o.powers; pi++) {
          const power = o.minPower + (pi / (o.powers - 1)) * (o.maxPower - o.minPower)
          const aim: Aim = { angle, power }
          const result = simulate(level, cand.pos, aim)
          simulations++
          if (result.outcome === 'goal') {
            return { strokes: cand.strokes + 1, shots: [...cand.shots, { from: cand.pos, aim }], simulations }
          }
          if (result.outcome !== 'rest') continue
          const key = cellKey(result.end)
          const prevBest = visitedCells.get(key)
          if (prevBest !== undefined && prevBest <= cand.strokes + 1) continue
          visitedCells.set(key, cand.strokes + 1)
          next.push({ pos: result.end, strokes: cand.strokes + 1, shots: [...cand.shots, { from: cand.pos, aim }] })
        }
      }
    }
    if (next.length === 0) return null
    next.sort((a, b) => walkingDistance(field, level, a.pos) - walkingDistance(field, level, b.pos))
    beam = next.slice(0, o.beamWidth)
  }
  return null
}

/** Fraction of a tee-only aim sweep that holes out in one shot. */
function holeInOneFraction(level: Level, angles: number, powers: number, minPower: number, maxPower: number): number {
  let wins = 0
  let total = 0
  for (let ai = 0; ai < angles; ai++) {
    const angle = -Math.PI + (ai / angles) * TAU
    for (let pi = 0; pi < powers; pi++) {
      const power = minPower + (pi / (powers - 1)) * (maxPower - minPower)
      total++
      const result = simulate(level, level.tee, { angle, power })
      if (result.outcome === 'goal') wins++
    }
  }
  return total ? wins / total : 0
}

function formatAim(aim: Aim): { angle: number; power: number } {
  return { angle: Math.round(aim.angle * 1e6) / 1e6, power: Math.round(aim.power * 1e6) / 1e6 }
}

function verifySolution(level: Level, aims: Aim[]): boolean {
  let pos = level.tee
  for (let i = 0; i < aims.length; i++) {
    const result = simulate(level, pos, aims[i])
    if (result.outcome === 'goal') return i === aims.length - 1
    if (result.outcome !== 'rest') return false
    pos = result.end
  }
  return false
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write')
  const rows: string[] = []
  const solutions: Record<string, Aim[]> = {}

  for (const level of LEVELS) {
    const t0 = performance.now()
    const solved = solveCourse(level)
    const elapsed = performance.now() - t0
    const hio = holeInOneFraction(level, DEFAULTS.angles, DEFAULTS.powers, DEFAULTS.minPower, DEFAULTS.maxPower)
    const strokes = solved ? solved.strokes : -1
    const sims = solved ? solved.simulations : 0
    rows.push(
      `${level.id}\tpar=${level.par}\tbest=${strokes}\tsims=${sims}\ttime=${elapsed.toFixed(0)}ms\thio=${(hio * 100).toFixed(2)}%`,
    )
    if (solved) {
      const aims = solved.shots.map((s) => s.aim)
      if (!verifySolution(level, aims)) {
        rows[rows.length - 1] += '\tREPLAY-MISMATCH'
      } else {
        solutions[level.id] = aims.map(formatAim)
      }
    }
  }

  for (const row of rows) console.log(row)

  if (write) {
    const lines: string[] = []
    lines.push("import type { Aim } from './types.ts'")
    lines.push('')
    lines.push('export const SOLUTIONS: Record<string, Aim[]> = {')
    for (const [id, aims] of Object.entries(solutions)) {
      const shotsStr = aims.map((a) => `{ angle: ${a.angle}, power: ${a.power} }`).join(', ')
      lines.push(`  ${id}: [${shotsStr}],`)
    }
    lines.push('}')
    lines.push('')
    const fs = await import('node:fs/promises')
    await fs.writeFile(new URL('../src/game/solutions.ts', import.meta.url), lines.join('\n'))
    console.log(`\nWrote ${Object.keys(solutions).length} solutions to src/game/solutions.ts`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
