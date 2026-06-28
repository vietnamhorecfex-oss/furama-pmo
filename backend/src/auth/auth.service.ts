/**
 * A-05 — AuthService. Register, login, refresh, logout, getMe.
 *
 * Password hashing: Argon2id with parameters from env (docs/06 §password). The hash is
 * upgraded transparently if the configured cost differs from the stored hash.
 *
 * Login responses never differentiate "user not found" vs "wrong password" — both return the
 * same generic 401 to prevent user enumeration (docs/03 M-AUTH AC).
 *
 * First user of an org self-bootstraps an Organization and becomes OWNER (docs/04 §1).
 */
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import type {
  LoginDto,
  LoginResponse,
  MeResponse,
  PublicUser,
  RegisterDto,
} from '@furama/shared';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService, toPublicUser } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { TokensService, type IssuedTokens } from './tokens.service';
import type { AppConfig } from '../config/env';

interface RegisterResult {
  user: PublicUser;
}

@Injectable()
export class AuthService {
  private readonly argonOptions: argon2.Options;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.argonOptions = {
      type: argon2.argon2id,
      memoryCost: config.get('ARGON2_MEMORY_KIB', { infer: true }),
      timeCost: config.get('ARGON2_TIME_COST', { infer: true }),
      parallelism: config.get('ARGON2_PARALLELISM', { infer: true }),
    };
  }

  async register(dto: RegisterDto, ip: string | null): Promise<RegisterResult> {
    // Resolve / bootstrap the Organization. First user of an org → owner of that org's first project later.
    const slug = (dto.orgSlug ?? defaultOrgSlug(dto.email)).toLowerCase();
    const org = await this.prisma.organization.upsert({
      where: { slug },
      update: {},
      create: { slug, name: slug },
    });

    if (await this.users.existsByEmail(org.id, dto.email)) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await argon2.hash(dto.password, this.argonOptions);
    const user = await this.users.create({
      orgId: org.id,
      name: dto.name,
      email: dto.email,
      passwordHash,
    });

    await this.audit.record(
      { actorId: user.id, ip },
      { action: 'user.registered', entityType: 'User', entityId: user.id, after: { email: user.email } },
    );

    return { user };
  }

  async login(
    dto: LoginDto,
    ip: string | null,
  ): Promise<{ tokens: IssuedTokens; response: LoginResponse }> {
    // Don't leak whether the email exists — same generic error for both branches.
    const generic = new UnauthorizedException('Invalid email or password');

    // Find by email across orgs. In the current single-org bootstrap there is at most one match;
    // when multi-tenancy adds org disambiguation we'll thread orgSlug through this path.
    const rows = await this.prisma.user.findMany({
      where: { email: dto.email.toLowerCase() },
      take: 2,
    });
    if (rows.length !== 1) throw generic;
    const userRow = rows[0]!;
    if (!userRow.isActive) throw generic;

    const ok = await argon2.verify(userRow.passwordHash, dto.password);
    if (!ok) throw generic;

    // Opportunistic rehash if the configured cost has moved beyond the stored hash.
    if (argon2.needsRehash(userRow.passwordHash, this.argonOptions)) {
      const newHash = await argon2.hash(dto.password, this.argonOptions);
      await this.prisma.user.update({ where: { id: userRow.id }, data: { passwordHash: newHash } });
    }

    await this.users.touchLastLogin(userRow.id);
    const tokens = await this.tokens.issueOnLogin(
      { id: userRow.id, orgId: userRow.orgId },
      ip,
    );

    await this.audit.record(
      { actorId: userRow.id, ip },
      { action: 'user.login', entityType: 'User', entityId: userRow.id },
    );

    return {
      tokens,
      response: { accessToken: tokens.accessToken, user: toPublicUser(userRow) },
    };
  }

  async refresh(rawRefreshToken: string, ip: string | null): Promise<IssuedTokens> {
    return this.tokens.rotate(rawRefreshToken, ip);
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    await this.tokens.revokeByRawToken(rawRefreshToken);
  }

  async getMe(userId: string): Promise<MeResponse> {
    const user = await this.users.findById(userId);
    const memberships = await this.prisma.projectMember.findMany({
      where: { userId },
      select: { projectId: true, role: true, memberLabel: true },
    });
    return {
      user,
      memberships: memberships.map((m) => ({
        projectId: m.projectId,
        role: m.role,
        memberLabel: m.memberLabel,
      })),
    };
  }
}

function defaultOrgSlug(email: string): string {
  const at = email.indexOf('@');
  const domain = at >= 0 ? email.slice(at + 1) : email;
  // strip TLD, normalise to slug
  const base = domain.split('.')[0] ?? 'org';
  return base.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'org';
}
