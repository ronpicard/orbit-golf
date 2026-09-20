import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

import type { Aim, BallState, Body, HazardKind, Level, Outcome, Rail, Saucer, ShotResult, Vec2 } from '../game/types.ts'
import {
  BALL_RADIUS,
  DT,
  MIN_POWER,
  bodyPosition,
  checkOutcome,
  clampAim,
  defaultAim,
  launchState,
  onFairway,
  predictPath,
  step,
  targetPosition,
} from '../game/physics.ts'
import type { EngineApi, EngineEvents, LoadOptions } from './engineApi.ts'
import {
  MAX_WELL_BODIES,
  createAccretionDiscMaterial,
  createAimRibbonMaterial,
  createAtmosphereMaterial,
  createBeamMaterial,
  createBumperMaterial,
  createCourseMaskTexture,
  createCupDiscMaterial,
  createCupRingMaterial,
  createFlagMaterial,
  createGateRingMaterial,
  createGlowTexture,
  createLensedHaloMaterial,
  createMoonMaterial,
  createNebulaSphere,
  createPhotonRingMaterial,
  createPlanetMaterial,
  createPostFxShader,
  createPredictionCurveMaterial,
  createPredictionDotsMaterial,
  createRingMaterial,
  createStarfield,
  createSunSprite,
  createWellMaterial,
} from './shaders.ts'
import { BLACKHOLE_DISC_SCALE, bodyHeight, sheetMass, wellDepthAt } from './sheet.ts'
import { ActiveTrail } from './trails.ts'
import { buildSaucerVisual, buildWormholeVisual, wormholeColor } from './hazards.ts'
import type { SaucerVisual, WormholeVisual } from './hazards.ts'
import { ParticlePool } from './particles.ts'
import { COLOR_AIM_HIGH, COLOR_AIM_LOW, COLOR_AIM_MID, COLOR_TEE } from './palette.ts'
import { ALIEN_BACKPACK_OFFSET, createAlienGolfer } from './alien.ts'
import type { AlienGolfer } from './alien.ts'
import { createBackdrop } from './backdrop.ts'
import type { Backdrop } from './backdrop.ts'
import { createCrowd } from './crowd.ts'
import type { Crowd } from './crowd.ts'

// --- Camera framing constants (chase camera, behind the ball looking along the aim direction) -----
const NDC_X_LIMIT = 0.9
const NDC_Y_MAX = 0.62
const CHASE_BACK_LANDSCAPE = 11
const CHASE_BACK_PORTRAIT = 14
const CHASE_LOOKAHEAD = 5.5
const CHASE_ELEVATION = THREE.MathUtils.degToRad(27)
const CHASE_FOV_LANDSCAPE = 50
const CHASE_FOV_PORTRAIT = 58
const CHASE_PULLBACK_MAX = 1.6
const CHASE_AHEAD_POINT = 9
const LIE_GLIDE_DURATION = 0.9
const CHASE_FOLLOW_LOOKAT_FRAC = 0.55
const IDLE_SWAY = THREE.MathUtils.degToRad(0.4)
const CRASH_SHAKE_DURATION = 0.35
const CRASH_SHAKE_MAX = 0.15
/** How long the chase camera follows the ball hard after a wormhole warp, to catch up quickly. */
const WARP_SNAP_DURATION = 0.4
/** Critically-damped spring time constant for the camera yaw following the aim angle. */
const CAMERA_YAW_TIME_CONSTANT = 0.12

const DRAG_THRESHOLD_PX = 8
const AIM_MIN_LENGTH = 1.2
const AIM_MAX_LENGTH = 6
const POWER_DRAG_DIVISOR = 0.34
const RIBBON_SAMPLES = 12
const RIBBON_HALF_WIDTH = 0.09
const PREDICT_SECONDS = 1.6
const PREDICT_STRIDE = 4
/** Radians of aim turn per full canvas width dragged horizontally. */
const TURN_RANGE = 2.4
/** Releasing a drag below this power is a "turn only" - it keeps the new angle but doesn't launch. */
const LAUNCH_POWER_THRESHOLD = 0.08
const POWER_BAR_WIDTH = 8
const POWER_BAR_MAX_HEIGHT = 90

// --- Post-shot outcome sequencing durations -------------------------------------------------------
const GOAL_SINK_DURATION = 0.35
const REST_WAIT_DURATION = 0.5
const REST_HOP_DURATION = 0.9
const HAZARD_FX_DURATION = 0.5
const HAZARD_BEAM_DURATION = 0.45
/** A 'rest' outcome this close to the cup gets a small crowd groan. */
const NEAR_MISS_DISTANCE = 1.2

// --- Course wall constants -------------------------------------------------------------------------
const WALL_THICK = 0.28
const WALL_HEIGHT = 0.55
/** Longest single piece of bumper wall, so walls can follow the curve of the sheet. */
const WALL_PIECE_LENGTH = 1.2
const ISLAND_HEIGHT = 0.55
const SKIRT_DROP = 1.0

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function hashStringToInt(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return h
}

/** Diagonal hazard-chevron stripes, generated once and shared by every island's inset plate. */
let chevronTexture: THREE.CanvasTexture | null = null
function getChevronTexture(): THREE.CanvasTexture {
  if (chevronTexture) return chevronTexture
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.strokeStyle = 'rgba(103, 232, 249, 0.9)'
    ctx.lineWidth = 10
    ctx.lineCap = 'round'
    for (let offset = -size; offset < size * 2; offset += 32) {
      ctx.beginPath()
      ctx.moveTo(offset, size + 10)
      ctx.lineTo(offset + size + 10, -10)
      ctx.stroke()
    }
  }
  chevronTexture = new THREE.CanvasTexture(canvas)
  chevronTexture.wrapS = THREE.RepeatWrapping
  chevronTexture.wrapT = THREE.RepeatWrapping
  return chevronTexture
}

/** Small deterministic PRNG so an asteroid's jitter is stable across rebuilds. */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Critically damped spring toward a target angle (shortest way around the circle), given the
 * current velocity state. `timeConstant` <= 0 snaps instantly (used for reduced motion).
 */
function smoothDampAngle(current: number, target: number, velocity: { v: number }, dt: number, timeConstant: number): number {
  if (timeConstant <= 1e-4 || dt <= 0) {
    velocity.v = 0
    return target
  }
  let delta = current - target
  delta = ((delta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
  const adjustedTarget = current - delta
  const omega = 2 / timeConstant
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const temp = (velocity.v + omega * delta) * dt
  velocity.v = (velocity.v - omega * temp) * exp
  return adjustedTarget + (delta + temp) * exp
}

/** Mixes the aim ribbon's low/mid/high power colors the same way the ribbon shader does. */
function powerRibbonColor(power: number): THREE.Color {
  const t1 = THREE.MathUtils.smoothstep(power, 0, 0.4)
  const t2 = THREE.MathUtils.smoothstep(power, 0.4, 0.75)
  const col = new THREE.Color(COLOR_AIM_LOW).lerp(new THREE.Color(COLOR_AIM_MID), t1)
  col.lerp(new THREE.Color(COLOR_AIM_HIGH), t2)
  return col
}

// --- Rail visuals: a faint circle showing a body/target's orbit, resting on the sheet -------------
interface RailVisual {
  line: THREE.Line
  update(level: Level, t: number): void
  dispose(): void
}

function buildRailVisual(rail: Rail | undefined, color: number): RailVisual | null {
  if (!rail) return null
  const segments = 96
  const xs = new Float32Array(segments + 1)
  const zs = new Float32Array(segments + 1)
  const positions = new Float32Array((segments + 1) * 3)
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    xs[i] = rail.center.x + Math.cos(a) * rail.radius
    zs[i] = rail.center.y + Math.sin(a) * rail.radius
    positions[i * 3] = xs[i]
    positions[i * 3 + 1] = 0
    positions[i * 3 + 2] = zs[i]
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.28 })
  const line = new THREE.Line(geometry, material)
  const posAttr = geometry.attributes.position as THREE.BufferAttribute
  return {
    line,
    update(level, t) {
      const arr = posAttr.array as Float32Array
      for (let i = 0; i < xs.length; i++) {
        arr[i * 3 + 1] = -wellDepthAt(level, xs[i], zs[i], t) + 0.03
      }
      posAttr.needsUpdate = true
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

// --- Body visual builders (hazards: planets, moons, black holes, asteroids) -----------------------

interface BodyVisual {
  group: THREE.Group
  update(level: Level, t: number, dt: number, elapsed: number): void
  dispose(): void
}

interface CupVisual {
  group: THREE.Group
  update(level: Level, t: number, dt: number, elapsed: number, flash: number, proximity: number): void
  dispose(): void
}

/** A short-lived, self-removing particle/flash effect. Returns false from update() when finished. */
interface Effect {
  update(dt: number): boolean
}

interface VisualCtx {
  particlePool: ParticlePool
}

function buildPlanetVisual(body: Body, _ctx: VisualCtx): BodyVisual {
  const group = new THREE.Group()
  const isMoon = body.kind === 'moon'

  const geometry = new THREE.SphereGeometry(body.radius, 48, 32)
  const material = isMoon ? createMoonMaterial() : createPlanetMaterial(body.palette)
  const mesh = new THREE.Mesh(geometry, material)
  group.add(mesh)

  let atmGeometry: THREE.SphereGeometry | null = null
  let atmMaterial: THREE.ShaderMaterial | null = null
  if (!isMoon) {
    atmGeometry = new THREE.SphereGeometry(body.radius * 1.18, 32, 24)
    atmMaterial = createAtmosphereMaterial(body.palette[0])
    group.add(new THREE.Mesh(atmGeometry, atmMaterial))
  }

  let ringGeometry: THREE.RingGeometry | null = null
  let ringMaterial: THREE.ShaderMaterial | null = null
  if (!isMoon && body.radius >= 1.3) {
    ringGeometry = new THREE.RingGeometry(body.radius * 1.5, body.radius * 2.4, 64, 1)
    ringMaterial = createRingMaterial()
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.x = -Math.PI / 2 + THREE.MathUtils.degToRad(20)
    group.add(ring)
  }

  const rail = buildRailVisual(body.rail, 0x8899aa)
  if (rail) group.add(rail.line)

  return {
    group,
    update(lvl, t, dt, elapsed) {
      const p = bodyPosition(body, t)
      const y = bodyHeight(lvl, body, t)
      group.position.set(p.x, y, p.y)
      mesh.rotation.y += dt * 0.06
      if (!isMoon) material.uniforms.uTime.value = elapsed
      rail?.update(lvl, t)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      atmGeometry?.dispose()
      atmMaterial?.dispose()
      ringGeometry?.dispose()
      ringMaterial?.dispose()
      rail?.dispose()
    },
  }
}

function buildBlackHoleVisual(body: Body, ctx: VisualCtx): BodyVisual {
  const group = new THREE.Group()

  const coreGeometry = new THREE.SphereGeometry(body.radius, 32, 24)
  const coreMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 })
  group.add(new THREE.Mesh(coreGeometry, coreMaterial))

  const discGeometry = new THREE.RingGeometry(body.radius * 1.5, body.radius * BLACKHOLE_DISC_SCALE, 96)
  const discMaterial = createAccretionDiscMaterial()
  const disc = new THREE.Mesh(discGeometry, discMaterial)
  disc.rotation.x = -Math.PI / 2
  group.add(disc)

  const photonGeometry = new THREE.RingGeometry(body.radius * 1.08, body.radius * 1.22, 64)
  const photonMaterial = createPhotonRingMaterial()
  const photon = new THREE.Mesh(photonGeometry, photonMaterial)
  photon.rotation.x = -Math.PI / 2
  group.add(photon)

  const haloGeometry = new THREE.PlaneGeometry(body.radius * 7, body.radius * 7)
  const haloMaterial = createLensedHaloMaterial()
  const halo = new THREE.Mesh(haloGeometry, haloMaterial)
  group.add(halo)

  const rail = buildRailVisual(body.rail, 0x8899aa)
  if (rail) group.add(rail.line)

  let spawnTimer = 0

  return {
    group,
    update(lvl, t, dt, elapsed) {
      const p = bodyPosition(body, t)
      const y = bodyHeight(lvl, body, t)
      group.position.set(p.x, y, p.y)
      disc.rotation.z += dt * 0.15
      discMaterial.uniforms.uTime.value = elapsed
      photonMaterial.uniforms.uTime.value = elapsed
      haloMaterial.uniforms.uTime.value = elapsed
      rail?.update(lvl, t)

      // ~80 particles spiralling inward along the funnel at any time (life ~1s, respawned continuously).
      spawnTimer -= dt
      if (spawnTimer <= 0) {
        spawnTimer = 0.0125
        const a = Math.random() * Math.PI * 2
        const r = body.radius * (2.5 + Math.random() * 2.5)
        const sx = group.position.x + Math.cos(a) * r
        const sz = group.position.z + Math.sin(a) * r
        const inward = 1.4
        const vx = -Math.cos(a) * inward + Math.sin(a) * 0.6
        const vz = -Math.sin(a) * inward - Math.cos(a) * 0.6
        ctx.particlePool.spawn(sx, group.position.y, sz, vx, 0.05, vz, new THREE.Color(0xffb877), 0.09, 0.9)
      }
    },
    dispose() {
      coreGeometry.dispose()
      coreMaterial.dispose()
      discGeometry.dispose()
      discMaterial.dispose()
      photonGeometry.dispose()
      photonMaterial.dispose()
      haloGeometry.dispose()
      haloMaterial.dispose()
      rail?.dispose()
    },
  }
}

function buildAsteroidVisual(body: Body): BodyVisual {
  const group = new THREE.Group()
  const geometry = new THREE.IcosahedronGeometry(body.radius, 1)
  const rand = seededRandom(hashStringToInt(body.id))
  const pos = geometry.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const jitter = 1 + (rand() - 0.5) * 0.3
    pos.setXYZ(i, pos.getX(i) * jitter, pos.getY(i) * jitter, pos.getZ(i) * jitter)
  }
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({ color: 0x8a7968, flatShading: true, roughness: 1 })
  const mesh = new THREE.Mesh(geometry, material)
  group.add(mesh)

  const spinAxis = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize()
  const rail = buildRailVisual(body.rail, 0x8899aa)
  if (rail) group.add(rail.line)

  return {
    group,
    update(lvl, t, dt) {
      const p = bodyPosition(body, t)
      const y = bodyHeight(lvl, body, t)
      group.position.set(p.x, y, p.y)
      mesh.rotateOnAxis(spinAxis, dt * 0.15)
      rail?.update(lvl, t)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      rail?.dispose()
    },
  }
}

