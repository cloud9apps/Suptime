"""Sentinel Server Monitor — main FastAPI app."""
from __future__ import annotations

import asyncio
import logging
import os
import re
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
    build_server_recovered_email,
    build_metric_high_email,
    build_metric_recovered_email,
    build_latency_high_email,
    build_digest_email,
    fire_webhook,
    send_alert_email,
    send_smtp_email,
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

class AlertOverrides(BaseModel):
    cpu_warn_pct: Optional[int] = None
    mem_warn_pct: Optional[int] = None
    disk_warn_pct: Optional[int] = None
    latency_warn_ms: Optional[int] = None


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
    public: bool = False
    alerts_muted: bool = False
    alert_overrides: AlertOverrides = AlertOverrides()


class DomainIn(BaseModel):
    domain: str
    track_ssl: bool = True
    track_whois: bool = True
    notes: Optional[str] = None
    public: bool = False


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


class WebhookEntry(BaseModel):
    id: Optional[str] = None
    name: str = ""
    url: str
    enabled: bool = True
    format: str = "json"


class CommentIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)


class SmtpConfig(BaseModel):
    enabled: bool = False
    host: Optional[str] = None
    port: int = 587
    username: Optional[str] = None
    password: Optional[str] = None
    from_email: Optional[str] = None
    use_tls: bool = True


class NotificationSettingsIn(BaseModel):
    email_enabled: bool = False
    email_recipient: Optional[str] = None
    webhooks: list[WebhookEntry] = []
    smtp: SmtpConfig = SmtpConfig()
    ssl_warn_days: int = 14
    domain_warn_days: int = 30
    cpu_warn_pct: int = 90
    mem_warn_pct: int = 90
    disk_warn_pct: int = 90
    latency_warn_ms: int = 3000
    digest_enabled: bool = False
    public_page_enabled: bool = False
    public_page_slug: Optional[str] = None
    public_page_title: str = "Sentinel Status"


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
    # Backfill from legacy single-webhook shape
    webhooks = doc.get("webhooks")
    if webhooks is None:
        legacy_url = doc.get("webhook_url")
        legacy_on = doc.get("webhook_enabled", False)
        webhooks = ([{"id": new_id(), "name": "default", "url": legacy_url,
                      "enabled": bool(legacy_on)}] if legacy_url else [])
    return {
        "email_enabled": doc.get("email_enabled", False),
        "email_recipient": doc.get("email_recipient"),
        "webhooks": webhooks,
        "smtp": doc.get("smtp") or {"enabled": False, "host": None, "port": 587,
                                    "username": None, "password": None,
                                    "from_email": None, "use_tls": True},
        "ssl_warn_days": doc.get("ssl_warn_days", 14),
        "domain_warn_days": doc.get("domain_warn_days", 30),
        "cpu_warn_pct": doc.get("cpu_warn_pct", 90),
        "mem_warn_pct": doc.get("mem_warn_pct", 90),
        "disk_warn_pct": doc.get("disk_warn_pct", 90),
        "latency_warn_ms": doc.get("latency_warn_ms", 3000),
        "digest_enabled": doc.get("digest_enabled", False),
        "public_page_enabled": doc.get("public_page_enabled", False),
        "public_page_slug": doc.get("public_page_slug"),
        "public_page_title": doc.get("public_page_title", "Sentinel Status"),
    }


async def _dispatch_alert(kind: str, subject: str, html: str, payload: dict,
                          server: Optional[dict] = None) -> None:
    if server and server.get("alerts_muted"):
        logger.info(f"Alert {kind} suppressed — {server.get('name')} is muted")
        return
    settings = await _get_notification_settings()
    if settings["email_enabled"] and settings["email_recipient"]:
        smtp = settings.get("smtp") or {}
        try:
            if smtp.get("enabled") and smtp.get("host"):
                await send_smtp_email(smtp, settings["email_recipient"], subject, html)
            else:
                await send_alert_email(settings["email_recipient"], subject, html)
        except Exception as e:
            logger.error(f"Alert email failed: {e}")
    for wh in settings.get("webhooks", []):
        if wh.get("enabled") and wh.get("url"):
            try:
                await fire_webhook(wh["url"], {"kind": kind, "subject": subject, **payload},
                                   wh.get("format") or "json")
            except Exception as e:
                logger.error(f"Webhook failed ({wh.get('name')}): {e}")


