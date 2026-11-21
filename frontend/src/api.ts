export type User = {
  id: number
  email: string
  is_confirmed: boolean
}

export class ApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0)
  }

  const data = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(
      data?.error ?? `Request failed (${response.status}).`,
      response.status,
      data?.code,
    )
  }
  return data as T
}

type Message = { message: string }

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
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.'
}