function buildBodyVisual(body: Body, ctx: VisualCtx): BodyVisual {
  switch (body.kind) {
    case 'planet':
    case 'moon':
      return buildPlanetVisual(body, ctx)
    case 'blackhole':
      return buildBlackHoleVisual(body, ctx)
    case 'asteroid':
      return buildAsteroidVisual(body)
    default: {
      const exhaustive: never = body.kind
      throw new Error(`Unknown body kind: ${String(exhaustive)}`)
    }
  }
}

/** The tee marker: a glowing ring + a small pad on the green, sitting on the sheet at level.tee. */
interface TeeVisual {
  group: THREE.Group
  update(level: Level, t: number, elapsed: number): void
  dispose(): void
}

function buildTeeVisual(level: Level): TeeVisual {
  const group = new THREE.Group()
  const r = 0.55

  const ringGeometry = new THREE.RingGeometry(r * 1.3, r * 1.45, 48)
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: COLOR_TEE,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const ring = new THREE.Mesh(ringGeometry, ringMaterial)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.02
  group.add(ring)

  const padGeometry = new THREE.PlaneGeometry(r * 1.9, r * 1.9)
  const padMaterial = new THREE.MeshBasicMaterial({
    color: COLOR_TEE,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const pad = new THREE.Mesh(padGeometry, padMaterial)
  pad.rotation.x = -Math.PI / 2
  pad.position.y = 0.015
  group.add(pad)

  return {
    group,
    update(lvl, t, elapsed) {
      const depth = wellDepthAt(lvl, level.tee.x, level.tee.y, t)
      group.position.set(level.tee.x, -depth, level.tee.y)
      ringMaterial.opacity = 0.4 + 0.25 * Math.sin(elapsed * 2.2)
    },
    dispose() {
      ringGeometry.dispose()
      ringMaterial.dispose()
      padGeometry.dispose()
      padMaterial.dispose()
    },
  }
}

/** The cup: a recessed disc with a white rim, a swirling emerald glow, a flagstick and a faint beam. */
function buildCupVisual(level: Level, ctx: VisualCtx): CupVisual {
  const group = new THREE.Group()
  const radius = level.target.radius

  const glowGeometry = new THREE.CircleGeometry(radius * 0.6, 32)
  const glowMaterial = createGateRingMaterial()
  const glow = new THREE.Mesh(glowGeometry, glowMaterial)
  glow.rotation.x = -Math.PI / 2
  glow.position.y = 0.026
  group.add(glow)

  const beamHeight = 3.0
  const beamGeometry = new THREE.CylinderGeometry(radius * 0.4, radius * 0.4, beamHeight, 20, 1, true)
  const beamMaterial = createBeamMaterial()
  const beam = new THREE.Mesh(beamGeometry, beamMaterial)
  beam.position.y = beamHeight / 2
  group.add(beam)

  // Ground cup: reads like a real golf hole - white rim, dark centre - showing the true capture radius.
  const cupRingGeometry = new THREE.RingGeometry(radius * 0.72, radius * 0.94, 48)
  const cupRingMaterial = createCupRingMaterial()
  const cupRing = new THREE.Mesh(cupRingGeometry, cupRingMaterial)
  cupRing.rotation.x = -Math.PI / 2
  cupRing.position.y = 0.03
  group.add(cupRing)

  const cupDiscGeometry = new THREE.CircleGeometry(radius * 0.7, 32)
  const cupDiscMaterial = createCupDiscMaterial()
  const cupDisc = new THREE.Mesh(cupDiscGeometry, cupDiscMaterial)
  cupDisc.rotation.x = -Math.PI / 2
  cupDisc.position.y = 0.025
  group.add(cupDisc)

  // Flag pole + small waving triangular flag.
  const poleHeight = Math.max(1.2, radius * 1.6)
  const poleOffset = radius * 1.05
  const poleGeometry = new THREE.CylinderGeometry(0.02, 0.02, poleHeight, 8)
  const poleMaterial = new THREE.MeshBasicMaterial({ color: 0xf8fafc })
  const pole = new THREE.Mesh(poleGeometry, poleMaterial)
  pole.position.set(poleOffset, poleHeight / 2, 0)
  group.add(pole)

  const flagGeometry = new THREE.BufferGeometry()
  const flagPositions = new Float32Array([0, poleHeight - 0.02, 0, 0, poleHeight - 0.32, 0, 0.42, poleHeight - 0.17, 0])
  flagGeometry.setAttribute('position', new THREE.Float32BufferAttribute(flagPositions, 3))
  flagGeometry.setIndex([0, 1, 2])
  const flagMaterial = createFlagMaterial()
  const flag = new THREE.Mesh(flagGeometry, flagMaterial)
  flag.position.set(poleOffset, 0, 0)
  group.add(flag)

  const rail = buildRailVisual(level.target.rail, 0x6ee7b7)
  if (rail) group.add(rail.line)

  let drawInTimer = 0

  return {
    group,
    update(lvl, t, dt, elapsed, flash, proximity) {
      const p = targetPosition(lvl.target, t)
      const depth = wellDepthAt(lvl, p.x, p.y, t)
      group.position.set(p.x, -depth, p.y)
      glowMaterial.uniforms.uTime.value = elapsed
      glowMaterial.uniforms.uFlash.value = flash
      glowMaterial.uniforms.uProximity.value = proximity
      beamMaterial.uniforms.uTime.value = elapsed
      cupRingMaterial.uniforms.uTime.value = elapsed
      flagMaterial.uniforms.uTime.value = elapsed
      rail?.update(lvl, t)

      // ~20 particles drawn gently into the cup.
      drawInTimer -= dt
      if (drawInTimer <= 0) {
        drawInTimer = 0.05
        const a = Math.random() * Math.PI * 2
        const r = radius * (0.6 + Math.random() * 0.8)
        const sx = group.position.x + Math.cos(a) * r
        const sz = group.position.z + Math.sin(a) * r
        const sy = group.position.y + 0.3 + Math.random() * 1.0
        const vx = (group.position.x - sx) * 0.9
        const vz = (group.position.z - sz) * 0.9
        const vy = (group.position.y + 0.05 - sy) * 0.9
        ctx.particlePool.spawn(sx, sy, sz, vx, vy, vz, new THREE.Color(0x6ee7b7), 0.08, 1.1)
      }
    },
    dispose() {
      glowGeometry.dispose()
      glowMaterial.dispose()
      beamGeometry.dispose()
      beamMaterial.dispose()
      cupRingGeometry.dispose()
      cupRingMaterial.dispose()
      cupDiscGeometry.dispose()
      cupDiscMaterial.dispose()
      poleGeometry.dispose()
      poleMaterial.dispose()
      flagGeometry.dispose()
      flagMaterial.dispose()
      rail?.dispose()
    },
  }
}

interface WellVisual {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  geometry: THREE.PlaneGeometry
  maskTexture: THREE.CanvasTexture
  center: Vec2
}

/**
 * The fairway ground sheet: a patch masked to `level.course` minus `level.islands`, pushed down
 * into gravity funnels. Authored flat in XY then rotated -90 deg about X into XZ, so local (x, y)
 * maps to world (x, -depth, -y) relative to the mesh's own position; per-frame uniform updates
 * convert each body's physics position into this local space: localX = worldX - centerX,
 * localY = centerY - worldY.
 */
function buildWellMesh(level: Level): WellVisual {
  const b = level.bounds
  const halfX = (b.maxX - b.minX) / 2 + 1
  const halfY = (b.maxY - b.minY) / 2 + 1
  const geometry = new THREE.PlaneGeometry(halfX * 2, halfY * 2, 240, 240)
  const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
  const halfExtent = new THREE.Vector2(halfX, halfY)
  const maskTexture = createCourseMaskTexture(level, halfExtent, center)
  const material = createWellMaterial(maskTexture)
  ;(material.uniforms.uHalfExtent.value as THREE.Vector2).copy(halfExtent)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(center.x, 0, center.y)
  // The turf is nearly opaque but does not write depth. Draw it before every other transparent
  // object, or it paints over the aim ribbon, prediction, trails, and rings that lie on it.
  mesh.renderOrder = -10
  return { mesh, material, geometry, maskTexture, center }
}

/**
 * Neon bumper walls along every edge of the course and its islands (a box per segment plus a
 * corner post), filled raised island blocks, and a dark skirt hanging below the outer edge.
 */
interface CourseStructure {
  group: THREE.Group
  wallMaterial: THREE.ShaderMaterial
  dispose(): void
}

function buildCourseStructure(level: Level): CourseStructure {
  const group = new THREE.Group()
  const wallMaterial = createBumperMaterial()
  const disposables: Array<() => void> = []

  const segmentGeometry = new THREE.BoxGeometry(1, WALL_HEIGHT, WALL_THICK)
  const postGeometry = new THREE.CylinderGeometry(WALL_THICK * 0.55, WALL_THICK * 0.55, WALL_HEIGHT, 10)
  disposables.push(() => {
    segmentGeometry.dispose()
    postGeometry.dispose()
  })

  function addLoopWalls(loop: Vec2[]): void {
    const n = loop.length
    for (let i = 0; i < n; i++) {
      const a = loop[i]
      const b = loop[(i + 1) % n]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len < 1e-6) continue
      // Short pieces, each tilted to its own two ends, so a wall follows the sheet over a hill or
      // down into a well instead of floating above it or sinking under it.
      const pieces = Math.max(1, Math.ceil(len / WALL_PIECE_LENGTH))
      const yaw = Math.atan2(-(b.y - a.y), b.x - a.x)
      for (let k = 0; k < pieces; k++) {
        const u0 = k / pieces
        const u1 = (k + 1) / pieces
        const x0 = a.x + (b.x - a.x) * u0
        const z0 = a.y + (b.y - a.y) * u0
        const x1 = a.x + (b.x - a.x) * u1
        const z1 = a.y + (b.y - a.y) * u1
        const y0 = -wellDepthAt(level, x0, z0, 0)
        const y1 = -wellDepthAt(level, x1, z1, 0)
        const run = len / pieces
        const mesh = new THREE.Mesh(segmentGeometry, wallMaterial)
        // A hair of overlap hides the seams between tilted pieces.
        mesh.scale.set(Math.hypot(run, y1 - y0) + 0.02, 1, 1)
        mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2 + WALL_HEIGHT / 2, (z0 + z1) / 2)
        // rotation.y = angle maps local +X to world (cos, 0, -sin); align it to the edge tangent.
        // rotation.z is applied first, in the wall's own frame, and pitches it along the slope.
        mesh.rotation.set(0, yaw, Math.atan2(y1 - y0, run))
        group.add(mesh)
      }
    }
    for (const v of loop) {
      const depth = wellDepthAt(level, v.x, v.y, 0)
      const post = new THREE.Mesh(postGeometry, wallMaterial)
      post.position.set(v.x, -depth + WALL_HEIGHT / 2, v.y)
      group.add(post)
    }
  }

  addLoopWalls(level.course)
  for (const island of level.islands) addLoopWalls(island)

  // Islands: filled raised blocks that read as solid bumpers - lighter indigo body, neon edge, and
  // an inset plate with a hazard-chevron pattern so they don't read as blank dead squares.
  const islandTopMaterial = new THREE.MeshStandardMaterial({
    color: 0x3730a3,
    roughness: 0.75,
    metalness: 0.1,
    emissive: 0x312e81,
    emissiveIntensity: 0.7,
  })
  const islandEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.8 })
  const islandPlateMaterial = new THREE.MeshBasicMaterial({
    map: getChevronTexture(),
    color: 0x67e8f9,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  disposables.push(() => {
    islandTopMaterial.dispose()
    islandEdgeMaterial.dispose()
    islandPlateMaterial.dispose()
  })
  for (const island of level.islands) {
    if (island.length < 3) continue
    const shape = new THREE.Shape(island.map((p) => new THREE.Vector2(p.x, p.y)))
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: ISLAND_HEIGHT, bevelEnabled: false })
    let cx = 0
    let cy = 0
    for (const p of island) {
      cx += p.x
      cy += p.y
    }
    cx /= island.length
    cy /= island.length
    const depth = wellDepthAt(level, cx, cy, 0)
    const mesh = new THREE.Mesh(geometry, islandTopMaterial)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = -depth
    group.add(mesh)
    const edgesGeometry = new THREE.EdgesGeometry(geometry)
    const edges = new THREE.LineSegments(edgesGeometry, islandEdgeMaterial)
    edges.rotation.x = -Math.PI / 2
    edges.position.y = -depth
    group.add(edges)

    // Inset plate: an 80%-scale copy of the block's own footprint, chevron-striped, sitting just
    // above the top face - reads as a bumper's warning marking rather than a blank cap.
    const insetPoints = island.map((p) => new THREE.Vector2(cx + (p.x - cx) * 0.8, cy + (p.y - cy) * 0.8))
    const insetShape = new THREE.Shape(insetPoints)
    const insetGeometry = new THREE.ShapeGeometry(insetShape)
    const insetMesh = new THREE.Mesh(insetGeometry, islandPlateMaterial)
    insetMesh.rotation.x = -Math.PI / 2
    insetMesh.position.y = -depth + ISLAND_HEIGHT + 0.02
    group.add(insetMesh)

    disposables.push(() => {
      geometry.dispose()
      edgesGeometry.dispose()
      insetGeometry.dispose()
    })
  }

  // Skirt: a dark band hanging below the outer edge so the course reads as a floating slab.
  const skirtMaterial = new THREE.MeshBasicMaterial({ color: 0x0a0a14, side: THREE.DoubleSide })
  disposables.push(() => skirtMaterial.dispose())
  {
    const n = level.course.length
    const positions: number[] = []
    const indices: number[] = []
    for (let i = 0; i < n; i++) {
      const a = level.course[i]
      const b = level.course[(i + 1) % n]
      const ya = -wellDepthAt(level, a.x, a.y, 0)
      const yb = -wellDepthAt(level, b.x, b.y, 0)
      const base = positions.length / 3
      positions.push(a.x, ya, a.y, b.x, yb, b.y, b.x, yb - SKIRT_DROP, b.y, a.x, ya - SKIRT_DROP, a.y)
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    const skirtGeometry = new THREE.BufferGeometry()
    skirtGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3))
    skirtGeometry.setIndex(indices)
    skirtGeometry.computeVertexNormals()
    const skirt = new THREE.Mesh(skirtGeometry, skirtMaterial)
    group.add(skirt)
    disposables.push(() => skirtGeometry.dispose())
  }

  return {
    group,
    wallMaterial,
    dispose() {
      wallMaterial.dispose()
      for (const d of disposables) d()
    },
  }
}

