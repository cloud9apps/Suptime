# Sentinel Server Monitor — PRD

## Original Problem Statement
Self-hosted software for: server uptime, server performance, SSL/domain expiry tracking, notes + saved details for cloud providers / SSL providers / hosting control panels / SSH keys, simple DB (SQLite / JSON), polished UI, push + webhook notifications.

## User Choices (locked)
- Features: uptime + performance + SSL/domain + vault + notes + notifications
- Channels: Webhook + Email (managed Resend)
- Perf: agentless SSH **and** lightweight agent push
- Storage: MongoDB (template constraint) + JWT single-user
- At-rest encryption: plaintext (user-requested)

## Architecture
- **Backend**: FastAPI + Motor (Mongo). Modules: `server.py`, `auth.py`, `monitor.py`, `email_service.py`.
- **Frontend**: React + shadcn/ui + Recharts + Sonner toasts + Cabinet Grotesk / JetBrains Mono / IBM Plex Sans.
- **Scheduler**: single asyncio loop (30s tick), runs HTTP/HTTPS/Ping/TCP checks + SSH pulls per server interval, and SSL/WHOIS every 6h. Retention: 7 days.
- **Alerts**: fired on up→down transitions and when SSL/domain days_remaining ≤ warn threshold.

## Implemented (2026-09-22)
- JWT auth (cookie + Bearer), admin seeded from env.
- Servers CRUD + force-check + 24h history + latency chart.
- Lightweight agent endpoint `/api/agent/metrics` with per-server token.
- Agentless SSH metrics via paramiko (CPU/MEM/DISK/load/uptime).
- Domains + SSL certificate checks + WHOIS registrar expiry checks.
- Credential vault (hosting panels / cloud / SSL / SSH keys / DB / API keys), search + filter + copy + reveal.
- Notes editor (title + long-form).
- Alert routing: Resend email (managed) + generic webhook, configurable thresholds, test-send button.
- Activity feed, dashboard summary tiles, terminal-grade dark UI.

## Backlog (P1)
- Public status page (share subset of servers/domains).
- Multi-recipient email + per-server alert overrides.
- Historic uptime graph over 7/30 days on the dashboard.
- Import/export JSON (backup / restore).

## Backlog (P2)
- Auth two-factor.
- Encrypted-at-rest vault (Fernet with env master key).
- Multi-user roles + audit log.
- Prometheus-compatible `/metrics` export.
