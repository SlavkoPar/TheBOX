# 02 — Authentication (email + password, email confirmation)

## Goal

Users register with an email address and a password. A registration must be confirmed through a link sent by email (SMTP) before the user can sign in.

## Flow

1. The user submits email + password on `/register`.
2. The backend creates an unconfirmed user and emails a confirmation link: `{FRONTEND_URL}/confirm?token=...`.
3. The user opens the link; the frontend `/confirm` page posts the token to the backend, which marks the user confirmed.
4. The user signs in on `/login`. Signing in before confirming is refused, with an option to resend the email.

## Data model

Table `users` (migration `0001_create_users`):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer | primary key |
| `email` | varchar(254) | unique, stored trimmed and lower-cased |
| `password_hash` | varchar(255) | Werkzeug `generate_password_hash` (scrypt) |
| `is_confirmed` | boolean | default false |
| `confirmed_at` | timestamptz | null until confirmed |
| `created_at` | timestamptz | |

## API

All under `/api/auth`, JSON in and out. Errors are `{"error": "<message>"}` with a 4xx/5xx status.

| Method | Path | Body | Success | Errors |
| --- | --- | --- | --- | --- |
| POST | `/register` | `email`, `password` | 201 `{message}` | 400 invalid email or password length; 502 account created but email not sent |
| POST | `/confirm` | `token` | 200 `{message}` | 400 missing, invalid or expired token |
| POST | `/resend-confirmation` | `email` | 200 `{message}` | — |
| POST | `/login` | `email`, `password` | 200 `{user}` | 401 wrong credentials; 403 with `code: "email_not_confirmed"` |
| POST | `/logout` | — | 204 | — |
| GET | `/me` | — | 200 `{user}` | 401 not signed in |

`user` is `{id, email, is_confirmed}`.

## Rules

- **Password:** 8–128 characters. No composition rules.
- **Confirmation token:** signed with `SECRET_KEY` (itsdangerous, salt `email-confirm`), carries the user id and email, expires after `CONFIRM_TOKEN_MAX_AGE` seconds (default 24 hours). Tokens are not stored; confirming twice is harmless.
- **No account enumeration:**
  - Registering an address that already has a confirmed account returns the same 201 response and sends nothing.
  - `/resend-confirmation` always returns the same 200 response.
  - `/login` returns the same 401 for an unknown address and a wrong password. The 403 "not confirmed" response is only given after the password is verified.
- **Re-registering an unconfirmed address** resends the confirmation email; the password from the first registration is kept.
- **Session:** Flask signed session cookie holding `user_id`; `HttpOnly`, `SameSite=Lax`, `Secure` when `SESSION_COOKIE_SECURE=1`. Protect further endpoints with the `login_required` decorator in `app/auth.py`.

## Email

- Sent with the standard library `smtplib` (`app/mail.py`), plain text.
- Configuration: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_USE_TLS` (STARTTLS), `SMTP_USE_SSL` (implicit TLS), `MAIL_FROM`.
- If `SMTP_HOST` is empty the email is written to the backend log instead of being sent, so the link can be copied during local development.
- Email is sent synchronously inside the request, with a 10-second timeout.

## Frontend

- `react-router-dom` routes: `/` (protected home), `/login`, `/register`, `/confirm`.
- `src/api.ts` — typed fetch wrapper; `src/auth.tsx` — `AuthProvider` / `useAuth()` holding the current user, loaded from `/api/auth/me` on start.
- Signed-out visitors to `/` are redirected to `/login`; signed-in visitors to `/login` or `/register` are redirected to `/`.

## Tests

`backend/tests/test_auth.py` (pytest, in-memory SQLite, email sending stubbed). Run with `python -m pytest` from `backend/` after `pip install -r requirements-dev.txt`.

## Not included

- Password reset / change password / change email
- Rate limiting or lockout on login, registration and resend
- CSRF tokens (relies on `SameSite=Lax` and JSON-only endpoints)
- Server-side session revocation ("sign out everywhere")
- Cleanup of accounts that are never confirmed
- HTML emails, background sending queue
- Frontend tests
