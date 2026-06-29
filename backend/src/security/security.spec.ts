/**
 * S-01 — Security integration tests (docs/06, docs/07 §5).
 *
 * Uses ONE shared NestJS app instance so the full middleware stack (guards, filters,
 * ThrottlerGuard) is exercised. Each describe block seeds its own users/projects and
 * cleans up via cascade-delete of the org row.
 *
 * Categories:
 *  1. Unauthenticated → 401 on protected routes
 *  2. Cross-project IDOR → 403/404 (no data leak across orgs)
 *  3. Role enforcement → 403 for wrong-role callers
 *  4. Input validation & injection → 400 / stored safely / XSS stripped
 *  5. Security headers (A05 — OWASP)
 *  6. Rate limiting on auth endpoints → 429 after limit exceeded
 */
import type { INestApplication } from '@nestjs/common';
import {
  createHttpTestApp,
  teardownHttpTestApp,
  registerAndLogin,
  SKIP_HTTP,
} from '../test-utils/http-harness';
import type { PrismaService } from '../prisma/prisma.service';

const itHttp = SKIP_HTTP ? it.skip : it;

/* -------------------------------------------------------------------------- */
/* Shared app fixture — one NestJS instance for all suites                    */
/* -------------------------------------------------------------------------- */

let sharedApp: INestApplication;
let sharedPrisma: PrismaService;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharedAgent: any;
const orgIdsToClean: string[] = [];

beforeAll(async () => {
  if (SKIP_HTTP) return;
  ({ app: sharedApp, prisma: sharedPrisma, agent: sharedAgent } = await createHttpTestApp());
}, 60_000);

afterAll(async () => {
  if (SKIP_HTTP) return;
  for (const orgId of orgIdsToClean) {
    await sharedPrisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  }
  await teardownHttpTestApp(sharedApp, sharedPrisma, undefined);
}, 30_000);

/* -------------------------------------------------------------------------- */
/* 1. Unauthenticated access → 401                                            */
/* -------------------------------------------------------------------------- */

