# Build context: repo root (see docker-compose.yml) so docs/mocks can be baked in.
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MOCKS_DIR=/app/mocks DB_PATH=/data/cosign.db
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY api/app ./app
COPY docs/mocks ./mocks
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
