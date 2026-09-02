FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.docker.txt /tmp/requirements.docker.txt
COPY backend/Trade_Bot/requirements.txt /tmp/requirements.bot.txt

RUN python -m pip install --upgrade pip && \
    pip install --no-cache-dir \
      -r /tmp/requirements.docker.txt \
      -r /tmp/requirements.bot.txt

COPY backend /app/backend

ENV PYTHONPATH=/app/backend
WORKDIR /app/backend

CMD ["uvicorn", "API.API_setup:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
