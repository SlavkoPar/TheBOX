import { useState } from 'react'
import { errorMessage } from '../api'

/** Runs an async action, tracking whether it is running and its error message. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true)
    setError('')
    try {
      await action()
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, setError, run }
}
