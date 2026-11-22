# 07 — Main functionality: implementation notes

How the requirements in `07-main-functionality.md` were built, and the decisions that were not in the request.

## Apps

| App | Route | What it does |
| --- | --- | --- |
| Drive | `/drive` | Folders and subfolders, upload, text documents edited in the browser, rename, delete, encrypt / decrypt, share |
| Photos | `/photos` | Albums and sub-albums, image upload, thumbnail grid, larger view, rename, delete, share |
| Tasks | `/tasks` | Tasks with notes and due date, done / not done, overdue highlight |
| Calendar | `/calendar` | Month view, timed and all-day events, email reminder before the start |
| Recipients | `/recipients` | First name, last name, email, address, country, mobile |

The apps menu is the grid button next to the profile icon in the header; it lists the five entries with their icons. The home page shows the same list as tiles. Both read `frontend/src/apps.ts`.

## Common code

**Backend — `app/common.py`**
- `crud_blueprint(...)`: list / create / read / replace / update / delete endpoints for a model owned by a user. Recipients, Tasks and Calendar events are each one schema plus one call to it.
- Field classes (`Str`, `Email`, `Bool`, `Int`, `Date`, `DateTime`) and `apply_schema` validate request JSON.
- `get_owned` loads a row only if it belongs to the signed-in user; everything else is a 404.
- `ApiError` gives every endpoint the same JSON error shape.
- `OwnedMixin` in `models.py` gives every table `id`, `user_id`, `created_at`.

**Backend — `app/files.py`**
- `files_blueprint("drive")` and `files_blueprint("photos")` create the same endpoints over the same `folders`, `files` and `shares` tables. Rows are kept apart by an `app` column. The differences (images only, encryption allowed) are the entries in `FILE_APP_OPTIONS`.

**Frontend — `src/common/`**
- `FileBrowser.tsx`: the whole folder browser. `pages/Drive.tsx` and `pages/Photos.tsx` are only an options object each.
- `ShareDialog.tsx`: recipient picker and send, used by both.
- `Modal.tsx` (`Modal`, `FormModal`, `PromptDialog`, `ConfirmDialog`), `useAction.ts`, `useCollection.ts`, `format.ts`, `icons.tsx`.
- `collection()` and `filesApi()` in `src/api.ts` are the matching API clients.

## Sharing by email (Drive and Photos)

1. Select files with the checkboxes, press **Share**, choose recipients, optionally add a message.
2. The backend creates a share with a random 256-bit token and emails each recipient the link `{FRONTEND_URL}/shared/<token>`.
3. The link opens a public page (no sign-in) listing the shared files, with **View** and **Download**.

- Anyone who has the link can open it; the token is the only protection.
- Links expire after `SHARE_MAX_AGE_DAYS` (default 30; 0 = never).
- The response lists addresses the email could not be sent to, and the dialog shows the link so it can be sent by hand.
- Deleting a file removes it from its shares. `GET` / `DELETE /api/<app>/shares` list and revoke links; there is no screen for this yet.
- Folders cannot be shared as a whole; select the files in them.

## Encryption of documents (Drive)

- **Encrypt** asks for a password (8+ characters). The content is replaced in the database by AES-256-GCM ciphertext; the key is derived from the password with scrypt and a random salt (`app/crypto.py`).
- The password is not stored. **A forgotten password means the document cannot be recovered.**
- An encrypted document can be downloaded (decrypted on the fly) or permanently **decrypted**, both with the password. A wrong password is detected, not turned into garbage.
- Encryption and decryption run on the server: the password travels to the server over HTTPS and is used in memory only. The server never keeps it, but this is not end-to-end encryption.
- A shared encrypted document asks the recipient for the password on the shared page. The password is not in the email; the sender passes it on separately.
- Photos cannot be encrypted (the request asked for documents).

## Calendar reminders

- Each event has an optional reminder: at the start, 5 / 10 / 15 / 30 minutes, 1 / 2 hours, 1 / 2 days or 1 week before.
- The reminder is emailed to the account's own address, with times in the time zone of the browser that saved the event.
- A background thread in the web process checks every `REMINDER_INTERVAL_SECONDS` (default 60). Each reminder is claimed with a conditional `UPDATE`, so several workers do not send it twice.
- A reminder missed while the server was down is sent late, as long as the event has not started. Moving an event or changing its reminder makes it due again. A failed send is retried on the next check.
- `flask send-reminders` runs one check from the command line or cron (set `REMINDER_INTERVAL_SECONDS=0` to turn the thread off).

## Storage and limits

- File content is stored in Postgres (`files.data`), not on disk, so it survives redeploys on hosts with no persistent disk such as Render's free plan.
- Upload limit: `MAX_UPLOAD_MB` (default 25) per request.
- Photos are shown from the original file; no thumbnails are generated.
- Only PNG, JPEG, GIF, WebP, BMP, AVIF, PDF and plain text are displayed in the browser. Every other type (including HTML and SVG) is always sent as a download, so an uploaded file cannot run script on the app's origin.

## Data model

Migration `0002_create_app_tables`: `recipients`, `tasks`, `events`, `folders`, `files`, `shares`, `share_files`, `share_recipients`.

## Tests

- Backend: `test_recipients.py`, `test_tasks.py`, `test_events.py` (including reminders), `test_files.py` (folders, upload, encryption, sharing, public links, isolation between users).
- Frontend: `AppLayout`, `Recipients`, `Tasks`, `Calendar`, `FileBrowser` (Drive and Photos), `Shared`.

## Not included

- Editing rich documents (Word-style), spreadsheets or previews of Office files
- Moving files or folders, search, trash / restore, storage quota per user
- Task lists, subtasks, repeating tasks
- Week / day calendar views, repeating events, inviting recipients to events
- Reminders by anything other than email, or to anyone other than the owner
- A screen to see and revoke shared links
- Thumbnails, photo metadata, slideshow
