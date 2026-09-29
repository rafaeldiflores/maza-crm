# 1) Interfaz Angular
FROM node:24-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ .
RUN npx ng build

# 2) API FastAPI que además sirve la interfaz
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 CRM_WEB_DIR=/app/web
WORKDIR /app
COPY requirements-servidor.txt .
RUN pip install --no-cache-dir -r requirements-servidor.txt
COPY *.py ./
COPY static/ static/
COPY --from=web /web/dist/frontend/browser /app/web
# Una sola instancia (--max-instances 1): el espejo de Firestore y el estado
# del rastreo viven en memoria.
CMD exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers
