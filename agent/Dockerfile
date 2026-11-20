FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir "livekit-agents[deepgram]==1.8.11" "openai==3.50.0" "httpx==0.28.1"
COPY tavio_assistant ./tavio_assistant
# Unhealthy once the worker has lost LiveKit for more than 30 s (livekit-agents' own endpoint).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8081/', timeout=4)"]
# Prints nothing it hears: transcripts stay in memory for summaries only.
CMD ["python", "-m", "tavio_assistant.main", "start"]
