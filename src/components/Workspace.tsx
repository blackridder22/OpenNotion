"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@/lib/auth";
import type { EditorBlock } from "@/lib/blocks";
import type { Role } from "@/lib/permissions";
import { MoveDialog } from "./MoveDialog";
import { ShareDialog } from "./ShareDialog";
import { createPage, Sidebar } from "./Sidebar";
import { displayTitle, notifyPagesChanged } from "./tree";

// BlockNote touches the DOM on creation, so it only renders in the browser.
const Editor = dynamic(() => import("./Editor"), { ssr: false, loading: () => <p className="muted">Loading…</p> });

type PageInfo = { id: string; title: string; icon: string | null; publicAccess: "none" | "view"; archived: boolean };
type Crumb = { id: string; title: string; icon: string | null };

type Props = {
  user: SessionUser | null;
  role: Role;
  page: PageInfo;
  blocks: EditorBlock[];
  subpages: { id: string; title: string; icon: string | null }[];
  crumbs: Crumb[];
};

const ICONS = ["📄", "📝", "📚", "✅", "💡", "🚀", "📌", "🗂️", "🎯", "🧪", "📅", "⭐"];

async function patchPage(id: string, body: Record<string, unknown>) {
  return fetch(`/api/pages/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function Workspace({ user, role, page, blocks, subpages, crumbs }: Props) {
  const router = useRouter();
  const canEdit = role === "owner" || role === "edit";
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "error" | null>(null);
  const [dialog, setDialog] = useState<"share" | "move" | "icon" | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitle(page.title);
    setIcon(page.icon);
  }, [page.id, page.title, page.icon]);

  function changeTitle(value: string) {
    setTitle(value);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      await patchPage(page.id, { title: value });
      notifyPagesChanged();
    }, 400);
  }

  async function changeIcon(value: string | null) {
    setIcon(value);
    setDialog(null);
    await patchPage(page.id, { icon: value });
    notifyPagesChanged();
  }

  async function archive(archived: boolean) {
    await patchPage(page.id, { archived });
    notifyPagesChanged();
    router.refresh();
  }

  async function addSubpage() {
    const id = await createPage(page.id);
    if (id) router.push(`/p/${id}`);
  }

  return (
    <div className="workspace">
      {user && <Sidebar user={user} activeId={page.id} />}
      <main className="page">
        <header className="topbar">
          <nav className="crumbs">
            {crumbs.map((c, i) => (
              <span key={c.id}>
                {i > 0 && <span className="crumb-sep">/</span>}
                <Link href={`/p/${c.id}`}>
                  {c.icon ? `${c.icon} ` : ""}
                  {c.id === page.id ? displayTitle(title) : displayTitle(c.title)}
                </Link>
              </span>
            ))}
          </nav>
          <div className="topbar-actions">
            {saveState && <span className="muted save-state">{{ saving: "Saving…", saved: "Saved", error: "Not saved" }[saveState]}</span>}
            {!canEdit && <span className="badge">View only</span>}
            {!user && <Link className="btn" href={`/login?next=/p/${page.id}`}>Log in</Link>}
            {role === "owner" && (
              <>
                <button className="btn" onClick={() => setDialog("share")}>Share</button>
                <button className="btn" onClick={() => setDialog("move")}>Move</button>
                {!page.archived && <button className="btn" onClick={() => archive(true)}>Trash</button>}
              </>
            )}
          </div>
        </header>

        {page.archived && (
          <div className="banner">
            This page is in the trash.
            {role === "owner" && (
              <button className="btn" onClick={() => archive(false)}>Restore</button>
            )}
          </div>
        )}

        <article className="page-body">
          <div className="page-icon-row">
            {icon ? (
              <button className="page-icon" disabled={!canEdit} onClick={() => setDialog("icon")} aria-label="Change icon">
                {icon}
              </button>
            ) : (
              canEdit && (
                <button className="link-button muted" onClick={() => setDialog("icon")}>
                  Add icon
                </button>
              )
            )}
            {dialog === "icon" && (
              <div className="icon-picker">
                {ICONS.map((i) => (
                  <button key={i} onClick={() => changeIcon(i)}>{i}</button>
                ))}
                <button className="link-button" onClick={() => changeIcon(null)}>Remove</button>
              </div>
            )}
          </div>
          <input
            className="page-title"
            value={title}
            placeholder="Untitled"
            readOnly={!canEdit}
            onChange={(e) => changeTitle(e.target.value)}
            aria-label="Page title"
          />
          <Editor key={page.id} pageId={page.id} initialBlocks={blocks} editable={canEdit} onSaveState={setSaveState} />

          {(subpages.length > 0 || canEdit) && (
            <section className="subpages">
              {subpages.map((s) => (
                <Link key={s.id} href={`/p/${s.id}`} className="subpage-link">
                  {s.icon ?? "📄"} {displayTitle(s.title)}
                </Link>
              ))}
              {canEdit && (
                <button className="link-button muted" onClick={addSubpage}>
                  + Add a sub-page
                </button>
              )}
            </section>
          )}
        </article>
      </main>

      {dialog === "share" && (
        <ShareDialog pageId={page.id} publicAccess={page.publicAccess} onClose={() => { setDialog(null); router.refresh(); }} />
      )}
      {dialog === "move" && <MoveDialog pageId={page.id} onClose={() => { setDialog(null); router.refresh(); }} />}
    </div>
  );
}
