"""Alert email sender (Resend via Emergent proxy)."""
from __future__ import annotations

import ipaddress
import logging
import os
import re
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

EMAIL_BASE_URL = "https://integrations.emergentagent.com"

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly",
               "goo.gl", "rebrand.ly")
_CRED_ASK = (
    "reply with your password", "reply with the code", "send your password",
    "cvv", "send us your password", "enter your password below",
    "confirm your card number", "your full card number", "seed phrase",
    "recovery phrase", "verify your card", "social security number",
    "confirm your bank details",
)
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags: set[str] = set()
        self.urls: list[str] = []
        self.anchors: list[tuple[str, str]] = []
        self._href = None
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Credential-ask phrase: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Non-https link/asset: {url!r} (G3)")
        parsed = urlparse(low)
        host = parsed.hostname or ""
        if not _host_ok(host) or parsed.username is not None:
            raise ValueError(f"Bad URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text host mismatch: {m.group(1)!r} vs {real!r} (G3)")


async def send_alert_email(to: str, subject: str, html: str) -> str | None:
    key = os.environ.get("EMERGENT_EMAIL_KEY")
    from_name = os.environ.get("EMAIL_FROM_NAME", "Sentinel Monitor")
    if not key:
        logger.warning("EMERGENT_EMAIL_KEY not set — skipping email send")
        return None
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": from_name}
    reply_to = os.environ.get("EMAIL_REPLY_TO")
    if reply_to:
        payload["contact_email"] = reply_to
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": key},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.error(f"Email send failed: {e.response.status_code} {e.response.text}")
        return None
    except Exception as e:
        logger.error(f"Email send error: {e}")
        return None


def build_server_down_email(server_name: str, target: str, error: str) -> tuple[str, str]:
    subject = f"[Sentinel] Server DOWN: {server_name}"
    body_error = escape(error or "no additional info")
    html = (
        '<table role="presentation" width="100%" style="font-family:Arial,sans-serif;background:#050505;color:#F3F4F6">'
        '<tr><td style="padding:24px">'
        f'<h2 style="margin:0 0 12px 0;color:#FF3366">Server DOWN</h2>'
        f'<p><strong>{escape(server_name)}</strong> is not reachable.</p>'
        f'<p style="font-family:monospace;background:#111;padding:12px;border-left:3px solid #FF3366">'
        f'target: {escape(target)}<br/>error: {body_error}</p>'
        '<p style="font-size:12px;color:#888">Sent by Sentinel Monitor. '
        'We never ask for your password or credentials by email.</p>'
        '</td></tr></table>'
    )
    return subject, html


def build_ssl_expiry_email(domain: str, days_remaining: int, expires_at: str) -> tuple[str, str]:
    subject = f"[Sentinel] SSL expires in {days_remaining}d: {domain}"
    html = (
        '<table role="presentation" width="100%" style="font-family:Arial,sans-serif;background:#050505;color:#F3F4F6">'
        '<tr><td style="padding:24px">'
        f'<h2 style="margin:0 0 12px 0;color:#FFCC00">SSL Expiring Soon</h2>'
        f'<p><strong>{escape(domain)}</strong> SSL certificate expires in '
        f'<strong>{days_remaining} days</strong>.</p>'
        f'<p style="font-family:monospace;background:#111;padding:12px;border-left:3px solid #FFCC00">'
        f'expires at: {escape(expires_at)}</p>'
        '<p style="font-size:12px;color:#888">Sent by Sentinel Monitor.</p>'
        '</td></tr></table>'
    )
    return subject, html


def build_domain_expiry_email(domain: str, days_remaining: int, expires_at: str) -> tuple[str, str]:
    subject = f"[Sentinel] Domain expires in {days_remaining}d: {domain}"
    html = (
        '<table role="presentation" width="100%" style="font-family:Arial,sans-serif;background:#050505;color:#F3F4F6">'
        '<tr><td style="padding:24px">'
        f'<h2 style="margin:0 0 12px 0;color:#FFCC00">Domain Expiring Soon</h2>'
        f'<p><strong>{escape(domain)}</strong> registration expires in '
        f'<strong>{days_remaining} days</strong>.</p>'
        f'<p style="font-family:monospace;background:#111;padding:12px;border-left:3px solid #FFCC00">'
        f'expires at: {escape(expires_at)}</p>'
        '<p style="font-size:12px;color:#888">Sent by Sentinel Monitor.</p>'
        '</td></tr></table>'
    )
    return subject, html


async def fire_webhook(url: str, payload: dict) -> bool:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, json=payload)
        return 200 <= resp.status_code < 300
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return False
