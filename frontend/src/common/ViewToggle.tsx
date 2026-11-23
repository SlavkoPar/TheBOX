import { Icon } from './icons'
import type { ViewMode } from './useViewMode'

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'list', label: 'List view' },
  { id: 'grid', label: 'Grid view' },
]

/** The List / Grid switch shown on every page that lists things. */
export default function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div className="segmented view-toggle" role="group" aria-label="View">
      {MODES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={mode === id ? undefined : 'secondary'}
          aria-pressed={mode === id}
          aria-label={label}
          title={label}
          onClick={() => onChange(id)}
        >
          <Icon name={id} size={18} />
        </button>
      ))}
    </div>
  )
}