def _threshold(s: dict, settings: dict, key: str) -> int:
    ov = (s.get("alert_overrides") or {}).get(key)
    return int(ov if ov is not None else settings[key])


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
        await _check_metric_alerts(s, m)
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
    await _check_metric_alerts(s, {
        "cpu_percent": body.cpu_percent, "mem_percent": body.mem_percent,
        "disk_percent": body.disk_percent,
    })
    return {"ok": True}


async def _check_metric_alerts(s: dict, m: dict) -> None:
    """Fire alerts on high CPU / MEM / DISK, and recovery when back to normal."""
    settings = await _get_notification_settings()
    thresholds = {
        "cpu": _threshold(s, settings, "cpu_warn_pct"),
        "mem": _threshold(s, settings, "mem_warn_pct"),
        "disk": _threshold(s, settings, "disk_warn_pct"),
    }
    values = {
        "cpu": m.get("cpu_percent"),
        "mem": m.get("mem_percent"),
        "disk": m.get("disk_percent"),
    }
    state = s.get("alert_state") or {}
    updates: dict = {}
    for kind, thresh in thresholds.items():
        v = values[kind]
        if v is None:
            continue
        was_high = bool(state.get(f"high_{kind}"))
        is_high = v >= thresh
        if is_high and not was_high:
            subject, html = build_metric_high_email(s["name"], kind, v, thresh)
            await _dispatch_alert(f"high_{kind}", subject, html,
                                  {"server_id": s["id"], "name": s["name"],
                                   "metric": kind, "value": v, "threshold": thresh}, s)
            await _log_activity(f"high_{kind}",
                                f"{s['name']} {kind.upper()} at {v}% (≥{thresh}%)",
                                level="warning", meta={"server_id": s["id"]})
            updates[f"alert_state.high_{kind}"] = True
        elif was_high and not is_high:
            subject, html = build_metric_recovered_email(s["name"], kind, v)
            await _dispatch_alert(f"recovered_{kind}", subject, html,
                                  {"server_id": s["id"], "name": s["name"],
                                   "metric": kind, "value": v}, s)
            await _log_activity(f"recovered_{kind}",
                                f"{s['name']} {kind.upper()} normal at {v}%",
                                level="success", meta={"server_id": s["id"]})
            updates[f"alert_state.high_{kind}"] = False
    if updates:
        await db.servers.update_one({"id": s["id"]}, {"$set": updates})


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
                               "target": target, "error": result["error"]}, s)
        await _log_activity("server_down",
                            f"{s['name']} went DOWN ({result['error']})",
                            level="error", meta={"server_id": s["id"]})
    elif prev_status == "down" and new_status == "up":
        subject, html = build_server_recovered_email(s["name"], target)
        await _dispatch_alert("server_recovered", subject, html,
                              {"server_id": s["id"], "name": s["name"],
                               "target": target}, s)
        await _log_activity("server_up",
                            f"{s['name']} is back UP",
                            level="success", meta={"server_id": s["id"]})
    # Latency alert (only when up)
    if result["ok"] and result.get("latency_ms") is not None:
        settings = await _get_notification_settings()
        thresh = _threshold(s, settings, "latency_warn_ms")
        state = s.get("alert_state") or {}
        was_slow = bool(state.get("high_latency"))
        is_slow = result["latency_ms"] >= thresh
        if is_slow and not was_slow:
            subject, html = build_latency_high_email(s["name"], result["latency_ms"], thresh)
            await _dispatch_alert("high_latency", subject, html,
                                  {"server_id": s["id"], "name": s["name"],
                                   "latency_ms": result["latency_ms"],
                                   "threshold": thresh}, s)
            await _log_activity("high_latency",
                                f"{s['name']} latency {result['latency_ms']}ms (≥{thresh}ms)",
                                level="warning", meta={"server_id": s["id"]})
            await db.servers.update_one({"id": s["id"]},
                                        {"$set": {"alert_state.high_latency": True}})
        elif was_slow and not is_slow:
            await _log_activity("recovered_latency",
                                f"{s['name']} latency back to {result['latency_ms']}ms",
                                level="success", meta={"server_id": s["id"]})
            await db.servers.update_one({"id": s["id"]},
                                        {"$set": {"alert_state.high_latency": False}})
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
    # Ensure each webhook has an id
    for wh in doc.get("webhooks", []):
        if not wh.get("id"):
            wh["id"] = new_id()
    if doc.get("public_page_slug"):
        doc["public_page_slug"] = re.sub(
            r"[^a-z0-9-]", "", doc["public_page_slug"].lower())
    await db.settings.update_one(
        {"_id": "notifications"}, {"$set": doc}, upsert=True
    )
    return await _get_notification_settings()


