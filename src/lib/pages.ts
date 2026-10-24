import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { blocks, pages, pageShares, users } from "@/db/schema";
import { buildBlockTree, flattenBlocks, type EditorBlock } from "./blocks";
import { resolveRole, type AncestorPage, type Role } from "./permissions";

export type PageSummary = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  position: number;
};

/** The page and its ancestors, nearest first. */
export async function getPath(pageId: string, tx: Tx | typeof db = db): Promise<(AncestorPage & PageSummary)[]> {
  const result = await tx.execute<{
    id: string;
    owner_id: string;
    parent_id: string | null;
    title: string;
    icon: string | null;
    position: number;
    public_access: "none" | "view";
    archived: boolean;
  }>(sql`
    with recursive path as (
      select p.*, 0 as depth from pages p where p.id = ${pageId}
      union all
      select p.*, path.depth + 1 from pages p join path on p.id = path.parent_id
      where path.depth < 256
    )
    select id, owner_id, parent_id, title, icon, position, public_access,
           archived_at is not null as archived
    from path order by depth
  `);
  return result.rows.map((r) => ({
    id: r.id,
    ownerId: r.owner_id,
    parentId: r.parent_id,
    title: r.title,
    icon: r.icon,
    position: r.position,
    publicAccess: r.public_access,
    archived: r.archived,
  }));
}

export async function getRole(pageId: string, userId: string | null, tx: Tx | typeof db = db): Promise<Role | null> {
  if (!isUuid(pageId)) return null;
  const path = await getPath(pageId, tx);
  if (path.length === 0) return null;
  const shares = userId
    ? await tx
        .select({ pageId: pageShares.pageId, userId: pageShares.userId, role: pageShares.role })
        .from(pageShares)
        .where(and(eq(pageShares.userId, userId), inArray(pageShares.pageId, path.map((p) => p.id))))
    : [];
  return resolveRole(path, userId, shares);
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Pages for the sidebar: everything the user owns, plus roots of pages shared with them. */
export async function getSidebar(userId: string) {
  const owned = await db
    .select({ id: pages.id, parentId: pages.parentId, title: pages.title, icon: pages.icon, position: pages.position })
    .from(pages)
    .where(and(eq(pages.ownerId, userId), isNull(pages.archivedAt)))
    .orderBy(asc(pages.position), asc(pages.createdAt));

  // Drop pages whose ancestor is in the trash.
  const ids = new Set(owned.map((p) => p.id));
  const visible = owned.filter((p) => {
    let cur: PageSummary | undefined = p;
    while (cur?.parentId) {
      if (!ids.has(cur.parentId)) return false;
      cur = owned.find((o) => o.id === cur!.parentId);
    }
    return true;
  });

  const shared = await db
    .select({ id: pages.id, parentId: pages.parentId, title: pages.title, icon: pages.icon, position: pages.position })
    .from(pageShares)
    .innerJoin(pages, eq(pages.id, pageShares.pageId))
    .where(and(eq(pageShares.userId, userId), isNull(pages.archivedAt)))
    .orderBy(asc(pages.title));

  const trash = await db
    .select({ id: pages.id, parentId: pages.parentId, title: pages.title, icon: pages.icon, position: pages.position })
    .from(pages)
    .where(and(eq(pages.ownerId, userId), sql`${pages.archivedAt} is not null`))
    .orderBy(asc(pages.archivedAt));

  return { private: visible, shared: shared.map((p) => ({ ...p, parentId: null })), trash };
}

export async function createPage(ownerId: string, parentId: string | null, title = "") {
  const [{ max }] = await db
    .select({ max: sql<number | null>`max(${pages.position})` })
    .from(pages)
    .where(and(eq(pages.ownerId, ownerId), parentId ? eq(pages.parentId, parentId) : isNull(pages.parentId)));
  const [page] = await db
    .insert(pages)
    .values({ ownerId, parentId, title, position: (max ?? 0) + 1 })
    .returning({ id: pages.id });
  return page.id;
}

export async function getPageWithBlocks(pageId: string) {
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
  if (!page) return null;
  const rows = await db
    .select({
      id: blocks.id,
      parentId: blocks.parentId,
      position: blocks.position,
      type: blocks.type,
      props: blocks.props,
      content: blocks.content,
    })
    .from(blocks)
    .where(eq(blocks.pageId, pageId));
  const children = await db
    .select({ id: pages.id, title: pages.title, icon: pages.icon })
    .from(pages)
    .where(and(eq(pages.parentId, pageId), isNull(pages.archivedAt)))
    .orderBy(asc(pages.position));
  return {
    page,
    blocks: buildBlockTree(rows.map((r) => ({ ...r, props: r.props as Record<string, unknown> }))),
    children,
  };
}

/** Upserts the editor document's blocks and removes the ones that are gone. */
export async function saveBlocks(pageId: string, doc: EditorBlock[]) {
  const rows = flattenBlocks(doc);
  await db.transaction(async (tx) => {
    if (rows.length === 0) {
      await tx.delete(blocks).where(eq(blocks.pageId, pageId));
    } else {
      await tx.delete(blocks).where(
        and(eq(blocks.pageId, pageId), sql`${blocks.id} <> all(${sql.param(rows.map((r) => r.id))}::text[])`),
      );
      await tx
        .insert(blocks)
        .values(rows.map((r) => ({ ...r, pageId, updatedAt: new Date() })))
        .onConflictDoUpdate({
          target: [blocks.pageId, blocks.id],
          set: {
            parentId: sql`excluded.parent_id`,
            position: sql`excluded.position`,
            type: sql`excluded.type`,
            props: sql`excluded.props`,
            content: sql`excluded.content`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
    await tx.update(pages).set({ updatedAt: new Date() }).where(eq(pages.id, pageId));
  });
}

export async function listShares(pageId: string) {
  return db
    .select({ userId: users.id, email: users.email, name: users.name, role: pageShares.role })
    .from(pageShares)
    .innerJoin(users, eq(users.id, pageShares.userId))
    .where(eq(pageShares.pageId, pageId))
    .orderBy(asc(users.email));
}
