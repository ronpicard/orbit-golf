import type { Body, BodyKind, Level } from '../game/types.ts'
import { bodyPosition } from '../game/physics.ts'

/**
 * The gravity-well "rubber sheet" that every visual (probe, trails, rails, bodies, target) sits on.
 * `wellDepthAt` below and the `wellDepth()` GLSL function in `WELL_DEPTH_GLSL` must compute the
 * identical smooth-clamped depth, so the ground mesh and everything resting on it agree exactly.
 *
 * Depth is signed. A body hanging below the sheet pulls it down into a well (positive depth); a
 * body floating above lifts it into a hill (negative depth). The pull on the ball is the same
 * either way: the sheet only shows which side the mass is on.
 */

/** Steepness of the raw inverse-distance sum, before the smooth clamp. */
export const WELL_K = 0.14
/** Asymptotic maximum depth of a well: raw potential approaches, never exceeds, this. */
export const WELL_D = 4.4
/** Asymptotic maximum height of a hill. Lower than a well so a hill never hides the hole. */
export const HILL_D = 2.4

/** How hard each kind of body bends the sheet for its mass. A black hole digs far deeper. */
const KIND_BEND: Record<BodyKind, number> = { planet: 1, moon: 0.85, blackhole: 1.9, asteroid: 0 }

/**
 * The signed mass the sheet sees for a body: mu scaled by kind, negative for a body above the
 * sheet. This is the value the renderer uploads as `uBodies[i].y`.
 */
export function sheetMass(body: Body): number {
  const bend = body.mu * KIND_BEND[body.kind]
  return body.side === 'above' ? -bend : bend
}

/** Signed depth (world units to push down; negative lifts) of the sheet at plane (x, y), time t. */
export function wellDepthAt(level: Level, x: number, y: number, t: number): number {
  let down = 0
  let up = 0
  for (const body of level.bodies) {
    const mass = sheetMass(body)
    if (mass === 0) continue
    const p = bodyPosition(body, t)
    const dx = p.x - x
    const dy = p.y - y
    const r2 = dx * dx + dy * dy
    const term = Math.abs(mass) / Math.sqrt(r2 + body.radius * body.radius)
    if (mass > 0) down += term
    else up += term
  }
  return WELL_D * (1 - Math.exp((-down * WELL_K) / WELL_D)) - HILL_D * (1 - Math.exp((-up * WELL_K) / HILL_D))
}

/**
 * World height of a body's centre. A body below the sheet floats in the mouth of its well, high
 * enough to be seen from the tee; a body above hovers clear of the crest of its hill.
 */
export function bodyHeight(level: Level, body: Body, t: number): number {
  const p = bodyPosition(body, t)
  const depth = wellDepthAt(level, p.x, p.y, t)
  if (body.side === 'above') return -depth + body.radius + 0.9
  if (body.mu <= 0) return -depth + body.radius * 0.6
  return -0.3 * depth + body.radius * 0.6
}

/**
 * GLSL `wellDepth(vec2 p)` body. Expects `MAX_BODIES`, `uBodies` (xz = position, y = sheetMass),
 * `uSoft` (per-body softening radius) and `uCount` to already be declared in the including shader.
 */
export const WELL_DEPTH_GLSL = `
  const float K = ${WELL_K.toFixed(6)};
  const float D = ${WELL_D.toFixed(6)};
  const float H = ${HILL_D.toFixed(6)};
  float wellDepth(vec2 p) {
    float down = 0.0;
    float up = 0.0;
    for (int i = 0; i < MAX_BODIES; i++) {
      if (i >= uCount) break;
      vec2 d = p - uBodies[i].xz;
      float r2 = dot(d, d);
      float s = uSoft[i];
      float term = abs(uBodies[i].y) / sqrt(r2 + s * s);
      if (uBodies[i].y > 0.0) down += term; else up += term;
    }
    return D * (1.0 - exp(-down * K / D)) - H * (1.0 - exp(-up * K / H));
  }
`
