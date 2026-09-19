import { isUnlocked, scoreLabel, totalScore } from '../game/progress.ts'
import type { Progress } from '../game/progress.ts'
import type { Level } from '../game/types.ts'
import { GolfFlagIcon, LockIcon } from './icons.tsx'
import { parRelation, scoreClass } from './scoring.ts'

interface MenuProps {
  levels: Level[]
  progress: Progress
  onPlay: () => void
  onSelectLevel: (index: number) => void
  onSandbox: () => void
}

/** Holes per nine, in the golf sense — independent of how many holes the course actually has. */
const NINE = 9

function hasAnyBest(progress: Progress): boolean {
  return Object.keys(progress.best).length > 0
}

/** The next hole the player hasn't beaten yet, mirroring App's own "continue" logic. */
function nextUnplayedIndex(progress: Progress, levels: Level[]): number {
  for (let i = 0; i < levels.length; i++) {
    if (isUnlocked(progress, levels, i) && progress.best[levels[i].id] === undefined) return i
  }
  return -1
}

interface NineSectionProps {
  title: string
  levels: Level[]
  start: number
  end: number
  progress: Progress
  currentIndex: number
  onSelectLevel: (index: number) => void
}

function NineSection({ title, levels, start, end, progress, currentIndex, onSelectLevel }: NineSectionProps) {
  const holes = levels.slice(start, end)
  if (holes.length === 0) return null
  const sub = totalScore(progress, holes)

  return (
    <section className="scorecard-section">
      <h2 className="scorecard-heading">{title}</h2>
      <div className="hole-grid">
        {holes.map((level, i) => {
          const index = start + i
          const unlocked = isUnlocked(progress, levels, index)
          const best = progress.best[level.id]
          const completed = best !== undefined
          const state = !unlocked ? 'locked' : completed ? 'completed' : index === currentIndex ? 'current' : ''
          return (
            <button
              key={level.id}
              type="button"
              className={`hole-card ${state}`}
              disabled={!unlocked}
              title={level.name}
              aria-label={unlocked ? `Hole ${index + 1}: ${level.name}` : `Hole ${index + 1} locked`}
              onClick={() => onSelectLevel(index)}
            >
              {!unlocked && <LockIcon className="hole-lock" />}
              {completed && <GolfFlagIcon className="hole-flag" />}
              <span className="hole-card-number">{index + 1}</span>
              <span className="hole-card-par">Par {level.par}</span>
              <span className={`hole-card-best ${best !== undefined ? scoreClass(best, level.par) : ''}`}>
                {best !== undefined ? scoreLabel(best, level.par) : '—'}
              </span>
            </button>
          )
        })}
      </div>
      <p className="scorecard-subtotal">
        {sub.completed > 0 ? `${sub.strokes} strokes / ${sub.par} par` : 'No holes completed yet'}
      </p>
    </section>
  )
}

export default function Menu({ levels, progress, onPlay, onSelectLevel, onSandbox }: MenuProps) {
  const total = totalScore(progress, levels)
  const playLabel = hasAnyBest(progress) ? 'Continue' : 'Play'
  const currentIndex = nextUnplayedIndex(progress, levels)

  return (
    <div className="menu-screen">
      <div className="menu-panel">
        <div className="menu-header">
          <div className="menu-title-row">
            <GolfFlagIcon className="menu-flag-icon" />
            <h1 className="menu-title">ORBIT GOLF</h1>
          </div>
          <p className="menu-tagline">Real gravity. One launch at a time.</p>
          <button type="button" className="play-button" onClick={onPlay}>
            {playLabel}
          </button>
        </div>

        <div className="scorecard">
          <NineSection
            title="Front nine"
            levels={levels}
            start={0}
            end={NINE}
            progress={progress}
            currentIndex={currentIndex}
            onSelectLevel={onSelectLevel}
          />
          <NineSection
            title="Back nine"
            levels={levels}
            start={NINE}
            end={levels.length}
            progress={progress}
            currentIndex={currentIndex}
            onSelectLevel={onSelectLevel}
          />
        </div>

        <button type="button" className="hole-card sandbox-card" onClick={onSandbox}>
          <span className="hole-card-number">&infin;</span>
          <span className="hole-card-name">Sandbox</span>
          <span className="hole-card-par">Free play</span>
        </button>

        <div className="menu-total">
          {total.completed > 0 ? (
            <>
              Total {total.strokes} / {total.par} ({parRelation(total.strokes, total.par)})
            </>
          ) : (
            'No holes completed yet'
          )}{' '}
          &middot; {total.completed}/{levels.length} complete
        </div>

        <div className="how-to-play">
          <p>Drag toward where you want to putt - drag further for more power, release to swing.</p>
          <p>The ball bounces off walls and rolls to a stop. Play your next stroke from where it lies.</p>
          <p>Planets and black holes bend your putt. Touch one and you replay the stroke.</p>
          <p>Sink it in as few strokes as you can.</p>
        </div>
      </div>
    </div>
  )
}
