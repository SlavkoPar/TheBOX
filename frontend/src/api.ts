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
  demo: () => request<DemoData>('GET', '/demo'),
}

// --- Recipients -------------------------------------------------------------------

export type RecipientInput = {
  first_name: string
  last_name: string
  email: string
  address: string
  country: string
  mobile: string
}
export type Recipient = RecipientInput & WithId

export const recipientsApi = collection<Recipient, RecipientInput>('/recipients')

// --- Tasks ------------------------------------------------------------------------

export type TaskInput = {
  title: string
  notes: string
  due_date: string | null // YYYY-MM-DD
  is_done: boolean
}
export type Task = TaskInput & WithId & { completed_at: string | null; created_at: string }

export const tasksApi = collection<Task, TaskInput>('/tasks')

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
}

export type Listing = {
  folder: Folder | null
  breadcrumbs: { id: number; name: string }[]
  folders: Folder[]
  files: FileItem[]
}

export type ShareResult = {
  link: string
  sent: string[]
  failed: string[]
}

export function filesApi(app: FileApp) {
  const base = `/${app}`
  const contentPath = (id: number, download: boolean) =>
    `${base}/files/${id}/content${download ? '?download=1' : ''}`

  return {
    list: (folderId: number | null) =>
      request<Listing>('GET', `${base}/items${folderId ? `?folder=${folderId}` : ''}`),

    createFolder: (name: string, parentId: number | null) =>
      request<Folder>('POST', `${base}/folders`, { name, parent_id: parentId }),
    renameFolder: (id: number, name: string) =>
      request<Folder>('PATCH', `${base}/folders/${id}`, { name }),
    deleteFolder: (id: number) => request<null>('DELETE', `${base}/folders/${id}`),

    upload: (files: File[], folderId: number | null) => {
      const form = new FormData()
      for (const file of files) form.append('file', file, file.name)
      if (folderId) form.append('folder_id', String(folderId))
      return request<{ files: FileItem[] }>('POST', `${base}/files`, form)
    },
    renameFile: (id: number, name: string) =>
      request<FileItem>('PATCH', `${base}/files/${id}`, { name }),
    deleteFile: (id: number) => request<null>('DELETE', `${base}/files/${id}`),

    /** URL for <img src>, links and new tabs (unencrypted files only). */
    contentUrl: (id: number, download = false) => `/api${contentPath(id, download)}`,
    /** Content as a Blob; pass the password for an encrypted document. */
    content: (id: number, password?: string) =>
      password === undefined
        ? requestBlob('GET', contentPath(id, false))
        : requestBlob('POST', contentPath(id, false), { password }),
    saveText: (id: number, content: string) =>
      request<FileItem>('PUT', `${base}/files/${id}/text`, { content }),

    encrypt: (id: number, password: string) =>
      request<FileItem>('POST', `${base}/files/${id}/encrypt`, { password }),
    decrypt: (id: number, password: string) =>
      request<FileItem>('POST', `${base}/files/${id}/decrypt`, { password }),

    share: (fileIds: number[], recipientIds: number[], message: string) =>
      request<ShareResult>('POST', `${base}/shares`, {
        file_ids: fileIds,
        recipient_ids: recipientIds,
        message,
      }),
  }
}

export type FilesApi = ReturnType<typeof filesApi>

// --- Shared links (public, no sign-in) ----------------------------------------------

export type SharedFile = Pick<FileItem, 'id' | 'name' | 'mime_type' | 'size' | 'is_encrypted'>

export type SharedListing = {
  app: FileApp
  shared_by: string
  message: string
  expires_at: string | null
  files: SharedFile[]
}

export const sharedApi = {
  get: (token: string) => request<SharedListing>('GET', `/shared/${token}`),
  contentUrl: (token: string, id: number, download = false) =>
    `/api/shared/${token}/files/${id}${download ? '?download=1' : ''}`,
  decrypted: (token: string, id: number, password: string) =>
    requestBlob('POST', `/shared/${token}/files/${id}`, { password }),
}
