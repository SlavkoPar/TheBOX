# 07 — Main functionality: implementation notes

How the requirements in `07-main-functionality.md` were built, and the decisions that were not in the request. The second half of the work implemented what an earlier version of these notes listed as "not included"; what is still missing is at the end.

## Apps

| App | Route | What it does |
| --- | --- | --- |
| Drive | `/drive` | Folders and subfolders, upload, documents created and edited in the browser (text, formatted text, spreadsheet), Office previews, move, rename, search, trash, encrypt / decrypt, share |
| Photos | `/photos` | Albums and sub-albums, image upload, thumbnail grid, viewer with slideshow and photo details, move, rename, search, trash, share |
| Tasks | `/tasks` | Lists, tasks with notes and due date, subtasks, repeating tasks, done / not done, overdue highlight |
| Calendar | `/calendar` | Month, week and day views, timed and all-day events, repeating events, inviting recipients, email reminders |
| Recipients | `/recipients` | First name, last name, email, address, country, mobile |

The apps menu is the grid button next to the profile icon in the header; it lists the five entries with their icons. The home page shows the same list as tiles. Both read `frontend/src/apps.ts`.

## Common code

**Backend — `app/common.py`**
- `crud_blueprint(...)`: list / create / read / replace / update / delete endpoints for a model owned by a user, with optional hooks (`validate`, `extra`, `after_commit`, `list_filter`). Recipients, Tasks, Task lists and Calendar events are each one schema plus one call to it.
- Field classes (`Str`, `Email`, `Bool`, `Int`, `Choice`, `Date`, `DateTime`) and `apply_schema` validate request JSON.
- `get_owned` loads a row only if it belongs to the signed-in user; everything else is a 404.
- `ApiError` gives every endpoint the same JSON error shape.
- `OwnedMixin` in `models.py` gives every table `id`, `user_id`, `created_at`.

**Backend — shared by several apps**
- `app/files.py`: `files_blueprint("drive")` and `files_blueprint("photos")` create the same endpoints over the same `folders`, `files` and `shares` tables. Rows are kept apart by an `app` column. The differences (images only, encryption allowed) are the entries in `FILE_APP_OPTIONS`.
- `app/recurrence.py`: repeating dates, used by Tasks (next due date) and Calendar (occurrences, reminders).

**Frontend — `src/common/`**
- `FileBrowser.tsx`: the whole folder browser. `pages/Drive.tsx` and `pages/Photos.tsx` are only an options object each.
- `FileDialogs.tsx` (Office preview, move, shared links, photo viewer), `ShareDialog.tsx`, `editors.tsx` (text, formatted text, spreadsheet).
- `Modal.tsx` (`Modal`, `FormModal`, `PromptDialog`, `ConfirmDialog`), `useAction.ts`, `useCollection.ts`, `format.ts`, `recurrence.ts`, `csv.ts`, `richText.ts`, `icons.tsx`.
- `collection()` and `filesApi()` in `src/api.ts` are the matching API clients.

## Drive and Photos

### Folders, move, search
- Folders nest to any depth. Files and folders can be moved with the **Move** button (one item or the whole selection); a folder cannot be moved into itself or a folder inside it.
- The search box finds files and folders by name in every folder of the app and shows where each one is.

### Trash
- **Delete** moves an item to the trash; a folder takes everything inside it along. Trashed items disappear from listings, search and shared links.
- The trash (`?view=trash`) lists what was deleted, with **Restore** and **Delete forever** per item and **Empty trash**.
- A restored item returns to where it was. If that folder is gone it returns to the top level; if its name was taken meanwhile, a restored folder gets " (restored)" added.
- Nothing is removed from the trash automatically.

### Storage limit
- Each user may store `STORAGE_QUOTA_MB` (default 500; 0 = no limit) across Drive and Photos together. Items in the trash count until deleted forever.
- The file browser shows the amount used. An upload or save that would exceed the limit is refused.

### Sharing by email
1. Select files and / or folders with the checkboxes, press **Share**, choose recipients, optionally add a message.
2. The backend creates a share with a random 256-bit token and emails each recipient the link `{FRONTEND_URL}/shared/<token>`.
3. The link opens a public page (no sign-in) listing the shared files, with **View** and **Download**.

- Anyone who has the link can open it; the token is the only protection.
- Sharing a folder shares the files that are in it (and its subfolders) at that moment. Files added later are not included.
- Links expire after `SHARE_MAX_AGE_DAYS` (default 30; 0 = never).
- The response lists addresses the email could not be sent to, and the dialog shows the link so it can be sent by hand.
- **Shared links** in the file browser lists every link with its files, recipients and expiry, and can copy or revoke it.

### Documents (Drive)
- **New document** creates a text document (`.txt`), a formatted document (`.html`) or a spreadsheet (`.csv`), each with its own editor. Uploaded files of those types open in the same editors.
- The formatted editor offers bold, italic, underline, headings and lists. Content is cleaned when opened and when saved: only simple formatting and links are kept; scripts, styles, images and frames are removed.
- The spreadsheet editor is a grid of cells saved as CSV. It has no formulas.
- Word, Excel and PowerPoint files (`.docx`, `.xlsx`, `.pptx`) open in a text-only preview made on the server: headings, paragraphs, tables, sheet cells, slide text. Formatting and pictures are not shown. Old formats (`.doc`, `.xls`, `.ppt`) are not previewed.

