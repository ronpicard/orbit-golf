import * as THREE from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { COLOR_GHOST_GOAL, COLOR_GHOST_MISS } from './palette.ts'

/**
 * Probe trails as fat lines (three/addons/lines), so they read as thick glowing curves at any zoom.
 * Every point carries its true world y (the sheet height at that spot), so the trail visibly follows
 * the rubber sheet in 3D instead of lying flat.
 */

const MAX_SEGMENTS = 6000
export const MAX_GHOSTS = 14
/** How many of the most recent segments get the bright "comet head" treatment. */
const HEAD_SEGMENTS = 160
const ACTIVE_COLOR = 0x7dd3fc
const HEAD_COLOR = 0xf0fbff
const GOAL_COLOR = new THREE.Color(COLOR_GHOST_GOAL).getHex()
const MISS_COLOR = new THREE.Color(COLOR_GHOST_MISS).getHex()

/** The trail currently being drawn for the flight in progress: a dim full tail plus a bright head. */
export class ActiveTrail {
  readonly group: THREE.Group
  private readonly tailLine: LineSegments2
  private readonly tailGeometry: LineSegmentsGeometry
  private readonly tailMaterial: LineMaterial
  private readonly tailArray: Float32Array
  private tailCount = 0

  private readonly headLine: LineSegments2
  private readonly headGeometry: LineSegmentsGeometry
  private readonly headMaterial: LineMaterial
  private readonly headArray: Float32Array
  /** Ring buffer of the last HEAD_SEGMENTS+1 points (world space), used to rebuild the head segments. */
  private readonly headPoints: THREE.Vector3[] = []

  private lastPoint: THREE.Vector3 | null = null

  constructor(resolution: THREE.Vector2) {
    this.tailArray = new Float32Array(MAX_SEGMENTS * 6)
    this.tailGeometry = new LineSegmentsGeometry()
    this.tailGeometry.setPositions(this.tailArray)
    this.tailGeometry.instanceCount = 0
    this.tailMaterial = new LineMaterial({
      color: ACTIVE_COLOR,
      linewidth: 2.5,
      worldUnits: false,
      transparent: true,
      opacity: 0.4,
      resolution,
    })
    this.tailLine = new LineSegments2(this.tailGeometry, this.tailMaterial)
    this.tailLine.frustumCulled = false

    this.headArray = new Float32Array(HEAD_SEGMENTS * 6)
    this.headGeometry = new LineSegmentsGeometry()
    this.headGeometry.setPositions(this.headArray)
    this.headGeometry.instanceCount = 0
    this.headMaterial = new LineMaterial({
      color: HEAD_COLOR,
      linewidth: 4,
      worldUnits: false,
      transparent: true,
      opacity: 0.95,
      resolution,
    })
    this.headLine = new LineSegments2(this.headGeometry, this.headMaterial)
    this.headLine.frustumCulled = false

    this.group = new THREE.Group()
    this.group.add(this.tailLine, this.headLine)
  }

  /** Clears the trail so a new flight starts from nothing. */
  reset(): void {
    this.tailCount = 0
    this.tailGeometry.instanceCount = 0
    this.headGeometry.instanceCount = 0
    this.headPoints.length = 0
    this.lastPoint = null
  }

  /** Appends one segment from the last recorded point to (x, y, z) - y is the sheet height at that point. */
  addPoint(x: number, y: number, z: number): void {
    const p = new THREE.Vector3(x, y, z)
    if (!this.lastPoint) {
      this.lastPoint = p
      this.headPoints.push(p)
      return
    }
    if (this.tailCount < MAX_SEGMENTS) {
      const interleaved = this.tailGeometry.attributes.instanceStart as THREE.InterleavedBufferAttribute
      const data = interleaved.data
      const arr = data.array as Float32Array
      const i = this.tailCount * 6
      arr[i] = this.lastPoint.x
      arr[i + 1] = this.lastPoint.y
      arr[i + 2] = this.lastPoint.z
      arr[i + 3] = p.x
      arr[i + 4] = p.y
      arr[i + 5] = p.z
      data.needsUpdate = true
      this.tailCount++
      this.tailGeometry.instanceCount = this.tailCount
    }
    this.lastPoint = p
    this.headPoints.push(p)
    if (this.headPoints.length > HEAD_SEGMENTS + 1) this.headPoints.shift()
    this.rebuildHead()
  }

