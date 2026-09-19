import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'

import type { Aim, Body, Bounds, Level, ProbeState, Rail, SimResult, Vec2 } from '../game/types.ts'
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
  createAtmosphereMaterial,
  createBeamMaterial,
  createGateDiscMaterial,
  createGateRingMaterial,
  createGlowTexture,
  createNebulaSphere,
  createPhotonRingMaterial,
  createPlanetMaterial,
  createStarfield,
  createWellMaterial,
} from './shaders.ts'
import { ActiveTrail, GhostTrailPool } from './trails.ts'

// --- Camera framing constants ------------------------------------------------------------------
const NDC_X_LIMIT = 0.92
const NDC_Y_MIN = -0.7
const NDC_Y_MAX = 0.8
const ELEVATION = THREE.MathUtils.degToRad(55)
const IDLE_SWAY = THREE.MathUtils.degToRad(0.4)
/** Arbitrary pleasant default heading in landscape; portrait adds 90 deg (see fitCameraToLevel). */
const LANDSCAPE_AZIMUTH = Math.PI / 2

const DRAG_THRESHOLD_PX = 8
const AIM_MIN_LENGTH = 0.8
const AIM_MAX_LENGTH = 4.5
const POST_FLIGHT_HOLD = 0.6

/** One entry in the scene per Level.body, dispatched on `kind`. */
interface BodyVisual {
  group: THREE.Group
  update(t: number, dt: number, elapsed: number): void
  dispose(): void
}

interface GateVisual {
  group: THREE.Group
  update(t: number, dt: number, flash: number): void
  dispose(): void
}

/** A short-lived, self-removing particle/flash effect. Returns false from update() when finished. */
interface Effect {
  update(dt: number): boolean
}

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

/** A faint circle showing a body/target's rail, or null if it doesn't ride one. */
function makeRailLine(rail: Rail | undefined, color: number): THREE.Line | null {
  if (!rail) return null
  const segments = 96
  const positions = new Float32Array((segments + 1) * 3)
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    positions[i * 3] = rail.center.x + Math.cos(a) * rail.radius
    positions[i * 3 + 1] = 0.01
    positions[i * 3 + 2] = rail.center.y + Math.sin(a) * rail.radius
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.25 })
  return new THREE.Line(geometry, material)
}

function disposeRail(line: THREE.Line | null): void {
  if (!line) return
  line.geometry.dispose()
  ;(line.material as THREE.Material).dispose()
}

// --- Body visual builders ------------------------------------------------------------------------

function buildPlanetVisual(body: Body, level: Level): BodyVisual {
  const group = new THREE.Group()

  const geometry = new THREE.SphereGeometry(body.radius, 48, 32)
  const material = createPlanetMaterial(body.palette)
  const mesh = new THREE.Mesh(geometry, material)
  group.add(mesh)

  const atmGeometry = new THREE.SphereGeometry(body.radius * 1.18, 32, 24)
  const atmMaterial = createAtmosphereMaterial(body.palette[0])
  group.add(new THREE.Mesh(atmGeometry, atmMaterial))

  let ringMaterial: THREE.MeshBasicMaterial | null = null
  let ringGeometry: THREE.RingGeometry | null = null
  if (body.id === level.homeId) {
    ringGeometry = new THREE.RingGeometry(body.radius * 1.3, body.radius * 1.42, 64)
    ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.x = -Math.PI / 2
    group.add(ring)
  }

  const rail = makeRailLine(body.rail, 0x8899aa)
  if (rail) group.add(rail)

  return {
    group,
    update(t, dt) {
      const p = bodyPosition(body, t)
      group.position.set(p.x, 0, p.y)
      mesh.rotation.y += dt * 0.06
      material.uniforms.uTime.value += dt
      if (ringMaterial) ringMaterial.opacity = 0.22 + 0.18 * Math.sin(material.uniforms.uTime.value * 2.2)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      atmGeometry.dispose()
      atmMaterial.dispose()
      ringGeometry?.dispose()
      ringMaterial?.dispose()
      disposeRail(rail)
    },
  }
}

