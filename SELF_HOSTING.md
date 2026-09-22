# Self-Hosting Sentinel Monitor

Sentinel is a single-admin, self-hosted dashboard for server uptime, performance (SSH / agent), SSL & domain expiry, a credentials vault, notes, a web SSH terminal and alerting (email + Slack / Discord / generic webhooks).

| Component | Tech | Port |
|-----------|------|------|
| Frontend  | React (CRA) served by nginx | 80 (container) |
| Backend   | FastAPI + uvicorn | 8001 |
| Database  | MongoDB 6/7 | 27017 |

All requests to `/api/*` (including the `/api/ws/ssh` WebSocket) are proxied to the backend; everything else serves the React SPA.

---

## 1. Requirements

- A Linux host (Debian/Ubuntu recommended), 1 vCPU / 1 GB RAM is plenty for ~50 servers.
- Docker 24+ and Docker Compose v2 **or** Python 3.11+, Node 20+, MongoDB 6+.
- Optional: a domain + TLS (Caddy / nginx / Traefik in front). Auth cookies are `Secure`, so **use HTTPS in production**.
- Outbound network access from the host for HTTP/ping/TCP probes, WHOIS (port 43) and SSH (22) to the servers you monitor.

---

## 2. Quick start with Docker Compose (recommended)

```bash
git clone <your-repo-url> sentinel && cd sentinel/deploy
cp .env.example .env
nano .env            # set JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, PUBLIC_URL
docker compose up -d --build
```

Open `http://<host>:8080` (or `PUBLIC_URL`) and log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### `.env` reference (`deploy/.env`)

| Key | Required | Description |
|-----|----------|-------------|
| `JWT_SECRET` | ✅ | Long random string. `openssl rand -hex 32` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | ✅ | Seeded on first boot. Changing the password here re-seeds it on restart. |
| `PUBLIC_URL` | ✅ | The URL users open in the browser, e.g. `https://monitor.example.com`. Baked into the frontend build and used for CORS. |
| `HTTP_PORT` | – | Host port for the frontend container (default `8080`). |
| `DB_NAME` | – | Mongo database name (default `sentinel`). |
| `EMERGENT_EMAIL_KEY` | – | Managed Resend key. Leave empty if you configure your own SMTP in **Settings → Email & SMTP**. |
| `EMAIL_FROM_NAME` | – | Display name for alert emails. |

> If you change `PUBLIC_URL` you must rebuild the frontend: `docker compose up -d --build frontend`.

### Useful commands

```bash
docker compose logs -f backend        # scheduler + alert logs
docker compose restart backend
docker compose pull && docker compose up -d --build   # upgrade
docker compose exec mongo mongodump --archive=/data/db/backup.archive --db sentinel   # DB dump
```

The Mongo volume `mongo_data` holds all data. Additionally, **Settings → Backup & Digest → Export** downloads a JSON backup of servers, domains, vault, notes and settings that can be re-imported on any instance.

---

## 3. HTTPS with a reverse proxy

### Caddy (simplest — automatic Let's Encrypt)

```
monitor.example.com {
    reverse_proxy localhost:8080
}
```

Caddy proxies WebSockets automatically. Set `PUBLIC_URL=https://monitor.example.com` and `HTTP_PORT=8080`.

### nginx (host level)

```nginx
server {
    listen 443 ssl http2;
    server_name monitor.example.com;
    ssl_certificate     /etc/letsencrypt/live/monitor.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/monitor.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;     # keep web-SSH sessions alive
    }
}
```

---

## 4. Manual installation (no Docker)

### 4.1 MongoDB

```bash
# Debian/Ubuntu — follow https://www.mongodb.com/docs/manual/installation/
sudo systemctl enable --now mongod
```

### 4.2 Backend

```bash
sudo apt install -y python3.11 python3.11-venv iputils-ping whois
cd sentinel/backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cat > .env <<'EOF'
MONGO_URL="mongodb://localhost:27017"
DB_NAME="sentinel"
CORS_ORIGINS="https://monitor.example.com"
JWT_SECRET="<openssl rand -hex 32>"
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="change-me"
EMAIL_FROM_NAME="Sentinel Monitor"
EOF

uvicorn server:app --host 127.0.0.1 --port 8001 --proxy-headers
```

systemd unit (`/etc/systemd/system/sentinel-backend.service`):

```ini
[Unit]
Description=Sentinel backend
After=network.target mongod.service

[Service]
User=sentinel
WorkingDirectory=/opt/sentinel/backend
EnvironmentFile=/opt/sentinel/backend/.env
ExecStart=/opt/sentinel/backend/.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001 --proxy-headers
Restart=always
AmbientCapabilities=CAP_NET_RAW

[Install]
WantedBy=multi-user.target
```

### 4.3 Frontend

```bash
cd sentinel/frontend
echo 'REACT_APP_BACKEND_URL=https://monitor.example.com' > .env
yarn install && yarn build          # outputs ./build
sudo cp -r build /var/www/sentinel
```

Serve `/var/www/sentinel` with nginx using `deploy/nginx.conf` as a template (change `proxy_pass http://backend:8001` to `http://127.0.0.1:8001`).

---

## 5. First-run checklist

1. **Settings → General** — set the application name.
2. **Settings → Email & SMTP** — enable email, enter recipient; optionally turn on your own SMTP.
3. **Settings → Webhooks** — add Slack / Discord / generic hooks and choose the render format. Click **Test alert**.
4. **Settings → Thresholds** — global SSL/domain/latency/CPU/MEM/DISK limits (override per server from the Servers page).
5. **Servers** — add HTTP/HTTPS/Ping/TCP targets. Enable **SSH metrics** (agentless) or **lightweight agent** and paste the generated cURL loop on the box.
6. **Domains & SSL** — add domains; checks run every 6 h.
7. **Vault** — save hosting panel logins, cloud keys, SSL private keys, SSH keys. Entries in category *SSH Key* appear in the **Terminal** page.
8. **Settings → Public Page** — enable and set a slug; toggle *Public* on servers/domains you want to expose.

---

## 6. Web SSH terminal

The **Terminal** page opens an interactive shell via `wss://<host>/api/ws/ssh` → backend → paramiko → your server. Nothing is stored for *Quick connect* sessions. Make sure your reverse proxy forwards WebSocket upgrades (both configs above do) and that the backend host can reach the target on its SSH port.

Vault *SSH Key* entries accept the host in the **URL** field as `host`, `host:2222`, `user@host` or `ssh://user@host:2222`.

---

## 7. Security notes

- The vault stores credentials **in plaintext** in MongoDB (by design for this build). Restrict Mongo to `localhost` / the Docker network, encrypt the disk, and keep the backup JSON safe.
- Always run behind HTTPS — cookies are marked `Secure; SameSite=None`.
- Single admin account; rotate `ADMIN_PASSWORD` by changing `.env` and restarting the backend.
- Metrics/checks/activity are retained for 7 days; configuration is kept forever.

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Login works but API calls fail with 401 | `PUBLIC_URL` / `CORS_ORIGINS` don't match the browser origin, or you're on plain HTTP (cookies are `Secure`). |
| Ping checks always down | Container needs `NET_RAW` (compose already adds it) / systemd `AmbientCapabilities=CAP_NET_RAW`. |
| WHOIS shows "No expiry data" | Some TLDs rate-limit or hide expiry; the `whois` binary must be installed. |
| Terminal says "not authenticated" | Token expired — log out/in. Proxy must pass `Upgrade` headers. |
| Emails not sent | Check **Test alert**; for SMTP use port 587 + STARTTLS or 465 (SSL). Logs: `docker compose logs backend`. |
