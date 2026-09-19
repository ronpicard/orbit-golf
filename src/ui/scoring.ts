/**
 * UI-only par-relative formatting, layered on top of `game/progress.ts`'s word labels
 * (`scoreLabel` gives "Birdie"/"Bogey"; this gives the compact "+3"/"E"/"-2" form and the
 * color class used to tint it).
 */

export function parRelation(strokes: number, par: number): string {
  const diff = strokes - par
  if (diff === 0) return 'E'
  return diff > 0 ? `+${diff}` : `${diff}`
}

export type ScoreClass = 'score-under' | 'score-par' | 'score-over'

export function scoreClass(strokes: number, par: number): ScoreClass {
  const diff = strokes - par
  if (diff < 0) return 'score-under'
  if (diff === 0) return 'score-par'
  return 'score-over'
}
