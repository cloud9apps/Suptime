"""Iteration 3 backend tests — webhook formats, per-server overrides/mute, incident comments, public status."""
import os
import time
import pytest
import requests
from dotenv import load_dotenv
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@sentinel.app"
ADMIN_PW = "admin123"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PW})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="session")
def created_ids():
    return {"servers": []}


# ---------- Webhook format ----------
class TestWebhookFormats:
    def test_put_and_get_webhook_formats(self, client):
        payload = {
            "email_enabled": False,
            "webhooks": [
                {"name": "wh-slack", "url": "https://httpbin.org/post",
                 "enabled": True, "format": "slack"},
                {"name": "wh-discord", "url": "https://httpbin.org/post",
                 "enabled": True, "format": "discord"},
                {"name": "wh-json", "url": "https://httpbin.org/post",
                 "enabled": True, "format": "json"},
            ],
            "public_page_enabled": True,
            "public_page_slug": "demo",
            "public_page_title": "Sentinel Status",
        }
        r = client.put(f"{BASE_URL}/api/settings/notifications", json=payload)
        assert r.status_code == 200, r.text
        got = client.get(f"{BASE_URL}/api/settings/notifications").json()
        fmts = sorted([w.get("format") for w in got["webhooks"]])
        assert fmts == ["discord", "json", "slack"], f"formats not persisted: {fmts}"

    def test_notifications_test_returns_format_and_ok(self, client):
        r = client.post(f"{BASE_URL}/api/settings/notifications/test")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "webhook_results" in data
        results = data["webhook_results"]
        assert len(results) == 3
        for res in results:
            assert "format" in res
            assert "ok" in res
            assert res["ok"] is True, f"Webhook failed: {res}"
        formats = sorted([r["format"] for r in results])
        assert formats == ["discord", "json", "slack"]


