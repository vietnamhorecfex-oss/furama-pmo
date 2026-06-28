import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

/** Global so any service can inject RealtimeGateway and call emit(). */
@Global()
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
