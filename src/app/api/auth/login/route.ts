import { NextResponse } from 'next/server';

const CORRECT_PASSWORD = process.env.SITE_PASSWORD || 'password123';

export async function POST(req: Request) {
  try {
    const { password } = await req.json();

    if (password === CORRECT_PASSWORD) {
      const response = NextResponse.json({ ok: true });
      response.cookies.set('authenticated', 'true', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      });
      return response;
    }

    return NextResponse.json({ ok: false, error: 'Invalid password' }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });
  }
}