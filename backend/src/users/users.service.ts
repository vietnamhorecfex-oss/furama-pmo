/**
 * A-03 — UsersService. Owns global user identity within an org.
 * `passwordHash` is NEVER exposed outside this module: every public-facing return value
 * goes through `toPublicUser()` first. AuthService is the only consumer of `findByEmail`
 * (which returns the hash for verification).
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { PublicUser } from '@furama/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateUserInput {
  orgId: string;
  name: string;
  email: string;
  passwordHash: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Internal use only — returns the hash. Caller must NEVER leak this to clients. */
  async findByEmailWithHash(orgId: string, email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { orgId, email: email.toLowerCase() },
    });
  }

  async findById(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return toPublicUser(user);
  }

  async create(input: CreateUserInput): Promise<PublicUser> {
    const created = await this.prisma.user.create({
      data: {
        orgId: input.orgId,
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
      },
    });
    return toPublicUser(created);
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  async existsByEmail(orgId: string, email: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { orgId, email: email.toLowerCase() },
    });
    return count > 0;
  }
}

/** Strip passwordHash and normalize date to ISO. Single conversion point for safety. */
export function toPublicUser(user: User): PublicUser {
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
