/**
 * C-01 — Activity feed endpoints (docs/04 §3 GET /projects/:pid/activity).
 * Entity-history is exposed as /projects/:pid/activity?entityType=Task&entityId=... when
 * a caller wants the full trail of one row; or via the dedicated /history sub-route below.
 */
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { activityQuerySchema, type ActivityQuery, type AuditLogDto, type Paginated } from '@furama/shared';
import { ZodPipe } from '../common/zod.pipe';
import { JwtAuthGuard, ProjectMemberGuard, type AuthedRequest } from '../rbac/guards';
import { AuditService } from './audit.service';

@Controller('projects/:projectId/activity')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class ActivityController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  feed(
    @Param('projectId') projectId: string,
    @Query(new ZodPipe(activityQuerySchema)) q: ActivityQuery,
    @Req() req: AuthedRequest,
  ): Promise<Paginated<AuditLogDto>> {
    return this.audit.feed({ userId: req.user.sub, orgId: req.user.orgId }, projectId, q);
  }

  @Get('history/:entityType/:entityId')
  history(
    @Param('projectId') projectId: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Req() req: AuthedRequest,
  ): Promise<AuditLogDto[]> {
    return this.audit.entityHistory(
      { userId: req.user.sub, orgId: req.user.orgId },
      projectId,
      entityType,
      entityId,
    );
  }
}
