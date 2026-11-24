import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage, messengerApi, recipientsApi } from '../api'
import type { ChatMessage, Conversation } from '../api'
import { ConfirmDialog } from '../common/Modal'
import { dateKey, formatDate, formatTime } from '../common/format'
import { Icon } from '../common/icons'
import { useAction } from '../common/useAction'

/** How often new messages are asked for while the panel is open. */
const POLL_OPEN_MS = 5000
/** While it is closed only the unread count in the header needs to stay fresh. */
const POLL_CLOSED_MS = 30000

/** Run `tick` now and then every `ms`, while the tab is visible. */
function usePolling(tick: () => void, ms: number) {
  useEffect(() => {
    tick()
    const timer = setInterval(() => {
      if (!document.hidden) tick()
    }, ms)
    return () => clearInterval(timer)
  }, [tick, ms])
}

function dayLabel(iso: string): string {
  const key = dateKey(new Date(iso))
  const today = new Date()
  if (key === dateKey(today)) return 'Today'
  today.setDate(today.getDate() - 1)
  return key === dateKey(today) ? 'Yesterday' : formatDate(iso)
}

/** Green dot next to the name of someone who is signed in right now. */
function OnlineDot({ person }: { person: Conversation | undefined }) {
  if (!person?.online) return null
  return <span className="online-dot" role="img" aria-label="Online" title="Online" />
}

type ChatProps = {
  person: Conversation
  /** something changed that the list of people shows (unread, last message, recipients) */
  onChange: () => void
}

