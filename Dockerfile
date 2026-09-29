FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements-servidor.txt .
RUN pip install --no-cache-dir -r requirements-servidor.txt
COPY . .
# Una sola instancia (--max-instances 1): el espejo de Firestore y el estado
# del rastreo viven en memoria.
CMD exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers
