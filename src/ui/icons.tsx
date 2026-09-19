/** Small inline SVG icons. No icon library dependency: every icon is hand-drawn markup. */

interface IconProps {
  className?: string
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} width="1em" height="1em" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

export function MuteIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} width="1em" height="1em" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path d="m16 9 5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function UnmuteIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} width="1em" height="1em" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path
        d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function BackIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} width="1em" height="1em" aria-hidden="true">
      <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function RestartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} width="1em" height="1em" aria-hidden="true">
      <path
        d="M4 12a8 8 0 1 1 2.6 5.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M4 17v-5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} width="1em" height="1em" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

export function MinusIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} width="1em" height="1em" aria-hidden="true">
      <path d="M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

export function EraseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} width="1em" height="1em" aria-hidden="true">
      <path
        d="m17 3 4 4-9.5 9.5H7L3 12.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9 21h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function SmallPlanetIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} width="1em" height="1em" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
    </svg>
  )
}

export function MediumPlanetIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} width="1em" height="1em" aria-hidden="true">
      <circle cx="12" cy="12" r="7" fill="currentColor" />
    </svg>
  )
}

export function LargePlanetIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} width="1em" height="1em" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="currentColor" />
    </svg>
  )
}

export function BlackHoleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} width="1em" height="1em" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" />
    </svg>
  )
}
