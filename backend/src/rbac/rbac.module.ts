import { forwardRef, Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacService } from './rbac.service';
import { JwtAuthGuard, ProjectMemberGuard } from './guards';

@Global()
@Module({
  // forwardRef breaks the cycle: AuthModule depends on RbacModule (for guards on /me)
  // and RbacModule's JwtAuthGuard depends on AuthModule's TokensService.
  imports: [forwardRef(() => AuthModule)],
  providers: [RbacService, JwtAuthGuard, ProjectMemberGuard],
  exports: [RbacService, JwtAuthGuard, ProjectMemberGuard],
})
export class RbacModule {}
