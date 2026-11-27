// Typed client for the backend API. Everything that talks to /api goes through here.

export class ApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.'
}

// --- Transport ----------------------------------------------------------------

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined || isForm ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0)
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new ApiError(
      data?.error ?? `Request failed (${response.status}).`,
      response.status,
      data?.code,
    )
  }
  return response
}

/** JSON request; resolves to the parsed body (null for 204). */
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await send(method, path, body)
  if (response.status === 204) return null as T
  return (await response.json().catch(() => null)) as T
}

/** Request whose response is file content. */
export async function requestBlob(method: string, path: string, body?: unknown): Promise<Blob> {
  return (await send(method, path, body)).blob()
}

// --- Common: a collection of rows with the standard CRUD endpoints ----------------

export type WithId = { id: number }

export type Collection<T extends WithId, Input> = {
  list: () => Promise<T[]>
  create: (data: Input) => Promise<T>
  update: (id: number, data: Partial<Input>) => Promise<T>
  remove: (id: number) => Promise<null>
}

export function collection<T extends WithId, Input>(path: string): Collection<T, Input> {
  return {
    list: () => request<{ items: T[] }>('GET', path).then((data) => data.items),
    create: (data) => request<T>('POST', path, data),
    update: (id, data) => request<T>('PATCH', `${path}/${id}`, data),
    remove: (id) => request<null>('DELETE', `${path}/${id}`),
  }
}

// --- Auth -----------------------------------------------------------------------

export type User = {
  id: number
  email: string
  is_confirmed: boolean
  /** an administrator: sees the Users page */
  is_admin?: boolean
}

/** A registered user, as an administrator sees it. */
export type AdminUser = User & {
  created_at: string
  confirmed_at: string | null
  file_count: number
  storage_used: number
}

/** How many items the signed-in user has in each app (the key is the app's id). */
export type Summary = Partial<Record<string, Record<string, number>>>

export const summaryApi = {
  get: () => request<Summary>('GET', '/summary'),
}

export const adminApi = {
  users: () => request<{ items: AdminUser[] }>('GET', '/admin/users').then((data) => data.items),
}

type Message = { message: string }

export type DemoItem = {
  id: number
  name: string
  size: string
}

export type DemoData = {
  message: string
  server_time: string
  items: DemoItem[]
}

export const api = {
  me: () => request<{ user: User }>('GET', '/auth/me'),
  register: (email: string, password: string) =>
    request<Message>('POST', '/auth/register', { email, password }),
  login: (email: string, password: string) =>
    request<{ user: User }>('POST', '/auth/login', { email, password }),
  logout: () => request<null>('POST', '/auth/logout'),
  confirm: (token: string) => request<Message>('POST', '/auth/confirm', { token }),
  resendConfirmation: (email: string) =>
    request<Message>('POST', '/auth/resend-confirmation', { email }),
  forgotPassword: (email: string) => request<Message>('POST', '/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    request<Message>('POST', '/auth/reset-password', { token, password }),
  demo: () => request<DemoData>('GET', '/demo'),
}

// --- Friends -------------------------------------------------------------------

export type FriendInput = {
  first_name: string
  last_name: string
  email: string
  address: string
  country: string
  mobile: string
}
export type Friend = FriendInput & WithId

export const friendsApi = collection<Friend, FriendInput>('/friends')

// --- Repeats (tasks and events) ------------------------------------------------------

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'

export const REPEAT_LABELS: Record<Repeat, string> = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
}

// --- Messenger ------------------------------------------------------------------

/** A file of the sender's Drive or Photos, sent with a message. */
export type ChatFile = { id: number; name: string; mime_type: string; size: number; is_encrypted: boolean }

export type ChatMessage = {
  id: number
  /** '' when only files were sent */
  body: string
  created_at: string
  mine: boolean
  files?: ChatFile[]
}

/** What to send along: files, and folders (the files in them at that moment). */
export type ChatAttachments = { file_ids: number[]; folder_ids: number[] }

/** Someone to chat with: a friend, or a person who wrote first (no friend_id). */
export type Conversation = {
  email: string
  name: string
  friend_id: number | null
  unread: number
  last: ChatMessage | null
  /** signed in to TheBOX right now */
  online?: boolean
}

export const messengerApi = {
  conversations: () =>
    request<{ items: Conversation[] }>('GET', '/messenger/conversations').then((data) => data.items),
  /** The chat with one address; with `after`, only messages newer than that id. */
  messages: (email: string, after = 0) =>
    request<{ items: ChatMessage[] }>(
      'GET',
      `/messenger/messages?with=${encodeURIComponent(email)}${after ? `&after=${after}` : ''}`,
    ).then((data) => data.items),
  send: (to: string, body: string, attachments?: ChatAttachments) =>
    request<ChatMessage>('POST', '/messenger/messages', { to, body, ...attachments }),
  remove: (id: number) => request<null>('DELETE', `/messenger/messages/${id}`),
  /** URL of a file sent with a message, for links and new tabs (unencrypted files only). */
  fileUrl: (messageId: number, fileId: number, download = false) =>
    `/api/messenger/messages/${messageId}/files/${fileId}${download ? '?download=1' : ''}`,
  thumbUrl: (messageId: number, fileId: number) =>
    `/api/messenger/messages/${messageId}/files/${fileId}/thumb`,
  decrypted: (messageId: number, fileId: number, password: string) =>
    requestBlob('POST', `/messenger/messages/${messageId}/files/${fileId}`, { password }),
}

