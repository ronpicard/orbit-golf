import { useEffect, useRef, useState } from 'react'
import { createAudio } from './audio.ts'
import type { GameAudio } from './audio.ts'
import { bodyPosition, clampAim, defaultAim, homeBody, targetPosition } from './game/physics.ts'
import { LEVELS, SANDBOX_LEVEL, makeSandboxBody } from './game/levels.ts'
import type { SandboxSize } from './game/levels.ts'
import { isUnlocked, loadProgress, recordResult, saveProgress, totalScore } from './game/progress.ts'
import type { Progress } from './game/progress.ts'
import type { Aim, Level, SimResult, Vec2 } from './game/types.ts'
import type { EngineApi, EngineEvents } from './render/engineApi.ts'
import GameCanvas from './ui/GameCanvas.tsx'
import Hud from './ui/Hud.tsx'
import Menu from './ui/Menu.tsx'
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

function crashMessage(crashedInto: string | null, level: Level): string {
  const body = level.bodies.find((b) => b.id === crashedInto)
  if (!body) return 'Crashed'
  if (body.kind === 'blackhole') return 'Swallowed by the black hole'
  if (body.kind === 'moon') return 'Crashed into a moon'
  if (body.kind === 'asteroid') return 'Crashed into an asteroid'
  return 'Crashed into a planet'
}

function outcomeToast(result: SimResult, level: Level): string {
  if (result.outcome === 'crash') return crashMessage(result.crashedInto, level)
  if (result.outcome === 'lost') return `Lost in deep space — missed the gate by ${result.closest.toFixed(1)}`
  if (result.outcome === 'timeout') return `Out of power — missed the gate by ${result.closest.toFixed(1)}`
  return ''
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
  const [aim, setAim] = useState<Aim>(() => defaultAim(LEVELS[0]))
  const [isFlying, setIsFlying] = useState(false)
  const [launchCount, setLaunchCount] = useState(0)
  const [muted, setMuted] = useState<boolean>(() => loadMuted(storage))
  const [coached, setCoached] = useState<boolean>(() => loadCoached(storage))
  const [resultInfo, setResultInfo] = useState<ResultInfo | null>(null)
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)

  const progressRef = useRef(progress)
  const toastTimerRef = useRef<number | undefined>(undefined)
  const toastIdRef = useRef(0)
  const unlockedAudioRef = useRef(false)

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
  // are applied directly with keepTrails so the trail history survives).
  useEffect(() => {
    if (!engine) return
    const level = mode === 'level' ? LEVELS[levelIndex] : mode === 'sandbox' ? sandboxLevel : LEVELS[0]
    engine.loadLevel(level)
    const nextAim = defaultAim(level)
    engine.setAim(nextAim)
    setAim(nextAim)
    setIsFlying(false)
    setResultInfo(null)
    if (mode === 'level') {
      setLaunchCount(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, levelIndex, engine])

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
    const nextAim = defaultAim(level)
    engine.setAim(nextAim)
    setAim(nextAim)
    setLaunchCount(0)
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
        if (b.id === level.homeId) return
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

    const placedCount = level.bodies.filter((b) => b.id !== level.homeId).length
    if (placedCount >= MAX_SANDBOX_BODIES) {
      showToast('Sandbox is full')
      return
    }

    const size: SandboxSize = sandboxTool
    const candidate = makeSandboxBody(pos, size, placedCount)
    const home = homeBody(level)
    const homePos = bodyPosition(home, 0)
    const targetPos = targetPosition(level.target, 0)

    const overlapsHome = Math.hypot(homePos.x - candidate.pos.x, homePos.y - candidate.pos.y) < home.radius + candidate.radius
    const overlapsTarget =
      Math.hypot(targetPos.x - candidate.pos.x, targetPos.y - candidate.pos.y) < level.target.radius + candidate.radius
    const overlapsBody = level.bodies.some((b) => {
      if (b.id === level.homeId) return false
      return Math.hypot(b.pos.x - candidate.pos.x, b.pos.y - candidate.pos.y) < b.radius + candidate.radius
    })

    if (overlapsHome || overlapsTarget || overlapsBody) {
      showToast('Cannot place here')
      return
    }

    applySandboxLevel({ ...level, bodies: [...level.bodies, candidate] })
  }

  function handleResult(result: SimResult) {
    setIsFlying(false)

    if (mode === 'sandbox') {
      if (result.outcome === 'goal') showToast('Gate reached')
      else showToast(outcomeToast(result, sandboxLevel))
      return
    }

    if (mode !== 'level') return
    const level = LEVELS[levelIndex]

    if (result.outcome === 'goal') {
      const strokes = launchCount
      const previousBest = progress.best[level.id]
      const nextProgress = recordResult(progress, level.id, strokes)
      setProgress(nextProgress)
      saveProgress(nextProgress, storage)
      audio.goal()
      const total = totalScore(nextProgress, LEVELS)
      setResultInfo({
        levelIndex,
        levelName: level.name,
        par: level.par,
        strokes,
        isNewBest: previousBest === undefined || strokes < previousBest,
        totalStrokes: total.strokes,
        totalPar: total.par,
        totalCompleted: total.completed,
      })
    } else {
      if (result.outcome === 'crash') audio.crash()
      else audio.lost()
      showToast(outcomeToast(result, level))
    }
  }

  const events: EngineEvents = {
    onAimChange: (nextAim) => setAim(nextAim),
    onLaunch: (launchAim) => {
      setLaunchCount((c) => c + 1)
      setIsFlying(true)
      audio.launch(launchAim.power)
      if (!coached) {
        setCoached(true)
        saveCoached(storage)
      }
    },
    onResult: handleResult,
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
            if (engine.isFlying()) engine.abort()
            else engine.fire()
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
              audio={audio}
              level={currentLevel}
              levelNumber={mode === 'level' ? levelIndex + 1 : null}
              aim={aim}
              isFlying={isFlying}
              launchCount={mode === 'level' ? launchCount : null}
              muted={muted}
              showCoachMark={mode === 'level' && levelIndex === 0 && !coached}
              onBack={goToMenu}
              onRestart={mode === 'level' ? restart : undefined}
              onToggleMute={toggleMute}
            />
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
