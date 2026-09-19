import type { Aim, Level, SimResult, Vec2 } from '../game/types.ts'

/** Callbacks from the 3D engine to the React shell. All are invoked on the main thread. */
export interface EngineEvents {
  /** The aim changed by dragging (dragging = true) or by setAim (dragging = false). */
  onAimChange(aim: Aim, dragging: boolean): void
  /** A probe left the home planet. Fired for drag-release launches and for fire(). */
  onLaunch(aim: Aim): void
  /** The flight ended. Not fired when a flight is cancelled by abort() or loadLevel(). */
  onResult(result: SimResult): void
  /** A press and release with no drag, in physics-plane coordinates. Used by the sandbox editor. */
  onTap(pos: Vec2): void
}

export interface LoadOptions {
  /** Keep the trails of earlier attempts. Used when the sandbox edits its level in place. */
  keepTrails?: boolean
}

export interface EngineApi {
  loadLevel(level: Level, options?: LoadOptions): void
  setAim(aim: Aim): void
  getAim(): Aim
  /** Launches with the current aim. Ignored while a probe is in flight. */
  fire(): void
  /** Cancels the flight in progress without reporting a result. */
  abort(): void
  clearTrails(): void
  isFlying(): boolean
  /** Re-reads the canvas size. The engine also observes its canvas, so this is rarely needed. */
  resize(): void
  dispose(): void
}
