import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { error, json } from "@/lib/api";
import { createSession, verifyPassword } from "@/lib/auth";

const body = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error("Enter your email and password", 400);
  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return error("Wrong email or password", 401);
  }
  await createSession(user.id);
  return json({ ok: true });
}
