"""Iteration 2 backend tests — Sentinel Monitor.

Covers: settings shape (webhooks[], smtp, thresholds, public page, digest),
uptime history, public status page (unauth), backup export/import,
weekly digest, high-CPU/MEM/DISK alerts + recovery, server/domain `public`.
"""
import os
import time
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@sentinel.app"
ADMIN_PASSWORD = "admin123"


# --------------------------------------------------------------------- fixtures
@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="session")
def unauth_client():
    return requests.Session()


# ------------------------------------------------------------- Notification settings
class TestNotificationSettings:
    def test_get_shape(self, client):
        r = client.get(f"{API}/settings/notifications")
        assert r.status_code == 200
        d = r.json()
        for key in ("webhooks", "smtp", "cpu_warn_pct", "mem_warn_pct",
                    "disk_warn_pct", "latency_warn_ms", "public_page_enabled",
                    "public_page_slug", "public_page_title", "digest_enabled",
                    "ssl_warn_days", "domain_warn_days",
                    "email_enabled", "email_recipient"):
            assert key in d, f"missing key: {key}"
        assert isinstance(d["webhooks"], list)
        assert isinstance(d["smtp"], dict)
        # legacy fields should not be top-level required
        assert "webhook_url" not in d
        assert "webhook_enabled" not in d

    def test_put_webhooks_smtp_slug(self, client):
        payload = {
            "email_enabled": True,
            "email_recipient": "TEST_alerts@example.com",
            "webhooks": [
                {"name": "primary", "url": "https://example.invalid/hook1", "enabled": True},
                {"name": "backup", "url": "https://example.invalid/hook2", "enabled": False},
            ],
            "smtp": {"enabled": False, "host": "smtp.example.com", "port": 2525,
                     "username": "u", "password": "p",
                     "from_email": "from@example.com", "use_tls": True},
            "ssl_warn_days": 10,
            "domain_warn_days": 20,
            "cpu_warn_pct": 85,
            "mem_warn_pct": 85,
            "disk_warn_pct": 85,
            "latency_warn_ms": 2500,
            "digest_enabled": True,
            "public_page_enabled": True,
            "public_page_slug": "Demo Page!!",  # will be sanitized
            "public_page_title": "TEST Sentinel Status",
        }
        r = client.put(f"{API}/settings/notifications", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["webhooks"]) == 2
        # ids assigned
        for wh in d["webhooks"]:
            assert wh.get("id")
        assert d["smtp"]["host"] == "smtp.example.com"
        assert d["smtp"]["port"] == 2525
        # slug sanitized (lowercase alnum+hyphen, no space or !)
        assert d["public_page_slug"] == "demopage", f"got {d['public_page_slug']!r}"
        assert d["cpu_warn_pct"] == 85
        assert d["latency_warn_ms"] == 2500

    def test_notifications_test_endpoint(self, client):
        # webhooks[1] disabled → only 1 entry in webhook_results
        r = client.post(f"{API}/settings/notifications/test")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "email_ok" in d
        assert "webhook_results" in d
        assert isinstance(d["webhook_results"], list)
        assert len(d["webhook_results"]) == 1  # only 'primary' enabled
        assert d["webhook_results"][0]["name"] == "primary"


# ------------------------------------------------------------- Uptime history
class TestUptimeHistory:
    def test_history_days_default(self, client):
        r = client.get(f"{API}/uptime/history?days=30")
        assert r.status_code == 200
        d = r.json()
        assert d["days"] == 30
        assert isinstance(d["servers"], list)
        for s in d["servers"]:
            assert set(("id", "name", "last_status", "series")).issubset(s)
            assert len(s["series"]) == 30
            for pt in s["series"]:
                assert "date" in pt and "pct" in pt and "checks" in pt

    def test_history_7d(self, client):
        r = client.get(f"{API}/uptime/history?days=7")
        assert r.status_code == 200
        d = r.json()
        assert d["days"] == 7
        for s in d["servers"]:
            assert len(s["series"]) == 7


