import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PROTECTED = ["/dashboard", "/connect", "/shops"];

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();

  const sessionCookie = getSessionCookie(req);
  if (!sessionCookie) {
    const url = new URL("/signin", req.url);
    url.searchParams.set("next", path + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/connect/:path*", "/shops/:path*"],
};
