import { scoreLabel } from '../game/progress.ts'

export interface ResultInfo {
  levelIndex: number
  levelName: string
  par: number
  strokes: number
  isNewBest: boolean
  totalStrokes: number
  totalPar: number
  totalCompleted: number
}

interface ResultCardProps {
  result: ResultInfo
  isLastLevel: boolean
  onNext: () => void
  onReplay: () => void
  onMenu: () => void
}

export default function ResultCard({ result, isLastLevel, onNext, onReplay, onMenu }: ResultCardProps) {
  return (
    <div className="modal-backdrop">
      <div className="result-card" role="dialog" aria-modal="true" aria-label="Level complete">
        <h2 className="result-title">Gate reached</h2>
        <p className="result-level-name">
          Level {result.levelIndex + 1} — {result.levelName}
        </p>
        <p className="result-score">{scoreLabel(result.strokes, result.par)}</p>
        <p className="result-stats">
          {result.strokes} launch{result.strokes === 1 ? '' : 'es'} &middot; Par {result.par}
        </p>
        {result.isNewBest && <p className="result-best">New best!</p>}

        {isLastLevel && (
          <div className="result-congrats">
            <p>You completed every level!</p>
            <p>
              Total score: {result.totalStrokes} strokes / {result.totalPar} par ({result.totalCompleted} levels)
            </p>
          </div>
        )}

        <div className="result-actions">
          <button type="button" className="primary-button" onClick={onNext}>
            {isLastLevel ? 'Back to menu' : 'Next level'}
          </button>
          <button type="button" className="secondary-button" onClick={onReplay}>
            Replay
          </button>
          <button type="button" className="secondary-button" onClick={onMenu}>
            Menu
          </button>
        </div>
      </div>
    </div>
  )
}
