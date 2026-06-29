/**
 * M8 — AI endpoints (docs/09 §8):
 *  POST /projects/:pid/ai/chat          — send a message, get reply + proposed actions
 *  POST /ai/actions/:id/confirm         — execute a proposed write action
 *  POST /ai/actions/:id/reject          — discard a proposed action
 *  GET  /projects/:pid/notifications    — list notifications
 *  POST /notifications/:id/read         — mark notification read
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { JwtAuthGuard, ProjectMemberGuard, type AuthedRequest } from '../rbac/guards';
import { AssistantService } from './assistant.service';

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
}).strict();

type ChatDto = z.infer<typeof chatSchema>;

function ctx(req: AuthedRequest) {
  return { userId: req.user.sub, orgId: req.user.orgId };
}

// ─── Project-scoped endpoints ─────────────────────────────────────────────────

@Controller('projects/:projectId/ai')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class ProjectAiController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  chat(
    @Req() req: AuthedRequest,
    @Param('projectId') projectId: string,
    @Body(new ZodPipe(chatSchema)) dto: ChatDto,
  ) {
    return this.assistant.chat(ctx(req), projectId, dto.message, dto.conversationId);
  }

}

// ─── Notifications ────────────────────────────────────────────────────────────

@Controller('projects/:projectId/notifications')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class NotificationsController {
  constructor(private readonly assistant: AssistantService) {}

  @Get()
  list(
    @Req() req: AuthedRequest,
    @Param('projectId') projectId: string,
    @Query('unread') unread?: string,
  ) {
    return this.assistant.listNotifications(ctx(req), projectId, unread === 'true');
  }
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationActionsController {
  constructor(private readonly assistant: AssistantService) {}

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.assistant.markRead(ctx(req), id);
  }
}

// ─── Action confirm / reject ──────────────────────────────────────────────────

@Controller('ai/actions')
@UseGuards(JwtAuthGuard)
export class AiActionsController {
  constructor(private readonly assistant: AssistantService) {}

  @Post(':id/confirm')
  confirm(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.assistant.confirmAction(ctx(req), id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reject(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.assistant.rejectAction(ctx(req), id);
  }
}
