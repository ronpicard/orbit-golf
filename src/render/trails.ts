import * as THREE from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'

/**
 * The bright "comet" tail trailing the ball while a stroke is in flight, as a fat line
 * (three/addons/lines) so it reads as a thick glowing curve at any zoom. Every point carries its
 * true world y (the sheet height at that spot), so the tail visibly follows the rubber sheet in 3D
 * instead of lying flat.
 *
 * Only the most recent TAIL_WINDOW_SECONDS of travel are kept - nothing older is drawn. When a
 * stroke ends or is aborted, call fadeOut() and keep calling update(dt) each frame; the tail fades
 * to nothing over FADE_DURATION and clears itself. Nothing from a finished stroke is ever left
 * behind on the course.
 */

/** Generous cap on segments kept, comfortably above what TAIL_WINDOW_SECONDS needs at the game's point rate. */
const MAX_HEAD_SEGMENTS = 128
const TAIL_WINDOW_SECONDS = 0.45
const FADE_DURATION = 0.25
const HEAD_COLOR = 0xf0fbff
const HEAD_OPACITY = 0.95

interface TrailPoint {
  x: number
  y: number
  z: number
  t: number
}

export class ActiveTrail {
  readonly group: THREE.Group
  private readonly headLine: LineSegments2
  private readonly headGeometry: LineSegmentsGeometry
  private readonly headMaterial: LineMaterial
  private readonly headArray: Float32Array
  /** Points still within the tail window (world space + the sim time they were recorded at). */
  private readonly points: TrailPoint[] = []
  private fading = false
  private fadeT = 0

  constructor(resolution: THREE.Vector2) {
    this.headArray = new Float32Array(MAX_HEAD_SEGMENTS * 6)
    this.headGeometry = new LineSegmentsGeometry()
    this.headGeometry.setPositions(this.headArray)
    this.headGeometry.instanceCount = 0
    this.headMaterial = new LineMaterial({
      color: HEAD_COLOR,
      linewidth: 4,
      worldUnits: false,
      transparent: true,
      opacity: HEAD_OPACITY,
      resolution,
    })
    this.headLine = new LineSegments2(this.headGeometry, this.headMaterial)
    this.headLine.frustumCulled = false

    this.group = new THREE.Group()
    this.group.add(this.headLine)
  }

  /** Clears the tail immediately, with no fade. Used when a new stroke starts or the tail is discarded. */
  reset(): void {
    this.points.length = 0
    this.headGeometry.instanceCount = 0
    this.fading = false
    this.fadeT = 0
    this.headMaterial.opacity = HEAD_OPACITY
  }

  /** Starts the fade-out; call update() every frame afterward until the tail clears itself. */
  fadeOut(): void {
    if (this.points.length === 0) {
      this.reset()
      return
    }
    this.fading = true
    this.fadeT = 0
  }

  /** Advances an in-progress fade-out. No-op otherwise. */
  update(dt: number): void {
    if (!this.fading) return
    this.fadeT += dt
    const k = Math.min(1, this.fadeT / FADE_DURATION)
    this.headMaterial.opacity = HEAD_OPACITY * (1 - k)
    if (k >= 1) this.reset()
  }

  /** Appends the ball's current position at simulation time t (seconds since this flight began). */
  addPoint(x: number, y: number, z: number, t: number): void {
    this.points.push({ x, y, z, t })
    while (this.points.length > 1 && t - this.points[0].t > TAIL_WINDOW_SECONDS) this.points.shift()
    if (this.points.length > MAX_HEAD_SEGMENTS + 1) this.points.splice(0, this.points.length - (MAX_HEAD_SEGMENTS + 1))
    this.rebuildHead()
  }

  private rebuildHead(): void {
    const segCount = Math.max(0, Math.min(MAX_HEAD_SEGMENTS, this.points.length - 1))
    const interleaved = this.headGeometry.attributes.instanceStart as THREE.InterleavedBufferAttribute
    const arr = interleaved.data.array as Float32Array
    for (let s = 0; s < segCount; s++) {
      const a = this.points[s]
      const b = this.points[s + 1]
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
    this.headMaterial.resolution.set(width, height)
  }

  hasSegments(): boolean {
    return this.points.length > 1
  }

  dispose(): void {
    this.headGeometry.dispose()
    this.headMaterial.dispose()
  }
}
