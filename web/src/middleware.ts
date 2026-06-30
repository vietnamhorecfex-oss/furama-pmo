import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = ['/login'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p)) || pathname.startsWith('/api') ) return NextResponse.next();
  const hasRefresh = req.cookies.has('furama_refresh');
  if (!hasRefresh && pathname.startsWith('/projects')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
