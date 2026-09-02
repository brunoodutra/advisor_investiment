import fcntl
from contextlib import contextmanager
from pathlib import Path
from typing import Any

_API_DIR = Path(__file__).resolve().parent.parent
_LLM_LOCK_PATH = _API_DIR / "cache" / "llm.lock"


@contextmanager
def llm_lock():
    _LLM_LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd = open(_LLM_LOCK_PATH, "a+", encoding="utf-8")
    try:
        fcntl.flock(fd.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd.fileno(), fcntl.LOCK_UN)
        fd.close()


def invoke_llm(llm_client: Any, prompt: str) -> str:
    with llm_lock():
        return llm_client.invoke(prompt)