@app.post("/api/settings/notifications/test")
async def test_notifications(user: dict = Depends(get_current_user)):
    settings = await _get_notification_settings()
    email_ok = False
    webhook_results = []
    test_subject = "[Sentinel] Test alert"
    test_html = (
        '<table role="presentation" width="100%" style="font-family:Arial,sans-serif;'
        'background:#050505;color:#F3F4F6"><tr><td style="padding:24px">'
        '<h2 style="margin:0 0 12px 0;color:#00FF66">Test alert</h2>'
        '<p>If you see this, your Sentinel email alerts are working.</p>'
        '<p style="font-size:12px;color:#888">Sent by Sentinel Monitor.</p>'
        '</td></tr></table>'
    )
    if settings["email_enabled"] and settings["email_recipient"]:
        smtp = settings.get("smtp") or {}
        try:
            if smtp.get("enabled") and smtp.get("host"):
                email_ok = await send_smtp_email(
                    smtp, settings["email_recipient"], test_subject, test_html)
            else:
                eid = await send_alert_email(
                    settings["email_recipient"], test_subject, test_html)
                email_ok = bool(eid)
        except Exception as e:
            logger.error(f"Test email failed: {e}")
    for wh in settings.get("webhooks", []):
        if wh.get("enabled") and wh.get("url"):
            ok = await fire_webhook(
                wh["url"], {"kind": "test", "subject": "Sentinel test alert",
                            "message": "Sentinel test webhook"},
                wh.get("format") or "json")
            webhook_results.append({"name": wh.get("name") or "webhook",
                                    "url": wh["url"], "format": wh.get("format") or "json",
                                    "ok": ok})
    return {"email_ok": email_ok, "webhook_results": webhook_results}


# =========================================================================
# Uptime history (7d / 30d bars)
# =========================================================================

@app.get("/api/uptime/history")
async def uptime_history(days: int = 30, user: dict = Depends(get_current_user)):
    """Per-server per-day uptime %."""
    days = max(1, min(days, 90))
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=days)).isoformat()
    servers = await db.servers.find({}, {"_id": 0}).to_list(1000)
    result: list[dict] = []
    for s in servers:
        pipeline = [
            {"$match": {"server_id": s["id"], "at": {"$gte": since}}},
            {"$group": {
                "_id": {"$substr": ["$at", 0, 10]},
                "total": {"$sum": 1},
                "ups": {"$sum": {"$cond": ["$ok", 1, 0]}},
            }},
        ]
        buckets = await db.checks.aggregate(pipeline).to_list(500)
        by_day = {b["_id"]: (b["ups"], b["total"]) for b in buckets}
        series = []
        for i in range(days - 1, -1, -1):
            d = (now - timedelta(days=i)).strftime("%Y-%m-%d")
            ups, total = by_day.get(d, (0, 0))
            pct = round(ups / total * 100.0, 2) if total else None
            series.append({"date": d, "pct": pct, "checks": total})
        result.append({"id": s["id"], "name": s["name"],
                       "last_status": s.get("last_status"), "series": series})
    return {"days": days, "servers": result}


# =========================================================================
# Public status page (unauthenticated)
# =========================================================================

@app.get("/api/public/status/{slug}")
async def public_status(slug: str):
    settings = await _get_notification_settings()
    if not settings.get("public_page_enabled"):
        raise HTTPException(404, "Status page not enabled")
    if (settings.get("public_page_slug") or "") != slug:
        raise HTTPException(404, "Status page not found")
    servers = await db.servers.find(
        {"public": True}, {"_id": 0, "ssh_password": 0, "ssh_private_key": 0,
                           "ssh_username": 0, "ssh_host": 0, "agent_token": 0,
                           "notes": 0},
    ).to_list(500)
    domains = await db.domains.find({"public": True}, {"_id": 0, "notes": 0}).to_list(500)
    # 7d uptime
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=7)).isoformat()
    for s in servers:
        total = await db.checks.count_documents({"server_id": s["id"], "at": {"$gte": since}})
        ups = await db.checks.count_documents(
            {"server_id": s["id"], "at": {"$gte": since}, "ok": True})
        s["uptime_pct_7d"] = round(ups / total * 100.0, 2) if total else None
    # Recent activity for public servers only
    public_server_ids = [s["id"] for s in servers]
    activity = await db.activity.find(
        {"kind": {"$in": ["server_down", "server_up", "ssl_expiring",
                          "domain_expiring", "high_cpu", "high_mem",
                          "high_disk", "high_latency", "server_recovered"]},
         "$or": [
             {"meta.server_id": {"$in": public_server_ids}},
             {"kind": {"$in": ["ssl_expiring", "domain_expiring"]}},
         ]},
        {"_id": 0},
    ).sort("created_at", -1).limit(20).to_list(20)
    for a in activity:
        a["comments"] = [{"id": c["id"], "text": c["text"], "created_at": c["created_at"]}
                         for c in (a.get("comments") or [])]
        a.pop("meta", None)
    return {
        "title": settings.get("public_page_title") or "Sentinel Status",
        "generated_at": now.isoformat(),
        "servers": servers,
        "domains": domains,
        "activity": activity,
    }


# =========================================================================
# Backup export / import
# =========================================================================

@app.get("/api/backup/export")
async def backup_export(user: dict = Depends(get_current_user)):
    servers = await db.servers.find({}, {"_id": 0}).to_list(2000)
    domains = await db.domains.find({}, {"_id": 0}).to_list(2000)
    credentials = await db.credentials.find({}, {"_id": 0}).to_list(2000)
    notes = await db.notes.find({}, {"_id": 0}).to_list(2000)
    settings = await _get_notification_settings()
    return {
        "version": 1,
        "exported_at": now_iso(),
        "servers": servers, "domains": domains,
        "credentials": credentials, "notes": notes,
        "settings": settings,
    }


class BackupImportIn(BaseModel):
    version: int = 1
    servers: list[dict] = []
    domains: list[dict] = []
    credentials: list[dict] = []
    notes: list[dict] = []
    settings: Optional[dict] = None
    replace: bool = False


@app.post("/api/backup/import")
async def backup_import(body: BackupImportIn,
                        user: dict = Depends(get_current_user)):
    if body.replace:
        await db.servers.delete_many({})
        await db.domains.delete_many({})
        await db.credentials.delete_many({})
        await db.notes.delete_many({})
    counts = {"servers": 0, "domains": 0, "credentials": 0, "notes": 0}
    for coll_name, items in (("servers", body.servers), ("domains", body.domains),
                             ("credentials", body.credentials), ("notes", body.notes)):
        coll = db[coll_name]
        for item in items:
            item.pop("_id", None)
            if not item.get("id"):
                item["id"] = new_id()
            await coll.update_one({"id": item["id"]}, {"$set": item}, upsert=True)
            counts[coll_name] += 1
    if body.settings:
        s = dict(body.settings); s.pop("_id", None)
        await db.settings.update_one({"_id": "notifications"},
                                     {"$set": s}, upsert=True)
    return {"ok": True, "counts": counts}


