import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { error, json } from "@/lib/api";
import { createSession, hashPassword } from "@/lib/auth";
import { createPage } from "@/lib/pages";

const body = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error("Enter a name, a valid email and a password of at least 8 characters", 400);
  const { email, name, password } = parsed.data;

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return error("An account with that email already exists", 409);

  const [user] = await db
    .insert(users)
    .values({ email, name, passwordHash: await hashPassword(password) })
    .returning({ id: users.id });
  const pageId = await createPage(user.id, null, "Getting started");
  await createSession(user.id);
  return json({ pageId }, 201);
}
