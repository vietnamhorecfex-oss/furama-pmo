/**
 * Comment endpoints: GET/POST /tasks/:taskId/comments (docs/04 §3).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { addCommentSchema, type AddCommentDto, type CommentDto } from '@furama/shared';
import { ZodPipe } from '../common/zod.pipe';
import { JwtAuthGuard, type AuthedRequest } from '../rbac/guards';
import { CommentsService } from './comments.service';

function ctxFromReq(req: AuthedRequest): { userId: string; orgId: string; ip: string | null } {
  return { userId: req.user.sub, orgId: req.user.orgId, ip: req.ip ?? null };
}

@Controller('tasks/:taskId/comments')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  list(@Param('taskId') taskId: string, @Req() req: AuthedRequest): Promise<CommentDto[]> {
    return this.comments.list(ctxFromReq(req), taskId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  add(
    @Param('taskId') taskId: string,
    @Body(new ZodPipe(addCommentSchema)) dto: AddCommentDto,
    @Req() req: AuthedRequest,
  ): Promise<CommentDto> {
    const c = ctxFromReq(req);
    return this.comments.add(c, taskId, dto.body, c.ip);
  }
}
