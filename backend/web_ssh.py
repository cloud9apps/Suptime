"""Browser → WebSocket → paramiko interactive shell bridge."""
from __future__ import annotations

import asyncio
import io
import json
import logging
import re
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger("sentinel.ssh")


def load_pkey(private_key: str):
    import paramiko  # type: ignore
    for KeyCls in (paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey, paramiko.DSSKey):
        try:
            return KeyCls.from_private_key(io.StringIO(private_key))
        except Exception:
            continue
    raise ValueError("Unsupported or malformed private key")


def parse_vault_host(url: str | None, username: str | None) -> tuple[str, int, str | None]:
    """Accept 'ssh://user@host:2222', 'user@host', 'host:22' or 'host'."""
    raw = (url or "").strip()
    raw = re.sub(r"^ssh://", "", raw, flags=re.I)
    user = username
    if "@" in raw:
        user, raw = raw.rsplit("@", 1)
    port = 22
    if ":" in raw:
        raw, p = raw.rsplit(":", 1)
        if p.isdigit():
            port = int(p)
    return raw, port, user


def _open_shell(cfg: dict[str, Any], cols: int, rows: int):
    import paramiko  # type: ignore
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kwargs: dict[str, Any] = {
        "hostname": cfg["host"], "port": int(cfg.get("port") or 22),
        "username": cfg["username"], "timeout": 12, "banner_timeout": 12,
        "auth_timeout": 12, "look_for_keys": False, "allow_agent": False,
    }
    if cfg.get("private_key"):
        kwargs["pkey"] = load_pkey(cfg["private_key"])
        if cfg.get("password"):
            kwargs["passphrase"] = cfg["password"]
    else:
        kwargs["password"] = cfg.get("password") or ""
    client.connect(**kwargs)
    chan = client.invoke_shell(term="xterm-256color", width=cols, height=rows)
    chan.settimeout(0.0)
    return client, chan


async def run_ssh_session(ws: WebSocket, cfg: dict[str, Any], cols: int, rows: int) -> None:
    """cfg: {host, port, username, password?, private_key?}. ws already accepted."""
    try:
        client, chan = await asyncio.to_thread(_open_shell, cfg, cols, rows)
    except Exception as e:
        await ws.send_text(json.dumps({"type": "error", "message": f"SSH connect failed: {e}"[:400]}))
        return
    await ws.send_text(json.dumps({"type": "ready", "host": cfg["host"], "username": cfg["username"]}))

    async def pump_out():
        try:
            while True:
                if chan.closed or chan.exit_status_ready() and not chan.recv_ready():
                    break
                if chan.recv_ready():
                    data = chan.recv(32768)
                    if not data:
                        break
                    await ws.send_bytes(data)
                else:
                    await asyncio.sleep(0.02)
        except Exception as e:
            logger.info(f"ssh pump_out ended: {e}")
        finally:
            try:
                await ws.send_text(json.dumps({"type": "closed"}))
            except Exception:
                pass

    out_task = asyncio.create_task(pump_out())
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if msg.get("bytes"):
                chan.send(msg["bytes"])
                continue
            text = msg.get("text")
            if not text:
                continue
            try:
                m = json.loads(text)
            except ValueError:
                chan.send(text.encode())
                continue
            if m.get("type") == "input":
                chan.send(m.get("data", "").encode())
            elif m.get("type") == "resize":
                try:
                    chan.resize_pty(width=int(m.get("cols", 80)), height=int(m.get("rows", 24)))
                except Exception:
                    pass
    except Exception as e:
        logger.info(f"ssh session ended: {e}")
    finally:
        out_task.cancel()
        try:
            chan.close()
            client.close()
        except Exception:
            pass
