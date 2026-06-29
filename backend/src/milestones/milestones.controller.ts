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
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createMilestoneSchema,
  setMilestoneStatusSchema,
  updateMilestoneSchema,
  type CreateMilestoneDto,
  type MilestoneDto,
  type SetMilestoneStatusDto,
  type UpdateMilestoneDto,
} from '@furama/shared';
import { ZodPipe } from '../common/zod.pipe';
import { JwtAuthGuard, ProjectMemberGuard, type AuthedRequest } from '../rbac/guards';
import { MilestonesService } from './milestones.service';

function ctxFromReq(req: AuthedRequest): { userId: string; orgId: string; ip: string | null } {
  return { userId: req.user.sub, orgId: req.user.orgId, ip: req.ip ?? null };
}

@Controller('projects/:projectId/milestones')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class ProjectMilestonesController {
  constructor(private readonly milestones: MilestonesService) {}

  @Get()
  list(@Param('projectId') pid: string, @Req() req: AuthedRequest): Promise<MilestoneDto[]> {
    return this.milestones.list(ctxFromReq(req), pid);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('projectId') pid: string,
    @Body(new ZodPipe(createMilestoneSchema)) dto: CreateMilestoneDto,
    @Req() req: AuthedRequest,
  ): Promise<MilestoneDto> {
    const c = ctxFromReq(req);
    return this.milestones.create(c, pid, dto, c.ip);
  }
}

@Controller('milestones')
@UseGuards(JwtAuthGuard)
export class MilestonesController {
  constructor(private readonly milestones: MilestonesService) {}

  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.milestones.get(ctxFromReq(req), id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodPipe(updateMilestoneSchema)) dto: UpdateMilestoneDto,
    @Req() req: AuthedRequest,
  ) {
    const c = ctxFromReq(req);
    return this.milestones.update(c, id, dto, c.ip);
  }

  @Patch(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body(new ZodPipe(setMilestoneStatusSchema)) dto: SetMilestoneStatusDto,
    @Req() req: AuthedRequest,
  ) {
    const c = ctxFromReq(req);
    return this.milestones.setStatus(c, id, dto, c.ip);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    await this.milestones.delete(c, id, c.ip);
  }
}