/** The chat with one person. Rendered with a `key`, so each chat starts empty. */
function Chat({ person, onChange }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [text, setText] = useState('')
  const [deleting, setDeleting] = useState<ChatMessage | null>(null)
  const sending = useAction()
  const adding = useAction()
  const lastId = useRef(0)
  const end = useRef<HTMLDivElement>(null)
  const { email } = person

  const add = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return
    lastId.current = Math.max(lastId.current, ...incoming.map((message) => message.id))
    setMessages((current) => {
      const known = new Set(current.map((message) => message.id))
      return [...current, ...incoming.filter((message) => !known.has(message.id))]
    })
  }, [])

  const load = useCallback(() => {
    messengerApi.messages(email, lastId.current).then(
      (incoming) => {
        add(incoming)
        setLoaded(true)
        setLoadError('')
        // Reading them cleared the unread count
        if (incoming.some((message) => !message.mine)) onChange()
      },
      (err) => setLoadError(errorMessage(err)),
    )
  }, [email, add, onChange])

  usePolling(load, POLL_OPEN_MS)

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length])

  async function send(event?: FormEvent) {
    event?.preventDefault()
    const body = text.trim()
    if (!body || sending.busy) return
    const sent = await sending.run(async () => {
      add([await messengerApi.send(email, body)])
    })
    if (sent) {
      setText('')
      onChange()
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  async function remove(message: ChatMessage) {
    await messengerApi.remove(message.id)
    setMessages((current) => current.filter((other) => other.id !== message.id))
    onChange()
  }

  function addToRecipients() {
    return adding.run(async () => {
      await recipientsApi.create({
        first_name: email.split('@')[0],
        last_name: '',
        email,
        address: '',
        country: '',
        mobile: '',
      })
      onChange()
    })
  }

  return (
    <section className="chat" aria-label={`Chat with ${person.name}`}>
      {person.recipient_id === null && (
        <button
          type="button"
          className="secondary chat-add"
          disabled={adding.busy}
          onClick={addToRecipients}
        >
          <Icon name="plus" size={16} /> Add to recipients
        </button>
      )}

      {(loadError || adding.error) && (
        <p className="error" role="alert">
          {loadError || adding.error}
        </p>
      )}

      <div className="chat-messages" role="log" aria-label="Messages">
        {!loaded && !loadError ? (
          <p className="hint">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="hint chat-empty">
            No messages yet. Write the first one: {person.name} gets an email saying a message is waiting.
          </p>
        ) : (
          messages.map((message, index) => {
            const day = dayLabel(message.created_at)
            const newDay = index === 0 || dayLabel(messages[index - 1].created_at) !== day
            return (
              <div key={message.id} className="chat-row-wrap">
                {newDay && <p className="chat-day">{day}</p>}
                <div className={`chat-row ${message.mine ? 'mine' : 'theirs'}`}>
                  {message.mine && (
                    <button
                      type="button"
                      className="icon-button chat-delete"
                      aria-label={`Delete message: ${message.body.slice(0, 40)}`}
                      title="Delete"
                      onClick={() => setDeleting(message)}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                  <div className="bubble">
                    <span className="visually-hidden">{message.mine ? 'You: ' : `${person.name}: `}</span>
                    <span className="bubble-text">{message.body}</span>
                    <time dateTime={message.created_at}>{formatTime(message.created_at)}</time>
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={end} />
      </div>

      {sending.error && (
        <p className="error" role="alert">
          {sending.error}
        </p>
      )}

      <form className="chat-form" onSubmit={send}>
        <textarea
          aria-label={`Message to ${person.name}`}
          placeholder="Write a message…"
          rows={1}
          maxLength={4000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" disabled={!text.trim() || sending.busy}>
          <Icon name="send" size={18} /> Send
        </button>
      </form>

      {deleting && (
        <ConfirmDialog
          title="Delete message"
          message={`Delete this message for both of you? "${deleting.body.slice(0, 80)}"`}
          confirmLabel="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}
        />
      )}
    </section>
  )
}

type PanelProps = {
  open: boolean
  /** address of the open chat; '' shows the list of people */
  peer: string
  onOpen: (email?: string) => void
  onClose: () => void
}

/**
 * The Messenger: a button in the header (with the number of unread messages)
 * and a panel that slides in from the right, over whatever page is open.
 */
export default function MessengerPanel({ open, peer, onOpen, onClose }: PanelProps) {
  const [people, setPeople] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(() => {
    messengerApi
      .conversations()
      .then(
        (items) => {
          setPeople(items)
          setError('')
        },
        (err) => setError(errorMessage(err)),
      )
      .finally(() => setLoading(false))
  }, [])

  usePolling(reload, open ? POLL_OPEN_MS : POLL_CLOSED_MS)

  useEffect(() => {
    if (!open) return
    function onKey(event: globalThis.KeyboardEvent) {
      // A dialog on top (deleting a message) takes Escape first
      if (event.key === 'Escape' && !document.querySelector('.modal-backdrop')) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const unread = people.reduce((sum, person) => sum + person.unread, 0)
  const person = people.find((other) => other.email === peer)

  return (
    <>
      <button
        type="button"
        className="icon-button chat-toggle app-messenger"
        aria-label={unread > 0 ? `Messenger, ${unread} unread` : 'Messenger'}
        aria-expanded={open}
        title="Messenger"
        onClick={() => (open ? onClose() : onOpen())}
      >
        <Icon name="chat" size={22} />
        {unread > 0 && <span className="badge unread">{unread}</span>}
      </button>

      {open && (
        <aside className="messenger-panel" aria-label="Messenger">
          <header className="chat-header">
            {peer && (
              <button
                type="button"
                className="icon-button"
                aria-label="Back to all chats"
                title="All chats"
                onClick={() => onOpen('')}
              >
                <Icon name="left" />
              </button>
            )}
            <div className="chat-who">
              <strong>
                {peer ? (person?.name ?? peer) : 'Messenger'}
                {peer && <OnlineDot person={person} />}
              </strong>
              <span className="hint">
                {!peer ? 'Chat with your recipients' : person && person.name !== peer ? peer : ''}
              </span>
            </div>
            <span className="spacer" />
            <button
              type="button"
              className="icon-button"
              aria-label="Close Messenger"
              title="Close"
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          </header>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {loading ? (
            <p>Loading…</p>
          ) : person ? (
            <Chat key={person.email} person={person} onChange={reload} />
          ) : peer ? (
            <p className="empty">
              {peer} is not one of your recipients. Add them in{' '}
              <Link to="/recipients" onClick={onClose}>
                Recipients
              </Link>{' '}
              to chat.
            </p>
          ) : people.length === 0 ? (
            !error && (
              <p className="empty">
                No one to chat with yet. Add your friends in{' '}
                <Link to="/recipients" onClick={onClose}>
                  Recipients
                </Link>
                .
              </p>
            )
          ) : (
            <nav className="chat-people" aria-label="Chats">
              <ul>
                {people.map((other) => (
                  <li key={other.email}>
                    <button type="button" className="chat-person" onClick={() => onOpen(other.email)}>
                      <span className="chat-person-top">
                        <strong>
                          {other.name}
                          <OnlineDot person={other} />
                        </strong>
                        {other.unread > 0 && (
                          <span className="badge unread" aria-label={`${other.unread} unread`}>
                            {other.unread}
                          </span>
                        )}
                      </span>
                      <span className="hint chat-last">
                        {other.last ? `${other.last.mine ? 'You: ' : ''}${other.last.body}` : 'No messages yet'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </aside>
      )}
    </>
  )
}
