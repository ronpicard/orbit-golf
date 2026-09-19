import { useEffect, useState } from 'react'
import { bodyPosition, targetPosition } from '../game/physics.ts'
import type { Aim, Level, Vec2 } from '../game/types.ts'

const MARGIN = 1
const PHONE_WIDTH = 120
const DESKTOP_WIDTH = 190
const PHONE_BREAKPOINT = 560
const EXPANDED_MAX_WIDTH = 520
const COMPACT_HEIGHT_FRACTION = 0.4
const EXPANDED_HEIGHT_FRACTION = 0.6
/** Below this viewport height (landscape phones) the two-row bottom bar eats more of the
 * screen, so the compact map is capped further to stay clear of it. */
const SHORT_VIEWPORT_HEIGHT = 480
const SHORT_VIEWPORT_HEIGHT_FRACTION = 0.3

interface MinimapProps {
  level: Level
  /** Where the next stroke is played from. */
  lie: Vec2
  aim: Aim
  levelNumber: number | null
}

function points(pts: Vec2[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(' ')
}

/** Top-down course map: the fairway, hazards, cup, tee and ball, drawn from the level's own geometry. */
export default function Minimap({ level, lie, aim, levelNumber }: MinimapProps) {
  const [expanded, setExpanded] = useState(false)
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))

  useEffect(() => {
    function onResize() {
      setViewport({ w: window.innerWidth, h: window.innerHeight })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const { minX, maxX, minY, maxY } = level.bounds
  const vx = minX - MARGIN
  const vy = minY - MARGIN
  const vw = maxX - minX + MARGIN * 2
  const vh = maxY - minY + MARGIN * 2
  const ratio = vh / vw

  const isPhone = viewport.w <= PHONE_BREAKPOINT
  const isShortViewport = viewport.h <= SHORT_VIEWPORT_HEIGHT
  const baseWidth = expanded ? Math.min(viewport.w * 0.8, EXPANDED_MAX_WIDTH) : isPhone ? PHONE_WIDTH : DESKTOP_WIDTH
  const compactFraction = isShortViewport ? SHORT_VIEWPORT_HEIGHT_FRACTION : COMPACT_HEIGHT_FRACTION
  const maxHeight = viewport.h * (expanded ? EXPANDED_HEIGHT_FRACTION : compactFraction)

  let width = baseWidth
  let height = width * ratio
  if (height > maxHeight) {
    height = maxHeight
    width = height / ratio
  }

  const cup = targetPosition(level.target, 0)
  const flagHeight = level.target.radius * 2.4
  const flagWidth = level.target.radius * 1.5

  const aimLength = 0.5 + aim.power * 2.5
  const aimEnd = {
    x: lie.x + Math.cos(aim.angle) * aimLength,
    y: lie.y + Math.sin(aim.angle) * aimLength,
  }

  const label = levelNumber !== null ? `Course map: hole ${levelNumber}` : 'Course map'

  return (
    <div
      className={`minimap ${expanded ? 'expanded' : ''}`}
      style={{ width, height }}
      role="img"
      aria-label={label}
      onClick={() => setExpanded((e) => !e)}
    >
      <svg viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet">
        <polygon points={points(level.course)} className="minimap-fairway" vectorEffect="non-scaling-stroke" />
        {level.islands.map((island, i) => (
          <polygon key={i} points={points(island)} className="minimap-island" vectorEffect="non-scaling-stroke" />
        ))}

        {level.bodies.map((b) => {
          const pos = bodyPosition(b, 0)
          const isBlackHole = b.kind === 'blackhole'
          return (
            <g key={b.id}>
              {b.rail && (
                <circle
                  cx={b.rail.center.x}
                  cy={b.rail.center.y}
                  r={b.rail.radius}
                  className="minimap-rail"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={b.radius}
                className={isBlackHole ? 'minimap-blackhole' : 'minimap-body'}
                style={isBlackHole ? undefined : { fill: b.palette[0] }}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })}

        {level.target.rail && (
          <circle
            cx={level.target.rail.center.x}
            cy={level.target.rail.center.y}
            r={level.target.rail.radius}
            className="minimap-rail"
            vectorEffect="non-scaling-stroke"
          />
        )}

        <circle cx={cup.x} cy={cup.y} r={level.target.radius} className="minimap-cup" vectorEffect="non-scaling-stroke" />
        <line
          x1={cup.x}
          y1={cup.y}
          x2={cup.x}
          y2={cup.y - flagHeight}
          className="minimap-flag-pole"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`M ${cup.x} ${cup.y - flagHeight} l ${flagWidth} ${flagWidth * 0.4} l ${-flagWidth} ${flagWidth * 0.4} Z`}
          className="minimap-flag"
        />

        <rect
          x={level.tee.x - 0.35}
          y={level.tee.y - 0.35}
          width={0.7}
          height={0.7}
          className="minimap-tee"
        />

        <line
          x1={lie.x}
          y1={lie.y}
          x2={aimEnd.x}
          y2={aimEnd.y}
          className="minimap-aim-line"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={lie.x} cy={lie.y} r={0.3} className="minimap-ball-pulse" vectorEffect="non-scaling-stroke" />
        <circle cx={lie.x} cy={lie.y} r={0.22} className="minimap-ball" />
      </svg>
    </div>
  )
}
