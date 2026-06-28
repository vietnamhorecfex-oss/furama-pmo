/**
 * P-03 — Project endpoints (docs/04 §2).
 * Authz is asserted in the service so service-direct callers (other modules, tests) can't bypass it.
 * Guards here only gate at the HTTP layer.
 */
import {
  Body,
  Controller,
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
  createProjectSchema,
  updateProjectMetaSchema,
  type CreateProjectDto,
  type ProjectDto,
  type UpdateProjectMetaDto,
} from '@furama/shared';
import { ZodPipe } from '../common/zod.pipe';
import {
  JwtAuthGuard,
  ProjectMemberGuard,
  type AuthedRequest,
} from '../rbac/guards';
import { ProjectsService } from './projects.service';

function ctxFromReq(req: AuthedRequest): { userId: string; orgId: string; ip: string | null } {
  return { userId: req.user.sub, orgId: req.user.orgId, ip: req.ip ?? null };
}

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Req() req: AuthedRequest): Promise<ProjectDto[]> {
    return this.projects.list(ctxFromReq(req));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodPipe(createProjectSchema)) dto: CreateProjectDto,
    @Req() req: AuthedRequest,
  ): Promise<ProjectDto> {
    const c = ctxFromReq(req);
    return this.projects.create(c, dto, c.ip);
  }

  @Get(':projectId')
  @UseGuards(ProjectMemberGuard)
  get(@Param('projectId') projectId: string, @Req() req: AuthedRequest): Promise<ProjectDto> {
    return this.projects.get(ctxFromReq(req), projectId);
  }

  @Patch(':projectId')
  @UseGuards(ProjectMemberGuard)
  updateMeta(
    @Param('projectId') projectId: string,
    @Body(new ZodPipe(updateProjectMetaSchema)) dto: UpdateProjectMetaDto,
    @Req() req: AuthedRequest,
  ): Promise<ProjectDto> {
    const c = ctxFromReq(req);
    return this.projects.updateMeta(c, projectId, dto, c.ip);
  }

  @Post(':projectId/archive')
  @UseGuards(ProjectMemberGuard)
  archive(@Param('projectId') projectId: string, @Req() req: AuthedRequest): Promise<ProjectDto> {
    const c = ctxFromReq(req);
    return this.projects.archive(c, projectId, c.ip);
  }
}
