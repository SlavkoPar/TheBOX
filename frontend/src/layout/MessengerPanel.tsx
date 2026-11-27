import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage, messengerApi, friendsApi } from '../api'
import type { ChatFile, ChatMessage, Conversation } from '../api'
import ItemPicker from '../common/ItemPicker'
import { ConfirmDialog, Modal, PromptDialog } from '../common/Modal'
import { dateKey, formatBytes, formatDate, formatTime, saveBlob } from '../common/format'
import { Icon } from '../common/icons'
import { VIEWABLE_TYPES, itemKey, locationOf } from '../common/items'
import type { PickedItem } from '../common/items'
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

/** A message in a few words: its text, or the names of the files it carries. */
function summaryOf(message: ChatMessage): string {
  const files = message.files ?? []
  if (message.body) return message.body
  if (files.length === 0) return 'Files that are no longer available'
  return files.length === 1 ? files[0].name : `${files[0].name} and ${files.length - 1} more`
}

type SentFilesProps = {
  message: ChatMessage
  onUnlock: (file: ChatFile) => void
}

/** The files a message carries: pictures as previews, the rest by name; each can be downloaded. */
function SentFiles({ message, onUnlock }: SentFilesProps) {
  const files = message.files ?? []
  if (files.length === 0) {
    return message.body ? null : <span className="bubble-text hint">The files are no longer available.</span>
  }
  return (
    <ul className="bubble-files" aria-label="Files">
      {files.map((file) => {
        const isImage = file.mime_type.startsWith('image/')
        if (file.is_encrypted) {
          return (
            <li key={file.id}>
              <button
                type="button"
                className="link-button bubble-file"
                aria-label={`Unlock and download ${file.name}`}
                onClick={() => onUnlock(file)}
              >
                <Icon name="lock" size={18} /> {file.name}
              </button>
              <small>{formatBytes(file.size)} · encrypted</small>
            </li>
          )
        }
        return (
          <li key={file.id} className={isImage ? 'bubble-photo' : undefined}>
            <a
              className="bubble-file"
              href={messengerApi.fileUrl(message.id, file.id, !VIEWABLE_TYPES.includes(file.mime_type))}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${file.name}`}
            >
              {isImage ? (
                <img src={messengerApi.thumbUrl(message.id, file.id)} alt={file.name} loading="lazy" />
              ) : (
                <>
                  <Icon name="file" size={18} /> {file.name}
                </>
              )}
            </a>
            <small>{isImage ? file.name : formatBytes(file.size)}</small>
            <a
              className="icon-button"
              href={messengerApi.fileUrl(message.id, file.id, true)}
              aria-label={`Download ${file.name}`}
              title="Download"
            >
              <Icon name="download" size={16} />
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/** Green dot next to the name of someone who is signed in right now. */
function OnlineDot({ person }: { person: Conversation | undefined }) {
  if (!person?.online) return null
  return <span className="online-dot" role="img" aria-label="Online" title="Online" />
}

type ChatProps = {
  person: Conversation
  /** something changed that the list of people shows (unread, last message, friends) */
  onChange: () => void
}

/** The chat with one person. Rendered with a `key`, so each chat starts empty. */
function Chat({ person, onChange }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [text, setText] = useState('')
  const [deleting, setDeleting] = useState<ChatMessage | null>(null)
  // Files and folders of Drive and Photos that go with the next message
  const [attached, setAttached] = useState<PickedItem[]>([])
  const [picking, setPicking] = useState(false)
  const [unlocking, setUnlocking] = useState<{ message: ChatMessage; file: ChatFile } | null>(null)
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
    if ((!body && attached.length === 0) || sending.busy) return
    const ids = (kind: PickedItem['kind']) => attached.filter((item) => item.kind === kind).map((item) => item.id)
    const attachments = attached.length > 0 ? { file_ids: ids('file'), folder_ids: ids('folder') } : undefined
    const sent = await sending.run(async () => {
      add([await messengerApi.send(email, body, attachments)])
    })
    if (sent) {
      setText('')
      setAttached([])
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

  function addToFriends() {
    return adding.run(async () => {
      await friendsApi.create({
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
      {person.friend_id === null && (
        <button
          type="button"
          className="secondary chat-add"
          disabled={adding.busy}
          onClick={addToFriends}
        >
          <Icon name="plus" size={16} /> Add to friends
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
                      aria-label={`Delete message: ${summaryOf(message).slice(0, 40)}`}
                      title="Delete"
                      onClick={() => setDeleting(message)}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                  <div className="bubble">
                    <span className="visually-hidden">{message.mine ? 'You: ' : `${person.name}: `}</span>
                    {message.body && <span className="bubble-text">{message.body}</span>}
                    <SentFiles message={message} onUnlock={(file) => setUnlocking({ message, file })} />
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

      {attached.length > 0 && (
        <ul className="chat-attached" aria-label="Attached">
          {attached.map((item) => (
            <li key={itemKey(item)} title={locationOf(item)}>
              <Icon name={item.kind === 'folder' ? 'folder' : 'file'} size={16} />
              <span>{item.name}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${item.name}`}
                title="Remove"
                onClick={() => setAttached((current) => current.filter((other) => itemKey(other) !== itemKey(item)))}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="chat-form" onSubmit={send}>
        <button
          type="button"
          className="icon-button"
          aria-label="Attach files"
          title="Attach files from Drive and Photos"
          onClick={() => setPicking(true)}
        >
          <Icon name="attach" />
        </button>
        <textarea
          aria-label={`Message to ${person.name}`}
          placeholder="Write a message…"
          rows={1}
          maxLength={4000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" disabled={(!text.trim() && attached.length === 0) || sending.busy}>
          <Icon name="send" size={18} /> Send
        </button>
      </form>

      {deleting && (
        <ConfirmDialog
          title="Delete message"
          message={`Delete this message for both of you? "${summaryOf(deleting).slice(0, 80)}"`}
          confirmLabel="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}
        />
      )}

      {picking && (
        <Modal title="Attach files and folders" onClose={() => setPicking(false)} wide>
          <div className="form">
            <ItemPicker picked={attached} onChange={setAttached} />
            <p className="hint">
              {person.name} can view and download them here, until you delete the message or the file.
            </p>
            <div className="form-actions">
              <button type="button" onClick={() => setPicking(false)}>
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}

      {unlocking && (
        <PromptDialog
          title={`Unlock ${unlocking.file.name}`}
          label="Password"
          type="password"
          submitLabel="Download"
          hint={
            unlocking.message.mine
              ? 'This document is encrypted. Enter its password.'
              : `This document is encrypted. Ask ${person.name} for the password.`
          }
          onClose={() => setUnlocking(null)}
          onSubmit={async (password) => {
            const { message, file } = unlocking
            saveBlob(await messengerApi.decrypted(message.id, file.id, password), file.name)
          }}
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
                {!peer ? 'Chat with your friends' : person && person.name !== peer ? peer : ''}
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
              {peer} is not one of your friends. Add them in{' '}
              <Link to="/friends" onClick={onClose}>
                Friends
              </Link>{' '}
              to chat.
            </p>
          ) : people.length === 0 ? (
            !error && (
              <p className="empty">
                No one to chat with yet. Add your friends in{' '}
                <Link to="/friends" onClick={onClose}>
                  Friends
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
                        {other.last ? `${other.last.mine ? 'You: ' : ''}${summaryOf(other.last)}` : 'No messages yet'}
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
