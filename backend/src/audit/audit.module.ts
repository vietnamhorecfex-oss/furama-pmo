import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { ActivityController } from './audit.controller';

@Global()
@Module({
  controllers: [ActivityController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