// --- Tasks ------------------------------------------------------------------------

export type TaskInput = {
  title: string
  notes: string
  due_date: string | null // YYYY-MM-DD
  is_done: boolean
  /** null = the built-in "My tasks" list */
  list_id: number | null
  /** set for a subtask */
  parent_id: number | null
  /** when a repeating task is completed, the next one is created */
  repeat: Repeat
}
export type Task = TaskInput & WithId & { completed_at: string | null; created_at: string }

export const tasksApi = collection<Task, TaskInput>('/tasks')

export type TaskList = WithId & { name: string }

export const taskListsApi = collection<TaskList, { name: string }>('/task-lists')

// --- Calendar ---------------------------------------------------------------------

export type EventInput = {
  title: string
  description: string
  location: string
  starts_at: string // ISO 8601
  ends_at: string
  all_day: boolean
  timezone: string
  reminder_minutes: number | null
  repeat: Repeat
  repeat_until: string | null // YYYY-MM-DD, inclusive
  /** friends invited to the event: they get the invitation and the reminders */
  friend_ids: number[]
}
export type CalendarEvent = EventInput & WithId & { reminder_sent_at: string | null }

export const eventsApi = collection<CalendarEvent, EventInput>('/events')

// --- Drive and Photos (same endpoints under /drive and /photos) ---------------------

export type FileApp = 'drive' | 'photos'

export type Folder = {
  id: number
  name: string
  parent_id: number | null
  created_at: string
  deleted_at: string | null
  /** where it is, e.g. "Work / Reports" — in search results and the trash */
  path?: string
}

export type FileItem = {
  id: number
  name: string
  folder_id: number | null
  mime_type: string
  size: number
  is_encrypted: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
  /** images only */
  width: number | null
  height: number | null
  taken_at: string | null
  camera: string | null
  path?: string
}

export type Listing = {
  folder: Folder | null
  breadcrumbs: { id: number; name: string }[]
  folders: Folder[]
  files: FileItem[]
}

export type Found = { folders: Folder[]; files: FileItem[] }

export type ShareResult = {
  link: string
  sent: string[]
  failed: string[]
}

/** A link that was emailed to friends. */
export type SharedLink = {
  id: number
  link: string
  message: string
  created_at: string
  expires_at: string | null
  expired: boolean
  files: FileItem[]
  friends: Friend[]
}

/** Text-only preview of an Office file. */
export type PreviewBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph' | 'list-item'; text: string }
  | { type: 'table'; rows: string[][] }

export type Preview =
  | { kind: 'document'; truncated: boolean; blocks: PreviewBlock[] }
  | { kind: 'sheets'; truncated: boolean; sheets: { name: string; rows: string[][] }[] }
  | { kind: 'slides'; truncated: boolean; slides: { title: string; lines: string[] }[] }

