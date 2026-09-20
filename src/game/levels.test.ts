import { test } from 'node:test'
import assert from 'node:assert/strict'

import { GRAVITY_SCALE, LEVELS, SANDBOX_LEVEL, makeSandboxBody } from './levels.ts'
import { SOLUTIONS } from './solutions.ts'
import {
  acceleration,
  bodyPosition,
  courseBounds,
  onFairway,
  pointInPolygon,
  railPosition,
  saucerPosition,
  simulate,
  ROLL_DECEL,
} from './physics.ts'
import type { Level, Vec2 } from './types.ts'

function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const ex = b.x - a.x
  const ey = b.y - a.y
  const len2 = ex * ex + ey * ey
  const u = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2))
  const cx = a.x + ex * u
  const cy = a.y + ey * u
  return Math.hypot(p.x - cx, p.y - cy)
}

function minWallDist(level: Level, p: Vec2): number {
  let m = Infinity
  for (const loop of [level.course, ...level.islands]) {
    for (let i = 0; i < loop.length; i++) {
      m = Math.min(m, distToSeg(p, loop[i], loop[(i + 1) % loop.length]))
    }
  }
  return m
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (o: Vec2, p: Vec2, q: Vec2) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function isSimplePolygon(poly: Vec2[]): boolean {
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue
      if (segmentsIntersect(a, b, poly[j], poly[(j + 1) % n])) return false
    }
  }
  return true
}

function bodyAt(level: Level, id: string) {
  const b = level.bodies.find((x) => x.id === id)
  assert.ok(b, `expected body ${id} to exist`)
  return b!
}

function fairwayConnected(level: Level, cell = 0.5): boolean {
  const key = (x: number, y: number) => `${Math.round(x / cell)},${Math.round(y / cell)}`
  const start = level.tee
  const goalKey = key(level.target.pos.x, level.target.pos.y)
  const visited = new Set<string>([key(start.x, start.y)])
  const queue: Vec2[] = [start]
  if (key(start.x, start.y) === goalKey) return true
  let head = 0
  while (head < queue.length) {
    const p = queue[head++]
    const neighbors: Vec2[] = [
      { x: p.x + cell, y: p.y },
      { x: p.x - cell, y: p.y },
      { x: p.x, y: p.y + cell },
      { x: p.x, y: p.y - cell },
    ]
    // A cell within a wormhole mouth links straight through to the cell at its other mouth: a
    // ball rolling into one comes out the other, so the flood fill must be able to too.
    for (const w of level.wormholes ?? []) {
      if (Math.hypot(p.x - w.a.x, p.y - w.a.y) <= w.radius) neighbors.push(w.b)
      if (Math.hypot(p.x - w.b.x, p.y - w.b.y) <= w.radius) neighbors.push(w.a)
    }
    for (const np of neighbors) {
      const k = key(np.x, np.y)
      if (visited.has(k)) continue
      if (!onFairway(level, np)) continue
      visited.add(k)
      if (k === goalKey) return true
      queue.push(np)
    }
  }
  return false
}

// -- Ids in order ---------------------------------------------------------------------------------

test('LEVELS has exactly 18 holes ordered l01..l18', () => {
  assert.equal(LEVELS.length, 18)
  LEVELS.forEach((l, i) => assert.equal(l.id, `l${String(i + 1).padStart(2, '0')}`))
})

// -- Per-level geometry, body, and gameplay sanity -------------------------------------------------

