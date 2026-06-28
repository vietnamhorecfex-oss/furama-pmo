/**
 * T-04 — Task endpoints (docs/04 §3).
 *
 * Two controllers because docs/04 routes some endpoints under /projects/:projectId/tasks
 * (project-scoped operations: list/create/mine) and others under /tasks/:id (taskId scoped).
 * Splitting them keeps the URL grammar and guard wiring honest — ProjectMemberGuard only
 * makes sense on routes that carry :projectId in the path.
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
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createTaskSchema,
  listTasksQuerySchema,
  progressUpdateSchema,
  setAssignmentsSchema,
  setDependenciesSchema,
  updateTaskSchema,
  type CreateTaskDto,
  type ListTasksQuery,
  type ProgressUpdateDto,
  type SetAssignmentsDto,
  type SetDependenciesDto,
  type UpdateTaskDto,
} from '@furama/shared';
import { ZodPipe } from '../common/zod.pipe';
import {
  JwtAuthGuard,
  ProjectMemberGuard,
  type AuthedRequest,
} from '../rbac/guards';
import { TasksService } from './tasks.service';

function ctxFromReq(req: AuthedRequest): { userId: string; orgId: string; ip: string | null } {
  return { userId: req.user.sub, orgId: req.user.orgId, ip: req.ip ?? null };
}

@Controller('projects/:projectId/tasks')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class ProjectTasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(
    @Param('projectId') projectId: string,
    @Query(new ZodPipe(listTasksQuerySchema)) q: ListTasksQuery,
    @Req() req: AuthedRequest,
  ) {
    return this.tasks.list(ctxFromReq(req), projectId, q);
  }

  @Get('mine')
  mine(@Param('projectId') projectId: string, @Req() req: AuthedRequest) {
    return this.tasks.myTasks(ctxFromReq(req), projectId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('projectId') projectId: string,
    @Body(new ZodPipe(createTaskSchema)) dto: CreateTaskDto,
    @Req() req: AuthedRequest,
  ) {
    const c = ctxFromReq(req);
    return this.tasks.create(c, projectId, dto, c.ip);
  }
}

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.tasks.get(ctxFromReq(req), id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodPipe(updateTaskSchema)) dto: UpdateTaskDto,
    @Req() req: AuthedRequest,
  ) {
    const c = ctxFromReq(req);
    return this.tasks.update(c, id, dto, c.ip);
  }

  @Patch(':id/progress')
  progress(
    @Param('id') id: string,
    @Body(new ZodPipe(progressUpdateSchema)) dto: ProgressUpdateDto,
    @Req() req: AuthedRequest,
  ) {
    const c = ctxFromReq(req);
    return this.tasks.updateProgress(c, id, dto, c.ip);
  }

  @Put(':id/assignments')
  setAssignments(
    @Param('id') id: string,
    @Body(new ZodPipe(setAssignmentsSchema)) dto: SetAssignmentsDto,
    @Req() req: AuthedRequest,
  ) {
    const c = ctxFromReq(req);
    return this.tasks.setAssignments(c, id, dto, c.ip);
  }

  @Put(':id/dependencies')
  setDependencies(
    @Param('id') id: string,
    @Body(new ZodPipe(setDependenciesSchema)) dto: SetDependenciesDto,
    @Req() req: AuthedRequest,
  ) {
    const c = ctxFromReq(req);
    return this.tasks.setDependencies(c, id, dto, c.ip);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @Req() req: AuthedRequest) {
    const c = ctxFromReq(req);
    await this.tasks.delete(c, id, c.ip);
  }
}
