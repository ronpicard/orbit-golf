import * as THREE from 'three'
import type { Level, Saucer, Vec2, Wormhole } from '../game/types.ts'
import { saucerPosition } from '../game/physics.ts'
import { wellDepthAt } from './sheet.ts'

/**
 * Visuals for the two moving hazards that don't fit the gravity-well model: wormhole mouths and
 * patrolling saucers. Positions are always driven by the course clock, never by a shot's own
 * elapsed time, so these hazards keep moving while the player aims and during post-shot phases.
 */

/** Cycled per wormhole pair so linked mouths read as the same colour. */
const WORMHOLE_COLORS = [0xa78bfa, 0x22d3ee, 0xf472b6] as const

export function wormholeColor(index: number): number {
  return WORMHOLE_COLORS[index % WORMHOLE_COLORS.length]
}

/** Swirling additive spiral, used for the flat portal disc lying on the sheet. */
function createPortalMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform vec3 uColor;
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        float a = atan(c.y, c.x);
        float swirl = sin(a * 5.0 - uTime * 3.5 + r * 8.0) * 0.5 + 0.5;
        float core = smoothstep(1.0, 0.0, r);
        float rim = smoothstep(1.0, 0.8, r);
        float alpha = clamp(swirl * core * 1.3, 0.0, 1.0) * rim;
        gl_FragColor = vec4(uColor * (0.55 + swirl * 0.85), alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

interface Mouth {
  group: THREE.Group
  disc: THREE.Mesh
  discGeometry: THREE.CircleGeometry
  discMaterial: THREE.ShaderMaterial
  ring: THREE.Mesh
  ringGeometry: THREE.TorusGeometry
  ringMaterial: THREE.MeshBasicMaterial
  pos: Vec2
  spin: number
}

function buildMouth(pos: Vec2, radius: number, color: number, spin: number, lowPerf: boolean): Mouth {
  const group = new THREE.Group()
  const segs = lowPerf ? 24 : 48

  const discGeometry = new THREE.CircleGeometry(radius, segs)
  const discMaterial = createPortalMaterial(color)
  const disc = new THREE.Mesh(discGeometry, discMaterial)
  disc.rotation.x = -Math.PI / 2
  disc.renderOrder = 10
  group.add(disc)

  const ringGeometry = new THREE.TorusGeometry(radius * 1.03, Math.max(0.02, radius * 0.07), 8, segs)
  const ringMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const ring = new THREE.Mesh(ringGeometry, ringMaterial)
  ring.rotation.x = -Math.PI / 2
  ring.renderOrder = 10
  group.add(ring)

  return { group, disc, discGeometry, discMaterial, ring, ringGeometry, ringMaterial, pos, spin }
}

function positionMouth(mouth: Mouth, level: Level, t: number): void {
  const depth = wellDepthAt(level, mouth.pos.x, mouth.pos.y, t)
  mouth.group.position.set(mouth.pos.x, -depth + 0.04, mouth.pos.y)
}

function disposeMouth(mouth: Mouth): void {
  mouth.discGeometry.dispose()
  mouth.discMaterial.dispose()
  mouth.ringGeometry.dispose()
  mouth.ringMaterial.dispose()
}

export interface WormholeVisual {
  group: THREE.Group
  color: number
  mouthAPos: Vec2
  mouthBPos: Vec2
  update(level: Level, t: number, elapsed: number): void
  dispose(): void
}

/** Both mouths of a linked pair, colour-matched so the player can see which two go together. */
export function buildWormholeVisual(wormhole: Wormhole, colorIndex: number, lowPerf: boolean): WormholeVisual {
  const group = new THREE.Group()
  const color = wormholeColor(colorIndex)
  const mouthA = buildMouth(wormhole.a, wormhole.radius, color, 0.4, lowPerf)
  const mouthB = buildMouth(wormhole.b, wormhole.radius, color, -0.4, lowPerf)
  group.add(mouthA.group, mouthB.group)

  return {
    group,
    color,
    mouthAPos: wormhole.a,
    mouthBPos: wormhole.b,
    update(level, t, elapsed) {
      positionMouth(mouthA, level, t)
      positionMouth(mouthB, level, t)
      mouthA.discMaterial.uniforms.uTime.value = elapsed
      mouthB.discMaterial.uniforms.uTime.value = elapsed
      mouthA.disc.rotation.z = elapsed * mouthA.spin
      mouthB.disc.rotation.z = elapsed * mouthB.spin
      mouthA.ring.rotation.z = -elapsed * mouthA.spin * 0.5
      mouthB.ring.rotation.z = -elapsed * mouthB.spin * 0.5
    },
    dispose() {
      disposeMouth(mouthA)
      disposeMouth(mouthB)
    },
  }
}

// --- Saucers -----------------------------------------------------------------------------------

const SAUCER_HOVER = 2.4

/** World position of a saucer's hull, hovering above the sheet at its current course-clock position. */
export function saucerHoverPos(level: Level, saucer: Saucer, t: number): THREE.Vector3 {
  const p = saucerPosition(saucer, t)
  const depth = wellDepthAt(level, p.x, p.y, t)
  return new THREE.Vector3(p.x, -depth + SAUCER_HOVER, p.y)
}

export interface SaucerVisual {
  group: THREE.Group
  update(level: Level, t: number, dt: number, elapsed: number): void
  /** 0..1: how bright/opaque the tractor beam looks. Used for the abduction animation. */
  setBeamBright(k: number): void
  worldPos(level: Level, t: number): THREE.Vector3
  dispose(): void
}

/** A hovering alien saucer with a green scanning tractor beam and a matching ring on the ground. */
export function buildSaucerVisual(saucer: Saucer, lowPerf: boolean): SaucerVisual {
  const group = new THREE.Group()
  const segs = lowPerf ? 12 : 24

  const hullGeometry = new THREE.SphereGeometry(saucer.radius * 0.45, segs, Math.max(6, Math.floor(segs / 2)))
  hullGeometry.scale(1, 0.32, 1)
  const hullMaterial = new THREE.MeshStandardMaterial({ color: 0xaeb8c8, metalness: 0.8, roughness: 0.25 })
  const hull = new THREE.Mesh(hullGeometry, hullMaterial)
  group.add(hull)

  const domeGeometry = new THREE.SphereGeometry(
    saucer.radius * 0.22,
    segs,
    Math.max(6, Math.floor(segs / 2)),
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.5,
  )
  const domeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x86efac,
    transparent: true,
    opacity: 0.55,
    roughness: 0.1,
    transmission: 0.3,
    emissive: 0x22c55e,
    emissiveIntensity: 0.2,
  })
  const dome = new THREE.Mesh(domeGeometry, domeMaterial)
  dome.position.y = saucer.radius * 0.12
  group.add(dome)

  const lightCount = lowPerf ? 6 : 10
  const lightGeometry = new THREE.SphereGeometry(Math.max(0.02, saucer.radius * 0.05), 6, 6)
  const lightMaterial = new THREE.MeshStandardMaterial({ color: 0xfff2a8, emissive: 0xfff2a8, emissiveIntensity: 1.2 })
  const lights = new THREE.InstancedMesh(lightGeometry, lightMaterial, lightCount)
  const m4 = new THREE.Matrix4()
  for (let i = 0; i < lightCount; i++) {
    const a = (i / lightCount) * Math.PI * 2
    m4.makeTranslation(Math.cos(a) * saucer.radius * 0.42, 0, Math.sin(a) * saucer.radius * 0.42)
    lights.setMatrixAt(i, m4)
  }
  group.add(lights)

  const beamGeometry = new THREE.CylinderGeometry(0.25, saucer.radius, 1, Math.max(8, Math.floor(segs / 2)), 1, true)
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0x4ade80,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const beam = new THREE.Mesh(beamGeometry, beamMaterial)
  group.add(beam)

  const scanGeometry = new THREE.RingGeometry(Math.max(0.05, saucer.radius * 0.05), saucer.radius, lowPerf ? 24 : 48)
  const scanMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x4ade80) } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform vec3 uColor;
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        float a = atan(c.y, c.x);
        float sweep = smoothstep(0.35, 0.0, abs(mod(a - uTime * 2.0, 6.28318) - 3.14159));
        float pulse = 0.32 + 0.22 * sin(uTime * 3.0);
        float alpha = clamp(pulse + sweep * 0.6, 0.0, 1.0) * smoothstep(1.0, 0.85, r);
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const scan = new THREE.Mesh(scanGeometry, scanMaterial)
  scan.rotation.x = -Math.PI / 2
  scan.renderOrder = 10
  group.add(scan)

  let beamBright = 0
  const seed = saucer.pos.x * 3.1 + saucer.pos.y * 1.7

  return {
    group,
    update(level, t, dt, elapsed) {
      const pos = saucerHoverPos(level, saucer, t)
      const bob = Math.sin(elapsed * 1.6 + seed) * 0.12
      const wobble = Math.sin(elapsed * 0.9 + seed) * 0.05
      group.position.set(pos.x, pos.y + bob, pos.z)
      group.rotation.z = wobble
      hull.rotation.y += dt * 0.4
      lights.rotation.y -= dt * 0.6

      const groundDepth = wellDepthAt(level, pos.x, pos.z, t)
      const groundY = -groundDepth
      const beamHeight = Math.max(0.1, group.position.y - groundY)
      beam.scale.y = beamHeight
      beam.position.y = -beamHeight / 2
      beamMaterial.opacity = 0.1 + beamBright * 0.6

      scan.position.set(pos.x, groundY + 0.045, pos.z)
      scanMaterial.uniforms.uTime.value = elapsed
    },
    setBeamBright(k) {
      beamBright = k
    },
    worldPos(level, t) {
      return saucerHoverPos(level, saucer, t)
    },
    dispose() {
      hullGeometry.dispose()
      hullMaterial.dispose()
      domeGeometry.dispose()
      domeMaterial.dispose()
      lightGeometry.dispose()
      lightMaterial.dispose()
      beamGeometry.dispose()
      beamMaterial.dispose()
      scanGeometry.dispose()
      scanMaterial.dispose()
    },
  }
}
