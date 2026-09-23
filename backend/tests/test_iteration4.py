"""Iteration 4 backend tests — branding, terminal targets, WS SSH bridge."""
import asyncio
import json
import os

import pytest
import requests
import websockets
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
WS_URL = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws/ssh"
ADMIN_EMAIL = "admin@sentinel.app"
ADMIN_PW = "admin123"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PW})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def client(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json",
                      "Authorization": f"Bearer {token}"})
    return s


# ---------- Branding ----------
class TestBranding:
    def test_branding_unauth(self):
        r = requests.get(f"{BASE_URL}/api/branding")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "app_name" in data
        assert isinstance(data["app_name"], str) and data["app_name"]

    def test_update_branding_persists(self, client):
        # Get current settings first
        cur = client.get(f"{BASE_URL}/api/settings/notifications").json()
        payload = {**cur, "app_name": "Ops Console"}
        r = client.put(f"{BASE_URL}/api/settings/notifications", json=payload)
        assert r.status_code == 200, r.text
        # Confirm via unauth branding endpoint
        b = requests.get(f"{BASE_URL}/api/branding").json()
        assert b["app_name"] == "Ops Console"

        # Reset
        payload["app_name"] = "Sentinel"
        r2 = client.put(f"{BASE_URL}/api/settings/notifications", json=payload)
        assert r2.status_code == 200
        b2 = requests.get(f"{BASE_URL}/api/branding").json()
        assert b2["app_name"] == "Sentinel"


# ---------- Terminal targets ----------
class TestTerminalTargets:
    _vault_id = None

    def test_list_targets(self, client):
        r = client.get(f"{BASE_URL}/api/terminal/targets")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        for entry in data:
            assert entry["source"] in ("server", "vault")
            for k in ("id", "name", "host", "port", "username", "auth"):
                assert k in entry, f"missing {k} in {entry}"

    def test_vault_ssh_key_appears(self, client):
        payload = {
            "category": "ssh_key",
            "name": "TEST_ssh_box",
            "url": "ssh://sshtest@127.0.0.1:2222",
            "password": "Passw0rd!",
            "ssh_key": "",
        }
        r = client.post(f"{BASE_URL}/api/credentials", json=payload)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        TestTerminalTargets._vault_id = cid

        targets = client.get(f"{BASE_URL}/api/terminal/targets").json()
        match = next((t for t in targets if t["source"] == "vault" and t["id"] == cid), None)
        assert match, f"vault target missing; got {[t['id'] for t in targets]}"
        assert match["host"] == "127.0.0.1"
        assert match["port"] == 2222
        assert match["username"] == "sshtest"
        assert match["auth"] == "password"

    def test_zzz_cleanup(self, client):
        if TestTerminalTargets._vault_id:
            client.delete(f"{BASE_URL}/api/credentials/{TestTerminalTargets._vault_id}")


# ---------- WebSocket SSH ----------
async def _recv_until(ws, predicate, timeout=15):
    """Recv frames until predicate(control_json_or_None, accum_bytes) is truthy."""
    out = b""
    last_ctrl = None
    end = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < end:
        try:
            m = await asyncio.wait_for(ws.recv(), timeout=timeout)
        except asyncio.TimeoutError:
            break
        if isinstance(m, bytes):
            out += m
        else:
            try:
                last_ctrl = json.loads(m)
            except Exception:
                last_ctrl = None
        if predicate(last_ctrl, out):
            return last_ctrl, out
    return last_ctrl, out


