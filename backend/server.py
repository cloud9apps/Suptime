"""Sentinel Server Monitor — main FastAPI app."""
from __future__ import annotations

import asyncio
import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from fastapi import Depends, FastAPI, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

from auth import build_router as build_auth_router, seed_admin
from email_service import (
    build_domain_expiry_email,
    build_server_down_email,
    build_ssl_expiry_email,
    fire_webhook,
    send_alert_email,
)
from monitor import (
    check_domain_whois,
    check_ssl_cert,
    fetch_ssh_metrics,
    run_check,
)

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("sentinel")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Sentinel Server Monitor")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

auth_router = build_auth_router(db)
app.include_router(auth_router)
get_current_user = auth_router.dependencies_get_current_user  # type: ignore[attr-defined]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


# =========================================================================
# Models
# =========================================================================

class ServerIn(BaseModel):
    name: str
    check_kind: str = Field(..., description="http|https|ping|tcp")
    target: str
    interval_seconds: int = 300
    notes: Optional[str] = None
    tags: list[str] = []
    ssh_enabled: bool = False
    ssh_host: Optional[str] = None
    ssh_port: int = 22
    ssh_username: Optional[str] = None
    ssh_password: Optional[str] = None
    ssh_private_key: Optional[str] = None
    agent_enabled: bool = False


class DomainIn(BaseModel):
    domain: str
    track_ssl: bool = True
    track_whois: bool = True
    notes: Optional[str] = None


class CredentialIn(BaseModel):
    category: str
    name: str
    url: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    api_key: Optional[str] = None
    ssh_key: Optional[str] = None
    notes: Optional[str] = None
    tags: list[str] = []


class NoteIn(BaseModel):
    title: str
    content: str
    tags: list[str] = []


class NotificationSettingsIn(BaseModel):
    email_enabled: bool = False
    email_recipient: Optional[str] = None
    webhook_enabled: bool = False
    webhook_url: Optional[str] = None
    ssl_warn_days: int = 14
    domain_warn_days: int = 30


class AgentMetricsIn(BaseModel):
    server_id: str
    agent_token: str
    cpu_percent: Optional[float] = None
    mem_percent: Optional[float] = None
    disk_percent: Optional[float] = None
    load_avg: Optional[list[float]] = None
    uptime: Optional[str] = None


# =========================================================================
# Helpers
# =========================================================================

async def _get_notification_settings() -> dict:
    doc = await db.settings.find_one({"_id": "notifications"}) or {}
    doc.pop("_id", None)
    return {
        "email_enabled": doc.get("email_enabled", False),
        "email_recipient": doc.get("email_recipient"),
        "webhook_enabled": doc.get("webhook_enabled", False),
        "webhook_url": doc.get("webhook_url"),
        "ssl_warn_days": doc.get("ssl_warn_days", 14),
        "domain_warn_days": doc.get("domain_warn_days", 30),
    }


async def _dispatch_alert(kind: str, subject: str, html: str, payload: dict) -> None:
    settings = await _get_notification_settings()
    if settings["email_enabled"] and settings["email_recipient"]:
        try:
            await send_alert_email(settings["email_recipient"], subject, html)
        except Exception as e:
            logger.error(f"Alert email failed: {e}")
    if settings["webhook_enabled"] and settings["webhook_url"]:
        try:
            await fire_webhook(settings["webhook_url"],
                               {"kind": kind, "subject": subject, **payload})
        except Exception as e:
            logger.error(f"Webhook failed: {e}")


async def _log_activity(kind: str, message: str, level: str = "info",
                        meta: Optional[dict] = None) -> None:
    await db.activity.insert_one({
        "id": new_id(),
        "kind": kind,
        "level": level,
        "message": message,
        "meta": meta or {},
        "created_at": now_iso(),
    })


