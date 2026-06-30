import type { LoginDto, LoginResponse, MeResponse, PublicUser, RegisterDto } from '@furama/shared';
import { prisma } from '../prisma';
import { hashPassword, verifyPassword, needsRehash } from './passwords';
import { issueOnLogin, rotate, revokeByRawToken, verifyAccess, type IssuedTokens } from './tokens';
import { auditRecord } from '../audit/audit';
import { Conflict, NotFound, Unauthorized } from '../http/errors';

export function toPublicUser(user: {
  id: string;
  orgId: string;
  name: string;
  email: string;
  avatarColor: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
}): PublicUser {
  return {
    id: user.id,
    orgId: user.orgId,
    name: user.name,
    email: user.email,
    avatarColor: user.avatarColor,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  };
}

function defaultOrgSlug(email: string): string {
  const at = email.indexOf('@');
  const domain = at >= 0 ? email.slice(at + 1) : email;
  const base = domain.split('.')[0] ?? 'org';
  return base.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'org';
}

export async function registerUser(dto: RegisterDto, ip: string | null): Promise<{ user: PublicUser }> {
  const slug = (dto.orgSlug ?? defaultOrgSlug(dto.email)).toLowerCase();
  const org = await prisma.organization.upsert({
    where: { slug },
    update: {},
    create: { slug, name: slug },
  });
  const exists = await prisma.user.findFirst({
    where: { orgId: org.id, email: dto.email.toLowerCase() },
    select: { id: true },
  });
  if (exists) throw new Conflict('Email already registered');
  const passwordHash = await hashPassword(dto.password);
  const user = await prisma.user.create({
    data: {
      orgId: org.id,
      name: dto.name,
      email: dto.email.toLowerCase(),
      passwordHash,
      isActive: true,
    },
  });
  await auditRecord(
    { actorId: user.id, ip },
    { action: 'user.registered', entityType: 'User', entityId: user.id, after: { email: user.email } },
  );
  return { user: toPublicUser(user) };
}

export async function loginUser(
  dto: LoginDto,
  ip: string | null,
): Promise<{ tokens: IssuedTokens; response: LoginResponse }> {
  const generic = new Unauthorized('Invalid email or password');
  const rows = await prisma.user.findMany({ where: { email: dto.email.toLowerCase() }, take: 2 });
  if (rows.length !== 1) throw generic;
  const userRow = rows[0]!;
  if (!userRow.isActive) throw generic;
  if (!(await verifyPassword(userRow.passwordHash, dto.password))) throw generic;
  if (needsRehash(userRow.passwordHash)) {
    await prisma.user.update({
      where: { id: userRow.id },
      data: { passwordHash: await hashPassword(dto.password) },
    });
  }
  const updatedUser = await prisma.user.update({
    where: { id: userRow.id },
    data: { lastLoginAt: new Date() },
  });
  const tokens = await issueOnLogin({ id: userRow.id, orgId: userRow.orgId }, ip);
  await auditRecord(
    { actorId: userRow.id, ip },
    { action: 'user.login', entityType: 'User', entityId: userRow.id },
  );
  return { tokens, response: { accessToken: tokens.accessToken, user: toPublicUser(updatedUser) } };
}

export async function refreshSession(rawRefresh: string, ip: string | null): Promise<IssuedTokens> {
  return rotate(rawRefresh, ip);
}

export async function logoutSession(rawRefresh?: string): Promise<void> {
  if (rawRefresh) await revokeByRawToken(rawRefresh);
}

export async function getMe(userId: string): Promise<MeResponse> {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u) throw new NotFound('User not found');
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    select: { projectId: true, role: true, memberLabel: true },
  });
  return { user: toPublicUser(u), memberships };
}