  private rebuildHead(): void {
    const segCount = Math.min(HEAD_SEGMENTS, this.headPoints.length - 1)
    const interleaved = this.headGeometry.attributes.instanceStart as THREE.InterleavedBufferAttribute
    const arr = interleaved.data.array as Float32Array
    for (let s = 0; s < segCount; s++) {
      const a = this.headPoints[s]
      const b = this.headPoints[s + 1]
      const i = s * 6
      arr[i] = a.x
      arr[i + 1] = a.y
      arr[i + 2] = a.z
      arr[i + 3] = b.x
      arr[i + 4] = b.y
      arr[i + 5] = b.z
    }
    interleaved.data.needsUpdate = true
    this.headGeometry.instanceCount = segCount
  }

  setResolution(width: number, height: number): void {
    this.tailMaterial.resolution.set(width, height)
    this.headMaterial.resolution.set(width, height)
  }

  hasSegments(): boolean {
    return this.tailCount > 0
  }

  /** Snapshots the current tail into a standalone, disposable ghost line. */
  toGhost(outcome: 'goal' | 'other'): GhostTrail {
    const positions = new Float32Array(this.tailCount * 6)
    const interleaved = this.tailGeometry.attributes.instanceStart as THREE.InterleavedBufferAttribute
    positions.set((interleaved.data.array as Float32Array).subarray(0, this.tailCount * 6))
    return new GhostTrail(positions, outcome)
  }

  dispose(): void {
    this.tailGeometry.dispose()
    this.tailMaterial.dispose()
    this.headGeometry.dispose()
    this.headMaterial.dispose()
  }
}

/** A frozen, faded trail left behind by a completed flight: soft white-lilac, or mint for a win. */
export class GhostTrail {
  readonly line: LineSegments2
  private readonly geometry: LineSegmentsGeometry
  private readonly material: LineMaterial

  constructor(positions: Float32Array, outcome: 'goal' | 'other') {
    this.geometry = new LineSegmentsGeometry()
    if (positions.length > 0) this.geometry.setPositions(positions)
    this.material = new LineMaterial({
      color: outcome === 'goal' ? GOAL_COLOR : MISS_COLOR,
      linewidth: 3,
      worldUnits: false,
      transparent: true,
      opacity: outcome === 'goal' ? 0.85 : 0.45,
      resolution: new THREE.Vector2(1, 1),
    })
    this.line = new LineSegments2(this.geometry, this.material)
    this.line.frustumCulled = false
  }

  setResolution(width: number, height: number): void {
    this.material.resolution.set(width, height)
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

/** Keeps at most MAX_GHOSTS ghost trails in a scene, disposing the oldest as new ones arrive. */
export class GhostTrailPool {
  private readonly ghosts: GhostTrail[] = []
  private readonly scene: THREE.Scene
  private width = 1
  private height = 1

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  add(ghost: GhostTrail): void {
    // A new ghost starts with a placeholder resolution; without the real one its width is wrong.
    ghost.setResolution(this.width, this.height)
    this.scene.add(ghost.line)
    this.ghosts.push(ghost)
    while (this.ghosts.length > MAX_GHOSTS) {
      const oldest = this.ghosts.shift()
      if (oldest) {
        this.scene.remove(oldest.line)
        oldest.dispose()
      }
    }
  }

  setResolution(width: number, height: number): void {
    this.width = width
    this.height = height
    for (const g of this.ghosts) g.setResolution(width, height)
  }

  clear(): void {
    for (const g of this.ghosts) {
      this.scene.remove(g.line)
      g.dispose()
    }
    this.ghosts.length = 0
  }
}
