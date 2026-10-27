# Stage 1: build the React frontend
FROM node:22-slim AS frontend-builder

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/index.html frontend/vite.config.js ./
COPY frontend/src ./src
RUN npm run build

# Stage 2: Python runtime serving the API and the built frontend
FROM python:3.13-slim

LABEL org.opencontainers.image.title="ProofPath AI" \
      org.opencontainers.image.description="Community reporting with optional Modal-hosted AI"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PROOFPATH_DATA_DIR=/data

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt \
    && mkdir -p /data \
    && useradd --system --uid 10001 --home-dir /app proofpath \
    && chown -R proofpath:proofpath /app /data

COPY --chown=proofpath:proofpath . .
COPY --from=frontend-builder --chown=proofpath:proofpath /build/dist ./frontend/dist
USER proofpath
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