export function filesApi(app: FileApp) {
  const base = `/${app}`
  const contentPath = (id: number, download: boolean) =>
    `${base}/files/${id}/content${download ? '?download=1' : ''}`
  const forGood = (permanent: boolean) => (permanent ? '?permanent=1' : '')

  return {
    list: (folderId: number | null) =>
      request<Listing>('GET', `${base}/items${folderId ? `?folder=${folderId}` : ''}`),
    /** Every folder, flat — for the "move to" dialog. */
    folders: () => request<{ items: Folder[] }>('GET', `${base}/folders`).then((d) => d.items),
    search: (text: string) => request<Found>('GET', `${base}/search?q=${encodeURIComponent(text)}`),

    createFolder: (name: string, parentId: number | null) =>
      request<Folder>('POST', `${base}/folders`, { name, parent_id: parentId }),
    renameFolder: (id: number, name: string) =>
      request<Folder>('PATCH', `${base}/folders/${id}`, { name }),
    moveFolder: (id: number, parentId: number | null) =>
      request<Folder>('PATCH', `${base}/folders/${id}`, { parent_id: parentId }),
    /** Moves to the trash; `permanent` deletes for good. */
    deleteFolder: (id: number, permanent = false) =>
      request<null>('DELETE', `${base}/folders/${id}${forGood(permanent)}`),

    upload: (files: File[], folderId: number | null) => {
      const form = new FormData()
      for (const file of files) form.append('file', file, file.name)
      if (folderId) form.append('folder_id', String(folderId))
      return request<{ files: FileItem[] }>('POST', `${base}/files`, form)
    },
    renameFile: (id: number, name: string) =>
      request<FileItem>('PATCH', `${base}/files/${id}`, { name }),
    moveFile: (id: number, folderId: number | null) =>
      request<FileItem>('PATCH', `${base}/files/${id}`, { folder_id: folderId }),
    /** Moves to the trash; `permanent` deletes for good. */
    deleteFile: (id: number, permanent = false) =>
      request<null>('DELETE', `${base}/files/${id}${forGood(permanent)}`),

    trash: () => request<Found>('GET', `${base}/trash`),
    restore: (fileIds: number[], folderIds: number[]) =>
      request<null>('POST', `${base}/trash/restore`, { file_ids: fileIds, folder_ids: folderIds }),
    emptyTrash: () => request<null>('DELETE', `${base}/trash`),

    /** URL for <img src>, links and new tabs (unencrypted files only). */
    contentUrl: (id: number, download = false) => `/api${contentPath(id, download)}`,
    /** Small version of an image, for grids. */
    thumbUrl: (id: number) => `/api${base}/files/${id}/thumb`,
    /** Content as a Blob; pass the password for an encrypted document. */
    content: (id: number, password?: string) =>
      password === undefined
        ? requestBlob('GET', contentPath(id, false))
        : requestBlob('POST', contentPath(id, false), { password }),
    preview: (id: number) => request<Preview>('GET', `${base}/files/${id}/preview`),
    saveText: (id: number, content: string) =>
      request<FileItem>('PUT', `${base}/files/${id}/text`, { content }),

    encrypt: (id: number, password: string) =>
      request<FileItem>('POST', `${base}/files/${id}/encrypt`, { password }),
    decrypt: (id: number, password: string) =>
      request<FileItem>('POST', `${base}/files/${id}/decrypt`, { password }),

    /** Sharing a folder shares the files in it (and its subfolders) at that moment. */
    share: (fileIds: number[], folderIds: number[], friendIds: number[], message: string) =>
      request<ShareResult>('POST', `${base}/shares`, {
        file_ids: fileIds,
        folder_ids: folderIds,
        friend_ids: friendIds,
        message,
      }),
    shares: () => request<{ items: SharedLink[] }>('GET', `${base}/shares`).then((d) => d.items),
    revokeShare: (id: number) => request<null>('DELETE', `${base}/shares/${id}`),
  }
}

export type FilesApi = ReturnType<typeof filesApi>

export type StorageInfo = { used: number; quota: number }

export const storageApi = {
  /** Bytes used across Drive and Photos, and the limit (0 = none). */
  get: () => request<StorageInfo>('GET', '/storage'),
}

// --- Packages: files and folders from anywhere, behind one link, with a send history ----

export type PackageInput = {
  name: string
  message: string
  file_ids: number[]
  folder_ids: number[]
  friend_ids: number[]
}

/** `path` is the folder the item is in, e.g. "Work / Reports"; "" for the top level. */
export type PackageFile = FileItem & { app: FileApp; path: string }
/** A folder in a package is live: the link shows what is in it now. */
export type PackageFolder = Folder & { app: FileApp; path: string; file_count: number }

/** One time the package was emailed. Names are as they were then. */
export type PackageSend = {
  id: number
  sent_at: string
  message: string
  friends: { name: string; email: string; sent: boolean }[]
  items: { kind: 'file' | 'folder'; app: FileApp; name: string; path: string; file_count?: number }[]
}

export type Package = WithId & {
  name: string
  message: string
  link: string
  created_at: string
  updated_at: string
  expires_at: string | null
  expired: boolean
  /** files the link gives access to: those picked plus those inside the folders */
  file_count: number
  files: PackageFile[]
  folders: PackageFolder[]
  friends: Friend[]
  /** newest first */
  sends: PackageSend[]
}

export const packagesApi = {
  ...collection<Package, PackageInput>('/packages'),
  /** Email the link to the package's friends; the send is added to its history. */
  send: (id: number) => request<ShareResult & { package: Package }>('POST', `/packages/${id}/send`),
}

// --- Shared links (public, no sign-in) ----------------------------------------------

export type SharedFile = Pick<
  FileItem,
  'id' | 'name' | 'mime_type' | 'size' | 'is_encrypted' | 'width' | 'height'
> & {
  /** in a package: the folder the file is in, starting at the folder that was packaged */
  path?: string
}

export type SharedListing = {
  /** 'package': files of both apps, sent as a package */
  app: FileApp | 'package'
  /** name of the package */
  name?: string
  shared_by: string
  message: string
  expires_at: string | null
  files: SharedFile[]
}

export const sharedApi = {
  get: (token: string) => request<SharedListing>('GET', `/shared/${token}`),
  contentUrl: (token: string, id: number, download = false) =>
    `/api/shared/${token}/files/${id}${download ? '?download=1' : ''}`,
  thumbUrl: (token: string, id: number) => `/api/shared/${token}/files/${id}/thumb`,
  decrypted: (token: string, id: number, password: string) =>
    requestBlob('POST', `/shared/${token}/files/${id}`, { password }),
}