class TestWSSSH:
    def test_unauth_rejected(self):
        async def run():
            try:
                async with websockets.connect(WS_URL) as ws:
                    await ws.recv()
                return "accepted"
            except websockets.exceptions.InvalidStatus as e:
                return f"status:{e.response.status_code}"
            except websockets.exceptions.InvalidStatusCode as e:
                return f"status:{e.status_code}"
            except websockets.exceptions.ConnectionClosed as e:
                return f"close:{e.rcvd.code if e.rcvd else '?'}"
            except Exception as e:
                return f"exc:{type(e).__name__}"
        result = asyncio.run(run())
        assert result.startswith("status:403") or result.startswith("close:4401"), result

    def test_adhoc_connect_and_echo(self, token):
        async def run():
            async with websockets.connect(f"{WS_URL}?token={token}", max_size=None) as ws:
                await ws.send(json.dumps({
                    "source": "adhoc", "host": "127.0.0.1", "port": 2222,
                    "username": "sshtest", "password": "Passw0rd!",
                    "cols": 100, "rows": 30}))
                # wait for ready
                ready = False
                for _ in range(20):
                    m = await asyncio.wait_for(ws.recv(), timeout=10)
                    if not isinstance(m, bytes):
                        j = json.loads(m)
                        if j.get("type") == "ready":
                            ready = True
                            break
                        if j.get("type") == "error":
                            return {"ready": False, "err": j}
                assert ready, "did not receive ready"
                # send command
                await ws.send(json.dumps({"type": "input", "data": "echo HELLO_$((6*7))\n"}))
                await ws.send(json.dumps({"type": "resize", "cols": 120, "rows": 40}))
                out = b""
                for _ in range(40):
                    m = await asyncio.wait_for(ws.recv(), timeout=5)
                    if isinstance(m, bytes):
                        out += m
                        if b"HELLO_42" in out:
                            break
                # exit
                await ws.send(json.dumps({"type": "input", "data": "exit\n"}))
                closed = False
                for _ in range(20):
                    try:
                        m = await asyncio.wait_for(ws.recv(), timeout=5)
                    except Exception:
                        break
                    if not isinstance(m, bytes):
                        j = json.loads(m)
                        if j.get("type") == "closed":
                            closed = True
                            break
                return {"ready": ready, "hello": b"HELLO_42" in out, "closed": closed}
        r = asyncio.run(run())
        assert r["ready"], r
        assert r["hello"], f"HELLO_42 not seen in output: {r}"
        assert r["closed"], f"closed control frame missing: {r}"

    def test_wrong_password_error(self, token):
        async def run():
            async with websockets.connect(f"{WS_URL}?token={token}") as ws:
                await ws.send(json.dumps({
                    "source": "adhoc", "host": "127.0.0.1", "port": 2222,
                    "username": "sshtest", "password": "wrong"}))
                for _ in range(20):
                    m = await asyncio.wait_for(ws.recv(), timeout=15)
                    if not isinstance(m, bytes):
                        return json.loads(m)
                return None
        j = asyncio.run(run())
        assert j and j.get("type") == "error", j
        assert "auth" in j.get("message", "").lower(), j

    def test_missing_host_error(self, token):
        async def run():
            async with websockets.connect(f"{WS_URL}?token={token}") as ws:
                await ws.send(json.dumps({
                    "source": "adhoc", "port": 2222,
                    "username": "sshtest", "password": "Passw0rd!"}))
                for _ in range(10):
                    m = await asyncio.wait_for(ws.recv(), timeout=10)
                    if not isinstance(m, bytes):
                        return json.loads(m)
                return None
        j = asyncio.run(run())
        assert j and j.get("type") == "error", j
        assert "host" in j.get("message", "").lower() and "user" in j.get("message", "").lower(), j

    def test_vault_source_connect(self, client, token):
        # create vault cred with password
        r = client.post(f"{BASE_URL}/api/credentials", json={
            "category": "ssh_key",
            "name": "TEST_vault_ssh_conn",
            "url": "ssh://sshtest@127.0.0.1:2222",
            "password": "Passw0rd!",
            "ssh_key": "",
        })
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        try:
            async def run():
                async with websockets.connect(f"{WS_URL}?token={token}", max_size=None) as ws:
                    await ws.send(json.dumps({"source": "vault", "id": cid,
                                              "cols": 100, "rows": 30}))
                    for _ in range(20):
                        m = await asyncio.wait_for(ws.recv(), timeout=10)
                        if not isinstance(m, bytes):
                            j = json.loads(m)
                            if j.get("type") == "ready":
                                return True
                            if j.get("type") == "error":
                                return j
                    return False
            result = asyncio.run(run())
            assert result is True, f"vault connect did not become ready: {result}"
        finally:
            client.delete(f"{BASE_URL}/api/credentials/{cid}")
