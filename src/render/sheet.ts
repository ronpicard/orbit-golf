import type { Level } from '../game/types.ts'
import { bodyPosition } from '../game/physics.ts'

/**
 * The gravity-well "rubber sheet" that every visual (probe, trails, rails, bodies, target) sits on.
 * `wellDepthAt` below and the `wellDepth()` GLSL function built by `wellDepthGlsl()` must compute the
 * identical smooth-clamped depth, so the ground mesh and everything resting on it agree exactly.
 */

/** Steepness of the raw inverse-distance sum, before the smooth clamp. */
export const WELL_K = 0.14
/** Asymptotic maximum depth: raw potential is smoothly clamped to approach, never exceed, this. */
export const WELL_D = 4.4

/** Depth (a positive number of world units to push down) of the sheet at physics-plane (x, y), time t. */
export function wellDepthAt(level: Level, x: number, y: number, t: number): number {
  let raw = 0
  for (const body of level.bodies) {
    if (body.mu <= 0) continue
    const p = bodyPosition(body, t)
    const dx = p.x - x
    const dy = p.y - y
    const r2 = dx * dx + dy * dy
    raw += body.mu / Math.sqrt(r2 + body.radius * body.radius)
  }
  raw *= WELL_K
  return WELL_D * (1 - Math.exp(-raw / WELL_D))
}

/**
 * GLSL `wellDepth(vec2 p)` body. Expects `MAX_BODIES`, `uBodies` (xz = position, y = mu), `uSoft`
 * (per-body softening radius) and `uCount` to already be declared in the including shader.
 */
export const WELL_DEPTH_GLSL = `
  const float K = ${WELL_K.toFixed(6)};
  const float D = ${WELL_D.toFixed(6)};
  float wellDepth(vec2 p) {
    float raw = 0.0;
    for (int i = 0; i < MAX_BODIES; i++) {
      if (i >= uCount) break;
      vec2 d = p - uBodies[i].xz;
      float r2 = dot(d, d);
      float s = uSoft[i];
      raw += uBodies[i].y / sqrt(r2 + s * s);
    }
    raw *= K;
    return D * (1.0 - exp(-raw / D));
  }
`
