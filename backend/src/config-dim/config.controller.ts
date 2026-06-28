/**
 * P-07 — Config endpoints for the five project dimensions (docs/04 §2). Each dimension gets
 * GET/POST/PATCH/DELETE plus a POST /reorder. Authz lives in the service; guards here gate at
 * the HTTP layer.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createBudgetCategorySchema,
  createPhaseSchema,
  createPriorityDefSchema,
  createStatusDefSchema,
  createWorkstreamSchema,
  deleteWithReplacementSchema,
  reorderSchema,
  updateBudgetCategorySchema,
  updatePhaseSchema,
  updatePriorityDefSchema,
  updateStatusDefSchema,
  updateWorkstreamSchema,
} from '@furama/shared';
import { ZodPipe } from '../common/zod.pipe';
import {
  JwtAuthGuard,
  ProjectMemberGuard,
  type AuthedRequest,
} from '../rbac/guards';
import { ConfigService } from './config.service';

function ctxFromReq(req: AuthedRequest): { userId: string; orgId: string; ip: string | null } {
  return { userId: req.user.sub, orgId: req.user.orgId, ip: req.ip ?? null };
}

@Controller('projects/:projectId')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class ConfigController {
  constructor(private readonly config: ConfigService) {}

  // ---------- PHASES
  @Get('phases')
  listPhases(@Param('projectId') pid: string, @Req() req: AuthedRequest) {
    return this.config.listPhases(ctxFromReq(req), pid);
  }
  @Post('phases')
  @HttpCode(HttpStatus.CREATED)
  createPhase(@Param('projectId') pid: string, @Body(new ZodPipe(createPhaseSchema)) dto: ReturnType<typeof createPhaseSchema.parse>, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    return this.config.createPhase(c, pid, dto, c.ip);
  }
  @Patch('phases/:id')
  updatePhase(@Param('projectId') pid: string, @Param('id') id: string, @Body(new ZodPipe(updatePhaseSchema)) dto: ReturnType<typeof updatePhaseSchema.parse>, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    return this.config.updatePhase(c, pid, id, dto, c.ip);
  }
  @Delete('phases/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePhase(@Param('projectId') pid: string, @Param('id') id: string, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    await this.config.deletePhase(c, pid, id, c.ip);
  }
  @Post('phases/reorder')
  reorderPhases(@Param('projectId') pid: string, @Body(new ZodPipe(reorderSchema)) dto: ReturnType<typeof reorderSchema.parse>, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    return this.config.reorderPhases(c, pid, dto, c.ip);
  }

  // ---------- WORKSTREAMS
  @Get('workstreams')
  listWorkstreams(@Param('projectId') pid: string, @Req() req: AuthedRequest) {
    return this.config.listWorkstreams(ctxFromReq(req), pid);
  }
  @Post('workstreams')
  @HttpCode(HttpStatus.CREATED)
  createWorkstream(@Param('projectId') pid: string, @Body(new ZodPipe(createWorkstreamSchema)) dto: ReturnType<typeof createWorkstreamSchema.parse>, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    return this.config.createWorkstream(c, pid, dto, c.ip);
  }
  @Patch('workstreams/:id')
  updateWorkstream(@Param('projectId') pid: string, @Param('id') id: string, @Body(new ZodPipe(updateWorkstreamSchema)) dto: ReturnType<typeof updateWorkstreamSchema.parse>, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    return this.config.updateWorkstream(c, pid, id, dto, c.ip);
  }
  @Delete('workstreams/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWorkstream(@Param('projectId') pid: string, @Param('id') id: string, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    await this.config.deleteWorkstream(c, pid, id, c.ip);
  }
  @Post('workstreams/reorder')
  reorderWorkstreams(@Param('projectId') pid: string, @Body(new ZodPipe(reorderSchema)) dto: ReturnType<typeof reorderSchema.parse>, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    return this.config.reorderWorkstreams(c, pid, dto, c.ip);
  }

  // ---------- STATUSES
  @Get('statuses')
  listStatuses(@Param('projectId') pid: string, @Req() req: AuthedRequest) {
    return this.config.listStatuses(ctxFromReq(req), pid);
  }
  @Post('statuses')
  @HttpCode(HttpStatus.CREATED)
  createStatus(@Param('projectId') pid: string, @Body(new ZodPipe(createStatusDefSchema)) dto: ReturnType<typeof createStatusDefSchema.parse>, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    return this.config.createStatus(c, pid, dto, c.ip);
  }
  @Patch('statuses/:id')
  updateStatus(@Param('projectId') pid: string, @Param('id') id: string, @Body(new ZodPipe(updateStatusDefSchema)) dto: ReturnType<typeof updateStatusDefSchema.parse>, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    return this.config.updateStatus(c, pid, id, dto, c.ip);
  }
  @Delete('statuses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteStatus(
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Query(new ZodPipe(deleteWithReplacementSchema)) q: ReturnType<typeof deleteWithReplacementSchema.parse>,
    @Req() req: AuthedRequest,
  ) {
    const c = ctxFromReq(req);
    await this.config.deleteStatus(c, pid, id, q, c.ip);
  }
  @Post('statuses/reorder')
  reorderStatuses(@Param('projectId') pid: string, @Body(new ZodPipe(reorderSchema)) dto: ReturnType<typeof reorderSchema.parse>, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    return this.config.reorderStatuses(c, pid, dto, c.ip);
  }

  // ---------- PRIORITIES
  @Get('priorities')
  listPriorities(@Param('projectId') pid: string, @Req() req: AuthedRequest) {
    return this.config.listPriorities(ctxFromReq(req), pid);
  }
  @Post('priorities')
  @HttpCode(HttpStatus.CREATED)
  createPriority(@Param('projectId') pid: string, @Body(new ZodPipe(createPriorityDefSchema)) dto: ReturnType<typeof createPriorityDefSchema.parse>, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    return this.config.createPriority(c, pid, dto, c.ip);
  }
  @Patch('priorities/:id')
  updatePriority(@Param('projectId') pid: string, @Param('id') id: string, @Body(new ZodPipe(updatePriorityDefSchema)) dto: ReturnType<typeof updatePriorityDefSchema.parse>, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    return this.config.updatePriority(c, pid, id, dto, c.ip);
  }
  @Delete('priorities/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePriority(
    @Param('projectId') pid: string,
    @Param('id') id: string,
    @Query(new ZodPipe(deleteWithReplacementSchema)) q: ReturnType<typeof deleteWithReplacementSchema.parse>,
    @Req() req: AuthedRequest,
  ) {
    const c = ctxFromReq(req);
    await this.config.deletePriority(c, pid, id, q, c.ip);
  }
  @Post('priorities/reorder')
  reorderPriorities(@Param('projectId') pid: string, @Body(new ZodPipe(reorderSchema)) dto: ReturnType<typeof reorderSchema.parse>, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    return this.config.reorderPriorities(c, pid, dto, c.ip);
  }

  // ---------- BUDGET CATEGORIES
  @Get('budget-categories')
  listBudgetCategories(@Param('projectId') pid: string, @Req() req: AuthedRequest) {
    return this.config.listBudgetCategories(ctxFromReq(req), pid);
  }
  @Post('budget-categories')
  @HttpCode(HttpStatus.CREATED)
  createBudgetCategory(@Param('projectId') pid: string, @Body(new ZodPipe(createBudgetCategorySchema)) dto: ReturnType<typeof createBudgetCategorySchema.parse>, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    return this.config.createBudgetCategory(c, pid, dto, c.ip);
  }
  @Patch('budget-categories/:id')
  updateBudgetCategory(@Param('projectId') pid: string, @Param('id') id: string, @Body(new ZodPipe(updateBudgetCategorySchema)) dto: ReturnType<typeof updateBudgetCategorySchema.parse>, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    return this.config.updateBudgetCategory(c, pid, id, dto, c.ip);
  }
  @Delete('budget-categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBudgetCategory(@Param('projectId') pid: string, @Param('id') id: string, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    await this.config.deleteBudgetCategory(c, pid, id, c.ip);
  }
  @Post('budget-categories/reorder')
  reorderBudgetCategories(@Param('projectId') pid: string, @Body(new ZodPipe(reorderSchema)) dto: ReturnType<typeof reorderSchema.parse>, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    return this.config.reorderBudgetCategories(c, pid, dto, c.ip);
  }
}
