# Next.js Refactor — Phase 0+1 (Foundation: Scaffold + Auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `web/` into a Next.js App Router app and port the authentication subsystem (JWT access + refresh rotation + family-revoke + argon2 + RBAC) from NestJS into Next.js server code, so a user can register, log in, refresh, and log out against the real Postgres DB.

**Architecture:** Single Next.js (App Router) app at `web/`. Server logic lives under `web/src/server/` as plain modules that import singleton `prisma` and `config`. REST behavior is preserved via route handlers under `app/api/v1/**` that mirror `api/openapi.yaml`. The refresh token stays in an httpOnly cookie; the access token is returned in JSON and attached as `Authorization: Bearer` by the client (faithful to the current SPA). `shared/` (`@furama/shared`) stays a workspace package.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript 5, Prisma 5, PostgreSQL, zod (via `@furama/shared`), `jsonwebtoken`, `argon2`, TanStack Query 5, Tailwind 3, Vitest.

## Global Constraints

- Package manager: **npm workspaces** (`shared`, `backend`, `web`). Run workspace scripts with `npm run <s> -w @furama/web`.
- Money: VND as `BigInt`. Dates: `timestamptz` UTC. IDs: `cuid()`. (No money/date work in this plan, but keep the rules.)
- Validation: zod schemas from `@furama/shared` at every boundary; reject unknown fields (`.strip()` already applied in schemas).
- Errors: never leak stack traces / Prisma messages; always emit the `ApiError` envelope `{ error: { code, message, requestId } }`.
- Error codes (status → code): 400→`VALIDATION`, 401→`UNAUTHORIZED`, 403→`FORBIDDEN`, 404→`NOT_FOUND`, 409→`CONFLICT`, 429→`RATE_LIMITED`, ≥500→`INTERNAL`.
- Refresh cookie name: `furama_refresh`, `httpOnly`, `sameSite: 'strict'`, `path: '/'`, `secure` = `COUNFIG.COOKIE_SECURE`.
- Backend dev port stays `3001` until `backend/` is deleted in a later phase; the new Next.js app runs on `3000` only after the unrelated `next-server` on `:3000` is no longer an issue — **for this plan the Next.js dev server runs on `:3002`** (`next dev -p 3002`) to avoid the occupied `:3000` and the live NestJS on `:3001`.
- Audit: every mutation calls `auditRecord(...)`. (Auth register/login already audit; keep those calls.)
- DB access only in `web/src/server/**`. Never call Prisma from a component or route handler body directly — go through a server module.

---

## File Structure (created in this plan)

```
web/
  package.json                      # MODIFY: Vite deps → Next deps
  next.config.mjs                   # CREATE
  tsconfig.json                     # MODIFY: Next settings
  postcss.config.js                 # KEEP (Tailwind)
  tailwind.config.js                # MODIFY: content globs for app/
  src/
    app/
      layout.tsx                    # CREATE: root layout + Providers
      page.tsx                      # CREATE: redirect → /login (temporary)
      providers.tsx                 # CREATE: TanStack Query client provider ('use client')
      globals.css                   # CREATE: Tailwind directives
      login/page.tsx                # CREATE: login form (Phase 1)
      api/
        health/route.ts             # CREATE
        ready/route.ts              # CREATE
        v1/auth/login/route.ts      # CREATE (Phase 1)
        v1/auth/refresh/route.ts    # CREATE (Phase 1)
        v1/auth/logout/route.ts     # CREATE (Phase 1)
        v1/auth/register/route.ts   # CREATE (Phase 1)
        v1/auth/me/route.ts         # CREATE (Phase 1)
    middleware.ts                   # CREATE (Phase 1): refresh-cookie gate
    server/
      config.ts                     # CREATE: validateEnv + getConfig() singleton
      prisma.ts                     # CREATE: Prisma singleton
      http/
        errors.ts                   # CREATE: ApiException classes
        envelope.ts                 # CREATE: toErrorResponse + route() wrapper
      auth/
        passwords.ts                # CREATE: argon2 hash/verify/needsRehash
        tokens.ts                   # CREATE: port of TokensService
        session.ts                  # CREATE: getAuthContext/requireAuth from Bearer
        cookies.ts                  # CREATE: set/clear refresh cookie on NextResponse
        service.ts                  # CREATE: register/login/refresh/logout/getMe
      rbac/
        capability.ts               # CREATE: verbatim CAPABILITY_MATRIX + roleHasCapability
        rbac.ts                     # CREATE: port of RbacService
      audit/
        audit.ts                    # CREATE: auditRecord(...) (minimal port)
    lib/
      api-client.ts                 # MODIFY/CREATE: fetch wrapper w/ Bearer + refresh retry
      auth-store.ts                 # MODIFY/CREATE: zustand access-token + user (in-memory)
      query-client.ts               # CREATE: QueryClient factory
```

---

## PHASE 0 — Scaffold Next.js

### Task 0.1: Switch `web/` from Vite to Next.js (app boots, `/` renders)

**Files:**
- Modify: `web/package.json`
- Create: `web/next.config.mjs`, `web/src/app/layout.tsx`, `web/src/app/page.tsx`, `web/src/app/globals.css`
- Modify: `web/tsconfig.json`, `web/tailwind.config.js`
- Delete: `web/vite.config.ts`, `web/index.html`

**Interfaces:**
- Produces: a running Next.js dev server on `:3002`; root layout importing `globals.css`.

- [ ] **Step 1: Replace Vite deps with Next in `web/package.json`**

Set `scripts` and `dependencies`/`devDependencies` (keep TanStack Query, zod, axios removal deferred):

```jsonc
{
  "name": "@furama/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3002",
    "build": "next build",
    "start": "next start -p 3002",
    "lint": "eslint \"src/**/*.{ts,tsx}\"",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "test:cov": "vitest run --coverage --passWithNoTests",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@furama/shared": "*",
    "@tanstack/react-query": "^5.51.23",
    "argon2": "^0.41.1",
    "jsonwebtoken": "^9.0.2",
    "next": "^14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zod": "^3.23.8",
    "zustand": "^4.5.4"
  },
  "devDependencies": {
    "@playwright/test": "^1.45.3",
    "@prisma/client": "5.22.0",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.41",
    "tailwindcss": "^3.4.9",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `web/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // shared/ is a workspace package compiled on the fly
  transpilePackages: ['@furama/shared'],
  experimental: { instrumentationHook: false },
};
export default nextConfig;
```

- [ ] **Step 3: Create `web/src/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Create `web/src/app/layout.tsx`**

