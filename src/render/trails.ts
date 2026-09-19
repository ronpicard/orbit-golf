import * as THREE from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'

/** Probe trails as fat lines (three/addons/lines), so they read as thick glowing curves at any zoom. */

const MAX_SEGMENTS = 6000
export const MAX_GHOSTS = 14
const TRAIL_Y = 0.02
const ACTIVE_COLOR = 0x7dd3fc
const GOAL_COLOR = 0x34d399
const MISS_COLOR = 0xa78bfa

/** The trail currently being drawn for the flight in progress. */
export class ActiveTrail {
  readonly line: LineSegments2
  private readonly geometry: LineSegmentsGeometry
  private readonly material: LineMaterial
  private readonly array: Float32Array
  private count = 0
  private lastPoint: THREE.Vector3 | null = null

  constructor(resolution: THREE.Vector2) {
    this.array = new Float32Array(MAX_SEGMENTS * 6)
    this.geometry = new LineSegmentsGeometry()
    this.geometry.setPositions(this.array)
    this.geometry.instanceCount = 0
    this.material = new LineMaterial({
      color: ACTIVE_COLOR,
      linewidth: 3,
      worldUnits: false,
      transparent: true,
      opacity: 1,
      resolution,
    })
    this.line = new LineSegments2(this.geometry, this.material)
    this.line.position.y = TRAIL_Y
    this.line.frustumCulled = false
  }

  /** Clears the trail so a new flight starts from nothing. */
  reset(): void {
    this.count = 0
    this.geometry.instanceCount = 0
    this.lastPoint = null
  }

  /** Appends one segment from the last recorded point to `p` (physics-plane point, y is world-z). */
  addPoint(x: number, z: number): void {
    const p = new THREE.Vector3(x, 0, z)
    if (!this.lastPoint) {
      this.lastPoint = p
      return
    }
    if (this.count < MAX_SEGMENTS) {
      const interleaved = this.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute
      const data = interleaved.data
      const arr = data.array as Float32Array
      const i = this.count * 6
      arr[i] = this.lastPoint.x
      arr[i + 1] = this.lastPoint.y
      arr[i + 2] = this.lastPoint.z
      arr[i + 3] = p.x
      arr[i + 4] = p.y
      arr[i + 5] = p.z
      data.needsUpdate = true
      this.count++
      this.geometry.instanceCount = this.count
    }
    this.lastPoint = p
  }

  setResolution(width: number, height: number): void {
    this.material.resolution.set(width, height)
  }

  hasSegments(): boolean {
    return this.count > 0
  }

  /** Snapshots the current path into a standalone, disposable ghost line. */
  toGhost(outcome: 'goal' | 'other'): GhostTrail {
    const positions = new Float32Array(this.count * 6)
    const interleaved = this.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute
    positions.set((interleaved.data.array as Float32Array).subarray(0, this.count * 6))
    return new GhostTrail(positions, outcome)
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

/** A frozen, faded trail left behind by a completed flight. */
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
      opacity: 0.5,
      resolution: new THREE.Vector2(1, 1),
    })
    this.line = new LineSegments2(this.geometry, this.material)
    this.line.position.y = TRAIL_Y
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
