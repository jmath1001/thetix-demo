import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const DEMO_SEGMENT_COOKIE = 'gs_demo_segment';
const DEMO_SEGMENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

function normalizeSegment(input: string | null): string | null {
  const value = (input ?? '').trim().toLowerCase();
  if (!value) return null;

  const cleaned = value
    .replace(/[^a-z0-9-_ ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  return cleaned || null;
}

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const investorParam = url.searchParams.get('investor');

  if (investorParam === null) {
    return NextResponse.next();
  }

  const responseUrl = request.nextUrl.clone();
  responseUrl.searchParams.delete('investor');
  const response = NextResponse.redirect(responseUrl);

  const normalized = normalizeSegment(investorParam);
  if (!normalized || normalized === 'clear') {
    response.cookies.delete(DEMO_SEGMENT_COOKIE);
    return response;
  }

  response.cookies.set(DEMO_SEGMENT_COOKIE, `investor:${normalized}`, {
    path: '/',
    sameSite: 'lax',
    maxAge: DEMO_SEGMENT_MAX_AGE_SECONDS,
  });

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.svg).*)'],
};