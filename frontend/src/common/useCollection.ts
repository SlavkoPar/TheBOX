import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from '../api'
import type { Collection, WithId } from '../api'

/**
 * Loads a collection and keeps it in sync after changes.
 * Used by every page that shows a list of rows (Friends, Tasks, Calendar).
 *
 * create / update / remove reject on failure, so forms can show the error;
 * on success the list is reloaded so the server's ordering is kept.
 */
export function useCollection<T extends WithId, Input>(api: Collection<T, Input>) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      setItems(await api.list())
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    let cancelled = false
    api
      .list()
      .then((loaded) => {
        if (!cancelled) setItems(loaded)
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api])

  const create = useCallback(
    async (data: Input) => {
      await api.create(data)
      await reload()
    },
    [api, reload],
  )

  const update = useCallback(
    async (id: number, data: Partial<Input>) => {
      await api.update(id, data)
      await reload()
    },
    [api, reload],
  )

  const remove = useCallback(
    async (id: number) => {
      await api.remove(id)
      await reload()
    },
    [api, reload],
  )

  return { items, loading, error, reload, create, update, remove }
}
