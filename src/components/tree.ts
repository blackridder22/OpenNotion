export type SidebarPage = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  position: number;
};

export type TreeNode = SidebarPage & { children: TreeNode[] };

export function toTree(pages: SidebarPage[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>(pages.map((p) => [p.id, { ...p, children: [] }]));
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => a.position - b.position);
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

export const PAGES_CHANGED = "opennotion:pages-changed";
export const notifyPagesChanged = () => window.dispatchEvent(new Event(PAGES_CHANGED));
export const displayTitle = (title: string) => title.trim() || "Untitled";
