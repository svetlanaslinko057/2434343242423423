"""
Gunicorn config for production runtime (Этап 2).

Used by:  gunicorn -c /app/backend/gunicorn_conf.py server:app

Why gunicorn instead of plain uvicorn:
  • Multi-worker process model — one OOM/crash doesn't kill the whole pod.
  • Graceful restarts on SIGHUP (zero-downtime config reload).
  • Slow-client protection (uvicorn's defaults can be hostile to mobile networks).

Note for preview: the platform supervisor still uses
    uvicorn server:app --workers 1 --reload
because preview wants hot-reload on file change. Production should switch to
this config; the application code is ready (lazy ML, proper healthchecks,
no in-memory state that breaks across workers).
"""
import multiprocessing
import os

# Bind
bind = os.getenv("GUNICORN_BIND", "0.0.0.0:8001")

# Workers — 4 is a sane default for a small pod (~2 CPU, ~2 GB RAM).
# Each uvicorn worker is async, so a single worker handles many concurrent
# connections; 4 gives us headroom for CPU-bound work (Mongo encode, AI calls).
workers = int(os.getenv("GUNICORN_WORKERS", "4"))
worker_class = "uvicorn.workers.UvicornWorker"

# Timeouts — keep generous for AI/LLM endpoints which can be slow.
timeout = int(os.getenv("GUNICORN_TIMEOUT", "120"))
graceful_timeout = 30
keepalive = 5

# Restart workers periodically to mitigate any slow memory leaks (PyTorch +
# sentence-transformers can grow; this re-loads the model after `max_requests`).
max_requests = int(os.getenv("GUNICORN_MAX_REQUESTS", "1000"))
max_requests_jitter = 100

# Logging
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info").lower()
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(L)s'

# Process naming
proc_name = "atlas-devos-api"

# Pre-fork hook: skip heavy imports (lazy ML stays lazy)
def when_ready(server):
    server.log.info("ATLAS DevOS — gunicorn ready (%d workers)", workers)

def post_fork(server, worker):
    server.log.info("ATLAS DevOS — worker %s spawned", worker.pid)
