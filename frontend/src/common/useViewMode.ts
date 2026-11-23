import { useState } from 'react'

export type ViewMode = 'list' | 'grid'

const PREFIX = 'thebox.view.'

function stored(place: string): ViewMode | null {
  try {
    const value = localStorage.getItem(PREFIX + place)
    return value === 'list' || value === 'grid' ? value : null
  } catch {
    return null // storage can be blocked (private mode): the choice then lasts for this visit
  }
}

/**
 * List or grid view of one place ("drive", "packages", …). The choice is
 * remembered in this browser; until one is made, `fallback` is used.
 */
export function useViewMode(place: string, fallback: ViewMode): [ViewMode, (mode: ViewMode) => void] {
  const [chosen, setChosen] = useState<Record<string, ViewMode>>({})
  const mode = chosen[place] ?? stored(place) ?? fallback

  function setMode(next: ViewMode) {
    setChosen({ ...chosen, [place]: next })
    try {
      localStorage.setItem(PREFIX + place, next)
    } catch {
      // not remembered, still applied
    }
  }

  return [mode, setMode]
}
