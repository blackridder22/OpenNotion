import { z } from "zod";
import { error, json, requirePageRole, requireUser } from "@/lib/api";
import { createPage, getPath, getSidebar } from "@/lib/pages";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json(await getSidebar(user.id));
}

const body = z.object({
  parentId: z.string().uuid().nullable().optional(),
  title: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return error("Invalid page", 400);
  const parentId = parsed.data.parentId ?? null;

  let ownerId = user.id;
  if (parentId) {
    const check = await requirePageRole(parentId, "edit");
    if ("failure" in check) return check.failure;
    // A sub-page belongs to whoever owns the tree it lives in, so the tree's
    // sharing settings keep applying to it.
    ownerId = (await getPath(parentId))[0].ownerId;
  }
  const id = await createPage(ownerId, parentId, parsed.data.title ?? "");
  return json({ id }, 201);
}