# =========================================================================
# Weekly digest
# =========================================================================

async def _build_digest_data() -> dict:
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=7)).isoformat()
    servers_docs = await db.servers.find({}, {"_id": 0}).to_list(2000)
    server_rows = []
    for s in servers_docs:
        total = await db.checks.count_documents({"server_id": s["id"], "at": {"$gte": since}})
        ups = await db.checks.count_documents(
            {"server_id": s["id"], "at": {"$gte": since}, "ok": True})
        pct = round(ups / total * 100.0, 2) if total else "—"
        server_rows.append({"name": s["name"], "uptime_pct_7d": pct,
                            "last_status": s.get("last_status") or "unknown"})
    domains_docs = await db.domains.find({}, {"_id": 0}).to_list(2000)
    settings = await _get_notification_settings()
    ssl_soon = [{"domain": d["domain"],
                 "days_remaining": (d.get("ssl") or {}).get("days_remaining")}
                for d in domains_docs
                if (d.get("ssl") or {}).get("days_remaining") is not None
                and (d.get("ssl") or {}).get("days_remaining") <= settings["ssl_warn_days"]]
    domain_soon = [{"domain": d["domain"],
                    "days_remaining": (d.get("whois") or {}).get("days_remaining")}
                   for d in domains_docs
                   if (d.get("whois") or {}).get("days_remaining") is not None
                   and (d.get("whois") or {}).get("days_remaining") <= settings["domain_warn_days"]]
    incidents = await db.activity.find(
        {"level": {"$in": ["error", "warning"]},
         "created_at": {"$gte": since}}, {"_id": 0},
    ).sort("created_at", -1).limit(30).to_list(30)
    incidents_rows = [{"when": i.get("created_at", "")[:19].replace("T", " "),
                       "message": i.get("message", "")} for i in incidents]
    return {"servers": server_rows, "ssl_soon": ssl_soon,
            "domain_soon": domain_soon, "incidents": incidents_rows}


@app.post("/api/settings/notifications/digest")
async def send_digest(user: dict = Depends(get_current_user)):
    settings = await _get_notification_settings()
    if not settings["email_enabled"] or not settings["email_recipient"]:
        raise HTTPException(400, "Enable email + set recipient first")
    data = await _build_digest_data()
    subject, html = build_digest_email(data)
    smtp = settings.get("smtp") or {}
    try:
        if smtp.get("enabled") and smtp.get("host"):
            ok = await send_smtp_email(smtp, settings["email_recipient"], subject, html)
            return {"ok": bool(ok)}
        eid = await send_alert_email(settings["email_recipient"], subject, html)
        return {"ok": bool(eid)}
    except Exception as e:
        raise HTTPException(500, f"Digest send failed: {e}")


@app.get("/api/activity")
async def get_activity(limit: int = 100, user: dict = Depends(get_current_user)):
    return await db.activity.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)


@app.post("/api/activity/{activity_id}/comments")
async def add_comment(activity_id: str, body: CommentIn,
                      user: dict = Depends(get_current_user)):
    comment = {"id": new_id(), "text": body.text.strip(), "created_at": now_iso(),
               "author": user.get("name") or user.get("email") or "operator"}
    r = await db.activity.update_one({"id": activity_id}, {"$push": {"comments": comment}})
    if not r.matched_count:
        raise HTTPException(404, "Event not found")
    return await db.activity.find_one({"id": activity_id}, {"_id": 0})


@app.delete("/api/activity/{activity_id}/comments/{comment_id}")
async def delete_comment(activity_id: str, comment_id: str,
                         user: dict = Depends(get_current_user)):
    r = await db.activity.update_one({"id": activity_id},
                                     {"$pull": {"comments": {"id": comment_id}}})
    if not r.matched_count:
        raise HTTPException(404, "Event not found")
    return await db.activity.find_one({"id": activity_id}, {"_id": 0})


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
                                fresh = await db.servers.find_one({"id": s["id"]})
                                if fresh:
                                    await _check_metric_alerts(fresh, m)
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