async def _clean_server_doc(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


# =========================================================================
# Servers
# =========================================================================

@app.post("/api/servers")
async def create_server(body: ServerIn, user: dict = Depends(get_current_user)):
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["last_status"] = "unknown"
    doc["last_checked_at"] = None
    doc["last_latency_ms"] = None
    doc["last_error"] = None
    doc["uptime_pct_24h"] = None
    if doc.get("agent_enabled"):
        doc["agent_token"] = secrets.token_urlsafe(24)
    await db.servers.insert_one(doc)
    return await _clean_server_doc(doc)


@app.get("/api/servers")
async def list_servers(user: dict = Depends(get_current_user)):
    servers = await db.servers.find({}, {"_id": 0}).to_list(1000)
    return servers


@app.get("/api/servers/{server_id}")
async def get_server(server_id: str, user: dict = Depends(get_current_user)):
    s = await db.servers.find_one({"id": server_id}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Server not found")
    return s


@app.put("/api/servers/{server_id}")
async def update_server(server_id: str, body: ServerIn,
                        user: dict = Depends(get_current_user)):
    existing = await db.servers.find_one({"id": server_id})
    if not existing:
        raise HTTPException(404, "Server not found")
    update = body.model_dump()
    if update.get("agent_enabled") and not existing.get("agent_token"):
        update["agent_token"] = secrets.token_urlsafe(24)
    await db.servers.update_one({"id": server_id}, {"$set": update})
    s = await db.servers.find_one({"id": server_id}, {"_id": 0})
    return s


@app.delete("/api/servers/{server_id}")
async def delete_server(server_id: str, user: dict = Depends(get_current_user)):
    await db.servers.delete_one({"id": server_id})
    await db.checks.delete_many({"server_id": server_id})
    await db.metrics.delete_many({"server_id": server_id})
    return {"ok": True}


@app.post("/api/servers/{server_id}/check")
async def check_server_now(server_id: str, user: dict = Depends(get_current_user)):
    s = await db.servers.find_one({"id": server_id})
    if not s:
        raise HTTPException(404, "Server not found")
    result = await _run_server_check(s)
    return result


@app.get("/api/servers/{server_id}/history")
async def server_history(server_id: str, hours: int = 24,
                         user: dict = Depends(get_current_user)):
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    checks = await db.checks.find(
        {"server_id": server_id, "at": {"$gte": since}}, {"_id": 0}
    ).sort("at", 1).to_list(2000)
    metrics = await db.metrics.find(
        {"server_id": server_id, "at": {"$gte": since}}, {"_id": 0}
    ).sort("at", 1).to_list(2000)
    return {"checks": checks, "metrics": metrics}


@app.post("/api/servers/{server_id}/ssh-metrics")
async def ssh_metrics_now(server_id: str, user: dict = Depends(get_current_user)):
    s = await db.servers.find_one({"id": server_id})
    if not s:
        raise HTTPException(404, "Server not found")
    if not s.get("ssh_enabled") or not s.get("ssh_host") or not s.get("ssh_username"):
        raise HTTPException(400, "SSH not configured for this server")
    m = await fetch_ssh_metrics(
        s["ssh_host"], int(s.get("ssh_port", 22)), s["ssh_username"],
        password=s.get("ssh_password"), private_key=s.get("ssh_private_key"),
    )
    if m["ok"]:
        await db.metrics.insert_one({
            "id": new_id(), "server_id": server_id, "source": "ssh",
            "at": now_iso(), **{k: v for k, v in m.items() if k != "ok"},
        })
    return m


@app.post("/api/agent/metrics")
async def agent_push_metrics(body: AgentMetricsIn):
    """Lightweight agent endpoint. Auth via per-server token."""
    s = await db.servers.find_one({"id": body.server_id})
    if not s or not s.get("agent_token"):
        raise HTTPException(404, "Server not found")
    if not secrets.compare_digest(s["agent_token"], body.agent_token):
        raise HTTPException(401, "Invalid agent token")
    await db.metrics.insert_one({
        "id": new_id(), "server_id": body.server_id, "source": "agent",
        "at": now_iso(),
        "cpu_percent": body.cpu_percent, "mem_percent": body.mem_percent,
        "disk_percent": body.disk_percent, "load_avg": body.load_avg,
        "uptime": body.uptime, "error": None,
    })
    return {"ok": True}


async def _run_server_check(s: dict) -> dict:
    target = s["target"]
    if s["check_kind"] == "tcp" and ":" not in target:
        target = f"{target}:{s.get('port', 80)}"
    result = await run_check(s["check_kind"], target)
    at = now_iso()
    prev_status = s.get("last_status")
    new_status = "up" if result["ok"] else "down"
    await db.checks.insert_one({
        "id": new_id(), "server_id": s["id"], "at": at, **result,
    })
    # 24h uptime %
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    total = await db.checks.count_documents({"server_id": s["id"], "at": {"$gte": since}})
    ups = await db.checks.count_documents({"server_id": s["id"], "at": {"$gte": since}, "ok": True})
    uptime_pct = round(ups / total * 100.0, 2) if total else None
    await db.servers.update_one({"id": s["id"]}, {"$set": {
        "last_status": new_status,
        "last_checked_at": at,
        "last_latency_ms": result["latency_ms"],
        "last_error": result["error"],
        "uptime_pct_24h": uptime_pct,
    }})
    if prev_status == "up" and new_status == "down":
        subject, html = build_server_down_email(s["name"], target, result["error"] or "")
        await _dispatch_alert("server_down", subject, html,
                              {"server_id": s["id"], "name": s["name"],
                               "target": target, "error": result["error"]})
        await _log_activity("server_down",
                            f"{s['name']} went DOWN ({result['error']})",
                            level="error", meta={"server_id": s["id"]})
    elif prev_status == "down" and new_status == "up":
        await _log_activity("server_up",
                            f"{s['name']} is back UP",
                            level="success", meta={"server_id": s["id"]})
    return {**result, "server_id": s["id"], "at": at,
            "uptime_pct_24h": uptime_pct}


# =========================================================================
# Domains + SSL
# =========================================================================

@app.post("/api/domains")
async def create_domain(body: DomainIn, user: dict = Depends(get_current_user)):
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["ssl"] = None
    doc["whois"] = None
    doc["last_checked_at"] = None
    await db.domains.insert_one(doc)
    doc.pop("_id", None)
    # Kick off first check async
    asyncio.create_task(_run_domain_check(doc))
    return doc


@app.get("/api/domains")
async def list_domains(user: dict = Depends(get_current_user)):
    return await db.domains.find({}, {"_id": 0}).to_list(1000)


@app.delete("/api/domains/{domain_id}")
async def delete_domain(domain_id: str, user: dict = Depends(get_current_user)):
    await db.domains.delete_one({"id": domain_id})
    return {"ok": True}


@app.post("/api/domains/{domain_id}/check")
async def check_domain_now(domain_id: str, user: dict = Depends(get_current_user)):
    d = await db.domains.find_one({"id": domain_id})
    if not d:
        raise HTTPException(404, "Domain not found")
    return await _run_domain_check(d)


async def _run_domain_check(d: dict) -> dict:
    ssl_info = None
    whois_info = None
    settings = await _get_notification_settings()
    if d.get("track_ssl"):
        ssl_info = await asyncio.to_thread(check_ssl_cert, d["domain"])
        if ssl_info["ok"] and ssl_info["days_remaining"] is not None:
            days = ssl_info["days_remaining"]
            if 0 <= days <= settings["ssl_warn_days"]:
                subject, html = build_ssl_expiry_email(
                    d["domain"], days, ssl_info["valid_until"] or "")
                await _dispatch_alert("ssl_expiring", subject, html,
                                      {"domain": d["domain"],
                                       "days_remaining": days})
                await _log_activity("ssl_expiring",
                                    f"SSL for {d['domain']} expires in {days}d",
                                    level="warning")
    if d.get("track_whois"):
        whois_info = await asyncio.to_thread(check_domain_whois, d["domain"])
        if whois_info["ok"] and whois_info["days_remaining"] is not None:
            days = whois_info["days_remaining"]
            if 0 <= days <= settings["domain_warn_days"]:
                subject, html = build_domain_expiry_email(
                    d["domain"], days, whois_info["expires_at_iso"] or "")
                await _dispatch_alert("domain_expiring", subject, html,
                                      {"domain": d["domain"],
                                       "days_remaining": days})
                await _log_activity("domain_expiring",
                                    f"Domain {d['domain']} expires in {days}d",
                                    level="warning")
    at = now_iso()
    await db.domains.update_one({"id": d["id"]}, {"$set": {
        "ssl": ssl_info, "whois": whois_info, "last_checked_at": at,
    }})
    return {"ssl": ssl_info, "whois": whois_info, "at": at}


# =========================================================================
# Credentials Vault
# =========================================================================

@app.post("/api/credentials")
async def create_credential(body: CredentialIn, user: dict = Depends(get_current_user)):
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    await db.credentials.insert_one(doc)
    doc.pop("_id", None)
    return doc


@app.get("/api/credentials")
async def list_credentials(user: dict = Depends(get_current_user)):
    return await db.credentials.find({}, {"_id": 0}).to_list(1000)


@app.put("/api/credentials/{cred_id}")
async def update_credential(cred_id: str, body: CredentialIn,
                            user: dict = Depends(get_current_user)):
    update = body.model_dump()
    update["updated_at"] = now_iso()
    r = await db.credentials.update_one({"id": cred_id}, {"$set": update})
    if not r.matched_count:
        raise HTTPException(404, "Credential not found")
    c = await db.credentials.find_one({"id": cred_id}, {"_id": 0})
    return c


@app.delete("/api/credentials/{cred_id}")
async def delete_credential(cred_id: str, user: dict = Depends(get_current_user)):
    await db.credentials.delete_one({"id": cred_id})
    return {"ok": True}


# =========================================================================
# Notes
# =========================================================================

@app.post("/api/notes")
async def create_note(body: NoteIn, user: dict = Depends(get_current_user)):
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    await db.notes.insert_one(doc)
    doc.pop("_id", None)
    return doc


@app.get("/api/notes")
async def list_notes(user: dict = Depends(get_current_user)):
    return await db.notes.find({}, {"_id": 0}).sort("updated_at", -1).to_list(1000)


@app.put("/api/notes/{note_id}")
async def update_note(note_id: str, body: NoteIn,
                      user: dict = Depends(get_current_user)):
    update = body.model_dump()
    update["updated_at"] = now_iso()
    r = await db.notes.update_one({"id": note_id}, {"$set": update})
    if not r.matched_count:
        raise HTTPException(404, "Note not found")
    n = await db.notes.find_one({"id": note_id}, {"_id": 0})
    return n


@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: str, user: dict = Depends(get_current_user)):
    await db.notes.delete_one({"id": note_id})
    return {"ok": True}


# =========================================================================
# Settings + Activity + Dashboard
# =========================================================================

@app.get("/api/settings/notifications")
async def get_settings(user: dict = Depends(get_current_user)):
    return await _get_notification_settings()


@app.put("/api/settings/notifications")
async def put_settings(body: NotificationSettingsIn,
                       user: dict = Depends(get_current_user)):
    doc = body.model_dump()
    await db.settings.update_one(
        {"_id": "notifications"}, {"$set": doc}, upsert=True
    )
    return doc


@app.post("/api/settings/notifications/test")
async def test_notifications(user: dict = Depends(get_current_user)):
    settings = await _get_notification_settings()
    email_ok = False
    webhook_ok = False
    if settings["email_enabled"] and settings["email_recipient"]:
        try:
            eid = await send_alert_email(
                settings["email_recipient"],
                "[Sentinel] Test alert",
                '<table role="presentation" width="100%" style="font-family:Arial,sans-serif;'
                'background:#050505;color:#F3F4F6"><tr><td style="padding:24px">'
                '<h2 style="margin:0 0 12px 0;color:#00FF66">Test alert</h2>'
                '<p>If you see this, your Sentinel email alerts are working.</p>'
                '<p style="font-size:12px;color:#888">Sent by Sentinel Monitor.</p>'
                '</td></tr></table>',
            )
            email_ok = bool(eid)
        except Exception as e:
            logger.error(f"Test email failed: {e}")
    if settings["webhook_enabled"] and settings["webhook_url"]:
        webhook_ok = await fire_webhook(
            settings["webhook_url"],
            {"kind": "test", "message": "Sentinel test webhook"},
        )
    return {"email_ok": email_ok, "webhook_ok": webhook_ok}


@app.get("/api/activity")
async def get_activity(limit: int = 100, user: dict = Depends(get_current_user)):
    return await db.activity.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)


