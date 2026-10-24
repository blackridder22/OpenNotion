import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pageShares, users } from "@/db/schema";
import { error, json, requirePageRole } from "@/lib/api";
import { isUuid, listShares } from "@/lib/pages";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const check = await requirePageRole(id, "owner");
  if ("failure" in check) return check.failure;
  return json({ shares: await listShares(id) });
}

const body = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["view", "edit"]) });

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const check = await requirePageRole(id, "owner");
  if ("failure" in check) return check.failure;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error("Enter an email and a role", 400);

  const [invitee] = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email)).limit(1);
  if (!invitee) return error("No account uses that email yet. Ask them to sign up first.", 404);
  if (invitee.id === check.user!.id) return error("You already own this page", 400);

  await db
    .insert(pageShares)
    .values({ pageId: id, userId: invitee.id, role: parsed.data.role })
    .onConflictDoUpdate({ target: [pageShares.pageId, pageShares.userId], set: { role: parsed.data.role } });
  return json({ shares: await listShares(id) });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const check = await requirePageRole(id, "owner");
  if ("failure" in check) return check.failure;
  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId || !isUuid(userId)) return error("Missing userId", 400);
  await db.delete(pageShares).where(and(eq(pageShares.pageId, id), eq(pageShares.userId, userId)));
  return json({ shares: await listShares(id) });
}
