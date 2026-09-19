import * as THREE from 'three'

/**
 * The alien golfer that stands beside the ball at the current lie and swings at it. Fully
 * procedural: geometry is built once in createAlienGolfer() and animated per-frame in update().
 * The group's local origin is the ground point between the feet; Engine.ts positions and rotates
 * the group on the sheet every frame (at the lie, addressing the aim direction).
 */

const SKIN = 0x4ade80
const BELLY = 0x16a34a
const EYE_BLACK = 0x0a0a12
const EYE_HIGHLIGHT = 0xf8fafc
const ANTENNA_GLOW = 0x86efac
const CLUB_SHAFT = 0x94a3b8
const CLUB_HEAD = 0x475569
const CAP_COLOR = 0xf472b6
const VISOR_COLOR = 0x38bdf8
const PACK_COLOR = 0x334155

/** How far along the aim direction the club head rests, roughly at the ball's launch point. */
const CLUB_REACH = 0.62

/** Local-space position of the backpack nozzles, for spawning jetpack flame particles during a hop. */
export const ALIEN_BACKPACK_OFFSET = new THREE.Vector3(0, 0.5, -0.2)

function skinMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.55, metalness: 0.05, flatShading: false })
}

/** Shortest signed angular difference b - a, wrapped to [-PI, PI]. */
function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

export interface AlienGolfer {
  group: THREE.Group
  /** Advances idle/swing/reaction animation. Call once per rendered frame. */
  update(dt: number, elapsed: number): void
  /** Smoothly (critically damped) turns the alien to address the ball along this aim angle. */
  setAimAngle(rad: number): void
  /** Starts backswing -> downswing -> contact -> follow-through. Returns seconds until contact. */
  playSwing(): number
  /** Plays a short reaction, then eases back to idle. */
  react(kind: 'cheer' | 'slump'): void
  /** Starts a short jetpack-hop pose (legs tucked, arms out for balance). Returns the duration in seconds. */
  playHop(): number
  /** While the ball is flying, shades eyes and turns the head to follow it (local-space target). */
  setWatchTarget(target: THREE.Vector3 | null): void
  dispose(): void
}

