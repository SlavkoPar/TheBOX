# 01 — Initial project setup

## Goal

Set up TheBOX as a two-part web application: a Python API backed by PostgreSQL and a React single-page frontend.

## Structure

```
TheBOX/
├── backend/    Flask API
├── frontend/   Vite + React + TypeScript app
└── specs/      Specs for Claude, numbered in order (NN-name.md)
```

## Backend

- **Stack:** Python, Flask, PostgreSQL
- **Libraries:** Flask-SQLAlchemy (ORM), Flask-Migrate (schema migrations), Flask-Cors, psycopg 3 (Postgres driver), python-dotenv
- **Layout:**
  - `wsgi.py` — entry point
  - `app/__init__.py` — `create_app()` application factory
  - `app/config.py` — configuration read from environment variables
  - `app/extensions.py` — `db`, `migrate`, `cors` instances
  - `app/models.py` — SQLAlchemy models
  - `app/routes.py` — `api` blueprint, mounted at `/api`
- **Configuration** (`.env`, see `.env.example`):
  - `DATABASE_URL` — default `postgresql+psycopg://postgres:postgres@localhost:5432/thebox`
  - `SECRET_KEY`
  - `CORS_ORIGINS` — default `http://localhost:5173`
- **Endpoints:**
  - `GET /api/health` — returns `{"status": "ok", "database": "ok" | "unavailable"}`
- **Run:** `flask run` (port 5000) from `backend/` with the virtualenv in `.venv` active

## Frontend

- **Stack:** Vite, React, TypeScript
- **Dev server:** `npm run dev` (port 5173); requests to `/api` are proxied to `http://localhost:5000`
- **Build:** `npm run build`

## Conventions

- All API routes live under `/api`.
- The frontend calls the API with relative `/api/...` URLs so the dev proxy applies.
- Schema changes go through Flask-Migrate migrations, not manual SQL.

## Not yet done

- No database models or migrations
- No authentication
- Frontend is still the default Vite template and does not call the API
- No tests, linting setup or CI for the backend
- No Docker or deployment configuration
