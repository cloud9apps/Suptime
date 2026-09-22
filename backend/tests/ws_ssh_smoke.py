import asyncio, json, os, sys
import httpx, websockets

API = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].splitlines()[0].strip()
WS = API.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws/ssh"


async def main():
    r = httpx.post(f"{API}/api/auth/login", json={"email": "admin@sentinel.app", "password": "admin123"})
    token = r.json()["access_token"]

    # 1) unauthenticated should be rejected with 4401
    try:
        async with websockets.connect(WS) as ws:
            await ws.recv()
        print("FAIL: unauth accepted")
    except websockets.exceptions.ConnectionClosed as e:
        print("unauth close code:", e.rcvd.code if e.rcvd else e)
    except Exception as e:
        print("unauth rejected:", type(e).__name__)

    # 2) adhoc connect to local sshd on 2222
    async with websockets.connect(f"{WS}?token={token}", max_size=None) as ws:
        await ws.send(json.dumps({"source": "adhoc", "host": "127.0.0.1", "port": 2222,
                                  "username": "sshtest", "password": "Passw0rd!", "cols": 100, "rows": 30}))
        out = b""
        ready = False
        for _ in range(40):
            try:
                m = await asyncio.wait_for(ws.recv(), timeout=2)
            except asyncio.TimeoutError:
                break
            if isinstance(m, bytes):
                out += m
            else:
                j = json.loads(m)
                print("ctrl:", j)
                if j["type"] == "ready":
                    ready = True
                    await ws.send(json.dumps({"type": "input", "data": "echo HELLO_$((6*7)) && whoami\n"}))
                    await ws.send(json.dumps({"type": "resize", "cols": 120, "rows": 40}))
                if j["type"] in ("error", "closed"):
                    break
            if b"HELLO_42" in out and b"sshtest" in out.split(b"HELLO_42")[-1]:
                break
        print("ready:", ready)
        print("HELLO_42 seen:", b"HELLO_42" in out, "| whoami ok:", b"sshtest" in out)
        await ws.send(json.dumps({"type": "input", "data": "exit\n"}))
        try:
            for _ in range(10):
                m = await asyncio.wait_for(ws.recv(), timeout=2)
                if not isinstance(m, bytes):
                    print("ctrl:", m); break
        except Exception as e:
            print("after exit:", type(e).__name__)

    # 3) bad credentials -> error message
    async with websockets.connect(f"{WS}?token={token}") as ws:
        await ws.send(json.dumps({"source": "adhoc", "host": "127.0.0.1", "port": 2222,
                                  "username": "sshtest", "password": "wrong"}))
        m = await asyncio.wait_for(ws.recv(), timeout=20)
        print("badcred:", m[:120])

asyncio.run(main())
