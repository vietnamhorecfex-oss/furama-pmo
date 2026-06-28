# 05 — Data Flows & Workflows

Diagrams below are the behavioral contract. Implement flows to match; tests in `docs/07` reference these.

## 1. End-to-end data flow (context)

```mermaid
flowchart LR
  U[User in browser] -->|HTTPS| API[NestJS API]
  API -->|validate DTO zod| V{Valid?}
  V -- no --> E1[400 VALIDATION]
  V -- yes --> AZ{RBAC allow?}
  AZ -- no --> E2[403 FORBIDDEN]
  AZ -- yes --> SVC[Service logic + invariants]
  SVC --> TX[(Prisma transaction)]
  TX --> AUD[(audit_log INSERT)]
  TX --> DB[(PostgreSQL)]
  SVC --> RT[WS broadcast to project room]
  SVC --> R[200/201 + DTO]
  RT --> U2[Other members' browsers refetch/patch]
```

## 2. Login + refresh rotation (sequence)

```mermaid
sequenceDiagram
  participant C as Client
  participant A as API/Auth
  participant R as Redis
  participant DB as Postgres
  C->>A: POST /auth/login {email,password}
  A->>DB: find user by (org,email)
  A->>A: Argon2id verify (constant-time)
  alt invalid
    A-->>C: 401 (generic, no enumeration)
  else valid
    A->>DB: insert refresh_token {familyId, hash}
    A->>R: cache session meta
    A-->>C: 200 {accessToken 15m} + Set-Cookie refresh(7d, httpOnly,Secure,SameSite=Strict)
  end
  Note over C,A: later, access expires
  C->>A: POST /auth/refresh (cookie)
  A->>DB: lookup token by hash
  alt token revoked/reused
    A->>DB: revoke entire family
    A-->>C: 401 (force re-login)
  else valid
    A->>DB: rotate (revoke old, insert new, link replacedBy)
    A-->>C: 200 {accessToken} + new cookie
  end
```

## 3. RBAC authorization decision (flowchart)

```mermaid
flowchart TD
  S[Request with capability + resource] --> M{Member of project?}
  M -- no --> D1[403]
  M -- yes --> RGet[role = effectiveRole]
  RGet --> OW{role in OWNER,PM?}
  OW -- yes --> A1[ALLOW - full]
  OW -- no --> CAP{capability type}
  CAP -- read/comment --> A2[ALLOW if not viewer-restricted]
  CAP -- task write/create --> LD{role == LEAD?}
  LD -- yes --> WS{task.workstream in lead scope?}
  WS -- yes --> A3[ALLOW]
  WS -- no --> D2[403]
  LD -- no --> MB{role == MEMBER and progress-only?}
  MB -- yes --> AS{caller is assignee?}
  AS -- yes --> A4[ALLOW progress fields only]
  AS -- no --> D3[403]
  MB -- no --> D4[403]
```

## 4. Task progress update + realtime (sequence)

```mermaid
sequenceDiagram
  participant C as Client (Lead/Member)
  participant API as TaskService
  participant DB as Postgres
  participant WS as WS Gateway
  C->>API: PATCH /tasks/:id/progress {status, percent}
  API->>API: assertCan(updateProgress, task)
  API->>API: apply invariants (status<->percent)
  API->>DB: BEGIN; update task; insert audit; COMMIT
  API->>WS: emit task.progress to project:{pid}
  API-->>C: 200 {task}
  WS-->>C: (others) patch board/list optimistic cache
```

## 5. Seed / Excel import pipeline (flowchart)

```mermaid
flowchart LR
  X[Excel workbooks] -->|offline extract| J[tasks.seed.json packed cols+rows]
  J --> IMP[ImportExportService.importPackedSeed]
  IMP --> P{phase exists?}
  P -- no --> NP[create Phase order++]
  P -- yes --> CW{workstream exists?}
  NP --> CW
  CW -- no --> NW[create Workstream track from PMO/MKT/OPS]
  CW -- yes --> UP[upsert Task by projectId+code]
  NW --> UP
  UP --> AS[create TaskAssignment from inCharge/support/approver labels]
  AS --> LK[link assignment.userId by member.memberLabel if match]
  LK --> AU[audit: import batch summary]
```

## 6. Budget rollup (data flow)

```mermaid
flowchart TD
  T[(task.budget_vnd, actual_vnd)] --> AG[GROUP BY workstream / category]
  BC[(budget_category.planned_vnd)] --> SUMP[sum planned]
  AG --> COMM[committed = sum budget_vnd]
  AG --> ACT[actual = sum actual_vnd]
  CAP[(project.budget_cap_vnd)] --> CHK{planned/committed/actual > cap?}
  SUMP --> CHK
  COMM --> CHK
  ACT --> CHK
  CHK -- yes --> FLAG[overCap flag + category overruns >10%]
  CHK -- no --> OK[within cap]
  FLAG --> DASH[Dashboard budget widget]
  OK --> DASH
```

## 7. Go/No-Go gate state machine

```mermaid
stateDiagram-v2
  [*] --> PENDING
  PENDING --> PASSED: OWNER/PM approve (criteria met)
  PENDING --> FAILED: criteria not met
  FAILED --> PENDING: remediation, re-review
  PASSED --> [*]
  PENDING --> NA: gate not applicable
```
Gate readiness is computed from linked tasks (e.g., "Ads live, QR active, POSM in production"): the UI shows % of criteria tasks `COMPLETED`; only OWNER/PM may set `PASSED`/`FAILED`.

## 8. Task lifecycle (state)

```mermaid
stateDiagram-v2
  [*] --> NOT_STARTED
  NOT_STARTED --> IN_PROGRESS: percent>0
  IN_PROGRESS --> IN_REVIEW: submit for review
  IN_PROGRESS --> BLOCKED: blocker raised
  IN_REVIEW --> COMPLETED: approver accepts (percent=100)
  IN_REVIEW --> IN_PROGRESS: changes requested
  BLOCKED --> IN_PROGRESS: unblocked
  COMPLETED --> IN_PROGRESS: reopened (audit-logged)
```
