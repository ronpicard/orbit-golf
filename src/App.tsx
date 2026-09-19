import { useEffect, useRef, useState } from 'react'
import { createAudio } from './audio.ts'
import type { GameAudio } from './audio.ts'
import { clampAim, defaultAim, onFairway, targetPosition } from './game/physics.ts'
import { LEVELS, SANDBOX_LEVEL, makeSandboxBody } from './game/levels.ts'
import type { SandboxSize } from './game/levels.ts'
import { isUnlocked, loadProgress, recordResult, saveProgress, totalScore } from './game/progress.ts'
import type { Progress } from './game/progress.ts'
import type { Aim, Level, ShotResult, Vec2 } from './game/types.ts'
import type { EngineApi, EngineEvents } from './render/engineApi.ts'
import GameCanvas from './ui/GameCanvas.tsx'
import Hud from './ui/Hud.tsx'
import Menu from './ui/Menu.tsx'
import Minimap from './ui/Minimap.tsx'
import ResultCard from './ui/ResultCard.tsx'
import type { ResultInfo } from './ui/ResultCard.tsx'
import SandboxPalette from './ui/SandboxPalette.tsx'
import type { SandboxTool } from './ui/SandboxPalette.tsx'
import Toast from './ui/Toast.tsx'
import { loadCoached, loadMuted, safeLocalStorage, saveCoached, saveMuted } from './ui/storage.ts'

type Mode = 'menu' | 'level' | 'sandbox'

interface Route {
  screen: Mode
  index: number
}

const MAX_SANDBOX_BODIES = 10
const ERASE_RADIUS = 1.5
const PLACEMENT_CLEARANCE = 1.5
const STROKE_LIMIT = 10
const NEAR_MISS_DISTANCE = 1.2
const SANDBOX_GOAL_RESET_MS = 1200

function parseHash(hash: string): Route {
  const levelMatch = /^#\/level\/(\d+)$/.exec(hash)
  if (levelMatch) {
    const n = Number(levelMatch[1])
    if (Number.isInteger(n) && n >= 1 && n <= LEVELS.length) {
      return { screen: 'level', index: n - 1 }
    }
    return { screen: 'menu', index: 0 }
  }
  if (hash === '#/sandbox') return { screen: 'sandbox', index: 0 }
  return { screen: 'menu', index: 0 }
}

function hashFor(mode: Mode, levelIndex: number): string {
  if (mode === 'level') return `#/level/${levelIndex + 1}`
  if (mode === 'sandbox') return '#/sandbox'
  return '#/'
}

function firstPlayableLevelIndex(progress: Progress): number {
  for (let i = 0; i < LEVELS.length; i++) {
    if (isUnlocked(progress, LEVELS, i) && progress.best[LEVELS[i].id] === undefined) return i
  }
  return 0
}

/** Wording for a lost stroke, based on what the ball touched (or left the course entirely). */
function hazardMessage(hazardId: string | null, level: Level): string {
  if (hazardId === null) return 'Out of bounds - replay the stroke'
  const body = level.bodies.find((b) => b.id === hazardId)
  if (!body) return 'Out of bounds - replay the stroke'
  switch (body.kind) {
    case 'planet':
      return 'Burned up on a planet - replay the stroke'
    case 'moon':
      return 'Hit a moon - replay the stroke'
    case 'asteroid':
      return 'Smacked an asteroid - replay the stroke'
    case 'blackhole':
      return 'Swallowed by the black hole - replay the stroke'
  }
}

/** Wording for a stroke that rolled to a stop short of the cup. */
function restMessage(result: ShotResult, level: Level): string {
  if (result.closest <= NEAR_MISS_DISTANCE) return 'So close!'
  const cup = targetPosition(level.target, 0)
  const distance = Math.hypot(cup.x - result.end.x, cup.y - result.end.y)
  return `${distance.toFixed(1)} to the hole`
}

