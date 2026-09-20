import type { Aim, Level, ShotResult, Vec2 } from '../game/types.ts'

/** Callbacks from the 3D engine to the React shell. All are invoked on the main thread. */
export interface EngineEvents {
  /** The aim changed by dragging (dragging = true) or by setAim (dragging = false). */
  onAimChange(aim: Aim, dragging: boolean): void
  /** A stroke was played. Fired when the swing starts, for drag-release launches and for fire(). */
  onLaunch(aim: Aim): void
  /** The ball hit a wall. `speed` is the speed into the wall, for scaling sound. */
  onBounce(speed: number): void
  /** The ball went through a wormhole. */
  onWarp(): void
  /** The shot ended. Not fired when a shot is cancelled by abort() or loadLevel(). */
  onResult(result: ShotResult): void
  /**
   * The ball's lie changed: where the next stroke will be played from. Fired after loadLevel (the
   * tee), after a 'rest' (the new resting point), and after a 'hazard' (back at the shot's start).
   */
  onLieChange(lie: Vec2): void
  /** A press and release with no drag, in physics-plane coordinates. Used by the sandbox editor. */
  onTap(pos: Vec2): void
}

export interface LoadOptions {
  /** Keep earlier trails and the current lie. Used when the sandbox edits its level in place. */
  keepTrails?: boolean
}

export interface EngineApi {
  loadLevel(level: Level, options?: LoadOptions): void
  setAim(aim: Aim): void
  getAim(): Aim
  /** Where the next stroke is played from. */
  getLie(): Vec2
  /** Plays a stroke with the current aim. Ignored while a shot is in progress. */
  fire(): void
  /** Cancels the shot in progress without reporting a result. The ball returns to its lie. */
  abort(): void
  clearTrails(): void
  /** True from the start of the swing until the shot has ended. */
  isFlying(): boolean
  /** Re-reads the canvas size. The engine also observes its canvas, so this is rarely needed. */
  resize(): void
  dispose(): void
}