for (const level of LEVELS) {
  test(`${level.id}: polygon sanity`, () => {
    assert.ok(level.course.length >= 4, 'course needs at least 4 vertices')
    assert.ok(level.course.length <= 40, 'course exceeds 40 vertices')
    for (const loop of [level.course, ...level.islands]) {
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i]
        const b = loop[(i + 1) % loop.length]
        assert.ok(Math.hypot(b.x - a.x, b.y - a.y) > 1e-6, 'zero-length edge')
      }
    }
    assert.ok(isSimplePolygon(level.course), 'course self-intersects')
    for (const island of level.islands) assert.ok(isSimplePolygon(island), 'island self-intersects')
    assert.deepEqual(level.bounds, courseBounds(level.course))
  })

  test(`${level.id}: tee and cup are on the fairway, clear of every wall`, () => {
    assert.ok(onFairway(level, level.tee), 'tee not on fairway')
    assert.ok(onFairway(level, level.target.pos), 'cup not on fairway')
    assert.ok(minWallDist(level, level.tee) >= 1.2, 'tee too close to a wall')
    assert.ok(minWallDist(level, level.target.pos) >= 1.2, 'cup too close to a wall')
  })

  test(`${level.id}: bodies sit on the fairway, clear of each other, the tee, and the cup`, () => {
    for (const b of level.bodies) {
      const p0 = bodyPosition(b, 0)
      assert.ok(onFairway(level, p0), `body ${b.id} not on fairway at t=0`)
      for (const other of level.bodies) {
        if (other === b) continue
        const p1 = bodyPosition(other, 0)
        const d = Math.hypot(p0.x - p1.x, p0.y - p1.y)
        assert.ok(d >= b.radius + other.radius, `bodies ${b.id}/${other.id} overlap`)
      }
      const dTee = Math.hypot(p0.x - level.tee.x, p0.y - level.tee.y)
      assert.ok(dTee >= 1.5, `body ${b.id} too close to the tee`)
      const dCup = Math.hypot(p0.x - level.target.pos.x, p0.y - level.target.pos.y)
      assert.ok(dCup >= b.radius + 0.5, `body ${b.id} too close to the cup`)
    }
  })

  test(`${level.id}: rails stay on the fairway, clear of walls`, () => {
    const rails: { center: Vec2; radius: number; period: number; phase: number; clearance: number }[] = []
    for (const b of level.bodies) if (b.rail) rails.push({ ...b.rail, clearance: b.radius })
    if (level.target.rail) rails.push({ ...level.target.rail, clearance: level.target.radius })
    for (const rail of rails) {
      for (let k = 0; k < 32; k++) {
        const t = (k / 32) * rail.period
        const p = railPosition(rail, t)
        assert.ok(onFairway(level, p), `rail leaves fairway at sample ${k}`)
        assert.ok(minWallDist(level, p) >= rail.clearance, `rail too close to a wall at sample ${k}`)
      }
    }
  })

  test(`${level.id}: wormhole mouths sit on the fairway, clear of the tee, cup, and every body`, () => {
    for (const w of level.wormholes ?? []) {
      assert.ok(onFairway(level, w.a), `wormhole ${w.id} mouth a not on fairway`)
      assert.ok(onFairway(level, w.b), `wormhole ${w.id} mouth b not on fairway`)

      const dTeeA = Math.hypot(w.a.x - level.tee.x, w.a.y - level.tee.y)
      const dTeeB = Math.hypot(w.b.x - level.tee.x, w.b.y - level.tee.y)
      assert.ok(dTeeA >= w.radius + 0.3, `wormhole ${w.id} mouth a too close to the tee`)
      assert.ok(dTeeB >= w.radius + 0.3, `wormhole ${w.id} mouth b too close to the tee`)

      const dCupA = Math.hypot(w.a.x - level.target.pos.x, w.a.y - level.target.pos.y)
      const dCupB = Math.hypot(w.b.x - level.target.pos.x, w.b.y - level.target.pos.y)
      assert.ok(dCupA >= w.radius + 0.3, `wormhole ${w.id} mouth a too close to the cup`)
      assert.ok(dCupB >= w.radius + 0.3, `wormhole ${w.id} mouth b too close to the cup`)

      for (const b of level.bodies) {
        const bp = bodyPosition(b, 0)
        const dA = Math.hypot(w.a.x - bp.x, w.a.y - bp.y)
        const dB = Math.hypot(w.b.x - bp.x, w.b.y - bp.y)
        assert.ok(dA >= w.radius + 0.3, `wormhole ${w.id} mouth a too close to body ${b.id}`)
        assert.ok(dB >= w.radius + 0.3, `wormhole ${w.id} mouth b too close to body ${b.id}`)
      }

      const dAB = Math.hypot(w.a.x - w.b.x, w.a.y - w.b.y)
      assert.ok(dAB >= 2 * w.radius, `wormhole ${w.id} mouths overlap`)
    }
  })

  test(`${level.id}: saucers stay on the fairway and their beam never covers the tee or a stationary cup`, () => {
    for (const s of level.saucers ?? []) {
      const period = s.rail ? s.rail.period : s.patrol ? s.patrol.period : 1
      for (let k = 0; k < 48; k++) {
        const t = (k / 48) * period
        const p = saucerPosition(s, t)
        assert.ok(onFairway(level, p), `saucer ${s.id} leaves the fairway at sample ${k}`)

        const dTee = Math.hypot(p.x - level.tee.x, p.y - level.tee.y)
        assert.ok(dTee >= s.radius, `saucer ${s.id} beam covers the tee at sample ${k}`)

        if (!level.target.rail) {
          const dCup = Math.hypot(p.x - level.target.pos.x, p.y - level.target.pos.y)
          assert.ok(dCup >= s.radius, `saucer ${s.id} beam covers the cup at sample ${k}`)
        }
      }
    }
  })

  test(`${level.id}: islands lie inside the course`, () => {
    for (const island of level.islands) {
      for (const p of island) assert.ok(pointInPolygon(p, level.course), 'island vertex outside course')
    }
  })

  test(`${level.id}: tee and cup are connected through the fairway`, () => {
    assert.ok(fairwayConnected(level), 'tee and cup are not connected on the 0.5-unit grid')
  })

  test(`${level.id}: a resting ball can actually rest`, () => {
    const out: Vec2 = { x: 0, y: 0 }
    acceleration(level, level.tee.x, level.tee.y, 0, out)
    assert.ok(Math.hypot(out.x, out.y) <= ROLL_DECEL, 'gravity at the tee exceeds ROLL_DECEL')

    const b = level.bounds
    let total = 0
    let ok = 0
    for (let x = b.minX; x <= b.maxX; x += 1) {
      for (let y = b.minY; y <= b.maxY; y += 1) {
        const p = { x, y }
        if (!onFairway(level, p)) continue
        let insideBody = false
        for (const body of level.bodies) {
          const bp = bodyPosition(body, 0)
          if (Math.hypot(bp.x - p.x, bp.y - p.y) <= body.radius) insideBody = true
        }
        if (insideBody) continue
        total++
        acceleration(level, x, y, 0, out)
        if (Math.hypot(out.x, out.y) <= ROLL_DECEL) ok++
      }
    }
    assert.ok(total > 0, 'no open fairway grid points sampled')
    assert.ok(ok / total >= 0.7, `only ${((ok / total) * 100).toFixed(1)}% of the fairway can hold a resting ball`)
  })

  test(`${level.id}: hint is non-empty and never says "pull"`, () => {
    assert.ok(level.hint.trim().length > 0)
    assert.ok(!level.hint.toLowerCase().includes('pull'), 'hint should describe dragging toward the shot')
  })

  test(`${level.id}: the stored solution replays to the cup within par`, () => {
    const aims = SOLUTIONS[level.id]
    assert.ok(aims && aims.length > 0, `no stored solution for ${level.id}`)
    assert.ok(aims!.length <= level.par, `solution takes ${aims!.length} strokes, more than par ${level.par}`)
    let pos = level.tee
    let holed = false
    for (const aim of aims!) {
      const result = simulate(level, pos, aim)
      if (result.outcome === 'goal') {
        holed = true
        break
      }
      assert.equal(result.outcome, 'rest', `shot from (${pos.x}, ${pos.y}) ended in a hazard`)
      pos = result.end
    }
    assert.ok(holed, 'replaying the stored solution never reaches the cup')
  })
}

