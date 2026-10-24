import { z } from "zod";
import { error, json, requirePageRole } from "@/lib/api";
import type { EditorBlock } from "@/lib/blocks";
import { saveBlocks } from "@/lib/pages";

type Ctx = { params: Promise<{ id: string }> };

const block: z.ZodType<EditorBlock> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(100),
    type: z.string().min(1).max(100),
    props: z.record(z.string(), z.unknown()).optional(),
    content: z.unknown().optional(),
    children: z.array(block).optional(),
  }),
);
const body = z.object({ blocks: z.array(block).max(10_000) });

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const check = await requirePageRole(id, "edit");
  if ("failure" in check) return check.failure;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error("Invalid document", 400);
  try {
    await saveBlocks(id, parsed.data.blocks);
  } catch (e) {
    return error(e instanceof Error ? e.message : "Could not save", 400);
  }
  return json({ ok: true });
}
