import type { NextResponse } from 'next/server';
import { getConfig } from '../config';
import type { IssuedTokens } from './tokens';

export const REFRESH_COOKIE = 'furama_refresh';

export function setRefreshCookie(res: NextResponse, tokens: IssuedTokens): void {
  res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: getConfig().COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
    expires: tokens.refreshExpiresAt,
  });
}

export function clearRefreshCookie(res: NextResponse): void {
  res.cookies.set(REFRESH_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}
