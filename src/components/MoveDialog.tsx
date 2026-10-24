"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { displayTitle, notifyPagesChanged, type SidebarPage } from "./tree";

export function MoveDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const [pages, setPages] = useState<SidebarPage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/pages")
      .then((r) => r.json())
      .then((d) => setPages(d.private ?? []));
  }, []);

  // A page cannot move under itself or one of its own sub-pages.
  const blocked = new Set([pageId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pages) {
      if (p.parentId && blocked.has(p.parentId) && !blocked.has(p.id)) {
        blocked.add(p.id);
        grew = true;
      }
    }
  }

  async function move(parentId: string | null) {
    const res = await fetch(`/api/pages/${pageId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId }),
    });
    if (!res.ok) return setError((await res.json()).error);
    notifyPagesChanged();
    onClose();
  }

  return (
    <Modal title="Move page to" onClose={onClose}>
      <ul className="move-list">
        <li>
          <button className="link-button" onClick={() => move(null)}>Top level (Private)</button>
        </li>
        {pages
          .filter((p) => !blocked.has(p.id))
          .map((p) => (
            <li key={p.id}>
              <button className="link-button" onClick={() => move(p.id)}>
                {p.icon ?? "📄"} {displayTitle(p.title)}
              </button>
            </li>
          ))}
      </ul>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
