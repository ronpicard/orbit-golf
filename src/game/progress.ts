import type { Level } from './types.ts'

export const STORAGE_KEY = 'orbit-golf.progress.v1'

/** Level id -> fewest launches taken to complete it. */
export interface Progress {
  best: Record<string, number>
}

export function emptyProgress(): Progress {
  return { best: {} }
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 999
}

/**
 * localStorage is untrusted input: accept only an object whose `best` maps strings to integers
 * in 1..999; anything else yields emptyProgress(). Never throws.
 */
export function parseProgress(raw: string | null): Progress {
  if (raw === null) return emptyProgress()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyProgress()
  }
  if (!isPlainObject(parsed)) return emptyProgress()
  const bestRaw = (parsed as Record<string, unknown>).best
  if (!isPlainObject(bestRaw)) return emptyProgress()

  const best: Record<string, number> = {}
  for (const key of Object.keys(bestRaw)) {
    if (FORBIDDEN_KEYS.has(key)) continue
    const value = bestRaw[key]
    if (isValidScore(value)) best[key] = value
  }
  return { best }
}

export function recordResult(progress: Progress, levelId: string, strokes: number): Progress {
  const existing = progress.best[levelId]
  const next = existing === undefined ? strokes : Math.min(existing, strokes)
  return { best: { ...progress.best, [levelId]: next } }
}

/** Index 0 is always unlocked; otherwise the previous level must have a recorded best. */
export function isUnlocked(progress: Progress, levels: Level[], index: number): boolean {
  if (index === 0) return true
  const prev = levels[index - 1]
  if (!prev) return false
  return progress.best[prev.id] !== undefined
}

export function totalScore(progress: Progress, levels: Level[]): { strokes: number; par: number; completed: number } {
  let strokes = 0
  let par = 0
  let completed = 0
  for (const level of levels) {
    const best = progress.best[level.id]
    if (best === undefined) continue
    strokes += best
    par += level.par
    completed += 1
  }
  return { strokes, par, completed }
}

export function scoreLabel(strokes: number, par: number): string {
  if (strokes === 1) return 'Hole in one'
  const diff = strokes - par
  if (diff <= -2) return 'Eagle'
  if (diff === -1) return 'Birdie'
  if (diff === 0) return 'Par'
  if (diff === 1) return 'Bogey'
  if (diff === 2) return 'Double bogey'
  return `+${diff}`
}

export function loadProgress(storage: Pick<Storage, 'getItem'> | null): Progress {
  if (!storage) return emptyProgress()
  try {
    return parseProgress(storage.getItem(STORAGE_KEY))
  } catch {
    return emptyProgress()
  }
}

export function saveProgress(progress: Progress, storage: Pick<Storage, 'setItem'> | null): boolean {
  if (!storage) return false
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(progress))
    return true
  } catch {
    return false
  }
}
