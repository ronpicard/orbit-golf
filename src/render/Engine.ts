import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

import type { Aim, Body, Level, ProbeState, Rail, SimResult, Vec2 } from '../game/types.ts'
import {
  DT,
  MIN_POWER,
  bodyPosition,
  checkOutcome,
  clampAim,
  defaultAim,
  homeBody,
  launchState,
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
  createCupDiscMaterial,
  createCupRingMaterial,
  createFlagMaterial,
  createGateDiscMaterial,
  createGateRingMaterial,
  createGlowTexture,
  createLensedHaloMaterial,
  createMoonMaterial,
  createNebulaSphere,
  createPhotonRingMaterial,
  createPlanetMaterial,
  createPostFxShader,
  createPredictionDotsMaterial,
  createRingMaterial,
  createStarfield,
  createSunSprite,
  createWellMaterial,
} from './shaders.ts'
import { wellDepthAt } from './sheet.ts'
import { ActiveTrail, GhostTrailPool } from './trails.ts'
import { ParticlePool } from './particles.ts'
import { COLOR_TEE } from './palette.ts'

// --- Camera framing constants ------------------------------------------------------------------
const NDC_X_LIMIT = 0.9
const NDC_Y_MAX_PORTRAIT = 0.74
/** Landscape screens are short, so the hint pill reaches further down in NDC terms. */
const NDC_Y_MAX_LANDSCAPE = 0.6
const FOV = 50
const ELEVATION = THREE.MathUtils.degToRad(30)
/** Fixed heading: camera sits behind home on the -x side, looking toward +x. Same in both orientations. */
const BASE_AZIMUTH = Math.PI
const IDLE_SWAY = THREE.MathUtils.degToRad(0.4)
const CAMERA_TAU = 1.2
const CAMERA_FOLLOW_LOOKAT_FRAC = 0.3
const CAMERA_DOLLY_FRAC = 0.08
const CRASH_SHAKE_DURATION = 0.35
const CRASH_SHAKE_MAX = 0.15

const DRAG_THRESHOLD_PX = 8
const AIM_MIN_LENGTH = 1.2
const AIM_MAX_LENGTH = 6
const POWER_DRAG_DIVISOR = 0.34
const POST_FLIGHT_HOLD = 0.6
const RIBBON_SAMPLES = 12
const RIBBON_HALF_WIDTH = 0.09
const PREDICT_SECONDS = 1.4
const PREDICT_STRIDE = 4

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function hashStringToInt(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return h
}

/** Small deterministic PRNG so an asteroid's jitter is stable across rebuilds. */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
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

// --- Body visual builders ------------------------------------------------------------------------

/** One entry in the scene per Level.body, dispatched on `kind`. */
interface BodyVisual {
  group: THREE.Group
  update(level: Level, t: number, dt: number, elapsed: number): void
  dispose(): void
}

