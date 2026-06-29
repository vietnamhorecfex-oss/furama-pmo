import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
  budgetImportSchema,
  setBudgetCapSchema,
  updateCategoryAmountsSchema,
  type BudgetImportDto,
  type BudgetImportResult,
  type BudgetSummary,
  type SetBudgetCapDto,
  type UpdateCategoryAmountsDto,
} from '@furama/shared';
import { ZodPipe } from '../common/zod.pipe';
import { JwtAuthGuard, ProjectMemberGuard, type AuthedRequest } from '../rbac/guards';
import { BudgetService } from './budget.service';

@Controller('projects/:projectId/budget')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class BudgetController {
  constructor(private readonly budget: BudgetService) {}

  @Get('summary')
  summary(@Param('projectId') projectId: string, @Req() req: AuthedRequest): Promise<BudgetSummary> {
    return this.budget.summary(ctx(req), projectId);
  }

  @Patch('cap')
  setCap(
    @Param('projectId') projectId: string,
    @Body(new ZodPipe(setBudgetCapSchema)) dto: SetBudgetCapDto,
    @Req() req: AuthedRequest,
  ): Promise<BudgetSummary> {
    return this.budget.setCap(ctx(req), projectId, dto.capVnd, req.ip ?? null);
  }

  @Patch('categories/:categoryId')
  setCategoryAmounts(
    @Param('projectId') projectId: string,
    @Param('categoryId') categoryId: string,
    @Body(new ZodPipe(updateCategoryAmountsSchema)) dto: UpdateCategoryAmountsDto,
    @Req() req: AuthedRequest,
  ): Promise<BudgetSummary> {
    return this.budget.setCategoryAmounts(ctx(req), projectId, categoryId, dto, req.ip ?? null);
  }

  @Post('import')
  import(
    @Param('projectId') projectId: string,
    @Body(new ZodPipe(budgetImportSchema)) dto: BudgetImportDto,
    @Req() req: AuthedRequest,
  ): Promise<BudgetImportResult> {
    return this.budget.importBudget(ctx(req), projectId, dto, req.ip ?? null);
  }
}

function ctx(req: AuthedRequest) {
  return { userId: req.user.sub, orgId: req.user.orgId };
}
