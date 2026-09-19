import { scoreLabel } from '../game/progress.ts'
import { parRelation, scoreClass } from './scoring.ts'

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
      <div className="result-card" role="dialog" aria-modal="true" aria-label="Hole complete">
        <h2 className="result-title">Gate reached</h2>
        <p className="result-level-name">
          Hole {result.levelIndex + 1} - {result.levelName}
        </p>
        <p className={`result-score ${scoreClass(result.strokes, result.par)}`}>{scoreLabel(result.strokes, result.par)}</p>
        <p className="result-stats">
          {result.strokes} launch{result.strokes === 1 ? '' : 'es'} &middot; Par {result.par}
        </p>
        {result.isNewBest && <p className="result-best">New best!</p>}

        {isLastLevel && (
          <div className="result-congrats">
            <p>You finished the course!</p>
            <p>
              Course total: {result.totalStrokes} / {result.totalPar} ({parRelation(result.totalStrokes, result.totalPar)}) &middot;{' '}
              {result.totalCompleted} holes
            </p>
          </div>
        )}

        <div className="result-actions">
          <button type="button" className="primary-button" onClick={onNext}>
            {isLastLevel ? 'Back to menu' : 'Next hole'}
          </button>
          <button type="button" className="secondary-button" onClick={onReplay}>
            Replay hole
          </button>
          <button type="button" className="secondary-button" onClick={onMenu}>
            Menu
          </button>
        </div>
      </div>
    </div>
  )
}
