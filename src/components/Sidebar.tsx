"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/auth";
import { displayTitle, notifyPagesChanged, PAGES_CHANGED, toTree, type SidebarPage, type TreeNode } from "./tree";

type SidebarData = { private: SidebarPage[]; shared: SidebarPage[]; trash: SidebarPage[] };

export async function createPage(parentId: string | null) {
  const res = await fetch("/api/pages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentId }),
  });
  if (!res.ok) return null;
  notifyPagesChanged();
  return (await res.json()).id as string;
}

export function Sidebar({ user, activeId }: { user: SessionUser; activeId: string }) {
  const router = useRouter();
  const [data, setData] = useState<SidebarData | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showTrash, setShowTrash] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/pages");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(PAGES_CHANGED, load);
    return () => window.removeEventListener(PAGES_CHANGED, load);
  }, [load]);

  // Keep the active page's ancestors open.
  useEffect(() => {
    if (!data) return;
    const byId = new Map(data.private.map((p) => [p.id, p]));
    const open = new Set<string>();
    let cur = byId.get(activeId);
    while (cur?.parentId) {
      open.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
    if (open.size) setExpanded((prev) => new Set([...prev, ...open]));
  }, [data, activeId]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function addPage(parentId: string | null) {
    const id = await createPage(parentId);
    if (!id) return;
    if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
    router.push(`/p/${id}`);
  }

  async function restore(id: string) {
    await fetch(`/api/pages/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: false }),
    });
    notifyPagesChanged();
    router.refresh();
  }

  async function deleteForever(id: string) {
    if (!confirm("Delete this page and its sub-pages forever?")) return;
    await fetch(`/api/pages/${id}`, { method: "DELETE" });
    notifyPagesChanged();
    if (id === activeId) router.push("/");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const renderNode = (node: TreeNode, depth: number) => {
    const isOpen = expanded.has(node.id);
    return (
      <li key={node.id}>
        <div className={`tree-row${node.id === activeId ? " active" : ""}`} style={{ paddingLeft: 8 + depth * 14 }}>
          <button
            className="tree-toggle"
            aria-label={isOpen ? "Collapse" : "Expand"}
            onClick={() => toggle(node.id)}
          >
            {node.children.length ? (isOpen ? "▾" : "▸") : "•"}
          </button>
          <Link href={`/p/${node.id}`} className="tree-link">
            <span className="tree-icon">{node.icon ?? "📄"}</span>
            {displayTitle(node.title)}
          </Link>
          <button className="tree-add" aria-label="Add a page inside" title="Add a page inside" onClick={() => addPage(node.id)}>
            +
          </button>
        </div>
        {isOpen && node.children.length > 0 && <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-user">
        <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
        <span className="sidebar-name">{user.name}&apos;s OpenNotion</span>
      </div>
      <button className="sidebar-action" onClick={() => addPage(null)}>
        + New page
      </button>

      <div className="sidebar-section">Private</div>
      <ul className="tree">{data && toTree(data.private).map((n) => renderNode(n, 0))}</ul>

      {data && data.shared.length > 0 && (
        <>
          <div className="sidebar-section">Shared with me</div>
          <ul className="tree">{data.shared.map((p) => renderNode({ ...p, children: [] }, 0))}</ul>
        </>
      )}

      <div className="sidebar-bottom">
        <button className="sidebar-action" onClick={() => setShowTrash(!showTrash)}>
          🗑 Trash {data && data.trash.length > 0 ? `(${data.trash.length})` : ""}
        </button>
        {showTrash && (
          <ul className="trash-list">
            {data?.trash.length === 0 && <li className="muted">Trash is empty</li>}
            {data?.trash.map((p) => (
              <li key={p.id}>
                <Link href={`/p/${p.id}`}>{displayTitle(p.title)}</Link>
                <button className="link-button" onClick={() => restore(p.id)}>
                  Restore
                </button>
                <button className="link-button danger" onClick={() => deleteForever(p.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className="sidebar-action" onClick={logout}>
          Log out
        </button>
      </div>
    </aside>
  );
}
