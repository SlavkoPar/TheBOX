# 05 — Tests

## Goal

Automated tests for the backend and the frontend, runnable locally with one command each. No external services are needed: no Postgres, no SMTP server, no browser.

## Backend — pytest

Run from `backend/` (after `pip install -r requirements-dev.txt`):

```
python -m pytest
```

- Database: in-memory SQLite, created and dropped per test.
- Shared fixtures in `tests/conftest.py`: `app`, `client`, `outbox` (captures emails instead of sending), `signed_in` (client with a confirmed, signed-in user).

| File | Covers |
| --- | --- |
| `test_auth.py` | register, confirm, resend, login, logout, `/me`; validation; no account enumeration; expired, invalid and orphaned tokens; password hashing; malformed bodies |
| `test_routes.py` | `/api/health` with the database up and down; `/api/demo` signed out and signed in; unknown API paths |
| `test_mail.py` | SMTP with STARTTLS + login, implicit SSL, no auth; logging instead of sending when `SMTP_HOST` is empty; errors propagate (`smtplib` is faked) |
| `test_config.py` | `DATABASE_URL` rewritten to the psycopg driver; `FRONTEND_URL` → `RENDER_EXTERNAL_URL` → localhost precedence; boolean parsing |
| `test_frontend_serving.py` | serving the built frontend: index, assets, fallback for client-side routes, JSON 404 for unknown `/api` paths, no escape from the dist folder |

## Frontend — Vitest + Testing Library

Run from `frontend/`:

```
npm test            # once
npm run test:watch  # re-run on change
```

- Environment: jsdom. Configuration is the `test` block in `vite.config.ts`; setup in `src/test/setup.ts`.
- `src/test/utils.tsx`: `mockApi()` replaces `fetch` with a fake backend keyed by `"METHOD /api/path"` (an unexpected request fails the test); `renderApp()` renders inside the router and `AuthProvider`.
- Test files sit next to the code they test (`*.test.ts(x)`).

| File | Covers |
| --- | --- |
| `api.test.ts` | request shape, 204 handling, `ApiError` from JSON and non-JSON errors, network failure |
| `pages/Login.test.tsx` | successful sign-in, wrong credentials, unconfirmed account + resend, redirect when signed in |
| `pages/Register.test.tsx` | successful registration, mismatched passwords, server error |
| `pages/Confirm.test.tsx` | valid token, expired token, missing token |
| `components/DemoFetch.test.tsx` | loading → data, error, fetch again, recovery after error |
| `App.test.tsx` | route protection, home page when signed in, unknown paths, navigation, sign out |

## Not included

- End-to-end tests in a real browser (e.g. Playwright)
- Tests against a real Postgres or SMTP server
- Coverage thresholds
- CI workflow running the tests on push
