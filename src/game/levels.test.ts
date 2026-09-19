import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LEVELS, makeSandboxBody } from './levels.ts'
import { bodyPosition, targetPosition, homeBody } from './physics.ts'
import { solveLevel } from '../../scripts/solve.ts'

const DIRECT_MUST_NOT_WIN = new Set(['l03', 'l04', 'l07', 'l08', 'l10', 'l13', 'l16', 'l17', 'l18'])

test('level ids are unique and ordered l01..l18', () => {
  const ids = LEVELS.map((l) => l.id)
  assert.deepEqual(
    ids,
    Array.from({ length: 18 }, (_, i) => `l${String(i + 1).padStart(2, '0')}`),
  )
  assert.equal(new Set(ids).size, ids.length)
})

test('every level has a valid homeId', () => {
  for (const level of LEVELS) {
    assert.ok(
      level.bodies.some((b) => b.id === level.homeId),
      `${level.id}: homeId ${level.homeId} not found among bodies`,
    )
  }
})

test('bodies do not overlap at t=0 and lie inside bounds', () => {
  for (const level of LEVELS) {
    const b = level.bounds
    const positions = level.bodies.map((body) => ({ body, pos: bodyPosition(body, 0) }))
    for (const { body, pos } of positions) {
      assert.ok(
        pos.x - body.radius >= b.minX &&
          pos.x + body.radius <= b.maxX &&
          pos.y - body.radius >= b.minY &&
          pos.y + body.radius <= b.maxY,
        `${level.id}: body ${body.id} out of bounds at t=0`,
      )
    }
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]
        const c = positions[j]
        const d = Math.hypot(a.pos.x - c.pos.x, a.pos.y - c.pos.y)
        assert.ok(
          d >= a.body.radius + c.body.radius,
          `${level.id}: bodies ${a.body.id} and ${c.body.id} overlap at t=0`,
        )
      }
    }
  }
})

test('target is inside bounds and not inside a body', () => {
  for (const level of LEVELS) {
    const b = level.bounds
    const tp = targetPosition(level.target, 0)
    assert.ok(
      tp.x - level.target.radius >= b.minX &&
        tp.x + level.target.radius <= b.maxX &&
        tp.y - level.target.radius >= b.minY &&
        tp.y + level.target.radius <= b.maxY,
      `${level.id}: target out of bounds at t=0`,
    )
    for (const body of level.bodies) {
      const p = bodyPosition(body, 0)
      const d = Math.hypot(p.x - tp.x, p.y - tp.y)
      assert.ok(d >= body.radius + level.target.radius, `${level.id}: target overlaps body ${body.id}`)
    }
  }
})

test('levels have at most 12 bodies', () => {
  for (const level of LEVELS) {
    assert.ok(level.bodies.length <= 12, `${level.id}: too many bodies (${level.bodies.length})`)
  }
})

test('every level has a non-empty name and hint, and par >= 1', () => {
  for (const level of LEVELS) {
    assert.ok(level.name.trim().length > 0, `${level.id}: empty name`)
    assert.ok(level.hint.trim().length > 0, `${level.id}: empty hint`)
    assert.ok(level.par >= 1, `${level.id}: par must be >= 1`)
  }
})

test('no hint references the old pull-back aiming control', () => {
  for (const level of LEVELS) {
    assert.ok(!level.hint.toLowerCase().includes('pull'), `${level.id}: hint mentions pulling back`)
  }
})

test('the home planet exists and every level is solvable', () => {
  for (const level of LEVELS) {
    // Throws if homeId does not resolve to a body.
    homeBody(level)
    const { wins, directWins } = solveLevel(level, 1, 0.02)
    assert.ok(wins > 0, `${level.id}: no winning aim found in coarse sweep`)
    if (DIRECT_MUST_NOT_WIN.has(level.id)) {
      assert.equal(directWins, false, `${level.id}: direct shot must not win`)
    }
  }
})

test('makeSandboxBody returns the right kind, mu, and radius for each size', () => {
  const pos = { x: 0, y: 0 }
  const small = makeSandboxBody(pos, 'small', 0)
  assert.equal(small.kind, 'planet')
  assert.equal(small.mu, 6)
  assert.equal(small.radius, 0.7)
  assert.equal(small.id, 'sb0')

  const medium = makeSandboxBody(pos, 'medium', 1)
  assert.equal(medium.kind, 'planet')
  assert.equal(medium.mu, 16)
  assert.equal(medium.radius, 1.1)
  assert.equal(medium.id, 'sb1')

  const large = makeSandboxBody(pos, 'large', 2)
  assert.equal(large.kind, 'planet')
  assert.equal(large.mu, 34)
  assert.equal(large.radius, 1.6)
  assert.equal(large.id, 'sb2')

  const blackhole = makeSandboxBody(pos, 'blackhole', 3)
  assert.equal(blackhole.kind, 'blackhole')
  assert.equal(blackhole.mu, 70)
  assert.equal(blackhole.radius, 0.55)
  assert.equal(blackhole.id, 'sb3')
})