```tsx
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata = { title: 'Furama PMO' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Create a temporary `web/src/app/page.tsx`**

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/login');
}
```

- [ ] **Step 6: Update `web/tailwind.config.js` content globs**

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 7: Replace `web/tsconfig.json` with Next settings**

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 8: Delete Vite files**

```bash
rm -f web/vite.config.ts web/index.html
```

- [ ] **Step 9: Create the Providers client component `web/src/app/providers.tsx`**

```tsx
'use client';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { makeQueryClient } from '../lib/query-client';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 10: Create `web/src/lib/query-client.ts`**

```ts
import { QueryClient } from '@tanstack/react-query';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 10_000, refetchOnWindowFocus: true, retry: 1 },
    },
  });
}
```

- [ ] **Step 11: Install and run the dev server**

Run: `npm install && npm run dev -w @furama/web`
Expected: `▲ Next.js 14.x` ... `Local: http://localhost:3002`, and visiting `/` 307-redirects to `/login` (404 page for `/login` is fine — it's built in Phase 1).

- [ ] **Step 12: Commit**

```bash
git add web/ package-lock.json
git commit -m "feat(web): scaffold Next.js App Router app (replaces Vite)"
```

---

### Task 0.2: Server config + Prisma singleton

**Files:**
- Create: `web/src/server/config.ts`, `web/src/server/prisma.ts`
- Test: `web/src/server/config.test.ts`

**Interfaces:**
- Produces: `getConfig(): AppConfig` (validated env, cached); `prisma` (PrismaClient singleton).
- `AppConfig` fields: `NODE_ENV, API_PORT, WEB_ORIGIN, DATABASE_URL, JWT_ACCESS_SECRET, JWT_ACCESS_TTL, REFRESH_TTL_DAYS, ARGON2_MEMORY_KIB, ARGON2_TIME_COST, ARGON2_PARALLELISM, COOKIE_SECURE, RATE_LIMIT_*, ANTHROPIC_API_KEY?, AI_MODEL_REASONING`.

- [ ] **Step 1: Write the failing test `web/src/server/config.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { validateEnv } from './config';

describe('validateEnv', () => {
  it('rejects when JWT secret is too short', () => {
    expect(() => validateEnv({ DATABASE_URL: 'postgresql://x@localhost/y', JWT_ACCESS_SECRET: 'short' }))
      .toThrow(/JWT_ACCESS_SECRET/);
  });
  it('applies defaults and coerces numbers', () => {
    const c = validateEnv({
      DATABASE_URL: 'postgresql://x@localhost/y',
      JWT_ACCESS_SECRET: 'x'.repeat(32),
    });
    expect(c.API_PORT).toBe(3000);
    expect(c.COOKIE_SECURE).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @furama/web -- config`
Expected: FAIL — cannot find `./config`.

- [ ] **Step 3: Implement `web/src/server/config.ts`** (port of `backend/src/config/env.ts`, minus `REDIS_URL`, plus `COOKIE_SECURE` transform)

```ts
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    WEB_ORIGIN: z.string().url().default('http://localhost:3002'),
    DATABASE_URL: z.string().url(),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
    JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
    REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
    ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(19456),
    ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),
    COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_WRITE_PER_MIN: z.coerce.number().int().positive().default(120),
    RATE_LIMIT_READ_PER_MIN: z.coerce.number().int().positive().default(600),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL_REASONING: z.string().default('claude-haiku-4-5-20251001'),
  })
  .strip();

export type AppConfig = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppConfig {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

let cached: AppConfig | null = null;
export function getConfig(): AppConfig {
  if (!cached) cached = validateEnv(process.env as Record<string, unknown>);
  return cached;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @furama/web -- config`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement `web/src/server/prisma.ts`** (serverless-safe singleton)

```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ log: ['warn', 'error'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export async function dbHealthy(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add web/src/server/config.ts web/src/server/config.test.ts web/src/server/prisma.ts
git commit -m "feat(web/server): env config validation + Prisma singleton"
```

---

### Task 0.3: Error envelope + `route()` wrapper + health/ready endpoints

**Files:**
- Create: `web/src/server/http/errors.ts`, `web/src/server/http/envelope.ts`
- Create: `web/src/app/api/health/route.ts`, `web/src/app/api/ready/route.ts`
- Test: `web/src/server/http/envelope.test.ts`

**Interfaces:**
- Produces:
  - `class ApiException extends Error { status: number }` and subclasses `BadRequest, Unauthorized, Forbidden, NotFound, Conflict` (constructors take `(message?: string)`).
  - `toErrorResponse(err: unknown): Response` — JSON `ApiError` envelope with the mapped status/code.
  - `route(fn: (req: Request, ctx: { params: Record<string,string> }) => Promise<Response>): typeof fn` — wraps a handler, converts thrown `ApiException`/zod errors/unknown into the envelope.

- [ ] **Step 1: Write the failing test `web/src/server/http/envelope.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { route } from './envelope';
import { Forbidden } from './errors';

const req = () => new Request('http://localhost/api/test', { method: 'POST' });

describe('route() error mapping', () => {
  it('maps ApiException to its status + code', async () => {
    const h = route(async () => { throw new Forbidden('nope'); });
    const res = await h(req(), { params: {} });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'nope', requestId: undefined } });
  });
  it('maps a ZodError to 400 VALIDATION', async () => {
    const h = route(async () => { z.object({ a: z.string() }).parse({}); return new Response(); });
    const res = await h(req(), { params: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION');
  });
  it('maps unknown errors to 500 INTERNAL without leaking the message', async () => {
    const h = route(async () => { throw new Error('db secret leaked'); });
    const res = await h(req(), { params: {} });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).not.toContain('db secret');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @furama/web -- envelope`
Expected: FAIL — cannot find `./envelope`.

- [ ] **Step 3: Implement `web/src/server/http/errors.ts`**

```ts
export class ApiException extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiException';
  }
}
export class BadRequest extends ApiException { constructor(m = 'Bad request') { super(400, m); } }
export class Unauthorized extends ApiException { constructor(m = 'Unauthorized') { super(401, m); } }
export class Forbidden extends ApiException { constructor(m = 'Forbidden') { super(403, m); } }
export class NotFound extends ApiException { constructor(m = 'Not found') { super(404, m); } }
export class Conflict extends ApiException { constructor(m = 'Conflict') { super(409, m); } }
```

- [ ] **Step 4: Implement `web/src/server/http/envelope.ts`** (port of `error.filter.ts` mapping)

