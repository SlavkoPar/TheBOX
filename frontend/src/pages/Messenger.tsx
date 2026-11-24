import { useEffect } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useMessenger } from '../common/messengerContext'

/**
 * /messenger is an address, not a page: the Messenger is a panel over the other
 * pages. Links (from the email notice: /messenger?with=…) open the panel on the
 * home page.
 */
export default function Messenger() {
  const [params] = useSearchParams()
  const { open } = useMessenger()
  const peer = (params.get('with') ?? '').trim().toLowerCase()

  useEffect(() => {
    open(peer)
  }, [open, peer])

  return <Navigate to="/" replace />
}
