import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const CORRECT_PASSWORD = process.env.APP_PASSWORD || 'password123';

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  
  // Public routes that should never require auth cookie.
  if (
    pathname === '/login' ||
    pathname === '/confirm' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/confirm') ||
    pathname.startsWith('/api/enrollment-form')


  ) {
    return NextResponse.next();
  }
  
  // Allow static assets and next internals
  if (pathname.startsWith('/_next') || pathname.startsWith('/public')) {
    return NextResponse.next();
  }
  
  // Check for auth cookie on all other routes
  const authCookie = request.cookies.get('authenticated')?.value;
  
  if (authCookie !== 'true') {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.svg).*)'],
};