```ts
import { ZodError } from 'zod';
import type { ApiError } from '@furama/shared';
import { ApiException } from './errors';

type ErrorCode = ApiError['error']['code'];

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
  404: 'NOT_FOUND', 409: 'CONFLICT', 429: 'RATE_LIMITED',
};

export function toErrorResponse(err: unknown, requestId?: string): Response {
  let status = 500;
  let message = 'An unexpected error occurred.';

  if (err instanceof ApiException) {
    status = err.status;
    message = err.message;
  } else if (err instanceof ZodError) {
    status = 400;
    message = err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  } else {
    // Unknown/internal: log server-side, return generic message.
    console.error('Unhandled error', err);
  }

  const code: ErrorCode = STATUS_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION');
  const payload: ApiError = { error: { code, message, requestId } };
  return Response.json(payload, { status });
}

type Handler = (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>;

export function route(fn: Handler): Handler {
  return async (req, ctx) => {
    const requestId = req.headers.get('x-request-id') ?? undefined;
    try {
      return await fn(req, ctx);
    } catch (err) {
      return toErrorResponse(err, requestId);
    }
  };
}
```

> NOTE: confirm `ApiError['error']['code']` includes `'INTERNAL'` and `'RATE_LIMITED'` in `shared/src/schemas/common`. If a code is missing, add it there (it already powers the NestJS filter, so it should exist).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w @furama/web -- envelope`
Expected: PASS (3 tests).

- [ ] **Step 6: Implement `web/src/app/api/health/route.ts`**

```ts
export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json({ status: 'ok' });
}
```

- [ ] **Step 7: Implement `web/src/app/api/ready/route.ts`**

```ts
import { dbHealthy } from '../../../server/prisma';
export const dynamic = 'force-dynamic';
export async function GET() {
  const ok = await dbHealthy();
  return Response.json({ status: ok ? 'ready' : 'unhealthy' }, { status: ok ? 200 : 503 });
}
```

- [ ] **Step 8: Manual verify against the DB**

Run (dev server up): `curl -s localhost:3002/api/health` then `curl -s localhost:3002/api/ready`
Expected: `{"status":"ok"}` and `{"status":"ready"}`.

- [ ] **Step 9: Commit**

```bash
git add web/src/server/http web/src/app/api/health web/src/app/api/ready
git commit -m "feat(web/server): ApiError envelope, route() wrapper, health/ready endpoints"
```

---

## PHASE 1 — Auth

### Task 1.1: Passwords (argon2) + RBAC capability matrix (pure, no DB)

**Files:**
- Create: `web/src/server/auth/passwords.ts`, `web/src/server/rbac/capability.ts`
- Test: `web/src/server/rbac/capability.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(plain): Promise<string>`, `verifyPassword(hash, plain): Promise<boolean>`, `needsRehash(hash): boolean` (argon2id with cost from `getConfig()`).
  - `CAPABILITY_MATRIX: Record<MemberRole, Record<Capability, true|'scope'|false>>`, `roleHasCapability(role, capability): CapabilityGrant`, `type CapabilityGrant = true | 'scope' | false`.

- [ ] **Step 1: Write the failing test `web/src/server/rbac/capability.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { roleHasCapability } from './capability';

