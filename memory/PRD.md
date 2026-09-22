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

## Iteration 2 — 2026-09-22
- Public shareable status page at `/status/:slug` (only public-flagged servers/domains; activity filtered to public server ids).
- Uptime History bars on Dashboard (7d / 30d) with per-day colored buckets.
- Backup Export & Import (JSON) for servers/domains/credentials/notes/settings.
- Weekly Digest email (manual "send now" button) with per-server 7d uptime, upcoming SSL/domain expirations, incident feed.
- **SMTP configuration** in Settings: use your own mail server (host/port/user/pass/from/STARTTLS), falls back to managed Resend.
- **Multiple webhooks** (name + url + enabled) instead of single URL; test endpoint returns per-webhook result.
- **Richer alerts**: high CPU / MEM / DISK / latency + recovery emails, with state debouncing on the server document.
- Public toggle on each server and domain.
- Per-metric thresholds in Settings: SSL / domain / latency / CPU / MEM / DISK.

## Iteration 3 — 2026-09-22
- **Slack / Discord webhook templates**: each webhook has a `format` (json | slack | discord). Slack → header + field blocks with colour attachment; Discord → colour-coded embed with fields. Test-send reports per-webhook format.
- **Per-server alert overrides**: `alerts_muted` (suppresses email + webhooks, events still logged) and `alert_overrides` {cpu_warn_pct, mem_warn_pct, disk_warn_pct, latency_warn_ms} (null = global). Mute button + rules panel on server detail; form fields in Add/Edit dialog.
- **Incident comments**: `POST/DELETE /api/activity/{id}/comments[/{cid}]`. Dashboard activity feed lets operator post/delete updates; public status page shows comments (sanitized: no author/meta) under each event with timestamps.
- Fixed invisible text on Settings outline buttons (Add webhook / Export / Import).

## Backlog (P1)
- Multi-recipient email.
- Scheduled maintenance windows (auto-mute for a time range).
- Comments on the Domains/SSL events surfaced on Domains page.

## Backlog (P2)
- Auth two-factor.
- Encrypted-at-rest vault (Fernet with env master key).
- Multi-user roles + audit log.
- Prometheus-compatible `/metrics` export.