// -- Sandbox ----------------------------------------------------------------------------------------

test('SANDBOX_LEVEL is a plain rectangle with no bodies or islands', () => {
  assert.equal(SANDBOX_LEVEL.id, 'sandbox')
  assert.equal(SANDBOX_LEVEL.par, 0)
  assert.equal(SANDBOX_LEVEL.islands.length, 0)
  assert.equal(SANDBOX_LEVEL.bodies.length, 0)
  assert.ok(SANDBOX_LEVEL.tee.x < SANDBOX_LEVEL.target.pos.x, 'tee should be left of the cup')
  assert.ok(onFairway(SANDBOX_LEVEL, SANDBOX_LEVEL.tee))
  assert.ok(onFairway(SANDBOX_LEVEL, SANDBOX_LEVEL.target.pos))
})

test('makeSandboxBody sizes match spec', () => {
  const small = bodyAt({ ...SANDBOX_LEVEL, bodies: [makeSandboxBody({ x: 0, y: 0 }, 'small', 0)] }, 'sb0')
  assert.ok(Math.abs(small.mu - 5 * GRAVITY_SCALE) < 1e-9)
  assert.equal(small.radius, 0.6)

  const medium = bodyAt({ ...SANDBOX_LEVEL, bodies: [makeSandboxBody({ x: 0, y: 0 }, 'medium', 1)] }, 'sb1')
  assert.ok(Math.abs(medium.mu - 11 * GRAVITY_SCALE) < 1e-9)
  assert.equal(medium.radius, 0.9)

  const large = bodyAt({ ...SANDBOX_LEVEL, bodies: [makeSandboxBody({ x: 0, y: 0 }, 'large', 2)] }, 'sb2')
  assert.ok(Math.abs(large.mu - 20 * GRAVITY_SCALE) < 1e-9)
  assert.equal(large.radius, 1.3)

  const hole = bodyAt({ ...SANDBOX_LEVEL, bodies: [makeSandboxBody({ x: 0, y: 0 }, 'blackhole', 3)] }, 'sb3')
  assert.equal(hole.kind, 'blackhole')
  assert.ok(Math.abs(hole.mu - 34 * GRAVITY_SCALE) < 1e-9)
  assert.equal(hole.radius, 0.45)
})