describe('CAPABILITY_MATRIX', () => {
  it('OWNER can ARCHIVE_PROJECT but PM cannot', () => {
    expect(roleHasCapability('OWNER', 'ARCHIVE_PROJECT')).toBe(true);
    expect(roleHasCapability('PM', 'ARCHIVE_PROJECT')).toBe(false);
  });
  it('LEAD EDIT_TASK is scope-gated; VIEWER cannot comment', () => {
    expect(roleHasCapability('LEAD', 'EDIT_TASK')).toBe('scope');
    expect(roleHasCapability('VIEWER', 'COMMENT_TASK')).toBe(false);
  });
  it('MEMBER UPDATE_TASK_PROGRESS is scope-gated', () => {
    expect(roleHasCapability('MEMBER', 'UPDATE_TASK_PROGRESS')).toBe('scope');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @furama/web -- capability`
Expected: FAIL — cannot find `./capability`.

- [ ] **Step 3: Implement `web/src/server/rbac/capability.ts`** — copy the matrix **verbatim** from `backend/src/rbac/capability.enum.ts` (it is the authoritative matrix; do not paraphrase). Replace the import line with:

```ts
import type { Capability, MemberRole } from '@furama/shared';
export type CapabilityGrant = true | 'scope' | false;
export const CAPABILITY_MATRIX: Record<MemberRole, Record<Capability, CapabilityGrant>> = {
  /* ...copy every cell exactly from backend/src/rbac/capability.enum.ts... */
};
export function roleHasCapability(role: MemberRole, capability: Capability): CapabilityGrant {
  return CAPABILITY_MATRIX[role][capability];
}
```

> Implementer: open `backend/src/rbac/capability.enum.ts` and paste the full `CAPABILITY_MATRIX` literal (OWNER/PM/LEAD/MEMBER/VIEWER blocks) unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @furama/web -- capability`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `web/src/server/auth/passwords.ts`** (port of argon2 usage in `auth.service.ts`)

```ts
import * as argon2 from 'argon2';
import { getConfig } from '../config';

function opts(): argon2.Options & { type: 0 | 1 | 2 } {
  const c = getConfig();
  return {
    type: argon2.argon2id,
    memoryCost: c.ARGON2_MEMORY_KIB,
    timeCost: c.ARGON2_TIME_COST,
    parallelism: c.ARGON2_PARALLELISM,
  };
}

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, opts());
}
export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}
export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, opts());
}
```

- [ ] **Step 6: Commit**

```bash
git add web/src/server/auth/passwords.ts web/src/server/rbac/capability.ts web/src/server/rbac/capability.test.ts
git commit -m "feat(web/server): argon2 passwords + RBAC capability matrix"
```

---

### Task 1.2: Tokens service (JWT + refresh rotation + family revoke)

**Files:**
- Create: `web/src/server/auth/tokens.ts`
- Test: `web/src/server/auth/tokens.test.ts` (integration — real Postgres)

**Interfaces:**
- Consumes: `prisma`, `getConfig()`, `Unauthorized` from `http/errors`.
- Produces: `signAccess(claims): string`, `verifyAccess(token): { sub: string; orgId: string }`, `issueOnLogin(user, ip): Promise<IssuedTokens>`, `rotate(rawRefreshToken, ip): Promise<IssuedTokens>`, `revokeByRawToken(raw): Promise<void>`, `revokeFamily(familyId): Promise<void>`. `IssuedTokens = { accessToken: string; refreshToken: string; refreshExpiresAt: Date }`.

- [ ] **Step 1: Write the failing integration test `web/src/server/auth/tokens.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { issueOnLogin, rotate, verifyAccess } from './tokens';

let userId: string;
let orgId: string;

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { slug: `t-${Date.now()}`, name: 'T' } });
  orgId = org.id;
  const u = await prisma.user.create({
    data: { orgId, name: 'T', email: `t-${Date.now()}@x.test`, passwordHash: 'x', isActive: true },
  });
  userId = u.id;
});
afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe('tokens', () => {
  it('issues an access token carrying sub+orgId', async () => {
    const t = await issueOnLogin({ id: userId, orgId }, null);
    expect(verifyAccess(t.accessToken)).toEqual({ sub: userId, orgId });
  });
  it('rotates a refresh token and detects reuse → family revoked', async () => {
    const first = await issueOnLogin({ id: userId, orgId }, null);
    const second = await rotate(first.refreshToken, null);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    // replaying the now-rotated first token is reuse → throws
    await expect(rotate(first.refreshToken, null)).rejects.toThrow(/reuse/i);
    // the legitimate second token is now also revoked (family killed)
    await expect(rotate(second.refreshToken, null)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @furama/web -- tokens`
Expected: FAIL — cannot find `./tokens`.

- [ ] **Step 3: Implement `web/src/server/auth/tokens.ts`** — port of `backend/src/auth/tokens.service.ts`. Same logic; class → module functions; `ConfigService` → `getConfig()`; `UnauthorizedException` → `Unauthorized`. **Fix the latent bug** in the NestJS `rotate()` where `replacedById` was set to the *old* token's id (`parsed.id`) instead of the newly minted token's id — thread the new id back from `mintRefresh`.

```ts
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { getConfig } from '../config';
import { Unauthorized } from '../http/errors';

export interface AccessTokenClaims { sub: string; orgId: string }
export interface IssuedTokens { accessToken: string; refreshToken: string; refreshExpiresAt: Date }

export function signAccess(claims: AccessTokenClaims): string {
  const c = getConfig();
  return jwt.sign(claims, c.JWT_ACCESS_SECRET, { expiresIn: c.JWT_ACCESS_TTL, algorithm: 'HS256' });
}

export function verifyAccess(token: string): AccessTokenClaims {
  const c = getConfig();
  try {
    const decoded = jwt.verify(token, c.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || decoded === null) throw new Unauthorized('Invalid token payload');
    const { sub, orgId } = decoded as Record<string, unknown>;
    if (typeof sub !== 'string' || typeof orgId !== 'string') throw new Unauthorized('Invalid token payload');
    return { sub, orgId };
  } catch (err) {
    if (err instanceof Unauthorized) throw err;
    throw new Unauthorized('Invalid or expired token');
  }
}

function sha256(input: string): string { return createHash('sha256').update(input).digest('hex'); }
function parseRefresh(raw: string): { id: string; hash: string } | null {
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;
  return { id: raw.slice(0, dot), hash: sha256(raw.slice(dot + 1)) };
}

async function mintRefresh(user: { id: string; orgId: string }, familyId: string, ip: string | null) {
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  const hash = sha256(secret);
  const expiresAt = new Date(Date.now() + getConfig().REFRESH_TTL_DAYS * 86_400_000);
  await prisma.refreshToken.create({
    data: { id, userId: user.id, familyId, tokenHash: hash, expiresAt, createdByIp: ip ?? null },
  });
  return {
    newId: id,
    tokens: { accessToken: signAccess({ sub: user.id, orgId: user.orgId }), refreshToken: `${id}.${secret}`, refreshExpiresAt: expiresAt } as IssuedTokens,
  };
}

export async function issueOnLogin(user: { id: string; orgId: string }, ip: string | null): Promise<IssuedTokens> {
  return (await mintRefresh(user, randomUUID(), ip)).tokens;
}

export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function rotate(rawRefreshToken: string, ip: string | null): Promise<IssuedTokens> {
  const parsed = parseRefresh(rawRefreshToken);
  if (!parsed) throw new Unauthorized('Invalid refresh token');
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: parsed.hash } });
  if (!row) throw new Unauthorized('Invalid refresh token');
  if (row.revokedAt || row.replacedById) {
    await revokeFamily(row.familyId);
    throw new Unauthorized('Refresh token reuse detected');
  }
  if (row.expiresAt.getTime() <= Date.now()) throw new Unauthorized('Refresh token expired');
  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user || !user.isActive) throw new Unauthorized('User is inactive');

  const minted = await mintRefresh({ id: user.id, orgId: user.orgId }, row.familyId, ip);
  const updated = await prisma.refreshToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date(), replacedById: minted.newId },
  });
  if (updated.count === 0) {
    await revokeFamily(row.familyId);
    throw new Unauthorized('Refresh token reuse detected');
  }
  return minted.tokens;
}

export async function revokeByRawToken(rawRefreshToken: string): Promise<void> {
  const parsed = parseRefresh(rawRefreshToken);
  if (!parsed) return;
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: parsed.hash } });
  if (row) await revokeFamily(row.familyId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @furama/web -- tokens`
Expected: PASS (2 tests). Requires `.env` `DATABASE_URL` reachable (native Postgres).

- [ ] **Step 5: Commit**

```bash
git add web/src/server/auth/tokens.ts web/src/server/auth/tokens.test.ts
git commit -m "feat(web/server): port TokensService (rotation + family revoke); fix replacedById bug"
```

---

### Task 1.3: RBAC service (scope resolution) + auth audit helper

**Files:**
- Create: `web/src/server/rbac/rbac.ts`, `web/src/server/audit/audit.ts`
- Test: `web/src/server/rbac/rbac.test.ts` (integration)

**Interfaces:**
- Consumes: `prisma`, `roleHasCapability`, `Forbidden`/`NotFound`.
- Produces:
  - `effectiveRole(userId, projectId): Promise<MemberRole | null>`
  - `assertCan(ctx, capability, projectId, scope?): Promise<MemberRole>` (throws `Forbidden`)
  - `can(ctx, capability, projectId, scope?): Promise<boolean>`
  - `AuthContext = { userId: string; orgId: string }`, `ScopeHints = { workstreamId?: string|null; taskId?: string|null }`
  - `auditRecord(actor: { actorId: string; ip: string|null }, entry: { action: string; entityType: string; entityId: string; before?: unknown; after?: unknown }): Promise<void>`

- [ ] **Step 1: Write the failing integration test `web/src/server/rbac/rbac.test.ts`** — proves the CLAUDE.md "good" case: a LEAD of one workstream is denied editing a task in another.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { assertCan, can } from './rbac';

let ids: { org: string; project: string; user: string; wsOwn: string; wsOther: string; taskOther: string };

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { slug: `r-${Date.now()}`, name: 'R' } });
  const user = await prisma.user.create({ data: { orgId: org.id, name: 'L', email: `l-${Date.now()}@x.test`, passwordHash: 'x', isActive: true } });
  const project = await prisma.project.create({ data: { orgId: org.id, name: 'P', code: `P${Date.now()}` } });
  const wsOwn = await prisma.workstream.create({ data: { projectId: project.id, name: 'Mkt', key: 'MKT' } });
  const wsOther = await prisma.workstream.create({ data: { projectId: project.id, name: 'Ops', key: 'OPS' } });
  const member = await prisma.projectMember.create({ data: { projectId: project.id, userId: user.id, role: 'LEAD', memberLabel: 'L' } });
  await prisma.memberWorkstream.create({ data: { projectMemberId: member.id, workstreamId: wsOwn.id } });
  const taskOther = await prisma.task.create({ data: { projectId: project.id, workstreamId: wsOther.id, code: `T${Date.now()}`, title: 'x', status: 'TODO', priority: 'MEDIUM' } });
  ids = { org: org.id, project: project.id, user: user.id, wsOwn: wsOwn.id, wsOther: wsOther.id, taskOther: taskOther.id };
});
afterAll(async () => {
  await prisma.task.deleteMany({ where: { projectId: ids.project } });
  await prisma.memberWorkstream.deleteMany({ where: { workstream: { projectId: ids.project } } });
  await prisma.workstream.deleteMany({ where: { projectId: ids.project } });
  await prisma.projectMember.deleteMany({ where: { projectId: ids.project } });
  await prisma.project.delete({ where: { id: ids.project } });
  await prisma.user.delete({ where: { id: ids.user } });
  await prisma.organization.delete({ where: { id: ids.org } });
  await prisma.$disconnect();
});

