import * as THREE from 'three'
import type { Level, Vec2 } from '../game/types.ts'
import { onFairway } from '../game/physics.ts'
import { wellDepthAt } from './sheet.ts'
import { ParticlePool } from './particles.ts'

/**
 * Two small floating spectator stands just outside the course's outer wall, beside the longest
 * straight edge nearest the cup, angled toward the fairway. Spectators are tiny green-headed
 * aliens (plus a few candy colours) drawn with instanced meshes so the per-spectator cost stays flat.
 */

/** Picks the outer-wall edge to stand beside: long, and close to the cup. */
function pickCrowdEdge(level: Level): { a: Vec2; b: Vec2; normal: Vec2 } {
  const poly = level.course
  const cup = level.target.pos
  let best: { a: Vec2; b: Vec2; score: number } | null = null
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const midx = (a.x + b.x) / 2
    const midy = (a.y + b.y) / 2
    const distToCup = Math.hypot(cup.x - midx, cup.y - midy)
    // Favour long edges, but only among ones reasonably close to the cup.
    const score = len - distToCup * 0.3
    if (!best || score > best.score) best = { a, b, score }
  }
  const a = best!.a
  const b = best!.b
  const midx = (a.x + b.x) / 2
  const midy = (a.y + b.y) / 2
  const tx = b.x - a.x
  const ty = b.y - a.y
  const tlen = Math.hypot(tx, ty) || 1
  let nx = -ty / tlen
  let ny = tx / tlen
  // Flip so the normal points away from the fairway (outward).
  if (onFairway(level, { x: midx + nx * 0.5, y: midy + ny * 0.5 })) {
    nx = -nx
    ny = -ny
  }
  return { a, b, normal: { x: nx, y: ny } }
}

export interface CrowdOptions {
  lowPerf: boolean
}

export interface Crowd {
  group: THREE.Group
  build(level: Level, options: CrowdOptions): void
  update(dt: number, elapsed: number, reducedMotion: boolean, ballWorld: THREE.Vector3 | null): void
  /** Cheer (goal) or groan (miss) reaction, called once a flight ends. */
  react(kind: 'cheer' | 'groan'): void
  dispose(): void
}

const HEAD_COLORS = [0x4ade80, 0x4ade80, 0x4ade80, 0xf472b6, 0x38bdf8, 0xfbbf24]

interface Spectator {
  local: THREE.Vector3
  phase: number
}

interface Stand {
  group: THREE.Group
  platform: THREE.Mesh
  headsMesh: THREE.InstancedMesh
  bodiesMesh: THREE.InstancedMesh
  spectators: Spectator[]
  flags: THREE.Mesh[]
}

