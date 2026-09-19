import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { GameAudio } from '../audio.ts'
import { clampAim } from '../game/physics.ts'
import type { Aim, Level } from '../game/types.ts'
import type { EngineApi } from '../render/engineApi.ts'
import { BackIcon, MinusIcon, MuteIcon, PlusIcon, RestartIcon, UnmuteIcon } from './icons.tsx'

const HOLD_DELAY_MS = 350
const HOLD_INTERVAL_MS = 60

interface HoldButtonProps {
  label: string
  className: string
  onTrigger: () => void
  children: ReactNode
}

/**
 * A button that fires once per tap (via the native click event, so keyboard/Enter and screen
 * readers still work) and repeats every 60ms once held past 350ms.
 */
function HoldButton({ label, className, onTrigger, children }: HoldButtonProps) {
  const timeoutRef = useRef<number | undefined>(undefined)
  const intervalRef = useRef<number | undefined>(undefined)

  function clear() {
    if (timeoutRef.current !== undefined) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }
    if (intervalRef.current !== undefined) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = undefined
    }
  }

  function startHold() {
    timeoutRef.current = window.setTimeout(() => {
      intervalRef.current = window.setInterval(onTrigger, HOLD_INTERVAL_MS)
    }, HOLD_DELAY_MS)
  }

  useEffect(() => clear, [])

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      onClick={onTrigger}
      onPointerDown={startHold}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
    >
      {children}
    </button>
  )
}

function formatAngle(angleRad: number): string {
  const deg = ((angleRad * 180) / Math.PI + 360) % 360
  return deg.toFixed(1)
}

function formatPower(power: number): string {
  return Math.round(power * 100).toString()
}

interface HudProps {
  engine: EngineApi | null
  /** Called after the ABORT button cancels a flight, so the app can cancel pending launch audio. */
  onAbort: () => void
  audio: GameAudio
  level: Level
  levelNumber: number | null
  aim: Aim
  isFlying: boolean
  strokes: number | null
  muted: boolean
  showCoachMark: boolean
  onBack: () => void
  onRestart?: () => void
  onToggleMute: () => void
}

function powerColorClass(power: number): string {
  if (power < 0.4) return 'power-low'
  if (power < 0.75) return 'power-mid'
  return 'power-high'
}

export default function Hud({
  engine,
  onAbort,
  audio,
  level,
  levelNumber,
  aim,
  isFlying,
  strokes,
  muted,
  showCoachMark,
  onBack,
  onRestart,
  onToggleMute,
}: HudProps) {
  const [launchedOnce, setLaunchedOnce] = useState(false)
  const [autoHidden, setAutoHidden] = useState(false)

  useEffect(() => {
    setLaunchedOnce(false)
    setAutoHidden(false)
  }, [level.id])

  useEffect(() => {
    if (isFlying) setLaunchedOnce(true)
  }, [isFlying])

  useEffect(() => {
    const mq = window.matchMedia('(max-height: 480px)')
    if (!mq.matches) return
    const timer = window.setTimeout(() => setAutoHidden(true), 3000)
    return () => window.clearTimeout(timer)
  }, [level.id])

  function nudgeAngle(deltaDeg: number) {
    if (!engine) return
    const current = engine.getAim()
    engine.setAim(clampAim({ angle: current.angle + (deltaDeg * Math.PI) / 180, power: current.power }))
    audio.tick()
  }

  function nudgePower(deltaPercent: number) {
    if (!engine) return
    const current = engine.getAim()
    engine.setAim(clampAim({ angle: current.angle, power: current.power + deltaPercent / 100 }))
    audio.tick()
  }

  function handleFire() {
    if (!engine) return
    if (isFlying) {
      engine.abort()
      onAbort()
    } else engine.fire()
  }

  const showHint = !launchedOnce && !autoHidden

  return (
    <>
      <div className="top-bar">
        <button type="button" className="icon-button" aria-label="Back to menu" onClick={onBack}>
          <BackIcon />
        </button>
        <div className="top-bar-title">
          <span className="level-title">{levelNumber !== null ? `Hole ${levelNumber} - ${level.name}` : level.name}</span>
          {strokes !== null && (
            <span className="level-meta">
              Par {level.par} &middot; Strokes {strokes}
            </span>
          )}
        </div>
        <div className="top-bar-actions">
          {onRestart && (
            <button type="button" className="icon-button" aria-label="Replay hole" onClick={onRestart}>
              <RestartIcon />
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={onToggleMute}
          >
            {muted ? <MuteIcon /> : <UnmuteIcon />}
          </button>
        </div>
      </div>

      <div className={`hint-pill ${showHint ? 'visible' : ''}`}>{level.hint}</div>

      {showCoachMark && (
        <div className="coach-mark" aria-hidden="true">
          <div className="coach-mark-track">
            <span className="coach-dot coach-dot-3" />
            <span className="coach-dot coach-dot-2" />
            <span className="coach-dot coach-dot-1" />
          </div>
          <p className="coach-caption">Drag toward the hole, release to putt</p>
        </div>
      )}

      <div className="bottom-bar">
        <div className="readout-group">
          <span className="readout-label">Angle</span>
          <div className="readout-controls">
            <HoldButton label="Decrease angle" className="nudge-button" onTrigger={() => nudgeAngle(-0.5)}>
              <MinusIcon />
            </HoldButton>
            <span className="readout-value">{formatAngle(aim.angle)}&deg;</span>
            <HoldButton label="Increase angle" className="nudge-button" onTrigger={() => nudgeAngle(0.5)}>
              <PlusIcon />
            </HoldButton>
          </div>
        </div>

        <button
          type="button"
          className={`fire-button ${isFlying ? 'abort' : ''}`}
          aria-label={isFlying ? 'Abort flight' : 'Fire probe'}
          onClick={handleFire}
        >
          {isFlying ? 'ABORT' : 'FIRE'}
        </button>

        <div className="readout-group">
          <span className="readout-label">Power</span>
          <div className="readout-controls">
            <HoldButton label="Decrease power" className="nudge-button" onTrigger={() => nudgePower(-1)}>
              <MinusIcon />
            </HoldButton>
            <span className="readout-value">{formatPower(aim.power)}%</span>
            <HoldButton label="Increase power" className="nudge-button" onTrigger={() => nudgePower(1)}>
              <PlusIcon />
            </HoldButton>
          </div>
          <div className="power-meter" role="presentation">
            <div
              className={`power-meter-fill ${powerColorClass(aim.power)}`}
              style={{ width: `${Math.round(aim.power * 100)}%` }}
            />
          </div>
        </div>
      </div>
    </>
  )
}