export default function App() {
  const [storage] = useState(() => safeLocalStorage())
  const [audio] = useState<GameAudio>(() => createAudio())

  const [progress, setProgress] = useState<Progress>(() => loadProgress(storage))
  // Start on the deep-linked screen. Starting on the menu would let the hash-sync effect below
  // overwrite the incoming hash before it is ever read.
  const [initialRoute] = useState(() => {
    const route = parseHash(window.location.hash)
    return route.screen === 'level' && !isUnlocked(progress, LEVELS, route.index)
      ? ({ screen: 'menu', index: 0 } as Route)
      : route
  })
  const [mode, setMode] = useState<Mode>(initialRoute.screen)
  const [levelIndex, setLevelIndex] = useState(initialRoute.index)
  const [sandboxLevel, setSandboxLevel] = useState<Level>(() => structuredClone(SANDBOX_LEVEL))
  const [sandboxTool, setSandboxTool] = useState<SandboxTool>('small')

  const [engine, setEngine] = useState<EngineApi | null>(null)
  const [aim, setAim] = useState<Aim>(() => defaultAim(LEVELS[0], LEVELS[0].tee))
  const [lie, setLie] = useState<Vec2>(() => LEVELS[0].tee)
  const [isFlying, setIsFlying] = useState(false)
  const [strokes, setStrokes] = useState(0)
  const [muted, setMuted] = useState<boolean>(() => loadMuted(storage))
  const [coached, setCoached] = useState<boolean>(() => loadCoached(storage))
  const [resultInfo, setResultInfo] = useState<ResultInfo | null>(null)
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)

  const progressRef = useRef(progress)
  const toastTimerRef = useRef<number | undefined>(undefined)
  const toastIdRef = useRef(0)
  const unlockedAudioRef = useRef(false)
  const launchWhooshTimerRef = useRef<number | undefined>(undefined)

  function clearLaunchWhooshTimer() {
    if (launchWhooshTimerRef.current !== undefined) {
      window.clearTimeout(launchWhooshTimerRef.current)
      launchWhooshTimerRef.current = undefined
    }
  }

  useEffect(() => {
    progressRef.current = progress
  }, [progress])

  // Sync mute setting into the audio engine once at startup.
  useEffect(() => {
    audio.setMuted(muted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentLevel: Level = mode === 'level' ? LEVELS[levelIndex] : mode === 'sandbox' ? sandboxLevel : LEVELS[0]

  // Load the level whenever the screen or level index changes (not on sandbox body edits, which
  // are applied directly with keepTrails so the trail history survives). The engine emits the
  // tee as the new lie and its own default aim once the level is loaded.
  useEffect(() => {
    if (!engine) return
    clearLaunchWhooshTimer()
    const level = mode === 'level' ? LEVELS[levelIndex] : mode === 'sandbox' ? sandboxLevel : LEVELS[0]
    engine.loadLevel(level)
    setIsFlying(false)
    setResultInfo(null)
    if (mode === 'level') {
      setStrokes(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, levelIndex, engine])

  // Cancel any pending delayed launch whoosh on unmount.
  useEffect(() => {
    return () => clearLaunchWhooshTimer()
  }, [])

  // Keep location.hash in sync with the current screen.
  useEffect(() => {
    const next = hashFor(mode, levelIndex)
    if (window.location.hash !== next) window.location.hash = next
  }, [mode, levelIndex])

  // Apply the initial hash and react to back/forward navigation.
  useEffect(() => {
    function apply() {
      const route = parseHash(window.location.hash)
      if (route.screen === 'level') {
        if (isUnlocked(progressRef.current, LEVELS, route.index)) {
          setLevelIndex(route.index)
          setMode('level')
        } else {
          setMode('menu')
        }
      } else if (route.screen === 'sandbox') {
        setMode('sandbox')
      } else {
        setMode('menu')
      }
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [])

  // Unlock audio on the very first user gesture.
  useEffect(() => {
    function unlock() {
      if (unlockedAudioRef.current) return
      unlockedAudioRef.current = true
      audio.unlock()
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [audio])

  function showToast(text: string) {
    toastIdRef.current += 1
    const id = toastIdRef.current
    setToast({ id, text })
    if (toastTimerRef.current !== undefined) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => {
      setToast((current) => (current && current.id === id ? null : current))
    }, 2200)
  }

  function restart() {
    if (!engine) return
    const level = mode === 'sandbox' ? sandboxLevel : LEVELS[levelIndex]
    engine.loadLevel(level)
    setStrokes(0)
    setIsFlying(false)
    setResultInfo(null)
  }

  function applySandboxLevel(next: Level) {
    setSandboxLevel(next)
    engine?.loadLevel(next, { keepTrails: true })
  }

  function handleSandboxReset() {
    const fresh = structuredClone(SANDBOX_LEVEL)
    setSandboxLevel(fresh)
    engine?.loadLevel(fresh)
  }

  function handleSandboxTap(pos: Vec2) {
    const level = sandboxLevel
    if (sandboxTool === 'erase') {
      let nearestIndex = -1
      let nearestDistance = Infinity
      level.bodies.forEach((b, i) => {
        const d = Math.hypot(b.pos.x - pos.x, b.pos.y - pos.y)
        if (d < nearestDistance) {
          nearestDistance = d
          nearestIndex = i
        }
      })
      if (nearestIndex === -1 || nearestDistance > ERASE_RADIUS) {
        showToast('Nothing nearby to erase')
        return
      }
      applySandboxLevel({ ...level, bodies: level.bodies.filter((_, i) => i !== nearestIndex) })
      return
    }

    if (level.bodies.length >= MAX_SANDBOX_BODIES) {
      showToast('Sandbox is full')
      return
    }

    if (!onFairway(level, pos)) {
      showToast('Cannot place here')
      return
    }

    const size: SandboxSize = sandboxTool
    const candidate = makeSandboxBody(pos, size, level.bodies.length)
    const cup = targetPosition(level.target, 0)

    const tooCloseToLie = Math.hypot(lie.x - pos.x, lie.y - pos.y) < PLACEMENT_CLEARANCE
    const tooCloseToCup = Math.hypot(cup.x - pos.x, cup.y - pos.y) < PLACEMENT_CLEARANCE
    const overlapsBody = level.bodies.some(
      (b) => Math.hypot(b.pos.x - candidate.pos.x, b.pos.y - candidate.pos.y) < b.radius + candidate.radius,
    )

    if (tooCloseToLie || tooCloseToCup || overlapsBody) {
      showToast('Cannot place here')
      return
    }

    applySandboxLevel({ ...level, bodies: [...level.bodies, candidate] })
  }

  function handleResult(result: ShotResult) {
    // After a miss the engine is still moving the golfer to the ball; onLieChange ends the shot.
    if (result.outcome === 'goal') setIsFlying(false)

    if (mode === 'sandbox') {
      if (result.outcome === 'goal') {
        audio.cupDrop()
        audio.cheer()
        showToast('Hole in!')
        window.setTimeout(() => {
          engine?.loadLevel(sandboxLevel)
        }, SANDBOX_GOAL_RESET_MS)
      } else if (result.outcome === 'hazard') {
        audio.crash()
        audio.groan()
        showToast(hazardMessage(result.hazardId, sandboxLevel))
      }
      return
    }

    if (mode !== 'level') return
    const level = LEVELS[levelIndex]

    if (result.outcome === 'goal') {
      const finalStrokes = strokes
      const previousBest = progress.best[level.id]
      const nextProgress = recordResult(progress, level.id, finalStrokes)
      setProgress(nextProgress)
      saveProgress(nextProgress, storage)
      audio.cupDrop()
      audio.goal()
      audio.cheer()
      const total = totalScore(nextProgress, LEVELS)
      setResultInfo({
        levelIndex,
        levelName: level.name,
        par: level.par,
        strokes: finalStrokes,
        isNewBest: previousBest === undefined || finalStrokes < previousBest,
        totalStrokes: total.strokes,
        totalPar: total.par,
        totalCompleted: total.completed,
        pickedUp: false,
      })
      return
    }

    if (strokes >= STROKE_LIMIT) {
      const nextProgress = recordResult(progress, level.id, STROKE_LIMIT)
      setProgress(nextProgress)
      saveProgress(nextProgress, storage)
      const total = totalScore(nextProgress, LEVELS)
      setResultInfo({
        levelIndex,
        levelName: level.name,
        par: level.par,
        strokes: STROKE_LIMIT,
        isNewBest: false,
        totalStrokes: total.strokes,
        totalPar: total.par,
        totalCompleted: total.completed,
        pickedUp: true,
      })
      return
    }

    if (result.outcome === 'hazard') {
      audio.crash()
      audio.groan()
      showToast(hazardMessage(result.hazardId, level))
    } else {
      if (result.closest <= NEAR_MISS_DISTANCE) audio.groan()
      showToast(restMessage(result, level))
    }
  }

  const events: EngineEvents = {
    onAimChange: (nextAim) => setAim(nextAim),
    onLaunch: (launchAim) => {
      setStrokes((c) => c + 1)
      setIsFlying(true)
      audio.swing(launchAim.power)
      clearLaunchWhooshTimer()
      launchWhooshTimerRef.current = window.setTimeout(() => {
        launchWhooshTimerRef.current = undefined
        audio.launch(launchAim.power)
      }, 320)
      if (!coached) {
        setCoached(true)
        saveCoached(storage)
      }
    },
    onBounce: (speed) => audio.bounce(speed),
    onResult: handleResult,
    onLieChange: (nextLie) => {
      setIsFlying(false)
      setLie(nextLie)
      if (engine) setAim(engine.getAim())
    },
    onTap: (pos) => {
      if (mode === 'sandbox') handleSandboxTap(pos)
    },
  }

  function goToMenu() {
    setResultInfo(null)
    setMode('menu')
  }

  function handlePlay() {
    setLevelIndex(firstPlayableLevelIndex(progress))
    setMode('level')
  }

  function handleSelectLevel(index: number) {
    if (!isUnlocked(progress, LEVELS, index)) return
    setLevelIndex(index)
    setMode('level')
  }

  function handleSandbox() {
    setMode('sandbox')
  }

  function toggleMute() {
    setMuted((m) => {
      const next = !m
      audio.setMuted(next)
      saveMuted(storage, next)
      return next
    })
  }

  function handleResultNext() {
    setResultInfo(null)
    if (levelIndex + 1 < LEVELS.length) setLevelIndex(levelIndex + 1)
    else setMode('menu')
  }

  function handleResultReplay() {
    setResultInfo(null)
    restart()
  }

  // Desktop keyboard controls.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (mode !== 'level' && mode !== 'sandbox') {
        if (e.key === 'Escape') goToMenu()
        return
      }
      const multiplier = e.shiftKey ? 5 : 1
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          if (engine) {
            const current = engine.getAim()
            engine.setAim(clampAim({ angle: current.angle - (0.5 * multiplier * Math.PI) / 180, power: current.power }))
            audio.tick()
          }
          break
        case 'ArrowRight':
          e.preventDefault()
          if (engine) {
            const current = engine.getAim()
            engine.setAim(clampAim({ angle: current.angle + (0.5 * multiplier * Math.PI) / 180, power: current.power }))
            audio.tick()
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          if (engine) {
            const current = engine.getAim()
            engine.setAim(clampAim({ angle: current.angle, power: current.power + (0.01 * multiplier) }))
            audio.tick()
          }
          break
        case 'ArrowDown':
          e.preventDefault()
          if (engine) {
            const current = engine.getAim()
            engine.setAim(clampAim({ angle: current.angle, power: current.power - (0.01 * multiplier) }))
            audio.tick()
          }
          break
        case ' ':
        case 'Enter':
          e.preventDefault()
          if (engine) {
            if (engine.isFlying()) {
              engine.abort()
              clearLaunchWhooshTimer()
            } else engine.fire()
          }
          break
        case 'r':
        case 'R':
          if (mode === 'level') restart()
          break
        case 'Escape':
          goToMenu()
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, engine, levelIndex, sandboxLevel])

  return (
    <div className="app-root">
      <GameCanvas events={events} onReady={setEngine} />

      <div className="overlay-layer">
        {mode === 'menu' && (
          <Menu levels={LEVELS} progress={progress} onPlay={handlePlay} onSelectLevel={handleSelectLevel} onSandbox={handleSandbox} />
        )}

        {(mode === 'level' || mode === 'sandbox') && (
          <>
            <Hud
              engine={engine}
              onAbort={clearLaunchWhooshTimer}
              audio={audio}
              level={currentLevel}
              levelNumber={mode === 'level' ? levelIndex + 1 : null}
              aim={aim}
              isFlying={isFlying}
              strokes={mode === 'level' ? strokes : null}
              muted={muted}
              showCoachMark={mode === 'level' && levelIndex === 0 && !coached}
              onBack={goToMenu}
              onRestart={mode === 'level' ? restart : undefined}
              onToggleMute={toggleMute}
            />
            <Minimap level={currentLevel} lie={lie} aim={aim} levelNumber={mode === 'level' ? levelIndex + 1 : null} />
            {mode === 'sandbox' && (
              <SandboxPalette
                tool={sandboxTool}
                onSelectTool={setSandboxTool}
                onClearTrails={() => engine?.clearTrails()}
                onReset={handleSandboxReset}
              />
            )}
          </>
        )}

        {resultInfo && (
          <ResultCard
            result={resultInfo}
            isLastLevel={resultInfo.levelIndex === LEVELS.length - 1}
            onNext={handleResultNext}
            onReplay={handleResultReplay}
            onMenu={goToMenu}
          />
        )}

        {toast && <Toast key={toast.id} text={toast.text} />}
      </div>
    </div>
  )
}
