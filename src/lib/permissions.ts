// Notion-style permission inheritance: a role granted on a page applies to
// every page beneath it, and the strongest grant along the path wins.

export type Role = "owner" | "edit" | "view";
export type ShareRole = "view" | "edit";

export type AncestorPage = {
  id: string;
  ownerId: string;
  publicAccess: "none" | "view";
  archived: boolean;
};

export type Share = { pageId: string; userId: string; role: ShareRole };

const rank: Record<Role, number> = { view: 1, edit: 2, owner: 3 };

export function strongest(a: Role | null, b: Role | null): Role | null {
  if (!a) return b;
  if (!b) return a;
  return rank[a] >= rank[b] ? a : b;
}

export function atLeast(role: Role | null, needed: Role): boolean {
  return role !== null && rank[role] >= rank[needed];
}

/**
 * `path` runs from the page itself up to its root. Pages in a subtree always
 * share the root's owner, so ownership is read from the page itself.
 */
export function resolveRole(path: AncestorPage[], userId: string | null, shares: Share[]): Role | null {
  if (path.length === 0) return null;
  const page = path[0];
  if (userId && page.ownerId === userId) return "owner";
  // Only the owner can open a page that is in the trash.
  if (path.some((p) => p.archived)) return null;

  const ids = new Set(path.map((p) => p.id));
  let role: Role | null = path.some((p) => p.publicAccess === "view") ? "view" : null;
  if (userId) {
    for (const share of shares) {
      if (share.userId === userId && ids.has(share.pageId)) role = strongest(role, share.role);
    }
  }
  return role;
}

export function wouldCreateCycle(pageId: string, newParentAncestors: string[]): boolean {
  return newParentAncestors.includes(pageId);
}
