import os
import uuid
from datetime import datetime, timezone

from .config import Config
from .json_store import load_json, update_json

COMMANDS_DEFAULT = []
VALID_TYPES = {"CLOSE_ALL", "CLOSE_SYMBOL", "SET_TPSL"}


def commands_path():
    return os.path.join(Config.DATA_DIR, "commands.json")


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def enqueue_command(command_type, symbol=None, payload=None, reason=None):
    command_type = str(command_type or "").upper()
    if command_type not in VALID_TYPES:
        raise ValueError(f"Tipo de comando inválido: {command_type}")

    command = {
        "id": str(uuid.uuid4()),
        "type": command_type,
        "symbol": symbol,
        "payload": payload or {},
        "reason": reason,
        "status": "pending",
        "created_at": _now_iso(),
        "processed_at": None,
        "result": None,
        "error": None,
    }
    with update_json(commands_path(), COMMANDS_DEFAULT) as commands:
        commands.append(command)
    return command


def list_commands():
    return load_json(commands_path(), COMMANDS_DEFAULT)


def claim_pending_commands():
    claimed = []
    with update_json(commands_path(), COMMANDS_DEFAULT) as commands:
        for cmd in commands:
            if cmd.get("status") == "pending":
                cmd["status"] = "processing"
                claimed.append(dict(cmd))
    return claimed


def finish_command(command_id, result=None, error=None):
    with update_json(commands_path(), COMMANDS_DEFAULT) as commands:
        for cmd in commands:
            if cmd.get("id") == command_id:
                cmd["status"] = "error" if error else "done"
                cmd["processed_at"] = _now_iso()
                cmd["result"] = result
                cmd["error"] = error
                return dict(cmd)
    return None
