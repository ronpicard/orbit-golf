import * as THREE from 'three'
import type { Level } from '../game/types.ts'
import { createGlowTexture, createMoonMaterial, createPlanetMaterial } from './shaders.ts'

/**
 * Decorative background life: saucers, satellites, a space station, an asteroid belt, floating
 * astronauts, a distant gas giant + moons, nebula sprites, a comet and shooting stars. Everything
 * here is pure decoration - it stays outside `level.bounds` and below/behind the fairway, is dimmer
 * than gameplay objects, and is rebuilt (cheaply) on every loadLevel() from the new bounds.
 */

export interface BackdropOptions {
  lowPerf: boolean
}

export interface Backdrop {
  group: THREE.Group
  build(level: Level, options: BackdropOptions): void
  update(dt: number, elapsed: number, reducedMotion: boolean): void
  dispose(): void
}

function seeded(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

// --- Shared geometry/material factories (cheap, reused across instances) --------------------------

function dimStandard(color: number, opts?: { emissive?: number; emissiveIntensity?: number }): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.7,
    metalness: 0.15,
    emissive: opts?.emissive ?? 0x000000,
    emissiveIntensity: opts?.emissiveIntensity ?? 0,
  })
}

// --- Saucer ----------------------------------------------------------------------------------------

interface Saucer {
  group: THREE.Group
  pathPhase: number
  pathSpeed: number
  radiusX: number
  radiusZ: number
  centerX: number
  centerZ: number
  baseY: number
  zipTimer: number
  zipping: number
  lights: THREE.Mesh
  lightMat: THREE.MeshStandardMaterial
}

function buildSaucerTemplate(disposeBag: (() => void)[]): {
  makeInstance(): Saucer['group']
  lightRef(group: THREE.Group): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial }
} {
  const hullGeo = new THREE.SphereGeometry(1, 20, 8)
  hullGeo.scale(1, 0.22, 1)
  const domeGeo = new THREE.SphereGeometry(0.42, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5)
  const alienHeadGeo = new THREE.SphereGeometry(0.12, 10, 8)
  const beamGeo = new THREE.ConeGeometry(0.55, 1, 16, 1, true)
  disposeBag.push(() => {
    hullGeo.dispose()
    domeGeo.dispose()
    alienHeadGeo.dispose()
    beamGeo.dispose()
  })

  const hullMat = dimStandard(0x94a3b8)
  const domeMat = new THREE.MeshPhysicalMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.4, roughness: 0.1, transmission: 0.4 })
  const alienHeadMat = dimStandard(0x4ade80, { emissive: 0x22c55e, emissiveIntensity: 0.2 })
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x86efac, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false })
  const lightsGeo = new THREE.SphereGeometry(0.05, 6, 6)
  disposeBag.push(() => {
    hullMat.dispose()
    domeMat.dispose()
    alienHeadMat.dispose()
    beamMat.dispose()
    lightsGeo.dispose()
  })

  function makeInstance(): THREE.Group {
    const g = new THREE.Group()
    const hull = new THREE.Mesh(hullGeo, hullMat)
    hull.scale.setScalar(1.4)
    g.add(hull)
    const dome = new THREE.Mesh(domeGeo, domeMat)
    dome.position.y = 0.12
    g.add(dome)
    const head = new THREE.Mesh(alienHeadGeo, alienHeadMat)
    head.position.y = 0.2
    g.add(head)
    const beam = new THREE.Mesh(beamGeo, beamMat)
    beam.position.y = -0.5
    g.add(beam)

    const ringLights = new THREE.InstancedMesh(lightsGeo, dimStandard(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1 }), 10)
    const m = new THREE.Matrix4()
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      m.makeTranslation(Math.cos(a) * 1.35, 0, Math.sin(a) * 1.35)
      ringLights.setMatrixAt(i, m)
    }
    g.add(ringLights)
    g.userData.ringLights = ringLights
    return g
  }

  function lightRef(group: THREE.Group): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
    const mesh = group.userData.ringLights as THREE.Mesh
    return { mesh, mat: mesh.material as THREE.MeshStandardMaterial }
  }

  return { makeInstance, lightRef }
}

// --- Satellite / space station -----------------------------------------------------------------

