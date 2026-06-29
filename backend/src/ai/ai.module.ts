import { Module } from '@nestjs/common';
import { AssistantService } from './assistant.service';
import {
  ProjectAiController,
  NotificationsController,
  NotificationActionsController,
  AiActionsController,
} from './ai.controller';
import { TasksModule } from '../tasks/tasks.module';
import { BudgetModule } from '../budget/budget.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { CommentsModule } from '../comments/comments.module';
import { ConfigDimModule } from '../config-dim/config.module';

@Module({
  imports: [TasksModule, BudgetModule, DashboardModule, CommentsModule, ConfigDimModule],
  controllers: [
    ProjectAiController,
    NotificationsController,
    NotificationActionsController,
    AiActionsController,
  ],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AiModule {}
