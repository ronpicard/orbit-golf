import * as THREE from 'three'

/**
 * The alien golfer that addresses the ball from a side-on stance and swings a putter at it.
 * Fully procedural: geometry is built once in createAlienGolfer() and animated per-frame in
 * update(). Engine.ts sets `group.position` to the ball's lie every frame and rotates the group
 * (`rotation.y = -aim`) to face the aim direction, so the LOCAL FRAME is fixed relative to the
 * ball and the shot, not relative to the alien's body:
 *
 *   - The origin (0, 0, 0) is the BALL'S CONTACT POINT on the ground. The ball mesh itself (owned
 *     by Engine.ts) sits at local (0, 0.16, 0) - i.e. its rendered radius above this group's
 *     origin.
 *   - Local +x is the TARGET LINE: the direction the shot travels, from ball toward the hole.
 *     The camera sits behind the ball at local -x, looking along +x.
 *   - Local +z is the direction from the golfer's feet toward the ball, i.e. the alien stands at
 *     negative z (STANCE_OFFSET.z < 0) and its built-in "front" (eyes, belly, visor) already
 *     faces +z, so no extra yaw is needed to have it look at the ball.
 *   - Local -z is therefore stage-left of the shot as seen from the camera behind the ball, which
 *     is where the golfer's feet are placed, keeping the ball, the aim arrow (drawn along the
 *     strip x in [-0.3, 8], |z| < 0.25) and the target line unobstructed.
 *
 * The swing is a 2D pendulum: a fixed pivot at the HANDS position rotates about the local z axis.
 * Because a rotation about z never changes a point's z-coordinate, giving the club head a local
 * z-offset (relative to the pivot) equal to `-HANDS.z` guarantees the head's world z is always 0
 * - i.e. the club always stays in the vertical plane containing the target line, no matter the
 * swing angle. Only the (x, y) part of the head's offset from the pivot rotates, tracing the
 * swing arc. This is what "rotate a club pivot located at the hands about the local z axis, in
 * the local x-y plane (offset in z to the hands)" means in code below.
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

// --- Local-frame layout (see header comment) ---------------------------------------------------

/** Ground centre of the golfer's stance: feet are shoulder-width apart around this point. */
const STANCE_OFFSET = new THREE.Vector3(-0.05, 0, -0.62)

/** Fixed pivot the club swings about: both hands grip the club here, in front of the chest. */
const HANDS = new THREE.Vector3(0, 0.62, -0.3)

/** Where the club head rests at address: just behind the ball, on the target line. */
const ADDRESS_HEAD = new THREE.Vector3(-0.2, 0.06, 0)

// Derive the club's rest geometry from HANDS -> ADDRESS_HEAD so the two points documented above
// are the single source of truth (rather than duplicating numbers in the mesh-building code).
const HEAD_DX = ADDRESS_HEAD.x - HANDS.x // -0.2
const HEAD_DY = ADDRESS_HEAD.y - HANDS.y // -0.56
const HEAD_DZ = ADDRESS_HEAD.z - HANDS.z // +0.3 (constant through the whole swing, see header)
/** Pivot-to-head distance projected onto the local x-y (swing) plane. */
const CLUB_LENGTH = Math.hypot(HEAD_DX, HEAD_DY) // ~0.595
/** Rest lean of the shaft from straight-down, i.e. the z-rotation that places the head at ADDRESS_HEAD. */
const ADDRESS_LEAN = Math.atan2(HEAD_DX, -HEAD_DY) // ~-0.34 rad (~-19.5deg)

/** Backswing / follow-through amplitudes for a full-power stroke, and the fixed contact angle. */
const BACK_MAX = THREE.MathUtils.degToRad(55)
const FOLLOW_MAX = THREE.MathUtils.degToRad(45)
/** Extra rotation (from address) at which the club head is deemed "at the ball" for contact. */
const CONTACT_OFFSET = THREE.MathUtils.degToRad(12)
/** Club angle used for a lowered/resting club (watching the ball roll, or slumped). */
const LOWERED_OFFSET = THREE.MathUtils.degToRad(-9)
/** Raised angle used for cheering (club held high), reusing the backswing-style geometry. */
const RAISED_OFFSET = -BACK_MAX

/** Local-space position of the backpack nozzles, for spawning jetpack flame particles during a hop. */
export const ALIEN_BACKPACK_OFFSET = STANCE_OFFSET.clone().add(new THREE.Vector3(0, 0.66, -0.19))

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

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

