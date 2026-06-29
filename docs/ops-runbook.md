# Ops Runbook — Furama PMO

This document covers the operational procedures for running the Furama PMO system in production.

## 1. Service architecture

| Service | Technology | Default port | Notes |
|---|---|---|---|
| API | NestJS + Node 20 | 3000 | Stateless; scale horizontally |
| Web | Static files (Vite build) | 443 (via CDN) | Served from CDN/object storage |
| Database | PostgreSQL 16 | 5432 | Primary + read replica |
| Cache / Session | Redis 7 | 6379 | Throttle state; refresh token family tracking |

## 2. Environment variables (required at boot)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (must match migration role) |
| `JWT_ACCESS_SECRET` | ≥ 32-char random secret for signing access JWTs |
| `WEB_ORIGIN` | CORS allowlist (e.g. `https://pmo.furama.vn`) |
| `REDIS_URL` | Redis URL for throttle adapter |
| `COOKIE_SECURE` | `true` in production (requires HTTPS) |
| `REFRESH_TTL_DAYS` | Refresh token lifetime in days (default 7) |

All variables are validated at boot (`validateEnv` in `backend/src/config/env.ts`). The app refuses to start if any required variable is missing or invalid.

**Never commit `.env` to git.** Use `.env.example` as a template. See `CLAUDE.md §secrets`.

## 3. Database migrations

### Applying migrations in production

```bash
# Run from repo root with MIGRATION_DATABASE_URL pointing to the migration role
DATABASE_URL="$MIGRATION_DATABASE_URL" \
  pnpm exec prisma migrate deploy --schema ./prisma/schema.prisma
```

The `migrate deploy` command:
- Applies all pending migrations in order
- Never auto-generates new migrations (safe for production)
- Is idempotent — safe to run on every deploy

### Rollback
Prisma does not support automatic rollback. If a migration causes an issue:
1. Take a snapshot of the DB (see §4 backup procedure)
2. Manually revert the DDL change
3. Update `_prisma_migrations` to mark the migration as rolled back
4. Deploy the reverted code

### Migration role vs app role
- **Migration role**: `furama_migrate` — `CREATE TABLE`, `ALTER TABLE`, `DROP INDEX`, full DDL
- **App role**: `furama_app` — `SELECT`, `INSERT`, `UPDATE`, `DELETE` only; **no DDL**
- `audit_log` table: `furama_app` has only `INSERT, SELECT` (append-only enforced at DB level)

## 4. Backup and restore

### Automated backup (daily)

```bash
#!/bin/bash
# /etc/cron.d/furama-backup — runs at 02:00 daily
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/furama-pmo"
FILENAME="$BACKUP_DIR/furama_${TIMESTAMP}.dump"

pg_dump \
  --format=custom \
  --compress=9 \
  --no-acl \
  --no-owner \
  "$DATABASE_URL" \
  -f "$FILENAME"

# Upload to object storage
aws s3 cp "$FILENAME" "s3://furama-backups/postgres/$TIMESTAMP.dump"

# Retain 30 days locally
find "$BACKUP_DIR" -name "*.dump" -mtime +30 -delete
```

### Restore from backup

```bash
# 1. Stop the API to prevent writes during restore
systemctl stop furama-api

# 2. Create a fresh DB (or restore to a staging DB first to verify)
createdb furama_pmo_restore

# 3. Restore
pg_restore \
  --format=custom \
  --no-acl \
  --no-owner \
  --dbname="postgresql://furama_migrate:$MIGRATE_PW@localhost/furama_pmo_restore" \
  /path/to/backup.dump

# 4. Verify row counts
psql "$DATABASE_URL" -c "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10;"

# 5. Promote restore DB to production (blue/green swap or rename)
# 6. Restart API
systemctl start furama-api
```

### Audit log retention
Audit logs must be retained ≥ 1 year (docs/06 §9). The `audit_log` table is append-only. Archive rows older than 365 days to cold storage before pruning:

