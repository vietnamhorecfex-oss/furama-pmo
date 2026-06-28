/**
 * P-05 — Member endpoints (docs/04 §2). Routed under /projects/:projectId/members.
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
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  addMemberSchema,
  updateMemberSchema,
  type AddMemberDto,
  type MemberDto,
  type UpdateMemberDto,
} from '@furama/shared';
import { ZodPipe } from '../common/zod.pipe';
import {
  JwtAuthGuard,
  ProjectMemberGuard,
  type AuthedRequest,
} from '../rbac/guards';
import { MembersService } from './members.service';

function ctxFromReq(req: AuthedRequest): { userId: string; orgId: string; ip: string | null } {
  return { userId: req.user.sub, orgId: req.user.orgId, ip: req.ip ?? null };
}

@Controller('projects/:projectId/members')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@Param('projectId') projectId: string, @Req() req: AuthedRequest): Promise<MemberDto[]> {
    return this.members.list(ctxFromReq(req), projectId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  add(
    @Param('projectId') projectId: string,
    @Body(new ZodPipe(addMemberSchema)) dto: AddMemberDto,
    @Req() req: AuthedRequest,
  ): Promise<MemberDto> {
    const c = ctxFromReq(req);
    return this.members.add(c, projectId, dto, c.ip);
  }

  @Patch(':memberId')
  update(
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
    @Body(new ZodPipe(updateMemberSchema)) dto: UpdateMemberDto,
    @Req() req: AuthedRequest,
  ): Promise<MemberDto> {
    const c = ctxFromReq(req);
    return this.members.update(c, projectId, memberId, dto, c.ip);
  }

  @Delete(':memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    const c = ctxFromReq(req);
    await this.members.remove(c, projectId, memberId, c.ip);
  }
}
