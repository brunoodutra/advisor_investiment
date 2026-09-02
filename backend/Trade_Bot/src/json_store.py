import fcntl
import json
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path


def _as_path(path) -> Path:
    return path if isinstance(path, Path) else Path(path)


def _copy_default(default):
    if isinstance(default, dict):
        return dict(default)
    if isinstance(default, list):
        return list(default)
    return default


@contextmanager
def file_lock(path, exclusive=True):
    target = _as_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    lock_path = target.with_suffix(target.suffix + ".lock")
    fd = open(lock_path, "a+", encoding="utf-8")
    try:
        fcntl.flock(fd.fileno(), fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
        yield
    finally:
        fcntl.flock(fd.fileno(), fcntl.LOCK_UN)
        fd.close()


def _read_unlocked(path: Path, default):
    if not path.exists():
        return _copy_default(default)
    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        if isinstance(default, dict) and not isinstance(payload, dict):
            return _copy_default(default)
        if isinstance(default, list) and not isinstance(payload, list):
            return _copy_default(default)
        return payload
    except (json.JSONDecodeError, OSError, TypeError):
        return _copy_default(default)


def _write_unlocked(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def load_json(path, default):
    target = _as_path(path)
    with file_lock(target, exclusive=False):
        return _read_unlocked(target, default)


def save_json(path, data):
    target = _as_path(path)
    with file_lock(target, exclusive=True):
        _write_unlocked(target, data)


@contextmanager
def update_json(path, default):
    target = _as_path(path)
    with file_lock(target, exclusive=True):
        data = _read_unlocked(target, default)
        yield data
        _write_unlocked(target, data)
