"""Uptime / SSL / Domain / performance monitoring helpers."""
from __future__ import annotations

import asyncio
import socket
import ssl
import subprocess
from datetime import datetime, timezone
from typing import Any

import httpx


async def check_http(url: str, timeout: float = 10.0) -> dict[str, Any]:
    started = datetime.now(timezone.utc)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.get(url)
        latency_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
        ok = 200 <= resp.status_code < 400
        return {
            "ok": ok,
            "status_code": resp.status_code,
            "latency_ms": latency_ms,
            "error": None if ok else f"HTTP {resp.status_code}",
        }
    except Exception as e:
        latency_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
        return {"ok": False, "status_code": None, "latency_ms": latency_ms,
                "error": str(e)[:200]}


async def check_tcp(host: str, port: int, timeout: float = 5.0) -> dict[str, Any]:
    started = datetime.now(timezone.utc)
    try:
        fut = asyncio.open_connection(host, port)
        reader, writer = await asyncio.wait_for(fut, timeout=timeout)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        latency_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
        return {"ok": True, "status_code": None, "latency_ms": latency_ms, "error": None}
    except Exception as e:
        latency_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
        return {"ok": False, "status_code": None, "latency_ms": latency_ms,
                "error": str(e)[:200]}


async def check_ping(host: str, timeout: float = 3.0) -> dict[str, Any]:
    started = datetime.now(timezone.utc)
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping", "-c", "1", "-W", str(int(timeout)), host,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        rc = await asyncio.wait_for(proc.wait(), timeout=timeout + 2)
        latency_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
        return {"ok": rc == 0, "status_code": rc, "latency_ms": latency_ms,
                "error": None if rc == 0 else "ping failed"}
    except Exception as e:
        latency_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
        return {"ok": False, "status_code": None, "latency_ms": latency_ms,
                "error": str(e)[:200]}


async def run_check(kind: str, target: str) -> dict[str, Any]:
    """Dispatch a single check based on kind: http/https/ping/tcp:PORT."""
    if kind in ("http", "https"):
        url = target if target.startswith(("http://", "https://")) else f"{kind}://{target}"
        return await check_http(url)
    if kind == "ping":
        return await check_ping(target)
    if kind.startswith("tcp"):
        # target format: host:port  OR kind stores "tcp" + port in target "host:port"
        if ":" in target:
            host, port_s = target.rsplit(":", 1)
            try:
                port = int(port_s)
            except ValueError:
                return {"ok": False, "status_code": None, "latency_ms": 0,
                        "error": "Bad port"}
            return await check_tcp(host, port)
        return {"ok": False, "status_code": None, "latency_ms": 0,
                "error": "TCP target must be host:port"}
    return {"ok": False, "status_code": None, "latency_ms": 0,
            "error": f"Unknown check kind: {kind}"}


def check_ssl_cert(hostname: str, port: int = 443, timeout: float = 8.0) -> dict[str, Any]:
    """Sync SSL check — call from a thread."""
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((hostname, port), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=hostname) as ssock:
                cert = ssock.getpeercert()
        not_after = cert.get("notAfter")
        not_before = cert.get("notBefore")
        issuer_tuple = cert.get("issuer", ())
        issuer = ", ".join(
            f"{name}={value}"
            for row in issuer_tuple for (name, value) in row
        )
        expires_at = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z").replace(
            tzinfo=timezone.utc)
        days_remaining = (expires_at - datetime.now(timezone.utc)).days
        return {
            "ok": True,
            "issuer": issuer,
            "valid_from": not_before,
            "valid_until": not_after,
            "expires_at_iso": expires_at.isoformat(),
            "days_remaining": days_remaining,
            "error": None,
        }
    except Exception as e:
        return {"ok": False, "issuer": None, "valid_from": None,
                "valid_until": None, "expires_at_iso": None,
                "days_remaining": None, "error": str(e)[:200]}


def check_domain_whois(domain: str) -> dict[str, Any]:
    """Sync WHOIS lookup — call from a thread."""
    try:
        import whois  # type: ignore
        w = whois.whois(domain)
        expiry = w.expiration_date
        if isinstance(expiry, list):
            expiry = expiry[0] if expiry else None
        if expiry and expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        registrar = w.registrar
        if isinstance(registrar, list):
            registrar = registrar[0] if registrar else None
        days_remaining = None
        expires_at_iso = None
        if expiry:
            expires_at_iso = expiry.isoformat()
            days_remaining = (expiry - datetime.now(timezone.utc)).days
        return {
            "ok": expiry is not None,
            "registrar": registrar,
            "expires_at_iso": expires_at_iso,
            "days_remaining": days_remaining,
            "error": None if expiry else "No expiry data returned",
        }
    except Exception as e:
        return {"ok": False, "registrar": None, "expires_at_iso": None,
                "days_remaining": None, "error": str(e)[:200]}


