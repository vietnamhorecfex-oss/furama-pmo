# Furama PMO — Restaurant Opening Project Management System

A multi-tenant system for managing restaurant (or **restaurant-cluster**) opening projects: timeline, tasks, RBAC, budget control, Go/No-Go gates, and real-time collaboration for Owner / PM / Leads / Members.

> This repository is a **handoff spec package** for [Claude Code](https://www.anthropic.com/claude-code) to implement the database, backend, frontend, tests, and security hardening. A working single-file HTML prototype already exists and is the source of the data model and UX. Real seed data (628 tasks across 3 workstream tracks) is included in `db/seed/tasks.seed.json`.

---

## What we are building

| | |
|---|---|
| **Domain** | Pre-opening program management for hospitality F&B venues |
| **Core value** | One shared source of truth where Owner/PM see health, Leads manage their workstream, Members update assigned tasks, all role-gated |
| **Scale target** | Multiple organizations → multiple restaurant projects → ~600–1,000 tasks per project |
| **Hand-off goal** | A production-ready, tested, secured web app deployable via Docker |

## Recommended stack (see `docs/01-system-design.md`)

- **Backend:** NestJS + TypeScript, Prisma ORM, PostgreSQL 16, REST + WebSocket
- **Auth:** JWT access + rotating refresh (httpOnly cookie), Argon2 password hashing, role + resource-scoped RBAC
- **Frontend:** React + Vite + TypeScript, TanStack Query, Tailwind, Zustand
- **Tests:** Jest + Supertest (API), Vitest + Testing Library (UI), Playwright (E2E), Testcontainers (DB)
- **Infra:** Docker Compose (dev), env-config, GitHub Actions CI

## Document index — read in this order

| # | File | Purpose |
|---|------|---------|
| 0 | `CLAUDE.md` | **Start here.** Build rules, commands, conventions, Definition of Done for Claude Code |
| 1 | `docs/01-system-design.md` | Architecture, components, tech stack, NFRs, deployment, C4 diagrams |
| 2 | `docs/02-data-model.md` | ERD, entity descriptions, enums, indexes, constraints |
| 3 | `docs/03-functional-spec.md` | Feature modules, user stories, acceptance criteria, full function catalog, RBAC matrix |
| 4 | `docs/04-api-spec.md` | REST endpoint catalog + WebSocket events (mirrors `api/openapi.yaml`) |
| 5 | `docs/05-workflows.md` | Data-flow & sequence diagrams (auth, RBAC, task update, seed import, budget rollup, gates) |
| 6 | `docs/06-security.md` | Threat model, OWASP Top-10 mitigations, authz enforcement, audit, secrets |
| 7 | `docs/07-test-plan.md` | Test strategy, coverage targets, concrete test cases, CI |
| 8 | `docs/08-build-roadmap.md` | Milestone-by-milestone backlog for implementation |
| 9 | `docs/09-ai-assistant.md` | Embedded AI (config help, staff guidance, conversational updates, overdue alerts) — permission-bounded agent |

## Concrete artifacts

- `prisma/schema.prisma` — runnable Prisma schema (source of truth for the DB)
- `db/schema.sql` — equivalent PostgreSQL DDL for review/portability
- `db/seed/tasks.seed.json` — **real** project data (columnar packed: `{cols, rows}`)
- `api/openapi.yaml` — OpenAPI 3.1 contract
- `ai/tools.json` — Claude tool-use schemas for the embedded assistant (mapped to services + RBAC)
- `ai/system-prompt.md` — assistant system prompt with safety/anti-injection rules
- `.env.example`, `docker-compose.yml` — local bootstrap

## Quick start (target state after implementation)

```bash
cp .env.example .env
docker compose up -d          # postgres + redis
pnpm install
pnpm prisma migrate dev       # apply schema
pnpm db:seed                  # load real Furama data from db/seed
pnpm dev                      # api :3000  +  web :5173
pnpm test                     # unit + integration
pnpm test:e2e                 # Playwright
```
