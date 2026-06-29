import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { BudgetSummary } from '@furama/shared';
import { JwtAuthGuard, ProjectMemberGuard, type AuthedRequest } from '../rbac/guards';
import { BudgetService } from './budget.service';

@Controller('projects/:projectId/budget')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class BudgetController {
  constructor(private readonly budget: BudgetService) {}

  @Get('summary')
  summary(@Param('projectId') projectId: string, @Req() req: AuthedRequest): Promise<BudgetSummary> {
    return this.budget.summary({ userId: req.user.sub, orgId: req.user.orgId }, projectId);
  }
}
