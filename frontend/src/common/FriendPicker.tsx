import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage, friendsApi } from '../api'
import type { Friend } from '../api'

/** Loads the friends when a dialog opens; null while loading. */
export function useFriends() {
  const [friends, setFriends] = useState<Friend[] | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    friendsApi
      .list()
      .then((items) => {
        if (!cancelled) setFriends(items)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { friends, loadError }
}

type Props = {
  friends: Friend[] | null
  loadError: string
  chosen: Set<number>
  onChange: (chosen: Set<number>) => void
}

/** Checkboxes for choosing who gets a link: used when sharing and in packages. */
export default function FriendPicker({ friends, loadError, chosen, onChange }: Props) {
  const allChosen = friends !== null && friends.length > 0 && chosen.size === friends.length

  function toggle(id: number) {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  return (
    <>
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}

      {friends === null && !loadError && <p>Loading friends…</p>}

      {friends !== null && friends.length === 0 && (
        <p className="empty">
          You have no friends yet. <Link to="/friends">Add friends</Link> first.
        </p>
      )}

      {friends !== null && friends.length > 0 && (
        <fieldset className="friend-picker">
          <legend>Send to</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={allChosen}
              onChange={() => onChange(allChosen ? new Set() : new Set(friends.map((r) => r.id)))}
            />
            <strong>Everyone</strong>
          </label>
          {friends.map((friend) => (
            <label className="check" key={friend.id}>
              <input
                type="checkbox"
                checked={chosen.has(friend.id)}
                onChange={() => toggle(friend.id)}
              />
              <span>
                {`${friend.first_name} ${friend.last_name}`.trim()}{' '}
                <small>{friend.email}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </>
  )
}
