import { Module } from '@nestjs/common';
import { MilestonesController, ProjectMilestonesController } from './milestones.controller';
import { MilestonesService } from './milestones.service';

@Module({
  controllers: [ProjectMilestonesController, MilestonesController],
  providers: [MilestonesService],
  exports: [MilestonesService],
})
export class MilestonesModule {}
