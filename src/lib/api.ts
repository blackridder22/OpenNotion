import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser, type SessionUser } from "./auth";
import { getRole } from "./pages";
import { atLeast, type Role } from "./permissions";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const error = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function requireUser(): Promise<SessionUser | NextResponse> {
  const user = await getCurrentUser();
  return user ?? error("Sign in required", 401);
}

/** Loads the caller and checks their role on a page; returns a response on failure. */
export async function requirePageRole(pageId: string, needed: Role) {
  const user = await getCurrentUser();
  const role = await getRole(pageId, user?.id ?? null);
  if (!atLeast(role, needed)) {
    // Do not reveal that a page exists to people who cannot see it.
    return { failure: role ? error("Not allowed", 403) : error("Page not found", 404) };
  }
  return { user, role: role! };
}