function seeded(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function createCrowd(): Crowd {
  const group = new THREE.Group()
  let disposeBag: (() => void)[] = []
  const confetti = new ParticlePool()
  group.add(confetti.points)

  let stands: Stand[] = []
  let reactPhase: 'idle' | 'cheer' | 'groan' = 'idle'
  let reactT = 0
  const CHEER_DUR = 2.5
  const GROAN_DUR = 1.5

  function clearAll(): void {
    for (const fn of disposeBag) fn()
    disposeBag = []
    // Keep the confetti points object across rebuilds (it is added to `group` once, outside clear()).
    for (const s of stands) group.remove(s.group)
    stands = []
  }

  function buildStand(rowCount: number, cols: number, side: 1 | -1, rand: () => number): Stand {
    const standGroup = new THREE.Group()

    // A gently curved bleacher platform: a wide, shallow box segment.
    const platformGeo = new THREE.CylinderGeometry(3.2, 3.2, 0.15, 24, 1, false, -0.5, 1)
    const platformMat = new THREE.MeshStandardMaterial({ color: 0x4f46e5, roughness: 0.6, metalness: 0.2, emissive: 0x312e81, emissiveIntensity: 0.5 })
    const platform = new THREE.Mesh(platformGeo, platformMat)
    platform.rotation.z = Math.PI / 2
    platform.rotation.y = Math.PI / 2
    standGroup.add(platform)
    disposeBag.push(() => {
      platformGeo.dispose()
      platformMat.dispose()
    })

    const headGeo = new THREE.SphereGeometry(0.09, 8, 6)
    const headMat = // instanceColor tints each spectator. vertexColors would read a missing attribute and go black.
    new THREE.MeshStandardMaterial({ roughness: 0.55, emissive: 0x14532d, emissiveIntensity: 0.35 })
    const bodyGeo = new THREE.CapsuleGeometry(0.06, 0.12, 2, 6)
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6d28d9, roughness: 0.7, emissive: 0x2e1065, emissiveIntensity: 0.4 })
    disposeBag.push(() => {
      headGeo.dispose()
      headMat.dispose()
      bodyGeo.dispose()
      bodyMat.dispose()
    })

    const total = rowCount * cols
    const headsMesh = new THREE.InstancedMesh(headGeo, headMat, total)
    const bodiesMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, total)
    headsMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3)
    const spectators: Spectator[] = []
    const color = new THREE.Color()
    let idx = 0
    for (let row = 0; row < rowCount; row++) {
      for (let col = 0; col < cols; col++) {
        const u = cols === 1 ? 0.5 : col / (cols - 1)
        const localX = (u - 0.5) * 2.6
        const localY = 0.15 + row * 0.22
        const localZ = side * (row * 0.16 - 0.3)
        spectators.push({ local: new THREE.Vector3(localX, localY, localZ), phase: rand() * Math.PI * 2 })
        color.setHex(HEAD_COLORS[Math.floor(rand() * HEAD_COLORS.length)])
        headsMesh.instanceColor.setXYZ(idx, color.r, color.g, color.b)
        idx++
      }
    }
    headsMesh.instanceColor.needsUpdate = true
    standGroup.add(headsMesh, bodiesMesh)

    // A couple of little pennant flags at the ends of the platform.
    const flags: THREE.Mesh[] = []
    const flagGeo = new THREE.ConeGeometry(0.05, 0.18, 3)
    const flagMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 })
    disposeBag.push(() => {
      flagGeo.dispose()
      flagMat.dispose()
    })
    for (const fx of [-1.5, 1.5]) {
      const flag = new THREE.Mesh(flagGeo, flagMat)
      flag.position.set(fx, 0.4, side * -0.35)
      flag.rotation.z = Math.PI
      standGroup.add(flag)
      flags.push(flag)
    }

    return { group: standGroup, platform, headsMesh, bodiesMesh, spectators, flags }
  }

  function build(level: Level, options: CrowdOptions): void {
    clearAll()
    const edge = pickCrowdEdge(level)
    const rand = seeded(Math.floor((edge.a.x + edge.b.y) * 1000) + 11)
    const rows = options.lowPerf ? 2 : 3
    const cols = 6

    // Local +X in buildStand's spectator layout should run along the edge's tangent.
    const tx = edge.b.x - edge.a.x
    const ty = edge.b.y - edge.a.y
    const rotY = Math.atan2(-ty, tx)
    const standOffset = 1.5

    const left = buildStand(rows, cols, 1, rand)
    const leftU = 0.28
    left.group.position.set(
      edge.a.x + tx * leftU + edge.normal.x * standOffset,
      0,
      edge.a.y + ty * leftU + edge.normal.y * standOffset,
    )
    left.group.rotation.y = rotY
    group.add(left.group)

    const right = buildStand(rows, cols, -1, rand)
    const rightU = 0.72
    right.group.position.set(
      edge.a.x + tx * rightU + edge.normal.x * standOffset,
      0,
      edge.a.y + ty * rightU + edge.normal.y * standOffset,
    )
    right.group.rotation.y = rotY
    group.add(right.group)

    stands = [left, right]

    // Rest each stand on the sheet's local height at its position (they float just above it).
    for (const stand of stands) {
      const depth = wellDepthAt(level, stand.group.position.x, stand.group.position.z, 0)
      stand.group.position.y = -depth + 1.1
    }
  }

  function react(kind: 'cheer' | 'groan'): void {
    reactPhase = kind === 'cheer' ? 'cheer' : 'groan'
    reactT = 0
    if (kind === 'cheer') {
      for (const stand of stands) {
        const world = new THREE.Vector3()
        stand.group.getWorldPosition(world)
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2
          confetti.spawn(
            world.x + (Math.random() - 0.5) * 2,
            world.y + 0.6,
            world.z + (Math.random() - 0.5) * 1,
            Math.cos(a) * 0.6,
            0.8 + Math.random() * 1.2,
            Math.sin(a) * 0.6,
            new THREE.Color(Math.random() > 0.5 ? 0xfacc15 : 0x4ade80),
            0.07,
            1.1,
            { drag: 0.5, gravity: 1.2 },
          )
        }
      }
    }
  }

  const tmpMatrix = new THREE.Matrix4()
  const tmpPos = new THREE.Vector3()
  const tmpQuat = new THREE.Quaternion()
  const tmpScale = new THREE.Vector3(1, 1, 1)
  const tmpLocalTarget = new THREE.Vector3()

  function updateStand(stand: Stand, _dt: number, elapsed: number, reducedMotion: boolean, ballWorld: THREE.Vector3 | null): void {
    const speed = reducedMotion ? 0.1 : 1
    let watchLocal: THREE.Vector3 | null = null
    if (ballWorld) {
      tmpLocalTarget.copy(ballWorld)
      stand.group.worldToLocal(tmpLocalTarget)
      watchLocal = tmpLocalTarget
    }

    for (let i = 0; i < stand.spectators.length; i++) {
      const sp = stand.spectators[i]
      let bob = Math.sin(elapsed * 2 + sp.phase) * 0.02
      let jump = 0
      let lean = 0
      if (reactPhase === 'cheer') {
        jump = Math.abs(Math.sin((reactT + sp.phase) * 8)) * 0.22
      } else if (reactPhase === 'groan') {
        bob = 0
        lean = -0.3 * Math.min(1, reactT / 0.3) + Math.sin(elapsed * 3 + sp.phase) * 0.05
      }
      tmpPos.set(sp.local.x, sp.local.y + bob + jump, sp.local.z)
      let yaw = 0
      if (watchLocal && reactPhase === 'idle') {
        yaw = Math.atan2(watchLocal.x - tmpPos.x, watchLocal.z - tmpPos.z)
      }
      tmpQuat.setFromEuler(new THREE.Euler(lean, yaw, 0))
      tmpScale.setScalar(1)
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
      stand.headsMesh.setMatrixAt(i, tmpMatrix)
      tmpPos.y -= 0.14
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
      stand.bodiesMesh.setMatrixAt(i, tmpMatrix)
    }
    stand.headsMesh.instanceMatrix.needsUpdate = true
    stand.bodiesMesh.instanceMatrix.needsUpdate = true
    for (const flag of stand.flags) flag.rotation.y = Math.sin(elapsed * 2 + flag.position.x) * (reducedMotion ? 0.05 : 0.25) * speed
  }

  function update(dt: number, elapsed: number, reducedMotion: boolean, ballWorld: THREE.Vector3 | null): void {
    if (reactPhase !== 'idle') {
      reactT += dt
      const dur = reactPhase === 'cheer' ? CHEER_DUR : GROAN_DUR
      if (reactT >= dur) reactPhase = 'idle'
    }
    for (const stand of stands) updateStand(stand, dt, elapsed, reducedMotion, ballWorld)
    confetti.update(dt)
  }

  function dispose(): void {
    clearAll()
    confetti.dispose()
  }

  return { group, build, update, react, dispose }
}
