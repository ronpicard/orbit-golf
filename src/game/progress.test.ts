import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Level } from './types.ts'
import {
  STORAGE_KEY,
  emptyProgress,
  parseProgress,
  recordResult,
  isUnlocked,
  totalScore,
  scoreLabel,
  loadProgress,
  saveProgress,
} from './progress.ts'

function makeLevel(id: string, par: number): Level {
  return {
    id,
    name: id,
    hint: '',
    par,
    homeId: 'home',
    bodies: [],
    target: { pos: { x: 0, y: 0 }, radius: 1 },
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    maxSpeed: 10,
    maxTime: 10,
  }
}

// ---------- emptyProgress ----------

test('emptyProgress returns an empty best map', () => {
  assert.deepEqual(emptyProgress(), { best: {} })
})

// ---------- parseProgress ----------

test('parseProgress returns empty progress for null', () => {
  assert.deepEqual(parseProgress(null), emptyProgress())
})

test('parseProgress returns empty progress for malformed JSON', () => {
  assert.deepEqual(parseProgress('{not json'), emptyProgress())
})

test('parseProgress returns empty progress for a non-object JSON value', () => {
  assert.deepEqual(parseProgress('42'), emptyProgress())
  assert.deepEqual(parseProgress('"hello"'), emptyProgress())
  assert.deepEqual(parseProgress('null'), emptyProgress())
  assert.deepEqual(parseProgress('[1,2,3]'), emptyProgress())
})

test('parseProgress returns empty progress when best is missing or wrong shape', () => {
  assert.deepEqual(parseProgress('{}'), emptyProgress())
  assert.deepEqual(parseProgress('{"best": "nope"}'), emptyProgress())
  assert.deepEqual(parseProgress('{"best": [1,2,3]}'), emptyProgress())
  assert.deepEqual(parseProgress('{"best": null}'), emptyProgress())
})

test('parseProgress accepts a well-formed progress object', () => {
  const result = parseProgress('{"best": {"level-1": 3, "level-2": 5}}')
  assert.deepEqual(result, { best: { 'level-1': 3, 'level-2': 5 } })
})

test('parseProgress drops non-integer or out-of-range scores', () => {
  const result = parseProgress(
    JSON.stringify({
      best: {
        good: 5,
        tooLow: 0,
        negative: -1,
        tooHigh: 1000,
        float: 2.5,
        stringy: '3',
        nully: null,
        nan: Number.NaN,
        infinite: Infinity,
        atMin: 1,
        atMax: 999,
      },
    }),
  )
  assert.deepEqual(result, { best: { good: 5, atMin: 1, atMax: 999 } })
})

test('parseProgress guards against prototype pollution keys', () => {
  const raw = '{"best": {"__proto__": 3, "constructor": 4, "prototype": 5, "safe": 2}}'
  const result = parseProgress(raw)
  assert.deepEqual(result, { best: { safe: 2 } })
  // Ensure nothing leaked onto Object.prototype.
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
  assert.equal(Object.prototype.hasOwnProperty.call(result.best, '__proto__'), false)
})

test('parseProgress never throws on weird input', () => {
  assert.doesNotThrow(() => parseProgress(undefined as unknown as string))
  assert.doesNotThrow(() => parseProgress('{"best":{"a":{}}}'))
  assert.doesNotThrow(() => parseProgress('   '))
})

// ---------- recordResult ----------

test('recordResult adds a new level score', () => {
  const p = recordResult(emptyProgress(), 'level-1', 4)
  assert.deepEqual(p, { best: { 'level-1': 4 } })
})

test('recordResult keeps the minimum of the old and new scores', () => {
  let p = recordResult(emptyProgress(), 'level-1', 5)
  p = recordResult(p, 'level-1', 3)
  assert.equal(p.best['level-1'], 3)
  p = recordResult(p, 'level-1', 7)
  assert.equal(p.best['level-1'], 3)
})

test('recordResult is immutable', () => {
  const original = emptyProgress()
  const updated = recordResult(original, 'level-1', 4)
  assert.deepEqual(original, emptyProgress())
  assert.notEqual(original, updated)
})

