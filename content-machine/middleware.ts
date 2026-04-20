import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/intelligence",
  "/generate",
  "/settings",
  "/context",
  "/scheduling",
  "/media",
  "/create",
];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-middleware-pathname", pathname);

  // Middleware may run on Edge — prefer NEXT_PUBLIC_* (inlined at build). Node falls back to SUPABASE_*.
  const e = process.env;
  const url = e["NEXT_PUBLIC_SUPABASE_URL"] || e["SUPABASE_URL"] || "";
  const key =
    e["NEXT_PUBLIC_SUPABASE_ANON_KEY"] || e["SUPABASE_ANON_KEY"] || "";

  if (!url || !key) {
    console.error(
      "[content-machine] Set SUPABASE_URL and SUPABASE_ANON_KEY in repo-root `.env`. See `.env.example`.",
    );
    if (isProtectedPath(pathname) || pathname === "/onboarding") {
      const u = request.nextUrl.clone();
      u.pathname = "/login";
      u.searchParams.set("error", "config");
      u.searchParams.set("next", pathname);
      return NextResponse.redirect(u);
    }
    return NextResponse.next({
      request: new NextRequest(request.url, { headers: requestHeaders }),
    });
  }

  let supabaseResponse = NextResponse.next({
    request: new NextRequest(request.url, { headers: requestHeaders }),
  });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request: new NextRequest(request.url, { headers: requestHeaders }),
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (pathname.startsWith("/auth/callback")) {
    return supabaseResponse;
  }

  /**
   * Do not query `organization_members` here. Anon + RLS often hides that row in Edge
   * middleware even for valid members, which made `userInOrg` always false → redirect
   * loops or impossible login. Workspace membership is resolved in RSC via
   * `getCachedServerApiContext()` (service role when configured) and `/onboarding` page.
   */

  if (pathname === "/onboarding") {
    if (!user) {
      const u = request.nextUrl.clone();
      u.pathname = "/login";
      u.searchParams.set("next", "/onboarding");
      return NextResponse.redirect(u);
    }
    return supabaseResponse;
  }

  if (isProtectedPath(pathname) && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if ((pathname === "/login" || pathname === "/signup") && user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/intelligence/:path*",
    "/generate/:path*",
    "/settings/:path*",
    "/context/:path*",
    "/scheduling/:path*",
    "/media",
    "/media/:path*",
    "/create",
    "/create/:path*",
    "/onboarding",
    "/login",
    "/signup",
    "/auth/callback",
  ],
};