export function createEngine(canvas: HTMLCanvasElement, events: EngineEvents): EngineApi {
  // --- Reduced motion --------------------------------------------------------------------------
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  let reducedMotion = reducedMotionQuery.matches
  const onReducedMotionChange = (e: MediaQueryListEvent): void => {
    reducedMotion = e.matches
  }
  reducedMotionQuery.addEventListener('change', onReducedMotionChange)

  const coarsePointerQuery = window.matchMedia('(pointer: coarse)')

  // --- Renderer / scene / composer ---------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x05040d, 1)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(CHASE_FOV_LANDSCAPE, 1, 0.1, 4000)

  const ambient = new THREE.AmbientLight(0xffffff, 0.35)
  const sun = new THREE.DirectionalLight(0xffffff, 1.15)
  sun.position.set(-0.6, 0.8, 0.35)
  scene.add(ambient, sun)

  // Soft fill light near the ball, on the camera's side, so the alien golfer reads clearly from behind.
  const teeFillLight = new THREE.PointLight(0xdff6ff, 0.9, 14, 2)
  scene.add(teeFillLight)

  const glowTexture = createGlowTexture()
  const nebula = createNebulaSphere()
  const stars = createStarfield()
  const sunSprite = createSunSprite(glowTexture)
  sunSprite.position.copy(sun.position).normalize().multiplyScalar(600)
  scene.add(nebula, stars, sunSprite)

  const composer = new EffectComposer(renderer)
  const renderPass = new RenderPass(scene, camera)
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.55, 0.85)
  const postFxPass = new ShaderPass(createPostFxShader())
  const outputPass = new OutputPass()
  composer.addPass(renderPass)
  composer.addPass(bloomPass)
  composer.addPass(postFxPass)
  composer.addPass(outputPass)

  // --- Overlay (screen-space drag stroke) -----------------------------------------------------------
  const overlayScene = new THREE.Scene()
  const overlayCamera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1)
  const strokeCircleMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    opacity: 0.55,
  })
  const strokeCircle = new THREE.Sprite(strokeCircleMaterial)
  strokeCircle.scale.set(46, 46, 1)
  strokeCircle.visible = false
  overlayScene.add(strokeCircle)

  // A short vertical bar rising from the pointer-down point, tracking the current drag power - the
  // touch-guide replacement for the old drag-stroke line (which fed back on itself once the camera
  // started turning with the aim; see the pointer input section below).
  const strokeBarGeometry = new THREE.PlaneGeometry(1, 1)
  strokeBarGeometry.translate(0, -0.5, 0)
  const strokeBarMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false })
  const strokeBar = new THREE.Mesh(strokeBarGeometry, strokeBarMaterial)
  strokeBar.visible = false
  overlayScene.add(strokeBar)

  // --- Particles -------------------------------------------------------------------------------------
  const particlePool = new ParticlePool()
  scene.add(particlePool.points)
  const visualCtx: VisualCtx = { particlePool }

  // --- Trails --------------------------------------------------------------------------------------
  const resolution = new THREE.Vector2(1, 1)
  const activeTrail = new ActiveTrail(resolution)
  scene.add(activeTrail.group)

  // --- Ball: a glossy white golf ball ------------------------------------------------------------
  const ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 20, 16)
  const ballMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.05 })
  const ballMesh = new THREE.Mesh(ballGeometry, ballMaterial)
  ballMesh.visible = false
  scene.add(ballMesh)

  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const ballGlow = new THREE.Sprite(glowMaterial)
  ballGlow.scale.set(0.5, 0.5, 0.5)
  ballGlow.visible = false
  scene.add(ballGlow)

  // The resting ball at the lie: visible while aiming and mid-swing, hidden the instant the club
  // makes contact and the flying ball (ballMesh above) takes over.
  const restBallMesh = new THREE.Mesh(ballGeometry, ballMaterial)
  restBallMesh.visible = false
  scene.add(restBallMesh)
  let showRestingBall = true

  // --- Alien golfer -----------------------------------------------------------------------------
  const alien: AlienGolfer = createAlienGolfer()
  scene.add(alien.group)
  let alienHopK: number | null = null

  // --- Living background + floating spectator stands ---------------------------------------------
  const backdrop: Backdrop = createBackdrop()
  scene.add(backdrop.group)
  const crowd: Crowd = createCrowd()
  scene.add(crowd.group)

  // --- Aim indicator: flat ribbon + tapered glowing curve + shrinking prediction dots -----------------
  const ribbonGeometry = new THREE.BufferGeometry()
  const ribbonPositions = new Float32Array(RIBBON_SAMPLES * 2 * 3)
  const ribbonUvs = new Float32Array(RIBBON_SAMPLES * 2 * 2)
  for (let i = 0; i < RIBBON_SAMPLES; i++) {
    const u = i / (RIBBON_SAMPLES - 1)
    ribbonUvs[i * 4] = u
    ribbonUvs[i * 4 + 1] = 0
    ribbonUvs[i * 4 + 2] = u
    ribbonUvs[i * 4 + 3] = 1
  }
  const ribbonIndices: number[] = []
  for (let i = 0; i < RIBBON_SAMPLES - 1; i++) {
    const a = i * 2
    const b = i * 2 + 1
    const c = (i + 1) * 2
    const d = (i + 1) * 2 + 1
    ribbonIndices.push(a, c, b, b, c, d)
  }
  // Shared (not copied) so per-frame writes to ribbonPositions reach the GPU.
  ribbonGeometry.setAttribute('position', new THREE.BufferAttribute(ribbonPositions, 3))
  ribbonGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(ribbonUvs, 2))
  ribbonGeometry.setIndex(ribbonIndices)
  const ribbonMaterial = createAimRibbonMaterial()
  const ribbonMesh = new THREE.Mesh(ribbonGeometry, ribbonMaterial)
  ribbonMesh.frustumCulled = false

  const predictionGeometry = new THREE.BufferGeometry()
  const predictionMaterial = createPredictionDotsMaterial()
  const predictionPoints = new THREE.Points(predictionGeometry, predictionMaterial)

  // Tapered glowing curve under the prediction dots, built the same way as the aim ribbon (a strip
  // of quads whose half-width shrinks along the path) so the initial bend of the shot is obvious.
  const PREDICT_MAX_SAMPLES = Math.ceil(PREDICT_SECONDS / DT / PREDICT_STRIDE) + 2
  const predictCurveGeometry = new THREE.BufferGeometry()
  const predictCurvePositions = new Float32Array(PREDICT_MAX_SAMPLES * 2 * 3)
  const predictCurveUvs = new Float32Array(PREDICT_MAX_SAMPLES * 2 * 2)
  const predictCurveIndices: number[] = []
  for (let i = 0; i < PREDICT_MAX_SAMPLES - 1; i++) {
    const a = i * 2
    const b = i * 2 + 1
    const c = (i + 1) * 2
    const d = (i + 1) * 2 + 1
    predictCurveIndices.push(a, c, b, b, c, d)
  }
  predictCurveGeometry.setAttribute('position', new THREE.BufferAttribute(predictCurvePositions, 3))
  predictCurveGeometry.setAttribute('uv', new THREE.BufferAttribute(predictCurveUvs, 2))
  predictCurveGeometry.setIndex(predictCurveIndices)
  predictCurveGeometry.setDrawRange(0, 0)
  const predictCurveMaterial = createPredictionCurveMaterial()
  const predictCurveMesh = new THREE.Mesh(predictCurveGeometry, predictCurveMaterial)
  predictCurveMesh.frustumCulled = false

  ribbonMesh.renderOrder = 10
  predictCurveMesh.renderOrder = 11
  predictionPoints.renderOrder = 12
  const aimGroup = new THREE.Group()
  aimGroup.add(ribbonMesh, predictCurveMesh, predictionPoints)
  scene.add(aimGroup)

  // --- Gravity well + hazards + tee + cup + course structure (rebuilt per level) -------------------
  let bodyVisuals: BodyVisual[] = []
  let wormholeVisuals: WormholeVisual[] = []
  let saucerVisuals: { saucer: Saucer; visual: SaucerVisual }[] = []
  let teeVisual: TeeVisual | null = null
  let cupVisual: CupVisual | null = null
  let well: WellVisual | null = null
  let courseStructure: CourseStructure | null = null
  let courseWallMaterial: THREE.ShaderMaterial | null = null

  // --- Mutable engine state --------------------------------------------------------------------------
  let currentLevel: Level | null = null
  /** Where the next stroke is played from. Owned entirely by the engine. */
  let lie: Vec2 = { x: 0, y: 0 }
  let aim: Aim = { angle: 0, power: 0.5 }
  let aimDirty = true
  let flying = false
  let ballState: BallState | null = null
  let flightStepCounter = 0
  let closestApproach = Infinity
  let gateFlash = 0
  let elapsed = 0
  let lastWidth = 0
  let lastHeight = 0
  /**
   * Course time, in seconds. Drives every rail, patrol, wormhole and saucer. Unlike a shot's own
   * elapsed time (BallState.t), this never resets mid-hole: it keeps advancing while aiming, during
   * the swing delay, and through every post-shot phase, so movers never appear to freeze.
   */
  let courseClock = 0
  /** Forces a prediction refresh every 2nd frame while aiming on a level with moving hazards. */
  let aimRefreshFrame = 0

  // Swing delay: onLaunch()/isFlying() fire/flip immediately, but the physical ball only exists
  // from contact onward.
  let pendingLaunchAim: Aim | null = null
  let swingTimer = 0

  // Post-outcome sequencing (sink / wait+hop / beam-back). See endShot() and updatePostPhase().
  type PostPhase = 'goalSink' | 'restWait' | 'restHop' | 'hazardBeam' | null
  let postPhase: PostPhase = null
  let postPhaseT = 0
  let pendingResult: ShotResult | null = null
  let hopFrom: Vec2 | null = null
  let hopTo: Vec2 | null = null
  let hopDuration = REST_HOP_DURATION
  const sinkStartPos = new THREE.Vector3()

  // Saucer abduction: while postPhase is 'hazardBeam' and the hazard was a saucer, the ball is
  // animated up the beam instead of just vanishing, and that saucer is held still for the duration.
  let activeHazardKind: HazardKind | null = null
  let hazardSaucerId: string | null = null
  let hazardFreezeClock = 0
  const hazardSuckFrom = new THREE.Vector3()

  /** Camera catch-up after a warp: for a short window the chase camera follows the ball hard. */
  let warpSnapTimer = 0

  // --- Chase camera state --------------------------------------------------------------------------
  const camPos = new THREE.Vector3()
  const camLookAt = new THREE.Vector3()
  /** The lie position the camera frames around, glided smoothly between the old and new lie. */
  const camFramingLie: Vec2 = { x: 0, y: 0 }
  let glideFromLie: Vec2 = { x: 0, y: 0 }
  let glideToLie: Vec2 = { x: 0, y: 0 }
  let glideT = 0
  let glideDuration = 0
  let currentFov = CHASE_FOV_LANDSCAPE
  let shakeTimer = 0
  // Camera yaw: a critically damped spring toward the aim angle, so the camera always sits behind
  // the ball looking along the aim direction. Locked to the aim the stroke was played with while a
  // shot is in flight (see `flying`), so the view doesn't spin mid-shot.
  let cameraYaw = 0
  const cameraYawVelocity = { v: 0 }
  let lockedYaw = 0

  const effects: Effect[] = []

  // --- Effects ---------------------------------------------------------------------------------------
  function triggerShake(): void {
    shakeTimer = CRASH_SHAKE_DURATION
  }

  function spawnRingEffect(pos: Vec2, y: number, color: number, maxScale: number, duration: number): void {
    const geometry = new THREE.RingGeometry(0.05, 0.15, 32)
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(pos.x, y + 0.05, pos.y)
    scene.add(mesh)
    let t = 0
    effects.push({
      update(dt) {
        t += dt
        const k = Math.min(1, t / duration)
        mesh.scale.setScalar(1 + k * maxScale)
        material.opacity = 1 - k
        if (k >= 1) {
          scene.remove(mesh)
          geometry.dispose()
          material.dispose()
          return false
        }
        return true
      },
    })
  }

  function spawnGoalBurst(pos: Vec2, y: number): void {
    spawnRingEffect(pos, y, 0x6ee7b7, 6, 0.6)
    const count = 60
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const speed = 0.5 + Math.random() * 1.5
      particlePool.spawn(
        pos.x,
        y + 0.1,
        pos.y,
        Math.cos(a) * speed,
        0.4 + Math.random() * 1.2,
        Math.sin(a) * speed,
        new THREE.Color(0x4ade80),
        0.1,
        0.8,
        { drag: 0.6 },
      )
    }
    gateFlash = 1
  }

  function spawnLaunchShockwave(pos: Vec2, y: number): void {
    spawnRingEffect(pos, y, 0xf0fbff, 5, 0.4)
  }

  /** A small burst at both mouths of whichever wormhole the ball just passed through. */
  function spawnWarpEffects(level: Level, ballPos: Vec2, clock: number): void {
    const holes = level.wormholes ?? []
    for (let i = 0; i < holes.length; i++) {
      const w = holes[i]
      const nearA = Math.hypot(w.a.x - ballPos.x, w.a.y - ballPos.y) < 0.1
      const nearB = !nearA && Math.hypot(w.b.x - ballPos.x, w.b.y - ballPos.y) < 0.1
      if (!nearA && !nearB) continue
      const color = wormholeColor(i)
      for (const mouth of [w.a, w.b]) {
        const y = -wellDepthAt(level, mouth.x, mouth.y, clock) + 0.1
        spawnRingEffect(mouth, y, color, 3, 0.4)
        for (let p = 0; p < 16; p++) {
          const a = Math.random() * Math.PI * 2
          const speed = 0.6 + Math.random() * 1.2
          particlePool.spawn(
            mouth.x,
            y,
            mouth.y,
            Math.cos(a) * speed,
            0.4 + Math.random() * 0.8,
            Math.sin(a) * speed,
            new THREE.Color(color),
            0.06,
            0.5,
            { drag: 1 },
          )
        }
      }
      return
    }
  }

  /** Burn-up / swirl / debris / fall-away flash depending on what ended the shot. */
  function spawnHazardEffect(level: Level, hazardId: string | null, pos: Vec2, y: number): void {
    const body = hazardId ? level.bodies.find((b) => b.id === hazardId) ?? null : null
    if (!body) {
      spawnRingEffect(pos, y, 0x94a3b8, 4, 0.4)
      triggerShake()
      return
    }
    if (body.kind === 'blackhole') {
      spawnRingEffect(pos, y, 0x1e1b4b, 10, 0.6)
      for (let i = 0; i < 50; i++) {
        const a = Math.random() * Math.PI * 2
        const r = 0.1 + Math.random() * 0.3
        particlePool.spawn(
          pos.x + Math.cos(a) * r,
          y + 0.05,
          pos.y + Math.sin(a) * r,
          -Math.cos(a) * 2,
          0.1,
          -Math.sin(a) * 2,
          new THREE.Color(0x8b5cf6),
          0.07,
          0.5,
          { drag: 1 },
        )
      }
      triggerShake()
      return
    }
    if (body.kind === 'asteroid') {
      spawnRingEffect(pos, y, 0x8a7968, 5, 0.4)
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * Math.PI * 2
        particlePool.spawn(
          pos.x,
          y + 0.1,
          pos.y,
          Math.cos(a) * (1 + Math.random() * 2),
          Math.random() * 1.5,
          Math.sin(a) * (1 + Math.random() * 2),
          new THREE.Color(0x8a7968),
          0.08,
          0.6,
          { drag: 1, gravity: 2 },
        )
      }
      triggerShake()
      return
    }
    // Planet or moon: a burn-up flash.
    spawnRingEffect(pos, y, 0xffb703, 7, 0.5)
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2
      particlePool.spawn(
        pos.x,
        y + 0.1,
        pos.y,
        Math.cos(a) * (1 + Math.random() * 2),
        Math.random() * 1.2,
        Math.sin(a) * (1 + Math.random() * 2),
        new THREE.Color(Math.random() > 0.5 ? 0xffb703 : 0xff8a3d),
        0.09,
        0.5,
        { drag: 1.2 },
      )
    }
    triggerShake()
  }

  function onBallBounce(pos: Vec2, y: number, speed: number): void {
    events.onBounce(speed)
    if (courseWallMaterial) {
      ;(courseWallMaterial.uniforms.uFlashPos.value as THREE.Vector3).set(pos.x, y, pos.y)
      courseWallMaterial.uniforms.uFlashAge.value = 0
    }
    const count = Math.min(18, 6 + Math.floor(speed))
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const s = 0.3 + Math.random() * speed * 0.3
      particlePool.spawn(
        pos.x,
        y + 0.05,
        pos.y,
        Math.cos(a) * s,
        0.2 + Math.random() * 0.4,
        Math.sin(a) * s,
        new THREE.Color(0xfef3c7),
        0.05,
        0.35,
        { drag: 2 },
      )
    }
  }

  function updateEffects(dt: number): void {
    for (let i = effects.length - 1; i >= 0; i--) {
      if (!effects[i].update(dt)) effects.splice(i, 1)
    }
  }

  /** Coarse pointers and narrow screens get a lighter decorative load to hold 60fps on phones. */
  function computeLowPerf(): boolean {
    const w = canvas.clientWidth || lastWidth
    return coarsePointerQuery.matches || w < 700
  }

  // --- Level / body rebuild ---------------------------------------------------------------------------
  function rebuildLevelVisuals(level: Level): void {
    const lowPerf = computeLowPerf()

    for (const v of bodyVisuals) {
      scene.remove(v.group)
      v.dispose()
    }
    bodyVisuals = level.bodies.map((body) => {
      const v = buildBodyVisual(body, visualCtx)
      scene.add(v.group)
      return v
    })

    for (const wv of wormholeVisuals) {
      scene.remove(wv.group)
      wv.dispose()
    }
    wormholeVisuals = (level.wormholes ?? []).map((w, i) => {
      const v = buildWormholeVisual(w, i, lowPerf)
      scene.add(v.group)
      return v
    })

    for (const sv of saucerVisuals) {
      scene.remove(sv.visual.group)
      sv.visual.dispose()
    }
    saucerVisuals = (level.saucers ?? []).map((s) => {
      const v = buildSaucerVisual(s, lowPerf)
      scene.add(v.group)
      return { saucer: s, visual: v }
    })

    if (teeVisual) {
      scene.remove(teeVisual.group)
      teeVisual.dispose()
    }
    teeVisual = buildTeeVisual(level)
    scene.add(teeVisual.group)

    if (cupVisual) {
      scene.remove(cupVisual.group)
      cupVisual.dispose()
    }
    cupVisual = buildCupVisual(level, visualCtx)
    scene.add(cupVisual.group)

    if (well) {
      scene.remove(well.mesh)
      well.geometry.dispose()
      well.material.dispose()
      well.maskTexture.dispose()
    }
    well = buildWellMesh(level)
    scene.add(well.mesh)

    if (courseStructure) {
      scene.remove(courseStructure.group)
      courseStructure.dispose()
    }
    courseStructure = buildCourseStructure(level)
    courseWallMaterial = courseStructure.wallMaterial
    scene.add(courseStructure.group)

    backdrop.build(level, { lowPerf })
    crowd.build(level, { lowPerf })
  }

  function updateWellUniforms(tSim: number): void {
    if (!well || !currentLevel) return
    const massive = currentLevel.bodies.filter((b) => sheetMass(b) !== 0).slice(0, MAX_WELL_BODIES)
    const bodiesUniform = well.material.uniforms.uBodies.value as THREE.Vector3[]
    const softUniform = well.material.uniforms.uSoft.value as Float32Array
    const { x: cx, y: cy } = well.center
    massive.forEach((body, i) => {
      const p = bodyPosition(body, tSim)
      // See buildWellMesh's doc comment for this local-space transform.
      // Shader layout: xz = position in the sheet's local space, y = signed sheet mass.
      bodiesUniform[i].set(p.x - cx, sheetMass(body), cy - p.y)
      softUniform[i] = body.radius
    })
    well.material.uniforms.uCount.value = massive.length
    well.material.uniforms.uCameraPos.value.copy(camera.position)
    well.material.uniforms.uTime.value = elapsed
  }

  // --- Chase camera -----------------------------------------------------------------------------
  function fitsChaseNdc(points: THREE.Vector3[], yMin: number): boolean {
    for (const p of points) {
      const proj = p.clone().project(camera)
      if (Math.abs(proj.x) > NDC_X_LIMIT || proj.y < yMin || proj.y > NDC_Y_MAX) return false
    }
    return true
  }

  /** Behind the ball looking along `dir` (the aim direction); pulled back (up to +60%) so the key points fit NDC. */
  function computeChaseFraming(
    level: Level,
    lieP: Vec2,
    dir: Vec2,
    portrait: boolean,
  ): { pos: THREE.Vector3; lookAt: THREE.Vector3; fov: number } {
    const back = portrait ? CHASE_BACK_PORTRAIT : CHASE_BACK_LANDSCAPE
    const fov = portrait ? CHASE_FOV_PORTRAIT : CHASE_FOV_LANDSCAPE
    const yMin = portrait ? -0.52 : -0.62
    const lieY = -wellDepthAt(level, lieP.x, lieP.y, courseClock)

    camera.fov = fov
    camera.aspect = lastWidth / Math.max(1, lastHeight)
    camera.updateProjectionMatrix()

    const aheadX = lieP.x + dir.x * CHASE_AHEAD_POINT
    const aheadY = lieP.y + dir.y * CHASE_AHEAD_POINT
    const points = [
      new THREE.Vector3(lieP.x - dir.x * 0.4, lieY + 1.5, lieP.y - dir.y * 0.4),
      new THREE.Vector3(lieP.x, lieY + BALL_RADIUS, lieP.y),
      new THREE.Vector3(aheadX, -wellDepthAt(level, aheadX, aheadY, courseClock), aheadY),
    ]

    const lookAt = new THREE.Vector3(lieP.x + dir.x * CHASE_LOOKAHEAD, lieY + 0.4, lieP.y + dir.y * CHASE_LOOKAHEAD)

    function place(k: number): void {
      const horiz = back * k
      const height = horiz * Math.tan(CHASE_ELEVATION)
      camera.position.set(lieP.x - dir.x * horiz, lieY + height, lieP.y - dir.y * horiz)
      camera.lookAt(lookAt)
      camera.updateMatrixWorld()
    }

    let k = 1
    place(k)
    let guard = 0
    while (!fitsChaseNdc(points, yMin) && k < CHASE_PULLBACK_MAX && guard < 20) {
      k = Math.min(CHASE_PULLBACK_MAX, k + 0.05)
      place(k)
      guard++
    }

    return { pos: camera.position.clone(), lookAt, fov }
  }

  /** Hard-snaps the camera's framing lie (level load, resize). Does not touch the yaw spring. */
  function snapCameraToLie(lieP: Vec2): void {
    glideFromLie = { x: lieP.x, y: lieP.y }
    glideToLie = { x: lieP.x, y: lieP.y }
    glideT = 0
    glideDuration = 0
  }

  /** Glides the camera's framing lie to a new point (e.g. after a rest) over LIE_GLIDE_DURATION. */
  function glideCameraToLie(lieP: Vec2): void {
    glideFromLie = { x: camFramingLie.x, y: camFramingLie.y }
    glideToLie = { x: lieP.x, y: lieP.y }
    glideT = 0
    glideDuration = LIE_GLIDE_DURATION
  }

  function updateCamera(dt: number): void {
    const level = currentLevel
    if (level && lastWidth > 0 && lastHeight > 0) {
      if (glideDuration > 0 && !reducedMotion) {
        glideT += dt
        const t = Math.min(1, glideT / glideDuration)
        const e = easeInOutCubic(t)
        camFramingLie.x = THREE.MathUtils.lerp(glideFromLie.x, glideToLie.x, e)
        camFramingLie.y = THREE.MathUtils.lerp(glideFromLie.y, glideToLie.y, e)
        if (t >= 1) glideDuration = 0
      } else {
        camFramingLie.x = glideToLie.x
        camFramingLie.y = glideToLie.y
        glideDuration = 0
      }

      // The camera always looks along the aim direction: spring the yaw toward it so turning feels
      // smooth but tight, and lock it to the launch aim for the whole stroke so the view can't spin
      // mid-shot.
      const targetYaw = flying ? lockedYaw : aim.angle
      if (reducedMotion) {
        cameraYaw = targetYaw
        cameraYawVelocity.v = 0
      } else {
        cameraYaw = smoothDampAngle(cameraYaw, targetYaw, cameraYawVelocity, dt, CAMERA_YAW_TIME_CONSTANT)
      }
      const dir: Vec2 = { x: Math.cos(cameraYaw), y: Math.sin(cameraYaw) }
      const portrait = lastHeight > lastWidth
      const framing = computeChaseFraming(level, camFramingLie, dir, portrait)
      camPos.copy(framing.pos)
      camLookAt.copy(framing.lookAt)
      currentFov = framing.fov
    }

    if (warpSnapTimer > 0) warpSnapTimer = Math.max(0, warpSnapTimer - dt)

    let finalPos = camPos
    let finalLookAt = camLookAt
    if (flying && ballState && !reducedMotion) {
      // After a wormhole warp the ball jumps instantly; follow it hard for a short window instead
      // of the usual slow chase-camera lag, so the view catches up within about WARP_SNAP_DURATION.
      const followK = warpSnapTimer > 0 ? 0.85 : 0.05
      const lookAtK = warpSnapTimer > 0 ? 0.95 : CHASE_FOLLOW_LOOKAT_FRAC
      finalLookAt = camLookAt.clone().lerp(ballMesh.position, lookAtK)
      finalPos = camPos.clone().lerp(ballMesh.position, followK)
    }

    camera.fov = currentFov
    camera.aspect = lastWidth / Math.max(1, lastHeight)
    camera.updateProjectionMatrix()
    camera.position.copy(finalPos)
    camera.lookAt(finalLookAt)

    if (!reducedMotion) {
      const sway = Math.sin(elapsed * 0.15) * IDLE_SWAY
      camera.rotateY(sway)
    }
    camera.updateMatrixWorld()

    if (shakeTimer > 0 && !reducedMotion) {
      shakeTimer = Math.max(0, shakeTimer - dt)
      const k = shakeTimer / CRASH_SHAKE_DURATION
      camera.position.x += (Math.random() - 0.5) * CRASH_SHAKE_MAX * k
      camera.position.y += (Math.random() - 0.5) * CRASH_SHAKE_MAX * k
      camera.position.z += (Math.random() - 0.5) * CRASH_SHAKE_MAX * k
    }
  }

  // --- Aim indicator --------------------------------------------------------------------------------
  function updateAimIndicator(): void {
    if (!currentLevel || !aimDirty) return
    const level = currentLevel
    const dirX = Math.cos(aim.angle)
    const dirY = Math.sin(aim.angle)
    const perpX = -dirY
    const perpZ = dirX
    const length = THREE.MathUtils.lerp(AIM_MIN_LENGTH, AIM_MAX_LENGTH, aim.power)
    const startR = BALL_RADIUS + 0.05

    for (let i = 0; i < RIBBON_SAMPLES; i++) {
      const frac = i / (RIBBON_SAMPLES - 1)
      const d = startR + length * frac
      const x = lie.x + dirX * d
      const z = lie.y + dirY * d
      const y = -wellDepthAt(level, x, z, courseClock) + 0.05
      const lx = x - perpX * RIBBON_HALF_WIDTH
      const lz = z - perpZ * RIBBON_HALF_WIDTH
      const rx = x + perpX * RIBBON_HALF_WIDTH
      const rz = z + perpZ * RIBBON_HALF_WIDTH
      const base = i * 6
      ribbonPositions[base] = lx
      ribbonPositions[base + 1] = y
      ribbonPositions[base + 2] = lz
      ribbonPositions[base + 3] = rx
      ribbonPositions[base + 4] = y
      ribbonPositions[base + 5] = rz
    }
    ;(ribbonGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ribbonMaterial.uniforms.uPower.value = aim.power

    const path = predictPath(level, lie, aim, PREDICT_SECONDS, PREDICT_STRIDE, courseClock)
    const count = path.length / 2
    const positions = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const px = path[i * 2]
      const pz = path[i * 2 + 1]
      const t = courseClock + i * PREDICT_STRIDE * DT
      const py = -wellDepthAt(level, px, pz, t) + 0.06
      positions[i * 3] = px
      positions[i * 3 + 1] = py
      positions[i * 3 + 2] = pz
      sizes[i] = THREE.MathUtils.lerp(0.13, 0.03, i / Math.max(1, count - 1))
    }
    predictionGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    predictionGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1))

    // Tapered glowing curve beneath the dots: a strip whose half-width shrinks toward the tail.
    const curveSamples = Math.min(count, PREDICT_MAX_SAMPLES)
    for (let i = 0; i < curveSamples; i++) {
      const px = positions[i * 3]
      const py = positions[i * 3 + 1] + 0.01
      const pz = positions[i * 3 + 2]
      const nx = i < curveSamples - 1 ? positions[(i + 1) * 3] : px
      const nz = i < curveSamples - 1 ? positions[(i + 1) * 3 + 2] : pz
      const px0 = i > 0 ? positions[(i - 1) * 3] : px
      const pz0 = i > 0 ? positions[(i - 1) * 3 + 2] : pz
      let tx = nx - px0
      let tz = nz - pz0
      const tlen = Math.hypot(tx, tz) || 1
      tx /= tlen
      tz /= tlen
      const pxp = -tz
      const pzp = tx
      const frac = i / Math.max(1, curveSamples - 1)
      const halfW = THREE.MathUtils.lerp(0.1, 0.015, frac)
      const base = i * 6
      predictCurvePositions[base] = px - pxp * halfW
      predictCurvePositions[base + 1] = py
      predictCurvePositions[base + 2] = pz - pzp * halfW
      predictCurvePositions[base + 3] = px + pxp * halfW
      predictCurvePositions[base + 4] = py
      predictCurvePositions[base + 5] = pz + pzp * halfW
      predictCurveUvs[i * 4] = frac
      predictCurveUvs[i * 4 + 1] = 0
      predictCurveUvs[i * 4 + 2] = frac
      predictCurveUvs[i * 4 + 3] = 1
    }
    ;(predictCurveGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(predictCurveGeometry.attributes.uv as THREE.BufferAttribute).needsUpdate = true
    predictCurveGeometry.setDrawRange(0, Math.max(0, (curveSamples - 1) * 6))

    aimDirty = false
  }

  function applyAim(next: Aim, dragging: boolean): void {
    aim = clampAim(next)
    aimDirty = true
    updateAimIndicator()
    if (!flying) alien.setAimAngle(aim.angle)
    events.onAimChange(aim, dragging)
  }

  // --- Flight (one stroke) -------------------------------------------------------------------------
  function beginFlight(a: Aim): void {
    if (!currentLevel || flying) return
    const launchAim = clampAim(a)
    events.onLaunch(launchAim)
    aim = launchAim
    lockedYaw = launchAim.angle
    flying = true
    ballState = null
    alien.setAimAngle(launchAim.angle)
    const contactDelay = reducedMotion ? 0 : alien.playSwing(launchAim.power)
    if (contactDelay <= 0) {
      performContact(launchAim)
    } else {
      pendingLaunchAim = launchAim
      swingTimer = contactDelay
    }
  }

  function performContact(a: Aim): void {
    if (!currentLevel) return
    pendingLaunchAim = null
    ballState = launchState(currentLevel, lie, a, courseClock)
    flightStepCounter = 0
    closestApproach = Infinity
    activeTrail.reset()
    const depth0 = wellDepthAt(currentLevel, ballState.pos.x, ballState.pos.y, ballState.clock)
    const y0 = -depth0 + 0.14
    activeTrail.addPoint(ballState.pos.x, y0, ballState.pos.y, ballState.t)
    ballMesh.visible = true
    ballGlow.visible = true
    ballMesh.scale.setScalar(1)
    ballMesh.position.set(ballState.pos.x, y0, ballState.pos.y)
    ballGlow.scale.setScalar(1)
    ballGlow.position.copy(ballMesh.position)
    showRestingBall = false
    spawnLaunchShockwave(lie, -depth0)
    for (let i = 0; i < 20; i++) {
      const ang = Math.random() * Math.PI * 2
      const speed = 0.6 + Math.random() * 1.4
      particlePool.spawn(
        ballState.pos.x,
        y0,
        ballState.pos.y,
        Math.cos(ang) * speed,
        0.3 + Math.random() * 0.6,
        Math.sin(ang) * speed,
        new THREE.Color(0xf0fbff),
        0.06,
        0.4,
        { drag: 1.5 },
      )
    }
  }

  function endShot(outcome: Outcome, hazardId: string | null, hazardKind: HazardKind | null): void {
    if (!ballState || !currentLevel) return
    const level = currentLevel
    const result: ShotResult = {
      outcome,
      hazardId,
      hazardKind,
      time: ballState.t,
      closest: closestApproach,
      end: { x: ballState.pos.x, y: ballState.pos.y },
      bounces: ballState.bounces,
      warps: ballState.warps,
    }
    // Nothing survives a finished stroke: the comet tail fades out and clears itself, never
    // leaving a mark on the course.
    activeTrail.fadeOut()
    const depthEnd = wellDepthAt(level, ballState.pos.x, ballState.pos.y, ballState.clock)
    const endY = -depthEnd + 0.14

    if (outcome === 'goal') {
      alien.setWatchTarget(null)
      alien.react('cheer')
      crowd.react('cheer')
      spawnGoalBurst(targetPosition(level.target, ballState.clock), -depthEnd)
      sinkStartPos.set(ballState.pos.x, endY, ballState.pos.y)
      pendingResult = result
      postPhase = 'goalSink'
      postPhaseT = 0
      return
    }

    if (outcome === 'rest') {
      alien.setWatchTarget(null)
      if (result.closest <= NEAR_MISS_DISTANCE) crowd.react('groan')
      events.onResult(result)
      ballMesh.position.set(ballState.pos.x, endY, ballState.pos.y)
      ballGlow.position.copy(ballMesh.position)
      hopFrom = { x: lie.x, y: lie.y }
      hopTo = { x: result.end.x, y: result.end.y }
      glideCameraToLie(hopTo)
      postPhase = 'restWait'
      postPhaseT = 0
      return
    }

    // hazard
    alien.setWatchTarget(null)
    activeHazardKind = hazardKind
    hazardSaucerId = hazardKind === 'saucer' ? hazardId : null
    if (hazardKind === 'saucer') {
      // The abduction animation (ball lerps up the beam) is driven per-frame from updatePostPhase;
      // freeze the clock so the abducting saucer holds its position for the animation.
      hazardFreezeClock = ballState.clock
      hazardSuckFrom.set(ballState.pos.x, endY, ballState.pos.y)
    } else {
      spawnHazardEffect(level, hazardId, ballState.pos, -depthEnd)
      ballMesh.visible = false
      ballGlow.visible = false
    }
    alien.react('slump')
    crowd.react('groan')
    events.onResult(result)
    postPhase = 'hazardBeam'
    postPhaseT = 0
  }

  function hopWorldPos(k: number): THREE.Vector3 {
    const level = currentLevel
    if (!level || !hopFrom || !hopTo) return new THREE.Vector3()
    const x = THREE.MathUtils.lerp(hopFrom.x, hopTo.x, k)
    const y = THREE.MathUtils.lerp(hopFrom.y, hopTo.y, k)
    const baseDepth = wellDepthAt(level, x, y, courseClock)
    const arc = Math.sin(clamp(k, 0, 1) * Math.PI) * 1.1
    return new THREE.Vector3(x, -baseDepth + arc, y)
  }

  function updatePostPhase(dt: number): void {
    if (!postPhase || !currentLevel) return
    const level = currentLevel
    postPhaseT += dt

    if (postPhase === 'goalSink') {
      const k = Math.min(1, postPhaseT / GOAL_SINK_DURATION)
      ballMesh.visible = true
      ballGlow.visible = true
      ballMesh.position.set(sinkStartPos.x, sinkStartPos.y - k * 0.3, sinkStartPos.z)
      ballMesh.scale.setScalar(Math.max(0.001, 1 - k))
      ballGlow.position.copy(ballMesh.position)
      ballGlow.scale.setScalar(Math.max(0.001, 1 - k))
      if (postPhaseT >= GOAL_SINK_DURATION) {
        ballMesh.visible = false
        ballGlow.visible = false
        ballMesh.scale.setScalar(1)
        ballGlow.scale.setScalar(1)
        postPhase = null
        flying = false
        if (pendingResult) events.onResult(pendingResult)
        pendingResult = null
      }
      return
    }

    if (postPhase === 'restWait') {
      if (postPhaseT >= REST_WAIT_DURATION) {
        postPhase = 'restHop'
        postPhaseT = 0
        hopDuration = alien.playHop()
        alienHopK = 0
      }
      return
    }

    if (postPhase === 'restHop') {
      const k = Math.min(1, postPhaseT / hopDuration)
      alienHopK = k
      if (Math.random() < 0.6 && !reducedMotion) {
        const p = hopWorldPos(k)
        alien.group.position.copy(p)
        alien.group.updateMatrixWorld()
        const flame = alien.group.localToWorld(ALIEN_BACKPACK_OFFSET.clone())
        particlePool.spawn(
          flame.x,
          flame.y,
          flame.z,
          (Math.random() - 0.5) * 0.3,
          -0.6 - Math.random() * 0.4,
          (Math.random() - 0.5) * 0.3,
          new THREE.Color(0xffb877),
          0.05,
          0.3,
          { drag: 2 },
        )
      }
      if (postPhaseT >= hopDuration) {
        alienHopK = null
        postPhase = null
        flying = false
        if (hopTo) lie = { x: hopTo.x, y: hopTo.y }
        showRestingBall = true
        ballMesh.visible = false
        ballGlow.visible = false
        events.onLieChange({ x: lie.x, y: lie.y })
        applyAim(defaultAim(level, lie, courseClock), false)
        hopFrom = null
        hopTo = null
      }
      return
    }

    if (postPhase === 'hazardBeam') {
      if (activeHazardKind === 'saucer' && hazardSaucerId) {
        const match = saucerVisuals.find((sv) => sv.saucer.id === hazardSaucerId)
        if (match) {
          const k = Math.min(1, postPhaseT / HAZARD_FX_DURATION)
          const eased = k * k
          const target = match.visual.worldPos(level, hazardFreezeClock)
          if (k < 1) {
            ballMesh.visible = true
            ballGlow.visible = true
            ballMesh.position.lerpVectors(hazardSuckFrom, target, eased)
            const scale = THREE.MathUtils.lerp(1, 0.3, eased)
            ballMesh.scale.setScalar(scale)
            ballGlow.position.copy(ballMesh.position)
            ballGlow.scale.setScalar(scale)
            if (Math.random() < 0.5 && !reducedMotion) {
              particlePool.spawn(
                ballMesh.position.x,
                ballMesh.position.y,
                ballMesh.position.z,
                (Math.random() - 0.5) * 0.4,
                0.6 + Math.random() * 0.6,
                (Math.random() - 0.5) * 0.4,
                new THREE.Color(0x4ade80),
                0.05,
                0.35,
                { drag: 1 },
              )
            }
          } else {
            ballMesh.visible = false
            ballGlow.visible = false
            ballMesh.scale.setScalar(1)
            ballGlow.scale.setScalar(1)
          }
          match.visual.setBeamBright(eased)
        }
      }
      if (postPhaseT >= HAZARD_FX_DURATION + HAZARD_BEAM_DURATION) {
        postPhase = null
        flying = false
        showRestingBall = true
        events.onLieChange({ x: lie.x, y: lie.y })
        applyAim(defaultAim(level, lie, courseClock), false)
        activeHazardKind = null
        hazardSaucerId = null
      }
    }
  }

  function stepFlight(dt: number): void {
    if (!flying || !currentLevel) return
    if (pendingLaunchAim) {
      swingTimer -= dt
      if (swingTimer <= 0) performContact(pendingLaunchAim)
      return
    }
    // `flying` stays true through the post-shot transition (sink, hop, beam-in) to block early
    // strokes. Without this guard the loop re-detects the finished shot every frame and restarts
    // that transition forever.
    if (!ballState || postPhase) return
    accumulator += dt
    while (accumulator >= DT && flying && ballState && !postPhase) {
      const prevBounces = ballState.bounces
      const prevWarps = ballState.warps
      step(currentLevel, ballState)
      accumulator -= DT
      flightStepCounter++
      if (ballState.bounces > prevBounces) {
        const depth = wellDepthAt(currentLevel, ballState.pos.x, ballState.pos.y, ballState.clock)
        onBallBounce(ballState.pos, -depth + 0.14, ballState.lastBounceSpeed)
      }
      if (ballState.warps > prevWarps) {
        events.onWarp()
        activeTrail.reset()
        spawnWarpEffects(currentLevel, ballState.pos, ballState.clock)
        warpSnapTimer = WARP_SNAP_DURATION
      }
      const check = checkOutcome(currentLevel, ballState)
      if (check.targetDistance < closestApproach) closestApproach = check.targetDistance
      if (flightStepCounter % 2 === 0) {
        const depth = wellDepthAt(currentLevel, ballState.pos.x, ballState.pos.y, ballState.clock)
        activeTrail.addPoint(ballState.pos.x, -depth + 0.14, ballState.pos.y, ballState.t)
      }
      if (check.outcome) {
        endShot(check.outcome, check.hazardId, check.hazardKind)
        break
      }
    }
  }
  let accumulator = 0

  // --- Per-frame visuals ----------------------------------------------------------------------------
  /** True while a level has any moving hazard, so the aim preview needs periodic refreshing. */
  function levelHasMovers(level: Level): boolean {
    if (level.target.rail) return true
    if (level.bodies.some((b) => b.rail)) return true
    if ((level.saucers ?? []).some((s) => s.rail || s.patrol)) return true
    return false
  }

  function currentProximity(level: Level): number {
    if (!flying || !ballState) return 0
    const tp = targetPosition(level.target, ballState.clock)
    const dist = Math.hypot(tp.x - ballState.pos.x, tp.y - ballState.pos.y)
    return clamp(1 - dist / (level.target.radius * 6), 0, 1)
  }

  function updateVisuals(dt: number): void {
    elapsed += dt
    // The course clock drives every rail, patrol, wormhole and saucer. It tracks the ball's own
    // clock while a shot is actually in flight, and otherwise just keeps ticking with real time, so
    // movers never freeze while aiming, mid-swing, or during a post-shot phase.
    if (ballState && !postPhase) {
      courseClock = ballState.clock
    } else {
      courseClock += dt
    }
    activeTrail.update(dt)
    ;(nebula.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed
    ;(stars.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed
    if (courseWallMaterial) {
      courseWallMaterial.uniforms.uTime.value = elapsed
      courseWallMaterial.uniforms.uFlashAge.value += dt
    }

    const level = currentLevel
    const tSim = courseClock
    if (level) {
      for (const v of bodyVisuals) v.update(level, tSim, dt, elapsed)
      teeVisual?.update(level, tSim, elapsed)
      gateFlash = Math.max(0, gateFlash - dt * 2.5)
      cupVisual?.update(level, tSim, dt, elapsed, gateFlash, currentProximity(level))
      updateWellUniforms(tSim)
      for (const wv of wormholeVisuals) wv.update(level, tSim, elapsed)
      for (const sv of saucerVisuals) {
        // The saucer performing an abduction holds still (frozen clock) for the whole animation.
        const t = postPhase === 'hazardBeam' && sv.saucer.id === hazardSaucerId ? hazardFreezeClock : tSim
        sv.visual.update(level, t, dt, elapsed)
      }
    }

    if (flying && ballState && level) {
      const depth = wellDepthAt(level, ballState.pos.x, ballState.pos.y, ballState.clock)
      ballMesh.position.set(ballState.pos.x, -depth + 0.14, ballState.pos.y)
      ballGlow.position.copy(ballMesh.position)
      // ~2 comet sparks per frame while flying.
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2
        const s = 0.2 + Math.random() * 0.4
        particlePool.spawn(
          ballMesh.position.x,
          ballMesh.position.y,
          ballMesh.position.z,
          Math.cos(a) * s,
          (Math.random() - 0.5) * s,
          Math.sin(a) * s,
          new THREE.Color(0x9be8ff),
          0.06,
          1.0,
          { drag: 0.8 },
        )
      }
      alien.setWatchTarget(ballMesh.position)
    }

    if (postPhase) updatePostPhase(dt)

    aimGroup.visible = !flying
    if (!flying) {
      // Levels with moving hazards need the prediction to track them while the player aims; static
      // levels keep the previous behaviour of only recomputing when the aim itself changes.
      if (level && levelHasMovers(level)) {
        aimRefreshFrame++
        if (aimRefreshFrame % 2 === 0) aimDirty = true
      }
      updateAimIndicator()
    }

    if (level) {
      if (alienHopK !== null) {
        alien.group.position.copy(hopWorldPos(alienHopK))
      } else {
        const depth = wellDepthAt(level, lie.x, lie.y, tSim)
        alien.group.position.set(lie.x, -depth, lie.y)
      }
      teeFillLight.position.set(lie.x - 2.5, 3, lie.y)

      if (showRestingBall) {
        const depth = wellDepthAt(level, lie.x, lie.y, tSim)
        restBallMesh.position.set(lie.x, -depth + 0.14, lie.y)
        restBallMesh.visible = true
      } else {
        restBallMesh.visible = false
      }
    }
    alien.update(dt, elapsed)

    // --- Living background + spectator stands -------------------------------------------------
    backdrop.update(dt, elapsed, reducedMotion)
    crowd.update(dt, elapsed, reducedMotion, flying && ballState ? ballMesh.position : null)

    updateEffects(dt)
    particlePool.update(dt)
    updateCamera(dt)
  }

  function renderFrame(): void {
    composer.render()
    strokeCircle.visible = dragging
    strokeBar.visible = dragging
    if (dragging) {
      renderer.autoClear = false
      renderer.render(overlayScene, overlayCamera)
      renderer.autoClear = true
    }
  }

  // --- Main loop ------------------------------------------------------------------------------------
  let rafId = 0
  let lastTime = performance.now()

  function animate(now: number): void {
    rafId = requestAnimationFrame(animate)
    if (document.hidden) {
      lastTime = now
      return
    }
    const dt = Math.min(0.05, (now - lastTime) / 1000)
    lastTime = now
    stepFlight(dt)
    updateVisuals(dt)
    renderFrame()
  }
  rafId = requestAnimationFrame(animate)

  // --- Resize -----------------------------------------------------------------------------------
  function handleResize(): void {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === 0 || h === 0) return
    lastWidth = w
    lastHeight = h
    renderer.setSize(w, h, false)
    composer.setSize(w, h)
    resolution.set(w, h)
    activeTrail.setResolution(w, h)
    overlayCamera.right = w
    overlayCamera.bottom = h
    overlayCamera.updateProjectionMatrix()

    const coarse = coarsePointerQuery.matches || w < 700
    if (coarse) bloomPass.setSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)))

    if (currentLevel) snapCameraToLie(lie)
  }

  const resizeObserver = new ResizeObserver(() => handleResize())
  if (canvas.parentElement) resizeObserver.observe(canvas.parentElement)
  handleResize()

  // --- Pointer input -----------------------------------------------------------------------------
  canvas.style.touchAction = 'none'
  const raycaster = new THREE.Raycaster()
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  let activePointerId: number | null = null
  let dragging = false
  let startScreen = { x: 0, y: 0 }
  /** The aim angle when this drag started; the drag adds a relative turn on top of it. */
  let dragStartAngle = 0
  /** Power before the drag began, restored after a turn-only drag so FIRE does not dribble the ball. */
  let dragStartPower = 0.5

  function raycastGround(clientX: number, clientY: number, out: THREE.Vector3): THREE.Vector3 | null {
    const rect = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    return raycaster.ray.intersectPlane(groundPlane, out)
  }

  function onPointerDown(e: PointerEvent): void {
    if (flying || activePointerId !== null) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    activePointerId = e.pointerId
    dragging = false
    startScreen = { x: e.clientX, y: e.clientY }
    dragStartAngle = aim.angle
    dragStartPower = aim.power
    canvas.setPointerCapture(e.pointerId)
  }

  /**
   * Camera-independent, relative drag mapping: since the camera now turns with the aim, mapping
   * "drag toward the shot" against the current camera (as before) would feed back on itself and
   * spin. Horizontal drag turns the aim relative to where it started; vertical drag sets power.
   * Dragging right moves the aim angle up (see the sign note on TURN_RANGE's usage below) - with
   * the camera positioned behind the ball looking along the aim direction, increasing the physics
   * angle rotates that direction toward the camera's own right, so a rightward drag turns the arrow
   * (and the view) to the right on screen, matching the finger.
   */
  function onPointerMove(e: PointerEvent): void {
    if (activePointerId === null || e.pointerId !== activePointerId) return
    const dx = e.clientX - startScreen.x
    const dy = e.clientY - startScreen.y
    const pixelDist = Math.hypot(dx, dy)
    if (!dragging && pixelDist < DRAG_THRESHOLD_PX) return
    dragging = true
    const rect = canvas.getBoundingClientRect()
    const angle = dragStartAngle + (dx / rect.width) * TURN_RANGE
    const power = clamp(-dy / (POWER_DRAG_DIVISOR * Math.min(rect.width, rect.height)), MIN_POWER, 1)
    applyAim({ angle, power }, true)

    strokeCircle.position.set(startScreen.x, startScreen.y, 0)
    const barHeight = Math.max(2, power * POWER_BAR_MAX_HEIGHT)
    strokeBar.scale.set(POWER_BAR_WIDTH, barHeight, 1)
    strokeBar.position.set(startScreen.x, startScreen.y, 0)
    strokeBarMaterial.color.copy(powerRibbonColor(power))
  }

  function onPointerUp(e: PointerEvent): void {
    if (activePointerId === null || e.pointerId !== activePointerId) return
    canvas.releasePointerCapture(activePointerId)
    const wasDragging = dragging
    activePointerId = null
    dragging = false
    if (wasDragging) {
      if (aim.power >= LAUNCH_POWER_THRESHOLD) {
        beginFlight(aim)
      } else {
        // Turn-only drag: keep the new angle and the power the player had set before it.
        applyAim({ angle: aim.angle, power: dragStartPower }, false)
      }
    } else if (currentLevel) {
      const hit = new THREE.Vector3()
      if (raycastGround(e.clientX, e.clientY, hit)) {
        const b = currentLevel.bounds
        events.onTap({ x: clamp(hit.x, b.minX, b.maxX), y: clamp(hit.z, b.minY, b.maxY) })
      }
    }
  }

  function onPointerCancel(e: PointerEvent): void {
    if (activePointerId === null || e.pointerId !== activePointerId) return
    activePointerId = null
    dragging = false
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)

  // --- Public API ---------------------------------------------------------------------------------
  const api: EngineApi = {
    loadLevel(level: Level, options?: LoadOptions) {
      // Abort any in-flight shot/post-sequence silently (no onResult), matching loadLevel's contract.
      if (flying) {
        flying = false
        pendingLaunchAim = null
        ballState = null
        postPhase = null
        pendingResult = null
        alienHopK = null
        activeHazardKind = null
        hazardSaucerId = null
        ballMesh.visible = false
        ballGlow.visible = false
        activeTrail.reset()
      }
      currentLevel = level
      rebuildLevelVisuals(level)
      if (!options?.keepTrails) courseClock = 0

      const prevLie = lie
      const keep =
        !!options?.keepTrails &&
        onFairway(level, prevLie) &&
        !level.bodies.some((b) => {
          const p = bodyPosition(b, 0)
          return Math.hypot(p.x - prevLie.x, p.y - prevLie.y) <= b.radius
        })
      lie = keep ? { x: prevLie.x, y: prevLie.y } : { x: level.tee.x, y: level.tee.y }

      showRestingBall = true
      alien.setWatchTarget(null)
      events.onLieChange({ x: lie.x, y: lie.y })
      const initialAim = defaultAim(level, lie, courseClock)
      // Snap the yaw straight to the fresh aim - a level load is a hard reset, not something to spring into.
      cameraYaw = initialAim.angle
      cameraYawVelocity.v = 0
      lockedYaw = initialAim.angle
      snapCameraToLie(lie)
      applyAim(initialAim, false)
    },

    setAim(next: Aim) {
      applyAim(next, false)
    },

    getAim() {
      return aim
    },

    getLie() {
      return { x: lie.x, y: lie.y }
    },

    fire() {
      if (flying) return
      beginFlight(aim)
    },

    abort() {
      if (!flying) return
      flying = false
      pendingLaunchAim = null
      ballState = null
      postPhase = null
      pendingResult = null
      alienHopK = null
      activeHazardKind = null
      hazardSaucerId = null
      ballMesh.visible = false
      ballGlow.visible = false
      showRestingBall = true
      alien.setWatchTarget(null)
      alien.setAimAngle(aim.angle)
      activeTrail.fadeOut()
      aimDirty = true
    },

    clearTrails() {
      activeTrail.reset()
    },

    isFlying() {
      return flying
    },

    resize() {
      handleResize()
    },

    dispose() {
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      reducedMotionQuery.removeEventListener('change', onReducedMotionChange)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)

      // Force any in-flight particle/flash effects to finish and clean up their scene objects.
      for (const e of [...effects]) e.update(9999)
      effects.length = 0

      for (const v of bodyVisuals) {
        scene.remove(v.group)
        v.dispose()
      }
      for (const wv of wormholeVisuals) {
        scene.remove(wv.group)
        wv.dispose()
      }
      for (const sv of saucerVisuals) {
        scene.remove(sv.visual.group)
        sv.visual.dispose()
      }
      if (chevronTexture) {
        chevronTexture.dispose()
        chevronTexture = null
      }
      if (teeVisual) {
        scene.remove(teeVisual.group)
        teeVisual.dispose()
      }
      if (cupVisual) {
        scene.remove(cupVisual.group)
        cupVisual.dispose()
      }
      if (well) {
        scene.remove(well.mesh)
        well.geometry.dispose()
        well.material.dispose()
        well.maskTexture.dispose()
      }
      if (courseStructure) {
        scene.remove(courseStructure.group)
        courseStructure.dispose()
      }

      activeTrail.dispose()
      particlePool.dispose()

      scene.remove(restBallMesh)
      ballGeometry.dispose()
      ballMaterial.dispose()
      glowMaterial.dispose()
      glowTexture.dispose()

      scene.remove(alien.group)
      alien.dispose()
      scene.remove(backdrop.group)
      backdrop.dispose()
      scene.remove(crowd.group)
      crowd.dispose()

      ribbonGeometry.dispose()
      ribbonMaterial.dispose()
      predictCurveGeometry.dispose()
      predictCurveMaterial.dispose()
      predictionGeometry.dispose()
      predictionMaterial.dispose()

      strokeCircleMaterial.dispose()
      strokeBarGeometry.dispose()
      strokeBarMaterial.dispose()

      nebula.geometry.dispose()
      ;(nebula.material as THREE.Material).dispose()
      stars.geometry.dispose()
      ;(stars.material as THREE.Material).dispose()
      sunSprite.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          const m = obj.material as THREE.Material | THREE.Material[]
          if (Array.isArray(m)) m.forEach((mm) => mm.dispose())
          else m.dispose()
        } else if (obj instanceof THREE.Sprite) {
          obj.material.dispose()
        }
      })

      postFxPass.dispose()
      composer.dispose()
      renderer.dispose()
    },
  }

  return api
}
