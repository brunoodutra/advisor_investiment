FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    libstdc++6 \
    libfreetype6 \
    libpng16-16 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/AI/Classification/requirements.txt /tmp/requirements.ai.txt

RUN python -m pip install --upgrade pip && \
    pip install --no-cache-dir -r /tmp/requirements.ai.txt

COPY backend /app/backend

ENV PYTHONPATH=/app/backend
WORKDIR /app/backend

CMD ["python", "-u", "AI/Classification/Real_Time_Inference/classification_in_produtction.py"]
