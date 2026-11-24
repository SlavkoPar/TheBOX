import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { errorMessage, messengerApi, recipientsApi } from '../api'
import type { ChatMessage, Conversation } from '../api'
import { ConfirmDialog } from '../common/Modal'
import { dateKey, formatDate, formatTime } from '../common/format'
import { Icon } from '../common/icons'
import { useAction } from '../common/useAction'

/** How often the page asks the server for new messages. */
const POLL_MS = 5000

/** Run `tick` now and then every few seconds, while the tab is visible. */
function usePolling(tick: () => void) {
  useEffect(() => {
    tick()
    const timer = setInterval(() => {
      if (!document.hidden) tick()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [tick])
}

function dayLabel(iso: string): string {
  const key = dateKey(new Date(iso))
  const today = new Date()
  if (key === dateKey(today)) return 'Today'
  today.setDate(today.getDate() - 1)
  return key === dateKey(today) ? 'Yesterday' : formatDate(iso)
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

  usePolling(load)

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
      <header className="chat-header">
        <Link to="/messenger" className="button icon-button chat-back" aria-label="Back to all chats">
          <Icon name="left" />
        </Link>
        <div className="chat-who">
          <strong>{person.name}</strong>
          {person.name !== email && <span className="hint">{email}</span>}
        </div>
        <span className="spacer" />
        {person.recipient_id === null && (
          <button type="button" className="secondary" disabled={adding.busy} onClick={addToRecipients}>
            <Icon name="plus" size={16} /> Add to recipients
          </button>
        )}
      </header>

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

export default function Messenger() {
  const [params] = useSearchParams()
  const selected = (params.get('with') ?? '').trim().toLowerCase()
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

  usePolling(reload)

  const person = people.find((other) => other.email === selected)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Messenger</h2>
          <p className="hint">Chat with your recipients.</p>
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : people.length === 0 && !error ? (
        <p className="empty">
          No one to chat with yet. Add your friends in <Link to="/recipients">Recipients</Link>.
        </p>
      ) : (
        <div className={`messenger${selected ? ' chatting' : ''}`}>
          <nav className="chat-people" aria-label="Chats">
            <ul>
              {people.map((other) => (
                <li key={other.email}>
                  <Link
                    to={`/messenger?with=${encodeURIComponent(other.email)}`}
                    className={`chat-person${other.email === selected ? ' current' : ''}`}
                    aria-current={other.email === selected ? 'page' : undefined}
                  >
                    <span className="chat-person-top">
                      <strong>{other.name}</strong>
                      {other.unread > 0 && (
                        <span className="badge unread" aria-label={`${other.unread} unread`}>
                          {other.unread}
                        </span>
                      )}
                    </span>
                    <span className="hint chat-last">
                      {other.last ? `${other.last.mine ? 'You: ' : ''}${other.last.body}` : 'No messages yet'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {person ? (
            <Chat key={person.email} person={person} onChange={reload} />
          ) : (
            <p className="empty chat-none">
              {selected ? (
                <>
                  {selected} is not one of your recipients. Add them in{' '}
                  <Link to="/recipients">Recipients</Link> to chat.
                </>
              ) : (
                'Choose someone to chat with.'
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
