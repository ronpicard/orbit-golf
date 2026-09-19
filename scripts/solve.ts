import { pathToFileURL } from 'node:url'
import { simulate, defaultAim } from '../src/game/physics.ts'
import { LEVELS } from '../src/game/levels.ts'
import type { Aim, Level } from '../src/game/types.ts'

const DEG = Math.PI / 180

export interface SolveResult {
  wins: number
  total: number
  best: { angle: number; power: number; time: number } | null
  directWins: boolean
}

/** Signed shortest difference between two angles given in degrees, result in [-180, 180]. */
function angleDiffDeg(a: number, b: number): number {
  let diff = (a - b) % 360
  if (diff > 180) diff -= 360
  if (diff < -180) diff += 360
  return diff
}

/**
 * Sweeps a grid of aims for a level and reports how many win. angleStepDeg divides the full
 * circle (360 / angleStepDeg steps); powerStep divides the [0.05, 1.00] power range inclusive.
 */
export function solveLevel(level: Level, angleStepDeg: number, powerStep: number): SolveResult {
  const dAimDeg = defaultAim(level).angle / DEG
  const angleSteps = Math.round(360 / angleStepDeg)
  const powerSteps = Math.round((1 - 0.05) / powerStep) + 1

  let wins = 0
  let total = 0
  let directWins = false
  let best: { angle: number; power: number; time: number } | null = null

  for (let ai = 0; ai < angleSteps; ai++) {
    const angleDeg = -180 + ai * angleStepDeg
    const angle = angleDeg * DEG
    for (let pi = 0; pi < powerSteps; pi++) {
      const power = Math.min(1, 0.05 + pi * powerStep)
      total++
      const aim: Aim = { angle, power }
      const result = simulate(level, aim)
      if (result.outcome !== 'goal') continue
      wins++
      if (!best || result.time < best.time) best = { angle: angleDeg, power, time: result.time }
      if (Math.abs(angleDiffDeg(angleDeg, dAimDeg)) <= 1.5) directWins = true
    }
  }

  return { wins, total, best, directWins }
}

function main(): void {
  const idArg = process.argv[2]
  const levels = idArg ? LEVELS.filter((l) => l.id === idArg) : LEVELS
  if (idArg && levels.length === 0) {
    console.error(`Unknown level id: ${idArg}`)
    process.exitCode = 1
    return
  }

  for (const level of levels) {
    const r = solveLevel(level, 0.5, 0.01)
    const pct = ((r.wins / r.total) * 100).toFixed(2)
    const bestStr = r.best
      ? `angle=${r.best.angle.toFixed(1)}deg power=${r.best.power.toFixed(2)} time=${r.best.time.toFixed(2)}s`
      : 'none'
    console.log(
      `${level.id}\twins=${r.wins}/${r.total}\t${pct}%\tdirectWins=${r.directWins}\tbest=${bestStr}`,
    )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