describe('Security — unauthenticated access (401)', () => {
  const PROTECTED = [
    ['GET', '/api/v1/projects'],
    ['POST', '/api/v1/projects'],
    ['GET', '/api/v1/tasks/nonexistent'],
    ['PATCH', '/api/v1/tasks/nonexistent'],
  ] as const;

  for (const [method, path] of PROTECTED) {
    itHttp(`${method} ${path} → 401 without token`, async () => {
      const res = await sharedAgent[method.toLowerCase()](path);
      expect(res.status).toBe(401);
      expect((res.body as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
    });
  }

  itHttp('project-scoped route → 401 without token', async () => {
    const pid = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const res = await sharedAgent.get(`/api/v1/projects/${pid}/tasks`);
    expect(res.status).toBe(401);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Cross-project IDOR                                                      */
/* -------------------------------------------------------------------------- */

describe('Security — IDOR isolation (403/404 across projects)', () => {
  let projectIdA: string;
  let taskIdA: string;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    if (SKIP_HTTP) return;

    const userA = await registerAndLogin(sharedAgent, 'idorA');
    orgIdsToClean.push(userA.orgId);
    tokenA = userA.token;

    const userB = await registerAndLogin(sharedAgent, 'idorB');
    orgIdsToClean.push(userB.orgId);
    tokenB = userB.token;

    const projRes = await sharedAgent
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'IDOR Test Project' });
    projectIdA = (projRes.body as { id: string }).id;

    const taskRes = await sharedAgent
      .post(`/api/v1/projects/${projectIdA}/tasks`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'IDOR Task' });
    taskIdA = (taskRes.body as { id: string }).id;
  }, 30_000);

  itHttp("user B cannot list user A's project tasks", async () => {
    const res = await sharedAgent
      .get(`/api/v1/projects/${projectIdA}/tasks`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect([403, 404]).toContain(res.status);
  });

  itHttp("user B cannot read user A's activity feed", async () => {
    const res = await sharedAgent
      .get(`/api/v1/projects/${projectIdA}/activity`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect([403, 404]).toContain(res.status);
  });

  itHttp("user B cannot update user A's task", async () => {
    const res = await sharedAgent
      .patch(`/api/v1/tasks/${taskIdA}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ title: 'hacked' });
    expect([403, 404]).toContain(res.status);
  });

  itHttp("user B cannot see user A's budget", async () => {
    const res = await sharedAgent
      .get(`/api/v1/projects/${projectIdA}/budget/summary`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect([403, 404]).toContain(res.status);
  });

  itHttp('owner A can access their own project tasks (positive check)', async () => {
    const res = await sharedAgent
      .get(`/api/v1/projects/${projectIdA}/tasks`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Role enforcement                                                         */
/* -------------------------------------------------------------------------- */

describe('Security — role enforcement (403 for wrong role)', () => {
  let projectId: string;
  let ownerToken: string;
  let memberToken: string;

  beforeAll(async () => {
    if (SKIP_HTTP) return;

    const owner = await registerAndLogin(sharedAgent, 'roleOwner');
    orgIdsToClean.push(owner.orgId);
    ownerToken = owner.token;

    const projRes = await sharedAgent
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'RBAC Test Project' });
    projectId = (projRes.body as { id: string }).id;

    const member = await registerAndLogin(sharedAgent, 'roleMember');
    orgIdsToClean.push(member.orgId);
    await sharedAgent
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: member.userId, role: 'MEMBER' });
    memberToken = member.token;
  }, 30_000);

  itHttp('MEMBER cannot update project meta (403)', async () => {
    const res = await sharedAgent
      .patch(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'Hacked' });
    expect(res.status).toBe(403);
  });

  itHttp('MEMBER cannot view activity feed (403)', async () => {
    const res = await sharedAgent
      .get(`/api/v1/projects/${projectId}/activity`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(403);
  });

  itHttp('MEMBER cannot create config dimensions (403)', async () => {
    const res = await sharedAgent
      .post(`/api/v1/projects/${projectId}/phases`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'New Phase', order: 99 });
    expect(res.status).toBe(403);
  });

  itHttp('MEMBER cannot manage other members (403)', async () => {
    const res = await sharedAgent
      .post(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ userId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', role: 'PM' });
    expect(res.status).toBe(403);
  });

  itHttp('OWNER can update project meta (positive check)', async () => {
    const res = await sharedAgent
      .patch(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'RBAC Verified Project' });
    expect(res.status).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Input validation                                                         */
/* -------------------------------------------------------------------------- */

describe('Security — input validation & injection resistance', () => {
  let taskId: string;
  let token: string;

  beforeAll(async () => {
    if (SKIP_HTTP) return;

    const user = await registerAndLogin(sharedAgent, 'injUser');
    orgIdsToClean.push(user.orgId);
    token = user.token;

    const projRes = await sharedAgent
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Injection Test' });
    const projectId = (projRes.body as { id: string }).id;

    const taskRes = await sharedAgent
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Base Task' });
    taskId = (taskRes.body as { id: string }).id;
  }, 30_000);

  itHttp('SQL injection in task title — stored as literal text', async () => {
    const malicious = "'; DROP TABLE tasks; --";
    const res = await sharedAgent
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: malicious });
    expect(res.status).toBe(200);
    expect((res.body as { title: string }).title).toBe(malicious);
  });

  itHttp('XSS in comment body — script tag stripped', async () => {
    const xss = '<script>alert(1)</script>Hello';
    const res = await sharedAgent
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: xss });
    expect(res.status).toBe(201);
    expect((res.body as { body: string }).body).not.toContain('<script>');
    expect((res.body as { body: string }).body).toContain('Hello');
  });

  itHttp('XSS with javascript: URL in comment — stripped', async () => {
    const xss = 'Click <a href="javascript:alert(1)">here</a>';
    const res = await sharedAgent
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: xss });
    expect(res.status).toBe(201);
    expect((res.body as { body: string }).body).not.toContain('javascript:');
  });

  itHttp('unknown extra field rejected (strict zod schema) → 400', async () => {
    const res = await sharedAgent
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'OK', hackerField: 'injected' });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION');
  });

  itHttp('negative progress percent rejected → 400', async () => {
    const res = await sharedAgent
      .patch(`/api/v1/tasks/${taskId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ percent: -10 });
    expect(res.status).toBe(400);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Security headers                                                         */
/* -------------------------------------------------------------------------- */

describe('Security — HTTP response headers', () => {
  itHttp('X-Content-Type-Options: nosniff present', async () => {
    const res = await sharedAgent.get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  itHttp('X-Frame-Options or CSP frame-ancestors prevents framing', async () => {
    const res = await sharedAgent.get('/health');
    const hasXFrame = res.headers['x-frame-options'] !== undefined;
    const hasCsp = ((res.headers['content-security-policy'] ?? '') as string).includes('frame-ancestors');
    expect(hasXFrame || hasCsp).toBe(true);
  });

  itHttp('no Express server banner in Server header', async () => {
    const res = await sharedAgent.get('/health');
    const server = (res.headers['server'] ?? '') as string;
    expect(server).not.toMatch(/express/i);
  });

  itHttp('CORS: unknown origin gets no Allow-Origin echo', async () => {
    const res = await sharedAgent
      .options('/api/v1/projects')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');
    const allowOrigin = res.headers['access-control-allow-origin'] ?? '';
    expect(allowOrigin).not.toBe('https://evil.example.com');
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Rate limiting on auth endpoints                                          */
/* -------------------------------------------------------------------------- */

describe('Security — rate limiting on auth endpoints', () => {
  itHttp('POST /auth/login fires 429 after limit (11 attempts)', async () => {
    const body = { email: `rl-${Date.now()}@example.test`, password: 'wrong' };
    let hitLimit = false;
    for (let i = 0; i < 15; i++) {
      const res = await sharedAgent.post('/api/v1/auth/login').send(body);
      if (res.status === 429) {
        hitLimit = true;
        break;
      }
    }
    expect(hitLimit).toBe(true);
  }, 30_000);

  itHttp('unauthenticated /auth/refresh → not 500 (no unhandled error)', async () => {
    // The shared agent may carry a refresh cookie from previous logins, which is intentional.
    // What we're asserting is that this endpoint never returns 500 — it either succeeds (200)
    // or rejects (401 / 429). A 500 would indicate an unhandled exception.
    const res = await sharedAgent.post('/api/v1/auth/refresh');
    expect(res.status).not.toBe(500);
  });
});
