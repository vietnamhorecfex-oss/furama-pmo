/**
 * HTTP-level integration test for GET /api/v1/projects/:projectId/export.
 *
 * Regression guard for the BigInt-serialization bug: exportProject() returned a
 * BudgetCategory.actualVnd that was still a BigInt, which is fine in-process but
 * makes NextResponse.json() (JSON.stringify) throw at the HTTP boundary → 500.
 * The service-level unit test never caught it because its seed had no budget
 * categories AND it never serialized the result. This test drives the real route
 * handler and calls res.json(), reproducing the exact failure surface.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/server/prisma';
import { signAccess } from '@/server/auth/tokens';
import { GET } from './route';

let orgId: string;
let ownerUserId: string;
let viewerUserId: string;
let pid: string;
let ownerToken: string;
let viewerToken: string;

function callExport(token: string | null): Promise<Response> {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const req = new Request(`http://test/api/v1/projects/${pid}/export`, { headers });
  return GET(req, { params: { projectId: pid } } as never);
}

beforeAll(async () => {
  const ts = Date.now();
  const org = await prisma.organization.create({ data: { slug: `xp-${ts}`, name: 'ExportRouteOrg' } });
  orgId = org.id;

  ownerUserId = (
    await prisma.user.create({
      data: { orgId, name: 'XPOwner', email: `xp-owner-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;
  viewerUserId = (
    await prisma.user.create({
      data: { orgId, name: 'XPViewer', email: `xp-viewer-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  const project = await prisma.project.create({
    data: { orgId, name: `XPProject-${ts}`, budgetCapVnd: BigInt(1_000), createdById: ownerUserId },
  });
  pid = project.id;

  await prisma.projectMember.create({ data: { projectId: pid, userId: ownerUserId, role: 'OWNER' } });
  await prisma.projectMember.create({ data: { projectId: pid, userId: viewerUserId, role: 'VIEWER' } });

  // A budget category with non-zero BigInt money fields — this is what regressed.
  await prisma.budgetCategory.create({
    data: { projectId: pid, name: 'Ops', plannedVnd: BigInt(500), actualVnd: BigInt(250) },
  });

  ownerToken = signAccess({ sub: ownerUserId, orgId });
  viewerToken = signAccess({ sub: viewerUserId, orgId });
});

afterAll(async () => {
  await prisma.budgetCategory.deleteMany({ where: { projectId: pid } });
  await prisma.project.deleteMany({ where: { id: pid } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, viewerUserId] } } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe('GET /projects/:projectId/export', () => {
  it('returns 200 and a JSON-serializable body with money as numbers (BigInt regression)', async () => {
    const res = await callExport(ownerToken);
    expect(res.status).toBe(200);

    // res.json() is where a leftover BigInt would have already thrown during
    // NextResponse.json() inside the handler, surfacing as a 500 above.
    const body = (await res.json()) as {
      project: { budgetCapVnd: unknown };
      budgetCategories: Array<{ plannedVnd: unknown; actualVnd: unknown }>;
    };

    expect(typeof body.project.budgetCapVnd).toBe('number');
    expect(body.budgetCategories).toHaveLength(1);
    expect(typeof body.budgetCategories[0]!.plannedVnd).toBe('number');
    expect(typeof body.budgetCategories[0]!.actualVnd).toBe('number');
    expect(body.budgetCategories[0]!.actualVnd).toBe(250);
  });

  it('rejects a request with no bearer token (401)', async () => {
    const res = await callExport(null);
    expect(res.status).toBe(401);
  });

  it('forbids a VIEWER from exporting (403)', async () => {
    const res = await callExport(viewerToken);
    expect(res.status).toBe(403);
  });
});