describe('rbac scope', () => {
  it('LEAD can EDIT_TASK in own workstream', async () => {
    const ctx = { userId: ids.user, orgId: ids.org };
    await expect(assertCan(ctx, 'EDIT_TASK', ids.project, { workstreamId: ids.wsOwn })).resolves.toBe('LEAD');
  });
  it('LEAD is FORBIDDEN editing a task in another workstream', async () => {
    const ctx = { userId: ids.user, orgId: ids.org };
    expect(await can(ctx, 'EDIT_TASK', ids.project, { taskId: ids.taskOther })).toBe(false);
  });
});
```

> Implementer: verify the exact Prisma model/field names (`Project.code`, `Workstream.key`, `Task.code/status/priority`, `ProjectMember.memberLabel`, `MemberWorkstream.projectMemberId`) against `prisma/schema.prisma` before running; adjust the seed data in the test to match. The assertions stay the same.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @furama/web -- rbac`
Expected: FAIL — cannot find `./rbac`.

- [ ] **Step 3: Implement `web/src/server/rbac/rbac.ts`** — port of `backend/src/rbac/rbac.service.ts` (class → functions; `prisma` injected → singleton import; `ForbiddenException`→`Forbidden`, `NotFoundException`→`NotFound`). Keep `effectiveRole`, `assertCan`, `can`, `leadOwnsWorkstream`, `isAssignee`, and the private `isInScope` logic unchanged.

```ts
import type { MemberRole, Capability } from '@furama/shared';
import { prisma } from '../prisma';
import { roleHasCapability } from './capability';
import { Forbidden, NotFound } from '../http/errors';

export interface AuthContext { userId: string; orgId: string }
export interface ScopeHints { workstreamId?: string | null; taskId?: string | null }

export async function effectiveRole(userId: string, projectId: string): Promise<MemberRole | null> {
  const m = await prisma.projectMember.findFirst({ where: { userId, projectId }, select: { role: true } });
  return m?.role ?? null;
}
export async function assertCan(ctx: AuthContext, capability: Capability, projectId: string, scope: ScopeHints = {}): Promise<MemberRole> {
  const role = await effectiveRole(ctx.userId, projectId);
  if (!role) throw new Forbidden('Not a member of this project');
  const grant = roleHasCapability(role, capability);
  if (grant === true) return role;
  if (grant === false) throw new Forbidden(`Role ${role} cannot ${capability}`);
  if (!(await isInScope(ctx.userId, projectId, role, capability, scope))) {
    throw new Forbidden(`Role ${role} can ${capability} only within own scope`);
  }
  return role;
}
export async function can(ctx: AuthContext, capability: Capability, projectId: string, scope: ScopeHints = {}): Promise<boolean> {
  try { await assertCan(ctx, capability, projectId, scope); return true; } catch { return false; }
}
async function leadOwnsWorkstream(userId: string, projectId: string, workstreamId: string): Promise<boolean> {
  const row = await prisma.memberWorkstream.findFirst({
    where: { workstreamId, projectMember: { userId, projectId, role: 'LEAD' } }, select: { id: true },
  });
  return row !== null;
}
async function isAssignee(userId: string, projectId: string, taskId: string): Promise<boolean> {
  const member = await prisma.projectMember.findFirst({ where: { userId, projectId }, select: { memberLabel: true } });
  if (!member) return false;
  const count = await prisma.taskAssignment.count({
    where: { taskId, OR: [{ userId }, ...(member.memberLabel ? [{ label: member.memberLabel }] : [])] },
  });
  return count > 0;
}
async function isInScope(userId: string, projectId: string, role: MemberRole, capability: Capability, scope: ScopeHints): Promise<boolean> {
  if (role === 'LEAD') {
    let workstreamId = scope.workstreamId ?? null;
    if (!workstreamId && scope.taskId) {
      const task = await prisma.task.findUnique({ where: { id: scope.taskId }, select: { workstreamId: true, projectId: true } });
      if (!task) throw new NotFound('Task not found');
      if (task.projectId !== projectId) return false;
      workstreamId = task.workstreamId;
    }
    if (!workstreamId) return false;
    return leadOwnsWorkstream(userId, projectId, workstreamId);
  }
  if (role === 'MEMBER') {
    if (!scope.taskId) return false;
    if (capability !== 'UPDATE_TASK_PROGRESS') return false;
    return isAssignee(userId, projectId, scope.taskId);
  }
  return false;
}
```

