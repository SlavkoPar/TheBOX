# --- Build the frontend ---
FROM node:22-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Backend image, serving the API and the built frontend ---
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FLASK_APP=wsgi.py \
    FRONTEND_DIST=/app/frontend-dist \
    PORT=10000

WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=frontend /frontend/dist ./frontend-dist

RUN useradd --create-home appuser
USER appuser

EXPOSE 10000
# Apply migrations, then start the server. (Render's preDeployCommand is not
# available on the free plan, so migrations run at container start.)
CMD ["sh", "-c", "flask db upgrade && exec gunicorn --bind 0.0.0.0:${PORT} --workers 2 --access-logfile - wsgi:app"]
