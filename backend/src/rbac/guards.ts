/**
 * A-10 — Auth + RBAC guards.
 *
 * JwtAuthGuard: extracts `Authorization: Bearer <jwt>`, verifies via TokensService,
 *   attaches `req.user = { sub, orgId }`.
 *
 * ProjectMemberGuard: requires `:projectId` route param and that the authed user is
 *   a member of that project. Apply with @UseGuards(JwtAuthGuard, ProjectMemberGuard).
 *
 * @RequireCapability(cap): set the capability metadata so a controller-method-level
 *   CapabilityGuard (added when needed) can enforce non-scope capabilities declaratively.
 *   Scope-aware checks belong in the service layer (call RbacService.assertCan there).
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  applyDecorators,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Capability } from '@furama/shared';
import { TokensService } from '../auth/tokens.service';
import { RbacService } from './rbac.service';

export interface AuthedUser {
  sub: string;
  orgId: string;
}

export interface AuthedRequest extends Request {
  user: AuthedUser;
  params: Record<string, string>;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(TokensService) private readonly tokens: TokensService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }
    const token = auth.slice('Bearer '.length).trim();
    const claims = this.tokens.verifyAccess(token);
    req.user = { sub: claims.sub, orgId: claims.orgId };
    return true;
  }
}

@Injectable()
export class ProjectMemberGuard implements CanActivate {
  constructor(@Inject(RbacService) private readonly rbac: RbacService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) {
      throw new UnauthorizedException('Use JwtAuthGuard before ProjectMemberGuard');
    }
    const projectId = req.params.projectId ?? req.params.pid;
    if (!projectId) {
      throw new ForbiddenException('Project context required');
    }
    const role = await this.rbac.effectiveRole(req.user.sub, projectId);
    if (!role) {
      throw new ForbiddenException('Not a member of this project');
    }
    return true;
  }
}

export const CAPABILITY_META = 'rbac:capability';
export const RequireCapability = (capability: Capability): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(CAPABILITY_META, capability), UseGuards(JwtAuthGuard, ProjectMemberGuard));
