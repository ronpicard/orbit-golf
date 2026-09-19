import { isUnlocked, scoreLabel, totalScore } from '../game/progress.ts'
import type { Progress } from '../game/progress.ts'
import type { Level } from '../game/types.ts'
import { LockIcon } from './icons.tsx'

interface MenuProps {
  levels: Level[]
  progress: Progress
  onPlay: () => void
  onSelectLevel: (index: number) => void
  onSandbox: () => void
}

function hasAnyBest(progress: Progress): boolean {
  return Object.keys(progress.best).length > 0
}

export default function Menu({ levels, progress, onPlay, onSelectLevel, onSandbox }: MenuProps) {
  const total = totalScore(progress, levels)
  const playLabel = hasAnyBest(progress) ? 'Continue' : 'Play'

  return (
    <div className="menu-screen">
      <div className="menu-panel">
        <div className="menu-header">
          <h1 className="menu-title">ORBIT GOLF</h1>
          <p className="menu-tagline">Real gravity. One launch at a time.</p>
          <button type="button" className="play-button" onClick={onPlay}>
            {playLabel}
          </button>
        </div>

        <div className="level-grid">
          {levels.map((level, index) => {
            const unlocked = isUnlocked(progress, levels, index)
            const best = progress.best[level.id]
            return (
              <button
                key={level.id}
                type="button"
                className={`level-card ${unlocked ? '' : 'locked'}`}
                disabled={!unlocked}
                aria-label={unlocked ? `Level ${index + 1}: ${level.name}` : `Level ${index + 1} locked`}
                onClick={() => onSelectLevel(index)}
              >
                {!unlocked && <LockIcon className="level-lock" />}
                <span className="level-card-number">{index + 1}</span>
                <span className="level-card-name">{level.name}</span>
                <span className="level-card-par">Par {level.par}</span>
                <span className="level-card-best">{best !== undefined ? scoreLabel(best, level.par) : '—'}</span>
              </button>
            )
          })}

          <button type="button" className="level-card sandbox-card" onClick={onSandbox}>
            <span className="level-card-number">&infin;</span>
            <span className="level-card-name">Sandbox</span>
            <span className="level-card-par">Free play</span>
          </button>
        </div>

        <div className="menu-total">
          Total: {total.strokes} strokes / {total.par} par &middot; {total.completed}/{levels.length} complete
        </div>

        <div className="how-to-play">
          <p>Drag anywhere to pull back like a slingshot, then release to launch.</p>
          <p>Gravity bends your probe&rsquo;s path — plan around planets and black holes.</p>
          <p>Reach the green gate in as few launches as possible.</p>
        </div>
      </div>
    </div>
  )
}
