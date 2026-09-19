import { useEffect, useRef } from 'react'
import type { EngineApi, EngineEvents } from '../render/engineApi.ts'
import { createEngine } from '../render/Engine.ts'

interface GameCanvasProps {
  events: EngineEvents
  onReady: (api: EngineApi | null) => void
}

/**
 * Owns the canvas and the engine's lifecycle. The engine is created exactly once per real mount
 * and disposed on unmount, which also makes this safe under React StrictMode's double-invoke:
 * the effect runs create -> dispose -> create, and each create/dispose pair is self-contained.
 *
 * `events` is forwarded through a ref so the engine (built once) always calls the latest
 * versions of the callbacks, even though the engine itself is never recreated when the parent
 * re-renders with a new `events` object.
 */
export default function GameCanvas({ events, onReady }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const eventsRef = useRef(events)
  eventsRef.current = events

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const stableEvents: EngineEvents = {
      onAimChange: (aim, dragging) => eventsRef.current.onAimChange(aim, dragging),
      onLaunch: (aim) => eventsRef.current.onLaunch(aim),
      onBounce: (speed) => eventsRef.current.onBounce(speed),
      onResult: (result) => eventsRef.current.onResult(result),
      onLieChange: (lie) => eventsRef.current.onLieChange(lie),
      onTap: (pos) => eventsRef.current.onTap(pos),
    }

    const api = createEngine(canvas, stableEvents)
    onReady(api)

    return () => {
      onReady(null)
      api.dispose()
    }
    // Intentionally mount-once: the engine is created for the lifetime of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <canvas ref={canvasRef} className="game-canvas" aria-label="Orbit Golf 3D view" />
}