# ---------- Server alert_overrides + alerts_muted ----------
class TestServerOverrides:
    def test_create_with_overrides(self, client, created_ids):
        body = {
            "name": "TEST_override_server",
            "check_kind": "https",
            "target": "https://example.com",
            "interval_seconds": 300,
            "alerts_muted": True,
            "alert_overrides": {"cpu_warn_pct": 95, "latency_warn_ms": 10},
        }
        r = client.post(f"{BASE_URL}/api/servers", json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["alerts_muted"] is True
        assert d["alert_overrides"]["cpu_warn_pct"] == 95
        assert d["alert_overrides"]["latency_warn_ms"] == 10
        assert d["alert_overrides"]["mem_warn_pct"] is None
        created_ids["servers"].append(d["id"])

        # GET should preserve
        g = client.get(f"{BASE_URL}/api/servers/{d['id']}").json()
        assert g["alerts_muted"] is True
        assert g["alert_overrides"]["latency_warn_ms"] == 10

    def test_update_overrides(self, client, created_ids):
        sid = created_ids["servers"][0]
        body = {
            "name": "TEST_override_server",
            "check_kind": "https",
            "target": "https://example.com",
            "interval_seconds": 300,
            "alerts_muted": False,
            "alert_overrides": {"mem_warn_pct": 50},
        }
        r = client.put(f"{BASE_URL}/api/servers/{sid}", json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["alerts_muted"] is False
        assert d["alert_overrides"]["mem_warn_pct"] == 50
        assert d["alert_overrides"]["cpu_warn_pct"] is None

    def test_create_without_overrides_defaults_nulls(self, client, created_ids):
        body = {"name": "TEST_no_overrides", "check_kind": "https",
                "target": "https://example.com"}
        r = client.post(f"{BASE_URL}/api/servers", json=body)
        assert r.status_code == 200
        d = r.json()
        ov = d["alert_overrides"]
        assert all(ov[k] is None for k in
                   ["cpu_warn_pct", "mem_warn_pct", "disk_warn_pct", "latency_warn_ms"])
        assert d["alerts_muted"] is False
        created_ids["servers"].append(d["id"])


# ---------- Latency override triggers high_latency ----------
class TestLatencyOverride:
    def test_latency_override_triggers_activity(self, client, created_ids):
        # Create a fresh server with latency threshold=10ms & alerts NOT muted
        body = {
            "name": "TEST_latency_override",
            "check_kind": "https",
            "target": "https://example.com",
            "alerts_muted": False,
            "alert_overrides": {"latency_warn_ms": 10},
        }
        r = client.post(f"{BASE_URL}/api/servers", json=body)
        assert r.status_code == 200
        sid = r.json()["id"]
        created_ids["servers"].append(sid)

        c = client.post(f"{BASE_URL}/api/servers/{sid}/check")
        assert c.status_code == 200, c.text
        time.sleep(1)
        acts = client.get(f"{BASE_URL}/api/activity").json()
        matched = [a for a in acts
                   if a.get("kind") == "high_latency"
                   and a.get("meta", {}).get("server_id") == sid]
        assert matched, f"Expected high_latency activity for server {sid}; got {[a['kind'] for a in acts[:10]]}"


# ---------- Incident comments ----------
class TestIncidentComments:
    def test_add_delete_comment(self, client):
        acts = client.get(f"{BASE_URL}/api/activity").json()
        assert acts, "No activity events found to comment on"
        aid = acts[0]["id"]

        # empty text -> 422
        r_empty = client.post(f"{BASE_URL}/api/activity/{aid}/comments",
                              json={"text": ""})
        assert r_empty.status_code == 422

        # unknown id -> 404
        r_404 = client.post(f"{BASE_URL}/api/activity/does-not-exist/comments",
                            json={"text": "hi"})
        assert r_404.status_code == 404

        # valid comment
        r_ok = client.post(f"{BASE_URL}/api/activity/{aid}/comments",
                           json={"text": "TEST comment"})
        assert r_ok.status_code == 200, r_ok.text
        event = r_ok.json()
        comments = event.get("comments") or []
        assert comments, "comment not appended"
        c = comments[-1]
        assert c["text"] == "TEST comment"
        assert "id" in c and "created_at" in c and "author" in c
        cid = c["id"]

        # delete
        rd = client.delete(f"{BASE_URL}/api/activity/{aid}/comments/{cid}")
        assert rd.status_code == 200
        remaining = [x for x in (rd.json().get("comments") or []) if x["id"] == cid]
        assert not remaining


# ---------- Public status ----------
class TestPublicStatus:
    def test_public_status_sanitizes_comments(self, client, created_ids):
        # Make one server public
        sid = created_ids["servers"][0]
        srv = client.get(f"{BASE_URL}/api/servers/{sid}").json()
        srv["public"] = True
        # PUT expects ServerIn shape
        put_body = {k: srv.get(k) for k in
                    ["name", "check_kind", "target", "interval_seconds", "notes",
                     "tags", "ssh_enabled", "ssh_host", "ssh_port", "ssh_username",
                     "ssh_password", "ssh_private_key", "agent_enabled", "public",
                     "alerts_muted", "alert_overrides"]}
        put_body["public"] = True
        r = client.put(f"{BASE_URL}/api/servers/{sid}", json=put_body)
        assert r.status_code == 200, r.text

        # Trigger an activity for this server (latency override already set)
        client.post(f"{BASE_URL}/api/servers/{sid}/check")
        time.sleep(1)

        # Find an activity for this server & attach a comment
        acts = client.get(f"{BASE_URL}/api/activity").json()
        target = next((a for a in acts if a.get("meta", {}).get("server_id") == sid), None)
        if target is None:
            pytest.skip("no activity for this server yet")
        cr = client.post(f"{BASE_URL}/api/activity/{target['id']}/comments",
                         json={"text": "PUBLIC comment"})
        assert cr.status_code == 200

        # Unauthenticated fetch of public status
        anon = requests.Session()
        pr = anon.get(f"{BASE_URL}/api/public/status/demo")
        assert pr.status_code == 200, pr.text
        data = pr.json()
        assert "activity" in data
        found = False
        for a in data["activity"]:
            assert "meta" not in a
            for c in a.get("comments", []):
                assert set(c.keys()) == {"id", "text", "created_at"}, f"unexpected keys {c.keys()}"
                if c["text"] == "PUBLIC comment":
                    found = True
        assert found, "public comment not visible"


# ---------- Cleanup ----------
def test_zzz_cleanup(client, created_ids):
    for sid in created_ids["servers"]:
        client.delete(f"{BASE_URL}/api/servers/{sid}")