# ------------------------------------------------------------- Public status page
class TestPublicStatusPage:
    def test_disabled_returns_404(self, client, unauth_client):
        # First disable
        cur = client.get(f"{API}/settings/notifications").json()
        cur["public_page_enabled"] = False
        client.put(f"{API}/settings/notifications", json=cur)
        r = unauth_client.get(f"{API}/public/status/ssl-vault-1")
        assert r.status_code == 404

    def test_enabled_with_public_server(self, client, unauth_client):
        # Enable + slug demo
        cur = client.get(f"{API}/settings/notifications").json()
        cur["public_page_enabled"] = True
        cur["public_page_slug"] = "demo"
        cur["public_page_title"] = "TEST Public Status"
        client.put(f"{API}/settings/notifications", json=cur)

        # Create a public server
        srv = client.post(f"{API}/servers", json={
            "name": "TEST_public_srv",
            "check_kind": "https",
            "target": "https://www.google.com",
            "public": True,
            "ssh_username": "shouldnotleak",
            "ssh_host": "shouldnotleak.example",
        }).json()
        sid = srv["id"]
        # Force one check to seed uptime
        client.post(f"{API}/servers/{sid}/check")

        # Wrong slug still 404
        r_bad = unauth_client.get(f"{API}/public/status/wrongslug")
        assert r_bad.status_code == 404

        # Correct
        r = unauth_client.get(f"{API}/public/status/demo")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["title"] == "TEST Public Status"
        names = [s["name"] for s in d["servers"]]
        assert "TEST_public_srv" in names
        found = [s for s in d["servers"] if s["name"] == "TEST_public_srv"][0]
        assert "uptime_pct_7d" in found
        # Secrets not leaked
        for k in ("ssh_username", "ssh_host", "ssh_password",
                  "ssh_private_key", "agent_token"):
            assert k not in found, f"leaked field {k}"

        # cleanup
        client.delete(f"{API}/servers/{sid}")