@app.get("/api/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    servers = await db.servers.find({}, {"_id": 0}).to_list(1000)
    domains = await db.domains.find({}, {"_id": 0}).to_list(1000)
    up = sum(1 for s in servers if s.get("last_status") == "up")
    down = sum(1 for s in servers if s.get("last_status") == "down")
    unknown = sum(1 for s in servers if s.get("last_status") not in ("up", "down"))
    settings = await _get_notification_settings()
    ssl_warn = 0
    ssl_expired = 0
    domain_warn = 0
    domain_expired = 0
    for d in domains:
        s_ssl = d.get("ssl") or {}
        s_who = d.get("whois") or {}
        if s_ssl.get("days_remaining") is not None:
            dr = s_ssl["days_remaining"]
            if dr < 0:
                ssl_expired += 1
            elif dr <= settings["ssl_warn_days"]:
                ssl_warn += 1
        if s_who.get("days_remaining") is not None:
            dr = s_who["days_remaining"]
            if dr < 0:
                domain_expired += 1
            elif dr <= settings["domain_warn_days"]:
                domain_warn += 1
    return {
        "servers": {"total": len(servers), "up": up, "down": down, "unknown": unknown},
        "domains": {
            "total": len(domains),
            "ssl_warn": ssl_warn, "ssl_expired": ssl_expired,
            "domain_warn": domain_warn, "domain_expired": domain_expired,
        },
    }


@app.get("/api/health")
async def health():
    return {"ok": True, "at": now_iso()}


# =========================================================================
# Scheduler
# =========================================================================

_scheduler_task: Optional[asyncio.Task] = None


async def _scheduler_loop():
    logger.info("Sentinel scheduler started.")
    while True:
        try:
            now = datetime.now(timezone.utc)
            # Server checks
            servers = await db.servers.find({}, {"_id": 0}).to_list(1000)
            for s in servers:
                last = s.get("last_checked_at")
                interval = int(s.get("interval_seconds", 300))
                if not last:
                    due = True
                else:
                    try:
                        last_dt = datetime.fromisoformat(last)
                        due = (now - last_dt).total_seconds() >= interval
                    except Exception:
                        due = True
                if due:
                    try:
                        await _run_server_check(s)
                    except Exception as e:
                        logger.error(f"Check failed for {s.get('name')}: {e}")
                    # Auto SSH metrics if enabled — every 5 min minimum
                    if s.get("ssh_enabled") and s.get("ssh_host"):
                        try:
                            m = await fetch_ssh_metrics(
                                s["ssh_host"], int(s.get("ssh_port", 22)),
                                s["ssh_username"],
                                password=s.get("ssh_password"),
                                private_key=s.get("ssh_private_key"),
                            )
                            if m["ok"]:
                                await db.metrics.insert_one({
                                    "id": new_id(), "server_id": s["id"],
                                    "source": "ssh", "at": now_iso(),
                                    **{k: v for k, v in m.items() if k != "ok"},
                                })
                        except Exception as e:
                            logger.error(f"SSH metrics failed for {s.get('name')}: {e}")

            # Domain / SSL checks — once every 6h
            domains = await db.domains.find({}, {"_id": 0}).to_list(1000)
            for d in domains:
                last = d.get("last_checked_at")
                due = True
                if last:
                    try:
                        last_dt = datetime.fromisoformat(last)
                        due = (now - last_dt).total_seconds() >= 6 * 3600
                    except Exception:
                        due = True
                if due:
                    try:
                        await _run_domain_check(d)
                    except Exception as e:
                        logger.error(f"Domain check failed for {d.get('domain')}: {e}")

            # Metrics retention — keep only 7 days
            cutoff = (now - timedelta(days=7)).isoformat()
            await db.checks.delete_many({"at": {"$lt": cutoff}})
            await db.metrics.delete_many({"at": {"$lt": cutoff}})
            await db.activity.delete_many({"created_at": {"$lt": cutoff}})
        except Exception as e:
            logger.error(f"Scheduler error: {e}")
        await asyncio.sleep(30)


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.servers.create_index("id", unique=True)
    await db.domains.create_index("id", unique=True)
    await db.credentials.create_index("id", unique=True)
    await db.notes.create_index("id", unique=True)
    await db.checks.create_index([("server_id", 1), ("at", -1)])
    await db.metrics.create_index([("server_id", 1), ("at", -1)])
    await db.activity.create_index([("created_at", -1)])
    await seed_admin(db)
    global _scheduler_task
    _scheduler_task = asyncio.create_task(_scheduler_loop())


@app.on_event("shutdown")
async def on_shutdown():
    global _scheduler_task
    if _scheduler_task:
        _scheduler_task.cancel()
    client.close()
