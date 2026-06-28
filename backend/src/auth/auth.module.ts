import { forwardRef, Global, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TokensService } from './tokens.service';

/**
 * @Global so that TokensService is reachable from every feature module's JwtAuthGuard
 * without needing each module to import AuthModule explicitly.
 */
@Global()
@Module({
  imports: [UsersModule, forwardRef(() => RbacModule)],
  controllers: [AuthController],
  providers: [AuthService, TokensService],
  exports: [TokensService],
})
export class AuthModule {}