function buildSatellite(disposeBag: (() => void)[]): THREE.Group {
  const g = new THREE.Group()
  const bodyGeo = new THREE.BoxGeometry(0.3, 0.22, 0.22)
  const bodyMat = dimStandard(0xcbd5e1)
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  g.add(body)

  const panelGeo = new THREE.BoxGeometry(0.5, 0.02, 0.18)
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.4, metalness: 0.5, emissive: 0x0f2f6b, emissiveIntensity: 0.25 })
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(panelGeo, panelMat)
    panel.position.x = side * 0.4
    g.add(panel)
  }

  const dishGeo = new THREE.ConeGeometry(0.12, 0.08, 12, 1, true)
  const dishMat = dimStandard(0xe2e8f0)
  const dish = new THREE.Mesh(dishGeo, dishMat)
  dish.position.set(0, 0.1, 0.16)
  dish.rotation.x = Math.PI * 0.6
  g.add(dish)

  const beaconGeo = new THREE.SphereGeometry(0.025, 6, 6)
  const beaconMat = dimStandard(0xff4d4d, { emissive: 0xff4d4d, emissiveIntensity: 1 })
  const beacon = new THREE.Mesh(beaconGeo, beaconMat)
  beacon.position.set(0.16, 0.1, -0.1)
  g.add(beacon)
  g.userData.beacon = beacon
  g.userData.beaconMat = beaconMat

  disposeBag.push(() => {
    bodyGeo.dispose()
    bodyMat.dispose()
    panelGeo.dispose()
    panelMat.dispose()
    dishGeo.dispose()
    dishMat.dispose()
    beaconGeo.dispose()
    beaconMat.dispose()
  })
  return g
}

function buildStation(disposeBag: (() => void)[]): THREE.Group {
  const g = new THREE.Group()
  const ringGeo = new THREE.TorusGeometry(1.4, 0.12, 10, 40)
  const ringMat = dimStandard(0x94a3b8)
  const ring = new THREE.Mesh(ringGeo, ringMat)
  g.add(ring)
  const hubGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.6, 16)
  const hubMat = dimStandard(0xcbd5e1)
  const hub = new THREE.Mesh(hubGeo, hubMat)
  hub.rotation.z = Math.PI / 2
  g.add(hub)
  const panelGeo = new THREE.BoxGeometry(1.6, 0.03, 0.5)
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.4, metalness: 0.5 })
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(panelGeo, panelMat)
    panel.position.x = side * 1.1
    g.add(panel)
  }
  disposeBag.push(() => {
    ringGeo.dispose()
    ringMat.dispose()
    hubGeo.dispose()
    hubMat.dispose()
    panelGeo.dispose()
    panelMat.dispose()
  })
  return g
}

// --- Astronaut -----------------------------------------------------------------------------------

function buildAstronaut(disposeBag: (() => void)[]): THREE.Group {
  const g = new THREE.Group()
  const suitMat = dimStandard(0xf1f5f9, { emissive: 0xffffff, emissiveIntensity: 0.03 })
  const visorMat = dimStandard(0xd4af37, { emissive: 0xd4af37, emissiveIntensity: 0.15 })
  const torsoGeo = new THREE.CapsuleGeometry(0.16, 0.28, 4, 10)
  const torso = new THREE.Mesh(torsoGeo, suitMat)
  g.add(torso)
  const headGeo = new THREE.SphereGeometry(0.14, 14, 10)
  const head = new THREE.Mesh(headGeo, visorMat)
  head.position.y = 0.32
  g.add(head)
  const limbGeo = new THREE.CapsuleGeometry(0.05, 0.24, 4, 8)
  const armR = new THREE.Mesh(limbGeo, suitMat)
  armR.position.set(0.22, 0.05, 0)
  armR.rotation.z = -0.5
  g.add(armR)
  const armL = new THREE.Mesh(limbGeo, suitMat)
  armL.position.set(-0.2, -0.05, 0)
  armL.rotation.z = 0.9
  g.add(armL)
  const legGeo = new THREE.CapsuleGeometry(0.055, 0.26, 4, 8)
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, suitMat)
    leg.position.set(side * 0.09, -0.32, 0)
    leg.rotation.z = side * 0.15
    g.add(leg)
  }
  g.userData.waveArm = armR
  disposeBag.push(() => {
    suitMat.dispose()
    visorMat.dispose()
    torsoGeo.dispose()
    headGeo.dispose()
    limbGeo.dispose()
    legGeo.dispose()
  })
  return g
}