async def fetch_ssh_metrics(host: str, port: int, username: str,
                            password: str | None = None,
                            private_key: str | None = None,
                            timeout: float = 10.0) -> dict[str, Any]:
    """Fetch CPU / MEM / DISK via SSH. Runs paramiko in a thread."""
    def _run() -> dict[str, Any]:
        try:
            import paramiko  # type: ignore
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            kwargs: dict[str, Any] = {
                "hostname": host, "port": port, "username": username,
                "timeout": timeout, "banner_timeout": timeout,
                "auth_timeout": timeout, "look_for_keys": False,
                "allow_agent": False,
            }
            if private_key:
                import io
                pk_stream = io.StringIO(private_key)
                for KeyCls in (paramiko.Ed25519Key, paramiko.RSAKey,
                               paramiko.ECDSAKey, paramiko.DSSKey):
                    try:
                        pk_stream.seek(0)
                        kwargs["pkey"] = KeyCls.from_private_key(pk_stream)
                        break
                    except Exception:
                        continue
            elif password:
                kwargs["password"] = password
            client.connect(**kwargs)
            cmd = (
                "echo '===CPU==='; "
                "top -bn1 | grep -E '^%?Cpu' | head -1; "
                "echo '===MEM==='; free -m; "
                "echo '===DISK==='; df -h /; "
                "echo '===LOAD==='; cat /proc/loadavg; "
                "echo '===UPTIME==='; uptime -p"
            )
            _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
            out = stdout.read().decode("utf-8", errors="ignore")
            err = stderr.read().decode("utf-8", errors="ignore")
            client.close()
            return _parse_metrics(out, err)
        except Exception as e:
            return {"ok": False, "error": str(e)[:200],
                    "cpu_percent": None, "mem_percent": None,
                    "disk_percent": None, "load_avg": None, "uptime": None}
    return await asyncio.to_thread(_run)


def _parse_metrics(out: str, err: str) -> dict[str, Any]:
    sections: dict[str, list[str]] = {}
    current = None
    for line in out.splitlines():
        if line.startswith("===") and line.endswith("==="):
            current = line.strip("=").strip()
            sections[current] = []
        elif current:
            sections[current].append(line)

    cpu = mem = disk = None
    load = uptime = None
    try:
        cpu_line = " ".join(sections.get("CPU", []))
        # "%Cpu(s):  1.2 us,  0.3 sy, ..."
        if "id" in cpu_line:
            parts = cpu_line.split(",")
            for p in parts:
                if "id" in p:
                    idle = float(p.strip().split()[0])
                    cpu = round(100.0 - idle, 1)
                    break
    except Exception:
        pass
    try:
        mem_lines = sections.get("MEM", [])
        for ln in mem_lines:
            if ln.lower().startswith("mem"):
                cols = ln.split()
                total = float(cols[1]); used = float(cols[2])
                mem = round(used / total * 100.0, 1)
                break
    except Exception:
        pass
    try:
        disk_lines = sections.get("DISK", [])
        for ln in disk_lines[1:]:
            cols = ln.split()
            if len(cols) >= 5 and cols[-1] == "/":
                disk = float(cols[4].rstrip("%"))
                break
        if disk is None and len(disk_lines) >= 2:
            cols = disk_lines[1].split()
            if len(cols) >= 5:
                disk = float(cols[4].rstrip("%"))
    except Exception:
        pass
    try:
        load_line = " ".join(sections.get("LOAD", []))
        load = load_line.strip().split()[:3] if load_line.strip() else None
    except Exception:
        pass
    try:
        uptime = " ".join(sections.get("UPTIME", [])).strip() or None
    except Exception:
        pass

    ok = any(v is not None for v in (cpu, mem, disk))
    return {"ok": ok, "error": err.strip()[:200] if not ok else None,
            "cpu_percent": cpu, "mem_percent": mem, "disk_percent": disk,
            "load_avg": load, "uptime": uptime}
