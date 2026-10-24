import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pages } from "@/db/schema";
import { error, json, requirePageRole } from "@/lib/api";
import { getPageWithBlocks, getPath } from "@/lib/pages";
import { wouldCreateCycle } from "@/lib/permissions";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const check = await requirePageRole(id, "view");
  if ("failure" in check) return check.failure;
  return json({ ...(await getPageWithBlocks(id)), role: check.role });
}

const body = z.object({
  title: z.string().max(500).optional(),
  icon: z.string().max(16).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  archived: z.boolean().optional(),
  publicAccess: z.enum(["none", "view"]).optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error("Invalid update", 400);
  const input = parsed.data;
  const ownerOnly = input.parentId !== undefined || input.archived !== undefined || input.publicAccess !== undefined;

  const check = await requirePageRole(id, ownerOnly ? "owner" : "edit");
  if ("failure" in check) return check.failure;

  const update: Partial<typeof pages.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) update.title = input.title;
  if (input.icon !== undefined) update.icon = input.icon;
  if (input.publicAccess !== undefined) update.publicAccess = input.publicAccess;
  if (input.archived !== undefined) update.archivedAt = input.archived ? new Date() : null;
  if (input.parentId !== undefined) {
    if (input.parentId) {
      const parentPath = await getPath(input.parentId);
      if (parentPath.length === 0 || parentPath[0].ownerId !== check.user!.id) {
        return error("You can only move a page under one of your own pages", 400);
      }
      if (wouldCreateCycle(id, parentPath.map((p) => p.id))) {
        return error("A page cannot be moved inside itself", 400);
      }
    }
    update.parentId = input.parentId;
  }
  await db.update(pages).set(update).where(eq(pages.id, id));
  return json({ ok: true });
}

// Permanent deletion, only for pages already in the trash.
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const check = await requirePageRole(id, "owner");
  if ("failure" in check) return check.failure;
  const deleted = await db
    .delete(pages)
    .where(and(eq(pages.id, id), isNotNull(pages.archivedAt)))
    .returning({ id: pages.id });
  if (deleted.length === 0) return error("Move the page to the trash first", 400);
  return json({ ok: true });
}