// ---------- isUnlocked ----------

test('isUnlocked: index 0 is always unlocked', () => {
  const levels = [makeLevel('a', 3), makeLevel('b', 3)]
  assert.equal(isUnlocked(emptyProgress(), levels, 0), true)
})

test('isUnlocked: level unlocks only once the previous level has a best score', () => {
  const levels = [makeLevel('a', 3), makeLevel('b', 3), makeLevel('c', 3)]
  assert.equal(isUnlocked(emptyProgress(), levels, 1), false)
  const p1 = recordResult(emptyProgress(), 'a', 4)
  assert.equal(isUnlocked(p1, levels, 1), true)
  assert.equal(isUnlocked(p1, levels, 2), false)
  const p2 = recordResult(p1, 'b', 2)
  assert.equal(isUnlocked(p2, levels, 2), true)
})

test('isUnlocked: out-of-range index with no previous level is false', () => {
  const levels = [makeLevel('a', 3)]
  assert.equal(isUnlocked(emptyProgress(), levels, 5), false)
})

// ---------- totalScore ----------

test('totalScore sums only completed levels', () => {
  const levels = [makeLevel('a', 3), makeLevel('b', 4), makeLevel('c', 5)]
  let p = emptyProgress()
  p = recordResult(p, 'a', 3)
  p = recordResult(p, 'b', 6)
  const total = totalScore(p, levels)
  assert.deepEqual(total, { strokes: 9, par: 7, completed: 2 })
})

test('totalScore is all zero when nothing is completed', () => {
  const levels = [makeLevel('a', 3), makeLevel('b', 4)]
  assert.deepEqual(totalScore(emptyProgress(), levels), { strokes: 0, par: 0, completed: 0 })
})

// ---------- scoreLabel ----------

test('scoreLabel: every branch', () => {
  assert.equal(scoreLabel(1, 5), 'Hole in one')
  assert.equal(scoreLabel(1, 1), 'Hole in one')
  assert.equal(scoreLabel(2, 4), 'Eagle')
  assert.equal(scoreLabel(2, 10), 'Eagle')
  assert.equal(scoreLabel(3, 4), 'Birdie')
  assert.equal(scoreLabel(4, 4), 'Par')
  assert.equal(scoreLabel(5, 4), 'Bogey')
  assert.equal(scoreLabel(6, 4), 'Double bogey')
  assert.equal(scoreLabel(7, 4), '+3')
  assert.equal(scoreLabel(10, 4), '+6')
})

// ---------- loadProgress ----------

test('loadProgress returns empty progress for null storage', () => {
  assert.deepEqual(loadProgress(null), emptyProgress())
})

test('loadProgress reads and parses from storage', () => {
  const store = new Map<string, string>()
  store.set(STORAGE_KEY, JSON.stringify({ best: { 'level-1': 2 } }))
  const storage = { getItem: (key: string) => store.get(key) ?? null }
  assert.deepEqual(loadProgress(storage), { best: { 'level-1': 2 } })
})

test('loadProgress returns empty progress when getItem throws', () => {
  const storage = {
    getItem: () => {
      throw new Error('blocked')
    },
  }
  assert.deepEqual(loadProgress(storage), emptyProgress())
})

// ---------- saveProgress ----------

test('saveProgress returns false for null storage', () => {
  assert.equal(saveProgress(emptyProgress(), null), false)
})

test('saveProgress writes JSON and returns true on success', () => {
  const store = new Map<string, string>()
  const storage = {
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
  }
  const progress = recordResult(emptyProgress(), 'level-1', 3)
  const ok = saveProgress(progress, storage)
  assert.equal(ok, true)
  assert.deepEqual(JSON.parse(store.get(STORAGE_KEY) as string), progress)
})

test('saveProgress returns false instead of throwing when setItem throws', () => {
  const storage = {
    setItem: () => {
      throw new Error('quota exceeded')
    },
  }
  assert.equal(saveProgress(emptyProgress(), storage), false)
})