### Encryption of documents (Drive)
- **Encrypt** asks for a password (8+ characters). The content is replaced in the database by AES-256-GCM ciphertext; the key is derived from the password with scrypt and a random salt (`app/crypto.py`).
- The password is not stored. **A forgotten password means the document cannot be recovered.**
- An encrypted document can be downloaded (decrypted on the fly) or permanently **decrypted**, both with the password. A wrong password is detected, not turned into garbage.
- Encryption and decryption run on the server: the password travels to the server over HTTPS and is used in memory only. The server never keeps it, but this is not end-to-end encryption.
- A shared encrypted document asks the recipient for the password on the shared page. The password is not in the email; the sender passes it on separately.
- Encrypted documents cannot be edited or previewed until decrypted. Photos cannot be encrypted (the request asked for documents).

### Photos
- A thumbnail (WebP, at most 480 px) is made at upload and used in the grids. The pixel size and, from EXIF, the date taken and the camera are stored and shown in the viewer. Photos are shown the way the camera was held.
- The viewer steps through the photos of the album with buttons or the arrow keys and can play them as a slideshow (3 seconds each).
- An image that cannot be read still uploads; it has no thumbnail or details.

### Storage and safety
- File content and thumbnails are stored in Postgres, not on disk, so they survive redeploys on hosts with no persistent disk such as Render's free plan.
- Upload limit: `MAX_UPLOAD_MB` (default 25) per request.
- Only PNG, JPEG, GIF, WebP, BMP, AVIF, PDF and plain text are displayed by the browser directly. Every other type (including HTML and SVG) is always sent as a download, so an uploaded file cannot run script on the app's origin.

## Tasks

- **Lists:** "My tasks" is built in; more lists can be created, renamed and deleted. Deleting a list deletes its tasks. A task can be moved to another list from its edit dialog.
- **Subtasks:** one level deep. A subtask lives in its parent's list. Completing or deleting a task does the same to its subtasks; completing a subtask does not complete its parent.
- **Repeating tasks:** daily, weekly, monthly or yearly. When a repeating task is completed, the next one is created with the next due date after today (so a long-overdue task does not produce a backlog). Its subtasks are not copied.

## Calendar

- **Views:** month grid, and week and day views that list each day's events in order with their times and place. Week and day are lists, not hour-by-hour grids.
- **Repeating events:** daily, weekly, monthly or yearly, for ever or until a date. The local time is kept across daylight-saving changes. Editing or deleting applies to the whole series; a single occurrence cannot be changed on its own.
- **Inviting recipients:** recipients ticked in the event form get an invitation email when they are added, and the reminder emails. They cannot accept or decline.
- **Reminders:** at the start, 5 / 10 / 15 / 30 minutes, 1 / 2 hours, 1 / 2 days or 1 week before. Emailed to the account's own address and to invited recipients, with times in the time zone of the browser that saved the event. A repeating event gets a reminder for every occurrence.
- A background thread in the web process checks every `REMINDER_INTERVAL_SECONDS` (default 60). Each reminder is claimed with a conditional `UPDATE`, so several workers do not send it twice.
- A reminder missed while the server was down is sent late, as long as the event has not started. Changing an event's time, repeat or reminder makes it due again. A failed send is retried on the next check.
- `flask send-reminders` runs one check from the command line or cron (set `REMINDER_INTERVAL_SECONDS=0` to turn the thread off).

## Data model

- Migration `0002_create_app_tables`: `recipients`, `tasks`, `events`, `folders`, `files`, `shares`, `share_files`, `share_recipients`.
- Migration `0003_manage_files_lists_repeats`: `task_lists`, `event_recipients`; trash, thumbnail and photo-detail columns on `files` / `folders`; list, parent and repeat on `tasks`; repeat columns on `events`.

## Tests

- Backend: `test_recipients.py`, `test_tasks.py`, `test_tasks_lists.py`, `test_events.py`, `test_events_repeat.py`, `test_files.py`, `test_files_manage.py`.
- Frontend: `AppLayout`, `Recipients`, `Tasks`, `Calendar`, `FileBrowser` (Drive and Photos), `Shared`, and `helpers.test.ts` (CSV, HTML cleaning, recurrence).

## Still not included

- **Reminders other than email** (SMS, push): these need an outside service and an account with it.
- Word-style page layout, pictures in documents, spreadsheet formulas, editing of Office files (they are previewed only)
- Previews of old Office formats and of files behind a shared link (those are download-only)
- Changing or skipping a single occurrence of a repeating event; accept / decline for invitations
- An hour-by-hour grid in the week and day views; dragging events
- Automatic emptying of the trash after some days
- Sharing a folder "live" (including files added after the link was sent)
- Search inside file contents
- Admin screens for changing a user's storage limit (it is one setting for everyone)
