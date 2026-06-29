import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { DashboardOverview } from '@furama/shared';
import { JwtAuthGuard, ProjectMemberGuard, type AuthedRequest } from '../rbac/guards';
import { DashboardService } from './dashboard.service';

@Controller('projects/:projectId/dashboard')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  overview(@Param('projectId') projectId: string, @Req() req: AuthedRequest): Promise<DashboardOverview> {
    return this.dashboard.overview({ userId: req.user.sub, orgId: req.user.orgId }, projectId);
  }
}