- [ ] **Step 4: Implement `web/src/server/audit/audit.ts`** — minimal port of `AuditService.record`. Confirm the `AuditLog` model fields in `prisma/schema.prisma` (e.g. `action, entityType, entityId, actorId, beforeJson/afterJson, ip, createdAt`) and map accordingly.

```ts
import { prisma } from '../prisma';

export interface AuditActor { actorId: string; ip: string | null }
export interface AuditEntry { action: string; entityType: string; entityId: string; before?: unknown; after?: unknown }

export async function auditRecord(actor: AuditActor, entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: actor.actorId,
      ip: actor.ip ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      // adjust field names to schema: e.g. beforeJson / afterJson
      before: entry.before === undefined ? undefined : (entry.before as object),
      after: entry.after === undefined ? undefined : (entry.after as object),
    },
  });
}
```

> Implementer: open `backend/src/audit/audit.service.ts` and `prisma/schema.prisma` (AuditLog model) and match the exact column names — the NestJS service is the source of truth for what gets written.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w @furama/web -- rbac`
Expected: PASS (2 tests) — proves the deny path (CLAUDE.md "good looks like").

- [ ] **Step 6: Commit**

```bash
git add web/src/server/rbac/rbac.ts web/src/server/rbac/rbac.test.ts web/src/server/audit/audit.ts
git commit -m "feat(web/server): port RbacService (scope) + audit helper; deny-path test"
```

---

### Task 1.4: Auth service + session reader + cookie helper

**Files:**
- Create: `web/src/server/auth/service.ts`, `web/src/server/auth/session.ts`, `web/src/server/auth/cookies.ts`
- Test: `web/src/server/auth/service.test.ts` (integration)

**Interfaces:**
- Consumes: `tokens.*`, `passwords.*`, `prisma`, `auditRecord`, `Unauthorized`/`Conflict`.
- Produces:
  - `registerUser(dto, ip): Promise<{ user: PublicUser }>`
  - `loginUser(dto, ip): Promise<{ tokens: IssuedTokens; response: LoginResponse }>`
  - `refreshSession(rawRefresh, ip): Promise<IssuedTokens>`
  - `logoutSession(rawRefresh?): Promise<void>`
  - `getMe(userId): Promise<MeResponse>`
  - `getAuthContext(req: Request): Promise<AuthContext>` (reads `Authorization: Bearer`, verifies, throws `Unauthorized`)
  - `setRefreshCookie(res: NextResponse, tokens), clearRefreshCookie(res)`, const `REFRESH_COOKIE='furama_refresh'`

- [ ] **Step 1: Write the failing integration test `web/src/server/auth/service.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { registerUser, loginUser } from './service';

const email = `svc-${Date.now()}@acme.test`;
afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { user: { email } } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