export function createAlienGolfer(): AlienGolfer {
  const group = new THREE.Group()
  // Everything visual hangs off bounceGroup, not group directly: Engine.ts fully owns group's
  // position/rotation each frame, so idle bob / cheer jump / hop apply here instead, as a local
  // offset that survives Engine repositioning group on the next frame.
  const bounceGroup = new THREE.Group()
  group.add(bounceGroup)
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g)
    return g
  }
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m)
    return m
  }

  const skinMat = trackMat(skinMaterial())
  const bellyMat = trackMat(new THREE.MeshStandardMaterial({ color: BELLY, roughness: 0.6 }))

  // --- Legs + feet ---------------------------------------------------------------------------
  const legGeo = track(new THREE.CapsuleGeometry(0.075, 0.16, 4, 8))
  const footGeo = track(new THREE.SphereGeometry(0.11, 12, 8))
  const legs = new THREE.Group()
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, skinMat)
    leg.position.set(side * 0.11, 0.19, 0)
    legs.add(leg)
    const foot = new THREE.Mesh(footGeo, skinMat)
    foot.scale.set(1.3, 0.6, 1.6)
    foot.position.set(side * 0.11, 0.07, 0.04)
    legs.add(foot)
  }
  bounceGroup.add(legs)

  // --- Body (rounded torso with a darker belly patch) -----------------------------------------
  const torsoGeo = track(new THREE.SphereGeometry(0.26, 20, 16))
  const torso = new THREE.Mesh(torsoGeo, skinMat)
  torso.position.set(0, 0.62, 0)
  torso.scale.set(1, 1.15, 0.92)
  bounceGroup.add(torso)

  const bellyGeo = track(new THREE.SphereGeometry(0.19, 16, 12))
  const belly = new THREE.Mesh(bellyGeo, bellyMat)
  belly.position.set(0, 0.56, 0.16)
  belly.scale.set(0.9, 1.05, 0.6)
  bounceGroup.add(belly)

  // --- Backpack / jetpack so the back view (camera side) reads well ---------------------------
  const packGeo = track(new THREE.BoxGeometry(0.24, 0.32, 0.14))
  const packMat = trackMat(new THREE.MeshStandardMaterial({ color: PACK_COLOR, roughness: 0.4, metalness: 0.3 }))
  const pack = new THREE.Mesh(packGeo, packMat)
  pack.position.set(0, 0.66, -0.19)
  bounceGroup.add(pack)
  const nozzleGeo = track(new THREE.CylinderGeometry(0.035, 0.045, 0.1, 8))
  const nozzleMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.4 }))
  for (const side of [-1, 1]) {
    const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat)
    nozzle.position.set(side * 0.07, 0.46, -0.2)
    bounceGroup.add(nozzle)
  }

  // --- Head + cap with visor ------------------------------------------------------------------
  const neck = new THREE.Group()
  neck.position.set(0, 0.95, 0)
  bounceGroup.add(neck)

  const headGeo = track(new THREE.SphereGeometry(0.24, 24, 18))
  const head = new THREE.Mesh(headGeo, skinMat)
  head.scale.set(1.05, 0.92, 1.02)
  head.position.set(0, 0.22, 0)
  neck.add(head)

  const capGeo = track(new THREE.SphereGeometry(0.245, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52))
  const capMat = trackMat(new THREE.MeshStandardMaterial({ color: CAP_COLOR, roughness: 0.5 }))
  const cap = new THREE.Mesh(capGeo, capMat)
  cap.position.set(0, 0.27, 0)
  neck.add(cap)
  const visorGeo = track(new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, Math.PI * 0.34, Math.PI * 0.16))
  const visorMat = trackMat(new THREE.MeshStandardMaterial({ color: VISOR_COLOR, roughness: 0.3, metalness: 0.2 }))
  const visor = new THREE.Mesh(visorGeo, visorMat)
  visor.position.set(0, 0.26, 0.06)
  visor.rotation.x = 0.5
  neck.add(visor)

  // Eyes: large glossy almonds with tiny white highlights, squashed toward the front (+z).
  const eyeGeo = track(new THREE.SphereGeometry(0.06, 14, 10))
  const eyeMat = trackMat(new THREE.MeshStandardMaterial({ color: EYE_BLACK, roughness: 0.15, metalness: 0.1 }))
  const highlightGeo = track(new THREE.SphereGeometry(0.018, 8, 6))
  const highlightMat = trackMat(new THREE.MeshStandardMaterial({ color: EYE_HIGHLIGHT, emissive: 0xffffff, emissiveIntensity: 0.3 }))
  const eyes: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat)
    eye.scale.set(0.8, 1.15, 0.6)
    eye.position.set(side * 0.1, 0.24, 0.18)
    neck.add(eye)
    eyes.push(eye)
    const hl = new THREE.Mesh(highlightGeo, highlightMat)
    hl.position.set(side * 0.1 + side * 0.02, 0.27, 0.22)
    neck.add(hl)
  }

  // Small smile: a thin torus arc.
  const smileGeo = track(new THREE.TorusGeometry(0.05, 0.008, 6, 12, Math.PI))
  const smileMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 0.4 }))
  const smile = new THREE.Mesh(smileGeo, smileMat)
  smile.position.set(0, 0.14, 0.22)
  smile.rotation.set(Math.PI, 0, Math.PI)
  neck.add(smile)

  // Antennae with glowing tips that sway gently.
  const antennaGeo = track(new THREE.CylinderGeometry(0.012, 0.018, 0.22, 6))
  const antennaMat = trackMat(new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.6 }))
  const tipGeo = track(new THREE.SphereGeometry(0.035, 10, 8))
  const tipMat = trackMat(new THREE.MeshStandardMaterial({ color: ANTENNA_GLOW, emissive: ANTENNA_GLOW, emissiveIntensity: 0.9 }))
  const antennae: THREE.Group[] = []
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.set(side * 0.08, 0.42, -0.02)
    pivot.rotation.z = side * -0.25
    const stalk = new THREE.Mesh(antennaGeo, antennaMat)
    stalk.position.y = 0.11
    pivot.add(stalk)
    const tip = new THREE.Mesh(tipGeo, tipMat)
    tip.position.y = 0.22
    pivot.add(tip)
    neck.add(pivot)
    antennae.push(pivot)
  }

  // --- Arms + three-fingered hands holding the club -------------------------------------------
  const upperArmGeo = track(new THREE.CapsuleGeometry(0.05, 0.16, 4, 8))
  const forearmGeo = track(new THREE.CapsuleGeometry(0.045, 0.15, 4, 8))
  const fingerGeo = track(new THREE.SphereGeometry(0.028, 8, 6))

  const shoulderL = new THREE.Group()
  shoulderL.position.set(-0.22, 0.72, 0.02)
  const shoulderR = new THREE.Group()
  shoulderR.position.set(0.22, 0.72, 0.02)
  bounceGroup.add(shoulderL, shoulderR)

  function buildArm(shoulder: THREE.Group, side: number): { elbow: THREE.Group; hand: THREE.Group } {
    const upper = new THREE.Mesh(upperArmGeo, skinMat)
    upper.position.y = -0.08
    shoulder.add(upper)
    const elbow = new THREE.Group()
    elbow.position.y = -0.16
    shoulder.add(elbow)
    const fore = new THREE.Mesh(forearmGeo, skinMat)
    fore.position.y = -0.075
    elbow.add(fore)
    const hand = new THREE.Group()
    hand.position.y = -0.15
    elbow.add(hand)
    for (let f = 0; f < 3; f++) {
      const finger = new THREE.Mesh(fingerGeo, skinMat)
      finger.position.set((f - 1) * 0.03 * side, -0.03, 0.02)
      hand.add(finger)
    }
    return { elbow, hand }
  }
  const armL = buildArm(shoulderL, -1)
  const armR = buildArm(shoulderR, 1)

  // Club: grey shaft + chunky head, held between the two hands, resting toward +x (the aim reach).
  const clubGroup = new THREE.Group()
  const shaftGeo = track(new THREE.CylinderGeometry(0.012, 0.015, 0.62, 8))
  const shaftMat = trackMat(new THREE.MeshStandardMaterial({ color: CLUB_SHAFT, roughness: 0.35, metalness: 0.5 }))
  const shaft = new THREE.Mesh(shaftGeo, shaftMat)
  shaft.position.y = -0.31
  clubGroup.add(shaft)
  const headGeoClub = track(new THREE.BoxGeometry(0.09, 0.07, 0.14))
  const headMatClub = trackMat(new THREE.MeshStandardMaterial({ color: CLUB_HEAD, roughness: 0.3, metalness: 0.6 }))
  const clubHead = new THREE.Mesh(headGeoClub, headMatClub)
  clubHead.position.y = -0.62
  clubGroup.add(clubHead)
  armR.hand.add(clubGroup)
  clubGroup.rotation.z = 0.15
  clubGroup.rotation.x = -0.1

  // --- Animation state --------------------------------------------------------------------------
  let idleT = 0
  let currentYaw = 0
  let targetYaw = 0
  let yawVel = 0

  type Phase = 'idle' | 'backswing' | 'downswing' | 'follow' | 'cheer' | 'slump' | 'hop'
  let phase: Phase = 'idle'
  let phaseT = 0
  const BACKSWING_DUR = 0.22
  const DOWNSWING_DUR = 0.1
  const FOLLOW_DUR = 0.35
  const FOLLOW_HOLD = 0.3
  const SLUMP_DUR = 1.2
  const CHEER_DUR = 1.4
  const HOP_DUR = 0.9

  let watchTarget: THREE.Vector3 | null = null
  const localWatch = new THREE.Vector3()

  function setAimAngle(rad: number): void {
    // Convert the physics-plane aim angle into the local +x-facing yaw the group must rotate to
    // (see Engine.ts: world dx = cos(aim), dz = sin(aim); rotation.y = -aim aligns local +x to it).
    targetYaw = -rad
  }

  function playSwing(): number {
    phase = 'backswing'
    phaseT = 0
    return BACKSWING_DUR + DOWNSWING_DUR
  }

  function react(kind: 'cheer' | 'slump'): void {
    phase = kind
    phaseT = 0
  }

  function playHop(): number {
    phase = 'hop'
    phaseT = 0
    return HOP_DUR
  }

  function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  }

  function applyIdlePose(t: number): void {
    const bob = Math.sin(t * 1.6) * 0.012
    torso.position.y = 0.62 + bob
    belly.position.y = 0.56 + bob
    neck.position.y = 0.95 + bob
    pack.position.y = 0.66 + bob
    const shift = Math.sin(t * 0.5) * 0.03
    torso.rotation.z = shift * 0.3
    neck.rotation.y = Math.sin(t * 0.35) * 0.18 // curious little head turn while idle
    for (let i = 0; i < antennae.length; i++) {
      antennae[i].rotation.x = Math.sin(t * 1.2 + i) * 0.12
    }
    // Gentle club waggle at rest.
    shoulderL.rotation.set(0.15, 0, 0.35)
    shoulderR.rotation.set(0.1 + Math.sin(t * 1.1) * 0.03, 0, -0.5)
    armL.elbow.rotation.set(-0.3, 0, 0)
    armR.elbow.rotation.set(-0.5, 0, 0)
  }

  function applySwingPose(): void {
    if (phase === 'backswing') {
      const k = easeInOut(Math.min(1, phaseT / BACKSWING_DUR))
      shoulderR.rotation.set(THREE.MathUtils.lerp(0.1, -1.1, k), 0, THREE.MathUtils.lerp(-0.5, -0.9, k))
      shoulderL.rotation.set(THREE.MathUtils.lerp(0.15, -0.9, k), 0, THREE.MathUtils.lerp(0.35, 0.7, k))
      armR.elbow.rotation.set(THREE.MathUtils.lerp(-0.5, -1.3, k), 0, 0)
      torso.rotation.y = THREE.MathUtils.lerp(0, -0.35, k)
      if (phaseT >= BACKSWING_DUR) {
        phase = 'downswing'
        phaseT = 0
      }
    } else if (phase === 'downswing') {
      const k = easeInOut(Math.min(1, phaseT / DOWNSWING_DUR))
      shoulderR.rotation.set(THREE.MathUtils.lerp(-1.1, 0.4, k), 0, THREE.MathUtils.lerp(-0.9, -0.65, k))
      shoulderL.rotation.set(THREE.MathUtils.lerp(-0.9, 0.5, k), 0, THREE.MathUtils.lerp(0.7, 0.2, k))
      armR.elbow.rotation.set(THREE.MathUtils.lerp(-1.3, -0.15, k), 0, 0)
      torso.rotation.y = THREE.MathUtils.lerp(-0.35, 0.25, k)
      if (phaseT >= DOWNSWING_DUR) {
        phase = 'follow'
        phaseT = 0
      }
    } else if (phase === 'follow') {
      const k = easeInOut(Math.min(1, phaseT / FOLLOW_DUR))
      shoulderR.rotation.set(THREE.MathUtils.lerp(0.4, -0.6, k), 0, THREE.MathUtils.lerp(-0.65, -1.2, k))
      shoulderL.rotation.set(THREE.MathUtils.lerp(0.5, -0.4, k), 0, THREE.MathUtils.lerp(0.2, 0.9, k))
      armR.elbow.rotation.set(THREE.MathUtils.lerp(-0.15, -0.9, k), 0, 0)
      torso.rotation.y = THREE.MathUtils.lerp(0.25, 0.05, k)
      if (phaseT >= FOLLOW_DUR + FOLLOW_HOLD) {
        phase = 'idle'
        phaseT = 0
      }
    }
  }

  function applyCheerPose(t: number): void {
    const k = Math.min(1, phaseT / CHEER_DUR)
    const jump = Math.abs(Math.sin(phaseT * 9)) * (1 - k) * 0.22
    bounceGroup.position.y = jump
    shoulderL.rotation.set(-2.4, 0, 0.3)
    shoulderR.rotation.set(-2.4, 0, -0.3)
    armL.elbow.rotation.set(-0.1, 0, 0)
    armR.elbow.rotation.set(-0.1, 0, 0)
    for (let i = 0; i < antennae.length; i++) {
      const flash = 0.6 + 0.4 * Math.sin(t * 14 + i * 2)
      const mat = antennae[i].children[1] as THREE.Mesh
      ;(mat.material as THREE.MeshStandardMaterial).emissiveIntensity = flash * 2.2
    }
    if (phaseT >= CHEER_DUR) {
      bounceGroup.position.y = 0
      phase = 'idle'
      phaseT = 0
    }
  }

  /** Legs tucked, arms out for balance, a little forward lean while airborne on the jetpack. */
  function applyHopPose(): void {
    const k = Math.min(1, phaseT / HOP_DUR)
    const arc = Math.sin(k * Math.PI)
    legs.rotation.x = -0.9 * arc
    torso.rotation.x = 0.15 * arc
    neck.rotation.x = -0.1 * arc
    shoulderL.rotation.set(-0.6 - 0.4 * arc, 0, 1.0)
    shoulderR.rotation.set(-0.6 - 0.4 * arc, 0, -1.0)
    armL.elbow.rotation.set(-0.2, 0, 0)
    armR.elbow.rotation.set(-0.2, 0, 0)
    if (phaseT >= HOP_DUR) {
      legs.rotation.x = 0
      torso.rotation.x = 0
      neck.rotation.x = 0
      phase = 'idle'
      phaseT = 0
    }
  }

  function applySlumpPose(): void {
    const k = Math.min(1, phaseT / SLUMP_DUR)
    const settle = easeInOut(Math.min(1, phaseT / 0.3))
    torso.position.y = 0.62 - 0.05 * settle
    neck.position.y = 0.95 - 0.06 * settle
    neck.rotation.z = Math.sin(phaseT * 6) * 0.15 * (1 - k)
    shoulderL.rotation.set(0.6, 0, 0.55)
    shoulderR.rotation.set(0.6, 0, -0.55)
    if (phaseT >= SLUMP_DUR) {
      torso.position.y = 0.62
      neck.position.y = 0.95
      neck.rotation.z = 0
      phase = 'idle'
      phaseT = 0
    }
  }

  function applyWatch(): void {
    if (!watchTarget) return
    localWatch.copy(watchTarget)
    group.worldToLocal(localWatch)
    const yaw = Math.atan2(localWatch.x, localWatch.z)
    neck.rotation.y = THREE.MathUtils.clamp(yaw * 0.4, -0.6, 0.6)
    // Shade eyes with one hand: raise the left arm toward the brow.
    shoulderL.rotation.set(-1.4, 0, 0.5)
    armL.elbow.rotation.set(-0.6, 0, 0)
  }

  function update(dt: number, elapsed: number): void {
    idleT += dt
    // Critically-damped turn toward targetYaw (spring-damper with damping ratio 1).
    const omega = 9
    const diff = angleDiff(currentYaw, targetYaw)
    const accel = omega * omega * diff - 2 * omega * yawVel
    yawVel += accel * dt
    currentYaw += yawVel * dt
    group.rotation.y = currentYaw

    if (phase !== 'cheer') bounceGroup.position.y = 0
    if (phase === 'idle') {
      applyIdlePose(idleT)
      if (watchTarget) applyWatch()
    } else if (phase === 'cheer') {
      applyCheerPose(elapsed)
    } else if (phase === 'slump') {
      applySlumpPose()
    } else if (phase === 'hop') {
      applyHopPose()
    } else {
      applySwingPose()
    }
    phaseT += dt

    clubGroup.position.set(CLUB_REACH * 0.55, 0, 0)
  }

  function setWatchTarget(target: THREE.Vector3 | null): void {
    watchTarget = target
  }

  function dispose(): void {
    for (const g of geometries) g.dispose()
    for (const m of materials) m.dispose()
  }

  return { group, update, setAimAngle, playSwing, react, playHop, setWatchTarget, dispose }
}
