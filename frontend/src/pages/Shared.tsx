import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { errorMessage, sharedApi } from '../api'
import type { SharedFile, SharedListing } from '../api'
import { PromptDialog } from '../common/Modal'
import { formatBytes, formatDate, saveBlob } from '../common/format'
import { Icon } from '../common/icons'

// Types the server lets a browser display; everything else is download-only.
const VIEWABLE = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'application/pdf',
  'text/plain',
]

/** Public page behind an emailed link (a share or a package): view or download the files. No sign-in. */
export default function Shared() {
  const { token = '' } = useParams()
  const [listing, setListing] = useState<SharedListing | null>(null)
  const [error, setError] = useState('')
  const [unlocking, setUnlocking] = useState<SharedFile | null>(null)

  useEffect(() => {
    let cancelled = false
    sharedApi
      .get(token)
      .then((data) => {
        if (!cancelled) setListing(data)
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const isPhotos = listing?.app === 'photos'
  // A package has a name and holds files of both apps, some of them in folders.
  const isPackage = listing?.app === 'package'
  const noun = isPhotos ? 'photo' : isPackage ? 'file' : 'document'

  function actions(file: SharedFile) {
    if (file.is_encrypted) {
      return (
        <button type="button" className="secondary" onClick={() => setUnlocking(file)}>
          <Icon name="lock" size={18} /> Unlock and download
        </button>
      )
    }
    return (
      <>
        {VIEWABLE.includes(file.mime_type) && (
          <a
            className="button secondary"
            href={sharedApi.contentUrl(token, file.id)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${file.name}`}
          >
            View
          </a>
        )}
        <a
          className="button"
          href={sharedApi.contentUrl(token, file.id, true)}
          aria-label={`Download ${file.name}`}
        >
          <Icon name="download" size={18} /> Download
        </a>
      </>
    )
  }

  return (
    <div className="shell">
      <header className="shell-header">
        <span className="brand">TheBOX</span>
      </header>
      <main className="shell-main">
        <div className="page page-narrow">
          {error && (
            <>
              <h2>Link not available</h2>
              <p className="error" role="alert">
                {error}
              </p>
            </>
          )}

          {!error && !listing && <p>Loading…</p>}

          {listing && (
            <>
              <div className="page-header">
                <div>
                  <h2>
                    {isPackage && listing.name
                      ? listing.name
                      : `${listing.files.length} ${listing.files.length === 1 ? noun : `${noun}s`} shared with you`}
                  </h2>
                  <p className="hint">
                    {isPackage && `${listing.files.length} ${listing.files.length === 1 ? noun : `${noun}s`} · `}
                    From {listing.shared_by}
                    {listing.expires_at && ` · link works until ${formatDate(listing.expires_at)}`}
                  </p>
                </div>
              </div>

              {listing.message && <blockquote className="share-message">{listing.message}</blockquote>}

              {listing.files.length === 0 && (
                <p className="empty">The shared {noun}s are no longer available.</p>
              )}

              {isPhotos ? (
                <ul className="photo-grid" aria-label="Shared photos">
                  {listing.files.map((file) => (
                    <li key={file.id} className="photo">
                      <a
                        className="photo-open"
                        href={sharedApi.contentUrl(token, file.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img src={sharedApi.thumbUrl(token, file.id)} alt={file.name} loading="lazy" />
                      </a>
                      <div className="photo-caption">
                        <span title={file.name}>{file.name}</span>
                        <a
                          className="icon-button"
                          href={sharedApi.contentUrl(token, file.id, true)}
                          aria-label={`Download ${file.name}`}
                        >
                          <Icon name="download" />
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="shared-list" aria-label={isPackage ? 'Shared files' : 'Shared documents'}>
                  {listing.files.map((file) => (
                    <li key={file.id}>
                      <span className="item-name">
                        <Icon name={file.is_encrypted ? 'lock' : 'file'} /> {file.name}
                      </span>
                      <small>
                        {file.path && `${file.path} · `}
                        {formatBytes(file.size)}
                        {file.is_encrypted && ' · encrypted'}
                      </small>
                      <span className="spacer" />
                      <span className="row-actions">{actions(file)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </main>

      {unlocking && (
        <PromptDialog
          title={`Unlock ${unlocking.name}`}
          label="Password"
          type="password"
          submitLabel="Download"
          hint={`This document is encrypted. Ask ${listing?.shared_by ?? 'the sender'} for the password.`}
          onClose={() => setUnlocking(null)}
          onSubmit={async (password) => {
            saveBlob(await sharedApi.decrypted(token, unlocking.id, password), unlocking.name)
          }}
        />
      )}
    </div>
  )
}