# ------------------------------------------------------------- Backup export/import
class TestBackup:
    def test_export_shape(self, client):
        r = client.get(f"{API}/backup/export")
        assert r.status_code == 200
        d = r.json()
        assert d["version"] == 1
        for k in ("servers", "domains", "credentials", "notes", "settings"):
            assert k in d

    def test_import_upsert(self, client):
        # Create a server, export, mutate name, re-import replace=false
        s = client.post(f"{API}/servers", json={
            "name": "TEST_backup_orig",
            "check_kind": "https",
            "target": "https://www.google.com",
        }).json()
        sid = s["id"]
        exp = client.get(f"{API}/backup/export").json()
        # mutate
        for srv in exp["servers"]:
            if srv["id"] == sid:
                srv["name"] = "TEST_backup_renamed"
        payload = {
            "version": 1,
            "servers": exp["servers"],
            "domains": exp["domains"],
            "credentials": exp["credentials"],
            "notes": exp["notes"],
            "settings": None,
            "replace": False,
        }
        r = client.post(f"{API}/backup/import", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["counts"]["servers"] >= 1
        # Verify rename persisted
        got = client.get(f"{API}/servers/{sid}").json()
        assert got["name"] == "TEST_backup_renamed"
        client.delete(f"{API}/servers/{sid}")


# ------------------------------------------------------------- Weekly digest
class TestDigest:
    def test_digest_email_disabled(self, client):
        cur = client.get(f"{API}/settings/notifications").json()
        cur["email_enabled"] = False
        client.put(f"{API}/settings/notifications", json=cur)
        r = client.post(f"{API}/settings/notifications/digest")
        assert r.status_code == 400

    def test_digest_email_enabled(self, client):
        cur = client.get(f"{API}/settings/notifications").json()
        cur["email_enabled"] = True
        cur["email_recipient"] = "TEST_digest@example.com"
        # SMTP off → uses Resend
        cur["smtp"]["enabled"] = False
        client.put(f"{API}/settings/notifications", json=cur)
        r = client.post(f"{API}/settings/notifications/digest")
        assert r.status_code == 200, r.text
        assert "ok" in r.json()


# ------------------------------------------------------------- Metric alerts
class TestMetricAlerts:
    def test_cpu_high_and_recover(self, client):
        # Ensure thresholds are default 90
        cur = client.get(f"{API}/settings/notifications").json()
        cur["cpu_warn_pct"] = 90
        cur["mem_warn_pct"] = 90
        cur["disk_warn_pct"] = 90
        client.put(f"{API}/settings/notifications", json=cur)

        srv = client.post(f"{API}/servers", json={
            "name": "TEST_agent_alerts",
            "check_kind": "https",
            "target": "https://www.google.com",
            "agent_enabled": True,
        }).json()
        sid = srv["id"]
        token = srv["agent_token"]

        # push high CPU
        r = client.post(f"{API}/agent/metrics", json={
            "server_id": sid, "agent_token": token,
            "cpu_percent": 95, "mem_percent": 10, "disk_percent": 10,
            "uptime": "1 day",
        })
        assert r.status_code == 200
        time.sleep(0.5)

        # check activity has high_cpu
        act = client.get(f"{API}/activity?limit=50").json()
        kinds = [a["kind"] for a in act]
        assert "high_cpu" in kinds

        # check server alert_state
        s2 = client.get(f"{API}/servers/{sid}").json()
        assert s2.get("alert_state", {}).get("high_cpu") is True

        # push low CPU → recovered
        r = client.post(f"{API}/agent/metrics", json={
            "server_id": sid, "agent_token": token,
            "cpu_percent": 20, "mem_percent": 10, "disk_percent": 10,
            "uptime": "1 day",
        })
        assert r.status_code == 200
        time.sleep(0.5)
        act = client.get(f"{API}/activity?limit=50").json()
        assert "recovered_cpu" in [a["kind"] for a in act]
        s3 = client.get(f"{API}/servers/{sid}").json()
        assert s3.get("alert_state", {}).get("high_cpu") is False

        # MEM high
        client.post(f"{API}/agent/metrics", json={
            "server_id": sid, "agent_token": token,
            "cpu_percent": 5, "mem_percent": 99, "disk_percent": 5,
            "uptime": "1 day",
        })
        act = client.get(f"{API}/activity?limit=50").json()
        assert "high_mem" in [a["kind"] for a in act]

        # DISK high
        client.post(f"{API}/agent/metrics", json={
            "server_id": sid, "agent_token": token,
            "cpu_percent": 5, "mem_percent": 5, "disk_percent": 99,
            "uptime": "1 day",
        })
        act = client.get(f"{API}/activity?limit=50").json()
        assert "high_disk" in [a["kind"] for a in act]

        client.delete(f"{API}/servers/{sid}")

    def test_latency_path_no_crash(self, client):
        # Just run a normal check and verify no server 500 and activity accessible
        srv = client.post(f"{API}/servers", json={
            "name": "TEST_latency_smoke",
            "check_kind": "https",
            "target": "https://www.google.com",
        }).json()
        sid = srv["id"]
        r = client.post(f"{API}/servers/{sid}/check")
        assert r.status_code == 200, r.text
        assert client.get(f"{API}/activity").status_code == 200
        client.delete(f"{API}/servers/{sid}")


# ------------------------------------------------------------- Public flag
class TestPublicFlag:
    def test_server_public_flag(self, client):
        s = client.post(f"{API}/servers", json={
            "name": "TEST_public_flag",
            "check_kind": "https",
            "target": "https://www.google.com",
            "public": True,
        }).json()
        assert s["public"] is True
        sid = s["id"]
        # Update to false
        upd = client.put(f"{API}/servers/{sid}", json={
            "name": "TEST_public_flag",
            "check_kind": "https",
            "target": "https://www.google.com",
            "public": False,
        }).json()
        assert upd["public"] is False
        client.delete(f"{API}/servers/{sid}")

    def test_domain_public_flag(self, client):
        d = client.post(f"{API}/domains", json={
            "domain": "example.com",
            "track_ssl": False, "track_whois": False,
            "public": True,
        }).json()
        assert d["public"] is True
        client.delete(f"{API}/domains/{d['id']}")
