import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { packagesApi } from '../api'
import type { FileItem, Folder, ShareResult } from '../api'
import { Modal } from './Modal'
import FriendPicker, { useFriends } from './FriendPicker'
import { useAction } from './useAction'

type Props = {
  files: FileItem[]
  /** Folders to share: everything inside them is included. */
  folders?: Folder[]
  /** "document" or "photo" */
  noun: string
  folderNoun?: string
  onClose: () => void
}

/**
 * Pick friends and email them a link to the selected files.
 *
 * What is shared is saved as a package, so it shows up in Packages with its
 * link and history, and can be edited or sent again from there.
 */
export default function ShareDialog({
  files,
  folders = [],
  noun,
  folderNoun = 'folder',
  onClose,
}: Props) {
  const { friends, loadError } = useFriends()
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [message, setMessage] = useState('')
  const [name, setName] = useState(() => {
    const all = [...folders, ...files]
    return all.length === 1 ? all[0].name : `${all[0]?.name ?? ''} and ${all.length - 1} more`
  })
  // Set once the package exists: if only the email step failed, a retry sends that package
  // and does not make a second one.
  const [packageId, setPackageId] = useState<number | null>(null)
  const [result, setResult] = useState<ShareResult | null>(null)
  const { busy, error, setError, run } = useAction()

  const plural = files.length === 1 ? noun : `${noun}s`
  const counts = [
    folders.length > 0 && `${folders.length} ${folderNoun}${folders.length === 1 ? '' : 's'}`,
    files.length > 0 && `${files.length} ${plural}`,
  ].filter(Boolean)
  const title = `Share ${counts.join(' and ')}`
  const hasEncrypted = files.some((file) => file.is_encrypted)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (chosen.size === 0) {
      setError('Select at least one friend.')
      return
    }
    await run(async () => {
      const data = {
        name,
        message,
        file_ids: files.map((file) => file.id),
        folder_ids: folders.map((folder) => folder.id),
        friend_ids: [...chosen],
      }
      const saved =
        packageId === null
          ? await packagesApi.create(data)
          : await packagesApi.update(packageId, data)
      setPackageId(saved.id)
      setResult(await packagesApi.send(saved.id))
    })
  }

  if (result) {
    return (
      <Modal title={title} onClose={onClose}>
        <div className="form">
          {result.sent.length > 0 && (
            <p className="notice" role="status">
              Link emailed to {result.sent.join(', ')}.
            </p>
          )}
          {result.failed.length > 0 && (
            <p className="error" role="alert">
              The email could not be sent to {result.failed.join(', ')}. You can send them the
              link yourself.
            </p>
          )}
          <label>
            Link
            <input readOnly value={result.link} onFocus={(event) => event.target.select()} />
          </label>
          <p className="hint">
            Saved as the package “{name.trim()}”. See what was sent, change it or send it again in{' '}
            <Link to="/packages">Packages</Link>.
          </p>
          {hasEncrypted && (
            <p className="hint">
              Encrypted documents open only with their password. Give it to the friends
              yourself — it is not in the email.
            </p>
          )}
          <div className="form-actions">
            <button type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <ul className="share-files">
          {folders.map((folder) => (
            <li key={`folder-${folder.id}`}>
              {folder.name} <small>(everything in this {folderNoun})</small>
            </li>
          ))}
          {files.map((file) => (
            <li key={file.id}>{file.name}</li>
          ))}
        </ul>

        <label>
          Package name
          <input value={name} required onChange={(event) => setName(event.target.value)} />
        </label>

        <FriendPicker
          friends={friends}
          loadError={loadError}
          chosen={chosen}
          onChange={setChosen}
        />

        <label>
          Message (optional)
          <textarea rows={3} value={message} onChange={(event) => setMessage(event.target.value)} />
        </label>

        <p className="hint">
          Each friend gets an email with a link to view or download{' '}
          {folders.length === 0 && files.length === 1 ? `this ${noun}` : `these ${noun}s`}. Anyone
          with the link can open it. It is saved as a package in Packages.
          {folders.length > 0 &&
            ` A shared ${folderNoun} shows what is in it when the link is opened, including what is added later.`}
        </p>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !friends || friends.length === 0}>
            Send link
          </button>
        </div>
      </form>
    </Modal>
  )
}
