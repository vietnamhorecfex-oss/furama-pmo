-- Furama PMO — PostgreSQL DDL (review/portability copy; Prisma schema is the source of truth)
-- Target: PostgreSQL 16. Apply enums, tables, constraints, indexes.

BEGIN;

CREATE TYPE project_status   AS ENUM ('PLANNING','ACTIVE','OPENING','CLOSED','ARCHIVED');
CREATE TYPE member_role      AS ENUM ('OWNER','PM','LEAD','MEMBER','VIEWER');
CREATE TYPE workstream_track AS ENUM ('PMO','MARKETING','OPERATIONS');
CREATE TYPE task_status      AS ENUM ('NOT_STARTED','IN_PROGRESS','IN_REVIEW','BLOCKED','COMPLETED');
CREATE TYPE priority         AS ENUM ('CRITICAL','HIGH','MEDIUM','LOW');
CREATE TYPE assignment_role  AS ENUM ('IN_CHARGE','SUPPORT','APPROVER');
CREATE TYPE milestone_type   AS ENUM ('MILESTONE','GATE');
CREATE TYPE gate_status      AS ENUM ('PENDING','PASSED','FAILED','NA');

CREATE TABLE organization (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_color  TEXT NOT NULL DEFAULT '#2F80ED',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);
CREATE INDEX idx_user_org ON app_user(org_id);

CREATE TABLE project (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  location       TEXT,
  status         project_status NOT NULL DEFAULT 'PLANNING',
  start_date     TIMESTAMPTZ,
  end_date       TIMESTAMPTZ,
  opening_date   TIMESTAMPTZ,
  budget_cap_vnd BIGINT NOT NULL DEFAULT 0 CHECK (budget_cap_vnd >= 0),
  created_by_id  TEXT REFERENCES app_user(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at    TIMESTAMPTZ
);
CREATE INDEX idx_project_org ON project(org_id);

CREATE TABLE project_member (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role         member_role NOT NULL DEFAULT 'VIEWER',
  member_label TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
CREATE INDEX idx_member_user ON project_member(user_id);

CREATE TABLE workstream (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  track      workstream_track NOT NULL DEFAULT 'PMO',
  "order"    INT NOT NULL DEFAULT 0,
  UNIQUE (project_id, name)
);

CREATE TABLE member_workstream (
  id                TEXT PRIMARY KEY,
  project_member_id TEXT NOT NULL REFERENCES project_member(id) ON DELETE CASCADE,
  workstream_id     TEXT NOT NULL REFERENCES workstream(id) ON DELETE CASCADE,
  UNIQUE (project_member_id, workstream_id)
);

CREATE TABLE phase (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  "order"    INT NOT NULL DEFAULT 0,
  start_date TIMESTAMPTZ,
  end_date   TIMESTAMPTZ,
  UNIQUE (project_id, name)
);

CREATE TABLE status_def (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#94A3B8',
  "order"     INT NOT NULL DEFAULT 0,
  is_terminal BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (project_id, key)
);

CREATE TABLE priority_def (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#7A8B99',
  "order"    INT NOT NULL DEFAULT 0,
  UNIQUE (project_id, key)
);

CREATE TABLE budget_category (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  owner_label TEXT,
  planned_vnd BIGINT NOT NULL DEFAULT 0 CHECK (planned_vnd >= 0),
  "order"     INT NOT NULL DEFAULT 0,
  UNIQUE (project_id, name)
);

CREATE TABLE task (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code               TEXT NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT,
  phase_id           TEXT REFERENCES phase(id) ON DELETE SET NULL,
  workstream_id      TEXT REFERENCES workstream(id) ON DELETE SET NULL,
  category           TEXT,
  budget_category_id TEXT REFERENCES budget_category(id) ON DELETE SET NULL,
  start_date         TIMESTAMPTZ,
  deadline           TIMESTAMPTZ,
  duration_days      INT,
  priority           priority NOT NULL DEFAULT 'MEDIUM',
  status             task_status NOT NULL DEFAULT 'NOT_STARTED',
  percent            INT NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  budget_vnd         BIGINT NOT NULL DEFAULT 0 CHECK (budget_vnd >= 0),
  actual_vnd         BIGINT NOT NULL DEFAULT 0 CHECK (actual_vnd >= 0),
  kpi                TEXT,
  deliverable        TEXT,
  dependency_text    TEXT,
  risk_text          TEXT,
  audience           TEXT,
  notes              TEXT,
  in_charge_label    TEXT,
  created_by_id      TEXT REFERENCES app_user(id),
  updated_by_id      TEXT REFERENCES app_user(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);
CREATE INDEX idx_task_proj_status     ON task(project_id, status);
CREATE INDEX idx_task_proj_deadline   ON task(project_id, deadline);
CREATE INDEX idx_task_proj_phase      ON task(project_id, phase_id);
CREATE INDEX idx_task_proj_workstream ON task(project_id, workstream_id);

CREATE TABLE task_assignment (
  id      TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES app_user(id) ON DELETE SET NULL,
  label   TEXT NOT NULL,
  role    assignment_role NOT NULL DEFAULT 'IN_CHARGE'
);
CREATE INDEX idx_assign_task ON task_assignment(task_id);
CREATE INDEX idx_assign_user ON task_assignment(user_id);

CREATE TABLE task_dependency (
  id                 TEXT PRIMARY KEY,
  task_id            TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  UNIQUE (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE TABLE comment (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comment_task ON comment(task_id, created_at);

CREATE TABLE milestone (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  date       TIMESTAMPTZ,
  type       milestone_type NOT NULL DEFAULT 'MILESTONE',
  status     gate_status NOT NULL DEFAULT 'PENDING',
  criteria   JSONB,
  notes      TEXT
);
CREATE INDEX idx_milestone_proj ON milestone(project_id);

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  project_id  TEXT REFERENCES project(id) ON DELETE SET NULL,
  actor_id    TEXT REFERENCES app_user(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  before      JSONB,
  after       JSONB,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_proj_time   ON audit_log(project_id, created_at);
CREATE INDEX idx_audit_entity      ON audit_log(entity_type, entity_id);
-- Enforce append-only at the DB level by granting the app role only INSERT/SELECT on audit_log.

CREATE TABLE refresh_token (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  family_id      TEXT NOT NULL,
  token_hash     TEXT NOT NULL UNIQUE,
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  replaced_by_id TEXT,
  created_by_ip  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user   ON refresh_token(user_id);
CREATE INDEX idx_refresh_family ON refresh_token(family_id);

COMMIT;
