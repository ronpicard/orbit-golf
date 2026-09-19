import type { JSX } from 'react'
import type { SandboxSize } from '../game/levels.ts'
import { BlackHoleIcon, EraseIcon, LargePlanetIcon, MediumPlanetIcon, RestartIcon, SmallPlanetIcon } from './icons.tsx'

export type SandboxTool = SandboxSize | 'erase'

interface SandboxPaletteProps {
  tool: SandboxTool
  onSelectTool: (tool: SandboxTool) => void
  onClearTrails: () => void
  onReset: () => void
}

const TOOLS: { id: SandboxTool; label: string; icon: (props: { className?: string }) => JSX.Element }[] = [
  { id: 'small', label: 'Small planet', icon: SmallPlanetIcon },
  { id: 'medium', label: 'Medium planet', icon: MediumPlanetIcon },
  { id: 'large', label: 'Large planet', icon: LargePlanetIcon },
  { id: 'blackhole', label: 'Black hole', icon: BlackHoleIcon },
  { id: 'erase', label: 'Erase', icon: EraseIcon },
]

export default function SandboxPalette({ tool, onSelectTool, onClearTrails, onReset }: SandboxPaletteProps) {
  return (
    <div className="sandbox-palette">
      <div className="sandbox-tools" role="group" aria-label="Sandbox tools">
        {TOOLS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`sandbox-tool ${tool === id ? 'selected' : ''}`}
            aria-label={label}
            aria-pressed={tool === id}
            onClick={() => onSelectTool(id)}
          >
            <Icon />
          </button>
        ))}
      </div>
      <div className="sandbox-actions">
        <button type="button" className="pill-button" onClick={onClearTrails}>
          Clear trails
        </button>
        <button type="button" className="pill-button" aria-label="Reset sandbox" onClick={onReset}>
          <RestartIcon />
          Reset
        </button>
      </div>
    </div>
  )
}
