import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from './lib/auth';

export async function middleware(request: NextRequest) {
  const { searchParams, pathname } = request.nextUrl;
  const token = searchParams.get('token');

  // Skip middleware for health check and static assets
  if (pathname.startsWith('/health') || pathname.includes('_next') || pathname.includes('favicon.ico')) {
    return NextResponse.next();
  }

  // 1. If token is present in URL, verify and set cookie
  if (token) {
    const result = await verifyToken(token);
    if (result.payload) {
      // Вместо редиректа просто разрешаем запрос и ставим куку
      const response = NextResponse.next();
      response.cookies.set('auth_token', token, {
        httpOnly: true,
        secure: false, // Отключаем для работы на HTTP без SSL
        sameSite: 'lax',
        path: '/',
      });
      return response;
    } else {
      return new NextResponse(`Access Denied. JWT Error: ${result.error}`, { status: 403 });
    }
  }

  // 2. Check if auth_token cookie exists
  const cookieToken = request.cookies.get('auth_token')?.value;
  if (cookieToken) {
    const result = await verifyToken(cookieToken);
    if (result.payload) return NextResponse.next();
    // If cookie token is invalid, we will fall through to the 401/403 below
  }

  // 3. For API or UI without token
  if (pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return new NextResponse(`Access Denied: No token found in URL or Cookie.
  Current URL: ${request.url}
  Please open this module from the ERP system.`, { status: 403 });
}

export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
};
