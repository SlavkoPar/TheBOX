# 04 — Demo fetch

## Goal

Show, end to end, how the frontend fetches data from the backend, as a pattern to copy for real features.

## Backend

- `GET /api/demo` in `app/routes.py`, protected with `login_required`.
- Response:

  ```json
  {
    "message": "Hello, user@example.com!",
    "server_time": "2026-11-21T18:00:00+00:00",
    "items": [{ "id": 1, "name": "Cardboard box", "size": "small" }]
  }
  ```

- `items` is a hard-coded list (`DEMO_ITEMS`); nothing is read from the database.
- Returns 401 when not signed in.

## Frontend

- `api.demo()` and the `DemoData` / `DemoItem` types in `src/api.ts`.
- `src/components/DemoFetch.tsx`, shown on the home page below the welcome card:
  - fetches on mount and shows a loading state, then the message, the item list and the server time;
  - shows the error message if the request fails;
  - "Fetch again" repeats the request (the server time changes).

## Tests

`test_demo_requires_login` in `backend/tests/test_auth.py`.