// --- Sprites (nebula glow, comet head, shooting stars) --------------------------------------------

function makeSprite(texture: THREE.Texture, color: number, opacity: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({ map: texture, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending })
  return new THREE.Sprite(mat)
}

// --- Main factory ----------------------------------------------------------------------------------

export function createBackdrop(): Backdrop {
  const group = new THREE.Group()
  group.renderOrder = -5
  let disposeBag: (() => void)[] = []
  const glowTexture = createGlowTexture()

  // Rebuilt-per-level state ------------------------------------------------------------------------
  let saucers: Saucer[] = []
  let satellites: Array<{ group: THREE.Group; orbitR: number; orbitPhase: number; orbitSpeed: number; centerX: number; centerZ: number; y: number; spin: THREE.Vector3 }> = []
  let station: THREE.Group | null = null
  let asteroidField: {
    meshes: THREE.InstancedMesh[]
    data: Array<{ pos: THREE.Vector3; vel: THREE.Vector3; axis: THREE.Vector3; spin: number; angle: number; meshIndex: number; instIndex: number }>
    bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
  } | null = null
  let astronauts: Array<{ group: THREE.Group; basePos: THREE.Vector3; phase: number; waveTimer: number }> = []
  let gasGiant: THREE.Group | null = null
  let nebulaSprites: THREE.Sprite[] = []
  let comet: { head: THREE.Sprite; trailGeo: THREE.BufferGeometry; trail: THREE.Line; points: THREE.Vector3[]; active: boolean; t: number; timer: number; withTail: boolean } | null = null
  let shootingStars: Array<{ line: THREE.Line; geo: THREE.BufferGeometry; timer: number; active: boolean; t: number; start: THREE.Vector3; end: THREE.Vector3 }> = []

  function clearAll(): void {
    for (const fn of disposeBag) fn()
    disposeBag = []
    group.clear()
    saucers = []
    satellites = []
    station = null
    asteroidField = null
    astronauts = []
    gasGiant = null
    nebulaSprites = []
    comet = null
    shootingStars = []
  }

  function build(level: Level, options: BackdropOptions): void {
    clearAll()
    const b = level.bounds
    const spanX = b.maxX - b.minX
    const spanY = b.maxY - b.minY
    const rand = seeded(Math.floor((b.maxX + b.maxY) * 1000) + 7)

    // --- Saucers -----------------------------------------------------------------------------
    const saucerTemplate = buildSaucerTemplate(disposeBag)
    const saucerCount = options.lowPerf ? 1 : 2 + Math.floor(rand() * 2) // 2-3, or 1 on phones
    for (let i = 0; i < saucerCount; i++) {
      const g = saucerTemplate.makeInstance()
      const centerX = b.minX + spanX * (0.2 + rand() * 0.6)
      const centerZ = (b.maxY + 4 + rand() * 6) * (rand() > 0.5 ? 1 : -1)
      const s: Saucer = {
        group: g,
        pathPhase: rand() * Math.PI * 2,
        pathSpeed: 0.06 + rand() * 0.05,
        radiusX: spanX * (0.15 + rand() * 0.15),
        radiusZ: 2.5 + rand() * 2,
        centerX,
        centerZ,
        baseY: 3.5 + rand() * 2.5,
        zipTimer: 10 + rand() * 10,
        zipping: 0,
        lights: saucerTemplate.lightRef(g).mesh,
        lightMat: saucerTemplate.lightRef(g).mat,
      }
      saucers.push(s)
      group.add(g)
    }

    // --- Satellites + station ------------------------------------------------------------------
    for (let i = 0; i < 2; i++) {
      const g = buildSatellite(disposeBag)
      satellites.push({
        group: g,
        orbitR: spanX * 0.4 + i * 3,
        orbitPhase: rand() * Math.PI * 2,
        orbitSpeed: 0.03 + rand() * 0.02,
        centerX: b.minX + spanX * 0.5,
        centerZ: 0,
        y: 6 + rand() * 4 + i * 2,
        spin: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
      })
      group.add(g)
    }
    station = buildStation(disposeBag)
    station.position.set(b.maxX + spanX * 0.5, 10, -spanY)
    station.scale.setScalar(1.8)
    group.add(station)

    // --- Asteroid belt ---------------------------------------------------------------------------
    const variantGeos: THREE.BufferGeometry[] = []
    for (let v = 0; v < 3; v++) {
      const geo = new THREE.IcosahedronGeometry(0.4 + v * 0.15, 0)
      const pos = geo.attributes.position
      const jr = seeded(v * 97 + 3)
      for (let i = 0; i < pos.count; i++) {
        const j = 1 + (jr() - 0.5) * 0.4
        pos.setXYZ(i, pos.getX(i) * j, pos.getY(i) * j, pos.getZ(i) * j)
      }
      geo.computeVertexNormals()
      variantGeos.push(geo)
      disposeBag.push(() => geo.dispose())
    }
    const rockMat = dimStandard(0x7a6a5a)
    disposeBag.push(() => rockMat.dispose())
    const total = options.lowPerf ? 60 : 120
    const perVariant = Math.ceil(total / 3)
    const meshes = variantGeos.map((geo) => new THREE.InstancedMesh(geo, rockMat, perVariant))
    for (const m of meshes) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      group.add(m)
    }
    const beltBounds = {
      minX: b.minX - spanX * 0.6,
      maxX: b.maxX + spanX * 0.6,
      minY: -18 - rand() * 4,
      maxY: -6,
      minZ: -spanY * 2.2,
      maxZ: spanY * 2.2,
    }
    const fieldData: NonNullable<typeof asteroidField>['data'] = []
    const fr = seeded(1234)
    for (let i = 0; i < total; i++) {
      const meshIndex = i % 3
      const instIndex = Math.floor(i / 3)
      const pos = new THREE.Vector3(
        THREE.MathUtils.lerp(beltBounds.minX, beltBounds.maxX, fr()),
        THREE.MathUtils.lerp(beltBounds.minY, beltBounds.maxY, fr()),
        THREE.MathUtils.lerp(beltBounds.minZ, beltBounds.maxZ, fr()),
      )
      const vel = new THREE.Vector3((fr() - 0.5) * 0.15, (fr() - 0.5) * 0.03, (fr() - 0.5) * 0.15)
      fieldData.push({
        pos,
        vel,
        axis: new THREE.Vector3(fr() - 0.5, fr() - 0.5, fr() - 0.5).normalize(),
        spin: 0.2 + fr() * 0.6,
        angle: fr() * Math.PI * 2,
        meshIndex,
        instIndex,
      })
    }
    asteroidField = { meshes, data: fieldData, bounds: beltBounds }

    // --- Astronauts ------------------------------------------------------------------------------
    const astronautCount = 2
    for (let i = 0; i < astronautCount; i++) {
      const g = buildAstronaut(disposeBag)
      const basePos = new THREE.Vector3(b.minX - 3 - rand() * 3, 4 + rand() * 3, (i === 0 ? -1 : 1) * (spanY * 0.6 + rand() * 2))
      g.position.copy(basePos)
      astronauts.push({ group: g, basePos, phase: rand() * Math.PI * 2, waveTimer: 4 + rand() * 6 })
      group.add(g)
    }

    // --- Gas giant + moons -------------------------------------------------------------------------
    gasGiant = new THREE.Group()
    const giantGeo = new THREE.SphereGeometry(1, 32, 24)
    const giantMat = createPlanetMaterial(['#f59e0b', '#78350f'])
    disposeBag.push(() => {
      giantGeo.dispose()
      giantMat.dispose()
    })
    const giantMesh = new THREE.Mesh(giantGeo, giantMat)
    giantMesh.scale.setScalar(9)
    gasGiant.add(giantMesh)
    gasGiant.position.set(b.maxX + spanX * 1.4, 14, spanY * 1.6)
    group.add(gasGiant)

    for (let i = 0; i < 2; i++) {
      const moonGeo = new THREE.SphereGeometry(1, 16, 12)
      const moonMat = createMoonMaterial()
      disposeBag.push(() => {
        moonGeo.dispose()
        moonMat.dispose()
      })
      const moon = new THREE.Mesh(moonGeo, moonMat)
      moon.scale.setScalar(1.2 + i * 0.6)
      moon.position.set(b.maxX + spanX * (1.1 + i * 0.25), 10 + i * 4, spanY * (1.1 + i * 0.5))
      group.add(moon)
    }

    // --- Nebula / galaxy glow sprites ----------------------------------------------------------------
    const nebulaColors = [0x8b5cf6, 0xf472b6, 0x38bdf8, 0x34d399, 0xfb923c, 0xc026d3]
    const nebulaCount = 8
    for (let i = 0; i < nebulaCount; i++) {
      const color = nebulaColors[i % nebulaColors.length]
      const sprite = makeSprite(glowTexture, color, 0.12 + rand() * 0.1)
      const scale = 30 + rand() * 40
      sprite.scale.set(scale, scale, 1)
      sprite.position.set((rand() - 0.5) * spanX * 4, (rand() - 0.2) * 40, (rand() - 0.5) * spanY * 6 - spanY * 2)
      nebulaSprites.push(sprite)
      group.add(sprite)
    }

    // --- Comet -------------------------------------------------------------------------------------
    const cometHead = makeSprite(glowTexture, 0xbae6fd, 0.9)
    cometHead.scale.set(1.2, 1.2, 1)
    cometHead.visible = false
    group.add(cometHead)
    const trailGeo = new THREE.BufferGeometry()
    const trailPositions = new Float32Array(2 * 3)
    trailGeo.setAttribute('position', new THREE.Float32BufferAttribute(trailPositions, 3))
    const trailMat = new THREE.LineBasicMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
    disposeBag.push(() => trailMat.dispose())
    const trailLine = new THREE.Line(trailGeo, trailMat)
    trailLine.visible = false
    group.add(trailLine)
    comet = {
      head: cometHead,
      trailGeo,
      trail: trailLine,
      points: [new THREE.Vector3(), new THREE.Vector3()],
      active: false,
      t: 0,
      timer: 25 + rand() * 15,
      withTail: !options.lowPerf,
    }

    // --- Shooting stars ------------------------------------------------------------------------------
    const starCount = 4
    for (let i = 0; i < starCount; i++) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3))
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
      disposeBag.push(() => mat.dispose())
      const line = new THREE.Line(geo, mat)
      line.visible = false
      group.add(line)
      shootingStars.push({ line, geo, timer: 6 + rand() * 8, active: false, t: 0, start: new THREE.Vector3(), end: new THREE.Vector3() })
    }
  }

  // --- Per-frame update --------------------------------------------------------------------------
  const tmpMatrix = new THREE.Matrix4()
  const tmpQuat = new THREE.Quaternion()
  const tmpScale = new THREE.Vector3(1, 1, 1)

  function update(dt: number, elapsed: number, reducedMotion: boolean): void {
    const speed = reducedMotion ? 0.08 : 1
    const rdt = dt * speed

    for (const s of saucers) {
      s.zipTimer -= rdt
      if (s.zipTimer <= 0 && !reducedMotion) {
        s.zipping = 1.4
        s.zipTimer = 10 + Math.random() * 10
      }
      s.zipping = Math.max(0, s.zipping - rdt * 0.6)
      const speedMul = 1 + s.zipping * 5
      s.pathPhase += rdt * s.pathSpeed * speedMul
      const x = s.centerX + Math.cos(s.pathPhase) * s.radiusX
      const z = s.centerZ + Math.sin(s.pathPhase * 1.3) * s.radiusZ
      const bob = Math.sin(elapsed * 1.4 + s.pathPhase) * 0.15
      s.group.position.set(x, s.baseY + bob, z)
      s.group.rotation.y += rdt * 0.4
      s.group.rotation.z = Math.sin(elapsed * 0.7 + s.pathPhase) * 0.08
      const blink = 0.5 + 0.5 * Math.sin(elapsed * 6 + s.pathPhase * 3)
      s.lightMat.emissiveIntensity = blink
    }

    for (const sat of satellites) {
      sat.orbitPhase += rdt * sat.orbitSpeed
      const x = sat.centerX + Math.cos(sat.orbitPhase) * sat.orbitR
      const z = sat.centerZ + Math.sin(sat.orbitPhase) * sat.orbitR * 0.6
      sat.group.position.set(x, sat.y, z)
      sat.group.rotateOnAxis(sat.spin, rdt * 0.2)
      const beaconMat = sat.group.userData.beaconMat as THREE.MeshStandardMaterial
      beaconMat.emissiveIntensity = 0.5 + 0.5 * Math.sin(elapsed * 3)
    }

    if (station) station.rotation.y += rdt * 0.03

    if (asteroidField) {
      const { meshes, data, bounds } = asteroidField
      for (const a of data) {
        a.pos.addScaledVector(a.vel, rdt)
        a.angle += a.spin * rdt
        if (a.pos.x < bounds.minX) a.pos.x = bounds.maxX
        if (a.pos.x > bounds.maxX) a.pos.x = bounds.minX
        if (a.pos.y < bounds.minY) a.pos.y = bounds.maxY
        if (a.pos.y > bounds.maxY) a.pos.y = bounds.minY
        if (a.pos.z < bounds.minZ) a.pos.z = bounds.maxZ
        if (a.pos.z > bounds.maxZ) a.pos.z = bounds.minZ
        tmpQuat.setFromAxisAngle(a.axis, a.angle)
        tmpMatrix.compose(a.pos, tmpQuat, tmpScale)
        meshes[a.meshIndex].setMatrixAt(a.instIndex, tmpMatrix)
      }
      for (const m of meshes) m.instanceMatrix.needsUpdate = true
    }

    for (const a of astronauts) {
      a.phase += rdt * 0.5
      a.group.position.set(
        a.basePos.x + Math.sin(a.phase) * 0.6,
        a.basePos.y + Math.sin(a.phase * 0.7) * 0.4,
        a.basePos.z + Math.cos(a.phase * 0.5) * 0.5,
      )
      a.group.rotation.y += rdt * 0.15
      a.group.rotation.z = Math.sin(a.phase * 0.6) * 0.2
      a.waveTimer -= rdt
      const waveArm = a.group.userData.waveArm as THREE.Mesh
      if (a.waveTimer <= 0) {
        waveArm.rotation.z = -0.5 + Math.sin(elapsed * 8) * 0.6
        if (a.waveTimer <= -1.5) a.waveTimer = 5 + Math.random() * 6
      } else {
        waveArm.rotation.z = -0.5
      }
    }

    if (gasGiant) gasGiant.rotation.y += rdt * 0.015

    for (let i = 0; i < nebulaSprites.length; i++) {
      const mat = nebulaSprites[i].material as THREE.SpriteMaterial
      mat.opacity = 0.1 + 0.05 * Math.sin(elapsed * 0.1 + i)
    }

    if (comet) {
      comet.timer -= rdt
      if (!comet.active && comet.timer <= 0 && !reducedMotion) {
        comet.active = true
        comet.t = 0
      }
      if (comet.active) {
        comet.t += dt / 6
        const k = comet.t
        const x = THREE.MathUtils.lerp(-60, 60, k)
        const y = 30 + Math.sin(k * Math.PI) * 10
        const z = -40 + k * 30
        comet.head.position.set(x, y, z)
        comet.head.visible = true
        if (comet.withTail) {
          comet.trail.visible = true
          const posAttr = comet.trailGeo.attributes.position as THREE.BufferAttribute
          posAttr.setXYZ(0, x, y, z)
          posAttr.setXYZ(1, x - 6, y - 1.5, z - 3)
          posAttr.needsUpdate = true
        }
        if (k >= 1) {
          comet.active = false
          comet.head.visible = false
          comet.trail.visible = false
          comet.timer = 25 + Math.random() * 15
        }
      }
    }

    for (const star of shootingStars) {
      star.timer -= rdt
      if (!star.active && star.timer <= 0 && !reducedMotion) {
        star.active = true
        star.t = 0
        star.start.set(-40 + Math.random() * 80, 25 + Math.random() * 20, -50 - Math.random() * 20)
        star.end.copy(star.start).add(new THREE.Vector3(-8 - Math.random() * 6, -4 - Math.random() * 3, 2))
      }
      if (star.active) {
        star.t += dt / 0.4
        const posAttr = star.geo.attributes.position as THREE.BufferAttribute
        const p0 = star.start.clone().lerp(star.end, Math.max(0, star.t - 0.15))
        const p1 = star.start.clone().lerp(star.end, Math.min(1, star.t))
        posAttr.setXYZ(0, p0.x, p0.y, p0.z)
        posAttr.setXYZ(1, p1.x, p1.y, p1.z)
        posAttr.needsUpdate = true
        star.line.visible = true
        ;(star.line.material as THREE.LineBasicMaterial).opacity = 0.8 * (1 - star.t)
        if (star.t >= 1) {
          star.active = false
          star.line.visible = false
          star.timer = 6 + Math.random() * 8
        }
      }
    }
  }

  function dispose(): void {
    clearAll()
    glowTexture.dispose()
  }

  return { group, build, update, dispose }
}
