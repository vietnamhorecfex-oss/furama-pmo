# 06 — Security Design

Security is a Definition-of-Done gate for every feature. This document is normative.

## 1. Authentication
- **Password hashing:** Argon2id (memory ≥ 19 MiB, iterations ≥ 2, parallelism ≥ 1). Never store or log plaintext.
- **Tokens:** short-lived **access JWT** (15 min, signed RS256 or HS256 with rotated secret) carrying `sub, orgId, jti`. **Refresh token** opaque, stored hashed (SHA-256) with a `familyId`.
- **Refresh rotation + theft detection:** each refresh issues a new token and revokes the previous; if a revoked/old token is presented, revoke the entire family and force re-login.
- **Cookies:** refresh in `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. Access token kept in memory (not localStorage).
- **No user enumeration:** login/reset return generic messages; constant-time compare.
- **Brute-force:** Redis rate limit + exponential backoff per account/IP; optional lockout after N failures.

## 2. Authorization (RBAC) — enforcement model
- Authorization happens **server-side only**; the SPA's hiding of buttons is UX, not security.
- Pattern: `@UseGuards(JwtAuthGuard, ProjectMemberGuard)` + a `@RequireCapability('task.edit')` decorator resolved by `RbacService.assertCan(ctx, capability, resource)`.
- **Resource scoping is mandatory:** loading the resource, then checking ownership/scope (LEAD↔workstream, MEMBER↔assignee) — never trust IDs from the client as authorization.
- Map every cell of the RBAC matrix (`docs/03 §2`) to a policy function; **each deny path has a test** (`docs/07`).
- **IDOR prevention:** every `/:id` handler verifies the resource belongs to a project the caller is a member of, in the same query (`where: { id, project: { members: { some: { userId } } } }`).

## 3. Input validation & output encoding
- Validate all input with zod at the boundary; **strict** parsing rejects unknown fields; coerce/limit lengths and ranges.
- Prisma parameterizes all queries → SQL injection class eliminated; **never** use `$queryRawUnsafe` with interpolation.
- Sanitize rich text/comments (strip HTML or store as text, render escaped). React escapes by default; avoid `dangerouslySetInnerHTML`.
- File uploads (if attachments added): validate type/size, store in object storage with random keys, scan, never serve from app origin with executable content-type.

## 4. OWASP Top-10 mapping

| Risk | Mitigation |
|---|---|
| A01 Broken Access Control | Server-side RBAC + resource scoping + IDOR query guards + deny-path tests |
| A02 Cryptographic Failures | Argon2id, TLS everywhere, hashed refresh tokens, secrets from manager, no secrets in logs |
| A03 Injection | Prisma parameterization, zod validation, no raw SQL interpolation, output escaping |
| A04 Insecure Design | Threat model (§6), least privilege, append-only audit, gates on mutations |
| A05 Security Misconfiguration | `helmet`, strict CORS allowlist, disabled stack traces in prod, env validation at boot |
| A06 Vulnerable Components | `pnpm audit`/Dependabot in CI, pin versions, fail build on high CVEs |
| A07 Auth Failures | Rotation, lockout/backoff, no enumeration, secure cookies, short access TTL |
| A08 Integrity Failures | Signed JWT, CI provenance, lockfiles, import validation |
| A09 Logging/Monitoring | Structured logs w/ request IDs, audit log, alert on authz failures spike |
| A10 SSRF | No user-supplied URLs fetched server-side; if added, allowlist + block internal ranges |

## 5. Transport, headers, CORS
- HTTPS only; HSTS at edge. `helmet` for security headers (CSP, X-Content-Type-Options, frame-ancestors 'none').
- CORS: explicit origin allowlist (web app domains), credentials true, methods/headers minimal.
- CSP: default-src 'self'; connect-src API + WSS; no inline scripts (nonce if needed).

## 6. Threat model (STRIDE, key entries)

| Threat | Vector | Control |
|---|---|---|
| **S**poofing | Stolen refresh token | Rotation + family revocation; Secure/httpOnly cookie; short access TTL |
| **T**ampering | Editing another workstream's task | Resource-scoped RBAC + audit |
| **R**epudiation | "I didn't change that" | Append-only audit with actor, ip, before/after |
| **I**nfo disclosure | IDOR across projects | Membership-scoped queries on every read |
| **D**oS | Login flooding / heavy aggregation | Rate limits, pagination caps, indexed queries, query timeouts |
| **E**levation | Member self-promoting to PM | Role changes restricted to OWNER/PM; cannot remove last OWNER; server-enforced |

## 7. Auditing & monitoring
- Every mutating service writes `audit_log` (actor, action, entityType/id, before/after, ip, ua) inside the same transaction.
- `audit_log` is append-only: grant the application DB role only `INSERT, SELECT` on it.
- Emit metrics/alerts on: spikes in 401/403, refresh-family revocations, failed-login rates, 5xx.

## 8. Secrets & configuration
- All secrets via env/secret manager; validated at boot (fail fast). `.env` never committed (`.env.example` only).
- Separate secrets per environment; rotate JWT signing keys with key-id support.
- DB least privilege: app role cannot DROP/ALTER; migrations run with a separate migration role.

## 9. Data protection & privacy
- PII = user name/email. Encrypt at rest (managed Postgres), TLS in transit.
- Export endpoints OWNER/PM only and audited.
- Soft-delete projects to preserve audit; hard-delete only via admin runbook with backup.
- Retention: audit logs retained ≥ 1 year; refresh tokens pruned after expiry.

## 10. Security test hooks (see `docs/07 §Security`)
- Authz bypass / IDOR tests for every protected route.
- Token reuse test (revoked refresh → family revoked).
- Rate-limit test on auth endpoints.
- Validation/injection fuzz on task & comment inputs.
- CORS/headers assertions.