interface GateVisual {
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

function buildPlanetVisual(body: Body, level: Level, _ctx: VisualCtx): BodyVisual {
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

  // Tee box for the home planet: a glowing ring + a small pad on the green, sitting on the sheet.
  let teeRingGeometry: THREE.RingGeometry | null = null
  let teeRingMaterial: THREE.MeshBasicMaterial | null = null
  let teePadGeometry: THREE.PlaneGeometry | null = null
  let teePadMaterial: THREE.MeshBasicMaterial | null = null
  const localSheetOffset = -body.radius * 0.6
  if (body.id === level.homeId) {
    teeRingGeometry = new THREE.RingGeometry(body.radius * 1.3, body.radius * 1.45, 48)
    teeRingMaterial = new THREE.MeshBasicMaterial({
      color: COLOR_TEE,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const teeRing = new THREE.Mesh(teeRingGeometry, teeRingMaterial)
    teeRing.rotation.x = -Math.PI / 2
    teeRing.position.y = localSheetOffset + 0.02
    group.add(teeRing)

    teePadGeometry = new THREE.PlaneGeometry(body.radius * 1.9, body.radius * 1.9)
    teePadMaterial = new THREE.MeshBasicMaterial({
      color: COLOR_TEE,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const teePad = new THREE.Mesh(teePadGeometry, teePadMaterial)
    teePad.rotation.x = -Math.PI / 2
    teePad.position.y = localSheetOffset + 0.015
    group.add(teePad)
  }

  const rail = buildRailVisual(body.rail, 0x8899aa)
  if (rail) group.add(rail.line)

  const sheetOffset = body.radius * 0.6

  return {
    group,
    update(lvl, t, dt, elapsed) {
      const p = bodyPosition(body, t)
      const depth = wellDepthAt(lvl, p.x, p.y, t)
      group.position.set(p.x, -depth + sheetOffset, p.y)
      mesh.rotation.y += dt * 0.06
      if (!isMoon) material.uniforms.uTime.value = elapsed
      if (teeRingMaterial) teeRingMaterial.opacity = 0.4 + 0.25 * Math.sin(elapsed * 2.2)
      rail?.update(lvl, t)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      atmGeometry?.dispose()
      atmMaterial?.dispose()
      ringGeometry?.dispose()
      ringMaterial?.dispose()
      teeRingGeometry?.dispose()
      teeRingMaterial?.dispose()
      teePadGeometry?.dispose()
      teePadMaterial?.dispose()
      rail?.dispose()
    },
  }
}

function buildBlackHoleVisual(body: Body, ctx: VisualCtx): BodyVisual {
  const group = new THREE.Group()

  const coreGeometry = new THREE.SphereGeometry(body.radius, 32, 24)
  const coreMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 })
  group.add(new THREE.Mesh(coreGeometry, coreMaterial))

  const discGeometry = new THREE.RingGeometry(body.radius * 1.5, body.radius * 4.2, 96)
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
      const depth = wellDepthAt(lvl, p.x, p.y, t)
      group.position.set(p.x, -depth + body.radius, p.y)
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
      const depth = wellDepthAt(lvl, p.x, p.y, t)
      group.position.set(p.x, -depth + body.radius * 0.5, p.y)
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

function buildBodyVisual(body: Body, level: Level, ctx: VisualCtx): BodyVisual {
  switch (body.kind) {
    case 'planet':
    case 'moon':
      return buildPlanetVisual(body, level, ctx)
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

/** The upright golf-flag portal: standing energy ring, ground cup, pole and waving flag. */
function buildGateVisual(level: Level, ctx: VisualCtx): GateVisual {
  const group = new THREE.Group()
  const radius = level.target.radius
  const floatHeight = radius * 0.9

  const ringGeometry = new THREE.TorusGeometry(radius * 0.85, 0.06, 12, 48)
  const ringMaterial = createGateRingMaterial()
  const ring = new THREE.Mesh(ringGeometry, ringMaterial)
  ring.rotation.y = Math.PI / 2
  ring.position.y = floatHeight
  group.add(ring)

  const discGeometry = new THREE.CircleGeometry(radius * 0.78, 32)
  const discMaterial = createGateDiscMaterial()
  const disc = new THREE.Mesh(discGeometry, discMaterial)
  disc.rotation.y = Math.PI / 2
  disc.position.y = floatHeight
  group.add(disc)

  const beamHeight = 3.5
  const beamGeometry = new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, beamHeight, 24, 1, true)
  const beamMaterial = createBeamMaterial()
  const beam = new THREE.Mesh(beamGeometry, beamMaterial)
  beam.position.y = beamHeight / 2
  group.add(beam)

  // Ground cup: reads like a golf hole - white rim, dark centre - showing the true capture radius.
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
      ringMaterial.uniforms.uTime.value = elapsed
      ringMaterial.uniforms.uFlash.value = flash
      ringMaterial.uniforms.uProximity.value = proximity
      discMaterial.uniforms.uTime.value = elapsed
      beamMaterial.uniforms.uTime.value = elapsed
      cupRingMaterial.uniforms.uTime.value = elapsed
      flagMaterial.uniforms.uTime.value = elapsed
      rail?.update(lvl, t)

      // ~40 particles drawn gently into the portal.
      drawInTimer -= dt
      if (drawInTimer <= 0) {
        drawInTimer = 0.05
        const a = Math.random() * Math.PI * 2
        const r = radius * (0.6 + Math.random() * 0.8)
        const sx = group.position.x + Math.cos(a) * r
        const sz = group.position.z + Math.sin(a) * r
        const sy = group.position.y + Math.random() * floatHeight * 1.4
        const vx = (group.position.x - sx) * 0.9
        const vz = (group.position.z - sz) * 0.9
        const vy = (group.position.y + floatHeight - sy) * 0.9
        ctx.particlePool.spawn(sx, sy, sz, vx, vy, vz, new THREE.Color(0x6ee7b7), 0.08, 1.1)
      }
    },
    dispose() {
      ringGeometry.dispose()
      ringMaterial.dispose()
      discGeometry.dispose()
      discMaterial.dispose()
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
  center: Vec2
}

/**
 * The fairway ground sheet: a rounded-rectangle patch shaped to the level bounds, pushed down into
 * gravity funnels. Authored flat in XY then rotated -90 deg about X into XZ, so local (x, y) maps to
 * world (x, -depth, -y) relative to the mesh's own position; per-frame uniform updates below convert
 * each body's physics position into this local space: localX = worldX - centerX, localY = centerY - worldY.
 */
function buildWellMesh(level: Level): WellVisual {
  const b = level.bounds
  const halfX = (b.maxX - b.minX) / 2 + 0.5
  const halfY = (b.maxY - b.minY) / 2 + 0.5
  const geomHalfX = halfX + 0.3
  const geomHalfY = halfY + 0.3
  const geometry = new THREE.PlaneGeometry(geomHalfX * 2, geomHalfY * 2, 240, 240)
  const material = createWellMaterial()
  ;(material.uniforms.uHalfExtent.value as THREE.Vector2).set(halfX, halfY)
  material.uniforms.uCornerRadius.value = 1.2
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
  mesh.position.set(center.x, 0, center.y)
  return { mesh, material, geometry, center }
}

/** Neon putt-putt bumper rail following the level bounds, raised above the sheet. */
interface BumperVisual {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  geometry: THREE.TubeGeometry
}

function buildBumper(level: Level): BumperVisual {
  const b = level.bounds
  const corners: Array<[number, number]> = [
    [b.minX, b.minY],
    [(b.minX + b.maxX) / 2, b.minY],
    [b.maxX, b.minY],
    [b.maxX, (b.minY + b.maxY) / 2],
    [b.maxX, b.maxY],
    [(b.minX + b.maxX) / 2, b.maxY],
    [b.minX, b.maxY],
    [b.minX, (b.minY + b.maxY) / 2],
  ]
  const points = corners.map(([x, z]) => {
    const y = -wellDepthAt(level, x, z, 0) + 0.25
    return new THREE.Vector3(x, y, z)
  })
  const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.15)
  const geometry = new THREE.TubeGeometry(curve, 128, 0.09, 8, true)
  const material = createBumperMaterial()
  const mesh = new THREE.Mesh(geometry, material)
  return { mesh, material, geometry }
}

/** Points sampled for fitting the camera: extreme points of every body, rail, target and far corner. */
function buildFitPoints(level: Level): THREE.Vector3[] {
  const t = 0
  const pts: THREE.Vector3[] = []
  const pushExtremes = (cx: number, cz: number, r: number, y: number): void => {
    pts.push(new THREE.Vector3(cx - r, y, cz))
    pts.push(new THREE.Vector3(cx + r, y, cz))
    pts.push(new THREE.Vector3(cx, y, cz - r))
    pts.push(new THREE.Vector3(cx, y, cz + r))
  }
  for (const body of level.bodies) {
    const p = bodyPosition(body, t)
    const y = -wellDepthAt(level, p.x, p.y, t)
    pushExtremes(p.x, p.y, body.radius, y)
    if (body.rail) {
      const r = body.rail
      const yc = -wellDepthAt(level, r.center.x, r.center.y, t)
      pushExtremes(r.center.x, r.center.y, r.radius, yc)
    }
  }
  const tp = targetPosition(level.target, t)
  const ty = -wellDepthAt(level, tp.x, tp.y, t)
  pushExtremes(tp.x, tp.y, level.target.radius, ty)
  if (level.target.rail) {
    const r = level.target.rail
    const yc = -wellDepthAt(level, r.center.x, r.center.y, t)
    pushExtremes(r.center.x, r.center.y, r.radius, yc)
  }
  const b = level.bounds
  pts.push(new THREE.Vector3(b.maxX, 0, 0.8 * b.maxY))
  pts.push(new THREE.Vector3(b.maxX, 0, -0.8 * b.maxY))
  return pts
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
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 4000)

  const ambient = new THREE.AmbientLight(0xffffff, 0.35)
  const sun = new THREE.DirectionalLight(0xffffff, 1.15)
  sun.position.set(-0.6, 0.8, 0.35)
  scene.add(ambient, sun)

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

  const strokeLineGeometry = new THREE.BufferGeometry()
  strokeLineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3))
  const strokeLineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthTest: false })
  const strokeLine = new THREE.Line(strokeLineGeometry, strokeLineMaterial)
  strokeLine.visible = false
  overlayScene.add(strokeLine)

  // --- Particles -------------------------------------------------------------------------------------
  const particlePool = new ParticlePool()
  scene.add(particlePool.points)
  const visualCtx: VisualCtx = { particlePool }

  // --- Trails --------------------------------------------------------------------------------------
  const resolution = new THREE.Vector2(1, 1)
  const activeTrail = new ActiveTrail(resolution)
  scene.add(activeTrail.group)
  const ghostPool = new GhostTrailPool(scene)

  // --- Probe: a glossy white golf ball ---------------------------------------------------------------
  const probeGeometry = new THREE.SphereGeometry(0.12, 20, 16)
  const probeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.05 })
  const probeMesh = new THREE.Mesh(probeGeometry, probeMaterial)
  probeMesh.visible = false
  scene.add(probeMesh)

  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const probeGlow = new THREE.Sprite(glowMaterial)
  probeGlow.scale.set(0.5, 0.5, 0.5)
  probeGlow.visible = false
  scene.add(probeGlow)

  // --- Aim indicator: flat ribbon + shrinking prediction dots -----------------------------------------
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

  const aimGroup = new THREE.Group()
  aimGroup.add(ribbonMesh, predictionPoints)
  scene.add(aimGroup)

  // --- Gravity well + bodies + gate + bumper (rebuilt per level) ----------------------------------------------
  let bodyVisuals: BodyVisual[] = []
  let gateVisual: GateVisual | null = null
  let well: WellVisual | null = null
  let bumper: BumperVisual | null = null

  // --- Mutable engine state --------------------------------------------------------------------------
  let currentLevel: Level | null = null
  let aim: Aim = { angle: 0, power: 0.5 }
  let aimDirty = true
  let flying = false
  let probeState: ProbeState | null = null
  let flightStepCounter = 0
  let closestApproach = Infinity
  let postFlightT = 0
  let postFlightTimer = 0
  let gateFlash = 0
  let elapsed = 0
  let lastWidth = 0
  let lastHeight = 0

  let camTarget = new THREE.Vector3()
  let camDistance = 20
  const camFollowLookAt = new THREE.Vector3()
  let camFollowDistance = 20
  let shakeTimer = 0

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

  function spawnCrashEffect(pos: Vec2, y: number): void {
    spawnRingEffect(pos, y, 0xffb703, 8, 0.5)
    const count = 40 + Math.floor(Math.random() * 30)
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const speed = 1 + Math.random() * 3
      const vy = Math.random() * 1.5
      particlePool.spawn(
        pos.x,
        y + 0.1,
        pos.y,
        Math.cos(a) * speed,
        vy,
        Math.sin(a) * speed,
        new THREE.Color(Math.random() > 0.5 ? 0xffb703 : 0xff8a3d),
        0.09 + Math.random() * 0.08,
        0.5 + Math.random() * 0.5,
        { drag: 1.2 },
      )
    }
    triggerShake()
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

  function updateEffects(dt: number): void {
    for (let i = effects.length - 1; i >= 0; i--) {
      if (!effects[i].update(dt)) effects.splice(i, 1)
    }
  }

  // --- Level / body rebuild ---------------------------------------------------------------------------
  function rebuildLevelVisuals(level: Level): void {
    for (const v of bodyVisuals) {
      scene.remove(v.group)
      v.dispose()
    }
    bodyVisuals = level.bodies.map((body) => {
      const v = buildBodyVisual(body, level, visualCtx)
      scene.add(v.group)
      return v
    })

    if (gateVisual) {
      scene.remove(gateVisual.group)
      gateVisual.dispose()
    }
    gateVisual = buildGateVisual(level, visualCtx)
    scene.add(gateVisual.group)

    if (well) {
      scene.remove(well.mesh)
      well.geometry.dispose()
      well.material.dispose()
    }
    well = buildWellMesh(level)
    scene.add(well.mesh)

    if (bumper) {
      scene.remove(bumper.mesh)
      bumper.geometry.dispose()
      bumper.material.dispose()
    }
    bumper = buildBumper(level)
    scene.add(bumper.mesh)
  }

  function updateWellUniforms(tSim: number): void {
    if (!well || !currentLevel) return
    const massive = currentLevel.bodies.filter((b) => b.mu > 0).slice(0, MAX_WELL_BODIES)
    const bodiesUniform = well.material.uniforms.uBodies.value as THREE.Vector3[]
    const softUniform = well.material.uniforms.uSoft.value as Float32Array
    const { x: cx, y: cy } = well.center
    massive.forEach((body, i) => {
      const p = bodyPosition(body, tSim)
      // See buildWellMesh's doc comment for this local-space transform.
      // Shader layout: xz = position in the sheet's local space, y = mu.
      bodiesUniform[i].set(p.x - cx, body.mu, cy - p.y)
      softUniform[i] = body.radius
    })
    well.material.uniforms.uCount.value = massive.length
    well.material.uniforms.uCameraPos.value.copy(camera.position)
    well.material.uniforms.uTime.value = elapsed
  }

  // --- Camera fitting -----------------------------------------------------------------------------
  function fitsNdc(points: THREE.Vector3[], yMin: number): boolean {
    for (const p of points) {
      const proj = p.clone().project(camera)
      if (Math.abs(proj.x) > NDC_X_LIMIT || proj.y < yMin || proj.y > (lastHeight > lastWidth ? NDC_Y_MAX_PORTRAIT : NDC_Y_MAX_LANDSCAPE)) return false
    }
    return true
  }

  function placeCameraAt(target: THREE.Vector3, azimuth: number, dist: number): void {
    const dir = new THREE.Vector3(
      Math.cos(azimuth) * Math.cos(ELEVATION),
      Math.sin(ELEVATION),
      Math.sin(azimuth) * Math.cos(ELEVATION),
    )
    camera.position.copy(target).addScaledVector(dir, dist)
    camera.lookAt(target)
    camera.updateMatrixWorld()
  }

  /** Binary search on distance so every point of interest fits inside the NDC box reserved for HUD. */
  function solveCameraDistance(target: THREE.Vector3, azimuth: number, points: THREE.Vector3[], yMin: number): number {
    let hi = 20
    placeCameraAt(target, azimuth, hi)
    let guard = 0
    while (!fitsNdc(points, yMin) && guard < 24) {
      hi *= 1.6
      placeCameraAt(target, azimuth, hi)
      guard++
    }
    let lo = 0.05
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2
      placeCameraAt(target, azimuth, mid)
      if (fitsNdc(points, yMin)) hi = mid
      else lo = mid
    }
    return hi
  }

  function fitCameraToLevel(): void {
    if (!currentLevel || lastWidth === 0 || lastHeight === 0) return
    camera.aspect = lastWidth / lastHeight
    camera.updateProjectionMatrix()
    const level = currentLevel
    const home = homeBody(level)
    const homePos = bodyPosition(home, 0)
    const farX = level.bounds.maxX
    const portrait = lastHeight > lastWidth
    const yMin = portrait ? -0.52 : -0.62
    const points = buildFitPoints(level)
    // Slide the look-at point along the course and keep the framing that gets the camera closest,
    // so the green fills the view on wide desktop screens as well as tall phones.
    let bestDistance = Infinity
    for (let f = 0.2; f <= 0.8001; f += 0.05) {
      const candidate = new THREE.Vector3(homePos.x + f * (farX - homePos.x), -0.5, homePos.y)
      const d = solveCameraDistance(candidate, BASE_AZIMUTH, points, yMin)
      if (d < bestDistance) {
        bestDistance = d
        camTarget = candidate
      }
    }
    camDistance = bestDistance
    camFollowLookAt.copy(camTarget)
    camFollowDistance = camDistance
  }

  function updateCamera(dt: number): void {
    const sway = reducedMotion ? 0 : Math.sin(elapsed * 0.15) * IDLE_SWAY

    let desiredLookAt = camTarget
    let desiredDistance = camDistance
    if (flying && probeState && !reducedMotion) {
      const probeWorld = probeMesh.position
      desiredLookAt = camTarget.clone().lerp(probeWorld, CAMERA_FOLLOW_LOOKAT_FRAC)
      desiredDistance = camDistance * (1 - CAMERA_DOLLY_FRAC)
    }

    if (reducedMotion) {
      camFollowLookAt.copy(desiredLookAt)
      camFollowDistance = desiredDistance
    } else {
      const alpha = 1 - Math.exp(-dt / CAMERA_TAU)
      camFollowLookAt.lerp(desiredLookAt, alpha)
      camFollowDistance += (desiredDistance - camFollowDistance) * alpha
    }

    placeCameraAt(camFollowLookAt, BASE_AZIMUTH + sway, camFollowDistance)

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
    const home = homeBody(level)
    const homePos = bodyPosition(home, 0)
    const dirX = Math.cos(aim.angle)
    const dirY = Math.sin(aim.angle)
    const perpX = -dirY
    const perpZ = dirX
    const length = THREE.MathUtils.lerp(AIM_MIN_LENGTH, AIM_MAX_LENGTH, aim.power)
    const startR = home.radius + 0.05

    for (let i = 0; i < RIBBON_SAMPLES; i++) {
      const frac = i / (RIBBON_SAMPLES - 1)
      const d = startR + length * frac
      const x = homePos.x + dirX * d
      const z = homePos.y + dirY * d
      const y = -wellDepthAt(level, x, z, 0) + 0.05
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

    const path = predictPath(level, aim, PREDICT_SECONDS, PREDICT_STRIDE)
    const count = path.length / 2
    const positions = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const px = path[i * 2]
      const pz = path[i * 2 + 1]
      const t = i * PREDICT_STRIDE * DT
      const py = -wellDepthAt(level, px, pz, t) + 0.06
      positions[i * 3] = px
      positions[i * 3 + 1] = py
      positions[i * 3 + 2] = pz
      sizes[i] = THREE.MathUtils.lerp(0.13, 0.03, i / Math.max(1, count - 1))
    }
    predictionGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    predictionGeometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1))
    aimDirty = false
  }

  function applyAim(next: Aim, dragging: boolean): void {
    aim = clampAim(next)
    aimDirty = true
    updateAimIndicator()
    events.onAimChange(aim, dragging)
  }

  // --- Flight ------------------------------------------------------------------------------------
  function beginFlight(a: Aim): void {
    if (!currentLevel || flying) return
    const launchAim = clampAim(a)
    events.onLaunch(launchAim)
    aim = launchAim
    flying = true
    probeState = launchState(currentLevel, aim)
    flightStepCounter = 0
    closestApproach = Infinity
    postFlightTimer = 0
    activeTrail.reset()
    const depth0 = wellDepthAt(currentLevel, probeState.pos.x, probeState.pos.y, 0)
    const y0 = -depth0 + 0.14
    activeTrail.addPoint(probeState.pos.x, y0, probeState.pos.y)
    probeMesh.visible = true
    probeGlow.visible = true
    probeMesh.position.set(probeState.pos.x, y0, probeState.pos.y)
    probeGlow.position.copy(probeMesh.position)
    spawnLaunchShockwave(bodyPosition(homeBody(currentLevel), 0), -depth0)
  }

  function endFlight(outcome: NonNullable<ReturnType<typeof checkOutcome>['outcome']>, crashedInto: string | null): void {
    if (!probeState || !currentLevel) return
    flying = false
    const result: SimResult = { outcome, crashedInto, time: probeState.t, closest: closestApproach }
    postFlightT = probeState.t
    postFlightTimer = POST_FLIGHT_HOLD
    probeMesh.visible = false
    probeGlow.visible = false
    if (activeTrail.hasSegments()) {
      const ghost = activeTrail.toGhost(outcome === 'goal' ? 'goal' : 'other')
      ghost.setResolution(lastWidth, lastHeight)
      ghostPool.add(ghost)
    }
    activeTrail.reset()
    const depthEnd = wellDepthAt(currentLevel, probeState.pos.x, probeState.pos.y, probeState.t)
    if (outcome === 'crash') spawnCrashEffect(probeState.pos, -depthEnd)
    if (outcome === 'goal') spawnGoalBurst(targetPosition(currentLevel.target, probeState.t), -depthEnd)
    aimDirty = true
    events.onResult(result)
  }

  function stepFlight(dt: number): void {
    if (!flying || !probeState || !currentLevel) return
    accumulator += dt
    while (accumulator >= DT && flying && probeState) {
      step(currentLevel, probeState)
      accumulator -= DT
      flightStepCounter++
      const check = checkOutcome(currentLevel, probeState)
      if (check.targetDistance < closestApproach) closestApproach = check.targetDistance
      if (flightStepCounter % 2 === 0) {
        const depth = wellDepthAt(currentLevel, probeState.pos.x, probeState.pos.y, probeState.t)
        activeTrail.addPoint(probeState.pos.x, -depth + 0.14, probeState.pos.y)
      }
      if (check.outcome) {
        endFlight(check.outcome, check.crashedInto)
        break
      }
    }
  }
  let accumulator = 0

  // --- Per-frame visuals ----------------------------------------------------------------------------
  function currentTSim(dt: number): number {
    if (flying && probeState) return probeState.t
    if (postFlightTimer > 0) {
      postFlightTimer -= dt
      if (postFlightTimer <= 0) {
        postFlightTimer = 0
        return 0
      }
      return postFlightT
    }
    return 0
  }

  function currentProximity(level: Level): number {
    if (!flying || !probeState) return 0
    const tp = targetPosition(level.target, probeState.t)
    const dist = Math.hypot(tp.x - probeState.pos.x, tp.y - probeState.pos.y)
    return clamp(1 - dist / (level.target.radius * 6), 0, 1)
  }

  function updateVisuals(dt: number): void {
    elapsed += dt
    ;(nebula.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed
    ;(stars.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed
    if (bumper) bumper.material.uniforms.uTime.value = elapsed

    const level = currentLevel
    const tSim = currentTSim(dt)
    if (level) {
      for (const v of bodyVisuals) v.update(level, tSim, dt, elapsed)
      gateFlash = Math.max(0, gateFlash - dt * 2.5)
      gateVisual?.update(level, tSim, dt, elapsed, gateFlash, currentProximity(level))
      updateWellUniforms(tSim)
    }

    if (flying && probeState && level) {
      const depth = wellDepthAt(level, probeState.pos.x, probeState.pos.y, probeState.t)
      probeMesh.position.set(probeState.pos.x, -depth + 0.14, probeState.pos.y)
      probeGlow.position.copy(probeMesh.position)
      // ~2 comet sparks per frame while flying.
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2
        const s = 0.2 + Math.random() * 0.4
        particlePool.spawn(
          probeMesh.position.x,
          probeMesh.position.y,
          probeMesh.position.z,
          Math.cos(a) * s,
          (Math.random() - 0.5) * s,
          Math.sin(a) * s,
          new THREE.Color(0x9be8ff),
          0.06,
          1.0,
          { drag: 0.8 },
        )
      }
    }

    aimGroup.visible = !flying
    if (!flying) updateAimIndicator()

    updateEffects(dt)
    particlePool.update(dt)
    updateCamera(dt)
  }

  function renderFrame(): void {
    composer.render()
    strokeCircle.visible = dragging
    strokeLine.visible = dragging
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
    ghostPool.setResolution(w, h)
    activeTrail.setResolution(w, h)
    overlayCamera.right = w
    overlayCamera.bottom = h
    overlayCamera.updateProjectionMatrix()

    const coarse = coarsePointerQuery.matches || w < 700
    if (coarse) bloomPass.setSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)))

    fitCameraToLevel()
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

  function raycastGround(clientX: number, clientY: number, out: THREE.Vector3): THREE.Vector3 | null {
    const rect = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    return raycaster.ray.intersectPlane(groundPlane, out)
  }

  function projectToPixel(world: THREE.Vector3, rect: DOMRect): { x: number; y: number } {
    const ndc = world.clone().project(camera)
    return { x: ((ndc.x * 0.5 + 0.5) * rect.width) + rect.left, y: ((1 - (ndc.y * 0.5 + 0.5)) * rect.height) + rect.top }
  }

  /**
   * The launch direction is the world-plane direction whose on-screen projection is parallel to the
   * screen-space drag vector: build the 2x2 Jacobian of screen offset per world offset at the home
   * planet, invert it, and apply it to the drag vector so "drag toward the shot" feels literal.
   */
  function computeDragAngle(dragPxX: number, dragPxY: number): number {
    if (!currentLevel) return aim.angle
    const level = currentLevel
    const home = homeBody(level)
    const homePos = bodyPosition(home, 0)
    const rect = canvas.getBoundingClientRect()
    const sheetY = (x: number, z: number): number => -wellDepthAt(level, x, z, 0)
    const P = new THREE.Vector3(homePos.x, sheetY(homePos.x, homePos.y), homePos.y)
    const Px = new THREE.Vector3(homePos.x + 1, sheetY(homePos.x + 1, homePos.y), homePos.y)
    const Pz = new THREE.Vector3(homePos.x, sheetY(homePos.x, homePos.y + 1), homePos.y + 1)
    const pP = projectToPixel(P, rect)
    const pPx = projectToPixel(Px, rect)
    const pPz = projectToPixel(Pz, rect)
    const j11 = pPx.x - pP.x
    const j21 = pPx.y - pP.y
    const j12 = pPz.x - pP.x
    const j22 = pPz.y - pP.y
    const det = j11 * j22 - j12 * j21

    let dx: number
    let dz: number
    if (Math.abs(det) < 1e-6) {
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
      camRight.y = 0
      if (camRight.lengthSq() < 1e-9) camRight.set(1, 0, 0)
      camRight.normalize()
      const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
      camForward.y = 0
      if (camForward.lengthSq() < 1e-9) camForward.set(0, 0, -1)
      camForward.normalize()
      dx = camRight.x * dragPxX - camForward.x * dragPxY
      dz = camRight.z * dragPxX - camForward.z * dragPxY
    } else {
      const invDet = 1 / det
      dx = (j22 * dragPxX - j12 * dragPxY) * invDet
      dz = (-j21 * dragPxX + j11 * dragPxY) * invDet
    }
    const len = Math.hypot(dx, dz) || 1
    return Math.atan2(dz / len, dx / len)
  }

  function onPointerDown(e: PointerEvent): void {
    if (flying || activePointerId !== null) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    activePointerId = e.pointerId
    dragging = false
    startScreen = { x: e.clientX, y: e.clientY }
    canvas.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent): void {
    if (activePointerId === null || e.pointerId !== activePointerId) return
    const dx = e.clientX - startScreen.x
    const dy = e.clientY - startScreen.y
    const pixelDist = Math.hypot(dx, dy)
    if (!dragging && pixelDist < DRAG_THRESHOLD_PX) return
    dragging = true
    const angle = computeDragAngle(dx, dy)
    const rect = canvas.getBoundingClientRect()
    const power = clamp(pixelDist / (POWER_DRAG_DIVISOR * Math.min(rect.width, rect.height)), MIN_POWER, 1)
    applyAim({ angle, power }, true)

    strokeCircle.position.set(startScreen.x, startScreen.y, 0)
    const posAttr = strokeLineGeometry.attributes.position as THREE.BufferAttribute
    posAttr.setXYZ(0, startScreen.x, startScreen.y, 0)
    posAttr.setXYZ(1, e.clientX, e.clientY, 0)
    posAttr.needsUpdate = true
  }

  function onPointerUp(e: PointerEvent): void {
    if (activePointerId === null || e.pointerId !== activePointerId) return
    canvas.releasePointerCapture(activePointerId)
    const wasDragging = dragging
    activePointerId = null
    dragging = false
    if (wasDragging) {
      beginFlight(aim)
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
      // Abort any in-flight probe silently (no onResult), matching loadLevel's contract.
      if (flying) {
        flying = false
        probeState = null
        probeMesh.visible = false
        probeGlow.visible = false
        activeTrail.reset()
      }
      currentLevel = level
      rebuildLevelVisuals(level)
      if (!options?.keepTrails) {
        aim = defaultAim(level)
        ghostPool.clear()
      }
      aimDirty = true
      postFlightTimer = 0
      fitCameraToLevel()
      updateAimIndicator()
    },

    setAim(next: Aim) {
      applyAim(next, false)
    },

    getAim() {
      return aim
    },

    fire() {
      if (flying) return
      beginFlight(aim)
    },

    abort() {
      if (!flying) return
      flying = false
      probeState = null
      probeMesh.visible = false
      probeGlow.visible = false
      activeTrail.reset()
      aimDirty = true
    },

    clearTrails() {
      activeTrail.reset()
      ghostPool.clear()
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
      if (gateVisual) {
        scene.remove(gateVisual.group)
        gateVisual.dispose()
      }
      if (well) {
        scene.remove(well.mesh)
        well.geometry.dispose()
        well.material.dispose()
      }
      if (bumper) {
        scene.remove(bumper.mesh)
        bumper.geometry.dispose()
        bumper.material.dispose()
      }

      activeTrail.dispose()
      ghostPool.clear()
      particlePool.dispose()

      probeGeometry.dispose()
      probeMaterial.dispose()
      glowMaterial.dispose()
      glowTexture.dispose()

      ribbonGeometry.dispose()
      ribbonMaterial.dispose()
      predictionGeometry.dispose()
      predictionMaterial.dispose()

      strokeCircleMaterial.dispose()
      strokeLineGeometry.dispose()
      strokeLineMaterial.dispose()

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