describe('auth service', () => {
  it('registers then logs in, returning an access token + public user', async () => {
    await registerUser({ name: 'Svc', email, password: 'Sup3rSecret!' } as any, null);
    const { tokens, response } = await loginUser({ email, password: 'Sup3rSecret!' } as any, null);
    expect(tokens.accessToken).toMatch(/\./);
    expect(response.user.email).toBe(email.toLowerCase());
    expect((response.user as any).passwordHash).toBeUndefined();
  });
  it('rejects a wrong password with a generic 401', async () => {
    await expect(loginUser({ email, password: 'wrong' } as any, null)).rejects.toThrow(/invalid email or password/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @furama/web -- service`
Expected: FAIL — cannot find `./service`.

- [ ] **Step 3: Implement `web/src/server/auth/service.ts`** — port of `backend/src/auth/auth.service.ts`. Inline the small `users` helpers (`existsByEmail`, `create`, `touchLastLogin`, `findById`, `toPublicUser`) or create `web/src/server/users/users.ts`; keep the generic-401 and org-bootstrap behavior exactly.

```ts
import type { LoginDto, LoginResponse, MeResponse, PublicUser, RegisterDto } from '@furama/shared';
import { prisma } from '../prisma';
import { hashPassword, verifyPassword, needsRehash } from './passwords';
import { issueOnLogin, rotate, revokeByRawToken, type IssuedTokens } from './tokens';
import { auditRecord } from '../audit/audit';
import { Conflict, Unauthorized } from '../http/errors';

export function toPublicUser(u: { id: string; orgId: string; name: string; email: string }): PublicUser {
  return { id: u.id, orgId: u.orgId, name: u.name, email: u.email } as PublicUser;
}
function defaultOrgSlug(email: string): string {
  const at = email.indexOf('@');
  const domain = at >= 0 ? email.slice(at + 1) : email;
  const base = domain.split('.')[0] ?? 'org';
  return base.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'org';
}

export async function registerUser(dto: RegisterDto, ip: string | null): Promise<{ user: PublicUser }> {
  const slug = (dto.orgSlug ?? defaultOrgSlug(dto.email)).toLowerCase();
  const org = await prisma.organization.upsert({ where: { slug }, update: {}, create: { slug, name: slug } });
  const exists = await prisma.user.findFirst({ where: { orgId: org.id, email: dto.email.toLowerCase() }, select: { id: true } });
  if (exists) throw new Conflict('Email already registered');
  const passwordHash = await hashPassword(dto.password);
  const user = await prisma.user.create({
    data: { orgId: org.id, name: dto.name, email: dto.email.toLowerCase(), passwordHash, isActive: true },
  });
  await auditRecord({ actorId: user.id, ip }, { action: 'user.registered', entityType: 'User', entityId: user.id, after: { email: user.email } });
  return { user: toPublicUser(user) };
}

export async function loginUser(dto: LoginDto, ip: string | null): Promise<{ tokens: IssuedTokens; response: LoginResponse }> {
  const generic = new Unauthorized('Invalid email or password');
  const rows = await prisma.user.findMany({ where: { email: dto.email.toLowerCase() }, take: 2 });
  if (rows.length !== 1) throw generic;
  const userRow = rows[0]!;
  if (!userRow.isActive) throw generic;
  if (!(await verifyPassword(userRow.passwordHash, dto.password))) throw generic;
  if (needsRehash(userRow.passwordHash)) {
    await prisma.user.update({ where: { id: userRow.id }, data: { passwordHash: await hashPassword(dto.password) } });
  }
  await prisma.user.update({ where: { id: userRow.id }, data: { lastLoginAt: new Date() } });
  const tokens = await issueOnLogin({ id: userRow.id, orgId: userRow.orgId }, ip);
  await auditRecord({ actorId: userRow.id, ip }, { action: 'user.login', entityType: 'User', entityId: userRow.id });
  return { tokens, response: { accessToken: tokens.accessToken, user: toPublicUser(userRow) } };
}

export async function refreshSession(raw: string, ip: string | null): Promise<IssuedTokens> { return rotate(raw, ip); }
export async function logoutSession(raw?: string): Promise<void> { if (raw) await revokeByRawToken(raw); }

export async function getMe(userId: string): Promise<MeResponse> {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u) throw new Unauthorized('User not found');
  const memberships = await prisma.projectMember.findMany({ where: { userId }, select: { projectId: true, role: true, memberLabel: true } });
  return { user: toPublicUser(u), memberships };
}
```

> Implementer: confirm `lastLoginAt` exists on `User` (the NestJS `touchLastLogin` updates it). Confirm `MeResponse.memberships` shape matches `shared` (projectId, role, memberLabel).

- [ ] **Step 4: Implement `web/src/server/auth/session.ts`**

```ts
import { verifyAccess } from './tokens';
import { Unauthorized } from '../http/errors';
import type { AuthContext } from '../rbac/rbac';

export function getAuthContext(req: Request): AuthContext {
  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) throw new Unauthorized('Missing bearer token');
  const claims = verifyAccess(m[1]!);
  return { userId: claims.sub, orgId: claims.orgId };
}
```

- [ ] **Step 5: Implement `web/src/server/auth/cookies.ts`**

```ts
import type { NextResponse } from 'next/server';
import { getConfig } from '../config';
import type { IssuedTokens } from './tokens';

export const REFRESH_COOKIE = 'furama_refresh';

export function setRefreshCookie(res: NextResponse, tokens: IssuedTokens): void {
  res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true, secure: getConfig().COOKIE_SECURE, sameSite: 'strict', path: '/', expires: tokens.refreshExpiresAt,
  });
}
export function clearRefreshCookie(res: NextResponse): void {
  res.cookies.set(REFRESH_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w @furama/web -- service`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add web/src/server/auth/service.ts web/src/server/auth/session.ts web/src/server/auth/cookies.ts web/src/server/auth/service.test.ts
git commit -m "feat(web/server): auth service (register/login/refresh/logout/me) + session + cookies"
```

---

### Task 1.5: Auth route handlers (`/api/v1/auth/*`)

**Files:**
- Create: `web/src/app/api/v1/auth/{login,refresh,logout,register,me}/route.ts`

**Interfaces:**
- Consumes: `service.*`, `setRefreshCookie/clearRefreshCookie/REFRESH_COOKIE`, `route()`, `getAuthContext`, `loginSchema/registerSchema` from `@furama/shared`.
- Produces: HTTP endpoints matching `api/openapi.yaml` (`POST /auth/login` 200, `/auth/refresh` 200, `/auth/logout` 204, `/auth/register` 201, `GET /auth/me` 200).

- [ ] **Step 1: Implement `login/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { loginSchema } from '@furama/shared';
import { route } from '../../../../../server/http/envelope';
import { loginUser } from '../../../../../server/auth/service';
import { setRefreshCookie } from '../../../../../server/auth/cookies';

function ip(req: Request) { return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null; }

export const POST = route(async (req) => {
  const dto = loginSchema.parse(await req.json());
  const { tokens, response } = await loginUser(dto, ip(req));
  const res = NextResponse.json(response, { status: 200 });
  setRefreshCookie(res, tokens);
  return res;
});
```

- [ ] **Step 2: Implement `register/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { registerSchema } from '@furama/shared';
import { route } from '../../../../../server/http/envelope';
import { registerUser } from '../../../../../server/auth/service';

function ip(req: Request) { return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null; }

export const POST = route(async (req) => {
  const dto = registerSchema.parse(await req.json());
  const out = await registerUser(dto, ip(req));
  return NextResponse.json(out, { status: 201 });
});
```

- [ ] **Step 3: Implement `refresh/route.ts`** (reads the cookie; jose/next cookies)

```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { route } from '../../../../../server/http/envelope';
import { refreshSession } from '../../../../../server/auth/service';
import { setRefreshCookie, REFRESH_COOKIE } from '../../../../../server/auth/cookies';
import { Unauthorized } from '../../../../../server/http/errors';

function ip(req: Request) { return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null; }

export const POST = route(async (req) => {
  const raw = cookies().get(REFRESH_COOKIE)?.value;
  if (!raw) throw new Unauthorized('Missing refresh cookie');
  const tokens = await refreshSession(raw, ip(req));
  const res = NextResponse.json({ accessToken: tokens.accessToken }, { status: 200 });
  setRefreshCookie(res, tokens);
  return res;
});
```

- [ ] **Step 4: Implement `logout/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { route } from '../../../../../server/http/envelope';
import { logoutSession } from '../../../../../server/auth/service';
import { clearRefreshCookie, REFRESH_COOKIE } from '../../../../../server/auth/cookies';

export const POST = route(async () => {
  const raw = cookies().get(REFRESH_COOKIE)?.value;
  await logoutSession(raw);
  const res = new NextResponse(null, { status: 204 });
  clearRefreshCookie(res);
  return res;
});
```

- [ ] **Step 5: Implement `me/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { route } from '../../../../../server/http/envelope';
import { getAuthContext } from '../../../../../server/auth/session';
import { getMe } from '../../../../../server/auth/service';

export const GET = route(async (req) => {
  const ctx = getAuthContext(req);
  return NextResponse.json(await getMe(ctx.userId), { status: 200 });
});
```

- [ ] **Step 6: Manual end-to-end verify with curl**

```bash
# register (use a fresh email), then login capturing the cookie jar
curl -s -X POST localhost:3002/api/v1/auth/register -H 'content-type: application/json' \
  -d '{"name":"QA","email":"qa+nx@acme.test","password":"Sup3rSecret!"}' -w '\n%{http_code}\n'
curl -s -c /tmp/j.txt -X POST localhost:3002/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"qa+nx@acme.test","password":"Sup3rSecret!"}' -w '\n%{http_code}\n'
# refresh using the cookie
curl -s -b /tmp/j.txt -X POST localhost:3002/api/v1/auth/refresh -w '\n%{http_code}\n'
```
Expected: 201, then 200 with `{accessToken,user}` and a `set-cookie: furama_refresh=...; HttpOnly`, then 200 with a new `accessToken`.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/api/v1/auth
git commit -m "feat(web/api): auth route handlers (login/register/refresh/logout/me)"
```

---

### Task 1.6: Middleware route gate + client auth store + api-client + login page

**Files:**
- Create: `web/src/middleware.ts`, `web/src/lib/auth-store.ts`, `web/src/lib/api-client.ts`, `web/src/app/login/page.tsx`
- Modify: `web/src/app/page.tsx` (redirect to `/projects` once authed — placeholder target `/login` for now)

**Interfaces:**
- Consumes: `/api/v1/auth/*`.
- Produces:
  - `useAuth` (zustand): `{ accessToken: string|null, user: PublicUser|null, setSession(token,user), clear() }`
  - `api<T>(path, init?): Promise<T>` — attaches `Authorization: Bearer` from the store, on 401 tries one `/auth/refresh` then retries; throws `ApiError` on failure.
  - `middleware` — redirects unauthenticated navigation (no `furama_refresh` cookie) away from `/projects/**` to `/login`.

- [ ] **Step 1: Implement `web/src/middleware.ts`** (coarse gate via refresh-cookie presence)

```ts
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = ['/login'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p)) || pathname.startsWith('/api') ) return NextResponse.next();
  const hasRefresh = req.cookies.has('furama_refresh');
  if (!hasRefresh && pathname.startsWith('/projects')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
```

- [ ] **Step 2: Implement `web/src/lib/auth-store.ts`**

```ts
'use client';
import { create } from 'zustand';
import type { PublicUser } from '@furama/shared';

interface AuthState {
  accessToken: string | null;
  user: PublicUser | null;
  setSession: (token: string, user: PublicUser) => void;
  setToken: (token: string) => void;
  clear: () => void;
}
export const useAuth = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setSession: (accessToken, user) => set({ accessToken, user }),
  setToken: (accessToken) => set({ accessToken }),
  clear: () => set({ accessToken: null, user: null }),
}));
```

- [ ] **Step 3: Implement `web/src/lib/api-client.ts`** (Bearer + one-shot refresh retry)

```ts
'use client';
import { useAuth } from './auth-store';

async function refresh(): Promise<string | null> {
  const res = await fetch('/api/v1/auth/refresh', { method: 'POST' });
  if (!res.ok) return null;
  const { accessToken } = (await res.json()) as { accessToken: string };
  useAuth.getState().setToken(accessToken);
  return accessToken;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const doFetch = (token: string | null) =>
    fetch(`/api/v1${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });

  let token = useAuth.getState().accessToken;
  let res = await doFetch(token);
  if (res.status === 401) {
    token = await refresh();
    if (token) res = await doFetch(token);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { code: 'INTERNAL', message: res.statusText } }));
    throw body;
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
```

- [ ] **Step 4: Implement `web/src/app/login/page.tsx`** (client form; on success store session + go to `/projects`)

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoginResponse } from '@furama/shared';
import { useAuth } from '../../lib/auth-store';

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuth((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    if (!res.ok) { setError('Sai email hoặc mật khẩu'); return; }
    const data = (await res.json()) as LoginResponse;
    setSession(data.accessToken, data.user);
    router.push('/projects');
  }

  return (
    <div className="min-h-screen grid place-items-center">
      <form onSubmit={onSubmit} className="w-80 space-y-3 rounded-xl border border-slate-200 bg-white p-6">
        <h1 className="text-lg font-bold text-indigo-700">Furama PMO</h1>
        <input className="w-full rounded border px-2 py-1.5" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full rounded border px-2 py-1.5" type="password" placeholder="Mật khẩu" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded bg-indigo-600 py-1.5 text-white">Đăng nhập</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Add a placeholder `web/src/app/projects/page.tsx`** so the post-login redirect lands somewhere (real version in Phase 4)

```tsx
'use client';
import { useAuth } from '../../lib/auth-store';
export default function ProjectsPage() {
  const user = useAuth((s) => s.user);
  return <main className="p-6">Đăng nhập thành công: {user?.email ?? '(reload mất session — Phase 4 thêm silent refresh)'}</main>;
}
```

- [ ] **Step 6: Manual verify in the browser**

Run: dev server on `:3002`. Visit `/projects` → redirected to `/login` (no cookie). Log in with the QA user from Task 1.5 → lands on `/projects` showing the email. Check DevTools: `furama_refresh` cookie is HttpOnly.

- [ ] **Step 7: Commit**

```bash
git add web/src/middleware.ts web/src/lib/auth-store.ts web/src/lib/api-client.ts web/src/app/login web/src/app/projects web/src/app/page.tsx
git commit -m "feat(web): middleware gate + auth store + api-client + login page"
```

---

## Self-Review (done during authoring)

- **Spec coverage (P0+P1):** scaffold (Task 0.1), Prisma singleton + config (0.2), error envelope + health/ready (0.3), argon2 + capability matrix (1.1), tokens rotation/family-revoke (1.2), RBAC scope + audit (1.3), auth service + session + cookies (1.4), auth route handlers mirroring openapi (1.5), middleware gate + client auth (1.6). ✅ Realtime/pages/other modules are explicitly later phases.
- **Placeholders:** none — every code step carries real code. Three `Implementer:` notes point at exact source files to copy verbatim (capability matrix, audit columns, RBAC test seed field names) because those must match the live schema; this is verification, not a stub.
- **Type consistency:** `IssuedTokens`, `AuthContext`, `ScopeHints`, `AppConfig`, `REFRESH_COOKIE`, `api<T>`, `useAuth` names are used identically across tasks. `route()` signature matches between definition (0.3) and consumers (1.5).
- **Known fix:** Task 1.2 corrects the NestJS `replacedById` bug (was set to the old token id) — call it out in the commit so reviewers know it's intentional.

## Follow-up plans (to be written next, one per phase)

- **Phase 2** — Port server lib per domain module (tasks, budget, dashboard, members, config-dim, milestones, comments, import-export, ai) with unit + integration tests.
- **Phase 3** — REST route handlers for every openapi path + per-route integration tests (Testcontainers Postgres).
- **Phase 4** — App Router pages + full route tree + migrate features to TanStack Query (incl. silent-refresh on load, task-detail intercepting route).
- **Phase 5** — Polling realtime + notifications.
- **Phase 6** — Full parity check vs the NestJS app, delete `backend/`, update `docs/CHANGELOG.md`.
- **Phase 7** — Vercel config + managed Postgres (Neon) + preview deploy.