export interface AlienGolfer {
  group: THREE.Group
  /** Advances idle/swing/reaction animation. Call once per rendered frame. */
  update(dt: number, elapsed: number): void
  /** Smoothly (critically damped) turns the alien to address the ball along this aim angle. */
  setAimAngle(rad: number): void
  /** Starts backswing -> downswing -> contact -> follow-through. `power` in (0, 1] scales the
   *  backswing/follow-through amplitude (35%..100%). Returns seconds until contact (constant). */
  playSwing(power?: number): number
  /** Plays a short reaction, then eases back to idle/address. */
  react(kind: 'cheer' | 'slump'): void
  /** Starts a short jetpack-hop pose (legs tucked, arms out for balance). Returns the duration in seconds. */
  playHop(): number
  /** While the ball is flying/rolling, shades eyes and turns the head to follow it (local-space target). */
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

  // --- Stance: everything but the club hangs off this group, offset beside the ball -------------
  const stance = new THREE.Group()
  stance.position.copy(STANCE_OFFSET)
  bounceGroup.add(stance)

  // --- Legs + feet (shoulder-width along local x, knees slightly bent) ---------------------------
  const legGeo = track(new THREE.CapsuleGeometry(0.075, 0.16, 4, 8))
  const footGeo = track(new THREE.SphereGeometry(0.11, 12, 8))
  const legs = new THREE.Group()
  legs.rotation.x = 0.12 // slight knee bend
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, skinMat)
    leg.position.set(side * 0.11, 0.19, 0)
    legs.add(leg)
    const foot = new THREE.Mesh(footGeo, skinMat)
    foot.scale.set(1.3, 0.6, 1.6)
    foot.position.set(side * 0.11, 0.07, 0.04)
    legs.add(foot)
  }
  stance.add(legs)

  // --- Body (rounded torso with a darker belly patch), tilted forward over the ball --------------
  const torsoGeo = track(new THREE.SphereGeometry(0.26, 20, 16))
  const torso = new THREE.Mesh(torsoGeo, skinMat)
  torso.position.set(0, 0.62, 0)
  torso.scale.set(1, 1.15, 0.92)
  torso.rotation.x = 0.22 // forward spine tilt, hinged from the hips
  stance.add(torso)

  const bellyGeo = track(new THREE.SphereGeometry(0.19, 16, 12))
  const belly = new THREE.Mesh(bellyGeo, bellyMat)
  belly.position.set(0, 0.56, 0.16)
  belly.scale.set(0.9, 1.05, 0.6)
  torso.add(belly)
  belly.position.set(0, -0.06, 0.16)

  // --- Backpack / jetpack so the back view (camera side) reads well ---------------------------
  const packGeo = track(new THREE.BoxGeometry(0.24, 0.32, 0.14))
  const packMat = trackMat(new THREE.MeshStandardMaterial({ color: PACK_COLOR, roughness: 0.4, metalness: 0.3 }))
  const pack = new THREE.Mesh(packGeo, packMat)
  pack.position.set(0, 0.66, -0.19)
  stance.add(pack)
  const nozzleGeo = track(new THREE.CylinderGeometry(0.035, 0.045, 0.1, 8))
  const nozzleMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.4 }))
  for (const side of [-1, 1]) {
    const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat)
    nozzle.position.set(side * 0.07, 0.46, -0.2)
    stance.add(nozzle)
  }

  // --- Head + cap with visor ------------------------------------------------------------------
  const neck = new THREE.Group()
  neck.position.set(0, 0.95, 0)
  stance.add(neck)

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

  // Eyes: large glossy almonds with tiny white highlights, squashed toward the front (+z, the ball).
  const eyeGeo = track(new THREE.SphereGeometry(0.06, 14, 10))
  const eyeMat = trackMat(new THREE.MeshStandardMaterial({ color: EYE_BLACK, roughness: 0.15, metalness: 0.1 }))
  const highlightGeo = track(new THREE.SphereGeometry(0.018, 8, 6))
  const highlightMat = trackMat(new THREE.MeshStandardMaterial({ color: EYE_HIGHLIGHT, emissive: 0xffffff, emissiveIntensity: 0.3 }))
  const eyes: THREE.Mesh[] = []
  const EYE_BASE_SCALE_Y = 1.15
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat)
    eye.scale.set(0.8, EYE_BASE_SCALE_Y, 0.6)
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
  const antennaTips: THREE.Mesh[] = []
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
    antennaTips.push(tip)
  }

  // --- Arms + three-fingered hands, posed reaching toward the grip on the club ------------------
  const upperArmGeo = track(new THREE.CapsuleGeometry(0.05, 0.16, 4, 8))
  const forearmGeo = track(new THREE.CapsuleGeometry(0.045, 0.15, 4, 8))
  const fingerGeo = track(new THREE.SphereGeometry(0.028, 8, 6))

  const shoulderL = new THREE.Group()
  shoulderL.position.set(-0.22, 0.72, 0.02)
  const shoulderR = new THREE.Group()
  shoulderR.position.set(0.22, 0.72, 0.02)
  stance.add(shoulderL, shoulderR)

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

  // Rest pose for both arms: reach forward (+z, toward the ball) and slightly down/in to meet the
  // grip at HANDS. This is a fixed, hand-tuned "two-bone reach" (not true IK): the grip point
  // itself never moves (see header comment), so a static-ish arm pose already keeps the hands
  // visibly on the club; the small `swingOffset`-coupled terms below add the pendulum motion.
  const REST_SHOULDER_X = -1.05
  const REST_SHOULDER_Z_L = 0.3
  const REST_SHOULDER_Z_R = -0.3
  const REST_ELBOW_X = -0.55

  // --- Club: rotates as a rigid pendulum about the fixed HANDS pivot -----------------------------
  const handsPivot = new THREE.Group()
  handsPivot.position.copy(HANDS)
  bounceGroup.add(handsPivot)

  // The shaft must physically join the grip (the pivot origin) to the head, which sits HEAD_DZ
  // closer to the target line. Its true length is therefore the diagonal, not CLUB_LENGTH.
  const SHAFT_LENGTH = Math.hypot(CLUB_LENGTH, HEAD_DZ)
  const shaftGeo = track(new THREE.CylinderGeometry(0.012, 0.015, SHAFT_LENGTH, 8))
  const shaftMat = trackMat(new THREE.MeshStandardMaterial({ color: CLUB_SHAFT, roughness: 0.35, metalness: 0.5 }))
  const shaft = new THREE.Mesh(shaftGeo, shaftMat)
  // Shaft runs straight "down" (local -y) from the pivot before the pivot's own z-rotation is
  // applied; the fixed z-offset keeps it (and the head below) on the target-line plane always.
  // Midpoint of grip -> head, tilted about x so the cylinder's -y axis points at the head. A
  // vertical stick offset by HEAD_DZ would float over the ball line, detached from the hands.
  shaft.position.set(0, -CLUB_LENGTH / 2, HEAD_DZ / 2)
  shaft.rotation.x = -Math.asin(HEAD_DZ / SHAFT_LENGTH)
  handsPivot.add(shaft)
  const headGeoClub = track(new THREE.BoxGeometry(0.09, 0.07, 0.14))
  const headMatClub = trackMat(new THREE.MeshStandardMaterial({ color: CLUB_HEAD, roughness: 0.3, metalness: 0.6 }))
  const clubHead = new THREE.Mesh(headGeoClub, headMatClub)
  clubHead.position.set(0, -CLUB_LENGTH, HEAD_DZ)
  handsPivot.add(clubHead)

  // --- Animation state --------------------------------------------------------------------------
  let idleT = 0
  let currentYaw = 0
  let targetYaw = 0
  let yawVel = 0

  type Phase = 'idle' | 'backswing' | 'downswing' | 'follow' | 'return' | 'cheer' | 'slump' | 'hop'
  let phase: Phase = 'idle'
  let phaseT = 0
  const BACKSWING_DUR = 0.22
  const DOWNSWING_DUR = 0.1
  const FOLLOW_DUR = 0.35
  const FOLLOW_HOLD = 0.3
  const RETURN_DUR = 0.25
  const SLUMP_DUR = 1.2
  const CHEER_DUR = 1.4
  const HOP_DUR = 0.9

  /** Backswing/follow-through scale for the in-flight swing, set by playSwing(power). */
  let swingScale = 1
  /** Current club angle relative to address (0 = address). Drives handsPivot + body coupling. */
  let swingOffset = 0
  /** swingOffset captured at the moment 'return' phase begins, so it eases back from wherever
   *  the previous phase (follow-through, cheer, hop, slump) actually left the club. */
  let returnStartOffset = 0

  function enterReturn(): void {
    returnStartOffset = swingOffset
    phase = 'return'
    phaseT = 0
  }

  let watchTarget: THREE.Vector3 | null = null
  const localWatch = new THREE.Vector3()

  function setAimAngle(rad: number): void {
    // Convert the physics-plane aim angle into the local +x-facing yaw the group must rotate to
    // (see Engine.ts: world dx = cos(aim), dz = sin(aim); rotation.y = -aim aligns local +x to it).
    targetYaw = -rad
  }

  function playSwing(power = 1): number {
    const clamped = THREE.MathUtils.clamp(power, 0.05, 1)
    swingScale = THREE.MathUtils.mapLinear(clamped, 0.05, 1, 0.35, 1)
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

  /** Applies the current swingOffset to the club and couples a bit of body twist to it. */
  function applyClubAndTwist(offset: number): void {
    handsPivot.rotation.z = ADDRESS_LEAN + offset
    torso.rotation.y = offset * 0.25
    neck.rotation.z = offset * 0.08
    shoulderR.rotation.set(REST_SHOULDER_X + offset * 0.4, 0, REST_SHOULDER_Z_R)
    shoulderL.rotation.set(REST_SHOULDER_X + offset * 0.25, 0, REST_SHOULDER_Z_L)
    armR.elbow.rotation.set(REST_ELBOW_X + offset * 0.2, 0, 0)
    armL.elbow.rotation.set(REST_ELBOW_X + offset * 0.1, 0, 0)
  }

  function applyIdlePose(t: number): void {
    const bob = Math.sin(t * 1.6) * 0.012
    torso.position.y = 0.62 + bob
    neck.position.y = 0.95 + bob
    pack.position.y = 0.66 + bob

    // Blink: a short close every few seconds.
    const BLINK_PERIOD = 3.6
    const BLINK_DUR = 0.12
    const blinkPhase = t % BLINK_PERIOD
    const blinking = blinkPhase < BLINK_DUR
    const eyeY = blinking ? EYE_BASE_SCALE_Y * 0.12 : EYE_BASE_SCALE_Y
    for (const eye of eyes) eye.scale.y = eyeY

    // Mostly look at the ball (built-in +z front); occasionally glance up the line toward the
    // hole (+x) and back down. `look` eases 0 -> 1 -> 0 once every LOOK_PERIOD seconds.
    const LOOK_PERIOD = 6
    const lookPhase = t % LOOK_PERIOD
    let look = 0
    if (lookPhase > 4 && lookPhase < 5.2) {
      const p = (lookPhase - 4) / 0.6
      look = p < 1 ? easeInOut(Math.min(1, p)) : easeInOut(Math.max(0, 1 - (p - 1)))
    }
    neck.rotation.y = Math.sin(t * 0.35) * 0.1 + look * 0.5
    neck.rotation.x = -look * 0.22

    for (let i = 0; i < antennae.length; i++) {
      antennae[i].rotation.x = Math.sin(t * 1.2 + i) * 0.12
    }

    // Gentle club waggle behind the ball at rest.
    const waggle = watchTarget ? 0 : Math.sin(t * 2.2) * THREE.MathUtils.degToRad(6)
    applyClubAndTwist(waggle)
  }

  function applySwingPose(): void {
    if (phase === 'backswing') {
      const k = easeInOut(Math.min(1, phaseT / BACKSWING_DUR))
      swingOffset = THREE.MathUtils.lerp(0, -BACK_MAX * swingScale, k)
      if (phaseT >= BACKSWING_DUR) {
        phase = 'downswing'
        phaseT = 0
      }
    } else if (phase === 'downswing') {
      const k = easeInOut(Math.min(1, phaseT / DOWNSWING_DUR))
      swingOffset = THREE.MathUtils.lerp(-BACK_MAX * swingScale, CONTACT_OFFSET, k)
      if (phaseT >= DOWNSWING_DUR) {
        phase = 'follow'
        phaseT = 0
      }
    } else if (phase === 'follow') {
      const k = easeInOut(Math.min(1, phaseT / FOLLOW_DUR))
      swingOffset = THREE.MathUtils.lerp(CONTACT_OFFSET, FOLLOW_MAX * swingScale, k)
      if (phaseT >= FOLLOW_DUR + FOLLOW_HOLD) {
        // Head stays down through contact, then looks up the line to watch the putt.
        neck.rotation.x = 0
        if (watchTarget) {
          phase = 'idle'
          phaseT = 0
        } else {
          enterReturn()
        }
      }
    } else if (phase === 'return') {
      const k = easeInOut(Math.min(1, phaseT / RETURN_DUR))
      swingOffset = THREE.MathUtils.lerp(returnStartOffset, 0, k)
      if (phaseT >= RETURN_DUR) {
        phase = 'idle'
        phaseT = 0
      }
    }
    neck.rotation.x = phase === 'backswing' || phase === 'downswing' ? 0.1 : neck.rotation.x
    applyClubAndTwist(swingOffset)
  }

  function applyCheerPose(t: number): void {
    const k = Math.min(1, phaseT / CHEER_DUR)
    const jump = Math.abs(Math.sin(phaseT * 9)) * (1 - k) * 0.22
    bounceGroup.position.y = jump
    shoulderL.rotation.set(-2.2, 0, 0.4)
    shoulderR.rotation.set(-2.2, 0, -0.4)
    armL.elbow.rotation.set(-0.1, 0, 0)
    armR.elbow.rotation.set(-0.1, 0, 0)
    swingOffset = RAISED_OFFSET
    applyClubAndTwist(swingOffset)
    for (let i = 0; i < antennaTips.length; i++) {
      const flash = 0.6 + 0.4 * Math.sin(t * 14 + i * 2)
      ;(antennaTips[i].material as THREE.MeshStandardMaterial).emissiveIntensity = flash * 2.2
    }
    if (phaseT >= CHEER_DUR) {
      bounceGroup.position.y = 0
      enterReturn()
    }
  }

  /** Legs tucked, arms out for balance, a little forward lean while airborne on the jetpack. */
  function applyHopPose(): void {
    const k = Math.min(1, phaseT / HOP_DUR)
    const arc = Math.sin(k * Math.PI)
    legs.rotation.x = 0.12 - 0.9 * arc
    torso.rotation.x = 0.22 + 0.15 * arc
    neck.rotation.x = -0.1 * arc
    shoulderL.rotation.set(-0.6 - 0.4 * arc, 0, 1.0)
    shoulderR.rotation.set(-0.6 - 0.4 * arc, 0, -1.0)
    armL.elbow.rotation.set(-0.2, 0, 0)
    armR.elbow.rotation.set(-0.2, 0, 0)
    swingOffset = THREE.MathUtils.lerp(swingOffset, LOWERED_OFFSET, 0.2)
    handsPivot.rotation.z = ADDRESS_LEAN + swingOffset
    if (phaseT >= HOP_DUR) {
      legs.rotation.x = 0.12
      torso.rotation.x = 0.22
      neck.rotation.x = 0
      enterReturn()
    }
  }

  function applySlumpPose(): void {
    const k = Math.min(1, phaseT / SLUMP_DUR)
    const settle = easeInOut(Math.min(1, phaseT / 0.3))
    torso.position.y = 0.62 - 0.05 * settle
    neck.position.y = 0.95 - 0.06 * settle
    neck.rotation.z = Math.sin(phaseT * 6) * 0.15 * (1 - k)
    shoulderL.rotation.set(0.5, 0, 0.5)
    shoulderR.rotation.set(0.5, 0, -0.5)
    swingOffset = THREE.MathUtils.lerp(swingOffset, LOWERED_OFFSET, 0.15)
    handsPivot.rotation.z = ADDRESS_LEAN + swingOffset
    if (phaseT >= SLUMP_DUR) {
      torso.position.y = 0.62
      neck.position.y = 0.95
      neck.rotation.z = 0
      enterReturn()
    }
  }

  /** While the ball rolls: lower the club, shade eyes with the leading hand, and turn to watch. */
  function applyWatch(dt: number): void {
    if (!watchTarget) return
    localWatch.copy(watchTarget)
    group.worldToLocal(localWatch)
    const yaw = Math.atan2(localWatch.x, localWatch.z)
    const targetNeckYaw = THREE.MathUtils.clamp(yaw * 0.5, -0.7, 0.7)
    neck.rotation.y = THREE.MathUtils.damp(neck.rotation.y, targetNeckYaw, 6, dt)
    torso.rotation.y = THREE.MathUtils.damp(torso.rotation.y, targetNeckYaw * 0.35, 6, dt)
    // Shade eyes with the leading (left) hand.
    shoulderL.rotation.set(-1.3, 0, 0.45)
    armL.elbow.rotation.set(-0.7, 0, 0)
    // Lower the club out of the way.
    swingOffset = THREE.MathUtils.damp(swingOffset, LOWERED_OFFSET, 6, dt)
    handsPivot.rotation.z = ADDRESS_LEAN + swingOffset
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
      if (watchTarget) applyWatch(dt)
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