```sql
-- Archive (run before deleting)
COPY (SELECT * FROM audit_log WHERE "createdAt" < NOW() - INTERVAL '365 days')
  TO '/backups/audit_archive_YYYYMM.csv' CSV HEADER;

-- Prune after verifying archive
DELETE FROM audit_log WHERE "createdAt" < NOW() - INTERVAL '365 days';
```

## 5. Deploy procedure

### Zero-downtime deploy (blue/green)

1. Build new Docker image
2. Start new containers alongside existing ones (health check: `GET /health` → 200)
3. Update load balancer to route to new containers
4. Drain old containers (grace period 30s for in-flight requests)
5. Run migrations if any (before switching traffic when additive; after if destructive)
6. Verify `/ready` returns 200 (DB connectivity confirmed)

### Rollback
```bash
# Point load balancer back to previous image tag
docker service update --image furama-api:prev furama_api
# OR
kubectl set image deployment/furama-api api=furama-api:PREVIOUS_TAG
```

## 6. Observability

### Structured logs
The API emits JSON logs via Pino. Each log line includes:
- `req.id` — unique request ID (from `x-request-id` header or auto-generated)
- `req.method`, `req.url`, `res.statusCode`, `responseTime`
- Sensitive fields are redacted: `req.headers.authorization`, `req.headers.cookie`

**Log aggregation**: pipe stdout to Loki / Elasticsearch / CloudWatch depending on infra.

### Key metrics to alert on
| Metric | Alert threshold | Meaning |
|---|---|---|
| HTTP 401 rate | > 50/min | Possible credential stuffing |
| HTTP 403 rate | > 20/min | Possible IDOR sweep or broken client |
| Refresh family revocations | > 5/min | Token theft detection firing |
| Failed login rate per IP | > 10/min | Brute force, rate limiter active |
| 5xx rate | > 1% of requests | App errors |
| DB connection wait time | > 500ms p95 | Pool exhaustion, query slowdown |

### Health endpoints
- `GET /health` — 200 always (liveness probe)
- `GET /ready` — 200 when DB is reachable (readiness probe); 503 if DB is down

### Query performance
Slow queries (> 1s) are logged by Pino HTTP with `responseTime`. Identify bottlenecks with:
```sql
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC LIMIT 20;
```

## 7. Security operations

### Rotating JWT secret
1. Add new secret as `JWT_ACCESS_SECRET_NEW` in environment
2. Update `tokens.service.ts` to accept both old and new secrets during transition
3. Deploy; all new tokens signed with new secret; old tokens valid until TTL (15min) expires
4. After 15 min, remove old secret from code and environment
5. Redeploy; rotation complete

### Investigating a refresh token theft alert
1. Query `audit_log` for `auth.refresh_family_revoked` events
2. Identify `familyId`; look up all `RefreshToken` rows for that family
3. Note IP addresses and user agent of the rogue request vs the legitimate one
4. Notify the affected user; they will be forced to re-login (family is revoked)
5. If pattern is widespread, enable rate limit alert and consider IP block

### Hard-deleting user data (GDPR / data subject request)
```sql
-- Back up first! Then:
BEGIN;
DELETE FROM audit_log WHERE "actorId" = '<userId>';  -- if allowed by retention policy
DELETE FROM "User" WHERE id = '<userId>';
-- Cascade handles RefreshToken, TaskAssignment, Comment.authorId (set null) rows
COMMIT;
```
Note: `Comment.authorId` is nullable in the schema; set to NULL rather than deleting comments to preserve audit context.

## 8. pnpm audit gate
Run before every release:
```bash
pnpm audit --audit-level=high
```
Fix or accept-override any HIGH/CRITICAL CVEs. Use `pnpm audit --fix` for semver-safe updates.
If a dependency cannot be updated, document the exception in `docs/CHANGELOG.md` with a risk assessment.
