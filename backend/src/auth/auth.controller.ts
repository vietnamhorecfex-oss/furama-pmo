/**
 * A-06 — Auth endpoints. The refresh token lives ONLY in an httpOnly Secure SameSite=Strict
 * cookie; clients never see or send it in JSON. Access token is returned in JSON for the SPA
 * to attach as Authorization: Bearer.
 *
 * Rate limit (docs/04 §7): 10/min/IP on register/login/refresh via @nestjs/throttler.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Get,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  loginSchema,
  registerSchema,
  type LoginResponse,
  type MeResponse,
  type RefreshResponse,
} from '@furama/shared';
import { ZodPipe } from '../common/zod.pipe';
import { JwtAuthGuard, type AuthedRequest } from '../rbac/guards';
import type { AppConfig } from '../config/env';
import { AuthService } from './auth.service';
import type { IssuedTokens } from './tokens.service';

const REFRESH_COOKIE = 'furama_refresh';
const AUTH_RATE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  private readonly cookieSecure: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cookieSecure = config.get('COOKIE_SECURE', { infer: true });
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle(AUTH_RATE)
  async register(
    @Body(new ZodPipe(registerSchema)) dto: Parameters<AuthService['register']>[0],
    @Req() req: Request,
  ): Promise<{ user: import('@furama/shared').PublicUser }> {
    return this.auth.register(dto, extractIp(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_RATE)
  async login(
    @Body(new ZodPipe(loginSchema)) dto: Parameters<AuthService['login']>[0],
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const { tokens, response } = await this.auth.login(dto, extractIp(req));
    this.setRefreshCookie(res, tokens);
    return response;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_RATE)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponse> {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw || typeof raw !== 'string') {
      throw new UnauthorizedException('Missing refresh cookie');
    }
    const tokens = await this.auth.refresh(raw, extractIp(req));
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw = req.cookies?.[REFRESH_COOKIE];
    await this.auth.logout(typeof raw === 'string' ? raw : undefined);
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: AuthedRequest): Promise<MeResponse> {
    return this.auth.getMe(req.user.sub);
  }

  // -----

  private setRefreshCookie(res: Response, tokens: IssuedTokens): void {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: 'strict',
      path: '/',
      expires: tokens.refreshExpiresAt,
    });
  }
}

function extractIp(req: Request): string | null {
  // Trust whatever Express resolved. CIDR/forwarded-header handling is configured at the proxy.
  return req.ip ?? null;
}
