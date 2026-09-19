import * as THREE from 'three'

/**
 * One pooled, additive THREE.Points system shared by every particle effect (probe sparks, crash
 * debris, goal bursts, black-hole spiral, portal draw-in). A fixed-capacity ring buffer keeps the
 * cost constant regardless of how many effects are alive at once.
 */
const CAPACITY = 1500

interface Slot {
  vx: number
  vy: number
  vz: number
  life: number
  maxLife: number
  drag: number
  gravity: number
}

export class ParticlePool {
  readonly points: THREE.Points
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.ShaderMaterial
  private readonly positions: Float32Array
  private readonly colors: Float32Array
  private readonly sizes: Float32Array
  private readonly life01: Float32Array
  private readonly slots: Slot[]
  private cursor = 0

  constructor() {
    this.positions = new Float32Array(CAPACITY * 3)
    this.colors = new Float32Array(CAPACITY * 3)
    this.sizes = new Float32Array(CAPACITY)
    this.life01 = new Float32Array(CAPACITY)
    this.slots = new Array(CAPACITY)
    for (let i = 0; i < CAPACITY; i++) {
      this.slots[i] = { vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, drag: 0, gravity: 0 }
    }

    this.geometry = new THREE.BufferGeometry()
    // BufferAttribute shares these arrays; Float32BufferAttribute would copy them and freeze the GPU data.
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3))
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1))
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.life01, 1))

    this.material = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute float aSize;
        attribute float aLife;
        attribute vec3 aColor;
        varying float vLife;
        varying vec3 vColor;
        void main() {
          vLife = aLife;
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * (220.0 / max(-mv.z, 0.001)) * clamp(aLife, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        varying float vLife;
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d) * clamp(vLife, 0.0, 1.0);
          if (a <= 0.003) discard;
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
  }

  /** Spawns one particle at (x,y,z) with the given velocity, color, point size and lifetime (s). */
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: THREE.Color,
    size: number,
    life: number,
    opts?: { drag?: number; gravity?: number },
  ): void {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % CAPACITY
    const slot = this.slots[i]
    slot.vx = vx
    slot.vy = vy
    slot.vz = vz
    slot.life = life
    slot.maxLife = life
    slot.drag = opts?.drag ?? 0
    slot.gravity = opts?.gravity ?? 0
    this.positions[i * 3] = x
    this.positions[i * 3 + 1] = y
    this.positions[i * 3 + 2] = z
    this.colors[i * 3] = color.r
    this.colors[i * 3 + 1] = color.g
    this.colors[i * 3 + 2] = color.b
    this.sizes[i] = size
    this.life01[i] = 1
  }

  update(dt: number): void {
    let dirty = false
    for (let i = 0; i < CAPACITY; i++) {
      const slot = this.slots[i]
      if (slot.life <= 0) continue
      slot.life -= dt
      if (slot.life <= 0) {
        this.life01[i] = 0
        dirty = true
        continue
      }
      const drag = 1 - Math.min(1, slot.drag * dt)
      slot.vx *= drag
      slot.vy *= drag
      slot.vz *= drag
      slot.vy -= slot.gravity * dt
      this.positions[i * 3] += slot.vx * dt
      this.positions[i * 3 + 1] += slot.vy * dt
      this.positions[i * 3 + 2] += slot.vz * dt
      this.life01[i] = Math.max(0, slot.life / slot.maxLife)
      dirty = true
    }
    if (dirty) {
      ;(this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
      ;(this.geometry.attributes.aLife as THREE.BufferAttribute).needsUpdate = true
      // Spawns write colour and size too; flag them so new particles are not drawn with stale values.
      ;(this.geometry.attributes.aColor as THREE.BufferAttribute).needsUpdate = true
      ;(this.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true
    }
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