interface FeatureAnchor {
  id: string
  pos: Vec2
  radius: number
  railedSaucer: boolean
}

function featureAnchors(level: Level): FeatureAnchor[] {
  const anchors: FeatureAnchor[] = []

  for (const body of level.bodies) {
    const pos = body.rail ? body.rail.center : body.pos
    const radius = body.rail ? body.rail.radius + body.radius : body.radius
    anchors.push({ id: body.id, pos, radius, railedSaucer: false })
  }

  for (const w of level.wormholes ?? []) {
    anchors.push({ id: `${w.id}.a`, pos: w.a, radius: w.radius, railedSaucer: false })
    anchors.push({ id: `${w.id}.b`, pos: w.b, radius: w.radius, railedSaucer: false })
  }

  for (const s of level.saucers ?? []) {
    if (s.rail) {
      anchors.push({ id: s.id, pos: s.rail.center, radius: s.rail.radius, railedSaucer: true })
    } else if (s.patrol) {
      const mid = { x: (s.patrol.a.x + s.patrol.b.x) / 2, y: (s.patrol.a.y + s.patrol.b.y) / 2 }
      anchors.push({ id: s.id, pos: mid, radius: s.radius, railedSaucer: false })
    } else {
      anchors.push({ id: s.id, pos: s.pos, radius: s.radius, railedSaucer: false })
    }
  }

  level.islands.forEach((island, i) => {
    const cx = island.reduce((sum, v) => sum + v.x, 0) / island.length
    const cy = island.reduce((sum, v) => sum + v.y, 0) / island.length
    anchors.push({ id: `island${i}`, pos: { x: cx, y: cy }, radius: 0, railedSaucer: false })
  })

  return anchors
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

test('no feature has more than one other feature within 5 units (courses stay uncluttered)', () => {
  for (const level of LEVELS) {
    const anchors = featureAnchors(level)
    for (const anchor of anchors) {
      const neighbors = anchors.filter((other) => {
        if (other.id === anchor.id) return false
        if (anchor.railedSaucer || other.railedSaucer) return false
        return dist(anchor.pos, other.pos) < 5
      })
      assert.ok(
        neighbors.length <= 1,
        `level ${level.id}: feature ${anchor.id} has ${neighbors.length} neighbors within 5 units: ${neighbors.map((n) => n.id).join(', ')}`,
      )
    }
  }
})

test('static bodies and wormhole mouths never overlap each other', () => {
  for (const level of LEVELS) {
    const anchors = featureAnchors(level)
      .filter((a) => level.bodies.some((b) => b.id === a.id) || a.id.endsWith('.a') || a.id.endsWith('.b'))
      .filter((a) => {
        const body = level.bodies.find((b) => b.id === a.id)
        return !body || !body.rail
      })

    for (let i = 0; i < anchors.length; i++) {
      for (let j = i + 1; j < anchors.length; j++) {
        const a = anchors[i]
        const b = anchors[j]
        const d = dist(a.pos, b.pos)
        assert.ok(
          d >= a.radius + b.radius + 1,
          `level ${level.id}: ${a.id} and ${b.id} overlap (distance ${d.toFixed(2)}, need >= ${(a.radius + b.radius + 1).toFixed(2)})`,
        )
      }
    }
  }
})
