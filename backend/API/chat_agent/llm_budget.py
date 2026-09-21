import os
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, List

_API_DIR = Path(__file__).resolve().parent.parent
_LLM_LOCK_DIR = _API_DIR / "cache"
_DEFAULT_MAX_CONCURRENT = 2

_max_concurrent = max(1, int(os.getenv("LLM_MAX_CONCURRENT", str(_DEFAULT_MAX_CONCURRENT))))
_thread_semaphore = threading.BoundedSemaphore(_max_concurrent)


def _ensure_slot_files() -> List[Path]:
    _LLM_LOCK_DIR.mkdir(parents=True, exist_ok=True)
    return [_LLM_LOCK_DIR / f"llm.lock.{idx}" for idx in range(_max_concurrent)]


@contextmanager
def llm_slot():
    """Acquire one LLM concurrency slot (in-process + cross-process via file locks)."""
    import fcntl
    import time

    _thread_semaphore.acquire()
    paths = _ensure_slot_files()
    fd = None
    try:
        # Busy-wait across slots with short sleeps so we don't hold a global exclusive lock
        # during long LLM calls from other processes beyond the configured concurrency.
        while True:
            for path in paths:
                candidate = open(path, "a+", encoding="utf-8")
                try:
                    fcntl.flock(candidate.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    fd = candidate
                    break
                except BlockingIOError:
                    candidate.close()
            if fd is not None:
                break
            time.sleep(0.05)
        yield
    finally:
        if fd is not None:
            try:
                fcntl.flock(fd.fileno(), fcntl.LOCK_UN)
            finally:
                fd.close()
        _thread_semaphore.release()


# Back-compat alias
llm_lock = llm_slot


def invoke_llm(llm_client: Any, messages: Any, **kwargs) -> str:
    """Pass-through textual; prefer complete_llm for tool calling."""
    with llm_slot():
        return llm_client.invoke(messages, **kwargs)


def complete_llm(llm_client: Any, messages: Any, **kwargs: Any) -> Any:
    """Acquire a concurrency slot only for the API call itself (not for outer sleeps)."""
    with llm_slot():
        return llm_client.complete(messages, **kwargs)