function buildBlackHoleVisual(body: Body): BodyVisual {
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

  const rail = makeRailLine(body.rail, 0x8899aa)
  if (rail) group.add(rail)

  return {
    group,
    update(t, dt) {
      const p = bodyPosition(body, t)
      group.position.set(p.x, 0, p.y)
      disc.rotation.z += dt * 0.15
      discMaterial.uniforms.uTime.value += dt
      photonMaterial.uniforms.uTime.value += dt
    },
    dispose() {
      coreGeometry.dispose()
      coreMaterial.dispose()
      discGeometry.dispose()
      discMaterial.dispose()
      photonGeometry.dispose()
      photonMaterial.dispose()
      disposeRail(rail)
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
  const rail = makeRailLine(body.rail, 0x8899aa)
  if (rail) group.add(rail)

  return {
    group,
    update(t, dt) {
      const p = bodyPosition(body, t)
      group.position.set(p.x, 0, p.y)
      mesh.rotateOnAxis(spinAxis, dt * 0.15)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      disposeRail(rail)
    },
  }
}

function buildBodyVisual(body: Body, level: Level): BodyVisual {
  switch (body.kind) {
    case 'planet':
    case 'moon':
      return buildPlanetVisual(body, level)
    case 'blackhole':
      return buildBlackHoleVisual(body)
    case 'asteroid':
      return buildAsteroidVisual(body)
    default: {
      const exhaustive: never = body.kind
      throw new Error(`Unknown body kind: ${String(exhaustive)}`)
    }
  }
}

function buildGateVisual(level: Level): GateVisual {
  const group = new THREE.Group()
  const radius = level.target.radius

  const ringGeometry = new THREE.RingGeometry(radius * 0.78, radius, 64)
  const ringMaterial = createGateRingMaterial()
  const ring = new THREE.Mesh(ringGeometry, ringMaterial)
  ring.rotation.x = -Math.PI / 2
  group.add(ring)

  const discGeometry = new THREE.CircleGeometry(radius * 0.75, 48)
  const discMaterial = createGateDiscMaterial()
  const disc = new THREE.Mesh(discGeometry, discMaterial)
  disc.rotation.x = -Math.PI / 2
  disc.position.y = 0.01
  group.add(disc)

  const beamHeight = 3.5
  const beamGeometry = new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, beamHeight, 24, 1, true)
  const beamMaterial = createBeamMaterial()
  const beam = new THREE.Mesh(beamGeometry, beamMaterial)
  beam.position.y = beamHeight / 2
  group.add(beam)

  const rail = makeRailLine(level.target.rail, 0x34d399)
  if (rail) group.add(rail)

  return {
    group,
    update(t, dt, flash) {
      const p = targetPosition(level.target, t)
      group.position.x = p.x
      group.position.z = p.y
      ringMaterial.uniforms.uTime.value += dt
      ringMaterial.uniforms.uFlash.value = flash
      discMaterial.uniforms.uTime.value += dt
      beamMaterial.uniforms.uTime.value += dt
    },
    dispose() {
      ringGeometry.dispose()
      ringMaterial.dispose()
      discGeometry.dispose()
      discMaterial.dispose()
      beamGeometry.dispose()
      beamMaterial.dispose()
      disposeRail(rail)
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
 * The gravity-well ground sheet. It is built with THREE's default PlaneGeometry (authored flat in
 * XY) and rotated -90 deg about X to lie in XZ. That rotation maps local (x, y) -> world
 * (x, -depth, -y) relative to the mesh's own position, so per-frame uniform updates below convert
 * each body's physics position into this local space: localX = worldX - centerX, localY = centerY - worldY.
 */
function buildWellMesh(level: Level): WellVisual {
  const b = level.bounds
  const width = (b.maxX - b.minX) * 1.4
  const depth = (b.maxY - b.minY) * 1.4
  const geometry = new THREE.PlaneGeometry(width, depth, 200, 200)
  const material = createWellMaterial()
  ;(material.uniforms.uHalfExtent.value as THREE.Vector2).set(width / 2, depth / 2)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
  mesh.position.set(center.x, 0, center.y)
  return { mesh, material, geometry, center }
}

function boundsCorners(b: Bounds): THREE.Vector3[] {
  return [
    new THREE.Vector3(b.minX, 0, b.minY),
    new THREE.Vector3(b.minX, 0, b.maxY),
    new THREE.Vector3(b.maxX, 0, b.minY),
    new THREE.Vector3(b.maxX, 0, b.maxY),
  ]
}

export function createEngine(canvas: HTMLCanvasElement, events: EngineEvents): EngineApi {
  // --- Renderer / scene / composer ---------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x05060f, 1)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000)

  const ambient = new THREE.AmbientLight(0xffffff, 0.35)
  const sun = new THREE.DirectionalLight(0xffffff, 1.1)
  sun.position.set(0.6, 0.8, 0.4)
  scene.add(ambient, sun)

  const nebula = createNebulaSphere()
  const stars = createStarfield()
  scene.add(nebula, stars)

  const composer = new EffectComposer(renderer)
  const renderPass = new RenderPass(scene, camera)
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.65, 0.55, 0.8)
  const outputPass = new OutputPass()
  composer.addPass(renderPass)
  composer.addPass(bloomPass)
  composer.addPass(outputPass)

  // --- Trails --------------------------------------------------------------------------------------
  const resolution = new THREE.Vector2(1, 1)
  const activeTrail = new ActiveTrail(resolution)
  scene.add(activeTrail.line)
  const ghostPool = new GhostTrailPool(scene)

  // --- Probe ---------------------------------------------------------------------------------------
  const probeGeometry = new THREE.SphereGeometry(0.12, 16, 16)
  const probeMaterial = new THREE.MeshBasicMaterial({ color: 0xdff9ff })
  const probeMesh = new THREE.Mesh(probeGeometry, probeMaterial)
  probeMesh.visible = false
  scene.add(probeMesh)

  const glowTexture = createGlowTexture()
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const probeGlow = new THREE.Sprite(glowMaterial)
  probeGlow.scale.set(0.6, 0.6, 0.6)
  probeGlow.visible = false
  scene.add(probeGlow)

  // --- Aim indicator (arrow + dotted prediction) ----------------------------------------------------
  const arrowGeometry = new LineSegmentsGeometry()
  arrowGeometry.setPositions(new Float32Array(6))
  const arrowMaterial = new LineMaterial({
    color: 0xfbbf24,
    linewidth: 3,
    worldUnits: false,
    transparent: true,
    resolution,
  })
  const arrowLine = new LineSegments2(arrowGeometry, arrowMaterial)
  arrowLine.frustumCulled = false

  const headGeometry = new THREE.ConeGeometry(0.09, 0.26, 10)
  const headMaterial = new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
  const arrowHead = new THREE.Mesh(headGeometry, headMaterial)

  const predictionGeometry = new THREE.BufferGeometry()
  const predictionMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.055,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
  const predictionPoints = new THREE.Points(predictionGeometry, predictionMaterial)

  const aimGroup = new THREE.Group()
  aimGroup.add(arrowLine, arrowHead, predictionPoints)
  scene.add(aimGroup)

  // --- Gravity well + bodies + gate (rebuilt per level) ----------------------------------------------
  let bodyVisuals: BodyVisual[] = []
  let gateVisual: GateVisual | null = null
  let well: WellVisual | null = null

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
  let camBaseAzimuth = LANDSCAPE_AZIMUTH

  const effects: Effect[] = []

  // --- Effects ---------------------------------------------------------------------------------------
  function spawnCrashEffect(pos: Vec2): void {
    const geometry = new THREE.RingGeometry(0.05, 0.15, 32)
    const material = new THREE.MeshBasicMaterial({
      color: 0xffb703,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(pos.x, 0.1, pos.y)
    scene.add(mesh)
    let t = 0
    effects.push({
      update(dt) {
        t += dt
        const k = Math.min(1, t / 0.5)
        mesh.scale.setScalar(1 + k * 8)
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

  function spawnGoalBurst(pos: Vec2): void {
    const count = 60
    const positions = new Float32Array(count * 3)
    const velocities: THREE.Vector3[] = []
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x
      positions[i * 3 + 1] = 0.1
      positions[i * 3 + 2] = pos.y
      const a = Math.random() * Math.PI * 2
      const speed = 0.5 + Math.random() * 1.5
      velocities.push(new THREE.Vector3(Math.cos(a) * speed, 0.4 + Math.random() * 1.2, Math.sin(a) * speed))
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({
      color: 0x34d399,
      size: 0.12,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const points = new THREE.Points(geometry, material)
    scene.add(points)
    gateFlash = 1
    let t = 0
    effects.push({
      update(dt) {
        t += dt
        const attr = geometry.attributes.position as THREE.BufferAttribute
        const arr = attr.array as Float32Array
        for (let i = 0; i < count; i++) {
          arr[i * 3] += velocities[i].x * dt
          arr[i * 3 + 1] += velocities[i].y * dt
          arr[i * 3 + 2] += velocities[i].z * dt
        }
        attr.needsUpdate = true
        material.opacity = Math.max(0, 1 - t / 0.8)
        if (t >= 0.8) {
          scene.remove(points)
          geometry.dispose()
          material.dispose()
          return false
        }
        return true
      },
    })
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
      const v = buildBodyVisual(body, level)
      scene.add(v.group)
      return v
    })

    if (gateVisual) {
      scene.remove(gateVisual.group)
      gateVisual.dispose()
    }
    gateVisual = buildGateVisual(level)
    scene.add(gateVisual.group)

    if (well) {
      scene.remove(well.mesh)
      well.geometry.dispose()
      well.material.dispose()
    }
    well = buildWellMesh(level)
    scene.add(well.mesh)
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
  }

  // --- Camera fitting -----------------------------------------------------------------------------
  function fitsNdc(corners: THREE.Vector3[]): boolean {
    for (const c of corners) {
      const p = c.clone().project(camera)
      if (Math.abs(p.x) > NDC_X_LIMIT || p.y < NDC_Y_MIN || p.y > NDC_Y_MAX) return false
    }
    return true
  }

  function placeCamera(target: THREE.Vector3, azimuth: number, dist: number): void {
    const dir = new THREE.Vector3(
      Math.cos(azimuth) * Math.cos(ELEVATION),
      Math.sin(ELEVATION),
      Math.sin(azimuth) * Math.cos(ELEVATION),
    )
    camera.position.copy(target).addScaledVector(dir, dist)
    camera.lookAt(target)
    camera.updateMatrixWorld()
  }

  /** Binary search on distance so all four bounds corners fit inside the NDC box reserved for HUD. */
  function solveCameraDistance(target: THREE.Vector3, azimuth: number, corners: THREE.Vector3[]): number {
    let hi = 20
    placeCamera(target, azimuth, hi)
    let guard = 0
    while (!fitsNdc(corners) && guard < 24) {
      hi *= 1.6
      placeCamera(target, azimuth, hi)
      guard++
    }
    let lo = 0.05
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2
      placeCamera(target, azimuth, mid)
      if (fitsNdc(corners)) hi = mid
      else lo = mid
    }
    return hi
  }

  function fitCameraToLevel(): void {
    if (!currentLevel || lastWidth === 0 || lastHeight === 0) return
    camera.aspect = lastWidth / lastHeight
    camera.updateProjectionMatrix()
    const b = currentLevel.bounds
    camTarget = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minY + b.maxY) / 2)
    const portrait = lastHeight > lastWidth
    camBaseAzimuth = LANDSCAPE_AZIMUTH + (portrait ? Math.PI / 2 : 0)
    camDistance = solveCameraDistance(camTarget, camBaseAzimuth, boundsCorners(b))
  }

  function updateCamera(): void {
    const sway = Math.sin(elapsed * 0.15) * IDLE_SWAY
    placeCamera(camTarget, camBaseAzimuth + sway, camDistance)
  }

  // --- Aim indicator --------------------------------------------------------------------------------
  function updateAimIndicator(): void {
    if (!currentLevel || !aimDirty) return
    const home = homeBody(currentLevel)
    const homePos = bodyPosition(home, 0)
    const dirX = Math.cos(aim.angle)
    const dirY = Math.sin(aim.angle)
    const length = THREE.MathUtils.lerp(AIM_MIN_LENGTH, AIM_MAX_LENGTH, aim.power)
    const startR = home.radius + 0.05
    const sx = homePos.x + dirX * startR
    const sz = homePos.y + dirY * startR
    const ex = homePos.x + dirX * (startR + length)
    const ez = homePos.y + dirY * (startR + length)
    arrowGeometry.setPositions(new Float32Array([sx, 0.06, sz, ex, 0.06, ez]))
    arrowHead.position.set(ex, 0.06, ez)
    arrowHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dirX, 0, dirY))

    const path = predictPath(currentLevel, aim, 1.4)
    const count = path.length / 2
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = path[i * 2]
      positions[i * 3 + 1] = 0.06
      positions[i * 3 + 2] = path[i * 2 + 1]
    }
    predictionGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
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
    events.onLaunch(clampAim(a))
    aim = clampAim(a)
    flying = true
    probeState = launchState(currentLevel, aim)
    flightStepCounter = 0
    closestApproach = Infinity
    postFlightTimer = 0
    activeTrail.reset()
    activeTrail.addPoint(probeState.pos.x, probeState.pos.y)
    probeMesh.visible = true
    probeGlow.visible = true
    probeMesh.position.set(probeState.pos.x, 0.15, probeState.pos.y)
    probeGlow.position.copy(probeMesh.position)
  }

  function endFlight(outcome: NonNullable<ReturnType<typeof checkOutcome>['outcome']>, crashedInto: string | null): void {
    if (!probeState) return
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
    if (outcome === 'crash') spawnCrashEffect(probeState.pos)
    if (outcome === 'goal') spawnGoalBurst(targetPosition(currentLevel!.target, probeState.t))
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
      if (flightStepCounter % 2 === 0) activeTrail.addPoint(probeState.pos.x, probeState.pos.y)
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

  function updateVisuals(dt: number): void {
    elapsed += dt
    ;(nebula.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed
    ;(stars.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed

    const tSim = currentTSim(dt)
    for (const v of bodyVisuals) v.update(tSim, dt, elapsed)
    gateFlash = Math.max(0, gateFlash - dt * 2.5)
    gateVisual?.update(tSim, dt, gateFlash)
    updateWellUniforms(tSim)

    if (flying && probeState) {
      probeMesh.position.set(probeState.pos.x, 0.15, probeState.pos.y)
      probeGlow.position.copy(probeMesh.position)
    }

    aimGroup.visible = !flying
    if (!flying) updateAimIndicator()

    updateEffects(dt)
    updateCamera()
  }

  function renderFrame(): void {
    composer.render()
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
  let startHit = new THREE.Vector3()

  function raycastGround(clientX: number, clientY: number, out: THREE.Vector3): THREE.Vector3 | null {
    const rect = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    return raycaster.ray.intersectPlane(groundPlane, out)
  }

  function onPointerDown(e: PointerEvent): void {
    if (flying || activePointerId !== null) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const hit = new THREE.Vector3()
    if (!raycastGround(e.clientX, e.clientY, hit)) return
    activePointerId = e.pointerId
    dragging = false
    startScreen = { x: e.clientX, y: e.clientY }
    startHit = hit
    canvas.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent): void {
    if (activePointerId === null || e.pointerId !== activePointerId) return
    const dx = e.clientX - startScreen.x
    const dy = e.clientY - startScreen.y
    const pixelDist = Math.hypot(dx, dy)
    if (!dragging && pixelDist < DRAG_THRESHOLD_PX) return
    dragging = true
    const hit = new THREE.Vector3()
    if (!raycastGround(e.clientX, e.clientY, hit)) return
    // Slingshot: the launch direction is opposite the drag (pull back to fire forward).
    const dragX = startHit.x - hit.x
    const dragZ = startHit.z - hit.z
    const angle = Math.atan2(dragZ, dragX)
    const rect = canvas.getBoundingClientRect()
    const power = clamp(pixelDist / (0.3 * Math.min(rect.width, rect.height)), MIN_POWER, 1)
    applyAim({ angle, power }, true)
  }

  function onPointerUp(e: PointerEvent): void {
    if (activePointerId === null || e.pointerId !== activePointerId) return
    canvas.releasePointerCapture(activePointerId)
    const wasDragging = dragging
    const hit = new THREE.Vector3()
    const hitOk = raycastGround(e.clientX, e.clientY, hit)
    activePointerId = null
    dragging = false
    if (wasDragging) {
      beginFlight(aim)
    } else if (hitOk) {
      events.onTap({ x: hit.x, y: hit.z })
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

      activeTrail.dispose()
      ghostPool.clear()

      probeGeometry.dispose()
      probeMaterial.dispose()
      glowMaterial.dispose()
      glowTexture.dispose()

      arrowGeometry.dispose()
      arrowMaterial.dispose()
      headGeometry.dispose()
      headMaterial.dispose()
      predictionGeometry.dispose()
      predictionMaterial.dispose()

      nebula.geometry.dispose()
      ;(nebula.material as THREE.Material).dispose()
      stars.geometry.dispose()
      ;(stars.material as THREE.Material).dispose()

      composer.dispose()
      renderer.dispose()
    },
  }

  return api
}
